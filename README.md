# Gewohnheiten

Ein schlanker Gewohnheits-Tracker als Web-App fürs Handy (PWA).

## Funktionen

- **Heute-Ansicht:** nur der heutige Tag mit Fortschrittsring. Den Vortag kann man bis 12 Uhr mittags nachtragen
- **Flexible Planung:** täglich, werktags oder an beliebigen Wochentagen. Freie Tage unterbrechen keine Serie
- **Streaks:** aktuelle und beste Serie, Meilenstein-Meldungen
- **Lebensbaum:** Erledigte Gewohnheiten lassen einen Baum über 8 Stufen wachsen. Die Gesundheit ändert sich
  stufenlos je nach erledigtem Anteil (0 % → −25, 50 % → −10, 70 % → ±0, 100 % → +10), jede zusätzliche Gewohnheit
  zählt. Bei 0 geht der Baum ein und fällt eine Stufe zurück. Gießkannen, verdient mit 7 perfekten Tagen, retten
  einen Tag unter 50 %. Dazu eine Chronik und Warnungen auf „Heute“
- **Erinnerungen:** Push-Benachrichtigung morgens und/oder abends mit dem Zustand deines Baums (siehe unten)
- **Viel Auswahl:** 18 Farben plus freie Farbwahl, rund 90 Symbole in 5 Kategorien
- **Statistik:** Quote der letzten 30 Tage und Kalender-Heatmap der letzten 17 Wochen
- **Offline & privat:** kein Konto, kein Server, alle Daten bleiben im Browser (`localStorage`)
- **Backup:** Export und Import als JSON-Datei
- Installierbar auf dem Homescreen, Dark Mode, deutsche Oberfläche

## Starten

Es gibt keinen Build-Schritt, es reicht ein beliebiger statischer Webserver:

```bash
npx http-server -c-1 .
# oder
python3 -m http.server 8080
```

Dann `http://localhost:8080` öffnen. Damit man die App auf dem Handy installieren kann, muss sie über HTTPS
ausgeliefert werden, z. B. über GitHub Pages.

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `index.html` | Grundgerüst, Ansichten, Dialog |
| `style.css` | Design inkl. Dark Mode |
| `app.js` | Datenhaltung, Streak-Berechnung, Rendering |
| `tree.js` | Spielregeln und Zeichnung des Lebensbaums |
| `idb.js` | Kopie der Daten in IndexedDB, damit der Service Worker sie lesen kann |
| `sw.js` | Service Worker für Offline-Betrieb und Benachrichtigungen |
| `scripts/send-reminder.mjs`, `.github/workflows/reminder.yml` | Stündlicher GitHub-Actions-Job, der die Erinnerung verschickt |
| `manifest.webmanifest`, `icons/` | App-Name und Icons für die Installation |

Wer Dateien ändert, sollte `VERSION` in `sw.js` erhöhen, damit installierte Apps das Update laden.

## Erinnerungen

Eine Web-App kann sich nicht selbst zu einer Uhrzeit wecken. Den Versand übernimmt deshalb GitHub Actions:

1. In der App unter **Einstellungen → Erinnerungen** Uhrzeiten für morgens und abends wählen und „Erinnerungen einrichten“ tippen.
   Die App erzeugt ein eigenes Schlüsselpaar (VAPID) und meldet sich beim Push-Dienst des Browsers an.
2. Den angezeigten Code als Repository-Secret `PUSH_CONFIG` speichern (Settings → Secrets and variables → Actions).
3. Der Workflow `Erinnerung` läuft stündlich und verschickt zur eingestellten Stunde einen Push, der nur
   „morning“ oder „evening“ enthält.
   Der Text wird erst auf dem Gerät im Service Worker aus den lokalen Daten berechnet, deine Gewohnheiten
   verlassen das Handy also nie.

Hinweise: Auf iPhone/iPad funktioniert das nur mit der App auf dem Home-Bildschirm (ab iOS 16.4).
Geplante Workflows laufen nur auf dem Standard-Branch und können sich bei GitHub um einige Minuten verspäten.
In öffentlichen Repos pausiert GitHub sie nach 60 Tagen ohne Aktivität im Repo; dann unter „Actions“ wieder aktivieren.
