# Premiere Pro UXP API Cheatsheet
> **For Claude:** Read this before writing any `premiere-api.js` or `timeline-editor.js` code.  
> Last verified: May 2026 against PPro Beta 25.x / `types.d.ts` from `AdobeDocs/uxp-premiere-pro-samples`.

---

## 1. Runtime Bootstrap

```js
// ONLY works inside Premiere Pro UXP runtime. Will throw outside it.
const ppro = require('premierepro');
```

**Everything on `ppro` returns Promises. Always `await`.** Failing to await produces silent wrong results or blocks the panel.

---

## 2. Project

```js
const project = await ppro.Project.getActiveProject();
// project.name  → string (await it)
// project.rootItem → ProjectItem (bin root)
```

### Lock pattern (REQUIRED before any write transaction)
```js
await project.lockedAccess(async () => {
  // safe to read project state here
  // can call executeTransaction inside lockedAccess
});
```

---

## 3. Sequence

```js
// Preferred: from project
const sequence = await project.getActiveSequence();

// Fallback: from SequenceEditor
const sequence = await ppro.SequenceEditor.getActiveSequence?.();

// Properties (all async via UXP proxy)
const name       = await sequence.name;
const id         = await sequence.sequenceID;
const durationTT = await sequence.duration;  // TickTime object
const endTT      = await sequence.end;        // TickTime — sequence out point
const timebase   = await sequence.getTimebase(); // ticks per frame (BigInt or number)

// Tracks
const videoTracks = await sequence.getVideoTracks(); // array-like
const audioTracks = await sequence.getAudioTracks();

// Track clips
const clips = await videoTracks[0].getClips();       // array of VideoClipTrackItem
const aClips = await audioTracks[0].getClips();      // array of AudioClipTrackItem

// Markers
const markers = await sequence.markers;              // Markers collection
```

---

## 4. TickTime — ALWAYS use ticks for timeline math

```js
const TICKS_PER_SECOND = 254016000000n; // BigInt constant — use for all conversions

// Create TickTime objects
const tt = ppro.TickTime.createWithSeconds(3.5);
const tt = ppro.TickTime.createWithTicks(BigInt(254016000000) * 3n); // 3 seconds

// Read ticks from a TickTime
const ticks = tt.ticks;      // BigInt
const secs  = tt.seconds;    // float

// Arithmetic (returns new TickTime, does not mutate)
const sum  = ttA.add(ttB);
const diff = ttA.subtract(ttB);

// Frame alignment (use this before every edit operation)
const fr = ppro.FrameRate.createWithValue(framerate_float); // e.g. 29.97
const aligned = tt.alignToNearestFrame(fr);
// OR: align to frame boundary ≤ given time
const alignedBelow = tt.alignToFrame(fr);

// Convert seconds → ticks manually (safe for BigInt math)
function secondsToTicks(secs) {
  return BigInt(Math.round(secs * 254016000000));
}
function ticksToSeconds(ticks) {
  return Number(ticks) / 254016000000;
}
```

**Rule:** Never store timeline positions as milliseconds. Always ticks. Convert to seconds only for display.

---

## 5. TrackItem (clip on the timeline)

```js
// Reading clip positions — all async
const startTT  = await clip.getStartTime();   // sequence-relative start (TickTime)
const endTT    = await clip.getEndTime();     // sequence-relative end (TickTime)
const inTT     = await clip.getInPoint();    // source media in point (TickTime)
const outTT    = await clip.getOutPoint();   // source media out point (TickTime)
const guid     = await clip.getGuid();       // unique string ID
const projItem = await clip.getProjectItem(); // backing ProjectItem

// Type guards
const isVideo = clip instanceof ppro.VideoClipTrackItem;
const isAudio = clip instanceof ppro.AudioClipTrackItem;
```

---

## 6. SequenceEditor — the write API

```js
// Get editor for a sequence
const seqEditor = await ppro.SequenceEditor.createForSequence(sequence);
```

### 6a. Ripple Delete ✅ CONFIRMED WORKING
```js
// Build a selection of clips to delete
ppro.TrackItemSelection.createEmptySelection((selection) => {
  selection.addItem(clipTrackItem);     // add one clip
  // selection.addItems(arrayOfClips); // add multiple

  project.executeTransaction((compoundAction) => {
    compoundAction.addAction(
      seqEditor.createRemoveItemsAction(
        selection,
        true,                              // ripple = true → ripple delete
        ppro.Constants.MediaType.ANY       // affects both video + audio
      )
    );
    return true; // MUST return true or transaction rolls back
  }, 'Ripple Delete Silence');
});
```

**MediaType options:** `ppro.Constants.MediaType.VIDEO`, `AUDIO`, `ANY`

### 6b. executeTransaction pattern
```js
// All timeline writes MUST go inside executeTransaction
// The second arg is the undo label shown in Premiere's Edit > Undo menu
const success = project.executeTransaction((compoundAction) => {
  compoundAction.addAction(actionA);
  compoundAction.addAction(actionB); // multiple actions = one undo step
  return true; // false or no return = rollback
}, 'Undo label string');

if (!success) Logger.error('Transaction failed');
```

### 6c. Overwrite clip into timeline ✅ CONFIRMED WORKING
```js
const projItem = await sourceClip.getProjectItem();
project.executeTransaction((ca) => {
  ca.addAction(seqEditor.createOverwriteItemAction(
    projItem,
    startTickTime,    // TickTime for sequence position
    videoTrackIndex,  // 0-based
    audioTrackIndex   // 0-based
  ));
  return true;
}, 'Overwrite clip');
```

### 6d. Set clip in/out points (source trim) ✅ CONFIRMED WORKING
```js
const clipPI = ppro.ClipProjectItem.cast(await clip.getProjectItem());

project.executeTransaction((ca) => {
  ca.addAction(clipPI.createSetInOutPointsAction(
    ppro.TickTime.createWithTicks(inTicks),
    ppro.TickTime.createWithTicks(outTicks)
  ));
  return true;
}, 'Trim clip');

// Clear in/out (restore full clip)
project.executeTransaction((ca) => {
  ca.addAction(clipPI.createClearInOutPointsAction());
  return true;
}, 'Clear trim');
```

### 6e. Add video transition ✅ IN types.d.ts (test before relying on it)
```js
// videoTransition = a VideoTransition object from ppro
// addTransitionOptions = { duration: TickTime, alignment: ... }
seqEditor.createAddVideoTransitionAction(videoTransition, addTransitionOptions);
```

---

## 7. Split Clip — ⚠️ NO NATIVE API — Workaround Only

**There is no `createRazorAction` or `createSplitAction` in UXP 1.0.**  
Adobe confirmed this is not planned for the v1.0 release.

**Workaround (from Adobe community, April 2026):** Remove original, overwrite two halves.  
**Known flaw:** Nukes all properties/effects on the original `VideoClipTrackItem`.

```js
// Strategy for "delete a time range" without split:
// 1. Find all clips overlapping [deleteStart, deleteEnd]
// 2. For clips fully inside the range → removeItemsAction (ripple)
// 3. For clips partially overlapping → trim their in/out with createSetInOutPointsAction
// This avoids the split entirely and is the recommended approach for our plugin.
```

**→ In our plugin we avoid the need to split by working with entire clips:**  
The AI should suggest segments that align to clip boundaries. The reverse-order ripple delete then removes whole clips or trims clip edges — no splitting needed.

---

## 8. Markers ✅ CONFIRMED WORKING

```js
// Sequence timeline markers
const markers = await sequence.markers;
const marker  = await markers.createMarker(timeInSeconds); // float seconds
marker.name     = 'Silence';
marker.comments = 'Gap: 1.4s — AI confidence 0.92';
// marker.type  = ppro.MarkerType.Comment (default) or .Chapter, .Web, etc.

// Color — use color labels on clips (not on sequence markers)
// Clip color labels: 0=none, 1=violet, 2=iris, 3=caribbean, 4=lavender, 5=cerulean...
// Red-ish = 8 (rose), Yellow-ish = 5 (mango) — test in your Premiere version
await clip.setColorLabel(8); // "Rose" ≈ red for silence
await clip.setColorLabel(5); // "Mango" ≈ yellow for b-roll
```

---

## 9. Transcripts (Premiere's native transcription)

### ⚠️ IMPORTANT: sequence-level transcript is NOT accessible via UXP API

`sequence.getTranscript()` does NOT exist. `ppro.Transcript.exportToJSON(sequence)` throws "Invalid parameter".  
Sequence transcripts are only exposed in the UI (Text panel); the UXP API only exposes **source clip** transcripts.

### Correct pattern — read clip transcripts and remap to sequence time

```js
// Prerequisite: user must have run Speech to Text on each SOURCE CLIP
//   Window → Text → select clip in Project panel → Transcribe (NOT "Transcribe Sequence")

async function getAllClipTranscripts(sequence) {
  const ppro = require('premierepro');
  const results = [];

  const videoTracks = await sequence.getVideoTracks();
  const track = videoTracks[0]; // V1 = A-roll
  const clips = await track.getClips();

  for (const clip of clips) {
    const projItem = await clip.getProjectItem();
    const clipPI = ppro.ClipProjectItem.cast(projItem);
    if (!clipPI) continue;

    let transcriptJSON;
    try {
      transcriptJSON = await ppro.Transcript.exportToJSON(clipPI); // takes ClipProjectItem, NOT Sequence
    } catch (e) {
      continue; // clip not transcribed
    }
    if (!transcriptJSON) continue;

    const transcript = JSON.parse(transcriptJSON);

    // Word timestamps are SOURCE-CLIP-RELATIVE — add clip's sequence start to convert
    const clipStartTicks = (await clip.getStartTime()).ticks; // BigInt

    for (const segment of transcript.segments ?? []) {
      for (const word of segment.words ?? []) {
        results.push({
          word:       word.word,
          startTicks: BigInt(word.startTime) + clipStartTicks, // sequence-relative BigInt
          endTicks:   BigInt(word.endTime)   + clipStartTicks,
          confidence: word.confidence ?? 1.0,
        });
      }
    }
  }
  return results; // flat array — sort by startTicks if needed
}
```

### Check which clips have no transcript

```js
async function checkTranscriptsExist(sequence) {
  const ppro = require('premierepro');
  const missing = [];
  const track = (await sequence.getVideoTracks())[0];
  for (const clip of await track.getClips()) {
    const clipPI = ppro.ClipProjectItem.cast(await clip.getProjectItem());
    if (!clipPI) { missing.push(await clip.name); continue; }
    try {
      const json = await ppro.Transcript.exportToJSON(clipPI);
      if (!json) missing.push(await clip.name);
    } catch (e) {
      missing.push(await clip.name);
    }
  }
  return missing; // [] = all good, non-empty = show "please transcribe" message
}
```

### Transcript JSON shape (from exportToJSON)

```json
{
  "segments": [
    {
      "words": [
        { "word": "Hello", "startTime": 1270080000, "endTime": 2540160000, "confidence": 0.98 }
      ]
    }
  ]
}
```

`startTime` / `endTime` in the JSON are source-clip-relative tick counts (plain numbers, not BigInt).  
Convert to BigInt with `BigInt(word.startTime)` before doing arithmetic with `clipStartTicks`.

---

## 10. Known Gaps / Not Yet in UXP API

| Feature | Status | Workaround |
|---|---|---|
| Razor/split clip at time | ❌ Not in v1.0 | Avoid by trimming clip edges |
| Programmatic trim (trackItem start/end) | ❌ Not exposed | Use `ClipProjectItem.createSetInOutPointsAction` |
| Audio crossfade transition | ⚠️ In types.d.ts, test required | Manual marker = fallback |
| Reading audio waveform data | ❌ Not exposed | Use Premiere's native transcription |
| `app` global (ExtendScript style) | ❌ Not available in UXP | Use `require('premierepro')` |

---

## 11. Error Handling Pattern

```js
async function safeApiCall(label, fn) {
  try {
    const result = await fn();
    Logger.debug(label + ' → ok');
    return result;
  } catch (e) {
    Logger.warn(label + ' failed: ' + e.message);
    return null;
  }
}

// Usage
const sequence = await safeApiCall('getActiveSequence', () =>
  project.getActiveSequence()
);
if (!sequence) return { success: false, error: 'No active sequence' };
```

---

## 12. Quick Reference: Full Delete-Range Flow

This is the core pattern for our plugin's "Commit Edits" step:

```js
async function rippleDeleteRange(sequence, startSecs, endSecs) {
  const ppro      = require('premierepro');
  const project   = await ppro.Project.getActiveProject();
  const seqEditor = await ppro.SequenceEditor.createForSequence(sequence);
  const startTT   = ppro.TickTime.createWithSeconds(startSecs);
  const endTT     = ppro.TickTime.createWithSeconds(endSecs);

  const videoTracks = await sequence.getVideoTracks();
  const audioTracks = await sequence.getAudioTracks();
  const allTracks   = [...videoTracks, ...audioTracks];

  const clipsToDelete = [];

  for (const track of allTracks) {
    const clips = await track.getClips();
    for (const clip of clips) {
      const cStart = await clip.getStartTime();
      const cEnd   = await clip.getEndTime();
      // Fully inside the delete range
      if (cStart.ticks >= startTT.ticks && cEnd.ticks <= endTT.ticks) {
        clipsToDelete.push(clip);
      }
      // Partially overlapping — TODO: trim edges (awaiting trim API)
    }
  }

  if (clipsToDelete.length === 0) return false;

  ppro.TrackItemSelection.createEmptySelection((selection) => {
    for (const clip of clipsToDelete) selection.addItem(clip);
    project.executeTransaction((ca) => {
      ca.addAction(seqEditor.createRemoveItemsAction(
        selection, true, ppro.Constants.MediaType.ANY
      ));
      return true;
    }, 'Ripple delete silence [' + startSecs.toFixed(2) + 's – ' + endSecs.toFixed(2) + 's]');
  });

  return true;
}
```
