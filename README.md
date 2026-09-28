# Tabletop

A private virtual tabletop in the spirit of Owlbear Rodeo, live at **https://table.parhome.ca** and running
entirely on Cloudflare: one Worker, two Durable Object classes, and one R2 bucket.

## What it does

- **Rooms.** The GM signs in with Google (or a password), creates rooms, and shares the room link. Players
  open the link, pick a name and colour, and they're in. No player accounts.
- **Scenes.** Upload battle maps (several at once: one scene each, named after the file), drop or paste
  them straight onto the board, or start from a blank grid. Square grids or hex grids (rows or columns),
  lined up with the map by cells across/down, cell size and offset, or by drawing a box over a few cells.
  The GM previews any scene privately and chooses which one players see.
- **Bringing maps in.** Besides plain images:
  - **Owlbear Rodeo backups** (`.ob2`: in Owlbear, Manage Storage, Export Backup, tick the scenes *and*
    their map images). Each scene comes over with its map, grid (square or hex), fog (the base cover and
    every cut) and the tokens whose images were in the backup, hidden ones still hidden. Drawings, text,
    walls and lights stay behind; the importer lists anything it left out. An old Owlbear Rodeo 1 export
    (`.owlbear`) needs converting first with Owlbear's own converter at 1to2.owlbear.app.
  - **Universal VTT files** from Dungeondraft, DungeonFog, Dungeon Alchemist, Arkenforge and others
    (`.dd2vtt`, `.df2vtt`, `.uvtt`): the map and its exact grid.
  - **Grid sizes in file names**, the way map makers label them (`Crypt 30x20.jpg`, `[22x30]`, `140ppi`).
  Big images are shrunk to 6144 px on the long side; grids are scaled to match.
- **Tokens.** Coloured quick tokens or uploaded images, drag and drop (snaps to the grid; hold Alt to
  place freely), names, sizes ½ to 6 squares, rotation, status rings, props (sit under characters),
  layer order, duplicate (copies are numbered), delete. Shift+click or Shift+drag selects several and they
  move together. The GM can hide tokens from players and lock them. Hidden tokens are never sent to
  players' browsers.
- **Fog of war.** New map scenes start covered. Reveal or hide with a paint brush (size in squares, `[`
  and `]` to resize), rectangles, polygons or a lasso; corners snap to the grid. Every stroke is one Undo.
  The GM sees fog dimmed and can switch to the players' view; players see solid fog and can't pick
  anything under it. Fog is stored with each scene, so it's there next session.
- **Map builder** (GM, the Build tool, `B`), laid out like Dungeondraft (the GM's map maker): modes
  Building, Walls, Doors, Terrain and Objects. Rooms (stone, wood, dirt) as rectangles, ovals or a brush get
  walls automatically where they meet empty space or terrain; terrain (grass, water, lava) goes under
  buildings. Walls by dragging along grid lines or clicking corners; doors, secret doors and openings by
  clicking a wall; objects (tables, beds, chests, stairs, pillars, trees, a campfire and more, 1 to 3
  squares, quarter turns) placed, turned with a right-click and dragged to move. Alt takes away instead of
  adding, as in Dungeondraft; Ctrl+wheel zooms. Works on a blank grid or over an uploaded map, and the Build
  bar imports Dungeondraft's Universal VTT exports. Each drag or click is one Undo. Players see the
  build under fog like any map; secret doors look like walls to them, and their browsers are never sent
  them. Stored in 16 x 16-square chunks (`src/shared/terrain.ts`), drawn by `src/client/room/build.ts`.
- **Drawing and notes.** Freehand, line, rectangle, ellipse, text notes; colours, widths, fill; eraser.
- **Measuring and pointing.** A ruler (5e diagonals, alternating 1-2-1, straight line, or hexes), spell
  areas (circle, cone, cube, line) that can be pinned to the map, and a laser pointer. Everyone sees them live.
- **Dice and chat.** Rolled on the server, so nobody can fudge a result: `d20`, `2d6+3`, `4d6dl1`,
  `2d20kh1`, `d%`, `4dF`. Advantage, disadvantage, a modifier box, and private rolls (only the roller
  and the GM see them). `/r 2d6+3` works in chat.
- **Initiative** tracker with rounds and turns, linked to tokens. Entries for hidden tokens aren't shown to
  players. Changes are sent as operations, so two people adding themselves at once both land.
- **Table display** for a second screen or a TV at the table: the GM opens it from the monitor button (the
  link carries a key only the GM can get). It shows just the map, exactly as players see it, can't change
  anything, and either fits the whole live scene or follows the GM's view of it. It also shows whose turn it is.
- **Undo/redo** of your own changes on the scene you're looking at, keyboard shortcuts (the ? button in the
  top bar lists them), touch and pinch zoom on phones and tablets, automatic reconnection that resends
  anything that didn't get through (and never applies anything twice).

Not included: lighting and line of sight, audio/video.

## How it's built

| Piece | Where | What it holds |
| --- | --- | --- |
| Worker | `src/worker/index.ts` | Every request: HTTP→HTTPS redirect, JSON API under `/api/`, GM sign-in, image upload and download; everything else goes to the static client |
| `Room` Durable Object | `src/worker/room.ts` | One per room: scenes, tokens, drawings, fog, chat, initiative in SQLite; all live WebSockets (hibernating) |
| `Directory` Durable Object | `src/worker/directory.ts` | One in total: the GM's room list, login throttling, the random secret sessions are signed with |
| R2 bucket `tabletop-files` | binding `FILES` | Uploaded images at `rooms/<roomId>/<assetId>` |
| Client | `src/client/` | Preact UI and a Konva canvas, served as static assets |
| Shared rules | `src/shared/` | Types, protocol, validation, permissions, dice, grid and template maths, initiative operations |

The Room object is the single authority. Browsers apply their own changes immediately; the server
validates and permission-checks every change and sends the sender back either the accepted change or a
correction. Each browser tracks, per field, which of its changes are unconfirmed, so everyone converges on
the same state even when two people edit the same token at once.

Every change a browser tab makes carries a number that counts up within that tab. The Room remembers the
last number it applied from each tab, so after a dropped connection the tab resends exactly what the server
never got, and a change that arrives twice is applied once. A change to a scene that goes with its fog
(Cover all, Clear all, a new map, and undoing them) travels in one message with it and is applied
completely or not at all, so players never see a map between the two halves.

Browsers say which protocol version their code speaks when they connect (`v=2` since built maps), and
which build it is (`b`, a hash of the source set in `vite.config.ts`; the server has the same one). A tab
whose build differs from the server's (one left open across a deploy) gets an **Update: Reload** button, and a
table display reloads itself. Tabs from before builds were compared are sent a message asking them to reload
(for such a table display, which shows no messages, the GM is told instead). A tab on older code isn't sent
built-map chunks, which it would mistake for fog. Such a tab can't send terrain either. Undo of a build step is worked out
when it's used, and puts back only what that step changed, so it never wipes what another tab built since.

**Security.**
- GM sign-in with Google: only the accounts listed in the `GM_EMAILS` secret become the GM, and taking an
  address off the list ends its sessions. OpenID Connect code flow with PKCE, a signed state and a nonce; the
  ID token comes straight from Google's token endpoint and its issuer, audience, expiry, nonce and verified
  email are checked.
- Or one GM password (the `GM_PASSWORD` secret). Either way, signing in sets an HttpOnly, Secure,
  SameSite=Lax cookie signed with a key derived from a random server-side secret; for password sessions the
  key also mixes in the password, so changing it signs those sessions out.
- Login attempts are counted before the password is checked: 10 wrong guesses per address (an IPv6 /64
  counts as one) and 60 overall per 15 minutes.
- The GM is a role, not a browser id, so no player can claim the GM's rolls or images.
- Players need only the room link (12 random characters, about 71 bits). Links that aren't shaped like a
  room id never reach storage.
- Uploads are checked by their actual bytes and served with `nosniff` and a sandboxing CSP.
- Each room has a size budget.
- Plain HTTP is redirected to HTTPS, with HSTS, and the pages carry a strict Content-Security-Policy
  (`public/_headers`).

## Running it locally

```bash
npm install
```

Create `.dev.vars` (never committed or deployed) with a local-only password; see `.dev.vars.example`.

```bash
npm run dev
```

To be a player at the same time, open `http://player.localhost:<port>/r/<roomId>` in another tab: a
different host name, so it doesn't share the GM cookie.

## Checks

```bash
npm run typecheck   # client, worker and tests
npm test            # unit tests: dice, grid and hex maths, templates, validation, permissions, undo,
                    # initiative, backups, map files (Universal VTT, Owlbear Rodeo backups, file names),
                    # the map builder (chunk ids, walls, doors and secret doors, edits and undo)
npm run smoke       # end-to-end: API + WebSocket protocol against a running server
```

The smoke test signs in, creates a throwaway room, connects a GM and two players over WebSockets, checks
permissions, hidden tokens, private rolls, the GM's identity, uploads, initiative, scene switching,
resending after a reconnect, all-or-nothing fog changes and deletion, then deletes the room. Against the live site:

```bash
BASE=https://table.parhome.ca GM_PASSWORD=... npm run smoke
```

`THROTTLE=1` adds the login-throttle check, which locks your address out of signing in for 15 minutes, so
only use it locally. After changing `GM_PASSWORD`, give it about a minute to reach every Cloudflare
location before testing.

## Deploying

The first time:

```bash
npx wrangler r2 bucket create tabletop-files
npm run deploy                      # typecheck, tests, build, wrangler deploy
npx wrangler secret put GM_PASSWORD # prompts for the password; sign-in is disabled until it's set
```

`wrangler deploy` also creates the custom domain `table.parhome.ca`. To use a different host name,
change `routes` in `wrangler.jsonc` and `connect-src` in `public/_headers`.

After that, `npm run deploy` is all it takes.

## Google sign-in

1. In Google Cloud Console, create a project, set up the OAuth consent screen (Google Auth Platform:
   an External app asking only for the basic `openid` and `email` scopes), and create an **OAuth client ID**
   of type **Web application** with this authorized redirect URI:
   `https://table.parhome.ca/api/auth/google/callback`
2. Give the Worker the client and the GM list (each command prompts for the value):

   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put GM_EMAILS      # e.g. gm@example.com, you@example.com
   ```

The start page shows **Sign in with Google** once all three are set. The GM password keeps working if
`GM_PASSWORD` is set, and the sign-in form hides it if not. Locally, `.dev.vars` holds made-up Google values
that only work with the smoke test's stand-in for Google: `GOOGLE=1 npm run smoke`.

## Costs

For a personal game group this stays inside Cloudflare's free allowances: Durable Objects with SQLite
storage, WebSocket hibernation (idle rooms cost nothing), and R2's free 10 GB.
