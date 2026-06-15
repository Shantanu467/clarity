# Clarity — testing workflow

## Run the tests

```bash
node --test tests/unit.test.js tests/timer.test.js tests/protocol.test.js
```

Run this from the `clarity/` directory every time you make a change to `app.js`.

---

## Rule: edit → test → commit

After **every edit** to `app.js`:

1. Make your change.
2. Add or update tests in the relevant test file (see below).
3. Run the test command above and confirm **fail 0**.
4. Then push / deploy.

---

## What's tested and where

| File | Covers |
|---|---|
| `tests/unit.test.js` | Pure functions: `fmtCountdown`, `kssGrade`, `energyGrade`, `fmtDur`, `intervalBadgeKind`, `protoSummary` |
| `tests/timer.test.js` | Timer engine: start, pause, resume, stop, skip, interval advancement, set completion |
| `tests/protocol.test.js` | Protocol CRUD: `addProtocol`, `deleteProtocol`, `DB.read/write`, localStorage persistence across reload |

---

## How the test harness works

`tests/setup.js` loads `app.js` inside a Node.js VM with a minimal browser-environment mock (fake `document`, `localStorage`, `navigator`, etc.). The app's DOM boot is skipped when `window.__clarityCaptureInternals = true`; instead the app exports its internal functions via `window.__clarityInternals`.

This means:
- No browser needed, no build step, no npm.
- Tests run fast (< 200 ms total).
- The same `app.js` that runs in the browser is what gets tested.

---

## When to add new tests

| Change type | What to add |
|---|---|
| New pure utility function | Test in `unit.test.js` |
| New timer behaviour (e.g. new engine state) | Test in `timer.test.js` |
| New data type stored in localStorage | Test in `protocol.test.js` (or a new file) |
| New exported internal (add it to the `_exp` block near the bottom of `app.js`) | Test wherever appropriate |

---

## Exposing new functions for testing

At the bottom of `app.js`, find the `_exp` object inside the `if (window.__clarityCaptureInternals)` block and add the function there. Nothing else needs to change.
