/* ui-controller.js - UI event handlers and rendering */

const UIController = {

    _pollInterval: null,

    init() {
        Logger.info('Initializing UI Controller');
        this.restoreSettings();
        this._updateProviderUI(this._getProvider());
        this.updateStatus('ready', 'READY');
        this._initRangeDisplays();
        this._setupEventBasedDetection();
        this.refreshSequences();
        this._startSequencePoll();
    },

    _initRangeDisplays() {
        var ranges = document.querySelectorAll('input[type="range"]');
        for (var i = 0; i < ranges.length; i++) {
            var el = ranges[i];
            var unit = el.id === 'silenceThreshold' ? ' dB'
                     : el.id === 'minSilenceDuration' ? ' ms' : '';
            this.updateRangeDisplay(el.id, el.value, unit);
        }
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

    _getBaseUrl() {
        const el = document.getElementById('baseUrlInput');
        return (el ? el.value.trim() : '') || UIState.getSettings().baseUrl || '';
    },

    _initAIService() {
        AIService.initialize({
            provider: this._getProvider(),
            apiKey:   this._getApiKey(),
            model:    this._getModel(),
            baseUrl:  this._getBaseUrl(),
        });
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
        const formatted = (unit === '') ? num.toFixed(2) : Math.round(num);
        display.textContent = formatted + unit;
        // Update filled-track percentage for Ambar range CSS (--pct custom prop)
        const rangeEl = document.getElementById(id);
        if (rangeEl && rangeEl.type === 'range') {
            const min = parseFloat(rangeEl.min) || 0;
            const max = parseFloat(rangeEl.max) || 100;
            const pct = ((num - min) / (max - min)) * 100;
            rangeEl.style.setProperty('--pct', pct.toFixed(1) + '%');
        }
    },

    // ── Provider / model / API key ────────────────────────────────────

    _getProvider() {
        const el = document.getElementById('aiProvider');
        return (el ? el.value : '') || UIState.getSettings().aiProvider || 'ollama';
    },

    _getModel() {
        const el = document.getElementById('aiModel');
        return (el ? el.value.trim() : '') || UIState.getSettings().aiModel || '';
    },

    onProviderChange() {
        const provider = this._getProvider();
        UIState.updateSetting('aiProvider', provider);
        CONSTANTS.AI_PROVIDER = provider;
        this._updateProviderUI(provider);
        this._initAIService();
    },

    onModelInput() {
        const model = this._getModel();
        UIState.updateSetting('aiModel', model);
        AIService.model = model;
    },

    _updateProviderUI(provider) {
        var PROVIDERS_LOCAL = {
            'gemini':            { keyHint: 'Free key → aistudio.google.com',              keyPlaceholder: 'AIzaSy…',              defaultModel: 'gemini-2.0-flash',          needsKey: true,  needsUrl: false },
            'openai':            { keyHint: 'Get key → platform.openai.com',               keyPlaceholder: 'sk-…',                 defaultModel: 'gpt-4o-mini',               needsKey: true,  needsUrl: false },
            'anthropic':         { keyHint: 'Get key → console.anthropic.com',             keyPlaceholder: 'sk-ant-…',             defaultModel: 'claude-haiku-4-5-20251001', needsKey: true,  needsUrl: false },
            'ollama':            { keyHint: 'No key needed — runs locally (ollama.com)',   keyPlaceholder: '(not required)',       defaultModel: 'llama3.2',                  needsKey: false, needsUrl: true  },
            'openai-compatible': { keyHint: 'API key for your endpoint (optional for local)', keyPlaceholder: 'sk-… or leave blank', defaultModel: 'llama3.2',                  needsKey: true,  needsUrl: true  },
        };
        var cfg = PROVIDERS_LOCAL[provider] || PROVIDERS_LOCAL['ollama'];
        var hintEl = document.getElementById('apiKeyHint');
        var phEl   = document.getElementById('apiKeyInput');
        var defEl  = document.getElementById('modelDefault');
        var grpEl  = document.getElementById('apiKeyGroup');
        var urlGrp = document.getElementById('baseUrlGroup');
        if (hintEl) hintEl.textContent  = cfg.keyHint;
        if (phEl)   phEl.placeholder    = cfg.keyPlaceholder;
        if (defEl)  defEl.textContent   = '(default: ' + cfg.defaultModel + ')';
        if (grpEl)  grpEl.style.display = cfg.needsKey ? '' : 'none';
        if (urlGrp) urlGrp.style.display = cfg.needsUrl ? '' : 'none';
        var labels = { gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Claude', ollama: 'Ollama', 'openai-compatible': 'Custom AI' };
        var sub = document.getElementById('headerSub');
        if (sub) sub.textContent = 'Premiere Pro · ' + (labels[provider] || 'AI');
    },

    onApiKeyInput() {
        UIState.updateSetting('apiKey', this._getApiKey());
        this._initAIService();
    },

    // ── FCPXML / SRT file loading ─────────────────────────────────────

    // Opens the OS file picker via UXP storage API (works inside Premiere).
    // Falls back to a programmatic <input type="file"> for browser testing.
    openFcpxmlPicker: async function() {
        var self = this;
        try {
            var result = await this._openFilePicker(['fcpxml', 'xml']);
            if (result) self._processFcpxmlContent(result.name, result.content);
        } catch (e) {
            self.showError('Could not open file: ' + e.message);
        }
    },

    openSrtPicker: async function() {
        var self = this;
        try {
            var result = await this._openFilePicker(['srt', 'txt']);
            if (result) self._processSrtContent(result.name, result.content);
        } catch (e) {
            self.showError('Could not open file: ' + e.message);
        }
    },

    // Drag-and-drop handlers
    onFcpxmlDrop: async function(event) {
        event.preventDefault();
        event.stopPropagation();
        var zone = document.getElementById('fcpxmlDropZone');
        if (zone) zone.classList.remove('drag-over');

        var file = this._getDroppedFile(event);
        if (!file) { this.showError('No file received — try using the file picker instead.'); return; }
        Logger.info('FCPXML drop: name=' + file.name + ' size=' + (file.size || '?'));

        try {
            var content = await this._readFileAsText(file);
            this._processFcpxmlContent(file.name, content);
        } catch (e) {
            this.showError('Could not read file: ' + e.message);
        }
    },

    onSrtDrop: async function(event) {
        event.preventDefault();
        event.stopPropagation();
        var zone = document.getElementById('srtDropZone');
        if (zone) zone.classList.remove('drag-over');

        var file = this._getDroppedFile(event);
        if (!file) { this.showError('No file received — try using the file picker instead.'); return; }
        Logger.info('SRT drop: name=' + file.name + ' size=' + (file.size || '?'));

        try {
            var content = await this._readFileAsText(file);
            this._processSrtContent(file.name, content);
        } catch (e) {
            this.showError('Could not read file: ' + e.message);
        }
    },

    // Extract the first file from a drop event — checks both .files and .items
    _getDroppedFile: function(event) {
        var dt = event.dataTransfer;
        if (!dt) return null;
        // Standard files array
        if (dt.files && dt.files.length > 0) return dt.files[0];
        // items API (some UXP versions)
        if (dt.items && dt.items.length > 0) {
            var item = dt.items[0];
            if (item.kind === 'file') return item.getAsFile();
        }
        return null;
    },

    // Core processor — takes file name + text content (from any source)
    _processFcpxmlContent: function(name, content) {
        var self = this;
        var zone     = document.getElementById('fcpxmlDropZone');
        var label    = document.getElementById('fcpxmlLabel');
        var sub      = document.getElementById('fcpxmlSub');
        var filename = document.getElementById('fcpxmlFilename');
        var icon     = document.getElementById('fcpxmlIcon');

        try {
            var parsed = FCPXMLParser.parse(content);
            UIState.setState('fcpxmlParsed', parsed);
            UIState.setState('fcpxmlRaw', content); // keep raw XML for export

            if (zone)     { zone.classList.add('loaded'); }
            if (icon)     { icon.textContent = '✅'; }
            if (label)    { label.textContent = parsed.sequenceName || 'Sequence loaded'; }
            if (sub)      { sub.style.display = 'none'; }
            if (filename) { filename.textContent = name; filename.style.display = 'block'; }

            Logger.info('FCPXML: ' + parsed.sequenceName +
                ' | ' + parsed.clips.length + ' clips | ' +
                FCPXMLParser.formatDuration(parsed.duration));

            self._updateSummaryCard();
            self._checkReadyToAnalyze();

        } catch (e) {
            Logger.error('FCPXML parse error', e);
            if (zone)     { zone.classList.remove('loaded'); }
            if (icon)     { icon.textContent = '❌'; }
            if (label)    { label.textContent = 'Invalid FCPXML file'; }
            if (sub)      { sub.textContent = e.message; sub.style.display = 'block'; }
            self.showError('FCPXML parse error: ' + e.message);
        }
    },

    _processSrtContent: function(name, content) {
        var self = this;
        var zone     = document.getElementById('srtDropZone');
        var label    = document.getElementById('srtLabel');
        var sub      = document.getElementById('srtSub');
        var filename = document.getElementById('srtFilename');
        var icon     = document.getElementById('srtIcon');

        try {
            var lines = SRTParser.parse(content);
            if (lines.length === 0) {
                throw new Error('No subtitle entries found — is this a valid SRT file?');
            }
            UIState.setState('srtParsed', lines);

            if (zone)     { zone.classList.add('loaded'); }
            if (icon)     { icon.textContent = '✅'; }
            if (label)    { label.textContent = lines.length + ' subtitle lines loaded'; }
            if (sub)      { sub.style.display = 'none'; }
            if (filename) { filename.textContent = name; filename.style.display = 'block'; }

            Logger.info('SRT: ' + lines.length + ' entries');
            self._updateSummaryCard();
            self._checkReadyToAnalyze();

        } catch (e) {
            Logger.error('SRT parse error', e);
            if (zone)  { zone.classList.remove('loaded'); }
            if (icon)  { icon.textContent = '❌'; }
            if (label) { label.textContent = 'Invalid SRT file'; }
            if (sub)   { sub.textContent = e.message; sub.style.display = 'block'; }
            self.showError('SRT parse error: ' + e.message);
        }
    },

    // ── File I/O helpers ──────────────────────────────────────────────

    // Opens native OS file picker.
    // In UXP (Premiere): uses require('uxp').storage.localFileSystem
    // In browser (dev):  falls back to programmatic <input type="file">
    _openFilePicker: function(types) {
        var self = this;

        // ── UXP path ──────────────────────────────────────────────────
        if (typeof require !== 'undefined') {
            try {
                var uxpMod  = require('uxp');
                var storage = uxpMod && uxpMod.storage;
                var lfs     = storage && storage.localFileSystem;
                if (lfs && typeof lfs.getFileForOpening === 'function') {
                    return lfs.getFileForOpening({ allowMultiple: false, types: types })
                        .then(function(file) {
                            if (!file) return null; // user cancelled
                            var fmt = storage.formats && storage.formats.utf8
                                      ? { format: storage.formats.utf8 }
                                      : {};
                            return file.read(fmt).then(function(content) {
                                return { name: file.name, content: String(content) };
                            });
                        });
                }
            } catch (e) {
                Logger.warn('UXP storage unavailable, using browser fallback: ' + e.message);
            }
        }

        // ── Browser / dev fallback ────────────────────────────────────
        return new Promise(function(resolve) {
            var input = document.createElement('input');
            input.type   = 'file';
            input.accept = types.map(function(t) { return '.' + t; }).join(',');

            input.onchange = function() {
                var file = input.files && input.files[0];
                if (!file) { resolve(null); return; }
                self._readFileAsText(file).then(function(text) {
                    resolve({ name: file.name, content: text });
                }).catch(function() {
                    resolve(null);
                });
            };
            // Some browsers need the input in the DOM first
            input.style.display = 'none';
            document.body.appendChild(input);
            input.click();
            // Clean up after pick
            setTimeout(function() {
                try { document.body.removeChild(input); } catch (_) {}
            }, 60000);
        });
    },

    // Read file as text — tries multiple APIs for UXP + browser compatibility
    _readFileAsText: async function(file) {
        // 1) Modern File.text() — works in UXP's Chromium for OS drag-and-drop files
        if (file && typeof file.text === 'function') {
            try { return await file.text(); } catch (_) {}
        }

        // 2) UXP Entry.read() — works if this is a UXP storage Entry (from getFileForOpening)
        if (typeof require !== 'undefined' && file && typeof file.read === 'function') {
            try {
                var uxpMod  = require('uxp');
                var storage = uxpMod && uxpMod.storage;
                var fmt = storage && storage.formats && storage.formats.utf8
                          ? { format: storage.formats.utf8 } : {};
                return String(await file.read(fmt));
            } catch (_) {}
        }

        // 3) UXP getEntryForPath — if the file has a nativePath property
        if (typeof require !== 'undefined' && file && (file.nativePath || file.path)) {
            try {
                var uxpMod2  = require('uxp');
                var storage2 = uxpMod2 && uxpMod2.storage;
                var lfs2     = storage2 && storage2.localFileSystem;
                if (lfs2 && typeof lfs2.getEntryForPath === 'function') {
                    var entry = await lfs2.getEntryForPath(file.nativePath || file.path);
                    var fmt2  = storage2.formats && storage2.formats.utf8 ? { format: storage2.formats.utf8 } : {};
                    return String(await entry.read(fmt2));
                }
            } catch (_) {}
        }

        // 4) Classic FileReader — fallback for browser testing
        return new Promise(function(resolve, reject) {
            try {
                var reader = new FileReader();
                reader.onload  = function(e) { resolve(e.target.result); };
                reader.onerror = function()  { reject(new Error('FileReader failed')); };
                reader.readAsText(file, 'UTF-8');
            } catch (e) {
                reject(new Error('No file reading API available: ' + e.message));
            }
        });
    },

    // Show sequence summary card using parsed data
    _updateSummaryCard: function() {
        var parsed = UIState.getState('fcpxmlParsed');
        var srt    = UIState.getState('srtParsed');
        var card   = document.getElementById('sequenceSummary');
        if (!card) return;

        if (!parsed) { card.classList.remove('visible'); return; }

        // Sequence name
        var nameEl = document.getElementById('sequenceName');
        if (nameEl) nameEl.textContent = parsed.sequenceName;

        // Duration
        var durEl = document.getElementById('statDuration');
        if (durEl) durEl.textContent = FCPXMLParser.formatDuration(parsed.duration);

        // Total clips
        var clipsEl = document.getElementById('statClips');
        if (clipsEl) clipsEl.textContent = parsed.clips.length;

        // Unique tracks used (unique lane count, capped to V1/V2/V3 etc.)
        var lanes   = {};
        parsed.clips.forEach(function(c) { lanes[c.lane] = true; });
        var trackEl = document.getElementById('statTracks');
        if (trackEl) trackEl.textContent = Object.keys(lanes).length;

        // SRT lines (or FCPXML caption count as fallback)
        var linesEl = document.getElementById('statLines');
        if (linesEl) {
            if (srt && srt.length > 0) {
                linesEl.textContent = srt.length;
            } else if (parsed.captions && parsed.captions.length > 0) {
                linesEl.textContent = parsed.captions.length + '*';
            } else {
                linesEl.textContent = '—';
            }
        }

        card.classList.add('visible');
    },

    _checkReadyToAnalyze: function() {
        var fcpxml = UIState.getState('fcpxmlParsed');
        // SRT is optional if FCPXML has embedded captions
        var srt    = UIState.getState('srtParsed');
        var parsed = UIState.getState('fcpxmlParsed');
        var hasCaptions = parsed && parsed.captions && parsed.captions.length > 0;
        var ready  = !!(fcpxml && (srt || hasCaptions));

        var btn  = document.getElementById('analyzeBtn');
        var hint = document.getElementById('analyzeBtnHint');
        if (btn) btn.disabled = !ready;
        if (hint) {
            if (!fcpxml) {
                hint.textContent = 'Load FCPXML file above to start';
                hint.style.display = '';
            } else if (!ready) {
                hint.textContent = hasCaptions
                    ? 'FCPXML has embedded captions — ready to analyze'
                    : 'Load SRT transcript above to enable';
                hint.style.display = '';
                if (hasCaptions) btn && (btn.disabled = false);
            } else {
                hint.style.display = 'none';
            }
        }
    },

    startAnalysis: async function() {
        var self = this;
        var fcpxmlParsed = UIState.getState('fcpxmlParsed');
        var srtParsed    = UIState.getState('srtParsed');

        if (!fcpxmlParsed) {
            self.showError('Load an FCPXML file first.');
            return;
        }
        var hasCaptions = fcpxmlParsed.captions && fcpxmlParsed.captions.length > 0;
        if (!srtParsed && !hasCaptions) {
            self.showError('Load an SRT transcript to enable analysis.');
            return;
        }

        var provider = self._getProvider();
        var apiKey   = self._getApiKey();
        if (provider !== 'ollama' && provider !== 'openai-compatible' && !apiKey) {
            self.showError('Add an API key in the Settings tab first.');
            return;
        }

        // Switch to Analyze tab and reset
        self.switchTab('analyze');
        self._cancelRequested = false;

        var aiLog = document.getElementById('aiLog');
        if (aiLog) aiLog.textContent = '';

        var cancelBtn  = document.getElementById('cancelAnalysisBtn');
        var emptyState = document.getElementById('analyzeEmptyState');
        if (cancelBtn)  cancelBtn.style.display  = '';
        if (emptyState) emptyState.style.display = 'none';

        self.showLoading('Building analysis…');
        self.updateStatus('analyzing', 'ANALYZING…');

        // ── Step 1: FCPXML already parsed ────────────────────────────
        self._setPipelineStep('step-parse-xml', 'done', fcpxmlParsed.clips.length + ' clips');

        // ── Step 2: SRT already parsed ───────────────────────────────
        if (srtParsed) {
            self._setPipelineStep('step-parse-srt', 'done', srtParsed.length + ' lines');
        } else {
            self._setPipelineStep('step-parse-srt', 'done', fcpxmlParsed.captions.length + ' captions');
        }

        // ── Step 3: Build prompt, kick off AI ───────────────────────
        self._setPipelineStep('step-match-broll',    'active', '…');
        self._setPipelineStep('step-detect-silence', 'active', '…');
        self._setPipelineStep('step-decisions',      'active', '…');

        var summary;
        try {
            summary = FCPXMLParser.buildPromptSummary(fcpxmlParsed, srtParsed || fcpxmlParsed.captions);
        } catch (e) {
            self.showError('Could not build prompt: ' + e.message);
            if (cancelBtn) cancelBtn.style.display = 'none';
            return;
        }

        self._appendAiLog('> ' + fcpxmlParsed.sequenceName + ' · ' +
            (srtParsed ? srtParsed.length + ' SRT lines' : fcpxmlParsed.captions.length + ' captions') +
            ' · sending to ' + provider + '…\n');

        self._initAIService();

        var response;
        try {
            response = await AIService.analyzeSequence(summary);
        } catch (e) {
            if (self._cancelRequested) return;
            self._setPipelineStep('step-match-broll',    'error', 'failed');
            self._setPipelineStep('step-detect-silence', 'error', 'failed');
            self._setPipelineStep('step-decisions',      'error', 'failed');
            self.showError('AI request failed: ' + e.message);
            if (cancelBtn) cancelBtn.style.display = 'none';
            return;
        }

        if (self._cancelRequested) return;

        // Show truncated raw output in AI log
        var rawText = response.text || '';
        self._appendAiLog(rawText.slice(0, 1000) +
            (rawText.length > 1000 ? '\n[…' + (rawText.length - 1000) + ' chars truncated]' : ''));

        self._setPipelineStep('step-match-broll',    'done', '✓');
        self._setPipelineStep('step-detect-silence', 'done', '✓');

        // ── Parse decisions ──────────────────────────────────────────
        var result = ResponseParser.parseEditDecisions(response);
        if (!result || !result.decisions.length) {
            self._setPipelineStep('step-decisions', 'error', 'parse failed');
            self.showError('Could not parse AI response. Check the AI Output log.');
            if (cancelBtn) cancelBtn.style.display = 'none';
            return;
        }

        // Drop decisions outside the sequence duration (e.g. AI outputs 1.36 for [1:36] instead of 96.0)
        var seqDuration = fcpxmlParsed.duration;
        var inRange = result.decisions.filter(function(d) {
            return d.timelineOffset >= 0 && d.timelineOffset < seqDuration;
        });
        var dropped = result.decisions.length - inRange.length;
        if (dropped > 0) {
            self._appendAiLog('\n[Dropped ' + dropped + ' decision(s) with timelineOffset outside 0–' +
                seqDuration.toFixed(1) + 's — AI likely misread [M:SS] timestamps]');
            result.decisions = inRange;
            result.counts = { cut: 0, broll: 0, story: 0 };
            result.decisions.forEach(function(d) {
                if (result.counts[d.type] !== undefined) result.counts[d.type]++;
            });
        }

        // Warn if all remaining decisions cluster in the first 5% of the timeline
        if (result.decisions.length > 0 && seqDuration > 10) {
            var boundary = seqDuration * 0.05;
            var allClustered = result.decisions.every(function(d) { return d.timelineOffset < boundary; });
            if (allClustered) {
                self._appendAiLog('\n⚠ All decisions are within the first ' + boundary.toFixed(1) +
                    's of a ' + seqDuration.toFixed(1) + 's sequence — AI may have misread [M:SS] as decimal seconds.');
            }
        }

        if (!result.decisions.length) {
            self._setPipelineStep('step-decisions', 'error', 'all out of range');
            self.showError('All AI decisions were out of range. The AI may have misread timestamps — try again.');
            if (cancelBtn) cancelBtn.style.display = 'none';
            return;
        }

        self._setPipelineStep('step-decisions', 'done', result.decisions.length + ' decisions');

        // Store with pending status
        UIState.setState('editDecisions', result.decisions.map(function(d) {
            return { type: d.type, description: d.description || '', timelineOffset: d.timelineOffset,
                     duration: d.duration || 0, confidence: d.confidence, reason: d.reason || '',
                     status: 'pending' };
        }));

        // ── Populate Review tab ──────────────────────────────────────
        self._renderDecisions(result);
        self._updateReviewBadge(result.decisions.length);

        self.hideLoading();
        if (cancelBtn) cancelBtn.style.display = 'none';
        self.updateStatus('success', 'DONE · ' + result.decisions.length + ' decisions');

        // Auto-switch to Review tab
        self.switchTab('review');
        Logger.info('Analysis complete: ' + result.decisions.length + ' decisions');
    },

    cancelAnalysis: function() {
        this._cancelRequested = true;
        this.hideLoading();
        var cancelBtn = document.getElementById('cancelAnalysisBtn');
        if (cancelBtn) cancelBtn.style.display = 'none';
        this.updateStatus('ready', 'CANCELLED');
        ['step-parse-xml','step-parse-srt','step-match-broll','step-detect-silence','step-decisions'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el && !el.classList.contains('done')) el.className = 'pipeline-step pending';
            var st = document.getElementById(id + '-status');
            if (st && st.textContent === '…') st.textContent = '—';
        });
        Logger.info('Analysis cancelled');
    },

    exportModifiedXml: async function() {
        var self       = this;
        var decisions  = UIState.getState('editDecisions') || [];
        var approved   = decisions.filter(function(d) { return d.status === 'approved'; });

        if (approved.length === 0) {
            self.showError('Approve at least one decision before exporting.');
            return;
        }

        var rawXml     = UIState.getState('fcpxmlRaw');
        var parsedData = UIState.getState('fcpxmlParsed');
        if (!rawXml || !parsedData) {
            self.showError('Original XML not available — reimport the file and run analysis again.');
            return;
        }

        // Premiere exports XMEML (.xml); FCP X uses FCPXML (.fcpxml).
        // The output extension must match the input so Premiere can re-import it.
        var isXmeml        = rawXml.indexOf('<xmeml') !== -1;
        var ext            = isXmeml ? 'xml' : 'fcpxml';
        var exportFilename = 'ambar-export.' + ext;
        Logger.info('Export: format=' + (isXmeml ? 'XMEML' : 'FCPXML') + ' file=' + exportFilename);

        self.showLoading('Applying edits…');
        try {
            var modified = FCPXMLEditor.applyDecisions(rawXml, parsedData, approved);

            var cuts  = approved.filter(function(d) { return d.type === 'cut';   }).length;
            var broll = approved.filter(function(d) { return d.type === 'broll'; }).length;
            var story = approved.filter(function(d) { return d.type === 'story'; }).length;
            var parts = [];
            if (cuts)  parts.push(cuts  + ' cut'  + (cuts  !== 1 ? 's' : ''));
            if (broll) parts.push(broll + ' B-roll');
            if (story) parts.push(story + ' story marker' + (story !== 1 ? 's' : ''));

            // Attempt 1: auto-save to UXP temp folder (no dialog) → auto-import
            if (PremiereAPI.isAvailable()) {
                var tempResult = await self._saveTempFile(modified, exportFilename);
                if (tempResult && tempResult.nativePath) {
                    self.showLoading('Importing into Premiere…');
                    var autoImported = await PremiereAPI.importFile(tempResult.nativePath);
                    self.hideLoading();
                    if (autoImported) {
                        self.updateStatus('success', 'DONE · ' + parts.join(' · '));
                        setTimeout(function() { self.updateStatus('ready', 'READY'); }, 6000);
                        return;
                    }
                }
            }

            // Attempt 2: Save dialog → auto-import from the chosen path
            var saveResult = await self._saveFile(modified, exportFilename, ext);
            self.hideLoading();
            if (!saveResult) return; // user cancelled

            self.updateStatus('success', 'EXPORTED · ' + parts.join(' · '));

            if (saveResult.nativePath && PremiereAPI.isAvailable()) {
                self.showLoading('Importing into Premiere…');
                var imported = await PremiereAPI.importFile(saveResult.nativePath);
                self.hideLoading();
                if (imported) {
                    self.updateStatus('success', 'IMPORTED · ' + parts.join(' · '));
                } else {
                    self.updateStatus('success', 'SAVED · ' + parts.join(' · '));
                    self.showError('File saved. To apply: File → Import → select the .' + ext + ' file.');
                }
            }

            setTimeout(function() { self.updateStatus('ready', 'READY'); }, 6000);
        } catch (e) {
            self.hideLoading();
            self.showError('Export failed: ' + e.message);
        }
    },

    // Auto-save to UXP temp/data folder without showing a Save dialog.
    // Returns { name, nativePath } on success, null if unavailable.
    _saveTempFile: async function(content, filename) {
        if (typeof require === 'undefined') return null;
        try {
            var uxpMod  = require('uxp');
            var storage = uxpMod && uxpMod.storage;
            var lfs     = storage && storage.localFileSystem;
            if (!lfs) return null;

            var folder = null;
            if (typeof lfs.getTemporaryFolder === 'function') {
                try { folder = await lfs.getTemporaryFolder(); } catch (_) {}
            }
            if (!folder && typeof lfs.getDataFolder === 'function') {
                try { folder = await lfs.getDataFolder(); } catch (_) {}
            }
            if (!folder) return null;

            var file = await folder.createFile(filename, { overwrite: true });
            if (!file) return null;

            var fmt = storage.formats && storage.formats.utf8 ? { format: storage.formats.utf8 } : {};
            await file.write(content, fmt);
            Logger.info('Temp save: ' + (file.nativePath || file.name));
            return { name: file.name, nativePath: file.nativePath || null };
        } catch (e) {
            Logger.debug('_saveTempFile failed: ' + e.message);
            return null;
        }
    },

    // Save a string as a file — UXP storage API with browser download fallback.
    // ext: 'xml' for XMEML, 'fcpxml' for FCPXML (controls the Save dialog filter).
    // Returns { name, nativePath } on success, null if user cancelled.
    _saveFile: async function(content, filename, ext) {
        var self      = this;
        var fileTypes = (ext === 'xml') ? ['xml'] : ['fcpxml', 'xml'];

        // UXP path — opens native Save As dialog
        if (typeof require !== 'undefined') {
            try {
                var uxpMod  = require('uxp');
                var storage = uxpMod && uxpMod.storage;
                var lfs     = storage && storage.localFileSystem;
                if (lfs && typeof lfs.getFileForSaving === 'function') {
                    var file = await lfs.getFileForSaving(filename, { types: fileTypes });
                    if (!file) return null; // user cancelled
                    var fmt = storage.formats && storage.formats.utf8
                              ? { format: storage.formats.utf8 } : {};
                    await file.write(content, fmt);
                    Logger.info('Exported: ' + file.name);
                    return { name: file.name, nativePath: file.nativePath || null };
                }
            } catch (e) {
                Logger.warn('UXP save failed, trying browser download: ' + e.message);
            }
        }

        // Browser fallback — trigger <a download> click
        try {
            var blob = new Blob([content], { type: 'text/xml' });
            var url  = URL.createObjectURL(blob);
            var a    = document.createElement('a');
            a.href     = url;
            a.download = filename;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            setTimeout(function() {
                try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (_) {}
            }, 2000);
            return { name: filename, nativePath: null };
        } catch (e) {
            throw new Error('Could not save file: ' + e.message);
        }
    },

    // ── Pipeline step helper ───────────────────────────────────────────

    _setPipelineStep: function(id, state, statusText) {
        var el = document.getElementById(id);
        if (el) el.className = 'pipeline-step ' + state;
        var st = document.getElementById(id + '-status');
        if (st) st.textContent = statusText || '';
    },

    _appendAiLog: function(text) {
        var log = document.getElementById('aiLog');
        if (!log) return;
        log.textContent += text;
        log.scrollTop = log.scrollHeight;
    },

    // ── Review tab rendering ───────────────────────────────────────────

    _renderDecisions: function(result) {
        var self = this;

        var statCuts  = document.getElementById('statCuts');
        var statBroll = document.getElementById('statBroll');
        var statStory = document.getElementById('statStory');
        if (statCuts)  statCuts.textContent  = result.counts.cut;
        if (statBroll) statBroll.textContent = result.counts.broll;
        if (statStory) statStory.textContent = result.counts.story;

        var summaryEl = document.getElementById('aiSummary');
        if (summaryEl) summaryEl.textContent = result.summary || '';

        var list = document.getElementById('decisionsList');
        if (!list) return;
        list.innerHTML = '';

        // ── Approve All / Reject All bar ──────────────────────────────
        // UXP blocks onclick in innerHTML — must use createElement + addEventListener
        var bar = document.createElement('div');
        bar.style.cssText = 'display:flex;gap:6px;margin-bottom:8px;';

        var approveAllBtn = document.createElement('button');
        approveAllBtn.className = 'secondary-btn';
        approveAllBtn.style.cssText = 'font-size:11px;padding:5px 10px;flex:1;';
        approveAllBtn.textContent = '✓ Approve All';
        approveAllBtn.addEventListener('click', function() { UIController.approveAll(); });
        bar.appendChild(approveAllBtn);

        var rejectAllBtn = document.createElement('button');
        rejectAllBtn.className = 'ghost-btn';
        rejectAllBtn.style.cssText = 'font-size:11px;padding:5px 10px;flex:1;';
        rejectAllBtn.textContent = '✕ Reject All';
        rejectAllBtn.addEventListener('click', function() { UIController.rejectAll(); });
        bar.appendChild(rejectAllBtn);

        list.appendChild(bar);

        // ── Decision items ─────────────────────────────────────────────
        result.decisions.forEach(function(d, idx) {
            var tagClass = d.type === 'cut' ? 'silence' : (d.type === 'broll' ? 'broll' : 'story');
            var confPct  = Math.round((d.confidence || 0) * 100);
            var durStr   = d.duration ? ' · ' + d.duration.toFixed(1) + 's' : '';

            // Wrapper
            var item = document.createElement('div');
            item.className = 'decision-item';
            item.id = 'decision-' + idx;

            // ── Main content column ──
            var main = document.createElement('div');
            main.className = 'decision-main';

            // Meta row: tag + time + confidence
            var meta = document.createElement('div');
            meta.className = 'decision-meta';

            var tag = document.createElement('span');
            tag.className = 'tag ' + tagClass;
            tag.textContent = d.type.toUpperCase();
            meta.appendChild(tag);

            var timeEl = document.createElement('span');
            timeEl.className = 'decision-time';
            timeEl.textContent = self._formatTime(d.timelineOffset) + durStr;
            meta.appendChild(timeEl);

            var badge = document.createElement('span');
            badge.className = 'badge';
            badge.textContent = confPct + '%';
            meta.appendChild(badge);

            main.appendChild(meta);

            var desc = document.createElement('div');
            desc.className = 'decision-desc';
            desc.textContent = d.description || '';
            main.appendChild(desc);

            if (d.reason) {
                var reason = document.createElement('div');
                reason.className = 'decision-reason';
                reason.textContent = d.reason;
                main.appendChild(reason);
            }

            item.appendChild(main);

            // ── Approve / Reject buttons ──
            var actions = document.createElement('div');
            actions.className = 'decision-actions';

            var approveBtn = document.createElement('button');
            approveBtn.className = 'decision-approve';
            approveBtn.id = 'approve-' + idx;
            approveBtn.title = 'Approve';
            approveBtn.textContent = '✓';
            approveBtn.addEventListener('click', (function(i) {
                return function() { UIController.approveDecision(i); };
            })(idx));
            actions.appendChild(approveBtn);

            var rejectBtn = document.createElement('button');
            rejectBtn.className = 'decision-reject';
            rejectBtn.id = 'reject-' + idx;
            rejectBtn.title = 'Reject';
            rejectBtn.textContent = '✕';
            rejectBtn.addEventListener('click', (function(i) {
                return function() { UIController.rejectDecision(i); };
            })(idx));
            actions.appendChild(rejectBtn);

            item.appendChild(actions);
            list.appendChild(item);
        });

        var resultsEl = document.getElementById('reviewResults');
        var emptyEl   = document.getElementById('reviewEmptyState');
        if (resultsEl) resultsEl.style.display = '';
        if (emptyEl)   emptyEl.style.display   = 'none';

        self._updateExportBtn();
    },

    // ── Decision approve / reject ─────────────────────────────────────

    approveDecision: function(idx) {
        var decisions = UIState.getState('editDecisions');
        if (!decisions || idx < 0 || idx >= decisions.length) return;
        var d = decisions[idx];
        // Toggle: clicking approve again reverts to pending
        d.status = (d.status === 'approved') ? 'pending' : 'approved';
        this._refreshDecisionItem(idx, d);
        this._updateExportBtn();
    },

    rejectDecision: function(idx) {
        var decisions = UIState.getState('editDecisions');
        if (!decisions || idx < 0 || idx >= decisions.length) return;
        var d = decisions[idx];
        // Toggle: clicking reject again reverts to pending
        d.status = (d.status === 'rejected') ? 'pending' : 'rejected';
        this._refreshDecisionItem(idx, d);
        this._updateExportBtn();
    },

    // Force all to approved (does not toggle — idempotent)
    approveAll: function() {
        var decisions = UIState.getState('editDecisions');
        if (!decisions) return;
        for (var i = 0; i < decisions.length; i++) {
            decisions[i].status = 'approved';
            this._refreshDecisionItem(i, decisions[i]);
        }
        this._updateExportBtn();
    },

    // Force all to rejected (does not toggle — idempotent)
    rejectAll: function() {
        var decisions = UIState.getState('editDecisions');
        if (!decisions) return;
        for (var i = 0; i < decisions.length; i++) {
            decisions[i].status = 'rejected';
            this._refreshDecisionItem(i, decisions[i]);
        }
        this._updateExportBtn();
    },

    // Update a single decision item's visual state
    _refreshDecisionItem: function(idx, d) {
        var item       = document.getElementById('decision-' + idx);
        var approveBtn = document.getElementById('approve-' + idx);
        var rejectBtn  = document.getElementById('reject-' + idx);

        if (item) {
            // Separate calls — UXP's classList.remove() may not support multiple args
            item.classList.remove('approved');
            item.classList.remove('rejected');
            if (d.status === 'approved') item.classList.add('approved');
            if (d.status === 'rejected') item.classList.add('rejected');
        }
        if (approveBtn) {
            if (d.status === 'approved') approveBtn.classList.add('on');
            else                         approveBtn.classList.remove('on');
        }
        if (rejectBtn) {
            if (d.status === 'rejected') rejectBtn.classList.add('on');
            else                         rejectBtn.classList.remove('on');
        }
    },

    // Enable / disable Export button based on approved count
    _updateExportBtn: function() {
        var decisions = UIState.getState('editDecisions') || [];
        var approved  = 0;
        for (var i = 0; i < decisions.length; i++) {
            if (decisions[i].status === 'approved') approved++;
        }
        var btn  = document.getElementById('exportBtn');
        var hint = document.getElementById('exportHint');
        if (btn) btn.disabled = (approved === 0);
        if (hint) {
            hint.textContent = approved > 0
                ? approved + ' decision' + (approved === 1 ? '' : 's') + ' approved — ready to export'
                : 'Approve decisions above to enable export';
        }
    },

    _updateReviewBadge: function(count) {
        var badge = document.getElementById('reviewBadge');
        var btn   = document.querySelector('[data-tab="review"]');
        if (badge) { badge.textContent = count; badge.style.display = count > 0 ? '' : 'none'; }
        if (btn) {
            if (count > 0) btn.classList.add('has-data');
            else           btn.classList.remove('has-data');
        }
    },

    _formatTime: function(secs) {
        if (!secs || isNaN(secs)) return '0:00';
        var m = Math.floor(secs / 60);
        var s = Math.floor(secs % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
    },

    _escapeHtml: function(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
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

        const provider = this._getProvider();
        const apiKey   = this._getApiKey();
        var localProviders = { 'ollama': true, 'openai-compatible': true };
        if (!localProviders[provider] && !Validators.isValidApiKey(apiKey)) {
            this.showError('No API key — add it in the Config tab.');
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

            this.showLoading('Analyzing…');
            this._initAIService();

            const raw    = await AIService.analyzeSilence(ProjectReader.formatForAPI(metadata), parseFloat(threshold), parseInt(duration, 10));
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

        const provider2  = this._getProvider();
        const apiKey2    = this._getApiKey();
        var localProviders2 = { 'ollama': true, 'openai-compatible': true };
        if (!localProviders2[provider2] && !Validators.isValidApiKey(apiKey2)) {
            this.showError('No API key — add it in the Config tab.');
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

            this.showLoading('Analyzing…');
            this._initAIService();

            const raw    = await AIService.detectBroll(ProjectReader.formatForAPI(metadata), parseFloat(confidence));
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

    async applyEdits() {
        const results = UIState.getState('results');
        if (!results) { this.showError('No results to apply.'); return; }

        this.showLoading('Adding markers to timeline…');

        try {
            let editResult;
            if (results.type === 'silence') {
                editResult = await TimelineEditor.markSilenceSegments(results.segments);
            } else if (results.type === 'broll') {
                editResult = await TimelineEditor.markBrollOpportunities(results.opportunities);
            }

            this.hideLoading();

            if (editResult && editResult.marked > 0) {
                this.updateStatus('success', editResult.marked + ' MARKERS ADDED');
                UIState.reset();
                this.hideResults();
            } else {
                this.showError('Could not write markers — sequence.markers is unavailable in this PPro version. Try adding markers manually using the analysis timestamps shown.');
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

        // ── 10. AI provider + key ────────────────────────────────────
        const provider = this._getProvider();
        const model    = AIService.model || (typeof PROVIDERS !== 'undefined' && PROVIDERS[provider] ? PROVIDERS[provider].defaultModel : '');
        ok('AI provider: ' + provider + ' / model: ' + (model || '(default)'));
        const key = this._getApiKey();
        if (provider === 'ollama') ok('Ollama: no API key needed');
        else if (!key) wrn('No API key — add it in the Config tab');
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
            const provider = this._getProvider();
            UIState.updateSetting('apiKey',     this._getApiKey());
            UIState.updateSetting('aiProvider', provider);
            UIState.updateSetting('aiModel',    this._getModel());
            UIState.updateSetting('baseUrl',    this._getBaseUrl());
            localStorage.setItem('pluginSettings', JSON.stringify(UIState.getSettings()));
            CONSTANTS.AI_PROVIDER = provider;
            this._initAIService();
            this.updateStatus('success', 'SETTINGS SAVED');
            setTimeout(() => this.updateStatus('ready', 'READY'), 2000);
            Logger.debug('Settings saved: provider=' + provider);
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

            // Restore provider selector and model
            if (settings.aiProvider) {
                const provEl = document.getElementById('aiProvider');
                if (provEl) provEl.value = settings.aiProvider;
                CONSTANTS.AI_PROVIDER = settings.aiProvider;
                this._updateProviderUI(settings.aiProvider);
            }
            if (settings.aiModel) {
                const modEl = document.getElementById('aiModel');
                if (modEl) modEl.value = settings.aiModel;
            }

            // Restore base URL field
            if (settings.baseUrl) {
                const urlEl = document.getElementById('baseUrlInput');
                if (urlEl) urlEl.value = settings.baseUrl;
            }

            // Initialize AI service from restored settings
            AIService.initialize({
                provider: settings.aiProvider || 'ollama',
                apiKey:   settings.apiKey     || '',
                model:    settings.aiModel    || '',
                baseUrl:  settings.baseUrl    || '',
            });

            Logger.debug('Settings restored: provider=' + (settings.aiProvider || 'ollama'));
        } catch (e) {
            Logger.error('Failed to restore settings', e);
        }
    },
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIController;
}
