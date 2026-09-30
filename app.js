'use strict';

const STORAGE_KEY = 'habits.v1';
const COLORS = ['#16a34a', '#2563eb', '#9333ea', '#ea580c', '#dc2626', '#0d9488', '#ca8a04', '#db2777'];
const EMOJIS = ['💧', '🏃', '📚', '🧘', '🦷', '💪', '🥗', '😴', '✍️', '🚶', '💊', '🎸', '🧹', '📵'];
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const SUGGESTIONS = [
  { name: 'Wasser trinken', emoji: '💧' },
  { name: 'Sport', emoji: '🏃' },
  { name: '10 Min. lesen', emoji: '📚' },
  { name: 'Meditieren', emoji: '🧘' },
  { name: 'Zahnseide', emoji: '🦷' },
  { name: 'Vor 23 Uhr schlafen', emoji: '😴' },
];

/* ---------- Datum ---------- */

const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const weekdayIdx = (d) => (d.getDay() + 6) % 7; // 0 = Montag
const todayKey = () => keyOf(new Date());

/* ---------- Zustand ---------- */

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (s && Array.isArray(s.habits)) return { habits: s.habits, log: s.log || {} };
  } catch { /* leer oder kaputt -> neu anfangen */ }
  return { habits: [], log: {} };
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    toast('Speichern fehlgeschlagen. Ist der Speicher voll oder privat?');
  }
}

let state = load();
let selectedKey = todayKey();
let currentView = 'today';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- Logik ---------- */

const isScheduled = (h, d) => h.days.includes(weekdayIdx(d));
const isDone = (h, k) => !!(state.log[h.id] && state.log[h.id][k]);

function toggle(h, k) {
  const entries = state.log[h.id] || (state.log[h.id] = {});
  if (entries[k]) delete entries[k];
  else entries[k] = true;
  save();
  return !!entries[k];
}

/** Frühester relevanter Tag: Erstellung oder frühester (nachgetragener) Eintrag. */
function startOf(h) {
  let start = h.createdAt;
  for (const k of Object.keys(state.log[h.id] || {})) if (k < start) start = k;
  return parseKey(start);
}

/**
 * Aktuelle Serie: aufeinanderfolgende erledigte geplante Tage bis heute.
 * Ungeplante Tage sind neutral. Ist heute noch offen, zählt die Serie bis gestern
 * (der Tag ist ja noch nicht vorbei).
 */
function currentStreak(h) {
  const start = startOf(h);
  let d = parseKey(todayKey());
  if (!isDone(h, keyOf(d))) d = addDays(d, -1);
  let streak = 0;
  while (d >= start) {
    if (isScheduled(h, d)) {
      if (!isDone(h, keyOf(d))) break;
      streak++;
    }
    d = addDays(d, -1);
  }
  return streak;
}

function bestStreak(h) {
  const today = parseKey(todayKey());
  let best = 0, run = 0;
  for (let d = startOf(h); d <= today; d = addDays(d, 1)) {
    if (!isScheduled(h, d)) continue;
    if (isDone(h, keyOf(d))) best = Math.max(best, ++run);
    else if (keyOf(d) !== todayKey()) run = 0;
  }
  return best;
}

/** Erfüllungsquote der letzten 30 Tage (heute zählt nur, wenn schon erledigt). */
function rate30(h) {
  const today = parseKey(todayKey());
  const start = startOf(h);
  let planned = 0, done = 0;
  for (let i = 0; i < 30; i++) {
    const d = addDays(today, -i);
    if (d < start) break;
    if (!isScheduled(h, d)) continue;
    const k = keyOf(d);
    if (i === 0 && !isDone(h, k)) continue;
    planned++;
    if (isDone(h, k)) done++;
  }
  return planned ? Math.round((done / planned) * 100) : null;
}

/* ---------- Hilfen ---------- */

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function daysLabel(days) {
  if (days.length === 7) return 'Täglich';
  const s = [...days].sort((a, b) => a - b).join();
  if (s === '0,1,2,3,4') return 'Werktags';
  if (s === '5,6') return 'Am Wochenende';
  return [...days].sort((a, b) => a - b).map((i) => WEEKDAYS[i]).join(', ');
}

const tageWort = (n) => (n === 1 ? 'Tag' : 'Tage');

/* ---------- Ansicht: Heute ---------- */

function renderToday() {
  const sel = parseKey(selectedKey);
  const isToday = selectedKey === todayKey();
  const dateFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long' });
  $('#today-weekday').textContent = new Intl.DateTimeFormat('de-DE', { weekday: 'long' }).format(sel);
  $('#today-title').textContent = isToday ? 'Heute' : dateFmt.format(sel);

  // Wochenleiste: die letzten 7 Tage bis heute
  const today = parseKey(todayKey());
  let strip = '';
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    const k = keyOf(d);
    const planned = state.habits.filter((h) => isScheduled(h, d) && startOf(h) <= d);
    const done = planned.filter((h) => isDone(h, k)).length;
    const dot = planned.length && done === planned.length ? 'full' : done ? 'partial' : '';
    strip += `<button type="button" data-day="${k}" class="${k === selectedKey ? 'sel' : ''}" aria-pressed="${k === selectedKey}">
      <span class="wd">${WEEKDAYS[weekdayIdx(d)]}</span><span class="dn">${d.getDate()}</span><span class="dot ${dot}"></span></button>`;
  }
  $('#week-strip').innerHTML = strip;

  const planned = state.habits.filter((h) => isScheduled(h, sel));
  const other = state.habits.filter((h) => !isScheduled(h, sel));
  const doneCount = planned.filter((h) => isDone(h, selectedKey)).length;
  renderRing(doneCount, planned.length);

  if (!state.habits.length) {
    $('#today-list').innerHTML = `<div class="empty">
      <div class="big">🌱</div>
      <h2>Starte mit einer kleinen Gewohnheit</h2>
      <p>Tippe auf einen Vorschlag oder auf <b>+</b>, um eine eigene anzulegen.</p>
      <div class="chips">${SUGGESTIONS.map((s, i) => `<button type="button" class="chip" data-suggest="${i}">${s.emoji} ${esc(s.name)}</button>`).join('')}</div>
    </div>`;
    return;
  }

  let html = '';
  if (planned.length) html += planned.map((h) => habitRow(h, false)).join('');
  else html += `<div class="empty"><div class="big">☀️</div><p>Für diesen Tag ist nichts geplant.</p></div>`;
  if (other.length) {
    html += `<div class="section-label">Nicht geplant</div>` + other.map((h) => habitRow(h, true)).join('');
  }
  if (planned.length && doneCount === planned.length) {
    html = `<div class="card" style="text-align:center">🎉 <b>${isToday ? 'Alles erledigt für heute! Dein Baum ist gegossen.' : 'Alles erledigt an diesem Tag!'}</b></div>` + html;
  }
  if (isToday) html = treeBanner(treeState()) + html;
  $('#today-list').innerHTML = html;
}

function habitRow(h, off) {
  const done = isDone(h, selectedKey);
  const streak = currentStreak(h);
  const meta = streak ? `🔥 <b>${streak}</b> ${tageWort(streak)} in Folge · ${daysLabel(h.days)}` : daysLabel(h.days);
  return `<div class="habit ${off ? 'off' : ''}" style="--c:${h.color}">
    <div class="emoji" aria-hidden="true">${esc(h.emoji)}</div>
    <button type="button" class="info" data-edit="${esc(h.id)}" aria-label="${esc(h.name)} bearbeiten">
      <div class="name">${esc(h.name)}</div>
      <div class="meta">${meta}</div>
    </button>
    <button type="button" class="check ${done ? 'on' : ''}" data-toggle="${esc(h.id)}" aria-pressed="${done}" aria-label="${esc(h.name)} ${done ? 'als offen markieren' : 'abhaken'}">${CHECK_SVG}</button>
  </div>`;
}

function renderRing(done, total) {
  const r = 24, c = 2 * Math.PI * r;
  const frac = total ? done / total : 0;
  $('#progress-ring').innerHTML = `<svg viewBox="0 0 56 56" aria-hidden="true">
      <circle class="track" cx="28" cy="28" r="${r}"/>
      <circle class="bar" cx="28" cy="28" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - frac)}"/>
    </svg><span>${done}/${total}</span>`;
  $('#progress-ring').setAttribute('aria-label', `${done} von ${total} erledigt`);
  $('#progress-ring').hidden = total === 0;
}

/* ---------- Ansicht: Baum ---------- */

const treeState = () => Tree.simulate(state.habits, state.log, todayKey());
const treeSeed = () => (state.habits.length ? state.habits.map((h) => h.createdAt).sort()[0] : 'baum');

function healthColor(h) {
  if (h >= 60) return 'var(--accent)';
  if (h >= 40) return '#84cc16';
  if (h >= 20) return '#eab308';
  return 'var(--danger)';
}

/** Hinweis auf der Heute-Ansicht, wenn der Baum Hilfe braucht. */
function treeBanner(t) {
  if (t.empty || !t.today.planned || t.today.done === t.today.planned) return '';
  const left = t.today.planned - t.today.done;
  const btn = `<button type="button" class="banner-link" data-tab="tree">Zum Baum</button>`;
  if (t.tonight.dies) {
    return `<div class="banner danger">🥀 <div><b>Dein Baum geht heute Nacht ein!</b><br>Er würde auf „${esc(Tree.STAGES[Math.max(0, t.stage - 1)].name)}“ zurückfallen. Erledige noch ${left === t.today.planned ? 'mindestens die Hälfte' : 'mehr'} deiner Gewohnheiten, um ihn zu retten. ${btn}</div></div>`;
  }
  if (t.tonight.usesCan) {
    return `<div class="banner">💧 <div>Wenn du heute nichts erledigst, wird eine Gießkanne verbraucht. ${btn}</div></div>`;
  }
  if (t.health < 40) {
    return `<div class="banner warn">🍂 <div><b>Dein Baum welkt</b> (${t.health} % Gesundheit). Erledige heute alles, damit er sich erholt. ${btn}</div></div>`;
  }
  return '';
}

function renderTree() {
  const t = treeState();
  $('#tree-stage-label').textContent = t.empty ? '' : `Stufe ${t.stage + 1} von ${Tree.STAGES.length} · ${t.stageName}`;
  if (t.empty) {
    $('#tree-content').innerHTML = `<div class="empty"><div class="big">🌰</div><p>Lege eine Gewohnheit an. Jede erledigte Gewohnheit lässt deinen Baum wachsen.</p></div>`;
    return;
  }

  const growthText = t.nextName
    ? `${t.growth - Tree.STAGES[t.stage].min} / ${t.nextMin - Tree.STAGES[t.stage].min} bis <b>${t.nextName}</b>`
    : 'Höchste Stufe erreicht 🏆';
  const cans = Array.from({ length: Tree.RULES.maxCans }, (_, i) => `<span class="can ${i < t.cans ? 'full' : ''}">💧</span>`).join('');
  const toNextCan = Tree.RULES.canEvery - (t.perfectRun % Tree.RULES.canEvery);
  const canText = t.cans >= Tree.RULES.maxCans
    ? 'Vorrat voll'
    : `Noch ${toNextCan} perfekte${toNextCan === 1 ? 'r Tag' : ' Tage'} bis zur nächsten`;

  let todayText;
  const { planned, done } = t.today;
  if (!planned) todayText = 'Heute ist nichts geplant, dein Baum ruht sich aus.';
  else if (done === planned) todayText = `✅ Heute alles erledigt: <b>+${Tree.RULES.perfect} Gesundheit</b>.`;
  else if (t.tonight.dies) todayText = `🥀 <b>Achtung:</b> Bleibt es bei ${done}/${planned}, geht dein Baum heute Nacht ein.`;
  else if (t.tonight.usesCan) todayText = `Heute noch nichts erledigt. Bleibt das so, rettet ihn eine Gießkanne.`;
  else {
    const d = t.tonight.delta;
    todayText = `Heute ${done}/${planned} erledigt. Bleibt es dabei: <b>${d > 0 ? '+' : ''}${d} Gesundheit</b>. Mach alles für <b>+${Tree.RULES.perfect}</b>.`;
  }

  const dateFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
  const eventText = (e) => {
    const date = dateFmt.format(parseKey(e.key));
    switch (e.type) {
      case 'start': return ['🌰', 'Samen gepflanzt', date];
      case 'grew': return ['🌱', `Gewachsen: <b>${esc(e.stage)}</b>`, date];
      case 'can': return ['💧', 'Gießkanne verdient', date];
      case 'saved': return ['🛟', 'Gießkanne hat deinen Baum gerettet', date];
      case 'missed': return ['🥀', `Nichts erledigt <span class="ev-delta">${e.delta} ❤️</span>`, date];
      case 'weak': return ['🍂', `Wenig erledigt <span class="ev-delta">${e.delta} ❤️</span>`, date];
      case 'died': return ['💀', `Eingegangen: ${esc(e.from)} → ${esc(e.to)}`, date];
      default: return ['•', '', date];
    }
  };
  const events = t.events.slice(-8).reverse().map((e) => {
    const [icon, text, date] = eventText(e);
    return `<li class="ev-${e.type}"><span class="ev-icon">${icon}</span><span class="ev-text">${text}</span><span class="ev-date">${date}</span></li>`;
  }).join('');

  $('#tree-content').innerHTML = `
    <div class="card tree-card ${t.health < 20 ? 'sick' : ''}">
      ${Tree.svg(t, treeSeed())}
      <div class="tree-name">${esc(t.stageName)}</div>
      <div class="tree-health-label" style="color:${healthColor(t.health)}">${Tree.healthLabel(t.health)}</div>
    </div>
    <div class="card">
      <div class="bar-row"><span>❤️ Gesundheit</span><span><b>${t.health}</b> / 100</span></div>
      <div class="bar"><i style="width:${t.health}%;background:${healthColor(t.health)}"></i></div>
      <div class="bar-row"><span>🌿 Wachstum</span><span>${growthText}</span></div>
      <div class="bar"><i style="width:${Math.round(t.progress * 100)}%;background:var(--accent)"></i></div>
      <div class="bar-row cans-row"><span>Gießkannen ${cans}</span><span class="muted-sm">${canText}</span></div>
      <p class="tree-today">${todayText}</p>
    </div>
    <div class="card">
      <h2>Chronik</h2>
      <ul class="events">${events}</ul>
    </div>
    <details class="card rules">
      <summary>So funktioniert dein Baum</summary>
      <ul>
        <li><b>Wachstum:</b> Jede erledigte Gewohnheit bringt 1 Punkt. Nach und nach wird aus dem Samen ein uralter Baum mit Blüten und Früchten.</li>
        <li><b>Gesundheit</b> wird jeden Abend abgerechnet: alles erledigt <b>+${Tree.RULES.perfect}</b>, mindestens die Hälfte <b>±0</b>, weniger <b>${Tree.RULES.weak}</b>, gar nichts <b>${Tree.RULES.missed}</b>.</li>
        <li><b>Eingehen:</b> Fällt die Gesundheit auf 0, stirbt der Baum und fällt eine ganze Stufe zurück.</li>
        <li><b>Gießkannen:</b> Für ${Tree.RULES.canEvery} perfekte Tage in Folge gibt es eine Gießkanne (max. ${Tree.RULES.maxCans}). Sie rettet dich automatisch an einem Tag, an dem du nichts geschafft hast.</li>
        <li>Tage ohne geplante Gewohnheiten zählen nicht.</li>
      </ul>
    </details>`;
}

/* ---------- Ansicht: Statistik ---------- */

const HEAT_WEEKS = 17;

function renderStats() {
  if (!state.habits.length) {
    $('#stats-list').innerHTML = `<div class="empty"><div class="big">📊</div><p>Lege zuerst eine Gewohnheit an, dann siehst du hier deine Statistiken.</p></div>`;
    return;
  }
  const today = parseKey(todayKey());
  // Startet am Montag vor (HEAT_WEEKS-1) Wochen, damit jede Spalte eine Woche ist
  const gridStart = addDays(today, -weekdayIdx(today) - (HEAT_WEEKS - 1) * 7);
  const monthFmt = new Intl.DateTimeFormat('de-DE', { month: 'short' });

  $('#stats-list').innerHTML = state.habits.map((h) => {
    const start = startOf(h);
    const rate = rate30(h);
    let cells = '';
    for (let i = 0; i < HEAT_WEEKS * 7; i++) {
      const d = addDays(gridStart, i);
      const k = keyOf(d);
      let cls = '';
      if (d > today) cls = 'future';
      else if (isDone(h, k)) cls = 'done';
      else if (d < start) cls = 'pre';
      else if (!isScheduled(h, d)) cls = 'rest';
      if (k === todayKey()) cls += ' today';
      cells += `<i class="${cls}" title="${d.toLocaleDateString('de-DE')}"></i>`;
    }
    const cur = currentStreak(h), best = bestStreak(h);
    return `<div class="card" style="--c:${h.color}">
      <div class="stat-head">
        <div class="emoji" aria-hidden="true">${esc(h.emoji)}</div>
        <div class="name">${esc(h.name)}</div>
        <button type="button" class="edit" data-edit="${esc(h.id)}">Bearbeiten</button>
      </div>
      <div class="nums">
        <div><b>🔥 ${cur}</b><span>Aktuelle Serie</span></div>
        <div><b>${best}</b><span>Beste Serie</span></div>
        <div><b>${rate === null ? '–' : rate + ' %'}</b><span>Quote 30 Tage</span></div>
      </div>
      <div class="heat" role="img" aria-label="Verlauf der letzten ${HEAT_WEEKS} Wochen">${cells}</div>
      <div class="legend"><span>${monthFmt.format(gridStart)}</span><span>${daysLabel(h.days)}</span><span>Heute</span></div>
    </div>`;
  }).join('');
}

/* ---------- Navigation ---------- */

function render() {
  if (currentView === 'today') renderToday();
  if (currentView === 'tree') renderTree();
  if (currentView === 'stats') renderStats();
}

function showView(name) {
  currentView = name;
  document.querySelectorAll('.view').forEach((v) => { v.hidden = v.dataset.view !== name; });
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $('#btn-add').hidden = name !== 'today';
  window.scrollTo(0, 0);
  render();
}

/* ---------- Dialog ---------- */

const dialog = $('#habit-dialog');
let editingId = null;
let draft = null;

function openDialog(habit, preset) {
  editingId = habit ? habit.id : null;
  draft = habit
    ? { ...habit, days: [...habit.days] }
    : { name: '', emoji: '✅', color: COLORS[state.habits.length % COLORS.length], days: [...ALL_DAYS], ...preset };
  $('#dialog-title').textContent = habit ? 'Gewohnheit bearbeiten' : 'Neue Gewohnheit';
  $('#f-name').value = draft.name;
  $('#f-emoji').value = draft.emoji;
  $('#btn-delete').hidden = !habit;
  renderDialogPickers();
  dialog.showModal();
  if (!habit && !preset) $('#f-name').focus();
}

function renderDialogPickers() {
  $('#emoji-picks').innerHTML = EMOJIS.map((e) => `<button type="button" data-emoji="${e}" aria-label="Symbol ${e}">${e}</button>`).join('');
  $('#swatches').innerHTML = COLORS.map((c) => `<button type="button" data-color="${c}" style="--c:${c}" aria-label="Farbe ${c}" aria-pressed="${c === draft.color}"></button>`).join('');
  $('#day-toggles').innerHTML = WEEKDAYS.map((w, i) => `<button type="button" data-dayt="${i}" aria-pressed="${draft.days.includes(i)}">${w}</button>`).join('');
}

$('#emoji-picks').addEventListener('click', (e) => {
  const b = e.target.closest('[data-emoji]');
  if (b) $('#f-emoji').value = b.dataset.emoji;
});
$('#swatches').addEventListener('click', (e) => {
  const b = e.target.closest('[data-color]');
  if (!b) return;
  draft.color = b.dataset.color;
  renderDialogPickers();
});
$('#day-toggles').addEventListener('click', (e) => {
  const b = e.target.closest('[data-dayt]');
  if (!b) return;
  const i = Number(b.dataset.dayt);
  draft.days = draft.days.includes(i) ? draft.days.filter((x) => x !== i) : [...draft.days, i];
  renderDialogPickers();
});

$('#habit-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#f-name').value.trim();
  if (!name) { $('#f-name').focus(); return; }
  if (!draft.days.length) { toast('Wähle mindestens einen Tag aus.'); return; }
  const emoji = $('#f-emoji').value.trim() || '✅';
  if (editingId) {
    Object.assign(state.habits.find((h) => h.id === editingId), { name, emoji, color: draft.color, days: draft.days });
  } else {
    state.habits.push({ id: uid(), name, emoji, color: draft.color, days: draft.days, createdAt: todayKey() });
  }
  save();
  dialog.close();
  render();
  toast(editingId ? 'Gespeichert' : 'Gewohnheit angelegt');
});

$('#btn-cancel').addEventListener('click', () => dialog.close());
$('#btn-delete').addEventListener('click', () => {
  const h = state.habits.find((x) => x.id === editingId);
  if (!h || !confirm(`„${h.name}“ und alle Einträge wirklich löschen?`)) return;
  state.habits = state.habits.filter((x) => x.id !== editingId);
  delete state.log[editingId];
  save();
  dialog.close();
  render();
  toast('Gelöscht');
});
// Klick auf den Hintergrund schließt den Dialog
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

/* ---------- Ereignisse ---------- */

document.addEventListener('click', (e) => {
  const t = e.target;
  const tab = t.closest('[data-tab]');
  if (tab) return showView(tab.dataset.tab);

  const day = t.closest('[data-day]');
  if (day) { selectedKey = day.dataset.day; return renderToday(); }

  const tog = t.closest('[data-toggle]');
  if (tog) {
    const h = state.habits.find((x) => x.id === tog.dataset.toggle);
    const before = treeState();
    const nowDone = toggle(h, selectedKey);
    const after = treeState();
    if (nowDone && navigator.vibrate) navigator.vibrate(15);
    renderToday();
    if (nowDone) {
      const btn = [...document.querySelectorAll('[data-toggle]')].find((b) => b.dataset.toggle === h.id);
      btn && btn.classList.add('pop');
      const s = currentStreak(h);
      const isToday = selectedKey === todayKey();
      if (after.stage > before.stage) toast(`🌳 Dein Baum ist gewachsen: ${after.stageName}!`);
      else if (after.cans > before.cans) toast('💧 Du hast eine Gießkanne verdient!');
      else if (isToday && after.today.planned && after.today.done === after.today.planned) toast(`💧 Baum gegossen – +${Tree.RULES.perfect} Gesundheit`);
      else if (isToday && s > 1 && (s % 7 === 0 || s === 3 || s === 30 || s === 100)) toast(`🔥 ${s} Tage in Folge – stark!`);
    }
    return;
  }

  const ed = t.closest('[data-edit]');
  if (ed) return openDialog(state.habits.find((x) => x.id === ed.dataset.edit));

  const sug = t.closest('[data-suggest]');
  if (sug) return openDialog(null, { ...SUGGESTIONS[Number(sug.dataset.suggest)] });
});

$('#btn-add').addEventListener('click', () => openDialog(null));

/* ---------- Einstellungen ---------- */

$('#btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ app: 'gewohnheiten', version: 1, exportedAt: new Date().toISOString(), ...state }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gewohnheiten-backup-${todayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#input-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.habits) || typeof data.log !== 'object') throw new Error('format');
    const valid = data.habits.every((h) => h && typeof h.id === 'string' && typeof h.name === 'string' && Array.isArray(h.days) && h.days.every((x) => ALL_DAYS.includes(x)) && /^\d{4}-\d{2}-\d{2}$/.test(h.createdAt));
    if (!valid) throw new Error('format');
    if (state.habits.length && !confirm('Das Backup ersetzt deine aktuellen Daten. Fortfahren?')) return;
    state = {
      habits: data.habits.map((h) => ({ ...h, color: COLORS.includes(h.color) ? h.color : COLORS[0], emoji: String(h.emoji || '✅') })),
      log: data.log || {},
    };
    save();
    toast(`${state.habits.length} Gewohnheiten importiert`);
  } catch {
    toast('Diese Datei ist kein gültiges Backup.');
  }
});

$('#btn-reset').addEventListener('click', () => {
  if (!confirm('Wirklich alle Gewohnheiten und Einträge löschen?')) return;
  state = { habits: [], log: {} };
  save();
  toast('Alle Daten gelöscht');
});

// Installations-Button (Chrome/Android)
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('#btn-install').hidden = false;
});
$('#btn-install').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('#btn-install').hidden = true;
});

/* ---------- Start ---------- */

// Nach Mitternacht (oder beim Zurückkehren in die App) auf den neuen Tag springen
let lastToday = todayKey();
function checkDayChange() {
  const now = todayKey();
  if (now === lastToday) return;
  if (selectedKey === lastToday) selectedKey = now;
  lastToday = now;
  render();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDayChange(); });
setInterval(checkDayChange, 60 * 1000);

// Änderungen aus einem anderen Tab übernehmen
window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEY) { state = load(); render(); }
});

showView('today');

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
