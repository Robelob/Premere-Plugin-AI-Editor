# Ambar — AI Vlog Editor for Premiere Pro

Ambar is a Premiere Pro plugin that uses AI to automatically edit talking-head vlogs: detecting and removing silence, suggesting B-roll cut points, and placing timeline markers for review before committing any changes.

---

## How It Works

```
1. Load your SRT transcript (or let Premiere's transcription generate one)
2. Click Analyze — AI identifies silence segments, places markers on the timeline ruler
3. Review the markers — scrub through, delete any you want to keep
4. Click Commit — silence segments are ripple-deleted, gaps are closed
```

The plugin is non-destructive until you click Commit. Markers are placed first so you can review every proposed cut.

---

## Requirements

| Component | Minimum Version |
|---|---|
| Adobe Premiere Pro | 25.x Beta (UXP panels) |
| CEP Bridge support | 22.0+ |
| OS | Windows 10/11 or macOS 12+ |
| AI provider | One of: Google Gemini, OpenAI, Anthropic Claude, Ollama (local) |

---

## Installation

### Part 1 — UXP Plugin

1. Open Premiere Pro
2. Go to **Window > UXP Developer Tools**
3. Click **Add Plugin**
4. Navigate to the `vlog-ai-assistant/` folder and select `manifest.json`
5. The **Premiere AI Assistant** panel appears under **Window > Extensions (UXP)**

### Part 2 — CEP Bridge (required for timeline cuts)

The CEP bridge is a hidden background panel that performs the actual timeline edits via ExtendScript. Without it, the plugin can still place markers but cannot commit cuts.

#### Step 1 — Enable CEP debug mode

**Windows** — open Registry Editor and add this string value:

```
Key:   HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.11
Name:  PlayerDebugMode
Value: 1
```

Or paste this into PowerShell and press Enter:
```powershell
New-ItemProperty -Path "HKCU:\SOFTWARE\Adobe\CSXS.11" -Name PlayerDebugMode -Value "1" -PropertyType String -Force
```

**macOS** — run in Terminal:
```bash
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
```

#### Step 2 — Install the bridge panel

**Windows:**
```powershell
Copy-Item -Path "C:\path\to\cep-bridge\*" -Destination "$env:APPDATA\Adobe\CEP\extensions\ambar-bridge" -Recurse -Force
```

**macOS:**
```bash
cp -R /path/to/cep-bridge/ ~/Library/Application\ Support/Adobe/CEP/extensions/ambar-bridge/
```

Replace `/path/to/cep-bridge/` with the actual path to the `cep-bridge` folder in this repo.

#### Step 3 — Restart Premiere Pro

After restarting, verify the bridge is running:
1. Open the plugin panel
2. Open the browser console (UXP Developer Tools → your plugin → Inspect)
3. Type `CEPBridge.ping()` and press Enter
4. You should see `{ success: true, message: 'bridge alive' }` within 2 seconds

If ping fails, check **Window > Extensions > Ambar Bridge** — it should appear (even though it's invisible by design).

---

## API Key Setup

Open `js/utils/constants.js` and set your provider and key:

```js
AI_PROVIDER: 'gemini',   // 'gemini' | 'openai' | 'anthropic' | 'ollama' | 'openai-compatible'
```

Then in the plugin panel settings (or directly in the UI), enter your API key.

### Google Gemini (default)
- Get a key at [aistudio.google.com](https://aistudio.google.com)
- Model: `gemini-2.0-flash` (default) or `gemini-1.5-pro`

### OpenAI
- Get a key at [platform.openai.com](https://platform.openai.com)
- Model: `gpt-4o` (default)

### Anthropic Claude
- Get a key at [console.anthropic.com](https://console.anthropic.com)
- Model: `claude-opus-4-7` (default)

### Ollama (free, runs locally — no API key)
- Install from [ollama.com](https://ollama.com)
- Pull a model: `ollama pull llama3.2`
- Ensure Ollama is running before clicking Analyze
- Set `AI_PROVIDER: 'ollama'` in constants.js

### OpenAI-compatible endpoints (Groq, Mistral, LM Studio, etc.)
- Set `AI_PROVIDER: 'openai-compatible'`
- Set `baseUrl` to your endpoint (e.g. `https://api.groq.com/openai/v1`)
- Set your API key

---

## Usage

### Step 1 — Open a sequence
Open any sequence in Premiere Pro. The plugin detects it automatically.

### Step 2 — Load a transcript
Click **Load SRT** and select the `.srt` subtitle file for your footage. Premiere Pro's built-in Speech to Text can generate one: **Window > Text > Transcribe**.

### Step 3 — Analyze
Click **Analyze**. The AI reads the transcript and identifies silence and filler segments. When complete:
- Orange markers appear on the timeline ruler at each proposed cut point
- The **Commit** button becomes active

### Step 4 — Review markers
Scrub through your timeline. Each marker is labeled with the silence duration and AI confidence. To keep a segment, delete its marker (click the marker, press Delete).

### Step 5 — Commit
Click **Commit**. The plugin:
1. Ripple-deletes each marked silence segment
2. Closes the resulting gaps
3. Leaves the rest of your edit intact

---

## Tuning the AI

In `js/utils/constants.js`:

| Constant | Default | Effect |
|---|---|---|
| `MIN_SILENCE_SECONDS` | `1.2` | Ignore silences shorter than this |
| `MIN_CONFIDENCE` | `0.75` | Ignore AI suggestions below this score (0–1) |
| `PADDING_SECONDS` | `0.15` | Breath room kept on each side of every cut |

Lower `MIN_CONFIDENCE` to catch more silences. Raise `MIN_SILENCE_SECONDS` to keep short pauses.

---

## Known Limitations

### PPro 25.x Beta API gaps
These features are blocked by missing APIs in the current Beta — not plugin bugs:

- **Audio crossfades at cut points** — `track.addTransition()` is not exposed in the QE DOM in this build. Add crossfades manually with `Sequence > Apply Default Transitions to Selection` after committing.
- **Single Ctrl+Z undo** — `app.beginUndoableAction()` is absent. Each cut is a separate undo step. To undo all cuts: press Ctrl+Z repeatedly, or use **Edit > History** and click the state before Commit.

### Clip edge trimming
When a silence spans the boundary of two clips, the plugin cuts at the nearest frame and leaves a short handle. It does not trim sub-frame edges. This is intentional — full razor + ripple delete without trim avoids corrupting linked audio/video sync.

---

## Troubleshooting

**"CEP Bridge not found" after Commit**
- Verify debug mode is enabled (see installation §Step 1)
- Verify the `ambar-bridge` folder exists in `%APPDATA%\Adobe\CEP\extensions\` (Windows) or `~/Library/Application Support/Adobe/CEP/extensions/` (macOS)
- Restart Premiere Pro after installing the bridge

**"No active sequence" on Analyze**
- Click on your sequence in the timeline to bring it into focus before analyzing

**Markers placed but 0 cuts applied**
- The bridge may have timed out (default: 60s). If your sequence is very long with many segments, try committing in smaller batches by deleting all but a few markers before each commit.

**AI returns unexpected results**
- Check that your SRT file matches the footage (same language, same clip)
- Try a higher-quality model (e.g. `gemini-1.5-pro` instead of `flash`)
- The system prompt assumes talking-head footage — results on music or b-roll-heavy videos will vary

---

## Project Structure

```
vlog-ai-assistant/        ← UXP plugin (load in UXP Developer Tools)
  manifest.json           ← Plugin ID: com.robelaipremiereassistant.plugin.v2
  index.html
  js/
    ai/
      ai-service.js       ← Multi-provider AI client
      prompt-templates.js ← System prompts (story-first silence detection)
      response-parser.js  ← Validates AI output, parseEditPlan()
    core/
      cep-bridge.js       ← UXP side of file-based IPC
      premiere-api.js     ← UXP Premiere API wrapper
      timeline-editor.js  ← analyzeAndMark() + commitEdits()
    ui/
      ui-controller.js    ← Button handlers, two-step flow
      ui-state.js         ← READY / ANALYZING / MARKERS_PLACED / COMMITTING / COMMITTED

cep-bridge/               ← CEP panel (install to CEP extensions folder)
  CSXS/manifest.xml       ← CEP 11 hidden panel
  jsx/host.jsx            ← All ExtendScript: razor, ripple delete
  js/main.js              ← 200ms polling loop
```

---

## Version

0.1.0 — initial release
