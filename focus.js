'use strict';

/*
 * Fokus-Modus: ein Timer, während dem ein kleiner Baum wächst. Gezählt wird über Zeitstempel,
 * deshalb läuft er auch korrekt weiter, wenn das Handy gesperrt oder die App geschlossen wird.
 * Jede volle 25 Min Fokus pro Tag = +1 Wachstum für den Lebensbaum (höchstens +3 pro Tag).
 */

const FOCUS_DURATIONS = [15, 25, 45, 60];
const focusDialog = $('#focus-dialog');
const focusOverlay = $('#focus-overlay');
let focusDraft = { duration: 25, label: '', blockId: null };
let focusTimer = null;
let lastFocusStage = -1;

const pad2 = (n) => String(n).padStart(2, '0');
const focusToday = () => Tree.focusMinutes(state.focus, todayKey());

/** Kurzinfo zum heutigen Fokus-Stand, z. B. „50 Min heute · +2 von 3 Wachstum“. */
function focusSummary() {
  const min = focusToday();
  const g = Tree.focusGrowth(state.focus, todayKey());
  const max = Tree.RULES.focusMaxPerDay;
  const toNext = Tree.RULES.focusBlock - (min % Tree.RULES.focusBlock);
  return {
    min, growth: g, max,
    text: g >= max
      ? `${min} Min heute · Tagesbonus +${max} erreicht`
      : `${min} Min heute · +${g} von ${max} Wachstum · noch ${toNext} Min bis zum nächsten`,
  };
}

function openFocusDialog({ label = '', blockId = null } = {}) {
  if (state.focus.active) return showFocusOverlay();
  focusDraft = { duration: focusDraft.duration || 25, label, blockId };
  $('#focus-label').value = label;
  renderFocusDurations();
  $('#focus-today').textContent = focusSummary().text;
  focusDialog.showModal();
}

function renderFocusDurations() {
  $('#focus-durations').innerHTML = FOCUS_DURATIONS.map((d) => `<button type="button" data-dur="${d}" aria-pressed="${d === focusDraft.duration}">${d} Min</button>`).join('');
}

$('#focus-durations').addEventListener('click', (e) => {
  const b = e.target.closest('[data-dur]');
  if (!b) return;
  focusDraft.duration = Number(b.dataset.dur);
  renderFocusDurations();
});

$('#focus-form').addEventListener('submit', (e) => {
  e.preventDefault();
  state.focus.active = {
    startedAt: Date.now(),
    duration: focusDraft.duration,
    label: $('#focus-label').value.trim().slice(0, 60) || 'Fokus',
    blockId: focusDraft.blockId,
  };
  save();
  focusDialog.close();
  lastFocusStage = -1;
  showFocusOverlay();
  // Erlaubnis für die Abschluss-Meldung nur erfragen, wenn noch nie gefragt wurde
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
});
$('#btn-focus-cancel').addEventListener('click', () => focusDialog.close());
focusDialog.addEventListener('click', (e) => { if (e.target === focusDialog) focusDialog.close(); });

function showFocusOverlay() {
  focusOverlay.hidden = false;
  document.body.classList.add('focus-open');
  $('#focus-run').hidden = false;
  $('#focus-done').hidden = true;
  tickFocus();
  clearInterval(focusTimer);
  focusTimer = setInterval(tickFocus, 1000);
}

function hideFocusOverlay() {
  clearInterval(focusTimer);
  focusTimer = null;
  focusOverlay.hidden = true;
  document.body.classList.remove('focus-open');
  render();
}

function tickFocus() {
  const a = state.focus.active;
  if (!a) return;
  const total = a.duration * 60000;
  const elapsed = Math.min(total, Date.now() - a.startedAt);
  const left = Math.max(0, total - elapsed);
  const p = elapsed / total;
  $('#focus-title').textContent = a.label;
  $('#focus-clock').textContent = `${pad2(Math.floor(left / 60000))}:${pad2(Math.floor((left % 60000) / 1000))}`;
  $('#focus-bar').style.width = `${(p * 100).toFixed(1)}%`;
  // Der Setzling wächst in Stufen mit der Session
  const bounds = [0, 0.12, 0.35, 0.6, 0.85, 1.0001];
  const stage = bounds.findIndex((b, i) => p >= b && p < bounds[i + 1]);
  const within = Math.round(((p - bounds[stage]) / (bounds[stage + 1] - bounds[stage])) * 4) / 4;
  const key = stage * 10 + within;
  if (key !== lastFocusStage) {
    lastFocusStage = key;
    $('#focus-tree').innerHTML = Tree.svg({ stage, progress: within, health: 100 }, 'fokus');
  }
  if (left <= 0) finishFocus(a.duration, true);
}

/** Session abschließen und speichern. full = Zeit voll durchgehalten. */
function finishFocus(minutes, full) {
  const a = state.focus.active;
  if (!a) return;
  const before = Tree.focusGrowth(state.focus, todayKey());
  const start = new Date(a.startedAt);
  const date = keyOf(start);
  if (minutes >= 1) {
    state.focus.sessions.push({
      id: uid(), date, start: `${pad2(start.getHours())}:${pad2(start.getMinutes())}`,
      minutes: Math.round(minutes), label: a.label, blockId: a.blockId,
    });
  }
  state.focus.active = null;
  save();
  clearInterval(focusTimer);
  const gained = Tree.focusGrowth(state.focus, todayKey()) - before;
  const sum = focusSummary();
  $('#focus-run').hidden = true;
  $('#focus-done').hidden = false;
  $('#focus-done-title').textContent = full ? `🎉 ${minutes} Minuten Fokus geschafft!` : `${Math.round(minutes)} Minuten Fokus`;
  $('#focus-done-text').textContent = gained > 0
    ? `+${gained} Wachstum für deinen Baum. ${sum.text}.`
    : sum.growth >= sum.max ? `Dein Tagesbonus ist schon voll – die Zeit zählt trotzdem in deiner Statistik.` : `${sum.text}.`;
  $('#focus-tree').innerHTML = Tree.svg({ stage: full ? 4 : 2, progress: 1, health: 100 }, 'fokus');
  if (full) {
    if (navigator.vibrate) navigator.vibrate([60, 60, 60]);
    // Meldung, falls die App im Hintergrund ist (wenn das System das zulässt)
    if (document.hidden && 'serviceWorker' in navigator && 'Notification' in window && Notification.permission === 'granted') {
      navigator.serviceWorker.ready.then((reg) => reg.showNotification('🎯 Fokus geschafft!', { body: `${minutes} Minuten „${a.label}“. ${gained > 0 ? `+${gained} Wachstum für deinen Baum.` : ''}`, icon: 'icons/icon-192.png', tag: 'focus' })).catch(() => {});
    }
  }
}

$('#btn-focus-stop').addEventListener('click', () => {
  const a = state.focus.active;
  if (!a) return hideFocusOverlay();
  const mins = Math.floor((Date.now() - a.startedAt) / 60000);
  const msg = mins >= 1
    ? `Fokus jetzt beenden? Deine ${mins} Min werden gezählt.`
    : 'Fokus abbrechen? Unter einer Minute wird nichts gezählt.';
  if (!confirm(msg)) return;
  finishFocus(mins, false);
});
$('#btn-focus-close').addEventListener('click', hideFocusOverlay);

// Beim Zurückkehren in die App sofort den richtigen Stand zeigen
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.focus.active) showFocusOverlay();
});

/** Fokus-Karte für den Baum-Tab. */
function focusCardHtml() {
  const s = focusSummary();
  const dots = Array.from({ length: s.max }, (_, i) => `<span class="fdot ${i < s.growth ? 'on' : ''}"></span>`).join('');
  return `<div class="card focus-card">
    <div class="card-head"><h2>🎯 Fokus</h2><span class="fdots" aria-label="${s.growth} von ${s.max} Fokus-Punkten heute">${dots}</span></div>
    <p class="muted-sm">${esc(s.text)}. Jede volle ${Tree.RULES.focusBlock} Min Fokus lassen deinen Baum wachsen – höchstens +${s.max} pro Tag, die Gesundheit kommt weiter nur von deinen Gewohnheiten.</p>
    <button type="button" class="btn" data-focus-start>${state.focus.active ? 'Laufenden Fokus öffnen' : 'Fokus starten'}</button>
  </div>`;
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-focus-start]')) openFocusDialog({ label: 'Fokus' });
});

// Läuft beim Start noch eine Session? (z. B. App zwischendurch geschlossen)
// Ist sie inzwischen abgelaufen, wird sie beim ersten Tick abgeschlossen und gespeichert.
document.addEventListener('DOMContentLoaded', () => {
  if (state.focus.active) showFocusOverlay();
});
