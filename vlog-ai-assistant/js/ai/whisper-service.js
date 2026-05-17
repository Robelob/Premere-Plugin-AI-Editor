/* whisper-service.js — Layer 2: speech-segment transcription via Whisper
 *
 * Dependency order: loaded AFTER audio-analyzer.js, BEFORE ai-service.js.
 * Logger is the only runtime dependency.
 *
 * Two decode modes:
 *   Synthetic PCM (sampleRate ≤ 1000): sends full exported audio file to Whisper
 *   Real PCM      (sampleRate > 1000): slices Float32Array → per-segment WAV buffers
 *
 * Multipart form is built manually — UXP's FormData does not propagate Blob.type
 * as the part Content-Type, causing Groq to reject the file as "unknown format".
 * Manual construction guarantees the correct Content-Type header on every request.
 */

const WhisperService = {

    // ── Entry point ────────────────────────────────────────────────────────────
    //
    // segments:      [{ startMs, endMs }] from AudioAnalyzer._invertToSpeech()
    // pcm:           { samples, sampleRate, duration } from AudioAnalyzer.getAudioPCM()
    // provider:      'groq' | 'openai' | 'local-whisper'
    // apiKey:        string
    // audioFilePath: disk path to the exported audio (needed when pcm is synthetic)
    //
    // Returns: [{ word, startMs, endMs, confidence }]

    async transcribeSegments(segments, pcm, provider, apiKey, audioFilePath) {
        if (!segments || segments.length === 0) {
            Logger.warn('[WhisperService] No speech segments to transcribe');
            return [];
        }

        if (pcm.sampleRate <= 1000) {
            if (!audioFilePath) {
                Logger.warn('[WhisperService] Synthetic PCM but no audioFilePath — cannot transcribe');
                return [];
            }
            Logger.info('[WhisperService] Synthetic PCM → full-file path: ' + audioFilePath.split(/[\\/]/).pop());
            return await this._transcribeFullFile(audioFilePath, provider, apiKey);
        }

        // Real PCM: per-segment WAV slices
        Logger.info('[WhisperService] Transcribing ' + segments.length + ' segment(s) via ' + provider);
        const { url, model } = this._providerEndpoint(provider);
        const allWords = [];

        for (const seg of segments) {
            const s0    = Math.floor(seg.startMs / 1000 * pcm.sampleRate);
            const s1    = Math.floor(seg.endMs   / 1000 * pcm.sampleRate);
            const slice = pcm.samples.slice(s0, s1);
            if (slice.length === 0) continue;

            const wavBuf = this._pcmToWavBuffer(slice, pcm.sampleRate);
            const words  = await this._postToWhisper(wavBuf, 'speech.wav', 'audio/wav', url, model, apiKey);

            for (const w of words) {
                allWords.push({
                    word:       w.word,
                    startMs:    seg.startMs + w.startMs,
                    endMs:      seg.startMs + w.endMs,
                    confidence: w.confidence,
                });
            }
        }

        Logger.info('[WhisperService] Total: ' + allWords.length + ' word(s)');
        return allWords;
    },

    // ── Full-file path (synthetic PCM fallback) ────────────────────────────────

    async _transcribeFullFile(filePath, provider, apiKey) {
        try {
            const uxp    = require('uxp');
            const url_   = 'file:///' + filePath.replace(/\\/g, '/').replace(/ /g, '%20');
            const entry  = await uxp.storage.localFileSystem.getEntryWithUrl(url_);
            const buffer = await entry.read({ format: uxp.storage.formats.binary });

            const ext      = filePath.split('.').pop().toLowerCase();
            const mime     = { mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', m4a: 'audio/mp4' }[ext] || 'audio/mpeg';
            const filename = 'audio.' + ext;
            const { url, model } = this._providerEndpoint(provider);

            const words = await this._postToWhisper(buffer, filename, mime, url, model, apiKey);
            Logger.info('[WhisperService] Full-file: ' + words.length + ' word(s)');
            return words;
        } catch (e) {
            Logger.error('[WhisperService] _transcribeFullFile: ' + e.message);
            return [];
        }
    },

    // ── Provider router ────────────────────────────────────────────────────────

    _providerEndpoint(provider) {
        if (provider === 'groq')
            return { url: 'https://api.groq.com/openai/v1/audio/transcriptions', model: 'whisper-large-v3-turbo' };
        if (provider === 'openai')
            return { url: 'https://api.openai.com/v1/audio/transcriptions', model: 'whisper-1' };
        const base = (typeof CONSTANTS !== 'undefined' && CONSTANTS.WHISPER_LOCAL_URL) || 'http://localhost:8080';
        return { url: base + '/v1/audio/transcriptions', model: 'whisper-1' };
    },

    // ── Manual multipart POST ──────────────────────────────────────────────────
    //
    // Constructs the multipart/form-data body as a raw Uint8Array so the file part
    // always carries the correct Content-Type header.
    // UXP's FormData silently drops Blob.type, causing Groq 400 "unknown file type".

    async _postToWhisper(buffer, filename, mimeType, url, model, apiKey) {
        try {
            const boundary = 'AmbarW' + Date.now().toString(36);
            const CRLF     = '\r\n';

            // TextEncoder is not available in UXP — encode ASCII strings manually
            const toBytes = (str) => {
                const out = new Uint8Array(str.length);
                for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xFF;
                return out;
            };

            // Normalize to a flat Uint8Array — respects byteOffset if buffer is a TypedArray view
            let fileBytes;
            if (buffer instanceof ArrayBuffer) {
                fileBytes = new Uint8Array(buffer);
            } else if (buffer && buffer.buffer instanceof ArrayBuffer) {
                fileBytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
            } else {
                fileBytes = new Uint8Array(buffer);
            }

            // File part header
            const fileHeader = toBytes(
                '--' + boundary + CRLF +
                'Content-Disposition: form-data; name="file"; filename="' + filename + '"' + CRLF +
                'Content-Type: ' + mimeType + CRLF + CRLF
            );

            // Text fields
            const fields = [
                ['model',                        model],
                ['response_format',              'verbose_json'],
                ['timestamp_granularities[]',    'word'],
                ['temperature',                  '0'],
            ];
            let tail = CRLF; // closes the file part body
            for (const [name, value] of fields) {
                tail += '--' + boundary + CRLF +
                        'Content-Disposition: form-data; name="' + name + '"' + CRLF +
                        CRLF + value + CRLF;
            }
            tail += '--' + boundary + '--' + CRLF;
            const tailBytes = toBytes(tail);

            // Concatenate into a single buffer
            const total = fileHeader.length + fileBytes.length + tailBytes.length;
            const body  = new Uint8Array(total);
            body.set(fileHeader, 0);
            body.set(fileBytes,  fileHeader.length);
            body.set(tailBytes,  fileHeader.length + fileBytes.length);

            Logger.info('[WhisperService] POST ' + (fileBytes.length / 1024).toFixed(0) +
                        'KB as ' + filename + ' (' + mimeType + ') → ' + url.split('/')[2]);

            const headers = { 'Content-Type': 'multipart/form-data; boundary=' + boundary };
            if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;

            const res = await fetch(url, { method: 'POST', headers, body: body.buffer });
            if (!res.ok) {
                const errText = await res.text();
                Logger.error('[WhisperService] API ' + res.status + ': ' + errText.slice(0, 300));
                return [];
            }
            const data = await res.json();
            return (data.words || []).map(w => ({
                word:       w.word.trim(),
                startMs:    w.start * 1000,
                endMs:      w.end   * 1000,
                confidence: 1.0,
            }));
        } catch (e) {
            Logger.error('[WhisperService] _postToWhisper failed: ' + e.message);
            return [];
        }
    },

    // ── WAV encoder ───────────────────────────────────────────────────────────
    // Returns an ArrayBuffer (not a Blob) — passed directly to _postToWhisper.

    _pcmToWavBuffer(samples, sampleRate) {
        const n    = samples.length;
        const buf  = new ArrayBuffer(44 + n * 2);
        const view = new DataView(buf);
        const str  = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

        str(0, 'RIFF');  view.setUint32(4,  36 + n * 2, true);
        str(8, 'WAVE');
        str(12, 'fmt '); view.setUint32(16, 16,          true);
        view.setUint16(20, 1,           true); // PCM
        view.setUint16(22, 1,           true); // mono
        view.setUint32(24, sampleRate,  true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2,           true); // block align
        view.setUint16(34, 16,          true); // bits per sample
        str(36, 'data'); view.setUint32(40, n * 2,       true);

        for (let i = 0; i < n; i++) {
            view.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, samples[i] * 32768)), true);
        }

        return buf;
    },
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = WhisperService;
}
