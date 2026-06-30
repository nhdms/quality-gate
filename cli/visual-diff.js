'use strict';

/**
 * Pixel diff core for the visual oracle (T2).
 *
 * Compares a captured screenshot against an approved baseline and reports how
 * far they drift. A per-channel tolerance suppresses sub-perceptual noise (font
 * antialiasing across runners) while still catching a deliberate 1px/color
 * drift. A dimension mismatch is always a hard difference — it usually means a
 * layout regression (e.g. a table overflowing the viewport changed the page
 * height), not noise.
 *
 * Zero runtime dependencies: PNG decoding is done in ./lib/png (built-in zlib).
 */

const fs = require('fs');
const png = require('./lib/png');

/**
 * Compare two decoded RGBA rasters.
 * @param {{width:number,height:number,data:Buffer}} a captured
 * @param {{width:number,height:number,data:Buffer}} b baseline
 * @param {{tolerance?:number}} [opts] per-channel 0-255 tolerance (default 0)
 * @returns {{dimensionMismatch:boolean,diffPixels:number,totalPixels:number,
 *            diffRatio:number,width:number,height:number}}
 */
function compareRasters(a, b, opts = {}) {
  const tolerance = Number.isFinite(opts.tolerance) ? opts.tolerance : 0;

  if (a.width !== b.width || a.height !== b.height) {
    // Compare the overlapping region so the ratio is still meaningful, but flag
    // the mismatch so the verdict treats it as a hard fail.
    const w = Math.min(a.width, b.width);
    const h = Math.min(a.height, b.height);
    const total = Math.max(a.width * a.height, b.width * b.height) || 1;
    let diff = total - w * h; // pixels that exist in only one image always differ
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (pixelDiffers(a, b, x, y, tolerance)) diff++;
      }
    }
    return {
      dimensionMismatch: true,
      diffPixels: diff,
      totalPixels: total,
      diffRatio: diff / total,
      width: a.width,
      height: a.height,
    };
  }

  const total = a.width * a.height || 1;
  let diff = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      if (pixelDiffers(a, b, x, y, tolerance)) diff++;
    }
  }
  return {
    dimensionMismatch: false,
    diffPixels: diff,
    totalPixels: total,
    diffRatio: diff / total,
    width: a.width,
    height: a.height,
  };
}

function pixelDiffers(a, b, x, y, tolerance) {
  const ia = (y * a.width + x) * 4;
  const ib = (y * b.width + x) * 4;
  return (
    Math.abs(a.data[ia] - b.data[ib]) > tolerance ||
    Math.abs(a.data[ia + 1] - b.data[ib + 1]) > tolerance ||
    Math.abs(a.data[ia + 2] - b.data[ib + 2]) > tolerance ||
    Math.abs(a.data[ia + 3] - b.data[ib + 3]) > tolerance
  );
}

/**
 * Compare two PNG files on disk.
 * @param {string} capturedPath
 * @param {string} baselinePath
 * @param {object} [opts]
 */
function compareFiles(capturedPath, baselinePath, opts) {
  const a = png.decode(fs.readFileSync(capturedPath));
  const b = png.decode(fs.readFileSync(baselinePath));
  return compareRasters(a, b, opts);
}

module.exports = { compareRasters, compareFiles, pixelDiffers };
