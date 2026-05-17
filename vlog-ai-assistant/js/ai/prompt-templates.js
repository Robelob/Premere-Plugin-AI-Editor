/* prompt-templates.js - AI prompt engineering templates */

// ── Private helpers ───────────────────────────────────────────────────────────

const TICKS = 254016000000;

function _ticksToSecs(tickTime) {
    if (!tickTime) return 0;
    // Handle both { ticks: BigInt } shape and raw number/BigInt
    var raw = (tickTime && tickTime.ticks !== undefined) ? tickTime.ticks : tickTime;
    return Number(raw) / TICKS;
}

// Convert Premiere SRT timecode (00:00:01,290 or 00:00:01.290) to seconds
function _srtTcToSeconds(tc) {
    var s = tc.trim().replace(',', '.');
    var parts = s.split(':');
    if (parts.length !== 3) return 0;
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
}

// Resolve start or end seconds from a word entry.
// Handles both new format { startTicks, endTicks } (BigInt) and
// old format { startTime: { ticks }, endTime: { ticks } }.
function _wordSecs(w, which) {
    if (!w) return 0;
    if (which === 'start') {
        if (w.startTicks !== undefined) return Number(w.startTicks) / TICKS;
        return _ticksToSecs(w.startTime);
    }
    if (w.endTicks !== undefined) return Number(w.endTicks) / TICKS;
    return _ticksToSecs(w.endTime);
}

// Format Premiere native transcript into a readable annotated block.
// Annotates silences longer than MIN_SILENCE_SECONDS so the AI can see them.
function _formatTranscript(transcriptData) {
    var words = [];
    try {
        // Accepts { words: [...] }, a plain array, or null
        var raw = (transcriptData && transcriptData.words) ? transcriptData.words : (Array.isArray(transcriptData) ? transcriptData : []);
        for (var i = 0; i < raw.length; i++) words.push(raw[i]);
    } catch (_) {}

    if (!words.length) return '(no transcript available — AI will estimate based on context)';

    var out     = '';
    var lineStart = _wordSecs(words[0], 'start');
    var lineWords = [];
    var prevEnd   = lineStart;
    var MIN_SILENCE = (typeof CONSTANTS !== 'undefined') ? CONSTANTS.MIN_SILENCE_SECONDS : 1.2;

    for (var i = 0; i < words.length; i++) {
        var w      = words[i];
        var wStart = _wordSecs(w, 'start');
        var wEnd   = _wordSecs(w, 'end');
        var gap    = wStart - prevEnd;

        // Annotate notable gaps inline so the AI doesn't have to compute them
        if (gap >= MIN_SILENCE) {
            if (lineWords.length) {
                out += '[' + lineStart.toFixed(2) + 's] ' + lineWords.join(' ') + '\n';
                lineWords = [];
            }
            out += '  *** SILENCE ' + gap.toFixed(2) + 's [' + prevEnd.toFixed(2) + 's → ' + wStart.toFixed(2) + 's] ***\n';
            lineStart = wStart;
        }

        // Group into ~10-word display lines for readability
        lineWords.push(w.word || w.text || '');
        prevEnd = wEnd;

        if (lineWords.length >= 10 || i === words.length - 1) {
            out += '[' + lineStart.toFixed(2) + 's] ' + lineWords.join(' ') + '\n';
            lineWords = [];
            if (i < words.length - 1) lineStart = _ticksToSecs(words[i + 1].startTime);
        }
    }

    return out.trim();
}

// Return total duration of the transcript in seconds.
function _transcriptDurationSeconds(transcriptData) {
    try {
        var raw = (transcriptData && transcriptData.words) ? transcriptData.words : (Array.isArray(transcriptData) ? transcriptData : []);
        if (!raw.length) return 0;
        return _wordSecs(raw[raw.length - 1], 'end');
    } catch (_) { return 0; }
}

// ── Public API ────────────────────────────────────────────────────────────────

const PromptTemplates = {
    getSilenceDetectionPrompt(metadata, threshold, minDuration) {
        var hasClips = metadata.clips && metadata.clips.length > 0;
        var totalMs  = metadata.project.duration_ms || 0;

        var clipSection;
        if (hasClips) {
            clipSection = 'CLIP DETAILS:\n' + metadata.clips.map(function(c) {
                return '  Clip ' + c.id + ': "' + c.name + '" in=' + c.in_point_ms + 'ms out=' + c.out_point_ms + 'ms dur=' + c.duration_ms + 'ms';
            }).join('\n');
        } else {
            // Timeline metadata unavailable via current UXP API — ask AI for structured estimates
            clipSection = 'NOTE: Timeline clip data is not available from the Premiere Pro API in this context.\n' +
                'Assume a typical vlog of 5-15 minutes with regular talking-head footage.\n' +
                'Generate REALISTIC estimated silence segments that a vlog editor would typically find.\n' +
                'Use timestamps spread across the assumed duration (300000ms if duration is 0).';
            if (totalMs === 0) totalMs = 300000; // default 5 min assumption
        }

        return 'You are an expert video editor analyzing a vlog for silent segments that can be removed.\n\n' +
            'PROJECT INFORMATION:\n' +
            '- Sequence: ' + metadata.project.name + '\n' +
            '- Total Duration: ' + totalMs + 'ms\n' +
            '- Number of Clips: ' + metadata.project.clip_count + '\n\n' +
            'ANALYSIS PARAMETERS:\n' +
            '- Silence Threshold: ' + threshold + 'dB\n' +
            '- Minimum Silence Duration: ' + minDuration + 'ms\n\n' +
            clipSection + '\n\n' +
            'TASK:\n' +
            'Identify segments where silence occurs (gaps between speech or dead air).\n' +
            'Return ONLY valid JSON:\n' +
            '{\n' +
            '  "silenceSegments": [\n' +
            '    {"start": 5000, "end": 5800, "confidence": 0.95},\n' +
            '    {"start": 12000, "end": 12500, "confidence": 0.88}\n' +
            '  ],\n' +
            '  "totalSilenceDuration": 1300,\n' +
            '  "estimatedTimeSavings": "2.1%"\n' +
            '}';
    },

    getBrollDetectionPrompt(metadata, confidenceThreshold) {
        var hasClips = metadata.clips && metadata.clips.length > 0;
        var totalMs  = metadata.project.duration_ms || 0;

        var clipSection;
        if (hasClips) {
            clipSection = 'CLIP DETAILS:\n' + metadata.clips.map(function(c) {
                return '  Clip ' + c.id + ': "' + c.name + '" in=' + c.in_point_ms + 'ms out=' + c.out_point_ms + 'ms dur=' + c.duration_ms + 'ms';
            }).join('\n');
        } else {
            clipSection = 'NOTE: Timeline clip data is not available from the Premiere Pro API in this context.\n' +
                'Assume a typical vlog of 5-15 minutes with regular talking-head footage.\n' +
                'Generate REALISTIC estimated B-roll opportunities that a vlog editor would typically find.';
            if (totalMs === 0) totalMs = 300000;
        }

        return 'You are an expert vlog editor identifying moments where B-roll footage would enhance the story.\n\n' +
            'PROJECT INFORMATION:\n' +
            '- Sequence: ' + metadata.project.name + '\n' +
            '- Total Duration: ' + totalMs + 'ms\n' +
            '- Number of Clips: ' + metadata.project.clip_count + '\n\n' +
            'CONFIDENCE THRESHOLD: ' + confidenceThreshold + '\n\n' +
            clipSection + '\n\n' +
            'TASK:\n' +
            'Identify moments where B-roll would improve the vlog.\n' +
            'Return ONLY valid JSON:\n' +
            '{\n' +
            '  "opportunities": [\n' +
            '    {"timestamp": 15000, "type": "transition", "suggestion": "Show the product", "confidence": 0.92},\n' +
            '    {"timestamp": 32500, "type": "emphasis", "suggestion": "Demonstrate the feature", "confidence": 0.87}\n' +
            '  ],\n' +
            '  "totalOpportunities": 2\n' +
            '}';
    },

    getCaptionGenerationPrompt(metadata) {
        var clipList = metadata.clips.map(function(c) {
            return '  Clip ' + c.id + ': "' + c.name + '" in=' + c.in_point_ms + 'ms dur=' + c.duration_ms + 'ms';
        }).join('\n');

        return 'You are an expert captioner creating engaging captions for a vlog.\n\n' +
            'PROJECT INFORMATION:\n' +
            '- Sequence: ' + metadata.project.name + '\n' +
            '- Total Duration: ' + metadata.project.duration_ms + 'ms\n\n' +
            'REQUIREMENTS:\n' +
            '- Captions must be under 42 characters per line\n' +
            '- Captions should be engaging and add value\n' +
            '- Use proper punctuation and capitalization\n\n' +
            'CLIP INFORMATION:\n' + clipList + '\n\n' +
            'TASK:\n' +
            'Generate captions for each major segment/clip in the vlog.\n\n' +
            'Return ONLY valid JSON:\n' +
            '{\n' +
            '  "captions": [\n' +
            '    {"timestamp": 0, "duration": 5000, "text": "Introduction caption"},\n' +
            '    {"timestamp": 5000, "duration": 7000, "text": "Main content caption"}\n' +
            '  ],\n' +
            '  "totalCaptions": 2\n' +
            '}';
    },

    getFcpxmlAnalysisPrompt: function(summary) {
        return summary + '\n\n' +
            '━━━ TASK ━━━\n' +
            'You are Ambar, a professional vlog editor. Analyze the sequence above and produce 5–20 edit decisions.\n\n' +
            'Decision types:\n' +
            '• "cut"   — remove silence, filler words, dead air, or repetition in the A-roll\n' +
            '• "broll" — place B-roll over a section (only suggest clips listed under AVAILABLE B-ROLL)\n' +
            '• "story" — reorder, restructure, or tighten for better narrative flow\n\n' +
            '⚠ CRITICAL — HOW TO SET timelineOffset:\n' +
            'Transcript entries look like  [M:SS] text  where M = minutes, SS = seconds.\n' +
            'timelineOffset is TOTAL SECONDS from the sequence start — NOT the M:SS value itself.\n' +
            'You MUST convert:\n' +
            '  [0:45] → timelineOffset = 45.0     (0 min × 60 + 45 sec)\n' +
            '  [1:10] → timelineOffset = 70.0     (1 min × 60 + 10 sec)\n' +
            '  [1:36] → timelineOffset = 96.0     (1 min × 60 + 36 sec)\n' +
            '  [2:05] → timelineOffset = 125.0    (2 min × 60 + 5 sec)\n' +
            'WRONG: timelineOffset: 1.36   ← this means 1.36 seconds, not 1 min 36 sec\n' +
            'RIGHT: timelineOffset: 96.0   ← correct for [1:36] transcript entry\n\n' +
            'Respond ONLY with valid JSON — no text before or after the JSON block:\n' +
            '{\n' +
            '  "summary": "2-3 sentence story assessment and pacing note",\n' +
            '  "decisions": [\n' +
            '    {\n' +
            '      "type": "cut",\n' +
            '      "description": "Short specific action label",\n' +
            '      "timelineOffset": 96.0,\n' +
            '      "duration": 3.1,\n' +
            '      "confidence": 0.92,\n' +
            '      "reason": "Why this edit improves the video"\n' +
            '    }\n' +
            '  ]\n' +
            '}\n\n' +
            'Rules:\n' +
            '- timelineOffset is TOTAL SECONDS (float) — always convert [M:SS] as shown above\n' +
            '- timelineOffset must be within the VALID RANGE shown in the sequence header\n' +
            '- duration must be > 0.1 seconds\n' +
            '- confidence is 0.0–1.0\n' +
            '- Order decisions by timelineOffset (earliest first)\n' +
            '- For broll decisions, name the specific asset from AVAILABLE B-ROLL in the description\n' +
            '- type must be exactly "cut", "broll", or "story"';
    },

    /**
     * Build a B-roll matching prompt.
     * transcriptBlocks: [{ startSeconds, endSeconds, text }] — from TimelineEditor._lastTranscriptBlocks
     * availableClips:   [{ name, mediaPath, durationSeconds, binName }] — from CEP getBrollClips
     */
    getBrollMatchingPrompt: function(transcriptBlocks, availableClips, v1DurationSecs) {
        var budgetSecs = Math.floor((v1DurationSecs || 0) * 0.40);
        var totalSecs  = Math.round(v1DurationSecs || 0);

        var clipList = [];
        for (var ci = 0; ci < availableClips.length; ci++) {
            var cc = availableClips[ci];
            var cd = (cc.durationSeconds != null) ? cc.durationSeconds.toFixed(1) + 's' : 'unknown';
            var cat = cc.binName || cc.category || 'unknown';
            clipList.push('[' + (ci + 1) + '] name="' + (cc.name || 'Unnamed') + '" path="' + (cc.mediaPath || '') + '" category=' + cat + ' available=' + cd);
        }

        var blockList = [];
        for (var bi = 0; bi < transcriptBlocks.length; bi++) {
            var bb = transcriptBlocks[bi];
            var ts = (bb.startSeconds != null) ? bb.startSeconds.toFixed(1) + 's–' + bb.endSeconds.toFixed(1) + 's' : '';
            blockList.push('[' + (bi + 1) + '] ' + ts + ': "' + (bb.text || '').replace(/\n/g, ' ') + '"');
        }

        return (
            'You are a professional vlog editor with 10 years experience.\n' +
            'Your job: place B-roll over a talking-head video. You think like a SURGEON —\n' +
            'cut precisely, only where it adds value, never as decoration.\n\n' +
            'VIDEO LENGTH: ' + totalSecs + ' seconds\n' +
            'TOTAL B-ROLL BUDGET: ' + budgetSecs + ' seconds maximum (40% of video)\n\n' +
            'NON-NEGOTIABLE RULES:\n' +
            '0. CRITICAL: You may ONLY use clips from the "AVAILABLE CLIPS" list below.\n' +
            '   These are B-roll candidates. The A-roll (talking-head footage on V1) has\n' +
            '   already been excluded — do NOT reference or invent any other clip names.\n' +
            '   If you suggest a clip not in the list, it will be silently dropped.\n' +
            '1. Each B-roll shot: EXACTLY 4–6 seconds (not more, not less)\n' +
            '2. Minimum 10 seconds of talking head between ANY two B-roll shots\n' +
            '3. No B-roll in first 6 seconds — viewer must connect with speaker first\n' +
            '4. No B-roll in last 6 seconds — always end on the speaker\'s face\n' +
            '5. Only place B-roll when speaker explicitly names, describes or refers to\n' +
            '   something a clip can VISUALLY SHOW. "I went to the temple" + temple clip = YES.\n' +
            '   "it was amazing" + any clip = NO (too vague).\n' +
            '6. If no clip DIRECTLY matches what is being said: place NOTHING\n' +
            '7. Maximum 3–4 placements total for a video under 3 minutes\n' +
            '8. Confidence must be 0.85 or higher — if unsure, skip it\n\n' +
            'THINKING PROCESS (apply to every transcript block):\n' +
            '  Step 1: What is the speaker SHOWING or DESCRIBING in concrete visual terms?\n' +
            '  Step 2: Is there a clip that shows EXACTLY that? (not vaguely, EXACTLY)\n' +
            '  Step 3: What is the BEST 4–6 second moment in that clip to use? (clipStartSec)\n' +
            '  Step 4: Will there be at least 10s of talking head before and after?\n' +
            '  Step 5: Only if ALL answers are yes: add to placements\n\n' +
            'TRANSCRIPT BLOCKS:\n' +
            (blockList.join('\n') || '(no transcript)') + '\n\n' +
            'AVAILABLE CLIPS (use the exact path value in your response):\n' +
            (clipList.join('\n') || '(no clips)') + '\n\n' +
            'Return ONLY this JSON — no explanation, no markdown:\n' +
            '{\n' +
            '  "reasoning": "2–3 sentences explaining your selection decisions",\n' +
            '  "placements": [\n' +
            '    {\n' +
            '      "atSec": 18.0,\n' +
            '      "durationSec": 5.0,\n' +
            '      "clipName": "ZVE100720.MP4",\n' +
            '      "clipPath": "/exact/path/from/above",\n' +
            '      "clipStartSec": 0.0,\n' +
            '      "reason": "Speaker says the temple had colorful decorations at 18s — clip shows temple facade",\n' +
            '      "confidence": 0.91\n' +
            '    }\n' +
            '  ]\n' +
            '}\n\n' +
            'If no placements meet all criteria, return: { "reasoning": "...", "placements": [] }'
        );
    },

    /**
     * Convert Premiere-exported SRT text into the transcript shape that
     * getTimelineAnalysisPrompt() expects: { words: [{ word, startTime, endTime }] }
     * Works with both word-level and sentence-level SRT exports.
     */
    parseSrtToTranscript(srtText) {
        var words  = [];
        var blocks = srtText.trim().split(/\r?\n\r?\n/);
        for (var i = 0; i < blocks.length; i++) {
            var lines = blocks[i].trim().split(/\r?\n/);
            if (lines.length < 2) continue;

            // Skip optional index number line
            var tcLine    = lines[0];
            var textStart = 1;
            if (/^\d+$/.test(lines[0].trim())) {
                tcLine    = lines[1];
                textStart = 2;
            }
            if (!tcLine || !tcLine.includes('-->')) continue;

            var parts    = tcLine.split('-->');
            var startSec = _srtTcToSeconds(parts[0]);
            var endSec   = _srtTcToSeconds(parts[1]);
            var text     = lines.slice(textStart).join(' ').replace(/<[^>]+>/g, '').trim();
            if (!text || endSec <= startSec) continue;

            words.push({
                word:       text,
                startTime:  { ticks: Math.round(startSec * TICKS) },
                endTime:    { ticks: Math.round(endSec   * TICKS) },
                confidence: 1.0,
            });
        }
        Logger.info('parseSrtToTranscript: ' + words.length + ' entries');
        return { words: words };
    },

    getSystemInstruction() {
        return (
            'You are Ambar, a professional vlog editor. You think in complete thoughts and ' +
            'natural sentences — not individual words or timestamps.\n\n' +
            'Your job is to identify segments to DELETE from the vlog. You return ONLY a ' +
            'JSON object matching the schema below. Never suggest a cut unless:\n' +
            '  1. Silence exceeds ' + CONSTANTS.MIN_SILENCE_SECONDS + ' seconds (genuine dead air, not a breath)\n' +
            '  2. The speaker is clearly restarting a sentence (false start / retake)\n' +
            '  3. There is obvious filler with no informational content\n\n' +
            'Group consecutive words into thematic blocks before deciding. ' +
            'A "thought" is a complete sentence or idea. Never cut inside a thought.\n\n' +
            'Confidence below ' + CONSTANTS.MIN_CONFIDENCE + ' will be automatically discarded — ' +
            'only include segments you are confident about.\n\n' +
            'Always respond with valid JSON. No markdown fences, no explanation text.'
        );
    },

    /**
     * Build the analysis prompt from a native Premiere transcript.
     *
     * transcriptData: object returned by sequence.getTranscript()
     *   Expected shape: { words: [{ word, startTime: { ticks }, endTime: { ticks }, confidence }] }
     *   Falls back gracefully if the shape varies.
     */
    getTimelineAnalysisPrompt(transcriptData) {
        var lines    = _formatTranscript(transcriptData);
        var duration = _transcriptDurationSeconds(transcriptData);

        var header = (
            'SEQUENCE DURATION: ' + duration.toFixed(1) + 's\n' +
            'SILENCE THRESHOLD: ' + CONSTANTS.MIN_SILENCE_SECONDS + 's\n' +
            'MIN CONFIDENCE: ' + CONSTANTS.MIN_CONFIDENCE + '\n\n' +
            'TRANSCRIPT (word-level timing):\n' +
            lines
        );

        var schema = (
            '{\n' +
            '  "summary": "2-3 sentence overall pacing assessment",\n' +
            '  "segments": [\n' +
            '    {\n' +
            '      "startSeconds": 12.4,\n' +
            '      "endSeconds": 14.1,\n' +
            '      "reason": "1.7s dead air after sentence ends",\n' +
            '      "type": "silence",\n' +
            '      "confidence": 0.94\n' +
            '    }\n' +
            '  ],\n' +
            '  "brollOpportunities": [\n' +
            '    {\n' +
            '      "atSeconds": 23.0,\n' +
            '      "suggestion": "Show the product being used",\n' +
            '      "confidence": 0.82\n' +
            '    }\n' +
            '  ]\n' +
            '}'
        );

        return (
            header + '\n\n' +
            '━━━ TASK ━━━\n' +
            'Analyze the transcript above. Identify segments to DELETE — silence gaps, ' +
            'false starts, and dead air. Never cut inside a complete thought.\n\n' +
            'type must be exactly "silence", "retake", or "filler".\n' +
            'startSeconds and endSeconds are sequence positions in decimal seconds.\n' +
            'Order segments by startSeconds ascending.\n\n' +
            'Return ONLY valid JSON matching this schema exactly:\n' +
            schema
        );
    },
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PromptTemplates;
}
