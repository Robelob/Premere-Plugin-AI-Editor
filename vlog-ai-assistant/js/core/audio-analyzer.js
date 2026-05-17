/* audio-analyzer.js — Layer 1: silence detection via PCM math
 *
 * Dependency order: loaded AFTER cep-bridge.js, BEFORE premiere-api.js.
 * PremiereAPI and CEPBridge are referenced by name (globals from other script tags).
 */

const AudioAnalyzer = {

    SILENCE_THRESHOLD_DB: -40,
    FRAME_MS:             10,
    MIN_SILENCE_MS:       1200,
    PADDING_MS:           150,

    // ── Entry point ───────────────────────────────────────────────────────────
    //
    // Called by TimelineEditor before Layer 2 (Whisper) and Layer 3 (LLM).
    // Returns { success: true, pcm, path } or { success: false, error }.
    //
    // Orchestration:
    //   1. PremiereAPI.getSourceFilePath()  — resolve native file path
    //   2. _readAsPCM(path)                — direct AudioContext decode
    //   3. CEPBridge exportAudio fallback  — if (1) or (2) fails
    //   4. _readAsPCM(exportedPath)        — decode the exported MP3/WAV
    //   5. Return failure with a clear message if everything fails

    async getAudioPCM(sequence) {
        // Step 1: resolve source path via UXP / CEP bridge
        const path = await PremiereAPI.getSourceFilePath(sequence);

        if (path) {
            Logger.info('[AudioAnalyzer] Source path: ' + path);

            // Step 2: direct PCM decode
            const pcm = await this._readAsPCM(path);
            if (pcm) {
                Logger.info('[AudioAnalyzer] Direct decode OK — duration ' + pcm.duration.toFixed(1) + 's');
                return { success: true, pcm, path };
            }
            Logger.warn('[AudioAnalyzer] Direct decode failed — trying CEP export fallback');
        } else {
            Logger.warn('[AudioAnalyzer] Source path not resolved — trying CEP export fallback');
        }

        // Step 3: export audio via CEP bridge (ExtendScript → AME → MP3)
        try {
            const exportResult = await CEPBridge.sendCommand('exportAudio', {});
            if (exportResult && exportResult.success && exportResult.audioPath) {
                Logger.info('[AudioAnalyzer] CEP exported audio: ' + exportResult.audioPath);

                // Step 4: decode the exported file
                const exportedPcm = await this._readAsPCM(exportResult.audioPath);
                if (exportedPcm) {
                    Logger.info('[AudioAnalyzer] CEP export decode OK — duration ' + exportedPcm.duration.toFixed(1) + 's');
                    return { success: true, pcm: exportedPcm, path: exportResult.audioPath };
                }
                Logger.error('[AudioAnalyzer] CEP export decode also failed');
            } else {
                Logger.warn('[AudioAnalyzer] CEP export failed: ' + (exportResult && exportResult.error));
            }
        } catch (e) {
            Logger.warn('[AudioAnalyzer] CEP exportAudio threw: ' + e.message);
        }

        // Step 5: nothing worked
        return {
            success: false,
            error: 'Could not read audio PCM. ' +
                   'Install the CEP bridge or ensure the source file format is supported by AudioContext.',
        };
    },

    // ── Layer 1 orchestrator (called after getAudioPCM succeeds) ─────────────

    async findSilences(sourceFilePath, clipStartTicks, clipInPointTicks) {
        Logger.info('[AudioAnalyzer] Reading PCM from: ' + sourceFilePath);
        const pcm = await this._readAsPCM(sourceFilePath);
        if (!pcm) return { silences: [], speechSegments: [] };

        const silenceRangesMs  = this._detectSilenceRanges(pcm);
        const speechSegmentsMs = this._invertToSpeech(silenceRangesMs, pcm.duration * 1000);
        const paddedSilences   = this._applyPadding(silenceRangesMs, pcm.duration * 1000);
        const sequenceSilences = this._toSequenceTicks(paddedSilences, clipStartTicks, clipInPointTicks);

        Logger.info('[AudioAnalyzer] Silences: ' + sequenceSilences.length +
                    ', Speech segments: ' + speechSegmentsMs.length);
        return { silences: sequenceSilences, speechSegments: speechSegmentsMs, pcm };
    },

    // ── PCM decode ────────────────────────────────────────────────────────────

    async _readAsPCM(filePath) {
        try {
            const uxp = require('uxp');
            const fs  = uxp.storage.localFileSystem;

            // file:/// + forward slashes + %20 avoids UXP URL bugs on Windows paths with spaces
            const url    = 'file:///' + filePath.replace(/\\/g, '/').replace(/ /g, '%20');
            const entry  = await fs.getEntryWithUrl(url);
            const buffer = await entry.read({ format: uxp.storage.formats.binary });
            const arrayBuffer = buffer.buffer || buffer;

            // Use cached AudioContext availability from Capabilities module
            // (checked once at startup, no repeated checks)
            const AC = (typeof Capabilities !== 'undefined') 
                    ? Capabilities.audioContextConstructor
                    : null;

            if (AC) {
                try {
                    const audioCtx    = new AC({ sampleRate: 16000 });
                    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
                    const channelData = audioBuffer.getChannelData(0); // mono
                    audioCtx.close();
                    Logger.info('[AudioAnalyzer] AudioContext decode OK — ' + audioBuffer.duration.toFixed(1) + 's');
                    return { samples: channelData, sampleRate: audioBuffer.sampleRate, duration: audioBuffer.duration };
                } catch (acErr) {
                    Logger.warn('[AudioAnalyzer] AudioContext.decodeAudioData failed: ' + acErr.message);
                }
            } else {
                Logger.debug('[AudioAnalyzer] AudioContext unavailable — using fallback parsers (WAV/MP3)');
            }

            // Pure JS WAV fallback — no library, no AudioContext.
            // Only works when the CEP bridge exports WAV (not MP3).
            if (filePath.toLowerCase().endsWith('.wav')) {
                const pcm = this._parseWAVBuffer(arrayBuffer);
                if (pcm) {
                    Logger.info('[AudioAnalyzer] WAV fallback parse OK — ' + pcm.duration.toFixed(1) + 's');
                    return pcm;
                }
            }

            // MP3 fallback — reads global_gain from MPEG1 Layer III frame side information.
            // global_gain is the overall amplitude scale for each 26ms frame (~0 = silence).
            // Returns a synthetic 1kHz PCM so _detectSilenceRanges works unchanged.
            if (filePath.toLowerCase().endsWith('.mp3')) {
                const pcm = this._parseMp3AsSyntheticPCM(arrayBuffer);
                if (pcm) {
                    Logger.info('[AudioAnalyzer] MP3 gain fallback OK — ' + pcm.duration.toFixed(1) + 's');
                    return pcm;
                }
            }

            Logger.error('[AudioAnalyzer] _readAsPCM: no working decoder for ' + filePath.split(/[\\/]/).pop());
            return null;
        } catch (e) {
            Logger.error('[AudioAnalyzer] _readAsPCM failed: ' + e.message);
            return null;
        }
    },

    // Pure JS WAV PCM parser — works without AudioContext.
    // Handles 8/16/24/32-bit PCM, any sample rate, mono or stereo (reads ch 0).
    // Walks RIFF chunks so extra chunks (LIST, cue, etc.) don't break parsing.
    _parseWAVBuffer(arrayBuffer) {
        try {
            const view = new DataView(arrayBuffer);
            const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
            const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
            if (riff !== 'RIFF' || wave !== 'WAVE') {
                Logger.warn('[AudioAnalyzer] _parseWAVBuffer: not a valid RIFF/WAVE file');
                return null;
            }

            let audioFormat = 0, numChannels = 0, sampleRate = 0, bitsPerSample = 0;
            let dataOffset = -1, dataSize = 0;
            let chunkStart = 12;

            while (chunkStart + 8 <= arrayBuffer.byteLength) {
                const id   = String.fromCharCode(view.getUint8(chunkStart), view.getUint8(chunkStart + 1), view.getUint8(chunkStart + 2), view.getUint8(chunkStart + 3));
                const size = view.getUint32(chunkStart + 4, true);
                if (id === 'fmt ') {
                    audioFormat   = view.getUint16(chunkStart + 8,  true);
                    numChannels   = view.getUint16(chunkStart + 10, true);
                    sampleRate    = view.getUint32(chunkStart + 12, true);
                    bitsPerSample = view.getUint16(chunkStart + 22, true);
                } else if (id === 'data') {
                    dataOffset = chunkStart + 8;
                    dataSize   = size;
                    break;
                }
                chunkStart += 8 + size + (size & 1); // RIFF pads chunks to even byte boundaries
            }

            if (dataOffset === -1)  { Logger.warn('[AudioAnalyzer] _parseWAVBuffer: no data chunk found'); return null; }
            if (audioFormat !== 1)  { Logger.warn('[AudioAnalyzer] _parseWAVBuffer: non-PCM format=' + audioFormat); return null; }

            const bytesPerSample = bitsPerSample / 8;
            const frameStride    = bytesPerSample * numChannels;
            const numFrames      = Math.floor(dataSize / frameStride);
            const samples        = new Float32Array(numFrames);

            for (let i = 0; i < numFrames; i++) {
                const byteOff = dataOffset + i * frameStride; // channel 0 only
                let val = 0;
                if      (bitsPerSample === 16) { val = view.getInt16(byteOff, true) / 32768; }
                else if (bitsPerSample === 24) {
                    const b0 = view.getUint8(byteOff), b1 = view.getUint8(byteOff + 1), b2 = view.getUint8(byteOff + 2);
                    let raw = (b2 << 16) | (b1 << 8) | b0;
                    if (raw >= 0x800000) raw -= 0x1000000;
                    val = raw / 8388608;
                }
                else if (bitsPerSample === 32) { val = view.getInt32(byteOff, true) / 2147483648; }
                else if (bitsPerSample === 8)  { val = (view.getUint8(byteOff) - 128) / 128; }
                samples[i] = val;
            }

            const duration = numFrames / sampleRate;
            Logger.info('[AudioAnalyzer] WAV: ' + sampleRate + 'Hz ' + bitsPerSample + '-bit ' + numChannels + 'ch → ' + duration.toFixed(1) + 's');
            return { samples, sampleRate, duration };
        } catch (e) {
            Logger.error('[AudioAnalyzer] _parseWAVBuffer failed: ' + e.message);
            return null;
        }
    },

    // MP3 global_gain parser — MPEG1 Layer III only, no full decode needed.
    // Reads global_gain from frame side info to classify silence vs speech.
    // Returns synthetic 1kHz PCM compatible with _detectSilenceRanges.
    _parseMp3AsSyntheticPCM(arrayBuffer) {
        try {
            const BITRATES    = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0]; // kbps
            const SAMPLE_RATES = [44100, 48000, 32000, 0]; // Hz (MPEG1)
            const GAIN_SILENCE = 100; // LAME: silence ~0, speech 100-240
            const SYNTH_RATE   = 1000;

            const data     = new Uint8Array(arrayBuffer);
            const len      = data.length;
            const gainPerMs = []; // one bool per ms: true = silent

            let offset = 0;
            while (offset + 4 < len) {
                if (data[offset] !== 0xFF || (data[offset + 1] & 0xE0) !== 0xE0) {
                    offset++;
                    continue;
                }

                const b1 = data[offset + 1];
                const b2 = data[offset + 2];
                const b3 = data[offset + 3];

                // version bits [4:3]: 0b11 = MPEG1; layer bits [2:1]: 0b01 = Layer III
                const version = (b1 >> 3) & 0x03;
                const layer   = (b1 >> 1) & 0x03;
                if (version !== 3 || layer !== 1) { offset++; continue; }

                const bitrateIdx  = (b2 >> 4) & 0x0F;
                const sampleIdx   = (b2 >> 2) & 0x03;
                const padding     = (b2 >> 1) & 0x01;
                const chanMode    = (b3 >> 6) & 0x03; // 3 = mono

                const bitrate    = BITRATES[bitrateIdx];
                const sampleRate = SAMPLE_RATES[sampleIdx];
                if (bitrate === 0 || sampleRate === 0) { offset++; continue; }

                const frameSize = Math.floor(144 * bitrate * 1000 / sampleRate) + padding;
                if (offset + frameSize > len) break;

                // protection bit 0 means CRC present (2 extra bytes before side info)
                const hasCRC     = (b1 & 0x01) === 0;
                const sideOffset = offset + 4 + (hasCRC ? 2 : 0);
                if (sideOffset + 17 > len) { offset += frameSize; continue; }

                let globalGain = 0;
                if (chanMode === 3) {
                    // Mono 17-byte side info: global_gain granule 0 at bits 39-46
                    // byte 4 bit 0 = bit 39, byte 5 bits [7:1] = bits 40-46
                    globalGain = ((data[sideOffset + 4] & 0x01) << 7) | ((data[sideOffset + 5] >> 1) & 0x7F);
                } else {
                    // Stereo 32-byte side info: global_gain granule 0 ch 0 at bits 41-48
                    // byte 5 bits [6:0] = bits 41-47, byte 6 bit 7 = bit 48
                    globalGain = ((data[sideOffset + 5] & 0x7F) << 1) | ((data[sideOffset + 6] >> 7) & 0x01);
                }

                // MPEG1: 1152 samples per frame → convert to ms
                const frameDurationMs = Math.round(1152 * 1000 / sampleRate);
                const isSilent = globalGain < GAIN_SILENCE;
                for (let ms = 0; ms < frameDurationMs; ms++) gainPerMs.push(isSilent);

                offset += frameSize;
            }

            if (gainPerMs.length === 0) {
                Logger.warn('[AudioAnalyzer] _parseMp3AsSyntheticPCM: no valid MPEG1 frames found');
                return null;
            }

            const samples = new Float32Array(gainPerMs.length);
            for (let i = 0; i < gainPerMs.length; i++) samples[i] = gainPerMs[i] ? 0.0 : 0.5;

            const duration = gainPerMs.length / SYNTH_RATE;
            Logger.info('[AudioAnalyzer] MP3 synthetic PCM: ' + gainPerMs.length + 'ms → ' + duration.toFixed(1) + 's');
            return { samples, sampleRate: SYNTH_RATE, duration };
        } catch (e) {
            Logger.error('[AudioAnalyzer] _parseMp3AsSyntheticPCM failed: ' + e.message);
            return null;
        }
    },

    // ── Silence math ──────────────────────────────────────────────────────────

    _detectSilenceRanges(pcm) {
        const { samples, sampleRate } = pcm;
        const frameSamples    = Math.floor(sampleRate * this.FRAME_MS / 1000);
        const thresholdLinear = Math.pow(10, this.SILENCE_THRESHOLD_DB / 20);
        const ranges = [];
        let silenceStart = null;

        // Explicit check: if the very first frame is below threshold the clip starts silent.
        // The loop's first iteration covers the same frame but guards on silenceStart === null,
        // so pre-setting it here is safe and makes the intent unambiguous.
        if (frameSamples > 0 && samples.length >= frameSamples) {
            let firstSumSq = 0;
            for (let j = 0; j < frameSamples; j++) firstSumSq += samples[j] * samples[j];
            if (Math.sqrt(firstSumSq / frameSamples) < thresholdLinear) silenceStart = 0;
        }

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

    // Invert silence ranges to find speech segments (sent to Whisper in Layer 2)
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

    // Pull silence boundaries inward by PADDING_MS so cuts land on speech, not mid-consonant.
    // Exception: do NOT pad the side that faces a clip boundary (startMs === 0 or
    // endMs ≈ totalDurationMs). Padding a clip-boundary side would create a phantom
    // keep-segment before the first word or after the last word.
    _applyPadding(ranges, totalDurationMs) {
        const PAD = this.PADDING_MS;
        return ranges
            .map(function(r) {
                const atClipStart = r.startMs === 0;
                const atClipEnd   = totalDurationMs != null && Math.abs(r.endMs - totalDurationMs) < 50;
                return {
                    startMs:    atClipStart ? r.startMs : r.startMs + PAD,
                    endMs:      atClipEnd   ? r.endMs   : r.endMs   - PAD,
                    durationMs: r.durationMs,
                    type:       r.type,
                };
            })
            .filter(function(r) { return r.endMs - r.startMs > 300; });
    },

    // ── Filler word detection (Layer 2 complement) ────────────────────────────

    // words: [{ word, startMs, endMs }] from WhisperService
    // Returns [{ startMs, endMs, durationMs, type: 'filler' }]
    detectFillerWords(words) {
        const FILLER_SINGLE = [
            'um', 'uh', 'uhh', 'umm', 'hmm', 'like', 'so',
            'basically', 'honestly', 'literally', 'actually', 'right',
        ];
        const FILLER_BIGRAM = ['you know', 'okay so', 'and uh', 'and um'];

        function norm(w) {
            return w.replace(/[^a-z\s]/gi, '').trim().toLowerCase();
        }

        // Tag each word index as filler (bigram check consumes word i+1 too)
        const fillerTag = new Array(words.length).fill(false);
        for (let i = 0; i < words.length; i++) {
            const w1 = norm(words[i].word);
            if (FILLER_SINGLE.indexOf(w1) !== -1) {
                fillerTag[i] = true;
                continue;
            }
            if (i + 1 < words.length) {
                const bigram = w1 + ' ' + norm(words[i + 1].word);
                if (FILLER_BIGRAM.indexOf(bigram) !== -1) {
                    fillerTag[i]     = true;
                    fillerTag[i + 1] = true;
                }
            }
        }

        // Group consecutive filler words; merge if gap between groups < 300ms
        const groups = [];
        let gStart = null, gEnd = null;
        for (let i = 0; i < words.length; i++) {
            if (fillerTag[i]) {
                if (gStart === null) {
                    gStart = words[i].startMs;
                    gEnd   = words[i].endMs;
                } else if (words[i].startMs - gEnd < 300) {
                    gEnd = words[i].endMs; // extend current group
                } else {
                    groups.push({ startMs: gStart, endMs: gEnd });
                    gStart = words[i].startMs;
                    gEnd   = words[i].endMs;
                }
            } else if (gStart !== null) {
                groups.push({ startMs: gStart, endMs: gEnd });
                gStart = null;
                gEnd   = null;
            }
        }
        if (gStart !== null) groups.push({ startMs: gStart, endMs: gEnd });

        // Apply PADDING_MS to both sides (both sides face speech for mid-clip fillers).
        // Groups that shrink to <= 0ms after padding are dropped.
        const PAD = this.PADDING_MS;
        return groups
            .map(function(g) {
                const start = g.startMs + PAD;
                const end   = g.endMs   - PAD;
                return { startMs: start, endMs: end, durationMs: end - start, type: 'filler' };
            })
            .filter(function(r) { return r.endMs > r.startMs; });
    },

    // Convert ms ranges (source-relative) to sequence ticks, accounting for clip offset
    _toSequenceTicks(rangesMs, clipStartTicks, clipInPointTicks) {
        return rangesMs.map(r => ({
            startTicks: clipStartTicks + BigInt(Math.round(r.startMs * 254016000)) - clipInPointTicks,
            endTicks:   clipStartTicks + BigInt(Math.round(r.endMs   * 254016000)) - clipInPointTicks,
            durationMs: r.durationMs,
            type:       'silence',
        }));
    },
};
