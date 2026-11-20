import { useCurrentFrame } from "remotion";
import { Backdrop, C, Caption, useIn } from "../theme";
import { Clip } from "../Clip";
import type { ClipSpec } from "../clips";

interface Props {
  eyebrow: string; title: string; sub: string; chips: string[]; shotWidth?: number; clip: ClipSpec; flip?: boolean;
}

const Chip = ({ label, delay }: { label: string; delay: number }) => {
  const t = useIn(delay, 10);
  const frame = useCurrentFrame();
  return (
    <span style={{ display: "inline-block", padding: "9px 20px", borderRadius: 999, fontSize: 22, fontWeight: 700, background: "rgba(110,86,207,.28)", border: `1.5px solid ${C.primary}`, color: "#e4dcff", opacity: t, transform: `scale(${0.5 + t * 0.5}) translateY(${(1 - t) * 20 + Math.sin((frame + delay * 3) / 9) * 3}px)` }}>
      {label}
    </span>
  );
};

export const Feature = ({ eyebrow, title, sub, chips, shotWidth = 1080, clip, flip }: Props) => (
  <Backdrop>
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", flexDirection: flip ? "row-reverse" : "row", padding: "0 110px", gap: 70 }}>
      <div style={{ width: 560, flexShrink: 0 }}>
        <Caption eyebrow={eyebrow} title={title} sub={sub} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 30 }}>
          {chips.map((c, i) => <Chip key={c} label={c} delay={14 + i * 6} />)}
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
        <Clip spec={clip} width={shotWidth} />
      </div>
    </div>
  </Backdrop>
);
