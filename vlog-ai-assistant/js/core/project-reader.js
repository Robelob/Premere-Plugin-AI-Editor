/* project-reader.js - Extract project and timeline metadata */

const ProjectReader = {
    /**
     * Read project metadata for AI analysis
     * @returns {object|null}
     */
    readProjectMetadata() {
        Logger.info('Reading project metadata...');
        
        try {
            const sequence = PremiereAPI.getActiveSequence();
            if (!sequence) {
                Logger.error('No active sequence available');
                return null;
            }
            
            const clips = PremiereAPI.getSequenceClips(sequence);
            const metadata = {
                sequenceName: sequence.name || 'Untitled Sequence',
                sequenceDuration: PremiereAPI.getSequenceDuration(sequence),
                clipCount: clips.length,
                clips: [],
                audioTracks: [],
                exportedAt: new Date().toISOString(),
            };
            
            // Extract clip metadata
            clips.forEach((clip, index) => {
                const props = PremiereAPI.getClipProperties(clip);
                if (props) {
                    metadata.clips.push({
                        index,
                        ...props,
                    });
                }
            });
            
            // Extract audio tracks info
            const audioTracks = PremiereAPI.getAudioTracks(sequence);
            metadata.audioTracks = audioTracks.map((track, index) => ({
                index,
                name: track.name || \Audio \\,
                locked: track.isLocked || false,
                muted: track.isMuted || false,
            }));
            
            Logger.info(\Project metadata extracted: \ clips, \ audio tracks\);
            return metadata;
        } catch (e) {
            Logger.error('Error reading project metadata', e);
            return null;
        }
    },
    
    /**
     * Get audio analysis data (placeholder for future audio processing)
     * @returns {object}
     */
    getAudioAnalysisData() {
        Logger.debug('Preparing audio analysis data...');
        
        try {
            const sequence = PremiereAPI.getActiveSequence();
            if (!sequence) return null;
            
            // Placeholder: In future, extract actual audio waveform data
            // For now, return basic structure
            return {
                sequenceName: sequence.name,
                totalDuration: PremiereAPI.getSequenceDuration(sequence),
                audioTracks: PremiereAPI.getAudioTracks(sequence).length,
                ready: true,
            };
        } catch (e) {
            Logger.error('Error preparing audio analysis', e);
            return null;
        }
    },
    
    /**
     * Format metadata for API consumption
     * @param {object} metadata - Raw metadata
     * @returns {object} Formatted for API
     */
    formatForAPI(metadata) {
        if (!Validators.isValidProjectMetadata(metadata)) {
            Logger.error('Invalid metadata structure');
            return null;
        }
        
        return {
            project: {
                name: metadata.sequenceName,
                duration_ms: metadata.sequenceDuration,
                clip_count: metadata.clipCount,
            },
            clips: metadata.clips.map(clip => ({
                id: clip.id,
                name: clip.name,
                duration_ms: clip.duration,
                in_point_ms: clip.inPoint,
                out_point_ms: clip.outPoint,
            })),
            audio_track_count: metadata.audioTracks.length,
        };
    },
    
    /**
     * Export metadata as JSON for review
     * @param {object} metadata
     * @returns {string} JSON string
     */
    exportAsJSON(metadata) {
        try {
            return JSON.stringify(metadata, null, 2);
        } catch (e) {
            Logger.error('Error exporting metadata as JSON', e);
            return '';
        }
    },
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProjectReader;
}
