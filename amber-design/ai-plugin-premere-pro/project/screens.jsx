// Amber — all 9 screens. Each is a function component returning a panel body.
// They're invoked by the App with shared state.

const { useState, useEffect, useRef, useMemo } = React;

/* ============================================================
   EMPTY — no sequence loaded
   ============================================================ */
function EmptyScreen({ onLoadDemo }) {
  return (
    <div className="p-body" style={{ display: "flex", flexDirection: "column" }}>
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "32px 18px",
        gap: 14,
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: 16,
          background: "var(--bg-2)",
          border: "1px dashed var(--border-2)",
          display: "grid", placeItems: "center",
          color: "var(--text-3)",
        }}>
          <Icon name="film" size={28} />
        </div>
        <div>
          <div className="h-title" style={{ marginBottom: 4 }}>No active sequence</div>
          <div className="h-sub" style={{ maxWidth: 240, margin: "0 auto" }}>
            Amber needs an open sequence in your timeline to start analyzing audio and clips.
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", maxWidth: 220 }}>
          <Button variant="amber" block icon="film" onClick={onLoadDemo}>Open a sequence</Button>
          <Button variant="ghost" block size="sm" onClick={onLoadDemo}>Try with demo project</Button>
        </div>
      </div>

      <div style={{
        borderTop: "1px solid var(--border-1)",
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "var(--bg-1)",
        color: "var(--text-3)",
        fontSize: 11.5,
      }}>
        <Icon name="info" size={13} />
        <span>Tip: drag a sequence into the Premiere timeline, then click <b style={{ color: "var(--text-2)" }}>Refresh</b>.</span>
      </div>
    </div>
  );
}

/* ============================================================
   HOME — Feature cards
   ============================================================ */
function HomeScreen({ project, onPickFeature }) {
  const features = [
    {
      id: "silence",
      title: "Remove silence",
      sub: "Auto-detect dead air, breaths, and ums.",
      icon: "scissors",
      stat: "12 cuts",
      color: "amber",
    },
    {
      id: "broll",
      title: "Suggest B-roll",
      sub: "Match clips from your bin to topics.",
      icon: "film",
      stat: "8 ideas",
      color: "ai",
    },
    {
      id: "captions",
      title: "Generate captions",
      sub: "Transcribe and style burn-in subtitles.",
      icon: "caption",
      stat: "auto",
      color: "amber",
    },
  ];
  return (
    <div className="p-body">
      {/* Project context */}
      <div className="card" style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: "var(--ai-grad-soft)",
          border: "1px solid oklch(0.68 0.220 295 / 0.35)",
          display: "grid", placeItems: "center",
          color: "var(--ai-cyan)",
        }}>
          <Icon name="film" size={16} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {project.name}
          </div>
          <div className="mono" style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 1 }}>
            {project.duration} · {project.clips} clips · {project.fps}
          </div>
        </div>
        <Button variant="ghost" size="sm" icon="external" title="Open in Premiere" />
      </div>

      {/* AI suggestion card */}
      <div className="ai-card" style={{ marginBottom: 16 }}>
        <div className="ai-card-inner">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span className="pulse" />
            <span className="ai-text" style={{ fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
              Amber suggests
            </span>
            <Confidence value={0.86} />
          </div>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8, lineHeight: 1.4 }}>
            This looks like a vlog. Want me to remove silences, find B-roll moments, and burn captions in one pass?
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <Button variant="ai" size="sm" icon="sparkles">Run full pass</Button>
            <Button variant="ghost" size="sm">Not now</Button>
          </div>
        </div>
      </div>

      {/* Feature cards */}
      <SectionHead label="Features" hint="3 available" />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {features.map((f) => (
          <button
            key={f.id}
            className="list-card"
            onClick={() => onPickFeature(f.id)}
            style={{ alignItems: "center", textAlign: "left" }}
          >
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              background: f.color === "ai" ? "var(--ai-grad-soft)" : "var(--amber-tint)",
              border: `1px solid ${f.color === "ai" ? "oklch(0.68 0.220 295 / 0.35)" : "oklch(0.80 0.170 75 / 0.35)"}`,
              display: "grid", placeItems: "center",
              color: f.color === "ai" ? "var(--ai-cyan)" : "var(--amber-bright)",
              flex: "none",
            }}>
              <Icon name={f.icon} size={16} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{f.title}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>{f.sub}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-3)" }}>
              <Tag variant={f.color === "ai" ? "ai" : "amber"}>{f.stat}</Tag>
              <Icon name="chevron" size={14} />
            </div>
          </button>
        ))}
      </div>

      <SectionHead label="History" hint="last 7 days" />
      <div className="card flush">
        {[
          { name: "Caption pass — Episode 14", time: "2h ago", tag: "captions" },
          { name: "Silence removal", time: "yesterday", tag: "silence" },
          { name: "B-roll suggestions", time: "3 days ago", tag: "broll" },
        ].map((h, i) => (
          <div key={i} className="row" style={{
            borderTop: i === 0 ? "none" : "1px solid var(--border-1)",
            borderRadius: 0,
          }}>
            <Icon name="history" size={13} style={{ color: "var(--text-3)" }} />
            <div className="row-text">
              <div className="row-title">{h.name}</div>
              <div className="row-sub mono">{h.time}</div>
            </div>
            <Tag>{h.tag}</Tag>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   SILENCE REMOVAL
   ============================================================ */
function SilenceScreen({ onStart }) {
  const [threshold, setThreshold] = useState(-38);
  const [padding, setPadding] = useState(120);
  const [minLen, setMinLen] = useState(400);
  const [removeFillers, setRemoveFillers] = useState(true);
  const [keepBreaths, setKeepBreaths] = useState(false);

  const detected = 23;
  const removed = 18;
  const saved = "1m 42s";

  // generate "silent ranges" against waveform
  const silentRanges = [
    [6, 11], [22, 27], [38, 43], [54, 58], [68, 75],
  ];

  return (
    <div className="p-body">
      {/* Preview */}
      <SectionHead label="Timeline preview" hint="00:00 — 04:32">
        <span className="tag">A1 · Voice</span>
      </SectionHead>
      <div className="card" style={{ padding: 10, marginBottom: 14 }}>
        <div className="tl-ruler">
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i}>{`${i * 45}s`}</span>
          ))}
        </div>
        <Waveform bars={80} silentRanges={silentRanges} />
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 10,
          fontSize: 11,
        }}>
          <div style={{ display: "flex", gap: 12, color: "var(--text-3)" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 8, height: 8, background: "var(--amber)", borderRadius: 2 }} />
              Voice
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 8, height: 8, background: "oklch(0.70 0.200 25 / 0.7)", borderRadius: 2 }} />
              Silent ({silentRanges.length})
            </span>
          </div>
          <div className="mono" style={{ color: "var(--text-3)", fontSize: 10.5 }}>
            saves <b style={{ color: "var(--amber-bright)" }}>{saved}</b>
          </div>
        </div>
      </div>

      <SectionHead label="Detection" />

      <div className="field">
        <div className="field-label">
          Silence threshold
          <span className="help">dB below peak</span>
        </div>
        <Slider value={threshold} min={-60} max={-12} onChange={setThreshold} suffix=" dB" />
      </div>

      <div className="field">
        <div className="field-label">
          Minimum length
          <span className="help">ignore shorter pauses</span>
        </div>
        <Slider value={minLen} min={100} max={2000} step={50} onChange={setMinLen} suffix=" ms" />
      </div>

      <div className="field">
        <div className="field-label">
          Edge padding
          <span className="help">keep before/after speech</span>
        </div>
        <Slider value={padding} min={0} max={500} step={10} onChange={setPadding} suffix=" ms" />
      </div>

      <SectionHead label="Smart" hint="AI-assisted" />
      <div className="card flush" style={{ marginBottom: 14 }}>
        <div className="row" style={{ borderRadius: 0 }}>
          <Icon name="sparkles" size={14} style={{ color: "var(--ai-cyan)" }} />
          <div className="row-text">
            <div className="row-title">Remove filler words</div>
            <div className="row-sub">"um", "uh", "like", "so..."</div>
          </div>
          <Toggle checked={removeFillers} onChange={setRemoveFillers} />
        </div>
        <div className="row">
          <Icon name="ear" size={14} style={{ color: "var(--ai-cyan)" }} />
          <div className="row-text">
            <div className="row-title">Keep audible breaths</div>
            <div className="row-sub">Sounds more natural after cuts</div>
          </div>
          <Toggle checked={keepBreaths} onChange={setKeepBreaths} />
        </div>
      </div>

      {/* Summary card */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 8,
        marginBottom: 14,
      }}>
        {[
          { l: "Detected", v: detected },
          { l: "Will cut", v: removed, hi: true },
          { l: "Time saved", v: saved, hi: true },
        ].map((m, i) => (
          <div key={i} className="card" style={{ padding: "10px 12px" }}>
            <div className="mono" style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{m.l}</div>
            <div className="mono" style={{
              fontSize: 18,
              fontWeight: 600,
              color: m.hi ? "var(--amber-bright)" : "var(--text-1)",
              marginTop: 4,
            }}>{m.v}</div>
          </div>
        ))}
      </div>

      <Button variant="amber" block icon="scissors" onClick={onStart}>
        Apply to timeline
      </Button>
    </div>
  );
}

/* ============================================================
   B-ROLL SUGGESTIONS
   ============================================================ */
function BRollScreen({ onStart }) {
  const [selected, setSelected] = useState(new Set([0, 2, 4]));
  const [filter, setFilter] = useState("all");

  const suggestions = [
    { t: "00:14", topic: "intro / city skyline", clip: "DJI_0421", dur: "0:08", confidence: 0.92, hue: 220, kind: "match" },
    { t: "00:48", topic: "coffee shop b-roll", clip: "MVI_3382", dur: "0:05", confidence: 0.78, hue: 60, kind: "match" },
    { t: "01:22", topic: "laptop typing close-up", clip: "MVI_3401", dur: "0:04", confidence: 0.71, hue: 285, kind: "generate" },
    { t: "02:05", topic: "walking shot, park", clip: "DJI_0427", dur: "0:06", confidence: 0.88, hue: 145, kind: "match" },
    { t: "02:50", topic: "screen recording (editor)", clip: "—", dur: "0:08", confidence: 0.65, hue: 295, kind: "stock" },
    { t: "03:31", topic: "outro / sunset wide", clip: "DJI_0432", dur: "0:09", confidence: 0.94, hue: 25, kind: "match" },
  ];

  const toggle = (i) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });

  return (
    <div className="p-body">
      <SectionHead label="Suggestions" hint={`${selected.size} of ${suggestions.length} selected`} />
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <Seg
          options={[
            { value: "all", label: "All" },
            { value: "match", label: "From bin" },
            { value: "stock", label: "Stock" },
            { value: "generate", label: "Generate" },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <div style={{ flex: 1 }} />
        <Button variant="ghost" size="sm" icon="sparkles">Re-suggest</Button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {suggestions.map((s, i) => {
          const sel = selected.has(i);
          return (
            <div
              key={i}
              className={"list-card" + (sel ? " selected" : "")}
              onClick={() => toggle(i)}
              style={{ padding: 8 }}
            >
              <Check checked={sel} onChange={() => toggle(i)} />
              <Thumb w={72} h={48} code={s.clip === "—" ? "STOCK" : s.clip} hue={s.hue} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12.5,
                  fontWeight: 600,
                  marginBottom: 3,
                }}>
                  <span className="mono" style={{ color: "var(--amber-bright)", fontSize: 11 }}>{s.t}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.topic}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-3)" }}>
                  <span className="mono">{s.dur}</span>
                  <span>·</span>
                  <Tag variant={s.kind === "generate" ? "ai" : s.kind === "stock" ? "amber" : ""}>
                    {s.kind}
                  </Tag>
                  <span style={{ flex: 1 }} />
                  <Confidence value={s.confidence} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{
        marginTop: 14,
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 8,
      }}>
        <Button variant="ghost" icon="play">Preview</Button>
        <Button variant="amber" icon="film" onClick={onStart} disabled={selected.size === 0}>
          Insert {selected.size}
        </Button>
      </div>
    </div>
  );
}

/* ============================================================
   CAPTIONS
   ============================================================ */
function CaptionsScreen({ onStart }) {
  const [style, setStyle] = useState("burn");
  const [position, setPosition] = useState("bottom");
  const [font, setFont] = useState("inter");
  const [maxLine, setMaxLine] = useState(38);
  const [highlight, setHighlight] = useState(true);

  const transcript = [
    { t: "00:00.4", text: "So yesterday I drove out to the coast and honestly", emph: ["honestly"] },
    { t: "00:04.1", text: "it was the most peaceful spot I've found this year.", emph: ["peaceful"] },
    { t: "00:08.6", text: "Here's a quick rundown of how the day went.", emph: [] },
    { t: "00:12.2", text: "We left at six, beat traffic, and grabbed coffee on the way.", emph: ["coffee"] },
  ];

  return (
    <div className="p-body">
      {/* Preview */}
      <SectionHead label="Live preview" />
      <div style={{
        position: "relative",
        height: 140,
        borderRadius: 10,
        marginBottom: 14,
        border: "1px solid var(--border-1)",
        overflow: "hidden",
        background: `repeating-linear-gradient(45deg,
          oklch(0.28 0.04 200) 0px, oklch(0.28 0.04 200) 8px,
          oklch(0.24 0.04 200) 8px, oklch(0.24 0.04 200) 16px)`,
      }}>
        <div className="mono" style={{
          position: "absolute", top: 8, left: 10,
          fontSize: 9.5,
          color: "oklch(0.85 0.05 200)",
          background: "oklch(0 0 0 / 0.4)",
          padding: "1px 5px",
          borderRadius: 3,
        }}>
          PROGRAM PREVIEW · 1920×1080
        </div>
        <div style={{
          position: "absolute",
          left: 0, right: 0,
          [position === "top" ? "top" : position === "middle" ? "top" : "bottom"]:
            position === "middle" ? "50%" : 18,
          transform: position === "middle" ? "translateY(-50%)" : "none",
          textAlign: "center",
          padding: "0 24px",
        }}>
          <div style={{
            display: "inline-block",
            background: style === "box" ? "oklch(0 0 0 / 0.7)" : "transparent",
            padding: style === "box" ? "6px 12px" : 0,
            borderRadius: 4,
            fontFamily: font === "mono" ? "var(--font-mono)" : "var(--font-ui)",
            fontWeight: 700,
            fontSize: 17,
            color: "white",
            textShadow: style === "burn" ? "0 1px 2px black, 0 0 8px oklch(0 0 0 / 0.8)" : "none",
            letterSpacing: "-0.005em",
          }}>
            it was the most{" "}
            <span style={{
              color: highlight ? "oklch(0.92 0.18 75)" : "white",
              textShadow: highlight ? "0 0 12px oklch(0.80 0.170 75 / 0.6)" : undefined,
            }}>peaceful</span>{" "}
            spot I've found this year.
          </div>
        </div>
      </div>

      <SectionHead label="Style" />
      <div className="field">
        <div className="field-label">Burn mode</div>
        <Seg
          variant="amber"
          options={[
            { value: "burn", label: "Burn in" },
            { value: "box", label: "Boxed" },
            { value: "track", label: "MOGRT" },
          ]}
          value={style}
          onChange={setStyle}
        />
      </div>

      <div className="field">
        <div className="field-label">Position</div>
        <Seg
          options={[
            { value: "top", label: "Top" },
            { value: "middle", label: "Middle" },
            { value: "bottom", label: "Bottom" },
          ]}
          value={position}
          onChange={setPosition}
        />
      </div>

      <div className="field">
        <div className="field-label">Font</div>
        <div className="seg" style={{ width: "100%" }}>
          {[
            { value: "inter", label: "Inter" },
            { value: "mono", label: "JetBrains Mono" },
            { value: "system", label: "System" },
          ].map((o) => (
            <button
              key={o.value}
              className={font === o.value ? "on" : ""}
              onClick={() => setFont(o.value)}
              style={{ flex: 1, fontFamily: o.value === "mono" ? "var(--font-mono)" : "var(--font-ui)" }}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <div className="field-label">
          Max characters per line
          <span className="help">readability</span>
        </div>
        <Slider value={maxLine} min={20} max={60} onChange={setMaxLine} suffix=" ch" />
      </div>

      <div className="row" style={{ padding: "10px 0", borderTop: "1px solid var(--border-1)" }}>
        <Icon name="sparkles" size={14} style={{ color: "var(--ai-cyan)" }} />
        <div className="row-text">
          <div className="row-title">Highlight emphasis words</div>
          <div className="row-sub">AI picks 1-2 words per caption to color</div>
        </div>
        <Toggle checked={highlight} onChange={setHighlight} />
      </div>

      <SectionHead label="Transcript" hint="4:32 · auto" />
      <div className="card flush" style={{ marginBottom: 14 }}>
        {transcript.map((line, i) => (
          <div key={i} className="row" style={{
            borderTop: i === 0 ? "none" : "1px solid var(--border-1)",
            borderRadius: 0,
            alignItems: "flex-start",
          }}>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 2 }}>
              {line.t}
            </span>
            <div className="row-text" style={{ fontSize: 12.5 }}>
              {line.text.split(" ").map((w, j) => {
                const clean = w.replace(/[.,!?]/g, "");
                const isEmph = highlight && line.emph.includes(clean);
                return (
                  <span key={j} style={{display: "contents"}}>
                    <span style={{
                      color: isEmph ? "var(--amber-bright)" : "var(--text-1)",
                      fontWeight: isEmph ? 600 : 400,
                    }}>{w}</span>
                    {" "}
                  </span>
                );
              })}
            </div>
            <Icon name="play" size={11} style={{ color: "var(--text-4)" }} />
          </div>
        ))}
      </div>

      <Button variant="amber" block icon="caption" onClick={onStart}>
        Generate captions
      </Button>
    </div>
  );
}

/* ============================================================
   PROCESSING — animated AI thinking
   ============================================================ */
function ProcessingScreen({ progress, log, onCancel }) {
  return (
    <div className="p-body" style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ textAlign: "center", padding: "20px 8px 14px" }}>
        <div style={{
          width: 88, height: 88,
          margin: "0 auto 16px",
          position: "relative",
        }}>
          {/* Outer ring */}
          <svg viewBox="0 0 100 100" style={{ position: "absolute", inset: 0 }}>
            <defs>
              <linearGradient id="ai-stroke" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="oklch(0.70 0.230 335)" />
                <stop offset="50%" stopColor="oklch(0.68 0.220 295)" />
                <stop offset="100%" stopColor="oklch(0.82 0.130 215)" />
              </linearGradient>
            </defs>
            <circle cx="50" cy="50" r="44" stroke="var(--bg-3)" strokeWidth="4" fill="none" />
            <circle
              cx="50" cy="50" r="44"
              stroke="url(#ai-stroke)"
              strokeWidth="4"
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${(progress / 100) * 276} 276`}
              transform="rotate(-90 50 50)"
              style={{ transition: "stroke-dasharray 240ms ease-out", filter: "drop-shadow(0 0 6px oklch(0.68 0.220 295 / 0.5))" }}
            />
          </svg>
          {/* Inner brand mark */}
          <div style={{
            position: "absolute",
            inset: 22,
            borderRadius: "50%",
            background: "var(--amber)",
            boxShadow: "inset 0 1px 0 oklch(1 0 0 / 0.3), 0 0 24px oklch(0.80 0.170 75 / 0.55)",
            display: "grid",
            placeItems: "center",
            color: "oklch(0.15 0.020 60)",
          }}>
            <Icon name="sparkles" size={20} />
          </div>
        </div>

        <div className="ai-text" style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", fontFamily: "var(--font-mono)", marginBottom: 6 }}>
          Amber is editing
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
          {progress < 30 ? "Analyzing audio…" :
           progress < 55 ? "Detecting B-roll moments…" :
           progress < 80 ? "Generating captions…" :
           progress < 99 ? "Applying to timeline…" :
           "Almost done"}
        </div>
        <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
          {Math.round(progress)}% · ~{Math.max(1, Math.ceil((100 - progress) / 4))}s remaining
        </div>
      </div>

      {/* Step list */}
      <SectionHead label="Pipeline" />
      <div className="card flush" style={{ marginBottom: 14 }}>
        {[
          { l: "Extracting audio waveform", p: 15 },
          { l: "Detecting silence", p: 30 },
          { l: "Transcribing speech", p: 55 },
          { l: "Matching B-roll suggestions", p: 75 },
          { l: "Generating XML edits", p: 95 },
          { l: "Applying to sequence", p: 100 },
        ].map((s, i) => {
          const done = progress >= s.p;
          const active = !done && progress >= (i === 0 ? 0 : [0, 15, 30, 55, 75, 95][i]);
          return (
            <div key={i} className="row" style={{
              borderTop: i === 0 ? "none" : "1px solid var(--border-1)",
              borderRadius: 0,
            }}>
              {done ? (
                <div style={{
                  width: 16, height: 16, borderRadius: "50%",
                  background: "var(--success)",
                  display: "grid", placeItems: "center",
                  color: "oklch(0.15 0.05 145)",
                }}>
                  <Icon name="check" size={11} />
                </div>
              ) : active ? (
                <Spinner size={14} />
              ) : (
                <div style={{
                  width: 16, height: 16, borderRadius: "50%",
                  border: "1.5px solid var(--border-2)",
                }} />
              )}
              <div className="row-text">
                <div className="row-title" style={{ color: done ? "var(--text-2)" : active ? "var(--text-1)" : "var(--text-3)" }}>
                  {s.l}
                </div>
              </div>
              {active && <Tag variant="ai">running</Tag>}
            </div>
          );
        })}
      </div>

      <SectionHead label="Log" hint="streaming">
        <span className="pulse" style={{ marginLeft: 6 }} />
      </SectionHead>
      <div className="card" style={{
        padding: 10,
        marginBottom: 14,
        background: "oklch(0.10 0.010 285)",
        fontFamily: "var(--font-mono)",
        fontSize: 10.5,
        color: "var(--text-2)",
        height: 110,
        overflowY: "auto",
        lineHeight: 1.55,
      }}>
        {log.map((l, i) => (
          <div key={i} style={{ display: "flex", gap: 8 }}>
            <span style={{ color: "var(--text-4)" }}>{l.t}</span>
            <span style={{
              color:
                l.k === "ai" ? "var(--ai-cyan)" :
                l.k === "ok" ? "var(--success)" :
                "var(--text-2)",
              minWidth: 36,
            }}>{l.k.toUpperCase()}</span>
            <span style={{ flex: 1 }}>{l.m}</span>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, color: "var(--text-3)" }}>
          <span style={{ color: "var(--amber-bright)" }}>▌</span>
        </div>
      </div>

      <Button variant="ghost" block onClick={onCancel} icon="x">Cancel</Button>
    </div>
  );
}

/* ============================================================
   RESULTS — before / after summary
   ============================================================ */
function ResultsScreen({ onDone, onUndo }) {
  return (
    <div className="p-body">
      <div style={{ textAlign: "center", padding: "10px 0 18px" }}>
        <div style={{
          width: 52, height: 52,
          margin: "0 auto 10px",
          borderRadius: "50%",
          background: "oklch(0.78 0.180 145 / 0.18)",
          border: "1px solid oklch(0.78 0.180 145 / 0.4)",
          display: "grid", placeItems: "center",
          color: "var(--success)",
        }}>
          <Icon name="check" size={24} />
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Edit applied</div>
        <div style={{ fontSize: 12, color: "var(--text-3)" }}>
          Saved as <span className="mono" style={{ color: "var(--text-2)" }}>v_amber_2026-05-12_3</span>
        </div>
      </div>

      <SectionHead label="Summary" hint="Episode 14" />
      <div className="card" style={{ marginBottom: 14, padding: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 12, alignItems: "center" }}>
          <div style={{ textAlign: "center" }}>
            <div className="mono" style={{ fontSize: 10, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>before</div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>06:18</div>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--text-4)", marginTop: 2 }}>112 cuts</div>
          </div>
          <Icon name="chevron" size={18} style={{ color: "var(--amber)" }} />
          <div style={{ textAlign: "center" }}>
            <div className="mono" style={{ fontSize: 10, color: "var(--amber-bright)", textTransform: "uppercase", letterSpacing: "0.05em" }}>after</div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 600, color: "var(--amber-bright)", marginTop: 4 }}>04:36</div>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--text-4)", marginTop: 2 }}>148 cuts</div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
        {[
          { l: "Silences removed", v: "18", sub: "−1:42 dead air" },
          { l: "B-roll inserted", v: "6", sub: "from bin + 1 stock" },
          { l: "Captions burned", v: "94", sub: "lines · 4:36" },
          { l: "Filler words", v: "23", sub: "um · uh · like" },
        ].map((s, i) => (
          <div key={i} className="card" style={{ padding: 10 }}>
            <div className="mono" style={{ fontSize: 9.5, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.l}</div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 600, marginTop: 4, color: "var(--amber-bright)" }}>{s.v}</div>
            <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <SectionHead label="Changes" hint="14 items" />
      <div className="card flush" style={{ marginBottom: 14 }}>
        {[
          { t: "00:14", k: "broll", m: "Inserted DJI_0421 (skyline)" },
          { t: "00:32", k: "cut", m: "Removed 1.4s silence" },
          { t: "00:48", k: "broll", m: "Inserted MVI_3382 (coffee)" },
          { t: "01:05", k: "cut", m: "Removed 'um' (0.6s)" },
          { t: "01:22", k: "caption", m: "Added 4 captions" },
        ].map((c, i) => (
          <div key={i} className="row" style={{
            borderTop: i === 0 ? "none" : "1px solid var(--border-1)",
            borderRadius: 0,
          }}>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--amber-bright)", minWidth: 36 }}>{c.t}</span>
            <Tag variant={c.k === "broll" ? "ai" : c.k === "caption" ? "amber" : ""}>{c.k}</Tag>
            <div className="row-text"><div className="row-title">{c.m}</div></div>
            <Button variant="ghost" size="sm" icon="x" title="Revert this change" />
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <Button variant="ghost" icon="history" onClick={onUndo}>Undo all</Button>
        <Button variant="amber" icon="check" onClick={onDone}>Looks good</Button>
      </div>
    </div>
  );
}

/* ============================================================
   SETTINGS
   ============================================================ */
function SettingsScreen() {
  const [model, setModel] = useState("gemini-flash");
  const [keyVisible, setKeyVisible] = useState(false);
  const [autosave, setAutosave] = useState(true);
  const [telem, setTelem] = useState(false);
  const [previewBefore, setPreviewBefore] = useState(true);

  return (
    <div className="p-body">
      <SectionHead label="AI Provider" />

      <div className="field">
        <div className="field-label">Model</div>
        <select className="select" value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="gemini-flash">Gemini Flash · fast, free tier</option>
          <option value="gemini-pro">Gemini Pro · better B-roll matching</option>
          <option value="local-whisper">Local Whisper · transcription only</option>
        </select>
      </div>

      <div className="field">
        <div className="field-label">
          API key <span className="req">*</span>
          <button
            className="help"
            style={{ background: "none", border: 0, cursor: "pointer", color: "var(--text-3)" }}
            onClick={() => setKeyVisible((v) => !v)}
          >
            {keyVisible ? "hide" : "show"}
          </button>
        </div>
        <div className="input-group">
          <span className="icon"><Icon name="key" size={13} /></span>
          <input
            className="input mono"
            type={keyVisible ? "text" : "password"}
            defaultValue="AIza••••••••••••••••XV2c"
          />
          <span className="suffix">verified</span>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6, display: "flex", alignItems: "center", gap: 4 }}>
          <Icon name="info" size={12} />
          Stored locally in your OS keychain. <a style={{ color: "var(--amber-bright)", textDecoration: "none" }}>Get a free key →</a>
        </div>
      </div>

      <SectionHead label="Workflow" />
      <div className="card flush" style={{ marginBottom: 14 }}>
        <div className="row" style={{ borderRadius: 0 }}>
          <Icon name="history" size={14} style={{ color: "var(--text-3)" }} />
          <div className="row-text">
            <div className="row-title">Save a version before applying</div>
            <div className="row-sub">Auto-snapshot the sequence (recommended)</div>
          </div>
          <Toggle checked={autosave} onChange={setAutosave} />
        </div>
        <div className="row">
          <Icon name="play" size={14} style={{ color: "var(--text-3)" }} />
          <div className="row-text">
            <div className="row-title">Preview cuts before applying</div>
            <div className="row-sub">Show diff in panel first</div>
          </div>
          <Toggle checked={previewBefore} onChange={setPreviewBefore} />
        </div>
        <div className="row">
          <Icon name="info" size={14} style={{ color: "var(--text-3)" }} />
          <div className="row-text">
            <div className="row-title">Share anonymous usage</div>
            <div className="row-sub">Helps improve B-roll matching</div>
          </div>
          <Toggle checked={telem} onChange={setTelem} />
        </div>
      </div>

      <SectionHead label="Cache" />
      <div className="card" style={{ padding: 12, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5, fontWeight: 500 }}>Transcripts & embeddings</div>
            <div className="mono" style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
              243 MB · 14 projects
            </div>
          </div>
          <Button variant="ghost" size="sm">Clear</Button>
        </div>
        <div style={{
          height: 4,
          background: "var(--bg-3)",
          borderRadius: 2,
          marginTop: 10,
          overflow: "hidden",
        }}>
          <div style={{
            width: "30%",
            height: "100%",
            background: "var(--amber)",
            boxShadow: "0 0 8px oklch(0.80 0.170 75 / 0.5)",
          }} />
        </div>
        <div className="mono" style={{ fontSize: 10, color: "var(--text-4)", marginTop: 4 }}>
          243 MB / 800 MB
        </div>
      </div>

      <SectionHead label="About" />
      <div className="card" style={{ padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="nav-brand-mark" style={{ width: 32, height: 32 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Amber</div>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--text-3)" }}>v0.4.2 · build 1142</div>
          </div>
          <Button variant="ghost" size="sm" iconRight="external">Changelog</Button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   ONBOARDING — multi-step
   ============================================================ */
function OnboardingScreen({ onComplete }) {
  const [step, setStep] = useState(0);
  const total = 4;

  const steps = [
    {
      icon: "logo",
      title: "Meet Amber",
      sub: "An AI editor that lives inside Premiere — cut silence, find B-roll, and burn captions in one pass.",
      action: "Get started",
    },
    {
      icon: "key",
      title: "Connect Gemini",
      sub: "Paste a free API key. Amber never uploads your media — only transcripts and metadata.",
      action: "Continue",
      content: (
        <div className="field">
          <div className="field-label">
            Gemini API key
            <a className="help" style={{ color: "var(--amber-bright)" }}>get one free →</a>
          </div>
          <div className="input-group">
            <span className="icon"><Icon name="key" size={13} /></span>
            <input className="input mono" placeholder="AIza…" />
          </div>
        </div>
      ),
    },
    {
      icon: "wand",
      title: "Pick your editing style",
      sub: "We'll use this as the default. You can change it any time.",
      action: "Continue",
      content: <StylePicker />,
    },
    {
      icon: "sparkles",
      title: "You're set",
      sub: "Open any sequence in Premiere and Amber will appear in the side panel. Try a 30-second clip first.",
      action: "Open panel",
    },
  ];

  const s = steps[step];

  return (
    <div className="p-body" style={{ display: "flex", flexDirection: "column" }}>
      {/* Progress dots */}
      <div style={{ display: "flex", gap: 5, justifyContent: "center", marginBottom: 22 }}>
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} style={{
            width: i === step ? 22 : 6,
            height: 6,
            borderRadius: 3,
            background: i <= step ? "var(--amber)" : "var(--bg-3)",
            boxShadow: i === step ? "0 0 8px var(--amber)" : "none",
            transition: "width 200ms, background 200ms",
          }} />
        ))}
      </div>

      <div style={{
        textAlign: "center",
        padding: "0 8px 14px",
      }}>
        <div className="ai-card" style={{
          width: 64, height: 64,
          margin: "0 auto 14px",
          borderRadius: "50%",
          padding: 2,
        }}>
          <div style={{
            width: "100%", height: "100%",
            borderRadius: "50%",
            background: "var(--bg-2)",
            display: "grid", placeItems: "center",
            color: "var(--amber-bright)",
          }}>
            <Icon name={s.icon} size={26} />
          </div>
        </div>
        <div className="h-title" style={{ fontSize: 16 }}>{s.title}</div>
        <div className="h-sub" style={{ maxWidth: 260, margin: "6px auto 0" }}>{s.sub}</div>
      </div>

      {s.content && <div style={{ marginTop: 10 }}>{s.content}</div>}

      <div style={{ flex: 1 }} />

      <div style={{
        display: "flex",
        gap: 8,
        paddingTop: 14,
        borderTop: "1px solid var(--border-1)",
        marginTop: 14,
      }}>
        {step > 0 && (
          <Button variant="ghost" onClick={() => setStep(step - 1)}>Back</Button>
        )}
        <div style={{ flex: 1 }} />
        <Button
          variant={step === total - 1 ? "ai" : "amber"}
          icon={step === total - 1 ? "sparkles" : undefined}
          iconRight={step === total - 1 ? undefined : "chevron"}
          onClick={() => step === total - 1 ? onComplete() : setStep(step + 1)}
        >
          {s.action}
        </Button>
      </div>
    </div>
  );
}

function StylePicker() {
  const [pick, setPick] = useState("vlog");
  const styles = [
    { id: "vlog", label: "Vlog", sub: "Punchy, tight cuts, big captions" },
    { id: "talkinghead", label: "Talking head", sub: "Subtle cuts, minimal captions" },
    { id: "tutorial", label: "Tutorial", sub: "Keep pauses, screen-rec B-roll" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "0 4px" }}>
      {styles.map((s) => (
        <button
          key={s.id}
          className={"list-card" + (pick === s.id ? " selected" : "")}
          onClick={() => setPick(s.id)}
          style={{ textAlign: "left", padding: "10px 12px" }}
        >
          <div style={{
            width: 18, height: 18, borderRadius: "50%",
            border: pick === s.id ? "5px solid var(--amber)" : "1.5px solid var(--border-2)",
            boxShadow: pick === s.id ? "0 0 10px oklch(0.80 0.170 75 / 0.4)" : "none",
            flex: "none",
          }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>{s.sub}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

Object.assign(window, {
  EmptyScreen,
  HomeScreen,
  SilenceScreen,
  BRollScreen,
  CaptionsScreen,
  ProcessingScreen,
  ResultsScreen,
  SettingsScreen,
  OnboardingScreen,
});
