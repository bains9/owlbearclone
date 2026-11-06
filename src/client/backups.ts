// Backups in the GM's Google Drive, from the start page (ui/BackupsCard.tsx; worker/backupRoutes.ts).
import type { BackupReason, BackupStatus, BackupSummary, TablePart } from "../shared/backups";

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !data) throw new Error(data?.error ?? "That didn't work. Check the connection, then try again.");
  return data;
}

export interface NightRoom {
  id: string;
  name: string;
  scenes: number;
  items: number;
  files: number;
  /** A room with its id is here now: it goes back beside it, as a copy. */
  here: boolean;
}

export interface BackupNight {
  id: string;
  at: number;
  reason: BackupReason;
  complete: boolean;
  missing: number;
  files: number;
  rooms: NightRoom[];
}

export const backups = {
  status: () => call<BackupStatus>("/api/backups"),
  setSource: (source: string) => call<{ source: string | null }>("/api/backups/drive", "PUT", { source }).then((r) => r.source),
  run: (reason: BackupReason) => call<{ started: boolean; why?: string }>("/api/backups/run", "POST", { reason }),
  nights: () => call<(BackupSummary | { id: string })[]>("/api/backups/nights"),
  night: (id: string) => call<BackupNight>(`/api/backups/night/${id}`),
  restoreRoom: (id: string, room: string) => call<{ room: string; name: string; sameLink: boolean; files: number }>(`/api/backups/night/${id}/room`, "POST", { room }),
  restoreParts: (id: string, parts: TablePart[]) => call<{ parts: TablePart[]; files: number }>(`/api/backups/night/${id}/table`, "POST", { parts }),
  /** Every file of a room or some parts back from Drive, a few at a time; how many couldn't be read. */
  async filesBack(id: string, what: { room: string; into: string } | { parts: TablePart[] }, progress: (n: number, total: number) => void): Promise<{ missing: number }> {
    let from = 0;
    let missing = 0;
    for (;;) {
      const step = await call<{ next: number; total: number; missing: number; done: boolean }>(`/api/backups/night/${id}/files`, "POST", { ...what, from });
      missing += step.missing;
      if (step.total) progress(step.next, step.total);
      if (step.done) return { missing };
      from = step.next;
    }
  },
};
