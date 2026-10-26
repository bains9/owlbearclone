// What Dungeon's Worker may ask Table's (see dungeon.ts). Only Workers on this account with
// a service binding to this entrypoint can call it; browsers can't reach it at all.

import { WorkerEntrypoint } from "cloudflare:workers";
import { dungeonSessionOk, redeemHop } from "./dungeon";

export class DungeonGate extends WorkerEntrypoint<Env> {
  /** A Dungeon session for a one-time code from /api/dungeon/hop, or null. */
  redeem(code: string): Promise<string | null> {
    return redeemHop(this.env, String(code));
  }

  /** Is this Dungeon session still good? */
  check(session: string): Promise<boolean> {
    return dungeonSessionOk(this.env, String(session));
  }
}
