# CLAUDE.md — Project Briefing for AI Coding Sessions

> Claude reads this file automatically when opening this repo.
> Read ALL referenced documents before writing any code.

---

## What This Project Is

**Ambar** — a Premiere Pro plugin that uses AI (Gemini / GPT / Claude / Ollama) to
automatically edit vlogs: removing silence, suggesting B-roll, and generating captions.

Plugin ID: `com.robelaipremiereassistant.plugin.v2`
Brand name: **Ambar** (use this everywhere, not "Premiere AI Assistant")

---

## Read These In Order Before Coding

1. **`ARCHITECTURE_DECISIONS.md`** — Settled decisions. Do not re-open them. Implement what's there.
2. **`PPRO_API_CHEATSHEET.md`** — UXP API confirmed signatures. Check before writing any `premiere-api.js` code.
3. **`CEP_BRIDGE_CHEATSHEET.md`** — ExtendScript patterns for the hidden CEP bridge. Check before writing any `host.jsx` code. Remember: ES3 only.
4. **`REFACTOR_PLAN.md`** — What to build, in what order, with what method signatures.
5. **`SHIPPING_CHECKLIST.md`** — Use this to know what "done" means. Check items off as you complete them.

---

## Architecture Overview (Hybrid UXP + CEP)

```
User clicks button
       ↓
UIController (UXP)
       ↓
AIService → Gemini/GPT/Claude/Ollama API
       ↓
ResponseParser → editPlan JSON
       ↓
TimelineEditor.analyzeAndMark()
       ↓ (UXP) places markers on timeline ruler
       
User reviews markers, clicks Commit
       ↓
TimelineEditor.commitEdits()
       ↓
CEPBridge.razorAndDelete(segments)   ← writes JSON to temp dir
       ↓
[CEP Bridge polls temp dir]          ← separate hidden panel
       ↓
host.jsx: razor + ripple delete      ← ExtendScript / QE DOM
       ↓
CEPBridge reads response, updates UI
```

**Key rule:** UXP handles everything except the actual destructive timeline cuts. CEP handles only: razor, ripple delete, audio crossfade. Nothing else goes in the CEP bridge.

---

## Full Project Structure

```
vlog-ai-assistant/           ← UXP plugin root (open this in UDT)
  CLAUDE.md                  ← this file
  PPRO_API_CHEATSHEET.md
  CEP_BRIDGE_CHEATSHEET.md
  ARCHITECTURE_DECISIONS.md
  REFACTOR_PLAN.md
  SHIPPING_CHECKLIST.md
  manifest.json              ← UXP manifest (don't change plugin ID)
  index.html                 ← loads all scripts in fixed order
  js/
    ai/
      ai-service.js          ← multi-provider AI client
      gemini-service.js      ← alias for ai-service
      prompt-templates.js    ← system prompts (story-first)
      response-parser.js     ← validates AI output, parseEditPlan()
    core/
      cep-bridge.js          ← NEW: UXP side of file-based IPC
      premiere-api.js        ← UXP Premiere API wrapper
      project-reader.js      ← reads sequence metadata
      timeline-editor.js     ← orchestrates analyze + commit
    ui/
      ui-controller.js       ← button handlers, two-step flow
      ui-state.js            ← READY/ANALYZING/MARKERS_PLACED/etc
    utils/
      constants.js           ← all shared constants
      error-handler.js
      logger.js
      validators.js

cep-bridge/                  ← CEP panel (install separately)
  CSXS/
    manifest.xml             ← CEP 11 manifest, hidden panel
  index.html                 ← minimal, loads CSInterface + main.js
  js/
    main.js                  ← 200ms polling loop
    CSInterface.js           ← Adobe's CEP library
  jsx/
    host.jsx                 ← ALL ExtendScript operations (ES3 only)
```

---

## Script Load Order in index.html (fixed — do not change)

```html
<script src="js/utils/constants.js"></script>
<script src="js/utils/logger.js"></script>
<script src="js/utils/error-handler.js"></script>
<script src="js/utils/validators.js"></script>
<script src="js/core/cep-bridge.js"></script>       <!-- NEW -->
<script src="js/core/premiere-api.js"></script>
<script src="js/core/project-reader.js"></script>
<script src="js/ai/prompt-templates.js"></script>
<script src="js/ai/response-parser.js"></script>
<script src="js/ai/ai-service.js"></script>
<script src="js/ai/gemini-service.js"></script>
<script src="js/core/timeline-editor.js"></script>
<script src="js/ui/ui-state.js"></script>
<script src="js/ui/ui-controller.js"></script>
```

---

## Non-Negotiable Rules

### UXP side
- All Premiere proxy properties need `await` — `sequence.name` returns a Promise
- All timeline positions in ticks (BigInt), never milliseconds
- All writes inside `project.executeTransaction()` with `return true`
- Modern JS is fine: async/await, const/let, arrow functions, template literals

### CEP / ExtendScript side
- **ES3 only**: `var` only, no arrow functions, no template literals, no destructuring
- Call `app.enableQE()` before every QE DOM usage
- Timecodes must be `"HH:MM:SS:FF"` format for QE razor
- Segments processed in REVERSE ORDER (end → start) without exception

### Both sides
- Never store timeline positions as milliseconds
- Log everything with `Logger.info/warn/error` (UXP) or `$.writeln` (ExtendScript)
- Plugin must work with CEP bridge missing (graceful degradation — markers only mode)

---

## Files Scheduled for Deletion

Remove these during the refactor. Do not edit them:
- `js/core/fcpxml-editor.js`
- `js/core/srt-parser.js`
- `js/core/xml-parser.js`
- `js/utils/xml-shim.js`

---

## Testing Setup

**UXP panel:** Premiere Pro Beta 25.x → UXP Developer Tools → Add Plugin → `manifest.json`

**CEP bridge:** 
- Enable debug mode (see `CEP_BRIDGE_CHEATSHEET.md` §5)
- Copy `cep-bridge/` to CEP extensions folder
- Restart Premiere
- Check `Window > Extensions > Ambar Bridge` appears

**Verify bridge works:** Call `CEPBridge.ping()` in the UXP panel console. Should return `{ success: true }` within 2 seconds.

**Console:** UXP logs appear in UDT console. ExtendScript logs appear in `$.writeln` output (visible in ExtendScript Toolkit or UDT script console).

---

## Do Not

- Do not change the UXP plugin ID in `manifest.json`
- Do not add a bundler without asking first
- Do not use `app.` in UXP code (ExtendScript syntax)
- Do not use `require('premierepro')` in CEP/ExtendScript code
- Do not use `CSInterface` in UXP code (it doesn't exist there)
- Do not process edit segments in forward order (breaks timing)
- Do not skip the marker step before committing cuts
- Do not use `localStorage`/`sessionStorage` (not available in UXP)
- Do not write ES6+ syntax in `host.jsx` (ExtendScript is ES3)
