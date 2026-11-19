import type { CSSProperties } from "react";
import { Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { useIn } from "./theme";

export interface Focus { x: number; y: number; s: number }

/** A screenshot in a rounded frame with a camera move from one focus point to another. */
export const Shot = ({ src, aspect, from, to, width = 1080, style }: { src: string; aspect: number; from: Focus; to: Focus; width?: number; style?: CSSProperties }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const enter = useIn(0, 16);
  const H = width / aspect;
  const t = interpolate(frame, [8, durationInFrames - 4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const f = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, s: from.s + (to.s - from.s) * t };
  const tx = Math.min(0, Math.max(width - width * f.s, width / 2 - f.x * width * f.s));
  const ty = Math.min(0, Math.max(H - H * f.s, H / 2 - f.y * H * f.s));
  return (
    <div
      style={{
        width, height: H, borderRadius: 28, overflow: "hidden", position: "relative",
        boxShadow: "0 40px 120px rgba(0,0,0,.55), 0 0 0 1.5px rgba(255,255,255,.14)",
        opacity: enter, transform: `translateY(${(1 - enter) * 80}px) scale(${0.92 + enter * 0.08}) rotate(${(1 - enter) * 2}deg)`, ...style,
      }}
    >
      <Img src={staticFile(src)} style={{ position: "absolute", left: 0, top: 0, width, height: H, transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${f.s})` }} />
    </div>
  );
};
