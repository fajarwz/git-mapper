import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { changeSlots, hunkSignatures, type ChangeSlot } from "../lib/lineSelection";
import type { DiffLine } from "../types";

export interface LineSelection {
  slots: Array<ChangeSlot | null>;
  isPicked: (lineIndex: number) => boolean;
  /** Mouse down on a gutter: flips the group (a split row's remove + add) and starts a drag;
   * with `extend`, picks everything from the last anchor to here. */
  begin: (group: number[], extend: boolean) => void;
  /** Pointer entering another row mid-drag: that row takes the drag's state. */
  enter: (group: number[]) => void;
  /** Keyboard flip, no drag. */
  toggleGroup: (group: number[]) => void;
  /** The picked ordinals of one hunk, ascending. */
  pickedIn: (hunk: number) => number[];
  /** Picked lines of one hunk by kind, for labels like "+2 −1". */
  countsIn: (hunk: number) => { add: number; remove: number };
  clear: (hunk: number) => void;
}

type Picks = ReadonlyMap<number, { sig: string; ords: ReadonlySet<number> }>;
const EMPTY: Picks = new Map();

/**
 * Which changed lines of one file's diff are ticked. Picks are kept per hunk with that hunk's
 * fingerprint: a reload that leaves the hunk untouched keeps them, one that changes it drops them.
 */
export function useLineSelection(diff: DiffLine[] | null, enabled: boolean): LineSelection | null {
  const lines = useMemo(() => diff ?? [], [diff]);
  const slots = useMemo(() => changeSlots(lines), [lines]);
  const sigs = useMemo(() => hunkSignatures(lines), [lines]);
  const [stored, setStored] = useState<Picks>(EMPTY);
  const anchor = useRef<number | null>(null);
  const dragTo = useRef<boolean | null>(null);

  const picks = useMemo<Picks>(() => {
    const live = new Map<number, { sig: string; ords: ReadonlySet<number> }>();
    for (const [hunk, entry] of stored) if (sigs[hunk] === entry.sig) live.set(hunk, entry);
    return live;
  }, [stored, sigs]);

  useEffect(() => {
    const stop = () => {
      dragTo.current = null;
    };
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  const isPicked = useCallback(
    (lineIndex: number) => {
      const slot = slots[lineIndex];
      return slot !== null && slot !== undefined && (picks.get(slot.hunk)?.ords.has(slot.ordinal) ?? false);
    },
    [slots, picks],
  );

  const setMany = useCallback(
    (indexes: number[], on: boolean) =>
      setStored(() => {
        const next = new Map(picks);
        for (const index of indexes) {
          const slot = slots[index];
          if (!slot) continue;
          const ords = new Set(next.get(slot.hunk)?.ords);
          if (on) ords.add(slot.ordinal);
          else ords.delete(slot.ordinal);
          if (ords.size === 0) next.delete(slot.hunk);
          else next.set(slot.hunk, { sig: sigs[slot.hunk], ords });
        }
        return next;
      }),
    [picks, slots, sigs],
  );

  const begin = useCallback(
    (group: number[], extend: boolean) => {
      const first = group.find((index) => slots[index]);
      if (first === undefined) return;
      if (extend && anchor.current !== null) {
        const [low, high] = [Math.min(anchor.current, first), Math.max(anchor.current, first)];
        const hunk = slots[first]?.hunk;
        const span = Array.from({ length: high - low + 1 }, (_, k) => low + k).filter(
          (index) => slots[index]?.hunk === hunk,
        );
        setMany([...span, ...group], true);
      } else {
        const target = !group.every(isPicked);
        dragTo.current = target;
        setMany(group, target);
      }
      anchor.current = first;
    },
    [slots, isPicked, setMany],
  );
  const enter = useCallback(
    (group: number[]) => {
      if (dragTo.current !== null) setMany(group, dragTo.current);
    },
    [setMany],
  );
  const toggleGroup = useCallback(
    (group: number[]) => setMany(group, !group.every(isPicked)),
    [setMany, isPicked],
  );
  const clear = useCallback(
    (hunk: number) =>
      setStored(() => {
        const next = new Map(picks);
        next.delete(hunk);
        return next;
      }),
    [picks],
  );

  return useMemo(
    () =>
      enabled
        ? {
            slots,
            isPicked,
            begin,
            enter,
            toggleGroup,
            pickedIn: (hunk: number) => [...(picks.get(hunk)?.ords ?? [])].sort((a, b) => a - b),
            countsIn: (hunk: number) => {
              const counts = { add: 0, remove: 0 };
              lines.forEach((line, index) => {
                if (slots[index]?.hunk !== hunk || !isPicked(index)) return;
                if (line.type === "add") counts.add += 1;
                else counts.remove += 1;
              });
              return counts;
            },
            clear,
          }
        : null,
    [enabled, slots, lines, picks, isPicked, begin, enter, toggleGroup, clear],
  );
}
