import {
  LitElement,
  html,
  css,
} from "https://unpkg.com/lit-element@3.3.3/lit-element.js?module";

class PrusaCardEditor extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      config: { type: Object },
    };
  }

  static get styles() {
    return css`
      :host {
        display: block;
        padding: 16px;
      }

      .form {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .field {
        margin-bottom: 16px;
      }

      .field:last-child {
        margin-bottom: 0;
      }

      .field-label {
        font-size: 14px;
        font-weight: 500;
        color: var(--primary-text-color);
        margin-bottom: 8px;
        display: block;
      }

      .field-help {
        font-size: 12px;
        color: var(--secondary-text-color);
        margin-top: 4px;
      }

      .section {
        background: var(--card-background-color, var(--ha-card-background));
        border-radius: 12px;
        padding: 16px;
        margin-bottom: 16px;
      }

      .section-title {
        font-size: 16px;
        font-weight: 500;
        color: var(--primary-text-color);
        margin-bottom: 16px;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .detected-info {
        font-size: 12px;
        color: var(--primary-text-color);
        padding: 12px;
        background: rgba(var(--rgb-primary-color), 0.1);
        border-radius: 8px;
        margin-top: 12px;
        border-left: 4px solid var(--primary-color);
      }

      .detected-entities {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 8px;
      }

      .detected-entity {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
      }

      .detected-entity ha-icon {
        color: var(--success-color);
        --mdc-icon-size: 16px;
      }

      .auto-detect-btn {
        padding: 10px 20px;
        border-radius: 8px;
        border: none;
        background: var(--primary-color);
        color: white;
        cursor: pointer;
        font-size: 14px;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-top: 16px;
        transition: opacity 0.2s;
      }

      .auto-detect-btn:hover {
        opacity: 0.9;
      }

      .note {
        font-size: 13px;
        color: var(--secondary-text-color);
        font-style: italic;
        margin-top: 8px;
        padding: 8px;
        background: rgba(var(--rgb-warning-color), 0.1);
        border-radius: 6px;
      }

      .error {
        color: var(--error-color);
        font-size: 13px;
        margin-top: 8px;
      }
    `;
  }

  setConfig(config) {
    this._config = { ...config };
  }

  get value() {
    return this._config;
  }

  _computeLabel(schema) {
    return schema.label || schema.name;
  }

  _valueChanged(ev) {
    if (!this._config || !this.hass) {
      return;
    }

    const target = ev.target;
    const configValue = target.getAttribute("name") || target.configValue;
    
    if (!configValue) return;

    let value;
    if (target.tagName === "HA-SWITCH" || target.type === "checkbox") {
      value = target.checked;
    } else {
      value = target.value;
    }

    if (this._config[configValue] === value) {
      return;
    }

    const newConfig = { ...this._config };
    if (value === "" || value === null || value === undefined) {
      delete newConfig[configValue];
    } else {
      newConfig[configValue] = value;
    }
    
    this._config = newConfig;

    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      })
    );
  }

  _deviceChanged(ev) {
    const deviceId = ev.detail?.value;
    if (!deviceId) return;

    const newConfig = { ...this._config, device: deviceId };
    this._config = newConfig;

    this._autoDetectFromDevice(deviceId);

    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      })
    );

    this.requestUpdate();
  }

  _entityChanged(ev) {
    const entityId = ev.detail?.value;
    if (!entityId) return;

    // If this is a PrusaLink entity, try to auto-detect other entities
    if (entityId.includes("prusalink") || entityId.includes("prusa")) {
      this._autoDetectFromEntity(entityId);
    }
  }

  _autoDetectFromDevice(deviceId) {
    if (!this.hass || !deviceId) return;

    const device = this.hass.devices?.[deviceId];
    if (!device) return;

    // Find entities by device_id
    const entities = Object.entries(this.hass.states)
      .filter(([_, state]) => state.attributes?.device_id === deviceId)
      .map(([entityId, _]) => entityId);

    this._applyDetectedEntities(entities);
  }

  _autoDetectFromEntity(sourceEntityId) {
    if (!this.hass || !sourceEntityId) return;

    const state = this.hass.states[sourceEntityId];
    if (!state) return;

    // Get device_id from entity
    const deviceId = state.attributes?.device_id;
    if (deviceId) {
      this._autoDetectFromDevice(deviceId);
      return;
    }

    // Fallback: Try to find related entities by naming convention
    const entityPrefix = sourceEntityId.split(".").pop().split("_")[0];
    
    const relatedEntities = Object.keys(this.hass.states).filter(id => {
      const name = id.toLowerCase();
      return name.includes("prusa") || name.includes("prusalink") || name.includes(entityPrefix);
    });

    this._applyDetectedEntities(relatedEntities);
  }

  _applyDetectedEntities(entityIds) {
    if (!entityIds || entityIds.length === 0) return;

    const detected = {};

    entityIds.forEach((entityId) => {
      const lowerId = entityId.toLowerCase();
      const state = this.hass.states[entityId];
      if (!state) return;

      const domain = entityId.split(".")[0];

      // Camera
      if (domain === "camera") {
        detected.camera = entityId;
      }
      
      // Power switch
      if (domain === "switch" && (lowerId.includes("power") || lowerId.includes("relay"))) {
        detected.power_switch = entityId;
      }

      // Sensors
      if (domain === "sensor") {
        // Bed temperature
        if (lowerId.includes("bed") && (lowerId.includes("temp") || lowerId.includes("heater"))) {
          detected.bed_temp_sensor = entityId;
        }
        
        // Nozzle/tool temperature
        if ((lowerId.includes("tool") || lowerId.includes("nozzle") || lowerId.includes("hotend")) && 
            (lowerId.includes("temp") || lowerId.includes("heat"))) {
          detected.nozzle_temp_sensor = entityId;
        }

        // Progress
        if (lowerId.includes("progress") || state.attributes?.unit_of_measurement === "%") {
          detected.progress_sensor = entityId;
        }

        // Time remaining
        if (lowerId.includes("remaining") || lowerId.includes("time_left")) {
          detected.time_remaining_sensor = entityId;
        }

        // Time elapsed
        if (lowerId.includes("elapsed") || lowerId.includes("printing") || lowerId.includes("print_time")) {
          detected.time_elapsed_sensor = entityId;
        }

        // Current layer
        if (lowerId.includes("layer") && !lowerId.includes("total") && 
            (lowerId.includes("current") || (!lowerId.includes("count") && !lowerId.includes("height")))) {
          detected.current_layer_sensor = entityId;
        }

        // Total layers
        if (lowerId.includes("layer") && (lowerId.includes("total") || lowerId.includes("count"))) {
          detected.total_layers_sensor = entityId;
        }

        // Fan speed
        if (lowerId.includes("fan") && (lowerId.includes("speed") || lowerId.includes("percent"))) {
          detected.fan_speed_sensor = entityId;
        }
        
        // Job state / Status (for determining printer state)
        if (lowerId.includes("job") || lowerId.includes("state") || lowerId.includes("status")) {
          detected.job_sensor = entityId;
        }
      }
    });

    // Update config with detected entities
    const newConfig = { ...this._config };
    Object.entries(detected).forEach(([key, value]) => {
      if (value && !newConfig[key]) {
        newConfig[key] = value;
      }
    });

    this._config = newConfig;
    this._detectedEntities = Object.entries(detected).filter(([_, v]) => v);

    // Notify about config change
    this.dispatchEvent(
      new CustomEvent("config-changed", {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      })
    );
  }

  _formatEntityType(type) {
    const labels = {
      bed_temp_sensor: "Druckbett-Temperatur",
      nozzle_temp_sensor: "Nozzle-Temperatur",
      progress_sensor: "Fortschritt",
      time_elapsed_sensor: "Laufzeit",
      time_remaining_sensor: "Restlaufzeit",
      current_layer_sensor: "Aktueller Layer",
      total_layers_sensor: "Gesamtlayers",
      fan_speed_sensor: "Lüfter",
      camera: "Kamera",
      power_switch: "Power-Schalter",
      job_sensor: "Job-Status",
    };
    return labels[type] || type;
  }

  render() {
    if (!this.hass || !this._config) {
      return html``;
    }

    return html`
      <div class="form">
        <!-- Basic Settings -->
        <div class="section">
          <div class="section-title">
            <ha-icon icon="mdi:printer-3d"></ha-icon>
            <span>Grundeinstellungen</span>
          </div>

          <div class="field">
            <label class="field-label">Name</label>
            <ha-textfield
              name="name"
              .value=${this._config.name || ""}
              placeholder="Mein Prusa Drucker"
              @change=${this._valueChanged}
            ></ha-textfield>
            <div class="field-help">Anzeigename des Druckers</div>
          </div>

          <div class="field">
            <label class="field-label">Icon</label>
            <ha-icon-picker
              name="icon"
              .value=${this._config.icon || "mdi:printer-3d"}
              @value-changed=${this._valueChanged}
            ></ha-icon-picker>
          </div>
        </div>

        <!-- Device Selection (if ha-device-picker works) -->
        <div class="section">
          <div class="section-title">
            <ha-icon icon="mdi:devices"></ha-icon>
            <span>Geräteauswahl (optional)</span>
          </div>

          <div class="field">
            <label class="field-label">PrusaLink Device</label>
            ${this.hass.devices ? html`
              <ha-device-picker
                .hass=${this.hass}
                .value=${this._config.device || ""}
                @value-changed=${this._deviceChanged}
              ></ha-device-picker>
            ` : html`
              <div class="note">Device-Picker nicht verfügbar. Bitte Entitäten manuell auswählen.</div>
            `}
            <div class="field-help">
              Wähle dein PrusaLink Device für automatische Entitätserkennung
            </div>
          </div>

          <div class="field">
            <label class="field-label">Oder: Prusa Status Entity</label>
            <ha-entity-picker
              .hass=${this.hass}
              .value=${this._config.job_sensor || ""}
              .includeDomains=${["sensor", "binary_sensor"]}
              name="job_sensor"
              @value-changed=${(ev) => {
                this._valueChanged(ev);
                this._entityChanged(ev);
              }}
            ></ha-entity-picker>
            <div class="field-help">
              Alternativ: Wähle irgendeine PrusaLink Entity (z.B. sensor.prusa_mk4_job)
            </div>
          </div>

          ${this._detectedEntities && this._detectedEntities.length > 0 ? html`
            <div class="detected-info">
              <strong><ha-icon icon="mdi:check-circle"></ha-icon> Automatisch erkannte Entitäten:</strong>
              <div class="detected-entities">
                ${this._detectedEntities.map(([type, entityId]) => html`
                  <div class="detected-entity">
                    <ha-icon icon="mdi:check"></ha-icon>
                    <span><strong>${this._formatEntityType(type)}:</strong> ${entityId}</span>
                  </div>
                `)}
              </div>
            </div>
          ` : ""}
        </div>

        <!-- Camera -->
        <div class="section">
          <div class="section-title">
            <ha-icon icon="mdi:camera"></ha-icon>
            <span>Kamera</span>
          </div>
          <div class="field">
            <label class="field-label">Kamera-Entität</label>
            <ha-entity-picker
              .hass=${this.hass}
              .value=${this._config.camera || ""}
              .includeDomains=${["camera"]}
              name="camera"
              @value-changed=${this._valueChanged}
            ></ha-entity-picker>
          </div>
        </div>

        <!-- Power Switch -->
        <div class="section">
          <div class="section-title">
            <ha-icon icon="mdi:power"></ha-icon>
            <span>Spannungsversorgung</span>
          </div>
          <div class="field">
            <label class="field-label">Power-Schalter Entität</label>
            <ha-entity-picker
              .hass=${this.hass}
              .value=${this._config.power_switch || ""}
              .includeDomains=${["switch", "input_boolean"]}
              name="power_switch"
              @value-changed=${this._valueChanged}
            ></ha-entity-picker>
            <div class="field-help">Schalter zum Ein-/Ausschalten der Drucker-Spannungsversorgung</div>
          </div>
        </div>

        <!-- Temperature Sensors -->
        <div class="section">
          <div class="section-title">
            <ha-icon icon="mdi:thermometer"></ha-icon>
            <span>Temperatur-Sensoren</span>
          </div>
          
          <div class="field">
            <label class="field-label">Druckbett-Temperatur</label>
            <ha-entity-picker
              .hass=${this.hass}
              .value=${this._config.bed_temp_sensor || ""}
              .includeDomains=${["sensor"]}
              name="bed_temp_sensor"
              @value-changed=${this._valueChanged}
            ></ha-entity-picker>
          </div>

          <div class="field">
            <label class="field-label">Nozzle-Temperatur</label>
            <ha-entity-picker
              .hass=${this.hass}
              .value=${this._config.nozzle_temp_sensor || ""}
              .includeDomains=${["sensor"]}
              name="nozzle_temp_sensor"
              @value-changed=${this._valueChanged}
            ></ha-entity-picker>
          </div>
        </div>

        <!-- Print Status Sensors -->
        <div class="section">
          <div class="section-title">
            <ha-icon icon="mdi:printer-3d"></ha-icon>
            <span>Druck-Status Sensoren</span>
          </div>
          
          <div class="field">
            <label class="field-label">Fortschritt (%)</label>
            <ha-entity-picker
              .hass=${this.hass}
              .value=${this._config.progress_sensor || ""}
              .includeDomains=${["sensor"]}
              name="progress_sensor"
              @value-changed=${this._valueChanged}
            ></ha-entity-picker>
          </div>

          <div class="field">
            <label class="field-label">Laufzeit</label>
            <ha-entity-picker
              .hass=${this.hass}
              .value=${this._config.time_elapsed_sensor || ""}
              .includeDomains=${["sensor"]}
              name="time_elapsed_sensor"
              @value-changed=${this._valueChanged}
            ></ha-entity-picker>
          </div>

          <div class="field">
            <label class="field-label">Restlaufzeit</label>
            <ha-entity-picker
              .hass=${this.hass}
              .value=${this._config.time_remaining_sensor || ""}
              .includeDomains=${["sensor"]}
              name="time_remaining_sensor"
              @value-changed=${this._valueChanged}
            ></ha-entity-picker>
          </div>

          <div class="field">
            <label class="field-label">Aktueller Layer</label>
            <ha-entity-picker
              .hass=${this.hass}
              .value=${this._config.current_layer_sensor || ""}
              .includeDomains=${["sensor"]}
              name="current_layer_sensor"
              @value-changed=${this._valueChanged}
            ></ha-entity-picker>
          </div>

          <div class="field">
            <label class="field-label">Gesamtlayers</label>
            <ha-entity-picker
              .hass=${this.hass}
              .value=${this._config.total_layers_sensor || ""}
              .includeDomains=${["sensor"]}
              name="total_layers_sensor"
              @value-changed=${this._valueChanged}
            ></ha-entity-picker>
          </div>

          <div class="field">
            <label class="field-label">Lüftergeschwindigkeit</label>
            <ha-entity-picker
              .hass=${this.hass}
              .value=${this._config.fan_speed_sensor || ""}
              .includeDomains=${["sensor"]}
              name="fan_speed_sensor"
              @value-changed=${this._valueChanged}
            ></ha-entity-picker>
          </div>
        </div>

        <!-- Display Settings -->
        <div class="section">
          <div class="section-title">
            <ha-icon icon="mdi:cog"></ha-icon>
            <span>Anzeige-Einstellungen</span>
          </div>
          
          <div class="field">
            <ha-formfield label="Druckvorschau anzeigen">
              <ha-switch
                name="show_preview"
                .checked=${this._config.show_preview !== false}
                @change=${this._valueChanged}
              ></ha-switch>
            </ha-formfield>
            <div class="field-help">Zeigt einen Platzhalter für das Druckmodell an</div>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define("prusa-card-editor", PrusaCardEditor);

console.info("%c PRUSA-CARD-EDITOR %c v1.0.1 ", "background: #41bdf5; color: white; font-weight: 700;", "background: #00d2d5; color: white; font-weight: 700;");
