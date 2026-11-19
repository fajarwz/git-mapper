import { Backdrop, C, Rise, useIn } from "../theme";

export const Version = () => {
  const pill = useIn(0, 10);
  return (
    <Backdrop>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ transform: `scale(${0.4 + pill * 0.6})`, opacity: pill, padding: "12px 34px", borderRadius: 999, background: C.primary, fontSize: 38, fontWeight: 800, boxShadow: "0 20px 70px rgba(110,86,207,.65)" }}>
          New in 1.7.0
        </div>
        <Rise delay={5}><div style={{ fontSize: 120, fontWeight: 800, letterSpacing: -3, marginTop: 40 }}>Keyboard first.</div></Rise>
        <Rise delay={11}><div style={{ fontSize: 34, color: C.textDim, fontWeight: 500, marginTop: 6 }}>Jump, find, go back, open a pull request.</div></Rise>
      </div>
    </Backdrop>
  );
};
