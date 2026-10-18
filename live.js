'use strict';

/*
 * Ablauf live: Benachrichtigungen, sobald eine Aktivität beginnt (und auf Wunsch ein paar Minuten vorher).
 *
 * Web-Apps können sich nicht selbst zu einer Uhrzeit wecken. Deshalb berechnet die App die nächsten Tage,
 * verschlüsselt sie mit dem Schlüssel der Erinnerungen und legt sie im eigenen GitHub-Repo ab
 * (Branch „live-plan“). Ein GitHub-Job (scripts/live.mjs) schickt die Meldungen dann pünktlich als Push.
 * Ohne den privaten Schlüssel aus dem Secret PUSH_CONFIG lässt sich die Datei nicht lesen.
 */

const LIVE_KEY = 'live.v1';
const LIVE_DAYS = 7;          // so weit im Voraus wird hochgeladen
const LIVE_BRANCH = 'live-plan';
const LIVE_FILE = 'live-plan.json';
const LIVE_LEADS = [0, 5, 10, 15, 30];

function loadLive() {
  try { return { start: true, lead: 15, ...(JSON.parse(localStorage.getItem(LIVE_KEY)) || {}) }; } catch { return { start: true, lead: 15 }; }
}
function saveLive(cfg) {
  try { localStorage.setItem(LIVE_KEY, JSON.stringify(cfg)); } catch { /* ignorieren */ }
}

/* ---------- Meldungen berechnen ---------- */

const atMinute = (k, min) => { const d = parseKey(k); d.setMinutes(min); return d.getTime(); };
const endOf = (b) => (b.e !== null ? Plan.fmt(b.e % 1440) : null);
const span = (b) => `${b.start}${endOf(b) ? `–${endOf(b)}` : ''}`;
const emo = (b) => b.emoji || (Plan.CATEGORIES[b.cat] || Plan.CATEGORIES.other).emoji;

/** Was in einem Block zu tun ist: Schritte, Gewohnheiten, To-dos. */
function blockLines(plan, k, b) {
  const lines = [];
  if (b.steps.length) lines.push(b.steps.join(' → '));
  const habits = b.habitIds.map((id) => state.habits.find((h) => h.id === id)).filter(Boolean);
  if (habits.length) lines.push(habits.map((h) => `${h.emoji} ${h.name}`).join(' · '));
  const todos = Plan.blockTodos(plan, k, b.id).filter((t) => !t.done);
  if (todos.length) lines.push(todos.map((t) => `📝 ${t.title}`).join(' · '));
  return lines;
}

/**
 * Alle Meldungen ab jetzt für die nächsten Tage. Fallen mehrere auf dieselbe Minute,
 * werden sie zu einer zusammengefasst (Beginn hat Vorrang vor der Vorwarnung).
 */
function liveItems(now = Date.now(), opts = loadLive()) {
  const plan = state.plan;
  const raw = [];
  for (let i = 0; i < LIVE_DAYS; i++) {
    const k = Plan.addDays(todayKey(), i);
    const items = Plan.dayTimeline(plan, k);
    items.forEach((b, j) => {
      const at = atMinute(k, b.s);
      const next = items.slice(j + 1).find((x) => x.s > b.s);
      if (opts.start) {
        raw.push({
          at, prio: 0, id: `${k}|${b.id}|start|${b.start}`,
          title: `▶ ${emo(b)} ${b.title} · ${span(b)}`,
          body: [...blockLines(plan, k, b), next ? `Danach ${next.start}: ${emo(next)} ${next.title}` : ''].filter(Boolean).join('\n'),
        });
      }
      if (opts.lead) {
        raw.push({
          at: at - opts.lead * 60000, prio: 2, id: `${k}|${b.id}|pre${opts.lead}|${b.start}`,
          title: `⏰ In ${opts.lead} Min: ${emo(b)} ${b.title}`,
          body: [span(b), ...blockLines(plan, k, b)].join('\n'),
        });
      }
    });
    // To-dos mit Uhrzeit, die nicht in einem Block liegen
    for (const t of Plan.dayTodos(plan, k)) {
      if (!t.time || t.done || (t.slot && t.slot.date === k)) continue;
      raw.push({ at: atMinute(k, Plan.toMin(t.time)), prio: 1, id: `${k}|${t.id}|todo|${t.time}`, title: `📝 ${t.title}`, body: `Jetzt um ${t.time}` });
    }
  }
  const byMinute = new Map();
  for (const x of raw.filter((r) => r.at > now - 60000).sort((a, b) => a.at - b.at || a.prio - b.prio)) {
    const m = byMinute.get(x.at);
    if (!m) byMinute.set(x.at, { id: x.id, at: x.at, title: x.title, body: x.body });
    else { m.id += `+${x.id}`; m.body = [m.body, x.title].filter(Boolean).join('\n'); }
  }
  return [...byMinute.values()];
}

/* ---------- Verschlüsseln & hochladen ---------- */

const utf8 = (s) => new TextEncoder().encode(s);
const toB64 = (buf) => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };

async function liveKey(privateKey) {
  const hash = await crypto.subtle.digest('SHA-256', utf8(`gewohnheiten-live:${privateKey}`));
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt']);
}

async function gzip(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function encryptPlan(plain, privateKey) {
  const raw = utf8(JSON.stringify(plain));
  const packed = await gzip(raw);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await liveKey(privateKey), packed || raw);
  return { v: 1, gz: !!packed, iv: toB64(iv), data: toB64(data) };
}

function gh(cfg, path, opts = {}) {
  return fetch(`https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) },
  });
}

/** Branch für die Plandatei anlegen, falls es ihn noch nicht gibt. */
async function ensureBranch(cfg) {
  const r = await gh(cfg, `/git/ref/heads/${LIVE_BRANCH}`);
  if (r.ok) return;
  if (r.status === 401) throw new Error('Token ungültig oder abgelaufen');
  if (r.status !== 404) throw new Error(`GitHub antwortet mit ${r.status}`);
  const repo = await gh(cfg, '');
  if (!repo.ok) throw new Error(repo.status === 404 ? 'Repo nicht gefunden – hat der Token Zugriff darauf?' : `GitHub antwortet mit ${repo.status}`);
  const base = (await repo.json()).default_branch || 'main';
  const head = await gh(cfg, `/git/ref/heads/${encodeURIComponent(base)}`);
  if (!head.ok) throw new Error(`Branch ${base} nicht lesbar (${head.status})`);
  const made = await gh(cfg, '/git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${LIVE_BRANCH}`, sha: (await head.json()).object.sha }) });
  if (!made.ok && made.status !== 422) throw new Error(made.status === 403 ? 'Dem Token fehlt die Berechtigung „Contents: Read and write“' : `Branch anlegen fehlgeschlagen (${made.status})`);
}

async function currentSha(cfg) {
  const r = await gh(cfg, `/contents/${LIVE_FILE}?ref=${LIVE_BRANCH}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Datei nicht lesbar (${r.status})`);
  return (await r.json()).sha;
}

/** Kurzer Fingerabdruck einer Meldung: Zeitpunkt + Prüfsumme über den Inhalt. */
function liveSig(x) {
  let h = 0;
  for (const c of x.id + x.title + x.body) h = (h * 31 + c.codePointAt(0)) | 0;
  return `${x.at}|${h}`;
}

let liveTimer = null;
let liveBusy = false;

/**
 * Plan hochladen, wenn er sich geändert hat. keepalive: beim Schließen der App,
 * damit die Anfrage auch noch durchgeht, wenn die Seite gleich eingefroren wird.
 */
async function liveSync({ force = false, keepalive = false, items } = {}) {
  const cfg = loadLive();
  const rem = loadReminder();
  if (!cfg.token || !cfg.owner || !rem || !rem.vapid || liveBusy) return false;
  const list = items || liveItems();
  // Nur hochladen, wenn sich an den kommenden Meldungen etwas geändert hat (vorbeigezogene zählen nicht)
  // oder der Vorrat langsam ausgeht
  const sig = list.map(liveSig);
  const now = Date.now();
  const before = (cfg.sig || []).filter((x) => Number(x.split('|')[0]) > now);
  const same = before.length === sig.length && sig.every((x, i) => x === before[i]);
  if (!force && same && now - (cfg.synced || 0) < 24 * 3600e3) return false;
  liveBusy = true;
  try {
    const file = await encryptPlan({ v: 1, generated: Date.now(), items: list }, rem.vapid.privateKey);
    const put = async (sha) => gh(cfg, `/contents/${LIVE_FILE}`, {
      method: 'PUT', keepalive,
      body: JSON.stringify({ message: 'Ablauf aktualisiert', content: btoa(JSON.stringify(file)), branch: LIVE_BRANCH, ...(sha ? { sha } : {}) }),
    });
    let r = await put(cfg.sha);
    if (r.status === 404 || r.status === 409 || r.status === 422) {
      // Branch fehlt oder die gemerkte Version ist veraltet -> nachschlagen und nochmal
      await ensureBranch(cfg);
      r = await put(await currentSha(cfg));
    }
    if (r.status === 401) throw new Error('Token ungültig oder abgelaufen');
    if (r.status === 403) throw new Error('Dem Token fehlt die Berechtigung „Contents: Read and write“');
    if (!r.ok) throw new Error(`Hochladen fehlgeschlagen (${r.status})`);
    const sha = (await r.json()).content.sha;
    saveLive({ ...loadLive(), sha, sig, synced: Date.now(), error: null });
    return true;
  } catch (err) {
    saveLive({ ...loadLive(), error: err.message || 'Keine Verbindung' });
    if (force) throw err;
    return false;
  } finally {
    liveBusy = false;
    if (currentView === 'settings') renderLive();
  }
}

/** Nach jeder Änderung: kurz warten, dann hochladen (mehrere Änderungen in Folge = ein Upload). */
function liveSchedule() {
  if (!loadLive().token) return;
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => liveSync(), 8000);
}

document.addEventListener('visibilitychange', () => {
  if (!loadLive().token) return;
  if (document.hidden) { clearTimeout(liveTimer); liveSync({ keepalive: true }); }
  else liveSync();
});
document.addEventListener('DOMContentLoaded', () => { setTimeout(() => liveSync(), 3000); });

/* ---------- Einstellungen ---------- */

const fmtClock = (ms) => new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(ms);
const fmtWhen = (ms) => {
  const k = keyOf(new Date(ms));
  return `${k === todayKey() ? 'heute' : k === Plan.addDays(todayKey(), 1) ? 'morgen' : shortDate(k)} ${fmtClock(ms)}`;
};

function liveOptionsHtml(cfg) {
  return `<label class="check-row"><input type="checkbox" data-live="start" ${cfg.start ? 'checked' : ''}> Wenn eine Aktivität beginnt</label>
    <label class="field"><span>Vorwarnung</span><select data-live="lead">
      ${LIVE_LEADS.map((m) => `<option value="${m}" ${m === cfg.lead ? 'selected' : ''}>${m ? `${m} Min vorher` : 'Aus'}</option>`).join('')}
    </select></label>`;
}

function renderLive() {
  const el = $('#live-body');
  if (!el) return;
  const rem = loadReminder();
  const cfg = loadLive();
  if (!rem || !rem.vapid) {
    el.innerHTML = '<p class="muted">Richte zuerst oben die <b>Erinnerungen</b> ein – die Ablauf-Benachrichtigungen nutzen denselben Zugang.</p>';
    return;
  }
  const info = repoInfo() || { owner: cfg.owner || '', repo: cfg.repo || '' };
  const next = liveItems().find((x) => x.at > Date.now());
  const preview = next ? `<p class="muted small">Nächste Meldung: <b>${esc(fmtWhen(next.at))}</b> – ${esc(next.title)}</p>` : '';
  if (!cfg.token) {
    el.innerHTML = `${liveOptionsHtml(cfg)}
      <p class="muted small">Damit GitHub weiß, wann deine Aktivitäten beginnen, lädt die App deinen Ablauf <b>verschlüsselt</b> in dein Repo. Dafür braucht sie einmalig einen Zugangsschlüssel (Token):</p>
      <ol class="steps">
        <li>Öffne <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → Neuer Token</a>. Name z. B. <code>Gewohnheiten</code>, Ablauf z. B. 1 Jahr.</li>
        <li><b>Repository access</b>: „Only select repositories“ → <code>${esc(info.repo || 'dein Repo')}</code>.</li>
        <li>Bei <b>Permissions</b> auf <b>„+ Add permissions“</b> tippen, <b>Contents</b> anhaken, dann daneben „Read-only“ auf <b>„Read and write“</b> umstellen. (Erscheint erst, wenn oben das Repo ausgewählt ist.) Dann <b>Generate token</b> und kopieren.</li>
        <li><input id="live-token" type="password" autocomplete="off" placeholder="github_pat_…" aria-label="GitHub-Token">
          <button class="btn btn-small" type="button" id="btn-live-connect">Verbinden</button></li>
      </ol>
      ${repoInfo() ? '' : `<div class="time-grid"><label class="field"><span>GitHub-Name</span><input id="live-owner" value="${esc(cfg.owner || '')}"></label>
        <label class="field"><span>Repo</span><input id="live-repo" value="${esc(cfg.repo || '')}"></label></div>`}
      ${preview}
      <button class="btn btn-ghost" type="button" id="btn-live-preview">Vorschau</button>`;
    return;
  }
  const actions = `https://github.com/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/actions/workflows/live.yml`;
  el.innerHTML = `${liveOptionsHtml(cfg)}
    ${cfg.error ? `<div class="banner warn">⚠️ <div>${esc(cfg.error)}</div></div>` : `<p class="live-ok">✓ Verbunden${cfg.synced ? ` · aktualisiert ${esc(fmtWhen(cfg.synced))}` : ''}</p>`}
    ${preview}
    <p class="muted small">Testen: <a href="${actions}" target="_blank" rel="noopener">GitHub → Actions → Ablauf live</a> → <b>Run workflow</b>. Die neueste Meldung ersetzt immer die vorige – so steht auf dem Sperrbildschirm, was gerade dran ist.</p>
    <div class="row">
      <button class="btn btn-ghost" type="button" id="btn-live-preview">Vorschau</button>
      <button class="btn btn-ghost" type="button" id="btn-live-sync">Jetzt hochladen</button>
      <button class="btn btn-ghost btn-danger" type="button" id="btn-live-off">Trennen</button>
    </div>`;
}

async function livePreview() {
  const next = liveItems().find((x) => x.at > Date.now());
  const reg = await navigator.serviceWorker.ready;
  const msg = next || { title: '▶ Gerade nichts geplant', body: 'Sobald eine Aktivität beginnt, kommt hier die Meldung.' };
  await reg.showNotification(msg.title, { body: msg.body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'live' });
}

$('#live-body').addEventListener('click', async (e) => {
  const id = e.target.closest('button')?.id;
  if (id === 'btn-live-preview') return livePreview().catch(() => toast('Vorschau nicht möglich'));
  if (id === 'btn-live-connect') {
    const token = $('#live-token').value.trim();
    const info = repoInfo() || { owner: ($('#live-owner')?.value || '').trim(), repo: ($('#live-repo')?.value || '').trim() };
    if (!token) return toast('Bitte den Token einfügen.');
    if (!info.owner || !info.repo) return toast('Bitte GitHub-Name und Repo angeben.');
    saveLive({ ...loadLive(), token, owner: info.owner, repo: info.repo, sha: null, sig: null, error: null });
    toast('Verbinde …');
    try {
      await ensureBranch(loadLive());
      await liveSync({ force: true });
      toast('✓ Verbunden – dein Ablauf ist hochgeladen');
    } catch (err) {
      toast(err.message || 'Verbinden fehlgeschlagen');
    }
    return renderLive();
  }
  if (id === 'btn-live-sync') {
    try { await liveSync({ force: true }); toast('Hochgeladen'); } catch (err) { toast(err.message || 'Hochladen fehlgeschlagen'); }
    return;
  }
  if (id === 'btn-live-off') {
    if (!confirm('Ablauf-Benachrichtigungen trennen? Der hochgeladene Plan wird geleert. Den Token kannst du danach bei GitHub löschen.')) return;
    try { await liveSync({ force: true, items: [] }); } catch { /* trotzdem trennen */ }
    saveLive({ start: loadLive().start, lead: loadLive().lead });
    renderLive();
    toast('Getrennt');
  }
});

$('#live-body').addEventListener('change', (e) => {
  const key = e.target.dataset.live;
  if (!key) return;
  const cfg = loadLive();
  if (key === 'start') cfg.start = e.target.checked;
  if (key === 'lead') cfg.lead = Number(e.target.value);
  saveLive(cfg);
  renderLive();
  liveSchedule();
});
