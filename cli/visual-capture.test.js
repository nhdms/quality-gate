'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  safeName,
  capturePlan,
  overflowFromMetrics,
  joinUrl,
  DEFAULT_BREAKPOINTS,
} = require('./visual-capture');

test('safeName slugifies a route + width into a stable filename', () => {
  assert.strictEqual(safeName('/auth/login', 375), 'auth_login__375w.png');
  assert.strictEqual(safeName('/', 1280), 'root__1280w.png');
  assert.strictEqual(safeName('https://x.com/a/b', 768), 'a_b__768w.png');
});

test('capturePlan expands routes × default breakpoints', () => {
  const plan = capturePlan(['/auth/login']);
  assert.strictEqual(plan.length, DEFAULT_BREAKPOINTS.length);
  assert.deepStrictEqual(
    plan.map((p) => p.width),
    [375, 768, 1280]
  );
});

test('capturePlan honours custom breakpoints', () => {
  const plan = capturePlan(['/a', '/b'], [320, 1440]);
  assert.strictEqual(plan.length, 4);
});

test('overflowFromMetrics: content wider than viewport (beyond 1px slack)', () => {
  assert.strictEqual(overflowFromMetrics(376, 375), false); // within slack
  assert.strictEqual(overflowFromMetrics(420, 375), true); // table overflow
  assert.strictEqual(overflowFromMetrics(375, 375), false);
});

test('joinUrl composes baseURL + route without doubling slashes', () => {
  assert.strictEqual(joinUrl('http://localhost:3000/', '/auth/login'), 'http://localhost:3000/auth/login');
  assert.strictEqual(joinUrl('http://localhost:3000', 'auth/login'), 'http://localhost:3000/auth/login');
  assert.strictEqual(joinUrl('http://x', 'https://abs/route'), 'https://abs/route');
});
