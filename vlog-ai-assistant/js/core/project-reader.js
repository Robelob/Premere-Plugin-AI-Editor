/* project-reader.js - Extract project and timeline metadata */

const ProjectReader = {
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

            clips.forEach(function(clip, index) {
                var props = PremiereAPI.getClipProperties(clip);
                if (props) {
                    metadata.clips.push({
                        index: index,
                        name:      props.name,
                        duration:  props.duration,
                        inPoint:   props.inPoint,
                        outPoint:  props.outPoint,
                        id:        props.id,
                    });
                }
            });

            var audioTracks = PremiereAPI.getAudioTracks(sequence);
            metadata.audioTracks = audioTracks.map(function(track, index) {
                return {
                    index:  index,
                    name:   track.name || ('Audio ' + index),
                    locked: track.isLocked || false,
                    muted:  track.isMuted  || false,
                };
            });

            Logger.info('Project metadata extracted: ' + metadata.clipCount + ' clips, ' + metadata.audioTracks.length + ' audio tracks');
            return metadata;
        } catch (e) {
            Logger.error('Error reading project metadata', e);
            return null;
        }
    },

    getAudioAnalysisData() {
        Logger.debug('Preparing audio analysis data...');
        try {
            var sequence = PremiereAPI.getActiveSequence();
            if (!sequence) return null;
            return {
                sequenceName:  sequence.name,
                totalDuration: PremiereAPI.getSequenceDuration(sequence),
                audioTracks:   PremiereAPI.getAudioTracks(sequence).length,
                ready:         true,
            };
        } catch (e) {
            Logger.error('Error preparing audio analysis', e);
            return null;
        }
    },

    formatForAPI(metadata) {
        if (!Validators.isValidProjectMetadata(metadata)) {
            Logger.error('Invalid metadata structure');
            return null;
        }
        return {
            project: {
                name:        metadata.sequenceName,
                duration_ms: metadata.sequenceDuration,
                clip_count:  metadata.clipCount,
            },
            clips: metadata.clips.map(function(clip) {
                return {
                    id:           clip.id,
                    name:         clip.name,
                    duration_ms:  clip.duration,
                    in_point_ms:  clip.inPoint,
                    out_point_ms: clip.outPoint,
                };
            }),
            audio_track_count: metadata.audioTracks.length,
        };
    },

    exportAsJSON(metadata) {
        try {
            return JSON.stringify(metadata, null, 2);
        } catch (e) {
            Logger.error('Error exporting metadata as JSON', e);
            return '';
        }
    },
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProjectReader;
}
