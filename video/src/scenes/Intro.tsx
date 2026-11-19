import { Img, staticFile } from "remotion";
import { Backdrop, C, Rise, useIn } from "../theme";

export const Intro = () => {
  const logo = useIn(0, 10);
  return (
    <Backdrop>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
        <Img src={staticFile("logo.svg")} style={{ width: 150, height: 150, borderRadius: 34, transform: `scale(${0.3 + logo * 0.7}) rotate(${(1 - logo) * -40}deg)`, opacity: logo, boxShadow: "0 30px 90px rgba(110,86,207,.6)" }} />
        <Rise delay={6}><div style={{ fontSize: 40, fontWeight: 700, marginTop: 30, color: C.textDim }}>Git Mapper</div></Rise>
        <Rise delay={10}><div style={{ fontSize: 120, fontWeight: 800, letterSpacing: -4 }}>Git, easy as a click.</div></Rise>
        <Rise delay={18}><div style={{ fontSize: 32, fontWeight: 500, color: C.textDim }}>Read history as a graph. Stage, commit and merge with a click.</div></Rise>
      </div>
    </Backdrop>
  );
};
