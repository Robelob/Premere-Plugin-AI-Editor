/* premiere-api.js - Premiere Pro UXP API wrapper
 *
 * In UXP panels, the global `app` (ExtendScript) is NOT available.
 * Premiere Pro is accessed via require('premierepro'), which is injected
 * by the UXP runtime when the plugin runs inside Premiere Pro.
 */

const PremiereAPI = {
    _ppro: null,
    _activeSequence: null,       // set by event listener when a sequence is activated
    _eventListenersSetup: false, // guard against double-registration

    // ── Module bootstrap ──────────────────────────────────────────────

    _load() {
        if (this._ppro) return this._ppro;
        try {
            this._ppro = require('premierepro');
            Logger.info('premierepro module loaded');
        } catch (e) {
            Logger.error('require("premierepro") failed — not running inside Premiere Pro', e);
        }
        return this._ppro;
    },

    isAvailable() {
        return !!this._load();
    },

    // ── Event-based sequence detection ───────────────────────────────
    //
    // ppro.Sequence itself has addEventListener/removeEventListener (visible
    // in the diagnostic), meaning it's a static EventTarget that fires events
    // when sequences are activated in the UI. We register for every plausible
    // event name and capture whichever one actually fires first.

    setupEventListeners(onSequenceActivated) {
        const ppro = this._load();
        if (!ppro || this._eventListenersSetup) return false;

        const self = this;
        let registered = 0;

        // ── Primary: ppro.eventRoot + ppro.SequenceEvent constants ──────
        // This is the documented PPro UXP event pattern.
        // ppro.SequenceEvent holds the event type identifiers; ppro.eventRoot
        // is the global dispatcher that fires them.
        if (ppro.eventRoot && ppro.SequenceEvent) {
            // Enumerate all keys on SequenceEvent (own + prototype)
            const seqEventKeys = [];
            try {
                for (var k in ppro.SequenceEvent) seqEventKeys.push(k);
                Object.getOwnPropertyNames(ppro.SequenceEvent).forEach(function(k) {
                    if (seqEventKeys.indexOf(k) === -1) seqEventKeys.push(k);
                });
            } catch (_) {}
            Logger.info('SequenceEvent keys: ' + seqEventKeys.join(', '));

            seqEventKeys.forEach(function(key) {
                try {
                    var eventType = ppro.SequenceEvent[key];
                    // Only register for leaf values (not Function prototype properties)
                    if (typeof eventType !== 'function' && eventType !== null && eventType !== undefined) {
                        var capturedKey = key; // capture for closure
                        ppro.eventRoot.addEventListener(eventType, function(e) {
                            Logger.info('SequenceEvent.' + capturedKey + ' fired!');
                            var wasEmpty = !self._activeSequence;

                            var seq = self._extractSequenceFromEvent(e, capturedKey);
                            if (seq) {
                                self._activeSequence = seq;
                                // Notify UI on explicit activation OR first detection ever
                                var shouldNotify = capturedKey === 'SEQUENCE_ACTIVATED' || wasEmpty;
                                if (shouldNotify && typeof onSequenceActivated === 'function') {
                                    onSequenceActivated(seq);
                                }
                                return;
                            }

                            // Only poll async on SEQUENCE_ACTIVATED (not on every clip click)
                            if (capturedKey === 'SEQUENCE_ACTIVATED') {
                                Logger.debug('Scheduling async polls after SEQUENCE_ACTIVATED');
                                [100, 400, 900, 2000].forEach(function(delay) {
                                    setTimeout(async function() {
                                        if (self._activeSequence) return;
                                        try {
                                            var delayed = await self.getActiveSequenceAsync();
                                            if (delayed) {
                                                Logger.info('Async poll (' + delay + 'ms) → ' + (delayed.name || delayed.id || 'sequence found'));
                                                self._activeSequence = delayed;
                                                if (typeof onSequenceActivated === 'function') onSequenceActivated(delayed);
                                            } else {
                                                Logger.debug('Async poll (' + delay + 'ms) still null');
                                            }
                                        } catch (err) {
                                            Logger.debug('Async poll (' + delay + 'ms) threw: ' + err.message);
                                        }
                                    }, delay);
                                });
                            }
                        });
                        registered++;
                    }
                } catch (e) {
                    Logger.debug('Could not register SequenceEvent.' + key + ': ' + e.message);
                }
            });
        } else {
            Logger.warn('ppro.eventRoot or ppro.SequenceEvent not available');
        }

        // ── Secondary: ppro.eventRoot with string names ──────────────────
        if (ppro.eventRoot && typeof ppro.eventRoot.addEventListener === 'function') {
            var stringCandidates = [
                'activated', 'sequenceActivated', 'sequenceOpen',
                'activesequencechanged', 'change', 'changed',
            ];
            stringCandidates.forEach(function(name) {
                try {
                    ppro.eventRoot.addEventListener(name, function(e) {
                        Logger.info('eventRoot string event "' + name + '" fired!');
                        var seq = self._extractSequenceFromEvent(e);
                        if (seq && typeof onSequenceActivated === 'function') onSequenceActivated(seq);
                    });
                    registered++;
                } catch (e) {
                    Logger.debug('eventRoot string "' + name + '" failed: ' + e.message);
                }
            });
        }

        this._eventListenersSetup = (registered > 0);
        Logger.info('Event listeners registered: ' + registered);
        return this._eventListenersSetup;
    },

    // Extract a sequence object from any known event payload shape
    _extractSequenceFromEvent(e, eventKey) {
        var self = this; // capture for nested closures (this changes inside function())
        var label = '[' + (eventKey || 'event') + ']';

        // Log actual VALUES of prototype properties (not just key names)
        try { Logger.debug(label + ' e.id=' + e.id + '  e.name=' + e.name + '  e.type=' + e.type); } catch (_) {}
        try {
            var t = e.target;
            Logger.debug(label + ' e.target typeof=' + typeof t +
                ' .id=' + (t && t.id) + ' .sequenceID=' + (t && t.sequenceID) +
                ' .name=' + (t && t.name) + ' .nodeID=' + (t && t.nodeID));
        } catch (err) { Logger.debug(label + ' e.target access threw: ' + err.message); }

        var seq = null;

        var checks = [
            function() { return e.sequence; },
            function() {
                var t = e.target;
                if (!t) return null;
                var hasSeqId = (t.sequenceID !== undefined && t.sequenceID !== null);
                var hasId    = (t.id !== undefined && t.id !== null && t.id !== '');
                var hasNode  = (t.nodeID !== undefined && t.nodeID !== null);
                var hasName  = (typeof t.name === 'string' && t.name.length > 0);
                return (hasSeqId || hasId || hasNode || hasName) ? t : null;
            },
            function() { return e.detail && (e.detail.sequenceID || e.detail.id || e.detail.name) ? e.detail : null; },
            function() { return e.detail && e.detail.sequence; },
            // e.id is non-trivial → e carries the sequence identity
            // Try queryCast(e) first to get a full Sequence interface proxy;
            // fall back to using e directly (has name/id but not videoTracks etc.)
            function() {
                var eid = e.id;
                if (eid === undefined || eid === null || eid === '' || eid === e.type) return null;
                Logger.debug(label + ' e.id=' + eid + ' — trying queryCast(e)');
                var ppro2 = self._load();
                if (ppro2 && ppro2.Sequence && typeof ppro2.Sequence.queryCast === 'function') {
                    try {
                        var cast = ppro2.Sequence.queryCast(e);
                        if (cast) { Logger.info(label + ' queryCast(e) succeeded'); return cast; }
                    } catch (qe) { Logger.debug(label + ' queryCast(e) threw: ' + qe.message); }
                }
                // queryCast failed — use e as a lightweight sequence reference
                Logger.debug(label + ' using e directly (name/id only, no videoTracks)');
                return e;
            },
        ];
        for (var i = 0; i < checks.length; i++) {
            try {
                var candidate = checks[i]();
                if (candidate) { seq = candidate; break; }
            } catch (err) {
                Logger.debug(label + ' check[' + i + '] threw: ' + err.message);
            }
        }

        // Last resort: if e.id and e.name are set, e IS the sequence carrier.
        // queryCast is handled inside checks[4]; reaching here means all checks returned null.
        if (!seq && e && e.id && typeof e.id === 'string' && e.id !== e.type) {
            Logger.info(label + ' using e as sequence (has id/name, queryCast unavailable)');
            seq = e;
        }

        if (seq) {
            Logger.info('Sequence captured from event: id=' + (seq.sequenceID || seq.id || '?') + ' name=' + (seq.name || '?'));
            this._activeSequence = seq;
        } else {
            Logger.debug(label + ' no sequence in payload — relying on async polls');
        }
        return seq;
    },

    // Poll all synchronous getters once (used as fallback after an event fires)
    _pollForSequence() {
        const ppro    = this._load();
        const project = this.getActiveProject();
        const self    = this;
        const attempts = [
            function() { return project && project.activeSequence; },
            function() { return project && typeof project.getActiveSequence === 'function' && project.getActiveSequence(); },
            function() { return ppro && ppro.Sequence && typeof ppro.Sequence.getActiveSequence === 'function' && ppro.Sequence.getActiveSequence(); },
            function() { return ppro && ppro.SequenceEditor && typeof ppro.SequenceEditor.getActiveSequence === 'function' && ppro.SequenceEditor.getActiveSequence(); },
            function() { return ppro && ppro.SequenceEditor && ppro.SequenceEditor.sequence; },
            function() { return ppro && ppro.SequenceEditor && ppro.SequenceEditor.activeSequence; },
            function() { return ppro && ppro.Timeline && typeof ppro.Timeline.getActiveSequence === 'function' && ppro.Timeline.getActiveSequence(); },
            // queryCast: cast the project itself to SequenceEditor interface
            function() {
                if (ppro && ppro.SequenceEditor && typeof ppro.SequenceEditor.queryCast === 'function') {
                    var ed = ppro.SequenceEditor.queryCast(project);
                    return ed && typeof ed.getActiveSequence === 'function' ? ed.getActiveSequence() : null;
                }
                return null;
            },
            // queryCast: cast project to Sequence directly
            function() {
                if (ppro && ppro.Sequence && typeof ppro.Sequence.queryCast === 'function') {
                    var s2 = ppro.Sequence.queryCast(project);
                    return s2;
                }
                return null;
            },
            // SourceMonitor — may expose the currently loaded sequence
            function() {
                if (ppro && ppro.SourceMonitor) {
                    var sm = typeof ppro.SourceMonitor.getInstance === 'function' ? ppro.SourceMonitor.getInstance() : null;
                    if (!sm && typeof ppro.SourceMonitor.getActiveSequence === 'function') return ppro.SourceMonitor.getActiveSequence();
                    if (sm && typeof sm.getActiveSequence === 'function') return sm.getActiveSequence();
                    if (sm && sm.activeSequence) return sm.activeSequence;
                }
                return null;
            },
        ];
        for (var i = 0; i < attempts.length; i++) {
            try {
                var s = attempts[i]();
                if (s && (s.sequenceID || s.name)) { this._activeSequence = s; return s; }
            } catch (_) {}
        }
        return null;
    },

    // Async version: awaits each call in case the UXP API returns Promises
    async getActiveSequenceAsync() {
        // Event-captured sequence takes priority
        if (this._activeSequence) return this._activeSequence;

        const ppro    = this._load();
        const project = this.getActiveProject();

        const asyncAttempts = [
            // Await the project getter itself (UXP bridge calls are async)
            async function() {
                var p = await ppro.Project.getActiveProject();
                if (!p) return null;
                Logger.debug('async project fetched: ' + (p.name || typeof p));
                return await p.activeSequence;
            },
            async function() {
                var p = await ppro.Project.getActiveProject();
                return (p && typeof p.getActiveSequence === 'function') ? await p.getActiveSequence() : null;
            },
            // Sync project reference (already fetched)
            async function() { return project ? await project.activeSequence : null; },
            async function() { return (project && typeof project.getActiveSequence === 'function') ? await project.getActiveSequence() : null; },
            // Sequence class static methods
            async function() { return (ppro && ppro.Sequence && typeof ppro.Sequence.getActiveSequence === 'function') ? await ppro.Sequence.getActiveSequence() : null; },
            // SequenceEditor
            async function() { return (ppro && ppro.SequenceEditor && typeof ppro.SequenceEditor.getActiveSequence === 'function') ? await ppro.SequenceEditor.getActiveSequence() : null; },
            async function() { return ppro && ppro.SequenceEditor ? await ppro.SequenceEditor.sequence : null; },
            async function() { return ppro && ppro.SequenceEditor ? await ppro.SequenceEditor.activeSequence : null; },
            // Try sequences collection (first item)
            async function() {
                var p2 = await ppro.Project.getActiveProject();
                if (!p2) return null;
                var seqs = await p2.sequences;
                if (!seqs) return null;
                var count = (seqs.numSequences !== undefined ? await seqs.numSequences : null) || (await seqs.length) || 0;
                if (count > 0) { Logger.debug('sequences collection count: ' + count); return seqs[0]; }
                return null;
            },
            // Try static lookup by the sequence ID we know from the event
            async function() {
                var knownId = self._activeSequence && (self._activeSequence.id || self._activeSequence.sequenceID);
                if (!knownId || !ppro.Sequence) return null;
                var methods = ['getSequence', 'getSequenceById', 'fromId', 'getById', 'findById', 'find'];
                for (var mi = 0; mi < methods.length; mi++) {
                    if (typeof ppro.Sequence[methods[mi]] === 'function') {
                        try {
                            var s2 = await ppro.Sequence[methods[mi]](knownId);
                            if (s2) { Logger.info('Sequence.' + methods[mi] + '(id) → found'); return s2; }
                        } catch (me) { Logger.debug('Sequence.' + methods[mi] + ' threw: ' + me.message); }
                    }
                }
                return null;
            },
        ];

        for (var i = 0; i < asyncAttempts.length; i++) {
            try {
                var s = await asyncAttempts[i]();
                if (s && (s.sequenceID || s.name)) {
                    Logger.info('getActiveSequenceAsync: async attempt #' + i + ' → ' + (s.name || s.sequenceID));
                    this._activeSequence = s;
                    return s;
                }
            } catch (e) {
                Logger.debug('async attempt #' + i + ' threw: ' + e.message);
            }
        }

        Logger.debug('getActiveSequenceAsync: all async attempts returned null');
        return null;
    },

    // ── Project ───────────────────────────────────────────────────────

    getActiveProject() {
        const ppro = this._load();
        if (!ppro) return null;
        try {
            return ppro.Project.getActiveProject();
        } catch (e) {
            Logger.error('Error getting active project', e);
            return null;
        }
    },

    // ── Sequence ──────────────────────────────────────────────────────

    getActiveSequence() {
        // Event-detected sequence takes priority
        if (this._activeSequence) {
            Logger.debug('getActiveSequence: returning event-captured sequence → ' + (this._activeSequence.name || this._activeSequence.sequenceID));
            return this._activeSequence;
        }
        // Fall back to synchronous polling (debug-level logging only — callers warn if needed)
        const found = this._pollForSequence();
        if (found) Logger.info('getActiveSequence: poll succeeded → ' + (found.name || found.sequenceID));
        return found;
    },

    /**
     * Return all sequences in the project.
     *
     * PPro UXP API: project.sequences is null in most versions.
     * Real approach: walk project.rootItem bin tree — sequences are ProjectItems.
     * Also tries project.sequences collection and SequenceUtils as backup.
     * Always includes activeSequence as guaranteed fallback.
     */
    getAllSequences() {
        const ppro    = this._load();
        const project = this.getActiveProject();
        if (!ppro || !project) return [];

        const out = [];

        // Strategy 1: project.sequences collection (works in older PPro)
        try {
            const col = project.sequences;
            if (col) {
                const count = (col.numSequences !== undefined && col.numSequences !== null) ? col.numSequences : (col.length !== undefined && col.length !== null ? col.length : 0);
                for (let i = 0; i < count; i++) {
                    const s = col[i];
                    if (s) out.push({ id: s.sequenceID || String(i), name: s.name || 'Sequence ' + i, sequence: s });
                }
                if (!out.length) {
                    try { for (const s of col) { if (s) out.push({ id: s.sequenceID || 'seq', name: s.name, sequence: s }); } } catch (_) {}
                }
            }
        } catch (_) {}

        // Strategy 2: walk the project bin tree (standard UXP PPro 22+ approach)
        if (!out.length) {
            try {
                if (project.rootItem) this._walkBin(project.rootItem, ppro, out);
            } catch (e) { Logger.debug('Bin walk failed: ' + e.message); }
        }

        // Strategy 3: SequenceUtils static helper
        if (!out.length) {
            try {
                const seqs = ppro.SequenceUtils && typeof ppro.SequenceUtils.getSequences === 'function'
                    ? ppro.SequenceUtils.getSequences()
                    : null;
                if (seqs) {
                    (Array.isArray(seqs) ? seqs : Array.from(seqs))
                        .forEach(s => out.push({ id: s.sequenceID, name: s.name, sequence: s }));
                }
            } catch (_) {}
        }

        // Strategy 4: ppro.Sequence as a direct collection (PPro 25+)
        if (!out.length) {
            try {
                const numSeq = ppro.Sequence && ppro.Sequence.numSequences;
                if (numSeq && numSeq > 0) {
                    for (let i = 0; i < numSeq; i++) {
                        try {
                            const s = ppro.Sequence[i];
                            if (s && !out.find(function(x) { return x.id === s.sequenceID; })) {
                                out.push({ id: s.sequenceID || String(i), name: s.name || 'Sequence ' + i, sequence: s });
                            }
                        } catch (_) {}
                    }
                }
            } catch (_) {}
        }

        // Strategy 5: SequenceEditor as collection source
        if (!out.length) {
            try {
                if (ppro.SequenceEditor && typeof ppro.SequenceEditor.getSequences === 'function') {
                    const seqs = ppro.SequenceEditor.getSequences();
                    if (seqs) {
                        const arr = Array.isArray(seqs) ? seqs : Array.from(seqs);
                        arr.forEach(function(s) {
                            if (s) out.push({ id: s.sequenceID || 'se', name: s.name || 'Sequence', sequence: s });
                        });
                    }
                }
            } catch (_) {}
        }

        // Always include the active sequence via all known patterns (deduplicated)
        const activeSeq = this.getActiveSequence();
        if (activeSeq) {
            // Use async-resolved values cached by UIController if sync props are unavailable
            const activeId   = activeSeq.sequenceID || activeSeq._resolvedId   || activeSeq.id   || 'active';
            const activeName = activeSeq.name        || activeSeq._resolvedName || 'Active Sequence';
            if (!out.find(function(s) { return s.id === activeId; })) {
                out.unshift({ id: activeId, name: activeName, sequence: activeSeq });
            }
        }

        Logger.info('getAllSequences → ' + out.length);
        return out;
    },

    /**
     * Walk the project bin tree recursively.
     * Sequences in Premiere Pro's UXP API are ProjectItems with type CLIP (1).
     * We try to extract a Sequence object from each non-bin item.
     */
    _walkBin(item, ppro, out) {
        try {
            const BIN  = 2;
            const ROOT = 3;

            if (item.type !== BIN && item.type !== ROOT) {
                // Try to get a Sequence object from this ProjectItem
                let seq = null;
                try { seq = typeof item.getLinkedComponent === 'function' ? item.getLinkedComponent() : null; } catch (_) {}
                if (!seq) {
                    try { seq = ppro.Sequence && typeof ppro.Sequence.fromProjectItem === 'function' ? ppro.Sequence.fromProjectItem(item) : null; } catch (_) {}
                }
                if (seq && seq.sequenceID) {
                    if (!out.find(s => s.id === seq.sequenceID)) {
                        out.push({ id: seq.sequenceID, name: seq.name || item.name, sequence: seq });
                    }
                    return;
                }
            }

            // Recurse into children (bins and root)
            const children = item.children;
            if (children) {
                const count = (children.numItems !== undefined && children.numItems !== null) ? children.numItems : (children.length !== undefined && children.length !== null ? children.length : 0);
                for (let i = 0; i < count; i++) {
                    try { this._walkBin(children[i], ppro, out); } catch (_) {}
                }
            }
        } catch (e) {
            Logger.debug('_walkBin: ' + e.message);
        }
    },

    getSequenceById(sequenceId) {
        const found = this.getAllSequences().find(s => s.id === sequenceId);
        return found ? found.sequence : null;
    },

    openSequence(sequence) {
        try {
            if (sequence && typeof sequence.open === 'function') {
                sequence.open();
                return true;
            }
        } catch (e) {
            Logger.error('Error opening sequence', e);
        }
        return false;
    },

    // ── Clips ─────────────────────────────────────────────────────────

    getSequenceClips(sequence) {
        try {
            if (!sequence) return [];
            // Try property access first, then method call (API varies by PPro version)
            var vt = null;
            try { vt = sequence.videoTracks; } catch (_) {}
            if (!vt && typeof sequence.getVideoTracks === 'function') {
                try { vt = sequence.getVideoTracks(); } catch (_) {}
            }
            if (!vt) return [];
            const clips = [];
            const count = (vt.numTracks !== undefined && vt.numTracks !== null) ? vt.numTracks : (vt.length !== undefined && vt.length !== null ? vt.length : 0);
            for (let i = 0; i < count; i++) {
                const track = vt[i];
                const clipCount = track && track.clips ? ((track.clips.numClips !== undefined && track.clips.numClips !== null) ? track.clips.numClips : (track.clips.length !== undefined ? track.clips.length : 0)) : 0;
                for (let j = 0; j < clipCount; j++) clips.push(track.clips[j]);
            }
            return clips;
        } catch (e) {
            Logger.error('Error getting sequence clips', e);
            return [];
        }
    },

    getAudioTracks(sequence) {
        try {
            if (!sequence) return [];
            var at = null;
            try { at = sequence.audioTracks; } catch (_) {}
            if (!at && typeof sequence.getAudioTracks === 'function') {
                try { at = sequence.getAudioTracks(); } catch (_) {}
            }
            if (!at) return [];
            const tracks = [];
            const count = (at.numTracks !== undefined && at.numTracks !== null) ? at.numTracks : (at.length !== undefined ? at.length : 0);
            for (let i = 0; i < count; i++) tracks.push(at[i]);
            return tracks;
        } catch (e) {
            Logger.error('Error getting audio tracks', e);
            return [];
        }
    },

    getClipProperties(clip) {
        try {
            if (!clip) return null;
            return {
                name:     clip.name || 'Unnamed',
                duration: clip.duration  ? Math.round(clip.duration.seconds  * 1000) : 0,
                inPoint:  clip.inPoint   ? Math.round(clip.inPoint.seconds   * 1000) : 0,
                outPoint: clip.outPoint  ? Math.round(clip.outPoint.seconds  * 1000) : 0,
                id:       clip.nodeID || '',
            };
        } catch (e) {
            Logger.error('Error getting clip properties', e);
            return null;
        }
    },

    // ── Markers ───────────────────────────────────────────────────────

    /**
     * Add a color label to a clip (red=silence, yellow=broll).
     */
    addMarker(clip, markerType, comment) {
        try {
            if (!clip || !clip.setColorLabel) return false;
            const colorMap = { broll: 4, silence: 2, keep: 3 };
            clip.setColorLabel(colorMap[markerType] || 0);
            return true;
        } catch (e) {
            Logger.error('Error labeling clip', e);
            return false;
        }
    },

    /**
     * Add a comment marker to the sequence timeline ruler.
     * UXP proxy properties are async — we must await sequence.markers.
     */
    async addSequenceMarker(sequence, timeInSeconds, name, comment) {
        try {
            if (!sequence) return false;

            // Try getting the markers collection — both sync and async
            var markers = null;
            try { markers = await sequence.markers; } catch (_) {}
            if (!markers && typeof sequence.getMarkers === 'function') {
                try { markers = await sequence.getMarkers(); } catch (_) {}
            }
            if (!markers) {
                Logger.warn('sequence.markers unavailable — marker at ' + timeInSeconds.toFixed(2) + 's skipped');
                return false;
            }

            var marker = await markers.createMarker(timeInSeconds);
            if (!marker) return false;
            try { marker.name     = name    || ''; } catch (_) {}
            try { marker.comments = comment || ''; } catch (_) {}
            Logger.debug('Marker added at ' + timeInSeconds.toFixed(2) + 's: ' + name);
            return true;
        } catch (e) {
            Logger.error('Error adding sequence marker', e);
            return false;
        }
    },

    // ── File import ───────────────────────────────────────────────────

    /**
     * Import a file (e.g. an FCPXML) into the active Premiere project.
     * The file path must be an absolute native path string.
     * Returns true on success, false if unavailable or failed.
     */
    async importFile(nativePath) {
        try {
            var ppro = this._load();
            if (!ppro) return false;

            // Resolve project — sync first, then async fallback
            var project = null;
            try { project = this.getActiveProject(); } catch (_) {}
            if (!project) {
                try { project = await ppro.Project.getActiveProject(); } catch (_) {}
            }
            if (!project) {
                Logger.warn('importFile: no active project');
                return false;
            }

            // Try every known import API shape across Premiere UXP versions
            var methods = [
                // Standard UXP API (Premiere 22+)
                async function() {
                    if (typeof project.importFiles === 'function') {
                        await project.importFiles([nativePath]);
                        return true;
                    }
                },
                // Singular form
                async function() {
                    if (typeof project.importFile === 'function') {
                        await project.importFile(nativePath);
                        return true;
                    }
                },
                // importMedia (seen in some versions)
                async function() {
                    if (typeof project.importMedia === 'function') {
                        await project.importMedia([nativePath]);
                        return true;
                    }
                },
                // ppro.Importer static
                async function() {
                    if (ppro.Importer && typeof ppro.Importer.importFiles === 'function') {
                        await ppro.Importer.importFiles([nativePath]);
                        return true;
                    }
                },
            ];

            for (var i = 0; i < methods.length; i++) {
                try {
                    var ok = await methods[i]();
                    if (ok) {
                        Logger.info('importFile: imported via method #' + i + ': ' + nativePath);
                        return true;
                    }
                } catch (me) {
                    Logger.debug('importFile method #' + i + ' threw: ' + me.message);
                }
            }

            Logger.warn('importFile: no import API available — open the file manually in Premiere (File → Import)');
            return false;
        } catch (e) {
            Logger.warn('importFile failed: ' + e.message);
            return false;
        }
    },

    getSequenceDuration(sequence) {
        try {
            if (!sequence) return 0;
            // Try .duration.seconds (property style)
            var dur = null;
            try { dur = sequence.duration; } catch (_) {}
            if (dur && dur.seconds !== undefined) return Math.round(dur.seconds * 1000);
            // Try .end (tick-based, PPro UXP v2)
            try { var endTicks = sequence.end; if (endTicks) return Math.round(endTicks / 254016000000 * 1000); } catch (_) {}
            // Try getDuration() method
            try { var d2 = typeof sequence.getDuration === 'function' ? sequence.getDuration() : null; if (d2 && d2.seconds !== undefined) return Math.round(d2.seconds * 1000); } catch (_) {}
            return 0;
        } catch (e) {
            Logger.error('Error getting sequence duration', e);
            return 0;
        }
    },
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PremiereAPI;
}
