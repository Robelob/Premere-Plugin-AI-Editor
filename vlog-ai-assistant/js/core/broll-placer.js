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

        // ── Send to text LLM for matching ─────────────────────────────────────
        const prompt = PromptTemplates.getBrollMatchingPrompt(blocks, brollClips);
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

        // ── Resolve clip names → media paths ─────────────────────────────────
        var resolved = [];
        for (var i = 0; i < placements.length; i++) {
            var p = placements[i];
            if (!p.clipName || p.atSeconds === undefined) continue;

            var mediaPath = null;
            var clipDur   = 0;
            for (var j = 0; j < brollClips.length; j++) {
                if (brollClips[j].name.toLowerCase() === p.clipName.toLowerCase()) {
                    mediaPath = brollClips[j].mediaPath;
                    clipDur   = brollClips[j].durationSeconds || 0;
                    break;
                }
            }

            if (!mediaPath) {
                Logger.warn('[BrollPlacer] No mediaPath for "' + p.clipName + '" — skipping');
                continue;
            }

            var dur = p.durationSeconds || 5;
            if (clipDur > 0) dur = Math.min(dur, clipDur);

            resolved.push({
                clipName:        p.clipName,
                mediaPath:       mediaPath,
                atSeconds:       p.atSeconds,
                durationSeconds: dur,
                reason:          p.reason || '',
            });
        }

        this._lastPlan = { placements: resolved, brollClips: brollClips };
        return { success: true, plan: this._lastPlan };
    },

    // Place B-roll clips on V2 using UXP SequenceEditor.createOverwriteItemAction.
    // Falls back to CEP bridge insertClip if SequenceEditor is unavailable.
    async commitBroll(plan) {
        var placements = plan && plan.placements ? plan.placements : [];
        Logger.info('[BrollPlacer] commitBroll: ' + placements.length + ' clip(s) to place');

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
                try {
                    var result = await CEPBridge.sendCommand('placeBroll', {
                        clipMediaPath: p.mediaPath,
                        startSeconds:  p.atSeconds,
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
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = BrollPlacer;
}
