'use strict';

const STORAGE_KEY = 'habits.v1';
const COLORS = [
  '#16a34a', '#65a30d', '#0d9488', '#0891b2', '#0284c7', '#2563eb', '#4f46e5', '#7c3aed', '#9333ea',
  '#c026d3', '#db2777', '#e11d48', '#dc2626', '#ea580c', '#d97706', '#ca8a04', '#78716c', '#475569',
];
const EMOJI_GROUPS = [
  ['Gesundheit', '💧 🥗 🍎 🥦 🥑 🍵 ☕ 😴 🛏️ 💊 🦷 🧴 🚭 🍷 🍬 🥤 🩺 ☀️'],
  ['Sport', '🏃 🚶 💪 🏋️ 🧘 🚴 🏊 ⚽ 🏀 🎾 🥾 🤸 🧗 🥊 🛹 ⛷️ 🏓 🤾'],
  ['Geist', '📚 📖 ✍️ 📓 🧠 🙏 🌅 😊 🫶 🧩 ♟️ 🎧 🌿 🕯️ 💭 🎯 🌙 🌈'],
  ['Lernen', '💻 🎓 🗣️ 🌍 🧮 📝 📅 ⏰ 💼 📊 🔬 🎸 🎹 🎨 📷 🎤 🧑‍💻 ✏️'],
  ['Zuhause', '🧹 🧺 🍳 🪴 🐶 🐱 🛒 🗑️ 🧽 🛁 🧼 🔧 💸 💰 📵 📞 👨‍👩‍👧 ❤️'],
].map(([name, list]) => ({ name, emojis: list.split(' ') }));
const HEX = /^#[0-9a-f]{6}$/i;
let emojiGroup = 0;
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
  mirror();
}

/** Kopie für den Service Worker, damit Erinnerungen den aktuellen Stand kennen. */
function mirror() {
  if (typeof indexedDB === 'undefined') return;
  Mirror.put('state', state).catch(() => {});
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

/** Bis zu dieser Uhrzeit darf der Vortag noch nachgetragen werden. */
const BACKFILL_UNTIL_HOUR = 12;
const yesterdayKey = () => keyOf(addDays(parseKey(todayKey()), -1));
const canBackfill = () => new Date().getHours() < BACKFILL_UNTIL_HOUR;

/** Hat gestern etwas offen gelassen, das man noch nachtragen könnte? */
function yesterdayIncomplete() {
  const y = parseKey(yesterdayKey());
  const planned = state.habits.filter((h) => isScheduled(h, y) && startOf(h) <= y);
  return planned.some((h) => !isDone(h, yesterdayKey()));
}

function renderToday() {
  // Nachtragen ist nur für gestern und nur bis mittags möglich
  if (selectedKey !== todayKey() && (selectedKey !== yesterdayKey() || !canBackfill())) selectedKey = todayKey();
  const sel = parseKey(selectedKey);
  const isToday = selectedKey === todayKey();
  const dateFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long' });
  $('#today-weekday').textContent = isToday
    ? new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }).format(sel)
    : `Nachtragen · ${dateFmt.format(sel)}`;
  $('#today-title').textContent = isToday ? 'Heute' : 'Gestern';

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
  if (isToday) {
    html = treeBanner(treeState()) + html;
    if (canBackfill() && yesterdayIncomplete()) {
      html += `<button type="button" class="link-btn" data-backfill="yes">Gestern vergessen einzutragen? Noch bis ${BACKFILL_UNTIL_HOUR} Uhr möglich</button>`;
    }
  } else {
    html = `<div class="banner">✏️ <div>Du trägst für <b>gestern</b> nach. Dein Baum wird automatisch neu berechnet. <button type="button" class="banner-link" data-backfill="no">Zurück zu heute</button></div></div>` + html;
  }
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
    return `<div class="banner danger">🥀 <div><b>Dein Baum geht heute Nacht ein!</b><br>Er würde auf „${esc(Tree.STAGES[Math.max(0, t.stage - 1)].name)}“ zurückfallen. ${(() => { const n = Tree.neededToSurvive(t); return n === 1 ? 'Schon 1 weitere Gewohnheit rettet ihn.' : `${n} weitere Gewohnheiten retten ihn.`; })()} ${btn}</div></div>`;
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
  else if (t.tonight.usesCan) todayText = `Heute ${done}/${planned} erledigt. Unter 50 % wird heute Nacht eine Gießkanne verbraucht.`;
  else {
    const d = t.tonight.delta;
    const gain = Tree.deltaFor((done + 1) / planned) - d;
    todayText = `Heute ${done}/${planned} erledigt. Stand jetzt: <b>${d > 0 ? '+' : ''}${d} Gesundheit</b>. Die nächste Gewohnheit bringt <b>+${gain}</b>, alles <b>+${Tree.RULES.perfect}</b>.`;
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
      case 'weak': return ['🍂', `${e.pct ?? '?'} % erledigt <span class="ev-delta">${e.delta} ❤️</span>`, date];
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
        <li><b>Gesundheit</b> wird jeden Abend abgerechnet, je nachdem wie viel du geschafft hast. Jede zusätzliche Gewohnheit zählt:
          <table class="curve">${[0, 25, 50, 70, 85, 100].map((p) => { const d = Tree.deltaFor(p / 100); return `<tr><td>${p} %</td><td class="${d < 0 ? 'neg' : d > 0 ? 'pos' : ''}">${d > 0 ? '+' : d === 0 ? '±' : ''}${d}</td></tr>`; }).join('')}</table></li>
        <li><b>Eingehen:</b> Fällt die Gesundheit auf 0, stirbt der Baum und fällt eine ganze Stufe zurück.</li>
        <li><b>Gießkannen:</b> Für ${Tree.RULES.canEvery} perfekte Tage in Folge gibt es eine Gießkanne (max. ${Tree.RULES.maxCans}). Sie rettet dich automatisch an einem Tag, an dem du unter 50 % bleibst.</li>
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
  if (currentView === 'settings') renderReminder();
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
  const presetEmoji = (habit || preset || {}).emoji;
  const found = EMOJI_GROUPS.findIndex((g) => g.emojis.includes(presetEmoji));
  emojiGroup = found >= 0 ? found : 0;
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
  const current = $('#f-emoji').value;
  $('#emoji-tabs').innerHTML = EMOJI_GROUPS.map((g, i) => `<button type="button" data-egroup="${i}" aria-pressed="${i === emojiGroup}">${g.name}</button>`).join('');
  $('#emoji-picks').innerHTML = EMOJI_GROUPS[emojiGroup].emojis.map((e) => `<button type="button" data-emoji="${e}" aria-label="Symbol ${e}" aria-pressed="${e === current}">${e}</button>`).join('');
  const custom = !COLORS.includes(draft.color);
  $('#swatches').innerHTML = COLORS.map((c) => `<button type="button" data-color="${c}" style="--c:${c}" aria-label="Farbe ${c}" aria-pressed="${c === draft.color}"></button>`).join('')
    + `<label class="custom-color" style="--c:${custom ? draft.color : 'transparent'}" aria-pressed="${custom}" title="Eigene Farbe">
        <input type="color" id="f-color" value="${custom ? draft.color : '#16a34a'}" aria-label="Eigene Farbe wählen"><span aria-hidden="true">${custom ? '' : '+'}</span></label>`;
  $('#day-toggles').innerHTML = WEEKDAYS.map((w, i) => `<button type="button" data-dayt="${i}" aria-pressed="${draft.days.includes(i)}">${w}</button>`).join('');
}

$('#emoji-picks').addEventListener('click', (e) => {
  const b = e.target.closest('[data-emoji]');
  if (!b) return;
  $('#f-emoji').value = b.dataset.emoji;
  renderDialogPickers();
});
$('#emoji-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-egroup]');
  if (!b) return;
  emojiGroup = Number(b.dataset.egroup);
  renderDialogPickers();
});
$('#swatches').addEventListener('input', (e) => {
  if (e.target.id !== 'f-color' || !HEX.test(e.target.value)) return;
  draft.color = e.target.value;
  const label = e.target.closest('.custom-color');
  label.style.setProperty('--c', draft.color);
  label.setAttribute('aria-pressed', 'true');
  label.querySelector('span').textContent = '';
  document.querySelectorAll('#swatches [data-color]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
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

  const bf = t.closest('[data-backfill]');
  if (bf) { selectedKey = bf.dataset.backfill === 'yes' ? yesterdayKey() : todayKey(); window.scrollTo(0, 0); return renderToday(); }

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

/* ---------- Erinnerungen ---------- */

const REMINDER_KEY = 'reminder.v1';
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

function loadReminder() {
  let cfg;
  try { cfg = JSON.parse(localStorage.getItem(REMINDER_KEY)); } catch { return null; }
  // Alte Version mit nur einer Uhrzeit -> abends
  if (cfg && cfg.evening === undefined && cfg.morning === undefined) {
    cfg = { ...cfg, morning: null, evening: cfg.hour ?? 19 };
    delete cfg.hour;
  }
  return cfg;
}
function saveReminder(cfg) {
  try {
    if (cfg) localStorage.setItem(REMINDER_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(REMINDER_KEY);
  } catch { /* ignorieren */ }
}

/** Owner/Repo aus der GitHub-Pages-Adresse ableiten (z. B. name.github.io/Repo/). */
function repoInfo() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  const repo = location.pathname.split('/').filter(Boolean)[0];
  return m && repo ? { owner: m[1], repo } : null;
}

function reminderSupport() {
  if (!('serviceWorker' in navigator) || !('Notification' in window)) return 'none';
  if (!('PushManager' in window)) {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return ios ? 'ios-install' : 'none';
  }
  return 'ok';
}

const SLOTS = {
  morning: { label: '☀️ Morgens', hours: [5, 6, 7, 8, 9, 10, 11, 12], fallback: 8 },
  evening: { label: '🌙 Abends', hours: [15, 16, 17, 18, 19, 20, 21, 22, 23], fallback: 20 },
};

function timeSelects(cfg) {
  return Object.entries(SLOTS).map(([slot, def]) => {
    const sel = cfg ? cfg[slot] : def.fallback;
    const opts = `<option value="" ${sel == null ? 'selected' : ''}>Aus</option>`
      + def.hours.map((h) => `<option value="${h}" ${h === sel ? 'selected' : ''}>${h}:00 Uhr</option>`).join('');
    return `<label class="field"><span>${def.label}</span><select data-slot="${slot}">${opts}</select></label>`;
  }).join('');
}

function readSelects() {
  const out = {};
  document.querySelectorAll('#reminder-body select[data-slot]').forEach((el) => { out[el.dataset.slot] = el.value === '' ? null : Number(el.value); });
  return out;
}

/** Das, was als GitHub-Secret gespeichert wird: Abo + Schlüssel + Uhrzeiten. */
function reminderCode(cfg) {
  return JSON.stringify({ v: 2, morning: cfg.morning, evening: cfg.evening, timezone: cfg.timezone, subscription: cfg.subscription, vapid: cfg.vapid });
}

function renderReminder() {
  const el = $('#reminder-body');
  const support = reminderSupport();
  if (support === 'ios-install') {
    el.innerHTML = `<p class="muted">Auf iPhone und iPad funktionieren Benachrichtigungen nur, wenn du die App <b>vom Home-Bildschirm</b> aus öffnest (ab iOS 16.4). Leg sie dort ab (siehe unten) und öffne sie dann von dort.</p>`;
    return;
  }
  if (support === 'none') {
    el.innerHTML = `<p class="muted">Dieser Browser unterstützt leider keine Benachrichtigungen für Web-Apps.</p>`;
    return;
  }
  if (Notification.permission === 'denied') {
    el.innerHTML = `<p class="muted">Benachrichtigungen sind blockiert. Erlaube sie in den Einstellungen deines Handys für diese App (iPhone: Einstellungen → Mitteilungen → Gewohnheiten).</p>`;
    return;
  }

  const cfg = loadReminder();
  if (!cfg) {
    el.innerHTML = `<div class="time-grid">${timeSelects(null)}</div>
      <button class="btn" type="button" id="btn-reminder-setup">Erinnerungen einrichten</button>`;
    return;
  }

  const info = repoInfo();
  const secretLink = info
    ? `<a href="https://github.com/${encodeURIComponent(info.owner)}/${encodeURIComponent(info.repo)}/settings/secrets/actions/new" target="_blank" rel="noopener">GitHub → Secrets</a>`
    : 'die Secrets-Seite deines GitHub-Repos (Settings → Secrets and variables → Actions)';
  const actionsLink = info
    ? `<a href="https://github.com/${encodeURIComponent(info.owner)}/${encodeURIComponent(info.repo)}/actions/workflows/reminder.yml" target="_blank" rel="noopener">GitHub → Actions → Erinnerung</a>`
    : 'GitHub → Actions → Erinnerung';
  el.innerHTML = `
    <div class="time-grid">${timeSelects(cfg)}</div>
    ${cfg.dirty ? `<div class="banner warn">⚠️ <div>Die Uhrzeiten wurden geändert. Kopiere den Code neu und <b>aktualisiere das Secret</b> <code>PUSH_CONFIG</code> bei GitHub, sonst gelten noch die alten Zeiten.</div></div>` : ''}
    <ol class="steps">
      <li><button class="btn btn-small" type="button" id="btn-reminder-copy">Code kopieren</button></li>
      <li>Öffne ${secretLink}. Name: <code>PUSH_CONFIG</code>, als Wert den Code einfügen, dann <b>Add secret</b>. Gibt es das Secret schon, bearbeite es stattdessen.</li>
      <li>Testen: ${actionsLink} → <b>Run workflow</b>. Nach ca. 30 Sekunden sollte die Benachrichtigung ankommen.</li>
    </ol>
    <details class="code-box"><summary>Code anzeigen</summary><textarea readonly id="reminder-code" rows="5">${esc(reminderCode(cfg))}</textarea></details>
    <p class="muted small">Der Code enthält einen geheimen Schlüssel für deine Benachrichtigungen. Speichere ihn nur als GitHub-Secret und teile ihn mit niemandem. Deine Gewohnheiten stehen nicht darin.</p>
    <div class="row">
      <button class="btn btn-ghost" type="button" data-preview="morning">Vorschau morgens</button>
      <button class="btn btn-ghost" type="button" data-preview="evening">Vorschau abends</button>
      <button class="btn btn-ghost btn-danger" type="button" id="btn-reminder-off">Deaktivieren</button>
    </div>`;
}

async function setupReminder() {
  const times = readSelects();
  if (times.morning == null && times.evening == null) return toast('Wähle mindestens eine Uhrzeit.');
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { renderReminder(); return toast('Ohne Erlaubnis gehen keine Benachrichtigungen.'); }
    const reg = await navigator.serviceWorker.ready;

    // Eigenes Schlüsselpaar (VAPID): Der öffentliche Teil geht an den Push-Dienst, der private ins GitHub-Secret
    const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
    const publicKey = b64url(await crypto.subtle.exportKey('raw', keys.publicKey));
    const privateKey = (await crypto.subtle.exportKey('jwk', keys.privateKey)).d;

    const old = await reg.pushManager.getSubscription();
    if (old) await old.unsubscribe();
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(publicKey) });

    saveReminder({
      ...times,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin',
      subscription: sub.toJSON(),
      vapid: { publicKey, privateKey },
    });
    renderReminder();
    toast('Fast fertig: Jetzt den Code bei GitHub hinterlegen');
  } catch (err) {
    console.error(err);
    toast('Einrichten fehlgeschlagen. Ist die App vom Home-Bildschirm geöffnet?');
  }
}

async function showPreview(slot) {
  const reg = await navigator.serviceWorker.ready;
  const msg = Tree.reminder(state.habits, state.log, todayKey(), slot);
  await reg.showNotification(msg.title, { body: msg.body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'reminder' });
}

async function disableReminder() {
  if (!confirm('Erinnerungen deaktivieren? Du kannst danach auch das Secret PUSH_CONFIG bei GitHub löschen.')) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch { /* egal */ }
  saveReminder(null);
  renderReminder();
  toast('Erinnerungen deaktiviert');
}

$('#reminder-body').addEventListener('click', async (e) => {
  const id = e.target.closest('button')?.id;
  if (id === 'btn-reminder-setup') setupReminder();
  const preview = e.target.closest('[data-preview]');
  if (preview) showPreview(preview.dataset.preview).catch(() => toast('Vorschau nicht möglich'));
  if (id === 'btn-reminder-off') disableReminder();
  if (id === 'btn-reminder-copy') {
    const code = reminderCode(loadReminder());
    try {
      await navigator.clipboard.writeText(code);
      toast('Code kopiert');
      const cfg = loadReminder();
      if (cfg.dirty) { delete cfg.dirty; saveReminder(cfg); renderReminder(); }
    } catch {
      const box = $('.code-box');
      box.open = true;
      $('#reminder-code').select();
      toast('Bitte den Code manuell kopieren');
    }
  }
});

$('#reminder-body').addEventListener('change', (e) => {
  if (!e.target.dataset.slot) return;
  const cfg = loadReminder();
  if (!cfg) return; // vor dem Einrichten nur Auswahl, noch nichts speichern
  const times = readSelects();
  if (times.morning == null && times.evening == null) {
    renderReminder();
    return toast('Mindestens eine Uhrzeit muss an sein. Zum Ausschalten „Deaktivieren“ nutzen.');
  }
  saveReminder({ ...cfg, ...times, dirty: true });
  renderReminder();
});

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
      habits: data.habits.map((h) => ({ ...h, color: HEX.test(h.color) ? h.color : COLORS[0], emoji: String(h.emoji || '✅') })),
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
  if (e.key === STORAGE_KEY) { state = load(); mirror(); render(); }
});

showView('today');
mirror();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
