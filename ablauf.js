'use strict';

/* ---------- Ansicht: Ablauf (Tagesplan) ---------- */

let planMode = 'today'; // 'today' | 'edit'
let editTplId = null;
let editingBlock = null; // { tplId, blockId | null, cat, habitIds }
let slotDraft = null; // { habitIds: Set, todoId }

const minNow = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const durText = (m) => {
  const h = Math.floor(m / 60), r = m % 60;
  if (!h) return `${r} Min`;
  return r ? `${h} Std ${r} Min` : `${h} Std`;
};
const catOf = (b) => Plan.CATEGORIES[b.cat] || Plan.CATEGORIES.other;
const blockEmoji = (b) => b.emoji || catOf(b).emoji;
const findTpl = (id) => state.plan.templates.find((t) => t.id === id);
const stepsHtml = (steps) => (steps.length
  ? `<div class="steps-flow">${steps.map((s) => `<span>${esc(s)}</span>`).join('<i aria-hidden="true">→</i>')}</div>`
  : '');

function renderPlan() {
  const el = $('#plan-content');
  const btn = $('#plan-head-btn');
  if (!state.plan.templates.length) {
    $('#plan-eyebrow').textContent = '';
    $('#plan-title').textContent = 'Dein Tag';
    btn.hidden = true;
    el.innerHTML = `<div class="card plan-intro">
      <div class="big">🗓️</div>
      <h2>Plane deinen perfekten Tag</h2>
      <p class="muted">Leg Tagestypen an, z. B. einen <b>Uni-Tag</b> und ein <b>Wochenende</b>, mit festen Zeiten für Morgenroutine, Vorlesung, Essen, Sport und Schlaf.
      Jedem Wochentag ordnest du einen Typ zu. Die App zeigt dir dann jederzeit, was gerade dran ist und was als Nächstes kommt.</p>
      <div class="row">
        <button class="btn" type="button" data-pa="starter">Mit Vorlage starten</button>
        <button class="btn btn-ghost" type="button" data-pa="blank">Leer starten</button>
      </div>
    </div>`;
    return;
  }
  btn.hidden = false;
  if (planMode === 'edit') renderPlanEditor(el, btn);
  else renderPlanToday(el, btn);
}

/* ----- Heute: Live-Zeitleiste ----- */

const shortDate = (k) => new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' }).format(parseKey(k));

function taskHtml(t, showTime) {
  return `<div class="task ${t.done ? 'done' : ''}">
    <button type="button" class="task-check" data-pa="task-toggle" data-id="${esc(t.id)}" aria-pressed="${t.done}" aria-label="${esc(t.title)} ${t.done ? 'als offen markieren' : 'erledigt'}">${t.done ? '✓' : ''}</button>
    <span class="task-title">${esc(t.title)}</span>
    ${showTime && t.time ? `<span class="task-time">${t.time}</span>` : ''}
    <button type="button" class="task-del" data-pa="task-del" data-id="${esc(t.id)}" aria-label="To-do löschen">×</button>
  </div>`;
}

function habitChips(ids) {
  const chips = ids.map((id) => {
    const h = state.habits.find((x) => x.id === id);
    if (!h) return '';
    const done = isDone(h, todayKey());
    return `<button type="button" class="tl-habit ${done ? 'on' : ''}" data-pa="habit" data-id="${esc(h.id)}" style="--hc:${h.color}" aria-pressed="${done}">
      <span class="mini-check" aria-hidden="true">${done ? '✓' : ''}</span>${esc(h.emoji)} ${esc(h.name)}</button>`;
  }).join('');
  return chips ? `<div class="habit-chips">${chips}</div>` : '';
}

/** Freie Lücken des Tages (mind. 15 Min), die noch nicht vorbei sind. */
function freeGaps(items, now) {
  const gaps = [];
  let lastEnd = null;
  for (const b of items) {
    if (lastEnd !== null && b.s - lastEnd >= 15) gaps.push({ s: lastEnd, e: b.s });
    if (b.e !== null) lastEnd = Math.max(lastEnd ?? 0, b.e);
  }
  return gaps.filter((g) => g.e > now);
}

/** Gewohnheiten, die heute fällig sind, aber in keinem Block des Tages stehen. */
function unplannedHabits(items) {
  const placed = new Set(items.flatMap((b) => b.habitIds));
  const today = parseKey(todayKey());
  return state.habits.filter((h) => isScheduled(h, today) && !placed.has(h.id));
}

function todoCard(today) {
  const plan = state.plan;
  const day = Plan.dayTodos(plan, today).sort((a, b) => a.done - b.done || (a.time || '99').localeCompare(b.time || '99'));
  const week = Plan.weekTodos(plan, today).sort((a, b) => a.done - b.done);
  const overdue = Plan.overdueTodos(plan, today);
  const tomorrow = Plan.dayTodos(plan, Plan.addDays(today, 1)).filter((t) => !t.done).length;
  const st = Plan.todoStatus(plan, today);
  const badge = st.planned
    ? `<span class="todo-badge ${st.done ? 'on' : ''}">${st.done ? '🌳 Bonus geschafft' : `${st.doneCount}/${st.total} · 🌳 Bonus`}</span>`
    : '';
  return `<div class="card tasks-card">
    <div class="card-head"><h2>To-dos</h2>${badge}</div>
    ${day.length ? day.map((t) => taskHtml(t, true)).join('') : '<p class="muted-sm hint">Für heute nichts Besonderes. Was musst du heute auf jeden Fall erledigen?</p>'}
    ${week.length ? `<div class="section-label todo-week">Diese Woche · bis ${shortDate(Plan.weekEnd(today))}</div>${week.map((t) => taskHtml(t, false)).join('')}` : ''}
    <form class="task-add" data-pa="add-task">
      <input id="task-title" maxlength="80" placeholder="Neues To-do, z. B. Müll rausbringen" autocomplete="off" aria-label="Neues To-do">
      <div class="task-add-row">
        <select id="task-day" aria-label="Wann"><option value="0">Heute</option><option value="1">Morgen</option><option value="week">Diese Woche</option></select>
        <input type="time" id="task-time" aria-label="Uhrzeit (optional)">
        <button class="btn btn-small" type="submit">Hinzufügen</button>
      </div>
    </form>
    ${st.planned ? '<p class="muted-sm hint">Alle To-dos von heute erledigt zählt für deinen Baum wie eine zusätzliche Gewohnheit.</p>' : ''}
    ${tomorrow ? `<p class="muted-sm hint">Für morgen ${tomorrow === 1 ? 'ist 1 To-do' : `sind ${tomorrow} To-dos`} geplant.</p>` : ''}
    ${overdue.length ? `<div class="overdue"><div class="section-label">Liegen geblieben</div>
      ${overdue.map((t) => `<div class="task">
        <span class="task-title">${esc(t.title)} <small class="muted-sm">${t.week ? 'Woche bis ' + shortDate(Plan.weekEnd(t.date)) : shortDate(t.date)}</small></span>
        <button type="button" class="btn btn-small btn-ghost" data-pa="task-today" data-id="${esc(t.id)}">Auf heute</button>
        <button type="button" class="task-del" data-pa="task-del" data-id="${esc(t.id)}" aria-label="To-do löschen">×</button>
      </div>`).join('')}</div>` : ''}
  </div>`;
}

function renderPlanToday(el, btn) {
  const today = todayKey();
  const tpl = Plan.templateFor(state.plan, today);
  const items = Plan.dayTimeline(state.plan, today);
  const now = minNow();
  const st = Plan.status(items, now);

  $('#plan-eyebrow').textContent = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  $('#plan-title').textContent = tpl ? `${tpl.emoji} ${tpl.name}` : '🌴 Freier Tag';
  btn.textContent = 'Bearbeiten';

  // Heute ein anderer Tagestyp?
  const stdId = state.plan.weekdays[weekdayIdx(new Date())];
  const std = findTpl(stdId);
  const override = state.plan.overrides[today] || '';
  const switcher = `<label class="day-switch"><span>Heute:</span>
    <select data-pa="override" aria-label="Tagestyp für heute">
      <option value="" ${!override ? 'selected' : ''}>Wie immer (${std ? esc(std.name) : 'frei'})</option>
      ${state.plan.templates.filter((t) => t.id !== stdId).map((t) => `<option value="${esc(t.id)}" ${override === t.id ? 'selected' : ''}>${esc(t.emoji)} ${esc(t.name)}</option>`).join('')}
      ${stdId ? `<option value="none" ${override === 'none' ? 'selected' : ''}>🌴 Freier Tag</option>` : ''}
    </select></label>`;

  // Karte: Was ist jetzt dran?
  let nowCard = '';
  if (st.current) {
    const c = st.current;
    const total = c.e !== null ? c.e - c.s : null;
    const pct = total ? Math.min(100, Math.round(((now - c.s) / total) * 100)) : null;
    nowCard = `<div class="now-card" style="--c:${catOf(c).color}">
      <div class="now-label">Jetzt</div>
      <div class="now-title">${esc(blockEmoji(c))} ${esc(c.title)}</div>
      <div class="now-meta">${c.e !== null ? `bis ${Plan.fmt(c.e)} · noch ${durText(c.e - now)}` : `seit ${c.start}`}</div>
      ${pct !== null ? `<div class="bar"><i style="width:${pct}%;background:var(--c)"></i></div>` : ''}
      ${stepsHtml(c.steps)}
      ${habitChips(c.habitIds)}
      ${st.next ? `<div class="now-next">Danach um <b>${st.next.start}</b>: ${esc(blockEmoji(st.next))} ${esc(st.next.title)}</div>` : ''}
    </div>`;
  } else if (st.next) {
    const n = st.next;
    nowCard = `<div class="now-card" style="--c:${catOf(n).color}">
      <div class="now-label">${st.before ? 'Dein Tag startet' : 'Als Nächstes'} in ${durText(n.s - now)}</div>
      <div class="now-title">${esc(blockEmoji(n))} ${esc(n.title)}</div>
      <div class="now-meta">um ${n.start}${n.e !== null ? ` · ${durText(n.e - n.s)}` : ''}</div>
      ${stepsHtml(n.steps)}
    </div>`;
  } else if (items.length) {
    const tmr = Plan.addDays(today, 1);
    const t2 = Plan.templateFor(state.plan, tmr);
    const first = Plan.dayTimeline(state.plan, tmr)[0];
    nowCard = `<div class="now-card" style="--c:#475569">
      <div class="now-label">Feierabend</div>
      <div class="now-title">🌙 Der Tag ist geschafft</div>
      <div class="now-meta">Morgen: ${t2 ? `${esc(t2.emoji)} ${esc(t2.name)}${first ? ` ab ${first.start}` : ''}` : '🌴 freier Tag'}</div>
    </div>`;
  }

  // Fällige Gewohnheiten ohne festen Platz im Tag
  const unplanned = unplannedHabits(items);
  const unplannedHtml = unplanned.length ? `<div class="unplanned">
      <div class="unplanned-head">Noch nicht eingeplant <span class="muted-sm">· antippen zum Einplanen</span></div>
      <div class="habit-chips">${unplanned.map((h) => `<button type="button" class="tl-habit plan-me ${isDone(h, today) ? 'on' : ''}" data-pa="plan-habit" data-id="${esc(h.id)}" style="--hc:${h.color}">
        <span class="mini-check" aria-hidden="true">${isDone(h, today) ? '✓' : '+'}</span>${esc(h.emoji)} ${esc(h.name)}</button>`).join('')}</div>
    </div>` : '';

  // Zeitleiste: Blöcke und To-dos mit Uhrzeit, dazu freie Lücken und die Jetzt-Linie
  const timedTodos = Plan.dayTodos(state.plan, today).filter((t) => t.time);
  const rows = [
    ...items.map((b) => ({ m: b.s, kind: 'block', b })),
    ...timedTodos.map((t) => ({ m: Plan.toMin(t.time), kind: 'task', t })),
  ].sort((a, b) => a.m - b.m || (a.kind === 'block' ? -1 : 1));

  let tl = '';
  let nowPlaced = !!st.current;
  let lastEnd = null;
  const nowLine = `<li class="tl-now" id="tl-now"><span>${Plan.fmt(now)}</span></li>`;
  for (const r of rows) {
    if (r.kind === 'block' && lastEnd !== null && r.b.s - lastEnd >= 15) {
      const g = { s: lastEnd, e: r.b.s };
      if (!nowPlaced && g.s > now) { tl += nowLine; nowPlaced = true; }
      const open = g.e > now;
      const from = Math.max(g.s, open ? now : g.s);
      tl += `<li class="tl-gap ${open ? '' : 'past'}"><span>Freie Zeit · ${durText(g.e - from)}${open && from > g.s ? ' übrig' : ''}</span>
        ${open ? `<button type="button" class="gap-add" data-pa="fill-gap" data-s="${g.s}" data-e="${g.e}">+ Einplanen</button>` : ''}</li>`;
    }
    if (!nowPlaced && r.m > now) { tl += nowLine; nowPlaced = true; }
    if (r.kind === 'task') {
      tl += `<li class="tl-item tl-task ${r.t.done ? 'past' : ''}"><div class="tl-time">${r.t.time}</div><div class="tl-dot"></div>
        <div class="tl-card">${taskHtml(r.t, false)}</div></li>`;
      continue;
    }
    const b = r.b;
    if (b.e !== null) lastEnd = Math.max(lastEnd ?? 0, b.e);
    const isNow = st.current && st.current.id === b.id;
    const isPast = !isNow && b.e !== null && now >= b.e;
    tl += `<li class="tl-item ${isNow ? 'now' : isPast ? 'past' : ''}" style="--c:${catOf(b).color}" ${isNow ? 'id="tl-current"' : ''}>
      <div class="tl-time">${b.start}${b.e !== null ? `<small>${Plan.fmt(b.e)}</small>` : ''}</div>
      <div class="tl-dot"></div>
      <div class="tl-card ${b.oneOff ? 'one-off' : ''}">
        ${b.oneOff ? `<button type="button" class="one-off-del" data-pa="del-oneoff" data-id="${esc(b.id)}" aria-label="Aus dem heutigen Plan entfernen">×</button>` : ''}
        <div class="tl-title">${esc(blockEmoji(b))} ${esc(b.title)}</div>
        <div class="tl-meta">${b.e !== null ? durText(b.e - b.s) : 'offen'}${b.oneOff ? ' · nur heute' : ''}${isNow ? ' · <b>läuft gerade</b>' : ''}</div>
        ${isPast ? '' : stepsHtml(b.steps)}
        ${habitChips(b.habitIds)}
      </div>
    </li>`;
  }
  if (!nowPlaced && rows.length) tl += nowLine;

  const timelineHtml = rows.length
    ? `<ol class="timeline">${tl}</ol>`
    : `<div class="empty"><div class="big">🌴</div><p>${tpl ? 'Dieser Tagestyp hat noch keine Zeitblöcke.' : 'Heute ist kein Ablauf geplant. Genieß den Tag!'}</p>
       <button type="button" class="btn btn-ghost" data-pa="fill-gap" data-s="${Math.ceil(now / 15) * 15}" data-e="${Math.ceil(now / 15) * 15 + 60}">+ Etwas einplanen</button></div>`;

  el.innerHTML = switcher + nowCard + todoCard(today) + unplannedHtml + `<div class="section-label">Dein Tag</div>` + timelineHtml;
}

/* ----- Bearbeiten: Tagestypen, Wochentage, Zeitblöcke ----- */

function renderPlanEditor(el, btn) {
  const tpls = state.plan.templates;
  if (!findTpl(editTplId)) editTplId = tpls[0].id;
  const tpl = findTpl(editTplId);
  $('#plan-eyebrow').textContent = 'Tagestypen & Zeiten';
  $('#plan-title').textContent = 'Ablauf planen';
  btn.textContent = 'Fertig';

  const chips = tpls.map((t) => `<button type="button" data-pa="pick-tpl" data-id="${esc(t.id)}" aria-pressed="${t.id === tpl.id}">${esc(t.emoji)} ${esc(t.name)}</button>`).join('')
    + `<button type="button" data-pa="new-tpl" class="add-chip">+ Neuer Tagestyp</button>`;

  const week = WEEKDAYS.map((w, i) => {
    const t = findTpl(state.plan.weekdays[i]);
    return `<div><b>${w}</b><span>${t ? esc(t.emoji) : '🌴'}</span></div>`;
  }).join('');

  const blocks = Plan.timeline(tpl).map((b) => `<button type="button" class="block-row" data-pa="edit-block" data-id="${esc(b.id)}" style="--c:${catOf(b).color}">
      <span class="block-time">${b.start}${b.e !== null ? `<small>bis ${Plan.fmt(b.e)}</small>` : ''}</span>
      <span class="block-name">${esc(blockEmoji(b))} ${esc(b.title)}${b.steps.length ? ` <small>· ${b.steps.length} Schritte</small>` : ''}${b.habitIds.length ? ` <small>· ${b.habitIds.map((id) => esc((state.habits.find((h) => h.id === id) || {}).emoji || '')).join('')}</small>` : ''}</span>
      <span class="block-edit" aria-hidden="true">›</span>
    </button>`).join('');

  el.innerHTML = `
    <div class="tpl-chips" role="tablist">${chips}</div>
    <div class="card">
      <div class="tpl-name-row">
        <input class="tpl-emoji" data-pa="tpl-emoji" value="${esc(tpl.emoji)}" maxlength="8" aria-label="Symbol des Tagestyps">
        <input class="tpl-name" data-pa="tpl-name" value="${esc(tpl.name)}" maxlength="40" aria-label="Name des Tagestyps">
      </div>
      <div class="field"><span>Gilt an diesen Tagen</span>
        <div class="days">${WEEKDAYS.map((w, i) => `<button type="button" data-pa="tpl-day" data-day="${i}" aria-pressed="${state.plan.weekdays[i] === tpl.id}">${w}</button>`).join('')}</div>
      </div>
      <div class="week-overview" aria-label="Wochenübersicht">${week}</div>
      <div class="row">
        <button class="btn btn-ghost btn-small" type="button" data-pa="dup-tpl">Duplizieren</button>
        <button class="btn btn-ghost btn-small btn-danger-text" type="button" data-pa="del-tpl">Löschen</button>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Zeitblöcke</h2><span class="muted-sm">${tpl.blocks.length}</span></div>
      ${blocks || '<p class="muted">Noch keine Zeitblöcke. Füge deinen ersten hinzu, z. B. die Morgenroutine.</p>'}
      <button class="btn" type="button" data-pa="new-block">+ Zeitblock hinzufügen</button>
    </div>`;
}

/* ----- Dialog: Zeitblock ----- */

const blockDialog = $('#block-dialog');

function openBlockDialog(tplId, blockId) {
  const tpl = findTpl(tplId);
  const b = blockId ? tpl.blocks.find((x) => x.id === blockId) : null;
  const items = Plan.timeline(tpl);
  const last = items[items.length - 1];
  const defStart = last ? Plan.fmt(last.e !== null ? last.e % 1440 : (last.s + 60) % 1440) : '08:00';
  editingBlock = { tplId, blockId: b ? b.id : null, cat: b ? b.cat : 'routine' };
  $('#block-dialog-title').textContent = b ? 'Zeitblock bearbeiten' : 'Neuer Zeitblock';
  $('#b-title').value = b ? b.title : '';
  $('#b-start').value = b ? b.start : defStart;
  $('#b-end').value = b && b.end ? b.end : '';
  $('#b-emoji').value = b ? b.emoji : '';
  $('#b-emoji').placeholder = catOf(editingBlock).emoji;
  $('#b-steps').value = b ? b.steps.join('\n') : '';
  editingBlock.habitIds = new Set(b ? b.habitIds : []);
  renderHabitPick('#b-habits', editingBlock.habitIds);
  $('#b-habit-field').hidden = !state.habits.length;
  $('#btn-block-delete').hidden = !b;
  renderCatChips();
  blockDialog.showModal();
  if (!b) $('#b-title').focus();
}

/** Auswahl-Chips für Gewohnheiten (Mehrfachauswahl). */
function renderHabitPick(sel, selected, highlight = []) {
  $(sel).innerHTML = state.habits.map((h) => `<button type="button" data-hpick="${esc(h.id)}" style="--hc:${h.color}" aria-pressed="${selected.has(h.id)}" class="${highlight.includes(h.id) ? 'suggest' : ''}">${esc(h.emoji)} ${esc(h.name)}</button>`).join('');
}

function renderCatChips() {
  $('#b-cats').innerHTML = Object.entries(Plan.CATEGORIES).map(([key, c]) => `<button type="button" data-cat="${key}" style="--c:${c.color}" aria-pressed="${key === editingBlock.cat}">${c.emoji} ${c.name}</button>`).join('');
  $('#b-emoji').placeholder = Plan.CATEGORIES[editingBlock.cat].emoji;
}

$('#b-cats').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  editingBlock.cat = b.dataset.cat;
  renderCatChips();
});

$('#b-habits').addEventListener('click', (e) => {
  const b = e.target.closest('[data-hpick]');
  if (!b) return;
  const id = b.dataset.hpick;
  if (editingBlock.habitIds.has(id)) editingBlock.habitIds.delete(id); else editingBlock.habitIds.add(id);
  b.setAttribute('aria-pressed', editingBlock.habitIds.has(id));
});

$('#block-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const title = $('#b-title').value.trim();
  const start = $('#b-start').value;
  const end = $('#b-end').value;
  if (!title) return $('#b-title').focus();
  if (!Plan.TIME.test(start)) return toast('Bitte eine Startzeit wählen.');
  const data = {
    title: title.slice(0, 60),
    start,
    end: Plan.TIME.test(end) && end !== start ? end : null,
    emoji: $('#b-emoji').value.trim().slice(0, 8),
    cat: editingBlock.cat,
    steps: $('#b-steps').value.split('\n').map((s) => s.trim().slice(0, 60)).filter(Boolean).slice(0, 12),
    habitIds: [...editingBlock.habitIds].filter((id) => state.habits.some((h) => h.id === id)),
  };
  const tpl = findTpl(editingBlock.tplId);
  if (editingBlock.blockId) Object.assign(tpl.blocks.find((x) => x.id === editingBlock.blockId), data);
  else tpl.blocks.push({ id: Plan.newId(), ...data });
  save();
  blockDialog.close();
  renderPlan();
});

$('#btn-block-cancel').addEventListener('click', () => blockDialog.close());
$('#btn-block-delete').addEventListener('click', () => {
  const tpl = findTpl(editingBlock.tplId);
  const b = tpl.blocks.find((x) => x.id === editingBlock.blockId);
  if (!b || !confirm(`„${b.title}“ löschen?`)) return;
  tpl.blocks = tpl.blocks.filter((x) => x.id !== b.id);
  save();
  blockDialog.close();
  renderPlan();
});
blockDialog.addEventListener('click', (e) => { if (e.target === blockDialog) blockDialog.close(); });

/* ----- Dialog: Freie Zeit einplanen (nur für heute) ----- */

const slotDialog = $('#slot-dialog');
const roundUp = (m, step) => Math.ceil(m / step) * step;

function openSlotDialog(gapS, gapE, habitId) {
  const now = minNow();
  const start = gapS <= now && now < gapE ? Math.min(roundUp(now, 5), gapE - 5) : gapS;
  const end = Math.min(gapE, start + 30);
  const items = Plan.dayTimeline(state.plan, todayKey());
  const unplanned = unplannedHabits(items).map((h) => h.id);
  slotDraft = { habitIds: new Set(habitId ? [habitId] : []), todoId: null };
  $('#slot-sub').textContent = gapE > gapS ? `Freie Zeit von ${Plan.fmt(gapS)} bis ${Plan.fmt(gapE % 1440)} · gilt nur für heute` : 'Gilt nur für heute';
  $('#s-start').value = Plan.fmt(start % 1440);
  $('#s-end').value = Plan.fmt(end % 1440);
  $('#s-custom').value = '';
  renderHabitPick('#s-habits', slotDraft.habitIds, unplanned);
  $('#s-habits-field').hidden = !state.habits.length;
  const today = todayKey();
  const todos = [...Plan.dayTodos(state.plan, today).filter((t) => !t.done && !t.time), ...Plan.weekTodos(state.plan, today).filter((t) => !t.done)];
  $('#s-todos').innerHTML = todos.map((t) => `<button type="button" data-tpick="${esc(t.id)}" aria-pressed="false">📝 ${esc(t.title)}</button>`).join('');
  $('#s-todos-field').hidden = !todos.length;
  slotDialog.showModal();
}

$('#s-habits').addEventListener('click', (e) => {
  const b = e.target.closest('[data-hpick]');
  if (!b) return;
  const id = b.dataset.hpick;
  if (slotDraft.habitIds.has(id)) slotDraft.habitIds.delete(id); else slotDraft.habitIds.add(id);
  b.setAttribute('aria-pressed', slotDraft.habitIds.has(id));
});
$('#s-todos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tpick]');
  if (!b) return;
  slotDraft.todoId = slotDraft.todoId === b.dataset.tpick ? null : b.dataset.tpick;
  document.querySelectorAll('#s-todos [data-tpick]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.tpick === slotDraft.todoId));
});

$('#slot-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const start = $('#s-start').value;
  const endRaw = $('#s-end').value;
  const end = Plan.TIME.test(endRaw) && endRaw !== start ? endRaw : null;
  const custom = $('#s-custom').value.trim().slice(0, 60);
  const habits = state.habits.filter((h) => slotDraft.habitIds.has(h.id));
  const todo = state.plan.tasks.find((t) => t.id === slotDraft.todoId);
  if (!Plan.TIME.test(start)) return toast('Bitte eine Startzeit wählen.');
  if (!habits.length && !todo && !custom) return toast('Wähle eine Gewohnheit, ein To-do oder schreib etwas hinein.');

  const today = todayKey();
  const list = state.plan.dayBlocks[today] || (state.plan.dayBlocks[today] = []);
  if (todo && !todo.week && !habits.length && !custom) {
    // Ein Tages-To-do bekommt einfach eine Uhrzeit und erscheint so in der Zeitleiste
    todo.time = start;
  } else {
    const title = custom || (todo && !habits.length ? todo.title : habits.map((h) => h.name).join(' & '));
    list.push({
      id: Plan.newId(), start, end, title: title.slice(0, 60),
      emoji: custom ? '📌' : todo && !habits.length ? '📝' : habits[0].emoji,
      cat: habits.length ? 'habit' : 'other', steps: todo && (habits.length || custom) ? [todo.title.slice(0, 60)] : [],
      habitIds: habits.map((h) => h.id),
    });
    if (todo && !todo.week) todo.time = start;
  }
  // Alte Tagespläne aufräumen
  const cutoff = Plan.addDays(today, -14);
  for (const k of Object.keys(state.plan.dayBlocks)) if (k < cutoff || !state.plan.dayBlocks[k].length) delete state.plan.dayBlocks[k];
  save();
  slotDialog.close();
  renderPlan();
  toast('Für heute eingeplant');
});
$('#btn-slot-cancel').addEventListener('click', () => slotDialog.close());
slotDialog.addEventListener('click', (e) => { if (e.target === slotDialog) slotDialog.close(); });

/* ----- Ereignisse ----- */

$('#plan-head-btn').addEventListener('click', () => {
  planMode = planMode === 'edit' ? 'today' : 'edit';
  window.scrollTo(0, 0);
  renderPlan();
  if (planMode === 'today') scrollToNow();
});

$('#plan-content').addEventListener('click', (e) => {
  const a = e.target.closest('[data-pa]');
  if (!a) return;
  const id = a.dataset.id;
  const plan = state.plan;
  switch (a.dataset.pa) {
    case 'starter': {
      const s = Plan.starter();
      // Gleichnamige Gewohnheiten direkt mit den Blöcken verknüpfen (z. B. „Sport“)
      const norm = (x) => x.trim().toLowerCase();
      for (const t of s.templates) for (const b of t.blocks) {
        b.habitIds = state.habits.filter((h) => norm(h.name) === norm(b.title)).map((h) => h.id);
      }
      Object.assign(plan, s);
      save();
      toast('Vorlage geladen. Tippe auf „Bearbeiten“, um sie anzupassen');
      break;
    }
    case 'blank': {
      const t = { id: Plan.newId(), name: 'Mein Tag', emoji: '📅', blocks: [] };
      plan.templates.push(t);
      plan.weekdays = plan.weekdays.map(() => t.id);
      editTplId = t.id;
      planMode = 'edit';
      save();
      break;
    }
    case 'task-toggle': {
      const t = plan.tasks.find((x) => x.id === id);
      if (!t) return;
      t.done = !t.done;
      if (t.done && navigator.vibrate) navigator.vibrate(15);
      save();
      if (t.done && !t.week && t.date === todayKey() && Plan.todoStatus(plan, todayKey()).done) toast('🌳 Alle To-dos erledigt – Bonus für deinen Baum!');
      break;
    }
    case 'task-del':
      plan.tasks = plan.tasks.filter((x) => x.id !== id);
      save();
      break;
    case 'task-today': {
      const t = plan.tasks.find((x) => x.id === id);
      if (t) { t.date = todayKey(); t.time = null; t.week = false; save(); toast('Auf heute verschoben'); }
      break;
    }
    case 'fill-gap':
      return openSlotDialog(Number(a.dataset.s), Number(a.dataset.e), null);
    case 'plan-habit': {
      const now = minNow();
      const gap = freeGaps(Plan.dayTimeline(plan, todayKey()), now)[0];
      const s0 = roundUp(now, 15);
      return gap ? openSlotDialog(gap.s, gap.e, id) : openSlotDialog(s0, s0 + 30, id);
    }
    case 'del-oneoff': {
      const k = todayKey();
      plan.dayBlocks[k] = (plan.dayBlocks[k] || []).filter((b) => b.id !== id);
      save();
      break;
    }
    case 'habit': {
      const h = state.habits.find((x) => x.id === id);
      if (!h) return;
      const done = toggle(h, todayKey());
      if (done && navigator.vibrate) navigator.vibrate(15);
      const t = treeState();
      if (done && t.today.planned && t.today.done === t.today.planned) toast(`💧 Baum gegossen – +${Tree.RULES.perfect} Gesundheit`);
      break;
    }
    case 'pick-tpl':
      editTplId = id;
      break;
    case 'new-tpl': {
      const t = { id: Plan.newId(), name: 'Neuer Tag', emoji: '📅', blocks: [] };
      plan.templates.push(t);
      editTplId = t.id;
      save();
      renderPlan();
      $('#plan-content .tpl-name').select();
      return;
    }
    case 'dup-tpl': {
      const src = findTpl(editTplId);
      const t = { ...src, id: Plan.newId(), name: `${src.name} (Kopie)`.slice(0, 40), blocks: src.blocks.map((b) => ({ ...b, steps: [...b.steps], id: Plan.newId() + Math.random().toString(36).slice(2, 5) })) };
      plan.templates.push(t);
      editTplId = t.id;
      save();
      toast('Kopie erstellt. Ordne ihr jetzt Wochentage zu');
      break;
    }
    case 'del-tpl': {
      const t = findTpl(editTplId);
      if (!confirm(`Tagestyp „${t.name}“ mit allen Zeitblöcken löschen?`)) return;
      plan.templates = plan.templates.filter((x) => x.id !== t.id);
      plan.weekdays = plan.weekdays.map((w) => (w === t.id ? null : w));
      for (const [k, v] of Object.entries(plan.overrides)) if (v === t.id) delete plan.overrides[k];
      editTplId = null;
      if (!plan.templates.length) planMode = 'today';
      save();
      break;
    }
    case 'tpl-day': {
      const i = Number(a.dataset.day);
      plan.weekdays[i] = plan.weekdays[i] === editTplId ? null : editTplId;
      save();
      break;
    }
    case 'new-block':
      return openBlockDialog(editTplId, null);
    case 'edit-block':
      return openBlockDialog(editTplId, id);
    default:
      return;
  }
  renderPlan();
});

$('#plan-content').addEventListener('change', (e) => {
  const pa = e.target.dataset.pa;
  const plan = state.plan;
  if (pa === 'override') {
    const v = e.target.value;
    if (v) plan.overrides[todayKey()] = v;
    else delete plan.overrides[todayKey()];
    // Alte Ausnahmen aufräumen
    for (const k of Object.keys(plan.overrides)) if (k < keyOf(addDays(new Date(), -7))) delete plan.overrides[k];
    save();
    renderPlan();
  } else if (pa === 'tpl-name' || pa === 'tpl-emoji') {
    const t = findTpl(editTplId);
    const v = e.target.value.trim();
    if (pa === 'tpl-name') t.name = v.slice(0, 40) || t.name;
    else t.emoji = v.slice(0, 8) || '📅';
    save();
    renderPlan();
  }
});

$('#plan-content').addEventListener('submit', (e) => {
  if (e.target.dataset.pa !== 'add-task') return;
  e.preventDefault();
  const title = $('#task-title').value.trim();
  if (!title) return $('#task-title').focus();
  const time = $('#task-time').value;
  const when = $('#task-day').value;
  const week = when === 'week';
  const offset = week ? 0 : Number(when);
  state.plan.tasks.push({ id: Plan.newId(), date: keyOf(addDays(new Date(), offset)), title: title.slice(0, 80), time: !week && Plan.TIME.test(time) ? time : null, done: false, week });
  // Erledigte Aufgaben älter als 30 Tage aufräumen
  const cutoff = keyOf(addDays(new Date(), -30));
  state.plan.tasks = state.plan.tasks.filter((t) => !(t.done && t.date < cutoff));
  save();
  renderPlan();
  toast(week ? 'Für diese Woche notiert' : offset ? 'Für morgen eingeplant' : 'To-do hinzugefügt');
  $('#task-title').focus();
});

function scrollToNow() {
  const target = document.getElementById('tl-current') || document.getElementById('tl-now');
  if (!target) return;
  const top = target.getBoundingClientRect().top + window.scrollY - window.innerHeight / 3;
  if (top > 200) window.scrollTo({ top, behavior: 'smooth' });
}

// Jede Minute aktualisieren, solange nicht gerade getippt wird
setInterval(() => {
  if (currentView !== 'plan' || planMode !== 'today' || document.hidden) return;
  const active = document.activeElement;
  if (active && active.closest('#plan-content') && /INPUT|SELECT|TEXTAREA/.test(active.tagName)) return;
  if (blockDialog.open || slotDialog.open) return;
  renderPlan();
}, 30 * 1000);
