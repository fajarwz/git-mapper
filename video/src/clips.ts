import manifest from "../assets/clips/manifest.json";

/** A recorded clip and how fast it plays (slow recordings are sped up a little). */
export interface ClipSpec { name: keyof typeof manifest; rate: number }

export const HISTORY: ClipSpec = { name: "history", rate: 1.15 };
export const DIFFS: ClipSpec = { name: "diffs", rate: 1.15 };
export const STAGE: ClipSpec = { name: "stage", rate: 1.3 };
export const CONFLICT: ClipSpec = { name: "conflict", rate: 1 };
export const SWITCHER: ClipSpec = { name: "switcher", rate: 1 };
export const FINDBAR: ClipSpec = { name: "findbar", rate: 1.1 };
export const BRANCHMENU: ClipSpec = { name: "branchmenu", rate: 1 };
export const SETTINGS: ClipSpec = { name: "settings", rate: 1 };

/** Frames the clip lasts in the composition (30 fps) once sped up. */
export const clipFrames = (spec: ClipSpec) => Math.ceil(manifest[spec.name].frames / spec.rate);
export const clipEvents = (spec: ClipSpec) => manifest[spec.name].events as [number, string][];
