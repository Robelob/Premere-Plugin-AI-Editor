/* project-memory.js — Per-sequence persistent state
   Stored in the UXP plugin data folder as ambar_<sequenceId>.json */

const ProjectMemory = {
    _cache:      null,
    _sequenceId: null,

    async init(sequenceId) {
        this._sequenceId = sequenceId;
        this._cache = (await this._load(sequenceId)) || this._freshState(sequenceId);
        Logger.info('[Memory] Loaded state for sequence: ' + sequenceId);
        return this._cache;
    },

    getState() { return this._cache || {}; },

    async recordAnalysis(cuts, transcriptWords, silenceRanges) {
        if (!this._cache) return;
        this._cache.lastAnalyzed    = new Date().toISOString();
        this._cache.cutsApplied     = cuts || [];
        this._cache.transcriptWords = transcriptWords || [];
        this._cache.silenceRanges   = silenceRanges || [];
        this._cache.analysisDone    = true;
        await this._save();
        Logger.info('[Memory] Recorded analysis: ' + (cuts || []).length + ' cuts');
    },

    async recordBroll(placements) {
        if (!this._cache) return;
        this._cache.brollPlacements = placements || [];
        this._cache.brollDone       = true;
        await this._save();
        Logger.info('[Memory] Recorded B-roll: ' + (placements || []).length + ' placements');
    },

    async recordCaptions(template, lineCount) {
        if (!this._cache) return;
        this._cache.captionTemplate = template;
        this._cache.captionLines    = lineCount || 0;
        this._cache.captionsDone    = true;
        await this._save();
        Logger.info('[Memory] Recorded captions: ' + lineCount + ' lines, style=' + template);
    },

    async recordOrganise(bins) {
        if (!this._cache) return;
        this._cache.bins         = bins || {};
        this._cache.organiseDone = true;
        await this._save();
        Logger.info('[Memory] Recorded organisation');
    },

    async detectNewFootage(currentClipPaths) {
        if (!this._cache) return currentClipPaths || [];
        var known    = new Set(this._cache.knownClips || []);
        var newClips = (currentClipPaths || []).filter(function(p) { return !known.has(p); });

        this._cache.knownClips         = currentClipPaths || [];
        this._cache.newFootageDetected = newClips.length > 0;
        this._cache.newClipCount       = newClips.length;
        await this._save();

        if (newClips.length > 0) {
            Logger.info('[Memory] New footage detected: ' + newClips.length + ' clip(s)');
        }
        return newClips;
    },

    needsReanalysis() {
        var s = this._cache;
        if (!s || !s.analysisDone) return true;
        return s.newFootageDetected === true;
    },

    _freshState(sequenceId) {
        return {
            sequenceId:         sequenceId,
            version:            '1.0',
            created:            new Date().toISOString(),
            lastAnalyzed:       null,
            analysisDone:       false,
            cutsApplied:        [],
            transcriptWords:    [],
            silenceRanges:      [],
            brollDone:          false,
            brollPlacements:    [],
            captionsDone:       false,
            captionTemplate:    null,
            captionLines:       0,
            organiseDone:       false,
            bins:               {},
            knownClips:         [],
            newFootageDetected: false,
            newClipCount:       0,
        };
    },

    async _save() {
        try {
            var uxpMod  = require('uxp');
            var folder  = await uxpMod.storage.localFileSystem.getDataFolder();
            var fileName = 'ambar_' + this._sequenceId.replace(/[^a-zA-Z0-9]/g, '_') + '.json';
            var file    = await folder.createFile(fileName, { overwrite: true });
            await file.write(JSON.stringify(this._cache, null, 2));
        } catch (e) {
            Logger.warn('[Memory] Save failed: ' + e.message);
        }
    },

    async _load(sequenceId) {
        try {
            var uxpMod   = require('uxp');
            var folder   = await uxpMod.storage.localFileSystem.getDataFolder();
            var fileName = 'ambar_' + sequenceId.replace(/[^a-zA-Z0-9]/g, '_') + '.json';
            var entries  = await folder.getEntries();
            var file     = null;
            for (var i = 0; i < entries.length; i++) {
                if (entries[i].name === fileName) { file = entries[i]; break; }
            }
            if (!file) return null;
            var content = await file.read({ format: uxpMod.storage.formats.utf8 });
            return JSON.parse(content);
        } catch (e) {
            return null;
        }
    },
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProjectMemory;
}
