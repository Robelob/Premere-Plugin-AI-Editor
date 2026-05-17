/* timeline-editor.js — Two-step edit orchestrator
 *
 * Step 1 — analyzeAndMark(editPlan):  places markers on the sequence ruler, NO destructive changes.
 * Step 2 — commitEdits(editPlan):     ripple-deletes silence segments (UXP native first, CEP bridge fallback).
 *
 * Segments are always processed REVERSE ORDER (end → start) to preserve timing of
 * earlier segments after each deletion. See ARCHITECTURE_DECISIONS.md §3.
 *
 * Padding: PADDING_SECONDS is applied to each side of every DELETE segment before
 * the actual cut so natural breath/room tone is preserved. See ARCHITECTURE_DECISIONS.md §4.
 */

const TimelineEditor = {

    // Populated after each successful Analyze run — used by BrollPlacer
    _lastTranscriptWords:  null,
    _lastTranscriptBlocks: null,

    // ── Auto-transcription entry point (Approach B) ───────────────────────────

    /**
     * Top-level orchestrator: get source files → AI transcription → silence detection → markers.
     * srtFallback: UIState.getState('srtTranscript') — used when auto-transcription fails.
     * Returns { success, editPlan, silenceMarked, error }
     */
    async analyzeSequence(srtFallback) {
        Logger.info('TimelineEditor.analyzeSequence: starting');
        UIState.set(CONSTANTS.STATES.ANALYZING);

        const sequence = await PremiereAPI.getActiveSequenceAsync();
        if (!sequence) {
            Logger.error('analyzeSequence: no active sequence');
            UIState.set(CONSTANTS.STATES.ERROR);
            return { success: false, error: CONSTANTS.MESSAGES.NO_SEQUENCE };
        }

        // ── Three-layer pipeline (primary path) ──────────────────────────────
        let layerResult = null;
        try {
            layerResult = await this._runLayerPipeline(sequence);
        } catch (e) {
            Logger.warn('analyzeSequence: pipeline error — ' + e.message);
        }

        if (layerResult && layerResult.success) {
            let pipelineSegments;
            if (layerResult.directSegments) {
                pipelineSegments = layerResult.directSegments;
            } else {
                pipelineSegments = this.findSilences(layerResult.words, CONSTANTS.MIN_SILENCE_SECONDS);
                // Merge filler-word segments (from Layer 2) with silence gaps, sorted by startSeconds
                if (layerResult.fillerSegments && layerResult.fillerSegments.length > 0) {
                    pipelineSegments = pipelineSegments.concat(layerResult.fillerSegments);
                    pipelineSegments.sort(function(a, b) { return a.startSeconds - b.startSeconds; });
                    Logger.info('analyzeSequence: merged cuts → ' + pipelineSegments.length +
                        ' (' + layerResult.fillerSegments.length + ' filler)');
                }
            }
            if (pipelineSegments.length > 0) {
                const brollOpportunities = [];
                const editPlan   = { segments: pipelineSegments, brollOpportunities };
                const markResult = await this.analyzeAndMark(editPlan);
                return { success: markResult.success, editPlan, silenceMarked: markResult.silenceMarked };
            }
            Logger.warn('analyzeSequence: pipeline found no silences, falling back to legacy path');
        }

        // ── Legacy path (SRT / cloud Whisper / manual audio / Layer 1 fallback) ──────────
        const transcriptResult = await this.buildSequenceTranscript(sequence, srtFallback);
        if (!transcriptResult.success) {
            Logger.error('analyzeSequence: ' + (transcriptResult.error || 'no transcript'));
            UIState.set(CONSTANTS.STATES.ERROR);
            return { success: false, fileTooLarge: !!transcriptResult.fileTooLarge, error: transcriptResult.error || 'No transcript found.' };
        }

        // If buildSequenceTranscript returned pre-computed segments (e.g., Layer 1 fallback),
        // use them directly without calling findSilences()
        let segments;
        if (transcriptResult.segments && transcriptResult.segments.length > 0) {
            Logger.info('analyzeSequence: using pre-computed segments from buildSequenceTranscript (source=' + (transcriptResult.segments[0].source || 'unknown') + ')');
            segments = transcriptResult.segments;
        } else if (!transcriptResult.words || !transcriptResult.words.length) {
            Logger.error('analyzeSequence: no transcript words or segments');
            UIState.set(CONSTANTS.STATES.ERROR);
            return { success: false, fileTooLarge: !!transcriptResult.fileTooLarge, error: 'No transcript found.' };
        } else {
            segments = this.findSilences(transcriptResult.words, CONSTANTS.MIN_SILENCE_SECONDS);
        }

        if (!segments.length) {
            Logger.warn('analyzeSequence: no silences found');
            UIState.set(CONSTANTS.STATES.ERROR);
            return { success: false, error: 'No silences detected — all word gaps are shorter than ' + CONSTANTS.MIN_SILENCE_SECONDS + 's.' };
        }

        const editPlan    = { segments, brollOpportunities: [] };
        const markResult  = await this.analyzeAndMark(editPlan);
        return { success: markResult.success, editPlan, silenceMarked: markResult.silenceMarked };
    },

    /**
     * Determine the best audio source, send to Groq Whisper, and remap word timestamps
     * to sequence-relative ticks.
     *
     * Priority (handled by PremiereAPI.prepareAudioForTranscription):
     *   1. Manual audio override (user picked a file)
     *   2. CEP bridge audio export (MP3) — timestamps already sequence-relative
     *   3. Source file direct send — apply clip offset math
     *
     * Returns { success, words: [{ word, startTicks: BigInt, endTicks: BigInt, confidence }] }
     */
    async buildSequenceTranscript(sequence, srtFallback) {
        const TICKS_PER_SEC = 254016000000;

        // Priority 1: manually selected audio file (shown when source is too large)
        const audioOverride = (typeof UIState !== 'undefined') ? UIState.getState('audioFilePath') : null;
        if (audioOverride) {
            Logger.info('buildSequenceTranscript: using manual audio override — ' + audioOverride.split(/[\\/]/).pop());
            const result = await AIService.sendAudioFile(audioOverride);
            Logger.info('buildSequenceTranscript: override result — success=' + result.success +
                ' words=' + (result.words ? result.words.length : 0) +
                (result.error ? ' error=' + result.error : ''));
            if (result.success && result.words && result.words.length > 0) {
                const words = result.words.map(w => ({
                    word:       w.word,
                    startTicks: BigInt(Math.round(w.startTime * TICKS_PER_SEC)),
                    endTicks:   BigInt(Math.round(w.endTime   * TICKS_PER_SEC)),
                    confidence: w.confidence !== undefined ? w.confidence : 1.0,
                }));
                return { success: true, words };
            }
        }

        // Priority 2 & 3: auto-detect best audio source
        const audioPrep = await PremiereAPI.prepareAudioForTranscription(sequence);
        Logger.info('buildSequenceTranscript: prepareAudioForTranscription — success=' + audioPrep.success +
            (audioPrep.path ? ' file=' + audioPrep.path.split(/[\\/]/).pop() : '') +
            (audioPrep.isSequenceExport !== undefined ? ' isSeqExport=' + audioPrep.isSequenceExport : '') +
            (audioPrep.error ? ' error=' + audioPrep.error : ''));

        if (audioPrep.success && audioPrep.path) {
            const result = await AIService.sendAudioFile(audioPrep.path);
            Logger.info('buildSequenceTranscript: AI result — success=' + result.success +
                ' words=' + (result.words ? result.words.length : 0) +
                (result.error ? ' error=' + result.error : ''));

            if (result.success && result.words && result.words.length > 0) {
                let words;
                if (audioPrep.isSequenceExport) {
                    // Exported from the full sequence → Whisper timestamps are already sequence-relative
                    words = result.words.map(w => ({
                        word:       w.word,
                        startTicks: BigInt(Math.round(w.startTime * TICKS_PER_SEC)),
                        endTicks:   BigInt(Math.round(w.endTime   * TICKS_PER_SEC)),
                        confidence: w.confidence !== undefined ? w.confidence : 1.0,
                    }));
                } else {
                    // Source file sent directly → remap using clip in/out offset
                    const src = audioPrep.source;
                    words = result.words.map(w => {
                        const srcStart = BigInt(Math.round(w.startTime * TICKS_PER_SEC));
                        const srcEnd   = BigInt(Math.round(w.endTime   * TICKS_PER_SEC));
                        const seqStart = srcStart - src.inPointTicks + src.clipStartTicks;
                        const seqEnd   = srcEnd   - src.inPointTicks + src.clipStartTicks;
                        return {
                            word:       w.word,
                            startTicks: seqStart < BigInt(0) ? BigInt(0) : seqStart,
                            endTicks:   seqEnd   < BigInt(0) ? BigInt(0) : seqEnd,
                            confidence: w.confidence !== undefined ? w.confidence : 1.0,
                        };
                    });
                }
                Logger.info('buildSequenceTranscript: ' + words.length + ' words mapped to sequence time');
                return { success: true, words };
            }

            Logger.warn('buildSequenceTranscript: AI transcription failed — ' + (result.error || 'no words returned'));
        }

        if (!audioPrep.success && audioPrep.fileTooLarge) {
            return { success: false, fileTooLarge: true, error: audioPrep.error };
        }

        // SRT fallback
        if (srtFallback && srtFallback.words && srtFallback.words.length > 0) {
            Logger.info('buildSequenceTranscript: SRT fallback (' + srtFallback.words.length + ' words)');
            return { success: true, words: srtFallback.words };
        }

        // ── FINAL FALLBACK: Layer 1 silence detection ──────────────────────────
        // If all word-based paths failed, try to extract silence ranges directly
        // from audio PCM analysis. This provides less precision than word timestamps,
        // but is better than failing entirely.
        Logger.info('buildSequenceTranscript: all word-based paths exhausted — trying Layer 1 silence detection');
        try {
            const pcmResult = await AudioAnalyzer.getAudioPCM(sequence);
            if (pcmResult && pcmResult.success && pcmResult.pcm) {
                const silenceRangesMs  = AudioAnalyzer._detectSilenceRanges(pcmResult.pcm);
                if (silenceRangesMs && silenceRangesMs.length > 0) {
                    Logger.info('buildSequenceTranscript: Layer 1 recovered ' + silenceRangesMs.length + ' silence range(s) — returning as editSegments');
                    // Return silence ranges as pre-computed segments (skip findSilences step)
                    const segments = silenceRangesMs.map(function(s) {
                        return {
                            startSeconds: s.startMs / 1000,
                            endSeconds:   s.endMs   / 1000,
                            confidence:   0.85,
                            source:       'layer1-audio-pcm',
                        };
                    });
                    // Signal to analyzeSequence that these are pre-computed segments
                    return { success: true, words: [], segments: segments, layer1Fallback: true };
                }
            }
        } catch (e) {
            Logger.warn('buildSequenceTranscript: Layer 1 fallback error — ' + e.message);
        }

        const providerNote = (typeof AIService !== 'undefined' && (AIService.provider === 'ollama' || AIService.provider === 'anthropic'))
            ? ' Switch to an OpenAI-compatible provider (e.g. Groq) or Gemini for auto-transcription.'
            : ' Check your API key and that the file is accessible.';
        return {
            success: false,
            error: 'No transcript. Auto-transcription failed.' + providerNote + ' Or load an SRT file in the Import tab.',
        };
    },

    async _runLayerPipeline(sequence) {
        const TICKS_PER_SEC = 254016000000;
        const PADDING       = CONSTANTS.PADDING_SECONDS || 0.15;

        // Layer 1 — silence detection via PCM analysis
        const pcmResult = await AudioAnalyzer.getAudioPCM(sequence);
        if (!pcmResult.success) {
            Logger.warn('_runLayerPipeline: Layer 1 failed — ' + pcmResult.error);
            return { success: false, error: pcmResult.error };
        }
        Logger.info('_runLayerPipeline: Layer 1 OK — ' + pcmResult.pcm.duration.toFixed(1) + 's');

        const silenceRanges  = AudioAnalyzer._detectSilenceRanges(pcmResult.pcm);
        const speechSegments = AudioAnalyzer._invertToSpeech(silenceRanges, pcmResult.pcm.duration * 1000);
        Logger.info('_runLayerPipeline: ' + silenceRanges.length + ' silence(s), ' + speechSegments.length + ' speech segment(s)');

        // Layer 2 — Whisper word timestamps (skip if no key or no speech)
        const whisperKey = CONSTANTS.WHISPER_API_KEY ||
                           (typeof AIService !== 'undefined' && AIService.apiKey ? AIService.apiKey : '');
        if (whisperKey && speechSegments.length > 0) {
            try {
                const rawWords = await WhisperService.transcribeSegments(
                    speechSegments,
                    pcmResult.pcm,
                    CONSTANTS.WHISPER_PROVIDER || 'groq',
                    whisperKey,
                    pcmResult.path
                );
                if (rawWords && rawWords.length > 0) {
                    Logger.info('_runLayerPipeline: Layer 2 OK — ' + rawWords.length + ' word(s)');

                    // Detect filler words from Layer 2 transcript (rawWords has startMs/endMs shape)
                    const fillerRanges = AudioAnalyzer.detectFillerWords(rawWords);
                    Logger.info('_runLayerPipeline: detectFillerWords → ' + fillerRanges.length + ' filler group(s)');
                    const fillerSegments = fillerRanges.map(function(f) {
                        return {
                            startSeconds: f.startMs / 1000,
                            endSeconds:   f.endMs   / 1000,
                            confidence:   0.9,
                            type:         'filler',
                        };
                    });

                    const words = rawWords.map(function(w) {
                        return {
                            word:       w.word,
                            startTicks: BigInt(Math.round(w.startMs / 1000 * TICKS_PER_SEC)),
                            endTicks:   BigInt(Math.round(w.endMs   / 1000 * TICKS_PER_SEC)),
                            confidence: w.confidence,
                        };
                    });
                    this._lastTranscriptWords  = words;
                    this._lastTranscriptBlocks = this._wordsToBlocks(words);
                    return { success: true, words, fillerSegments };
                }
                Logger.warn('_runLayerPipeline: Layer 2 returned no words — using Layer 1 silence ranges');
            } catch (e) {
                Logger.warn('_runLayerPipeline: Layer 2 error — ' + e.message);
            }
        } else if (!whisperKey) {
            Logger.info('_runLayerPipeline: no Whisper key — using Layer 1 silence ranges directly');
        }

        // Layer 2 skipped / failed — convert silence ranges directly to segments
        // NOTE: Do NOT apply padding here. Let commitEdits handle padding uniformly.
        // Padding is applied per-segment in commitEdits, not here.
        if (silenceRanges.length === 0) {
            return { success: false, error: 'No silence or speech detected in audio' };
        }
        const directSegments = silenceRanges
            .map(function(s) {
                return {
                    startSeconds: s.startMs / 1000,
                    endSeconds:   s.endMs   / 1000,
                    confidence:   0.85,
                };
            })
            .filter(function(s) { return s.endSeconds - s.startSeconds > 0.3; });

        Logger.info('_runLayerPipeline: returning ' + directSegments.length + ' silence range(s) from Layer 1 (no padding applied yet)');
        return { success: true, words: null, directSegments };
    },

    /**
     * Detect silence gaps between consecutive words.
     * Returns editPlan-compatible segments: [{ startSeconds, endSeconds, confidence }]
     */
    findSilences(words, minSilenceSeconds) {
        const minTicks = BigInt(Math.round((minSilenceSeconds || CONSTANTS.MIN_SILENCE_SECONDS) * 254016000000));
        const sorted   = words.slice().sort((a, b) => (a.startTicks < b.startTicks ? -1 : a.startTicks > b.startTicks ? 1 : 0));
        const segments = [];

        for (let i = 1; i < sorted.length; i++) {
            const gapStart = sorted[i - 1].endTicks;
            const gapEnd   = sorted[i].startTicks;
            if (gapEnd > gapStart && (gapEnd - gapStart) >= minTicks) {
                segments.push({
                    startSeconds: Number(gapStart) / 254016000000,
                    endSeconds:   Number(gapEnd)   / 254016000000,
                    confidence:   1.0,
                });
            }
        }

        Logger.info('findSilences: ' + segments.length + ' gap(s) ≥ ' + (minSilenceSeconds || CONSTANTS.MIN_SILENCE_SECONDS) + 's');
        return segments;
    },

    // ── Step 1 ────────────────────────────────────────────────────────────────

    async analyzeAndMark(editPlan) {
        Logger.info('TimelineEditor.analyzeAndMark: ' + editPlan.segments.length + ' segments');

        // Build the marker list for the CEP bridge.
        // UXP's sequence.markers API returns null in PPro 25.x — bridge is the reliable path.
        const markerList = [];

        for (const seg of editPlan.segments) {
            const duration = (seg.endSeconds - seg.startSeconds).toFixed(2);
            const conf = seg.confidence !== undefined
                ? ' — ' + (seg.confidence * 100).toFixed(0) + '% confidence'
                : '';
            const isFiller = seg.type === 'filler';
            markerList.push({
                timeSeconds: seg.startSeconds,
                name:    isFiller ? 'Filler Word' : 'Silence',
                comment: isFiller ? (duration + 's filler' + conf) : (duration + 's gap' + conf),
                type:    seg.type || 'silence',
            });
        }

        if (Array.isArray(editPlan.brollOpportunities)) {
            for (const broll of editPlan.brollOpportunities) {
                markerList.push({
                    timeSeconds: broll.atSeconds,
                    name: 'B-roll',
                    comment: broll.suggestion || '',
                });
            }
        }

        let silenceMarked = 0;
        let brollMarked   = 0;

        if (markerList.length > 0) {
            try {
                const result = await CEPBridge.placeMarkers(markerList);
                if (result && result.success) {
                    silenceMarked = editPlan.segments.length;
                    brollMarked   = Array.isArray(editPlan.brollOpportunities) ? editPlan.brollOpportunities.length : 0;
                    Logger.info('analyzeAndMark: CEP bridge placed ' + result.placed + ' marker(s)');
                } else {
                    Logger.warn('analyzeAndMark: CEP bridge placeMarkers returned failure — ' + (result && result.error));
                }
            } catch (e) {
                Logger.warn('analyzeAndMark: CEP bridge placeMarkers exception — ' + e.message);
            }
        }

        Logger.info('analyzeAndMark: ' + silenceMarked + ' silence + ' + brollMarked + ' B-roll markers placed');
        UIState.set(CONSTANTS.STATES.MARKERS_PLACED);
        return { success: silenceMarked > 0, silenceMarked, brollMarked };
    },

    // ── Step 2 ────────────────────────────────────────────────────────────────

    async commitEdits(editPlan) {
        Logger.info('TimelineEditor.commitEdits: ' + editPlan.segments.length + ' segments');
        UIState.set(CONSTANTS.STATES.COMMITTING);

        const sequence = await PremiereAPI.getActiveSequenceAsync();
        if (!sequence) {
            Logger.error('commitEdits: no active sequence');
            UIState.set(CONSTANTS.STATES.ERROR);
            return { success: false, cutsApplied: 0 };
        }

        let project   = null;
        let seqEditor = null;
        try {
            const ppro = require('premierepro');
            project    = await ppro.Project.getActiveProject();
        } catch (e) {
            Logger.error('commitEdits: could not load premierepro — ' + e.message);
            UIState.set(CONSTANTS.STATES.ERROR);
            return { success: false, cutsApplied: 0 };
        }
        try {
            seqEditor = await PremiereAPI.getSequenceEditor(sequence);
        } catch (e) {
            Logger.warn('commitEdits: SequenceEditor not available — ' + e.message);
        }

        let cutsApplied = 0;

        let timedOut = false;

        if (!seqEditor) {
            // SequenceEditor not available in this PPro build — send all segments to CEP bridge
            Logger.info('commitEdits: no SequenceEditor — routing all ' + editPlan.segments.length + ' segment(s) to CEP bridge');
            try {
                const result = await CEPBridge.razorAndDelete(this._sortReverse(editPlan.segments));
                if (result && result.success) cutsApplied += result.cutsApplied || 0;
            } catch (e) {
                Logger.warn('commitEdits: CEP bridge error — ' + e.message);
                if (e.message && e.message.indexOf('timeout') !== -1) timedOut = true;
            }
        } else {
            // Sort end → start so each deletion doesn't shift subsequent positions
            const sorted = this._sortReverse(editPlan.segments);
            const needsBridge = []; // segments where no whole clips were found (need razor)

            for (const seg of sorted) {
                const pad   = CONSTANTS.PADDING_SECONDS;
                const start = seg.startSeconds + pad;
                const end   = seg.endSeconds   - pad;

                if (end - start < 0.3) {
                    Logger.info('commitEdits: skipping ' + seg.startSeconds.toFixed(2) + 's–' + seg.endSeconds.toFixed(2) + 's (too short after padding)');
                    continue;
                }

                const deleted = await this._deleteSegment(sequence, project, seqEditor, start, end);
                if (deleted) {
                    cutsApplied++;
                } else {
                    // No whole clips in range — clip likely spans the boundary and needs razor
                    // Send the ORIGINAL (unpadded) segment; the bridge applies its own padding
                    needsBridge.push(seg);
                }
            }

            // CEP bridge handles clips that straddle the silence boundary
            if (needsBridge.length > 0) {
                Logger.info('commitEdits: ' + needsBridge.length + ' segment(s) need CEP bridge razor');
                try {
                    const result = await CEPBridge.razorAndDelete(needsBridge);
                    if (result && result.success) cutsApplied += result.cutsApplied || 0;
                } catch (e) {
                    Logger.warn('commitEdits: CEP bridge failed — ' + e.message);
                    Logger.warn(CONSTANTS.MESSAGES.BRIDGE_MISSING);
                }
            }
        }

        Logger.info('commitEdits: ' + cutsApplied + ' total cuts applied');
        UIState.set(CONSTANTS.STATES.COMMITTED);
        return { success: cutsApplied > 0, cutsApplied, timedOut };
    },

    // ── Internal helpers ──────────────────────────────────────────────────────

    // Return a copy of segments with PADDING_SECONDS shrunk from each side.
    // Segments that become shorter than 0.3s after padding are dropped.
    _applyPadding(segments) {
        const PAD = CONSTANTS.PADDING_SECONDS;
        const MIN = 0.3;
        const out = [];
        for (const seg of segments) {
            const start = seg.startSeconds + PAD;
            const end   = seg.endSeconds   - PAD;
            if (end - start < MIN) {
                Logger.info('_applyPadding: dropped ' + seg.startSeconds.toFixed(2) + 's–' + seg.endSeconds.toFixed(2) + 's');
                continue;
            }
            out.push(Object.assign({}, seg, { startSeconds: start, endSeconds: end }));
        }
        return out;
    },

    // Group word-level timestamps into ~10-second topic blocks for the B-roll prompt.
    // Handles both { startTicks, endTicks } (BigInt) and { startTime, endTime } (object) shapes.
    _wordsToBlocks(words) {
        if (!words || !words.length) return [];
        var BLOCK_SEC = 10;
        var TICKS_PER_SEC = 254016000000;
        var blocks = [];
        var blockWords = [];

        function getSecs(w, which) {
            if (which === 'start') {
                if (w.startTicks !== undefined) return Number(w.startTicks) / TICKS_PER_SEC;
                if (w.startTime && w.startTime.ticks !== undefined) return Number(w.startTime.ticks) / TICKS_PER_SEC;
            } else {
                if (w.endTicks !== undefined) return Number(w.endTicks) / TICKS_PER_SEC;
                if (w.endTime && w.endTime.ticks !== undefined) return Number(w.endTime.ticks) / TICKS_PER_SEC;
            }
            return 0;
        }

        var blockStart = getSecs(words[0], 'start');
        for (var i = 0; i < words.length; i++) {
            var w = words[i];
            var wStart = getSecs(w, 'start');
            if (wStart - blockStart >= BLOCK_SEC && blockWords.length) {
                blocks.push({ startSeconds: blockStart, endSeconds: wStart, text: blockWords.join(' ') });
                blockWords = [];
                blockStart = wStart;
            }
            blockWords.push(w.word || w.text || '');
        }
        if (blockWords.length) {
            var last = words[words.length - 1];
            blocks.push({ startSeconds: blockStart, endSeconds: getSecs(last, 'end'), text: blockWords.join(' ') });
        }
        return blocks;
    },

    // Sort segments descending by startSeconds (end of timeline → start).
    _sortReverse(segments) {
        return segments.slice().sort(function(a, b) {
            return b.startSeconds - a.startSeconds;
        });
    },

    // Find all clips fully contained within [startSecs, endSecs] and ripple-delete them.
    // Returns true if at least one clip was deleted, false if the range is empty
    // (meaning the clip straddles the boundary and the caller must try the CEP bridge).
    // TODO(MIGRATE-TO-UXP): when razor API lands, eliminate the CEP bridge fallback here.
    async _deleteSegment(sequence, project, seqEditor, startSecs, endSecs) {
        try {
            const ppro     = require('premierepro');
            const startTicks = PremiereAPI.timeToTicks(startSecs);
            const endTicks   = PremiereAPI.timeToTicks(endSecs);

            // Use sync property access (matches getSequenceClips — confirmed working in this PPro build)
            const allClips = PremiereAPI.getSequenceClips(sequence);
            // Also include audio track clips
            const audioClips = [];
            try {
                var at = null;
                try { at = sequence.audioTracks; } catch (_) {}
                if (at) {
                    const atCount = (at.numTracks !== undefined && at.numTracks !== null) ? at.numTracks : (at.length || 0);
                    for (let i = 0; i < atCount; i++) {
                        const tr = at[i];
                        const cc = (tr && tr.clips && tr.clips.numClips !== undefined && tr.clips.numClips !== null) ? tr.clips.numClips : (tr && tr.clips && tr.clips.length || 0);
                        for (let j = 0; j < cc; j++) audioClips.push(tr.clips[j]);
                    }
                }
            } catch (_) {}
            const allItems = [...allClips, ...audioClips];

            const clipsToDelete = [];
            for (const clip of allItems) {
                const cStart = await clip.getStartTime();
                const cEnd   = await clip.getEndTime();
                if (cStart.ticks >= startTicks && cEnd.ticks <= endTicks) {
                    clipsToDelete.push(clip);
                }
            }

            if (!clipsToDelete.length) return false;

            ppro.TrackItemSelection.createEmptySelection((selection) => {
                for (const clip of clipsToDelete) selection.addItem(clip);
                project.executeTransaction((ca) => {
                    ca.addAction(seqEditor.createRemoveItemsAction(
                        selection, true, ppro.Constants.MediaType.ANY
                    ));
                    return true;
                }, 'Ripple delete silence [' + startSecs.toFixed(2) + 's–' + endSecs.toFixed(2) + 's]');
            });

            Logger.info('_deleteSegment: removed ' + clipsToDelete.length + ' clip(s) at ' + startSecs.toFixed(2) + 's–' + endSecs.toFixed(2) + 's');
            return true;
        } catch (e) {
            Logger.error('_deleteSegment failed: ' + e.message);
            return false;
        }
    },
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = TimelineEditor;
}
