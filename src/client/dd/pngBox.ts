// The PNG box a sidecar travels in (design 3.3): the server stores only sniffed images, so the
// sidecar's bytes are the pixels of a lossless PNG and nothing is colour-managed.
//
// - Colour type 2 (RGB, 8-bit), PNG_BOX_WIDTH px wide, ceil(bytes / PNG_BOX_ROW_BYTES) rows tall,
//   filter 0 on every row; the pixel bytes, row by row, are the sidecar's bytes, zero-padded at the end.
// - Chunks IHDR, IDAT and IEND only (no gAMA, sRGB, iCCP or cHRM).
// - IDAT is zlib from CompressionStream("deflate"); without it, stored deflate blocks plus Adler-32.
// - Unpacking has one exact path: the signature, IHDR exactly (512 wide, 8-bit, colour type 2, no
//   interlace), the IDAT concatenation, DecompressionStream("deflate"), every filter byte 0. There
//   is no createImageBitmap fallback: a device without DecompressionStream guesses from the picture.

export const PNG_BOX_WIDTH = 512;
/** Sidecar bytes a row (3 a pixel). */
export const PNG_BOX_ROW_BYTES = PNG_BOX_WIDTH * 3;

/** Packs sidecar bytes (header included) into a PNG. */
export async function packPng(payload: Uint8Array): Promise<{ blob: Blob; width: number; height: number }> {
  throw new Error("not implemented: packPng");
}

/**
 * The pixel bytes of a PNG box: the sidecar followed by its zero padding. Anything but the exact
 * layout above throws SidecarError.
 */
export async function unpackPng(png: Blob | Uint8Array): Promise<Uint8Array> {
  throw new Error("not implemented: unpackPng");
}

/** Whether this device can unpack a sidecar (DecompressionStream is there; Safari before 16.4 lacks it). */
export function canUnpack(): boolean {
  return typeof DecompressionStream === "function";
}
