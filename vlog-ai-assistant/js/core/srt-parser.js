/* srt-parser.js — Parse SRT subtitle files into timed text segments

   SRT format:
     1
     00:00:01,234 --> 00:00:05,678
     First line of subtitle

     2
     00:00:06,000 --> 00:00:10,500
     Second subtitle text
*/

var SRTParser = {

    /* Parse SRT string → [{ index, start, end, text }]
       start/end are in seconds (float). */
    parse: function(srtString) {
        if (!srtString || !srtString.trim()) return [];

        // Normalize line endings
        var normalized = srtString.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        // Split into cue blocks at blank lines
        var blocks = normalized.trim().split(/\n{2,}/);
        var result = [];

        for (var i = 0; i < blocks.length; i++) {
            var cue = this._parseCue(blocks[i].trim());
            if (cue) result.push(cue);
        }

        return result;
    },

    _parseCue: function(block) {
        if (!block) return null;
        var lines = block.split('\n');
        if (lines.length < 2) return null;

        // Find the timecode line — it contains "-->"
        var tcIdx = -1;
        for (var i = 0; i < lines.length; i++) {
            if (lines[i].indexOf('-->') !== -1) { tcIdx = i; break; }
        }
        if (tcIdx === -1) return null;

        var times = this._parseTcLine(lines[tcIdx]);
        if (!times) return null;

        // Index is typically the line before the timecode
        var idx = tcIdx > 0 ? (parseInt(lines[tcIdx - 1].trim(), 10) || 0) : 0;

        // Text is everything after the timecode line, tags stripped
        var textLines = lines.slice(tcIdx + 1);
        var text = textLines
            .join(' ')
            .replace(/<[^>]+>/g, '')   // strip HTML-like tags
            .replace(/\{[^}]+\}/g, '') // strip {style} tags
            .trim();

        if (!text) return null;

        return {
            index: idx,
            start: times.start,
            end:   times.end,
            text:  text
        };
    },

    // Parse "00:00:01,234 --> 00:00:05,678" → { start, end } in seconds
    _parseTcLine: function(line) {
        var match = line.match(
            /(\d{1,2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,\.]\d{3})/
        );
        if (!match) return null;
        return {
            start: this._tsToSeconds(match[1]),
            end:   this._tsToSeconds(match[2])
        };
    },

    // "00:01:23,456" → 83.456
    _tsToSeconds: function(ts) {
        var normalized = ts.replace(',', '.');
        var parts = normalized.split(':');
        if (parts.length !== 3) return 0;
        var h = parseInt(parts[0], 10) || 0;
        var m = parseInt(parts[1], 10) || 0;
        var s = parseFloat(parts[2])   || 0;
        return h * 3600 + m * 60 + s;
    },

    // Seconds → "HH:MM:SS,mmm" (SRT format)
    toTimestamp: function(secs) {
        var ms  = Math.round((secs % 1) * 1000);
        var s   = Math.floor(secs % 60);
        var m   = Math.floor((secs / 60) % 60);
        var h   = Math.floor(secs / 3600);
        return (h  < 10 ? '0' : '') + h  + ':' +
               (m  < 10 ? '0' : '') + m  + ':' +
               (s  < 10 ? '0' : '') + s  + ',' +
               (ms < 100 ? (ms < 10 ? '00' : '0') : '') + ms;
    },

    // Full text dump (for prompt building)
    toPlainText: function(lines) {
        return lines.map(function(l) { return l.text; }).join(' ');
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SRTParser;
}
