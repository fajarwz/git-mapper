import { Fragment, type CSSProperties } from "react";
import { Audio, OffthreadVideo, Sequence, staticFile } from "remotion";
import { clipEvents, clipFrames, type ClipSpec } from "./clips";
import { useIn } from "./theme";

const FPS = 30;
const ASPECT = 1.6;
/** Frames the frame animates in before the recording starts. */
export const LEAD = 10;

const SFX: Record<string, { files: string[]; volume: number }> = {
  click: { files: ["click"], volume: 0.9 },
  key: { files: ["key1", "key2", "key3", "key4"], volume: 0.55 },
  space: { files: ["space"], volume: 0.6 },
  chord: { files: ["chord"], volume: 0.9 },
};

/** The real app, recorded: a rounded frame that plays the clip along with its click and key sounds. */
export const Clip = ({ spec, width = 1080, style }: { spec: ClipSpec; width?: number; style?: CSSProperties }) => {
  const enter = useIn(0, 16);
  const H = width / ASPECT;
  let keyIndex = 0;
  return (
    <div
      style={{
        width, height: H, borderRadius: 28, overflow: "hidden", position: "relative", background: "#0e0c16",
        boxShadow: "0 40px 120px rgba(0,0,0,.55), 0 0 0 1.5px rgba(255,255,255,.14)",
        opacity: enter, transform: `translateY(${(1 - enter) * 80}px) scale(${0.92 + enter * 0.08}) rotate(${(1 - enter) * 2}deg)`, ...style,
      }}
    >
      <Sequence from={LEAD} durationInFrames={clipFrames(spec)} layout="none">
        <OffthreadVideo src={staticFile(`clips/${spec.name}.mp4`)} playbackRate={spec.rate} muted style={{ width, height: H }} />
      </Sequence>
      {clipEvents(spec).map(([at, kind], i) => {
        const sfx = SFX[kind];
        if (!sfx) return <Fragment key={i} />;
        const file = sfx.files[kind === "key" ? keyIndex++ % sfx.files.length : 0];
        return (
          <Sequence key={i} from={LEAD + Math.round(at / spec.rate)} durationInFrames={Math.ceil(0.3 * FPS)} layout="none">
            <Audio src={staticFile(`sfx/${file}.wav`)} volume={sfx.volume} />
          </Sequence>
        );
      })}
    </div>
  );
};
