# CEP Bridge Cheatsheet
> **For Claude:** Read this alongside `PPRO_API_CHEATSHEET.md` before writing any CEP bridge code.
> ExtendScript is ES3 (ECMAScript 3). No arrow functions, no `const`/`let`, no template literals, no classes.
> All variables must use `var`. All loops must be `for(var i...)`. Strings use `+` concatenation only.

---

## 1. Two Separate Runtimes — Critical Mental Model

```
┌─────────────────────────────────────────────────────┐
│  PREMIERE PRO PROCESS                               │
│                                                     │
│  ┌─────────────────┐    ┌────────────────────────┐  │
│  │  UXP Panel      │    │  CEP Bridge Panel      │  │
│  │  (your UI)      │    │  (hidden, invisible)   │  │
│  │                 │    │                        │  │
│  │  Modern JS      │    │  index.html (tiny)     │  │
│  │  require(ppro)  │    │  CSInterface.evalScript │  │
│  │  async/await    │    │     ↓                  │  │
│  └────────┬────────┘    │  host.jsx (ES3)        │  │
│           │             │  app.enableQE()        │  │
│           │  shared     │  qe.project...         │  │
│           └── JSON ────►│  app.project...        │  │
│              temp files └────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

**UXP CANNOT call ExtendScript.** `CSInterface` does not exist in UXP. The only
communication channel is the filesystem — JSON files written to a shared temp directory.

---

## 2. File-Based IPC Protocol

### Temp directory
```
Windows: C:\Users\<user>\AppData\Local\Temp\ambar-bridge\
Mac:      /tmp/ambar-bridge/
```

### Message format

**UXP → CEP** (command file):
```json
{
  "id": "cmd_1234567890",
  "action": "razorAndDelete",
  "params": {
    "segments": [
      { "startSeconds": 12.4, "endSeconds": 14.1 },
      { "startSeconds": 45.0, "endSeconds": 47.2 }
    ]
  }
}
```

**CEP → UXP** (response file, named `<id>.response.json`):
```json
{
  "id": "cmd_1234567890",
  "success": true,
  "cutsApplied": 2,
  "error": null
}
```

### UXP side — writing a command
```js
// In premiere-api.js (UXP)
async sendBridgeCommand(action, params) {
  const ppro = this._load();
  const id = 'cmd_' + Date.now();
  const tmpDir = this._getTmpDir();
  const cmdFile = tmpDir + '/' + id + '.command.json';
  const responseFile = tmpDir + '/' + id + '.response.json';

  // Write command using UXP filesystem API
  const uxp = require('uxp');
  const fs = uxp.storage.localFileSystem;
  // ... write JSON to cmdFile

  // Poll for response (CEP processes it async)
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      if (attempts > 100) { // 10s timeout
        clearInterval(poll);
        reject(new Error('Bridge timeout'));
        return;
      }
      try {
        // Try to read response file
        const entry = await fs.getEntryWithUrl('file://' + responseFile);
        const data = await entry.read({ format: uxp.storage.formats.utf8 });
        clearInterval(poll);
        resolve(JSON.parse(data));
      } catch (e) {
        // File not yet written — keep polling
      }
    }, 100);
  });
},

_getTmpDir() {
  // UXP: use the plugin's data folder as a reliable writable location
  const uxp = require('uxp');
  return uxp.storage.localFileSystem.getDataFolder().nativePath;
},
```

---

## 3. CEP Bridge Panel Structure

```
cep-bridge/
  CSXS/
    manifest.xml          ← CEP manifest (invisible panel)
  index.html              ← Minimal HTML, loads CSInterface + poller
  js/
    main.js               ← Polling loop, reads commands, calls evalScript
    CSInterface.js        ← Adobe's CSInterface library (copy from CEP-Resources)
  jsx/
    host.jsx              ← All ExtendScript operations (ES3 only)
```

### manifest.xml (CEP 11, hidden panel)
```xml
<?xml version="1.0" encoding="UTF-8"?>
<ExtensionManifest xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  ExtensionBundleId="com.robelaipremiereassistant.bridge"
  ExtensionBundleVersion="0.1.0"
  Version="11.0">
  <ExtensionList>
    <Extension Id="com.robelaipremiereassistant.bridge.panel" Version="0.1.0"/>
  </ExtensionList>
  <ExecutionEnvironment>
    <HostList>
      <Host Name="PPRO" Version="[22.0,99.9]"/>
    </HostList>
    <LocaleList>
      <Locale Code="All"/>
    </LocaleList>
    <RequiredRuntimeList>
      <RequiredRuntime Name="CSXS" Version="11.0"/>
    </RequiredRuntimeList>
  </ExecutionEnvironment>
  <DispatchInfoList>
    <Extension Id="com.robelaipremiereassistant.bridge.panel">
      <DispatchInfo>
        <Resources>
          <MainPath>./index.html</MainPath>
          <ScriptPath>./jsx/host.jsx</ScriptPath>
        </Resources>
        <Lifecycle>
          <AutoVisible>false</AutoVisible>   <!-- hidden panel -->
          <StartOn>
            <Event>applicationActivate</Event>
          </StartOn>
        </Lifecycle>
        <UI>
          <Type>Panel</Type>
          <Menu>Ambar Bridge</Menu>
          <Geometry>
            <Size><Height>1</Height><Width>1</Width></Size>
          </Geometry>
        </UI>
      </DispatchInfo>
    </Extension>
  </DispatchInfoList>
</ExtensionManifest>
```

### index.html (minimal)
```html
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body>
<script src="js/CSInterface.js"></script>
<script src="js/main.js"></script>
</body>
</html>
```

### main.js (CEP polling loop)
```js
var cs = new CSInterface();

// Load the JSX file on startup
cs.evalScript('$.evalFile("' + cs.getSystemPath(SystemPath.EXTENSION) + '/jsx/host.jsx")');

// Determine temp directory
var tmpDir = '';
cs.evalScript('ambar_getTmpDir()', function(result) {
  tmpDir = result;
  startPolling();
});

function startPolling() {
  setInterval(function() {
    if (!tmpDir) return;
    // Ask ExtendScript to check for command files and process them
    cs.evalScript('ambar_processPendingCommands("' + tmpDir + '")', function(result) {
      // result is JSON string of processed command IDs — just for logging
    });
  }, 200); // Poll every 200ms
}
```

---

## 4. host.jsx — The ExtendScript Operations (ES3 Only)

```javascript
// host.jsx — ALL code here must be ES3 compatible
// No const, let, arrow functions, template literals, spread, destructuring

// ── Utility ──────────────────────────────────────────────────────────

function ambar_getTmpDir() {
  // Returns platform temp dir as a string
  var os = $.os;
  if (os.indexOf('Windows') !== -1) {
    return Folder.temp.fsName + '/ambar-bridge';
  }
  return '/tmp/ambar-bridge';
}

function ambar_ensureDir(path) {
  var folder = new Folder(path);
  if (!folder.exists) folder.create();
}

function ambar_readJSON(filePath) {
  var file = new File(filePath);
  if (!file.exists) return null;
  file.open('r');
  var content = file.read();
  file.close();
  try { return JSON.parse(content); } catch (e) { return null; }
}

function ambar_writeJSON(filePath, data) {
  var file = new File(filePath);
  file.open('w');
  file.write(JSON.stringify(data));
  file.close();
}

// ── Time conversion ───────────────────────────────────────────────────

// Convert seconds (float) to HH:MM:SS:FF timecode string
// Required by QE DOM razor() method
function ambar_secondsToTimecode(seconds, frameRate) {
  frameRate = frameRate || 29.97;
  var totalFrames = Math.round(seconds * frameRate);
  var frames = totalFrames % Math.round(frameRate);
  var totalSecs = Math.floor(totalFrames / Math.round(frameRate));
  var secs = totalSecs % 60;
  var mins = Math.floor(totalSecs / 60) % 60;
  var hours = Math.floor(totalSecs / 3600);

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  return pad(hours) + ':' + pad(mins) + ':' + pad(secs) + ':' + pad(frames);
}

// Get sequence frame rate
function ambar_getFrameRate() {
  var seq = app.project.activeSequence;
  if (!seq) return 29.97;
  // timebase is ticks per frame — 254016000000 ticks/sec
  var ticksPerFrame = seq.timebase;
  if (!ticksPerFrame || ticksPerFrame === 0) return 29.97;
  return 254016000000 / ticksPerFrame;
}

// ── Core Operations ───────────────────────────────────────────────────

// Razor all tracks at a given sequence time (seconds)
// Uses QE DOM — the only way to split clips programmatically
function ambar_razorAtTime(seconds) {
  try {
    app.enableQE();
    var seq = qe.project.getActiveSequence();
    if (!seq) return { success: false, error: 'No active QE sequence' };

    var frameRate = ambar_getFrameRate();
    var tc = ambar_secondsToTimecode(seconds, frameRate);

    // Razor all tracks at this timecode
    seq.razor(tc);

    return { success: true, timecode: tc };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// Ripple delete a clip that starts at or after startSeconds and ends at or before endSeconds
// After razoring at both boundaries, we select the middle clip and ripple delete it
function ambar_rippleDeleteRange(startSeconds, endSeconds) {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return { success: false, error: 'No active sequence' };

    var frameRate = ambar_getFrameRate();

    // Step 1: Razor at start and end boundaries (QE DOM)
    app.enableQE();
    var qseq = qe.project.getActiveSequence();
    var tcStart = ambar_secondsToTimecode(startSeconds, frameRate);
    var tcEnd   = ambar_secondsToTimecode(endSeconds,   frameRate);
    qseq.razor(tcStart);
    qseq.razor(tcEnd);

    // Step 2: Find and select all clips fully inside the range (standard DOM)
    var deletedCount = 0;
    var vTracks = seq.videoTracks;
    var aTracks = seq.audioTracks;
    var i, j, clip, clipStart, clipEnd;

    // Deselect all first
    seq.getSelection(); // clears selection side effect in some versions
    app.project.activeSequence.setPlayerPosition('00:00:00:00'); // harmless reset

    // Select clips fully inside range across all video tracks
    for (i = 0; i < vTracks.numTracks; i++) {
      var vTrack = vTracks[i];
      for (j = 0; j < vTrack.clips.numItems; j++) {
        clip = vTrack.clips[j];
        clipStart = clip.start.seconds;
        clipEnd   = clip.end.seconds;
        // Fully inside the delete range (with 1ms tolerance)
        if (clipStart >= (startSeconds - 0.001) && clipEnd <= (endSeconds + 0.001)) {
          clip.selected = true;
          deletedCount++;
        }
      }
    }

    // Select clips on all audio tracks too
    for (i = 0; i < aTracks.numTracks; i++) {
      var aTrack = aTracks[i];
      for (j = 0; j < aTrack.clips.numItems; j++) {
        clip = aTrack.clips[j];
        clipStart = clip.start.seconds;
        clipEnd   = clip.end.seconds;
        if (clipStart >= (startSeconds - 0.001) && clipEnd <= (endSeconds + 0.001)) {
          clip.selected = true;
        }
      }
    }

    if (deletedCount === 0) {
      return { success: false, error: 'No clips found in range after razor' };
    }

    // Step 3: Execute ripple delete via menu command (most reliable method)
    // MenuItemID 4 = Edit > Ripple Delete
    // This operates on currently selected clips
    qseq.rippleDelete(); // QE DOM ripple delete on selection

    return { success: true, deletedCount: deletedCount };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

// Apply Constant Power crossfade to audio track 1 at a given sequence time
function ambar_applyAudioCrossfade(seconds) {
  try {
    app.enableQE();
    var qseq = qe.project.getActiveSequence();
    if (!qseq) return { success: false, error: 'No QE sequence' };

    var frameRate = ambar_getFrameRate();
    var tc = ambar_secondsToTimecode(seconds, frameRate);

    // Get audio track 1 (index 0)
    var aTrack = qseq.getAudioTrackAt(0);
    if (!aTrack) return { success: false, error: 'No audio track at index 0' };

    // Apply Constant Power crossfade at this edit point
    // QE DOM: addTransition(transitionName, timecode, alignment, duration)
    // alignment: 0=start, 1=center, 2=end
    // duration in ticks: 2 frames = 2 * (254016000000 / frameRate)
    var ticksPerFrame = Math.round(254016000000 / frameRate);
    var durationTicks = 2 * ticksPerFrame;

    aTrack.addTransition('Constant Power', tc, 1, durationTicks.toString());

    return { success: true };
  } catch (e) {
    // Crossfade failure is non-fatal — log and continue
    return { success: false, error: e.toString(), fatal: false };
  }
}

// ── Command dispatcher ────────────────────────────────────────────────

function ambar_processPendingCommands(tmpDir) {
  try {
    ambar_ensureDir(tmpDir);
    var folder = new Folder(tmpDir);
    var files = folder.getFiles('*.command.json');
    var processed = [];

    for (var i = 0; i < files.length; i++) {
      var cmdFile = files[i];
      var cmd = ambar_readJSON(cmdFile.fsName);
      if (!cmd || !cmd.id || !cmd.action) continue;

      var result = { id: cmd.id, success: false, error: 'Unknown action' };

      try {
        if (cmd.action === 'razorAndDelete') {
          // Process segments in REVERSE ORDER (end → start) to preserve timing
          var segments = cmd.params.segments;
          var sorted = segments.slice().sort(function(a, b) {
            return b.startSeconds - a.startSeconds; // descending
          });

          var cutsApplied = 0;
          var errors = [];

          for (var j = 0; j < sorted.length; j++) {
            var seg = sorted[j];
            var deleteResult = ambar_rippleDeleteRange(seg.startSeconds, seg.endSeconds);
            if (deleteResult.success) {
              cutsApplied++;
              // Apply crossfade at the new edit point
              ambar_applyAudioCrossfade(seg.startSeconds);
            } else {
              errors.push(seg.startSeconds + 's: ' + deleteResult.error);
            }
          }

          result = {
            id: cmd.id,
            success: cutsApplied > 0,
            cutsApplied: cutsApplied,
            errors: errors
          };

        } else if (cmd.action === 'razorOnly') {
          var razorResult = ambar_razorAtTime(cmd.params.seconds);
          result = { id: cmd.id, success: razorResult.success, error: razorResult.error || null };

        } else if (cmd.action === 'ping') {
          result = { id: cmd.id, success: true, message: 'bridge alive' };
        }
      } catch (actionErr) {
        result = { id: cmd.id, success: false, error: actionErr.toString() };
      }

      // Write response
      var responseFile = tmpDir + '/' + cmd.id + '.response.json';
      ambar_writeJSON(responseFile, result);

      // Delete the command file so we don't process it again
      cmdFile.remove();
      processed.push(cmd.id);
    }

    return JSON.stringify(processed);
  } catch (e) {
    return JSON.stringify({ error: e.toString() });
  }
}
```

---

## 5. Enabling CEP Debug Mode (for development)

**Windows** — add registry key:
```
HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.11
  PlayerDebugMode = "1"  (string value)
```

**Mac** — run in terminal:
```bash
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
```

Restart Premiere after setting. Without this, unsigned CEP extensions won't load.

---

## 6. Installing CEP Alongside UXP

Both panels coexist in the same Premiere Pro window. Install locations:

**Windows:**
```
C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\ambar-bridge\
```

**Mac:**
```
/Library/Application Support/Adobe/CEP/extensions/ambar-bridge/
```

The UXP panel loads from UXP Developer Tools (during dev) or from your plugin package.
The CEP panel loads from the extensions folder above.

They both appear in Premiere Pro at the same time. The CEP bridge panel is invisible (`AutoVisible: false`) so users never see it — it just runs in the background.

---

## 7. Known QE DOM Quirks

| Method | Notes |
|---|---|
| `qe.project.getActiveSequence()` | Must call `app.enableQE()` first every time |
| `seq.razor(timecode)` | Timecode must be `"HH:MM:SS:FF"` format exactly |
| `track.razor(timecode)` | Razors only that track, not all tracks |
| `qseq.rippleDelete()` | Operates on current selection — select clips first |
| `track.addTransition(name, tc, align, ticks)` | Name must match exactly: `"Constant Power"` |
| QE DOM on Mac | `evalScript` is synchronous on Mac, blocks UI thread briefly |

---

## 8. ES3 Syntax Rules (ExtendScript)

```javascript
// ✅ OK in ExtendScript
var x = 1;
function foo(a) { return a + 1; }
for (var i = 0; i < arr.length; i++) {}
var s = 'hello ' + name;
JSON.parse(str);     // available in modern Premiere (2020+)
JSON.stringify(obj); // available in modern Premiere (2020+)

// ❌ NOT available in ExtendScript
const x = 1;          // ES6
let x = 1;            // ES6
var f = (a) => a + 1; // arrow function
var s = `hello ${name}`; // template literal
var [a, b] = arr;     // destructuring
var {x} = obj;        // destructuring
async function foo()  // async/await
Promise.resolve()     // Promises
Array.from()          // ES6+
Object.assign()       // ES6+
```
