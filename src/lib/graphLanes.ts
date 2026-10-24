/**
 * Greedy lane assignment walking commits newest-first: a commit occupies the
 * lane where one of its children reserved it, otherwise the lowest free lane.
 * Its primary parent continues in the same lane; secondary parents (merge
 * branches) reserve free lanes. Deliberately simple — a real layout engine
 * is a separate pass — but with a hard cap: repos with many parallel branches
 * would otherwise grow arbitrarily wide. When the cap is full the round-robin
 * victim slot is recycled, so single-use lanes collapse instead of spreading.
 */
export const MAX_LANES = 6;

export function computeLanes(
  commits: Array<{ hash: string; parents: string[] }>,
): number[] {
  const slots: Array<string | null> = [];
  let victim = 0;
  const claimFreeOrVictim = (): number => {
    // Slots past the array end are free too, so the list only grows up to the cap.
    const free = slots.findIndex((slot, index) => index < MAX_LANES && slot == null);
    if (free !== -1) return free;
    // Full above the cap: recycle the round-robin victim slot.
    const picked = victim % MAX_LANES;
    victim = picked + 1;
    return picked;
  };

  return commits.map(({ hash, parents }) => {
    let lane = slots.indexOf(hash);
    if (lane === -1) lane = claimFreeOrVictim();
    slots[lane] = parents[0] ?? null;
    for (const parent of parents.slice(1)) {
      if (slots.includes(parent)) continue;
      slots[claimFreeOrVictim()] = parent;
    }
    return lane;
  });
}
