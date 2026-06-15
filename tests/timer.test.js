'use strict';
/**
 * Tests for the timer engine (timerStart / Pause / Resume / Skip / Stop).
 * setInterval is a no-op in the test VM, so ticks don't fire automatically —
 * we drive advancement manually via timerSkip() / timerAdvance().
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./setup.js');

// Helper: a minimal protocol with N intervals of given seconds
function proto(sets, ...intervals) {
  return {
    id: 'test',
    name: 'Test',
    sets,
    intervals: intervals.map(([label, seconds]) => ({ label, seconds }))
  };
}

// ── timerStart ───────────────────────────────────────────────────────────────
describe('timerStart', () => {
  test('sets running state immediately', () => {
    const app = loadApp();
    app.timerStart(proto(3, ['Work', 30], ['Rest', 10]));
    const a = app._timerActive;
    assert.ok(a, '_timerActive should be set');
    assert.equal(a.running, true);
    assert.equal(a.done, false);
    assert.equal(a.setIdx, 0);
    assert.equal(a.intIdx, 0);
    assert.equal(a.msRemaining, null);
    assert.ok(a.endTime > Date.now(), 'endTime should be in the future');
  });

  test('endTime is approximately interval.seconds ahead', () => {
    const app = loadApp();
    const before = Date.now();
    app.timerStart(proto(1, ['Work', 30]));
    const after = Date.now();
    const { endTime } = app._timerActive;
    assert.ok(endTime >= before + 29_900, 'endTime too early');
    assert.ok(endTime <= after + 30_100, 'endTime too far');
  });

  test('restarting replaces an existing active timer', () => {
    const app = loadApp();
    app.timerStart(proto(1, ['Work', 30]));
    app.timerStart(proto(2, ['Sprint', 20], ['Rest', 10]));
    const a = app._timerActive;
    assert.equal(a.protocol.name, 'Test');
    assert.equal(a.protocol.sets, 2);
    assert.equal(a.intIdx, 0);
    assert.equal(a.setIdx, 0);
  });
});

// ── timerPause / timerResume ─────────────────────────────────────────────────
describe('timerPause / timerResume', () => {
  test('pause stops the timer and saves msRemaining', () => {
    const app = loadApp();
    app.timerStart(proto(1, ['Work', 30]));
    app.timerPause();
    const a = app._timerActive;
    assert.equal(a.running, false);
    assert.ok(a.msRemaining != null && a.msRemaining > 0, 'msRemaining should be positive');
    assert.equal(a.endTime, null);
  });

  test('resume after pause restores running and clears msRemaining', () => {
    const app = loadApp();
    app.timerStart(proto(1, ['Work', 30]));
    app.timerPause();
    app.timerResume();
    const a = app._timerActive;
    assert.equal(a.running, true);
    assert.equal(a.msRemaining, null);
    assert.ok(a.endTime > Date.now(), 'endTime should be in the future again');
  });

  test('pause is idempotent when already paused', () => {
    const app = loadApp();
    app.timerStart(proto(1, ['Work', 30]));
    app.timerPause();
    const msR1 = app._timerActive.msRemaining;
    app.timerPause(); // second call — should not change msRemaining significantly
    // running was already false so second pause is a no-op
    assert.equal(app._timerActive.running, false);
  });
});

// ── timerStop ────────────────────────────────────────────────────────────────
describe('timerStop', () => {
  test('clears _timerActive', () => {
    const app = loadApp();
    app.timerStart(proto(1, ['Work', 30]));
    app.timerStop();
    assert.equal(app._timerActive, null);
  });

  test('safe to call when already stopped', () => {
    const app = loadApp();
    assert.doesNotThrow(() => app.timerStop());
  });
});

// ── interval advancement (timerSkip → timerAdvance) ──────────────────────────
describe('interval advancement', () => {
  test('skipping advances intIdx within a set', () => {
    const app = loadApp();
    app.timerStart(proto(1, ['Work', 30], ['Rest', 10], ['Hold', 5]));
    assert.equal(app._timerActive.intIdx, 0);
    app.timerSkip();
    assert.equal(app._timerActive.intIdx, 1);
    app.timerSkip();
    assert.equal(app._timerActive.intIdx, 2);
  });

  test('skipping past last interval rolls over to next set', () => {
    const app = loadApp();
    app.timerStart(proto(3, ['Work', 30], ['Rest', 10]));
    // set 0, interval 0 → skip → set 0, interval 1
    app.timerSkip();
    assert.equal(app._timerActive.setIdx, 0);
    assert.equal(app._timerActive.intIdx, 1);
    // skip → set 1, interval 0
    app.timerSkip();
    assert.equal(app._timerActive.setIdx, 1);
    assert.equal(app._timerActive.intIdx, 0);
  });

  test('completing all sets marks done', () => {
    const app = loadApp();
    app.timerStart(proto(2, ['Work', 20], ['Rest', 10]));
    // 2 sets × 2 intervals = 4 skips to finish
    app.timerSkip(); // set 0 int 1
    app.timerSkip(); // set 1 int 0
    app.timerSkip(); // set 1 int 1
    app.timerSkip(); // done
    const a = app._timerActive;
    assert.equal(a.done, true);
    assert.equal(a.running, false);
  });

  test('single-interval protocol completes after one skip per set', () => {
    const app = loadApp();
    app.timerStart(proto(3, ['Sprint', 20]));
    app.timerSkip(); // set 1
    app.timerSkip(); // set 2
    app.timerSkip(); // done
    assert.equal(app._timerActive.done, true);
  });

  test('endTime updates to new interval duration on advance', () => {
    const app = loadApp();
    app.timerStart(proto(1, ['Work', 30], ['Rest', 10]));
    const before = Date.now();
    app.timerSkip(); // advances to Rest (10s)
    const { endTime } = app._timerActive;
    assert.ok(endTime >= before + 9_900 && endTime <= Date.now() + 10_100,
      'endTime should reflect the Rest interval (10s)');
  });
});

// ── timerSkip on done timer ───────────────────────────────────────────────────
describe('timerSkip safety', () => {
  test('timerSkip does nothing if no timer is active', () => {
    const app = loadApp();
    assert.doesNotThrow(() => app.timerSkip());
    assert.equal(app._timerActive, null);
  });
});
