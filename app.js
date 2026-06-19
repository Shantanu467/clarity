'use strict';
/* ============================================================
   Clarity — local-first cognitive-activeness & meal tracker.
   No frameworks, no dependencies, no network. All data lives
   in localStorage on this device. User text is rendered with
   textContent only (never innerHTML) — see el().
   ============================================================ */
(function () {

  /* ---------------- constants ---------------- */

  // Karolinska Sleepiness Scale (validated, 1=alert .. 9=fighting sleep)
  const KSS = [
    null,
    { n: 1, label: 'Extremely alert' },
    { n: 2, label: 'Very alert' },
    { n: 3, label: 'Alert' },
    { n: 4, label: 'Rather alert' },
    { n: 5, label: 'Neither alert nor sleepy' },
    { n: 6, label: 'Some signs of sleepiness' },
    { n: 7, label: 'Sleepy — no effort to stay awake' },
    { n: 8, label: 'Sleepy — some effort to stay awake' },
    { n: 9, label: 'Very sleepy — fighting sleep' }
  ];

  // Mental energy / focus (1=foggy .. 5=sharp)
  const ENERGY = [
    null,
    { n: 1, label: 'Foggy — can’t focus' },
    { n: 2, label: 'Low — sluggish' },
    { n: 3, label: 'OK — average' },
    { n: 4, label: 'Good — engaged' },
    { n: 5, label: 'Sharp — clear & fast' }
  ];

  const DEFAULT_MEAL_TYPES = [
    'Carb-heavy', 'Sugary / Dessert', 'Balanced', 'Protein-heavy',
    'Light / Salad', 'Fried / Greasy', 'Liquid / Smoothie', 'Other'
  ];
  const SIZES = ['Small', 'Medium', 'Large'];

  // How far back we'll auto-suggest "your last meal" in the check-in.
  const RECENT_MEAL_WINDOW_MIN = 5 * 60;

  const K = {
    meals: 'clarity.meals',
    checkins: 'clarity.checkins',
    settings: 'clarity.settings',
    lastBackup: 'clarity.lastBackup',
    protocols: 'clarity.protocols',  // Timers: interval protocols
    journal: 'clarity.journal',      // Compass: good-time journal entries
    expDone: 'clarity.expDone',      // Compass: { experimentId: true }
    schemaVersion: 3
  };

  /* ---------------- storage ---------------- */

  const DB = {
    read(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    write(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); }
      catch (e) { toast('Storage full — export a backup'); }
    }
  };

  const state = {
    tab: 'track',
    meals: DB.read(K.meals, []),
    checkins: DB.read(K.checkins, []),
    journal: DB.read(K.journal, []),     // good-time journal entries (Compass)
    expDone: DB.read(K.expDone, {}),     // experiments marked done (Compass)
    settings: Object.assign(
      { mealTypes: DEFAULT_MEAL_TYPES.slice(), schemaVersion: K.schemaVersion },
      DB.read(K.settings, {})
    ),
    // transient view state
    draft: null,            // active check-in
    mealForm: null,         // active meal form
    gtjForm: null,          // active good-time journal entry (Compass)
    compassSub: 'journal',  // 'journal' | 'experiments'
    // timers tab
    protocols: DB.read(K.protocols, []),
    timerView: 'list',      // 'list' | 'running' | 'editor'
    protoEdit: null         // protocol being created/edited
  };

  function saveMeals() { DB.write(K.meals, state.meals); }
  function saveCheckins() { DB.write(K.checkins, state.checkins); }
  function saveJournal() { DB.write(K.journal, state.journal); }
  function saveExpDone() { DB.write(K.expDone, state.expDone); }

  /* ---------------- tiny DOM helper (XSS-safe) ---------------- */
  // Renders user-supplied strings via textContent, never innerHTML.
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const key in attrs) {
        const v = attrs[key];
        if (v == null || v === false) continue;
        if (key === 'class') node.className = v;
        else if (key === 'text') node.textContent = v;
        else if (key === 'html') { /* intentionally unsupported */ }
        else if (key === 'dataset') Object.assign(node.dataset, v);
        else if (key.slice(0, 2) === 'on' && typeof v === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), v);
        } else node.setAttribute(key, v === true ? '' : v);
      }
    }
    const kids = children == null ? [] : (Array.isArray(children) ? children : [children]);
    for (const c of kids) {
      if (c == null || c === false) continue;
      node.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    }
    return node;
  }
  const $ = (sel) => document.querySelector(sel);

  /* ---------------- time / format utils ---------------- */
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function nowISO() { return new Date().toISOString(); }
  function minutesAgoISO(min) { return new Date(Date.now() - min * 60000).toISOString(); }
  function isoToLocalInput(iso) {
    // returns value usable by <input type=datetime-local> in local time
    const d = new Date(iso);
    const off = d.getTimezoneOffset() * 60000;
    return new Date(d - off).toISOString().slice(0, 16);
  }
  function localInputToISO(val) { return new Date(val).toISOString(); }

  function fmtClock(iso) {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  function fmtDay(iso) {
    const d = new Date(iso), t = new Date();
    const sameDay = d.toDateString() === t.toDateString();
    const yest = new Date(t.getTime() - 86400000).toDateString() === d.toDateString();
    if (sameDay) return 'Today';
    if (yest) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  function relFromNow(iso) {
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60), rm = m % 60;
    return rm ? `${h}h ${rm}m ago` : `${h}h ago`;
  }
  function fmtDur(min) {
    if (min == null) return '—';
    if (min < 60) return min + ' min';
    const h = Math.floor(min / 60), rm = min % 60;
    return rm ? `${h}h ${rm}m` : `${h}h`;
  }

  /* ---------------- "how long ago" picker ---------------- */
  // Quick buttons + a minutes-ago slider. Calls onSet(iso) on every change.
  // Updates its own DOM in place (no full re-render) so the slider stays smooth.
  function timeAgoPicker(initialISO, onSet) {
    const QUICK = [['Just now', 0], ['30m', 30], ['1h', 60], ['1h 30m', 90], ['2h', 120], ['3h', 180]];
    const MAX = 360; // 6 hours, step 5 min
    let minutes = Math.min(MAX, Math.max(0, Math.round((Date.now() - new Date(initialISO).getTime()) / 60000)));

    const wrap = el('div', { class: 'tap' });
    const chips = el('div', { class: 'chips' });
    const slider = el('input', { type: 'range', min: '0', max: String(MAX), step: '5', value: String(minutes), class: 'tap__slider', 'aria-label': 'Minutes ago' });
    const label = el('div', { class: 'tap__label' });

    function labelText(iso) {
      return minutes === 0 ? 'Just now' : `${fmtDur(minutes)} ago · ate ${fmtClock(iso)}`;
    }
    function apply(m, src) {
      minutes = Math.min(MAX, Math.max(0, m));
      const iso = minutes === 0 ? nowISO() : minutesAgoISO(minutes);
      onSet(iso);
      if (src !== 'slider') slider.value = String(minutes);
      label.textContent = labelText(iso);
      for (const c of chips.children) c.classList.toggle('chip--on', Number(c.dataset.min) === minutes);
    }

    QUICK.forEach(([txt, m]) => {
      chips.appendChild(el('button', { class: 'chip', type: 'button', dataset: { min: String(m) }, onclick: () => apply(m, 'chip') }, txt));
    });
    slider.addEventListener('input', () => apply(Number(slider.value), 'slider'));

    wrap.appendChild(chips);
    wrap.appendChild(slider);
    wrap.appendChild(label);
    apply(minutes, 'init');
    return wrap;
  }

  /* ---------------- color grading ---------------- */
  // KSS 1..9 -> grade 1..5 (good->bad)
  function kssGrade(n) { return Math.min(5, Math.ceil(n / 2)); }
  // energy 1..5 -> grade 1..5 (good->bad): invert (5 good)
  function energyGrade(n) { return 6 - n; }
  function gradeClass(g) {
    return ['', 'good', 'okgood', 'mid', 'okbad', 'bad'][g] || 'mid';
  }

  /* ---------------- toast ---------------- */
  let toastTimer = null;
  function toast(msg) {
    let t = $('#toast');
    if (!t) { t = el('div', { id: 'toast', class: 'toast' }); document.body.appendChild(t); }
    t.textContent = msg;
    // force reflow then show
    void t.offsetWidth;
    t.classList.add('toast--show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('toast--show'), 1900);
  }

  /* ============================================================
     MEAL helpers
     ============================================================ */
  function addMeal(m) {
    const meal = Object.assign({ id: uid() }, m);
    state.meals.push(meal);
    state.meals.sort((a, b) => new Date(b.eatenAt) - new Date(a.eatenAt));
    saveMeals();
    return meal;
  }
  function deleteMeal(id) {
    state.meals = state.meals.filter(m => m.id !== id);
    saveMeals();
  }
  function findMeal(id) { return state.meals.find(m => m.id === id) || null; }
  function mostRecentMealWithin(min) {
    const cutoff = Date.now() - min * 60000;
    let best = null;
    for (const m of state.meals) {
      const t = new Date(m.eatenAt).getTime();
      if (t >= cutoff && (!best || t > new Date(best.eatenAt).getTime())) best = m;
    }
    return best;
  }

  /* ============================================================
     CHECK-IN persistence
     ============================================================ */
  function saveCheckinFromDraft(d) {
    let mealId = null, mealSnapshot = null, eatenAt = null;
    if (d.mealMode === 'existing' && d.mealId) {
      const m = findMeal(d.mealId);
      if (m) { mealId = m.id; eatenAt = m.eatenAt; mealSnapshot = { type: m.type, size: m.size, eatenAt: m.eatenAt }; }
    } else if (d.mealMode === 'inline' && d.inline && d.inline.type) {
      // Persist inline meal as a real meal record too (single source of truth).
      const m = addMeal({ eatenAt: d.inline.eatenAt, type: d.inline.type, size: d.inline.size || 'Medium' });
      mealId = m.id; eatenAt = m.eatenAt; mealSnapshot = { type: m.type, size: m.size, eatenAt: m.eatenAt };
    }
    const feltAt = d.feltAt || nowISO();
    const minutesSinceMeal = eatenAt
      ? Math.max(0, Math.round((new Date(feltAt) - new Date(eatenAt)) / 60000))
      : null;

    const rec = {
      id: uid(),
      createdAt: nowISO(),
      feltAt: feltAt,
      kss: d.kss,
      energy: d.energy,
      mealId: mealId,
      mealSnapshot: mealSnapshot,
      minutesSinceMeal: minutesSinceMeal,
      caffeineSinceMeal: (d.caffeine == null ? null : !!d.caffeine),
      note: (d.note || '').trim() || null
    };
    state.checkins.push(rec);
    state.checkins.sort((a, b) => new Date(b.feltAt) - new Date(a.feltAt));
    saveCheckins();
    return rec;
  }

  /* ============================================================
     BACKUP / EXPORT / IMPORT
     ============================================================ */
  function unbackedCount() {
    const last = DB.read(K.lastBackup, null);
    if (!last) return state.checkins.length + state.meals.length + state.journal.length;
    const t = new Date(last).getTime();
    const newCk = state.checkins.filter(c => new Date(c.createdAt).getTime() > t).length;
    const newMl = state.meals.filter(m => new Date(m.eatenAt).getTime() > t).length;
    const newJr = state.journal.filter(e => new Date(e.at).getTime() > t).length;
    return newCk + newMl + newJr;
  }
  function markBackedUp() { DB.write(K.lastBackup, nowISO()); }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  }

  function exportJSON() {
    const payload = {
      app: 'clarity', schemaVersion: K.schemaVersion, exportedAt: nowISO(),
      meals: state.meals, checkins: state.checkins,
      journal: state.journal, expDone: state.expDone, settings: state.settings
    };
    download(`clarity-backup-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(payload, null, 2), 'application/json');
    markBackedUp();
    renderBanner();
    toast('Backup saved — share to Files/iCloud');
  }

  function csvCell(v) {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCSV() {
    const cols = ['timestamp', 'date', 'hour', 'kss', 'kss_label', 'energy', 'energy_label',
      'felt_at', 'meal_time', 'meal_type', 'meal_size', 'minutes_since_meal', 'caffeine', 'note'];
    const lines = [cols.join(',')];
    // chronological for analysis
    const rows = state.checkins.slice().sort((a, b) => new Date(a.feltAt) - new Date(b.feltAt));
    for (const c of rows) {
      const snap = c.mealSnapshot || {};
      const d = new Date(c.feltAt);
      lines.push([
        c.feltAt,
        d.toLocaleDateString('en-CA'),
        d.getHours(),
        c.kss, KSS[c.kss] ? KSS[c.kss].label : '',
        c.energy, ENERGY[c.energy] ? ENERGY[c.energy].label : '',
        c.feltAt,
        snap.eatenAt || '',
        snap.type || '',
        snap.size || '',
        c.minutesSinceMeal == null ? '' : c.minutesSinceMeal,
        c.caffeineSinceMeal == null ? '' : (c.caffeineSinceMeal ? 'yes' : 'no'),
        c.note || ''
      ].map(csvCell).join(','));
    }
    download(`clarity-checkins-${new Date().toISOString().slice(0, 10)}.csv`,
      lines.join('\n'), 'text/csv');
    toast('CSV exported');
  }

  function importJSONFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.meals) || !Array.isArray(data.checkins)) {
          toast('Not a valid Clarity backup'); return;
        }
        if (!confirm('Replace all current data with this backup? This cannot be undone.')) return;
        state.meals = data.meals;
        state.checkins = data.checkins;
        if (data.settings && Array.isArray(data.settings.mealTypes)) {
          state.settings = Object.assign(state.settings, { mealTypes: data.settings.mealTypes });
          DB.write(K.settings, state.settings);
        }
        if (Array.isArray(data.journal)) { state.journal = data.journal; saveJournal(); }
        if (data.expDone && typeof data.expDone === 'object') { state.expDone = data.expDone; saveExpDone(); }
        saveMeals(); saveCheckins();
        markBackedUp();
        toast('Backup restored');
        render();
      } catch (e) { toast('Could not read that file'); }
    };
    reader.readAsText(file);
  }

  /* ============================================================
     RENDER: shell, banner, tabs
     ============================================================ */
  function setTab(tab) {
    state.tab = tab;
    state.draft = null;
    state.mealForm = null;
    state.gtjForm = null;
    if (tab === 'timers' && _timerActive && !_timerActive.done && state.timerView !== 'editor') {
      state.timerView = 'running';
    }
    render();
  }

  function renderTabs() {
    document.querySelectorAll('.tab').forEach(btn => {
      btn.classList.toggle('tab--on', btn.dataset.tab === state.tab);
    });
  }

  function renderBanner() {
    const banner = $('#backup-banner');
    const n = unbackedCount();
    if (n >= 12) {
      banner.hidden = false;
      banner.replaceChildren(
        el('span', { text: `${n} entries not yet backed up` }),
        el('button', { type: 'button', text: 'Back up', onclick: exportJSON })
      );
    } else {
      banner.hidden = true;
      banner.replaceChildren();
    }
  }

  function render() {
    renderTabs();
    renderBanner();
    const root = $('#app');
    root.replaceChildren();
    if (state.tab === 'track') root.appendChild(state.draft ? viewStepper() : viewTrackHome());
    else if (state.tab === 'meals') root.appendChild(viewMeals());
    else if (state.tab === 'insights') root.appendChild(viewInsights());
    else if (state.tab === 'timers') {
      if (state.timerView === 'running') root.appendChild(viewActiveTimer());
      else if (state.timerView === 'editor') root.appendChild(viewProtocolEditor());
      else root.appendChild(viewTimers());
    }
    else if (state.tab === 'compass') root.appendChild(viewCompass());
    root.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  /* ============================================================
     VIEW: Track home
     ============================================================ */
  function viewTrackHome() {
    const todayCount = state.checkins.filter(c => fmtDay(c.feltAt) === 'Today').length;
    const last = state.checkins[0];

    const frag = document.createDocumentFragment();
    frag.appendChild(el('h1', { class: 'h1', text: 'How alert are you?' }));
    frag.appendChild(el('p', { class: 'sub', text: 'A quick check-in. Takes a few taps.' }));

    frag.appendChild(el('button', {
      class: 'btn btn--primary btn--lg', type: 'button',
      onclick: startCheckin
    }, '＋  Start check-in'));

    if (last) {
      frag.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'row__meta', text: 'Last check-in' }),
        el('div', { class: 'row', }, [
          pillFor('kss', last.kss),
          el('div', { class: 'row__main' }, [
            el('div', { class: 'row__title', text: `${KSS[last.kss].label}` }),
            el('div', { class: 'row__meta', text:
              `${fmtDay(last.feltAt)} ${fmtClock(last.feltAt)} · energy ${last.energy}/5` +
              (last.minutesSinceMeal != null ? ` · ${fmtDur(last.minutesSinceMeal)} after eating` : '') })
          ])
        ])
      ]));
    }

    frag.appendChild(el('p', { class: 'muted center', text:
      todayCount ? `${todayCount} check-in${todayCount > 1 ? 's' : ''} today` : 'No check-ins yet today' }));
    return frag;
  }

  function pillFor(kind, n) {
    const g = kind === 'kss' ? kssGrade(n) : energyGrade(n);
    return el('span', { class: 'pill pill--' + gradeClass(g), text: String(n) });
  }

  /* ============================================================
     CHECK-IN stepper
     ============================================================ */
  const STEPS = ['kss', 'energy', 'felt', 'meal', 'more'];

  function startCheckin() {
    state.draft = { step: 0, kss: null, energy: null, feltAt: nowISO(), mealMode: null, mealId: null, inline: null, caffeine: null, note: '' };
    render();
  }
  function cancelCheckin() { state.draft = null; render(); }
  function gotoStep(i) { state.draft.step = Math.max(0, Math.min(STEPS.length - 1, i)); render(); }

  function viewStepper() {
    const d = state.draft;
    const step = STEPS[d.step];
    const frag = document.createDocumentFragment();

    // header: progress + cancel
    const progress = el('div', { class: 'progress' });
    STEPS.forEach((_, i) => progress.appendChild(el('div', { class: 'progress__dot' + (i <= d.step ? ' progress__dot--on' : '') })));

    frag.appendChild(el('div', { class: 'stepper__head' }, [
      el('span', { class: 'step__count', text: `Step ${d.step + 1} of ${STEPS.length}` }),
      el('button', { class: 'btn btn--ghost', type: 'button', style: 'flex:0 0 auto;width:auto;min-height:40px;padding:0 14px', onclick: cancelCheckin, text: 'Cancel' })
    ]));
    frag.appendChild(progress);

    if (step === 'kss') frag.appendChild(stepKSS(d));
    else if (step === 'energy') frag.appendChild(stepEnergy(d));
    else if (step === 'felt') frag.appendChild(stepFelt(d));
    else if (step === 'meal') frag.appendChild(stepMeal(d));
    else if (step === 'more') frag.appendChild(stepMore(d));

    // back button (not on first step)
    if (d.step > 0) {
      frag.appendChild(el('button', { class: 'btn btn--ghost', type: 'button', style: 'margin-top:14px', onclick: () => gotoStep(d.step - 1), text: '‹ Back' }));
    }
    return frag;
  }

  function stepKSS(d) {
    const wrap = el('div', {});
    wrap.appendChild(el('div', { class: 'step__q', text: 'Right now, how sleepy or alert do you feel?' }));
    const scale = el('div', { class: 'scale' });
    for (let i = 1; i <= 9; i++) {
      const item = KSS[i];
      scale.appendChild(el('button', {
        class: 'scale__btn', type: 'button', dataset: { grade: String(kssGrade(i)) },
        onclick: () => { d.kss = i; gotoStep(d.step + 1); }
      }, [
        el('span', { class: 'scale__num', text: String(i) }),
        el('span', { class: 'scale__label', text: item.label })
      ]));
    }
    wrap.appendChild(scale);
    wrap.appendChild(el('p', { class: 'muted', style: 'font-size:13px;margin-top:12px', text: 'Karolinska Sleepiness Scale — a validated 1–9 measure of momentary sleepiness.' }));
    return wrap;
  }

  function stepEnergy(d) {
    const wrap = el('div', {});
    wrap.appendChild(el('div', { class: 'step__q', text: 'And your mental energy / focus?' }));
    const scale = el('div', { class: 'scale' });
    for (let i = 1; i <= 5; i++) {
      scale.appendChild(el('button', {
        class: 'scale__btn', type: 'button', dataset: { grade: String(energyGrade(i)) },
        onclick: () => { d.energy = i; gotoStep(d.step + 1); }
      }, [
        el('span', { class: 'scale__num', text: String(i) }),
        el('span', { class: 'scale__label', text: ENERGY[i].label })
      ]));
    }
    wrap.appendChild(scale);
    return wrap;
  }

  function stepFelt(d) {
    const wrap = el('div', {});
    wrap.appendChild(el('div', { class: 'step__q', text: 'When did you feel this?' }));
    const opts = [['Now', 0], ['15m ago', 15], ['30m ago', 30], ['1h ago', 60]];
    const chips = el('div', { class: 'chips' });
    opts.forEach(([label, min]) => {
      chips.appendChild(el('button', {
        class: 'chip', type: 'button',
        onclick: () => { d.feltAt = min === 0 ? nowISO() : minutesAgoISO(min); gotoStep(d.step + 1); }
      }, label));
    });
    wrap.appendChild(chips);

    // custom time
    wrap.appendChild(el('div', { class: 'field', style: 'margin-top:18px' }, [
      el('label', { class: 'field__label', text: 'Or pick a time' }),
      (function () {
        const input = el('input', { type: 'datetime-local', value: isoToLocalInput(d.feltAt) });
        input.addEventListener('change', () => { if (input.value) d.feltAt = localInputToISO(input.value); });
        return input;
      })(),
      el('button', { class: 'btn', type: 'button', style: 'margin-top:10px', onclick: () => gotoStep(d.step + 1), text: 'Use this time ›' })
    ]));
    return wrap;
  }

  function stepMeal(d) {
    const wrap = el('div', {});
    wrap.appendChild(el('div', { class: 'step__q', text: 'What did you eat last?' }));

    const recent = mostRecentMealWithin(RECENT_MEAL_WINDOW_MIN);
    if (recent && (d.mealMode == null || d.mealMode === 'existing')) {
      // Auto-use the most recent logged meal (changeable).
      if (d.mealMode == null) { d.mealMode = 'existing'; d.mealId = recent.id; }
      const chosen = findMeal(d.mealId) || recent;
      wrap.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'row__meta', text: '✓ Using your last logged meal' }),
        el('div', { class: 'row__title', style: 'margin-top:2px', text: `${chosen.type}${chosen.size ? ' · ' + chosen.size : ''}` }),
        el('div', { class: 'row__meta', text: `${fmtClock(chosen.eatenAt)} · ${relFromNow(chosen.eatenAt)}` }),
        el('div', { class: 'btn-row', style: 'margin-top:14px' }, [
          el('button', { class: 'btn btn--primary', type: 'button', onclick: () => gotoStep(d.step + 1), text: 'Continue ›' }),
          el('button', { class: 'btn', type: 'button', onclick: () => { d.mealMode = 'inline'; d.mealId = null; d.inline = { type: null, size: 'Medium', eatenAt: minutesAgoISO(60) }; render(); }, text: 'Different meal' })
        ]),
        el('button', { class: 'btn btn--ghost', type: 'button', style: 'margin-top:10px', onclick: () => { d.mealMode = 'none'; d.mealId = null; gotoStep(d.step + 1); }, text: 'Haven’t eaten recently' })
      ]));
      return wrap;
    }

    // inline meal entry (fallback or "something else")
    d.inline = d.inline || { type: null, size: 'Medium', eatenAt: minutesAgoISO(60) };

    wrap.appendChild(el('label', { class: 'field__label', text: 'Type' }));
    const typeChips = el('div', { class: 'chips' });
    state.settings.mealTypes.forEach(t => {
      typeChips.appendChild(el('button', {
        class: 'chip' + (d.inline.type === t ? ' chip--on' : ''), type: 'button',
        onclick: () => { d.inline.type = t; render(); }
      }, t));
    });
    wrap.appendChild(typeChips);

    wrap.appendChild(el('label', { class: 'field__label', style: 'margin-top:16px', text: 'Size' }));
    const sizeChips = el('div', { class: 'chips' });
    SIZES.forEach(s => {
      sizeChips.appendChild(el('button', {
        class: 'chip' + (d.inline.size === s ? ' chip--on' : ''), type: 'button',
        onclick: () => { d.inline.size = s; render(); }
      }, s));
    });
    wrap.appendChild(sizeChips);

    wrap.appendChild(el('label', { class: 'field__label', style: 'margin-top:16px', text: 'When did you eat?' }));
    wrap.appendChild(timeAgoPicker(d.inline.eatenAt, (iso) => { d.inline.eatenAt = iso; }));

    wrap.appendChild(el('button', {
      class: 'btn btn--primary', type: 'button', style: 'margin-top:18px',
      onclick: () => {
        if (!d.inline.type) { toast('Pick a meal type first'); return; }
        d.mealMode = 'inline'; gotoStep(d.step + 1);
      }, text: 'Continue ›'
    }));
    wrap.appendChild(el('button', { class: 'btn btn--ghost', type: 'button', style: 'margin-top:10px', onclick: () => { d.mealMode = 'none'; d.inline = null; gotoStep(d.step + 1); }, text: 'Skip — haven’t eaten' }));
    return wrap;
  }

  function stepMore(d) {
    const wrap = el('div', {});
    wrap.appendChild(el('div', { class: 'step__q', text: 'Anything else? (optional)' }));

    wrap.appendChild(el('label', { class: 'field__label', text: 'Caffeine since that meal?' }));
    const caf = el('div', { class: 'chips' });
    [['Yes', true], ['No', false]].forEach(([label, val]) => {
      caf.appendChild(el('button', {
        class: 'chip' + (d.caffeine === val ? ' chip--on' : ''), type: 'button',
        onclick: () => { d.caffeine = (d.caffeine === val ? null : val); render(); }
      }, label));
    });
    wrap.appendChild(caf);

    wrap.appendChild(el('div', { class: 'field', style: 'margin-top:16px' }, [
      el('label', { class: 'field__label', text: 'Note' }),
      (function () {
        const ta = el('textarea', { placeholder: 'e.g. big lunch, poor sleep last night…' });
        ta.value = d.note || '';
        ta.addEventListener('input', () => { d.note = ta.value; });
        return ta;
      })()
    ]));

    wrap.appendChild(el('button', {
      class: 'btn btn--primary btn--lg', type: 'button', style: 'margin-top:8px',
      onclick: () => {
        const rec = saveCheckinFromDraft(d);
        state.draft = null;
        renderBanner();
        render();
        toast(rec.minutesSinceMeal != null ? `Saved · ${fmtDur(rec.minutesSinceMeal)} after eating` : 'Check-in saved');
      }, text: '✓  Save check-in'
    }));
    return wrap;
  }

  /* ============================================================
     VIEW: Meals
     ============================================================ */
  function viewMeals() {
    const frag = document.createDocumentFragment();
    frag.appendChild(el('h1', { class: 'h1', text: 'Meals' }));
    frag.appendChild(el('p', { class: 'sub', text: 'Log what you eat so check-ins know your timing.' }));

    if (state.mealForm) {
      frag.appendChild(mealFormCard());
    } else {
      frag.appendChild(el('button', { class: 'btn btn--primary btn--lg', type: 'button', onclick: () => { state.mealForm = { type: null, size: 'Medium', eatenAt: nowISO(), items: '' }; render(); }, text: '＋  Log a meal' }));
    }

    frag.appendChild(el('h2', { class: 'h2', text: 'Recent' }));
    if (!state.meals.length) {
      frag.appendChild(emptyState('🍽', 'No meals logged yet'));
    } else {
      const list = el('div', { class: 'list' });
      state.meals.slice(0, 40).forEach(m => {
        list.appendChild(el('div', { class: 'row' }, [
          el('div', { class: 'row__main' }, [
            el('div', { class: 'row__title', text: `${m.type}${m.size ? ' · ' + m.size : ''}` }),
            el('div', { class: 'row__meta', text: `${fmtDay(m.eatenAt)} ${fmtClock(m.eatenAt)}` + (m.items ? ' · ' + m.items : '') })
          ]),
          el('button', { class: 'row__del', type: 'button', 'aria-label': 'Delete meal', onclick: () => { if (confirm('Delete this meal?')) { deleteMeal(m.id); render(); } }, text: '🗑' })
        ]));
      });
      frag.appendChild(list);
    }
    return frag;
  }

  function mealFormCard() {
    const f = state.mealForm;
    const card = el('div', { class: 'card card--pad-lg' });

    card.appendChild(el('label', { class: 'field__label', text: 'Type' }));
    const typeChips = el('div', { class: 'chips' });
    state.settings.mealTypes.forEach(t => {
      typeChips.appendChild(el('button', { class: 'chip' + (f.type === t ? ' chip--on' : ''), type: 'button', onclick: () => { f.type = t; render(); } }, t));
    });
    card.appendChild(typeChips);

    card.appendChild(el('label', { class: 'field__label', style: 'margin-top:16px', text: 'Size' }));
    const sizeChips = el('div', { class: 'chips' });
    SIZES.forEach(s => sizeChips.appendChild(el('button', { class: 'chip' + (f.size === s ? ' chip--on' : ''), type: 'button', onclick: () => { f.size = s; render(); } }, s)));
    card.appendChild(sizeChips);

    card.appendChild(el('div', { class: 'field', style: 'margin-top:16px' }, [
      el('label', { class: 'field__label', text: 'When did you eat?' }),
      timeAgoPicker(f.eatenAt, (iso) => { f.eatenAt = iso; })
    ]));

    card.appendChild(el('div', { class: 'field' }, [
      el('label', { class: 'field__label', text: 'Items (optional)' }),
      (function () {
        const input = el('input', { type: 'text', placeholder: 'e.g. rice, dal, salad' });
        input.value = f.items || '';
        input.addEventListener('input', () => { f.items = input.value; });
        return input;
      })()
    ]));

    card.appendChild(el('div', { class: 'btn-row', style: 'margin-top:8px' }, [
      el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => { state.mealForm = null; render(); }, text: 'Cancel' }),
      el('button', {
        class: 'btn btn--primary', type: 'button', onclick: () => {
          if (!f.type) { toast('Pick a meal type'); return; }
          addMeal({ eatenAt: f.eatenAt, type: f.type, size: f.size, items: (f.items || '').trim() || null });
          state.mealForm = null;
          renderBanner();
          render();
          toast('Meal logged');
        }, text: 'Save meal'
      })
    ]));
    return card;
  }

  /* ============================================================
     VIEW: Insights
     ============================================================ */
  function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }

  function viewInsights() {
    const frag = document.createDocumentFragment();
    frag.appendChild(el('h1', { class: 'h1', text: 'Insights' }));
    frag.appendChild(el('p', { class: 'sub', text: 'Patterns from your check-ins. Data stays on this device.' }));

    const cks = state.checkins;
    if (!cks.length) {
      frag.appendChild(emptyState('📈', 'No check-ins yet — patterns appear here'));
      frag.appendChild(dataTools());
      return frag;
    }

    // --- KSS by minutes-since-meal bucket ---
    const buckets = [
      { label: '0–30 min', lo: 0, hi: 30 },
      { label: '30–60 min', lo: 30, hi: 60 },
      { label: '60–90 min', lo: 60, hi: 90 },
      { label: '90–120 min', lo: 90, hi: 120 },
      { label: '120+ min', lo: 120, hi: Infinity }
    ];
    const withMeal = cks.filter(c => c.minutesSinceMeal != null);
    frag.appendChild(el('h2', { class: 'h2', text: 'Sleepiness after eating' }));
    if (!withMeal.length) {
      frag.appendChild(el('p', { class: 'muted', text: 'Log meals with your check-ins to see this.' }));
    } else {
      const wrap = el('div', { class: 'card' });
      buckets.forEach(b => {
        const vals = withMeal.filter(c => c.minutesSinceMeal >= b.lo && c.minutesSinceMeal < b.hi).map(c => c.kss);
        wrap.appendChild(barRow(b.label, avg(vals), 9, vals.length, 'kss'));
      });
      wrap.appendChild(el('p', { class: 'muted', style: 'font-size:13px;margin:10px 0 0', text: 'Average sleepiness (KSS 1–9, higher = sleepier) by time since your last meal.' }));
      frag.appendChild(wrap);
    }

    // --- KSS by meal type ---
    const typeMap = {};
    withMeal.forEach(c => {
      const t = c.mealSnapshot && c.mealSnapshot.type;
      if (!t) return;
      (typeMap[t] = typeMap[t] || []).push(c.kss);
    });
    const types = Object.keys(typeMap).sort((a, b) => avg(typeMap[b]) - avg(typeMap[a]));
    if (types.length) {
      frag.appendChild(el('h2', { class: 'h2', text: 'Sleepiness by meal type' }));
      const wrap = el('div', { class: 'card' });
      types.forEach(t => wrap.appendChild(barRow(t, avg(typeMap[t]), 9, typeMap[t].length, 'kss')));
      frag.appendChild(wrap);
    }

    // --- history ---
    frag.appendChild(el('h2', { class: 'h2', text: 'History' }));
    const list = el('div', { class: 'list' });
    cks.slice(0, 60).forEach(c => {
      const snap = c.mealSnapshot;
      const meta = `${fmtDay(c.feltAt)} ${fmtClock(c.feltAt)} · energy ${c.energy}/5`
        + (c.minutesSinceMeal != null ? ` · ${fmtDur(c.minutesSinceMeal)} after ${snap ? snap.type : 'meal'}` : '')
        + (c.caffeineSinceMeal ? ' · ☕' : '');
      list.appendChild(el('div', { class: 'row' }, [
        pillFor('kss', c.kss),
        el('div', { class: 'row__main' }, [
          el('div', { class: 'row__title', text: KSS[c.kss].label }),
          el('div', { class: 'row__meta', text: meta }),
          c.note ? el('div', { class: 'row__meta', text: '“' + c.note + '”' }) : null
        ]),
        el('button', { class: 'row__del', type: 'button', 'aria-label': 'Delete check-in', onclick: () => { if (confirm('Delete this check-in?')) { state.checkins = state.checkins.filter(x => x.id !== c.id); saveCheckins(); render(); } }, text: '🗑' })
      ]));
    });
    frag.appendChild(list);

    frag.appendChild(dataTools());
    return frag;
  }

  function barRow(label, value, max, count, kind) {
    const row = el('div', { class: 'bar' });
    const valTxt = value == null ? 'no data' : value.toFixed(1);
    row.appendChild(el('div', { class: 'bar__head' }, [
      el('span', { text: label }),
      el('span', { class: 'muted', text: value == null ? '—' : `${valTxt}  (n=${count})` })
    ]));
    const track = el('div', { class: 'bar__track' });
    const fill = el('div', { class: 'bar__fill' });
    if (value != null) {
      const g = kind === 'kss' ? kssGrade(Math.round(value)) : energyGrade(Math.round(value));
      const colorVar = ['', '--s-good', '--s-okgood', '--s-mid', '--s-okbad', '--s-bad'][g];
      // set via CSSOM (allowed under CSP), not inline-attr in markup
      fill.style.width = Math.round((value / max) * 100) + '%';
      fill.style.background = `var(${colorVar})`;
    }
    track.appendChild(fill);
    row.appendChild(track);
    return row;
  }

  function dataTools() {
    const card = el('div', { class: 'card', style: 'margin-top:22px' });
    card.appendChild(el('div', { class: 'row__meta', style: 'margin-bottom:10px', text: 'Backup & export' }));
    card.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn', type: 'button', onclick: exportJSON, text: 'Backup (JSON)' }),
      el('button', { class: 'btn', type: 'button', onclick: exportCSV, text: 'Export CSV' })
    ]));
    // import
    const fileInput = el('input', { type: 'file', accept: 'application/json,.json', style: 'display:none' });
    fileInput.addEventListener('change', () => { if (fileInput.files[0]) importJSONFile(fileInput.files[0]); fileInput.value = ''; });
    card.appendChild(fileInput);
    card.appendChild(el('button', { class: 'btn btn--ghost', type: 'button', style: 'margin-top:10px', onclick: () => fileInput.click(), text: 'Restore from backup…' }));
    return card;
  }

  function emptyState(emoji, text) {
    return el('div', { class: 'empty' }, [
      el('span', { class: 'empty__emoji', text: emoji }),
      el('div', { text: text })
    ]);
  }

  /* ============================================================
     PROTOCOL storage helpers
     ============================================================ */
  function saveProtocols() { DB.write(K.protocols, state.protocols); }

  function addProtocol(p) { state.protocols.push(p); saveProtocols(); }

  function deleteProtocol(id) {
    state.protocols = state.protocols.filter(p => p.id !== id);
    saveProtocols();
  }

  function protoSummary(p) {
    const seq = p.intervals.map(iv => `${iv.label} ${iv.seconds}s`).join(' → ');
    return `${p.sets} set${p.sets !== 1 ? 's' : ''} · ${seq}`;
  }

  /* ============================================================
     AUDIO  (Web Audio API — works offline; iOS requires user gesture first)
     ============================================================ */
  let _audioCtx = null;

  function beep(type) {
    try {
      if (!window.AudioContext && !window.webkitAudioContext) return;
      if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const cfgs = {
        tick:     [{ freq: 880, at: 0,    dur: 0.06, vol: 0.25 }],
        interval: [{ freq: 660, at: 0,    dur: 0.18, vol: 0.35 }],
        done: [
          { freq: 880,  at: 0,    dur: 0.15, vol: 0.4 },
          { freq: 880,  at: 0.22, dur: 0.15, vol: 0.4 },
          { freq: 1100, at: 0.44, dur: 0.3,  vol: 0.4 }
        ]
      };
      const play = () => {
        const T = _audioCtx.currentTime;
        for (const { freq, at, dur, vol } of (cfgs[type] || [])) {
          const osc = _audioCtx.createOscillator();
          const gain = _audioCtx.createGain();
          osc.connect(gain); gain.connect(_audioCtx.destination);
          osc.type = 'sine'; osc.frequency.value = freq;
          const t = T + at;
          gain.gain.setValueAtTime(0, t);
          gain.gain.linearRampToValueAtTime(vol, t + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
          osc.start(t); osc.stop(t + dur + 0.05);
        }
      };
      if (_audioCtx.state === 'suspended') _audioCtx.resume().then(play).catch(() => {});
      else play();
    } catch (e) { /* audio unavailable */ }
  }

  /* ============================================================
     TIMER ENGINE
     ============================================================ */
  let _timerActive = null;
  let _timerTick = null;
  let _timerBeepSec = -1;

  function timerStart(protocol) {
    timerStop();
    _timerBeepSec = -1;
    _timerActive = { protocol, setIdx: 0, intIdx: 0, endTime: null, msRemaining: null, running: false, done: false };
    timerResume();
    beep('interval');
  }

  function timerPause() {
    const a = _timerActive;
    if (!a || !a.running) return;
    a.msRemaining = Math.max(0, a.endTime - Date.now());
    a.endTime = null;
    a.running = false;
    clearInterval(_timerTick); _timerTick = null;
    updateTimerDOM();
  }

  function timerResume() {
    const a = _timerActive;
    if (!a || a.done) return;
    if (_audioCtx && _audioCtx.state === 'suspended') _audioCtx.resume().catch(() => {});
    const ms = a.msRemaining != null ? a.msRemaining
      : (a.endTime != null ? Math.max(0, a.endTime - Date.now())
      : a.protocol.intervals[a.intIdx].seconds * 1000);
    a.endTime = Date.now() + ms;
    a.msRemaining = null;
    a.running = true;
    clearInterval(_timerTick);
    _timerTick = setInterval(timerTick, 200);
  }

  function timerTick() {
    const a = _timerActive;
    if (!a || !a.running) return;
    const msLeft = Math.max(0, a.endTime - Date.now());
    const secsLeft = Math.ceil(msLeft / 1000);
    if (secsLeft > 0 && secsLeft <= 3 && secsLeft !== _timerBeepSec) {
      _timerBeepSec = secsLeft;
      beep('tick');
    }
    if (msLeft <= 0) timerAdvance();
    else updateTimerDOM();
  }

  function timerAdvance() {
    const a = _timerActive;
    if (!a) return;
    _timerBeepSec = -1;
    a.intIdx++;
    if (a.intIdx >= a.protocol.intervals.length) {
      a.intIdx = 0;
      a.setIdx++;
      if (a.setIdx >= a.protocol.sets) {
        a.done = true; a.running = false;
        clearInterval(_timerTick); _timerTick = null;
        beep('done');
        if (state.tab === 'timers') render();
        return;
      }
    }
    a.endTime = Date.now() + a.protocol.intervals[a.intIdx].seconds * 1000;
    beep('interval');
    if (state.tab === 'timers' && state.timerView === 'running') render();
  }

  function timerSkip() { if (_timerActive) timerAdvance(); }

  function timerStop() {
    clearInterval(_timerTick); _timerTick = null;
    _timerActive = null;
  }

  function fmtCountdown(secs) {
    const m = Math.floor(secs / 60), s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function intervalBadgeKind(label) {
    const l = (label || '').toLowerCase();
    if (/work|go|push|active|on|sprint|lift|effort/.test(l)) return 'work';
    if (/rest|break|recover|off|pause|relax|cool|down/.test(l)) return 'rest';
    return 'other';
  }

  function updateTimerDOM() {
    const a = _timerActive;
    const elCd = document.getElementById('tmr-countdown');
    if (!elCd || !a) return;
    const msLeft = a.running ? Math.max(0, a.endTime - Date.now()) : (a.msRemaining || 0);
    const secsLeft = Math.ceil(msLeft / 1000);
    const iv = a.protocol.intervals[a.intIdx];
    const pct = iv.seconds > 0 ? (1 - msLeft / (iv.seconds * 1000)) * 100 : 100;
    elCd.textContent = fmtCountdown(secsLeft);
    const elBar = document.getElementById('tmr-bar');
    if (elBar) elBar.style.width = Math.min(100, Math.max(0, pct)).toFixed(1) + '%';
  }

  /* ============================================================
     VIEW: Timers — protocol list
     ============================================================ */
  function viewTimers() {
    const frag = document.createDocumentFragment();

    if (_timerActive && _timerActive.running && !_timerActive.done) {
      const a = _timerActive;
      const iv = a.protocol.intervals[a.intIdx];
      frag.appendChild(el('div', {
        class: 'card card--timer-banner',
        onclick: () => { state.timerView = 'running'; render(); }
      }, [
        el('div', { class: 'row__meta', text: '▶ Timer running — tap to open' }),
        el('div', { class: 'row__title', text: a.protocol.name }),
        el('div', { class: 'row__meta', text: `${iv.label} · Set ${a.setIdx + 1} of ${a.protocol.sets}` })
      ]));
    }

    frag.appendChild(el('h1', { class: 'h1', text: 'Timers' }));
    frag.appendChild(el('p', { class: 'sub', text: 'Build interval protocols once, run them anytime.' }));

    frag.appendChild(el('button', {
      class: 'btn btn--primary btn--lg', type: 'button',
      onclick: () => {
        state.protoEdit = {
          id: uid(), name: '',
          intervals: [{ label: 'Work', seconds: 30 }, { label: 'Rest', seconds: 10 }],
          sets: 3, isNew: true
        };
        state.timerView = 'editor';
        render();
      }
    }, '＋  New protocol'));

    if (!state.protocols.length) {
      frag.appendChild(emptyState('⏱', 'No protocols yet — create one above'));
    } else {
      frag.appendChild(el('h2', { class: 'h2', text: 'Saved protocols' }));
      const list = el('div', { class: 'list' });
      state.protocols.forEach(p => {
        list.appendChild(el('div', { class: 'proto-row' }, [
          el('div', { class: 'proto-row__main' }, [
            el('div', { class: 'proto-row__name', text: p.name || 'Untitled' }),
            el('div', { class: 'proto-row__meta', text: protoSummary(p) })
          ]),
          el('div', { class: 'proto-row__actions' }, [
            el('button', {
              type: 'button', 'aria-label': 'Edit', text: '✎',
              onclick: () => {
                state.protoEdit = { ...p, intervals: p.intervals.map(iv => ({ ...iv })), isNew: false };
                state.timerView = 'editor';
                render();
              }
            }),
            el('button', {
              type: 'button', 'aria-label': 'Delete', text: '🗑',
              onclick: () => {
                if (confirm(`Delete "${p.name || 'this protocol'}"?`)) {
                  deleteProtocol(p.id); render();
                }
              }
            }),
            el('button', {
              type: 'button', 'aria-label': 'Start', class: 'proto-row__start', text: '▶',
              onclick: () => { timerStart(p); state.timerView = 'running'; render(); }
            })
          ])
        ]));
      });
      frag.appendChild(list);
    }
    return frag;
  }

  /* ============================================================
     VIEW: Protocol editor
     ============================================================ */
  function viewProtocolEditor() {
    const draft = state.protoEdit;
    const frag = document.createDocumentFragment();

    frag.appendChild(el('div', { class: 'stepper__head' }, [
      el('span', { class: 'step__count', text: draft.isNew ? 'New protocol' : 'Edit protocol' }),
      el('button', {
        class: 'btn btn--ghost', type: 'button',
        style: 'flex:0 0 auto;width:auto;min-height:40px;padding:0 14px', text: 'Cancel',
        onclick: () => { state.timerView = 'list'; state.protoEdit = null; render(); }
      })
    ]));

    frag.appendChild(el('div', { class: 'field' }, [
      el('label', { class: 'field__label', text: 'Protocol name' }),
      (function () {
        const inp = el('input', { type: 'text', placeholder: 'e.g. 3×30s push', value: draft.name });
        inp.addEventListener('input', () => { draft.name = inp.value; });
        return inp;
      })()
    ]));

    frag.appendChild(el('label', { class: 'field__label', style: 'display:block;margin:20px 0 10px', text: 'Intervals (in order)' }));
    const intList = el('div', { class: 'int-list' });
    draft.intervals.forEach((iv, i) => {
      intList.appendChild(el('div', { class: 'int-row' }, [
        (function () {
          const inp = el('input', { type: 'text', placeholder: 'Label', value: iv.label });
          inp.addEventListener('input', () => { iv.label = inp.value; });
          return inp;
        })(),
        (function () {
          const inp = el('input', { type: 'number', min: '5', max: '3600', step: '5', value: String(iv.seconds), 'aria-label': 'Seconds' });
          inp.addEventListener('change', () => {
            const v = parseInt(inp.value, 10);
            if (v >= 5) iv.seconds = v; else inp.value = String(iv.seconds);
          });
          return inp;
        })(),
        el('span', { class: 'int-row__unit', text: 's' }),
        el('button', {
          class: 'int-row__del', type: 'button', 'aria-label': 'Remove', text: '✕',
          onclick: () => { draft.intervals.splice(i, 1); render(); }
        })
      ]));
    });
    frag.appendChild(intList);

    frag.appendChild(el('button', {
      class: 'btn btn--ghost', type: 'button', style: 'margin-top:10px',
      text: '＋ Add interval',
      onclick: () => {
        const last = draft.intervals[draft.intervals.length - 1];
        const nextLabel = (last && /work|go|push|active|sprint|lift/.test((last.label || '').toLowerCase())) ? 'Rest' : 'Work';
        draft.intervals.push({ label: nextLabel, seconds: last ? last.seconds : 30 });
        render();
      }
    }));

    frag.appendChild(el('div', { class: 'field', style: 'margin-top:24px' }, [
      el('label', { class: 'field__label', text: 'Sets (rounds)' }),
      el('div', { class: 'sets-stepper' }, [
        el('button', { type: 'button', text: '−', onclick: () => { if (draft.sets > 1) { draft.sets--; render(); } } }),
        el('div', { class: 'sets-stepper__val', text: String(draft.sets) }),
        el('button', { type: 'button', text: '＋', onclick: () => { if (draft.sets < 99) { draft.sets++; render(); } } })
      ])
    ]));

    const totalSecs = draft.intervals.reduce((s, iv) => s + iv.seconds, 0) * draft.sets;
    if (totalSecs > 0) {
      frag.appendChild(el('p', { class: 'muted', style: 'font-size:14px;margin-top:8px', text: `Total ≈ ${fmtDur(Math.ceil(totalSecs / 60))}` }));
    }

    frag.appendChild(el('button', {
      class: 'btn btn--primary btn--lg', type: 'button', style: 'margin-top:24px',
      text: draft.isNew ? 'Save protocol' : 'Update protocol',
      onclick: () => {
        if (!draft.name.trim()) { toast('Give the protocol a name'); return; }
        if (!draft.intervals.length) { toast('Add at least one interval'); return; }
        if (draft.intervals.some(iv => !iv.label.trim())) { toast('Give each interval a label'); return; }
        const proto = { id: draft.id, name: draft.name.trim(), intervals: draft.intervals.map(iv => ({ ...iv })), sets: draft.sets };
        if (draft.isNew) {
          addProtocol(proto);
        } else {
          const idx = state.protocols.findIndex(p => p.id === proto.id);
          if (idx >= 0) state.protocols[idx] = proto; else state.protocols.push(proto);
          saveProtocols();
        }
        state.protoEdit = null;
        state.timerView = 'list';
        toast(draft.isNew ? 'Protocol saved' : 'Protocol updated');
        render();
      }
    }));

    return frag;
  }

  /* ============================================================
     VIEW: Active timer
     ============================================================ */
  function viewActiveTimer() {
    const a = _timerActive;
    if (!a) { state.timerView = 'list'; return viewTimers(); }

    const frag = document.createDocumentFragment();

    frag.appendChild(el('div', { class: 'stepper__head' }, [
      el('button', {
        class: 'btn btn--ghost', type: 'button',
        style: 'flex:0 0 auto;width:auto;min-height:40px;padding:0 14px', text: '‹ Protocols',
        onclick: () => { state.timerView = 'list'; render(); }
      }),
      el('span', { class: 'step__count', text: a.protocol.name })
    ]));

    if (a.done) {
      frag.appendChild(el('div', { class: 'tmr-done' }, [
        el('span', { class: 'tmr-done__emoji', text: '🎉' }),
        el('div', { class: 'tmr-done__title', text: 'Done!' }),
        el('div', { class: 'tmr-done__sub', text: `${a.protocol.sets} set${a.protocol.sets !== 1 ? 's' : ''} complete` })
      ]));
      frag.appendChild(el('div', { class: 'btn-row', style: 'margin-top:24px' }, [
        el('button', { class: 'btn btn--primary', type: 'button', text: '↺  Repeat', onclick: () => { timerStart(a.protocol); render(); } }),
        el('button', { class: 'btn', type: 'button', text: 'Done', onclick: () => { timerStop(); state.timerView = 'list'; render(); } })
      ]));
      return frag;
    }

    const iv = a.protocol.intervals[a.intIdx];
    const msLeft = a.running ? Math.max(0, a.endTime - Date.now()) : (a.msRemaining != null ? a.msRemaining : iv.seconds * 1000);
    const secsLeft = Math.ceil(msLeft / 1000);
    const pct = iv.seconds > 0 ? (1 - msLeft / (iv.seconds * 1000)) * 100 : 0;

    frag.appendChild(el('div', { class: 'tmr-face' }, [
      el('div', { id: 'tmr-countdown', class: 'tmr-countdown', text: fmtCountdown(secsLeft) }),
      el('span', { class: `tmr-label-badge tmr-label-badge--${intervalBadgeKind(iv.label)}`, text: iv.label }),
      el('div', { class: 'tmr-set', text: `Set ${a.setIdx + 1} of ${a.protocol.sets}` })
    ]));

    const barEl = el('div', { id: 'tmr-bar', class: 'tmr-bar' });
    barEl.style.width = Math.min(100, Math.max(0, pct)).toFixed(1) + '%';
    frag.appendChild(el('div', { class: 'tmr-track' }, [barEl]));

    const seqRow = el('div', { class: 'tmr-seq' });
    a.protocol.intervals.forEach((iv2, i) => {
      seqRow.appendChild(el('span', {
        class: `tmr-seq__item tmr-seq__item--${intervalBadgeKind(iv2.label)}${i === a.intIdx ? ' tmr-seq__item--on' : ''}`,
        text: `${iv2.label} ${iv2.seconds}s`
      }));
    });
    frag.appendChild(seqRow);

    frag.appendChild(el('div', { class: 'tmr-controls' }, [
      el('button', {
        class: 'btn btn--primary tmr-controls__play', type: 'button',
        text: a.running ? '⏸  Pause' : '▶  Resume',
        onclick: () => { if (a.running) timerPause(); else timerResume(); render(); }
      }),
      el('button', {
        class: 'btn tmr-controls__icon', type: 'button',
        'aria-label': 'Skip interval', text: '⏭',
        onclick: () => { timerSkip(); }
      }),
      el('button', {
        class: 'btn btn--ghost tmr-controls__icon', type: 'button',
        'aria-label': 'Stop timer', text: '⏹',
        onclick: () => { if (confirm('Stop the timer?')) { timerStop(); state.timerView = 'list'; render(); } }
      })
    ]));

    return frag;
  }

  /* ============================================================
     COMPASS — specific-knowledge project
     A good-time journal + experiment bank. Local-first like the
     rest of the app; entries live in localStorage (K.journal).
     ============================================================ */

  // Engagement 1..5 (higher = more absorbed)
  const ENGAGE = [null, 'Bored / clock-watching', 'Meh', 'OK', 'Into it', 'Lost in it'];
  // Energy afterward (stored as -1 / 0 / +1)
  const ENERGY3 = [['Drained', -1], ['Neutral', 0], ['Charged', 1]];

  // Experiment bank — things to try so the journal has signal.
  // Grouped by "thread"; star = great starter, easy = fits a busy week.
  const EXPERIMENTS = [
    { thread: 'Capture (photography)', items: [
      { id: 'cap1', text: 'Shoot one person you love for 20 min; give them 5 frames', metric: 'their reaction', star: true, easy: true },
      { id: 'cap2', text: 'One photo a day for 7 days — only moments / emotion / movement', metric: 'which ones absorbed you', easy: true },
      { id: 'cap3', text: 'Be the unofficial photographer at the next gathering', metric: 'your energy + a shot someone loved' },
      { id: 'cap4', text: 'Rent or borrow a camera for a weekend before buying', metric: 'prototypes the purchase', star: true }
    ]},
    { thread: 'Teach / transmit', items: [
      { id: 'tea1', text: 'Teach your meal-prep / health system to one person, 30 min', metric: 'did they get it + your energy', star: true, easy: true },
      { id: 'tea2', text: 'Volunteer to onboard / train / present at the office', metric: 'energy during', easy: true },
      { id: 'tea3', text: 'Write a 1-page “how to” for a friend who needs it', metric: 'did it actually help' }
    ]},
    { thread: 'Wonder → broadcast', items: [
      { id: 'won1', text: '60-sec explainer of a cosmos thing, sent to a friend', metric: 'their “whoa”', star: true, easy: true },
      { id: 'won2', text: 'One 1–2 min reel explaining a cool fact with visuals', metric: 'did anyone feel the wonder' },
      { id: 'won3', text: '“One thing I learned” daily story for 7 days', metric: 'replies + your energy', easy: true }
    ]},
    { thread: 'Motion / speed', items: [
      { id: 'mot1', text: 'Go-karting — but log it deliberately this time', metric: 'recharge, or do you want the craft?', easy: true },
      { id: 'mot2', text: 'Shoot or film motion (cars, bikes, a kart session)', metric: 'absorption' },
      { id: 'mot3', text: '20-min chat with someone in the motorsport world', metric: 'energized or deflated' }
    ]},
    { thread: 'Solve / negotiate', items: [
      { id: 'sol1', text: 'Untangle one messy problem at work on purpose', metric: 'energized or drained', easy: true },
      { id: 'sol2', text: 'Help mediate one disagreement', metric: 'your energy + did it resolve', easy: true }
    ]},
    { thread: 'Combos ✦ (where it probably hides)', items: [
      { id: 'com1', text: 'Reel explaining a cosmos idea using your OWN footage', metric: 'photographer + vlogger + teacher at once', star: true },
      { id: 'com2', text: 'A 2-min “how I shot this & why” for a friend', metric: 'teach + capture' },
      { id: 'com3', text: 'Shoot a kart/car session and edit a 30-sec clip', metric: 'motion + capture' }
    ]}
  ];

  function engageGrade(n) { return 6 - n; } // 5 absorbed -> grade 1 (green)
  function engagePill(n) { return el('span', { class: 'pill pill--' + gradeClass(engageGrade(n)), text: String(n) }); }

  function addJournalEntry(e) {
    const rec = Object.assign({ id: uid(), at: nowISO() }, e);
    state.journal.push(rec);
    state.journal.sort((a, b) => new Date(b.at) - new Date(a.at));
    saveJournal();
    return rec;
  }
  function deleteJournalEntry(id) {
    state.journal = state.journal.filter(x => x.id !== id);
    saveJournal();
  }
  function newGtjForm(activity, experimentId) {
    return { activity: activity || '', engagement: null, energy: null, flow: null, pinch: null, pinchTrigger: '', note: '', experimentId: experimentId || null };
  }

  function yesNoChips(val, onSet) {
    const c = el('div', { class: 'chips' });
    [['Yes', true], ['No', false]].forEach(([label, v]) => {
      c.appendChild(el('button', { class: 'chip' + (val === v ? ' chip--on' : ''), type: 'button', onclick: () => onSet(val === v ? null : v) }, label));
    });
    return c;
  }

  function viewCompass() {
    const frag = document.createDocumentFragment();
    frag.appendChild(el('h1', { class: 'h1', text: 'Compass' }));
    frag.appendChild(el('p', { class: 'sub', text: 'Track what lights you up. Find the pattern.' }));

    const seg = el('div', { class: 'chips', style: 'margin-bottom:8px' });
    [['journal', 'Journal'], ['experiments', 'Experiments']].forEach(([key, label]) => {
      seg.appendChild(el('button', { class: 'chip' + (state.compassSub === key ? ' chip--on' : ''), type: 'button', onclick: () => { state.compassSub = key; render(); } }, label));
    });
    frag.appendChild(seg);

    frag.appendChild(state.compassSub === 'experiments' ? viewExperiments() : viewJournal());
    return frag;
  }

  function viewJournal() {
    const frag = document.createDocumentFragment();

    if (state.gtjForm) {
      frag.appendChild(gtjFormCard());
    } else {
      frag.appendChild(el('button', { class: 'btn btn--primary btn--lg', type: 'button', onclick: () => { state.gtjForm = newGtjForm(); render(); }, text: '＋  Log a good time' }));
    }

    frag.appendChild(el('h2', { class: 'h2', text: 'Recent' }));
    if (!state.journal.length) {
      frag.appendChild(emptyState('🧭', 'Nothing logged yet — catch a moment'));
    } else {
      const list = el('div', { class: 'list' });
      state.journal.slice(0, 60).forEach(e => list.appendChild(journalRow(e)));
      frag.appendChild(list);
      frag.appendChild(el('div', { class: 'card', style: 'margin-top:16px' }, [
        el('div', { class: 'row__meta', style: 'margin-bottom:10px', text: 'After ~2–3 weeks, circle your high-energy lines — then send me this.' }),
        el('button', { class: 'btn', type: 'button', onclick: exportJournalCSV, text: 'Export journal (CSV)' })
      ]));
    }
    return frag;
  }

  function gtjFormCard() {
    const f = state.gtjForm;
    const card = el('div', { class: 'card card--pad-lg' });

    if (f.experimentId) {
      card.appendChild(el('div', { class: 'row__meta', style: 'margin-bottom:6px', text: '✦ Logging an experiment' }));
    }

    card.appendChild(el('label', { class: 'field__label', text: 'What were you doing?' }));
    const act = el('input', { type: 'text', placeholder: 'e.g. explained a star-birth clip to a friend' });
    act.value = f.activity || '';
    act.addEventListener('input', () => { f.activity = act.value; });
    card.appendChild(act);

    card.appendChild(el('label', { class: 'field__label', style: 'margin-top:16px', text: 'How absorbed were you?' }));
    const eng = el('div', { class: 'chips' });
    for (let i = 1; i <= 5; i++) {
      eng.appendChild(el('button', { class: 'chip' + (f.engagement === i ? ' chip--on' : ''), type: 'button', onclick: () => { f.engagement = i; render(); } }, String(i)));
    }
    card.appendChild(eng);
    card.appendChild(el('p', { class: 'muted', style: 'font-size:13px;margin:8px 0 0', text: f.engagement ? `${f.engagement} · ${ENGAGE[f.engagement]}` : '1 = bored · 5 = lost in it' }));

    card.appendChild(el('label', { class: 'field__label', style: 'margin-top:16px', text: 'Energy afterward?' }));
    const ene = el('div', { class: 'chips' });
    ENERGY3.forEach(([label, val]) => {
      ene.appendChild(el('button', { class: 'chip' + (f.energy === val ? ' chip--on' : ''), type: 'button', onclick: () => { f.energy = (f.energy === val ? null : val); render(); } }, label));
    });
    card.appendChild(ene);

    card.appendChild(el('label', { class: 'field__label', style: 'margin-top:16px', text: 'Did time vanish? (flow)' }));
    card.appendChild(yesNoChips(f.flow, (v) => { f.flow = v; render(); }));

    card.appendChild(el('label', { class: 'field__label', style: 'margin-top:16px', text: 'Did the perfectionist critic show up?' }));
    card.appendChild(yesNoChips(f.pinch, (v) => { f.pinch = v; render(); }));
    if (f.pinch === true) {
      const trig = el('input', { type: 'text', placeholder: 'what set it off? (e.g. compared to a pro)', style: 'margin-top:10px' });
      trig.value = f.pinchTrigger || '';
      trig.addEventListener('input', () => { f.pinchTrigger = trig.value; });
      card.appendChild(trig);
    }

    card.appendChild(el('div', { class: 'field', style: 'margin-top:16px' }, [
      el('label', { class: 'field__label', text: 'Note (optional)' }),
      (function () { const ta = el('textarea', { placeholder: 'anything you noticed…' }); ta.value = f.note || ''; ta.addEventListener('input', () => { f.note = ta.value; }); return ta; })()
    ]));

    card.appendChild(el('div', { class: 'btn-row', style: 'margin-top:8px' }, [
      el('button', { class: 'btn btn--ghost', type: 'button', onclick: () => { state.gtjForm = null; render(); }, text: 'Cancel' }),
      el('button', {
        class: 'btn btn--primary', type: 'button', onclick: () => {
          if (!f.activity.trim()) { toast('What were you doing?'); return; }
          if (f.engagement == null) { toast('Pick an absorption level'); return; }
          addJournalEntry({
            activity: f.activity.trim(), engagement: f.engagement, energy: f.energy,
            flow: f.flow, pinch: f.pinch, pinchTrigger: (f.pinchTrigger || '').trim() || null,
            note: (f.note || '').trim() || null, experimentId: f.experimentId
          });
          state.gtjForm = null;
          render();
          toast('Logged ✓');
        }, text: 'Save'
      })
    ]));
    return card;
  }

  function journalRow(e) {
    const bits = [`${fmtDay(e.at)} ${fmtClock(e.at)}`];
    if (e.energy != null) bits.push('energy ' + (e.energy > 0 ? '↑' : e.energy < 0 ? '↓' : '→'));
    if (e.flow) bits.push('flow');
    if (e.pinch) bits.push('pinch' + (e.pinchTrigger ? ' (' + e.pinchTrigger + ')' : ''));
    return el('div', { class: 'row' }, [
      engagePill(e.engagement),
      el('div', { class: 'row__main' }, [
        el('div', { class: 'row__title', text: e.activity }),
        el('div', { class: 'row__meta', text: bits.join(' · ') }),
        e.note ? el('div', { class: 'row__meta', text: '“' + e.note + '”' }) : null
      ]),
      el('button', { class: 'row__del', type: 'button', 'aria-label': 'Delete entry', onclick: () => { if (confirm('Delete this entry?')) { deleteJournalEntry(e.id); render(); } }, text: '🗑' })
    ]);
  }

  function viewExperiments() {
    const frag = document.createDocumentFragment();
    frag.appendChild(el('p', { class: 'sub', style: 'margin-top:6px', text: 'Pick 3–4 across different threads. ⭐ great starter · 🟢 fits a busy week.' }));
    const doneCount = Object.keys(state.expDone).filter(k => state.expDone[k]).length;
    if (doneCount) frag.appendChild(el('p', { class: 'muted', style: 'margin:-10px 0 2px', text: doneCount + ' tried so far' }));

    EXPERIMENTS.forEach(group => {
      frag.appendChild(el('h2', { class: 'h2', text: group.thread }));
      const list = el('div', { class: 'list' });
      group.items.forEach(it => list.appendChild(experimentRow(it)));
      frag.appendChild(list);
    });

    frag.appendChild(el('p', { class: 'muted center', style: 'margin-top:22px;font-size:13px', text: 'The only rule: did a real person feel or understand something? Never “is this world-class?”' }));
    return frag;
  }

  function experimentRow(it) {
    const done = !!state.expDone[it.id];
    const tags = [];
    if (it.star) tags.push('⭐');
    if (it.easy) tags.push('🟢');
    const meta = (tags.length ? tags.join(' ') + '  ' : '') + '→ ' + it.metric;
    return el('div', { class: 'row' + (done ? ' row--done' : '') }, [
      el('button', {
        class: 'check' + (done ? ' check--on' : ''), type: 'button',
        'aria-label': done ? 'Mark as not done' : 'Mark as done',
        onclick: () => { if (done) delete state.expDone[it.id]; else state.expDone[it.id] = true; saveExpDone(); render(); },
        text: done ? '✓' : '○'
      }),
      el('div', { class: 'row__main' }, [
        el('div', { class: 'row__title', text: it.text }),
        el('div', { class: 'row__meta', text: meta })
      ]),
      el('button', { class: 'btn', style: 'width:auto;flex:0 0 auto;min-height:40px;padding:0 14px', type: 'button', onclick: () => { state.gtjForm = newGtjForm(it.text, it.id); state.compassSub = 'journal'; render(); }, text: 'Log ›' })
    ]);
  }

  function exportJournalCSV() {
    if (!state.journal.length) { toast('Nothing to export yet'); return; }
    const cols = ['timestamp', 'date', 'time', 'activity', 'engagement', 'engagement_label', 'energy', 'flow', 'pinch', 'pinch_trigger', 'experiment_id', 'note'];
    const lines = [cols.join(',')];
    const rows = state.journal.slice().sort((a, b) => new Date(a.at) - new Date(b.at));
    for (const e of rows) {
      const d = new Date(e.at);
      lines.push([
        e.at,
        d.toLocaleDateString('en-CA'),
        d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        e.activity,
        e.engagement,
        ENGAGE[e.engagement] || '',
        e.energy == null ? '' : (e.energy > 0 ? 'charged' : e.energy < 0 ? 'drained' : 'neutral'),
        e.flow == null ? '' : (e.flow ? 'yes' : 'no'),
        e.pinch == null ? '' : (e.pinch ? 'yes' : 'no'),
        e.pinchTrigger || '',
        e.experimentId || '',
        e.note || ''
      ].map(csvCell).join(','));
    }
    download(`clarity-journal-${new Date().toISOString().slice(0, 10)}.csv`,
      lines.join('\n'), 'text/csv');
    toast('Journal CSV exported');
  }

  /* ============================================================
     boot
     ============================================================ */
  function bindTabs() {
    document.querySelectorAll('.tab').forEach(btn => {
      btn.addEventListener('click', () => setTab(btn.dataset.tab));
    });
  }

  function registerSW() {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('service-worker.js').catch(() => {/* offline cache is optional */ });
    }
  }

  if (!window.__clarityCaptureInternals) {
    // keep meals/checkins/journal sorted on load (in case of manual edits / imports)
    state.meals.sort((a, b) => new Date(b.eatenAt) - new Date(a.eatenAt));
    state.checkins.sort((a, b) => new Date(b.feltAt) - new Date(a.feltAt));
    state.journal.sort((a, b) => new Date(b.at) - new Date(a.at));

    // When app resumes from background, fast-forward any intervals that elapsed.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && _timerActive && _timerActive.running) {
        let limit = 500;
        while (limit-- > 0 && _timerActive && _timerActive.running && !_timerActive.done && Date.now() >= _timerActive.endTime) {
          const a = _timerActive;
          a.intIdx++;
          if (a.intIdx >= a.protocol.intervals.length) {
            a.intIdx = 0;
            a.setIdx++;
            if (a.setIdx >= a.protocol.sets) {
              a.done = true; a.running = false;
              clearInterval(_timerTick); _timerTick = null;
              break;
            }
          }
          a.endTime = Date.now() + a.protocol.intervals[a.intIdx].seconds * 1000;
        }
        if (state.tab === 'timers') render();
      }
    });

    bindTabs();
    render();
    registerSW();
  }

  // Test harness: expose internals when loaded by the test suite.
  // window.__clarityCaptureInternals must be set BEFORE the script runs.
  if (typeof window !== 'undefined' && window.__clarityCaptureInternals) {
    const _exp = {
      // pure utils
      fmtCountdown, intervalBadgeKind, protoSummary,
      kssGrade, energyGrade, fmtDur,
      // timer engine
      timerStart, timerPause, timerResume, timerSkip, timerStop, timerAdvance,
      // protocol CRUD
      addProtocol, deleteProtocol, saveProtocols,
      // storage + state (direct references)
      DB, state
    };
    // _timerActive is a let — expose via getter so tests always see current value
    Object.defineProperty(_exp, '_timerActive', { get() { return _timerActive; }, enumerable: true });
    window.__clarityInternals = _exp;
  }

})();
