import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_HEIGHT,
  MAX_IMAGE_WIDTH,
  validateImageData,
} from "./image-validation";

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(45);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  bytes.set([0x49, 0x45, 0x4e, 0x44], 37);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function jpeg(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(23);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08]);
  bytes[7] = height >> 8;
  bytes[8] = height & 0xff;
  bytes[9] = width >> 8;
  bytes[10] = width & 0xff;
  bytes.set([0xff, 0xd9], 21);
  return bytes;
}

function webp(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8);
  bytes.set([0x56, 0x50, 0x38, 0x58], 12);
  const write24 = (offset: number, value: number) => {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >> 8) & 0xff;
    bytes[offset + 2] = (value >> 16) & 0xff;
  };
  const view = new DataView(bytes.buffer);
  view.setUint32(4, bytes.length - 8, true);
  view.setUint32(16, 10, true);
  write24(24, width - 1);
  write24(27, height - 1);
  return bytes;
}

describe("validateImageData", () => {
  it.each([
    ["PNG", png(640, 480), "image/png"],
    ["JPEG", jpeg(640, 480), "image/jpeg"],
    ["WebP", webp(640, 480), "image/webp"],
  ] as const)("accepts valid bounded %s headers", (_label, bytes, mime) => {
    expect(validateImageData(bytes, mime)).toEqual({
      ok: true,
      width: 640,
      height: 480,
    });
  });

  it("requires declared MIME to match magic bytes", () => {
    expect(validateImageData(png(32, 32), "image/jpeg")).toEqual({
      ok: false,
      reason: "mime-mismatch",
    });
  });

  it("rejects corrupt or truncated data", () => {
    expect(validateImageData(new Uint8Array([1, 2, 3]), "image/png")).toEqual({
      ok: false,
      reason: "invalid-data",
    });
    expect(validateImageData(png(0, 32), "image/png")).toEqual({
      ok: false,
      reason: "invalid-data",
    });
  });

  it("enforces dimensions and total pixel bounds", () => {
    expect(
      validateImageData(png(MAX_IMAGE_WIDTH + 1, 32), "image/png"),
    ).toEqual({ ok: false, reason: "dimensions-too-large" });
    expect(
      validateImageData(png(4096, MAX_IMAGE_HEIGHT), "image/png"),
    ).toEqual({ ok: false, reason: "dimensions-too-large" });
  });
});
