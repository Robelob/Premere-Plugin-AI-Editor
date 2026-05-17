/* ui-controller.js - UI event handlers and rendering */

const UIController = {

    _pollInterval:    null,
    _pendingEditPlan: null,
    _captionTemplate: 'minimal',
    _mogrtPath:       null,

    init() {
        Logger.info('Initializing UI Controller');

        if (typeof Capabilities !== 'undefined') {
            Capabilities.detectSync();
            Capabilities.logDiagnostics();
            Capabilities.detectCEPBridge().then(function() {
                Logger.info('[Capabilities] CEP Bridge detection complete');
            }).catch(function(e) {
                Logger.debug('[Capabilities] CEP Bridge detection error: ' + e.message);
            });
        }

        this.restoreSettings();
        this._initAIService();
        this._updateProviderUI(this._getProvider());
        this._updateStatusBar('Ready', 0);
        this._setupEventBasedDetection();
        this.refreshSequences();
        this._startSequencePoll();
    },

    // ── Sidebar navigation ────────────────────────────────────────────

    switchPanel(panelName) {
        document.querySelectorAll('.nav-btn, .sidebar-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.dataset.panel === panelName);
        });
        document.querySelectorAll('.panel-content').forEach(function(panel) {
            panel.classList.toggle('active', panel.id === 'panel-' + panelName);
        });
    },

    // ── Sequence detection ────────────────────────────────────────────

    _setupEventBasedDetection() {
        if (!PremiereAPI.isAvailable()) return;
        var self = this;
        var ok = PremiereAPI.setupEventListeners(async function(sequence) {
            var seqName = null;
            try { seqName = await sequence.name;       } catch (_) {}
            try {
                if (seqName && !sequence._resolvedName) sequence._resolvedName = seqName;
            } catch (_) {}

            Logger.info('UIController: sequence activated — name=' + seqName);
            self.refreshSequences();

            if (typeof ProjectMemory !== 'undefined') {
                try {
                    var seqId = null;
                    try { seqId = await sequence.sequenceID; } catch (_) {}
                    if (!seqId) seqId = seqName || 'default';
                    var memState = await ProjectMemory.init(seqId);
                    self._updateMemoryUI(memState);
                } catch (memErr) {
                    Logger.warn('[Memory] Init failed: ' + memErr.message);
                }
            }
        });
        if (ok) Logger.info('Event-based sequence detection armed');
        else    Logger.warn('Event-based detection unavailable — relying on poll');
    },

    _startSequencePoll() {
        if (this._pollInterval) return;
        var self = this;
        var pollCount = 0;
        this._pollInterval = setInterval(function() {
            try {
                var select = document.getElementById('sequenceSelect');
                if (!select) return;
                var hasSeq = select.value && select.value !== '' && select.options.length >= 1;
                if (hasSeq) return;

                pollCount++;
                if (pollCount % 6 === 0) {
                    PremiereAPI.getActiveSequenceAsync().then(function(seq) {
                        if (seq) self.refreshSequences();
                    }).catch(function() {});
                }

                var active = PremiereAPI.getActiveSequence();
                if (active) self.refreshSequences();
            } catch (e) { /* silent */ }
        }, 10000);
    },

    // ── Internal helpers ──────────────────────────────────────────────

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

    // ── Sequence selector ─────────────────────────────────────────────

    refreshSequences() {
        const select = document.getElementById('sequenceSelect');
        if (!select) return;

        if (!PremiereAPI.isAvailable()) {
            select.innerHTML = '<option value="">── Load plugin inside Premiere Pro ──</option>';
            this._updateTopbarPill(null);
            Logger.warn('premierepro module unavailable');
            return;
        }

        if (!PremiereAPI.getActiveProject()) {
            select.innerHTML = '<option value="">── No project open ──</option>';
            this._updateTopbarPill(null);
            return;
        }

        try {
            const sequences = PremiereAPI.getAllSequences();
            select.innerHTML = '';

            if (sequences.length === 0) {
                select.innerHTML = '<option value="">── No sequence detected ──</option>';
                this._updateTopbarPill(null);
                const hint = document.getElementById('seqHint');
                if (hint) hint.style.display = 'block';
                return;
            }

            const hint = document.getElementById('seqHint');
            if (hint) hint.style.display = 'none';

            sequences.forEach(function(s) {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = s.name;
                select.appendChild(opt);
            });

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

            // Update topbar pill with sequence name
            const selectedSeq = sequences.find(function(s) { return s.id === selectedId; });
            this._updateTopbarPill(selectedSeq ? selectedSeq.name : sequences[0].name);
            Logger.info('Loaded ' + sequences.length + ' sequence(s), selected: ' + selectedId);
        } catch (e) {
            Logger.error('Error refreshing sequences', e);
            this._updateTopbarPill(null);
        }
    },

    _updateTopbarPill(seqName) {
        const dot      = document.getElementById('seqDot');
        const nameEl   = document.getElementById('seqName');
        const durEl    = document.getElementById('seqDuration');
        const seqSpan  = document.getElementById('statusSeqName');

        if (!nameEl) return;

        if (seqName) {
            nameEl.textContent = seqName;
            if (dot) dot.classList.add('connected');
            if (seqSpan) seqSpan.textContent = seqName;
        } else {
            nameEl.textContent = 'No sequence';
            if (dot) dot.classList.remove('connected');
            if (durEl) durEl.textContent = '';
            if (seqSpan) seqSpan.textContent = '–';
        }
    },

    _updateMemoryUI(state) {
        if (!state) return;
        var self = this;

        // Update sequence ID in memory panel header
        var seqIdEl = document.getElementById('memSeqId');
        if (seqIdEl && state.sequenceId) seqIdEl.textContent = state.sequenceId;

        // Row definitions: key → { dotId, statusId, done, statusText }
        var rows = [
            {
                dotId:    'memDot-edit',
                statusId: 'memStatus-edit',
                done:     !!state.analysisDone,
                text:     state.analysisDone
                    ? (state.cutsApplied || []).length + ' cuts · ' + self._timeAgo(state.lastAnalyzed)
                    : 'not run',
            },
            {
                dotId:    'memDot-broll',
                statusId: 'memStatus-broll',
                done:     !!state.brollDone,
                text:     state.brollDone
                    ? (state.brollPlacements || []).length + ' placements'
                    : 'not run',
            },
            {
                dotId:    'memDot-captions',
                statusId: 'memStatus-captions',
                done:     !!state.captionsDone,
                text:     state.captionsDone
                    ? (state.captionLines || 0) + ' lines'
                    : 'not run',
            },
            {
                dotId:    'memDot-organise',
                statusId: 'memStatus-organise',
                done:     !!state.organiseDone,
                text:     state.organiseDone ? 'organized' : 'not run',
            },
        ];

        rows.forEach(function(row) {
            var dot    = document.getElementById(row.dotId);
            var status = document.getElementById(row.statusId);
            if (dot)    dot.className = 'mem-dot' + (row.done ? ' green' : '');
            if (status) status.textContent = row.text;
        });

        // New footage row — show/hide
        var footageRow = document.getElementById('memRow-footage');
        if (footageRow) {
            if (state.newFootageDetected) {
                footageRow.style.display = '';
                var footageDot    = document.getElementById('memDot-footage');
                var footageStatus = document.getElementById('memStatus-footage');
                if (footageDot)    footageDot.className = 'mem-dot amber';
                if (footageStatus) footageStatus.textContent =
                    (state.newClipCount || '?') + ' new clip(s)';
            } else {
                footageRow.style.display = 'none';
            }
        }
    },

    _timeAgo(isoString) {
        if (!isoString) return 'unknown';
        var mins = Math.round((Date.now() - new Date(isoString).getTime()) / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return mins + ' min ago';
        return Math.round(mins / 60) + ' hr ago';
    },

    onSequenceChange() {
        const select = document.getElementById('sequenceSelect');
        const sequenceId = select ? select.value : '';
        if (!sequenceId) return;

        UIState.setState('selectedSequenceId', sequenceId);

        const seq = PremiereAPI.getSequenceById(sequenceId);
        if (seq) {
            PremiereAPI.openSequence(seq);
            this._updateTopbarPill(seq.name);
        }
    },

    // ── Status bar ────────────────────────────────────────────────────

    _updateStatusBar(text, pct) {
        const textEl = document.getElementById('statusBarText');
        const fill   = document.getElementById('statusBarFill');
        if (textEl) textEl.textContent = text || 'Ready';
        if (fill)   fill.style.width   = Math.max(0, Math.min(100, pct || 0)) + '%';
    },

    // ── Provider / model / API key ────────────────────────────────────

    _getProvider() {
        if (CONSTANTS.AI_PROVIDER && CONSTANTS.AI_PROVIDER !== '') {
            return CONSTANTS.AI_PROVIDER;
        }
        const el = document.getElementById('aiProvider');
        return (el ? el.value : '') || UIState.getSettings().aiProvider || 'ollama';
    },

    _getModel() {
        if (CONSTANTS.AI_MODEL && CONSTANTS.AI_MODEL !== '') {
            return CONSTANTS.AI_MODEL;
        }
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

    onWhisperProviderChange() {
        const el = document.getElementById('whisperProvider');
        if (el) {
            CONSTANTS.WHISPER_PROVIDER = el.value;
            UIState.updateSetting('whisperProvider', el.value);
        }
    },

    onVisionModelChange() {
        const el = document.getElementById('visionModel');
        if (el) {
            CONSTANTS.VISION_MODEL = el.value;
            UIState.updateSetting('visionModel', el.value);
        }
    },

    _updateProviderUI(provider) {
        var PROVIDERS_LOCAL = {
            'gemini':            { keyHint: 'Free key → aistudio.google.com',              keyPlaceholder: 'AIzaSy…',              defaultModel: 'gemini-2.0-flash',          needsKey: true,  needsUrl: false },
            'openai':            { keyHint: 'Get key → platform.openai.com',               keyPlaceholder: 'sk-…',                 defaultModel: 'gpt-4o-mini',               needsKey: true,  needsUrl: false },
            'anthropic':         { keyHint: 'Get key → console.anthropic.com',             keyPlaceholder: 'sk-ant-…',             defaultModel: 'claude-haiku-4-5-20251001', needsKey: true,  needsUrl: false },
            'ollama':            { keyHint: 'No key needed — runs locally (ollama.com)',   keyPlaceholder: '(not required)',       defaultModel: 'llama3.2',                  needsKey: false, needsUrl: true  },
            'openai-compatible': { keyHint: 'API key for your endpoint (optional for local)', keyPlaceholder: 'sk-… or leave blank', defaultModel: 'llama3.2',                  needsKey: true,  needsUrl: true  },
        };
        var cfg    = PROVIDERS_LOCAL[provider] || PROVIDERS_LOCAL['ollama'];
        var hintEl = document.getElementById('apiKeyHint');
        var phEl   = document.getElementById('apiKeyInput');
        var defEl  = document.getElementById('modelDefault');
        var grpEl  = document.getElementById('apiKeyGroup');
        var urlGrp = document.getElementById('baseUrlGroup');
        if (hintEl) hintEl.textContent   = cfg.keyHint;
        if (phEl)   phEl.placeholder     = cfg.keyPlaceholder;
        if (defEl)  defEl.textContent    = '(default: ' + cfg.defaultModel + ')';
        if (grpEl)  grpEl.style.display  = cfg.needsKey ? '' : 'none';
        if (urlGrp) urlGrp.style.display = cfg.needsUrl ? '' : 'none';
    },

    onApiKeyInput() {
        UIState.updateSetting('apiKey', this._getApiKey());
        this._initAIService();
    },

    toggleApiKeyVisibility() {
        const input = document.getElementById('apiKeyInput');
        const btn   = document.getElementById('toggleKeyBtn');
        if (!input) return;
        const isHidden = input.type === 'password';
        input.type = isHidden ? 'text' : 'password';
        if (btn) btn.textContent = isHidden ? '🙈' : '👁';
    },

    // ── File I/O helpers ──────────────────────────────────────────────

    _openFilePicker(types, binaryMode) {
        var self = this;

        if (typeof require !== 'undefined') {
            try {
                var uxpMod  = require('uxp');
                var storage = uxpMod && uxpMod.storage;
                var lfs     = storage && storage.localFileSystem;
                if (lfs && typeof lfs.getFileForOpening === 'function') {
                    return lfs.getFileForOpening({ allowMultiple: false, types: types })
                        .then(function(file) {
                            if (!file) return null;
                            if (binaryMode) {
                                return { name: file.name, nativePath: file.nativePath || null, path: file.nativePath || null };
                            }
                            var fmt = storage.formats && storage.formats.utf8
                                      ? { format: storage.formats.utf8 } : {};
                            return file.read(fmt).then(function(content) {
                                return { name: file.name, content: String(content), nativePath: file.nativePath || null };
                            });
                        });
                }
            } catch (e) {
                Logger.warn('UXP storage unavailable: ' + e.message);
            }
        }

        return new Promise(function(resolve) {
            var input = document.createElement('input');
            input.type   = 'file';
            input.accept = types.map(function(t) { return '.' + t; }).join(',');
            input.onchange = function() {
                var file = input.files && input.files[0];
                if (!file) { resolve(null); return; }
                self._readFileAsText(file).then(function(text) {
                    resolve({ name: file.name, content: text });
                }).catch(function() { resolve(null); });
            };
            input.style.display = 'none';
            document.body.appendChild(input);
            input.click();
            setTimeout(function() {
                try { document.body.removeChild(input); } catch (_) {}
            }, 60000);
        });
    },

    _readFileAsText: async function(file) {
        if (file && typeof file.text === 'function') {
            try { return await file.text(); } catch (_) {}
        }
        if (typeof require !== 'undefined' && file && typeof file.read === 'function') {
            try {
                var uxpMod  = require('uxp');
                var storage = uxpMod && uxpMod.storage;
                var fmt = storage && storage.formats && storage.formats.utf8
                          ? { format: storage.formats.utf8 } : {};
                return String(await file.read(fmt));
            } catch (_) {}
        }
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

    _saveFile: async function(content, filename, ext) {
        var fileTypes = [ext || 'srt'];

        if (typeof require !== 'undefined') {
            try {
                var uxpMod  = require('uxp');
                var storage = uxpMod && uxpMod.storage;
                var lfs     = storage && storage.localFileSystem;
                if (lfs && typeof lfs.getFileForSaving === 'function') {
                    var file = await lfs.getFileForSaving(filename, { types: fileTypes });
                    if (!file) return null;
                    var fmt = storage.formats && storage.formats.utf8
                              ? { format: storage.formats.utf8 } : {};
                    await file.write(content, fmt);
                    Logger.info('Saved: ' + file.name);
                    return { name: file.name, nativePath: file.nativePath || null };
                }
            } catch (e) {
                Logger.warn('UXP save failed: ' + e.message);
            }
        }

        // Browser fallback
        try {
            var blob = new Blob([content], { type: 'text/plain' });
            var url  = URL.createObjectURL(blob);
            var a    = document.createElement('a');
            a.href = url; a.download = filename; a.style.display = 'none';
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

    // ── Pipeline step helpers ─────────────────────────────────────────

    _setStepCard(id, state, subText, badgeText) {
        var card  = document.getElementById(id);
        var badge = document.getElementById(id + '-badge');
        var sub   = document.getElementById(id + '-sub');

        if (card) {
            card.className = 'step-card' + (state ? ' ' + state : '');
        }
        if (badge) {
            badge.className = 'step-badge ' + (state || 'waiting');
            badge.textContent = badgeText ||
                (state === 'active' ? 'in progress' :
                 state === 'done'   ? 'done' :
                 state === 'error'  ? 'error' : 'waiting');
        }
        if (sub && subText) sub.textContent = subText;
    },

    _appendAiLog(text) {
        var log = document.getElementById('aiLog');
        if (!log) return;
        if (log.style.display === 'none') log.style.display = '';
        log.textContent += text;
        log.scrollTop = log.scrollHeight;
    },

    _resetEditSteps() {
        var steps = ['step-silence', 'step-transcribe', 'step-ai-decisions'];
        var self  = this;
        steps.forEach(function(id) { self._setStepCard(id, '', '', 'waiting'); });
        var log = document.getElementById('aiLog');
        if (log) { log.textContent = ''; log.style.display = 'none'; }
    },

    // ── Main analysis flow ────────────────────────────────────────────

    startTimelineAnalysis: async function() {
        var self     = this;
        var provider = self._getProvider();
        var apiKey   = self._getApiKey();
        var noKeyOk  = provider === 'ollama' || provider === 'openai-compatible';

        if (!noKeyOk && !apiKey) {
            self.showError('Add an API key in Settings first.');
            return;
        }

        self._cancelRequested = false;
        self._pendingEditPlan = null;
        self._resetEditSteps();
        self._initAIService();
        self.showLoading('Layer 1 — detecting silence…');
        self._updateStatusBar('Detecting silence…', 10);
        self._setStepCard('step-silence', 'active');

        try {
            var srtFallback = UIState.getState('srtTranscript');
            var result = await TimelineEditor.analyzeSequence(srtFallback);

            if (self._cancelRequested) {
                self._updateStatusBar('Cancelled', 0);
                self.hideLoading();
                return;
            }

            if (!result.success) {
                self._setStepCard('step-silence', 'error');
                self._setStepCard('step-transcribe', 'error');
                self._setStepCard('step-ai-decisions', 'error');
                self._updateStatusBar('Analysis failed', 0);
                self.showError(result.error || 'Analysis failed — check provider settings.');
                return;
            }

            // All three layers completed successfully
            self._setStepCard('step-silence', 'done',
                (result.silenceMarked || 0) + ' silences', 'done');
            self._setStepCard('step-transcribe', 'done', '', 'done');
            self._setStepCard('step-ai-decisions', 'done',
                result.editPlan ? result.editPlan.segments.length + ' decisions' : '', 'done');

            self._pendingEditPlan = result.editPlan;

            var commitBtn  = document.getElementById('commitEditsBtn');
            var commitHint = document.getElementById('commitEditsHint');
            if (commitBtn) commitBtn.disabled = false;
            if (commitHint) {
                var n = result.silenceMarked || 0;
                commitHint.textContent = n + ' silence marker' + (n === 1 ? '' : 's') +
                    ' placed — review in the timeline, then commit.';
                commitHint.style.display = '';
            }

            self._updateStatusBar('Analysis complete — ' + (result.silenceMarked || 0) + ' markers', 100);
            self.hideLoading();
            Logger.info('Timeline analysis complete — ' + result.editPlan.segments.length + ' segment(s)');
        } catch (e) {
            Logger.error('startTimelineAnalysis: ' + e.message);
            self._setStepCard('step-silence', 'error');
            self.showError('Analysis failed: ' + e.message);
            self._updateStatusBar('Error', 0);
        }
    },

    cancelAnalysis: function() {
        this._cancelRequested = true;
        this.hideLoading();
        var cancelBtn = document.getElementById('cancelAnalysisBtn');
        if (cancelBtn) cancelBtn.style.display = 'none';
        this._resetEditSteps();
        this._updateStatusBar('Cancelled', 0);
        Logger.info('Analysis cancelled');
    },

    commitEdits: async function() {
        var self = this;

        if (!self._pendingEditPlan) {
            self.showError('Run Analyze first — no pending edit plan.');
            return;
        }

        self._updateStatusBar('Committing edits…', 50);
        self.showLoading('Applying cuts…');

        try {
            var result = await TimelineEditor.commitEdits(self._pendingEditPlan);

            if (result.success) {
                self._pendingEditPlan = null;
                var n = result.cutsApplied;
                var commitHint = document.getElementById('commitEditsHint');
                if (commitHint) {
                    commitHint.textContent = n + ' cut' + (n === 1 ? '' : 's') + ' applied. Undo with Ctrl+Z.';
                    commitHint.classList.add('success');
                }
                self._updateStatusBar(n + ' cuts applied', 100);
                var commitBtn = document.getElementById('commitEditsBtn');
                if (commitBtn) commitBtn.disabled = true;
            } else {
                var bridgeMsg = result.timedOut
                    ? 'CEP bridge timed out — check timeline before retrying.'
                    : 'No clips deleted. ' + CONSTANTS.MESSAGES.BRIDGE_MISSING;
                self.showError('Commit finished but ' + bridgeMsg);
                self._updateStatusBar('Commit error', 0);
            }
        } catch (e) {
            Logger.error('commitEdits: ' + e.message);
            self.showError('Commit failed: ' + e.message);
            self._updateStatusBar('Error', 0);
        }

        self.hideLoading();
    },

    // ── B-roll ────────────────────────────────────────────────────────

    async suggestBroll() {
        const btn      = document.getElementById('suggestBrollBtn');
        const placeBtn = document.getElementById('placeBrollBtn');
        const log      = document.getElementById('brollLog');
        if (!log) return;

        btn.disabled    = true;
        btn.textContent = '⏳ Matching…';
        if (placeBtn) placeBtn.disabled = true;
        log.innerHTML     = '';
        log.style.display = 'block';

        this._setStepCard('step-vision-classify', 'active');
        this._updateStatusBar('Classifying clips…', 20);

        const addEntry = (icon, msg, color) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:flex-start;gap:6px;padding:4px 8px;' +
                                'border-bottom:0.5px solid rgba(255,255,255,0.05);';
            row.innerHTML = '<span style="flex-shrink:0;line-height:1.6">' + icon + '</span>' +
                            '<span style="color:' + (color || 'var(--text-2)') + ';font-size:11px;line-height:1.6;word-break:break-all">' +
                            msg + '</span>';
            log.appendChild(row);
            log.scrollTop = log.scrollHeight;
        };

        try {
            addEntry('🔍', 'Fetching project clips and matching to transcript…');
            const result = await BrollPlacer.suggestBroll();

            this._setStepCard('step-vision-classify', 'done');
            this._setStepCard('step-suggest-placements', 'active');

            if (!result.success) {
                addEntry('❌', result.error || 'Failed', 'var(--danger)');
                this._setStepCard('step-suggest-placements', 'error');
                this._updateStatusBar('B-roll suggestion failed', 0);
            } else {
                const placements = result.plan.placements;
                if (placements.length === 0) {
                    addEntry('⚠', 'AI found no suitable B-roll moments. Check transcript and clips.', 'var(--warning)');
                    this._setStepCard('step-suggest-placements', 'error');
                } else {
                    addEntry('✅', 'AI suggested ' + placements.length + ' placement(s) — review then click Place.', 'var(--success)');
                    for (var i = 0; i < placements.length; i++) {
                        const p = placements[i];
                        const dur = (p.durationSeconds || 5).toFixed(1);
                        addEntry('🎬', p.clipName + ' @ ' + p.atSeconds.toFixed(1) + 's (' + dur + 's) — ' + (p.reason || ''), 'var(--ai-cyan)');
                    }
                    this._setStepCard('step-suggest-placements', 'done',
                        placements.length + ' placements', 'done');
                    if (placeBtn) placeBtn.disabled = false;
                    this._updateStatusBar(placements.length + ' B-roll suggestions ready', 80);
                }
            }
        } catch (e) {
            addEntry('❌', 'Error: ' + e.message, 'var(--danger)');
            this._setStepCard('step-vision-classify', 'error');
        }

        btn.disabled    = false;
        btn.textContent = '🎬 Suggest B-roll';
    },

    async commitBroll() {
        const btn  = document.getElementById('placeBrollBtn');
        const log  = document.getElementById('brollLog');
        if (!log || !BrollPlacer._lastPlan || !BrollPlacer._lastPlan.placements.length) return;

        btn.disabled    = true;
        btn.textContent = '⏳ Placing…';
        this._setStepCard('step-place-v2', 'active');
        this._updateStatusBar('Placing B-roll…', 60);

        const addEntry = (icon, msg, color) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:flex-start;gap:6px;padding:4px 8px;' +
                                'border-bottom:0.5px solid rgba(255,255,255,0.05);';
            row.innerHTML = '<span style="flex-shrink:0;line-height:1.6">' + icon + '</span>' +
                            '<span style="color:' + (color || 'var(--text-2)') + ';font-size:11px;line-height:1.6;word-break:break-all">' +
                            msg + '</span>';
            log.appendChild(row);
            log.scrollTop = log.scrollHeight;
        };

        try {
            addEntry('🎬', 'Placing B-roll on V2…');
            const result = await BrollPlacer.commitBroll(BrollPlacer._lastPlan);

            if (result.placed > 0) {
                addEntry('🎉', 'Placed ' + result.placed + '/' + result.total + ' clip(s) on V2.', 'var(--success)');
                this._setStepCard('step-place-v2', 'done', result.placed + ' placed', 'done');
                this._updateStatusBar(result.placed + ' B-roll clips placed', 100);
            } else {
                addEntry('⚠', 'No clips placed. Verify CEP bridge panel is open (Window → Extensions → Ambar Bridge).', 'var(--warning)');
                this._setStepCard('step-place-v2', 'error');
                this._updateStatusBar('B-roll placement failed', 0);
            }

            for (var i = 0; i < result.errors.length; i++) {
                addEntry('❌', result.errors[i], 'var(--danger)');
            }
        } catch (e) {
            addEntry('❌', 'Error: ' + e.message, 'var(--danger)');
            this._setStepCard('step-place-v2', 'error');
        }

        btn.disabled    = false;
        btn.textContent = '✅ Place on timeline';
    },

    // ── Captions ──────────────────────────────────────────────────────

    selectCaptionTemplate(templateName) {
        this._captionTemplate = templateName;

        document.querySelectorAll('.template-card').forEach(function(card) {
            card.classList.toggle('selected', card.dataset.template === templateName);
        });

        Logger.debug('[Captions] Template selected: ' + templateName);
    },

    async openMogrtPicker() {
        var self = this;
        try {
            var result = await this._openFilePicker(['mogrt'], true);
            if (result) {
                self._mogrtPath = result.nativePath || result.path || result.name;
                var input = document.getElementById('mogrtPathInput');
                if (input) input.value = self._mogrtPath;
                Logger.info('[Captions] MOGRT selected: ' + self._mogrtPath);
            }
        } catch (e) {
            self.showError('Could not open file: ' + e.message);
        }
    },

    generateCaptions: async function() {
        var self = this;
        var btn  = document.getElementById('generateCaptionsBtn');
        var hint = document.getElementById('captionsHint');

        // Get transcript words from the last analysis
        var words = UIState.getState('transcriptWords');
        if (!words || words.length === 0) {
            var srtTranscript = UIState.getState('srtTranscript');
            if (srtTranscript && srtTranscript.words) words = srtTranscript.words;
        }
        // Primary source: Whisper output stored in TimelineEditor (BigInt ticks → ms)
        if ((!words || words.length === 0) &&
            typeof TimelineEditor !== 'undefined' &&
            TimelineEditor._lastTranscriptWords &&
            TimelineEditor._lastTranscriptWords.length > 0) {
            var tps = Number(CONSTANTS.TICKS_PER_SECOND);
            words = TimelineEditor._lastTranscriptWords.map(function(w) {
                return {
                    word:    w.word,
                    startMs: Math.round(Number(w.startTicks) * 1000 / tps),
                    endMs:   Math.round(Number(w.endTicks)   * 1000 / tps),
                };
            });
        }

        if (!words || words.length === 0) {
            self.showError('No transcript available — run Analyze first to generate word timestamps.');
            return;
        }

        if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating…'; }
        if (hint) hint.style.display = 'none';
        self._updateStatusBar('Generating SRT…', 30);

        try {
            // Layer 1: generate SRT string
            const srtString = CaptionEngine.generateSRT(words);
            if (!srtString) {
                self.showError('Caption generation produced empty output.');
                return;
            }

            // Layer 2: write to temp dir
            const writeResult = await CaptionEngine.writeSRTToTemp(srtString);
            if (!writeResult.success) {
                self.showError('Could not write SRT file: ' + writeResult.error);
                return;
            }

            self._updateStatusBar('Applying to timeline…', 70);

            // Layer 3: custom .mogrt path uses MOGRT placement; all others use SRT caption track
            var applyResult;
            if (this._captionTemplate === 'custom' && this._mogrtPath) {
                applyResult = await CaptionEngine.importCustomMogrt(this._mogrtPath, words);
            } else {
                applyResult = await CaptionEngine.applyToTimeline(
                    writeResult.path, this._captionTemplate, null
                );
            }

            if (!applyResult.success) {
                self.showError('Caption track creation failed: ' + applyResult.error);
                self._updateStatusBar('Caption error', 0);
                return;
            }

            // Store SRT string for export
            UIState.setState('lastSrtString', srtString);

            if (hint) {
                hint.textContent = 'Caption track added to timeline. Export SRT for further editing.';
                hint.style.display = '';
            }
            self._updateStatusBar('Captions applied to timeline', 100);
            Logger.info('[Captions] Done — caption track created');
        } catch (e) {
            Logger.error('generateCaptions: ' + e.message);
            self.showError('Caption generation failed: ' + e.message);
            self._updateStatusBar('Error', 0);
        }

        if (btn) { btn.disabled = false; btn.textContent = '💬 Generate captions'; }
    },

    exportSrt: async function() {
        var self = this;

        // Try to use a cached SRT or generate fresh
        var srtString = UIState.getState('lastSrtString');
        if (!srtString) {
            var words = UIState.getState('transcriptWords');
            if (!words || words.length === 0) {
                var srtTranscript = UIState.getState('srtTranscript');
                if (srtTranscript && srtTranscript.words) words = srtTranscript.words;
            }
            // Fallback: Whisper output stored in TimelineEditor (BigInt ticks → ms)
            if ((!words || words.length === 0) &&
                typeof TimelineEditor !== 'undefined' &&
                TimelineEditor._lastTranscriptWords &&
                TimelineEditor._lastTranscriptWords.length > 0) {
                var tps = Number(CONSTANTS.TICKS_PER_SECOND);
                words = TimelineEditor._lastTranscriptWords.map(function(w) {
                    return {
                        word:    w.word,
                        startMs: Math.round(Number(w.startTicks) * 1000 / tps),
                        endMs:   Math.round(Number(w.endTicks)   * 1000 / tps),
                    };
                });
            }
            if (!words || words.length === 0) {
                self.showError('No transcript available — run Analyze first.');
                return;
            }
            srtString = CaptionEngine.generateSRT(words);
        }

        if (!srtString) {
            self.showError('Could not generate SRT from transcript.');
            return;
        }

        try {
            var result = await self._saveFile(srtString, 'ambar_captions.srt', 'srt');
            if (result) {
                self._updateStatusBar('SRT saved', 100);
                Logger.info('[Captions] SRT exported to ' + (result.nativePath || result.name));
            }
        } catch (e) {
            self.showError('Export failed: ' + e.message);
        }
    },

    // ── Organise ──────────────────────────────────────────────────────

    async organizeProjectBins() {
        const btn = document.getElementById('organizeBinsBtn');
        const log = document.getElementById('organizeLog');
        if (!log) return;

        btn.disabled    = true;
        btn.textContent = '⏳ Organizing…';
        log.innerHTML   = '';
        log.style.display = 'block';

        this._setStepCard('step-vision-scan', 'active');
        this._updateStatusBar('Vision scanning clips…', 20);

        const addEntry = (icon, msg, color) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:flex-start;gap:6px;padding:4px 8px;' +
                                'border-bottom:0.5px solid rgba(255,255,255,0.05);animation:ambar-fadein 0.15s ease';
            row.innerHTML = '<span style="flex-shrink:0;line-height:1.6">' + icon + '</span>' +
                            '<span style="color:' + (color || 'var(--text-2)') + ';font-size:11px;line-height:1.6;word-break:break-all">' +
                            msg + '</span>';
            log.appendChild(row);
            log.scrollTop = log.scrollHeight;
        };

        const self = this;

        function onProgress(e) {
            if (e.type === 'start') {
                addEntry('📋', 'Found ' + e.total + ' clip(s) — starting Pass 1 (vision descriptions)…');
            } else if (e.type === 'pass1-start') {
                addEntry('🚀', 'Extracting frames in parallel…');
            } else if (e.type === 'extracting') {
                addEntry('🎬', '[' + e.index + '/' + e.total + '] ' + e.name + ' — extracting frame…');
            } else if (e.type === 'describing') {
                addEntry('👁', '[' + e.index + '/' + e.total + '] ' + e.name + ' — vision describing…');
            } else if (e.type === 'described') {
                addEntry('💬', '[' + e.index + '/' + e.total + '] ' + e.name + ': ' + (e.description || '…'), 'var(--text-2)');
            } else if (e.type === 'classifying-all') {
                self._setStepCard('step-vision-scan', 'done');
                self._setStepCard('step-create-bins', 'active');
                self._updateStatusBar('Creating bins…', 70);
                addEntry('🧠', 'Pass 2 — classifying all ' + e.total + ' clip(s)…', 'var(--ai-cyan)');
            } else if (e.type === 'classified') {
                var confStr = (e.confidence > 0) ? ' (' + (e.confidence * 100).toFixed(0) + '%)' : '';
                addEntry('📁', e.name + ' → ' + e.binName + confStr, 'var(--ai-cyan)');
            } else if (e.type === 'skip') {
                addEntry('⚠', '[' + e.index + '/' + e.total + '] ' + e.name + ' skipped — ' + e.reason, 'var(--warning)');
            } else if (e.type === 'creating-bin') {
                addEntry('📂', 'Creating bin ' + e.binName + ' (' + e.count + ' clip(s))…');
            } else if (e.type === 'bin-done') {
                addEntry('✅', 'Moved ' + e.count + ' clip(s) → ' + e.binName, 'var(--success)');
            } else if (e.type === 'bin-error') {
                addEntry('❌', e.binName + ' failed: ' + e.error, 'var(--danger)');
            } else if (e.type === 'done') {
                const summary = e.bins
                    .filter(function(b) { return b.success; })
                    .map(function(b) { return b.binName; })
                    .join(', ');
                if (e.totalMoved > 0) {
                    addEntry('🎉', 'Done — ' + e.totalMoved + ' clip(s) organized' + (summary ? ' into ' + summary : ''), 'var(--success)');
                    self._setStepCard('step-create-bins', 'done', e.totalMoved + ' clips moved', 'done');
                    self._updateStatusBar(e.totalMoved + ' clips organized', 100);
                } else {
                    addEntry('⚠', 'Done — 0 clips moved. Check Ollama is running with llava pulled.', 'var(--warning)');
                    self._setStepCard('step-create-bins', 'error');
                }
            }
        }

        try {
            await ProjectOrganizer.organizeProjectClips(onProgress);
        } catch (e) {
            addEntry('❌', 'Error: ' + e.message, 'var(--danger)');
            this._setStepCard('step-vision-scan', 'error');
        }

        btn.disabled    = false;
        btn.textContent = '📁 Organise project bins';
    },

    // ── Settings ──────────────────────────────────────────────────────

    toggleDebugMode() {
        const cb = document.getElementById('enableDebug');
        const on = cb ? cb.checked : false;
        UIState.setState('debugEnabled', on);
        CONSTANTS.DEBUG = on;
        Logger.info('Debug mode: ' + (on ? 'ON' : 'OFF'));
    },

    saveSettings() {
        try {
            const provider = this._getProvider();
            UIState.updateSetting('apiKey',           this._getApiKey());
            UIState.updateSetting('aiProvider',       provider);
            UIState.updateSetting('aiModel',          this._getModel());
            UIState.updateSetting('baseUrl',          this._getBaseUrl());

            const wpEl = document.getElementById('whisperProvider');
            if (wpEl) UIState.updateSetting('whisperProvider', wpEl.value);

            const vmEl = document.getElementById('visionModel');
            if (vmEl) UIState.updateSetting('visionModel', vmEl.value);

            localStorage.setItem('pluginSettings', JSON.stringify(UIState.getSettings()));
            CONSTANTS.AI_PROVIDER = provider;
            this._initAIService();
            this._updateStatusBar('Settings saved', 100);
            setTimeout(() => this._updateStatusBar('Ready', 0), 2000);
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
                const textEl = document.getElementById(key + 'Input') || document.getElementById(key);
                if (textEl && textEl.tagName === 'INPUT' && textEl.type !== 'range') {
                    textEl.value = value;
                }
            }

            if (settings.aiProvider || CONSTANTS.AI_PROVIDER) {
                const provEl = document.getElementById('aiProvider');
                const displayProvider = CONSTANTS.AI_PROVIDER || settings.aiProvider;
                if (provEl) provEl.value = displayProvider;
                CONSTANTS.AI_PROVIDER = displayProvider;
                this._updateProviderUI(displayProvider);
            }
            if (settings.aiModel || CONSTANTS.AI_MODEL) {
                const modEl = document.getElementById('aiModel');
                const displayModel = CONSTANTS.AI_MODEL || settings.aiModel;
                if (modEl) modEl.value = displayModel;
            }
            if (settings.baseUrl) {
                const urlEl = document.getElementById('baseUrlInput');
                if (urlEl) urlEl.value = settings.baseUrl;
            }
            if (settings.whisperProvider) {
                const wpEl = document.getElementById('whisperProvider');
                if (wpEl) wpEl.value = settings.whisperProvider;
                CONSTANTS.WHISPER_PROVIDER = settings.whisperProvider;
            }
            if (settings.visionModel) {
                const vmEl = document.getElementById('visionModel');
                if (vmEl) vmEl.value = settings.visionModel;
                CONSTANTS.VISION_MODEL = settings.visionModel;
            }

            AIService.initialize({
                provider: CONSTANTS.AI_PROVIDER || settings.aiProvider || 'ollama',
                apiKey:   settings.apiKey  || '',
                model:    CONSTANTS.AI_MODEL || settings.aiModel || '',
                baseUrl:  settings.baseUrl || '',
            });

            Logger.debug('Settings restored: provider=' +
                (CONSTANTS.AI_PROVIDER || settings.aiProvider || 'ollama'));
        } catch (e) {
            Logger.error('Failed to restore settings', e);
        }
    },

    // ── Diagnostic ────────────────────────────────────────────────────

    runDiagnostic() {
        const out = document.getElementById('diagnosticOut');
        if (!out) return;

        const lines = [];
        const ok  = (msg) => lines.push('✓ ' + msg);
        const err = (msg) => lines.push('<span class="diag-err">✗ ' + msg + '</span>');
        const wrn = (msg) => lines.push('<span class="diag-warn">⚠ ' + msg + '</span>');

        let ppro = null;
        try {
            ppro = require('premierepro');
            ok('require("premierepro") succeeded');
            ok('  exports: ' + Object.keys(ppro).join(', '));
        } catch (e) {
            err('require("premierepro") FAILED: ' + e.message);
        }

        if (typeof app !== 'undefined') {
            ok('Legacy global app also exists (version: ' + (app.version || '?') + ')');
        } else {
            wrn('Global app is undefined (expected in UXP)');
        }

        if (ppro) {
            let project = null;
            try {
                project = ppro.Project.getActiveProject();
                if (project) ok('Project.getActiveProject() → "' + (project.name || '(unnamed)') + '"');
                else         err('Project.getActiveProject() returned null');
            } catch (e) { err('Project error: ' + e.message); }
        }

        ok('AI provider: ' + this._getProvider() + ' / model: ' + (AIService.model || '(default)'));
        const key = this._getApiKey();
        if (this._getProvider() === 'ollama') ok('Ollama: no API key needed');
        else if (!key) wrn('No API key — add it in Settings');
        else ok('API key: ' + key.slice(0, 8) + '… (' + key.length + ' chars)');

        ok('Event listeners registered: ' + (PremiereAPI._eventListenersSetup ? 'YES' : 'NO'));

        out.innerHTML = lines.join('\n');
        out.style.display = 'block';
        Logger.info('Diagnostic ran — ' + lines.length + ' checks');
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
        this._updateStatusBar('Error', 0);
        Logger.error('UI error: ' + message);
    },

    // Legacy method kept for any code that still calls it
    updateStatus(status, message) {
        this._updateStatusBar(message || status, status === 'success' ? 100 : status === 'analyzing' ? 50 : 0);
    },

    // ── Utility ───────────────────────────────────────────────────────

    _formatTime(secs) {
        if (!secs || isNaN(secs)) return '0:00';
        var m = Math.floor(secs / 60);
        var s = Math.floor(secs % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
    },
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UIController;
}
