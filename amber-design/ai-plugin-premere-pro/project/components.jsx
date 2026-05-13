// Amber — shared components and small UI primitives.
// All component names are unique; styles are inline or via styles.css class names.

const { useState, useEffect, useRef, useMemo, useCallback, Fragment } = React;

/* ============================================================
   Icons — minimal stroked set drawn fresh (no copyrighted set)
   ============================================================ */
function Icon({ name, size = 14, className = "", style = {} }) {
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className,
    style,
  };
  switch (name) {
    case "sparkles":
      return (
        <svg {...props}>
          <path d="M12 3 L13.4 8.6 L19 10 L13.4 11.4 L12 17 L10.6 11.4 L5 10 L10.6 8.6 Z" />
          <path d="M18 15 L18.7 17 L20.5 17.7 L18.7 18.4 L18 20.5 L17.3 18.4 L15.5 17.7 L17.3 17 Z" />
        </svg>
      );
    case "wand":
      return (
        <svg {...props}>
          <path d="M4 20 L14 10" />
          <path d="M14.5 4.5 L15.5 6.5 M19.5 8.5 L17.5 9.5 M18 4 L18.5 3 M14 8.5 L13 9" />
          <circle cx="16.5" cy="6.5" r="2" />
        </svg>
      );
    case "scissors":
      return (
        <svg {...props}>
          <circle cx="6" cy="7" r="2.4" />
          <circle cx="6" cy="17" r="2.4" />
          <path d="M8 8.5 L20 17 M8 15.5 L20 7" />
        </svg>
      );
    case "film":
      return (
        <svg {...props}>
          <rect x="3" y="4" width="18" height="16" rx="1.5" />
          <path d="M3 9h18 M3 15h18 M8 4v16 M16 4v16" />
        </svg>
      );
    case "caption":
      return (
        <svg {...props}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M7 11 H10 M7 14 H13 M14 11 H17 M15 14 H17" />
        </svg>
      );
    case "settings":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3 L12 6 M12 18 L12 21 M3 12 L6 12 M18 12 L21 12 M5.6 5.6 L7.7 7.7 M16.3 16.3 L18.4 18.4 M5.6 18.4 L7.7 16.3 M16.3 7.7 L18.4 5.6" />
        </svg>
      );
    case "home":
      return (
        <svg {...props}>
          <path d="M4 11 L12 4 L20 11 V20 H4 Z" />
          <path d="M9 20 V14 H15 V20" />
        </svg>
      );
    case "empty":
      return (
        <svg {...props}>
          <rect x="3" y="5" width="18" height="14" rx="2" strokeDasharray="3 3" />
          <path d="M9 12 H15" strokeDasharray="2 2" />
        </svg>
      );
    case "loader":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="8" opacity="0.25" />
          <path d="M20 12 A8 8 0 0 0 12 4" />
        </svg>
      );
    case "check":
      return (
        <svg {...props}>
          <path d="M5 12 L10 17 L19 7" />
        </svg>
      );
    case "x":
      return (
        <svg {...props}>
          <path d="M6 6 L18 18 M18 6 L6 18" />
        </svg>
      );
    case "play":
      return (
        <svg {...props}>
          <path d="M7 5 L19 12 L7 19 Z" fill="currentColor" />
        </svg>
      );
    case "pause":
      return (
        <svg {...props}>
          <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
          <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
        </svg>
      );
    case "chevron":
      return (
        <svg {...props}>
          <path d="M9 6 L15 12 L9 18" />
        </svg>
      );
    case "chevron-down":
      return (
        <svg {...props}>
          <path d="M6 9 L12 15 L18 9" />
        </svg>
      );
    case "ear":
      return (
        <svg {...props}>
          <path d="M8 21 c-2.5 -3 -3 -7 -3 -9 a7 7 0 0 1 14 0 c0 4 -3 5 -4.5 6 c-1.5 1 -1 3 -3 3 Z" />
          <path d="M11 9 a2 2 0 0 1 2 2" />
        </svg>
      );
    case "magnify":
      return (
        <svg {...props}>
          <circle cx="11" cy="11" r="6" />
          <path d="M15.5 15.5 L20 20" />
        </svg>
      );
    case "external":
      return (
        <svg {...props}>
          <path d="M14 4 H20 V10" />
          <path d="M20 4 L11 13" />
          <path d="M18 14 V20 H4 V6 H10" />
        </svg>
      );
    case "key":
      return (
        <svg {...props}>
          <circle cx="8" cy="12" r="4" />
          <path d="M12 12 H21 M18 12 V15 M21 12 V14" />
        </svg>
      );
    case "info":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 11 V16 M12 8 V8.5" />
        </svg>
      );
    case "history":
      return (
        <svg {...props}>
          <path d="M4 12 A8 8 0 1 0 6 7" />
          <path d="M3 4 V8 H7" />
          <path d="M12 8 V12 L15 14" />
        </svg>
      );
    case "user":
      return (
        <svg {...props}>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20 c1.5 -4 5 -5 7 -5 s5.5 1 7 5" />
        </svg>
      );
    case "drag":
      return (
        <svg {...props}>
          <circle cx="9" cy="6" r="1" fill="currentColor" stroke="none" />
          <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="9" cy="18" r="1" fill="currentColor" stroke="none" />
          <circle cx="15" cy="6" r="1" fill="currentColor" stroke="none" />
          <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="15" cy="18" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "logo":
      return (
        <svg {...props} fill="currentColor" stroke="none">
          <path d="M12 3 L19 8 V16 L12 21 L5 16 V8 Z" opacity="0.9" />
          <path d="M12 8 L15.5 10.5 V13.5 L12 16 L8.5 13.5 V10.5 Z" fill="#fff" opacity="0.85" />
        </svg>
      );
    default:
      return <svg {...props}><circle cx="12" cy="12" r="6" /></svg>;
  }
}

/* ============================================================
   Button
   ============================================================ */
function Button({ children, variant = "default", size = "md", block, onClick, disabled, icon, iconRight, type = "button", title, className = "" }) {
  const classes = ["btn"];
  if (variant === "amber") classes.push("amber");
  else if (variant === "ai") classes.push("ai");
  else if (variant === "ghost") classes.push("ghost");
  else if (variant === "danger") classes.push("danger");
  if (size === "sm") classes.push("sm");
  if (size === "lg") classes.push("lg");
  if (block) classes.push("block");
  if (className) classes.push(className);
  return (
    <button type={type} className={classes.join(" ")} onClick={onClick} disabled={disabled} title={title}>
      {icon && <Icon name={icon} size={14} />}
      {children && <span>{children}</span>}
      {iconRight && <Icon name={iconRight} size={14} />}
    </button>
  );
}

/* ============================================================
   Slider
   ============================================================ */
function Slider({ value, min = 0, max = 100, step = 1, onChange, suffix = "", format }) {
  const pct = ((value - min) / (max - min)) * 100;
  const display = format ? format(value) : `${value}${suffix}`;
  return (
    <div className="slider-row">
      <input
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ "--pct": `${pct}%` }}
      />
      <div className="slider-value">{display}</div>
    </div>
  );
}

/* ============================================================
   Toggle
   ============================================================ */
function Toggle({ checked, onChange }) {
  return (
    <button
      className={"toggle" + (checked ? " on" : "")}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
    />
  );
}

function Check({ checked, onChange }) {
  return (
    <button
      className={"check" + (checked ? " on" : "")}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
    >
      {checked && <Icon name="check" size={10} />}
    </button>
  );
}

/* ============================================================
   Segmented control
   ============================================================ */
function Seg({ options, value, onChange, variant }) {
  return (
    <div className={"seg" + (variant === "amber" ? " amber" : "")}>
      {options.map((o) => (
        <button
          key={o.value}
          className={value === o.value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ============================================================
   Tag
   ============================================================ */
function Tag({ children, variant }) {
  const cls = "tag" + (variant ? ` ${variant}` : "");
  return <span className={cls}>{children}</span>;
}

function Confidence({ value }) {
  // value 0..1 → 5 bars
  const filled = Math.round(value * 5);
  return (
    <span className="confidence" title={`${Math.round(value * 100)}% confidence`}>
      <span className="bars">
        {[3, 5, 7, 9, 11].map((h, i) => (
          <span key={i} className={i < filled ? "on" : ""} style={{ height: h }} />
        ))}
      </span>
      <span className="mono">{Math.round(value * 100)}</span>
    </span>
  );
}

/* ============================================================
   Sparkline / waveform — purely visual
   ============================================================ */
function Waveform({ bars = 80, silentRanges = [], cutMap = null, height = 56, animated = false }) {
  const data = useMemo(() => {
    // deterministic seeded pseudo-random
    const out = [];
    let s = 1;
    for (let i = 0; i < bars; i++) {
      s = (s * 9301 + 49297) % 233280;
      const r = s / 233280;
      const base = Math.sin(i / 6) * 0.3 + 0.5;
      out.push(Math.max(0.06, Math.min(1, base + (r - 0.5) * 0.6)));
    }
    return out;
  }, [bars]);
  return (
    <div className="wave" style={{ height }}>
      <div style={{ display: "flex", alignItems: "center", height: "100%", padding: "0 4px", gap: 1 }}>
        {data.map((v, i) => {
          const isSilent = silentRanges.some(([s, e]) => i >= s && i < e);
          const isCut = cutMap && cutMap[i];
          return (
            <span
              key={i}
              className="wave-bar"
              style={{
                height: `${v * 100}%`,
                background: isSilent
                  ? "oklch(0.70 0.200 25 / 0.7)"
                  : isCut
                  ? "var(--text-4)"
                  : "var(--amber)",
                opacity: isCut ? 0.25 : isSilent ? 0.95 : 0.85,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   Thumb placeholder — striped block, no fake imagery
   ============================================================ */
function Thumb({ w = 88, h = 56, label, hue = 285, code }) {
  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: 6,
        position: "relative",
        overflow: "hidden",
        flex: "none",
        background: `repeating-linear-gradient(45deg,
          oklch(0.32 0.012 ${hue}) 0px,
          oklch(0.32 0.012 ${hue}) 6px,
          oklch(0.27 0.012 ${hue}) 6px,
          oklch(0.27 0.012 ${hue}) 12px)`,
        border: "1px solid var(--border-1)",
      }}
    >
      {code && (
        <div
          className="mono"
          style={{
            position: "absolute",
            top: 4,
            left: 5,
            fontSize: 9,
            color: "oklch(0.85 0.04 285)",
            background: "oklch(0 0 0 / 0.4)",
            padding: "1px 4px",
            borderRadius: 2,
          }}
        >
          {code}
        </div>
      )}
      {label && (
        <div
          className="mono"
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            fontSize: 9,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "oklch(0.85 0.04 285)",
            textShadow: "0 1px 2px oklch(0 0 0 / 0.6)",
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Section heading
   ============================================================ */
function SectionHead({ label, hint, children }) {
  return (
    <div className="h-row">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

/* ============================================================
   Spinner
   ============================================================ */
function Spinner({ size = 14 }) {
  return (
    <span className="spin" style={{ display: "inline-grid", placeItems: "center" }}>
      <Icon name="loader" size={size} />
    </span>
  );
}

/* ============================================================
   Export to window so other JSX files can use these
   ============================================================ */
Object.assign(window, {
  Icon,
  Button,
  Slider,
  Toggle,
  Check,
  Seg,
  Tag,
  Confidence,
  Waveform,
  Thumb,
  SectionHead,
  Spinner,
});
