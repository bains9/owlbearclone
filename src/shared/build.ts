// Which build of Tabletop this is. The browser code and the server are built (and
// deployed) together, so a browser tab whose build differs from the server's is running
// an older version: one left open across an update.

declare const __BUILD_ID__: string | undefined;

/** Set at build time (vite.config.ts); "dev" in tests. */
export const BUILD_ID: string = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";
