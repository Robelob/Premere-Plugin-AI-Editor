/* timeline-editor.js - Apply edits to Premiere timeline via markers */

const TimelineEditor = {
    editHistory: [],

    /**
     * Add sequence markers at silence segment start points.
     * Markers appear on the timeline ruler so the editor can review and cut manually.
     * Also color-labels clips that overlap each silence range (red = silence).
     */
    markSilenceSegments(segments) {
        Logger.info('Marking silence segments...');

        if (!Array.isArray(segments) || segments.length === 0) {
            Logger.warn('No silence segments to mark');
            return { success: false, marked: 0 };
        }

        const sequence = PremiereAPI.getActiveSequence();
        if (!sequence) {
            Logger.error('No active sequence');
            return { success: false, marked: 0 };
        }

        let marked = 0;
        const clips = PremiereAPI.getSequenceClips(sequence);

        segments.forEach((segment) => {
            const startSec = segment.start / 1000;
            const endSec   = segment.end / 1000;
            const comment  = `Silence ${startSec.toFixed(1)}s – ${endSec.toFixed(1)}s (remove this gap)`;

            // Add a sequence timeline marker at the silence start
            const didAdd = PremiereAPI.addSequenceMarker(sequence, startSec, 'Silence', comment);
            if (didAdd) marked++;

            // Also color any overlapping clips red so they stand out in the timeline
            clips.forEach((clip) => {
                const props = PremiereAPI.getClipProperties(clip);
                if (!props) return;
                const clipStart = props.inPoint / 1000;
                const clipEnd   = props.outPoint / 1000;
                if (clipStart <= endSec && clipEnd >= startSec) {
                    PremiereAPI.addMarker(clip, 'silence', comment);
                }
            });

            this.editHistory.push({ type: 'mark-silence', segment, timestamp: Date.now() });
        });

        Logger.info(`Silence marking complete — ${marked} markers added`);
        return { success: true, marked };
    },

    /**
     * Add sequence markers at B-roll opportunity timestamps.
     * Marks show the suggestion text so the editor knows what footage to find.
     * Also color-labels the nearest clip yellow.
     */
    markBrollOpportunities(opportunities) {
        Logger.info('Marking B-roll opportunities...');

        if (!Array.isArray(opportunities) || opportunities.length === 0) {
            Logger.warn('No B-roll opportunities to mark');
            return { success: false, marked: 0 };
        }

        const sequence = PremiereAPI.getActiveSequence();
        if (!sequence) {
            Logger.error('No active sequence');
            return { success: false, marked: 0 };
        }

        let marked = 0;
        const clips = PremiereAPI.getSequenceClips(sequence);

        opportunities.forEach((opp) => {
            const timeSec   = opp.timestamp / 1000;
            const suggestion = opp.suggestion || opp.type || 'B-roll opportunity';
            const comment   = `B-roll @ ${timeSec.toFixed(1)}s: ${suggestion}`;

            const didAdd = PremiereAPI.addSequenceMarker(sequence, timeSec, 'B-Roll', comment);
            if (didAdd) marked++;

            // Color the clip that contains this timestamp yellow
            let nearestClip = null;
            let minDist = Infinity;
            clips.forEach((clip) => {
                const props = PremiereAPI.getClipProperties(clip);
                if (!props) return;
                const clipStart = props.inPoint / 1000;
                const clipEnd   = props.outPoint / 1000;
                if (timeSec >= clipStart && timeSec <= clipEnd) {
                    nearestClip = clip;
                    minDist = 0;
                } else if (minDist > 0) {
                    const dist = Math.min(Math.abs(timeSec - clipStart), Math.abs(timeSec - clipEnd));
                    if (dist < minDist) { minDist = dist; nearestClip = clip; }
                }
            });
            if (nearestClip) PremiereAPI.addMarker(nearestClip, 'broll', comment);

            this.editHistory.push({ type: 'mark-broll', opportunity: opp, timestamp: Date.now() });
        });

        Logger.info(`B-roll marking complete — ${marked} markers added`);
        return { success: true, marked };
    },

    /**
     * Apply silence and B-roll edits in one pass.
     */
    applyBatchEdits(edits) {
        Logger.info('Applying batch edits...');
        try {
            const results = {};
            if (edits.silence && edits.silence.length > 0) {
                results.silence = this.markSilenceSegments(edits.silence);
            }
            if (edits.broll && edits.broll.length > 0) {
                results.broll = this.markBrollOpportunities(edits.broll);
            }
            return { success: true, results, timestamp: new Date().toISOString() };
        } catch (e) {
            Logger.error('Error applying batch edits', e);
            return { success: false };
        }
    },

    undo() {
        if (this.editHistory.length === 0) {
            Logger.warn('No edits to undo');
            return false;
        }
        try {
            const lastEdit = this.editHistory.pop();
            Logger.info(`Undo: ${lastEdit.type}`);
            return true;
        } catch (e) {
            Logger.error('Error during undo', e);
            return false;
        }
    },

    getEditHistory() { return [...this.editHistory]; },

    clearHistory() {
        this.editHistory = [];
        Logger.debug('Edit history cleared');
    },
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = TimelineEditor;
}
