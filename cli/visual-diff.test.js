'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const png = require('./lib/png');
const { compareRasters, compareFiles } = require('./visual-diff');

function solid(width, height, [r, g, b, a = 255]) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { width, height, data };
}

test('identical rasters → zero diff (DoD: unchanged UI is GREEN)', () => {
  const a = solid(20, 20, [128, 128, 128]);
  const b = solid(20, 20, [128, 128, 128]);
  const r = compareRasters(a, b);
  assert.strictEqual(r.diffPixels, 0);
  assert.strictEqual(r.diffRatio, 0);
  assert.strictEqual(r.dimensionMismatch, false);
});

test('a single 1px change → non-zero diff (DoD: 1px drift is RED)', () => {
  const a = solid(20, 20, [128, 128, 128]);
  const b = solid(20, 20, [128, 128, 128]);
  b.data[0] = 129; // one channel of one pixel
  const r = compareRasters(a, b);
  assert.strictEqual(r.diffPixels, 1);
  assert.ok(r.diffRatio > 0);
});

test('a color drift across the image → large diff (DoD: color drift is RED)', () => {
  const a = solid(10, 10, [10, 20, 30]);
  const b = solid(10, 10, [40, 50, 60]);
  const r = compareRasters(a, b);
  assert.strictEqual(r.diffPixels, 100);
});

test('per-channel tolerance suppresses sub-perceptual noise', () => {
  const a = solid(10, 10, [100, 100, 100]);
  const b = solid(10, 10, [102, 100, 100]); // +2 on one channel
  assert.strictEqual(compareRasters(a, b, { tolerance: 0 }).diffPixels, 100);
  assert.strictEqual(compareRasters(a, b, { tolerance: 2 }).diffPixels, 0);
});

test('dimension mismatch is always flagged (overflow/layout regression)', () => {
  const a = solid(30, 20, [0, 0, 0]); // wider — e.g. a table overflowed
  const b = solid(20, 20, [0, 0, 0]);
  const r = compareRasters(a, b);
  assert.strictEqual(r.dimensionMismatch, true);
  assert.ok(r.diffPixels > 0);
});

test('compareFiles decodes PNGs from disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-vdiff-'));
  try {
    const ap = path.join(dir, 'a.png');
    const bp = path.join(dir, 'b.png');
    fs.writeFileSync(ap, png.encode(solid(8, 8, [200, 100, 50])));
    fs.writeFileSync(bp, png.encode(solid(8, 8, [200, 100, 50])));
    assert.strictEqual(compareFiles(ap, bp).diffPixels, 0);

    fs.writeFileSync(bp, png.encode(solid(8, 8, [201, 100, 50])));
    assert.ok(compareFiles(ap, bp).diffPixels > 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
