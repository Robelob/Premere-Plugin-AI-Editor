// Amber — root app: screen navigator, host frame, tweaks panel.

const { useState, useEffect, useRef, useCallback } = React;

const SCREENS = [
  { id: "onboarding", label: "Onboarding", icon: "logo", group: "First run" },
  { id: "empty", label: "Empty state", icon: "empty", group: "First run" },

  { id: "home", label: "Home", icon: "home", group: "Main" },
  { id: "silence", label: "Remove silence", icon: "scissors", group: "Main" },
  { id: "broll", label: "B-roll", icon: "film", group: "Main" },
  { id: "captions", label: "Captions", icon: "caption", group: "Main" },

  { id: "processing", label: "Processing", icon: "sparkles", group: "Run" },
  { id: "results", label: "Results", icon: "check", group: "Run" },

  { id: "settings", label: "Settings", icon: "settings", group: "More" },
];

const PROJECT = { name: "Episode 14 — coast trip", duration: "04:32", clips: 14, fps: "23.976 fps" };

function App() {
  const [screen, setScreen] = useState("home");
  const [widthMode, setWidthMode] = useState("narrow"); // narrow | wide
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState([]);

  const t = useTweaks(TWEAK_DEFAULTS);

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", t.theme);
  }, [t.theme]);

  // Apply font tweak via CSS variables
  useEffect(() => {
    const root = document.documentElement;
    const fontMap = {
      inter: '"Inter", system-ui, sans-serif',
      geist: '"Geist", "Inter", system-ui, sans-serif',
      ibm: '"IBM Plex Sans", "Inter", system-ui, sans-serif',
      system: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    };
    const monoMap = {
      jetbrains: '"JetBrains Mono", "SF Mono", Menlo, monospace',
      geistmono: '"Geist Mono", "JetBrains Mono", monospace',
      ibmmono: '"IBM Plex Mono", "JetBrains Mono", monospace',
      sfmono: '"SF Mono", Menlo, "JetBrains Mono", monospace',
    };
    root.style.setProperty("--font-ui", fontMap[t.fontUi] || fontMap.inter);
    root.style.setProperty("--font-mono", monoMap[t.fontMono] || monoMap.jetbrains);
  }, [t.fontUi, t.fontMono]);

  // Processing screen animation
  useEffect(() => {
    if (screen !== "processing") {
      setProgress(0);
      setLog([]);
      return;
    }
    setProgress(0);
    setLog([
      { t: "00:00", k: "info", m: "starting amber pipeline" },
      { t: "00:00", k: "info", m: "model=gemini-flash temp=0.2" },
    ]);
    const newLogs = [
      { p: 8,  l: { t: "00:01", k: "ok", m: "loaded sequence: Episode 14 (4:32, 14 clips)" } },
      { p: 18, l: { t: "00:02", k: "info", m: "extracting audio · 48kHz mono" } },
      { p: 28, l: { t: "00:03", k: "ai", m: "found 23 silence regions ≥ 400ms" } },
      { p: 35, l: { t: "00:04", k: "ai", m: "transcribing… 4:32 of speech" } },
      { p: 48, l: { t: "00:06", k: "ok", m: "transcript: 94 lines, 612 words" } },
      { p: 60, l: { t: "00:07", k: "ai", m: "indexing 14 bin clips · embeddings" } },
      { p: 72, l: { t: "00:09", k: "ai", m: "matched 6 b-roll moments (avg conf 0.84)" } },
      { p: 84, l: { t: "00:10", k: "info", m: "generating FCXML edits" } },
      { p: 95, l: { t: "00:11", k: "ok", m: "applying to active sequence" } },
    ];
    const iv = setInterval(() => {
      setProgress((p) => {
        const next = Math.min(100, p + 0.7);
        newLogs.forEach((nl) => {
          if (p < nl.p && next >= nl.p) {
            setLog((L) => [...L, nl.l]);
          }
        });
        if (next >= 100) {
          clearInterval(iv);
          setTimeout(() => setScreen("results"), 600);
        }
        return next;
      });
    }, 80);
    return () => clearInterval(iv);
  }, [screen]);

  const startProcess = useCallback(() => setScreen("processing"), []);
  const cancel = useCallback(() => setScreen("home"), []);

  // Group screens for the navigator
  const groups = ["First run", "Main", "Run", "More"];

  return (
    <div style={{display: "contents"}}>
      <div className="page">
        {/* LEFT — screen navigator */}
        <aside className="nav">
          <div className="nav-brand">
            <div className="nav-brand-mark" />
            <div>
              <div className="nav-brand-name">Amber</div>
              <div style={{ fontSize: 10, color: "var(--text-3)", letterSpacing: "0.04em" }}>AI Editor</div>
            </div>
            <div className="nav-brand-ver">v0.4</div>
          </div>

          {groups.map((g) => (
            <div key={g} style={{display: "contents"}}>
              <div className="nav-group-label">{g}</div>
              {SCREENS.filter((s) => s.group === g).map((s) => (
                <div
                  key={s.id}
                  className={"nav-item" + (screen === s.id ? " active" : "")}
                  onClick={() => setScreen(s.id)}
                >
                  <span className="nav-item-dot" />
                  <Icon name={s.icon} size={13} />
                  <span className="nav-item-label">{s.label}</span>
                </div>
              ))}
            </div>
          ))}

          <div style={{ flex: 1 }} />

          <div style={{
            padding: "12px 8px",
            borderTop: "1px solid var(--border-1)",
            fontSize: 10.5,
            color: "var(--text-4)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}>
            <Icon name="info" size={12} />
            <span className="nav-item-label">Click a screen to preview</span>
          </div>
        </aside>

        {/* RIGHT — stage with host frame + plugin */}
        <main className="stage" data-screen-label={SCREENS.find((s) => s.id === screen)?.label}>
          <div className="stage-grid" />

          {/* Stage toolbar (this is OUR design tool chrome, not the plugin) */}
          <div className="stage-toolbar">
            <span className="pill">
              <span className="dot" />
              <span className="mono">{SCREENS.find((s) => s.id === screen)?.label}</span>
            </span>
            <span className="crumb">
              Amber panel · <b>{widthMode === "wide" ? "Floating (520px)" : "Docked (340px)"}</b>
            </span>
            <span className="spacer" />
            <div className="stage-width-toggle">
              <button
                className={widthMode === "narrow" ? "on" : ""}
                onClick={() => setWidthMode("narrow")}
              >NARROW</button>
              <button
                className={widthMode === "wide" ? "on" : ""}
                onClick={() => setWidthMode("wide")}
              >WIDE</button>
            </div>
            <span className="kbd">⌘+K</span>
          </div>

          <div style={{ position: "absolute", inset: "52px 0 0 0", zIndex: 1 }}>
            <HostFrame panelWidthMode={widthMode}>
              <AmberPanel
                screen={screen}
                progress={progress}
                log={log}
                onStartProcess={startProcess}
                onCancel={cancel}
                onPickFeature={(id) => setScreen(id)}
                onSetScreen={setScreen}
              />
            </HostFrame>
          </div>
        </main>
      </div>

      {/* TWEAKS PANEL */}
      <TweaksPanel title="Tweaks" className="amber-tweaks">
        <TweakSection title="Theme">
          <TweakRadio
            label="Mode"
            value={t.theme}
            onChange={(v) => t.set("theme", v)}
            options={[
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
            ]}
          />
        </TweakSection>
        <TweakSection title="Typography">
          <TweakSelect
            label="UI font"
            value={t.fontUi}
            onChange={(v) => t.set("fontUi", v)}
            options={[
              { value: "inter", label: "Inter (default)" },
              { value: "geist", label: "Geist" },
              { value: "ibm", label: "IBM Plex Sans" },
              { value: "system", label: "System UI" },
            ]}
          />
          <TweakSelect
            label="Mono font"
            value={t.fontMono}
            onChange={(v) => t.set("fontMono", v)}
            options={[
              { value: "jetbrains", label: "JetBrains Mono (default)" },
              { value: "geistmono", label: "Geist Mono" },
              { value: "ibmmono", label: "IBM Plex Mono" },
              { value: "sfmono", label: "SF Mono" },
            ]}
          />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

// The plugin panel — header + tabs + body + footer (varies by screen)
function AmberPanel({ screen, progress, log, onStartProcess, onCancel, onPickFeature, onSetScreen }) {
  // Onboarding gets a totally clean panel
  if (screen === "onboarding") {
    return (
      <div className="panel" style={{ height: "100%", width: "100%", border: "none", borderRadius: 0 }}>
        <div className="p-head">
          <div className="p-head-title">
            <span className="glyph" />
            <span>Amber</span>
            <Tag variant="amber">setup</Tag>
          </div>
        </div>
        <OnboardingScreen onComplete={() => onSetScreen("home")} />
      </div>
    );
  }

  // Tabs across most screens
  const TABS = [
    { id: "home", label: "Home", icon: "home" },
    { id: "silence", label: "Silence", icon: "scissors", badge: "23" },
    { id: "broll", label: "B-roll", icon: "film", badge: "6" },
    { id: "captions", label: "Captions", icon: "caption" },
  ];

  const showTabs = ["home", "silence", "broll", "captions"].includes(screen);

  return (
    <div className="panel" style={{ height: "100%", width: "100%", border: "none", borderRadius: 0 }}>
      <div className="p-head">
        <div className="p-head-title">
          <span className="glyph" />
          <span>Amber</span>
          {screen === "processing" && (
            <span style={{display: "contents"}}>
              <span className="pulse" style={{ marginLeft: 4 }} />
              <span className="ai-text" style={{ fontSize: 10.5, fontFamily: "var(--font-mono)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                running
              </span>
            </span>
          )}
        </div>
        <div className="p-head-spacer" />
        <button className="p-head-icon" title="History" onClick={() => onSetScreen("results")}>
          <Icon name="history" size={14} />
        </button>
        <button className="p-head-icon" title="Settings" onClick={() => onSetScreen("settings")}>
          <Icon name="settings" size={14} />
        </button>
      </div>

      {showTabs && (
        <div className="p-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={"p-tab" + (screen === tab.id ? " active" : "")}
              onClick={() => onSetScreen(tab.id)}
            >
              <Icon name={tab.icon} size={12} />
              <span>{tab.label}</span>
              {tab.badge && <span className="badge">{tab.badge}</span>}
            </button>
          ))}
        </div>
      )}

      <div key={screen} className="fade-in" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {screen === "empty" && <EmptyScreen onLoadDemo={() => onSetScreen("home")} />}
        {screen === "home" && <HomeScreen project={PROJECT} onPickFeature={onPickFeature} />}
        {screen === "silence" && <SilenceScreen onStart={onStartProcess} />}
        {screen === "broll" && <BRollScreen onStart={onStartProcess} />}
        {screen === "captions" && <CaptionsScreen onStart={onStartProcess} />}
        {screen === "processing" && (
          <ProcessingScreen progress={progress} log={log} onCancel={onCancel} />
        )}
        {screen === "results" && (
          <ResultsScreen onDone={() => onSetScreen("home")} onUndo={() => onSetScreen("home")} />
        )}
        {screen === "settings" && <SettingsScreen />}
      </div>
    </div>
  );
}

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "fontUi": "inter",
  "fontMono": "jetbrains"
}/*EDITMODE-END*/;

const root = ReactDOM.createRoot(document.getElementById("app"));
root.render(<App />);
