/* xml-shim.js — Lightweight XML parser for UXP (no DOMParser needed).
   Returns a DOM-compatible document: tagName, getAttribute, children,
   textContent, parentElement, querySelector, querySelectorAll.
   Selector support: "tag" and "parent child" (two-level descendant).
*/

var SimpleXML = (function () {

    /* ── Node ──────────────────────────────────────────────────────────── */

    function Node(tagName, attrs, parent) {
        this.tagName       = tagName ? tagName.toLowerCase() : '#document';
        this._attrs        = attrs || {};
        this.children      = [];
        this.textContent   = '';
        this.parentElement = parent || null;
    }

    Node.prototype.getAttribute = function (name) {
        var v = this._attrs[name];
        return (v !== undefined && v !== null) ? String(v) : null;
    };

    Node.prototype.querySelector = function (sel) {
        var all = this.querySelectorAll(sel);
        return all.length ? all[0] : null;
    };

    Node.prototype.querySelectorAll = function (sel) {
        var parts = sel.trim().split(/\s+/).map(function (p) { return p.toLowerCase(); });
        var acc = [];
        if (parts.length === 1) {
            _collect(this, parts[0], acc);
        } else {
            // "parent child": find all <child> inside any <parent>
            var parentTag = parts[parts.length - 2];
            var leafTag   = parts[parts.length - 1];
            var parents   = [];
            _collect(this, parentTag, parents);
            for (var i = 0; i < parents.length; i++) {
                _collect(parents[i], leafTag, acc);
            }
        }
        return acc;
    };

    function _collect(node, tagName, out) {
        for (var i = 0; i < node.children.length; i++) {
            var c = node.children[i];
            if (c.tagName === tagName) out.push(c);
            _collect(c, tagName, out);
        }
    }

    /* ── Attribute parser ───────────────────────────────────────────────── */

    var ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
    function decodeEntities(s) {
        return String(s).replace(/&[a-z]+;/gi, function (e) { return ENTITIES[e] || e; });
    }

    var ATTR_RE = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s\/>]+)))?/g;

    function parseAttrs(str) {
        var attrs = {};
        ATTR_RE.lastIndex = 0;
        var m;
        while ((m = ATTR_RE.exec(str)) !== null) {
            if (!m[1]) continue;
            var val = m[2] !== undefined ? m[2]
                    : m[3] !== undefined ? m[3]
                    : m[4] !== undefined ? m[4] : '';
            attrs[m[1]] = decodeEntities(val);
        }
        return attrs;
    }

    /* ── Find real closing '>' of a tag, skip over quoted attr values ───── */

    function findTagEnd(xml, from) {
        var i = from, len = xml.length;
        while (i < len) {
            var c = xml[i];
            if (c === '>') return i;
            if (c === '"') { i = xml.indexOf('"', i + 1); if (i < 0) return -1; }
            else if (c === "'") { i = xml.indexOf("'", i + 1); if (i < 0) return -1; }
            i++;
        }
        return -1;
    }

    /* ── Main parser ────────────────────────────────────────────────────── */

    function parse(xml) {
        var root  = new Node('#document', {}, null);
        var stack = [root];
        var pos   = 0;
        var len   = xml.length;

        while (pos < len) {
            var lt = xml.indexOf('<', pos);
            if (lt < 0) {
                var tail = xml.slice(pos).trim();
                if (tail && stack.length > 1) stack[stack.length - 1].textContent += tail;
                break;
            }

            // Flush any text before the tag
            if (lt > pos) {
                var txt = xml.slice(pos, lt).trim();
                if (txt && stack.length > 1) stack[stack.length - 1].textContent += txt;
            }
            pos = lt;

            // Identify special constructs by looking ahead
            var peek = xml.slice(pos, pos + 9);

            // CDATA section: <![CDATA[ ... ]]>
            if (peek.slice(0, 9) === '<![CDATA[') {
                var cdEnd = xml.indexOf(']]>', pos + 9);
                if (cdEnd < 0) { pos = len; break; }
                if (stack.length > 1) stack[stack.length - 1].textContent += xml.slice(pos + 9, cdEnd);
                pos = cdEnd + 3;
                continue;
            }

            // Comment: <!-- ... -->
            if (peek.slice(0, 4) === '<!--') {
                var cmEnd = xml.indexOf('-->', pos + 4);
                pos = cmEnd >= 0 ? cmEnd + 3 : len;
                continue;
            }

            // Processing instruction or <!DOCTYPE etc.
            if (xml[pos + 1] === '?' || xml[pos + 1] === '!') {
                var specEnd = xml.indexOf('>', pos + 2);
                pos = specEnd >= 0 ? specEnd + 1 : len;
                continue;
            }

            // Regular element — find real closing '>'
            var gt = findTagEnd(xml, pos + 1);
            if (gt < 0) { pos = len; break; }

            var inner = xml.slice(pos + 1, gt);
            pos = gt + 1;

            // Closing tag </name>
            if (inner.charAt(0) === '/') {
                if (stack.length > 1) stack.pop();
                continue;
            }

            // Strip trailing whitespace; detect self-close />
            var trimmed  = inner.replace(/\s+$/, '');
            var selfClose = trimmed.charAt(trimmed.length - 1) === '/';
            if (selfClose) trimmed = trimmed.slice(0, -1).replace(/\s+$/, '');

            // Split into tag name + attribute string
            var sp = trimmed.search(/\s/);
            var tagName = (sp < 0) ? trimmed.trim() : trimmed.slice(0, sp).trim();
            var attrStr = (sp < 0) ? '' : trimmed.slice(sp);
            if (!tagName) continue;

            var cur    = stack[stack.length - 1];
            var parent = (cur === root) ? null : cur;
            var node   = new Node(tagName, parseAttrs(attrStr), parent);
            cur.children.push(node);
            if (!selfClose) stack.push(node);
        }

        return root;
    }

    /* ── Public ─────────────────────────────────────────────────────────── */

    return {
        parseFromString: function (xmlString) {
            try {
                return parse(xmlString || '');
            } catch (e) {
                var errDoc = new Node('#document', {}, null);
                var errEl  = new Node('parsererror', {}, null);
                errEl.textContent = 'SimpleXML parse error: ' + e.message;
                errDoc.children.push(errEl);
                return errDoc;
            }
        }
    };

}());

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SimpleXML;
}
