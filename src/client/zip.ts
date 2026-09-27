// Reading zip files made elsewhere (an Owlbear Rodeo backup, say): stored or
// deflate-compressed entries, read one at a time so a big file isn't all unpacked
// in memory at once. Decompression uses the browser's own DecompressionStream.

export interface ZipEntry {
  name: string;
  /** 0: stored, 8: deflate. */
  method: number;
  size: number;
  /** The entry's bytes as stored in the file (compressed, for deflate). */
  raw: Uint8Array;
}

/** The entries of a zip file, by name. Throws if it isn't a zip this can read. */
export function openZip(buf: ArrayBuffer): Map<string, ZipEntry> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const dec = new TextDecoder();
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("isn't a zip file.");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  if (count === 0xffff || p === 0xffffffff) throw new Error("is too big a zip file to read here.");
  const out = new Map<string, ZipEntry>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.byteLength || view.getUint32(p, true) !== 0x02014b50) throw new Error("is a damaged zip file.");
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const compressed = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (flags & 1) throw new Error("is password-protected.");
    if (localOffset + 30 > buf.byteLength || view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error("is a damaged zip file.");
    }
    const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    if (start + compressed > buf.byteLength) throw new Error("is a damaged zip file.");
    out.set(name, { name, method, size, raw: bytes.subarray(start, start + compressed) });
  }
  return out;
}

/** An entry's contents. */
export async function readEntry(e: ZipEntry): Promise<Uint8Array> {
  if (e.method === 0) return e.raw;
  if (e.method !== 8) throw new Error(`${e.name} is compressed in a way this can't read.`);
  const stream = new Blob([e.raw as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readText(e: ZipEntry): Promise<string> {
  return new TextDecoder().decode(await readEntry(e));
}
