/* xml-parser.js — Parse Premiere Pro FCPXML into structured data

   FCPXML 1.9 structure:
     <resources>
       <format id="r1" frameDuration="1001/30000s" width="1920" height="1080"/>
       <asset id="r2" name="clip.mp4" .../>
     </resources>
     <library><event><project name="My Sequence">
       <sequence duration="120s" format="r1">
         <spine>
           <clip name="talking_head.mp4" offset="0s" duration="30s" ref="r2">
             <clip name="broll.mp4" lane="1" offset="5s" duration="10s" ref="r3"/>
           </clip>
         </spine>
       </sequence>
     </project></event></library>

   Timecodes: rational "N/Ds" or integer "Ns"
     "86400s/2500" → 86400/2500 = 34.56s
     "1001/30000s" → 1001/30000 ≈ 0.0334s (one frame at 29.97fps)
*/

var FCPXMLParser = {

    /* Public entry point. Returns:
       {
         sequenceName, duration, frameRate, width, height,
         clips: [{ name, offset, duration, start, lane, track, type, path }],
         captions: [{ start, end, text }],
         assets: { id: { name, src, duration } }
       }
    */
    parse: function(xmlString) {
        // Prefer native DOMParser; fall back to SimpleXML shim (needed in UXP/Premiere Pro)
        var domParser = null;
        try {
            domParser = new DOMParser();
        } catch (e) {
            if (typeof SimpleXML !== 'undefined') {
                domParser = SimpleXML;
            }
        }
        if (!domParser) {
            throw new Error('No XML parser available. Load js/utils/xml-shim.js before xml-parser.js.');
        }

        var doc = domParser.parseFromString(xmlString, 'text/xml');

        // Both DOMParser and SimpleXML expose <parsererror> on failure
        var errEl = doc.querySelector('parsererror');
        if (errEl) {
            throw new Error('XML parse error: ' + errEl.textContent.slice(0, 200));
        }

        // Detect XMEML (Premiere Pro's FCP7 legacy export) vs FCPXML
        if (xmlString.indexOf('<xmeml') !== -1) {
            return this._parseXmeml(doc, xmlString);
        }

        var result = {
            sequenceName: 'Untitled Sequence',
            duration: 0,
            frameRate: 30,
            width: 1920,
            height: 1080,
            clips: [],
            captions: [],
            assets: {},
            _formats: {}
        };

        this._parseResources(doc, result);

        var sequence = doc.querySelector('sequence');
        if (!sequence) {
            throw new Error('No <sequence> element found. Is this a valid Premiere Pro FCPXML export?');
        }

        // Sequence name comes from the parent <project> element
        var project = sequence.parentElement;
        while (project && project.tagName.toLowerCase() !== 'project') {
            project = project.parentElement;
        }
        if (project) {
            result.sequenceName = project.getAttribute('name') || result.sequenceName;
        }

        result.duration = this._parseTime(sequence.getAttribute('duration') || '0s');

        // Look up format for frame rate + dimensions
        var fmtId = sequence.getAttribute('format');
        if (fmtId && result._formats[fmtId]) {
            var fmt = result._formats[fmtId];
            result.frameRate = fmt.frameRate;
            result.width     = fmt.width;
            result.height    = fmt.height;
        }

        var spine = sequence.querySelector('spine');
        if (spine) {
            this._walkSpine(spine, result);
        } else {
            this._walkSpine(sequence, result);
        }

        // Clean up internal map
        delete result._formats;

        return result;
    },

    // ── XMEML (Premiere Pro FCP7 legacy format) ────────────────────────

    _parseXmeml: function(doc, rawXml) {
        var self = this;
        var result = {
            sequenceName: 'Untitled Sequence',
            duration: 0,
            frameRate: 25,
            width: 1920,
            height: 1080,
            clips: [],
            captions: [],
            assets: {},
            _format: 'xmeml',
            // Map of fileId → full <file>…</file> XML string.
            // Full definitions contain <pathurl>; Premiere needs these to re-link media.
            _fileDefMap: {}
        };

        // Extract full <file> definitions from the raw XML string.
        // Full definitions always start with a <name> child element;
        // reference-only elements are self-closing (<file id="x"/>).
        if (rawXml) {
            var filePat = /<file\s+id="([^"]+)"\s*>\s*<name>[\s\S]*?<\/file>/g;
            var fm;
            while ((fm = filePat.exec(rawXml)) !== null) {
                if (!result._fileDefMap[fm[1]]) {
                    result._fileDefMap[fm[1]] = fm[0];
                }
            }
        }

        var sequence = doc.querySelector('sequence');
        if (!sequence) {
            throw new Error('No <sequence> found in XMEML. Export your sequence from Premiere using File → Export → Final Cut Pro XML.');
        }

        // Name
        var nameEl = sequence.querySelector('name');
        if (nameEl) result.sequenceName = nameEl.textContent.trim();

        // Frame rate
        var rateEl = sequence.querySelector('rate');
        var tbEl = rateEl ? rateEl.querySelector('timebase') : null;
        var fps = tbEl ? (parseInt(tbEl.textContent.trim(), 10) || 25) : 25;
        result.frameRate = fps;

        // Dimensions from samplecharacteristics
        var scEl = sequence.querySelector('samplecharacteristics');
        if (scEl) {
            var wEl = scEl.querySelector('width');
            var hEl = scEl.querySelector('height');
            if (wEl) result.width  = parseInt(wEl.textContent.trim(), 10) || 1920;
            if (hEl) result.height = parseInt(hEl.textContent.trim(), 10) || 1080;
        }

        // Sequence duration (frames → seconds)
        // <duration> appears as direct child of <sequence>, before <media>
        var durEl = sequence.querySelector('duration');
        if (durEl) result.duration = (parseInt(durEl.textContent.trim(), 10) || 0) / fps;

        // Walk video tracks: <media><video><track><clipitem>
        var media = sequence.querySelector('media');
        if (!media) return result;
        var video = media.querySelector('video');
        if (!video) return result;

        var videoChildren = video.children;
        var trackIdx = 0;
        for (var ti = 0; ti < videoChildren.length; ti++) {
            var trackEl = videoChildren[ti];
            if (trackEl.tagName.toLowerCase() !== 'track') continue;
            var clipChildren = trackEl.children;
            for (var ci = 0; ci < clipChildren.length; ci++) {
                var item = clipChildren[ci];
                if (item.tagName.toLowerCase() === 'clipitem') {
                    self._extractXmemlClip(item, trackIdx, fps, result);
                }
            }
            trackIdx++;
        }

        return result;
    },

    _extractXmemlClip: function(item, lane, fps, result) {
        var nameEl  = item.querySelector('name');
        var startEl = item.querySelector('start');
        var endEl   = item.querySelector('end');
        var inEl    = item.querySelector('in');
        var outEl   = item.querySelector('out');
        var fileEl  = item.querySelector('file');

        var name   = nameEl  ? nameEl.textContent.trim()                    : 'clip';
        var startF = startEl ? parseInt(startEl.textContent.trim(), 10) : 0;
        var endF   = endEl   ? parseInt(endEl.textContent.trim(),   10) : 0;
        var inF    = inEl    ? parseInt(inEl.textContent.trim(),    10) : 0;
        var outF   = outEl   ? parseInt(outEl.textContent.trim(),   10) : (endF - startF);

        if (inF  < 0) inF  = 0;                     // -1 = no in-point set
        if (outF < 0) outF = endF - startF;
        if (startF < 0 || endF <= startF) return;   // disabled clip

        var fileId = fileEl ? (fileEl.getAttribute('id') || '') : '';
        var itemId = item.getAttribute('id') || ('ci-' + result.clips.length);
        var isBroll = lane > 0 || this._looksLikeBroll(name);

        result.clips.push({
            ref:      fileId,
            name:     name,
            offset:   startF / fps,
            duration: (endF - startF) / fps,
            start:    inF / fps,
            lane:     lane,
            track:    lane === 0 ? 'V1' : 'V' + (lane + 1),
            type:     isBroll ? 'broll' : 'aroll',
            path:     '',
            // Preserved for XMEML editing
            _startFrame: startF,
            _endFrame:   endF,
            _inFrame:    inF,
            _outFrame:   outF,
            _fps:        fps,
            _itemId:     itemId,
            _fileRef:    fileId
        });
    },

    // ── Resource extraction ────────────────────────────────────────────

    _parseResources: function(doc, result) {
        // Assets (source media)
        var assets = doc.querySelectorAll('resources asset');
        for (var i = 0; i < assets.length; i++) {
            var a   = assets[i];
            var id  = a.getAttribute('id');
            if (!id) continue;
            var rep = a.querySelector('media-rep');
            result.assets[id] = {
                name:     a.getAttribute('name') || '',
                src:      rep ? (rep.getAttribute('src') || '') : '',
                duration: this._parseTime(a.getAttribute('duration') || '0s')
            };
        }

        // Formats (frame rate, resolution)
        var formats = doc.querySelectorAll('resources format');
        for (var j = 0; j < formats.length; j++) {
            var f   = formats[j];
            var fid = f.getAttribute('id');
            if (!fid) continue;
            var fd  = this._parseTime(f.getAttribute('frameDuration') || '1/30s');
            result._formats[fid] = {
                frameRate: fd > 0 ? Math.round((1 / fd) * 100) / 100 : 30,
                width:     parseInt(f.getAttribute('width')  || '1920', 10),
                height:    parseInt(f.getAttribute('height') || '1080', 10)
            };
        }
    },

    // ── Spine walking ──────────────────────────────────────────────────

    _walkSpine: function(spine, result) {
        var children = spine.children;
        for (var i = 0; i < children.length; i++) {
            var el  = children[i];
            var tag = el.tagName.toLowerCase();
            if (tag === 'clip' || tag === 'asset-clip' || tag === 'ref-clip') {
                this._extractClip(el, 0, result);
            } else if (tag === 'title') {
                this._extractCaption(el, result);
            }
            // <gap> elements represent empty space — skip
        }
    },

    _extractClip: function(el, lane, result) {
        var ref    = el.getAttribute('ref') || '';
        var asset  = result.assets[ref] || {};
        var name   = el.getAttribute('name') || asset.name || 'clip';
        var offset = this._parseTime(el.getAttribute('offset')   || '0s');
        var dur    = this._parseTime(el.getAttribute('duration') || '0s');
        var start  = this._parseTime(el.getAttribute('start')    || '0s');

        var isBroll = lane > 0 || this._looksLikeBroll(name);

        result.clips.push({
            ref:      ref,
            name:     name,
            offset:   offset,
            duration: dur,
            start:    start,
            lane:     lane,
            track:    lane === 0 ? 'V1' : 'V' + (lane + 1),
            type:     isBroll ? 'broll' : 'aroll',
            path:     asset.src || ''
        });

        // Recurse into connected clips (B-roll on higher lanes)
        var children = el.children;
        for (var i = 0; i < children.length; i++) {
            var child    = children[i];
            var childTag = child.tagName.toLowerCase();
            if (childTag === 'clip' || childTag === 'asset-clip' || childTag === 'ref-clip') {
                var childLane = parseInt(child.getAttribute('lane') || '0', 10);
                // Positive lanes = video tracks above primary; negative = audio below
                if (childLane > 0) {
                    this._extractClip(child, childLane, result);
                }
            } else if (childTag === 'title') {
                this._extractCaption(child, result);
            }
        }
    },

    _extractCaption: function(el, result) {
        var textEl = el.querySelector('text');
        if (!textEl) return;
        var text = textEl.textContent.trim();
        if (!text) return;

        var offset = this._parseTime(el.getAttribute('offset')   || '0s');
        var dur    = this._parseTime(el.getAttribute('duration') || '0s');

        result.captions.push({
            start: offset,
            end:   offset + dur,
            text:  text
        });
    },

    // ── Helpers ────────────────────────────────────────────────────────

    // Heuristic: lane > 0 already handles most cases; this catches
    // files where B-roll sits on lane 0 but has a descriptive name.
    _looksLikeBroll: function(name) {
        var n = name.toLowerCase();
        var indicators = ['broll', 'b-roll', 'b_roll', 'cutaway', 'insert', 'gv ', 'establishing'];
        for (var i = 0; i < indicators.length; i++) {
            if (n.indexOf(indicators[i]) !== -1) return true;
        }
        return false;
    },

    // Parse FCPXML rational time string → seconds (float)
    _parseTime: function(s) {
        if (!s) return 0;
        s = String(s).trim();
        // Strip trailing 's'
        if (s.charAt(s.length - 1) === 's') s = s.slice(0, -1);
        var slash = s.indexOf('/');
        if (slash !== -1) {
            var num = parseFloat(s.slice(0, slash));
            var den = parseFloat(s.slice(slash + 1));
            return (den > 0) ? num / den : 0;
        }
        return parseFloat(s) || 0;
    },

    // Format seconds → "H:MM:SS" or "M:SS"
    formatDuration: function(secs) {
        secs = Math.floor(secs);
        var h = Math.floor(secs / 3600);
        var m = Math.floor((secs % 3600) / 60);
        var s = secs % 60;
        if (h > 0) {
            return h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
        }
        return m + ':' + (s < 10 ? '0' : '') + s;
    },

    // Build a compact text summary for the AI prompt
    buildPromptSummary: function(parsed, srtLines) {
        var lines = [];
        lines.push('SEQUENCE: ' + parsed.sequenceName);
        lines.push('DURATION: ' + this.formatDuration(parsed.duration) + ' (' + parsed.duration.toFixed(1) + 's total)');
        lines.push('RESOLUTION: ' + parsed.width + 'x' + parsed.height + ' @ ' + parsed.frameRate + 'fps');
        lines.push('VALID timelineOffset RANGE: 0.0 to ' + parsed.duration.toFixed(1) + ' seconds');
        lines.push('');

        // Group clips by track
        var aroll  = parsed.clips.filter(function(c) { return c.type === 'aroll'; });
        var broll  = parsed.clips.filter(function(c) { return c.type === 'broll'; });
        var bNames = [];

        lines.push('A-ROLL CLIPS (' + aroll.length + '):');
        aroll.forEach(function(c) {
            lines.push('  ' + c.name + ' | offset=' + c.offset.toFixed(2) + 's dur=' + c.duration.toFixed(2) + 's');
        });

        if (broll.length > 0) {
            lines.push('');
            lines.push('B-ROLL CLIPS IN TIMELINE (' + broll.length + '):');
            broll.forEach(function(c) {
                lines.push('  ' + c.name + ' | offset=' + c.offset.toFixed(2) + 's dur=' + c.duration.toFixed(2) + 's');
                bNames.push(c.name);
            });
        }

        // Available (unused) B-roll in assets
        var usedRefs = parsed.clips.map(function(c) { return c.ref; });
        var unusedBroll = [];
        Object.keys(parsed.assets).forEach(function(id) {
            if (usedRefs.indexOf(id) === -1) {
                var a = parsed.assets[id];
                if (FCPXMLParser._looksLikeBroll(a.name)) {
                    unusedBroll.push(a.name);
                }
            }
        });
        if (unusedBroll.length > 0) {
            lines.push('');
            lines.push('AVAILABLE B-ROLL (not yet placed):');
            unusedBroll.forEach(function(n) { lines.push('  ' + n); });
        }

        // Transcript
        var transcript = srtLines && srtLines.length > 0 ? srtLines : parsed.captions;
        if (transcript && transcript.length > 0) {
            lines.push('');
            lines.push('TRANSCRIPT (' + transcript.length + ' segments):');
            transcript.forEach(function(t) {
                var ts = '[' + FCPXMLParser.formatDuration(t.start) + ']';
                lines.push('  ' + ts + ' ' + t.text);
            });
        }

        return lines.join('\n');
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FCPXMLParser;
}
