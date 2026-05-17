/* cep-bridge.js — UXP side of file-based IPC with the CEP bridge panel
 *
 * Communication protocol:
 *   UXP writes  → {tmpDir}/{id}.command.json
 *   CEP writes  → {tmpDir}/{id}.response.json
 *
 * If the bridge is not installed, ping() rejects after BRIDGE_TIMEOUT_MS.
 * Callers must handle that case — the plugin works without the bridge
 * (markers-only mode, no destructive cuts).
 */

const CEPBridge = (() => {
    let _available = null; // null=unknown, true/false after first ping

    // ── Private helpers ──────────────────────────────────────────────────

    async function _getTmpDir() {
        // Must match Folder.temp.fsName used by ExtendScript in host.jsx.
        // On Windows that is %TEMP% (AppData\Local\Temp); on Mac it is /tmp.
        // process.env is available in UXP's Node-like runtime.
        if (typeof process !== 'undefined' && process.env) {
            const sysTemp = process.env.TEMP || process.env.TMP;
            if (sysTemp) {
                const sep = sysTemp.includes('\\') ? '\\' : '/';
                return sysTemp + sep + 'ambar-bridge';
            }
        }
        // Fallback: derive system temp from the UXP data folder path.
        // Data folder shape on Windows:
        //   C:\Users\<user>\AppData\Roaming\Adobe\UXP\...
        // System temp shape on Windows:
        //   C:\Users\<user>\AppData\Local\Temp
        const uxp = require('uxp');
        const fs = uxp.storage.localFileSystem;
        const dataFolder = await fs.getDataFolder();
        const dataPath = dataFolder.nativePath;
        const appDataIdx = dataPath.indexOf('AppData');
        if (appDataIdx !== -1) {
            return dataPath.slice(0, appDataIdx) + 'AppData\\Local\\Temp\\ambar-bridge';
        }
        // Mac fallback
        return '/tmp/ambar-bridge';
    }

    async function _ensureDir(dirPath) {
        const uxp = require('uxp');
        const fs = uxp.storage.localFileSystem;
        try {
            await fs.getEntryWithUrl('file:///' + dirPath.replace(/\\/g, '/'));
        } catch (_e) {
            // Directory doesn't exist — create it
            const parentEntry = await fs.getEntryWithUrl(
                'file:///' + dirPath.replace(/\\/g, '/').replace(/\/ambar-bridge$/, '')
            );
            await parentEntry.createFolder('ambar-bridge');
        }
    }

    async function _writeTempFile(filePath, data) {
        const uxp = require('uxp');
        const fs = uxp.storage.localFileSystem;
        const url = 'file:///' + filePath.replace(/\\/g, '/');

        let fileEntry;
        try {
            fileEntry = await fs.getEntryWithUrl(url);
        } catch (_e) {
            // File doesn't exist — create it in the parent dir
            const slashIdx = filePath.replace(/\\/g, '/').lastIndexOf('/');
            const parentPath = filePath.replace(/\\/g, '/').slice(0, slashIdx);
            const fileName = filePath.replace(/\\/g, '/').slice(slashIdx + 1);
            const parentEntry = await fs.getEntryWithUrl('file:///' + parentPath);
            fileEntry = await parentEntry.createFile(fileName, { overwrite: true });
        }

        await fileEntry.write(JSON.stringify(data), {
            format: uxp.storage.formats.utf8,
        });
    }

    async function _readTempFile(filePath) {
        const uxp = require('uxp');
        const fs = uxp.storage.localFileSystem;
        const url = 'file:///' + filePath.replace(/\\/g, '/');
        const entry = await fs.getEntryWithUrl(url);
        const text = await entry.read({ format: uxp.storage.formats.utf8 });
        return JSON.parse(text);
    }

    function _pollForResponse(responseFilePath, customTimeoutMs) {
        return new Promise((resolve, reject) => {
            const interval = CONSTANTS.BRIDGE_POLL_MS;
            const timeout  = customTimeoutMs || CONSTANTS.BRIDGE_TIMEOUT_MS;
            const maxAttempts = Math.ceil(timeout / interval);
            let attempts = 0;

            const timer = setInterval(async () => {
                attempts++;
                if (attempts > maxAttempts) {
                    clearInterval(timer);
                    reject(new Error('CEP bridge timeout after ' + timeout + 'ms'));
                    return;
                }
                try {
                    const data = await _readTempFile(responseFilePath);
                    clearInterval(timer);
                    resolve(data);
                } catch (_e) {
                    // Response not written yet — keep polling
                }
            }, interval);
        });
    }

    // ── Public API ───────────────────────────────────────────────────────

    async function sendCommand(action, params, timeoutMs) {
        const tmpDir = await _getTmpDir();
        await _ensureDir(tmpDir);

        const id = 'cmd_' + Date.now();
        const sep = tmpDir.includes('\\') ? '\\' : '/';
        const cmdFile      = tmpDir + sep + id + '.command.json';
        const responseFile = tmpDir + sep + id + '.response.json';

        Logger.info('CEPBridge.sendCommand: ' + action + ' [' + id + ']');
        await _writeTempFile(cmdFile, { id, action, params: params || {} });

        const response = await _pollForResponse(responseFile, timeoutMs);
        Logger.info('CEPBridge response: ' + JSON.stringify(response));
        return response;
    }

    async function ping() {
        try {
            const result = await sendCommand('ping', {});
            _available = result && result.success === true;
            return result;
        } catch (e) {
            _available = false;
            Logger.warn('CEPBridge.ping failed: ' + e.message);
            throw e;
        }
    }

    // segments: [{ startSeconds, endSeconds }, ...]
    // Padding is applied here (before sending) per ARCHITECTURE_DECISIONS.md §4
    async function razorAndDelete(segments) {
        if (!Array.isArray(segments) || segments.length === 0) {
            return { success: false, error: 'No segments provided' };
        }

        const PADDING = CONSTANTS.PADDING_SECONDS;
        const MIN_CUT = 0.3; // skip segments too short after padding

        const padded = [];
        for (const seg of segments) {
            const start = seg.startSeconds + PADDING;
            const end   = seg.endSeconds   - PADDING;
            if (end - start < MIN_CUT) {
                Logger.info('CEPBridge: skipping short segment ' +
                    seg.startSeconds.toFixed(2) + 's–' + seg.endSeconds.toFixed(2) + 's after padding');
                continue;
            }
            padded.push({ startSeconds: start, endSeconds: end });
        }

        if (padded.length === 0) {
            return { success: false, error: 'All segments too short after padding' };
        }

        return await sendCommand('razorAndDelete', { segments: padded });
    }

    // markers: [{ timeSeconds, name, comment }, ...]
    async function placeMarkers(markers) {
        if (!Array.isArray(markers) || markers.length === 0) {
            return { success: false, error: 'No markers provided' };
        }
        return await sendCommand('placeMarkers', { markers });
    }

    // Get source file paths for V1 clips via ExtendScript (more reliable than UXP path APIs).
    // Returns { success, sources: [{ path, startSeconds, endSeconds, inPointSeconds }] }
    async function getSourcePaths() {
        return await sendCommand('getSourcePaths', {});
    }

    // Export the active sequence's audio as a low-bitrate MP3 via seq.exportAsMediaDirect().
    // Returns { success, audioPath, sizeBytes } — timestamps from Whisper will be sequence-relative.
    // Uses a 3-minute timeout because export is synchronous in ExtendScript and blocks the bridge.
    async function exportAudio() {
        return await sendCommand('exportAudio', {}, 3 * 60 * 1000);
    }

    function isAvailable() {
        return _available === true;
    }

    return { ping, sendCommand, razorAndDelete, placeMarkers, getSourcePaths, exportAudio, isAvailable };
})();
