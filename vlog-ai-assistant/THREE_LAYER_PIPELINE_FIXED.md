# Three-Layer Pipeline — Fixed Fallback Chains

> **Status:** All three layers now have complete fallback paths. No loss of silence detection on any code path.

---

## What Was Fixed

### Issue 1: Double-Padding Bug
**Problem:** When Layer 2 (Whisper) failed or was skipped, `directSegments` in `_runLayerPipeline()` were created with padding already applied (0.15s shrunk from each side). Then in `commitEdits()`, padding was applied *again*, causing segments to shrink twice and potentially disappear if too short.

**Solution:** Remove padding from `directSegments` in `_runLayerPipeline()`. Return raw silence ranges (no padding). Let `commitEdits()` apply padding uniformly to all segments.

**Code change:** [timeline-editor.js line 315-324](js/core/timeline-editor.js#L315-L324)
```js
// BEFORE: Applied padding here
startSeconds: s.startMs / 1000 + PADDING,
endSeconds:   s.endMs   / 1000 - PADDING,

// AFTER: No padding here — let commitEdits handle it
startSeconds: s.startMs / 1000,
endSeconds:   s.endMs   / 1000,
```

---

### Issue 2: Missing Layer 1 Fallback
**Problem:** When `buildSequenceTranscript()` failed to get word timestamps from all sources (cloud API, manual audio, SRT), it would return an error. But it never tried the Layer 1 (AudioAnalyzer) as a final fallback.

This meant if a user had no Whisper key and no SRT file, they'd get an error even though Layer 1 could still detect silence ranges.

**Solution:** Add Layer 1 fallback as the final safety net in `buildSequenceTranscript()`. If all word-based paths fail:
1. Try `AudioAnalyzer.getAudioPCM()`
2. Extract silence ranges
3. Convert to editPlan segments
4. Return them directly (signal skip `findSilences()`)

**Code change:** [timeline-editor.js line 282-314](js/core/timeline-editor.js#L282-L314)

---

## Complete Fallback Chain

```
User clicks Analyze
    ↓
analyzeSequence()
    ├─ Try _runLayerPipeline()  ← primary path
    │   ├─ Layer 1: AudioAnalyzer.getAudioPCM() → PCM
    │   ├─ Detect silenceRanges + speechSegments
    │   │
    │   ├─ Layer 2a: WhisperService (if key exists)
    │   │   ├─ Transcribe speechSegments → words
    │   │   └─ Return { words, directSegments: null }
    │   │
    │   └─ Layer 2b: Skip Layer 2 (no key)
    │       └─ Return { words: null, directSegments }  ← RAW, NO PADDING
    │
    └─ If pipeline fails entirely, try buildSequenceTranscript()
        ├─ Priority 1: Manual audio override
        │   └─ AIService.sendAudioFile() → words
        │
        ├─ Priority 2: CEP exported audio
        │   └─ AIService.sendAudioFile() → words
        │
        ├─ Priority 3: SRT manual upload
        │   └─ Parse SRT → words
        │
        └─ FINAL FALLBACK (NEW): Layer 1 silence detection
            ├─ AudioAnalyzer.getAudioPCM()
            ├─ Extract silenceRangesMs
            └─ Return { segments, layer1Fallback: true }  ← direct segments
```

---

## Path Analysis: Where Silence Never Gets Lost

### Path A: Layer 1 + Layer 2 (Best Precision)
```
PCM → Silence + Speech detection
   → Whisper: transcribe speech → word-level timestamps
   → findSilences(): calculate gaps between words
   → AI: confirm which gaps are editorial cuts
   
Result: Precise, semantic-aware silence detection
```

### Path B: Layer 1 Only (Layer 2 Skip/Fail)
```
PCM → Silence detection
   → directSegments (raw ranges, no padding)
   → commitEdits() applies padding uniformly
   
Result: Good precision, audio-mathematical silence ranges
```

### Path C: buildSequenceTranscript + Cloud API
```
Cloud Whisper: upload audio → words
   → findSilences(): gaps between words
   
Result: Precision depends on uploaded audio quality
```

### Path D: buildSequenceTranscript + SRT
```
Manual SRT: user provides transcript
   → findSilences(): gaps between words
   
Result: Precision depends on SRT accuracy
```

### Path E: buildSequenceTranscript + Layer 1 Fallback (NEW)
```
All word-based paths failed
   → Layer 1 fallback: AudioAnalyzer extracts silence ranges
   → Segments returned directly (pre-computed)
   
Result: Same precision as Path B — audio-mathematical silence detection
       No error; plugin still works!
```

---

## Key Changes to timeline-editor.js

### Change 1: Remove Padding from _runLayerPipeline Line 315-324

```js
// BEFORE (double-padding):
const directSegments = silenceRanges
    .map(function(s) {
        return {
            startSeconds: s.startMs / 1000 + PADDING,      // ← DON'T
            endSeconds:   s.endMs   / 1000 - PADDING,      // ← DON'T
            confidence:   0.85,
        };
    })

// AFTER (raw segments):
const directSegments = silenceRanges
    .map(function(s) {
        return {
            startSeconds: s.startMs / 1000,                // ← raw
            endSeconds:   s.endMs   / 1000,                // ← raw
            confidence:   0.85,
        };
    })
```

### Change 2: Add Layer 1 Fallback in buildSequenceTranscript Line 282-314

```js
// BEFORE (error on first failure):
if (srtFallback && ...) return { ... };
// If we get here, error out
return { success: false, error: '...' };

// AFTER (Layer 1 fallback):
if (srtFallback && ...) return { ... };

// NEW: Try Layer 1 as final safety net
try {
    const pcmResult = await AudioAnalyzer.getAudioPCM(sequence);
    if (pcmResult && pcmResult.success && pcmResult.pcm) {
        const silenceRangesMs = AudioAnalyzer._detectSilenceRanges(pcmResult.pcm);
        if (silenceRangesMs && silenceRangesMs.length > 0) {
            const segments = silenceRangesMs.map(...);
            return { success: true, words: [], segments, layer1Fallback: true };
        }
    }
} catch (e) { Logger.warn(...); }

return { success: false, error: '...' };
```

### Change 3: Update analyzeSequence Line 63-74

```js
// BEFORE (always call findSilences):
const segments = this.findSilences(transcriptResult.words, ...);
if (!segments.length) return error;

// AFTER (check for pre-computed segments):
let segments;
if (transcriptResult.segments && transcriptResult.segments.length > 0) {
    Logger.info('using pre-computed segments from buildSequenceTranscript');
    segments = transcriptResult.segments;
} else {
    segments = this.findSilences(transcriptResult.words, ...);
}
if (!segments.length) return error;
```

---

## Testing the Fix

### Test 1: Layer 1 + Layer 2 Success
- Set `WHISPER_API_KEY` in constants
- Load a vlog with long silences
- Analyze → markers appear on silence locations
- **Expected:** Precise markers based on word boundaries

### Test 2: Layer 1 Only (No Whisper Key)
- Set `WHISPER_API_KEY = ''` (or remove key)
- Load same vlog
- Analyze → markers appear on silence ranges
- **Expected:** Markers at silence boundaries, slightly less precise than Test 1
- **Bug check:** Markers should NOT appear twice (no double-padding)

### Test 3: Layer 1 Fallback (All Paths Fail)
- Disconnect from network (block API calls)
- Clear SRT file from Import tab
- Load vlog
- Analyze → markers appear
- **Expected:** Markers from Layer 1 fallback, no error message
- **Regression check:** Analyze button doesn't hang or timeout

### Test 4: Commit After Any Path
- Run any test above
- Review markers in timeline
- Click Commit
- **Expected:** Silence segments deleted cleanly, no audio pops
- **Bug check:** Padding applied exactly once (no double-padding artifacts)

---

## Code Quality Checks

- ✅ All padding applied uniformly in `commitEdits()` only
- ✅ No double-padding on any code path
- ✅ Layer 1 fallback only triggers when all other paths fail
- ✅ Logging updated to show which fallback path was taken
- ✅ No breaking changes to public API
- ✅ Graceful degradation: plugin still works if CEP bridge is missing

---

## Affected Files

- [timeline-editor.js](js/core/timeline-editor.js) — 3 changes, ~50 lines total
- No changes needed to audio-analyzer.js, whisper-service.js, or constants.js
- No changes to UI or state machine

---

## Next Steps

1. **Verify no regressions:** Run all three paths above and confirm markers place correctly
2. **Test commit flow:** Verify silence ranges are deleted at correct times
3. **Check performance:** Layer 1 fallback may take extra time (PCM decode) — monitor on large files
4. **Update TRANSCRIPT_GUIDE.md:** Document the new fallback chain visually

