// Feet and metres. A room can measure in metres: its new scenes then start with one
// square being 1.5 m (the metric stand-in for 5 ft), and the GM can switch the scenes it
// already has between the two (5 ft = 1.5 m, so feet x 0.3).

import { DEFAULT_GRID, LIMITS } from "./sanitize";
import type { GridSettings, RoomSettings } from "./types";

/** What one square is: its distance and the unit's name. */
export type GridUnits = Pick<GridSettings, "unit" | "unitName">;

/** One square in a room that measures in metres. */
export const METRIC_UNITS: GridUnits = { unit: 1.5, unitName: "m" };
/** One square in a room that measures in feet (what every scene started with before metres). */
export const FEET_UNITS: GridUnits = { unit: DEFAULT_GRID.unit, unitName: DEFAULT_GRID.unitName };

const METRES_PER_FOOT = 0.3;

const FEET_NAMES = /^(?:ft|feet|foot|')$/i;
const METRE_NAMES = /^(?:m|metres?|meters?)$/i;

const bare = (unitName: string) => unitName.trim().replace(/\.$/, "");

/** Whether a unit is feet ("ft", "feet", "ft."). */
export function isFeet(unitName: string): boolean {
  return FEET_NAMES.test(bare(unitName));
}

/** Whether a unit is metres ("m", "metres", "meters"). Not "km" or "cm". */
export function isMetres(unitName: string): boolean {
  return METRE_NAMES.test(bare(unitName));
}

/** Whether a room measures in metres. Rooms from before the setting existed don't. */
export function isMetric(settings: Pick<RoomSettings, "metric"> | null | undefined): boolean {
  return settings?.metric === true;
}

/** A distance rounded to 0.1 (to 0.01 if it's smaller than that), without float noise. */
export function roundUnit(n: number): number {
  const r = Math.round(n * 10) / 10;
  return r > 0 ? r : Math.max(0.01, Math.round(n * 100) / 100);
}

/**
 * A scene's units switched to metres (toMetric) or back to feet: 5 ft is 1.5 m, 10 ft is 3 m,
 * rounded to 0.1. Null when the scene isn't measured in the unit being switched from (it's
 * already in the other, or in something else, like squares or km): it's left as it is.
 * Null too when the result would be more than a square can be (metres over 30000 a square
 * going back to feet), which the server would cut down, losing the way back.
 */
export function switchUnits(units: GridUnits, toMetric: boolean): GridUnits | null {
  // A hand-edited backup can carry anything as a grid: it's left for the server to fill in.
  if (typeof units?.unitName !== "string" || typeof units.unit !== "number") return null;
  if (!(toMetric ? isFeet(units.unitName) : isMetres(units.unitName))) return null;
  const unit = roundUnit(toMetric ? units.unit * METRES_PER_FOOT : units.unit / METRES_PER_FOOT);
  return unit <= LIMITS.gridUnitMax ? { unit, unitName: toMetric ? "m" : "ft" } : null;
}

/** What one square is in a room's new scenes. */
export function newSceneUnits(settings: Pick<RoomSettings, "metric"> | null | undefined): GridUnits {
  return { ...(isMetric(settings) ? METRIC_UNITS : FEET_UNITS) };
}

/** The grid a room's new scenes start with. */
export function defaultGrid(settings: Pick<RoomSettings, "metric"> | null | undefined): GridSettings {
  return { ...DEFAULT_GRID, ...newSceneUnits(settings) };
}

/**
 * What one square is in a scene brought in from a file that says (an Owlbear Rodeo scale).
 * A room in metres switches feet to metres and keeps any other scale as it is; one without
 * a scale gets 1.5 m. A room in feet starts every scene at 5 ft, as it always has.
 */
export function importedUnits(scale: GridUnits | undefined, settings: Pick<RoomSettings, "metric"> | null | undefined): GridUnits {
  if (!isMetric(settings)) return newSceneUnits(settings);
  if (!scale) return { ...METRIC_UNITS };
  if (isMetres(scale.unitName)) return { unit: scale.unit, unitName: "m" };
  return switchUnits(scale, true) ?? { ...scale };
}
