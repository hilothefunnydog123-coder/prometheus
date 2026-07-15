import type { SupportedImageMimeType } from "./analyze-input";

export const MAX_IMAGE_WIDTH = 4096;
export const MAX_IMAGE_HEIGHT = 4096;
export const MAX_IMAGE_PIXELS = 16_000_000;

export type ImageValidationFailure =
  | "invalid-data"
  | "mime-mismatch"
  | "dimensions-too-large";

export type ImageValidationResult =
  | { ok: true; width: number; height: number }
  | { ok: false; reason: ImageValidationFailure };

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function detectedMime(bytes: Uint8Array): SupportedImageMimeType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 3) === "PNG" &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 16 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 4) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function pngDimensions(bytes: Uint8Array): [number, number] | null {
  if (
    bytes.length < 45 ||
    ascii(bytes, 12, 4) !== "IHDR" ||
    ascii(bytes, bytes.length - 8, 4) !== "IEND"
  ) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(8) !== 13 ||
    view.getUint32(bytes.length - 12) !== 0
  ) {
    return null;
  }
  return [view.getUint32(16), view.getUint32(20)];
}

const JPEG_START_OF_FRAME = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
  0xcf,
]);

function jpegDimensions(bytes: Uint8Array): [number, number] | null {
  if (
    bytes.length < 4 ||
    bytes[bytes.length - 2] !== 0xff ||
    bytes[bytes.length - 1] !== 0xd9
  ) {
    return null;
  }
  let offset = 2;
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset++]!;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 1 >= bytes.length) return null;
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length) return null;
    if (JPEG_START_OF_FRAME.has(marker)) {
      if (length < 7) return null;
      const height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!;
      const width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      return [width, height];
    }
    offset += length;
  }
  return null;
}

function uint24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function webpDimensions(bytes: Uint8Array): [number, number] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 20 || view.getUint32(4, true) !== bytes.length - 8) {
    return null;
  }
  const chunk = ascii(bytes, 12, 4);
  if (
    chunk === "VP8X" &&
    bytes.length >= 30 &&
    view.getUint32(16, true) === 10
  ) {
    return [uint24le(bytes, 24) + 1, uint24le(bytes, 27) + 1];
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const b0 = bytes[21]!;
    const b1 = bytes[22]!;
    const b2 = bytes[23]!;
    const b3 = bytes[24]!;
    return [
      1 + (b0 | ((b1 & 0x3f) << 8)),
      1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)),
    ];
  }
  if (
    chunk === "VP8 " &&
    bytes.length >= 30 &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    const width = (bytes[26]! | (bytes[27]! << 8)) & 0x3fff;
    const height = (bytes[28]! | (bytes[29]! << 8)) & 0x3fff;
    return [width, height];
  }
  return null;
}

export function validateImageData(
  bytes: Uint8Array,
  declaredMime: SupportedImageMimeType,
): ImageValidationResult {
  const actualMime = detectedMime(bytes);
  if (actualMime === null) return { ok: false, reason: "invalid-data" };
  if (actualMime !== declaredMime) {
    return { ok: false, reason: "mime-mismatch" };
  }
  const dimensions =
    actualMime === "image/png"
      ? pngDimensions(bytes)
      : actualMime === "image/jpeg"
        ? jpegDimensions(bytes)
        : webpDimensions(bytes);
  if (!dimensions || dimensions[0] <= 0 || dimensions[1] <= 0) {
    return { ok: false, reason: "invalid-data" };
  }
  const [width, height] = dimensions;
  if (
    width > MAX_IMAGE_WIDTH ||
    height > MAX_IMAGE_HEIGHT ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    return { ok: false, reason: "dimensions-too-large" };
  }
  return { ok: true, width, height };
}
