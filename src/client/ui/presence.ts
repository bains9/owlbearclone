// The top bar's presence dots: up to six people's dots and "+N" for the rest. While "Only you can
// see this scene" is in a narrower top bar, CSS (styles.css) shows three dots and "+N" instead,
// or two narrower still, so the top bar's buttons keep their room. These say which dots and
// counts each of those widths shows; a count is there only when it takes less room than the
// dots it stands for.

/** The extra classes on the dot for person `i` (from 0) of `count`. */
export function dotClasses(i: number, count: number): string[] {
  const out: string[] = [];
  // Hidden where two dots and "+N" are shown.
  if (i >= 2 && count > 3) out.push("dot-3up");
  // Hidden where three dots and "+N" are shown.
  if (i >= 3 && count > 4) out.push("dot-4up");
  return out;
}

export interface PresenceCount {
  /** more-6 after six dots (any width), more-3 after three, more-2 after two. */
  cls: "more-6" | "more-3" | "more-2";
  text: string;
}

/** The "+N" counts for `count` people, one for each layout that leaves some people out. */
export function presenceCounts(count: number): PresenceCount[] {
  const out: PresenceCount[] = [];
  if (count > 6) out.push({ cls: "more-6", text: `+${count - 6}` });
  if (count > 4) out.push({ cls: "more-3", text: `+${count - 3}` });
  if (count > 3) out.push({ cls: "more-2", text: `+${count - 2}` });
  return out;
}
