// Verschickt die Morgen-/Abend-Erinnerung per Web Push. Läuft stündlich in GitHub Actions.
//   node send-reminder.mjs check  -> schreibt send=true/false nach $GITHUB_OUTPUT
//   node send-reminder.mjs send   -> verschickt die Benachrichtigung
// Konfiguration kommt aus dem Secret PUSH_CONFIG (in der App unter Einstellungen erzeugt).
import { appendFileSync } from 'node:fs';

const mode = process.argv[2];
const raw = process.env.PUSH_CONFIG;

function output(key, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

if (!raw) {
  console.log('Kein Secret PUSH_CONFIG gesetzt. Richte die Erinnerungen in der App unter Einstellungen ein.');
  output('send', 'false');
  process.exit(0);
}

let cfg;
try {
  cfg = JSON.parse(raw);
  if (!cfg.subscription?.endpoint || !cfg.vapid?.publicKey || !cfg.vapid?.privateKey) throw new Error('Felder fehlen');
} catch (err) {
  console.error(`PUSH_CONFIG ist ungültig (${err.message}). Kopiere den Code in der App erneut.`);
  process.exit(1);
}

// v1 hatte nur eine Uhrzeit (abends), v2 hat morning/evening (je Stunde oder null)
const slots = cfg.morning !== undefined || cfg.evening !== undefined
  ? { morning: cfg.morning ?? null, evening: cfg.evening ?? null }
  : { morning: null, evening: cfg.hour ?? null };

if (mode === 'check') {
  const tz = cfg.timezone || 'Europe/Berlin';
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(new Date()));
  const force = process.env.FORCE === 'true';
  let slot = Object.keys(slots).find((k) => slots[k] !== null && Number(slots[k]) === hour) || null;
  // Manuell gestartet: passende Erinnerung zur Tageszeit schicken
  if (!slot && force) slot = hour < 14 && slots.morning !== null ? 'morning' : 'evening';
  const plan = Object.entries(slots).map(([k, v]) => `${k === 'morning' ? 'morgens' : 'abends'} ${v === null ? 'aus' : `${v} Uhr`}`).join(', ');
  console.log(`Es ist ${hour} Uhr (${tz}). Eingestellt: ${plan}${force ? ' (manuell gestartet)' : ''} -> ${slot ? `sende ${slot === 'morning' ? 'Morgen' : 'Abend'}-Erinnerung` : 'nichts zu tun'}.`);
  output('send', String(!!slot));
  output('slot', slot || '');
} else if (mode === 'send') {
  const { default: webpush } = await import('web-push');
  const [owner = 'user', repo = ''] = (process.env.GITHUB_REPOSITORY || '').split('/');
  webpush.setVapidDetails(`https://${owner.toLowerCase()}.github.io/${repo}/`, cfg.vapid.publicKey, cfg.vapid.privateKey);
  try {
    // Keine Nutzdaten: Das Handy berechnet den Text selbst aus den lokalen Daten.
    const slot = process.env.SLOT === 'morning' ? 'morning' : 'evening';
    const res = await webpush.sendNotification(cfg.subscription, JSON.stringify({ type: 'reminder', slot }), { TTL: 3 * 3600, urgency: 'high' });
    console.log(`${slot === 'morning' ? 'Morgen' : 'Abend'}-Erinnerung verschickt (Status ${res.statusCode}).`);
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      console.error('Das Benachrichtigungs-Abo ist abgelaufen. Richte die Erinnerungen in der App neu ein und aktualisiere das Secret PUSH_CONFIG.');
    } else {
      console.error(`Senden fehlgeschlagen: ${err.statusCode || ''} ${err.body || err.message}`);
    }
    process.exit(1);
  }
} else {
  console.error('Aufruf: node send-reminder.mjs check|send');
  process.exit(1);
}
