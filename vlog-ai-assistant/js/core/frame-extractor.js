/* frame-extractor.js — Extract JPEG frames from video files
 *
 * Strategy 1 (primary): CEP bridge → ffmpeg → temp JPEG on disk → UXP reads + base64 encodes.
 *   Requires ffmpeg in system PATH or a common install location.
 *
 * Strategy 2 (fallback): HTMLVideoElement + Canvas.
 *   TODO(UXP-COMPAT): HTMLVideoElement is NOT available in most UXP versions
 *   (execMethod error). Returns null gracefully — callers skip null frames.
 */

const FrameExtractor = {

    async extractFrame(sourceFilePath, timestampSeconds) {
        // ── Strategy 1: CEP bridge → ffmpeg ───────────────────────────────────
        try {
            const result = await CEPBridge.sendCommand('extractFrame', {
                mediaPath:        sourceFilePath,
                timestampSeconds: timestampSeconds,
            }, 20000); // 20s timeout — ffmpeg is fast for a single frame

            if (result && result.success && result.framePath) {
                const base64 = await this._readFileAsBase64(result.framePath);
                if (base64) {
                    Logger.info('[FrameExtractor] CEP frame at ' + timestampSeconds.toFixed(1) + 's — ' +
                        Math.round(base64.length * 0.75 / 1024) + 'KB');
                    return base64;
                }
                Logger.warn('[FrameExtractor] _readFileAsBase64 returned null for ' + result.framePath);
            } else if (result && result.error) {
                Logger.warn('[FrameExtractor] CEP bridge: ' + result.error);
            }
        } catch (e) {
            Logger.warn('[FrameExtractor] CEP extractFrame at ' + timestampSeconds.toFixed(1) + 's: ' + e.message);
        }

        // ── Strategy 2: HTMLVideoElement + Canvas (TODO(UXP-COMPAT)) ──────────
        try {
            const video = document.createElement('video');
            if (!video || typeof video.addEventListener !== 'function') {
                Logger.warn('[FrameExtractor] HTMLVideoElement not available in this UXP version');
                return null;
            }

            video.src   = 'file:///' + sourceFilePath.replace(/\\/g, '/');
            video.muted = true;

            await new Promise(function(resolve, reject) {
                video.addEventListener('loadedmetadata', resolve, { once: true });
                video.addEventListener('error', function() {
                    reject(new Error('video element load error'));
                }, { once: true });
                video.load();
            });

            video.currentTime = timestampSeconds;
            await new Promise(function(resolve) {
                video.addEventListener('seeked', resolve, { once: true });
            });

            const canvas  = document.createElement('canvas');
            canvas.width  = video.videoWidth  || 1280;
            canvas.height = video.videoHeight || 720;
            const ctx     = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            video.src = '';
            return dataUrl.replace(/^data:image\/jpeg;base64,/, '');
        } catch (e) {
            Logger.warn('[FrameExtractor] HTMLVideoElement fallback at ' + timestampSeconds.toFixed(1) + 's: ' + e.message);
        }

        return null;
    },

    // Read a JPEG file from disk and return its raw base64 string (no data: URI prefix).
    async _readFileAsBase64(filePath) {
        try {
            const uxp   = require('uxp');
            const fs    = uxp.storage.localFileSystem;
            const url   = 'file:///' + filePath.replace(/\\/g, '/');
            const entry = await fs.getEntryWithUrl(url);
            const raw   = await entry.read({ format: uxp.storage.formats.binary });

            // raw may be ArrayBuffer or Uint8Array depending on UXP version
            const bytes = (raw instanceof Uint8Array) ? raw : new Uint8Array(raw.buffer !== undefined ? raw.buffer : raw);

            // Build binary string in 8 KB chunks to avoid apply() stack overflow
            let binary = '';
            const CHUNK = 8192;
            for (let i = 0; i < bytes.byteLength; i += CHUNK) {
                binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, bytes.byteLength)));
            }
            return btoa(binary);
        } catch (e) {
            Logger.warn('[FrameExtractor] _readFileAsBase64: ' + e.message);
            return null;
        }
    },

    /**
     * Extract one frame every intervalSeconds across durationSeconds.
     * Returns [{ timestampSeconds, base64 }] — base64 is null for frames that failed.
     */
    async extractKeyframes(sourceFilePath, durationSeconds, intervalSeconds) {
        intervalSeconds = intervalSeconds || (CONSTANTS.VISION_KEYFRAME_INTERVAL_SEC || 15);
        const keyframes = [];
        const filename  = sourceFilePath.split(/[\\/]/).pop();

        for (var t = 0; t < durationSeconds; t += intervalSeconds) {
            var base64 = await this.extractFrame(sourceFilePath, t);
            keyframes.push({ timestampSeconds: t, base64: base64 });
        }

        var ok = keyframes.filter(function(k) { return k.base64 !== null; }).length;
        Logger.info('[FrameExtractor] ' + ok + '/' + keyframes.length + ' keyframe(s) extracted from ' + filename);
        return keyframes;
    },
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FrameExtractor;
}
