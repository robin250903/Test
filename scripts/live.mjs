// Ablauf live: verschickt Benachrichtigungen, wenn eine Aktivität beginnt (und die Vorwarnung davor).
// Läuft stündlich in GitHub Actions und kümmert sich um die jeweils nächste volle Stunde.
//   node live.mjs check  -> schreibt has=true/false und slot=<ms> nach $GITHUB_OUTPUT
//   node live.mjs run    -> wartet bis zu den Zeitpunkten und verschickt die Meldungen
// Der Plan liegt verschlüsselt im Branch „live-plan“ (von der App hochgeladen). Den Schlüssel
// kennt nur das Secret PUSH_CONFIG, das auch die Morgen-/Abend-Erinnerung nutzt.
import { appendFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const HOUR = 3600e3;
const LATE = 10 * 60e3;   // verspätete Meldungen höchstens so lange nachholen
const mode = process.argv[2];

function output(key, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clock = (ms) => new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: cfg.timezone || 'Europe/Berlin' }).format(ms);

let cfg;
try {
  cfg = JSON.parse(process.env.PUSH_CONFIG || 'null');
} catch {
  cfg = null;
}
if (!cfg?.subscription?.endpoint || !cfg?.vapid?.privateKey) {
  console.log('Kein gültiges Secret PUSH_CONFIG. Richte die Erinnerungen in der App unter Einstellungen ein.');
  output('has', 'false');
  process.exit(0);
}

async function loadPlan() {
  const res = await fetch(`${process.env.GITHUB_API_URL || 'https://api.github.com'}/repos/${process.env.GITHUB_REPOSITORY}/contents/live-plan.json?ref=live-plan`, {
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github.raw', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Plan nicht lesbar (${res.status})`);
  const file = await res.json();
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`gewohnheiten-live:${cfg.vapid.privateKey}`));
  const key = await crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['decrypt']);
  let plain;
  try {
    plain = Buffer.from(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(file.iv, 'base64') }, key, Buffer.from(file.data, 'base64')));
  } catch {
    throw new Error('Plan passt nicht zum Schlüssel. Öffne die App einmal, damit sie ihn neu hochlädt (und prüfe, ob PUSH_CONFIG aktuell ist).');
  }
  const data = JSON.parse((file.gz ? gunzipSync(plain) : plain).toString('utf8'));
  return Array.isArray(data.items) ? data.items.filter((x) => x && Number.isFinite(x.at) && x.id && x.title) : [];
}

// Zuständig für die Stunde, die gerade beginnt (Start um :50 -> nächste volle Stunde; bis 40 Min Verspätung ok)
const slotStart = Number(process.env.SLOT) || Math.floor((Date.now() + 20 * 60e3) / HOUR) * HOUR;
const slotEnd = slotStart + HOUR;
const inSlot = (x) => x.at >= slotStart && x.at < slotEnd;
const force = process.env.FORCE === 'true';

if (mode === 'check') {
  let items = [];
  try {
    items = (await loadPlan()) || [];
  } catch (err) {
    console.error(err.message);
    if (!force) process.exit(1);
  }
  const due = items.filter((x) => inSlot(x) && x.at > Date.now() - LATE);
  console.log(`Zuständig für ${clock(slotStart)}–${clock(slotEnd)}: ${due.length ? due.map((x) => `${clock(x.at)} ${x.title}`).join(' | ') : 'nichts geplant'}${force ? ' (manuell gestartet: Test-Meldung)' : ''}.`);
  output('has', String(due.length > 0 || force));
  output('slot', String(slotStart));
} else if (mode === 'run') {
  const { default: webpush } = await import('web-push');
  const [owner = 'user', repo = ''] = (process.env.GITHUB_REPOSITORY || '').split('/');
  webpush.setVapidDetails(`https://${owner.toLowerCase()}.github.io/${repo}/`, cfg.vapid.publicKey, cfg.vapid.privateKey);

  const send = async (msg) => {
    try {
      // topic: Ist das Handy offline, ersetzt eine neue Meldung die noch nicht zugestellte alte
      const res = await webpush.sendNotification(cfg.subscription, JSON.stringify({ type: 'live', ...msg }), { TTL: 600, urgency: 'high', topic: 'live' });
      console.log(`${clock(Date.now())} verschickt: ${msg.title} (Status ${res.statusCode})`);
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        console.error('Das Benachrichtigungs-Abo ist abgelaufen. Richte die Erinnerungen in der App neu ein und aktualisiere das Secret PUSH_CONFIG.');
        process.exit(1);
      }
      console.error(`Senden fehlgeschlagen: ${err.statusCode || ''} ${err.body || err.message}`);
    }
  };

  let items = (await loadPlan().catch(() => null)) || [];
  if (force) {
    const next = items.filter((x) => x.at > Date.now()).sort((a, b) => a.at - b.at)[0];
    await send({
      title: '🔔 Ablauf live funktioniert',
      body: next ? `Nächste Meldung um ${clock(next.at)}: ${next.title}` : 'Gerade ist nichts geplant. Öffne die App, damit sie deinen Ablauf hochlädt.',
      at: Date.now(),
    });
    // Nur testen: Die regulären Meldungen verschickt der stündliche Lauf
    process.exit(0);
  }

  const sent = new Set();
  let loaded = Date.now();
  for (;;) {
    // Jede Minute neu laden, damit Änderungen aus der App (verschobene Blöcke) noch ankommen
    if (Date.now() - loaded >= 60e3) {
      try { items = (await loadPlan()) || []; } catch (err) { console.error(err.message); }
      loaded = Date.now();
    }
    const now = Date.now();
    const open = items.filter((x) => inSlot(x) && !sent.has(x.id));
    for (const x of open.filter((i) => i.at <= now + 2000).sort((a, b) => a.at - b.at)) {
      sent.add(x.id);
      if (now - x.at <= LATE) await send({ title: x.title, body: x.body || '', at: x.at });
      else console.log(`Übersprungen (zu spät): ${clock(x.at)} ${x.title}`);
    }
    const future = open.filter((i) => i.at > now + 2000);
    if (!future.length) break;
    await sleep(Math.min(Math.min(...future.map((i) => i.at)) - now, 60e3));
  }
  console.log('Fertig für diese Stunde.');
} else {
  console.error('Aufruf: node live.mjs check|run');
  process.exit(1);
}
