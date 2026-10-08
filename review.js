'use strict';

/* ---------- Tagesabschluss & Wochenrückblick ---------- */

const MOODS = ['😫', '😕', '😐', '🙂', '🤩'];
const MOOD_NAMES = ['Mies', 'Eher schlecht', 'Okay', 'Gut', 'Super'];
const ENERGY_NAMES = ['Leer', 'Müde', 'Normal', 'Fit', 'Voller Energie'];
let journalDraft = null; // { k, mood, energy } während der Eingabe
let journalEditing = false;
// 0 = diese Woche, -1 = Vorwoche … (montags startet der Rückblick mit der abgeschlossenen Vorwoche)
let reviewOffset = weekdayIdx(new Date()) === 0 ? -1 : 0;

const fmt1 = (n) => n.toLocaleString('de-DE', { maximumFractionDigits: 1 });
const weekdayShort = (k) => WEEKDAYS[weekdayIdx(parseKey(k))];

/** Kennzahlen eines Tages für Rückblick und Abschluss. */
function dayStats(k) {
  const d = parseKey(k);
  const active = state.habits.filter((h) => startOf(h) <= d);
  const sc = Tree.dayScore(active, state.log, k, todoExtra(k));
  const todos = Plan.dayTodos(state.plan, k);
  return {
    k,
    planned: sc.planned,
    full: sc.full,
    pct: sc.planned ? Math.min(1, sc.done / sc.planned) : null,
    todos: todos.length,
    todosDone: todos.filter((t) => t.done).length,
    focus: Tree.focusMinutes(state.focus, k),
    mood: state.journal[k] ? state.journal[k].mood : null,
    energy: state.journal[k] ? state.journal[k].energy : null,
  };
}

/* ----- Tagesabschluss ----- */

/** Ab 19 Uhr rückt der Tagesabschluss nach oben, solange er noch nicht ausgefüllt ist. */
const journalDue = () => new Date().getHours() >= 19 && !state.journal[todayKey()];

function journalCardHtml() {
  const k = todayKey();
  const entry = state.journal[k];
  const st = dayStats(k);
  const t = treeState();
  const tonight = !t.today.planned ? 'Ruhetag für deinen Baum'
    : t.today.done >= t.today.planned ? `🌳 +${Tree.RULES.perfect} Gesundheit heute Nacht`
      : t.tonight.usesCan ? '💧 eine Gießkanne wird heute Nacht verbraucht'
        : `${t.tonight.delta >= 0 ? '+' : ''}${t.tonight.delta} Gesundheit heute Nacht`;
  const summary = `<div class="day-sum">
      <div><b>${st.full}/${st.planned}</b><span>erledigt</span></div>
      <div><b>${st.todosDone}/${st.todos}</b><span>To-dos</span></div>
      <div><b>${st.focus}</b><span>Min Fokus</span></div>
    </div>
    <p class="muted-sm day-sum-tree">${tonight}</p>`;

  if (entry && !journalEditing) {
    return `<div class="card journal-card" id="journal-card">
      <div class="card-head"><h2>🌙 Tagesabschluss</h2><button type="button" class="link-btn" data-jr="edit">Bearbeiten</button></div>
      ${summary}
      <div class="journal-saved">
        <span class="big-mood" aria-label="Stimmung: ${MOOD_NAMES[(entry.mood || 3) - 1]}">${entry.mood ? MOODS[entry.mood - 1] : '–'}</span>
        <div><b>${entry.mood ? MOOD_NAMES[entry.mood - 1] : 'Keine Stimmung'}</b>${entry.energy ? ` · Energie: ${ENERGY_NAMES[entry.energy - 1]}` : ''}
        ${entry.note ? `<p>${esc(entry.note)}</p>` : ''}</div>
      </div>
    </div>`;
  }
  if (!journalDraft || journalDraft.k !== k) journalDraft = { k, mood: entry ? entry.mood : null, energy: entry ? entry.energy : null };
  return `<div class="card journal-card" id="journal-card">
    <div class="card-head"><h2>🌙 Tagesabschluss</h2></div>
    ${summary}
    <div class="field"><span>Wie war dein Tag?</span>
      <div class="mood-row">${MOODS.map((m, i) => `<button type="button" data-jr="mood" data-v="${i + 1}" aria-pressed="${journalDraft.mood === i + 1}" aria-label="${MOOD_NAMES[i]}">${m}</button>`).join('')}</div>
    </div>
    <div class="field"><span>Energie</span>
      <div class="energy-row">${ENERGY_NAMES.map((n, i) => `<button type="button" data-jr="energy" data-v="${i + 1}" aria-pressed="${journalDraft.energy === i + 1}" aria-label="${n}" title="${n}">${'▮'.repeat(i + 1)}</button>`).join('')}</div>
    </div>
    <label class="field"><span>Notiz <small>(optional)</small></span>
      <textarea id="journal-note" rows="2" maxlength="500" placeholder="Was lief gut? Was nimmst du dir für morgen vor?">${esc(entry ? entry.note : '')}</textarea></label>
    <button type="button" class="btn" data-jr="save">Tag abschließen</button>
  </div>`;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-jr]');
  if (!b) return;
  const card = b.closest('#journal-card');
  switch (b.dataset.jr) {
    case 'mood':
    case 'energy':
      journalDraft[b.dataset.jr] = Number(b.dataset.v);
      card.querySelectorAll(`[data-jr="${b.dataset.jr}"]`).forEach((x) => x.setAttribute('aria-pressed', x === b));
      return;
    case 'edit':
      journalEditing = true;
      journalDraft = null;
      render();
      return;
    case 'save': {
      if (!journalDraft.mood) return toast('Wie war dein Tag? Tipp ein Gesicht an.');
      state.journal[todayKey()] = { mood: journalDraft.mood, energy: journalDraft.energy, note: (card.querySelector('#journal-note').value || '').trim().slice(0, 500) };
      journalEditing = false;
      save();
      render();
      toast(journalDraft.mood >= 4 ? '🌙 Schöner Tag! Gute Nacht.' : '🌙 Gespeichert. Morgen ist ein neuer Tag.');
    }
  }
});

/* ----- Wochenrückblick ----- */

function weekKeys(offset) {
  const start = parseKey(Tree.weekStart(todayKey()));
  const mon = addDays(start, offset * 7);
  return Array.from({ length: 7 }, (_, i) => keyOf(addDays(mon, i)));
}

/** Durchschnittliche Tagesquote einer Woche (nur vergangene Tage mit Plan). */
function weekAvg(keys) {
  const vals = keys.filter((k) => k <= todayKey()).map(dayStats).filter((s) => s.pct !== null);
  return vals.length ? vals.reduce((a, s) => a + s.pct, 0) / vals.length : null;
}

/** Wie gut lief jede Gewohnheit in dieser Woche? */
function habitWeekRates(keys) {
  const past = keys.filter((k) => k <= todayKey());
  const end = past[past.length - 1];
  return state.habits.map((h) => {
    if (keyOf(startOf(h)) > end) return null;
    if (Tree.isWeekly(h)) {
      return { h, rate: Math.min(1, Tree.weekCount(h, state.log, end) / Tree.weeklyTimes(h)), label: `${Tree.weekCount(h, state.log, end)}/${Tree.weeklyTimes(h)}×` };
    }
    const due = past.filter((k) => parseKey(k) >= startOf(h) && h.days.includes(weekdayIdx(parseKey(k))) && !isPausedOn(h, k));
    if (!due.length) return null;
    const sum = due.reduce((a, k) => a + Tree.progressOf(h, state.log, k), 0);
    return { h, rate: sum / due.length, label: `${due.filter((k) => isDone(h, k)).length}/${due.length} Tage` };
  }).filter(Boolean).sort((a, b) => b.rate - a.rate);
}

/** Muster der letzten 4 Wochen: An welchen Tagen ist die Stimmung besser? */
function moodInsight() {
  const keys = Array.from({ length: 28 }, (_, i) => keyOf(addDays(parseKey(todayKey()), -i))).filter((k) => state.journal[k] && state.journal[k].mood);
  if (keys.length < 6) return null;
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  let best = null;
  const consider = (label, yes, no) => {
    if (yes.length < 3 || no.length < 3) return;
    const diff = avg(yes) - avg(no);
    if (Math.abs(diff) >= 0.5 && (!best || Math.abs(diff) > Math.abs(best.diff))) best = { label, diff, yes: avg(yes), no: avg(no) };
  };
  for (const h of state.habits) {
    const rel = keys.filter((k) => parseKey(k) >= startOf(h) && !isPausedOn(h, k));
    consider(`${h.emoji} ${h.name}`, rel.filter((k) => isDone(h, k)).map((k) => state.journal[k].mood), rel.filter((k) => !isDone(h, k)).map((k) => state.journal[k].mood));
  }
  consider('🎯 mindestens 25 Min Fokus', keys.filter((k) => Tree.focusMinutes(state.focus, k) >= 25).map((k) => state.journal[k].mood), keys.filter((k) => Tree.focusMinutes(state.focus, k) < 25).map((k) => state.journal[k].mood));
  return best;
}

/** Kleines Balkendiagramm: eine Reihe, ein Farbton, Wert beim Antippen. */
function barChart(id, days, valueOf, fmtValue, max, color) {
  const bars = days.map((s) => {
    const future = s.k > todayKey();
    const v = future ? null : valueOf(s);
    const h = v === null || !max ? 0 : Math.max(v > 0 ? 4 : 0, Math.round((v / max) * 100));
    const label = `${weekdayShort(s.k)}: ${v === null ? (future ? 'noch nicht' : 'nichts geplant') : fmtValue(v, s)}`;
    return `<button type="button" class="bar-col ${s.k === todayKey() ? 'is-today' : ''}" data-tip="${esc(label)}" aria-label="${esc(label)}">
      <span class="bar-slot"><i style="height:${h}%;background:${color}"></i></span>
      <span class="bar-day">${weekdayShort(s.k)}</span></button>`;
  }).join('');
  return `<div class="bar-chart" id="${id}">${bars}</div><div class="bar-tip" id="${id}-tip" aria-live="polite">Tippe auf einen Tag für Details</div>`;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('.bar-col');
  if (!b) return;
  const chart = b.closest('.bar-chart');
  chart.querySelectorAll('.bar-col').forEach((x) => x.classList.toggle('sel', x === b));
  const tip = document.getElementById(`${chart.id}-tip`);
  if (tip) tip.textContent = b.dataset.tip;
});
document.addEventListener('pointerover', (e) => {
  const b = e.target.closest && e.target.closest('.bar-col');
  if (!b || e.pointerType === 'touch') return;
  const tip = document.getElementById(`${b.closest('.bar-chart').id}-tip`);
  if (tip) tip.textContent = b.dataset.tip;
});

function weekReviewHtml() {
  if (!state.habits.length) return '';
  const keys = weekKeys(reviewOffset);
  const days = keys.map(dayStats);
  const past = days.filter((s) => s.k <= todayKey());
  const avg = weekAvg(keys);
  const prev = weekAvg(weekKeys(reviewOffset - 1));
  const perfect = past.filter((s) => s.pct !== null && s.pct >= 1).length;
  const rates = habitWeekRates(keys);
  const focusTotal = past.reduce((a, s) => a + s.focus, 0);
  const moods = past.filter((s) => s.mood);
  const moodAvg = moods.length ? moods.reduce((a, s) => a + s.mood, 0) / moods.length : null;
  const weekTodoList = state.plan.tasks.filter((t) => keys.includes(t.date) && t.date <= todayKey());
  const todosDone = weekTodoList.filter((t) => t.done).length;
  // Baum: Stand vor der Woche vs. jetzt / Wochenende
  const endKey = keys[6] < todayKey() ? keys[6] : todayKey();
  const before = Tree.simulate(state.habits, state.log, Plan.addDays(keys[0], -1), todoExtra);
  const after = Tree.simulate(state.habits, state.log, endKey, todoExtra);
  const growthGain = after.growth - before.growth;
  const healthDiff = after.health - before.health;
  const insight = reviewOffset === 0 ? moodInsight() : null;
  const fmtRange = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
  const title = reviewOffset === 0 ? 'Diese Woche' : reviewOffset === -1 ? 'Letzte Woche' : `Woche vom ${fmtRange.format(parseKey(keys[0]))}`;
  const trend = avg !== null && prev !== null
    ? (() => { const d = Math.round((avg - prev) * 100); return d === 0 ? 'wie letzte Woche' : `${d > 0 ? '▲' : '▼'} ${Math.abs(d)} Punkte zur Vorwoche`; })()
    : '';
  const maxFocus = Math.max(25, ...past.map((s) => s.focus));
  const best = rates[0];
  const worst = rates.length > 1 ? rates[rates.length - 1] : null;

  return `<div class="card review-card">
    <div class="review-nav">
      <button type="button" data-rv="-1" aria-label="Vorherige Woche">‹</button>
      <div><h2>📊 ${title}</h2><span class="muted-sm">${fmtRange.format(parseKey(keys[0]))} – ${fmtRange.format(parseKey(keys[6]))}</span></div>
      <button type="button" data-rv="1" aria-label="Nächste Woche" ${reviewOffset >= 0 ? 'disabled' : ''}>›</button>
    </div>
    <div class="review-hero">
      <div><b>${avg === null ? '–' : Math.round(avg * 100) + ' %'}</b><span>Ø Tagesquote</span></div>
      <div><b>${perfect}</b><span>perfekte ${perfect === 1 ? 'Tag' : 'Tage'}</span></div>
      <div><b>${focusTotal >= 60 ? fmt1(focusTotal / 60) + ' h' : focusTotal + ' Min'}</b><span>Fokus</span></div>
    </div>
    ${trend ? `<p class="trend ${trend.startsWith('▲') ? 'up' : trend.startsWith('▼') ? 'down' : ''}">${trend}</p>` : ''}
    <h3 class="chart-title">Tagesquote</h3>
    ${barChart(`rv-pct-${reviewOffset}`, days, (s) => s.pct, (v, s) => `${Math.round(v * 100)} % · ${s.full} von ${s.planned} geschafft${s.mood ? ' · ' + MOODS[s.mood - 1] : ''}`, 1, 'var(--accent)')}
    <h3 class="chart-title">Fokus</h3>
    ${barChart(`rv-focus-${reviewOffset}`, days, (s) => s.focus, (v) => `${v} Min Fokus`, maxFocus, '#7c3aed')}
    <ul class="review-list">
      ${best ? `<li>💪 <span>Am stärksten: <b>${esc(best.h.emoji)} ${esc(best.h.name)}</b></span><em>${best.label}</em></li>` : ''}
      ${worst && worst.rate < best.rate ? `<li>🎯 <span>Da geht noch was: <b>${esc(worst.h.emoji)} ${esc(worst.h.name)}</b></span><em>${worst.label}</em></li>` : ''}
      ${weekTodoList.length ? `<li>✅ <span>To-dos erledigt</span><em>${todosDone}/${weekTodoList.length}</em></li>` : ''}
      <li>🌳 <span>Dein Baum</span><em>${growthGain >= 0 ? '+' : ''}${growthGain} Wachstum · ${healthDiff >= 0 ? '+' : ''}${healthDiff} Gesundheit</em></li>
      ${moodAvg !== null ? `<li>${MOODS[Math.round(moodAvg) - 1]} <span>Ø Stimmung</span><em>${fmt1(moodAvg)} / 5 · ${moods.length} ${moods.length === 1 ? 'Abschluss' : 'Abschlüsse'}</em></li>` : ''}
    </ul>
    ${insight ? `<div class="insight">💡 <div><b>Muster der letzten 4 Wochen:</b> An Tagen mit ${esc(insight.label)} war deine Stimmung im Schnitt <b>${fmt1(insight.yes)}</b>, sonst <b>${fmt1(insight.no)}</b>.</div></div>`
      : reviewOffset === 0 && moods.length < 6 ? `<p class="muted-sm review-hint">Mach abends den 🌙 Tagesabschluss – nach ein paar Tagen erkenne ich Muster, z. B. an welchen Tagen es dir besser geht.</p>` : ''}
  </div>`;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-rv]');
  if (!b || b.disabled) return;
  reviewOffset = Math.min(0, reviewOffset + Number(b.dataset.rv));
  render();
});

/** Hinweis am Sonntagabend und Montag: der Rückblick ist da. */
function reviewBanner() {
  const d = new Date();
  const wd = weekdayIdx(d);
  if (!(wd === 6 && d.getHours() >= 17) && wd !== 0) return '';
  if (!state.habits.length) return '';
  return `<div class="banner">📊 <div>${wd === 6 ? 'Deine Woche ist fast rum.' : 'Neue Woche!'} Schau dir deinen <button type="button" class="banner-link" data-tab="stats">Wochenrückblick</button> an.</div></div>`;
}
