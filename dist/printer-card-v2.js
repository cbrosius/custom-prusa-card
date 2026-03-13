/**
 * 3D Printer Card — Home Assistant Custom Card
 * Uses native HA components for all sensors and controls:
 *   - hui-tile-card      → sensor chips (renders value, unit, icon natively)
 *   - ha-icon-button     → all action buttons
 *   - ha-state-label     → status text
 *   - ha-circular-progress → print progress
 */

// ─────────────────────────────────────────────────────────────
//  Visual Editor
// ─────────────────────────────────────────────────────────────
class PrinterCardV2Editor extends HTMLElement {
  constructor() { super(); this._config = {}; this._hass = null; }
  set hass(hass) { this._hass = hass; this._render(); }
  setConfig(config) { this._config = { ...config }; this._render(); }

  _schema() {
    return [
      { name: "name", label: "Drucker Name", selector: { text: {} } },
      { name: "printer_status_entity", label: "Drucker-Status Sensor", selector: { entity: {} } },
      { name: "camera_entity", label: "Kamera", selector: { entity: { domain: "camera" } } },
      { name: "power_switch_entity", label: "Spannungsversorgungs-Schalter", selector: { entity: { domain: ["switch", "input_boolean"] } } },
      { name: "bed_temp_entity", label: "Druckbett-Temperatur Sensor", selector: { entity: { domain: "sensor" } } },
      { name: "nozzle_temp_entity", label: "Nozzle-Temperatur Sensor", selector: { entity: { domain: "sensor" } } },
      { name: "print_progress_entity", label: "Druckfortschritt (%) Sensor", selector: { entity: { domain: "sensor" } } },
      { name: "print_time_entity", label: "Bisherige Druckzeit Sensor", selector: { entity: { domain: "sensor" } } },
      { name: "print_time_left_entity", label: "Restlaufzeit Sensor", selector: { entity: { domain: "sensor" } } },
      { name: "current_layer_entity", label: "Aktueller Layer Sensor", selector: { entity: { domain: "sensor" } } },
      { name: "total_layers_entity", label: "Gesamt-Layer Sensor", selector: { entity: { domain: "sensor" } } },
      { name: "eta_entity", label: "Fertigstellung (ETA) Sensor", selector: { entity: { domain: "sensor" } } },
      { name: "thumbnail_entity", label: "Modell-Vorschaubild (Sensor/Entity)", selector: { entity: {} } },
      { name: "job_name_entity", label: "Dateiname / Job-Name Sensor", selector: { entity: { domain: "sensor" } } },

      { name: "pause_button_entity", label: "Pause-Entität", selector: { entity: { domain: ["button", "script", "input_button"] } } },
      {
        name: "printer_image",
        label: "Drucker-Bild",
        selector: {
          select: {
            options: [
              { label: "Kein Bild", value: "" },
              { label: "Prusa Core XY", value: "PrusaCoreOne.jpg" },
              { label: "Prusa Mini", value: "PrusaMini.jpg" },
              { label: "A1 Mini", value: "A1Mini.jpg" },
              { label: "Custom1", value: "Custom1.jpg" },
              { label: "Custom2", value: "Custom2.jpg" },
              { label: "Custom3", value: "Custom3.jpg" },
            ]
          }
        }
      },
      {
        name: "show_printer_image_when_off",
        label: "Zeige Drucker-Bild, wenn der Drucker aus ist",
        selector: { boolean: {} }
      },
    ];
  }

  _render() {
    if (!this._hass || !customElements.get("ha-form")) return;
    if (!this._formEl) {
      this._formEl = document.createElement("ha-form");
      this._formEl.addEventListener("value-changed", (e) => {
        this._config = e.detail.value;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config } }));
      });
      this.appendChild(this._formEl);
    }
    this._formEl.hass = this._hass;
    this._formEl.data = this._config;
    this._formEl.schema = this._schema();
    this._formEl.computeLabel = (s) => s.label || s.name;
  }
}
if (!customElements.get("printer-card-v2-editor")) {
  customElements.define("printer-card-v2-editor", PrinterCardV2Editor);
}


// ─────────────────────────────────────────────────────────────
//  Main Card
// ─────────────────────────────────────────────────────────────
class PrinterCardV2 extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = null;
    this._lastStatus = null;
    this._camInterval = null;
    // Reusable native tile elements, keyed by entity role
    this._tiles = {};
  }

  static getConfigElement() { return document.createElement("printer-card-v2-editor"); }
  static getStubConfig() {
    return { name: "my3D-Printer", printer_status_entity: "", camera_entity: "", power_switch_entity: "" };
  }

  setConfig(config) {
    this._config = config;
    this._lastStatus = null; // force structural rebuild
    this._tiles = {};
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    const status = this._status();
    if (status !== this._lastStatus) {
      this._lastStatus = status;
      this._render();
    } else {
      // Just forward hass to all live native child elements — they update themselves
      this._propagateHass();
    }
  }

  connectedCallback() {
    this._camInterval = setInterval(() => this._refreshCamera(), 5000);
  }
  disconnectedCallback() {
    clearInterval(this._camInterval);
  }

  // ── Camera refresh (flicker-free preload) ────────────────
  _refreshCamera() {
    const img = this.shadowRoot.querySelector(".camera-img");
    if (!img || !this._config.camera_entity || !this._hass) return;
    const token = this._hass.states[this._config.camera_entity]?.attributes?.access_token;
    if (!token) return;
    const src = `/api/camera_proxy/${this._config.camera_entity}?token=${token}&t=${Date.now()}`;
    const pre = new Image();
    pre.onload = () => {
      img.src = src;
      // Update lightbox if active
      const lb = this.shadowRoot.getElementById("lightbox");
      if (lb && lb.classList.contains("active")) {
        lb.querySelector("img").src = src;
      }
    };
    pre.src = src;
  }

  // ── Status detection — reads raw sensor value from HA ────
  _status() {
    if (!this._config.printer_status_entity || !this._hass) return "unavailable";
    const stateObj = this._hass.states[this._config.printer_status_entity];
    if (!stateObj) return "unavailable";
    const raw = stateObj.state.toLowerCase();
    if (raw === "unavailable" || raw === "unknown" || raw === "off" || raw === "offline") return "unavailable";
    if (raw.includes("print") || raw.includes("printing") || raw.includes("running") || raw.includes("working")) return "printing";
    if (raw.includes("idle") || raw.includes("standby") || raw.includes("ready") ||
      raw.includes("finish") || raw.includes("operational") || raw === "on") return "idle";
    // Fallback: if entity exists and has a real value, treat as idle rather than unavailable
    return "idle";
  }

  // ── Propagate hass to all native HA child elements ───────
  _propagateHass() {
    if (!this.shadowRoot) return;
    // All native HA elements that need hass forwarded
    this.shadowRoot.querySelectorAll(
      "hui-tile-card, ha-icon-button, ha-state-label-badge, hui-image-card, mushroom-template-card"
    ).forEach(el => { if (el.hass !== this._hass) el.hass = this._hass; });

    // Update custom text elements
    this._updateJobName();
    this._updateTimeValues();
    this._updateLayerValue();
    this._updateProgressBar();
  }

  _updateJobName() {
    const jobNameEl = this.shadowRoot.querySelector(".job-name");
    if (!jobNameEl) return;
    const jobId = this._config.job_name_entity;
    if (jobId && this._hass?.states[jobId]) {
      const fileName = this._hass.states[jobId].state || "—";
      jobNameEl.textContent = fileName;
    }
  }

  _updateTimeValues() {
    const timeValues = this.shadowRoot.querySelectorAll(".t-value");
    if (timeValues.length < 2) return;

    // ELAPSED
    const elapsedId = this._config.print_time_entity;
    if (elapsedId && this._hass?.states[elapsedId]) {
      const state = this._hass.states[elapsedId].state;
      const unit = this._hass.states[elapsedId].attributes?.unit_of_measurement || "";
      timeValues[0].textContent = state !== "unavailable" && state !== "unknown" ? `${state} ${unit}`.trim() : "—";
    }

    // REMAINING
    const remainingId = this._config.print_time_left_entity;
    if (remainingId && this._hass?.states[remainingId]) {
      const state = this._hass.states[remainingId].state;
      const unit = this._hass.states[remainingId].attributes?.unit_of_measurement || "";
      timeValues[1].textContent = state !== "unavailable" && state !== "unknown" ? `${state} ${unit}`.trim() : "—";
    }

    // ETA (if 3 elements exist)
    if (timeValues.length >= 3) {
      const etaId = this._config.eta_entity;
      if (etaId && this._hass?.states[etaId]) {
        const state = this._hass.states[etaId].state;
        const unit = this._hass.states[etaId].attributes?.unit_of_measurement || "";
        timeValues[2].textContent = state !== "unavailable" && state !== "unknown" ? `${state} ${unit}`.trim() : "—";
      }
    }
  }

  _updateLayerValue() {
    // No longer needed manually as we use Jinja templates in _buildLayerTile
    // Mushroom handles the updates itself when hass changes.
  }

  _updateProgressBar() {
    const progressFill = this.shadowRoot.querySelector(".progress-fill");
    if (!progressFill) return;
    const pct = this._pct();
    progressFill.style.width = pct + "%";
  }

  _showLightbox(src) {
    const lb = this.shadowRoot.getElementById("lightbox");
    if (!lb) return;
    lb.querySelector("img").src = src;
    lb.classList.add("active");
  }

  // ── Full structural render ────────────────────────────────
  _render() {
    if (!this._hass) return;
    const sr = this.shadowRoot;
    const status = this._lastStatus || this._status();

    // Clear and rebuild
    sr.innerHTML = `<style>${this._css()}</style>`;
    const card = document.createElement("ha-card");
    card.className = "printer-card-v2";

    // Lightbox for bigger image
    const lb = document.createElement("div");
    lb.id = "lightbox";
    lb.className = "lightbox";
    lb.onclick = () => lb.classList.remove("active");
    const lbImg = document.createElement("img");
    lb.appendChild(lbImg);
    sr.appendChild(lb);

    if (status === "unavailable") {
      card.appendChild(this._buildUnavail());
    } else if (status === "idle") {
      card.appendChild(this._buildCameraArea(status));
      const bottom = this._buildIdleBottom();
      if (bottom) card.appendChild(bottom);
    } else {
      card.appendChild(this._buildCameraArea(status));
      const bottom = this._buildPrintingBottom();
      if (bottom) card.appendChild(bottom);
    }

    sr.appendChild(card);
    this._propagateHass();
  }

  // ── Build: Unavailable view ───────────────────────────────
  _buildUnavail() {
    const wrap = document.createElement("div");
    wrap.className = "view-unavail";

    // Show printer image if configured
    const customImg = this._config.printer_image;
    if (customImg && this._config.show_printer_image_when_off) {
      const imgWrap = document.createElement("div");
      imgWrap.className = "unavail-printer-image";

      const img = document.createElement("img");
      const scriptPath = new URL(import.meta.url).pathname;
      const basePath = scriptPath.substring(0, scriptPath.lastIndexOf('/'));
      img.src = `${basePath}/images/${customImg}`;
      img.alt = "Drucker";
      imgWrap.appendChild(img);
      wrap.appendChild(imgWrap);
    } else {
      const icon = document.createElement("ha-icon");
      icon.setAttribute("icon", "mdi:printer-3d");
      icon.className = "unavail-icon-el";
      wrap.appendChild(icon);
    }

    const text = document.createElement("div");
    text.innerHTML = `
      <div class="unavail-name">${this._config.name || "3D-Drucker"}</div>
      <div class="unavail-sub">Offline</div>`;

    const powerWrap = document.createElement("div");
    powerWrap.className = "power-wrap";
    powerWrap.innerHTML = `<span class="power-label">POWER</span>`;

    const btn = this._makeIconButton("mdi:power", "btn-power-on", "power-on");
    powerWrap.appendChild(btn);

    wrap.appendChild(text);
    wrap.appendChild(powerWrap);
    return wrap;
  }

  // ── Build: Camera area with overlay ──────────────────────
  _buildCameraArea(status) {
    const wrap = document.createElement("div");
    wrap.className = "camera-area";
    wrap.onclick = () => {
      const img = wrap.querySelector(".camera-img");
      if (img) this._showLightbox(img.src);
    };

    // Custom printer image (shown when no camera available)
    const customImg = this._config.printer_image;
    let showLiveBadge = false;

    if (customImg) {
      // If custom image is selected from the dropdown, use the local image file
      const img = document.createElement("img");
      img.className = "camera-img printer-custom-img";
      // Use relative path from /local/ - works regardless of folder name
      const scriptPath = new URL(import.meta.url).pathname;
      const basePath = scriptPath.substring(0, scriptPath.lastIndexOf('/'));
      img.src = `${basePath}/images/${customImg}`;
      img.alt = "Drucker";
      wrap.appendChild(img);
    } else if (this._config.printer_image_entity && this._hass) {
      // Backward compatibility: support for entity-based images
      const customImgId = this._config.printer_image_entity;
      let customImgUrl = null;

      // Check if it's a media entity (from media picker)
      if (customImgId.startsWith("media-source://")) {
        customImgUrl = customImgId;
      } else if (this._hass.states[customImgId]) {
        // For image entity
        customImgUrl = this._hass?.states[customImgId]?.state?.startsWith("http")
          ? this._hass.states[customImgId].state
          : this._hass?.states[customImgId]?.attributes?.entity_picture;
      }

      if (customImgUrl) {
        const img = document.createElement("img");
        img.className = "camera-img printer-custom-img";
        img.src = customImgUrl;
        img.alt = "Drucker";
        wrap.appendChild(img);
      } else {
        wrap.appendChild(this._cameraPlaceholder());
      }
    } else {
      // Camera image
      const camId = this._config.camera_entity;
      if (camId && this._hass) {
        const token = this._hass.states[camId]?.attributes?.access_token;
        const src = token ? `/api/camera_proxy/${camId}?token=${token}&t=${Date.now()}` : null;
        if (src) {
          const img = document.createElement("img");
          img.className = "camera-img";
          img.src = src;
          img.alt = "Kamera";
          wrap.appendChild(img);
        } else {
          wrap.appendChild(this._cameraPlaceholder());
        }
      } else {
        wrap.appendChild(this._cameraPlaceholder());
      }
    }

    // Overlay
    const overlay = document.createElement("div");
    overlay.className = "cam-overlay";

    // Status pill — uses ha-state-label-badge for the status entity
    const pill = document.createElement("div");
    pill.className = `status-pill ${status === "printing" ? "pill-printing" : "pill-idle"}`;

    const pillIcon = document.createElement("ha-icon");
    pillIcon.setAttribute("icon", status === "printing" ? "mdi:printer-3d-nozzle" : "mdi:printer-3d");
    pill.appendChild(pillIcon);

    const pillText = document.createElement("span");
    pillText.textContent = status === "printing"
      ? "PRINTING..."
      : `${this._config.name || "3D-Drucker"} – Idle`;
    pill.appendChild(pillText);
    overlay.appendChild(pill);

    // Action button
    if (status === "printing") {
      overlay.appendChild(this._makeIconButton("mdi:pause", "btn-cam-pause", "pause"));
    } else {
      overlay.appendChild(this._makeIconButton("mdi:power", "btn-cam-off", "power-off"));
    }

    wrap.appendChild(overlay);

    // Live badge - only show when camera feed is available
    const hasCamera = this._config.camera_entity && this._hass &&
      this._hass.states[this._config.camera_entity]?.attributes?.access_token;
    if (hasCamera) {
      const live = document.createElement("div");
      live.className = "live-badge";
      live.innerHTML = `<div class="live-dot"></div>LIVE`;
      wrap.appendChild(live);
    }

    return wrap;
  }

  _cameraPlaceholder() {
    const d = document.createElement("div");
    d.className = "camera-no";
    d.innerHTML = `<ha-icon icon="mdi:camera-off"></ha-icon> Kein Kamerabild`;
    return d;
  }

  // ── Build: Idle bottom — native hui-tile-cards ────────────
  _buildIdleBottom() {
    const wrap = document.createElement("div");
    wrap.className = "idle-bottom";

    const tempRow = document.createElement("div");
    tempRow.className = "temp-row";
    
    const bedTile = this._buildTile(this._config.bed_temp_entity, "mdi:thermometer", "blue");
    const nozzleTile = this._buildTile(this._config.nozzle_temp_entity, "mdi:printer-3d-nozzle-heat", "blue");
    
    if (bedTile) tempRow.appendChild(bedTile);
    if (nozzleTile) tempRow.appendChild(nozzleTile);
    
    if (tempRow.children.length > 0) {
      wrap.appendChild(tempRow);
      return wrap;
    }

    return null;
  }

  // ── Build: Printing bottom ────────────────────────────────
  _buildPrintingBottom() {
    const wrap = document.createElement("div");

    // Info row: thumbnail + job name + times
    const infoRow = document.createElement("div");
    infoRow.className = "print-info-row";

    // Thumbnail with click-to-zoom
    const thumbWrap = document.createElement("div");
    thumbWrap.className = "thumb-wrap";

    const thumbId = this._config.thumbnail_entity;
    const thumbUrl = thumbId ? (this._hass?.states[thumbId]?.state?.startsWith("http")
      ? this._hass.states[thumbId].state
      : this._hass?.states[thumbId]?.attributes?.entity_picture) : null;
    
    if (thumbUrl) {
      const img = document.createElement("img");
      img.className = "thumb-sm";
      img.src = thumbUrl;
      img.alt = "Modell";
      thumbWrap.appendChild(img);
      thumbWrap.onclick = () => this._showLightbox(thumbUrl);
    } else {
      const ph = document.createElement("div");
      ph.className = "thumb-sm-ph";
      ph.innerHTML = `<ha-icon icon="mdi:cube-outline"></ha-icon>`;
      thumbWrap.appendChild(ph);
    }
    infoRow.appendChild(thumbWrap);

    // Job info: job name + elapsed / remaining via native state labels
    const jobInfo = document.createElement("div");
    jobInfo.className = "job-info";

    const jobName = document.createElement("div");
    jobName.className = "job-name";
    const jobId = this._config.job_name_entity;
    if (jobId && this._hass?.states[jobId]) {
      const fileName = this._hass.states[jobId].state || "—";
      jobName.textContent = fileName;
    } else {
      jobName.textContent = "—";
    }
    jobInfo.appendChild(jobName);

    const timeRow = document.createElement("div");
    timeRow.className = "time-row";
    timeRow.appendChild(this._buildTimeCol("ELAPSED", this._config.print_time_entity, false));
    timeRow.appendChild(this._buildTimeCol("REMAINING", this._config.print_time_left_entity, true));
    timeRow.appendChild(this._buildTimeCol("ETA", this._config.eta_entity, true));
    jobInfo.appendChild(timeRow);
    infoRow.appendChild(jobInfo);
    wrap.appendChild(infoRow);

    // Progress bar — driven by native entity value
    const progWrap = document.createElement("div");
    progWrap.className = "progress-wrap";
    const track = document.createElement("div");
    track.className = "progress-track";
    const fill = document.createElement("div");
    fill.className = "progress-fill";
    const pct = this._pct();
    fill.style.width = pct + "%";
    track.appendChild(fill);
    progWrap.appendChild(track);
    wrap.appendChild(progWrap);

    // Sensor grid — all native hui-tile-cards
    const sensorsWrap = document.createElement("div");
    sensorsWrap.className = "print-sensors";
    const grid = document.createElement("div");
    grid.className = "sensor-grid-2";


    const tiles = [
      this._buildLayerTile(),
      this._buildTile(this._config.print_progress_entity, "mdi:percent", "orange"),
      this._buildTile(this._config.bed_temp_entity, "mdi:radiator", "orange"),
      this._buildTile(this._config.nozzle_temp_entity, "mdi:printer-3d-nozzle-heat", "orange"),
      this._buildTile(this._config.print_time_entity, "mdi:clock-outline", "orange"),
      this._buildTile(this._config.print_time_left_entity, "mdi:clock-end", "orange"),
      this._buildTile(this._config.eta_entity, "mdi:clock-check-outline", "orange")
    ];

    tiles.forEach(tile => {
      if (tile) grid.appendChild(tile);
    });

    if (grid.children.length > 0) {
      sensorsWrap.appendChild(grid);
      wrap.appendChild(sensorsWrap);
    }

    return wrap;
  }

  // ── Native hui-tile-card factory ─────────────────────────
  // hui-tile-card renders the entity's icon, name, state + unit natively
  _buildTile(entityId, fallbackIcon, color) {
    if (!entityId) return null;

    const wrapper = document.createElement("div");
    wrapper.className = `tile-wrap tile-${color}`;

    // Extract a clean name from the entity attributes
    const stateObj = this._hass?.states[entityId];
    const attrName = stateObj?.attributes?.friendly_name || entityId;
    // Remove device prefix (everything before the last space or use the whole name)
    const cleanName = attrName.includes(' ')
      ? attrName.split(' ').slice(1).join(' ')
      : attrName;

    const tile = document.createElement("hui-tile-card");
    tile.setConfig({
      type: "tile",
      entity: entityId,
      name: cleanName,
      icon: fallbackIcon,
      color: color,
      show_entity_picture: false,
      tap_action: { action: "more-info" },
    });

    this._tiles[entityId] = tile;
    wrapper.appendChild(tile);
    return wrapper;
  }

  // Layer tile: two entities combined into one display
  _buildLayerTile() {
    const curId = this._config.current_layer_entity;
    if (!curId) return null;

    const totId = this._config.total_layers_entity;
    // Use official Home Assistant Jinja templates for reliable updates
    // Handle unavailable/unknown states by showing "—" instead
    let secondary = `{% set cur = states('${curId}') %}{% if cur not in ['unavailable', 'unknown', 'none'] %}{{ cur }}{% else %}—{% endif %}`;
    if (totId) {
      secondary = `{% set cur = states('${curId}') %}{% set tot = states('${totId}') %}{% if cur not in ['unavailable', 'unknown', 'none'] and tot not in ['unavailable', 'unknown', 'none'] %}{{ cur }} / {{ tot }}{% else %}—{% endif %}`;
    }

    const tile = document.createElement("mushroom-template-card");
    tile.className = "mushroom-layer-tile";
    tile.setConfig({
      type: "custom:mushroom-template-card",
      primary: "Layer",
      secondary: secondary,
      icon: "mdi:layers-triple",
      icon_color: "orange",
      layout: "horizontal",
      tap_action: { action: "more-info" },
      entity: curId
    });
    
    return tile;
  }

  // Inline state label for meta rows (last job, filament)
  _buildStateLine(entityId, label, accent) {
    const wrap = document.createElement("div");
    wrap.style.textAlign = accent ? "right" : "left";
    const l = document.createElement("div");
    l.className = "meta-label";
    l.textContent = label;
    wrap.appendChild(l);

    const v = document.createElement("div");
    v.className = "meta-value" + (accent ? " accent" : "");
    if (entityId) {
      const badge = document.createElement("ha-state-label-badge");
      badge.label = "";
      this._tiles[entityId + "_meta"] = badge;
      v.appendChild(badge);
    } else {
      v.textContent = "—";
    }
    wrap.appendChild(v);
    return wrap;
  }

  // Time column for printing view
  _buildTimeCol(label, entityId, accent) {
    const wrap = document.createElement("div");
    wrap.style.textAlign = accent ? "right" : "left";
    const l = document.createElement("div");
    l.className = "t-label";
    l.textContent = label;
    wrap.appendChild(l);
    const v = document.createElement("div");
    v.className = "t-value" + (accent ? " remaining" : "");
    if (entityId && this._hass?.states[entityId]) {
      const state = this._hass.states[entityId].state;
      const unit = this._hass.states[entityId].attributes?.unit_of_measurement || "";
      v.textContent = state !== "unavailable" && state !== "unknown" ? `${state} ${unit}`.trim() : "—";
    } else {
      v.textContent = "—";
    }
    wrap.appendChild(v);
    return wrap;
  }

  // ── Native ha-icon-button factory ────────────────────────
  _makeIconButton(icon, cssClass, action) {
    const btn = document.createElement("ha-icon-button");
    btn.className = `cam-action-btn ${cssClass}`;
    btn.dataset.action = action;
    // ha-icon-button needs a nested ha-icon or path
    const inner = document.createElement("ha-icon");
    inner.setAttribute("icon", icon);
    btn.appendChild(inner);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this._doAction(action);
    });
    return btn;
  }

  // ── Progress helper ───────────────────────────────────────
  _pct() {
    const id = this._config.print_progress_entity;
    if (!id || !this._hass) return 0;
    return Math.min(parseFloat(this._hass.states[id]?.state) || 0, 100);
  }

  // ── Actions ───────────────────────────────────────────────
  _doAction(action) {
    const c = this._config;
    if (action === "power-on") this._svc("homeassistant", "turn_on", { entity_id: c.power_switch_entity });
    if (action === "power-off") this._svc("homeassistant", "turn_off", { entity_id: c.power_switch_entity });
    if (action === "pause" && c.pause_button_entity) {
      const d = c.pause_button_entity.split(".")[0];
      this._svc(d, d === "button" ? "press" : "turn_on", { entity_id: c.pause_button_entity });
    }
  }
  _svc(domain, service, data) { if (this._hass) this._hass.callService(domain, service, data); }

  getCardSize() { return 4; }

  // ── CSS ───────────────────────────────────────────────────
  _css() {
    return `
    :host { display: block; }
    * { box-sizing: border-box; }

    ha-card.printer-card-v2 {
      overflow: hidden;
      border-radius: var(--ha-card-border-radius, 16px);
      padding: 0;
    }

    /* ── UNAVAILABLE ─────────────────────────────────────── */
    .view-unavail {
      display: flex; align-items: center; gap: 12px;
      padding: 14px 16px;
    }
    .unavail-icon-el {
      --mdc-icon-size: 24px;
      color: var(--secondary-text-color);
      width: 40px; height: 40px;
      background: var(--secondary-background-color, #f5f5f5);
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .unavail-printer-image {
      width: 60px; height: 60px;
      flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      background: var(--secondary-background-color, #f5f5f5);
      border-radius: 8px;
      overflow: hidden;
    }
    .unavail-printer-image img {
      width: 100%; height: 100%;
      object-fit: contain;
    }
    .unavail-name { font-size: .95rem; font-weight: 600; }
    .unavail-sub  { font-size: .78rem; color: var(--secondary-text-color); margin-top: 1px; }
    .power-wrap   { display: flex; align-items: center; gap: 6px; margin-left: auto; }
    .power-label  { font-size: .72rem; font-weight: 600; letter-spacing: .06em;
                    text-transform: uppercase; color: var(--secondary-text-color); }

    /* ── CAMERA ──────────────────────────────────────────── */
    .camera-area  { 
      position: relative; 
      width: 100%; 
      background: #111; 
      line-height: 0;
      margin: 0;
      padding: 0;
      cursor: zoom-in;
    }
    .camera-img   {
      width: 100%; 
      height: auto;
      display: block; 
      object-fit: cover;
      aspect-ratio: 16/9; 
      background: #111;
      margin: 0;
      padding: 0;
    }
    .lightbox {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.92); z-index: 9999;
      display: none; align-items: center; justify-content: center;
      cursor: zoom-out;
    }
    .lightbox.active { display: flex; }
    .lightbox img {
      max-width: 95%; max-height: 95%; border-radius: 8px;
      box-shadow: 0 0 50px rgba(0,0,0,0.8);
      object-fit: contain;
    }
    .printer-custom-img {
      object-fit: contain;
      background: #1a1a1a;
    }
    .camera-no {
      width: 100%; height: 180px; display: flex; align-items: center;
      justify-content: center; background: #1a1a1a; color: #555; gap: 8px;
      font-size: .85rem;
    }
    .camera-no ha-icon { --mdc-icon-size: 22px; }

    .cam-overlay {
      position: absolute; top: 10px; left: 10px; right: 10px;
      display: flex; align-items: center; justify-content: space-between;
      pointer-events: none;
    }
    .cam-overlay > * { pointer-events: all; }

    .status-pill {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 6px 13px 6px 10px; border-radius: 40px;
      backdrop-filter: blur(14px) saturate(1.6);
      font-size: .82rem; font-weight: 600;
    }
    .status-pill ha-icon { --mdc-icon-size: 16px; }
    .pill-idle     { background: rgba(255,255,255,.82); color: #1a1a1a; }
    .pill-printing { background: rgba(28,28,28,.78);    color: #ff6d00; }
    .pill-printing ha-icon { color: #ff6d00; }

    .live-badge {
      position: absolute; bottom: 10px; left: 12px;
      display: flex; align-items: center; gap: 5px;
      font-size: .72rem; font-weight: 700; color: #fff; letter-spacing: .05em;
    }
    .live-dot {
      width: 8px; height: 8px; border-radius: 50%; background: #f44336;
      animation: blink 1.4s ease infinite;
    }
    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }

    /* icon buttons */
    .cam-action-btn {
      --mdc-icon-button-size: 40px;
      --mdc-icon-size: 20px;
      border-radius: 50%;
    }
    .btn-power-on  { background: rgba(76,175,80,.15); color: #4caf50; }
    .btn-cam-pause { background: rgba(28,28,28,.78); backdrop-filter: blur(12px); color: #fff; }
    .btn-cam-off   { background: rgba(244,67,54,.15); backdrop-filter: blur(12px); color: #f44336; }

    /* ── TILE WRAPPERS ───────────────────────────────────── */
    /* Override hui-tile-card internals to match our color scheme */
    .tile-wrap {
      border-radius: 12px;
      overflow: hidden;
      position: relative;
    }
    .tile-blue hui-tile-card {
      --tile-color: #2196f3;
      --rgb-tile-color: 33, 150, 243;
      --state-color: #2196f3;
      --ha-card-background: rgba(33,150,243,.08);
      --ha-card-box-shadow: none;
      --ha-card-border-radius: 12px;
      --primary-text-color: white;
      --secondary-text-color: #2196f3;
      margin: 0;
    }
    .tile-blue hui-tile-card ha-tile-icon {
      --tile-color: #2196f3;
      --rgb-tile-color: 33, 150, 243;
    }
    .tile-orange hui-tile-card {
      --tile-color: #ff6d00;
      --rgb-tile-color: 255, 109, 0;
      --state-color: #ff6d00;
      --ha-card-background: rgba(255,109,0,.07);
      --ha-card-box-shadow: none;
      --ha-card-border-radius: 12px;
      --primary-text-color: white;
      --secondary-text-color: #ff6d00;
      margin: 0;
    }
    .tile-orange hui-tile-card ha-tile-icon {
      --tile-color: #ff6d00;
      --rgb-tile-color: 255, 109, 0;
    }
    /* Force colors for all tile content */
    .tile-orange hui-tile-card .primary,
    .tile-orange hui-tile-card ha-tile-info .primary {
      color: white !important;
    }
    .tile-orange hui-tile-card .state,
    .tile-orange hui-tile-card .value,
    .tile-orange hui-tile-card .secondary,
    .tile-orange hui-tile-card ha-tile-info .secondary {
      color: #ff6d00 !important;
    }
    .tile-blue hui-tile-card .primary,
    .tile-blue hui-tile-card ha-tile-info .primary {
      color: white !important;
    }
    .tile-blue hui-tile-card .state,
    .tile-blue hui-tile-card .value,
    .tile-blue hui-tile-card .secondary,
    .tile-blue hui-tile-card ha-tile-info .secondary {
      color: #2196f3 !important;
    }
    .tile-empty {
      height: 64px; display: flex; align-items: center; justify-content: center;
      color: var(--secondary-text-color); font-size: .85rem;
      background: var(--secondary-background-color); border-radius: 12px;
    }
    .layer-total-overlay {
      position: absolute; bottom: 4px; right: 8px;
      font-size: .68rem; color: var(--secondary-text-color);
    }
    .layer-total-overlay ha-state-label-badge { --ha-label-badge-size: 20px; font-size: .65rem; }

    /* Mushroom Layer Tile tweaks to match hui-tile-card */
    .mushroom-layer-tile {
      margin: 0;
      --ha-card-border-radius: 12px;
      --ha-card-box-shadow: none;
      --ha-card-background: rgba(255,109,0,.07);
      --mush-icon-size: 40px;
      --mush-spacing: 12px;
    }
    .mushroom-layer-tile ha-card {
      background: transparent !important;
      border: none !important;
      box-shadow: none !important;
    }

    /* ── IDLE BOTTOM ─────────────────────────────────────── */
    .idle-bottom { padding: 12px 14px 14px; }
    .temp-row {
      display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;
    }
    .meta-row {
      display: flex; justify-content: space-between; align-items: flex-start;
      padding-top: 10px;
      border-top: 1px solid var(--divider-color, rgba(0,0,0,.07));
    }
    .meta-label { font-size: .7rem; color: var(--secondary-text-color); }
    .meta-value {
      font-size: .88rem; font-weight: 500; margin-top: 2px;
      /* strip badge chrome — show only text */
    }
    .meta-value ha-state-label-badge {
      --ha-label-badge-size: 0px;
      --ha-label-badge-font-size: .88rem;
      font-weight: 500;
    }
    .meta-value.accent { color: #ff6d00; font-weight: 700; }

    /* ── PRINTING BOTTOM ─────────────────────────────────── */
    .print-info-row {
      display: flex; align-items: center; gap: 12px; padding: 12px 14px 0;
    }
    .thumb-wrap {
      width: 54px; height: 54px; border-radius: 8px;
      overflow: hidden; flex-shrink: 0; cursor: zoom-in;
      background: var(--secondary-background-color);
    }
    .thumb-sm {
      width: 100%; height: 100%; object-fit: cover;
      display: block;
    }
    .thumb-sm-ph {
      width: 100%; height: 100%;
      display: flex; align-items: center; justify-content: center;
    }
    .thumb-sm-ph ha-icon { --mdc-icon-size: 26px; color: var(--secondary-text-color); }
    .job-info  { flex: 1; min-width: 0; }
    .job-name  { font-size: .9rem; font-weight: 700; white-space: nowrap;
                 overflow: hidden; text-overflow: ellipsis; margin-bottom: 4px; }
    .job-name-badge { --ha-label-badge-font-size: .9rem; }
    .time-row  { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 5px; }
    .t-label   { font-size: .62rem; text-transform: uppercase; letter-spacing: .06em;
                 color: var(--secondary-text-color); font-weight: 600; white-space: nowrap; }
    .t-value   { font-size: .82rem; font-weight: 600; margin-top: 1px; white-space: nowrap; }
    .t-value.remaining { color: #ff6d00; }
    .t-value ha-state-label-badge { --ha-label-badge-font-size: .88rem; }

    .progress-wrap  { padding: 10px 14px 0; }
    .progress-track {
      height: 6px; border-radius: 6px;
      background: var(--secondary-background-color, rgba(0,0,0,.08)); overflow: hidden;
    }
    .progress-fill {
      height: 100%; border-radius: 6px;
      background: linear-gradient(90deg, #ff6d00, #ff9800); transition: width .4s ease;
    }

    .print-sensors  { padding: 10px 14px 14px; }
    .sensor-grid-2  { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  `;
  }
}

if (!customElements.get("printer-card-v2")) {
  customElements.define("printer-card-v2", PrinterCardV2);
}

window.customCards = window.customCards || [];
if (!window.customCards.some(card => card.type === "printer-card-v2")) {
  window.customCards.push({
    type: "printer-card-v2",
    name: "3D Printer Card V2",
    description: "Dynamische 3D-Drucker Karte mit nativen HA-Komponenten",
    preview: true,
  });
}