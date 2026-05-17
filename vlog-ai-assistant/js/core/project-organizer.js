/* project-organizer.js — Two-pass clip classification + bin creation
 *
 * PASS 1 (parallel): llava describes each frame → { filename, description }
 * PASS 2 (single):   text LLM classifies ALL descriptions in one call → { filename, category, confidence }
 * BINS:              CEP bridge createBinAndMove per populated category
 */

const ProjectOrganizer = {

    // Maps vision category strings → Premiere Pro bin names
    _BIN_MAP: {
        'talking-head':     '🎙 Talking Head',
        'aerial-drone':     '🚁 Aerial & Drone',
        'indoor-broll':     '🏛 Indoor B-roll',
        'outdoor-broll':    '🌿 Outdoor B-roll',
        'landscape':        '🌊 Landscape',
        'product-closeup':  '📦 Product',
        'screen-recording': '💻 Screen Recording',
        'other':            '🏷 Other',
    },

    async organizeProjectClips(onProgress) {
        const emit = (typeof onProgress === 'function') ? onProgress : function() {};
        console.time('organise');
        Logger.info('[ProjectOrganizer] Starting clip organization');

        // ── Get all project clips via CEP bridge ──────────────────────────────
        let clips;
        try {
            clips = await PremiereAPI.getAllProjectClips();
        } catch (e) {
            Logger.error('[ProjectOrganizer] getAllProjectClips failed: ' + e.message);
            console.timeEnd('organise');
            return { success: false, error: e.message };
        }

        if (!clips || clips.length === 0) {
            Logger.warn('[ProjectOrganizer] No clips found in project');
            console.timeEnd('organise');
            return { success: false, error: 'No clips found in project' };
        }

        // Detect new footage since last organize run
        if (typeof ProjectMemory !== 'undefined' && ProjectMemory._sequenceId) {
            try {
                var clipPaths = clips.map(function(c) { return c.mediaPath || c.name || ''; }).filter(Boolean);
                var newClips  = await ProjectMemory.detectNewFootage(clipPaths);
                if (newClips.length > 0) {
                    Logger.info('[Memory] New footage: ' + newClips.length + ' clip(s) since last run');
                }
            } catch (memErr) {
                Logger.warn('[Memory] detectNewFootage failed: ' + memErr.message);
            }
        }

        emit({ type: 'start', total: clips.length });

        // ── PASS 1: sequential frame extraction + llava description ──────────
        // Sequential because the CEP bridge handles one extractFrame at a time
        // (ExtendScript blocks with $.sleep polling). Parallel sends cause timeouts
        // for clips 3-5 while clips 1-2 are still blocking. Ollama also processes
        // one vision call at a time, so true parallelism wasn't happening anyway.
        emit({ type: 'pass1-start', total: clips.length });

        const descriptions = [];
        for (var pi = 0; pi < clips.length; pi++) {
            const clip = clips[pi];
            const idx  = pi + 1;

            if (!clip.mediaPath) {
                emit({ type: 'skip', name: clip.name, index: idx, total: clips.length, reason: 'no media path' });
                descriptions.push({ filename: clip.name, description: 'no media path' });
                continue;
            }

            emit({ type: 'extracting', name: clip.name, index: idx, total: clips.length });
            const durationSecs = clip.durationSeconds || 10;
            // Sample at 15%, 50%, 85% — avoids black frames at hard open/close
            const ts1 = Math.max(1, durationSecs * 0.15);
            const ts2 = Math.max(1, durationSecs * 0.50);
            const ts3 = Math.max(1, durationSecs * 0.85);

            const f1 = await FrameExtractor.extractFrame(clip.mediaPath, ts1);
            const f2 = await FrameExtractor.extractFrame(clip.mediaPath, ts2);
            const f3 = await FrameExtractor.extractFrame(clip.mediaPath, ts3);
            const frames = [f1, f2, f3].filter(Boolean);

            if (!frames.length) {
                emit({ type: 'skip', name: clip.name, index: idx, total: clips.length, reason: 'frame extraction failed' });
                descriptions.push({ filename: clip.name, description: 'frame extraction failed' });
                continue;
            }

            emit({ type: 'describing', name: clip.name, index: idx, total: clips.length });
            // All 3 frames sent in a single llava call — Ollama images[] array
            const descResult  = await VisionService.describeFrame(frames, CONSTANTS.VISION_MODEL);
            const description = descResult.success ? descResult.description : 'description failed';
            emit({ type: 'described', name: clip.name, index: idx, total: clips.length, description });

            descriptions.push({ filename: clip.name, description });
        }
        Logger.info('[ProjectOrganizer] Pass 1 done — ' + descriptions.length + ' description(s)');

        // ── PASS 2: single text LLM call for all clips at once ────────────────
        emit({ type: 'classifying-all', total: descriptions.length });
        let classifications = [];
        try {
            classifications = await AIService.classifyAllClips(descriptions);
            Logger.info('[ProjectOrganizer] Pass 2 done — ' + classifications.length + ' classification(s)');
        } catch (e) {
            Logger.error('[ProjectOrganizer] classifyAllClips failed: ' + e.message);
            classifications = descriptions.map(function(d) {
                return { filename: d.filename, category: 'other', confidence: 0 };
            });
        }

        // ── Map classifications → grouped by category ─────────────────────────
        const grouped = {};
        for (var ci = 0; ci < classifications.length; ci++) {
            const c        = classifications[ci];
            const category = c.category || 'other';
            const binName  = this._BIN_MAP[category] || '🏷 Other';

            // Match back to original clip by filename to retrieve mediaPath
            let mediaPath = null;
            for (var j = 0; j < clips.length; j++) {
                if (clips[j].name === c.filename) { mediaPath = clips[j].mediaPath; break; }
            }

            emit({ type: 'classified', name: c.filename, category, binName, confidence: c.confidence || 0 });
            Logger.info('[ProjectOrganizer] "' + c.filename + '" → ' + category + ' (' + binName + ')');

            if (!mediaPath) continue;
            if (!grouped[category]) grouped[category] = [];
            grouped[category].push(mediaPath);
        }

        // ── Create bins and move clips ─────────────────────────────────────────
        let totalMoved = 0;
        const binResults = [];
        const categories = Object.keys(grouped);

        for (var k = 0; k < categories.length; k++) {
            const cat      = categories[k];
            const paths    = grouped[cat];
            const binName2 = this._BIN_MAP[cat] || '🏷 Other';
            if (paths.length === 0) continue;

            emit({ type: 'creating-bin', binName: binName2, count: paths.length });
            try {
                const bridgeResult = await CEPBridge.sendCommand('createBinAndMove', {
                    binName:        binName2,
                    clipMediaPaths: paths,
                }, 120000);
                if (bridgeResult && bridgeResult.success) {
                    totalMoved += bridgeResult.count || paths.length;
                    Logger.info('[ProjectOrganizer] Moved ' + paths.length + ' → "' + binName2 + '"');
                    emit({ type: 'bin-done', binName: binName2, count: bridgeResult.count || paths.length });
                } else {
                    Logger.warn('[ProjectOrganizer] Bin "' + binName2 + '" failed: ' + (bridgeResult && bridgeResult.error));
                    emit({ type: 'bin-error', binName: binName2, error: (bridgeResult && bridgeResult.error) || 'unknown' });
                }
                binResults.push({ binName: binName2, count: paths.length, success: !!(bridgeResult && bridgeResult.success) });
            } catch (e) {
                Logger.error('[ProjectOrganizer] CEP bridge error for "' + binName2 + '": ' + e.message);
                emit({ type: 'bin-error', binName: binName2, error: e.message });
                binResults.push({ binName: binName2, count: paths.length, success: false, error: e.message });
            }
        }

        console.timeEnd('organise');
        Logger.info('[ProjectOrganizer] Done — ' + totalMoved + ' clip(s) in ' + binResults.length + ' bin(s)');
        emit({ type: 'done', totalMoved, bins: binResults });

        if (totalMoved > 0 && typeof ProjectMemory !== 'undefined' && ProjectMemory._sequenceId) {
            try {
                var binMap = {};
                binResults.forEach(function(b) { if (b.binName) binMap[b.binName] = b; });
                await ProjectMemory.recordOrganise(binMap);
            } catch (memErr) {
                Logger.warn('[Memory] recordOrganise failed: ' + memErr.message);
            }
        }

        return { success: totalMoved > 0, totalMoved, bins: binResults };
    },
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProjectOrganizer;
}
