import type { ReactNode } from "react";
import { AbsoluteFill, Audio, staticFile } from "remotion";
import { TransitionSeries, linearTiming, type TransitionPresentation } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { Fonts } from "./theme";
import { Intro } from "./scenes/Intro";
import { Feature } from "./scenes/Feature";
import { Version } from "./scenes/Version";
import { Wide } from "./scenes/Wide";
import { Outro } from "./scenes/Outro";

const T = 10;
const focus = (x: number, y: number, s: number) => ({ x, y, s });

// The transition listed on a scene is the one that leads into it.
const SCENES: { frames: number; node: ReactNode; into: TransitionPresentation<Record<string, unknown>> }[] = [
  { frames: 70, node: <Intro />, into: fade() as never },
  { frames: 85, node: <Feature eyebrow="Read history" title="Every branch keeps its colour." sub="Forks and merges bend at their own commit." chips={["Lane graph", "Branch pills", "Stashes as rows"]} src="shots/main-dark.png" aspect={2800 / 1800} from={focus(0.5, 0.5, 1)} to={focus(0.2, 0.3, 1.9)} />, into: slide({ direction: "from-right" }) as never },
  { frames: 85, node: <Feature flip eyebrow="Read changes" title="Diffs that read." sub="Syntax-highlighted, with word-level marks." chips={["Unified", "Split", "Image diffs"]} src="shots/split.png" aspect={2560 / 1520} from={focus(0.5, 0.5, 1)} to={focus(0.7, 0.65, 1.7)} />, into: slide({ direction: "from-left" }) as never },
  { frames: 90, node: <Feature eyebrow="Change things" title="Stage, commit, undo." sub="Down to single lines, without leaving the window." chips={["Stage files", "Pick lines", "Undo tip"]} src="shots/stage.png" aspect={2200 / 1520} from={focus(0.5, 0.5, 1)} to={focus(0.2, 0.55, 1.7)} />, into: slide({ direction: "from-right" }) as never },
  { frames: 85, node: <Feature flip eyebrow="Merge and resolve" title="Conflicts, block by block." sub="Keep current, incoming or both, inline." chips={["Current", "Incoming", "Both"]} src="shots/conflict.png" aspect={2200 / 1800} from={focus(0.5, 0.3, 1)} to={focus(0.7, 0.78, 1.6)} />, into: slide({ direction: "from-left" }) as never },
  { frames: 50, node: <Version />, into: wipe({ direction: "from-left" }) as never },
  { frames: 100, node: <Wide eyebrow="Quick switcher" title="Jump to any tab." src="shots/switcher.png" from={focus(0.5, 0.5, 1)} to={focus(0.5, 0.26, 1.7)} keys={["Ctrl", "P"]} />, into: slide({ direction: "from-bottom" }) as never },
  { frames: 95, node: <Wide eyebrow="Find bar" title="Search without leaving the graph." src="shots/findbar.png" from={focus(0.5, 0.5, 1)} to={focus(0.75, 0.22, 1.6)} keys={["Ctrl", "F"]} keysAt="left" />, into: slide({ direction: "from-right" }) as never },
  { frames: 85, node: <Wide eyebrow="Pull requests" title="Create one from the branch menu." src="shots/branch-menu.png" from={focus(0.5, 0.5, 1)} to={focus(0.3, 0.6, 1.8)} />, into: slide({ direction: "from-left" }) as never },
  { frames: 90, node: <Feature flip eyebrow="Cheatsheet" title="Every shortcut, one glance." sub="Back and forward across tabs, tooltips everywhere." chips={["Alt + ← →", "Ctrl + Enter", "Ctrl + 1–9"]} shotWidth={860} src="shots/settings.png" aspect={2200 / 2300} from={focus(0.5, 0.5, 1.25)} to={focus(0.5, 0.85, 1.25)} />, into: slide({ direction: "from-bottom" }) as never },
  { frames: 70, node: <Outro />, into: fade() as never },
];

export const SHOWCASE_FRAMES = SCENES.reduce((n, s) => n + s.frames, 0) - T * (SCENES.length - 1);

export const Showcase = () => (
  <AbsoluteFill>
    <Fonts />
    <Audio src={staticFile("music.mp3")} volume={0.8} />
    <TransitionSeries>
      {SCENES.flatMap((s, i) => [
        ...(i > 0 ? [<TransitionSeries.Transition key={`t${i}`} presentation={s.into} timing={linearTiming({ durationInFrames: T })} />] : []),
        <TransitionSeries.Sequence key={`s${i}`} durationInFrames={s.frames}>{s.node}</TransitionSeries.Sequence>,
      ])}
    </TransitionSeries>
  </AbsoluteFill>
);
