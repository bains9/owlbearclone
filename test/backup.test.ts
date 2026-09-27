import { describe, expect, it } from "vitest";
import { makeZip, readZip } from "../src/client/backup";

describe("backup zip", () => {
  it("round-trips files byte for byte", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255]);
    const json = new TextEncoder().encode(JSON.stringify({ hello: "wörld" }));
    const zip = makeZip([
      { name: "room.json", data: json },
      { name: "files/abc123", data: png },
    ]);
    const files = readZip(await zip.arrayBuffer());
    expect([...files.keys()]).toEqual(["room.json", "files/abc123"]);
    expect(new TextDecoder().decode(files.get("room.json"))).toBe('{"hello":"wörld"}');
    expect([...files.get("files/abc123")!]).toEqual([...png]);
  });
  it("rejects things that aren't zips", () => {
    expect(() => readZip(new TextEncoder().encode("not a zip at all, just text").buffer as ArrayBuffer)).toThrow();
  });
});
