/* broll-placer.js — B-roll suggestion + timeline placement
 *
 * suggestBroll(): reads transcript blocks stored by TimelineEditor, fetches
 *   all project clips via CEP bridge, sends both to the text LLM, gets back
 *   a placement plan { clipName, atSeconds, durationSeconds, reason }.
 *
 * commitBroll(plan): sends each placement to CEP bridge 'placeBroll' command
 *   which inserts the clip on V2 using ExtendScript seq.overwriteClip().
 *
 * Non-destructive: B-roll goes on V2, A-roll on V1 is never touched.
 * Forward order is correct here (unlike silence removal which needs reverse).
 */

const BrollPlacer = {

    _lastPlan: null,

    async suggestBroll() {
        Logger.info('[BrollPlacer] suggestBroll starting');

        // ── Require transcript blocks from the last Analyze run ───────────────
        const blocks = TimelineEditor._lastTranscriptBlocks;
        if (!blocks || blocks.length === 0) {
            Logger.warn('[BrollPlacer] No transcript blocks — run Analyze first');
            return { success: false, error: 'No transcript found. Click "Analyze with Ambar" first.' };
        }
        Logger.info('[BrollPlacer] ' + blocks.length + ' transcript block(s) available');

        // ── Get all project clips from CEP bridge ─────────────────────────────
        let brollClips = [];
        try {
            const bridgeResult = await CEPBridge.sendCommand('getBrollClips', {}, 30000);
            if (bridgeResult && bridgeResult.success) {
                brollClips = bridgeResult.clips || [];
                Logger.info('[BrollPlacer] Got ' + brollClips.length + ' project clip(s)');
            } else {
                const err = (bridgeResult && bridgeResult.error) || 'bridge error';
                Logger.warn('[BrollPlacer] getBrollClips failed: ' + err);
                return { success: false, error: 'Could not get project clips: ' + err };
            }
        } catch (e) {
            Logger.error('[BrollPlacer] getBrollClips threw: ' + e.message);
            return { success: false, error: 'CEP bridge error: ' + e.message };
        }

        if (!brollClips.length) {
            return { success: false, error: 'No clips in project. Import media first.' };
        }

        // ── Get V1 duration and send to text LLM for matching ─────────────────
        var v1DurationSecs = 0;
        try {
            v1DurationSecs = await this._getV1DurationSecs();
        } catch (_) { v1DurationSecs = 0; }

        // ── Send to text LLM for matching ─────────────────────────────────────
        const prompt = PromptTemplates.getBrollMatchingPrompt(blocks, brollClips, v1DurationSecs);
        Logger.info('[BrollPlacer] Prompt length: ' + prompt.length + ' chars');

        // sendPrompt() returns { text: string } — NOT { success, text }
        let aiText = '';
        try {
            const aiResponse = await AIService.sendPrompt(
                'You are Ambar, a professional vlog editor. Respond ONLY with valid JSON matching the schema.',
                prompt
            );
            aiText = (aiResponse && typeof aiResponse.text === 'string') ? aiResponse.text : '';
        } catch (e) {
            Logger.error('[BrollPlacer] AIService.sendPrompt threw: ' + e.message);
            return { success: false, error: 'AI error: ' + e.message };
        }

        if (!aiText) {
            return { success: false, error: 'AI returned an empty response. Check your API key in Settings.' };
        }

        // ── Parse AI JSON response ────────────────────────────────────────────
        let parsed;
        try {
            var raw = aiText;
            // Strip markdown code fences if model wrapped the JSON
            var clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
            parsed = JSON.parse(clean);
        } catch (e) {
            Logger.error('[BrollPlacer] JSON parse failed: ' + e.message + ' raw=' + (aiResponse.text || '').slice(0, 200));
            return { success: false, error: 'AI response was not valid JSON. Try again.' };
        }

        var placements = Array.isArray(parsed && parsed.placements) ? parsed.placements : [];
        Logger.info('[BrollPlacer] AI returned ' + placements.length + ' placement(s)');
        if (parsed && parsed.reasoning) {
            Logger.info('[BrollPlacer] AI reasoning: ' + parsed.reasoning);
        }

        // ── Resolve clip names → media paths ─────────────────────────────────
        var resolved = [];
        for (var i = 0; i < placements.length; i++) {
            var p = placements[i];
            var atVal = (p.atSeconds !== undefined) ? p.atSeconds : (p.atSec !== undefined ? p.atSec : undefined);
            if (!p.clipName && !p.clipPath) {
                Logger.warn('[BrollPlacer] Placement missing clipName/clipPath — skipping: ' + JSON.stringify(p));
                continue;
            }

            // Flexible matching: prefer exact name, then basename of mediaPath, then substring
            var wantedName = (p.clipName || '').toString();
            var wantedPath = p.clipPath || p.mediaPath || '';

            var mediaPath = null;
            var clipDur = 0;

            // 1) exact name match (case-insensitive)
            for (var j = 0; j < brollClips.length; j++) {
                try {
                    if (brollClips[j].name && wantedName && brollClips[j].name.toLowerCase() === wantedName.toLowerCase()) {
                        mediaPath = brollClips[j].mediaPath;
                        clipDur = brollClips[j].durationSeconds || 0;
                        break;
                    }
                } catch (_) {}
            }

            // 2) match by basename of mediaPath if provided by AI
            if (!mediaPath && wantedName) {
                var wn = wantedName.toLowerCase();
                for (var j2 = 0; j2 < brollClips.length; j2++) {
                    try {
                        var bn = (brollClips[j2].mediaPath || '').split(/[\\\/]/).pop() || '';
                        if (bn.toLowerCase() === wn) {
                            mediaPath = brollClips[j2].mediaPath;
                            clipDur = brollClips[j2].durationSeconds || 0;
                            break;
                        }
                    } catch (_) {}
                }
            }

            // 3) if AI provided full clipPath, match by that
            if (!mediaPath && wantedPath) {
                for (var j3 = 0; j3 < brollClips.length; j3++) {
                    try {
                        if ((brollClips[j3].mediaPath || '').toLowerCase() === wantedPath.toLowerCase()) {
                            mediaPath = brollClips[j3].mediaPath;
                            clipDur = brollClips[j3].durationSeconds || 0;
                            break;
                        }
                    } catch (_) {}
                }
            }

            // 4) fuzzy substring match (clip name contains wantedName or vice versa)
            if (!mediaPath && wantedName) {
                var wn2 = wantedName.toLowerCase();
                for (var j4 = 0; j4 < brollClips.length; j4++) {
                    try {
                        var cn = (brollClips[j4].name || '').toLowerCase();
                        if (cn.indexOf(wn2) !== -1 || wn2.indexOf(cn) !== -1) {
                            mediaPath = brollClips[j4].mediaPath;
                            clipDur = brollClips[j4].durationSeconds || 0;
                            break;
                        }
                    } catch (_) {}
                }
            }

            if (!mediaPath) {
                Logger.warn('[BrollPlacer] No mediaPath found for AI suggestion: ' + JSON.stringify(p));
                continue;
            }

            var dur = (p.durationSeconds !== undefined) ? p.durationSeconds : (p.durationSec !== undefined ? p.durationSec : 5);
            if (clipDur > 0) dur = Math.min(dur, clipDur);

            // If atVal undefined, try atSec/atSeconds fields
            if (atVal === undefined) atVal = (p.atSec !== undefined ? p.atSec : (p.atSeconds !== undefined ? p.atSeconds : 0));

            resolved.push({
                clipName:        p.clipName || (wantedPath.split(/[\\\/]/).pop() || 'Unnamed'),
                mediaPath:       mediaPath,
                atSeconds:       atVal,
                durationSeconds: dur,
                clipStartSec:    typeof p.clipStartSec === 'number' ? p.clipStartSec : 0,
                confidence:      typeof p.confidence === 'number' ? p.confidence : 1.0,
                reason:          p.reason || '',
            });
            Logger.info('[BrollPlacer] Resolved placement -> ' + (p.clipName || '') + ' => ' + mediaPath + ' @' + atVal + 's dur ' + dur + 's');
        }

        this._lastPlan = { placements: resolved, brollClips: brollClips };
        return { success: true, plan: this._lastPlan };
    },

    // Place B-roll clips on V2 using UXP SequenceEditor.createOverwriteItemAction.
    // Falls back to CEP bridge insertClip if SequenceEditor is unavailable.
    async commitBroll(plan) {
        var placements = plan && plan.placements ? plan.placements : [];
        Logger.info('[BrollPlacer] commitBroll: ' + placements.length + ' clip(s) to place');

        // Validate and trim the plan against V1 duration and editorial rules
        var v1Duration = 0;
        try { v1Duration = await this._getV1DurationSecs(); } catch (_) { v1Duration = 0; }
        var safePlan = this._validateAndTrimPlan({ placements: placements }, v1Duration);
        if (!safePlan || safePlan.length === 0) {
            Logger.info('[BrollPlacer] No valid placements after validation');
            return { success: false, placed: 0, total: (placements ? placements.length : 0), errors: ['No valid placements after validation'], error: 'No valid placements after validation' };
        }
        Logger.info('[BrollPlacer] Placing ' + safePlan.length + ' validated placement(s)');

        var placed = 0;
        var errors = [];

        // ── Acquire UXP context — bypass Capabilities cache for SequenceEditor ──
        var ppro = null, project = null, sequence = null, seqEditor = null;
        try {
            ppro     = require('premierepro');
            project  = await ppro.Project.getActiveProject();
            // Must use project.getActiveSequence() — required by SequenceEditor.createForSequence
            sequence = await project.getActiveSequence();
            Logger.info('[BrollPlacer] sequence: ' + (sequence ? 'ok' : 'null'));

            if (ppro.SequenceEditor) {
                Logger.info('[BrollPlacer] ppro.SequenceEditor type: ' + typeof ppro.SequenceEditor);
                // Skip typeof check — UXP proxy objects don't always report 'function'
                // Try createForSequence directly and log the real error if it throws
                try {
                    seqEditor = await ppro.SequenceEditor.createForSequence(sequence);
                    if (seqEditor) {
                        Logger.info('[BrollPlacer] SequenceEditor.createForSequence OK');
                    } else {
                        Logger.warn('[BrollPlacer] createForSequence returned null');
                    }
                } catch (seErr) {
                    Logger.warn('[BrollPlacer] createForSequence threw: ' + (seErr && seErr.message));
                }
            } else {
                Logger.warn('[BrollPlacer] ppro.SequenceEditor is ' + typeof ppro.SequenceEditor);
            }
            if (!seqEditor) Logger.warn('[BrollPlacer] SequenceEditor not available — will use CEP fallback');
        } catch (e) {
            Logger.warn('[BrollPlacer] UXP context: ' + e.message);
        }

        var useUXP = !!(seqEditor && project);
        Logger.info('[BrollPlacer] placement path: ' + (useUXP ? 'UXP createOverwriteItemAction' : 'CEP insertClip fallback'));

        for (var i = 0; i < placements.length; i++) {
            var p = placements[i];

            if (useUXP) {
                // ── UXP path ──────────────────────────────────────────────────
                try {
                    var projItem = await this._findRawProjItem(p.mediaPath, ppro, project);
                    if (!projItem) {
                        errors.push('"' + p.clipName + '": not found in UXP project tree');
                        Logger.warn('[BrollPlacer] UXP: could not find projItem for "' + p.clipName + '"');
                        continue;
                    }
                    // Use ppro.TickTime.createWithSeconds — plain {ticks:BigInt} is rejected
                    var tickTime = ppro.TickTime.createWithSeconds(p.atSeconds);
                    // V2 = videoTrackIndex 1 (0-indexed), -1 = no audio placement
                    await project.executeTransaction(function(ca) {
                        ca.addAction(seqEditor.createOverwriteItemAction(projItem, tickTime, 1, -1));
                        return true;
                    }, 'Place B-roll: ' + p.clipName);
                    placed++;
                    Logger.info('[BrollPlacer] UXP placed "' + p.clipName + '" at ' + p.atSeconds.toFixed(2) + 's');
                } catch (e) {
                    errors.push('"' + p.clipName + '" @ ' + p.atSeconds.toFixed(1) + 's: ' + e.message);
                    Logger.error('[BrollPlacer] UXP placement failed for "' + p.clipName + '": ' + e.message);
                }
            } else {
                // ── CEP bridge fallback ───────────────────────────────────────
                // Skip if V2 is already occupied at this position
                var hasOverlap = await this._v2HasClipAt(p.atSeconds, p.durationSeconds, sequence);
                if (hasOverlap) {
                    Logger.warn('[BrollPlacer] Skipping "' + p.clipName + '" — V2 overlap at ' + p.atSeconds + 's');
                    errors.push('"' + p.clipName + '": skipped — V2 already occupied at ' + p.atSeconds.toFixed(1) + 's');
                    continue;
                }
                try {
                    var result = await CEPBridge.sendCommand('placeBroll', {
                        mediaPath:    p.mediaPath,
                        startSecs:    p.atSeconds,
                        durationSecs: p.durationSeconds,
                        trackIndex:   1,
                        sourceInSecs: p.clipStartSec || 0,
                    }, 30000);
                    if (result && result.success) {
                        placed++;
                        Logger.info('[BrollPlacer] CEP placed "' + p.clipName + '" at ' + p.atSeconds.toFixed(2) + 's');
                    } else {
                        var err = (result && result.error) || 'bridge returned failure';
                        errors.push('"' + p.clipName + '" @ ' + p.atSeconds.toFixed(1) + 's: ' + err);
                        Logger.warn('[BrollPlacer] CEP failed "' + p.clipName + '": ' + err);
                    }
                } catch (e) {
                    errors.push('"' + p.clipName + '": ' + e.message);
                    Logger.error('[BrollPlacer] CEP threw for "' + p.clipName + '": ' + e.message);
                }
            }
        }

        Logger.info('[BrollPlacer] Done — ' + placed + '/' + placements.length + ' placed');
        return { success: placed > 0, placed: placed, total: placements.length, errors: errors };
    },

    // Walk UXP project.rootItem recursively and return the raw ProjectItem whose
    // media path matches targetPath. Returns null if not found.
    async _findRawProjItem(targetPath, ppro, project) {
        if (!project || !project.rootItem) return null;
        var targetLower = targetPath.toLowerCase();
        var found = null;

        async function walk(item) {
            if (found) return;
            try {
                var type = item.type; // sync in some versions
                if (type === undefined) {
                    try { type = await item.type; } catch (_) {}
                }
                var isBinOrRoot = (type === 2 || type === 3); // BIN=2, ROOT=3

                if (!isBinOrRoot) {
                    // Leaf — check media path
                    var mp = null;
                    if (ppro.ClipProjectItem) {
                        try {
                            var clipPI = ppro.ClipProjectItem.cast(item);
                            if (clipPI) mp = await clipPI.getMediaPath();
                        } catch (_) {}
                    }
                    if (!mp) {
                        for (var k = 0; k < ['treePath','path','filePath','mediaPath'].length; k++) {
                            try { var v = await item[['treePath','path','filePath','mediaPath'][k]]; if (v && typeof v === 'string') { mp = v; break; } } catch (_) {}
                        }
                    }
                    if (mp && mp.toLowerCase() === targetLower) {
                        found = item;
                    }
                    return;
                }

                // Recurse into bin/root
                var children = item.children;
                if (!children) return;
                var count = (children.numItems !== undefined && children.numItems !== null)
                    ? children.numItems
                    : (children.length !== undefined ? children.length : 0);
                for (var i = 0; i < count && !found; i++) {
                    try { await walk(children[i]); } catch (_) {}
                }
            } catch (_) {}
        }

        await walk(project.rootItem);
        return found;
    },

    async _getV1DurationSecs() {
        try {
            var ppro = require('premierepro');
            var project = await ppro.Project.getActiveProject();
            var seq = null;
            try { seq = project.activeSequence || await project.getActiveSequence(); } catch (_) { try { seq = await project.getActiveSequence(); } catch (_) { seq = project.activeSequence; } }
            Logger.info('[BrollPlacer] _getV1DurationSecs: project=' + (!!project) + ' seq=' + (!!seq));
            if (!seq) return 0;
            // Try several shapes that the UXP proxy may expose
            try {
                var end = null;
                try { end = await seq.end; } catch (_) { end = seq.end; }
                Logger.info('[BrollPlacer] _getV1DurationSecs: seq.end=' + (end ? JSON.stringify(end).slice(0,200) : 'null'));
                if (end) {
                    if (end.ticks !== undefined && end.ticks !== null) return Number(end.ticks) / 254016000000;
                    if (end.seconds !== undefined && end.seconds !== null) return Number(end.seconds);
                    // If end is a string or number
                    if (typeof end === 'number') return Number(end);
                    if (typeof end === 'string' && end.match(/^[0-9]+$/)) return Number(end) / 254016000000;
                }
            } catch (_) {}

            try {
                Logger.info('[BrollPlacer] _getV1DurationSecs: checking seq.end.ticks fallback');
                if (seq.end && seq.end.ticks !== undefined) return Number(seq.end.ticks) / 254016000000;
            } catch (_) {}

            try {
                Logger.info('[BrollPlacer] _getV1DurationSecs: checking seq.duration');
                if (seq.duration && seq.duration.seconds !== undefined) return Number(seq.duration.seconds);
            } catch (_) {}

            // Fallback: derive from V1 clips end time
            try {
                var vTracks = seq.videoTracks;
                Logger.info('[BrollPlacer] _getV1DurationSecs: vTracks=' + (vTracks ? vTracks.numTracks : 'null'));
                if (vTracks && vTracks.numTracks > 0) {
                    var track = vTracks[0];
                    var maxEnd = 0;
                    for (var ci = 0; ci < track.clips.numItems; ci++) {
                        try { var ce = track.clips[ci].end.seconds; if (ce && ce > maxEnd) maxEnd = ce; } catch (_) {}
                    }
                    if (maxEnd > 0) return Number(maxEnd);
                }
            } catch (_) {}

            // Final fallback: use transcript blocks last end time if available
            try {
                if (TimelineEditor && Array.isArray(TimelineEditor._lastTranscriptBlocks) && TimelineEditor._lastTranscriptBlocks.length) {
                    var last = TimelineEditor._lastTranscriptBlocks[TimelineEditor._lastTranscriptBlocks.length - 1];
                    if (last && last.endSeconds) {
                        Logger.info('[BrollPlacer] _getV1DurationSecs: falling back to transcript endSeconds = ' + last.endSeconds);
                        return Number(last.endSeconds);
                    }
                }
            } catch (_) {}

            return 0;
        } catch (e) {
            return 0;
        }
    },

    // Check if V2 (tracks[1]) already has a clip that overlaps [startSecs, startSecs+durationSecs].
    // Returns false if sequence is null or V2 doesn't exist yet — safe to place in those cases.
    async _v2HasClipAt(startSecs, durationSecs, sequence) {
        try {
            if (!sequence) return false;
            const ppro   = require('premierepro');
            const tracks = await sequence.getVideoTracks();
            if (!tracks || tracks.length < 2) return false;
            const v2clips  = await tracks[1].getClips();
            const endSecs  = startSecs + (durationSecs || 0);
            for (const clip of v2clips) {
                const cs = Number((await clip.getStartTime()).ticks) / 254016000000;
                const ce = Number((await clip.getEndTime()).ticks)   / 254016000000;
                if (cs < endSecs && ce > startSecs) return true;
            }
            return false;
        } catch (e) {
            return false; // if we can't check, allow placement
        }
    },

    _validateAndTrimPlan(plan, v1DurationSecs) {
        var MAX_COVERAGE = 0.40;  // matches prompt's 40% budget
        var MIN_CLIP_SEC = 4.0;   // matches prompt's 4–6s rule
        var MAX_CLIP_SEC = 6.0;
        var MIN_GAP_SEC  = 10.0;  // matches prompt's 10s minimum gap
        var KEEP_START_SEC = 6.0; // matches prompt's 6s no-broll zone
        var KEEP_END_SEC   = 6.0; // matches prompt's 6s no-broll zone

        var validated = (plan && plan.placements ? plan.placements.slice() : [])
            .map(function(p) {
                return {
                    clipName: p.clipName || p.clipName,
                    mediaPath: p.mediaPath || p.clipPath || p.mediaPath,
                    atSeconds: (p.atSeconds !== undefined) ? p.atSeconds : (p.atSec !== undefined ? p.atSec : 0),
                    durationSeconds: Math.max(MIN_CLIP_SEC, Math.min(MAX_CLIP_SEC, (p.durationSeconds || p.durationSec || 5))) ,
                    confidence: (p.confidence !== undefined) ? p.confidence : (p.confidence || 1.0),
                    reason: p.reason || ''
                };
            })
            .filter(function(p) {
                return p.atSeconds >= KEEP_START_SEC && (p.atSeconds + p.durationSeconds) <= (v1DurationSecs - KEEP_END_SEC);
            })
            .filter(function(p) { return (p.confidence || 0) >= 0.85; })
            .sort(function(a, b) { return a.atSeconds - b.atSeconds; });

        var gapped = [];
        var lastEndSec = -9999;
        for (var i = 0; i < validated.length; i++) {
            var p = validated[i];
            if (p.atSeconds >= lastEndSec + MIN_GAP_SEC) {
                gapped.push(p);
                lastEndSec = p.atSeconds + p.durationSeconds;
            }
        }

        var budgetSecs = v1DurationSecs * MAX_COVERAGE;
        var final = [];
        var usedSecs = 0;
        for (var k = 0; k < gapped.length; k++) {
            var q = gapped[k];
            if (usedSecs + q.durationSeconds <= budgetSecs) {
                final.push(q);
                usedSecs += q.durationSeconds;
            }
        }

        Logger.info('[BrollPlacer] Validated: ' + final.length + ' of ' + (plan.placements ? plan.placements.length : 0) + ' placements, covering ' + usedSecs.toFixed(1) + 's of ' + v1DurationSecs.toFixed(1) + 's V1');
        return final;
    },
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = BrollPlacer;
}
