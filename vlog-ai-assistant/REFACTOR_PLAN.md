# Refactor Plan: Native Timeline-First Workflow
> **For Claude:** This is the complete spec for the refactor. Read `PPRO_API_CHEATSHEET.md` first.  
> Do not start coding until you've read both documents.

---

## Goal

Move from **File-Based XML** → **Native Timeline-First** workflow.

Fix: audio popping, sync drift, "barcode" edits (too many word-level cuts).  
Keep: model-agnostic AI architecture, existing UI layout, marker-review safety step.

---

## File Map

```
js/
  ai/
    ai-service.js          ← KEEP, minor cleanup only
    gemini-service.js      ← KEEP (alias for ai-service)
    prompt-templates.js    ← REWRITE (story-first prompting)
    response-parser.js     ← EXTEND (new editPlan schema)
  core/
    premiere-api.js        ← EXTEND (add ticks helpers, transition, marker types)
    timeline-editor.js     ← REWRITE (reverse-order, padding, two-step commit)
    fcpxml-editor.js       ← DELETE (entire file)
    srt-parser.js          ← DELETE (entire file)
    xml-parser.js          ← DELETE (entire file)
    project-reader.js      ← KEEP (reads sequence metadata for AI context)
  ui/
    ui-controller.js       ← EXTEND (wire up Analyze → Commit two-step buttons)
    ui-state.js            ← EXTEND (add ANALYZING / MARKERS_PLACED / COMMITTED states)
  utils/
    constants.js           ← EXTEND (add TICKS_PER_SECOND, PADDING_TICKS)
    xml-shim.js            ← DELETE (no longer needed)
```

---

## Constants to Add (`constants.js`)

```js
// Ticks
TICKS_PER_SECOND: 254016000000,   // exact PPro constant — BigInt in use
PADDING_TICKS: 38102400000,       // ~0.15s breath padding per keep segment
CROSSFADE_FRAMES: 2,              // 2-frame Constant Power on every new cut

// Edit thresholds
MIN_SILENCE_SECONDS: 1.2,         // AI must not suggest cuts shorter than this
MIN_CONFIDENCE: 0.75,             // discard AI suggestions below this score

// UI states
STATES: {
  READY:          'ready',
  ANALYZING:      'analyzing',
  MARKERS_PLACED: 'markers_placed',  // after Analyze, before Commit
  COMMITTING:     'committing',
  COMMITTED:      'committed',
  ERROR:          'error',
},
```

---

## A. `premiere-api.js` — Extend (Precision Engine)

### Add: `timeToTicks(seconds)`
```js
timeToTicks(seconds) {
  return BigInt(Math.round(seconds * 254016000000));
},
ticksToSeconds(ticks) {
  return Number(ticks) / 254016000000;
},
```

### Add: `getSequenceEditor(sequence)`
```js
async getSequenceEditor(sequence) {
  const ppro = this._load();
  return await ppro.SequenceEditor.createForSequence(sequence);
},
```

### Add: `rippleDeleteClips(clips, sequence)`
```js
// clips = array of TrackItem objects already identified for deletion
// Uses executeTransaction + createRemoveItemsAction(ripple=true)
// See PPRO_API_CHEATSHEET.md §6a for exact pattern
async rippleDeleteClips(clips, sequence) { ... }
```

### Add: `addSilenceMarker(sequence, startSecs, endSecs, confidence)`
```js
// Adds a named marker on the sequence ruler
// name: '⏸ Silence' | color: red (use clip label 8 on overlapping clips)
```

### Add: `addBrollMarker(sequence, timeSecs, suggestion)`
```js
// name: '🎬 B-roll' | color: yellow (clip label 5)
```

### Remove: `importFile()` — no longer needed  
### Remove: all XML-related helpers

---

## B. `timeline-editor.js` — Rewrite (Reverse-Order Editor)

### New public API:

```js
TimelineEditor = {

  // Step 1: Place markers only — NO destructive edits
  async analyzeAndMark(editPlan) { ... },

  // Step 2: Execute actual ripple deletes (after user confirms markers)
  async commitEdits(editPlan) { ... },

  // Internal helpers
  _processInReverseOrder(segments) { ... },
  _applyPaddingToKeepSegments(segments, paddingTicks) { ... },
  _deleteSegment(sequence, seqEditor, startTicks, endTicks) { ... },
}
```

### Critical implementation rules:

**Reverse-order processing:**
```js
// Sort segments by startTime DESCENDING before any deletes
const sorted = segments.slice().sort((a, b) => b.startTicks - a.startTicks);
for (const seg of sorted) {
  await this._deleteSegment(sequence, seqEditor, seg.startTicks, seg.endTicks);
}
```

**Breath padding:**
```js
// Shrink each DELETE segment by PADDING_TICKS on each side
// so the surrounding KEEP segments have a 0.15s natural buffer
const PADDING = CONSTANTS.PADDING_TICKS;
const paddedStart = seg.startTicks + PADDING;
const paddedEnd   = seg.endTicks   - PADDING;
if (paddedEnd - paddedStart < TICKS_PER_SECOND * 0.3) continue; // too short after padding
```

**What `analyzeAndMark` does:**
1. Gets active sequence
2. Loops through editPlan.segments (to DELETE)
3. Calls `PremiereAPI.addSilenceMarker()` for each
4. Calls `PremiereAPI.addBrollMarker()` for broll opportunities
5. Updates ui-state to `MARKERS_PLACED`
6. Does NOT touch clips at all

**What `commitEdits` does:**
1. Gets active sequence + seqEditor
2. Applies padding to all segments
3. Sorts segments in reverse order
4. For each segment: finds clips fully inside range, ripple-deletes them
5. Attempts audio crossfade on resulting edit points
6. Updates ui-state to `COMMITTED`

---

## C. `prompt-templates.js` — Rewrite (Story-First Prompting)

### New system prompt (replace `getSystemInstruction()`):

```
You are Ambar, a professional vlog editor. You think in complete thoughts and 
natural sentences — not individual words or timestamps.

Your job is to identify segments to DELETE from the vlog. You return ONLY a 
JSON array of delete segments. Never suggest a cut unless:
  1. Silence exceeds 1.2 seconds (genuine dead air, not a breath)
  2. The speaker is clearly restarting a sentence (false start / retake)
  3. There is obvious filler with no informational content

Group consecutive words into thematic blocks before deciding. 
A "thought" is a complete sentence or idea. Never cut inside a thought.
```

### New edit plan JSON schema:

```json
{
  "summary": "2-3 sentence overall assessment",
  "segments": [
    {
      "startSeconds": 12.4,
      "endSeconds": 14.1,
      "reason": "1.7s dead air after sentence ends",
      "type": "silence",
      "confidence": 0.94
    },
    {
      "startSeconds": 45.0,
      "endSeconds": 47.2,
      "reason": "False start — speaker restarts same sentence",
      "type": "retake",
      "confidence": 0.88
    }
  ],
  "brollOpportunities": [
    {
      "atSeconds": 23.0,
      "suggestion": "Show the product being used",
      "confidence": 0.82
    }
  ]
}
```

### Replace `getFcpxmlAnalysisPrompt()` with `getTimelineAnalysisPrompt(transcriptData)`

Input is the native Premiere transcript JSON (word-level with ticks), not XML.  
Output is the schema above.

---

## D. `response-parser.js` — Extend

### Add: `parseEditPlan(apiResponse)`

```js
parseEditPlan(apiResponse) {
  // Extract and validate the new schema
  // Filter out segments below CONSTANTS.MIN_CONFIDENCE
  // Filter out segments shorter than CONSTANTS.MIN_SILENCE_SECONDS
  // Return { summary, segments, brollOpportunities } or null
}
```

Keep all existing parsers for backward compatibility during migration.

---

## E. `ui-controller.js` — Wire Up Two-Step UI

### Button flow:

```
[Analyze]  →  calls AIService.analyzeSequence()
           →  calls ResponseParser.parseEditPlan()
           →  calls TimelineEditor.analyzeAndMark(editPlan)
           →  UI shows marker count + enables [Commit Edits] button

[Commit Edits] →  calls TimelineEditor.commitEdits(editPlan)
               →  UI shows success / undo reminder
```

### State machine:

```
READY → ANALYZING → MARKERS_PLACED → COMMITTING → COMMITTED
                                  ↘ (user can cancel) → READY
```

The `editPlan` must be stored on `UIController._pendingEditPlan` between the two steps.

---

## F. What to Delete

- `js/core/fcpxml-editor.js` — delete entire file
- `js/core/srt-parser.js` — delete entire file  
- `js/core/xml-parser.js` — delete entire file
- `js/utils/xml-shim.js` — delete entire file
- All references to these in `index.html` `<script>` tags
- `PromptTemplates.getFcpxmlAnalysisPrompt()` — replaced by `getTimelineAnalysisPrompt()`
- `PromptTemplates.getSilenceDetectionPrompt()` — replaced by story-first prompt
- `PremiereAPI.importFile()` — no longer needed

---

## G. Coding Order (do in this sequence)

1. `constants.js` — add new constants first (everything depends on them)
2. `premiere-api.js` — add tick helpers and new marker/delete methods
3. `prompt-templates.js` — rewrite system prompt and schema
4. `response-parser.js` — add `parseEditPlan()`
5. `timeline-editor.js` — rewrite with reverse-order + two-step
6. `ui-controller.js` — wire up new button flow + state machine
7. `index.html` — remove deleted file script tags
8. Delete the four dead files

---

## H. Testing Checkpoints

After each step, test this in Premiere:

| Step | Test |
|---|---|
| After `premiere-api.js` changes | `PremiereAPI.timeToTicks(1.0) === 254016000000n` |
| After marker methods | Analyze runs → red markers appear on timeline ruler |
| After `timeline-editor.js` | Commit runs → clips ripple-deleted from end toward start |
| After full flow | Run on a 3-minute vlog — should produce ≤ 15 cuts, no audio pops |

---

## I. Known Limitations (document in code, don't try to workaround)

```js
// TODO(API-GAP): Audio crossfades via UXP not confirmed working.
// Fallback: user applies Cmd+Shift+D after commit, or we set default transition.

// TODO(API-GAP): Clip trimming (setting trackItem start/end) not exposed in UXP v1.
// Current approach: only delete clips fully inside a silence range.
// Clips partially overlapping a silence range are skipped (marked only).

// TODO(API-GAP): No razor/split API — we avoid needing it by aligning
// AI suggestions to whole-clip boundaries using transcript word timing.
```
