/**
 * 3D Printer Card — Home Assistant Custom Card
 * Camera: live-streams via /api/camera_proxy_stream (MJPEG multipart),
 *         falls back to HLS <video>, then to 5-second snapshot polling.
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
      {
        name: "printer_image", label: "Drucker-Bild",
        selector: { media: { accept: ["image/*"], clearable: true, image_upload: true, hide_content_type: true } }
      },
      { name: "printer_status_entity", label: "Drucker-Status Sensor", selector: { entity: {} } },
      { name: "camera_entity", label: "Kamera", selector: { entity: { domain: "camera" } } },
      { name: "power_switch_entity", label: "Spannungsversorgungs-Schalter", selector: { entity: { domain: ["switch", "input_boolean"] } } },
      { name: "power_sensor_entity", label: "Leistungsaufnahme (W) Sensor", selector: { entity: { domain: "sensor" } } },
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
    ];
  }

  _render() {
    if (!this._hass || !customElements.get("ha-form")) return;
    if (!this._formEl) {
      this._formEl = document.createElement("ha-form");
      this._formEl.addEventListener("value-changed", (e) => {
        this._config = e.detail.value;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config } }));
        setTimeout(() => {
          this._formEl.schema = this._schema();
          this._formEl.data = { ...this._config };
        }, 0);
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
    this._tiles = {};
    this._streamMode = "mjpeg"; // "mjpeg" | "hls" | "poll"
    this._pollInterval = null;
  }

  static getConfigElement() { return document.createElement("printer-card-v2-editor"); }
  static getStubConfig() {
    return { name: "my3D-Printer", printer_status_entity: "", camera_entity: "", power_switch_entity: "", job_name_entity: "" };
  }

  setConfig(config) {
    this._config = config;
    this._lastStatus = null;
    this._tiles = {};
    this._stopPoll();
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    const status = this._status();
    if (status !== this._lastStatus) {
      this._lastStatus = status;
      this._render();
    } else {
      this._propagateHass();
    }
  }

  disconnectedCallback() { this._stopPoll(); }

  // ── Polling fallback ──────────────────────────────────────
  _startPoll() {
    if (this._pollInterval) return;
    this._pollInterval = setInterval(() => this._pollSnapshot(), 5000);
  }
  _stopPoll() {
    if (this._pollInterval) { clearInterval(this._pollInterval); this._pollInterval = null; }
  }

  _pollSnapshot() {
    const img = this.shadowRoot.querySelector(".camera-img");
    if (!img || !this._config.camera_entity || !this._hass) return;
    const camId = this._config.camera_entity;
    const token = this._hass.states[camId]?.attributes?.access_token;
    const src = token
      ? `/api/camera_proxy/${camId}?token=${token}&t=${Date.now()}`
      : `/api/camera_proxy/${camId}?t=${Date.now()}`;
    const pre = new Image();
    pre.onload = () => { img.src = src; };
    pre.src = src;
  }

  // ── Printer image URL resolver ────────────────────────────
  _getPrinterImage() {
    const img = this._config.printer_image;
    if (!img) return null;
    const id = img.media_content_id || img;
    if (!id) return null;
    if (id.startsWith("http") || id.startsWith("/local/") || id.startsWith("/api/")) return id;
    if (id.startsWith("media-source://image_upload/"))
      return `/api/image/serve/${id.replace("media-source://image_upload/", "")}/original`;
    if (id.startsWith("media-source://media_source/local/"))
      return id.replace("media-source://media_source/local/", "/local/");
    return null;
  }

  // ── Status detection ──────────────────────────────────────
  _status() {
    if (!this._config.printer_status_entity || !this._hass) return "unavailable";
    const stateObj = this._hass.states[this._config.printer_status_entity];
    if (!stateObj) return "unavailable";
    const raw = stateObj.state.toLowerCase();
    if (["unavailable", "unknown", "off", "offline"].includes(raw)) return "unavailable";
    if (raw.includes("print") || raw.includes("running") || raw.includes("working")) return "printing";
    return "idle";
  }

  // ── Propagate hass to native HA child elements ────────────
  _propagateHass() {
    if (!this.shadowRoot) return;
    this.shadowRoot.querySelectorAll(
      "hui-tile-card, hui-sensor-card, ha-icon-button, ha-state-label-badge, mushroom-template-card"
    ).forEach(el => { if (el.hass !== this._hass) el.hass = this._hass; });
    // Guard each helper — avoids crashes if DOM isn't fully built yet
    this._updateJobName();
    this._updateTimeValues();
    this._updateProgressBar();
  }

  _updateJobName() {
    const el = this.shadowRoot.querySelector(".job-name");
    if (!el) return;
    const id = this._config.job_name_entity;
    el.textContent = (id && this._hass?.states[id]) ? (this._hass.states[id].state || "—") : "—";
  }

  _updateTimeValues() {
    const els = this.shadowRoot.querySelectorAll(".t-value");
    if (els.length < 2) return;
    const read = (id) => {
      if (!id || !this._hass?.states[id]) return "—";
      const s = this._hass.states[id].state;
      const u = this._hass.states[id].attributes?.unit_of_measurement || "";
      return (s !== "unavailable" && s !== "unknown") ? `${s} ${u}`.trim() : "—";
    };
    const elapsedId = this._config.print_time_entity;
    const elapsedAvail = elapsedId && this._hass?.states[elapsedId] && !["unavailable", "unknown"].includes(this._hass.states[elapsedId].state);
    if (elapsedAvail) {
      els[0].textContent = read(elapsedId);
    } else {
      els[0].textContent = this._getLayerInfo();
    }
    els[1].textContent = read(this._config.print_time_left_entity);
    if (els.length >= 3) els[2].textContent = read(this._config.eta_entity);
  }

  _updateProgressBar() {
    const fill = this.shadowRoot.querySelector(".progress-fill");
    if (fill) fill.style.width = this._pct() + "%";
  }

  _showLightbox(src, isVideo) {
    const lb = this.shadowRoot.getElementById("lightbox");
    if (!lb) return;
    lb.innerHTML = "";
    if (isVideo) {
      const video = document.createElement("video");
      video.className = "lb-video";
      video.src = src;
      video.autoplay = true; video.muted = true; video.playsInline = true; video.controls = true;
      lb.appendChild(video);
    } else {
      const img = document.createElement("img");
      img.src = src;
      lb.appendChild(img);
    }
    lb.onclick = () => {
      const v = lb.querySelector("video");
      if (v) v.src = "";
      lb.classList.remove("active");
    };
    lb.classList.add("active");
  }

  // ── Full structural render ────────────────────────────────
  _render() {
    if (!this._hass) return;
    const sr = this.shadowRoot;
    const status = this._lastStatus || this._status();

    sr.innerHTML = `<style>${this._css()}</style>`;

    const lb = document.createElement("div");
    lb.id = "lightbox";
    lb.className = "lightbox";
    sr.appendChild(lb);

    const card = document.createElement("ha-card");
    card.className = "printer-card-v2";
    sr.appendChild(card);

    if (status === "unavailable") {
      card.appendChild(this._buildUnavail());
    } else if (status === "idle") {
      card.appendChild(this._buildHeader(status));
      if (this._config.camera_entity) {
        card.appendChild(this._buildCameraArea());
      } else {
        const divider = document.createElement("div");
        divider.className = "no-cam-divider";
        card.appendChild(divider);
      }
      const bottom = this._buildIdleBottom();
      if (bottom) card.appendChild(bottom);
    } else {
      card.appendChild(this._buildHeader(status));
      if (this._config.camera_entity) {
        card.appendChild(this._buildCameraArea());
      } else {
        const divider = document.createElement("div");
        divider.className = "no-cam-divider";
        card.appendChild(divider);
      }
      const bottom = this._buildPrintingBottom();
      if (bottom) card.appendChild(bottom);
    }

    this._propagateHass();
  }

  // ── Build: Unavailable ────────────────────────────────────
  _buildUnavail() {
    const wrap = document.createElement("div");
    wrap.className = "view-unavail";
    const imgUrl = this._getPrinterImage();
    if (imgUrl) {
      const imgWrap = document.createElement("div");
      imgWrap.className = "unavail-printer-image";
      const img = document.createElement("img"); img.src = imgUrl; img.alt = "Drucker";
      imgWrap.appendChild(img); wrap.appendChild(imgWrap);
    } else {
      const icon = document.createElement("ha-icon");
      icon.setAttribute("icon", "mdi:printer-3d"); icon.className = "unavail-icon-el";
      wrap.appendChild(icon);
    }
    const text = document.createElement("div");
    const statusEntity = this._config.printer_status_entity;
    const realStatus = (statusEntity && this._hass?.states[statusEntity]) ? this._hass.states[statusEntity].state : "unavailable";
    text.innerHTML = `<div class="unavail-name">${this._config.name || "3D-Drucker"}</div><div class="unavail-sub">${realStatus}</div>`;
    const powerWrap = document.createElement("div");
    powerWrap.className = "power-wrap";
    powerWrap.innerHTML = `<span class="power-label">POWER</span>`;
    powerWrap.appendChild(this._makeIconButton("mdi:power", "btn-power-on", "power-on"));
    wrap.appendChild(text);
    wrap.appendChild(powerWrap);
    return wrap;
  }

  // ── Build: Header (idle / printing) ──────────────────────
  _buildHeader(status) {
    const wrap = document.createElement("div");
    wrap.className = "view-unavail";
    const imgUrl = this._getPrinterImage();
    if (imgUrl) {
      const imgWrap = document.createElement("div");
      imgWrap.className = "unavail-printer-image";
      const img = document.createElement("img"); img.src = imgUrl; img.alt = "Drucker";
      imgWrap.appendChild(img); wrap.appendChild(imgWrap);
    } else {
      const icon = document.createElement("ha-icon");
      icon.setAttribute("icon", "mdi:printer-3d"); icon.className = "unavail-icon-el";
      wrap.appendChild(icon);
    }
    const statusEntity = this._config.printer_status_entity;
    const realStatus = (statusEntity && this._hass?.states[statusEntity]) ? this._hass.states[statusEntity].state : (status === "printing" ? "Printing" : "Idle");
    const text = document.createElement("div");
    text.innerHTML = `<div class="unavail-name">${this._config.name || "3D-Drucker"}</div><div class="unavail-sub">${realStatus}</div>`;
    if (status !== "printing") {
      const powerWrap = document.createElement("div");
      powerWrap.className = "power-wrap";
      powerWrap.innerHTML = `<span class="power-label">POWER</span>`;
      powerWrap.appendChild(this._makeIconButton("mdi:power", "btn-power-on", "power-on"));
      wrap.appendChild(text);
      wrap.appendChild(powerWrap);
    } else {
      wrap.appendChild(text);
    }
    return wrap;
  }

  // ── Build: Camera area ────────────────────────────────────
  _buildCameraArea() {
    this._stopPoll();

    const wrap = document.createElement("div");
    wrap.className = "camera-area";

    const camId = this._config.camera_entity;
    if (!camId || !this._hass) {
      wrap.appendChild(this._cameraPlaceholder());
      return wrap;
    }

    const token = this._hass.states[camId]?.attributes?.access_token;
    const tokenParam = token ? `?token=${token}` : "";
    const mjpegUrl = `/api/camera_proxy_stream/${camId}${tokenParam}`;

    const img = document.createElement("img");
    img.className = "camera-img";
    img.alt = "Kamera";

    img.onerror = () => this._tryHlsOrPoll(wrap, img, camId, token);
    img.src = mjpegUrl;

    wrap.appendChild(img);
    this._streamMode = "mjpeg";

    wrap.onclick = () => {
      const snapUrl = `/api/camera_proxy/${camId}${tokenParam}&t=${Date.now()}`;
      this._showLightbox(snapUrl, false);
    };

    const live = document.createElement("div");
    live.className = "live-badge";
    live.innerHTML = `<div class="live-dot"></div>LIVE`;
    wrap.appendChild(live);

    return wrap;
  }

  _tryHlsOrPoll(wrap, failedImg, camId, token) {
    failedImg.remove();
    const tokenParam = token ? `?token=${token}` : "";
    const hlsUrl = `/api/camera_proxy_stream/${camId}${tokenParam}${token ? "&" : "?"}format=hls`;

    const video = document.createElement("video");
    video.className = "camera-img";
    video.autoplay = true; video.muted = true; video.playsInline = true; video.loop = true;

    video.onerror = () => {
      video.remove();
      this._streamMode = "poll";
      const snapUrl = `/api/camera_proxy/${camId}${tokenParam}&t=${Date.now()}`;
      const img = document.createElement("img");
      img.className = "camera-img"; img.alt = "Kamera"; img.src = snapUrl;
      wrap.insertBefore(img, wrap.querySelector(".live-badge"));
      this._startPoll();
    };

    video.src = hlsUrl;
    wrap.insertBefore(video, wrap.querySelector(".live-badge"));
    this._streamMode = "hls";
    wrap.onclick = () => this._showLightbox(hlsUrl, true);
  }

  _cameraPlaceholder() {
    const d = document.createElement("div");
    d.className = "camera-no";
    d.innerHTML = `<ha-icon icon="mdi:camera-off"></ha-icon> Kein Kamerabild`;
    return d;
  }

  // ── Build: Idle bottom ────────────────────────────────────
  _buildIdleBottom() {
    const wrap = document.createElement("div");
    wrap.className = "idle-bottom";
    const tempRow = document.createElement("div");
    tempRow.className = "temp-row";
    const bedTile = this._buildSensorCard(this._config.bed_temp_entity, "mdi:thermometer", "blue");
    const nozzleTile = this._buildSensorCard(this._config.nozzle_temp_entity, "mdi:printer-3d-nozzle-heat", "orange");
    const powerTile = this._buildSensorCard(this._config.power_sensor_entity, "mdi:lightning-bolt", "yellow");
    if (bedTile) tempRow.appendChild(bedTile);
    if (nozzleTile) tempRow.appendChild(nozzleTile);
    if (powerTile) tempRow.appendChild(powerTile);
    if (tempRow.children.length > 0) { wrap.appendChild(tempRow); return wrap; }
    return null;
  }

  // ── Build: Printing bottom ────────────────────────────────
  _buildPrintingBottom() {
    const wrap = document.createElement("div");

    const infoRow = document.createElement("div");
    infoRow.className = "print-info-row";

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "thumb-wrap";
    const thumbId = this._config.thumbnail_entity;
    const thumbUrl = thumbId ? (this._hass?.states[thumbId]?.state?.startsWith("http")
      ? this._hass.states[thumbId].state
      : this._hass?.states[thumbId]?.attributes?.entity_picture) : null;
    if (thumbUrl) {
      const img = document.createElement("img");
      img.className = "thumb-sm"; img.src = thumbUrl; img.alt = "Modell";
      thumbWrap.appendChild(img);
      thumbWrap.onclick = () => this._showLightbox(thumbUrl, false);
    } else {
      const ph = document.createElement("div");
      ph.className = "thumb-sm-ph";
      ph.innerHTML = `<ha-icon icon="mdi:cube-outline"></ha-icon>`;
      thumbWrap.appendChild(ph);
    }
    infoRow.appendChild(thumbWrap);

    const jobInfo = document.createElement("div");
    jobInfo.className = "job-info";
    const jobName = document.createElement("div");
    jobName.className = "job-name";
    const jobId = this._config.job_name_entity;
    jobName.textContent = (jobId && this._hass?.states[jobId]) ? (this._hass.states[jobId].state || "—") : "—";
    jobInfo.appendChild(jobName);

    const timeRow = document.createElement("div");
    timeRow.className = "time-row";
    const elapsedId = this._config.print_time_entity;
    const elapsedAvail = elapsedId && this._hass?.states[elapsedId] && !["unavailable", "unknown"].includes(this._hass.states[elapsedId].state);
    if (elapsedAvail) {
      timeRow.appendChild(this._buildTimeCol("ELAPSED", elapsedId, false));
    } else {
      const layerInfo = this._getLayerInfo();
      timeRow.appendChild(this._buildTimeCol("LAYER", null, false, layerInfo));
    }
    timeRow.appendChild(this._buildTimeCol("REMAINING", this._config.print_time_left_entity, true));
    timeRow.appendChild(this._buildTimeCol("ETA", this._config.eta_entity, true));
    jobInfo.appendChild(timeRow);
    infoRow.appendChild(jobInfo);
    wrap.appendChild(infoRow);

    const progWrap = document.createElement("div");
    progWrap.className = "progress-wrap";
    const track = document.createElement("div"); track.className = "progress-track";
    const fill = document.createElement("div"); fill.className = "progress-fill";
    fill.style.width = this._pct() + "%";
    track.appendChild(fill); progWrap.appendChild(track);
    wrap.appendChild(progWrap);

    const sensorsWrap = document.createElement("div");
    sensorsWrap.className = "print-sensors";
    const grid = document.createElement("div");
    grid.className = "sensor-grid-2";
    [
      this._buildLayerTile(),
      this._buildTile(this._config.print_progress_entity, "mdi:percent"),
      this._buildTile(this._config.bed_temp_entity, "mdi:radiator"),
      this._buildTile(this._config.nozzle_temp_entity, "mdi:printer-3d-nozzle-heat"),
      this._buildTile(this._config.power_sensor_entity, "mdi:lightning-bolt"),
      this._buildTile(this._config.print_time_entity, "mdi:clock-outline"),
      this._buildTile(this._config.print_time_left_entity, "mdi:clock-end"),
      this._buildTile(this._config.eta_entity, "mdi:clock-check-outline"),
    ].forEach(t => { if (t) grid.appendChild(t); });
    if (grid.children.length > 0) { sensorsWrap.appendChild(grid); wrap.appendChild(sensorsWrap); }

    return wrap;
  }

  // ── hui-tile-card factory ─────────────────────────────────
  _buildTile(entityId, fallbackIcon, color) {
    if (!entityId) return null;
    const wrapper = document.createElement("div");
    wrapper.className = `tile-wrap tile-${color}`;
    const stateObj = this._hass?.states[entityId];
    const attrName = stateObj?.attributes?.friendly_name || entityId;
    const cleanName = attrName.includes(' ') ? attrName.split(' ').slice(1).join(' ') : attrName;
    const tile = document.createElement("hui-tile-card");
    tile.setConfig({ type: "tile", entity: entityId, name: cleanName, icon: fallbackIcon,
      color, show_entity_picture: false, tap_action: { action: "more-info" } });
    this._tiles[entityId] = tile;
    wrapper.appendChild(tile);
    return wrapper;
  }

  // ── hui-sensor-card factory ───────────────────────────────
  // The graph SVG renders at 0x0 if hass is set before the card is
  // attached to a laid-out DOM node. Fix:
  //   1. Append card to wrapper immediately (gives it real dimensions)
  //   2. Defer setConfig + hass via whenDefined so the element upgrade
  //      callback has fired and the internal ResizeObserver can measure.
  _buildSensorCard(entityId, icon, color) {
    if (!entityId) return null;
    const wrapper = document.createElement("div");
    wrapper.className = `sensor-card-wrap sensor-${color}`;
    const card = document.createElement("hui-sensor-card");
    // Attach first so layout dimensions are available when graph initialises
    wrapper.appendChild(card);
    this._tiles[entityId] = card;

    customElements.whenDefined("hui-sensor-card").then(() => {
      if (typeof card.setConfig === "function") {
        card.setConfig({
          type: "sensor",
          entity: entityId,
          icon: icon,
          graph: "line",
          hours_to_show: 1,
          tap_action: { action: "more-info" }
        });
      }
      if (this._hass) card.hass = this._hass;
    });

    return wrapper;
  }

  // ── Mushroom layer tile ───────────────────────────────────
  // Uses customElements.whenDefined() to safely defer setConfig
  // until mushroom-template-card is actually registered by HACS.
  _buildLayerTile() {
    const curId = this._config.current_layer_entity;
    if (!curId) return null;
    const totId = this._config.total_layers_entity;
    let secondary = `{% set cur = states('${curId}') %}{% if cur not in ['unavailable','unknown','none'] %}{{ cur }}{% else %}—{% endif %}`;
    if (totId) secondary = `{% set cur = states('${curId}') %}{% set tot = states('${totId}') %}{% if cur not in ['unavailable','unknown','none'] and tot not in ['unavailable','unknown','none'] %}{{ cur }} / {{ tot }}{% else %}—{% endif %}`;

    const tile = document.createElement("mushroom-template-card");
    tile.className = "mushroom-layer-tile";

    const cfg = {
      type: "custom:mushroom-template-card",
      primary: "Layer",
      secondary,
      icon: "mdi:layers-triple",
      layout: "horizontal",
      tap_action: { action: "more-info" },
      entity: curId
    };

    // Defer setConfig until the custom element is actually defined —
    // avoids "tile.setConfig is not a function" when HACS loads late.
    customElements.whenDefined("mushroom-template-card").then(() => {
      if (typeof tile.setConfig === "function") {
        tile.setConfig(cfg);
        if (this._hass) tile.hass = this._hass;
      }
    });

    return tile;
  }

  // ── Time column ───────────────────────────────────────────
  _buildTimeCol(label, entityId, accent, fallbackValue) {
    const wrap = document.createElement("div");
    wrap.style.textAlign = accent ? "right" : "left";
    const l = document.createElement("div"); l.className = "t-label"; l.textContent = label;
    wrap.appendChild(l);
    const v = document.createElement("div");
    v.className = "t-value" + (accent ? " remaining" : "");
    if (entityId && this._hass?.states[entityId]) {
      const state = this._hass.states[entityId].state;
      const unit = this._hass.states[entityId].attributes?.unit_of_measurement || "";
      v.textContent = (state !== "unavailable" && state !== "unknown") ? `${state} ${unit}`.trim() : "—";
    } else if (fallbackValue !== undefined) {
      v.textContent = fallbackValue;
    } else { v.textContent = "—"; }
    wrap.appendChild(v);
    return wrap;
  }

  // ── Layer info helper ─────────────────────────────────────
  _getLayerInfo() {
    const curId = this._config.current_layer_entity;
    const totId = this._config.total_layers_entity;
    if (!curId || !this._hass?.states[curId]) return "—";
    const cur = this._hass.states[curId].state;
    if (cur === "unavailable" || cur === "unknown") return "—";
    if (!totId || !this._hass?.states[totId]) return cur;
    const tot = this._hass.states[totId].state;
    if (tot === "unavailable" || tot === "unknown") return cur;
    return `${cur} / ${tot}`;
  }

  // ── ha-icon-button factory ────────────────────────────────
  _makeIconButton(icon, cssClass, action) {
    const btn = document.createElement("ha-icon-button");
    btn.className = `cam-action-btn ${cssClass}`; btn.dataset.action = action;
    const inner = document.createElement("ha-icon"); inner.setAttribute("icon", icon);
    btn.appendChild(inner);
    btn.addEventListener("click", (e) => { e.stopPropagation(); this._doAction(action); });
    return btn;
  }

  _pct() {
    const id = this._config.print_progress_entity;
    if (!id || !this._hass) return 0;
    return Math.min(parseFloat(this._hass.states[id]?.state) || 0, 100);
  }

  _doAction(action) {
    const c = this._config;
    if (action === "power-on") this._svc("homeassistant", "turn_on", { entity_id: c.power_switch_entity });
    if (action === "power-off") this._svc("homeassistant", "turn_off", { entity_id: c.power_switch_entity });
  }
  _svc(domain, service, data) { if (this._hass) this._hass.callService(domain, service, data); }

  getCardSize() { return 4; }

  // ── CSS ───────────────────────────────────────────────────
  _css() {
    return `
    :host { display: block; }
    * { box-sizing: border-box; }

    ha-card.printer-card-v2 { overflow: hidden; border-radius: var(--ha-card-border-radius, 16px); padding: 0; }

    /* ── HEADER / UNAVAILABLE ────────────────────────────── */
    .view-unavail { display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
    .unavail-icon-el {
      --mdc-icon-size: 24px; color: var(--secondary-text-color);
      width: 40px; height: 40px; background: var(--secondary-background-color, #f5f5f5);
      border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .unavail-printer-image {
      width: 54px; height: 54px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      background: var(--secondary-background-color, #f5f5f5); border-radius: 8px; overflow: hidden;
    }
    .unavail-printer-image img { width: 100%; height: 100%; object-fit: contain; }
    .unavail-name { font-size: .95rem; font-weight: 600; }
    .unavail-sub  { font-size: .78rem; color: var(--secondary-text-color); margin-top: 1px; }
    .power-wrap   { display: flex; align-items: center; gap: 6px; margin-left: auto; }
    .power-label  { font-size: .72rem; font-weight: 600; letter-spacing: .06em;
                    text-transform: uppercase; color: var(--secondary-text-color); }

    /* ── CAMERA ──────────────────────────────────────────── */
    .camera-area {
      position: relative; width: 100%; background: #111;
      line-height: 0; margin: 0; padding: 0; cursor: zoom-in;
    }
    .view-unavail + .camera-area { margin-top: 2px; }
    .no-cam-divider { height: 1px; background: var(--divider-color, rgba(255,255,255,0.1)); }

    .camera-img {
      width: 100%; height: auto; display: block; object-fit: cover;
      aspect-ratio: 16/9; background: #111; margin: 0; padding: 0;
    }
    .camera-no {
      width: 100%; height: 180px; display: flex; align-items: center;
      justify-content: center; background: #1a1a1a; color: #555; gap: 8px; font-size: .85rem;
    }
    .camera-no ha-icon { --mdc-icon-size: 22px; }

    /* ── LIGHTBOX ─────────────────────────────────────────── */
    .lightbox {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.92); z-index: 9999;
      display: none; align-items: center; justify-content: center; cursor: zoom-out;
    }
    .lightbox.active { display: flex; }
    .lightbox img { max-width: 95%; max-height: 95%; border-radius: 8px; box-shadow: 0 0 50px rgba(0,0,0,0.8); object-fit: contain; }
    .lb-video { max-width: 95%; max-height: 95%; border-radius: 8px; box-shadow: 0 0 50px rgba(0,0,0,0.8); background: #000; }

    /* ── LIVE BADGE ───────────────────────────────────────── */
    .live-badge {
      position: absolute; bottom: 10px; left: 12px;
      display: flex; align-items: center; gap: 5px;
      font-size: .72rem; font-weight: 700; color: #fff; letter-spacing: .05em;
    }
    .live-dot { width: 8px; height: 8px; border-radius: 50%; background: #f44336; animation: blink 1.4s ease infinite; }
    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }

    /* ── BUTTONS ──────────────────────────────────────────── */
    .cam-action-btn { --mdc-icon-button-size: 40px; --mdc-icon-size: 20px; border-radius: 50%; }
    .btn-power-on { background: rgba(76,175,80,.15); color: #4caf50; }

    /* ── TILES ────────────────────────────────────────────── */
    .tile-wrap { border-radius: 12px; overflow: hidden; position: relative; }
    .tile-blue hui-tile-card {
      --tile-color: #2196f3; --rgb-tile-color: 33,150,243; --state-color: #2196f3;
      --ha-card-background: rgba(33,150,243,.08); --ha-card-box-shadow: none;
      --ha-card-border-radius: 12px; --primary-text-color: white; --secondary-text-color: #2196f3; margin: 0;
    }
    .tile-blue hui-tile-card .primary, .tile-blue hui-tile-card ha-tile-info .primary { color: white !important; }
    .tile-blue hui-tile-card .state, .tile-blue hui-tile-card .value,
    .tile-blue hui-tile-card .secondary, .tile-blue hui-tile-card ha-tile-info .secondary { color: #2196f3 !important; }

    /* ── SENSOR CARD ────────────────────────────────────────── */
    .sensor-card-wrap { border-radius: 12px; overflow: hidden; display: block; }
    .sensor-blue hui-sensor-card { --card-background: rgba(33,150,243,.08); --icon-color: #2196f3; }
  
    .mushroom-layer-tile { margin: 0; --ha-card-border-radius: 12px; --ha-card-box-shadow: none; --mush-icon-size: 40px; --mush-spacing: 12px; }
    .mushroom-layer-tile ha-card { background: transparent !important; border: none !important; box-shadow: none !important; }

    /* ── IDLE BOTTOM ──────────────────────────────────────── */
    .idle-bottom { padding: 12px 14px 14px; }
    .temp-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }

    /* ── PRINTING BOTTOM ──────────────────────────────────── */
    .print-info-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px 0; }
    .thumb-wrap { width: 54px; height: 54px; border-radius: 8px; overflow: hidden; flex-shrink: 0; cursor: zoom-in; background: var(--secondary-background-color); }
    .thumb-sm { width: 100%; height: 100%; object-fit: cover; display: block; }
    .thumb-sm-ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
    .thumb-sm-ph ha-icon { --mdc-icon-size: 26px; color: var(--secondary-text-color); }
    .job-info { flex: 1; min-width: 0; }
    .job-name { font-size: .9rem; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 4px; }
    .time-row { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; margin-top: 5px; }
    .t-label { font-size: .62rem; text-transform: uppercase; letter-spacing: .06em; color: var(--secondary-text-color); font-weight: 600; white-space: nowrap; }
    .t-value { font-size: .82rem; font-weight: 600; margin-top: 1px; white-space: nowrap; }
    .t-value.remaining { color: #ff6d00; }
    .progress-wrap { padding: 10px 14px 0; }
    .progress-track { height: 6px; border-radius: 6px; background: var(--secondary-background-color, rgba(0,0,0,.08)); overflow: hidden; }
    .progress-fill { height: 100%; border-radius: 6px; background: linear-gradient(90deg,#ff6d00,#ff9800); transition: width .4s ease; }
    .print-sensors { padding: 10px 14px 14px; }
    .sensor-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    `;
  }
}

if (!customElements.get("printer-card-v2")) {
  customElements.define("printer-card-v2", PrinterCardV2);
}

window.customCards = window.customCards || [];
if (!window.customCards.some(c => c.type === "printer-card-v2")) {
  window.customCards.push({
    type: "printer-card-v2",
    name: "3D Printer Card V2",
    description: "Dynamische 3D-Drucker Karte mit nativen HA-Komponenten",
    preview: true,
  });
}