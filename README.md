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
2. Kopiere sie in das Verzeichnis `config/www/community/custom-prusa-card/`
3. Füge folgende Ressourcen in deine Lovelace-Dashboard-Konfiguration ein:

```yaml
resources:
  - type: module
    url: /hacsfiles/custom-prusa-card/printer-card-v2.js
```

## Konfiguration

### GUI-Konfiguration (Empfohlen)

1. Füge eine neue Card zu deinem Dashboard hinzu
2. Suche nach "Prusa 3D Printer Card"
3. Wähle dein PrusaLink-Device aus
4. Die Card erkennt automatisch alle verfügbaren Entitäten
5. Passe die Anzeige-Einstellungen nach Bedarf an

### YAML-Konfiguration

```yaml
type: custom:prusa-card
name: Mein 3D Drucker
icon: mdi:printer-3d
device: <device_id>
# Oder manuelle Entitätszuweisung:
camera: camera.prusa_mk4
power_switch: switch.prusa_power
bed_temp_sensor: sensor.prusa_bed_temperature
nozzle_temp_sensor: sensor.prusa_tool0_temperature
progress_sensor: sensor.prusa_progress
show_preview: true
```

### Konfigurationsoptionen

| Option | Typ | Beschreibung | Standard |
|--------|-----|--------------|----------|
| `name` | string | Anzeigename des Druckers | "Prusa Printer" |
| `icon` | string | Icon für den Drucker | `mdi:printer-3d` |
| `device` | string | PrusaLink Device ID | - |
| `camera` | string | Kamera-Entität | Automatisch |
| `power_switch` | string | Power-Schalter Entität | Automatisch |
| `bed_temp_sensor` | string | Druckbett-Temperatur Sensor | Automatisch |
| `nozzle_temp_sensor` | string | Nozzle-Temperatur Sensor | Automatisch |
| `progress_sensor` | string | Fortschritt Sensor | Automatisch |
| `time_elapsed_sensor` | string | Laufzeit Sensor | Automatisch |
| `time_remaining_sensor` | string | Restlaufzeit Sensor | Automatisch |
| `current_layer_sensor` | string | Aktueller Layer Sensor | Automatisch |
| `total_layers_sensor` | string | Gesamtlayers Sensor | Automatisch |
| `fan_speed_sensor` | string | Lüftergeschwindigkeit Sensor | Automatisch |
| `show_preview` | boolean | Druckvorschau anzeigen | true |

## Voraussetzungen

- Home Assistant 2023.4.0 oder höher
- PrusaLink Integration in Home Assistant eingerichtet
- Optional: Eine Kamera, die den Drucker überwacht
- Optional: Ein Schalter zur Steuerung der Spannungsversorgung

## Automatische Entitätserkennung

Die Card erkennt automatisch folgende PrusaLink-Entitäten basierend auf ihren Namen:

| Entitätstyp | Erkannte Muster |
|-------------|-----------------|
| Kamera | `camera.*`, `*camera*` |
| Power-Schalter | `switch.*power*`, `switch.*relay*` |
| Druckbett-Temp | `sensor.*bed*temp*`, `sensor.*heater_bed*` |
| Nozzle-Temp | `sensor.*tool*temp*`, `sensor.*nozzle*temp*`, `sensor.*hotend*temp*` |
| Fortschritt | `sensor.*progress*`, `sensor.*%*` |
| Restlaufzeit | `sensor.*time*remaining*`, `sensor.*time_left*` |
| Laufzeit | `sensor.*time*elapsed*`, `sensor.*time_printing*` |
| Aktueller Layer | `sensor.*layer*` (ohne total/count) |
| Gesamtlayers | `sensor.*layer*total*`, `sensor.*layers*` |
| Lüfter | `sensor.*fan*` |


## Mitwirken

Beiträge sind willkommen! Bitte erstelle einen Pull Request oder öffne ein Issue.

## Lizenz

MIT License

## Danksagung

- [Home Assistant](https://www.home-assistant.io/)
- [Mushroom Cards](https://github.com/piitaya/lovelace-mushroom) für das Design-Inspiration

## Support

Bei Problemen oder Fragen erstelle bitte ein Issue im GitHub Repository.
