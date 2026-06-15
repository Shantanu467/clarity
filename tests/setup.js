'use strict';
/**
 * Loads app.js into a sandboxed Node.js VM with a minimal browser-environment
 * mock. Returns the __clarityInternals object exposed by the test harness hook
 * at the bottom of app.js.
 *
 * Pass an optional `initialStorage` object to pre-populate localStorage so you
 * can test persistence across "reloads" by sharing the same storage object
 * between two loadApp() calls.
 */
const vm   = require('vm');
const fs   = require('fs');
const path = require('path');

function makeEl() {
  return {
    appendChild() {},
    addEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    replaceChildren() {},
    style: {},
    children: [],
    textContent: '',
    hidden: false,
    value: '',
    className: '',
    dataset: {},
    offsetWidth: 0
  };
}

function loadApp(initialStorage = {}) {
  // Use the passed object directly so mutations (setItem) are visible to the
  // caller when they later pass the same object to a second loadApp() call.
  const store = initialStorage;

  const ctx = {
    __clarityCaptureInternals: true,
    __clarityInternals: null,
    document: {
      querySelector()         { return makeEl(); },
      querySelectorAll()      { return { forEach() {} }; },
      getElementById()        { return null; },   // updateTimerDOM checks for null — safe
      createElement()         { return makeEl(); },
      createDocumentFragment(){ return { appendChild() {}, replaceChildren() {} }; },
      body: { appendChild() {} },
      addEventListener()      {}
    },
    localStorage: {
      getItem(k)    { return store[k] !== undefined ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); }
    },
    navigator: {},
    AudioContext: null,
    webkitAudioContext: null,
    location: { protocol: 'https:', hostname: 'localhost' },
    URL: { createObjectURL() { return 'blob:mock'; }, revokeObjectURL() {} },
    Blob: class { constructor(p) { this.parts = p; } },
    setTimeout()    {},
    clearTimeout()  {},
    setInterval()   { return 1; },
    clearInterval() {},
    confirm: () => true,
    console
  };
  ctx.window = ctx;

  vm.createContext(ctx);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8'),
    ctx
  );

  if (!ctx.__clarityInternals) {
    throw new Error('app.js did not set __clarityInternals — test harness hook missing');
  }
  return ctx.__clarityInternals;
}

module.exports = { loadApp };
