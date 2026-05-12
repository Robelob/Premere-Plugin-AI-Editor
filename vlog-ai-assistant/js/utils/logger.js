/* logger.js - Logging utility */

const Logger = {
    _level() {
        return (typeof CONSTANTS !== 'undefined') ? CONSTANTS.LOG_LEVEL : 'info';
    },
    _debug() {
        return (typeof CONSTANTS !== 'undefined') && CONSTANTS.DEBUG;
    },

    info(message, data) {
        if (this._level() !== 'error' && this._level() !== 'warn') {
            data !== undefined
                ? console.log('[INFO]', message, data)
                : console.log('[INFO]', message);
        }
    },

    debug(message, data) {
        if (this._debug() || this._level() === 'debug') {
            data !== undefined
                ? console.log('[DEBUG]', message, data)
                : console.log('[DEBUG]', message);
        }
    },

    warn(message, data) {
        data !== undefined
            ? console.warn('[WARN]', message, data)
            : console.warn('[WARN]', message);
    },

    error(message, error) {
        error !== undefined
            ? console.error('[ERROR]', message, error)
            : console.error('[ERROR]', message);
    },

    group(label)  { console.group(label); },
    groupEnd()    { console.groupEnd(); },
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Logger;
}
