# CLAUDE.md — Project Briefing for AI Coding Sessions

> Claude reads this file automatically when opening this repo.
> Read ALL referenced documents before writing any code.
> **Architecture has pivoted — read TRANSCRIPT_GUIDE.md before touching any audio code.**

---

## What This Project Is

**Ambar** — a Premiere Pro UXP + CEP hybrid plugin that uses AI to automatically
edit talking-head vlogs: removing silence, suggesting B-roll, and generating captions.

Plugin ID: `com.robelaipremiereassistant.plugin.v2`
Brand name: **Ambar** — use this everywhere, not "Premiere AI Assistant"

---

## Read These In Order Before Coding

1. **`ARCHITECTURE_DECISIONS.md`** — settled decisions, do not re-open them
2. **`PPRO_API_CHEATSHEET.md`** — confirmed UXP API signatures
3. **`CEP_BRIDGE_CHEATSHEET.md`** — ExtendScript patterns (ES3 only)
4. **`TRANSCRIPT_GUIDE.md`** — ⚠️ RECENTLY UPDATED — three-layer audio pipeline
5. **`LOCAL_AI_SETUP.md`** — Ollama + Groq + Whisper configuration
6. **`REFACTOR_PLAN.md`** — what to build and in what order
7. **`SHIPPING_CHECKLIST.md`** — use this to know what "done" means

---

## Architecture Overview

```
User clicks Analyze
       ↓
LAYER 1 — AudioAnalyzer.findSilences()          [UXP, pure JS math]
  reads source PCM via AudioContext
  returns: silence ranges in ticks + speech segments in ms
       ↓
LAYER 2 — WhisperService.transcribeSegments()   [UXP, speech segments only]
  sends small speech-only WAV blobs to Groq Whisper API
  returns: word-level timestamps
       ↓
LAYER 3 — AIService.sendPrompt()                [UXP, text only ~2KB]
  sends text summary to Ollama / Groq / Gemini / Claude
  returns: confirmedCuts + retakes + broll as JSON
       ↓
TimelineEditor.analyzeAndMark()                 [UXP]
  places markers on timeline — no cuts yet
       ↓
User reviews markers → clicks Commit
       ↓
CEPBridge.razorAndDelete(segments)
host.jsx: razor + ripple delete + crossfade     [ExtendScript / QE DOM]
```

**No full video is ever uploaded to the cloud. Cloud only receives ~2KB of text.**

---

## Full Project Structure

```
vlog-ai-assistant/
  CLAUDE.md
  PPRO_API_CHEATSHEET.md
  CEP_BRIDGE_CHEATSHEET.md
  ARCHITECTURE_DECISIONS.md
  TRANSCRIPT_GUIDE.md        ← pivoted: three-layer pipeline
  LOCAL_AI_SETUP.md          ← Ollama + Groq + Whisper config
  REFACTOR_PLAN.md
  SHIPPING_CHECKLIST.md
  manifest.json
  index.html
  js/
    ai/
      ai-service.js          ← Layer 3 text LLM (all providers)
      gemini-service.js      ← alias for ai-service
      whisper-service.js     ← NEW: Layer 2 audio transcription
      prompt-templates.js    ← getEditorialAnalysisPrompt()
      response-parser.js     ← parseEditPlan()
    core/
      audio-analyzer.js      ← NEW: Layer 1 RMS silence detection
      cep-bridge.js          ← UXP side IPC
      premiere-api.js        ← UXP Premiere API wrapper
      project-reader.js
      timeline-editor.js     ← orchestrates all three layers
    ui/
      ui-controller.js
      ui-state.js
    utils/
      constants.js

cep-bridge/
  CSXS/manifest.xml
  index.html
  js/main.js
  jsx/host.jsx
```

---

## Script Load Order in index.html (fixed)

```html
<script src="js/utils/constants.js"></script>
<script src="js/utils/logger.js"></script>
<script src="js/utils/error-handler.js"></script>
<script src="js/utils/validators.js"></script>
<script src="js/core/cep-bridge.js"></script>
<script src="js/core/audio-analyzer.js"></script>
<script src="js/core/premiere-api.js"></script>
<script src="js/core/project-reader.js"></script>
<script src="js/ai/prompt-templates.js"></script>
<script src="js/ai/response-parser.js"></script>
<script src="js/ai/whisper-service.js"></script>
<script src="js/ai/ai-service.js"></script>
<script src="js/ai/gemini-service.js"></script>
<script src="js/core/timeline-editor.js"></script>
<script src="js/ui/ui-state.js"></script>
<script src="js/ui/ui-controller.js"></script>
<script src="js/index.js"></script>
```

---

## Rules

### UXP
- All Premiere proxy properties need `await`
- Timeline positions always in ticks (BigInt)
- All writes inside `executeTransaction()` with `return true`
- `AudioContext` available in UXP — use it for PCM decoding
- Speech blobs built in memory — no temp files for audio

### CEP / host.jsx
- ES3 only — `var`, no arrow functions, no template literals
- `app.enableQE()` before every QE DOM call
- Segments processed REVERSE ORDER always

### Both
- Never upload full video/audio to cloud
- Logger everywhere
- Graceful degradation if CEP bridge missing
- **CONSTANTS are source of truth** — when modifying AI_PROVIDER, AI_MODEL, VISION_MODEL, WHISPER_PROVIDER in constants.js, they take priority over localStorage and UI settings. This ensures consistent behavior across plugin lifecycle.
  - Example: Change `CONSTANTS.AI_PROVIDER` from 'gemini' to 'ollama' → reload plugin → all AI calls use ollama automatically
  - UIController._getProvider() checks CONSTANTS first, then falls back to UI/localStorage

---

## Copilot vs Claude Code

| Task | Use |
|---|---|
| Create new file from scratch | Claude Code |
| Wire modules together | Claude Code |
| Any UXP / CEP / QE DOM code | Claude Code |
| Boilerplate inside existing file | Copilot |
| WAV encoding, FormData, null checks | Copilot |
| Inline completions | Copilot |

---

## Do Not

- Do not upload full video to any API
- Do not use `ppro.Transcript.exportToJSON()` — abandoned
- Do not make Ollama handle audio transcription — it cannot
- Do not change plugin ID in manifest.json
- Do not use ES6+ in host.jsx
- Do not process segments forward (always reverse order)
- Do not skip marker step before commit
