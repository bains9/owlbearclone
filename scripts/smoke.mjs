// End-to-end check of the API and the room protocol against a running server.
//
//   node scripts/smoke.mjs                         (local dev server on :5230, password from .dev.vars)
//   BASE=https://table.parhome.ca GM_PASSWORD=... node scripts/smoke.mjs
//
// It signs in as the GM, creates a throwaway room, connects a GM and two players
// over WebSockets, exercises permissions, hidden tokens, dice, uploads and scene
// switching, then deletes the room again.

import { readFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:5230";
const WS_BASE = BASE.replace(/^http/, "ws");
let password = process.env.GM_PASSWORD;
if (!password) {
  const vars = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8");
  password = /^GM_PASSWORD=(.*)$/m.exec(vars)?.[1]?.trim();
}
if (!password) throw new Error("No GM password: set GM_PASSWORD or create .dev.vars");

let failures = 0;
function check(cond, label) {
  if (cond) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rid = () => Math.random().toString(36).slice(2, 12);

function connect(roomId, { cookie, uid, name, sid }) {
  const url = `${WS_BASE}/api/rooms/${roomId}/ws?uid=${uid}&name=${encodeURIComponent(name)}&color=%234f9dde${sid ? `&sid=${sid}` : ""}`;
  const ws = new WebSocket(url, cookie ? { headers: { Cookie: cookie } } : undefined);
  const c = { ws, msgs: [], closeCode: null, seq: 0 };
  ws.onmessage = (e) => {
    if (e.data === "pong") return;
    c.msgs.push(JSON.parse(e.data));
  };
  ws.onclose = (e) => {
    c.closeCode = e.code;
  };
  c.send = (m) => ws.send(JSON.stringify(m));
  c.items = (ops) => c.send({ t: "items", seq: ++c.seq, ...ops });
  c.waitFor = async (pred, ms = 3000) => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const found = c.msgs.find(pred);
      if (found) return found;
      await sleep(20);
    }
    return null;
  };
  c.clear = () => {
    c.msgs.length = 0;
  };
  return c;
}

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function main() {
  console.log(`Smoke test against ${BASE}`);

  let r = await fetch(`${BASE}/api/me`);
  check(r.ok && (await r.json()).gm === false, "anonymous visitor is not the GM");

  r = await fetch(`${BASE}/api/rooms`);
  check(r.status === 401, "room list needs the GM");

  r = await fetch(`${BASE}/api/login`, { method: "POST", body: JSON.stringify({ password: "wrong" }) });
  check(r.status === 401, "wrong password is refused");

  r = await fetch(`${BASE}/api/login`, { method: "POST", body: JSON.stringify({ password }) });
  const setCookie = r.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0];
  check(r.ok && cookie.startsWith("tt_gm="), "right password signs in");
  check(/HttpOnly/i.test(setCookie) && /SameSite=Lax/i.test(setCookie), "session cookie is HttpOnly and SameSite=Lax");

  r = await fetch(`${BASE}/api/me`, { headers: { Cookie: cookie } });
  check((await r.json()).gm === true, "cookie makes you the GM");

  // Flip a character in the middle of the signature (every bit of it is significant),
  // and separately the last character (whose spare bits must not be accepted either).
  const at = cookie.length - 10;
  const flipped = cookie.slice(0, at) + (cookie[at] === "A" ? "B" : "A") + cookie.slice(at + 1);
  r = await fetch(`${BASE}/api/me`, { headers: { Cookie: flipped } });
  check((await r.json()).gm === false, "a tampered cookie is not the GM");
  const last = cookie[cookie.length - 1];
  const variants = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".split("").filter((c) => c !== last);
  let anyAccepted = false;
  for (const c of variants.slice(0, 8)) {
    r = await fetch(`${BASE}/api/me`, { headers: { Cookie: cookie.slice(0, -1) + c } });
    if ((await r.json()).gm) anyAccepted = true;
  }
  check(!anyAccepted, "no other spelling of the signature is accepted");

  r = await fetch(`${BASE}/api/rooms`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: "https://evil.example" },
    body: JSON.stringify({ name: "x" }),
  });
  check(r.status === 403, "cross-origin POST is refused");

  r = await fetch(`${BASE}/api/rooms`, { method: "POST", headers: { Cookie: cookie }, body: JSON.stringify({ name: "Smoke test room" }) });
  const room = await r.json();
  check(r.status === 201 && /^[A-Za-z0-9]{12}$/.test(room.id), "GM creates a room");

  const gm = connect(room.id, { cookie, uid: "gmuser" + rid(), name: "The GM" });
  const alice = connect(room.id, { uid: "alice" + rid(), name: "Alice" });
  const bob = connect(room.id, { uid: "bob" + rid(), name: "Bob" });
  const gmHello = await gm.waitFor((m) => m.t === "hello");
  const aHello = await alice.waitFor((m) => m.t === "hello");
  await bob.waitFor((m) => m.t === "hello");
  check(gmHello?.you.role === "gm", "GM socket is the GM");
  check(aHello?.you.role === "player", "player socket is a player");
  check(gmHello?.scenes.length === 1 && gmHello.activeSceneId === gmHello.scenes[0].id, "new room has one active scene");
  const sceneId = gmHello.activeSceneId;
  await gm.waitFor((m) => m.t === "players" && m.players.length === 3);
  check(true, "presence shows three people");

  const base = { sceneId, kind: "token", z: 0, size: 1, rotation: 0, assetId: null, color: "#e4572e", locked: false, rings: [] };
  const visible = { ...base, id: "vis" + rid(), x: 35, y: 35, label: "Fighter", hidden: false };
  const hidden = { ...base, id: "hid" + rid(), x: 105, y: 35, label: "Assassin", hidden: true };
  gm.items({ upsert: [visible, hidden] });
  const aGot = await alice.waitFor((m) => m.t === "items" && m.upsert?.some((i) => i.id === visible.id));
  check(aGot && !aGot.upsert.some((i) => i.id === hidden.id), "player gets the visible token but not the hidden one");
  const gmEcho = await gm.waitFor((m) => m.t === "items" && m.seq === 1);
  check(gmEcho?.upsert?.length === 2, "GM gets its own change echoed with its seq");

  alice.clear();
  gm.clear();
  alice.items({ patch: [{ id: visible.id, set: { x: 175 } }] });
  const gmSaw = await gm.waitFor((m) => m.t === "items" && m.patch?.[0]?.set.x === 175);
  check(Boolean(gmSaw), "player moves a token; GM sees the move");

  alice.clear();
  alice.items({ patch: [{ id: visible.id, set: { hidden: true } }] });
  const refusedHide = await alice.waitFor((m) => m.t === "items" && m.refused?.includes(visible.id));
  check(refusedHide?.upsert?.[0]?.hidden === false, "player can't hide a token (refused and corrected)");

  alice.clear();
  alice.items({ patch: [{ id: hidden.id, set: { x: 0 } }], delete: [hidden.id] });
  const probe = await alice.waitFor((m) => m.t === "items" && m.seq === alice.seq);
  await sleep(150);
  check(
    probe?.delete?.includes(hidden.id) && !probe.refused && !probe.upsert && !alice.msgs.some((m) => m.t === "error"),
    "player can't touch a hidden token, and can't tell it apart from a deleted one",
  );

  alice.clear();
  const fog = { id: "fog" + rid(), sceneId, kind: "fog", z: 0, mode: "reveal", shape: "rect", points: [0, 0, 10, 10] };
  alice.items({ upsert: [fog] });
  const refusedFog = await alice.waitFor((m) => m.t === "items" && m.refused?.includes(fog.id));
  check(refusedFog?.delete?.includes(fog.id), "player can't create fog");

  alice.clear();
  gm.items({ patch: [{ id: hidden.id, set: { hidden: false } }] });
  const revealed = await alice.waitFor((m) => m.t === "items" && m.upsert?.some((i) => i.id === hidden.id));
  check(Boolean(revealed), "revealing a token sends it to players");

  alice.clear();
  gm.items({ patch: [{ id: hidden.id, set: { hidden: true } }] });
  const rehidden = await alice.waitFor((m) => m.t === "items" && m.delete?.includes(hidden.id));
  check(Boolean(rehidden), "hiding a token removes it for players");

  alice.clear();
  gm.send({ t: "eph", e: { k: "drag", sceneId, moves: [{ id: hidden.id, x: 1, y: 1 }] } });
  gm.send({ t: "eph", e: { k: "drag", sceneId, moves: [{ id: visible.id, x: 2, y: 2 }] } });
  const drag = await alice.waitFor((m) => m.t === "eph");
  await sleep(150);
  check(
    drag?.e.moves[0].id === visible.id && !alice.msgs.some((m) => m.t === "eph" && m.e.moves?.some((mv) => mv.id === hidden.id)),
    "live drags of hidden tokens don't reach players",
  );

  alice.clear();
  bob.clear();
  alice.send({ t: "roll", expr: "2d20kh1+5" });
  const roll = await bob.waitFor((m) => m.t === "chat" && m.message.kind === "roll");
  check(roll && roll.message.roll.total >= 6 && roll.message.roll.total <= 25, "a public roll reaches everyone with a sane total");

  bob.clear();
  gm.clear();
  alice.send({ t: "roll", expr: "1d20", private: true, label: "Stealth" });
  const gmPrivate = await gm.waitFor((m) => m.t === "chat" && m.message.private);
  await sleep(150);
  check(Boolean(gmPrivate) && !bob.msgs.some((m) => m.t === "chat"), "a private roll reaches the GM but not other players");

  alice.clear();
  alice.send({ t: "roll", expr: "1000d6" });
  const bad = await alice.waitFor((m) => m.t === "error");
  check(Boolean(bad), "silly rolls are refused with a message");

  alice.clear();
  alice.send({ t: "scene.upsert", scene: { ...gmHello.scenes[0], name: "Hacked" } });
  check(Boolean(await alice.waitFor((m) => m.t === "error")), "players can't edit scenes");

  // Validation: prototype keys and "__" ids are not fields or ids.
  alice.clear();
  alice.items({ patch: [{ id: visible.id, set: { constructor: { junk: "x".repeat(1000) } } }] });
  const proto = await alice.waitFor((m) => m.t === "items" && m.seq === alice.seq);
  check(proto?.refused?.includes(visible.id), "a patch of 'constructor' is refused");
  alice.clear();
  alice.items({ upsert: [{ ...base, id: "__proto__", x: 1, y: 1, label: "", hidden: false }] });
  await sleep(200);
  gm.clear();
  const gmState = connect(room.id, { cookie, uid: "gmcheck" + rid(), name: "GM check" });
  const gmState2 = await gmState.waitFor((m) => m.t === "hello");
  check(!gmState2?.items.some((i) => i.id === "__proto__"), "an item id of __proto__ is never stored");
  gmState.ws.close();

  // Over the per-message cap: the extra operations are refused (corrected), not silently dropped.
  alice.clear();
  const many = Array.from({ length: 5001 }, (_, i) => "nope" + i);
  alice.items({ delete: many });
  const capped = await alice.waitFor((m) => m.t === "items" && m.seq === alice.seq, 8000);
  check(capped?.refused?.includes("nope5000") && capped.delete?.includes("nope5000"), "operations past the cap are corrected, not dropped");

  // The GM's identity can't be claimed by a player.
  const faker = connect(room.id, { uid: "@gm", name: "Not the GM" });
  const fakeHello = await faker.waitFor((m) => m.t === "hello");
  check(fakeHello?.you.userId !== "@gm" && fakeHello?.you.role === "player", "a player can't take the GM's identity");
  check(gmHello.you.userId === "@gm", "the GM's items and rolls are owned by the GM role, not a browser id");

  // uploads
  r = await fetch(`${BASE}/api/rooms/${room.id}/assets?kind=token&name=dot&w=1&h=1`, {
    method: "POST",
    headers: { "Content-Type": "image/png", "X-Tabletop-User": "alice123" },
    body: TINY_PNG,
  });
  const asset = await r.json();
  check(r.status === 201 && asset.mime === "image/png", "player uploads a token image");
  r = await fetch(`${BASE}/api/files/${room.id}/${asset.id}`);
  const body = Buffer.from(await r.arrayBuffer());
  check(r.ok && r.headers.get("content-type") === "image/png" && body.equals(TINY_PNG), "the image is served back byte for byte");
  check(/immutable/.test(r.headers.get("cache-control") ?? ""), "images are cached as immutable");
  const etag = r.headers.get("etag");
  r = await fetch(`${BASE}/api/files/${room.id}/${asset.id}`, { headers: { "If-None-Match": etag } });
  check(r.status === 304, "conditional request gets 304");

  r = await fetch(`${BASE}/api/rooms/${room.id}/assets?kind=map&name=m&w=1&h=1`, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: TINY_PNG,
  });
  check(r.status === 403, "players can't upload maps");

  alice.clear();
  r = await fetch(`${BASE}/api/rooms/${room.id}/assets?kind=map&name=secret-map&w=1&h=1`, {
    method: "POST",
    headers: { "Content-Type": "image/png", Cookie: cookie, "X-Tabletop-User": aHello.you.userId },
    body: TINY_PNG,
  });
  const gmAsset = await r.json();
  check(r.status === 201 && gmAsset.owner === "@gm", "the GM's upload belongs to the GM role even with a player's id attached");
  await sleep(200);
  check(!alice.msgs.some((m) => m.t === "asset.upsert" && m.asset.id === gmAsset.id), "players aren't told about the GM's images");
  alice.send({ t: "asset.delete", id: gmAsset.id });
  check(Boolean(await alice.waitFor((m) => m.t === "error")), "a player can't delete the GM's images");
  r = await fetch(`${BASE}/api/files/${room.id}/${gmAsset.id}`);
  check(r.ok, "the GM's image is still there");

  r = await fetch(`${BASE}/api/rooms/${room.id}/assets?kind=token&name=x&w=1&h=1`, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: "<html><script>alert(1)</script></html>",
  });
  check(r.status === 415, "an HTML file posing as an image is refused");

  r = await fetch(`${BASE}/api/rooms/nosuchroom12/assets?kind=token&name=x&w=1&h=1`, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: TINY_PNG,
  });
  check(r.status === 403, "uploads to a room that doesn't exist are refused");
  r = await fetch(`${BASE}/api/rooms/not-a-room-id/ws`);
  check(r.status === 404, "room ids of the wrong shape never reach a Durable Object");

  // initiative: an entry for a hidden token isn't shown to players; changes are operations
  alice.clear();
  gm.items({ patch: [{ id: hidden.id, set: { hidden: true } }] });
  await sleep(150);
  const initOp = (c, op) => c.send({ t: "initiative.op", op });
  initOp(gm, { op: "add", entry: { id: "e1", name: "Assassin", value: 20, color: "#ff0000", tokenId: hidden.id } });
  initOp(gm, { op: "add", entry: { id: "e2", name: "Fighter", value: 12, color: "#00ff00", tokenId: visible.id } });
  const aInit = await alice.waitFor((m) => m.t === "initiative" && m.initiative.entries.some((e) => e.id === "e2"));
  check(
    aInit && aInit.initiative.entries.length === 1 && aInit.initiative.entries[0].name === "Fighter" && aInit.initiative.turn === -1,
    "players don't see initiative entries for hidden tokens",
  );
  gm.clear();
  initOp(alice, { op: "update", id: "e2", value: 15 });
  initOp(bob, { op: "add", entry: { id: "e3", name: "Bob", value: 9, color: "#0000ff", tokenId: null } });
  // Two connections: the server may take them in either order, so wait for the state with both.
  const gmInit = await gm.waitFor(
    (m) => m.t === "initiative" && m.initiative.entries.some((e) => e.id === "e3") && m.initiative.entries.some((e) => e.id === "e2" && e.value === 15),
  );
  const byId = Object.fromEntries((gmInit?.initiative.entries ?? []).map((e) => [e.id, e]));
  check(
    gmInit?.initiative.entries.length === 3 && byId.e2?.value === 15 && gmInit.initiative.entries[0].id === "e1" && gmInit.initiative.turn === 0,
    "two players' changes at once both land, and the hidden entry keeps its turn",
  );
  alice.clear();
  initOp(alice, { op: "remove", id: "e1" });
  check(Boolean(await alice.waitFor((m) => m.t === "error")), "a player can't remove an entry they can't see");
  initOp(alice, { op: "clear" });
  check(Boolean(await alice.waitFor((m) => m.t === "error" && alice.msgs.filter((x) => x.t === "error").length >= 2)), "only the GM ends combat");
  alice.clear();
  gm.items({ patch: [{ id: hidden.id, set: { hidden: false } }] });
  const shown = await alice.waitFor((m) => m.t === "initiative" && m.initiative.entries.length === 3);
  await alice.waitFor((m) => m.t === "items" && m.upsert?.some((i) => i.id === hidden.id));
  check(shown?.initiative.entries.length === 3 && shown.initiative.turn === 0, "revealing the token reveals its initiative entry");

  // scenes
  gm.clear();
  alice.clear();
  const scene2 = { ...gmHello.scenes[0], id: "sc" + rid(), name: "Dungeon", order: 1 };
  gm.send({ t: "scene.upsert", scene: scene2, create: true });
  await gm.waitFor((m) => m.t === "scene.upsert" && m.scene.id === scene2.id);
  await sleep(100);
  check(!alice.msgs.some((m) => m.t === "scene.upsert" && m.scene.id === scene2.id), "players don't hear about scenes they aren't on");
  const dungeonToken = { ...base, sceneId: scene2.id, id: "dt" + rid(), x: 35, y: 35, label: "Door", hidden: false };
  gm.items({ upsert: [dungeonToken] });
  await sleep(100);
  check(
    !alice.msgs.some((m) => m.t === "items" && m.upsert?.some((i) => i.id === dungeonToken.id)),
    "players don't get tokens from other scenes",
  );
  gm.send({ t: "scene.activate", id: scene2.id });
  const switched = await alice.waitFor((m) => m.t === "scene.active");
  check(
    switched?.id === scene2.id && switched.scene?.name === "Dungeon" && switched.items.length === 1,
    "switching scenes sends players the new scene and its tokens",
  );

  // Changes carry a seq per browser tab: a copy of one already applied is answered, not applied again.
  const sid = "tab" + rid();
  const tab = connect(room.id, { cookie, uid: "x", name: "GM tab", sid });
  const tabHello = await tab.waitFor((m) => m.t === "hello");
  check(tabHello?.lastSeq === 0 && !("sid" in tabHello.you), "a new tab starts at seq 0, and its tab id isn't shown to anyone");
  check(!tabHello?.players.some((p) => "sid" in p), "the player list doesn't carry tab ids");
  const once = { ...base, sceneId: scene2.id, id: "once" + rid(), x: 35, y: 35, label: "Once", hidden: false };
  tab.send({ t: "items", seq: 1, upsert: [once] });
  await tab.waitFor((m) => m.t === "items" && m.seq === 1);
  tab.clear();
  tab.send({ t: "items", seq: 1, upsert: [{ ...once, x: 999 }] });
  const again = await tab.waitFor((m) => m.t === "items" && m.seq === 1);
  check(again?.upsert?.[0]?.x === 35, "a change sent twice is applied once, and the repeat is answered with the stored copy");
  tab.send({ t: "chat", seq: 2, text: "said once" });
  tab.send({ t: "chat", seq: 2, text: "said once" });
  const ack = await tab.waitFor((m) => m.t === "ack" && m.seq === 2);
  await sleep(200);
  check(Boolean(ack) && tab.msgs.filter((m) => m.t === "chat" && m.message.text === "said once").length === 1, "a chat message resent after a reconnect appears once");
  tab.ws.close();
  const tab2 = connect(room.id, { cookie, uid: "x", name: "GM tab", sid });
  const tab2Hello = await tab2.waitFor((m) => m.t === "hello");
  check(tab2Hello?.lastSeq === 2, "reconnecting, the tab learns which of its changes the server already has");

  // Fog and the scene's cover change together in one message, so players never see the map in between.
  const reveal = { id: "rv" + rid(), sceneId: scene2.id, kind: "fog", z: 0, mode: "reveal", shape: "rect", points: [0, 0, 100, 100] };
  tab2.send({ t: "items", seq: 3, upsert: [reveal] });
  await alice.waitFor((m) => m.t === "items" && m.upsert?.some((i) => i.id === reveal.id));
  alice.clear();
  tab2.send({ t: "items", seq: 4, delete: [reveal.id], scene: { id: scene2.id, fogCover: true } });
  const covered = await alice.waitFor((m) => m.t === "items" && m.delete?.includes(reveal.id));
  check(covered?.scene?.fogCover === true && covered.scene.name === "Dungeon", "players get Cover all's fog and cover in one message");
  alice.clear();
  alice.items({ delete: [dungeonToken.id], scene: { id: scene2.id, fogCover: false } });
  const denied = await alice.waitFor((m) => m.t === "items" && m.seq === alice.seq);
  check(denied?.refused?.includes(dungeonToken.id) && !denied.scene, "a player can't change the scene, and nothing sent with it happens");
  tab2.clear();
  tab2.send({ t: "items", seq: 5, patch: [{ id: once.id, set: { x: 105 } }], scene: { id: "gone" + rid(), fogCover: false } });
  const goneEcho = await tab2.waitFor((m) => m.t === "items" && m.seq === 5);
  check(goneEcho?.refused?.includes(once.id), "item changes tied to a scene that's gone are refused with it");

  // Editing a scene that no longer exists doesn't bring it back; creating one needs create.
  tab2.clear();
  const ghostScene = "gs" + rid();
  tab2.send({ t: "scene.upsert", seq: 6, scene: { id: ghostScene, name: "Ghost" } });
  const noGhost = await tab2.waitFor((m) => m.t === "scene.delete" && m.id === ghostScene);
  check(noGhost?.seq === 6, "an edit to a deleted scene is answered with its deletion");
  tab2.send({ t: "scene.upsert", seq: 7, scene: { id: scene2.id, name: "Dungeon, level 2" } });
  const renamed = await tab2.waitFor((m) => m.t === "scene.upsert" && m.seq === 7);
  check(renamed?.scene.name === "Dungeon, level 2" && renamed.scene.fogCover === true, "a scene edit changes only the settings it names");

  // Uncovering together with fog shapes, one of which is refused: none of it happens.
  alice.clear();
  tab2.clear();
  const good = { ...reveal, id: "ok" + rid() };
  const broken = { ...reveal, id: "bad" + rid(), points: [0, 0] };
  tab2.send({ t: "items", seq: 8, upsert: [good, broken], scene: { id: scene2.id, fogCover: false } });
  const partial = await tab2.waitFor((m) => m.t === "items" && m.seq === 8);
  await sleep(200);
  check(
    partial?.refused?.includes(good.id) && partial.refused.includes(broken.id) && partial.scene?.fogCover === true &&
      !alice.msgs.some((m) => m.t === "items" && (m.scene || m.upsert?.some((i) => i.id === good.id))),
    "a scene change with any part refused changes nothing, and the map stays covered",
  );
  tab2.ws.close();

  // reconnect
  const alice2 = connect(room.id, { uid: "alice" + rid(), name: "Alice again" });
  const hello2 = await alice2.waitFor((m) => m.t === "hello");
  check(
    hello2?.scenes.length === 1 && hello2.items.every((i) => i.sceneId === scene2.id) && hello2.messages.every((m) => !m.private),
    "a late joiner sees only the live scene and public chat",
  );
  alice2.ws.close();

  // deletion
  r = await fetch(`${BASE}/api/rooms/${room.id}`, { method: "DELETE", headers: { Cookie: cookie } });
  check(r.ok, "GM deletes the room");
  await sleep(300);
  check(alice.closeCode === 4410 && gm.closeCode === 4410, "everyone in the room is disconnected with the 'deleted' code");
  r = await fetch(`${BASE}/api/files/${room.id}/${asset.id}`);
  check(r.status === 404, "the room's images are gone from storage");
  const ghost = connect(room.id, { uid: "ghost" + rid(), name: "Ghost" });
  const nf = await ghost.waitFor((m) => m.t === "closed");
  for (let i = 0; i < 50 && ghost.closeCode === null; i++) await sleep(100);
  const ghostOk = nf?.reason === "notfound" && ghost.closeCode === 4404;
  check(ghostOk, "joining a deleted room says not found");
  if (!ghostOk) console.log(`        got message ${JSON.stringify(ghost.msgs)} and close code ${ghost.closeCode}`);

  r = await fetch(`${BASE}/api/rooms`, { headers: { Cookie: cookie } });
  const list = await r.json();
  check(!list.some((x) => x.id === room.id), "the room is gone from the GM's list");

  if (BASE.startsWith("https://")) {
    r = await fetch(BASE.replace(/^https:/, "http:") + "/r/abc", { redirect: "manual" });
    check(r.status === 308 && r.headers.get("location")?.startsWith("https://"), "plain HTTP is sent to HTTPS");
  }
  if (process.env.THROTTLE === "1") {
    const tries = await Promise.all(
      Array.from({ length: 25 }, () =>
        fetch(`${BASE}/api/login`, { method: "POST", body: JSON.stringify({ password: "wrong-" + rid() }) }).then((x) => x.status),
      ),
    );
    const wrong = tries.filter((c) => c === 401).length;
    check(wrong <= 10 && tries.filter((c) => c === 429).length >= 15, `25 guesses at once get at most 10 tries (got ${wrong})`);
  }

  for (const c of [gm, alice, bob, ghost, faker]) {
    try {
      c.ws.close();
    } catch {
      // already closed
    }
  }
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
