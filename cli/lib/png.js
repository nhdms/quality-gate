'use strict';

/**
 * Minimal, dependency-free PNG codec for the visual oracle (T2).
 *
 * The gate runs on arbitrary self-hosted runners, so the diff core must not
 * depend on `pngjs`/`pixelmatch`. This decodes the 8-bit, non-interlaced PNGs
 * that Playwright emits (color types 0/2/4/6) and encodes 8-bit RGBA, using
 * only Node's built-in `zlib`. Decoded output is always normalised to RGBA so
 * the comparator works on a single representation.
 */

const zlib = require('zlib');

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// CRC32 (PNG chunks are CRC-protected; zlib.crc32 isn't available on all the
// Node versions our runners may pin, so compute it ourselves).
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const CHANNELS_BY_COLOR_TYPE = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Decode a PNG buffer into a normalised RGBA raster.
 * @param {Buffer} buffer
 * @returns {{width:number,height:number,data:Buffer}} data is width*height*4 RGBA
 */
function decode(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || !buffer.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('not a PNG (bad signature)');
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];

  let off = 8;
  while (off < buffer.length) {
    const len = buffer.readUInt32BE(off);
    const type = buffer.toString('ascii', off + 4, off + 8);
    const data = buffer.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len; // length(4) + type(4) + data + crc(4)
  }

  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth} (need 8)`);
  if (interlace !== 0) throw new Error('interlaced PNG not supported');
  const channels = CHANNELS_BY_COLOR_TYPE[colorType];
  if (!channels || colorType === 3) {
    throw new Error(`unsupported PNG color type ${colorType}`);
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = channels; // bytes per pixel at 8-bit
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart];
    const row = Buffer.from(raw.subarray(rowStart + 1, rowStart + 1 + stride));

    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0; // left
      const b = prev[x]; // up
      const c = x >= bpp ? prev[x - bpp] : 0; // upper-left
      let val = row[x];
      switch (filter) {
        case 0:
          break;
        case 1:
          val = (val + a) & 0xff;
          break;
        case 2:
          val = (val + b) & 0xff;
          break;
        case 3:
          val = (val + ((a + b) >> 1)) & 0xff;
          break;
        case 4:
          val = (val + paeth(a, b, c)) & 0xff;
          break;
        default:
          throw new Error(`unsupported PNG row filter ${filter}`);
      }
      row[x] = val;
    }

    // Expand the scanline into RGBA.
    for (let px = 0; px < width; px++) {
      const o = (y * width + px) * 4;
      const i = px * bpp;
      if (colorType === 6) {
        out[o] = row[i];
        out[o + 1] = row[i + 1];
        out[o + 2] = row[i + 2];
        out[o + 3] = row[i + 3];
      } else if (colorType === 2) {
        out[o] = row[i];
        out[o + 1] = row[i + 1];
        out[o + 2] = row[i + 2];
        out[o + 3] = 255;
      } else if (colorType === 0) {
        out[o] = out[o + 1] = out[o + 2] = row[i];
        out[o + 3] = 255;
      } else if (colorType === 4) {
        out[o] = out[o + 1] = out[o + 2] = row[i];
        out[o + 3] = row[i + 1];
      }
    }
    prev = row;
  }

  return { width, height, data: out };
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * Encode an RGBA raster as an 8-bit PNG (color type 6, filter 0 per row).
 * Used by tests to synthesise fixtures without committing binaries.
 * @param {{width:number,height:number,data:Buffer}} img
 * @returns {Buffer}
 */
function encode(img) {
  const { width, height, data } = img;
  if (data.length !== width * height * 4) {
    throw new Error('encode: data length does not match width*height*4');
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type None
    data.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw);

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { decode, encode, crc32, SIGNATURE };
