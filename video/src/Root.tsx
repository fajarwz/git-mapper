import { Composition } from "remotion";
import { Showcase, SHOWCASE_FRAMES } from "./Showcase";

export const Root = () => (
  <Composition id="Showcase" component={Showcase} durationInFrames={SHOWCASE_FRAMES} fps={30} width={1920} height={1080} />
);
