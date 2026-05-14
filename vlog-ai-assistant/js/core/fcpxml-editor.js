/* fcpxml-editor.js — Apply approved AI edit decisions to FCPXML
 *
 * Cut decisions   → trim / remove / split spine clips, shift downstream clips
 * B-roll decisions → insert a connected clip (lane="1") from the best-matching asset
 * Story decisions  → injected as <marker> elements (reordering is a manual step)
 *
 * The spine block in the raw XML is replaced wholesale; all <resources>,
 * project metadata and sequence attributes outside the spine are preserved.
 */

var FCPXMLEditor = (function () {

    var MIN_DUR = 0.05; // clips shorter than this (seconds) are dropped

    // ── Public entry point ────────────────────────────────────────────────

    function applyDecisions(rawXml, parsedData, approvedDecisions) {
        // Dispatch to XMEML path if the source file is Premiere's FCP7 legacy format
        if (rawXml.indexOf('<xmeml') !== -1) {
            return _applyDecisionsXmeml(rawXml, parsedData, approvedDecisions);
        }

        // Deep-clone clip list so we never mutate the parsed cache
        var clips = parsedData.clips.map(function (c) {
            return {
                ref: c.ref, name: c.name, offset: c.offset, duration: c.duration,
                start: c.start || 0, lane: c.lane || 0, type: c.type, path: c.path
            };
        });

        var aroll = clips.filter(function (c) { return c.lane === 0; });
        var broll = clips.filter(function (c) { return c.lane > 0; });

        // ── 1. Apply cuts (reverse order so original coords stay valid) ──
        var cuts = approvedDecisions
            .filter(function (d) { return d.type === 'cut' && typeof d.timelineOffset === 'number'; })
            .sort(function (a, b) { return b.timelineOffset - a.timelineOffset; });

        cuts.forEach(function (cut) {
            var r = _applyCut(aroll, broll, cut.timelineOffset, cut.duration || 0);
            aroll = r.aroll;
            broll = r.broll;
        });

        // ── 2. Insert B-roll connected clips ──────────────────────────────
        var brollDecisions = approvedDecisions.filter(function (d) { return d.type === 'broll'; });
        brollDecisions.forEach(function (bd) {
            var asset = _findBrollAsset(parsedData, bd.description || '', broll);
            if (!asset) return;
            var dur = typeof bd.duration === 'number' && bd.duration > 0 ? bd.duration : 5;
            broll.push({
                ref: asset.id, name: asset.name, offset: bd.timelineOffset,
                duration: Math.min(dur, asset.duration || dur),
                start: 0, lane: 1, type: 'broll', path: asset.src || ''
            });
        });

        // ── 3. Story decisions → markers ─────────────────────────────────
        var storyMarkers = approvedDecisions
            .filter(function (d) { return d.type === 'story'; })
            .map(function (d) {
                return { offset: d.timelineOffset, label: '[STORY] ' + (d.description || ''), note: d.reason || '' };
            });

        // ── 4. Build new sequence duration ───────────────────────────────
        var newDuration = 0;
        aroll.forEach(function (c) {
            var end = c.offset + c.duration;
            if (end > newDuration) newDuration = end;
        });

        // ── 5. Rebuild the XML ───────────────────────────────────────────
        var newSpine = _buildSpine(aroll, broll, storyMarkers);
        return _spliceSpine(rawXml, newSpine, newDuration);
    }

    // ── Cut logic ─────────────────────────────────────────────────────────

    function _applyCut(aroll, broll, T, D) {
        var END = T + D;
        return {
            aroll: _cutClips(aroll, T, END, D, true),
            broll: _cutClips(broll, T, END, D, false)
        };
    }

    function _cutClips(list, T, END, D, allowSplit) {
        var out = [];
        list.forEach(function (c) {
            var cEnd = c.offset + c.duration;

            if (cEnd <= T) {
                // Entirely before cut → keep unchanged
                out.push(c); return;
            }
            if (c.offset >= END) {
                // Entirely after cut → shift left by D
                out.push(_clone(c, { offset: c.offset - D })); return;
            }
            if (c.offset >= T && cEnd <= END) {
                // Fully inside cut → remove
                return;
            }

            if (c.offset < T && cEnd > END) {
                // Cut is inside clip → split into Part 1 + Part 2
                var part1Dur = T - c.offset;
                if (part1Dur >= MIN_DUR) out.push(_clone(c, { duration: part1Dur }));
                if (allowSplit) {
                    var part2Dur = cEnd - END;
                    if (part2Dur >= MIN_DUR) {
                        out.push(_clone(c, {
                            offset: T,
                            start:  c.start + (END - c.offset),
                            duration: part2Dur
                        }));
                    }
                }
                return;
            }

            if (c.offset < T) {
                // Clip tail overlaps cut start → trim tail
                var newDur = T - c.offset;
                if (newDur >= MIN_DUR) out.push(_clone(c, { duration: newDur }));
                return;
            }

            // Clip head overlaps cut end → trim head, shift left to T
            var skip = END - c.offset;
            var remDur = cEnd - END;
            if (remDur >= MIN_DUR) {
                out.push(_clone(c, {
                    offset:   T,
                    start:    c.start + skip,
                    duration: remDur
                }));
            }
        });
        return out;
    }

    // ── B-roll asset matching ─────────────────────────────────────────────

    function _findBrollAsset(parsedData, description, existingBroll) {
        var usedRefs = {};
        existingBroll.forEach(function (c) { usedRefs[c.ref] = true; });

        var descWords = description.toLowerCase().split(/\W+/).filter(Boolean);

        var best = null, bestScore = -1;
        Object.keys(parsedData.assets).forEach(function (id) {
            var asset = parsedData.assets[id];
            if (!FCPXMLParser._looksLikeBroll(asset.name)) return;

            var nameWords = asset.name.toLowerCase().split(/\W+/).filter(Boolean);
            var score = 0;
            descWords.forEach(function (w) { if (nameWords.indexOf(w) !== -1) score++; });
            // Prefer unused assets
            if (!usedRefs[id]) score += 0.5;

            if (score > bestScore) { bestScore = score; best = { id: id, name: asset.name, src: asset.src, duration: asset.duration }; }
        });
        return best; // may be null if no B-roll assets exist
    }

    // ── Spine builder ─────────────────────────────────────────────────────

    function _buildSpine(aroll, broll, storyMarkers) {
        var lines = ['    <spine>'];

        // Sort A-roll by timeline position
        var sortedA = aroll.slice().sort(function (a, b) { return a.offset - b.offset; });

        sortedA.forEach(function (ac) {
            var acEnd = ac.offset + ac.duration;

            // B-roll children that fall inside this A-roll's range
            var children = broll.filter(function (bc) {
                return bc.offset >= ac.offset && bc.offset < acEnd;
            });

            // Story markers that fall inside this A-roll's range
            var markers = storyMarkers.filter(function (m) {
                return m.offset >= ac.offset && m.offset < acEnd;
            });

            var hasChildren = children.length > 0 || markers.length > 0;
            var tag = '      <clip ' + _clipAttrs(ac, false);

            if (!hasChildren) {
                lines.push(tag + '/>');
            } else {
                lines.push(tag + '>');
                children.forEach(function (bc) {
                    lines.push('        <clip ' + _clipAttrs(bc, true) + '/>');
                });
                markers.forEach(function (m) {
                    lines.push('        <marker start="' + _toTime(m.offset - ac.offset) +
                        '" duration="' + _toTime(1 / 25) + '" value="' +
                        _esc(m.label) + '" note="' + _esc(m.note) + '"/>');
                });
                lines.push('      </clip>');
            }
        });

        lines.push('    </spine>');
        return lines.join('\n');
    }

    function _clipAttrs(c, isChild) {
        var parts = [];
        parts.push('name="' + _esc(c.name) + '"');
        parts.push('offset="' + _toTime(c.offset) + '"');
        parts.push('duration="' + _toTime(c.duration) + '"');
        if (c.start > 0.001) parts.push('start="' + _toTime(c.start) + '"');
        if (c.ref) parts.push('ref="' + _esc(c.ref) + '"');
        if (isChild && c.lane && c.lane > 0) parts.push('lane="' + c.lane + '"');
        return parts.join(' ');
    }

    // ── XML surgery ───────────────────────────────────────────────────────

    function _spliceSpine(xml, newSpine, newDuration) {
        // Use regex so we match <spine> whether or not it has attributes
        if (typeof Logger !== 'undefined') {
            Logger.debug('FCPXMLEditor: XML length=' + xml.length + ' first300=' + xml.slice(0, 300).replace(/\s+/g, ' '));
        }
        var openMatch = /<spine(\s[^>]*)?>/.exec(xml);
        if (!openMatch) {
            // No <spine> tag in raw XML — inject the full rebuilt spine before </sequence>.
            // This handles Premiere FCPXML exports that omit the spine wrapper.
            var seqClose = xml.indexOf('</sequence>');
            if (seqClose === -1) {
                throw new Error('Could not locate <spine> or <sequence> block in FCPXML');
            }
            var result0 = xml.slice(0, seqClose) + '\n' + newSpine + '\n' + xml.slice(seqClose);
            result0 = result0.replace(
                /(<sequence\b[^>]*?\s)duration="[^"]*"/,
                '$1duration="' + _toTime(newDuration) + '"'
            );
            return result0;
        }

        var spineStart = openMatch.index;
        var spineEnd   = xml.indexOf('</spine>', spineStart);
        if (spineEnd === -1) {
            throw new Error('Found <spine> open tag but no </spine> closing tag');
        }
        spineEnd += '</spine>'.length;

        var result = xml.slice(0, spineStart) + newSpine + xml.slice(spineEnd);

        // Update the sequence duration attribute
        result = result.replace(
            /(<sequence\b[^>]*?\s)duration="[^"]*"/,
            '$1duration="' + _toTime(newDuration) + '"'
        );

        return result;
    }

    // Used only when no <spine> is found — extract markers from the built spine XML
    function _decisionsToMarkers(spineXml) {
        var markers = [];
        var re = /<marker\s[^/]*/g;
        var m;
        while ((m = re.exec(spineXml)) !== null) {
            markers.push('    ' + m[0] + '/>');
        }
        return markers.length ? '\n' + markers.join('\n') : '';
    }

    // ── Utilities ─────────────────────────────────────────────────────────

    function _clone(c, overrides) {
        return Object.assign({}, c, overrides);
    }

    function _toTime(secs) {
        var ms = Math.round(Math.max(0, secs) * 1000);
        return ms + '/1000s';
    }

    function _esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    // ── XMEML (Premiere Pro FCP7 legacy format) edit path ────────────────

    var _xmemlCounter = 0;

    function _applyDecisionsXmeml(rawXml, parsedData, approvedDecisions) {
        var fps = parsedData.frameRate || 25;

        // Build frame-based A-roll list
        var aroll = parsedData.clips
            .filter(function (c) { return c.lane === 0; })
            .map(function (c) {
                return {
                    name:       c.name,
                    _itemId:    c._itemId  || '',
                    _fileRef:   c._fileRef || c.ref || '',
                    startFrame: c._startFrame !== undefined ? c._startFrame : Math.round(c.offset * fps),
                    endFrame:   c._endFrame   !== undefined ? c._endFrame   : Math.round((c.offset + c.duration) * fps),
                    inFrame:    c._inFrame    !== undefined ? c._inFrame    : Math.round(c.start * fps),
                    outFrame:   c._outFrame   !== undefined ? c._outFrame   : Math.round((c.start + c.duration) * fps)
                };
            });

        // Apply cuts in reverse order so early offsets stay valid
        var cuts = approvedDecisions
            .filter(function (d) { return d.type === 'cut' && typeof d.timelineOffset === 'number'; })
            .map(function (d) {
                var T = Math.round(d.timelineOffset * fps);
                var D = Math.max(1, Math.round((d.duration || 0) * fps));
                return { T: T, END: T + D, D: D };
            })
            .sort(function (a, b) { return b.T - a.T; });

        cuts.forEach(function (cut) {
            aroll = _cutXmemlClips(aroll, cut.T, cut.END, cut.D);
        });

        var newTrackContent = _buildXmemlTrackContent(aroll, fps, parsedData._fileDefMap || {});
        return _spliceXmemlPrimaryTrack(rawXml, newTrackContent, aroll);
    }

    function _cutXmemlClips(list, T, END, D) {
        var out = [];
        list.forEach(function (c) {
            var S = c.startFrame, E = c.endFrame, I = c.inFrame, O = c.outFrame;

            if (E <= T) {
                out.push(c); return;
            }
            if (S >= END) {
                out.push(_cloneXm(c, { startFrame: S - D, endFrame: E - D })); return;
            }
            if (S >= T && E <= END) {
                return; // fully removed
            }
            if (S < T && E > END) {
                // Split
                var d1 = T - S;
                if (d1 >= 1) out.push(_cloneXm(c, { endFrame: T, outFrame: I + d1 }));
                var d2 = E - END;
                if (d2 >= 1) {
                    out.push(_cloneXm(c, {
                        startFrame: T, endFrame: T + d2,
                        inFrame: I + (END - S), outFrame: O,
                        _itemId: c._itemId + '_s' + (++_xmemlCounter)
                    }));
                }
                return;
            }
            if (S < T) {
                // Tail overlaps cut start
                var trimEnd = T - S;
                if (trimEnd >= 1) out.push(_cloneXm(c, { endFrame: T, outFrame: I + trimEnd }));
                return;
            }
            // Head overlaps cut end
            var skip = END - S;
            var newEnd = E - D;
            if (newEnd - T >= 1) out.push(_cloneXm(c, { startFrame: T, endFrame: newEnd, inFrame: I + skip }));
        });
        return out;
    }

    function _cloneXm(c, overrides) {
        return Object.assign({}, c, overrides);
    }

    function _buildXmemlTrackContent(clips, fps, fileDefMap) {
        var ntsc = (Math.round(fps) !== fps) ? 'TRUE' : 'FALSE';
        var fpsInt = Math.round(fps);
        var fmap = fileDefMap || {};
        var seenFileIds = {};
        return clips.map(function (c) {
            var dur  = c.outFrame - c.inFrame;
            var id   = _esc(c._itemId || ('clipitem-' + (++_xmemlCounter)));
            var fileTag = '';
            if (c._fileRef) {
                var fid = c._fileRef;
                if (fmap[fid] && !seenFileIds[fid]) {
                    // First occurrence of this file: embed the full definition
                    // (includes <pathurl> so Premiere can re-link the source media)
                    fileTag = '                ' + fmap[fid];
                } else {
                    // Subsequent reference — id-only is sufficient
                    fileTag = '                <file id="' + _esc(fid) + '"/>';
                }
                seenFileIds[fid] = true;
            }
            return [
                '            <clipitem id="' + id + '">',
                '                <name>' + _esc(c.name) + '</name>',
                '                <duration>' + Math.abs(dur) + '</duration>',
                '                <rate>',
                '                    <timebase>' + fpsInt + '</timebase>',
                '                    <ntsc>' + ntsc + '</ntsc>',
                '                </rate>',
                '                <start>' + c.startFrame + '</start>',
                '                <end>'   + c.endFrame   + '</end>',
                '                <in>'    + c.inFrame    + '</in>',
                '                <out>'   + c.outFrame   + '</out>',
                fileTag,
                '            </clipitem>'
            ].filter(Boolean).join('\n');
        }).join('\n');
    }

    function _spliceXmemlPrimaryTrack(xml, newTrackContent, clips) {
        // Locate <sequence> (skips master clip definitions above it)
        var seqMatch = /<sequence\b[^>]*>/.exec(xml);
        if (!seqMatch) throw new Error('Could not find <sequence> in XMEML');
        var afterSeqTag = seqMatch.index + seqMatch[0].length;

        // <media> inside the sequence
        var mediaIdx = xml.indexOf('<media>', afterSeqTag);
        if (mediaIdx === -1) throw new Error('Could not find <media> in XMEML sequence');

        // <video> inside <media>
        var videoMatch = /<video\b[^>]*>/.exec(xml.slice(mediaIdx));
        if (!videoMatch) throw new Error('Could not find <video> in XMEML');
        var afterVideoTag = mediaIdx + videoMatch.index + videoMatch[0].length;

        // First <track> inside <video>
        var trackMatch = /<track\b[^>]*>/.exec(xml.slice(afterVideoTag));
        if (!trackMatch) throw new Error('Could not find primary <track> in XMEML <video>');
        var trackContentStart = afterVideoTag + trackMatch.index + trackMatch[0].length;

        // Closing </track>
        var trackEnd = xml.indexOf('</track>', trackContentStart);
        if (trackEnd === -1) throw new Error('Found <track> but no </track>');

        // Replace track content
        var result = xml.slice(0, trackContentStart) +
                     '\n' + newTrackContent + '\n        ' +
                     xml.slice(trackEnd);

        // Update the sequence's own <duration> (first one after <sequence>, before <media>)
        if (clips.length > 0) {
            var newDurFrames = 0;
            clips.forEach(function (c) { if (c.endFrame > newDurFrames) newDurFrames = c.endFrame; });
            var seqTagPos = result.indexOf('<sequence');
            if (seqTagPos !== -1) {
                var firstDurPos = result.indexOf('<duration>', seqTagPos);
                if (firstDurPos !== -1) {
                    var firstDurClose = result.indexOf('</duration>', firstDurPos) + '</duration>'.length;
                    result = result.slice(0, firstDurPos) +
                             '<duration>' + newDurFrames + '</duration>' +
                             result.slice(firstDurClose);
                }
            }
        }

        return result;
    }

    // ── Public surface ────────────────────────────────────────────────────

    return { applyDecisions: applyDecisions };

}());

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FCPXMLEditor;
}
