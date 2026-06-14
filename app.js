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
    schemaVersion: 2
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
    settings: Object.assign(
      { mealTypes: DEFAULT_MEAL_TYPES.slice(), schemaVersion: K.schemaVersion },
      DB.read(K.settings, {})
    ),
    // transient view state
    draft: null,        // active check-in
    mealForm: null      // active meal form
  };

  function saveMeals() { DB.write(K.meals, state.meals); }
  function saveCheckins() { DB.write(K.checkins, state.checkins); }

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
    if (!last) return state.checkins.length + state.meals.length;
    const t = new Date(last).getTime();
    const newCk = state.checkins.filter(c => new Date(c.createdAt).getTime() > t).length;
    const newMl = state.meals.filter(m => new Date(m.eatenAt).getTime() > t).length;
    return newCk + newMl;
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
      meals: state.meals, checkins: state.checkins, settings: state.settings
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

  // keep meals/checkins sorted on load (in case of manual edits / imports)
  state.meals.sort((a, b) => new Date(b.eatenAt) - new Date(a.eatenAt));
  state.checkins.sort((a, b) => new Date(b.feltAt) - new Date(a.feltAt));

  bindTabs();
  render();
  registerSW();

})();
