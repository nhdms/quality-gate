'use strict';

/**
 * Screenshot capture for the visual oracle (T2).
 *
 * Renders each `visual.routes` entry at each `visual.breakpoints` width with
 * Playwright, writing a full-page PNG per (route × breakpoint) and recording
 * whether the page overflowed its viewport horizontally (the mobile-table
 * regression class). Playwright is loaded lazily so the rest of the gate's
 * pure-Node tooling keeps zero runtime dependencies — the browser only has to
 * exist on the runner when the visual lane actually runs.
 *
 * The pure helpers (plan/naming/overflow) are unit-tested; the Playwright I/O
 * lives behind `captureAll` and the CLI boundary.
 */

const DEFAULT_BREAKPOINTS = [375, 768, 1280];

/** Filesystem-safe stem for a (route, width) pair. */
function safeName(route, width) {
  const slug =
    String(route)
      .replace(/^https?:\/\/[^/]+/i, '')
      .replace(/[^a-z0-9]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase() || 'root';
  return `${slug}__${width}w.png`;
}

/**
 * Expand routes × breakpoints into a capture plan.
 * @param {string[]} routes
 * @param {number[]} [breakpoints]
 * @returns {Array<{route:string,width:number,file:string}>}
 */
function capturePlan(routes, breakpoints) {
  const widths = breakpoints && breakpoints.length ? breakpoints : DEFAULT_BREAKPOINTS;
  const plan = [];
  for (const route of routes || []) {
    for (const width of widths) {
      plan.push({ route, width, file: safeName(route, width) });
    }
  }
  return plan;
}

/** A page overflows when its rendered content is wider than the viewport. */
function overflowFromMetrics(scrollWidth, viewportWidth) {
  // 1px of slack absorbs sub-pixel rounding; anything beyond is real overflow.
  return Number(scrollWidth) > Number(viewportWidth) + 1;
}

/** Join a baseURL and route without doubling or dropping the slash. */
function joinUrl(baseURL, route) {
  if (/^https?:\/\//i.test(route)) return route;
  const b = String(baseURL || '').replace(/\/+$/, '');
  const r = String(route || '');
  return b + (r.startsWith('/') ? r : '/' + r);
}

/**
 * Capture every plan item with Playwright. Lazy-requires `playwright`.
 * @returns {Promise<Array<{route,width,file,path,overflow,error}>>}
 */
async function captureAll({ baseURL, routes, breakpoints, outDir, fs, path }) {
  // eslint-disable-next-line global-require
  const { chromium } = require('playwright');
  fs.mkdirSync(outDir, { recursive: true });

  const plan = capturePlan(routes, breakpoints);
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const item of plan) {
      const url = joinUrl(baseURL, item.route);
      const outPath = path.join(outDir, item.file);
      const context = await browser.newContext({
        viewport: { width: item.width, height: 900 },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      let overflow = false;
      let error = null;
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        const scrollWidth = await page.evaluate(
          () => document.documentElement.scrollWidth
        );
        overflow = overflowFromMetrics(scrollWidth, item.width);
        await page.screenshot({ path: outPath, fullPage: true });
      } catch (err) {
        error = err.message;
      } finally {
        await context.close();
      }
      results.push({ ...item, path: outPath, overflow, error });
    }
  } finally {
    await browser.close();
  }
  return results;
}

module.exports = {
  safeName,
  capturePlan,
  overflowFromMetrics,
  joinUrl,
  captureAll,
  DEFAULT_BREAKPOINTS,
};
