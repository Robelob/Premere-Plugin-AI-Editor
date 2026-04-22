/* prompt-templates.js - AI prompt engineering templates */

const PromptTemplates = {
    /**
     * Generate silence detection prompt
     * @param {object} metadata
     * @param {number} threshold
     * @param {number} minDuration
     * @returns {string}
     */
    getSilenceDetectionPrompt(metadata, threshold, minDuration) {
        return \
You are an expert video editor analyzing a vlog for silent segments that can be removed.

PROJECT INFORMATION:
- Sequence: \
- Total Duration: \ms
- Number of Clips: \

ANALYSIS PARAMETERS:
- Silence Threshold: \dB
- Minimum Silence Duration: \ms

CLIP DETAILS:
\

TASK:
Identify segments in the vlog where silence occurs (gaps between speech or dead air).
For each silence segment found, return:
1. Start time (in milliseconds)
2. End time (in milliseconds)
3. Confidence score (0-1)

Return ONLY valid JSON in this format:
{
  "silenceSegments": [
    {"start": 5000, "end": 5800, "confidence": 0.95},
    {"start": 12000, "end": 12500, "confidence": 0.88}
  ],
  "totalSilenceDuration": 1300,
  "estimatedTimeSavings": "2.1%"
}
\;
    },
    
    /**
     * Generate B-roll detection prompt
     * @param {object} metadata
     * @param {number} confidenceThreshold
     * @returns {string}
     */
    getBrollDetectionPrompt(metadata, confidenceThreshold) {
        return \
You are an expert vlog editor identifying moments where B-roll footage would enhance the story.

PROJECT INFORMATION:
- Sequence: \
- Total Duration: \ms
- Number of Clips: \

CONFIDENCE THRESHOLD: \ (only suggest opportunities above this level)

CLIP DETAILS:
\

TASK:
Identify moments in the vlog where adding B-roll would:
1. Emphasize a key point
2. Show visual evidence of a claim
3. Add visual interest during transitions
4. Break up talking head footage

For each B-roll opportunity, return:
- Timestamp (milliseconds)
- Type of B-roll needed (e.g., "transition", "emphasis", "example")
- Description of suggested visual
- Confidence score (0-1)

Return ONLY valid JSON:
{
  "opportunities": [
    {"timestamp": 15000, "type": "transition", "suggestion": "Show the product", "confidence": 0.92},
    {"timestamp": 32500, "type": "emphasis", "suggestion": "Demonstrate the feature", "confidence": 0.87}
  ],
  "totalOpportunities": 2
}
\;
    },
    
    /**
     * Generate caption generation prompt
     * @param {object} metadata
     * @returns {string}
     */
    getCaptionGenerationPrompt(metadata) {
        return \
You are an expert captioner creating engaging captions for a vlog.

PROJECT INFORMATION:
- Sequence: \
- Total Duration: \ms

REQUIREMENTS:
- Captions must be under 42 characters per line
- Captions should be engaging and add value
- Use proper punctuation and capitalization
- Include speaker identification if multiple speakers

CLIP INFORMATION:
\

TASK:
Generate captions for each major segment/clip in the vlog.

Return ONLY valid JSON:
{
  "captions": [
    {"timestamp": 0, "duration": 5000, "text": "Introduction caption"},
    {"timestamp": 5000, "duration": 7000, "text": "Main content caption"}
  ],
  "totalCaptions": 2
}
\;
    },
    
    /**
     * System instruction for plugin
     * @returns {string}
     */
    getSystemInstruction() {
        return \
You are an AI video editing assistant specialized in vlog optimization.
Your role is to:
1. Identify technical issues (silence, pacing)
2. Suggest editorial improvements (B-roll, transitions)
3. Enhance accessibility (captions, descriptions)

Always respond with valid JSON.
Be precise with timestamps and confidence scores.
Consider the vlog's purpose and audience.
\;
    },
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PromptTemplates;
}
