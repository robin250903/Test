# Gewohnheiten

Ein schlanker Gewohnheits-Tracker als Web-App fürs Handy (PWA).

## Funktionen

- **Heute-Ansicht:** Gewohnheiten abhaken, Fortschrittsring, die letzten 7 Tage nachtragen
- **Flexible Planung:** täglich, werktags oder an beliebigen Wochentagen. Freie Tage unterbrechen keine Serie
- **Streaks:** aktuelle und beste Serie, Meilenstein-Meldungen
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
| `sw.js` | Service Worker für den Offline-Betrieb |
| `manifest.webmanifest`, `icons/` | App-Name und Icons für die Installation |

Wer Dateien ändert, sollte `VERSION` in `sw.js` erhöhen, damit installierte Apps das Update laden.
