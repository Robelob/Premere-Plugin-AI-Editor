/* capabilities.js — Detect available APIs at startup
 * 
 * Runs once on panel load, caches results, and prevents repeated error logging
 * for APIs that are unavailable in this PPro/UXP build.
 * 
 * Provides: Capabilities.hasAudioContext, hasSequenceEditor, hasCEPBridge
 */

const Capabilities = (() => {
    let _detected = false;
    let _audioContext = null;
    let _sequenceEditor = null;
    let _cepBridge = null;

    return {
        // ── Synchronous detection (run once at module load) ──────────────────

        detectSync() {
            if (_detected) return;
            _detected = true;

            // Check AudioContext availability in all known globals
            _audioContext = (typeof AudioContext !== 'undefined' && AudioContext)
                         || (typeof webkitAudioContext !== 'undefined' && webkitAudioContext)
                         || (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext))
                         || (typeof globalThis !== 'undefined' && (globalThis.AudioContext || globalThis.webkitAudioContext))
                         || null;

            Logger.info('[Capabilities] AudioContext: ' + (!!_audioContext ? 'available' : 'NOT FOUND'));

            // Check SequenceEditor availability (requires ppro to be loaded)
            try {
                const ppro = require('premierepro');
                if (ppro && ppro.SequenceEditor && typeof ppro.SequenceEditor.createForSequence === 'function') {
                    _sequenceEditor = true;
                    Logger.info('[Capabilities] SequenceEditor.createForSequence: available');
                } else {
                    _sequenceEditor = false;
                    Logger.warn('[Capabilities] SequenceEditor.createForSequence: NOT AVAILABLE (PPro version < 25.5 or API not exposed)');
                }
            } catch (e) {
                _sequenceEditor = false;
                Logger.debug('[Capabilities] SequenceEditor check failed: ' + e.message);
            }

            // CEP Bridge availability will be determined later by ping()
            // (it's asynchronous and may not be installed)
            _cepBridge = null;
        },

        // ── Async CEP Bridge detection ─────────────────────────────────────

        async detectCEPBridge() {
            if (_cepBridge !== null) return _cepBridge; // cached
            try {
                const result = await CEPBridge.ping();
                _cepBridge = !!(result && result.success);
                Logger.info('[Capabilities] CEP Bridge: ' + (_cepBridge ? 'available' : 'NOT RESPONDING'));
            } catch (e) {
                _cepBridge = false;
                Logger.info('[Capabilities] CEP Bridge: NOT INSTALLED (' + e.message + ')');
            }
            return _cepBridge;
        },

        // ── Cached accessors ──────────────────────────────────────────────

        get hasAudioContext() {
            if (!_detected) this.detectSync();
            return !!_audioContext;
        },

        get audioContextConstructor() {
            if (!_detected) this.detectSync();
            return _audioContext;
        },

        get hasSequenceEditor() {
            if (!_detected) this.detectSync();
            return _sequenceEditor === true;
        },

        get hasCEPBridge() {
            return _cepBridge === true;
        },

        // ── Diagnostic summary ───────────────────────────────────────────────

        diagnosticSummary() {
            if (!_detected) this.detectSync();
            return {
                audioContext:  !!_audioContext,
                sequenceEditor: _sequenceEditor === true,
                cepBridge:     _cepBridge === true,
                mode: _audioContext && _sequenceEditor
                    ? 'NATIVE_FULLSTACK'
                    : !_audioContext && _sequenceEditor
                    ? 'PARTIAL_NO_AUDIO_CONTEXT'
                    : _audioContext && !_sequenceEditor
                    ? 'PARTIAL_NO_SEQUENCE_EDITOR'
                    : _audioContext && _cepBridge
                    ? 'CEP_BRIDGE_ONLY_WITH_AC'
                    : _cepBridge
                    ? 'CEP_BRIDGE_ONLY'
                    : 'DEGRADED_NO_APIS',
            };
        },

        logDiagnostics() {
            const diag = this.diagnosticSummary();
            Logger.info('[Capabilities] Startup diagnostics:');
            Logger.info('  AudioContext: ' + (diag.audioContext ? '✓' : '✗'));
            Logger.info('  SequenceEditor: ' + (diag.sequenceEditor ? '✓' : '✗'));
            Logger.info('  CEP Bridge: ' + (diag.cepBridge ? '✓' : '✗'));
            Logger.info('  Mode: ' + diag.mode);
        },
    };
})();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Capabilities;
}
