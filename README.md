# Custom 3D Printer Card

Eine Home Assistant Custom Card für 3D-Drucker mit Mushroom Design.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Home Assistant](https://img.shields.io/badge/home%20assistant-2023.4.0%2B-blue)

## Features

- **GUI-Konfiguration**: Vollständig konfigurierbar über die Home Assistant UI
- **Mushroom Design**: Modernes, ansprechendes Design mit dynamischen Statusanzeigen
- **Status-basierte Anzeige**: Verschiedene Ansichten je nach Druckerstatus

## Status-Ansichten

### Unavailable (Ausgeschaltet)
- Minimale Ansicht mit Icon, Name und Power-Button zum Einschalten

### Idle (Bereit)
- Kamera (volle Breite)
- Druckbett-Temperatur
- Nozzle-Temperatur
- Power-Button zum Ausschalten

### Printing (Druckt)
- Kamera (volle Breite)
- Druckmodell-Vorschau (linke Hälfte)
- Druckstatus-Sensoren (rechte Hälfte):
  - Druckfortschritt mit Fortschrittsbalken
  - Bisherige Laufzeit
  - Restlaufzeit
  - Aktueller Layer
  - Druckbett-Temperatur
  - Nozzle-Temperatur
  - Lüftergeschwindigkeit
- Pause-Button zum Pausieren des Drucks

## Installation

### HACS (Home Assistant Community Store)

1. Öffne HACS in Home Assistant
2. Gehe zu "Frontend" → "Benutzerdefinierte Repositories"
3. Füge die URL dieses Repositories hinzu
4. Wähle "Lovelace" als Kategorie
5. Installiere die Card
6. Lade die Ressourcen neu oder starte Home Assistant neu

### Manuelle Installation

1. Lade die Dateien aus dem `dist`-Ordner herunter
2. Kopiere sie in das Verzeichnis `config/www/community/custom-printer-card/`
3. Füge folgende Ressourcen in deine Lovelace-Dashboard-Konfiguration ein:

```yaml
resources:
  - type: module
    url: /hacsfiles/custom-printer-card/printer-card-v2.js
```

## Konfiguration

### GUI-Konfiguration (Empfohlen)

1. Füge eine neue Card zu deinem Dashboard hinzu
2. Suche nach "3D Printer Card"
3. Wähle deine Drucker-Entitäten aus
4. Passe die Anzeige-Einstellungen nach Bedarf an

### YAML-Konfiguration

```yaml
type: custom:printer-card-v2
name: Mein 3D Drucker
printer_status_entity: sensor.printer_status
camera_entity: camera.printer_camera
power_switch_entity: switch.printer_power
bed_temp_entity: sensor.bed_temperature
nozzle_temp_entity: sensor.nozzle_temperature
print_progress_entity: sensor.print_progress
print_time_entity: sensor.print_time_elapsed
print_time_left_entity: sensor.print_time_remaining
current_layer_entity: sensor.current_layer
total_layers_entity: sensor.total_layers
thumbnail_entity: sensor.print_thumbnail
job_name_entity: sensor.job_name
printer_image: "A1Mini.jpg"
show_printer_image_when_off: true
```

### Konfigurationsoptionen

| Option | Typ | Beschreibung | Standard |
|--------|-----|--------------|----------|
| `name` | string | Anzeigename des Druckers | "3D Drucker" |
| `printer_status_entity` | string | Status-Sensor des Druckers | - |
| `camera_entity` | string | Kamera-Entität | - |
| `power_switch_entity` | string | Power-Schalter Entität | - |
| `bed_temp_entity` | string | Druckbett-Temperatur Sensor | - |
| `nozzle_temp_entity` | string | Nozzle-Temperatur Sensor | - |
| `print_progress_entity` | string | Druckfortschritt Sensor (%) | - |
| `print_time_entity` | string | Bisherige Druckzeit Sensor | - |
| `print_time_left_entity` | string | Restlaufzeit Sensor | - |
| `current_layer_entity` | string | Aktueller Layer Sensor | - |
| `total_layers_entity` | string | Gesamtlayers Sensor | - |
| `thumbnail_entity` | string | Modell-Vorschaubild Sensor | - |
| `job_name_entity` | string | Dateiname / Job-Name Sensor | - |
| `printer_image` | string | Drucker-Bild (Dropdown oder Custom Upload) | "" |
| `show_printer_image_when_off` | boolean | Zeige Drucker-Bild wenn ausgeschaltet | false |

## Voraussetzungen

- Home Assistant 2023.4.0 oder höher
- Drucker-Integration in Home Assistant eingerichtet (z.B. PrusaLink, OctoPrint, Bambu Lab, etc.)
- Optional: Eine Kamera, die den Drucker überwacht
- Optional: Ein Schalter zur Steuerung der Spannungsversorgung


## Mitwirken

Beiträge sind willkommen! Bitte erstelle einen Pull Request oder öffne ein Issue.

## Lizenz

MIT License

## Danksagung

- [Home Assistant](https://www.home-assistant.io/)
- [Mushroom Cards](https://github.com/piitaya/lovelace-mushroom) für das Design-Inspiration

## Support

Bei Problemen oder Fragen erstelle bitte ein Issue im GitHub Repository.
