// Token sizes: the squares a token covers, and the D&D creature sizes they stand for, so the
// size list can say "2×2 (Large)" and a monster from the Monsters list fits the map's grid.

export type DndSize = "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan";

/** The sizes the token bar offers, in squares. */
export const TOKEN_SIZES = [0.5, 1, 2, 3, 4, 6];

/** How many squares across a creature of each D&D size takes up. */
export const DND_SQUARES: Record<DndSize, number> = {
  tiny: 0.5,
  small: 1,
  medium: 1,
  large: 2,
  huge: 3,
  gargantuan: 4,
};

export const DND_SIZE_NAMES: Record<DndSize, string> = {
  tiny: "Tiny",
  small: "Small",
  medium: "Medium",
  large: "Large",
  huge: "Huge",
  gargantuan: "Gargantuan",
};

/** The D&D sizes a token `squares` across stands for ("Small/Medium" for 1), or "" for none. */
export function dndSizeName(squares: number): string {
  return (Object.keys(DND_SQUARES) as DndSize[])
    .filter((s) => DND_SQUARES[s] === squares)
    .map((s) => DND_SIZE_NAMES[s])
    .join("/");
}

/** A size as the token bar lists it: "½×½ (Tiny)", "1×1 (Small/Medium)", "6×6". */
export function sizeOptionLabel(squares: number, dnd = true): string {
  const n = squares === 0.5 ? "½" : String(squares);
  const name = dnd ? dndSizeName(squares) : "";
  return name ? `${n}×${n} (${name})` : `${n}×${n}`;
}
