/* premiere-api.js - Wrapper for Premiere Pro DOM API */

const PremiereAPI = {
    /**
     * Get the active sequence
     * @returns {object|null}
     */
    getActiveSequence() {
        try {
            if (app && app.project && app.project.activeSequence) {
                return app.project.activeSequence;
            }
        } catch (e) {
            Logger.error('Error getting active sequence', e);
        }
        return null;
    },
    
    /**
     * Get all clips in a sequence
     * @param {object} sequence
     * @returns {array}
     */
    getSequenceClips(sequence) {
        try {
            if (!sequence || !sequence.videoTracks) return [];
            
            const clips = [];
            const videoTracks = sequence.videoTracks;
            
            for (let i = 0; i < videoTracks.numTracks; i++) {
                const track = videoTracks[i];
                for (let j = 0; j < track.clips.numClips; j++) {
                    clips.push(track.clips[j]);
                }
            }
            
            return clips;
        } catch (e) {
            Logger.error('Error getting sequence clips', e);
            return [];
        }
    },
    
    /**
     * Get audio tracks from sequence
     * @param {object} sequence
     * @returns {array}
     */
    getAudioTracks(sequence) {
        try {
            if (!sequence || !sequence.audioTracks) return [];
            
            const tracks = [];
            for (let i = 0; i < sequence.audioTracks.numTracks; i++) {
                tracks.push(sequence.audioTracks[i]);
            }
            
            return tracks;
        } catch (e) {
            Logger.error('Error getting audio tracks', e);
            return [];
        }
    },
    
    /**
     * Get clip properties
     * @param {object} clip
     * @returns {object}
     */
    getClipProperties(clip) {
        try {
            if (!clip) return null;
            
            return {
                name: clip.name || 'Unnamed',
                duration: clip.duration ? Math.round(clip.duration.seconds * 1000) : 0,
                inPoint: clip.inPoint ? Math.round(clip.inPoint.seconds * 1000) : 0,
                outPoint: clip.outPoint ? Math.round(clip.outPoint.seconds * 1000) : 0,
                id: clip.nodeID || '',
            };
        } catch (e) {
            Logger.error('Error getting clip properties', e);
            return null;
        }
    },
    
    /**
     * Delete a clip from track
     * @param {object} clip
     * @returns {boolean}
     */
    deleteClip(clip) {
        try {
            if (!clip) return false;
            clip.remove();
            return true;
        } catch (e) {
            Logger.error('Error deleting clip', e);
            return false;
        }
    },
    
    /**
     * Add marker to clip
     * @param {object} clip
     * @param {string} markerType - Type of marker (e.g., 'broll', 'silence')
     * @param {string} comment
     * @returns {boolean}
     */
    addMarker(clip, markerType, comment) {
        try {
            if (!clip || !clip.setColorLabel) return false;
            
            // Different color labels for different marker types
            const colorMap = {
                'broll': 4,    // Yellow
                'silence': 2,  // Red
                'keep': 3,     // Green
            };
            
            const color = colorMap[markerType] || 0;
            clip.setColorLabel(color);
            
            Logger.debug(\Marked clip as \\);
            return true;
        } catch (e) {
            Logger.error('Error adding marker', e);
            return false;
        }
    },
    
    /**
     * Get sequence duration
     * @param {object} sequence
     * @returns {number} Duration in milliseconds
     */
    getSequenceDuration(sequence) {
        try {
            if (!sequence || !sequence.duration) return 0;
            return Math.round(sequence.duration.seconds * 1000);
        } catch (e) {
            Logger.error('Error getting sequence duration', e);
            return 0;
        }
    },
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PremiereAPI;
}
