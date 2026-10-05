'use strict';

/*
 * Lebensbaum: Wachstum und Gesundheit werden bei jedem Aufruf deterministisch aus dem Log
 * berechnet (Tag für Tag nachgespielt). Nachtragen oder Austragen wirkt sich dadurch korrekt aus.
 */
const Tree = (() => {
  const STAGES = [
    { name: 'Samen', min: 0 },
    { name: 'Keimling', min: 5 },
    { name: 'Setzling', min: 15 },
    { name: 'Jungbaum', min: 35 },
    { name: 'Baum', min: 70 },
    { name: 'Großer Baum', min: 120 },
    { name: 'Blühender Baum', min: 200 },
    { name: 'Uralter Baum', min: 320 },
  ];

  const RULES = {
    startHealth: 70,
    // Gesundheit pro Tag je nach Anteil erledigter Gewohnheiten, dazwischen linear:
    // jede zusätzlich erledigte Gewohnheit bringt immer etwas.
    curve: [[0, -25], [0.5, -10], [0.7, 0], [1, 10]],
    perfect: 10,
    canBelow: 0.5, // Gießkanne rettet jeden Tag unter 50 %
    reviveHealth: 40,
    canEvery: 7,   // perfekte Tage in Folge für eine Gießkanne
    maxCans: 2,
  };

  const pad = (n) => String(n).padStart(2, '0');
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const weekdayIdx = (d) => (d.getDay() + 6) % 7;
  const clamp = (v) => Math.max(0, Math.min(100, v));

  const stageOf = (growth) => STAGES.reduce((s, st, i) => (growth >= st.min ? i : s), 0);

  function deltaFor(ratio) {
    const c = RULES.curve;
    if (ratio >= 1) return c[c.length - 1][1];
    for (let i = 1; i < c.length; i++) {
      const [x0, y0] = c[i - 1], [x1, y1] = c[i];
      if (ratio <= x1) return Math.round(y0 + ((ratio - x0) / (x1 - x0)) * (y1 - y0));
    }
    return 0;
  }

  function habitStart(h, log) {
    let start = h.createdAt;
    for (const k of Object.keys(log[h.id] || {})) if (k < start) start = k;
    return start;
  }

  /**
   * extra(dateKey) -> { planned, done } (optional): eine zusätzliche „Gewohnheit“ pro Tag,
   * z. B. „Alle To-dos erledigt“. Sie zählt nur an Tagen, an denen sie geplant ist.
   */
  function simulate(habits, log, todayK, extra) {
    const result = {
      growth: 0, stage: 0, health: RULES.startHealth, cans: 0, perfectRun: 0,
      events: [], today: { planned: 0, done: 0 }, empty: !habits.length,
    };
    if (!habits.length) return finish(result);

    const starts = new Map(habits.map((h) => [h.id, habitStart(h, log)]));
    const firstKey = [...starts.values()].sort()[0];
    const today = parseKey(todayK);
    let { growth, health, cans, perfectRun } = result;
    const events = [{ type: 'start', key: firstKey }];

    for (let d = parseKey(firstKey); d <= today; d = addDays(d, 1)) {
      const k = keyOf(d);
      const wd = weekdayIdx(d);
      const active = habits.filter((h) => starts.get(h.id) <= k);
      const x = extra ? extra(k) : null;
      const bonusPlanned = x && x.planned ? 1 : 0;
      const bonusDone = x && x.planned && x.done ? 1 : 0;
      const planned = { length: active.filter((h) => h.days.includes(wd)).length + bonusPlanned };
      const done = active.filter((h) => h.days.includes(wd) && log[h.id] && log[h.id][k]).length + bonusDone;
      const stageBefore = stageOf(growth);

      // Jede erledigte Gewohnheit lässt den Baum wachsen, auch an ungeplanten Tagen
      growth += active.filter((h) => log[h.id] && log[h.id][k]).length + bonusDone;

      if (k === todayK) {
        result.today = { planned: planned.length, done };
        // Der heutige Tag kann nur helfen, bestraft wird erst, wenn er vorbei ist
        if (planned.length && done === planned.length) {
          health = clamp(health + RULES.perfect);
          perfectRun++;
          if (perfectRun % RULES.canEvery === 0 && cans < RULES.maxCans) { cans++; events.push({ type: 'can', key: k }); }
        }
      } else if (planned.length) {
        const ratio = done / planned.length;
        if (ratio >= 1) {
          health = clamp(health + RULES.perfect);
          perfectRun++;
          if (perfectRun % RULES.canEvery === 0 && cans < RULES.maxCans) { cans++; events.push({ type: 'can', key: k }); }
        } else {
          perfectRun = 0;
          if (ratio < RULES.canBelow && cans > 0) {
            cans--;
            events.push({ type: 'saved', key: k });
          } else {
            const delta = deltaFor(ratio);
            health = clamp(health + delta);
            if (delta < 0) events.push({ type: ratio === 0 ? 'missed' : 'weak', key: k, delta, pct: Math.round(ratio * 100) });
          }
        }
        if (health <= 0) {
          const lost = Math.max(0, stageOf(growth) - 1);
          events.push({ type: 'died', key: k, from: STAGES[stageOf(growth)].name, to: STAGES[lost].name });
          growth = STAGES[lost].min;
          health = RULES.reviveHealth;
        }
      }

      const stageAfter = stageOf(growth);
      if (stageAfter > stageBefore) events.push({ type: 'grew', key: k, stage: STAGES[stageAfter].name });
    }

    Object.assign(result, { growth, health, cans, perfectRun, events });
    return finish(result);
  }

  function finish(r) {
    r.stage = stageOf(r.growth);
    r.stageName = STAGES[r.stage].name;
    const next = STAGES[r.stage + 1];
    r.nextName = next ? next.name : null;
    r.nextMin = next ? next.min : null;
    r.progress = next ? (r.growth - STAGES[r.stage].min) / (next.min - STAGES[r.stage].min) : 1;

    // Was passiert heute Nacht, wenn es beim aktuellen Stand bleibt?
    const { planned, done } = r.today;
    r.tonight = { delta: 0, usesCan: false, dies: false };
    if (planned && done < planned) {
      const ratio = done / planned;
      if (ratio < RULES.canBelow && r.cans > 0) r.tonight.usesCan = true;
      else {
        r.tonight.delta = deltaFor(ratio);
        r.tonight.dies = r.health + r.tonight.delta <= 0;
      }
    }
    return r;
  }

  function healthLabel(h) {
    if (h >= 80) return 'Kerngesund';
    if (h >= 60) return 'Gesund';
    if (h >= 40) return 'Durstig';
    if (h >= 20) return 'Welkt';
    return 'Kurz vorm Eingehen';
  }

  /* ---------- Zeichnung ---------- */

  // Kleiner deterministischer Zufallsgenerator, damit der Baum immer gleich aussieht
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seedFrom(str) {
    let h = 2166136261;
    for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return h >>> 0;
  }

  function palette(health) {
    if (health >= 60) return ['#22c55e', '#16a34a', '#4ade80'];
    if (health >= 40) return ['#84cc16', '#65a30d', '#a3e635'];
    if (health >= 20) return ['#eab308', '#ca8a04', '#d97706'];
    return ['#b45309', '#92400e', '#a16207'];
  }

  const f = (n) => n.toFixed(1);

  function svg(t, seedStr) {
    const W = 320, H = 300, gx = 160, gy = 262;
    const seed = seedFrom(seedStr || 'baum');
    const shape = rng(seed);
    const leafRng = rng(seed + 1);
    const colors = palette(t.health);
    const keep = t.health >= 40 ? 1 : t.health >= 20 ? 0.65 : t.health >= 8 ? 0.35 : 0.1;
    const bark = t.health >= 20 ? '#8b5a2b' : '#7c6a58';
    const branches = [];
    const leaves = [];
    const extras = [];

    const pick = (arr) => arr[Math.floor(leafRng() * arr.length)];
    let minX = gx, maxX = gx, minY = gy;
    const track = (x, y, r = 0) => { minX = Math.min(minX, x - r); maxX = Math.max(maxX, x + r); minY = Math.min(minY, y - r); };

    if (t.stage === 0) {
      extras.push(`<ellipse cx="${gx}" cy="${gy - 4}" rx="30" ry="12" fill="#92400e" opacity="0.35"/>`);
      extras.push(`<ellipse cx="${gx}" cy="${gy - 12}" rx="14" ry="10" fill="#a16207"/>`);
      extras.push(`<path d="M${gx - 2} ${gy - 21} q3 -12 11 -15" stroke="#65a30d" stroke-width="4" fill="none" stroke-linecap="round"/>`);
    } else if (t.stage === 1) {
      const h = 50 + 30 * t.progress;
      branches.push(`<path d="M${gx} ${gy} q-10 ${-h / 2} 0 ${-h}" stroke="#65a30d" stroke-width="5" fill="none" stroke-linecap="round"/>`);
      leaves.push(`<ellipse cx="${gx - 18}" cy="${gy - h + 4}" rx="20" ry="9" fill="${colors[0]}" transform="rotate(-25 ${gx - 18} ${gy - h + 4})"/>`);
      leaves.push(`<ellipse cx="${gx + 18}" cy="${gy - h - 2}" rx="20" ry="9" fill="${colors[1]}" transform="rotate(25 ${gx + 18} ${gy - h - 2})"/>`);
    } else {
      const levels = Math.min(t.stage + 1, 7);
      const grow = 0.85 + 0.15 * t.progress;
      const trunkLen = (34 + t.stage * 7) * grow;
      const leafR = 5 + t.stage * 0.9;

      const branch = (x, y, len, angle, width, depth) => {
        const x2 = x + Math.cos(angle) * len;
        const y2 = y + Math.sin(angle) * len;
        branches.push(`<path d="M${f(x)} ${f(y)}L${f(x2)} ${f(y2)}" stroke="${bark}" stroke-width="${f(width)}" stroke-linecap="round"/>`);
        track(x2, y2, leafR * 2.2);
        if (depth === 0) {
          const n = 3;
          for (let i = 0; i < n; i++) {
            const lx = x2 + (leafRng() - 0.5) * leafR * 2.2;
            const ly = y2 + (leafRng() - 0.5) * leafR * 2.2;
            const show = leafRng() < keep;
            const c = pick(colors);
            if (show) leaves.push(`<circle cx="${f(lx)}" cy="${f(ly)}" r="${f(leafR * (0.8 + leafRng() * 0.4))}" fill="${c}"/>`);
            else leafRng();
          }
          const deco = leafRng();
          if (t.health >= 40 && t.stage >= 6 && deco < 0.45) {
            extras.push(`<circle cx="${f(x2 + (leafRng() - 0.5) * leafR * 2)}" cy="${f(y2 + (leafRng() - 0.5) * leafR * 2)}" r="${f(leafR * 0.38)}" fill="#f9a8d4" stroke="#fff" stroke-width="0.8"/>`);
          } else if (t.health >= 40 && t.stage >= 7 && deco > 0.75) {
            extras.push(`<circle cx="${f(x2 + (leafRng() - 0.5) * leafR)}" cy="${f(y2 + leafR * (0.4 + leafRng() * 0.4))}" r="${f(leafR * 0.42)}" fill="#dc2626"/>`);
          } else { leafRng(); leafRng(); }
          return;
        }
        const kids = depth < levels - 2 && shape() < 0.25 ? 3 : 2;
        for (let i = 0; i < kids; i++) {
          const spread = 0.35 + shape() * 0.25;
          const dir = kids === 2 ? (i === 0 ? -1 : 1) : i - 1;
          branch(x2, y2, len * (0.7 + shape() * 0.1), angle + dir * spread + (shape() - 0.5) * 0.15, width * 0.68, depth - 1);
        }
      };
      branch(gx, gy, trunkLen, -Math.PI / 2 + (shape() - 0.5) * 0.08, 4 + t.stage * 2, levels - 1);
    }

    // Abgefallene Blätter am Boden
    const fallen = [];
    if (t.stage >= 2 && t.health < 60) {
      const count = Math.round((60 - t.health) / 4);
      const fr = rng(seed + 2);
      for (let i = 0; i < count; i++) {
        const x = gx + (fr() - 0.5) * 180;
        fallen.push(`<ellipse cx="${f(x)}" cy="${f(gy + 2 + fr() * 8)}" rx="5" ry="2.5" fill="${palette(Math.min(t.health, 30))[i % 3]}" transform="rotate(${f((fr() - 0.5) * 60)} ${f(x)} ${gy + 4})"/>`);
      }
    }

    const margin = 6;
    const scale = Math.min(1, (gy - margin) / (gy - minY), (gx - margin) / (gx - minX), (W - margin - gx) / (maxX - gx || 1));
    const fit = scale < 1 ? ` transform="translate(${f(gx * (1 - scale))} ${f(gy * (1 - scale))}) scale(${scale.toFixed(3)})"` : '';

    return `<svg class="tree-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${STAGES[t.stage].name}, Gesundheit ${t.health} Prozent">
      <ellipse cx="${gx}" cy="${gy + 6}" rx="120" ry="14" class="ground"/>
      ${fallen.join('')}
      <g class="tree-body"${fit}>${branches.join('')}<g class="canopy">${leaves.join('')}${extras.join('')}</g></g>
    </svg>`;
  }

  /** Wie viele weitere Gewohnheiten heute nötig sind, damit der Baum die Nacht überlebt. */
  function neededToSurvive(t) {
    const { planned, done } = t.today;
    for (let n = 0; done + n <= planned; n++) {
      const ratio = (done + n) / planned;
      if ((ratio < RULES.canBelow && t.cans > 0) || t.health + deltaFor(ratio) > 0) return n;
    }
    return planned - done;
  }

  /**
   * Text für die Erinnerungen, passend zum Zustand des Baums.
   * slot: 'morning' (motivierend, Tagesplan) oder 'evening' (anfeuernd, was noch geht).
   */
  function reminder(habits, log, todayK, slot = 'evening', extra) {
    const t = simulate(habits, log, todayK, extra);
    const { planned, done } = t.today;
    const open = habits.filter((h) => h.days.includes(weekdayIdx(parseKey(todayK))) && !(log[h.id] && log[h.id][todayK]));
    const x = extra ? extra(todayK) : null;
    if (x && x.planned && !x.done) open.unshift({ emoji: '✅', name: `${x.total - x.doneCount} To-do${x.total - x.doneCount === 1 ? '' : 's'}` });
    const names = open.slice(0, 3).map((h) => `${h.emoji} ${h.name}`).join(', ') + (open.length > 3 ? ' …' : '');
    const left = planned - done;
    const morning = slot === 'morning';

    if (t.empty) return { title: '🌰 Pflanz deinen Baum', body: 'Leg deine erste Gewohnheit an, damit dein Baum wachsen kann.', urgent: false };
    if (!planned) return { title: '🌳 Ruhetag', body: 'Heute ist nichts geplant. Dein Baum ruht sich aus.', urgent: false };
    if (done === planned) {
      return morning
        ? { title: '☀️ Schon alles erledigt!', body: `Was für ein Start in den Tag. Dein Baum ist gegossen (${t.health} % Gesundheit).`, urgent: false }
        : { title: '🌳 Alles erledigt!', body: `Dein Baum ist heute gegossen (${t.stageName}, ${t.health} % Gesundheit). Stark!`, urgent: false };
    }

    if (morning) {
      if (t.health < 40) {
        return { title: '🌱 Heute kannst du deinen Baum retten', body: `Er ist geschwächt (${t.health} %). Alles erledigt bringt +${RULES.perfect}. Heute dran: ${names}`, urgent: false };
      }
      const plan = left === 1 ? 'Heute steht 1 Sache an' : `Heute stehen ${left} Sachen an`;
      return { title: '☀️ Guten Morgen!', body: `${plan}: ${names}. Starte gut in den Tag, dein ${t.stageName} freut sich.`, urgent: false };
    }

    if (t.tonight.dies) {
      const need = neededToSurvive(t);
      return { title: '🥀 Dein Baum geht heute Nacht ein!', body: `Schon ${need === 1 ? '1 weitere Gewohnheit rettet' : `${need} weitere retten`} ihn. Offen: ${names}`, urgent: true };
    }
    if (t.tonight.usesCan) {
      return { title: '💧 Deine Gießkanne ist in Gefahr', body: `Unter 50 % wird heute Nacht eine Gießkanne verbraucht. Du schaffst das noch: ${names}`, urgent: false };
    }
    const gain = deltaFor((done + 1) / planned) - t.tonight.delta;
    if (t.tonight.delta < 0) {
      return { title: '⏳ Du hast noch Zeit!', body: `Stand jetzt: ${t.tonight.delta} Gesundheit. Eine weitere bringt +${gain}. Offen: ${names}`, urgent: true };
    }
    return { title: '🌿 Fast geschafft', body: `Noch ${left} offen. Die nächste bringt +${gain}, alles zusammen +${RULES.perfect}: ${names}`, urgent: false };
  }

  return { STAGES, RULES, simulate, svg, healthLabel, reminder, deltaFor, neededToSurvive };
})();

if (typeof module !== 'undefined') module.exports = Tree;
