# Gewohnheiten

Ein schlanker Gewohnheits-Tracker als Web-App fürs Handy (PWA).

## Funktionen

- **Zielwerte & Wochenziele:** Gewohnheiten können eine Menge zählen (z. B. 2000 ml Wasser, +250 ml pro Tipp; Teilfortschritt
  zählt anteilig) oder X-mal pro Woche an beliebigen Tagen fällig sein (Abrechnung sonntags, Serie in Wochen)
- **Fokus-Modus:** Timer (15–60 Min) mit wachsendem Setzling, startbar aus dem laufenden Block oder dem Baum-Tab. Jede volle
  25 Min Fokus pro Tag geben +1 Wachstum, höchstens +3 pro Tag; die Gesundheit bleibt Sache der Gewohnheiten
- **Tagesabschluss & Wochenrückblick:** abends Stimmung, Energie und Notiz mit Tageszusammenfassung; in der Statistik ein
  Rückblick pro Woche (Tagesquote, Fokus, stärkste/schwächste Gewohnheit, Baum, Stimmung) und erkannte Muster

- **Tagesablauf:** Tagestypen wie „Uni-Tag“ oder „Wochenende“ mit Zeitblöcken (Morgenroutine, Vorlesung, Essen, Sport …),
  die den Wochentagen zugeordnet werden. Für einzelne Tage lässt sich ein anderer Typ wählen. Die Live-Zeitleiste zeigt,
  was gerade läuft (mit Restzeit), was als Nächstes kommt und wo freie Zeit ist. Routine-Blöcke haben Schritte statt Häkchen
- **Gewohnheiten im Ablauf:** Blöcke können mehrere Gewohnheiten enthalten (z. B. Kreatin in der Morgenroutine), die direkt
  in der Zeitleiste abgehakt werden. Freie Lücken lassen sich per „+ Einplanen“ nur für heute füllen; fällige, noch nicht
  eingeplante Gewohnheiten werden angezeigt
- **In Blöcken erledigen:** Über „＋ To-do / Gewohnheit“ lassen sich To-dos und (nur für diesen Tag) Gewohnheiten in
  einen Block legen, z. B. Kreatin in die Morgenroutine oder eine Mail in die Uni-Pause. Umgekehrt ordnet der
  📍-Button ein To-do einem Block oder einer Uhrzeit zu. Abgehakt wird direkt im Block
- **Tag flexibel anpassen:** Jeder Block lässt sich nur für einen Tag verschieben (−30 bis +60 Min oder freie Zeiten),
  optional mit allen folgenden Blöcken, oder auslassen. Der Tagestyp bleibt unverändert; Anpassungen sind markiert
  und lassen sich einzeln oder für den ganzen Tag zurücksetzen
- **Vorausplanen:** Über die Tagesleiste im Ablauf lassen sich die nächsten 6 Tage planen: Tagestyp ändern,
  freie Lücken füllen, To-dos für diesen Tag anlegen. Statt des Live-Status gibt es eine Planungsübersicht
- **Pausieren:** Gewohnheiten lassen sich bis zu einem Datum oder bis auf Weiteres pausieren (z. B. Sport bei einer
  Verletzung). Pausentage zählen nicht für Baum, Serien, Quote und Erinnerungen; die Zeiträume werden gespeichert
- **To-dos:** für heute, morgen oder „diese Woche“, optional mit Uhrzeit, dazu „Liegen geblieben“. Gibt es heute To-dos,
  zählt „Alle To-dos erledigt“ für den Baum wie eine zusätzliche Gewohnheit (Wochen-To-dos zählen nicht täglich)
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
| `plan.js` | Logik des Tagesablaufs (Tagestypen, Zeitleiste, Bereinigung, Vorlage) |
| `ablauf.js` | Ansicht und Editor des Tagesablaufs |
| `focus.js` | Fokus-Modus (Timer, Sessions) |
| `review.js` | Tagesabschluss und Wochenrückblick |
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
