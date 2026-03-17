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
      { name: "printer_status_entity", label: "Drucker-Status Sensor", selector: { entity: {} } },
      {
        name: "printer_image", label: "Drucker-Bild",
        selector: { media: { accept: ["image/*"], clearable: true, image_upload: true, hide_content_type: true } }
      },
      { name: "camera_entity", label: "Kamera", selector: { entity: { domain: "camera" } } },
      {
        type: "expandable", title: "Druckdetail-Einstellungen", icon: "mdi:view-grid",
        schema: [
          { name: "accent_color", label: "Akzentfarbe (während Drucken)", selector: { color_rgb: {} } },
          { name: "job_name_entity", label: "Dateiname / Job-Name Sensor", selector: { entity: { domain: "sensor" } } },
          { name: "thumbnail_entity", label: "Modell-Vorschaubild", selector: { entity: { domain: ["camera", "image"] } } },
          { name: "print_progress_entity", label: "Druckfortschritt (%) Sensor", selector: { entity: { domain: "sensor" } } },
          { name: "bed_temp_entity", label: "Druckbett-Temperatur Sensor", selector: { entity: { domain: "sensor" } } },
          { name: "nozzle_temp_entity", label: "Nozzle-Temperatur Sensor", selector: { entity: { domain: "sensor" } } },
          { name: "current_layer_entity", label: "Aktueller Layer Sensor", selector: { entity: { domain: "sensor" } } },
          { name: "total_layers_entity", label: "Gesamt-Layer Sensor", selector: { entity: { domain: "sensor" } } },
          { name: "print_start_time", label: "Druckstart-Zeit Sensor", selector: { entity: { domain: "sensor" } } },
          { name: "eta_entity", label: "Fertigstellung (ETA) Sensor", selector: { entity: { domain: "sensor" } } },
        ]
      },
      {
        type: "expandable", title: "Power-Control", icon: "mdi:view-grid",
        schema: [
          { name: "power_switch_entity", label: "Spannungsversorgungs-Schalter", selector: { entity: { domain: ["switch", "input_boolean"] } } },
          { name: "power_sensor_entity", label: "Leistungsaufnahme (W) Sensor", selector: { entity: { domain: "sensor", device_class: "power" } } },
        ]
      },
      {
        type: "expandable", title: "Kacheln während Druck anzeigen", icon: "mdi:view-grid",
        schema: [
          { name: "show_tile_layer",     label: "Layer",            selector: { boolean: {} } },
          { name: "show_tile_progress",  label: "Fortschritt %",    selector: { boolean: {} } },
          { name: "show_tile_bed",       label: "Bett-Temperatur",  selector: { boolean: {} } },
          { name: "show_tile_nozzle",    label: "Nozzle-Temperatur",selector: { boolean: {} } },
          { name: "show_tile_power",     label: "Leistung",         selector: { boolean: {} } },
          { name: "show_tile_elapsed",   label: "Bisherige Zeit",   selector: { boolean: {} } },
          { name: "show_tile_eta",       label: "ETA",              selector: { boolean: {} } },
        ]
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
    this._pollInterval = null;
  }

  static getConfigElement() { return document.createElement("printer-card-v2-editor"); }

  static getStubConfig() {
    return { 
      name: "my3D-Printer", 
      printer_status_entity: "", 
      camera_entity: "", 
      power_switch_entity: "", 
      job_name_entity: "", 
      accent_color: [175, 100, 0], 
    };
  }

  set preview(value) {
    if (this._preview !== value) {
      this._preview = value;
      this._render();
    }
  }

  set editMode(value) {
    if (this._editMode !== value) {
      this._editMode = value;
      this._render();
    }
  }

  get _showAllStates() {
    let el = this;
    while (el) {
      if (el.tagName === "HUI-DIALOG-EDIT-CARD") return true;
      el = el.parentElement ||
           (el.getRootNode && el.getRootNode() !== el ? el.getRootNode().host : null);
    }
    return false;
  }


  setConfig(config) {
    this._config = config;
    this._lastStatus = null;
    this._stopPoll();
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    const status = this._status();
    const showAll = this._showAllStates;
    if (status !== this._lastStatus || showAll !== this._lastShowAll) {
      this._lastStatus = status;
      this._lastShowAll = showAll;
      this._render();
    } else {
      this._propagateHass();
    }
  }

  connectedCallback() {
    this._render();
  }

  disconnectedCallback() { this._stopPoll(); }

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

  _status() {
    if (!this._config.printer_status_entity || !this._hass) return "unavailable";
    const stateObj = this._hass.states[this._config.printer_status_entity];
    if (!stateObj) return "unavailable";
    const raw = stateObj.state.toLowerCase();
    if (["unavailable", "unknown", "off", "offline"].includes(raw)) return "unavailable";
    if (raw.includes("print") || raw.includes("running") || raw.includes("working")) return "printing";
    return "idle";
  }

  _propagateHass() {
    if (!this.shadowRoot) return;
    this.shadowRoot.querySelectorAll(
      "hui-tile-card, ha-icon-button, ha-state-label-badge, mushroom-template-card"
    ).forEach(el => { if (el.hass !== this._hass) el.hass = this._hass; });
    this._updateJobName();
    this._updateTimeValues();
    this._updateProgressBar();
    this._updateHeaderSensorStrip();
    this._updateHeaderStatusLabel();
    this.shadowRoot.querySelectorAll("ha-relative-time").forEach(el => {
      el.hass = this._hass;
    });
  }

  _updateHeaderStatusLabel() {
    const subDiv = this.shadowRoot.querySelector(".unavail-sub");
    if (!subDiv) return;
    const statusEntity = this._config.printer_status_entity;
    const realStatus = (statusEntity && this._hass?.states[statusEntity])
      ? this._hass.states[statusEntity].state
      : this._lastStatus || "—";

    let displayStatus = realStatus;
    let powerValueAvailable = false;
    if (this._status() !== "unavailable" && this._config.power_sensor_entity && this._hass?.states[this._config.power_sensor_entity]) {
      const powerState = this._hass.states[this._config.power_sensor_entity];
      if (powerState.state !== "unavailable" && powerState.state !== "unknown") {
        const powerValue = powerState.state;
        const powerUnit = powerState.attributes?.unit_of_measurement || "W";
        displayStatus = `${realStatus} (${powerValue}${powerUnit})`;
        powerValueAvailable = true;
      }
    }

    subDiv.textContent = displayStatus;

    if (powerValueAvailable) {
      if (!subDiv.classList.contains("sub-clickable")) {
        subDiv.classList.add("sub-clickable");
        subDiv.addEventListener("click", (e) => {
          e.stopPropagation();
          this._fireMoreInfo(this._config.power_sensor_entity);
        });
      }
    } else {
      subDiv.classList.remove("sub-clickable");
    }
  }

  _updateHeaderSensorStrip() {
    const strip = this.shadowRoot.querySelector(".header-sensor-strip");
    if (!strip) return;
    strip.querySelectorAll(".header-sensor-col").forEach((col) => {
      const labelEl = col.querySelector(".header-sensor-label");
      const valueEl = col.querySelector(".header-sensor-value");
      if (!labelEl || !valueEl) return;
      const label = labelEl.textContent;
      if (label === "LAYER") {
        valueEl.textContent = this._getLayerInfo();
      } else {
        const idMap = { BED: this._config.bed_temp_entity, NOZ: this._config.nozzle_temp_entity };
        const id = idMap[label];
        if (!id || !this._hass?.states[id]) return;
        const s = this._hass.states[id];
        const val = s.state;
        const unit = s.attributes?.unit_of_measurement || "";
        valueEl.textContent = (val !== "unavailable" && val !== "unknown") ? `${val}${unit}` : "—";
      }
    });
  }

  _updateJobName() {
    const el = this.shadowRoot.querySelector(".job-name");
    if (!el) return;
    const id = this._config.job_name_entity;
    el.textContent = (id && this._hass?.states[id]) ? (this._hass.states[id].state || "—") : "—";
  }

  _updateTimeValues() {
    const updateCompound = (wrapClass, entityId) => {
      const wrap = this.shadowRoot.querySelector(`.${wrapClass}`);
      if (!wrap) return;
      if (!entityId || !this._hass?.states[entityId]) return;
      const state = this._hass.states[entityId].state;
      if (!state || state === "unavailable" || state === "unknown") return;
      const date = new Date(state);
      const timeSpan = wrap.querySelector(".t-time");
      if (timeSpan) timeSpan.textContent = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const relTime = wrap.querySelector("ha-relative-time");
      if (relTime) { relTime.datetime = date; relTime.hass = this._hass; }
    };

    updateCompound("t-compound-elapsed", this._config.print_start_time);
    updateCompound("t-compound-eta",     this._config.eta_entity);
  }

  _updateProgressBar() {
    const fill = this.shadowRoot.querySelector(".progress-fill");
    if (fill) fill.style.width = this._pct() + "%";
    const pct = this.shadowRoot.querySelector(".progress-pct");
    if (pct) pct.textContent = this._pct() + "%";
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
    lb.addEventListener("click", () => {
      const v = lb.querySelector("video");
      if (v) v.src = "";
      lb.classList.remove("active");
    }, { passive: true });
    lb.classList.add("active");
  }

  _render() {
    if (!this._hass) return;
    const sr = this.shadowRoot;

    sr.innerHTML = `<style>${this._css()}</style>`;

    const lb = document.createElement("div");
    lb.id = "lightbox";
    lb.className = "lightbox";
    sr.appendChild(lb);

    if (this._showAllStates) {
      this._renderPreview(sr);
    } else {
      this._renderNormal(sr);
    }

    this._propagateHass();
  }

  _renderPreview(sr) {
    const views = [
      { label: "Unavailable", build: () => {
        const card = document.createElement("ha-card");
        card.className = "printer-card-v2";
        card.appendChild(this._buildUnavail());
        return card;
      }},
      { label: "Idle", build: () => {
        const card = document.createElement("ha-card");
        card.className = "printer-card-v2";
        card.appendChild(this._buildHeader("idle"));
        if (this._config.camera_entity) {
          card.appendChild(this._buildCameraArea());
        } else {
          const divider = document.createElement("div");
          divider.className = "no-cam-divider";
          card.appendChild(divider);
        }
        const bottom = this._buildIdleBottom();
        if (bottom) card.appendChild(bottom);
        return card;
      }},
      { label: "Printing", build: () => {
        const card = document.createElement("ha-card");
        card.className = "printer-card-v2";
        card.appendChild(this._buildHeader("printing"));
        if (this._config.camera_entity) {
          card.appendChild(this._buildCameraArea());
        } else {
          const divider = document.createElement("div");
          divider.className = "no-cam-divider";
          card.appendChild(divider);
        }
        const bottom = this._buildPrintingBottom();
        if (bottom) card.appendChild(bottom);
        return card;
      }},
    ];

    const wrapper = document.createElement("div");
    wrapper.className = "preview-stack";

    views.forEach(({ label, build }) => {
      const section = document.createElement("div");
      section.className = "preview-section";

      const chip = document.createElement("div");
      chip.className = "preview-chip";
      chip.textContent = label;
      section.appendChild(chip);

      section.appendChild(build());
      wrapper.appendChild(section);
    });

    sr.appendChild(wrapper);
  }

  _renderNormal(sr) {
    const status = this._lastStatus || this._status();
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
  }

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
    powerWrap.innerHTML = `<span class="power-label">POWER ON -></span>`;
    powerWrap.appendChild(this._makeIconButton("mdi:power", "btn-power-on", "power-on"));
    wrap.appendChild(text);
    wrap.appendChild(powerWrap);
    return wrap;
  }

  _buildHeaderSensorStrip() {
    const layerInfo = this._getLayerInfo();
    const items = [
      ...(layerInfo !== "—" ? [{ label: "LAYER", id: null, value: layerInfo }] : []),
      { label: "BED",   id: this._config.bed_temp_entity },
      { label: "NOZ",   id: this._config.nozzle_temp_entity },
    ].filter(i => (i.id && this._hass?.states[i.id]) || i.value !== undefined);

    if (items.length === 0) return null;

    const strip = document.createElement("div");
    strip.className = "header-sensor-strip";

    items.forEach((item, idx) => {
      if (idx > 0) {
        const div = document.createElement("div");
        div.className = "header-sensor-divider";
        strip.appendChild(div);
      }
      const col = document.createElement("div");
      col.className = "header-sensor-col";

      const label = document.createElement("div");
      label.className = "header-sensor-label";
      label.textContent = item.label;

      const value = document.createElement("div");
      value.className = "header-sensor-value";
      if (item.value !== undefined) {
        value.textContent = item.value;
      } else {
        const stateObj = this._hass.states[item.id];
        const val = stateObj.state;
        const unit = stateObj.attributes?.unit_of_measurement || "";
        value.textContent = (val !== "unavailable" && val !== "unknown") ? `${val}${unit}` : "—";
      }

      col.appendChild(label);
      col.appendChild(value);
      strip.appendChild(col);
    });

    return strip;
  }

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
    const realStatus = (statusEntity && this._hass?.states[statusEntity])
      ? this._hass.states[statusEntity].state
      : (status === "printing" ? "Printing" : "Idle");

    const text = document.createElement("div");

    const nameDiv = document.createElement("div");
    nameDiv.className = "unavail-name";
    nameDiv.textContent = this._config.name || "3D-Drucker";
    text.appendChild(nameDiv);

    const subDiv = document.createElement("div");
    subDiv.className = "unavail-sub";
    subDiv.textContent = realStatus;

    text.appendChild(subDiv);
    wrap.appendChild(text);

    if (status === "printing") {
      const strip = this._buildHeaderSensorStrip();
      if (strip) wrap.appendChild(strip);
    } else {
      const powerWrap = document.createElement("div");
      powerWrap.className = "power-wrap";
      powerWrap.innerHTML = `<span class="power-label">POWER OFF -></span>`;
      powerWrap.appendChild(this._makeIconButton("mdi:power", "btn-power-off", "power-off"));
      wrap.appendChild(powerWrap);
    }

    return wrap;
  }

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

    wrap.addEventListener("click", () => this._showLightbox(mjpegUrl, false), { passive: true });

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
      const snapUrl = `/api/camera_proxy/${camId}${tokenParam}&t=${Date.now()}`;
      const img = document.createElement("img");
      img.className = "camera-img"; img.alt = "Kamera"; img.src = snapUrl;
      wrap.insertBefore(img, wrap.querySelector(".live-badge"));
      wrap.addEventListener("click", () => {
        const freshSnap = `/api/camera_proxy/${camId}${tokenParam}&t=${Date.now()}`;
        this._showLightbox(freshSnap, false);
      }, { passive: true });
      this._startPoll();
    };

    video.src = hlsUrl;
    wrap.insertBefore(video, wrap.querySelector(".live-badge"));
    wrap.addEventListener("click", () => this._showLightbox(hlsUrl, true), { passive: true });
  }

  _cameraPlaceholder() {
    const d = document.createElement("div");
    d.className = "camera-no";
    d.innerHTML = `<ha-icon icon="mdi:camera-off"></ha-icon> Kein Kamerabild`;
    return d;
  }

  _buildIdleBottom() {
    const wrap = document.createElement("div");
    wrap.className = "idle-bottom";
    const tempRow = document.createElement("div");
    tempRow.className = "temp-row";
    const bedTile = this._buildTile(this._config.bed_temp_entity, "mdi:radiator");
    const nozzleTile = this._buildTile(this._config.nozzle_temp_entity, "mdi:printer-3d-nozzle-heat");

    if (bedTile) tempRow.appendChild(bedTile);
    if (nozzleTile) tempRow.appendChild(nozzleTile);
    if (tempRow.children.length > 0) {
      tempRow.style.gridTemplateColumns = `repeat(${tempRow.children.length}, 1fr)`;
      wrap.appendChild(tempRow);
      return wrap;
    }
    return null;
  }

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
      thumbWrap.addEventListener("click", () => this._showLightbox(thumbUrl, false), { passive: true });
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
    jobName.textContent = this._showAllStates ? "benchy_v3_final_FINAL.gcode" : ((jobId && this._hass?.states[jobId]) ? (this._hass.states[jobId].state || "—") : "—");
    jobInfo.appendChild(jobName);

    const timeRow = document.createElement("div");
    timeRow.className = "time-row";
    if (this._showAllStates) {
      timeRow.appendChild(this._buildTimeCol("START-TIME", null, false, "2 hours ago"));
      timeRow.appendChild(this._buildTimeCol("ETA", null, true, "in 47 minutes"));
    } else {
      timeRow.appendChild(this._buildTimeCol("START-TIME", this._config.print_start_time, false));
      timeRow.appendChild(this._buildTimeCol("ETA", this._config.eta_entity, true));
    }
    jobInfo.appendChild(timeRow);
    infoRow.appendChild(jobInfo);
    wrap.appendChild(infoRow);

    const progWrap = document.createElement("div");
    progWrap.className = "progress-wrap";
    const progHeader = document.createElement("div");
    progHeader.className = "progress-header";
    const progLabel = document.createElement("span");
    progLabel.className = "progress-label";
    progLabel.textContent = "Progress";
    const progPct = document.createElement("span");
    progPct.className = "progress-pct";
    progPct.textContent = this._pct() + "%";
    progHeader.appendChild(progLabel);
    progHeader.appendChild(progPct);
    progWrap.appendChild(progHeader);
    const track = document.createElement("div"); track.className = "progress-track";
    const fill = document.createElement("div"); fill.className = "progress-fill";
    fill.style.width = this._pct() + "%";
    track.appendChild(fill); progWrap.appendChild(track);
    wrap.appendChild(progWrap);

    const sensorsWrap = document.createElement("div");
    sensorsWrap.className = "print-sensors";
    const grid = document.createElement("div");
    grid.className = "sensor-grid-2";
    const show = (flag) => this._config[flag] !== false;
    [
      show("show_tile_layer")     ? this._buildLayerTile() : null,
      show("show_tile_progress")  ? this._buildTile(this._config.print_progress_entity,  "mdi:percent") : null,
      show("show_tile_bed")       ? this._buildTile(this._config.bed_temp_entity,         "mdi:radiator") : null,
      show("show_tile_nozzle")    ? this._buildTile(this._config.nozzle_temp_entity,      "mdi:printer-3d-nozzle-heat") : null,
      show("show_tile_power")     ? this._buildTile(this._config.power_sensor_entity,     "mdi:lightning-bolt") : null,
      show("show_tile_elapsed")   ? this._buildTile(this._config.print_start_time,        "mdi:clock-outline") : null,
      show("show_tile_eta")       ? this._buildTile(this._config.eta_entity,              "mdi:clock-check-outline") : null,
    ].forEach(t => { if (t) grid.appendChild(t); });
    if (grid.children.length > 0) { sensorsWrap.appendChild(grid); wrap.appendChild(sensorsWrap); }

    return wrap;
  }

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
    wrapper.appendChild(tile);
    return wrapper;
  }

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
      icon_color: this._accentColor(),
      layout: "horizontal",
      tap_action: { action: "more-info" },
      entity: curId
    };

    customElements.whenDefined("mushroom-template-card").then(() => {
      if (typeof tile.setConfig === "function") {
        tile.setConfig(cfg);
        if (this._hass) tile.hass = this._hass;
      }
    });

    return tile;
  }

  _buildTimeCol(label, entityId, accent, fallbackValue) {
    const wrap = document.createElement("div");
    wrap.style.textAlign = accent ? "right" : "left";
    wrap.style.justifySelf = accent ? "end" : "start";
    const l = document.createElement("div"); l.className = "t-label"; l.textContent = label;
    wrap.appendChild(l);

    const useRelativeTime = (label === "START-TIME" || label === "ETA");

    if (useRelativeTime && entityId && this._hass?.states[entityId]) {
      const state = this._hass.states[entityId].state;
      if (state && state !== "unavailable" && state !== "unknown") {
        const date = new Date(state);
        const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

        const valueWrap = document.createElement("div");
        valueWrap.className = "t-value t-value-compound accent";
        if (accent) valueWrap.classList.add("remaining");
        valueWrap.classList.add(label === "START-TIME" ? "t-compound-elapsed" : "t-compound-eta");

        const timeSpan = document.createElement("span");
        timeSpan.className = "t-time";
        timeSpan.textContent = timeStr;

        const relTime = document.createElement("ha-relative-time");
        relTime.className = "t-rel-inline";
        relTime.hass = this._hass;
        relTime.datetime = date;
        relTime.capitalize = false;

        valueWrap.appendChild(timeSpan);
        valueWrap.appendChild(document.createTextNode(" ("));
        valueWrap.appendChild(relTime);
        valueWrap.appendChild(document.createTextNode(")"));
        wrap.appendChild(valueWrap);
        return wrap;
      }
    }

    // Plain text fallback when entity unavailable or unknown
    const v = document.createElement("div");
    v.className = "t-value accent" + (accent ? " remaining" : "");

    if (entityId && this._hass?.states[entityId]) {
      const state = this._hass.states[entityId].state;
      const unit = this._hass.states[entityId].attributes?.unit_of_measurement || "";
      v.textContent = (state !== "unavailable" && state !== "unknown") ? `${state} ${unit}`.trim() : "—";
    } else if (fallbackValue !== undefined) {
      v.textContent = fallbackValue;
    } else {
      v.textContent = "—";
    }

    wrap.appendChild(v);
    return wrap;
  }

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

  _makeIconButton(icon, cssClass, action) {
    const btn = document.createElement("ha-icon-button");
    btn.className = `cam-action-btn ${cssClass}`;
    
    // Setze das Icon nicht über den Slot, sondern direkt als Attribut, 
    // falls die Version von HA dies unterstützt:
    btn.setAttribute("icon", icon); 
    
    btn.addEventListener("click", (e) => { 
      e.stopPropagation(); 
      this._doAction(action); 
    });
    return btn;
  }

  _pct() {
    if (this._showAllStates) return 63;
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

  _fireMoreInfo(entityId) {
    const event = new CustomEvent("hass-more-info", {
      bubbles: true,
      composed: true,
      detail: { entityId },
    });
    this.dispatchEvent(event);
  }

  getCardSize() { return 4; }

  _accentColor() {
    const v = this._config.accent_color;
    if (!v) return "#ff6d00";
    if (Array.isArray(v) && v.length === 3) return `rgb(${v[0]},${v[1]},${v[2]})`;
    return v;
  }

  _css() {
    const accent = this._accentColor();
    return `
    :host { display: block; --accent: ${accent}; }
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
    .unavail-sub  { font-size: .78rem; color: ${accent}; margin-top: 1px; }
    .unavail-sub.sub-clickable { cursor: pointer; }
    .unavail-sub.sub-clickable:hover { opacity: 0.75; }
    .power-wrap   { display: flex; align-items: center; gap: 6px; margin-left: auto; }
    .power-label  { font-size: .72rem; font-weight: 600; letter-spacing: .06em;
                    text-transform: uppercase; color: var(--secondary-text-color); }

    /* ── HEADER SENSOR STRIP ─────────────────────────────── */
    .header-sensor-strip {
      display: flex; align-items: stretch; gap: 0; margin-left: auto;
      background: var(--secondary-background-color, rgba(0,0,0,.05));
      border-radius: 10px; padding: 6px 4px; flex-shrink: 0;
    }
    .header-sensor-col {
      display: flex; flex-direction: column; align-items: center;
      padding: 0 10px; min-width: 48px;
    }
    .header-sensor-divider {
      width: 1px; background: var(--divider-color, rgba(128,128,128,.25));
      align-self: stretch; margin: 2px 0;
    }
    .header-sensor-label {
      font-size: .6rem; font-weight: 700; letter-spacing: .07em;
      text-transform: uppercase; color: var(--secondary-text-color);
    }
    .header-sensor-value {
      font-size: .9rem; font-weight: 700; color: ${accent};
      margin-top: 1px; white-space: nowrap;
    }

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
    .cam-action-btn { --mdc-icon-button-size: 40px; --mdc-icon-size: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center;}
    .btn-power-on  { background: rgba(76,175,80,.15); color: #4caf50; }
    .btn-power-off { background: rgba(244,67,54,.15); color: #f44336; }

    /* ── TILES ────────────────────────────────────────────── */
    .tile-wrap { border-radius: 12px; overflow: hidden; position: relative; }

    /* ── TILE ICON ACCENT COLOR ───────────────────────────── */
    .tile-wrap hui-tile-card {
      --tile-color: ${accent};
      --state-icon-color: ${accent};
    }
    .tile-wrap hui-tile-card ha-tile-icon,
    .tile-wrap hui-tile-card ha-tile-icon ha-state-icon,
    .tile-wrap hui-tile-card ha-tile-icon ha-icon,
    .tile-wrap hui-tile-card ha-tile-icon .icon {
      color: ${accent} !important;
      --mdc-icon-color: ${accent};
    }

    .mushroom-layer-tile { margin: 0; --ha-card-border-radius: 12px; --ha-card-box-shadow: none; --mush-icon-size: 40px; --mush-spacing: 12px; }
    .mushroom-layer-tile ha-card { background: transparent !important; border: none !important; box-shadow: none !important; }
    .mushroom-layer-tile { --mush-rgb-state-color: ${accent}; }
    .mushroom-layer-tile [slot="secondary"], .mushroom-layer-tile .secondary { color: ${accent} !important; }

    /* ── IDLE BOTTOM ──────────────────────────────────────── */
    .idle-bottom { padding: 12px 14px 14px; }
    .temp-row { display: grid; gap: 8px; }

    /* ── PRINTING BOTTOM ──────────────────────────────────── */
    .print-info-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px 0; }
    .thumb-wrap { width: 54px; height: 54px; border-radius: 8px; overflow: hidden; flex-shrink: 0; cursor: zoom-in; background: var(--secondary-background-color); }
    .thumb-sm { width: 100%; height: 100%; object-fit: cover; display: block; }
    .thumb-sm-ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
    .thumb-sm-ph ha-icon { --mdc-icon-size: 26px; color: var(--secondary-text-color); }
    .job-info { flex: 1; min-width: 0; }
    .job-name { font-size: .9rem; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 4px; }
    .time-row { display: grid; grid-template-columns: repeat(2,1fr); gap: 8px; margin-top: 5px; }
    .t-label { font-size: .62rem; text-transform: uppercase; letter-spacing: .06em; color: var(--secondary-text-color); font-weight: 600; white-space: nowrap; }
    .t-value { font-size: .82rem; font-weight: 600; margin-top: 1px; white-space: nowrap; }
    .t-value.accent { color: ${accent}; }
    .t-value-compound { display: flex; align-items: baseline; flex-wrap: wrap; gap: 0; white-space: normal; }
    .t-value-compound.accent { color: ${accent}; }
    .t-time { font-weight: 700; }
    .ha-relative-time.t-rel-inline { display: inline; font-size: inherit; font-weight: inherit; color: ${accent}; }
    .progress-wrap { padding: 10px 14px 14px; }
    .progress-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 5px; }
    .progress-label { font-size: .72rem; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: var(--secondary-text-color); }
    .progress-pct { font-size: .82rem; font-weight: 700; color: ${accent}; }
    .progress-track { height: 6px; border-radius: 6px; background: var(--secondary-background-color, rgba(0,0,0,.08)); overflow: hidden; }
    .progress-fill { height: 100%; border-radius: 6px; background: ${accent}; transition: width .4s ease; }
    .print-sensors { padding: 0 14px 14px; }
    .sensor-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

    /* ── PREVIEW STACK ────────────────────────────────────── */
    .preview-stack { display: flex; flex-direction: column; gap: 16px; padding: 12px; }
    .preview-section { display: flex; flex-direction: column; gap: 6px; }
    .preview-chip {
      display: inline-block; align-self: flex-start;
      font-size: .65rem; font-weight: 700; letter-spacing: .07em; text-transform: uppercase;
      color: var(--secondary-text-color);
      background: var(--secondary-background-color, rgba(0,0,0,.06));
      border-radius: 6px; padding: 3px 8px;
    }
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