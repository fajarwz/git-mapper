import { Backdrop, Caption } from "../theme";
import { Clip } from "../Clip";
import type { ClipSpec } from "../clips";

interface Props {
  eyebrow: string; title: string; clip: ClipSpec;
}

const W = 1300;
const H = W / 1.6;

/** Caption on top, the recorded app below. Key badges are drawn inside the recording itself. */
export const Wide = ({ eyebrow, title, clip }: Props) => (
  <Backdrop>
    <div style={{ position: "absolute", top: 46, left: 0, right: 0 }}>
      <Caption eyebrow={eyebrow} title={title} align="center" />
    </div>
    <div style={{ position: "absolute", left: (1920 - W) / 2, top: 232, width: W, height: H }}>
      <Clip spec={clip} width={W} />
    </div>
  </Backdrop>
);
