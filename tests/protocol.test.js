'use strict';
/**
 * Tests for protocol CRUD (addProtocol, deleteProtocol) and localStorage
 * persistence (DB.read / DB.write). Also verifies that protocols survive an
 * app "reload" by sharing the same storage object between two loadApp() calls.
 */
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./setup.js');

function sampleProto(id = 'p1') {
  return {
    id,
    name: 'Push day',
    intervals: [{ label: 'Work', seconds: 30 }, { label: 'Rest', seconds: 10 }],
    sets: 3
  };
}

// ── DB (localStorage wrapper) ─────────────────────────────────────────────────
describe('DB storage', () => {
  test('read returns fallback for a missing key', () => {
    const { DB } = loadApp();
    assert.equal(DB.read('no.such.key', 'fallback'), 'fallback');
  });

  test('write then read roundtrips a primitive', () => {
    const { DB } = loadApp();
    DB.write('test.num', 42);
    assert.equal(DB.read('test.num', null), 42);
  });

  test('write then read roundtrips an object', () => {
    const { DB } = loadApp();
    DB.write('test.obj', { a: 1, nested: [2, 3] });
    // JSON-stringify both sides: VM-context objects have different prototypes
    // so deepStrictEqual fails even when values are structurally identical.
    assert.equal(
      JSON.stringify(DB.read('test.obj', null)),
      JSON.stringify({ a: 1, nested: [2, 3] })
    );
  });

  test('write null returns null on read (not the fallback)', () => {
    const { DB } = loadApp();
    DB.write('test.null', null);
    assert.equal(DB.read('test.null', 'fallback'), null);
  });

  test('overwriting a key returns the new value', () => {
    const { DB } = loadApp();
    DB.write('test.overwrite', 'first');
    DB.write('test.overwrite', 'second');
    assert.equal(DB.read('test.overwrite', null), 'second');
  });
});

// ── addProtocol ───────────────────────────────────────────────────────────────
describe('addProtocol', () => {
  test('adds the protocol to state.protocols', () => {
    const { addProtocol, state } = loadApp();
    assert.equal(state.protocols.length, 0);
    addProtocol(sampleProto());
    assert.equal(state.protocols.length, 1);
    assert.equal(state.protocols[0].name, 'Push day');
  });

  test('persists to localStorage', () => {
    const storage = {};
    const { addProtocol, DB } = loadApp(storage);
    addProtocol(sampleProto('x1'));
    const saved = DB.read('clarity.protocols', []);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].id, 'x1');
  });

  test('can add multiple protocols', () => {
    const { addProtocol, state } = loadApp();
    addProtocol(sampleProto('a'));
    addProtocol(sampleProto('b'));
    assert.equal(state.protocols.length, 2);
  });
});

// ── deleteProtocol ────────────────────────────────────────────────────────────
describe('deleteProtocol', () => {
  test('removes the matching protocol by id', () => {
    const { addProtocol, deleteProtocol, state } = loadApp();
    addProtocol(sampleProto('del-1'));
    addProtocol(sampleProto('del-2'));
    deleteProtocol('del-1');
    assert.equal(state.protocols.length, 1);
    assert.equal(state.protocols[0].id, 'del-2');
  });

  test('persists deletion to localStorage', () => {
    const storage = {};
    const { addProtocol, deleteProtocol, DB } = loadApp(storage);
    addProtocol(sampleProto('to-delete'));
    deleteProtocol('to-delete');
    const saved = DB.read('clarity.protocols', []);
    assert.equal(saved.length, 0);
  });

  test('no-op when id does not exist', () => {
    const { deleteProtocol, state } = loadApp();
    assert.doesNotThrow(() => deleteProtocol('ghost'));
    assert.equal(state.protocols.length, 0);
  });
});

// ── Persistence across reload ─────────────────────────────────────────────────
describe('persistence across app reload', () => {
  test('protocols added in one session are visible in the next', () => {
    const storage = {};

    const app1 = loadApp(storage);
    app1.addProtocol({ id: 'persist-1', name: 'Tabata', intervals: [{ label: 'Work', seconds: 20 }, { label: 'Rest', seconds: 10 }], sets: 8 });
    app1.addProtocol({ id: 'persist-2', name: 'EMOM',   intervals: [{ label: 'Go',   seconds: 60 }], sets: 10 });

    const app2 = loadApp(storage);
    assert.equal(app2.state.protocols.length, 2);
    assert.equal(app2.state.protocols[0].name, 'Tabata');
    assert.equal(app2.state.protocols[1].name, 'EMOM');
    assert.equal(app2.state.protocols[1].sets, 10);
  });

  test('deletion in one session is reflected in the next', () => {
    const storage = {};
    const app1 = loadApp(storage);
    app1.addProtocol(sampleProto('keep'));
    app1.addProtocol(sampleProto('gone'));
    app1.deleteProtocol('gone');

    const app2 = loadApp(storage);
    assert.equal(app2.state.protocols.length, 1);
    assert.equal(app2.state.protocols[0].id, 'keep');
  });

  test('protocol details (intervals, sets) survive reload', () => {
    const storage = {};
    const p = { id: 'detail-test', name: 'My Protocol', sets: 5, intervals: [{ label: 'Lift', seconds: 45 }, { label: 'Rest', seconds: 15 }] };
    loadApp(storage).addProtocol(p);

    const { state } = loadApp(storage);
    const loaded = state.protocols[0];
    assert.equal(loaded.sets, 5);
    assert.equal(loaded.intervals.length, 2);
    assert.equal(loaded.intervals[0].label, 'Lift');
    assert.equal(loaded.intervals[0].seconds, 45);
    assert.equal(loaded.intervals[1].seconds, 15);
  });
});
