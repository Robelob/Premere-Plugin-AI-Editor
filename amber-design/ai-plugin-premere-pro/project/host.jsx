// Amber — generic NLE host frame. NOT a recreation of any specific editor.
// Provides context that the panel lives inside a video-editing app.

const { useState, useEffect, useMemo } = React;

function HostFrame({ children, panelWidthMode }) {
  return (
    <div style={{
      position: "absolute",
      inset: 0,
      display: "flex",
      flexDirection: "column",
      background: "var(--bg-0)",
    }}>
      {/* Top bar */}
      <div style={{
        height: 38,
        background: "oklch(0.115 0.010 285)",
        borderBottom: "1px solid var(--border-1)",
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "0 14px",
        fontSize: 11.5,
        color: "var(--text-3)",
        flex: "none",
      }}>
        {/* Window controls */}
        <div style={{ display: "flex", gap: 6, marginRight: 4 }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <div key={c} style={{ width: 11, height: 11, borderRadius: "50%", background: c, opacity: 0.85 }} />
          ))}
        </div>

        {/* Nav menu */}
        <div style={{ display: "flex", gap: 14, color: "var(--text-2)" }}>
          {["File", "Edit", "Clip", "Sequence", "Markers", "Window"].map((m) => (
            <span key={m} style={{ cursor: "default" }}>{m}</span>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {/* Sequence label */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-2)" }}>
          <Icon name="film" size={12} />
          <span className="mono" style={{ fontSize: 11 }}>Episode 14 / coast trip · 4:32</span>
        </div>

        {/* Workspace */}
        <div className="seg" style={{ padding: 1 }}>
          <button className="on" style={{ fontSize: 10.5, padding: "3px 8px" }}>Editing</button>
          <button style={{ fontSize: 10.5, padding: "3px 8px" }}>Audio</button>
          <button style={{ fontSize: 10.5, padding: "3px 8px" }}>Color</button>
        </div>
      </div>

      {/* Main content area */}
      <div style={{
        flex: 1,
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gridTemplateRows: "1fr auto",
        gridTemplateAreas: '"viewer panel" "timeline timeline"',
        gap: 1,
        background: "var(--border-1)",
        overflow: "hidden",
        minHeight: 0,
      }}>
        {/* Viewer */}
        <div style={{
          gridArea: "viewer",
          background: "var(--bg-0)",
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}>
          {/* Bin / project tabs */}
          <div style={{
            height: 32,
            display: "flex",
            alignItems: "center",
            gap: 0,
            padding: "0 8px",
            borderBottom: "1px solid var(--border-1)",
            background: "var(--bg-1)",
            flex: "none",
          }}>
            {["Project", "Effects", "Media Browser"].map((t, i) => (
              <div key={t} style={{
                padding: "8px 14px",
                fontSize: 11.5,
                color: i === 0 ? "var(--text-1)" : "var(--text-3)",
                borderBottom: i === 0 ? "2px solid var(--amber)" : "2px solid transparent",
                marginBottom: -1,
              }}>{t}</div>
            ))}
            <div style={{ flex: 1 }} />
            <Icon name="magnify" size={13} style={{ color: "var(--text-3)" }} />
          </div>

          {/* Viewer body — split: bin / monitor */}
          <div style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: "180px 1fr",
            gap: 1,
            background: "var(--border-1)",
            minHeight: 0,
          }}>
            {/* Bin */}
            <div style={{
              background: "var(--bg-1)",
              padding: "8px 8px",
              overflowY: "auto",
              fontSize: 11.5,
            }}>
              <div className="mono" style={{
                fontSize: 9.5,
                color: "var(--text-4)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                margin: "4px 4px 6px",
              }}>
                bin / clips
              </div>
              {[
                { name: "DJI_0421.mp4", k: "video", hue: 220, sel: false },
                { name: "MVI_3382.mov", k: "video", hue: 60, sel: true },
                { name: "MVI_3401.mov", k: "video", hue: 285, sel: false },
                { name: "DJI_0427.mp4", k: "video", hue: 145, sel: false },
                { name: "DJI_0432.mp4", k: "video", hue: 25, sel: false },
                { name: "VO_take_03.wav", k: "audio", hue: 0, sel: false },
                { name: "amber_music.aiff", k: "audio", hue: 0, sel: false },
              ].map((c, i) => (
                <div key={i} style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "5px 6px",
                  borderRadius: 4,
                  background: c.sel ? "oklch(0.30 0.05 250)" : "transparent",
                  color: c.sel ? "var(--text-1)" : "var(--text-2)",
                }}>
                  {c.k === "audio" ? (
                    <Icon name="ear" size={12} style={{ color: "var(--text-3)" }} />
                  ) : (
                    <div style={{
                      width: 18, height: 12, borderRadius: 2,
                      background: `oklch(0.45 0.10 ${c.hue})`,
                      border: "1px solid oklch(0 0 0 / 0.3)",
                    }} />
                  )}
                  <span className="mono" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.name}
                  </span>
                </div>
              ))}
            </div>

            {/* Program monitor */}
            <div style={{
              background: "var(--bg-0)",
              padding: 12,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              minWidth: 0,
            }}>
              <div style={{
                width: "100%",
                maxWidth: 540,
                aspectRatio: "16 / 9",
                background: `linear-gradient(180deg,
                  oklch(0.55 0.08 220) 0%,
                  oklch(0.42 0.07 220) 50%,
                  oklch(0.78 0.10 50) 51%,
                  oklch(0.50 0.10 30) 100%)`,
                borderRadius: 4,
                position: "relative",
                border: "1px solid oklch(0 0 0 / 0.5)",
                overflow: "hidden",
                boxShadow: "0 6px 24px oklch(0 0 0 / 0.4)",
              }}>
                {/* Faux coastal scene shapes */}
                <div style={{
                  position: "absolute",
                  bottom: "20%",
                  left: 0, right: 0,
                  height: "30%",
                  background: "oklch(0.30 0.05 240 / 0.6)",
                  clipPath: "polygon(0 60%, 15% 40%, 30% 55%, 45% 30%, 60% 50%, 80% 35%, 100% 50%, 100% 100%, 0 100%)",
                }} />
                {/* Burn caption */}
                <div style={{
                  position: "absolute",
                  bottom: 18,
                  left: 0, right: 0,
                  textAlign: "center",
                }}>
                  <span style={{
                    fontWeight: 700,
                    fontSize: 14,
                    color: "white",
                    textShadow: "0 1px 2px black, 0 0 6px oklch(0 0 0 / 0.7)",
                  }}>
                    the most <span style={{ color: "oklch(0.92 0.18 75)" }}>peaceful</span> spot
                  </span>
                </div>
                {/* timecode */}
                <div className="mono" style={{
                  position: "absolute",
                  top: 8,
                  left: 8,
                  fontSize: 10,
                  color: "oklch(0.95 0 0 / 0.85)",
                  background: "oklch(0 0 0 / 0.5)",
                  padding: "2px 6px",
                  borderRadius: 3,
                }}>
                  01:24:18
                </div>
              </div>

              {/* Transport */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text-3)" }}>
                <Icon name="chevron" size={14} style={{ transform: "rotate(180deg)" }} />
                <div style={{
                  width: 30, height: 30,
                  borderRadius: "50%",
                  border: "1px solid var(--border-2)",
                  display: "grid", placeItems: "center",
                  color: "var(--text-1)",
                }}>
                  <Icon name="play" size={12} />
                </div>
                <Icon name="chevron" size={14} />
                <span className="mono" style={{ fontSize: 11, marginLeft: 6 }}>00:01:24:18 / 00:04:32:00</span>
              </div>
            </div>
          </div>
        </div>

        {/* Plugin panel area */}
        <div style={{
          gridArea: "panel",
          width: panelWidthMode === "wide" ? 520 : 340,
          background: "var(--bg-1)",
          display: "flex",
          flexDirection: "column",
          transition: "width 240ms ease",
          minHeight: 0,
          overflow: "hidden",
        }}>
          {children}
        </div>

        {/* Timeline */}
        <div style={{
          gridArea: "timeline",
          background: "var(--bg-1)",
          borderTop: "1px solid var(--border-1)",
          minHeight: 0,
          height: 138,
          display: "flex",
          flexDirection: "column",
        }}>
          <TimelineMock />
        </div>
      </div>
    </div>
  );
}

function TimelineMock() {
  // tracks: V2 (broll), V1 (main), A1 (voice), A2 (music)
  const cuts = [
    // [startPct, lenPct, label, hue, kind]
    { s: 0, l: 8, label: "intro", hue: 60, t: "V1" },
    { s: 8.5, l: 10, label: "DJI_0421", hue: 220, t: "V2" },
    { s: 8.5, l: 18, label: "VO_03", hue: 60, t: "V1" },
    { s: 26.5, l: 12, label: "MVI_3382", hue: 60, t: "V2" },
    { s: 27, l: 22, label: "main 2", hue: 60, t: "V1" },
    { s: 49, l: 8, label: "MVI_3401", hue: 285, t: "V2" },
    { s: 49.5, l: 18, label: "talk", hue: 60, t: "V1" },
    { s: 68, l: 10, label: "DJI_0427", hue: 145, t: "V2" },
    { s: 68, l: 14, label: "main 3", hue: 60, t: "V1" },
    { s: 83, l: 16, label: "outro · DJI_0432", hue: 25, t: "V1" },
  ];

  // Audio waveform bars
  const audioBars = useMemo(() => {
    const out = [];
    let s = 1;
    for (let i = 0; i < 240; i++) {
      s = (s * 9301 + 49297) % 233280;
      const r = s / 233280;
      const base = Math.sin(i / 5) * 0.3 + 0.5;
      out.push(Math.max(0.08, Math.min(1, base + (r - 0.5) * 0.7)));
    }
    return out;
  }, []);

  const trackLabel = (t) => (
    <div style={{
      width: 32,
      flex: "none",
      fontFamily: "var(--font-mono)",
      fontSize: 9.5,
      color: "var(--text-3)",
      display: "grid",
      placeItems: "center",
      borderRight: "1px solid var(--border-1)",
      background: "var(--bg-0)",
    }}>{t}</div>
  );

  return (
    <div style={{display: "contents"}}>
      {/* Ruler */}
      <div style={{
        height: 22,
        borderBottom: "1px solid var(--border-1)",
        display: "flex",
        background: "var(--bg-1)",
        flex: "none",
      }}>
        {trackLabel("")}
        <div style={{
          flex: 1,
          display: "flex",
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
          color: "var(--text-4)",
          alignItems: "center",
          padding: "0 4px",
          position: "relative",
        }}>
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} style={{
              flex: 1,
              borderLeft: i === 0 ? "none" : "1px solid var(--border-1)",
              paddingLeft: 4,
            }}>
              {`00:${String(i * 27).padStart(2, "0")}`}
            </div>
          ))}
          {/* Playhead */}
          <div style={{
            position: "absolute",
            top: 0, bottom: -200,
            left: "32%",
            width: 1,
            background: "var(--amber)",
            boxShadow: "0 0 6px var(--amber)",
            pointerEvents: "none",
            zIndex: 2,
          }}>
            <div style={{
              position: "absolute",
              top: 0, left: -5,
              width: 11, height: 12,
              background: "var(--amber)",
              clipPath: "polygon(50% 100%, 0 0, 100% 0)",
            }} />
          </div>
        </div>
      </div>

      {/* V2 track (B-roll) */}
      <TrackRow label="V2" cuts={cuts.filter((c) => c.t === "V2")} labelEl={trackLabel} aiTag />
      {/* V1 track (main) */}
      <TrackRow label="V1" cuts={cuts.filter((c) => c.t === "V1")} labelEl={trackLabel} />
      {/* A1 audio */}
      <AudioRow label="A1" labelEl={trackLabel} bars={audioBars} silences={[[40, 52], [120, 132], [185, 200]]} />
      {/* A2 music */}
      <AudioRow label="A2" labelEl={trackLabel} bars={audioBars.map((b) => b * 0.4)} muted />
    </div>
  );
}

function TrackRow({ label, cuts, labelEl, aiTag }) {
  return (
    <div style={{
      height: 26,
      display: "flex",
      alignItems: "stretch",
      borderBottom: "1px solid var(--border-1)",
      flex: "none",
      background: "var(--bg-1)",
    }}>
      {labelEl(label)}
      <div style={{ flex: 1, position: "relative", padding: "3px 4px" }}>
        {cuts.map((c, i) => (
          <div key={i} style={{
            position: "absolute",
            top: 3, bottom: 3,
            left: `${c.s}%`,
            width: `${c.l}%`,
            background: aiTag
              ? `linear-gradient(180deg, oklch(0.55 0.14 ${c.hue}), oklch(0.40 0.12 ${c.hue}))`
              : `linear-gradient(180deg, oklch(0.45 0.06 ${c.hue}), oklch(0.32 0.05 ${c.hue}))`,
            borderRadius: 2,
            border: aiTag
              ? "1px solid oklch(0.68 0.220 295 / 0.6)"
              : "1px solid oklch(0 0 0 / 0.4)",
            boxShadow: aiTag
              ? "0 0 8px oklch(0.68 0.220 295 / 0.3), inset 0 1px 0 oklch(1 0 0 / 0.15)"
              : "inset 0 1px 0 oklch(1 0 0 / 0.1)",
            display: "flex",
            alignItems: "center",
            padding: "0 6px",
            fontFamily: "var(--font-mono)",
            fontSize: 9.5,
            color: "oklch(0.95 0.02 ${c.hue})",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {aiTag && (
              <span style={{
                width: 5, height: 5, borderRadius: "50%",
                background: "var(--ai-cyan)",
                boxShadow: "0 0 4px var(--ai-cyan)",
                marginRight: 5,
                flex: "none",
              }} />
            )}
            {c.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function AudioRow({ label, labelEl, bars, silences = [], muted }) {
  return (
    <div style={{
      height: 28,
      display: "flex",
      alignItems: "stretch",
      borderBottom: "1px solid var(--border-1)",
      flex: "none",
      background: "var(--bg-1)",
      opacity: muted ? 0.55 : 1,
    }}>
      {labelEl(label)}
      <div style={{ flex: 1, position: "relative", padding: "3px 4px" }}>
        <div style={{
          position: "absolute",
          inset: "3px 4px",
          background: muted ? "oklch(0.28 0.04 200)" : "oklch(0.30 0.08 145)",
          borderRadius: 2,
          border: "1px solid oklch(0 0 0 / 0.4)",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
        }}>
          {bars.map((b, i) => {
            const isSil = silences.some(([s, e]) => i >= s && i < e);
            return (
              <span key={i} style={{
                flex: 1,
                margin: "auto 0.5px",
                height: `${b * 70}%`,
                background: isSil
                  ? "oklch(0.70 0.200 25 / 0.6)"
                  : muted ? "oklch(0.55 0.08 200)" : "oklch(0.75 0.13 145)",
                opacity: isSil ? 1 : 0.85,
                borderRadius: 0.5,
              }} />
            );
          })}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { HostFrame });
