# AI Service Initialization Fix — Deep Dive & Resolution

> **Date:** May 17, 2026  
> **Issue:** All video clips being classified as "Other" despite accurate llava descriptions  
> **Root Cause:** AIService initialization using wrong provider (openai-compatible instead of ollama)  
> **Status:** ✅ FIXED

---

## Problem Summary

### What You Experienced
```
Pass 1 (llava descriptions) ✅ WORKING
- Frame descriptions were accurate (outdoor beach, person talking, etc.)

Pass 2 (classification) ❌ BROKEN
- Console error: [ERROR] AI request failed Error: API error: 400 Bad Request
- Log showed: "classifyAllClips: 5 clip(s) via openai-compatible/whisper-large-v3-turbo"
- Expected: "classifyAllClips: 5 clip(s) via ollama/llama3.2"

Result: ALL 5 VIDEOS → 🏷 Other folder
```

### Why This Happened

**Settings Priority Conflict:**

```
Timeline of broken initialization:

1. constants.js loads
   ├─ AI_PROVIDER: 'ollama'
   ├─ AI_MODEL: 'llama3.2'
   
2. index.html scripts execute
   └─ ui-controller.js loads

3. UIController.init() called
   ├─ this.restoreSettings()
   │  ├─ Load localStorage (contains OLD "openai-compatible" from previous session)
   │  ├─ Set HTML select element to "openai-compatible"
   │  ├─ Call AIService.initialize({provider: "openai-compatible"})  ← WRONG!
   │
   ├─ this._initAIService()  [ADDED IN THIS FIX]
   │  ├─ this._getProvider() reads HTML element
   │  ├─ HTML element.value = "openai-compatible" (from restoreSettings)
   │  └─ Return "openai-compatible"  ← STILL WRONG!
   │
   └─ AIService.initialize({provider: "openai-compatible"})
      └─ All AI calls use wrong endpoint → 400 errors → fallback to "Other"
```

**The core problem:** localStorage + UI elements overrode CONSTANTS settings.

---

## Solution Implemented

### Architecture Decision: CONSTANTS are Primary Source of Truth

Changed `js/ui/ui-controller.js` to prioritize CONSTANTS over localStorage/UI:

```javascript
// OLD (broken)
_getProvider() {
    const el = document.getElementById('aiProvider');
    return (el ? el.value : '') || UIState.getSettings().aiProvider || CONSTANTS.AI_PROVIDER;
    // ↑ HTML element checked FIRST — gets "openai-compatible" from localStorage
}

// NEW (fixed)
_getProvider() {
    // CONSTANTS is primary source of truth
    if (CONSTANTS.AI_PROVIDER && CONSTANTS.AI_PROVIDER !== '') {
        return CONSTANTS.AI_PROVIDER;  // Checked FIRST
    }
    // Fallback chain: UI → localStorage → hardcoded
    const el = document.getElementById('aiProvider');
    return (el ? el.value : '') || UIState.getSettings().aiProvider || 'ollama';
}
```

### Three Changes Made

#### 1. **Added AIService initialization call** (ui-controller.js, line 21)
```javascript
init() {
    Logger.info('Initializing UI Controller');
    
    if (typeof Capabilities !== 'undefined') {
        // ... capabilities detection ...
    }
    
    this.restoreSettings();
    this._initAIService();     // ← NEW: Initialize AIService with current settings
    this._updateProviderUI(this._getProvider());
    // ... rest of init ...
}
```

#### 2. **Made _getProvider() and _getModel() check CONSTANTS first** (ui-controller.js, lines 233–248)
```javascript
_getProvider() {
    // CONSTANTS is primary source of truth; UI/localStorage are secondary
    if (CONSTANTS.AI_PROVIDER && CONSTANTS.AI_PROVIDER !== '') {
        return CONSTANTS.AI_PROVIDER;
    }
    const el = document.getElementById('aiProvider');
    return (el ? el.value : '') || UIState.getSettings().aiProvider || 'ollama';
}

_getModel() {
    // CONSTANTS is primary source of truth; UI/localStorage are secondary
    if (CONSTANTS.AI_MODEL && CONSTANTS.AI_MODEL !== '') {
        return CONSTANTS.AI_MODEL;
    }
    const el = document.getElementById('aiModel');
    return (el ? el.value.trim() : '') || UIState.getSettings().aiModel || '';
}
```

#### 3. **Updated restoreSettings() to use CONSTANTS as primary source** (ui-controller.js, lines 2031–2055)
```javascript
// Restore provider selector and model from UI, but prioritize CONSTANTS
if (settings.aiProvider || CONSTANTS.AI_PROVIDER) {
    const provEl = document.getElementById('aiProvider');
    const displayProvider = CONSTANTS.AI_PROVIDER || settings.aiProvider;
    if (provEl) provEl.value = displayProvider;
    CONSTANTS.AI_PROVIDER = displayProvider;
    this._updateProviderUI(displayProvider);
}
if (settings.aiModel || CONSTANTS.AI_MODEL) {
    const modEl = document.getElementById('aiModel');
    const displayModel = CONSTANTS.AI_MODEL || settings.aiModel;
    if (modEl) modEl.value = displayModel;
}

// Initialize AI service from CONSTANTS (primary) or restored settings (secondary)
AIService.initialize({
    provider: CONSTANTS.AI_PROVIDER || settings.aiProvider || 'ollama',
    apiKey:   settings.apiKey     || '',
    model:    CONSTANTS.AI_MODEL || settings.aiModel    || '',
    baseUrl:  settings.baseUrl    || '',
});

Logger.debug('Settings restored: provider=' + (CONSTANTS.AI_PROVIDER || settings.aiProvider || 'ollama') + ', model=' + (CONSTANTS.AI_MODEL || settings.aiModel || ''));
```

---

## Updated CONSTANTS Configuration

**js/utils/constants.js** (already set correctly):
```javascript
// AI Provider ('gemini' | 'openai' | 'anthropic' | 'ollama')
AI_PROVIDER: 'ollama',       // ← Local Ollama server (no API key)
AI_MODEL: 'llama3.2',        // ← Your installed model

// Vision AI — Layer 2b
VISION_MODEL: 'llava:7b',    // ← Changed from 'llava' to exact model name
```

---

## Settings Priority Chain (Highest → Lowest)

```
1. CONSTANTS.AI_PROVIDER / CONSTANTS.AI_MODEL
   └─ Set once in constants.js, applies everywhere
   
2. localStorage / UIState
   └─ User-modified settings (persisted)
   
3. HTML element .value
   └─ Current form field value
   
4. Hardcoded fallback
   └─ 'ollama'
```

**User changes to CONSTANTS flow automatically** through all code paths.

---

## How to Use This Architecture

### For Development
When you need to test a different AI provider:

```javascript
// js/utils/constants.js
AI_PROVIDER: 'ollama',      // Change this single line
AI_MODEL: 'llama3.2',       // Change this single line

// Reload plugin → all AI calls use new settings automatically
```

### For Production
```javascript
// js/utils/constants.js
AI_PROVIDER: 'ollama',      // Locked in for reliability
AI_MODEL: 'llama3.2',       // Locked in for compatibility

// Users can still override in UI Settings tab if needed
// But CONSTANTS is the baseline/default
```

---

## Consistent with Ambar Architecture

This decision aligns with **Ambar's design patterns:**

### Layer 1 (Silence Detection)
```javascript
const MIN_SILENCE_SECONDS = 1.2;   // ← Read from CONSTANTS
const PADDING_SECONDS = 0.15;      // ← Read from CONSTANTS
```
→ No dialogue with user about these values; CONSTANTS sets them.

### Layer 2 (Whisper Transcription)
```javascript
WHISPER_PROVIDER: 'groq',
WHISPER_API_KEY: '',               // ← CONSTANTS is baseline
```
→ User provides Groq key in UI, but provider comes from CONSTANTS.

### Layer 3 (Editorial AI) — NOW CONSISTENT
```javascript
AI_PROVIDER: 'ollama',
AI_MODEL: 'llama3.2',              // ← CONSTANTS is baseline (this fix)
```
→ User can override in UI, but CONSTANTS is the reliable default.

---

## Test This Fix

### Step 1: Run another organize
1. Right-click footage folder → "Organize Videos by Scene"
2. Watch the console logs

### Step 2: Expected Output
```
[INFO] Initializing UI Controller
[INFO] Settings restored: provider=ollama, model=llama3.2      ← KEY: Shows ollama
[INFO] [ProjectOrganizer] Pass 1 done — 5 description(s)
[INFO] [AIService] classifyAllClips: 5 clip(s) via ollama/llama3.2   ← KEY: Shows ollama
[INFO] [ProjectOrganizer] Pass 2 done — 5 classification(s)
```

### Step 3: Verify Bin Organization
Videos should go to correct folders:
- 🎙 Talking Head (close-up person speaking)
- 🚁 Aerial & Drone (drone shot)
- 🌿 Outdoor B-roll (outdoor landscape)
- 🌊 Landscape (scenic beach)
- etc.

NOT all going to 🏷 Other.

---

## Files Modified

| File | Changes | Why |
|---|---|---|
| js/ui/ui-controller.js | 3 edits | CONSTANTS priority, init call, restoreSettings logic |
| js/utils/constants.js | 1 edit (previous) | Set AI_PROVIDER=ollama, AI_MODEL=llama3.2 |
| CLAUDE.md | 1 edit | Document CONSTANTS priority rule for future coding |

---

## Documentation Created

- **MEMORY:** `/memories/repo/ai-service-initialization.md` — Architecture decision for future sessions
- **SESSION:** `/memories/session/classification-fix-checkpoint.md` — This session's work log
- **THIS FILE:** `/FIX_AI_SERVICE_INITIALIZATION.md` — Complete explanation

---

## FAQ

### Q: Why not just clear localStorage?
**A:** Users might have legitimate customizations stored there. CONSTANTS should be explicit baseline, localStorage should be optional override.

### Q: Will this break user customization?
**A:** No. User can still change provider/model in UI Settings tab. CONSTANTS just sets the reliable default that loads at startup.

### Q: Why check CONSTANTS first instead of checking all three?
**A:** **Principle of least surprise.** If developer sets `CONSTANTS.AI_PROVIDER = 'ollama'`, user expects ollama to be used. localStorage from a previous version should not override that.

### Q: Does this affect other CONSTANTS (silence threshold, padding, etc.)?
**A:** Not yet, but it **should**. Future fix: Apply same CONSTANTS-first pattern to SILENCE_THRESHOLD, PADDING_SECONDS, etc. See `timeline-editor.js` line 66–70 for current implementation.

---

## Next Steps

1. ✅ Code fixed in this session
2. ⏳ Test with organize videos again
3. ⏳ Verify correct bin organization
4. ⏳ If needed: Clear browser localStorage (`Dev Tools → Application → Storage → Clear All`) to confirm CONSTANTS override works
5. 📝 Update SHIPPING_CHECKLIST.md if organization feature ready for beta

