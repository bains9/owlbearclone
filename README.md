# Tabletop

A private virtual tabletop in the spirit of Owlbear Rodeo, live at **https://table.parhome.ca** and running
entirely on Cloudflare: one Worker, two Durable Object classes, and one R2 bucket.

## What it does

- **Rooms.** The GM signs in with a password, creates rooms, and shares the room link. Players open the
  link, pick a name and colour, and they're in. No player accounts.
- **Scenes.** Upload battle maps (several at once: one scene each, named after the file), or start from
  a blank grid. Square grids or hex grids (rows or columns), lined up with the map by cells across/down,
  cell size and offset. The GM previews any scene privately and chooses which one players see.
- **Tokens.** Coloured quick tokens or uploaded images, drag and drop (snaps to the grid; hold Alt to
  place freely), names, sizes ½ to 6 squares, rotation, status rings, props (sit under characters),
  layer order, duplicate (copies are numbered), delete. Shift+click or Shift+drag selects several and they
  move together. The GM can hide tokens from players and lock them. Hidden tokens are never sent to
  players' browsers.
- **Fog of war.** New map scenes start covered. Reveal or hide with a paint brush (size in squares, `[`
  and `]` to resize), rectangles, polygons or a lasso; corners snap to the grid. Every stroke is one Undo.
  The GM sees fog dimmed and can switch to the players' view; players see solid fog and can't pick
  anything under it. Fog is stored with each scene, so it's there next session.
- **Drawing and notes.** Freehand, line, rectangle, ellipse, text notes; colours, widths, fill; eraser.
- **Measuring and pointing.** A ruler (5e diagonals, alternating 1-2-1, straight line, or hexes), spell
  areas (circle, cone, cube, line) that can be pinned to the map, and a laser pointer. Everyone sees them live.
- **Dice and chat.** Rolled on the server, so nobody can fudge a result: `d20`, `2d6+3`, `4d6dl1`,
  `2d20kh1`, `d%`, `4dF`. Advantage, disadvantage, a modifier box, and private rolls (only the roller
  and the GM see them). `/r 2d6+3` works in chat.
- **Initiative** tracker with rounds and turns, linked to tokens. Entries for hidden tokens aren't shown to
  players. Changes are sent as operations, so two people adding themselves at once both land.
- **Undo/redo** of your own changes on the scene you're looking at, keyboard shortcuts (the ? button in the
  top bar lists them), touch and pinch zoom on phones and tablets, automatic reconnection that resends
  anything that didn't get through.

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

**Security.**
- One GM password (the `GM_PASSWORD` secret). Signing in sets an HttpOnly, Secure, SameSite=Lax cookie
  signed with a key derived from a random server-side secret *and* the password, so changing the password
  signs every session out.
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
npm test            # unit tests: dice, grid and hex maths, templates, validation, permissions, undo, initiative
npm run smoke       # end-to-end: API + WebSocket protocol against a running server
```

The smoke test signs in, creates a throwaway room, connects a GM and two players over WebSockets, checks
permissions, hidden tokens, private rolls, the GM's identity, uploads, initiative, scene switching and
deletion, then deletes the room. Against the live site:

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

## Costs

For a personal game group this stays inside Cloudflare's free allowances: Durable Objects with SQLite
storage, WebSocket hibernation (idle rooms cost nothing), and R2's free 10 GB.
