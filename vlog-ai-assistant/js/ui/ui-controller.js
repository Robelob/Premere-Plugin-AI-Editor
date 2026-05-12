/* ui-controller.js - UI event handlers and rendering */

const UIController = {

    _pollInterval: null,

    init() {
        Logger.info('Initializing UI Controller');
        this.restoreSettings();
        this.updateStatus('ready', 'READY');
        this._setupEventBasedDetection();
        this.refreshSequences();
        this._startSequencePoll();
    },

    _setupEventBasedDetection() {
        if (!PremiereAPI.isAvailable()) return;
        var self = this;
        var ok = PremiereAPI.setupEventListeners(async function(sequence) {
            // UXP proxy properties require await — fetch name and id async
            var seqName = null;
            var seqId   = null;
            try { seqName = await sequence.name;       } catch (_) {}
            try { seqId   = await sequence.sequenceID; } catch (_) {}
            if (!seqName) { try { seqId = await sequence.id; } catch (_) {} }

            Logger.info('UIController: sequence activated — name=' + seqName + ' id=' + (seqId || '?'));

            // Cache the async-resolved values back onto the object for sync use downstream
            try {
                if (seqName && !sequence._resolvedName) sequence._resolvedName = seqName;
                if (seqId   && !sequence._resolvedId)   sequence._resolvedId   = seqId;
            } catch (_) {}

            self.refreshSequences();
            self.updateStatus('ready', 'READY · ' + (seqName || 'Sequence detected'));
        });
        if (ok) Logger.info('Event-based sequence detection armed');
        else Logger.warn('Event-based detection unavailable — relying on poll');
    },

    _startSequencePoll() {
        if (this._pollInterval) return;
        var self = this;
        var pollCount = 0;
        // Poll every 10 seconds — catches when user opens a sequence in PPro timeline
        this._pollInterval = setInterval(function() {
            try {
                var select = document.getElementById('sequenceSelect');
                if (!select) return;
                var currentVal = select.value;
                var hasSeq = currentVal && currentVal !== '' && select.options.length >= 1;
                if (hasSeq) return; // already have a sequence, stop polling silently

                pollCount++;
                // Every 6th poll (60 seconds), try the async method as it might work
                if (pollCount % 6 === 0) {
                    PremiereAPI.getActiveSequenceAsync().then(function(seq) {
                        if (seq) self.refreshSequences();
                    }).catch(function() {});
                }

                // Try sync refresh — no warn logging since it's expected to fail
                var active = PremiereAPI.getActiveSequence();
                if (active) self.refreshSequences();
            } catch (e) { /* silent */ }
        }, 10000);
    },

    // ── Internal helpers ─────────────────────────────────────────────

    _getApiKey() {
        const el = document.getElementById('apiKeyInput');
        return (el ? el.value.trim() : '') || UIState.getSettings().apiKey || '';
    },

    // ── Tab switching ─────────────────────────────────────────────────

    switchTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });
        document.querySelectorAll('.panel-content').forEach(panel => {
            panel.classList.toggle('active', panel.id === 'panel-' + tabName);
        });
    },

    // ── Sequence selector ─────────────────────────────────────────────

    refreshSequences() {
        const select = document.getElementById('sequenceSelect');
        if (!select) return;

        // ── Diagnostic checks before calling the API ──────────────────
        if (!PremiereAPI.isAvailable()) {
            select.innerHTML = '<option value="">── Load plugin inside Premiere Pro ──</option>';
            this.updateStatus('error', 'NO PREMIERE CONTEXT');
            Logger.warn('premierepro module unavailable — not running inside Premiere Pro');
            return;
        }

        if (!PremiereAPI.getActiveProject()) {
            select.innerHTML = '<option value="">── No project open ──</option>';
            this.updateStatus('ready', 'OPEN A PROJECT');
            Logger.warn('No active project — open a Premiere project first');
            return;
        }

        // ── Load sequences ────────────────────────────────────────────
        try {
            const sequences = PremiereAPI.getAllSequences();
            select.innerHTML = '';

            if (sequences.length === 0) {
                select.innerHTML = '<option value="">── No sequence detected ──</option>';
                this.updateStatus('ready', 'OPEN A SEQUENCE');
                const hint = document.getElementById('seqHint');
                if (hint) hint.style.display = 'block';
                Logger.warn('No sequences found — trying active sequence on analysis');
                return;
            }
            const hint = document.getElementById('seqHint');
            if (hint) hint.style.display = 'none';

            sequences.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = s.name;
                select.appendChild(opt);
            });

            // Pre-select the currently active sequence in Premiere
            let selectedId = null;
            try {
                const active = PremiereAPI.getActiveSequence();
                if (active) selectedId = active.sequenceID || active._resolvedId || active.id;
            } catch (_) {}

            if (selectedId) {
                select.value = selectedId;
            } else {
                selectedId = sequences[0].id;
                select.value = selectedId;
            }

            UIState.setState('selectedSequenceId', selectedId);
            this.updateStatus('ready', 'READY');
            Logger.info('Loaded ' + sequences.length + ' sequence(s), selected: ' + selectedId);
        } catch (e) {
            Logger.error('Error refreshing sequences', e);
            select.innerHTML = '<option value="">── Error — check DevTools console ──</option>';
        }
    },

    onSequenceChange() {
        const select = document.getElementById('sequenceSelect');
        const sequenceId = select ? select.value : '';
        if (!sequenceId) return;

        UIState.setState('selectedSequenceId', sequenceId);

        const seq = PremiereAPI.getSequenceById(sequenceId);
        if (seq) {
            PremiereAPI.openSequence(seq);
            this.updateStatus('ready', 'READY · ' + seq.name);
        }
    },

    // ── Range input display ───────────────────────────────────────────

    updateRangeDisplay(id, value, unit) {
        const display = document.getElementById(id + '-val');
        if (!display) return;
        const num = parseFloat(value);
        // For confidence show 2 decimals, otherwise integer
        const formatted = (unit === '') ? num.toFixed(2) : Math.round(num);
        display.textContent = formatted + unit;
    },

    // ── API key ───────────────────────────────────────────────────────

    onApiKeyInput() {
        // Auto-save API key as user types (debounce via no timeout — just keep fresh)
        const key = this._getApiKey();
        UIState.updateSetting('apiKey', key);
        if (key) GeminiService.initialize(key);
    },

    toggleApiKeyVisibility() {
        const input = document.getElementById('apiKeyInput');
        const btn   = document.getElementById('toggleKeyBtn');
        if (!input) return;
        const isHidden = input.type === 'password';
        input.type = isHidden ? 'text' : 'password';
        if (btn) btn.textContent = isHidden ? '🙈' : '👁';
    },

    // ── Main analysis flows ───────────────────────────────────────────

    async analyzeSilence() {
        Logger.info('Starting silence analysis');

        // Try sync first, then async
        let sequence = PremiereAPI.getActiveSequence();
        if (!sequence) {
            this.showLoading('Detecting sequence…');
            sequence = await PremiereAPI.getActiveSequenceAsync();
        }
        if (!sequence) {
            this.hideLoading();
            this.showError('No active sequence found. Open a sequence in Premiere\'s timeline and try again.');
            return;
        }

        const thresholdEl = document.getElementById('silenceThreshold');
        const threshold = thresholdEl ? thresholdEl.value : -50;
        const durationEl = document.getElementById('minSilenceDuration');
        const duration  = durationEl ? durationEl.value : 500;

        if (!Validators.isValidSilenceThreshold(threshold)) {
            this.showError('Threshold must be between -80 and -10 dB.');
            return;
        }
        if (!Validators.isValidMinDuration(duration)) {
            this.showError('Duration must be between 100 and 2000 ms.');
            return;
        }

        const apiKey = this._getApiKey();
        if (!Validators.isValidApiKey(apiKey)) {
            this.showError('No API key — add your Gemini key in the Config tab.');
            return;
        }

        UIState.updateSetting('silenceThreshold', parseFloat(threshold));
        UIState.updateSetting('minSilenceDuration', parseInt(duration, 10));
        this.showLoading('Reading timeline…');

        try {
            const metadata = ProjectReader.readProjectMetadata();
            if (!metadata) {
                this.showError('Could not read project metadata. Is a sequence open?');
                this.hideLoading();
                return;
            }

            this.showLoading('Analyzing with Gemini AI…');
            GeminiService.initialize(apiKey);

            const raw    = await GeminiService.analyzeSilence(ProjectReader.formatForAPI(metadata), parseFloat(threshold), parseInt(duration, 10));
            const parsed = ResponseParser.parseSilenceResponse(raw);

            if (!parsed || !parsed.segments.length) {
                this.showError('No silence segments found. Try lowering the threshold.');
                this.hideLoading();
                return;
            }

            this.hideLoading();
            this.displayResults({ type: 'silence', ...parsed });
            Logger.info(`Silence analysis done — ${parsed.segments.length} segments`);
        } catch (error) {
            Logger.error('Silence analysis failed', error);
            this.showError(ErrorHandler.handleAPIError(error).userMessage);
        }
    },

    async detectBroll() {
        Logger.info('Starting B-roll detection');

        let sequence = PremiereAPI.getActiveSequence();
        if (!sequence) {
            this.showLoading('Detecting sequence…');
            sequence = await PremiereAPI.getActiveSequenceAsync();
        }
        if (!sequence) {
            this.hideLoading();
            this.showError('No active sequence found. Open a sequence in Premiere\'s timeline and try again.');
            return;
        }

        const confidenceEl = document.getElementById('confidenceThreshold');
        const confidence = confidenceEl ? confidenceEl.value : 0.7;
        if (!Validators.isValidConfidence(confidence)) {
            this.showError('Confidence must be between 0.5 and 0.95.');
            return;
        }

        const apiKey = this._getApiKey();
        if (!Validators.isValidApiKey(apiKey)) {
            this.showError('No API key — add your Gemini key in the Config tab.');
            return;
        }

        UIState.updateSetting('confidenceThreshold', parseFloat(confidence));
        this.showLoading('Reading timeline…');

        try {
            const metadata = ProjectReader.readProjectMetadata();
            if (!metadata) {
                this.showError('Could not read project metadata. Is a sequence open?');
                this.hideLoading();
                return;
            }

            this.showLoading('Analyzing with Gemini AI…');
            GeminiService.initialize(apiKey);

            const raw    = await GeminiService.detectBroll(ProjectReader.formatForAPI(metadata), parseFloat(confidence));
            const parsed = ResponseParser.parseBrollResponse(raw);

            if (!parsed || !parsed.opportunities.length) {
                this.showError('No B-roll opportunities found. Try lowering the confidence threshold.');
                this.hideLoading();
                return;
            }

            this.hideLoading();
            this.displayResults({ type: 'broll', ...parsed });
            Logger.info(`B-roll detection done — ${parsed.opportunities.length} opportunities`);
        } catch (error) {
            Logger.error('B-roll detection failed', error);
            this.showError(ErrorHandler.handleAPIError(error).userMessage);
        }
    },

    applyEdits() {
        const results = UIState.getState('results');
        if (!results) { this.showError('No results to apply.'); return; }

        this.showLoading('Adding markers to timeline…');

        try {
            let editResult;
            if (results.type === 'silence') {
                editResult = TimelineEditor.markSilenceSegments(results.segments);
            } else if (results.type === 'broll') {
                editResult = TimelineEditor.markBrollOpportunities(results.opportunities);
            }

            this.hideLoading();

            if (editResult && editResult.success) {
                this.updateStatus('success', `${editResult.marked} MARKERS ADDED`);
                UIState.reset();
                this.hideResults();
            } else {
                this.showError('Some markers could not be applied. Check the sequence is not locked.');
            }
        } catch (error) {
            Logger.error('Apply edits failed', error);
            this.hideLoading();
            this.showError('Failed to apply edits: ' + error.message);
        }
    },

    discardResults() {
        UIState.reset();
        this.hideResults();
        this.updateStatus('ready', 'READY');
    },

    runDiagnostic() {
        const out = document.getElementById('diagnosticOut');
        if (!out) return;

        const lines = [];
        const ok  = (msg) => lines.push('✓ ' + msg);
        const err = (msg) => lines.push('<span class="diag-err">✗ ' + msg + '</span>');
        const wrn = (msg) => lines.push('<span class="diag-warn">⚠ ' + msg + '</span>');

        // ── 1. Check require('premierepro') ──────────────────────────
        let ppro = null;
        try {
            ppro = require('premierepro');
            ok('require("premierepro") succeeded');
            ok('  exports: ' + Object.keys(ppro).join(', '));
        } catch (e) {
            err('require("premierepro") FAILED: ' + e.message);
            err('  Plugin must be loaded via UXP Developer Tool into Premiere Pro');
        }

        // ── 2. Check legacy global app ───────────────────────────────
        if (typeof app !== 'undefined') {
            ok('Legacy global app also exists (version: ' + (app.version || '?') + ')');
        } else {
            wrn('Global app is undefined (expected in UXP — using require instead)');
        }

        // ── 3. Project object ────────────────────────────────────────
        if (ppro) {
            let project = null;
            try {
                project = ppro.Project.getActiveProject();
                if (project) ok('Project.getActiveProject() → "' + (project.name || '(unnamed)') + '"');
                else         err('Project.getActiveProject() returned null');
            } catch (e) { err('Project error: ' + e.message); }

            if (project) {
                // Show all keys on the project object so we know exact method names
                try {
                    const keys = [];
                    for (const k in project) keys.push(k);
                    // Also own properties
                    Object.getOwnPropertyNames(project).forEach(k => { if (!keys.includes(k)) keys.push(k); });
                    ok('project keys: ' + (keys.length ? keys.join(', ') : '(none — prototype only)'));
                } catch (e) { wrn('Could not enumerate project keys: ' + e.message); }

                // Try every plausible pattern to get active sequence
                const seqAttempts = [
                    () => project.activeSequence,
                    () => project.getActiveSequence && project.getActiveSequence(),
                    () => project.getSequence && project.getSequence(),
                    () => ppro.Sequence && ppro.Sequence.getActiveSequence && ppro.Sequence.getActiveSequence(),
                    () => ppro.SequenceEditor && ppro.SequenceEditor.getActiveSequence && ppro.SequenceEditor.getActiveSequence(),
                ];
                let foundSeq = false;
                seqAttempts.forEach((fn, i) => {
                    try {
                        const s = fn();
                        if (s && s.name) { ok('Sequence attempt #' + i + ' → "' + s.name + '" id=' + s.sequenceID); foundSeq = true; }
                        else wrn('Sequence attempt #' + i + ' → ' + JSON.stringify(s));
                    } catch (e) { wrn('Seq attempt #' + i + ' threw: ' + e.message); }
                });
                if (!foundSeq) err('All sequence access attempts returned null/undefined');

                // Try rootItem via property and method
                try {
                    const r1 = project.rootItem;
                    if (r1) ok('project.rootItem → type=' + r1.type + ' name=' + r1.name);
                    else    wrn('project.rootItem is null/undefined');
                } catch (e) { wrn('project.rootItem threw: ' + e.message); }
                try {
                    const r2 = typeof project.getRootItem === 'function' ? project.getRootItem() : null;
                    if (r2) ok('project.getRootItem() → type=' + r2.type + ' name=' + r2.name);
                    else    wrn('project.getRootItem() → null (or method missing)');
                } catch (e) { wrn('project.getRootItem() threw: ' + e.message); }
            }

            // ── 4. Sequence class ──────────────────────────────────────
            if (ppro.Sequence) {
                try {
                    const skeys = [];
                    for (const k in ppro.Sequence) skeys.push(k);
                    Object.getOwnPropertyNames(ppro.Sequence).forEach(function(k) { if (skeys.indexOf(k) === -1) skeys.push(k); });
                    ok('ppro.Sequence keys: ' + (skeys.length ? skeys.join(', ') : '(none — prototype only)'));
                    // Try as a collection
                    const numSeq = ppro.Sequence.numSequences;
                    if (numSeq !== undefined) {
                        ok('ppro.Sequence.numSequences = ' + numSeq);
                        for (let i = 0; i < numSeq; i++) {
                            try { const s = ppro.Sequence[i]; ok('  Sequence[' + i + ']: ' + (s ? s.name : 'null')); } catch (se) { wrn('  Sequence[' + i + ']: threw ' + se.message); }
                        }
                    } else wrn('ppro.Sequence.numSequences = undefined');
                } catch (e) { wrn('Sequence check threw: ' + e.message); }
            } else wrn('ppro.Sequence is not defined');

            // ── 5. SequenceEditor ──────────────────────────────────────
            if (ppro.SequenceEditor) {
                try {
                    const seKeys = [];
                    for (const k in ppro.SequenceEditor) seKeys.push(k);
                    Object.getOwnPropertyNames(ppro.SequenceEditor).forEach(function(k) { if (seKeys.indexOf(k) === -1) seKeys.push(k); });
                    ok('ppro.SequenceEditor keys: ' + (seKeys.length ? seKeys.join(', ') : '(none — prototype only)'));

                    // Try every plausible SequenceEditor accessor
                    ['getActiveSequence', 'getSequence', 'getSequences', 'sequence', 'activeSequence'].forEach(function(name) {
                        try {
                            const val = typeof ppro.SequenceEditor[name] === 'function' ? ppro.SequenceEditor[name]() : ppro.SequenceEditor[name];
                            if (val && val.name) ok('  SequenceEditor.' + name + ' → "' + val.name + '"');
                            else wrn('  SequenceEditor.' + name + ' → ' + JSON.stringify(val));
                        } catch (se) { wrn('  SequenceEditor.' + name + ' threw: ' + se.message); }
                    });
                } catch (e) { wrn('SequenceEditor check threw: ' + e.message); }
            } else wrn('ppro.SequenceEditor is not defined');

            // ── 6. SequenceEvent + eventRoot (NEW — the correct event system) ──
            if (ppro.SequenceEvent) {
                try {
                    const seqEvKeys = [];
                    for (const k in ppro.SequenceEvent) seqEvKeys.push(k + '=' + ppro.SequenceEvent[k]);
                    Object.getOwnPropertyNames(ppro.SequenceEvent).forEach(function(k) {
                        if (!seqEvKeys.find(function(x) { return x.startsWith(k + '='); })) seqEvKeys.push(k + '=' + ppro.SequenceEvent[k]);
                    });
                    ok('ppro.SequenceEvent: ' + (seqEvKeys.length ? seqEvKeys.join(', ') : '(no keys)'));
                } catch (e) { wrn('SequenceEvent check threw: ' + e.message); }
            } else wrn('ppro.SequenceEvent NOT exported (unexpected)');

            if (ppro.eventRoot) {
                try {
                    const erKeys = [];
                    for (const k in ppro.eventRoot) erKeys.push(k);
                    ok('ppro.eventRoot exists — keys: ' + (erKeys.length ? erKeys.join(', ') : '(no own keys — EventTarget prototype)'));
                } catch (e) { wrn('eventRoot check threw: ' + e.message); }
            } else wrn('ppro.eventRoot NOT exported');

            if (ppro.ProjectEvent) {
                try {
                    const projEvKeys = [];
                    for (const k in ppro.ProjectEvent) projEvKeys.push(k + '=' + ppro.ProjectEvent[k]);
                    ok('ppro.ProjectEvent: ' + (projEvKeys.length ? projEvKeys.join(', ') : '(no keys)'));
                } catch (e) { wrn('ProjectEvent check threw: ' + e.message); }
            }

            if (ppro.SourceMonitor) {
                try {
                    const smKeys = [];
                    for (const k in ppro.SourceMonitor) smKeys.push(k);
                    Object.getOwnPropertyNames(ppro.SourceMonitor).forEach(function(k) { if (smKeys.indexOf(k) === -1) smKeys.push(k); });
                    ok('ppro.SourceMonitor keys: ' + (smKeys.length ? smKeys.join(', ') : '(no own keys)'));
                    if (typeof ppro.SourceMonitor.getActiveSequence === 'function') {
                        const smSeq = ppro.SourceMonitor.getActiveSequence();
                        smSeq && smSeq.name ? ok('SourceMonitor.getActiveSequence() → "' + smSeq.name + '"') : wrn('SourceMonitor.getActiveSequence() → ' + JSON.stringify(smSeq));
                    }
                } catch (e) { wrn('SourceMonitor check threw: ' + e.message); }
            }
        }

        // ── 7. Async probe (runs in background, updates panel) ────────
        wrn('Running async probe — results appear below in ~2s...');
        const self = this;
        (async function() {
            const asyncLines = [];
            const aok  = function(m) { asyncLines.push('✓ [async] ' + m); };
            const awrn = function(m) { asyncLines.push('<span class="diag-warn">⚠ [async] ' + m + '</span>'); };

            try {
                const p = ppro && ppro.Project ? ppro.Project.getActiveProject() : null;
                if (p) {
                    try { const s = await p.activeSequence;       s && s.name ? aok('await project.activeSequence → "' + s.name + '"')        : awrn('await project.activeSequence → ' + JSON.stringify(s)); } catch(e) { awrn('await project.activeSequence threw: ' + e.message); }
                    try { const s = typeof p.getActiveSequence === 'function' ? await p.getActiveSequence() : null; s && s.name ? aok('await project.getActiveSequence() → "' + s.name + '"') : awrn('await project.getActiveSequence() → ' + JSON.stringify(s)); } catch(e) { awrn('await project.getActiveSequence() threw: ' + e.message); }
                    try { const s = await p.sequences;           awrn('await project.sequences → ' + (s ? JSON.stringify(s) : 'null')); } catch(e) { awrn('await project.sequences threw: ' + e.message); }
                }
                if (ppro && ppro.SequenceEditor) {
                    try { const s = typeof ppro.SequenceEditor.getActiveSequence === 'function' ? await ppro.SequenceEditor.getActiveSequence() : null; s && s.name ? aok('await SequenceEditor.getActiveSequence() → "' + s.name + '"') : awrn('await SequenceEditor.getActiveSequence() → ' + JSON.stringify(s)); } catch(e) { awrn('await SequenceEditor.getActiveSequence() threw: ' + e.message); }
                    try { const s = await ppro.SequenceEditor.sequence; s && s.name ? aok('await SequenceEditor.sequence → "' + s.name + '"') : awrn('await SequenceEditor.sequence → ' + JSON.stringify(s)); } catch(e) { awrn('await SequenceEditor.sequence threw: ' + e.message); }
                }
                if (ppro && ppro.Sequence && typeof ppro.Sequence.queryCast === 'function' && p) {
                    try { const cast = ppro.Sequence.queryCast(p); cast && cast.name ? aok('Sequence.queryCast(project) → "' + cast.name + '"') : awrn('Sequence.queryCast(project) → ' + JSON.stringify(cast)); } catch(e) { awrn('Sequence.queryCast threw: ' + e.message); }
                }
                if (ppro && ppro.SequenceEditor && typeof ppro.SequenceEditor.queryCast === 'function' && p) {
                    try { const cast = ppro.SequenceEditor.queryCast(p); awrn('SequenceEditor.queryCast(project) → ' + (cast ? JSON.stringify(Object.keys(cast)) : 'null')); } catch(e) { awrn('SequenceEditor.queryCast threw: ' + e.message); }
                }
            } catch(e) { awrn('Async probe error: ' + e.message); }

            // Append async results to the diagnostic panel
            try {
                var el = document.getElementById('diagnosticOut');
                if (el) el.innerHTML += '\n' + asyncLines.join('\n');
            } catch(_) {}
        })();

        // ── 9. Event listener status ──────────────────────────────────
        ok('Event listeners registered: ' + (PremiereAPI._eventListenersSetup ? 'YES' : 'NO'));
        if (PremiereAPI._activeSequence) {
            var capSeq = PremiereAPI._activeSequence;
            ok('Captured sequence: name="' + capSeq.name + '" id=' + (capSeq.id || capSeq.sequenceID || '?'));
            // Show all keys on the captured sequence (incl prototype)
            try {
                var seqKeys = [];
                for (var sk in capSeq) { try { seqKeys.push(sk); } catch(_) {} }
                ok('  seq keys: ' + (seqKeys.length ? seqKeys.join(', ') : '(none)'));
            } catch (_) {}
            // Test queryCast(capSeq) — might give full Sequence interface
            try {
                var cast3 = ppro && ppro.Sequence && typeof ppro.Sequence.queryCast === 'function' ? ppro.Sequence.queryCast(capSeq) : null;
                cast3 ? ok('  queryCast(capSeq) → ' + typeof cast3 + ' keys: ' + Object.keys(cast3).join(', ')) : wrn('  queryCast(capSeq) → null');
            } catch (ce) { wrn('  queryCast(capSeq) threw: ' + ce.message); }
            // Sync property/method test
            ['videoTracks','audioTracks','duration','end','markers','getVideoTracks','getAudioTracks','getDuration'].forEach(function(p) {
                try {
                    var v = capSeq[p];
                    if (typeof v === 'function') ok('  seq.' + p + ' is a function');
                    else if (v !== undefined && v !== null) ok('  seq.' + p + ' = ' + typeof v);
                    else wrn('  seq.' + p + ' → null/undefined');
                } catch (pe) { wrn('  seq.' + p + ' threw: ' + pe.message); }
            });
            // Async property/method test
            (async function() {
                var alines = [];
                var props = ['videoTracks','audioTracks','duration','end','markers','getVideoTracks','getAudioTracks'];
                for (var ai = 0; ai < props.length; ai++) {
                    var ap = props[ai];
                    try {
                        var raw = capSeq[ap];
                        var v2 = typeof raw === 'function' ? await raw.call(capSeq) : await raw;
                        if (v2 !== undefined && v2 !== null) {
                            var desc = typeof v2;
                            if (v2 && v2.numTracks !== undefined) desc += ' numTracks=' + v2.numTracks;
                            if (v2 && v2.seconds !== undefined) desc += ' seconds=' + v2.seconds;
                            if (typeof v2 === 'number') desc = String(v2);
                            alines.push('  ⚡ await seq.' + ap + ' → ' + desc);
                        } else {
                            alines.push('  ⚡ await seq.' + ap + ' → undefined/null');
                        }
                    } catch (ae) { alines.push('  ⚡ await seq.' + ap + ' threw: ' + ae.message); }
                }
                try { var el3 = document.getElementById('diagnosticOut'); if (el3) el3.innerHTML += '\n' + alines.join('\n'); } catch(_) {}
            })();
        } else {
            wrn('No sequence captured via events yet — open/click a sequence in PPro timeline');
        }

        // ── 10. API key ──────────────────────────────────────────────
        const key = this._getApiKey();
        if (!key) wrn('No API key — add it in the Config tab');
        else ok('API key: ' + key.slice(0, 8) + '… (' + key.length + ' chars)');

        out.innerHTML = lines.join('\n');
        out.style.display = 'block';
        Logger.info('Diagnostic ran — ' + lines.length + ' checks');
    },

    toggleDebugMode() {
        const cb = document.getElementById('enableDebug');
        const on = cb ? cb.checked : false;
        UIState.setState('debugEnabled', on);
        CONSTANTS.DEBUG = on;
        Logger.info('Debug mode: ' + (on ? 'ON' : 'OFF'));
    },

    // ── Results rendering ─────────────────────────────────────────────

    displayResults(results) {
        UIState.setResults(results);
        const section = document.getElementById('resultsSection');
        const list    = document.getElementById('resultsList');
        if (!section || !list) return;

        let html = '';

        if (results.type === 'silence' && Array.isArray(results.segments)) {
            html += `<div class="results-summary">${results.segments.length} segments · ${results.estimatedTimeSavings || '—'} savings</div>`;
            html += '<div class="results-items">';
            results.segments.forEach((seg, i) => {
                const s   = (seg.start / 1000).toFixed(1);
                const e   = (seg.end   / 1000).toFixed(1);
                const pct = Math.round(seg.confidence * 100);
                html += `<div class="results-item">
                    <span class="item-index">#${i + 1}</span>
                    <span class="item-time">${s}s – ${e}s</span>
                    <span class="item-suggestion"></span>
                    <span class="badge">${pct}%</span>
                </div>`;
            });
            html += '</div>';

        } else if (results.type === 'broll' && Array.isArray(results.opportunities)) {
            html += `<div class="results-summary">${results.opportunities.length} opportunities detected</div>`;
            html += '<div class="results-items">';
            results.opportunities.forEach((opp, i) => {
                const sec  = (opp.timestamp / 1000).toFixed(1);
                const pct  = Math.round(opp.confidence * 100);
                const sugg = opp.suggestion || opp.type || '';
                html += `<div class="results-item">
                    <span class="item-index">#${i + 1}</span>
                    <span class="item-time">@ ${sec}s</span>
                    <span class="item-suggestion">${sugg}</span>
                    <span class="badge">${pct}%</span>
                </div>`;
            });
            html += '</div>';
        }

        list.innerHTML = html;
        section.style.display = 'block';
        this.updateStatus('success', 'ANALYSIS COMPLETE');
    },

    hideResults() {
        const el = document.getElementById('resultsSection');
        if (el) el.style.display = 'none';
    },

    // ── Loading / status / error ──────────────────────────────────────

    showLoading(message) {
        UIState.setLoading(true);
        const overlay = document.getElementById('loadingIndicator');
        const text    = document.getElementById('loadingText');
        const errBar  = document.getElementById('errorMessage');
        if (overlay) overlay.style.display = 'flex';
        if (text)    text.textContent = (message || 'Analyzing…').toUpperCase();
        if (errBar)  errBar.style.display = 'none';
        this.updateStatus('analyzing', 'ANALYZING…');
    },

    hideLoading() {
        UIState.setLoading(false);
        const overlay = document.getElementById('loadingIndicator');
        if (overlay) overlay.style.display = 'none';
    },

    showError(message) {
        this.hideLoading();
        UIState.setError(message);
        const bar  = document.getElementById('errorMessage');
        const text = document.getElementById('errorText');
        if (bar && text) {
            text.textContent = message;
            bar.style.display = 'flex';
        }
        this.updateStatus('error', 'ERROR');
    },

    updateStatus(status, message) {
        UIState.setStatus(status, message);
        const pill = document.getElementById('statusIndicator');
        const text = document.getElementById('statusText');
        if (pill) pill.className = `status-pill status-${status}`;
        if (text) text.textContent = message || status.toUpperCase();
    },

    // ── Settings persistence ──────────────────────────────────────────

    saveSettings() {
        try {
            const apiKey = this._getApiKey();
            UIState.updateSetting('apiKey', apiKey);
            localStorage.setItem('pluginSettings', JSON.stringify(UIState.getSettings()));
            if (apiKey) GeminiService.initialize(apiKey);
            this.updateStatus('success', 'SETTINGS SAVED');
            setTimeout(() => this.updateStatus('ready', 'READY'), 2000);
            Logger.debug('Settings saved');
        } catch (e) {
            Logger.error('Failed to save settings', e);
        }
    },

    restoreSettings() {
        try {
            const saved = localStorage.getItem('pluginSettings');
            if (!saved) return;
            const settings = JSON.parse(saved);

            for (const [key, value] of Object.entries(settings)) {
                UIState.updateSetting(key, value);

                // Restore slider/range values + their display labels
                const rangeEl = document.getElementById(key);
                if (rangeEl && rangeEl.type === 'range') {
                    rangeEl.value = value;
                    const unit = key === 'silenceThreshold' ? ' dB'
                               : key === 'minSilenceDuration' ? ' ms' : '';
                    this.updateRangeDisplay(key, value, unit);
                }

                // Restore text inputs (API key)
                const textEl = document.getElementById(key + 'Input') || document.getElementById(key);
                if (textEl && textEl.tagName === 'INPUT' && textEl.type !== 'range') {
                    textEl.value = value;
                }
            }

            if (settings.apiKey && Validators.isValidApiKey(settings.apiKey)) {
                GeminiService.initialize(settings.apiKey);
            }

            Logger.debug('Settings restored');
        } catch (e) {
            Logger.error('Failed to restore settings', e);
        }
    },
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIController;
}
