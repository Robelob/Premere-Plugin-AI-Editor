# Shipping Checklist
> **For Claude:** Use this to know what "done" looks like for each coding session.
> Check items off as they're completed. Never ship a session without verifying the relevant items.

---

## Phase 1 — Foundation (do this first, in order)

- [ ] **constants.js** — Add `TICKS_PER_SECOND`, `PADDING_SECONDS`, `MIN_SILENCE_SECONDS`, `MIN_CONFIDENCE`, `STATES`, `BRIDGE_TIMEOUT_MS`, `BRIDGE_POLL_MS`
- [ ] **cep-bridge.js** (NEW file) — UXP side of IPC: `sendCommand()`, `ping()`, `razorAndDelete()`, `_writeTempFile()`, `_pollForResponse()`, `_getTmpDir()`
- [ ] **premiere-api.js** — Add `timeToTicks()`, `ticksToSeconds()`, `getSequenceEditor()`, `addSilenceMarker()`, `addBrollMarker()`, updated `addSequenceMarker()` with color support
- [ ] **prompt-templates.js** — Rewrite `getSystemInstruction()` (story-first), add `getTimelineAnalysisPrompt(transcriptData)`, keep old methods for now
- [ ] **response-parser.js** — Add `parseEditPlan()` with confidence + duration filtering
- [ ] **timeline-editor.js** — Full rewrite: `analyzeAndMark()`, `commitEdits()`, `_applyPadding()`, `_sortReverse()`
- [ ] **ui-state.js** — Add new states: `MARKERS_PLACED`, `COMMITTING`, `COMMITTED`
- [ ] **ui-controller.js** — Wire up two-step button flow, store `_pendingEditPlan`, disable/enable Commit button

## Phase 2 — CEP Bridge

- [ ] **cep-bridge/CSXS/manifest.xml** — Hidden panel manifest, CEP 11, PPRO host
- [ ] **cep-bridge/index.html** — Minimal HTML loader
- [ ] **cep-bridge/js/main.js** — 200ms polling loop, calls `ambar_processPendingCommands`
- [ ] **cep-bridge/jsx/host.jsx** — All ExtendScript: `ambar_razorAtTime()`, `ambar_rippleDeleteRange()`, `ambar_applyAudioCrossfade()`, `ambar_processPendingCommands()`, `ambar_getTmpDir()`
- [ ] **CSInterface.js** — Copy from `Adobe-CEP/CEP-Resources` repo (v11)

## Phase 3 — Cleanup

- [ ] Delete `js/core/fcpxml-editor.js`
- [ ] Delete `js/core/srt-parser.js`
- [ ] Delete `js/core/xml-parser.js`
- [ ] Delete `js/utils/xml-shim.js`
- [ ] Remove deleted file `<script>` tags from `index.html`
- [ ] Add `cep-bridge.js` script tag to `index.html` (before `premiere-api.js`)
- [ ] Update `STRUCTURE.md` to reflect new file layout

## Phase 4 — Testing Gates

Before calling any phase "done", verify:

**Phase 1 gate:**
- [ ] `CONSTANTS.TICKS_PER_SECOND === 254016000000` (check in browser console of UXP panel)
- [ ] `ResponseParser.parseEditPlan()` correctly filters low-confidence segments
- [ ] `TimelineEditor.analyzeAndMark()` places red markers on the timeline ruler
- [ ] Commit button is disabled before Analyze runs
- [ ] Commit button enables after Analyze places markers

**Phase 2 gate:**
- [ ] CEP bridge panel appears in Premiere (`Window > Extensions > Ambar Bridge`)
- [ ] `CEPBridge.ping()` returns `{ success: true, message: 'bridge alive' }` within 2 seconds
- [ ] `CEPBridge.razorAndDelete([{startSeconds: 5, endSeconds: 7}])` creates visible cuts on a test clip
- [ ] Cuts happen in reverse order (verify by checking which cut appears in undo history first)
- [ ] Audio crossfade appears on the resulting edit point

**Full integration gate:**
- [ ] Record a 3-minute continuous talking-head clip
- [ ] Import into Premiere, drop on timeline
- [ ] Run Analyze → markers appear on silence gaps
- [ ] Run Commit → clips cut at marked positions
- [ ] Result has < 20 cuts total (not word-level barcode)
- [ ] No audible audio pops on playback
- [ ] Undo (Ctrl+Z) cleanly removes all cuts

---

## File Size Budget

Keep files focused. If a file exceeds these sizes, it needs to be split:

| File | Max lines |
|---|---|
| `premiere-api.js` | 400 |
| `timeline-editor.js` | 300 |
| `cep-bridge.js` | 200 |
| `host.jsx` | 400 |
| `ui-controller.js` | 600 |
| `prompt-templates.js` | 250 |
| `response-parser.js` | 200 |

---

## Common Mistakes to Avoid

1. **Forgetting `app.enableQE()` before any `qe.*` call** — QE state resets between evalScript calls
2. **Using seconds instead of ticks for UXP timeline math** — always ticks
3. **Using ES6+ syntax in host.jsx** — ExtendScript is ES3, will silently fail or throw
4. **Processing segments forward instead of reverse** — breaks timing of all subsequent cuts
5. **Not awaiting UXP proxy properties** — `sequence.name` not `await sequence.name` returns a Promise object, not the string
6. **Forgetting `return true` in executeTransaction callback** — without it, the transaction rolls back silently
7. **Writing to the wrong temp dir** — UXP and CEP must agree on the same path
8. **Not handling bridge ping failure gracefully** — if CEP bridge isn't installed, plugin should still work (markers only, no commits)

---

## Graceful Degradation

The plugin must work even if the CEP bridge is not installed. If `CEPBridge.ping()` fails:

- **Analyze** still works (UXP markers)
- **Commit** shows a message: "CEP Bridge not found. Please ensure the bridge panel is installed. See README for instructions."
- The Commit button is disabled (or shows a warning icon)
- Users can still use the markers as a manual cutting guide

Never crash or show a blank panel if CEP is missing.

---

## README Requirements (before first public release)

- [ ] Installation steps for BOTH the UXP plugin AND the CEP bridge
- [ ] How to enable CEP debug mode (registry key / defaults write)
- [ ] How to add an AI API key
- [ ] Supported Premiere versions (25.x Beta for UXP, 22.0+ for CEP)
- [ ] Known limitations (no trim of partial clips at segment edges)
- [ ] How to undo all edits (single Ctrl+Z per commit transaction)
