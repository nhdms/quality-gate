'use strict';

const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const png = require('./png');

function solid(width, height, [r, g, b, a]) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { width, height, data };
}

test('encode → decode round-trips an RGBA raster', () => {
  const img = solid(4, 3, [10, 20, 30, 255]);
  img.data[0] = 200; // perturb one channel of one pixel
  const decoded = png.decode(png.encode(img));
  assert.strictEqual(decoded.width, 4);
  assert.strictEqual(decoded.height, 3);
  assert.ok(decoded.data.equals(img.data));
});

test('decodes a color-type-2 (RGB) PNG, filling alpha=255', () => {
  // Build a tiny 2x1 RGB PNG by hand to exercise the non-RGBA path.
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const raw = Buffer.from([0, 1, 2, 3, 4, 5, 6]); // filter byte + 2 RGB pixels
  const idat = zlib.deflateSync(raw);
  const mk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(png.crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const buf = Buffer.concat([
    png.SIGNATURE,
    mk('IHDR', ihdr),
    mk('IDAT', idat),
    mk('IEND', Buffer.alloc(0)),
  ]);
  const d = png.decode(buf);
  assert.deepStrictEqual([...d.data.subarray(0, 4)], [1, 2, 3, 255]);
  assert.deepStrictEqual([...d.data.subarray(4, 8)], [4, 5, 6, 255]);
});

test('rejects a non-PNG buffer', () => {
  assert.throws(() => png.decode(Buffer.from('not a png')), /bad signature/);
});

test('round-trips a larger raster with varied rows (filter handling)', () => {
  const w = 16;
  const h = 16;
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      data[o] = (x * 16) & 0xff;
      data[o + 1] = (y * 16) & 0xff;
      data[o + 2] = (x * y) & 0xff;
      data[o + 3] = 255;
    }
  }
  const decoded = png.decode(png.encode({ width: w, height: h, data }));
  assert.ok(decoded.data.equals(data));
});
