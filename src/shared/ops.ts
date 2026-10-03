// Applying item operations to a collection, and computing the operations that
// undo them. Used by the browser for optimistic updates and undo/redo.

import type { ItemOps } from "./protocol";
import type { Item, ItemPatch, MutableFields } from "./types";

export type ItemMap = Record<string, Item>;

/**
 * What an optional field means when it's missing, so undoing a change to it (making
 * a token a prop, hiding a note) has a value to go back to.
 */
const MISSING: Partial<Record<keyof MutableFields, unknown>> = { layer: "character", hidden: false, locked: false };

export function applyOps(items: ItemMap, ops: ItemOps): ItemMap {
  const next = { ...items };
  for (const item of ops.upsert ?? []) next[item.id] = item;
  for (const p of ops.patch ?? []) {
    const cur = next[p.id];
    if (cur) next[p.id] = { ...cur, ...p.set } as Item;
  }
  for (const id of ops.delete ?? []) delete next[id];
  return next;
}

/** The operations that return `items` to its current state after `ops` is applied. */
export function inverseOps(items: ItemMap, ops: ItemOps): ItemOps {
  const upsert: Item[] = [];
  const patch: ItemPatch[] = [];
  const del: string[] = [];
  for (const item of ops.upsert ?? []) {
    const before = items[item.id];
    if (before) upsert.push(before);
    else del.push(item.id);
  }
  for (const p of ops.patch ?? []) {
    const before = items[p.id];
    if (!before) continue;
    const set: Partial<MutableFields> = {};
    for (const key of Object.keys(p.set) as (keyof MutableFields)[]) {
      const old = (before as unknown as Record<string, unknown>)[key] ?? MISSING[key];
      if (old !== undefined) (set as Record<string, unknown>)[key] = old;
    }
    if (Object.keys(set).length) patch.push({ id: p.id, set });
  }
  for (const id of ops.delete ?? []) {
    const before = items[id];
    if (before) upsert.push(before);
  }
  const out: ItemOps = {};
  if (upsert.length) out.upsert = upsert;
  if (patch.length) out.patch = patch;
  if (del.length) out.delete = del;
  return out;
}

export function isEmptyOps(ops: ItemOps): boolean {
  return !ops.upsert?.length && !ops.patch?.length && !ops.delete?.length;
}

/** Only patches: nothing added or deleted. */
export function isPatchOnly(ops: ItemOps): boolean {
  return !ops.upsert?.length && !ops.delete?.length && !!ops.patch?.length;
}

/**
 * Two patches in a row as one: what `b` sets wins over what `a` set, field by field, with the
 * items in the order they first appear. Folds a burst of turning into one undo step.
 */
export function mergePatches(a: ItemPatch[], b: ItemPatch[]): ItemPatch[] {
  const out = new Map<string, Partial<MutableFields>>();
  for (const p of [...a, ...b]) out.set(p.id, { ...out.get(p.id), ...p.set });
  return [...out].map(([id, set]) => ({ id, set }));
}
