'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { buildManifest, resolveBaseURL } = require('./visual-run');

// Inject a fake fs + compare so the orchestrator's wiring is testable without
// Playwright or real PNGs on disk.
function fakeFs(existing) {
  const set = new Set(existing);
  return { existsSync: (p) => set.has(p) };
}

test('builds a comparison entry when the baseline exists', () => {
  const captures = [{ route: '/auth/login', width: 375, file: 'auth_login__375w.png', path: 'cap/auth_login__375w.png', overflow: false }];
  const baselineDir = 'visual/baseline';
  const fs = fakeFs([path.join(baselineDir, 'auth_login__375w.png')]);
  const compare = () => ({ diffRatio: 0, diffPixels: 0, totalPixels: 100, dimensionMismatch: false });

  const [entry] = buildManifest(captures, baselineDir, { fs, path, compare });
  assert.strictEqual(entry.route, '/auth/login');
  assert.strictEqual(entry.baselineMissing, undefined);
  assert.deepStrictEqual(entry.comparison, { diffRatio: 0, diffPixels: 0, totalPixels: 100, dimensionMismatch: false });
});

test('flags baselineMissing when no approved baseline exists (no auto-baseline)', () => {
  const captures = [{ route: '/x', width: 768, file: 'x__768w.png', path: 'cap/x__768w.png', overflow: false }];
  const fs = fakeFs([]); // baseline dir is empty
  const [entry] = buildManifest(captures, 'visual/baseline', { fs, path });
  assert.strictEqual(entry.baselineMissing, true);
  assert.strictEqual(entry.comparison, null);
});

test('propagates a capture error into the manifest', () => {
  const captures = [{ route: '/x', width: 375, file: 'x__375w.png', path: 'cap/x__375w.png', overflow: false, error: 'net::ERR' }];
  const fs = fakeFs([]);
  const [entry] = buildManifest(captures, 'visual/baseline', { fs, path });
  assert.strictEqual(entry.captureError, 'net::ERR');
});

test('carries the overflow flag through to the manifest', () => {
  const captures = [{ route: '/x', width: 375, file: 'x__375w.png', path: 'cap/x__375w.png', overflow: true }];
  const fs = fakeFs([path.join('visual/baseline', 'x__375w.png')]);
  const compare = () => ({ diffRatio: 0, diffPixels: 0, totalPixels: 1, dimensionMismatch: false });
  const [entry] = buildManifest(captures, 'visual/baseline', { fs, path, compare });
  assert.strictEqual(entry.overflow, true);
});

test('resolveBaseURL: explicit VISUAL_BASE_URL wins over config (per-PR preview)', () => {
  const cfg = { visual: { baseURL: 'http://config-origin:3000' } };
  // The env-supplied preview URL must override a pinned config baseURL.
  assert.strictEqual(
    resolveBaseURL(cfg, { VISUAL_BASE_URL: 'http://preview-pr-42.example.com' }),
    'http://preview-pr-42.example.com'
  );
});

test('resolveBaseURL: falls back to config baseURL when env is unset/empty', () => {
  const cfg = { visual: { baseURL: 'http://config-origin:3000' } };
  assert.strictEqual(resolveBaseURL(cfg, {}), 'http://config-origin:3000');
  assert.strictEqual(resolveBaseURL(cfg, { VISUAL_BASE_URL: '' }), 'http://config-origin:3000');
});

test('resolveBaseURL: defaults to localhost when neither env nor config set', () => {
  assert.strictEqual(resolveBaseURL({}, {}), 'http://localhost:3000');
});

test('records a diff failure as a captureError', () => {
  const captures = [{ route: '/x', width: 375, file: 'x__375w.png', path: 'cap/x__375w.png', overflow: false }];
  const fs = fakeFs([path.join('visual/baseline', 'x__375w.png')]);
  const compare = () => {
    throw new Error('corrupt png');
  };
  const [entry] = buildManifest(captures, 'visual/baseline', { fs, path, compare });
  assert.match(entry.captureError, /diff failed: corrupt png/);
});
