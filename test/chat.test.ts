// Private messages in the chat (shared/chat.ts): `/w Name message` whispers to one person in the
// room, seen only by the two of them; `/gm message` goes to the GM; and who sees each message.
import { describe, expect, it } from "vitest";
import { canSeeMessage, toGmOf, whisperOf } from "../src/shared/chat";
import type { ChatMessage } from "../src/shared/types";

const GM = { userId: "gm-id", role: "gm" as const };
const ROWAN = { userId: "rowan-id", role: "player" as const };
const TAMSIN = { userId: "tamsin-id", role: "player" as const };
const DISPLAY = { userId: "display-id", role: "player" as const, display: true };

const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: "m1",
  ts: 1,
  userId: ROWAN.userId,
  name: "Rowan",
  color: "#f00",
  role: "player",
  kind: "chat",
  text: "hello",
  ...over,
});

describe("who sees a message", () => {
  it("shows a message aloud to everyone", () => {
    for (const c of [GM, ROWAN, TAMSIN, DISPLAY]) expect(canSeeMessage(msg({}), c)).toBe(true);
  });

  it("shows a whisper only to the two it's between, not the GM, nor a table display", () => {
    const w = msg({ to: { userId: TAMSIN.userId, name: "Tamsin", color: "#0f0", role: "player" } });
    expect(canSeeMessage(w, ROWAN)).toBe(true);
    expect(canSeeMessage(w, TAMSIN)).toBe(true);
    expect(canSeeMessage(w, GM)).toBe(false);
    expect(canSeeMessage(w, DISPLAY)).toBe(false);
    // To the GM: the GM (any of their tabs) and the sender.
    const toGm = msg({ to: { userId: GM.userId, name: "Brannoc", color: "#fa0", role: "gm" } });
    expect(canSeeMessage(toGm, GM)).toBe(true);
    expect(canSeeMessage(toGm, TAMSIN)).toBe(false);
  });

  it("shows a message to the GM (or a private roll) to the GM and its sender only", () => {
    const p = msg({ private: true });
    expect(canSeeMessage(p, GM)).toBe(true);
    expect(canSeeMessage(p, ROWAN)).toBe(true);
    expect(canSeeMessage(p, TAMSIN)).toBe(false);
    // The GM's own: the GM alone.
    const gms = msg({ private: true, userId: GM.userId, role: "gm" });
    expect(canSeeMessage(gms, GM)).toBe(true);
    expect(canSeeMessage(gms, ROWAN)).toBe(false);
  });
});

describe("whispers typed in the chat box", () => {
  const people = [
    { userId: GM.userId, name: "Brannoc" },
    { userId: ROWAN.userId, name: "Rowan" },
    { userId: "sir-id", name: "Sir Aldwyn" },
    { userId: "sir2-id", name: "Sir" },
    { userId: DISPLAY.userId, name: "Table display", display: true },
  ];

  it("whispers to the one named, in any case, with the rest as the message", () => {
    expect(whisperOf("/w brannoc meet me by the well", people, ROWAN.userId)).toEqual({ to: GM.userId, name: "Brannoc", text: "meet me by the well" });
    expect(whisperOf("/whisper Rowan  hi  there ", people, GM.userId)).toEqual({ to: ROWAN.userId, name: "Rowan", text: "hi  there" });
  });

  it("tells a long name from a shorter one it starts with", () => {
    expect(whisperOf("/w Sir Aldwyn the bridge is out", people, ROWAN.userId)).toMatchObject({ to: "sir-id", text: "the bridge is out" });
    expect(whisperOf("/w Sir the bridge is out", people, ROWAN.userId)).toMatchObject({ to: "sir2-id", text: "the bridge is out" });
    // Not a word that only starts with a name.
    expect(whisperOf("/w Rowany hi", people, GM.userId)).toHaveProperty("error");
  });

  it("says why it can't send: nobody of that name, no message, yourself, or a table display", () => {
    expect(whisperOf("/w Bob hi", people, ROWAN.userId)).toEqual({ error: "Nobody called Bob is in the room to whisper to." });
    expect(whisperOf("/w Brannoc", people, ROWAN.userId)).toHaveProperty("error");
    expect(whisperOf("/w", people, ROWAN.userId)).toHaveProperty("error");
    expect(whisperOf("/w Rowan hi", people, ROWAN.userId)).toEqual({ error: "That's you: whisper to someone else." });
    expect(whisperOf("/w Table display hi", people, ROWAN.userId)).toHaveProperty("error");
  });

  it("leaves everything else alone", () => {
    expect(whisperOf("hello all", people, ROWAN.userId)).toBeNull();
    expect(whisperOf("/r 2d6", people, ROWAN.userId)).toBeNull();
    expect(whisperOf("/wave", people, ROWAN.userId)).toBeNull();
  });

  it("reads a message to the GM", () => {
    expect(toGmOf("/gm I pocket the ring")).toBe("I pocket the ring");
    expect(toGmOf("/GM   quietly ")).toBe("quietly");
    expect(toGmOf("/gm")).toBe("");
    expect(toGmOf("/gmail")).toBeNull();
    expect(toGmOf("hello")).toBeNull();
  });
});
