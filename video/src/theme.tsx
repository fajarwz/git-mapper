import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { continueRender, delayRender, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

export const C = {
  primary: "#6e56cf",
  primaryInk: "#563d9a",
  ink: "#17151f",
  canvas: "#0e0c16",
  text: "#f4f2fb",
  textDim: "#a9a4c0",
  rose: "#cf6a92",
  teal: "#2fa186",
  blue: "#477fb8",
};

export const SANS = "'Plus Jakarta Sans', system-ui, sans-serif";
export const MONO = "'JetBrains Mono', ui-monospace, monospace";

export const Fonts = () => {
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => {
    const faces = [
      new FontFace("Plus Jakarta Sans", `url(${staticFile("fonts/plus-jakarta-sans.woff2")})`, { weight: "200 800" }),
      new FontFace("JetBrains Mono", `url(${staticFile("fonts/jetbrains-mono.woff2")})`, { weight: "100 800" }),
    ];
    Promise.all(faces.map((f) => f.load()))
      .then((loaded) => loaded.forEach((f) => (document.fonts as unknown as { add(f: FontFace): void }).add(f)))
      .finally(() => continueRender(handle));
  }, [handle]);
  return null;
};

export const Backdrop = ({ children }: { children?: ReactNode }) => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 40) * 70;
  const glow = (color: string, x: number, y: number, size: number): CSSProperties => ({
    position: "absolute", left: x, top: y, width: size, height: size, borderRadius: "50%",
    background: color, filter: "blur(160px)", opacity: 0.5,
  });
  return (
    <div style={{ position: "absolute", inset: 0, background: C.canvas, overflow: "hidden", fontFamily: SANS, color: C.text }}>
      <div style={glow(C.primary, -200 + drift, -250, 800)} />
      <div style={glow(C.rose, 1500 - drift, -300, 650)} />
      <div style={glow(C.teal, 1350 + drift, 800, 600)} />
      <div style={glow(C.blue, -250, 750 - drift, 600)} />
      {children}
    </div>
  );
};

export const useIn = (delay = 0, damping = 200) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping } });
};

export const Rise = ({ delay = 0, children, style }: { delay?: number; children: ReactNode; style?: CSSProperties }) => {
  const t = useIn(delay, 16);
  return <div style={{ opacity: Math.min(1, t * 1.5), transform: `translateY(${(1 - t) * 40}px)`, ...style }}>{children}</div>;
};

export const Caption = ({ eyebrow, title, sub, align = "left" }: { eyebrow: string; title: string; sub?: string; align?: "left" | "center" }) => (
  <div style={{ textAlign: align }}>
    <Rise>
      <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: "#b8a8ff" }}>{eyebrow}</div>
    </Rise>
    <Rise delay={3}>
      <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.05, margin: "14px 0 18px", letterSpacing: -1.5 }}>{title}</div>
    </Rise>
    {sub && (
      <Rise delay={6}>
        <div style={{ fontSize: 28, lineHeight: 1.45, color: C.textDim, fontWeight: 500 }}>{sub}</div>
      </Rise>
    )}
  </div>
);

export const Kbd = ({ children, size = 30, light = false }: { children: ReactNode; size?: number; light?: boolean }) => (
  <span
    style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: size * 1.5, height: size * 1.45,
      padding: `0 ${size * 0.5}px`, borderRadius: size * 0.35, fontFamily: SANS, fontWeight: 700, fontSize: size,
      background: light ? "#fff" : "rgba(255,255,255,0.1)", color: light ? C.ink : C.text,
      border: `1.5px solid ${light ? "rgba(23,21,31,0.18)" : "rgba(255,255,255,0.22)"}`,
      borderBottomWidth: size * 0.12,
    }}
  >
    {children}
  </span>
);

export const Combo = ({ keys, size, light }: { keys: string[]; size?: number; light?: boolean }) => (
  <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
    {keys.map((k) => (
      <Kbd key={k} size={size} light={light}>{k}</Kbd>
    ))}
  </span>
);

export const Cursor = ({ x, y, click = 0 }: { x: number; y: number; click?: number }) => (
  <svg width="34" height="34" viewBox="0 0 24 24" style={{ position: "absolute", left: x, top: y, filter: "drop-shadow(0 3px 6px rgba(0,0,0,.35))", transform: `scale(${1 - click * 0.15})`, transformOrigin: "0 0", zIndex: 20 }}>
    <path d="M4 2l15 9-6.5 1.5L9 19z" fill="#fff" stroke="#17151f" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
);
