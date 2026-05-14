# Architecture Decisions
> **For Claude:** These decisions are FINAL. Do not suggest alternatives or re-open these questions.
> They were made deliberately after researching the ecosystem. Implement what's here.

---

## Decision 1: Hybrid UXP + CEP Architecture

**What we chose:** UXP panel for all UI and AI logic. Hidden CEP bridge for destructive timeline operations that UXP cannot do yet.

**Why:** UXP cannot split/razor clips at arbitrary time positions (confirmed by Adobe — not in v1.0 roadmap). Without this, the plugin cannot edit the most common vlog recording pattern: one long continuous clip. CEP fills this gap using the QE DOM.

**Future migration path:** When UXP ships a split/razor API, replace `CEPBridge.razorAndDelete()` with the native UXP equivalent. The rest of the codebase is untouched. `// TODO(MIGRATE-TO-UXP)` comments mark these callsites.

**What stays in UXP forever:** Sequence detection, active sequence reading, marker placement, track/clip enumeration, AI service calls, UI rendering, state management.

**What stays in CEP until UXP catches up:** Razor/split at arbitrary time, ripple delete after razor, audio crossfade application.

---

## Decision 2: File-Based IPC Between UXP and CEP

**What we chose:** JSON files written to a shared temp directory. UXP writes commands, CEP polls and executes, writes responses.

**Why:** UXP and CEP run in completely separate JavaScript engines. There is no shared memory, no event bus, no `window` object shared between them. File I/O is the only reliable channel that works on both Mac and Windows across all Premiere versions.

**Polling interval:** 200ms in CEP (fast enough to feel instant, cheap enough to not impact performance).

**Timeout:** 10 seconds on the UXP side before declaring bridge failure.

**Temp dir location:** Plugin data folder (UXP) and `/tmp/ambar-bridge` (Mac) / `%TEMP%\ambar-bridge` (Windows). The CEP bridge reads the path from ExtendScript's `Folder.temp`.

---

## Decision 3: Reverse-Order Processing

**What we chose:** Always process edit segments from end-of-timeline toward start.

**Why:** When you delete a segment at time T, everything after T shifts left. If you then try to delete a segment at T+30s, it no longer exists at T+30s — it's now at T+30s minus the duration you just deleted. Reverse order means early-timeline segments are never affected by later deletions.

**This is non-negotiable.** Any implementation that processes segments forward will produce wrong cut positions on the second and subsequent cuts.

---

## Decision 4: Breath Padding on Every Cut

**What we chose:** Shrink each delete segment by 0.15s (≈ 38,102,400,000 ticks) on each side before executing the razor.

**Why:** Cutting exactly at the silence boundary produces robotic, clipped audio. A 0.15s buffer leaves the natural breath and room tone around each word boundary. FireCut recommends 250ms; we use 150ms as a tighter default, user-adjustable.

**Implementation:** Applied to the segment list BEFORE sorting and BEFORE sending to the bridge. The AI-suggested `startSeconds`/`endSeconds` values are shrunk by `PADDING_SECONDS` on each side.

**Minimum cut size check:** After padding, if `endSeconds - startSeconds < 0.3`, skip this segment — it's too short to cut meaningfully after padding.

---

## Decision 5: Story-First AI Prompting (Not Word-Level)

**What we chose:** AI groups speech into thematic blocks and only suggests cuts on silences > 1.2s or clear false starts. Returns segments to DELETE, not segments to keep.

**Why the old approach failed:** Word-level timestamp cutting produced "barcode" timelines — hundreds of micro-cuts that slow Premiere, sound robotic, and are impossible to manually review. FireCut's own docs warn against < 750ms minimum silence duration for this reason.

**The 1.2s threshold:** Below this, pauses are natural breathing and emphasis. Above this, they're dead air the viewer notices. Competitors use 500–800ms as default; we use 1.2s as default (adjustable down to 0.5s in UI).

---

## Decision 6: Two-Step Commit Flow (Non-Negotiable UX)

**What we chose:** Step 1 = Analyze (places markers, no edits). Step 2 = Commit (executes cuts).

**Why:** Competitors that auto-cut without review generate support requests when they cut something the editor wanted. The two-step flow is the professional safeguard. Markers let the editor scan the timeline and remove any suggested cut before committing.

**Implementation:** `UIController._pendingEditPlan` stores the parsed plan between steps. The Commit button is disabled until Analyze completes successfully. Closing the panel or navigating away clears `_pendingEditPlan`.

---

## Decision 7: Plugin Name is "Ambar"

The plugin is called **Ambar** (not "Premiere AI Assistant" or "Vlog AI"). This is the brand name used in prompts, UI copy, and the `CONSTANTS.NAME` value. Keep it consistent.

---

## Decision 8: No Bundler

The plugin uses plain `<script>` tags in `index.html`. No webpack, no rollup, no npm build step during development. This keeps the dev loop fast (edit file → reload panel in UDT) and removes a failure point.

If bundling is ever added, it goes in a separate `build/` step and the output goes to a `dist/` folder. The source in `js/` always remains readable.

---

## Decision 9: Module Load Order is Fixed

Scripts in `index.html` load in this exact order. Do not change it:

```
1. constants.js          — no dependencies
2. logger.js             — depends on CONSTANTS
3. error-handler.js      — depends on Logger
4. validators.js         — depends on Logger
5. cep-bridge.js         — depends on Logger, CONSTANTS (NEW — UXP side of IPC)
6. premiere-api.js       — depends on Logger, CONSTANTS
7. project-reader.js     — depends on PremiereAPI, Logger
8. ai-service.js         — depends on CONSTANTS, Logger, PromptTemplates
9. prompt-templates.js   — no dependencies
10. response-parser.js   — depends on Logger
11. timeline-editor.js   — depends on PremiereAPI, CEPBridge, Logger, CONSTANTS
12. ui-state.js          — depends on CONSTANTS
13. ui-controller.js     — depends on everything above
```

---

## Decision 10: What Gets Deleted

These files are dead weight and must be removed:
- `js/core/fcpxml-editor.js` — XML export workflow is gone
- `js/core/srt-parser.js` — SRT parsing is gone
- `js/core/xml-parser.js` — XML parsing is gone
- `js/utils/xml-shim.js` — XML polyfill is gone
- All `<script>` tags for the above in `index.html`

Do not try to "preserve" or "refactor" these files. Delete them.

---

## What This Plugin Is NOT

- Not a fully automatic editor — the user must review and approve cuts
- Not a replacement for the human editor's creative decisions
- Not a transcription service — it uses Premiere's native transcription
- Not trying to compete on every feature — silence removal + b-roll markers + captions is the v1 scope
