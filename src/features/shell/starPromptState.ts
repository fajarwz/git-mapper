const DAY_MS = 24 * 60 * 60 * 1000;

export const FIRST_ASK_AFTER_DAYS = 3;
export const MIN_LAUNCHES = 10;
export const REARM_AFTER_DAYS = 7;
export const MAX_ASKS = 2;

/** `later` = asked and dismissed, may be asked once more; `done` = never ask again. */
export interface StarPromptState {
  firstSeen: number;
  launches: number;
  status: "pending" | "later" | "done";
  asks: number;
  lastAsk: number;
}

export function initialStarState(now: number): StarPromptState {
  return { firstSeen: now, launches: 0, status: "pending", asks: 0, lastAsk: 0 };
}

export function recordLaunch(state: StarPromptState): StarPromptState {
  return { ...state, launches: state.launches + 1 };
}

export function shouldPrompt(state: StarPromptState, now: number): boolean {
  if (state.status === "done" || state.asks >= MAX_ASKS) return false;
  if (state.status === "later") return now - state.lastAsk >= REARM_AFTER_DAYS * DAY_MS;
  return now - state.firstSeen >= FIRST_ASK_AFTER_DAYS * DAY_MS && state.launches >= MIN_LAUNCHES;
}

/** Dismissed without starring: the second dismissal closes the book. */
export function dismissLater(state: StarPromptState, now: number): StarPromptState {
  const asks = state.asks + 1;
  return { ...state, asks, lastAsk: now, status: asks >= MAX_ASKS ? "done" : "later" };
}

export function markDone(state: StarPromptState): StarPromptState {
  return { ...state, status: "done" };
}
