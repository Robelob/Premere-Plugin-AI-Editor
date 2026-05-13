# Ambar — AI Editor for Premiere Pro
_Updated 2026-05-13_

## Vision

An AI-powered UXP panel that acts as an **assistant editor** for vlog creators.
The AI handles the structural/mechanical work (boring parts) so the human editor
can focus on creative finishing (color, music, personality).

**AI does:**
- Detect and cut silences & dead air
- Detect repeated takes and flag for removal
- Match B-roll clips (by name) to topics being discussed
- Suggest reordering segments for better story flow
- Analyze overall narrative structure

**Human finishes:**
- Color grading
- Music & sound design
- Fine-tune cuts & pacing
- Personal style & creative decisions

---

## Architecture — FCPXML Round-Trip

The core workflow avoids all UXP API limitations by working with exported files:

```
Premiere Pro
  └─ Export sequence as FCPXML (File → Export → Final Cut Pro XML)
  └─ Export transcript as SRT (built-in Speech to Text → Captions → Export)

Ambar plugin
  1. IMPORT   — user loads FCPXML + SRT into the panel
  2. PARSE    — extract clip catalog, timecodes, track layout, B-roll names
  3. ANALYZE  — send structured data to AI (clip names + transcript + timeline)
  4. REVIEW   — AI returns decisions; user approves/rejects each one
  5. EXPORT   — plugin writes modified FCPXML; user imports as new sequence

Premiere Pro
  └─ Import the modified FCPXML as a new sequence (original untouched)
```

**Why FCPXML:**
- No UXP API limitations — just file I/O
- AI gets complete picture: every clip, position, duration, file path, name
- Non-destructive — modified XML becomes a new sequence; original is safe
- Transcript already synchronized with clip positions inside FCPXML
- B-roll clip names (e.g. `train_station.mp4`) give AI topic context without vision

---

## Data the AI Receives

| Data | Source | How |
|---|---|---|
| Clip catalog (names, positions, durations) | FCPXML | Parsed by plugin |
| Track layout (which clips on V1/V2/V3) | FCPXML | Parsed by plugin |
| What is being said + when | FCPXML caption track OR SRT file | Parsed by plugin |
| B-roll identification | Clip names (user names them descriptively) | Direct from FCPXML |

**Naming convention (user-defined):**
- V1 A-roll: `talking_head_intro.mp4`, `talking_head_main.mp4`
- V2 B-roll: `train_station.mp4`, `coffee_shop_morning.mp4`, `city_skyline.mp4`
- Unused bin clips available to insert: same descriptive naming

---

## Clip Naming & B-Roll Matching

AI reads clip names to identify content — no computer vision needed.
Future feature: "AI Clip Renamer" tab that sends frames to vision model and
renames clips automatically. For now, user names clips before exporting.

Convention: `<topic>_<broll|aroll>_<index>.mp4` or just `<topic>.mp4`.

---

## UI — 4 Tabs (Amber Design System)

### Tab 1: Import
- FCPXML file picker (drag & drop or browse)
- Transcript source: SRT file picker OR paste box
- Loaded state: sequence summary card (duration, clip count, track count)
- "Analyze with Ambar" CTA — disabled until both files loaded

### Tab 2: Analyze (auto-shown when analysis starts)
- Animated progress ring (Amber brand mark in center)
- Pipeline steps with live status:
  1. Parsing FCPXML
  2. Parsing transcript
  3. Matching B-roll to topics
  4. Detecting silence gaps
  5. Generating edit decisions
- Streaming AI log output
- Cancel button

### Tab 3: Review
- Summary stats: cuts, B-roll placements, story suggestions
- Decisions list — each item shows:
  - Timestamp, type (silence/broll/story/cut), description, confidence
  - Approve ✓ / Reject ✗ per item
- "Export Modified XML" CTA — generates and saves the rewritten FCPXML

### Tab 4: Settings
- AI Provider (Ollama / OpenAI-compatible / Gemini / OpenAI / Anthropic)
- Model + Base URL + API Key
- Workflow preferences (auto-save version, preview before export)
- About / version

---

## File Structure

```
vlog-ai-assistant/
├── manifest.json                # UXP plugin metadata
├── index.html                   # Single-page panel entry point
├── css/
│   ├── variables.css            # Amber design tokens (colors, type, shape)
│   ├── main.css                 # Layout, panel, tabs, base reset
│   └── components.css           # Buttons, forms, cards, AI effects, animations
└── js/
    ├── index.js                 # Plugin bootstrap
    ├── utils/
    │   ├── logger.js            # Logging (debug/info/warn/error)
    │   ├── constants.js         # Shared config constants
    │   ├── validators.js        # Input validation
    │   └── error-handler.js     # Error classification & user messages
    ├── core/
    │   ├── premiere-api.js      # UXP → Premiere Pro bridge (sequence detection)
    │   ├── xml-parser.js        # NEW: parse FCPXML → structured data
    │   ├── srt-parser.js        # NEW: parse SRT transcript → timestamped lines
    │   ├── xml-writer.js        # NEW: apply AI decisions → modified FCPXML
    │   └── project-reader.js    # Legacy metadata reader (fallback)
    ├── ai/
    │   ├── ai-service.js        # Universal AI client (all providers)
    │   ├── prompt-templates.js  # Prompts for XML analysis workflow
    │   └── response-parser.js   # Parse AI edit-decision responses
    └── ui/
        ├── ui-state.js          # Centralized UI state
        └── ui-controller.js     # All tab/screen event handlers
```

---

## AI Edit Decision Format

AI returns structured JSON with edit decisions:

```json
{
  "summary": "Strong vlog structure. Tightening will save ~2 minutes.",
  "decisions": [
    {
      "id": "d1",
      "type": "silence",
      "timestamp_ms": 5200,
      "duration_ms": 1800,
      "description": "1.8s dead air after intro sentence",
      "confidence": 0.94,
      "action": "cut"
    },
    {
      "id": "d2",
      "type": "broll",
      "timestamp_ms": 14000,
      "duration_ms": 8000,
      "description": "Place train_station.mp4 over 'the train station was amazing'",
      "clip_name": "train_station.mp4",
      "confidence": 0.88,
      "action": "insert_v2"
    },
    {
      "id": "d3",
      "type": "story",
      "description": "Intro feels weak — consider moving the 00:55 clip to the opening",
      "confidence": 0.72,
      "action": "suggest"
    }
  ]
}
```

---

## Build Phases

### Phase 1 — Visual foundation ✅ (current)
- [x] Amber design system (CSS variables, components, animations)
- [x] New 4-tab HTML layout
- [x] Universal AI service (Ollama, Groq, OpenAI-compatible, Gemini, Anthropic)

### Phase 2 — Data pipeline (next)
- [ ] FCPXML parser (xml-parser.js)
- [ ] SRT transcript parser (srt-parser.js)
- [ ] Import tab file loading + UI state
- [ ] Sequence summary card from parsed data

### Phase 3 — AI analysis
- [ ] Prompt template for XML + transcript analysis
- [ ] AI response parser for edit decisions
- [ ] Analyze tab pipeline UI wired to real AI calls
- [ ] Review tab decisions list with approve/reject

### Phase 4 — Export
- [ ] XML writer (apply approved decisions to FCPXML)
- [ ] Export modified FCPXML to file
- [ ] Results summary after export

### Phase 5 — Polish
- [ ] Onboarding flow
- [ ] AI clip renamer feature
- [ ] History / recent projects
- [ ] Light mode support

---

## Technical Notes

**UXP constraints:**
- No `??` or `?.` operators — use `||` and explicit null checks
- UXP fetch API works but CDN script loading may be blocked — no React/Vue
- `sequence.markers`, `sequence.videoTracks` etc. are unavailable in this PPro version
- File I/O via `require('uxp').storage` (LocalFileSystem / picker)

**FCPXML reference:**
- Premiere exports FCPXML 1.9 (Final Cut Pro interchange format)
- All clips appear as `<clip>` elements with `offset`, `duration`, `start` attributes
- Timecodes in rational time format: `"86400s/2500"` = 86400/2500 = 34.56s
- Caption tracks appear as `<title>` elements with `<text>` content

**AI provider for development:**
- Groq (console.groq.com) — free tier, very fast, OpenAI-compatible
- Base URL: `https://api.groq.com/openai/v1`
- Model: `llama-3.1-8b-instant` or `llama-3.3-70b-versatile`
