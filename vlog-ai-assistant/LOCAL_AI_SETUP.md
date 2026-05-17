# Local AI Setup Guide
> **For Claude Code:** Read this before touching anything related to Ollama, Whisper, or local AI.
> This tells you exactly what the user has installed and what still needs to be set up.

---

## What the User Has

| Tool | Status | Notes |
|---|---|---|
| Ollama | ✅ Installed | Running at `http://localhost:11434` |
| Groq API key | ✅ Active | Used for Layer 2 Whisper transcription |
| GitHub Copilot | ✅ Active (limited) | Use for inline completions, not architecture |

---

## Ollama — Layer 3 (Editorial AI)

Ollama handles all text LLM requests. It's already wired in `ai-service.js`.
User just needs to pull a model.

### Recommended models (tell user to run ONE of these)

```bash
ollama pull llama3.2       # best balance: fast, good reasoning, 2GB
ollama pull mistral        # alternative: slightly faster on some hardware
ollama pull gemma2:2b      # smallest: very fast, weaker reasoning
ollama pull phi3:mini      # Microsoft model, good for short prompts
```

**For plugin testing use `llama3.2`** — it handles JSON output reliably.

### Verify Ollama is running

```bash
curl http://localhost:11434/api/generate -d '{"model":"llama3.2","prompt":"say ok","stream":false}'
# Should return: {"response":"ok",...}
```

### Ollama JSON mode (required for our editorial prompt)

Add `format: 'json'` to the Ollama request body in `ai-service.js`:

```js
// In ai-service.js — _callOllama() method
body: JSON.stringify({
  model:  this.model || 'llama3.2',
  prompt: systemPrompt + '\n\n' + userPrompt,
  stream: false,
  format: 'json',   // ← ADD THIS — forces valid JSON output
  options: { temperature: 0 },
}),
```

### Ollama does NOT do audio transcription

Ollama is text-only (and vision for some models). It cannot transcribe audio.
Layer 2 (Whisper) must use Groq API or a separate local Whisper server.
Do not try to make Ollama handle audio — it will fail silently.

---

## Groq — Layer 2 (Whisper Transcription)

User already has a Groq API key. Use it for Whisper transcription only.
Groq handles speech-segment blobs (not full files) so the 25MB limit is not an issue.

### Groq key location

Store in plugin settings UI or in `constants.js`:
```js
WHISPER_PROVIDER: 'groq',
WHISPER_API_KEY:  'gsk_...',   // user's existing Groq key
```

### Test Groq transcription

```js
// Quick test in browser console / UXP DevTools console:
const form = new FormData();
form.append('file', new Blob(['...'], { type: 'audio/wav' }), 'test.wav');
form.append('model', 'whisper-large-v3-turbo');
form.append('response_format', 'verbose_json');
form.append('timestamp_granularities[]', 'word');
const res  = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + GROQ_KEY },
  body: form,
});
console.log(await res.json());
```

---

## Optional: Local Whisper Server (future — when user wants fully offline)

If the user wants zero cloud dependency for transcription, set up a local Whisper server.

### Option A — faster-whisper server (recommended)

```bash
pip install faster-whisper flask
# Create server.py:
# from faster_whisper import WhisperModel
# model = WhisperModel("base", device="cpu", compute_type="int8")
# ... Flask endpoint at localhost:8080/v1/audio/transcriptions
```

### Option B — whisper.cpp with server mode

```bash
git clone https://github.com/ggml-org/whisper.cpp
cd whisper.cpp && make server
./models/download-ggml-model.sh base.en
./server -m models/ggml-base.en.bin --port 8080
```

Both expose an OpenAI-compatible endpoint at `localhost:8080` that `WhisperService._whisperAPI()` already supports.

Set `WHISPER_PROVIDER: 'local-whisper'` in constants.js to switch.

---

## GitHub Copilot — How to Use It Alongside Claude Code

### Use Copilot for
- Inline completions inside functions Claude Code already created
- Boilerplate: WAV encoding, FormData construction, error handler patterns
- Completing repetitive mapping/transformation code
- Quick fixes: renaming variables, adding null checks

### Use Claude Code for
- Creating new files from scratch
- Multi-file refactors
- Anything involving the PPro UXP or CEP API (Copilot doesn't know it)
- Architecture decisions and wiring modules together
- When you're stuck on a bug

### How to split a coding session

1. **Start with Claude Code**: "Create `js/core/audio-analyzer.js` based on TRANSCRIPT_GUIDE.md Layer 1"
2. **Switch to Copilot**: fill in the helper functions inside the file Claude created
3. **Back to Claude Code**: "Wire audio-analyzer.js into timeline-editor.js"

### What to paste into Claude Code every session

Always paste the contents of these files at the start:
- `CLAUDE.md` (project brief)
- The relevant cheatsheet (`PPRO_API_CHEATSHEET.md` or `CEP_BRIDGE_CHEATSHEET.md`)
- The specific guide for what you're building (`TRANSCRIPT_GUIDE.md` if audio-related)

Claude Code context is limited — don't assume it remembers the last session.

---

## Provider Decision Tree (for constants.js defaults)

```
User wants fully free + offline?
  → AI_PROVIDER: 'ollama' (Layer 3)
  → WHISPER_PROVIDER: 'local-whisper' (Layer 2, needs whisper.cpp setup)

User has Groq key (already the case)?
  → AI_PROVIDER: 'ollama' OR 'groq' (Layer 3)
  → WHISPER_PROVIDER: 'groq' (Layer 2) ← easiest, one key covers both layers

User wants best quality?
  → AI_PROVIDER: 'anthropic' with claude-sonnet-4-5 (Layer 3)
  → WHISPER_PROVIDER: 'openai' with whisper-1 (Layer 2)
```

**Default in constants.js should be:**
```js
AI_PROVIDER:      'groq',                    // works with existing key
AI_MODEL:         'llama-3.3-70b-versatile', // Groq's best free text model
WHISPER_PROVIDER: 'groq',                    // same key, Whisper endpoint
WHISPER_API_KEY:  '',                        // user fills this in UI
```

This gives the user one key, one provider, two capabilities — lowest friction to ship.
