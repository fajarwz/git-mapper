import type { ReactNode } from "react";
import { AbsoluteFill, Audio, staticFile } from "remotion";
import { TransitionSeries, linearTiming, type TransitionPresentation } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { Fonts } from "./theme";
import { LEAD } from "./Clip";
import { BRANCHMENU, CONFLICT, DIFFS, FINDBAR, HISTORY, SETTINGS, STAGE, SWITCHER, clipFrames, type ClipSpec } from "./clips";
import { Intro } from "./scenes/Intro";
import { Feature } from "./scenes/Feature";
import { Version } from "./scenes/Version";
import { Wide } from "./scenes/Wide";
import { Outro } from "./scenes/Outro";

const T = 10;

// A recorded scene lasts its lead-in plus the clip at its playback speed.
const len = (spec: ClipSpec) => LEAD + clipFrames(spec);

// The transition listed on a scene is the one that leads into it.
const SCENES: { frames: number; node: ReactNode; into: TransitionPresentation<Record<string, unknown>> }[] = [
  { frames: 70, node: <Intro />, into: fade() as never },
  { frames: len(HISTORY), node: <Feature eyebrow="Read history" title="Every branch keeps its colour." sub="Forks and merges bend at their own commit." chips={["Lane graph", "Branch pills", "Stashes as rows"]} clip={HISTORY} />, into: slide({ direction: "from-right" }) as never },
  { frames: len(DIFFS), node: <Feature flip eyebrow="Read changes" title="Diffs that read." sub="Syntax-highlighted, with word-level marks." chips={["Unified", "Split", "Image diffs"]} clip={DIFFS} />, into: slide({ direction: "from-left" }) as never },
  { frames: len(STAGE), node: <Feature eyebrow="Change things" title="Stage, commit, undo." sub="Down to single lines, without leaving the window." chips={["Stage files", "Pick lines", "Ctrl + Enter"]} clip={STAGE} />, into: slide({ direction: "from-right" }) as never },
  { frames: len(CONFLICT), node: <Feature flip eyebrow="Merge and resolve" title="Conflicts, block by block." sub="Keep current, incoming or both, inline." chips={["Current", "Incoming", "Both"]} clip={CONFLICT} />, into: slide({ direction: "from-left" }) as never },
  { frames: 50, node: <Version />, into: wipe({ direction: "from-left" }) as never },
  { frames: len(SWITCHER), node: <Wide eyebrow="Quick switcher" title="Jump to any tab." clip={SWITCHER} />, into: slide({ direction: "from-bottom" }) as never },
  { frames: len(FINDBAR), node: <Wide eyebrow="Find bar" title="Search without leaving the graph." clip={FINDBAR} />, into: slide({ direction: "from-right" }) as never },
  { frames: len(BRANCHMENU), node: <Wide eyebrow="Pull requests" title="Create one from the branch menu." clip={BRANCHMENU} />, into: slide({ direction: "from-left" }) as never },
  { frames: len(SETTINGS), node: <Feature flip eyebrow="Cheatsheet" title="Every shortcut, one glance." sub="Back and forward across tabs, tooltips everywhere." chips={["Alt + ← →", "Ctrl + Enter", "Ctrl + 1–9"]} clip={SETTINGS} />, into: slide({ direction: "from-bottom" }) as never },
  { frames: 70, node: <Outro />, into: fade() as never },
];

export const SHOWCASE_FRAMES = SCENES.reduce((n, s) => n + s.frames, 0) - T * (SCENES.length - 1);

export const Showcase = () => (
  <AbsoluteFill>
    <Fonts />
    <Audio src={staticFile("music.mp3")} volume={0.4} loop />
    <TransitionSeries>
      {SCENES.flatMap((s, i) => [
        ...(i > 0 ? [<TransitionSeries.Transition key={`t${i}`} presentation={s.into} timing={linearTiming({ durationInFrames: T })} />] : []),
        <TransitionSeries.Sequence key={`s${i}`} durationInFrames={s.frames}>{s.node}</TransitionSeries.Sequence>,
      ])}
    </TransitionSeries>
  </AbsoluteFill>
);
