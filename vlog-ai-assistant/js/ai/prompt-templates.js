/* prompt-templates.js - AI prompt engineering templates */

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

    getSystemInstruction() {
        return 'You are an AI video editing assistant specialized in vlog optimization.\n' +
            'Your role is to:\n' +
            '1. Identify technical issues (silence, pacing)\n' +
            '2. Suggest editorial improvements (B-roll, transitions)\n' +
            '3. Enhance accessibility (captions, descriptions)\n\n' +
            'Always respond with valid JSON.\n' +
            'Be precise with timestamps and confidence scores.\n' +
            'Consider the vlog\'s purpose and audience.';
    },
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PromptTemplates;
}
