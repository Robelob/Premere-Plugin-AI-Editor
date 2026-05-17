# Shipping Checklist
> **For Claude Code:** Start each session by finding the first unchecked item and completing it.
> Check items off as you go. Never leave a session with broken code.

---

## Phase 1 — Foundation (do first, in order)

- [ ] **constants.js** — add `TICKS_PER_SECOND`, `PADDING_SECONDS`, `MIN_SILENCE_SECONDS`,
  `MIN_CONFIDENCE`, `WHISPER_PROVIDER`, `WHISPER_API_KEY`, `AI_PROVIDER`, `AI_MODEL`,
  `OLLAMA_MODEL`, `OLLAMA_BASE_URL`, `STATES`, `BRIDGE_TIMEOUT_MS`

- [ ] **cep-bridge.js** (NEW) — `sendCommand()`, `ping()`, `razorAndDelete()`,
  `_writeTempFile()`, `_pollForResponse()`, `_getTmpDir()`

- [ ] **premiere-api.js** — add `timeToTicks()`, `ticksToSeconds()`,
  `getSequenceEditor()`, `getClipSourcePath()`, `addSilenceMarker()`, `addBrollMarker()`

- [ ] **ui-state.js** — add `MARKERS_PLACED`, `COMMITTING`, `COMMITTED` states

## Phase 2 — Three-Layer Audio Pipeline (do in order)

- [ ] **audio-analyzer.js** (NEW FILE) — Layer 1
  - `findSilences(sourceFilePath, clipStartTicks, clipInPointTicks)`
  - `_readAsPCM(filePath)` — uses `AudioContext.decodeAudioData()`
  - `_detectSilenceRanges(pcm)` — RMS energy per 10ms frame, -40dB threshold
  - `_invertToSpeech(silenceRanges, totalDurationMs)` — returns speech segments
  - `_applyPadding(ranges)` — 150ms buffer each side
  - `_toSequenceTicks(ranges, clipStartTicks, clipInPointTicks)`

- [ ] **whisper-service.js** (NEW FILE) — Layer 2
  - `transcribeSegments(segments, pcm, provider, apiKey)`
  - `_whisperAPI(wavBlob, url, model, apiKey)` — generic Whisper endpoint caller
  - `_pcmToWavBlob(samples, sampleRate)` — pure JS WAV encoder, no dependencies

- [ ] **prompt-templates.js** — add `getEditorialAnalysisPrompt(blocks, silences)`
  Replace old FCPXML/SRT prompts. Keep `getSystemInstruction()`.

- [ ] **response-parser.js** — add `parseEditPlan(responseText)`
  Handles new schema: `{ confirmedCuts, retakes, broll, summary }`
  Filters by `MIN_CONFIDENCE`. Returns null on parse failure.

- [ ] **timeline-editor.js** — full rewrite of `analyzeSequence()`
  - Call `AudioAnalyzer.findSilences()` → Layer 1
  - Call `WhisperService.transcribeSegments()` → Layer 2
  - Build paragraph blocks from words
  - Call `AIService.sendPrompt()` → Layer 3
  - Call `ResponseParser.parseEditPlan()`
  - Call `_placeMarkers()` (no cuts)
  - Keep existing `commitEdits()` and `_applyPadding()`

- [ ] **ui-controller.js** — wire two-step flow
  - Analyze button → `TimelineEditor.analyzeSequence()` → store `_pendingEditPlan`
  - Commit button → `TimelineEditor.commitEdits(_pendingEditPlan)` → enable after markers placed
  - Show progress during each layer (Layer 1 / 2 / 3 status in UI)

## Phase 3 — CEP Bridge

- [ ] **cep-bridge/CSXS/manifest.xml** — hidden panel, CEP 11, PPRO host
- [ ] **cep-bridge/index.html** — minimal HTML loader
- [ ] **cep-bridge/js/main.js** — 200ms polling loop
- [ ] **cep-bridge/jsx/host.jsx** — `ambar_razorAtTime()`, `ambar_rippleDeleteRange()`,
  `ambar_applyAudioCrossfade()`, `ambar_processPendingCommands()`, `ambar_getTmpDir()`
- [ ] **CSInterface.js** — copy from Adobe-CEP/CEP-Resources repo (v11)

## Phase 4 — Cleanup

- [ ] Delete `js/core/fcpxml-editor.js`
- [ ] Delete `js/core/srt-parser.js`
- [ ] Delete `js/core/xml-parser.js`
- [ ] Delete `js/utils/xml-shim.js`
- [ ] Remove deleted file `<script>` tags from `index.html`
- [ ] Add new file `<script>` tags in correct order (see CLAUDE.md)

## Phase 5 — Testing Gates

**Phase 1+2 gate — run in UXP DevTools console:**
```js
// Confirm constants loaded
console.log(CONSTANTS.TICKS_PER_SECOND === 254016000000); // true
console.log(CONSTANTS.WHISPER_PROVIDER);                   // 'groq'

// Confirm AudioAnalyzer exists
console.log(typeof AudioAnalyzer.findSilences);            // 'function'

// Confirm WhisperService exists
console.log(typeof WhisperService.transcribeSegments);     // 'function'
```

**Phase 2 gate — real footage test:**
- Open a sequence with a single continuous clip
- Click Analyze
- Layer 1 log appears: "[AudioAnalyzer] Found X silence ranges"
- Layer 2 log appears: "[WhisperService] ..."
- Layer 3 log appears: "Layer 3 done: X cuts confirmed"
- Red markers appear on timeline ruler
- Commit button enables

**Phase 3 gate — CEP bridge:**
- `CEPBridge.ping()` returns `{ success: true }` within 2 seconds
- `CEPBridge.razorAndDelete([{startSeconds:5, endSeconds:7}])` cuts a test clip
- Cuts happen end → start (verify in undo history)

**Full integration gate — 3-minute vlog clip:**
- ≤ 20 total cuts produced (not word-level barcode)
- No audible audio pops on playback
- One Ctrl+Z undoes all commits (or sequential Ctrl+Z works cleanly)

---

## Common Mistakes (Claude Code must avoid these)

1. Uploading full video files — Layer 2 receives WAV blobs of speech segments only
2. Using ticks as Numbers — always BigInt arithmetic for ticks
3. Forgetting `app.enableQE()` before QE DOM in host.jsx
4. ES6 syntax in host.jsx — ES3 only (`var`, no arrows, no template literals)
5. Processing segments forward — always reverse order (end → start)
6. Not returning `true` from `executeTransaction` callback — silent rollback
7. Trying to use Ollama for audio — it's text-only, use Groq for Whisper
8. Missing `await` on Premiere UXP proxy properties

---

## File Size Budget

| File | Max lines |
|---|---|
| `audio-analyzer.js` | 200 |
| `whisper-service.js` | 150 |
| `premiere-api.js` | 400 |
| `timeline-editor.js` | 350 |
| `cep-bridge.js` | 200 |
| `host.jsx` | 400 |
| `ui-controller.js` | 600 |
| `prompt-templates.js` | 250 |
| `response-parser.js` | 200 |

---

## Graceful Degradation Requirements

| Missing component | Plugin behaviour |
|---|---|
| CEP bridge not installed | Analyze works, Commit shows install instructions |
| Ollama not running | Falls back to Groq for Layer 3 |
| Groq key missing | Shows "Add API key in settings" message |
| AudioContext unavailable | Shows "TODO: CEP audio export fallback needed" warning |
| No clips on timeline | Shows "Open a sequence with clips first" |
| Clip has no source file | Shows clip name + "source file not found" |
