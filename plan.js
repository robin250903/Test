'use strict';

/*
 * Tagesablauf: Tagestypen (z. B. „Uni-Tag“) mit Zeitblöcken, Zuordnung zu Wochentagen,
 * Ausnahmen für einzelne Tage und Aufgaben. Reine Logik ohne DOM, damit auch der
 * Service Worker sie für die Erinnerungen nutzen kann.
 */
const Plan = (() => {
  const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
  const DATE = /^\d{4}-\d{2}-\d{2}$/;

  const CATEGORIES = {
    routine: { name: 'Routine', color: '#0d9488', emoji: '☀️' },
    work: { name: 'Uni & Arbeit', color: '#2563eb', emoji: '🎓' },
    focus: { name: 'Lernen', color: '#7c3aed', emoji: '📚' },
    food: { name: 'Essen', color: '#ea580c', emoji: '🍽️' },
    sport: { name: 'Sport', color: '#16a34a', emoji: '🏃' },
    free: { name: 'Freizeit', color: '#db2777', emoji: '🎮' },
    sleep: { name: 'Schlaf', color: '#475569', emoji: '😴' },
    habit: { name: 'Gewohnheiten', color: '#0891b2', emoji: '✅' },
    other: { name: 'Sonstiges', color: '#78716c', emoji: '📌' },
  };

  const pad = (n) => String(n).padStart(2, '0');
  const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const weekdayIdx = (d) => (d.getDay() + 6) % 7;
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const fmt = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  const idOk = (v) => typeof v === 'string' && /^[\w-]{1,40}$/.test(v);
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const empty = () => ({ templates: [], weekdays: [null, null, null, null, null, null, null], overrides: {}, tasks: [], dayBlocks: {}, dayEdits: {}, dayHabits: {} });

  const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  /** Sonntag der Woche, in der das Datum liegt (Woche Mo–So). */
  const weekEnd = (k) => addDays(k, 6 - weekdayIdx(parseKey(k)));

  function normBlock(b) {
    // Früher eine Gewohnheit pro Block (habitId), jetzt beliebig viele (habitIds)
    const ids = Array.isArray(b.habitIds) ? b.habitIds : (b.habitId ? [b.habitId] : []);
    return {
      id: b.id,
      start: b.start,
      end: TIME.test(b.end) && b.end !== b.start ? b.end : null,
      title: str(b.title, 60) || 'Block',
      emoji: str(b.emoji, 8),
      cat: CATEGORIES[b.cat] ? b.cat : 'other',
      steps: (Array.isArray(b.steps) ? b.steps : []).map((x) => str(x, 60)).filter(Boolean).slice(0, 12),
      habitIds: [...new Set(ids.filter(idOk))].slice(0, 10),
    };
  }
  const validBlock = (b) => b && idOk(b.id) && TIME.test(b.start);

  /** Bereinigt gespeicherte oder importierte Daten, damit kaputte Einträge die App nicht stören. */
  function normalize(p) {
    const out = empty();
    if (!p || typeof p !== 'object') return out;
    if (Array.isArray(p.templates)) {
      out.templates = p.templates.filter((t) => t && idOk(t.id)).slice(0, 20).map((t) => ({
        id: t.id,
        name: str(t.name, 40) || 'Tag',
        emoji: str(t.emoji, 8) || '📅',
        blocks: (Array.isArray(t.blocks) ? t.blocks : []).filter(validBlock).slice(0, 60).map(normBlock),
      }));
    }
    const ids = new Set(out.templates.map((t) => t.id));
    if (Array.isArray(p.weekdays)) out.weekdays = out.weekdays.map((_, i) => (ids.has(p.weekdays[i]) ? p.weekdays[i] : null));
    if (p.overrides && typeof p.overrides === 'object') {
      for (const [k, v] of Object.entries(p.overrides)) if (DATE.test(k) && (v === 'none' || ids.has(v))) out.overrides[k] = v;
    }
    if (Array.isArray(p.tasks)) {
      out.tasks = p.tasks.filter((t) => t && idOk(t.id) && DATE.test(t.date)).slice(-500).map((t) => ({
        id: t.id, date: t.date, title: str(t.title, 80) || 'Aufgabe', time: TIME.test(t.time) ? t.time : null, done: !!t.done, week: !!t.week,
        // In einem Block erledigen: { date, blockId }
        slot: t.slot && DATE.test(t.slot.date) && idOk(t.slot.blockId) ? { date: t.slot.date, blockId: t.slot.blockId } : null,
      }));
    }
    // Anpassungen von Tagestyp-Blöcken nur für einen Tag: { datum: { blockId: { start, end } | { skip: true } } }
    if (p.dayEdits && typeof p.dayEdits === 'object') {
      for (const [k, edits] of Object.entries(p.dayEdits)) {
        if (!DATE.test(k) || !edits || typeof edits !== 'object') continue;
        const day = {};
        for (const [id, e] of Object.entries(edits)) {
          if (!idOk(id) || !e || typeof e !== 'object') continue;
          if (e.skip) day[id] = { skip: true };
          else if (TIME.test(e.start)) day[id] = { start: e.start, end: TIME.test(e.end) && e.end !== e.start ? e.end : null };
        }
        if (Object.keys(day).length) out.dayEdits[k] = day;
      }
    }
    // Gewohnheiten, die nur an einem Tag in einen Block gelegt wurden: { datum: { blockId: [habitId] } }
    if (p.dayHabits && typeof p.dayHabits === 'object') {
      for (const [k, map] of Object.entries(p.dayHabits)) {
        if (!DATE.test(k) || !map || typeof map !== 'object') continue;
        const day = {};
        for (const [id, list] of Object.entries(map)) {
          if (idOk(id) && Array.isArray(list)) { const ids = [...new Set(list.filter(idOk))].slice(0, 10); if (ids.length) day[id] = ids; }
        }
        if (Object.keys(day).length) out.dayHabits[k] = day;
      }
    }
    if (p.dayBlocks && typeof p.dayBlocks === 'object') {
      for (const [k, list] of Object.entries(p.dayBlocks)) {
        if (DATE.test(k) && Array.isArray(list)) out.dayBlocks[k] = list.filter(validBlock).slice(0, 30).map(normBlock);
      }
    }
    return out;
  }

  /** Tagestyp für ein Datum: Ausnahme für diesen Tag, sonst Wochentag. null = freier Tag. */
  function templateFor(plan, dateK) {
    const o = plan.overrides[dateK];
    if (o === 'none') return null;
    const id = o || plan.weekdays[weekdayIdx(parseKey(dateK))];
    return plan.templates.find((t) => t.id === id) || null;
  }

  /** Sortierte Blöcke mit Minuten. Ohne eigenes Ende endet ein Block, wenn der nächste beginnt. */
  function timeline(tpl, extraBlocks = []) {
    const blocks = [...(tpl ? tpl.blocks : []), ...extraBlocks.map((b) => ({ ...b, oneOff: true }))]
      .sort((a, b) => toMin(a.start) - toMin(b.start));
    return blocks.map((b, i) => {
      const s = toMin(b.start);
      let e = b.end ? toMin(b.end) : (blocks[i + 1] ? toMin(blocks[i + 1].start) : null);
      if (e !== null && e <= s) e += 24 * 60; // über Mitternacht, z. B. 23:00–07:00
      return { ...b, s, e };
    });
  }

  /** Was läuft gerade, was kommt als Nächstes? now = Minuten seit Mitternacht. */
  function status(items, now) {
    let current = null;
    for (const b of items) if (b.s <= now && (b.e === null || now < b.e)) current = b;
    const next = items.find((b) => b.s > now) || null;
    return { current, next, before: !!items.length && now < items[0].s };
  }

  /** Zeitleiste eines Tages: Tagestyp plus nur für diesen Tag eingeplante Blöcke. */
  /** Tagestyp-Blöcke mit den Anpassungen für diesen Tag (verschoben/ausgelassen). */
  function adjustedTemplate(plan, dateK) {
    const tpl = templateFor(plan, dateK);
    if (!tpl) return null;
    const edits = plan.dayEdits[dateK] || {};
    const blocks = tpl.blocks
      .filter((b) => !(edits[b.id] && edits[b.id].skip))
      .map((b) => (edits[b.id] ? { ...b, start: edits[b.id].start, end: edits[b.id].end, orig: { start: b.start, end: b.end } } : b));
    return { ...tpl, blocks };
  }
  function dayTimeline(plan, dateK) {
    const extra = plan.dayHabits[dateK] || {};
    return timeline(adjustedTemplate(plan, dateK), plan.dayBlocks[dateK] || []).map((b) => {
      const add = (extra[b.id] || []).filter((id) => !b.habitIds.includes(id));
      return add.length ? { ...b, habitIds: [...b.habitIds, ...add], dayHabitIds: add } : b;
    });
  }
  /** To-dos, die an diesem Tag in einem bestimmten Block erledigt werden sollen. */
  const blockTodos = (plan, dateK, blockId) => plan.tasks.filter((t) => t.slot && t.slot.date === dateK && t.slot.blockId === blockId);
  /** Blöcke des Tagestyps, die an diesem Tag ausgelassen werden. */
  const skippedBlocks = (plan, dateK) => {
    const tpl = templateFor(plan, dateK);
    const edits = plan.dayEdits[dateK] || {};
    return tpl ? tpl.blocks.filter((b) => edits[b.id] && edits[b.id].skip) : [];
  };

  /* ---------- To-dos ---------- */

  /** To-dos, die genau für diesen Tag geplant sind (ohne Wochen-To-dos). */
  const dayTodos = (plan, dateK) => plan.tasks.filter((t) => !t.week && t.date === dateK);
  /** Wochen-To-dos, die an diesem Tag sichtbar sind (angelegt in dieser Woche, noch nicht vorbei). */
  const weekTodos = (plan, dateK) => plan.tasks.filter((t) => t.week && t.date <= dateK && weekEnd(t.date) >= dateK);
  /** Unerledigtes aus der Vergangenheit. */
  const overdueTodos = (plan, dateK) => plan.tasks.filter((t) => !t.done && (t.week ? weekEnd(t.date) < dateK : t.date < dateK));

  /** Für den Baum: Gab es an diesem Tag To-dos, und sind alle erledigt? */
  function todoStatus(plan, dateK) {
    const list = dayTodos(plan, dateK);
    const doneCount = list.filter((t) => t.done).length;
    return { planned: list.length > 0, done: list.length > 0 && doneCount === list.length, total: list.length, doneCount };
  }

  /** Kurzfassung für die Erinnerungen, z. B. „📅 Uni-Tag ab 07:00 (☀️ Morgenroutine) · 2 Aufgaben“. */
  function summary(plan, dateK, prefix = 'Heute') {
    if (!plan) return '';
    const tpl = templateFor(plan, dateK);
    const items = dayTimeline(plan, dateK);
    const tasks = dayTodos(plan, dateK).filter((t) => !t.done).length + weekTodos(plan, dateK).filter((t) => !t.done).length;
    const parts = [];
    if (tpl && items.length) {
      const first = items[0];
      parts.push(`${prefix}: ${tpl.emoji} ${tpl.name} ab ${first.start} (${first.emoji || CATEGORIES[first.cat].emoji} ${first.title})`);
    } else if (plan.templates.length) {
      parts.push(`${prefix}: freier Tag`);
    }
    if (tasks) parts.push(`${tasks} To-do${tasks === 1 ? '' : 's'}`);
    return parts.join(' · ');
  }

  /** Vorlage zum Start: Uni-Tag (Mo–Fr) und Wochenende (Sa–So). */
  function starter() {
    const b = (start, end, title, emoji, cat, steps = []) => ({ id: newId() + Math.random().toString(36).slice(2, 5), start, end, title, emoji, cat, steps, habitIds: [] });
    const uni = {
      id: newId(), name: 'Uni-Tag', emoji: '🎓',
      blocks: [
        b('07:00', '07:30', 'Morgenroutine', '☀️', 'routine', ['Aufstehen', 'Zähne putzen', 'Bett machen', 'Duschen']),
        b('07:30', '08:00', 'Frühstück', '🥣', 'food'),
        b('08:00', '08:30', 'Weg zur Uni', '🚲', 'other'),
        b('08:30', '12:00', 'Vorlesung', '🎓', 'work'),
        b('12:00', '13:00', 'Mittagessen', '🍽️', 'food'),
        b('13:00', '16:00', 'Lernen & Nacharbeiten', '📚', 'focus'),
        b('17:00', '18:00', 'Sport', '🏃', 'sport'),
        b('18:30', '19:30', 'Abendessen', '🍝', 'food'),
        b('19:30', '21:30', 'Freizeit', '🎮', 'free'),
        b('21:30', '22:00', 'Abendroutine', '🌙', 'routine', ['Küche aufräumen', 'Tasche für morgen packen', 'Zähne putzen', 'Handy weg']),
        b('22:30', null, 'Schlafen', '😴', 'sleep'),
      ],
    };
    const weekend = {
      id: newId() + 'w', name: 'Wochenende', emoji: '🏖️',
      blocks: [
        b('09:00', '09:45', 'Morgenroutine', '☀️', 'routine', ['Aufstehen', 'Zähne putzen', 'Bett machen']),
        b('09:45', '10:30', 'Frühstück', '🥐', 'food'),
        b('11:00', '13:00', 'Haushalt & Einkaufen', '🧺', 'other', ['Wäsche', 'Aufräumen', 'Einkaufen']),
        b('13:00', '14:00', 'Mittagessen', '🍽️', 'food'),
        b('14:00', '18:00', 'Freizeit', '🎮', 'free'),
        b('19:00', '20:00', 'Abendessen', '🍝', 'food'),
        b('23:30', null, 'Schlafen', '😴', 'sleep'),
      ],
    };
    return {
      templates: [uni, weekend],
      weekdays: [uni.id, uni.id, uni.id, uni.id, uni.id, weekend.id, weekend.id],
    };
  }

  return {
    CATEGORIES, TIME, empty, normalize, templateFor, timeline, dayTimeline, skippedBlocks, status, summary, starter, toMin, fmt, newId,
    dayTodos, weekTodos, overdueTodos, todoStatus, weekEnd, addDays, blockTodos,
  };
})();

if (typeof module !== 'undefined') module.exports = Plan;
