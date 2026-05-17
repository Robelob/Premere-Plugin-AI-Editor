# Transcript Guide — Three-Layer Local Pipeline
> **REPLACES the previous Transcript Guide entirely.**
> Previous approach (Groq audio upload, ppro.Transcript.exportToJSON) is ABANDONED.
> Reason: 25MB file limit kills real camera footage. Native PPro transcript API is broken/inaccessible.
> New approach: everything runs locally except the editorial LLM decision.

---

## The Three Layers — Mental Model

```
LAYER 1: Silence Detection    → pure JS math, reads audio PCM from source file
LAYER 2: Speech Transcription → Whisper running via Groq (speech segments only, small)
LAYER 3: Editorial Decisions  → Cloud LLM or Ollama (receives TEXT only, ~2KB)
```

**No full video file is ever uploaded. The cloud only receives text.**
Layer 1 finds the speech. Layer 2 transcribes only those speech segments.
Layer 3 makes editorial decisions from the text summary.

---

## Layer 1 — Silence Detection (Pure JS Math)

No AI. No network. No library needed. Just math on audio amplitude.

### How it works

Read the source file as raw PCM using the Web Audio API (available in UXP),
calculate RMS energy per 10ms frame, mark frames below -40dB as silence,
merge adjacent silence frames into ranges, convert to sequence ticks.

### New file: `js/core/audio-analyzer.js`

```js
const AudioAnalyzer = {

  SILENCE_THRESHOLD_DB: -40,
  FRAME_MS: 10,
  MIN_SILENCE_MS: 1200,
  PADDING_MS: 150,

  async findSilences(sourceFilePath, clipStartTicks, clipInPointTicks) {
    Logger.info('[AudioAnalyzer] Reading PCM from: ' + sourceFilePath);
    const pcm = await this._readAsPCM(sourceFilePath);
    if (!pcm) return { silences: [], speechSegments: [] };

    const silenceRangesMs  = this._detectSilenceRanges(pcm);
    const speechSegmentsMs = this._invertToSpeech(silenceRangesMs, pcm.duration * 1000);
    const paddedSilences   = this._applyPadding(silenceRangesMs);
    const sequenceSilences = this._toSequenceTicks(paddedSilences, clipStartTicks, clipInPointTicks);

    Logger.info('[AudioAnalyzer] Silences: ' + sequenceSilences.length + ', Speech segments: ' + speechSegmentsMs.length);
    return { silences: sequenceSilences, speechSegments: speechSegmentsMs, pcm };
  },

  async _readAsPCM(filePath) {
    try {
      const uxp     = require('uxp');
      const fs      = uxp.storage.localFileSystem;
      const entry   = await fs.getEntryWithUrl('file://' + filePath);
      const buffer  = await entry.read({ format: uxp.storage.formats.binary });
      const audioCtx    = new AudioContext({ sampleRate: 16000 });
      const audioBuffer = await audioCtx.decodeAudioData(buffer.buffer || buffer);
      const channelData = audioBuffer.getChannelData(0);
      audioCtx.close();
      return { samples: channelData, sampleRate: audioBuffer.sampleRate, duration: audioBuffer.duration };
    } catch (e) {
      Logger.error('[AudioAnalyzer] PCM read failed: ' + e.message);
      // TODO(UXP-COMPAT): if AudioContext unavailable, fallback to CEP bridge audio export
      return null;
    }
  },

  _detectSilenceRanges(pcm) {
    const { samples, sampleRate } = pcm;
    const frameSamples    = Math.floor(sampleRate * this.FRAME_MS / 1000);
    const thresholdLinear = Math.pow(10, this.SILENCE_THRESHOLD_DB / 20);
    const ranges = [];
    let silenceStart = null;

    for (let i = 0; i < samples.length; i += frameSamples) {
      const frame = samples.slice(i, i + frameSamples);
      let sumSq = 0;
      for (let j = 0; j < frame.length; j++) sumSq += frame[j] * frame[j];
      const rms    = Math.sqrt(sumSq / frame.length);
      const timeMs = (i / sampleRate) * 1000;

      if (rms < thresholdLinear && silenceStart === null) {
        silenceStart = timeMs;
      } else if (rms >= thresholdLinear && silenceStart !== null) {
        if (timeMs - silenceStart >= this.MIN_SILENCE_MS)
          ranges.push({ startMs: silenceStart, endMs: timeMs, durationMs: timeMs - silenceStart });
        silenceStart = null;
      }
    }
    if (silenceStart !== null) {
      const endMs = (samples.length / sampleRate) * 1000;
      if (endMs - silenceStart >= this.MIN_SILENCE_MS)
        ranges.push({ startMs: silenceStart, endMs, durationMs: endMs - silenceStart });
    }
    return ranges;
  },

  // Invert silence ranges to get speech segments (what we SEND to Whisper)
  _invertToSpeech(silenceRanges, totalDurationMs) {
    const speechSegments = [];
    let cursor = 0;
    for (const s of silenceRanges) {
      if (s.startMs > cursor) speechSegments.push({ startMs: cursor, endMs: s.startMs });
      cursor = s.endMs;
    }
    if (cursor < totalDurationMs) speechSegments.push({ startMs: cursor, endMs: totalDurationMs });
    return speechSegments;
  },

  _applyPadding(ranges) {
    return ranges
      .map(r => ({ ...r, startMs: r.startMs + this.PADDING_MS, endMs: r.endMs - this.PADDING_MS }))
      .filter(r => r.endMs - r.startMs > 300);
  },

  _toSequenceTicks(rangesMs, clipStartTicks, clipInPointTicks) {
    return rangesMs.map(r => ({
      startTicks: clipStartTicks + BigInt(Math.round(r.startMs * 254016000)) - clipInPointTicks,
      endTicks:   clipStartTicks + BigInt(Math.round(r.endMs   * 254016000)) - clipInPointTicks,
      durationMs: r.durationMs,
      type: 'silence',
    }));
  },
};
```

---

## Layer 2 — Whisper Transcription (Speech Segments Only)

We only send the SPEECH segments to Whisper — not the full file.
A 10-min vlog has ~7-8 min of actual speech ≈ much smaller than the full file.
Each speech segment is extracted from the PCM in memory and sent as a .wav blob.

### New file: `js/ai/whisper-service.js`

```js
const WhisperService = {

  // segments: array of { startMs, endMs } from AudioAnalyzer._invertToSpeech()
  // pcm: { samples: Float32Array, sampleRate: number } from AudioAnalyzer
  async transcribeSegments(segments, pcm, provider, apiKey) {
    const allWords = [];

    for (const seg of segments) {
      // Extract PCM slice for this speech segment
      const startSample = Math.floor(seg.startMs / 1000 * pcm.sampleRate);
      const endSample   = Math.floor(seg.endMs   / 1000 * pcm.sampleRate);
      const slice       = pcm.samples.slice(startSample, endSample);
      const wavBlob     = this._pcmToWavBlob(slice, pcm.sampleRate);

      const words = await this._transcribe(wavBlob, provider, apiKey);

      // Offset word times by segment start
      for (const w of words) {
        allWords.push({
          word:       w.word,
          startMs:    seg.startMs + w.startMs,
          endMs:      seg.startMs + w.endMs,
          confidence: w.confidence,
        });
      }
    }
    return allWords;
  },

  async _transcribe(wavBlob, provider, apiKey) {
    if (provider === 'groq')          return this._whisperAPI(wavBlob, 'https://api.groq.com/openai/v1/audio/transcriptions', 'whisper-large-v3-turbo', apiKey);
    if (provider === 'openai')        return this._whisperAPI(wavBlob, 'https://api.openai.com/v1/audio/transcriptions', 'whisper-1', apiKey);
    if (provider === 'local-whisper') return this._whisperAPI(wavBlob, 'http://localhost:8080/v1/audio/transcriptions', 'whisper-1', '');
    Logger.warn('[WhisperService] No transcription provider configured');
    return [];
  },

  async _whisperAPI(wavBlob, url, model, apiKey) {
    const form = new FormData();
    form.append('file', wavBlob, 'speech.wav');
    form.append('model', model);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
    form.append('temperature', '0');

    const headers = apiKey ? { 'Authorization': 'Bearer ' + apiKey } : {};
    try {
      const res  = await fetch(url, { method: 'POST', headers, body: form });
      const data = await res.json();
      return (data.words || []).map(w => ({
        word: w.word.trim(), startMs: w.start * 1000, endMs: w.end * 1000, confidence: 1.0,
      }));
    } catch (e) {
      Logger.error('[WhisperService] ' + e.message);
      return [];
    }
  },

  // Convert Float32Array PCM to WAV blob (no dependencies needed)
  _pcmToWavBlob(samples, sampleRate) {
    const numSamples  = samples.length;
    const buffer      = new ArrayBuffer(44 + numSamples * 2);
    const view        = new DataView(buffer);
    const writeStr    = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, numSamples * 2, true);
    for (let i = 0; i < numSamples; i++)
      view.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, samples[i] * 32768)), true);

    return new Blob([buffer], { type: 'audio/wav' });
  },
};
```

---

## Layer 3 — Editorial AI (No Changes to ai-service.js)

`AIService` already handles all providers. Just update the prompt in `prompt-templates.js`.

### Update `getEditorialAnalysisPrompt()` in `prompt-templates.js`

```js
getEditorialAnalysisPrompt(transcriptBlocks, silences) {
  const blocks = transcriptBlocks.map((b, i) =>
    `[${i+1}] ${b.startSec.toFixed(1)}s–${b.endSec.toFixed(1)}s: "${b.text}"`
  ).join('\n');

  const gaps = silences.map(s =>
    `${(Number(s.startTicks) / 254016000000).toFixed(1)}s–${(Number(s.endTicks) / 254016000000).toFixed(1)}s (${(s.durationMs/1000).toFixed(1)}s)`
  ).join('\n');

  return `You are a professional vlog editor. Review this transcript and silence data.

TRANSCRIPT BLOCKS:
${blocks}

SILENCE GAPS (detected by audio analysis):
${gaps}

Tasks:
1. Confirm which silences are genuine dead air (vs dramatic pauses — keep those)
2. Identify retakes — where speaker restarts the same sentence
3. Suggest 2-3 B-roll moments

Return ONLY valid JSON:
{
  "confirmedCuts": [{ "startSec": 0.0, "endSec": 0.0, "reason": "", "confidence": 0.0 }],
  "retakes":       [{ "startSec": 0.0, "endSec": 0.0, "reason": "", "confidence": 0.0 }],
  "broll":         [{ "atSec": 0.0, "suggestion": "" }],
  "summary": ""
}`;
},
```

---

## constants.js additions

```js
// Layer 2 — Whisper transcription
WHISPER_PROVIDER: 'groq',          // 'groq' | 'openai' | 'local-whisper'
WHISPER_API_KEY:  '',              // same Groq key the user already has
WHISPER_LOCAL_URL: 'http://localhost:8080',

// Layer 3 — Editorial AI (uses existing AI_PROVIDER / AI_MODEL)
// Ollama default:
AI_PROVIDER: 'ollama',
AI_MODEL:    'llama3.2',
OLLAMA_BASE_URL: 'http://localhost:11434',
```

---

## index.html script tag additions

Add these BEFORE `timeline-editor.js`:
```html
<script src="js/core/audio-analyzer.js"></script>
<script src="js/ai/whisper-service.js"></script>
```

---

## What is ABANDONED from old TRANSCRIPT_GUIDE.md

| Old approach | Why abandoned | Replacement |
|---|---|---|
| `ppro.Transcript.exportToJSON()` | Broken — sequence transcript not exposed | AudioAnalyzer (Layer 1) |
| Send full video to Gemini base64 | 20MB limit, slow | Whisper on speech segments only |
| Send full video to Groq | 25MB limit | Whisper on speech segments (~50% smaller) |
| SRT file loading | Deleted in Phase 3 cleanup | AudioAnalyzer |
| Python bridge | Never built | Not needed |
