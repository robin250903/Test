'use strict';

/*
 * Kalender: Monatsansicht im Ablauf-Tab. Termine lassen sich hier auch Wochen im Voraus eintragen.
 * Sie landen als Einmal-Blöcke (plan.dayBlocks) im jeweiligen Tag und stehen dort zur Uhrzeit in der Zeitleiste.
 */

let calMonth = null; // 'YYYY-MM'
let calSel = null;   // gewählter Tag

const monthKey = (k) => k.slice(0, 7);
const CAL_WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

function openCalendar(k) {
  calSel = k || todayKey();
  calMonth = monthKey(calSel);
  planMode = 'cal';
  window.scrollTo(0, 0);
  renderPlan();
}

/** Eigene Termine eines Tages, sortiert (ohne reine Gewohnheits-Blöcke). */
const dayEvents = (k) => (state.plan.dayBlocks[k] || []).filter((b) => b.cat !== 'habit')
  .sort((a, b) => Plan.toMin(a.start) - Plan.toMin(b.start));
const openTodos = (k) => Plan.dayTodos(state.plan, k).filter((t) => !t.done);

function shiftMonth(mk, d) {
  const [y, m] = mk.split('-').map(Number);
  const x = new Date(y, m - 1 + d, 1);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}`;
}

function eventRow(b, k, withDate) {
  const time = `${b.start}${b.end ? `–${b.end}` : ''}`;
  return `<button type="button" class="cal-ev" data-cal="edit" data-k="${k}" data-id="${esc(b.id)}" style="--c:${catOf(b).color}">
    ${withDate ? `<span class="cal-ev-date">${esc(dayLabel(k) === 'Heute' || dayLabel(k) === 'Morgen' ? dayLabel(k) : shortDate(k))}</span>` : ''}
    <span class="cal-ev-time">${time}</span><span class="cal-ev-title">${esc(blockEmoji(b))} ${esc(b.title)}</span></button>`;
}

function renderCalendar(el, btn) {
  const today = todayKey();
  const last = Plan.addDays(today, CAL_AHEAD);
  if (!calSel || calSel < today) calSel = today;
  if (!calMonth) calMonth = monthKey(calSel);
  const [y, m] = calMonth.split('-').map(Number);
  $('#plan-eyebrow').textContent = 'Kalender';
  $('#plan-title').textContent = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
  btn.textContent = 'Fertig';

  // Monatsraster, Woche beginnt am Montag
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const lead = weekdayIdx(first);
  let cells = CAL_WEEKDAYS.map((w) => `<span class="cal-wd">${w}</span>`).join('');
  cells += '<span></span>'.repeat(lead);
  for (let d = 1; d <= days; d++) {
    const k = `${calMonth}-${pad(d)}`;
    const past = k < today || k > last;
    const ev = dayEvents(k);
    const todos = openTodos(k).length;
    const marks = ev.slice(0, 2).map((b) => esc(blockEmoji(b))).join('') + (ev.length > 2 ? '<small>+</small>' : '');
    cells += `<button type="button" class="cal-cell${k === today ? ' today' : ''}${k === calSel ? ' sel' : ''}" data-cal="pick" data-k="${k}" ${past ? 'disabled' : ''}
      aria-label="${esc(new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }).format(parseKey(k)))}${ev.length ? `, ${ev.length} Termin${ev.length === 1 ? '' : 'e'}` : ''}">
      <b>${d}</b><span class="cal-marks">${marks}</span>${todos ? '<i></i>' : ''}</button>`;
  }
  const canPrev = calMonth > monthKey(today);
  const canNext = calMonth < monthKey(last);
  const grid = `<div class="card cal-card">
    <div class="cal-nav">
      <button type="button" data-cal="prev" aria-label="Voriger Monat" ${canPrev ? '' : 'disabled'}>‹</button>
      <button type="button" class="link-btn" data-cal="today">Heute</button>
      <button type="button" data-cal="next" aria-label="Nächster Monat" ${canNext ? '' : 'disabled'}>›</button>
    </div>
    <div class="cal-grid">${cells}</div>
  </div>`;

  // Gewählter Tag
  const ev = dayEvents(calSel);
  const todos = openTodos(calSel);
  const tpl = Plan.templateFor(state.plan, calSel);
  const sel = `<div class="card cal-day">
    <div class="card-head"><h2>${esc(new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }).format(parseKey(calSel)))}</h2>
      <span class="muted-sm">${tpl ? `${esc(tpl.emoji)} ${esc(tpl.name)}` : '🌴 frei'}</span></div>
    ${ev.map((b) => eventRow(b, calSel, false)).join('')}
    ${todos.map((t) => `<div class="cal-todo">📝 ${t.time ? `<b>${t.time}</b> ` : ''}${esc(t.title)}</div>`).join('')}
    ${!ev.length && !todos.length ? '<p class="muted-sm">Noch nichts eingetragen.</p>' : ''}
    <div class="row cal-actions">
      <button type="button" class="btn" data-cal="add">＋ Termin</button>
      <button type="button" class="btn btn-ghost" data-cal="open">Tag öffnen</button>
    </div>
  </div>`;

  // Demnächst: alle kommenden Termine und datierten To-dos
  const upcoming = [];
  for (const k of Object.keys(state.plan.dayBlocks).filter((x) => x >= today).sort()) {
    for (const b of dayEvents(k)) upcoming.push(eventRow(b, k, true));
  }
  const soonTodos = state.plan.tasks.filter((t) => !t.done && !t.week && t.date > today)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99').localeCompare(b.time || '99'));
  const list = upcoming.slice(0, 20).join('');
  const soon = `<div class="card">
    <div class="card-head"><h2>Demnächst</h2></div>
    ${list || '<p class="muted-sm">Keine Termine geplant. Tippe auf einen Tag und dann auf „＋ Termin“.</p>'}
    ${soonTodos.length ? `<div class="section-label">To-dos</div>${soonTodos.slice(0, 10).map((t) => `<button type="button" class="cal-ev" data-cal="pick" data-k="${t.date}" style="--c:#78716c">
      <span class="cal-ev-date">${esc(shortDate(t.date))}</span><span class="cal-ev-time">${t.time || ''}</span><span class="cal-ev-title">📝 ${esc(t.title)}</span></button>`).join('')}` : ''}
  </div>`;

  el.innerHTML = grid + sel + soon;
}

/** Für Dialoge, die mit dem angesehenen Tag arbeiten (Einplanen, Anpassen). */
const calUseDay = (k) => { planDay = k === todayKey() ? null : k; };

document.getElementById('plan-content').addEventListener('click', (e) => {
  const a = e.target.closest('[data-cal]');
  if (!a || a.disabled) return;
  switch (a.dataset.cal) {
    case 'prev': calMonth = shiftMonth(calMonth, -1); break;
    case 'next': calMonth = shiftMonth(calMonth, 1); break;
    case 'today': calSel = todayKey(); calMonth = monthKey(calSel); break;
    case 'pick':
      calSel = a.dataset.k;
      calMonth = monthKey(calSel);
      break;
    case 'add':
      calUseDay(calSel);
      return openNewEvent();
    case 'edit':
      calSel = a.dataset.k;
      calMonth = monthKey(calSel);
      calUseDay(calSel);
      return openAdjustDialog(a.dataset.id);
    case 'open':
      calUseDay(calSel);
      planMode = 'today';
      window.scrollTo(0, 0);
      break;
    default: return;
  }
  renderPlan();
});
