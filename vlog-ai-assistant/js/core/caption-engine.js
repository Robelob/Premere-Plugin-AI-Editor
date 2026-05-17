/* caption-engine.js — SRT generation and caption track creation
 *
 * Layer flow:
 *   generateSRT(words)      → SRT string
 *   writeSRTToTemp(srt)     → { success, path } to ambar-bridge tmp dir
 *   applyToTimeline(path)   → { success, captionCount } via CEP bridge
 */

const CaptionEngine = {

    // ── Public API ───────────────────────────────────────────────────────

    /**
     * Group word-level timestamps into caption lines and return SRT string.
     * words: [{ word: string, startMs: number, endMs: number }]
     */
    generateSRT(words) {
        if (!words || words.length === 0) return '';

        const maxWords = CONSTANTS.CAPTIONS_MAX_WORDS_PER_LINE || 6;
        const maxChars = CONSTANTS.CAPTIONS_MAX_CHARS_PER_LINE || 42;

        const lines = [];
        let current = [];
        let lineStart = 0;
        let lineEnd = 0;
        let index = 1;

        for (let i = 0; i < words.length; i++) {
            const w = words[i];
            const projected = current.concat(w.word).join(' ');

            // Flush when adding this word would exceed limits
            if (current.length > 0 &&
                (current.length >= maxWords || projected.length > maxChars)) {
                lines.push({
                    index: index++,
                    start: lineStart,
                    end:   lineEnd,
                    text:  current.join(' '),
                });
                current = [];
            }

            if (current.length === 0) lineStart = w.startMs;
            current.push(w.word);
            lineEnd = w.endMs;
        }

        // Flush remaining words
        if (current.length > 0) {
            lines.push({
                index: index++,
                start: lineStart,
                end:   lineEnd,
                text:  current.join(' '),
            });
        }

        const srt = lines.map(function(l) {
            return l.index + '\n' +
                   CaptionEngine._formatSRTTime(l.start) + ' --> ' +
                   CaptionEngine._formatSRTTime(l.end) + '\n' +
                   l.text;
        }).join('\n\n');

        Logger.info('[CaptionEngine] Generated ' + lines.length + ' caption lines');
        return srt;
    },

    /**
     * Write SRT string to the shared ambar-bridge temp directory.
     * Returns { success: true, path } or { success: false, error }.
     */
    async writeSRTToTemp(srtString) {
        try {
            if (typeof require === 'undefined') {
                throw new Error('UXP storage not available (not running inside Premiere)');
            }

            const uxp     = require('uxp');
            const storage = uxp.storage;
            const lfs     = storage.localFileSystem;

            // Use the same temp directory that CEP bridge watches
            const tmpDir = await CaptionEngine._getTmpDir();
            const fmt    = storage.formats && storage.formats.utf8
                           ? { format: storage.formats.utf8 } : {};

            // Try to resolve the ambar-bridge folder
            let folder;
            const url = 'file:///' + tmpDir.replace(/\\/g, '/');
            try {
                folder = await lfs.getEntryWithUrl(url);
            } catch (_) {
                // Dir doesn't exist — create it inside system temp
                const parentUrl = url.replace(/\/ambar-bridge$/, '');
                const parent    = await lfs.getEntryWithUrl(parentUrl);
                folder = await parent.createFolder('ambar-bridge');
            }

            const file = await folder.createFile('ambar_captions.srt', { overwrite: true });
            await file.write(srtString, fmt);

            const path = file.nativePath || (tmpDir + '/ambar_captions.srt');
            Logger.info('[CaptionEngine] SRT written to ' + path);
            return { success: true, path };
        } catch (e) {
            Logger.error('[CaptionEngine] writeSRTToTemp: ' + e.message);
            return { success: false, error: e.message };
        }
    },

    /**
     * Import the SRT into the Premiere project and create a caption track.
     * templateName: key from CONSTANTS.CAPTION_TEMPLATES
     * customMogrtPath: only used when template type === 'mogrt'
     * Returns { success, captionCount } or { success: false, error }.
     */
    async applyToTimeline(srtPath, templateName, customMogrtPath) {
        try {
            Logger.info('[CaptionEngine] Applying to timeline: ' + srtPath +
                        ' template=' + templateName);

            const result = await CEPBridge.sendCommand(
                'importAndCreateCaptionTrack',
                { srtFilePath: srtPath }
            );

            if (!result || !result.success) {
                return { success: false, error: (result && result.error) || 'CEP bridge returned failure' };
            }

            Logger.info('[CaptionEngine] Caption track created — ' + result.clipName);

            if (typeof ProjectMemory !== 'undefined' && ProjectMemory._sequenceId) {
                try { await ProjectMemory.recordCaptions(templateName, 1); } catch (_) {}
            }

            return { success: true, captionCount: 1 };
        } catch (e) {
            Logger.error('[CaptionEngine] applyToTimeline: ' + e.message);
            return { success: false, error: e.message };
        }
    },

    /**
     * Group word timestamps into caption lines.
     * Returns [{ text, startSecs, endSecs }] — used by importCustomMogrt.
     */
    generateLines(words) {
        if (!words || words.length === 0) return [];
        var maxWords = CONSTANTS.CAPTIONS_MAX_WORDS_PER_LINE || 6;
        var maxChars = CONSTANTS.CAPTIONS_MAX_CHARS_PER_LINE || 42;
        var lines    = [];
        var current  = [];
        var lineStart = 0;
        var lineEnd   = 0;

        for (var i = 0; i < words.length; i++) {
            var w         = words[i];
            var projected = current.concat(w.word).join(' ');
            if (current.length > 0 && (current.length >= maxWords || projected.length > maxChars)) {
                lines.push({ text: current.join(' '), startSecs: lineStart / 1000, endSecs: lineEnd / 1000 });
                current = [];
            }
            if (current.length === 0) lineStart = w.startMs;
            current.push(w.word);
            lineEnd = w.endMs;
        }
        if (current.length > 0) {
            lines.push({ text: current.join(' '), startSecs: lineStart / 1000, endSecs: lineEnd / 1000 });
        }
        return lines;
    },

    /**
     * Place one MOGRT instance per caption line on V3 via the CEP bridge.
     * words: [{ word, startMs, endMs }]
     */
    async importCustomMogrt(mogrtFilePath, words) {
        if (!mogrtFilePath) return { success: false, error: 'No .mogrt path provided' };
        if (!words || words.length === 0) return { success: false, error: 'No transcript words for MOGRT placement' };

        var lines  = this.generateLines(words);
        if (!lines.length) return { success: false, error: 'No caption lines generated' };

        var placed = 0;
        var errors = [];

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];
            try {
                var result = await CEPBridge.sendCommand('placeMogrt', {
                    mogrtPath:  mogrtFilePath,
                    text:       line.text,
                    startSecs:  line.startSecs,
                    endSecs:    line.endSecs,
                    trackIndex: 2,
                });
                if (result && result.success) {
                    placed++;
                } else {
                    errors.push('Line ' + (i + 1) + ': ' + ((result && result.error) || 'failed'));
                }
            } catch (e) {
                errors.push('Line ' + (i + 1) + ': ' + e.message);
            }
        }

        Logger.info('[CaptionEngine] importCustomMogrt: ' + placed + '/' + lines.length + ' placed');
        return { success: placed > 0, placed: placed, total: lines.length, errors: errors };
    },

    // ── Private helpers ──────────────────────────────────────────────────

    _formatSRTTime(ms) {
        const h   = Math.floor(ms / 3600000);
        const m   = Math.floor((ms % 3600000) / 60000);
        const s   = Math.floor((ms % 60000) / 1000);
        const ms3 = Math.floor(ms % 1000);

        function pad2(n) { return n < 10 ? '0' + n : String(n); }
        function pad3(n) { return n < 10 ? '00' + n : (n < 100 ? '0' + n : String(n)); }

        return pad2(h) + ':' + pad2(m) + ':' + pad2(s) + ',' + pad3(ms3);
    },

    async _getTmpDir() {
        // Mirror CEPBridge._getTmpDir() — must point to the same directory
        if (typeof process !== 'undefined' && process.env) {
            const sysTemp = process.env.TEMP || process.env.TMP;
            if (sysTemp) {
                const sep = sysTemp.includes('\\') ? '\\' : '/';
                return sysTemp + sep + 'ambar-bridge';
            }
        }
        // Fallback: derive from UXP data folder
        const uxp      = require('uxp');
        const lfs      = uxp.storage.localFileSystem;
        const data     = await lfs.getDataFolder();
        const dataPath = data.nativePath;
        const idx      = dataPath.indexOf('AppData');
        if (idx !== -1) return dataPath.slice(0, idx) + 'AppData\\Local\\Temp\\ambar-bridge';
        return '/tmp/ambar-bridge';
    },
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CaptionEngine;
}
