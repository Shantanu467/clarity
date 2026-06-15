'use strict';
/**
 * Unit tests for pure utility functions in app.js.
 * None of these touch the DOM or timer state.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./setup.js');

// Load once — these functions are stateless
const {
  fmtCountdown, intervalBadgeKind, protoSummary,
  kssGrade, energyGrade, fmtDur
} = loadApp();

// ── fmtCountdown ────────────────────────────────────────────────────────────
describe('fmtCountdown', () => {
  test('0 seconds → 0:00', () => assert.equal(fmtCountdown(0), '0:00'));
  test('30 seconds → 0:30', () => assert.equal(fmtCountdown(30), '0:30'));
  test('59 seconds → 0:59', () => assert.equal(fmtCountdown(59), '0:59'));
  test('60 seconds → 1:00', () => assert.equal(fmtCountdown(60), '1:00'));
  test('90 seconds → 1:30', () => assert.equal(fmtCountdown(90), '1:30'));
  test('3661 seconds → 61:01', () => assert.equal(fmtCountdown(3661), '61:01'));
});

// ── intervalBadgeKind ───────────────────────────────────────────────────────
describe('intervalBadgeKind', () => {
  test('"Work" → work',     () => assert.equal(intervalBadgeKind('Work'), 'work'));
  test('"work" → work',     () => assert.equal(intervalBadgeKind('work'), 'work'));
  test('"Sprint" → work',   () => assert.equal(intervalBadgeKind('Sprint'), 'work'));
  test('"Push" → work',     () => assert.equal(intervalBadgeKind('Push'), 'work'));
  test('"Rest" → rest',     () => assert.equal(intervalBadgeKind('Rest'), 'rest'));
  test('"Break" → rest',    () => assert.equal(intervalBadgeKind('Break'), 'rest'));
  test('"Cool down" → rest',() => assert.equal(intervalBadgeKind('Cool down'), 'rest'));
  test('"recover" → rest',  () => assert.equal(intervalBadgeKind('recover'), 'rest'));
  test('"Hold" → other',    () => assert.equal(intervalBadgeKind('Hold'), 'other'));
  test('"" → other',        () => assert.equal(intervalBadgeKind(''), 'other'));
  test('undefined → other', () => assert.equal(intervalBadgeKind(undefined), 'other'));
});

// ── kssGrade ────────────────────────────────────────────────────────────────
describe('kssGrade (KSS 1–9 → grade 1–5)', () => {
  const cases = [[1,1],[2,1],[3,2],[4,2],[5,3],[6,3],[7,4],[8,4],[9,5]];
  for (const [kss, grade] of cases) {
    test(`KSS ${kss} → grade ${grade}`, () => assert.equal(kssGrade(kss), grade));
  }
});

// ── energyGrade ─────────────────────────────────────────────────────────────
describe('energyGrade (energy 1–5 → grade 5–1)', () => {
  const cases = [[1,5],[2,4],[3,3],[4,2],[5,1]];
  for (const [energy, grade] of cases) {
    test(`energy ${energy} → grade ${grade}`, () => assert.equal(energyGrade(energy), grade));
  }
});

// ── fmtDur ──────────────────────────────────────────────────────────────────
describe('fmtDur (minutes)', () => {
  test('null → —',       () => assert.equal(fmtDur(null), '—'));
  test('0 → 0 min',     () => assert.equal(fmtDur(0), '0 min'));
  test('45 → 45 min',   () => assert.equal(fmtDur(45), '45 min'));
  test('60 → 1h',       () => assert.equal(fmtDur(60), '1h'));
  test('90 → 1h 30m',   () => assert.equal(fmtDur(90), '1h 30m'));
  test('120 → 2h',      () => assert.equal(fmtDur(120), '2h'));
  test('150 → 2h 30m',  () => assert.equal(fmtDur(150), '2h 30m'));
});

// ── protoSummary ─────────────────────────────────────────────────────────────
describe('protoSummary', () => {
  test('3 sets, two intervals', () => {
    const p = { sets: 3, intervals: [{ label: 'Work', seconds: 30 }, { label: 'Rest', seconds: 10 }] };
    assert.equal(protoSummary(p), '3 sets · Work 30s → Rest 10s');
  });
  test('1 set, one interval (singular)', () => {
    const p = { sets: 1, intervals: [{ label: 'Sprint', seconds: 20 }] };
    assert.equal(protoSummary(p), '1 set · Sprint 20s');
  });
  test('5 sets, three intervals', () => {
    const p = { sets: 5, intervals: [
      { label: 'Work', seconds: 40 },
      { label: 'Rest', seconds: 20 },
      { label: 'Hold', seconds: 10 }
    ]};
    assert.equal(protoSummary(p), '5 sets · Work 40s → Rest 20s → Hold 10s');
  });
});
