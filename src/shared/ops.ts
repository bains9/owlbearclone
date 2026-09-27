// Applying item operations to a collection, and computing the operations that
// undo them. Used by the browser for optimistic updates and undo/redo.

import type { ItemOps } from "./protocol";
import type { Item, ItemPatch, MutableFields } from "./types";

export type ItemMap = Record<string, Item>;

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
      (set as Record<string, unknown>)[key] = (before as unknown as Record<string, unknown>)[key];
    }
    patch.push({ id: p.id, set });
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
