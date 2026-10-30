# NeuralAgent – Admin-Handbuch

Stand: 2026-10-30 (Version 0.1.2, Meilensteine M0–M9 fertig, M10 offen).
Dieses Handbuch ist für dich als Betreiber. Es erklärt, was gebaut wurde, wie du es benutzt und betreibst, und vor allem, **wo die Umsetzung vom ursprünglichen Auftrag abweicht** (Abschnitt 4).

Quellen: der ursprüngliche Auftrag (`research-local/PROMPT.md`), `docs/DECISIONS.md` (D1–D39), `docs/STATUS.md`, `docs/PLAN.md`, `docs/HANDOFF.md`. Was die Dokumente nicht belegen, steht hier nicht oder ist als "nicht von Hand getestet" markiert.

## Inhalt

1. Kurzüberblick
2. Funktionen im Detail
3. Admin-Aufgaben
4. Abweichungen und Entscheidungen
5. Offene Punkte und Checkliste für dich

---

## 1. Kurzüberblick

NeuralAgent ist eine Arbeitsfläche für KI-Coding-Agents (Claude Code, Codex usw.). Du startest mehrere Agents in Terminals, siehst auf einen Blick, wer arbeitet oder auf dich wartet, und steuerst alles auch vom Handy aus – per Chat oder per Telefonanruf bei "Neural", dem Orchestrator.

| Teil | Was es ist |
|---|---|
| **Desktop-App** (macOS, Windows, Linux) | Das Fenster mit Workspaces, Terminal-Grid, Agent-Dashboard, Einstellungen. Gebaut mit Tauri 2 (ein Rahmen, der eine Web-Oberfläche als Desktop-App verpackt). |
| **Daemon** `neuralagentd` | Ein Hintergrunddienst, der die Terminals, Agents und den ganzen Zustand hält. Er läuft weiter, wenn du die App schließt oder aktualisierst. Die App ist nur ein Client davon (D1). |
| **Neural** (Orchestrator) | Der Assistent im Daemon. Du chattest oder telefonierst mit ihm, er startet, promptet und überwacht Agents. Weckwort: "Hey Neural". |
| **Relay-Server** | Ein kleiner Server (Rust, SQLite) unter `agent.neuralhub.dev`. Er vermittelt zwischen Rechner und Handy, verwaltet Konten und liefert Webseiten und Downloads aus. Er sieht nur verschlüsselte Daten. |
| **Web-Remote / PWA** | Dieselbe Oberfläche im Browser unter `/app`. Auf dem iPhone als "Progressive Web App" installierbar (eine Webseite, die sich wie eine App verhält). |
| **Android-App** | Eine dünne Hülle (Capacitor) um die Web-Remote, plus Native-Teile: Push, Widget, Schnellkachel, Anruf bei gesperrtem Handy. |
| **Admin-Bereich** | `/admin/` auf dem Relay: Anfragen freigeben, Nutzer verwalten, Statistik. |
| **Landing und Download-Seite** | `/` und `/download` auf dem Relay. |
| **Auto-Update** | Desktop und APK holen neue Versionen vom Relay. |

### Wie die Teile miteinander reden

```
 Desktop-App (Fenster) ──lokal──►  Daemon  (Terminals, Agents, Neural, Sprache)
                                      │
                                      │ ausgehende WebSocket-Verbindung, Ende-zu-Ende verschlüsselt
                                      ▼
                       Relay  agent.neuralhub.dev  (ein Port, 8080)
                       /  Landing   /download   /app (Web-Remote)   /admin
                       /auth (Login)  /api (Konten, Push, Updates)   /ws (Weiterleitung)
                                      ▲
                                      │ verschlüsselt (WebCrypto)
              ┌───────────────────────┴───────────────────────┐
         Browser / iPhone-PWA                          Android-App
         (gleiche Oberfläche /app)               (lädt /app live vom Server)
```

Wichtig: Der **Desktop bleibt die Quelle der Wahrheit**. Agents laufen nur auf deinen Rechnern, nie auf dem Server. Wer lokal ohne Konto arbeitet, hat keinerlei Verbindung zum Server außer der Update-Prüfung und dem Download (D38).

---

## 2. Funktionen im Detail

Hinweis zu Begriffen, die mehrfach vorkommen: **Workspace** = ein Projektordner mit seinen Terminals. **Pane** = ein einzelnes Terminal-Feld im Grid. **Agent** = ein KI-Programm (CLI) in einem Pane. **CLI** = ein Programm, das man im Terminal bedient.

### 2.1 Terminals, Pane-Grid, Tabs
**Was:** Pro Workspace gibt es ein Grid mit 1 bis 16 Panes, frei teilbar. Mehr als 16 landen in neuen Tabs (D12).
**Bedienung:** Teilen per Button oder ⌘D / ⌘\, Voreinstellungen 1–16, Zoom auf ein Pane mit ⌘↩, Trennlinien ziehen, ⌘1…9 springt zu Panes. Das Layout wird gespeichert. Die Terminals nutzen xterm.js (eine Terminal-Darstellung für Webseiten), bei vielen sichtbaren Terminals in einem sparsameren Modus (D13).
**Stand:** 16 Shells mit Dauerausgabe liefen flüssig (Daemon ~12 % CPU).
**Beispiele:**
- Du startest abends drei Claude-Code-Agents in zwei Repos, jeder in einem eigenen Pane, und siehst alle gleichzeitig.
- Ein Pane läuft als Server-Log, daneben ein Agent, der am Code arbeitet. Mit ⌘↩ zoomst du kurz auf den Agent.

### 2.2 Agent-Katalog und Ein-Klick-Installation
**Was:** Der Daemon kennt 13 Agent-CLIs und erkennt installierte automatisch (`which` plus `--version`). Fehlt eine, installierst du sie per Klick (D15).
**Bedienung:** Seitenleiste → "Agents" → "Install agents", oder "Install agents…" im Menü "New agent". Der Installationsbefehl des Herstellers läuft **sichtbar in einem Pane**, damit du Rückfragen (z. B. sudo) selbst beantwortest. Danach wird neu erkannt. Eigene Profile (Befehl, Argumente) legst du im Katalog unter "Profiles" an.
**Stand:** Codex wurde echt installiert. Auf dem Handy braucht ein Installationsstart eine Freigabe.
**Beispiele:**
- Du richtest einen neuen Rechner ein und installierst Claude Code und Codex nacheinander per Klick, ohne die Befehle zu googeln.
- Du legst ein Profil "Claude Haiku" mit `--model haiku` an und nutzt es für günstige Testläufe.

### 2.3 Status über Hooks
**Was:** Jeder Agent zeigt: startet, arbeitet, wartet auf Eingabe, fertig, Fehler. **Hooks** sind Einhängepunkte, über die ein Agent dem Daemon Ereignisse meldet. Sie werden pro Prozess übergeben und verändern deine eigene Konfiguration nie (D6, D16). Bei CLIs ohne Hooks schätzt der Daemon den Status aus der Ausgabe.
**Bedienung:** Seitenleiste → "Agents" zeigt alle Agents aller Workspaces, Dringendes zuerst, mit letzter Nachricht und Zeit im Status. Dort auch Stoppen, Neustart, Öffnen.
**Stand:** Claude Code live geprüft. Codex nur mit einem nachgestellten Aufruf; ein echter Codex-Durchlauf steht aus, er braucht deinen Login (D17).
**Beispiele:**
- Du lässt fünf Agents laufen und schaust nur auf die Liste: zwei sind fertig, einer wartet auf dich.
- Ein Agent meldet Fehler. Du öffnest ihn direkt aus dem Dashboard.

### 2.4 Freigaben (Approvals)
**Was:** Jeder Workspace ist standardmäßig freigegeben (pro Workspace abschaltbar). Handy und Neural dürfen nur in freigegebenen Workspaces Agents starten, prompten und stoppen. Rohe Shells, Einstellungen und Freigaben selbst gibt es nur am Desktop (D7).
**Bedienung:** Schalter pro Workspace. Auch ein Agent, der Erlaubnis für ein Werkzeug braucht ("Wants to use Bash"), erscheint als "wartet auf Eingabe".
**Hinweis:** Die im Auftrag genannte Bestätigung "per Push/am Handy" für Aktionen außerhalb freigegebener Ordner ist laut D7 als Warteschlange mit dem Remote-Teil vorgesehen. Dass sie komplett ausgebaut ist, belegt STATUS nicht; die Policy selbst (Handy kann außerhalb freigegebener Workspaces nichts) ist im Remote-Test geprüft.
**Beispiele:**
- Dein privater Ordner mit Notizen bleibt ungeschützt vom Handy: du schaltest die Freigabe aus.
- Unterwegs startest du per Handy einen Agent im freigegebenen Projekt, aber ein Terminal im Home-Ordner geht nicht.

### 2.5 Diktat und Weckwort
**Was:** Sprache wird lokal in Text umgewandelt (STT, "speech to text"), nichts geht in die Cloud. Zwei Wege: Push-to-Talk (Taste halten, sprechen, loslassen, der Text wird in die gerade aktive App getippt, systemweit) und das Weckwort "Hey Neural" (D19–D22).
**Bedienung:** Einstellungen (Zahnrad unten in der Seitenleiste) → "Voice models": Parakeet, Weckwort-Erkenner und Silero laden (zusammen ca. 630 MB, mit Prüfsumme). Standardtaste ⌥/Alt+Leertaste (auch ⌘⇧Leertaste oder F5). macOS fragt einmal nach Mikrofon und Bedienungshilfen. Weckwort einschalten: "Listen for Hey Neural". Bei deutscher Aussprache hilft "Learn my voice" (3 Aufnahmen). Beim Sprechen erscheint am unteren Bildschirmrand eine kleine "Listening…"-Pille.
**Stand:** Mit Testaudio Ende-zu-Ende geprüft (Weckwort 4/4, keine Fehlauslöser). **Mit deiner echten Stimme nicht getestet**, und Windows/Linux-Sprache nicht getestet. Das Weckwort-Modell ist englisch; deutsch ausgesprochenes "Hey Neural" erkannte es im Test 0/8, nach "Learn my voice" 4/8 (D20).
**Beispiele:**
- Du hältst ⌥ Leertaste im Browser-Fenster eines Tickets und diktierst einen Prompt.
- Du sagst von der Couch "Hey Neural, was machen meine Agents?" und siehst die Antwort.

### 2.6 Sprachantworten
**Was:** Neural spricht Antworten lokal aus (TTS, "text to speech"), Satz für Satz, damit der erste Satz schon läuft, während der Rest entsteht. Engine: Supertonic 3, Deutsch und Englisch (D21).
**Bedienung:** Einstellungen → "Calls": Stimme (höher/tiefer 1–5), Tempo, gesprochene Vorschau.
**Beispiele:**
- Du lässt dir den Status beim Kochen vorlesen.
- Du stellst die Stimme etwas tiefer ein und hörst sie vorher in der Vorschau an.

### 2.7 Ruhezustand verhindern (Keep-awake)
**Was:** Solange Agents arbeiten, verhindert der Daemon den Ruhezustand des Rechners. Der Bildschirm darf aus (M4).
**Bedienung:** Einstellung: Aus / immer / nur am Strom. Danach schläft der Mac wieder (ein paar Sekunden nach Arbeitsende).
**Stand:** Auf macOS geprüft (`pmset` zeigt "Agents are working").
**Beispiele:**
- Du startest einen langen Refactor, klappst den Bildschirm aus und gehst essen; der Mac schläft nicht.
- Auf dem Laptop im Akkubetrieb lässt du die Einstellung auf "nur am Strom".

### 2.8 Discord-Präsenz
**Was:** Dein Discord-Profil zeigt "NeuralAgent · …". Modi: Aus / General / Detailed, Standard General (nur Anzahl und Status, keine Projektnamen); Detailed nennt Workspace-Namen. Ist Discord zu, passiert nichts.
**Stand:** Logik per Test geprüft. **Der Live-Test mit offenem Discord steht aus** (Checkliste).
**Beispiele:**
- Auf deinem Server zeigst du "Working with AI agents" als Showcase.
- Im Stream stellst du auf General, damit keine Kundennamen sichtbar sind.

### 2.9 Fortsetzen nach Neustart
**Was:** Startet der Daemon neu (z. B. nach Rechnerneustart), werden laufende Sessions im selben Pane neu gestartet. Agents mit bekannter Konversations-ID bekommen das Resume-Argument ihrer CLI (Claude: `--resume <id>`). Abschaltbar.
**Stand:** Geprüft (Session lebte wieder und nahm Eingaben an).
**Beispiele:**
- Nach einem Update und Neustart sind abends alle Panes wieder da.
- Du schaltest die Funktion aus, wenn nach einem Neustart nichts automatisch laufen soll.

### 2.10 Verlauf: Suche und Fortsetzen
**Was:** Seitenleiste → "History" durchsucht alte Claude-Code- und Codex-Konversationen auf diesem Rechner (nur Titel und deine eigenen Prompts; Tool-Ausgaben und Antworten werden nicht gelesen). "Resume" öffnet die CLI mit ihrem Resume-Befehl im ursprünglichen Ordner.
**Stand:** Auf 1,9 GB echter Transkripte gemessen: erste Suche 5,9 s (Debug-Build), danach 2–3 ms. Einen echten Codex-Resume aus dem Dashboard führt STATUS noch als offen.
**Beispiele:**
- "Wo habe ich letzte Woche den Login-Bug besprochen?" – Suchwort eintippen, Resume klicken.
- Du machst eine alte Konversation in genau dem Ordner weiter, wo sie entstand.

### 2.11 Menüleiste / Tray
**Was:** Das Symbol in der Menüleiste (Windows/Linux: Tray) zeigt "N agents · M working / K need you", "Open NeuralAgent", "Quit (agents keep running)" und "Quit and stop all agents". Auf macOS steht die Zahl der wartenden Agents neben dem Symbol. Fenster schließen (⌘W) lässt die App in der Menüleiste weiterlaufen, damit Diktat und Weckwort funktionieren. Außerdem "Disconnect remote" als Not-Aus.
**Stand:** Alles geprüft bis auf den Klick auf "Disconnect remote" in der echten Menüleiste (Checkliste).
**Beispiele:**
- Du beendest die App, die Agents laufen weiter, ein Blick ins Menü zeigt "2 working".
- Unterwegs siehst du am Zähler, dass dich ein Agent braucht.

### 2.12 Git-Änderungen und Worktrees pro Agent
**Was:** Die Leiste des Workspaces zeigt Branch und Anzahl geänderter Dateien; "Changes" zeigt Dateiliste und Diff pro Datei. Optional "Own worktree per agent": Jeder neue Agent bekommt einen eigenen Branch `neuralagent/<profil>-<id>` in einem **Worktree** (ein zusätzlicher Arbeitsordner desselben Repos) unter `.neuralagent/worktrees/` (D23).
**Rückführen:** "Merge into main" committet, führt zusammen, löscht Worktree und Branch und schließt den Agent. Bei Konflikt wird alles abgebrochen und nichts ändert sich. "Discard" verwirft.
**Stand:** Auf einem Klon geprüft.
**Beispiele:**
- Zwei Agents bauen parallel am selben Repo, jeder in seinem Worktree, ohne sich in die Quere zu kommen.
- Ein Agent hat Unsinn gebaut: "Discard", der Hauptzweig bleibt sauber.

### 2.13 Browser-Vorschau
**Was:** Der Daemon erkennt in der Terminal-Ausgabe die Adresse eines Dev-Servers. Das Pane bekommt einen Globus-Button, der ein Browser-Pane daneben öffnet (in einer Sandbox, kann das App-Fenster nicht umleiten). Leere Panes bieten ebenfalls "Browser".
**Wichtig:** Auf dem Handy wird eine lokale Adresse **noch nicht** geladen; der im Auftrag geforderte Tunnel über den Relay ist laut STATUS nicht umgesetzt (siehe Abschnitt 4).
**Beispiele:**
- Der Agent startet Vite, du siehst die Seite sofort neben dem Terminal.
- Du prüfst die Änderung, ohne den Browser separat zu öffnen.

### 2.14 MCP-Server
**Was:** **MCP-Server** sind Zusatzwerkzeuge, die Agents nutzen können. Seitenleiste → "MCP": eine Liste für alle Agents. Hinzufügen per Befehl oder HTTP-Adresse mit geheimen Variablen, abschaltbar, einmaliger Import aus Claude Code und Codex. Jeder danach gestartete Claude Code, Codex und OpenCode bekommt sie (D24). Die geheimen Werte liegen nur in einer privaten Datei des Daemons und erreichen Agents nur über ihre Umgebung; sie landen nie im Zustand, in der Kommandozeile oder im Browser. Einen Katalog oder Shop gibt es bewusst nicht.
**Beispiele:**
- Du trägst einmal deinen Datenbank-MCP ein, und alle Agents sehen ihn.
- Du schaltest einen MCP zeitweise ab, ohne ihn zu löschen.

### 2.15 Nutzung und Kosten
**Was:** Der Daemon liest die Token-Zahlen aus den Transkripten von Claude Code und Codex (kein Proxy, keine Keys). Kosten sind eine **Schätzung zu API-Listenpreisen**; Abo-Nutzer zahlen ihren Tarif. Unbekannte Modelle zeigen "no price" statt eines falschen Preises. Abo-Limits kommen bei Claude Code über einen eigenen Statusline-Befehl, der danach deinen eigenen unverändert ausführt (D25).
**Bedienung:** Seitenleiste → "Usage".
**Stand:** Auf diesem Mac gemessen (7 Tage, ~9.950 Aufrufe, erste Lesung 17,7 s, danach 13 ms). Limits mit echtem Abo und echte Codex-Limits nicht geprüft (nur Unit-Test).
**Beispiele:**
- Am Monatsende siehst du, welcher Workspace am meisten verbraucht hat.
- Du erkennst, dass ein Agent für eine Kleinigkeit ein teures Modell nutzte.

### 2.16 Remote-Zugriff und Kopplung
**Was:** Remote gibt es nur mit Konto und deiner Freigabe (siehe Abschnitt 3). Auf dem Rechner: Seitenleiste → "Remote" → "Continue with GitHub/Google". Ein neues Gerät meldest du mit demselben Konto an. Zusätzlich "Add phone": ein QR-Code, einmal nutzbar, 2 Minuten gültig, nur für dasselbe Konto. Dort auch Geräteliste, einzelnes Abmelden, "Sign out everywhere" und der Not-Aus (D27, D29).
**Wichtig:** Remote-Clients (Handy, Browser) werden immer wie ein Handy behandelt, egal was sie behaupten, und können Remote-Einstellungen nicht ändern – außer dem Not-Aus.
**Beispiele:**
- Du scannst am Laptop den QR-Code mit dem Handy und bist sofort verbunden.
- Das Handy ging verloren: "Sign out everywhere", sofort getrennt.

### 2.17 Ende-zu-Ende-Verschlüsselung (E2E)
**Was:** Zwischen Rechner und Handy/Browser sind Inhalte verschlüsselt, der Relay sieht nur Chiffre (X25519 Schlüsselaustausch, AES-256-GCM). Der QR-Code enthält den Fingerabdruck des Rechner-Schlüssels, so erkennt das Handy einen vom Relay untergeschobenen Schlüssel (D28).
**Ehrliche Grenze:** Schützt vor passivem Mitlesen, nicht vor einem übernommenen Server, der die Web-App ausliefert. Ein Handy, das nur per Login (ohne QR) verbunden wurde, vertraut dem Schlüsselverzeichnis des Relays beim ersten Mal; der Fingerabdruck wird auf beiden Seiten angezeigt zum Vergleichen. Browser-Schlüssel liegen in IndexedDB (nicht auslesbar), nur als Notlösung als Bytes in localStorage (D32). Ein eigenes Dokument `docs/SPEC.md`, wie im Auftrag verlangt, existiert **nicht**.
**Beispiele:**
- Auch wenn jemand die Server-Datenbank kopiert, findet er keine Terminal-Inhalte.
- Du vergleichst bei einem neuen Browser kurz den Fingerabdruck.

### 2.18 Web-Remote und Handy-Layout
**Was:** `https://agent.neuralhub.dev/app` zeigt dieselbe App wie der Desktop. Auf dem Desktop-Browser mit der dichten Seitenleiste; auf dem Handy mit Tab-Leiste: Agents, Workspaces, dazu unter "More" History, Usage, MCP, This device, Settings (D33). Terminals bekommen auf dem Handy eine Sondertasten-Leiste (Esc, Tab, Ctrl, Pfeile) und eine eigene Eingabezeile (D35); ein Pane wird pro Ansicht gezeigt, Chips wechseln.
**iPhone:** Installation über Teilen → "Zum Home-Bildschirm". Grenzen von iOS: Anruf nur im Vordergrund, keine Widgets.
**Stand:** In Safari-Responsive-Modus und WebKit/Chromium getestet; **auf einem echten iPhone nicht getestet** (kein Xcode, D10).
**Beispiele:**
- Auf einem fremden Rechner öffnest du `/app`, meldest dich an und siehst deine Agents.
- Im Zug antwortest du mit der Sondertasten-Leiste auf "Continue? (y/n)".

### 2.19 Push-Benachrichtigungen
**Was:** Wird ein Agent fertig, scheitert oder wartet auf dich, bekommst du eine Meldung. Der Relay sieht nur Art und Sitzungs-ID, keine Namen oder Terminaltext; das Gerät schreibt den Text selbst (D34). Wer die App gerade geöffnet hat, bekommt keinen Push. Android über FCM (Firebase), Browser/iPhone-PWA über Web Push. Limit 30 Pushes pro Konto und Minute. Ein Tipp öffnet genau den Agent.
**Bedienung:** "This device" → Benachrichtigungen einschalten.
**Stand:** Android im Emulator, Web Push in Chromium mit Mock-Dienst geprüft. **Ein echter Push von Apple auf ein iPhone wurde nicht gesehen.** Antwort-Buttons in der Meldung (Ja/Nein) sind laut STATUS nicht umgesetzt.
**Beispiele:**
- Du gehst spazieren; das Handy meldet "Agent fertig", ein Tipp öffnet ihn.
- Ein Agent bleibt hängen und wartet auf Eingabe; du bekommst die Meldung nicht doppelt, weil du schon am Laptop sitzt.

### 2.20 Android-App (Widget, Schnellkachel, Sperrbildschirm-Anruf)
**Was:** Die APK lädt `/app` live vom Server, ist also immer aktuell (D35). Nativ dazu: FCM-Push, **Homescreen-Widget** (Rechner und Agent-Zusammenfassung), **Schnellkachel** (zeigt "An agent needs you" und öffnet die App; eine zweite Kachel "Call Neural"), Anmeldung im Custom Tab mit Rückkehr über `neuralagent://auth`. Beim Anruf läuft ein Mikrofon-Dienst mit Benachrichtigung und "Hang up"; die App erscheint über dem Sperrbildschirm.
**Stand:** Im Emulator geprüft (inkl. Sperrbildschirm-Anruf; das Emulator-Mikrofon fehlt, das Audio selbst wurde im Browser getestet). **Auf einem echten Handy, mit Headset und mit Headset-Taste nicht getestet.** Eine Headset-Tastensteuerung belegt STATUS nicht.
**Beispiele:**
- Du tippst die Kachel "Call Neural" im gesperrten Zustand und gibst per Stimme einen Auftrag.
- Das Widget zeigt auf dem Homescreen, dass zwei Agents arbeiten.

### 2.21 Audit-Log
**Was:** Jede Aktion von Handy, Browser und Neural wird protokolliert und ist in der App sichtbar (Seitenleiste → "Remote", Audit-Bereich). Beispiel-Eintrag: Neural startete Session "Japan-Map", Erfolg.
**Beispiele:**
- Du prüfst nach einer Reise, was vom Handy aus passiert ist.
- Du siehst, dass Neural nur in freigegebenen Workspaces gehandelt hat.

### 2.22 Neural-Orchestrator (BYOK, Werkzeuge, gemeinsamer Chat)
**Was:** Neural ist ein Client des Daemons mit denselben Regeln und demselben Audit-Log wie ein Handy (D36). Er findet Ordner aus Alltagssprache, startet, promptet und stoppt Agents, beantwortet Statusfragen und kann Swarms starten. Der Chat (letzte 60 Nachrichten) ist Teil des gemeinsamen Zustands: Desktop, Browser und Handy zeigen denselben Verlauf.
**BYOK ("bring your own key", du bringst deinen eigenen Schlüssel):** Anbieter einstellbar: NeuralHub (Voreinstellung), Anthropic, OpenAI-kompatibel, Ollama (lokal). Schlüssel liegen im System-Schlüsselbund (Release auf macOS/Windows), sonst in einer nur für dich lesbaren Datei; Remote-Clients können Neural nutzen, aber keine Schlüssel setzen. Einstellungen → "Neural".
**Beispiele:**
- "Starte den Testbot in Japan Map" – Neural findet den Ordner und startet den Agent.
- Du nutzt einen eigenen Anthropic-Key statt des NeuralHub-Keys.

### 2.23 Anrufe mit Neural
**Was:** Seitenleiste → "Neural" → Telefon-Symbol. Alles (Erkennung, Sprachausgabe, Turn-Taking) läuft auf dem Rechner; das Handy streamt nur Audio. Bei Unterbrechen (300 ms Sprechen über Neural) hört er auf. Eine kurze Bestätigung ("Okay.", "Moment.") spielt, falls das Modell noch nicht antwortet. Neuigkeiten ("Testbot ist fertig") sagt er zwischen Antworten. Deutsch und Englisch, er antwortet in deiner Sprache (D36).
**Gemessen (synthetische Anrufer):** Ende des Satzes bis zum ersten Ton 0,8–1,0 s, bis zur eigentlichen Antwort 2,3–3,2 s. Das erste Audio ist die Bestätigung, nicht die inhaltliche Antwort.
**Grenzen:** Die Echo-Unterdrückung des Desktop-Chrome ist schwächer; bei hoher Lautstärke kann Neural sich dort selbst unterbrechen (D36). Dein eigenes Gespräch auf echtem Handy ist auf der Checkliste.
**Beispiele:**
- Du rufst vom Handy an: "Starte einen Agent in Japan Map und lass ihn die UI fixen."
- Du fragst während der Autofahrt "Ist Japan Map fertig?" und bekommst eine kurze gesprochene Antwort.

### 2.24 Swarms
**Was:** Ein **Swarm** ist ein Team aus 1–8 Agents (Standard: Coordinator, Scout, Builder, Reviewer) in einem Workspace mit einem Ziel. Er bekommt einen eigenen Tab mit einem Pane pro Mitglied. Die Mitglieder schreiben sich über einen eingebauten MCP-Server (`neuralagent-swarm`) Nachrichten, die sichtbar sind (D37). Nur der Coordinator startet, die anderen warten. Als "fertig" meldet nur eine Nachricht an dich; Zwischenstände lösen keine Pushes aus.
**Bedienung:** Seitenleiste → "Swarm" → "New swarm", Projekt und Ziel wählen. Stop beendet alle Mitglieder.
**Stand:** Mit Stellvertreter-Agents im CI-Test und einmal mit echten Claude-Haiku-Agents geprüft (24 s, 7 Nachrichten). Verbraucht dein Claude-Kontingent.
**Beispiele:**
- "Füge eine --name-Option zum Skript hinzu": Builder setzt um, Reviewer testet, Coordinator meldet.
- Neural startet einen Swarm per Zuruf, du hörst die Fertig-Meldung.

### 2.25 Themes
**Was:** Sechs Farbschemata plus Akzentfarbe, **pro Gerät** gespeichert (Handy schwarz, Desktop graphit möglich). Das Terminal und das Sprach-Fenster folgen live (D38). Einstellungen → Themes.

### 2.26 Auto-Update und Releases
**Was:** Die App prüft 15 s nach dem Start und alle 6 Stunden. Ein Hinweis "NeuralAgent X is ready" bietet "Install"; auch unter Einstellungen → "Updates". Laufende Agents laufen weiter: Der Daemon läuft aus einer versionierten Kopie, die neue App tauscht ihn erst aus, wenn keine Session mehr lebt (D38). Updates sind signiert. Die APK prüft ihre Version gegen `/api/releases/latest` und bietet die neue APK an.
**Stand:** Update von 0.1.0 auf 0.1.1 lokal und Release 0.1.1 über CI geprüft. **Installation auf Windows/Linux und der APK-Update-Hinweis auf einem echten Handy: nicht von Hand getestet.**
**Beispiel:** Du veröffentlichst ein Update, und deine Mac-App bietet es mittags an, während nachts gestartete Agents unbeeinflusst weiterarbeiten.

### 2.27 Download-Seite und macOS-Installationsbefehl
**Was:** `https://agent.neuralhub.dev/download` listet die neuesten Versionen (Mac Apple-Silicon und Intel, Windows, Linux, APK). Vorabversionen (z. B. `-beta.1`) erscheinen dort nie.
**macOS ohne Rückfrage:** im Terminal
`curl -fsSL https://agent.neuralhub.dev/install.sh | sh`
(Seit 0.1.2 wird das ganze App-Bundle ad-hoc signiert; der Befehl installiert ohne die Sicherheitsabfrage.) Ein per Browser geladenes DMG ist nicht notarisiert: einmal Systemeinstellungen → Datenschutz & Sicherheit → "Trotzdem öffnen". Danach aktualisiert sich die App selbst.

---

## 3. Admin-Aufgaben

### 3.1 Der Admin-Bereich `/admin/`
Adresse: `https://agent.neuralhub.dev/admin/`. Anmelden mit Google oder GitHub über ein Konto, dessen E-Mail in `ADMIN_EMAILS` steht. **Keine Passkeys** (D39); die 2-Faktor-Absicherung deines Anbieters schützt. Dein erster Login ist automatisch freigeschaltet und Admin.

Was der Bereich laut Dokumentation kann: offene Anfragen mit Approve/Deny, Nutzer mit Geräten und dem Schalter "Remote an/aus", Statistik. Das Sperren, Entsperren und Löschen von Nutzern wirkt sofort auf offene Verbindungen (D26; im Relay-Test geprüft). Downloads pro Plattform und Version und Verbindungen über die Zeit stehen im Auftrag; wie weit das Dashboard das im Detail zeigt, habe ich nicht geprüft – schau einmal hinein.

### 3.2 Nutzer freigeben
1. Jemand wählt in der App "Request access" und meldet sich mit Google oder GitHub an. Status: "pending".
2. Du bekommst eine Mail "Access request: …" von `agent@neuralhub.dev`.
3. In `/admin/` auf Approve oder Deny klicken.
4. Der Nutzer bekommt "You're in" bzw. eine Absage; die App schaltet Remote **ohne Neustart** frei.

Die Mailzustellung wurde im Test geprüft; **echte OAuth-Anmeldung und echte Mails sind auf deiner Checkliste**.

### 3.3 Ein Release veröffentlichen
1. `node scripts/set-version.mjs X.Y.Z` (setzt die eine Version für App, Daemon, Relay und APK).
2. Committen.
3. Tag `vX.Y.Z` setzen und pushen.
4. Die CI (`.github/workflows/release.yml`) baut macOS (Apple Silicon und Intel), Windows, Linux und die APK und lädt sie über einen geschützten Endpunkt auf den Relay; danach wird das Manifest veröffentlicht. Unveröffentlichte Uploads sind unsichtbar.
5. Der Relay behält die **letzten 3 veröffentlichten Versionen** und räumt ältere und verwaiste Uploads auf.

Vorabversionen (`-beta.1`) erreichen nur Clients, die selbst schon auf einer Vorabversion sind. Release 0.1.1 lief so komplett grün durch; 0.1.2 folgte.

### 3.4 Den Relay deployen
Zwei Wege (D31, `deploy/relay/`):
- **Automatisch (geplant):** Die CI baut das Relay-Image nach GHCR (GitHub Container Registry, privat). Auf dem Server prüft ein systemd-Timer alle 5 Minuten, zieht ein neues Image, startet es, wartet auf den Health-Check und rollt sonst zum vorherigen Image zurück. **Das läuft erst, wenn der Lese-Token auf dem Server liegt** (Checkliste). Bis dahin:
- **Von Hand (aktueller Stand):** Quellcode per `rsync` auf den Server kopieren (Verzeichnis `/opt/neuralagent/src`), dort das Image bauen (`docker build -f deploy/relay/Dockerfile …`) und `docker compose up -d` in `/opt/neuralagent` ausführen. Das Image enthält `apps/web/dist`. Die genaue Befehlsfolge steht in `docs/HANDOFF.md`.

Der Relay-Container heißt `neuralagent-relay`, hört auf Port 8080; davor liegt dein Proxy (NPM) mit WebSockets. Der Container bekommt nie das Test-Login-Feature (nur für Dev/CI).

### 3.5 Wo liegen Logs?
| Was | Wo |
|---|---|
| Daemon | `<Datenordner>/logs/daemon.log` |
| Desktop-App | `<Datenordner>/logs/app.log` |
| Relay | Container-Logs auf dem Server (`docker logs neuralagent-relay`) |
| Pull-Deployment | Journal des systemd-Dienstes `neuralagent-update` |

Der Datenordner ist der NeuralAgent-Ordner im Benutzerverzeichnis deines Betriebssystems (oder `NEURALAGENT_HOME`, falls gesetzt). Den genauen Pfad für Release-Builds habe ich nicht nachgeprüft.

### 3.6 Wo liegen Geheimnisse?
(Hier steht nur der Ort, nie ein Wert.)

| Geheimnis | Ort |
|---|---|
| OAuth- und Mail-Zugangsdaten, Admin-Liste, Upload-Token des Relays | Env-Datei `/etc/neuralagent/relay.env` auf dem Server (nie ausgeben) |
| Firebase-Dienstkonto für Push | Datei auf dem Server unter `/etc/neuralagent/`, in den Container eingebunden |
| GHCR-Lesetoken | Env-Datei `/etc/neuralagent/ghcr.env` auf dem Server (noch anzulegen) |
| Vorbereitete Dateien (`server.env`, Firebase-Dateien) | Ein Ordner außerhalb des Repos auf deinem Mac |
| Updater-Signierschlüssel (Desktop) | GitHub-Secrets und lokal außerhalb des Repos; Passwort im macOS-Schlüsselbund |
| Android-Keystore und Passwort | Keystore-Datei außerhalb des Repos, Passwort im macOS-Schlüsselbund, beides als GitHub-Secrets für die CI |
| Dein NeuralHub-API-Key für Neural | macOS-Schlüsselbund |
| Remote-Zugangsdaten im Desktop | System-Schlüsselbund (Release auf macOS/Windows), sonst Datei nur für dich lesbar |
| MCP-Geheimnisse der Agents | private Datei des Daemons (`mcp-secrets.json`, nur für dich lesbar) |

Die CI enthält einen Secret-Scan.

### 3.7 Backups
Laut Checkliste in STATUS **außerhalb des Repos** sichern (Passwortmanager oder offline):
- **Android-Keystore samt Passwörtern.** Ohne denselben Keystore lässt sich nie ein APK-Update über die alte App installieren.
- **Updater-Signierschlüssel samt Passwort.** Ohne ihn gibt es keine Desktop-Updates.
- **Relay-Secrets** (`relay.env`) **und die Datenbank** `/var/lib/neuralagent/relay.db` (Konten und Geräte).

Ob es automatische Datenbank-Sicherungen gibt, steht nicht in den Dokumenten; ich gehe davon aus, dass nicht.

### 3.8 Schutz und Limits
Im Relay gibt es ein IP-basiertes Rate-Limit ("too many requests, try again in a minute"), höchstens 32 gleichzeitige Verbindungen und 20 Geräte pro Konto, und Obergrenzen für Nachrichten- und Dateigrößen. Außerdem: gehashte, rotierende Refresh-Tokens; wird ein altes Token erneut benutzt, wird das Gerät abgemeldet (D26). Eine Bandbreitenbegrenzung pro Nutzer habe ich in den Dokumenten nicht gefunden.

---

## 4. Abweichungen und Entscheidungen

Dies ist der wichtigste Abschnitt. Er vergleicht den Auftrag mit dem, was gebaut ist.

### a) Neu oder anders als geplant

| Prompt sagte | Umgesetzt | Warum (D-Nummer) |
|---|---|---|
| Admin: Passkey als zweiter Faktor | Nur Anmeldung per Google/GitHub mit Adresse aus `ADMIN_EMAILS`; Passkey-Code und Tabelle sind entfernt | Du fandest den Passkey-Schritt lästig; der Anbieter-2FA schützt (D39, vorher D30) |
| Hintergrunddienst für Terminals ("PTY-Host") | Ein Daemon `neuralagentd`, der auch Zustand, Hooks, Remote und Neural hält; die App ist nur ein Client | Agents überleben Beenden/Update, Remote fühlt sich wie die App an (D1) |
| Lokales STT whisper-rs/whisper.cpp (large-v3-turbo) | Parakeet TDT 0.6B v3 (int8) über sherpa-onnx; Whisper nur im Benchmark (zu langsam: 1,9 s) | Benchmark: Deutsch 8,7 % Fehler, schnell (D19) |
| Wake-Word z. B. openWakeWord | sherpa-onnx-Schlüsselworterkennung mit "Hey Neural"; Zusatzfunktion "Learn my voice" | Kein Training nötig; Modell ist englisch, daher Lernen der eigenen Aussprache (D8, D20) |
| TTS-Kandidaten Kokoro, Piper, Chatterbox, F5 | Supertonic 3 (int8, 4 Schritte); Pocket TTS nur Englisch-Alternative; Piper verworfen | Benchmark mit Zahlen; Piper braucht eigenen Phonemizer (D21) |
| Sprache (Diktat, Weckwort) im Hintergrundprozess denkbar | Diktat und Weckwort laufen in der App, nicht im Daemon; Modelle (~630 MB) werden beim ersten Mal geladen | macOS vergibt Mikrofon-/Bedienungshilfen-Rechte pro App-Paket (D22) |
| Anruf-Audio lokal auf dem Desktop | Wie gefordert, im Daemon; das Handy streamt 16-kHz-Audio hin und 24-kHz-Sprache zurück; ein Anruf pro Rechner | D36 |
| Anruf-Ziel unter ~1 s bis zum ersten Wort | Erster Ton 0,8–1,0 s durch eine zwischengespeicherte Bestätigung ("Okay."), die inhaltliche Antwort kommt nach 2,3–3,2 s | Modell-Antwortzeit plus Sprachsynthese (D36, gemessen in STATUS) |
| Modell für Anrufe | Eigenes Anrufmodell (Standard Claude Haiku 5.5) mit abgeschaltetem Denken, kürzerer Verlauf, Sprachhinweis | Ohne Abschalten dauerte der erste Token 2–3 s (D36) |
| Anmeldung am Desktop per Deep-Link `neuralagent://` | Rückkehr über einen lokalen Loopback-Port des Daemons (`127.0.0.1`); `neuralagent://auth` bleibt für Android | Kein eigenes URL-Schema auf Desktop nötig; Daemon bleibt angemeldet, wenn das Fenster zu ist (D27) |
| Konto-Token als JWT (Plan) | Zufällige Zugriffstoken im Speicher (15 Min.) plus rotierende Refresh-Tokens, nur als Hash gespeichert | Sperren/Löschen muss sofort wirken; nichts offline zu prüfen (D26) |
| Zustandsabgleich allgemein | Ereignisprotokoll (Event-Sourcing) mit Ringpuffer von 2048 Ereignissen, Snapshot bei Rückstand | Kein Flackern, günstig bei 16 Panes (D2, D3) |
| Terminal-Wiederherstellung | Unsichtbares Terminal ("vt100") im Daemon, Snapshot plus Byte-Zähler | Ein Roh-Ringpuffer bricht nach Größenänderungen (D3) |
| Lokale Verbindung | WebSocket auf `127.0.0.1` mit 256-Bit-Token, Origin-Prüfung | Läuft überall gleich (D4) |
| Agents in der Umgebung | Login-Shell-Umgebung wird einmal eingelesen, Variablen eines umgebenden Agents entfernt | GUI-Apps haben nur einen minimalen PATH (D5) |
| Status: Hooks, sonst Ausgabe | Claude Code per `--settings`, Codex per `-c notify=…`; Fehler nur, wenn die letzte Antwort ein API-Fehler ist | Claude meldet auch fehlgeschlagene Nebenanfragen als Fehler (D16, D37) |
| Git über was auch immer | Über die `git`-Befehlszeile; Worktrees **innerhalb** des Repos (`.neuralagent/worktrees/`), per `.git/info/exclude` versteckt | Gleiche Konfiguration wie dein Terminal; Worktree bleibt im Workspace und seiner Freigabe (D23) |
| MCP verwalten, kein Shop | Wie gefordert; Geheimnisse nur im Daemon und in der Umgebung des Agents | D24 |
| Nutzung aus Session-Logs | Wie gefordert; Kosten sind Listenpreis-Schätzung; unbekannte Modelle ohne Preis; eigener Statusline-Befehl für Abo-Limits | D25 |
| Freigegebene Ordner | Jeder neue Workspace ist standardmäßig freigegeben, pro Workspace abschaltbar | Deine Entscheidung in der Fragerunde (D7) |
| Orchestrator-Name | "Neural", Weckwort "Hey Neural" | Deine Entscheidung (D8) |
| Logo: 3 Varianten SVG | Konzept C, ein "N" aus Panes, gewählt; alle drei in `docs/brand/`; Symbole mit `tauri icon` erzeugt | Lesbar bei 16 px, bildet das Produkt ab (D11) |
| Relay: ein Dienst, Port 8080 | Rust (axum) und SQLite in einem Container | D26 |
| Pull-Deployment mit Watchtower oder Timer | systemd-Timer alle 5 Min. mit Health-Check und Rollback | Kein eingehender Zugriff, keine Server-Secrets in der CI (D31) |
| E2E-Verschlüsselung | X25519 + AES-256-GCM mit Fingerabdruck im QR-Code; Rust und WebCrypto teilen Testvektoren | D28 |
| Remote-Clients | Werden immer als Handy behandelt (Art vom Relay-Gerätedatensatz, nie vom Client); Not-Aus von überall | D29 |
| Browser-Schlüssel | Nicht auslesbare IndexedDB-Schlüssel, Bytes in localStorage nur als Notlösung | WebKit speichert in manchen Modi nichts in IndexedDB (D32) |
| Handy: Orchestrator im Mittelpunkt, großer Anruf-Button, Agents darunter | Eine App mit zwei Navigationen: Desktop-Seitenleiste, Handy mit Tab-Leiste (Agents, Workspaces) und "More"; Terminals mit Sondertasten-Leiste und eigener Eingabezeile | Eine Codebasis, Layout nach Breite; xterm.js verschluckt auf Android Tastatureingaben (D33, D35) |
| Push-Inhalt "nur das Nötigste" | Nur Art und Sitzungs-ID; kein Push an Geräte, die verbunden und sichtbar sind; Limit 30/Min. pro Konto | D34 |
| APK mit Capacitor, lädt Remote live | Wie gefordert, `www/` nur als Offline-Seite; Release-Signatur mit eigenem Keystore; Versionscode aus der Versionsnummer | D35 |
| Swarm: Nachrichten sichtbar | Über einen eingebauten MCP-Server `neuralagent-swarm` (`send_message`, `team`, `messages`); Zustellung erst, wenn der Empfänger bereit ist; Fertig-Meldungen von Mitgliedern unterdrückt, nur Bericht an dich meldet | Funktioniert für jede Engine mit MCP; Agents bestätigten sich sonst gegenseitig endlos (D37) |
| Themes auf NeuralHub-Tokens | Sechs Farbschemata plus Akzent, pro Gerät | D38 |
| Update-Ablage | Upload mit Bearer-Token, Manifest, drei Versionen behalten, Vorabversionen nur für Tester | D38 |
| Daemon beim Update | Daemon läuft aus versionierter Kopie, wird erst ersetzt, wenn keine Session lebt | Agents laufen beim Update weiter (D38) |
| Mac-App unsigniert, README erklärt Rechtsklick → Öffnen | Nicht notarisiert, aber ab 0.1.2 ad-hoc signiert; `install.sh` installiert ohne Abfrage; Downloadseite erklärt den ersten Start | 0.1.1 wurde als "beschädigt" gemeldet (STATUS, D38) |
| Ein Terminal-Tab-Modell | Bei mehr als 16 Terminals ein neuer Tab | D12 |
| Terminal-Darstellung | WebGL bis 12 sichtbare Terminals, darüber DOM-Modus | WebGL-Kontexte sind pro Seite begrenzt (D13) |
| Test im Browser | `apps/desktop/dev.html` führt dieselbe UI ohne Tauri gegen einen lokalen Daemon aus (nur Entwicklung) | Automatische UI-Tests (D14) |
| iOS-Simulator (Xcode) | Nicht vorhanden; iOS nur als PWA, getestet im Safari-Responsive-Modus | Kein Xcode auf dem Build-Mac (D10) |
| Eigene Ideen (Punkt 21) | Keine eigene Entscheidung dazu in DECISIONS.md; Meilenstein M10 (Ideen, Politur, Abschlussbericht) ist noch offen | STATUS/HANDOFF |

### Nicht umgesetzt oder verschoben (laut Dokumenten)

| Prompt sagte | Stand | Anmerkung |
|---|---|---|
| Browser-Vorschau remote (Dev-Server über den Relay tunneln) | Nicht umgesetzt: auf dem Handy wird eine lokale Adresse nicht geladen | STATUS (M4) nennt ihn als offen; der Plan führt `tunnel.*` auf |
| Antworten auf "wartet auf Eingabe" direkt aus der Push-Meldung (Ja/Nein/Text) | In den Dokumenten nicht als gebaut belegt | Nur "Tap öffnet den Agent" ist belegt |
| Bestätigung außerhalb freigegebener Ordner per Push am Handy | Policy ist umgesetzt (Handy kann außerhalb nichts); die Rückfrage-Warteschlange ist laut D7 erst mit M5 vorgesehen | Nicht von Hand geprüft |
| Headset-Taste steuert Sprechen/Auflegen | Nicht belegt; der Dienst bietet "Hang up" in der Benachrichtigung | Nicht von Hand getestet |
| Voice-to-Text am Handy (zwei Wege einstellbar) | In den Dokumenten nicht ausdrücklich belegt | Der Anruf mit Neural ist belegt |
| Pinch-Zoom der Terminal-Schrift, Pull-to-Refresh, Swipe zwischen Agents | In den Dokumenten nicht belegt (Chips zum Wechseln der Panes sind belegt) | Nicht behaupten |
| Wortfehlerraten-Benchmark mit Moonshine u. a. | Parakeet, Nemotron und Whisper gemessen; Moonshine nicht gemessen | D9, D19 |
| `docs/SPEC.md` mit ehrlicher E2E-Grenze | Existiert nicht; die Grenze steht in DECISIONS (D28) und in diesem Handbuch | Nachholen, falls gewünscht |
| LAN-Direktverbindung ohne Relay | In den Dokumenten nicht erwähnt | Nicht umgesetzt |
| Installations-/README-Pflege, Abschlussbericht | M10 offen | HANDOFF |
| Datenschutz, Impressum, Nutzungsbedingungen | Entwürfe unter `/privacy`, `/imprint`, `/terms` (Quelle `apps/web/src/legal.tsx`); deine Angaben fehlen noch und eine rechtliche Prüfung | Checkliste |
| Windows und Linux | Von der CI gebaut, **nicht von Hand getestet** | Wie im Auftrag verlangt |
| iPhone | Nur Responsive-Modus; Push, Installation und Anruf auf echtem Gerät nicht getestet | D10 |
| Code-Signierung | macOS nicht notarisiert, Windows nicht signiert (braucht Apple Developer ID bzw. Zertifikat) | D38, deine Entscheidung |
| Echter Codex-Durchlauf | Nur mit nachgestelltem Aufruf getestet; braucht `codex login` | D17 |
| Discord live | Nicht mit geöffnetem Discord gesehen | Checkliste |
| Eigene Stimme für Diktat/Weckwort | Nicht getestet (nur Testaudio) | Checkliste |
| Test-Budget Orchestrator ($100, Stopp bei $80) | Verbrauch lt. STATUS unter ca. $3,5 (Schätzung) | STATUS |

### b) Im Prompt nicht genau definiert

| Prompt ließ offen | Umgesetzt | Warum (D-Nummer) |
|---|---|---|
| Wie genau Agents installiert werden ("passender Befehl pro OS") | Herstellerbefehle pro OS, sichtbar im Pane; Katalog mit 13 CLIs, danach Neu-Erkennung | Installer stellen Rückfragen, du sollst sie sehen (D15) |
| "Zuverlässig erkennen, wo möglich über Hooks" | Pro CLI ein eigener Weg (Claude Code `--settings`, Codex `notify`, sonst Ausgabe-Heuristik: 1,2 s Ausgabe = arbeitet, 2,5 s Ruhe nach Prompt = fertig) | D6, D16 |
| Wie "Freigabe von Ordnern" aussieht | Schalter pro Workspace, neue sind standardmäßig freigegeben; Handy/Neural nur dort | Deine Entscheidung (D7) |
| Wo Sprache läuft (App oder Dienst) | Diktat/Weckwort in der App, Anruf-Sprache im Daemon | Rechte pro App-Bündel / Anrufe brauchen Daemon (D22, D36) |
| Standard-Hotkey | ⌥/Alt+Leertaste, alternativ ⌘⇧Leertaste oder F5 | D22 |
| Verhalten, wenn Weckwort-Modell Deutsch nicht versteht | "Learn my voice": Wake-Wort-Aufnahme wird als zusätzliches Schlüsselwort gelernt (nicht kürzer als 3 Teile, gegen Fehlauslöser) | D20 |
| Wie Turn-Taking funktioniert | Silero-VAD, Satzende nach 0,5 s Stille, Unterbrechen bei 300 ms Sprechen | D20, D36 |
| Wie Neural Pausen überbrückt | Zwischengespeicherte Bestätigungen DE/EN nach 80 ms ohne Ausgabe | D36 |
| Kosten: wie berechnet | API-Listenpreise, Cache-Writes 1,25×/2× Eingabepreis; Abo-Nutzer zahlen ihren Tarif | D25 |
| Was "Sperren wirkt sofort" bedeutet | Relay verwirft Tokens und WebSockets des Nutzers sofort | D26 |
| Was "Geräte" und Zugangsdaten sind | Pro Gerät ein X25519-Schlüssel und ein Refresh-Token; Zugangsdaten im Schlüsselbund | D27, D28 |
| "Add phone"-QR | Einmalig, 2 Minuten, nur gleiches Konto, trägt den Fingerabdruck des Rechners | D28 |
| Admin-Konto | Adressen in `ADMIN_EMAILS`, automatisch freigegeben | D39 |
| Mehrdeutige Ordner | In den Dokumenten nicht ausdrücklich belegt (Ordner-Finden ist per Test belegt: "Japan Map") | STATUS M7 |
| Wie der Swarm entscheidet, wer wann spricht | Nur der Coordinator startet, alle bekommen Briefings ohne Bestätigungen; Warteschlange pro Empfänger, Zustellung erst bei "bereit" | D37 |
| Update-Ablauf bei laufenden Agents | Versionierte Daemon-Kopie, Tausch erst ohne laufende Session | D38 |
| Versionsnummer | Eine Version im Cargo-Workspace für alles; APK-Versionscode aus Major/Minor/Patch | D38 |
| Was auf Android nativ passiert und was auf der Seite | FCM, Widget, Kachel, Custom-Tab-Login nativ; alles andere Webseite | D35 |
| Umgang mit iOS-Push | Nur für installierte PWA (iOS 16.4+), die Einstellungsseite sagt das | D34 |

---

## 5. Offene Punkte und Checkliste für dich

Direkt aus `docs/STATUS.md` (Stand 2026-10-30). Schon erledigt auf deiner Seite: Domain, Proxy-Host, Zertifikat und alle vorbereiteten Zugangsdaten.

- [ ] **Lese-Token für das Pull-Deployment auf dem Server anlegen.** Ein klassisches GitHub-Token nur mit `read:packages` erzeugen und auf dem Server in die Datei `/etc/neuralagent/ghcr.env` legen (Befehl in STATUS; das Token nie in den Chat). Danach deployt jeder Push, der den Relay berührt, in ca. 5 Minuten selbst, mit Rollback.
- [ ] **Remote mit echtem Konto probieren** (5 Min): App → Remote → "Continue with GitHub/Google", dann `/admin/` öffnen.
- [ ] **Handys testen** (10 Min): Android-APK installieren, anmelden, Benachrichtigungen einschalten, Agent fertig werden lassen, Meldung antippen. iPhone: `/app` in Safari öffnen, zum Home-Bildschirm hinzufügen, gleicher Test.
- [ ] **Mail-Check:** Zweites Konto stellt eine Anfrage; "Access request" kommt an, nach Approve "You're in" (Spam prüfen).
- [ ] **Tray "Disconnect remote"** einmal in der echten Menüleiste klicken.
- [ ] **Backups** (nicht ins Repo): Android-Keystore samt Passwörtern, Updater-Signierschlüssel samt Passwort, `relay.env` und `relay.db` vom Server.
- [ ] **Sprache mit eigener Stimme** (5 Min): Einstellungen → Voice models laden, ⌥ Leertaste halten, sprechen; Weckwort einschalten; bei Problemen "Learn my voice" 3×. Eine offene macOS-Abfrage "Terminal wants to control TextEdit" darf mit "Don't Allow" beantwortet werden.
- [ ] **Neural anrufen** (5 Min): Einstellungen → Neural prüfen, dann Neural → Telefon-Symbol. Auf Android "Call Neural" oder die Kachel (auch vom Sperrbildschirm). Rückmeldung zu Tempo, Natürlichkeit und Echo.
- [ ] **Rechtstexte:** Name, Adresse, Kontakt in `/imprint`, `/privacy`, `/terms` eintragen und prüfen lassen, bevor du Leute einlädst.
- [ ] **Logo hochladen:** Discord-Entwicklerportal (App-Symbol; dazu Rich Presence → Art Assets, Name `logo`), GitHub-OAuth-App, Firebase. **Nicht** bei Google (löst eine Prüfung aus). Dateien in `docs/brand/export/`.
- [ ] **Discord-Präsenz prüfen** (1 Min): Discord öffnen, einen Agent starten, Profil prüfen.
- [ ] **Veröffentlichte App installieren** (5 Min): macOS mit dem `curl`-Befehl aus 2.27; Android-APK von der Download-Seite über die CI-Version installieren (gleicher Schlüssel).
- [ ] **Optional: signierte Builds.** Apple Developer ID (99 $/Jahr) für Notarisierung, Windows-Zertifikat gegen SmartScreen. Die CI braucht dann nur die Secrets.
- [ ] **Optional: Swarm ausprobieren** (5 Min). Verbraucht Claude-Kontingent, ein Haiku-Profil hält es günstig.

**Bekannte Lücken (STATUS):** kein iOS-Simulator; Windows und Linux nur CI-gebaut; Anzeige "Last seen" bei nie verbundenem Gerät zeigt das Erstelldatum; das Dashboard sagt "No agents running", solange nur eine Shell läuft (HANDOFF).
