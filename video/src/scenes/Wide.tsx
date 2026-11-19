import { Backdrop, Caption, Combo, useIn } from "../theme";
import { Shot, type Focus } from "../Shot";

interface Props {
  eyebrow: string; title: string; src: string; from: Focus; to: Focus; keys?: string[]; keysAt?: "left" | "right";
}

const W = 1300;
const H = W / (2800 / 1800);

/** Caption on top, a full-width real screenshot below with a camera move and an optional key badge. */
export const Wide = ({ eyebrow, title, src, from, to, keys, keysAt = "right" }: Props) => {
  const pop = useIn(16, 9);
  return (
    <Backdrop>
      <div style={{ position: "absolute", top: 46, left: 0, right: 0 }}>
        <Caption eyebrow={eyebrow} title={title} align="center" />
      </div>
      <div style={{ position: "absolute", left: (1920 - W) / 2, top: 232, width: W, height: H }}>
        <Shot src={src} aspect={2800 / 1800} from={from} to={to} width={W} />
        {keys && (
          <div style={{ position: "absolute", bottom: 26, [keysAt]: 30, padding: "14px 22px", borderRadius: 18, background: "rgba(23,21,31,.9)", opacity: pop, transform: `scale(${0.4 + pop * 0.6})`, boxShadow: "0 18px 50px rgba(0,0,0,.45)" }}>
            <Combo keys={keys} size={26} />
          </div>
        )}
      </div>
    </Backdrop>
  );
};
