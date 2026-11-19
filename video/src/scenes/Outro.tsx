import { Img, staticFile } from "remotion";
import { Backdrop, C, Rise, useIn } from "../theme";

export const Outro = () => {
  const logo = useIn(0, 10);
  return (
    <Backdrop>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <Img src={staticFile("logo.svg")} style={{ width: 120, height: 120, borderRadius: 28, opacity: logo, transform: `scale(${0.4 + logo * 0.6})` }} />
        <Rise delay={4}><div style={{ fontSize: 96, fontWeight: 800, letterSpacing: -3, marginTop: 30 }}>Get Git Mapper</div></Rise>
        <Rise delay={9}><div style={{ fontSize: 40, fontWeight: 700, color: "#b8a8ff", marginTop: 8 }}>gitmapper.fajarwz.com</div></Rise>
        <Rise delay={14}><div style={{ fontSize: 28, color: C.textDim, marginTop: 28, fontWeight: 500 }}>Windows · macOS · Linux — free, local, no account</div></Rise>
      </div>
    </Backdrop>
  );
};
