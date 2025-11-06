// public/js/devices.js
// Vollständige Datei – Filter + Sortierung + Netzwerkfelder (has_network) + Kauf/Preis/Garantie + Raum-Historie

// ----------------------------------------------------
// Kleinere Utilities
// ----------------------------------------------------
function getValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : null;
}
function setValue(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.type === "date") {
    if (!val) {
      el.value = "";
      return;
    }
    const s = String(val);
    // ISO oder ISO mit Zeit -> sauber schneiden
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      el.value = s.slice(0, 10);
      return;
    }
    // Fallback: Date-parsing und ISO-Tag
    const d = new Date(s);
    el.value = isNaN(d) ? "" : d.toISOString().slice(0, 10);
  } else {
    el.value = val ?? "";
  }
}
function show(elOrId) {
  const el =
    typeof elOrId === "string" ? document.getElementById(elOrId) : elOrId;
  el && el.classList.remove("d-none");
}
function hide(elOrId) {
  const el =
    typeof elOrId === "string" ? document.getElementById(elOrId) : elOrId;
  el && el.classList.add("d-none");
}
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function escapeAttr(s) {
  return escapeHtml(s).replaceAll("\n", " ");
}
function eurosToCents(eurosStr) {
  if (eurosStr === null || eurosStr === undefined || eurosStr === "")
    return null;

  const s = eurosStr.toString().trim();
  let normalized;

  if (s.includes(',')) {
    // Annahme: Deutsches Format ("1.461,22" oder "1461,22")
    // 1. Tausenderpunkte entfernen
    // 2. Komma durch Punkt ersetzen
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else {
    // Annahme: US/Code-Format ("1461.22" oder "1461")
    // (Keine Kommas vorhanden, Punkt ist das Dezimaltrennzeichen)
    // Wir müssen nichts ersetzen.
    normalized = s;
  }

  const n = Number(normalized);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100);
}

function centsToEurosStr(cents) {
  if (cents === null || cents === undefined) return "";
  const n = Number(cents);
  if (Number.isNaN(n)) return "";
  return (n / 100).toFixed(2);
}

/**
 * NEU: Hilfsfunktion zur Formatierung von ISO-Daten (YYYY-MM-DD)
 * @param {string} isoDate - z.B. "2025-11-05"
 * @returns {string} - z.B. "05.11.2025" oder ""
 */
function formatDate(isoDate) {
  if (!isoDate || !String(isoDate).includes("-")) return "";
  
  // Schneidet Zeit (z.B. "T10:00:00") ab, falls vorhanden
  const datePart = isoDate.slice(0, 10); 
  const parts = datePart.split('-'); // [YYYY, MM, DD]

  if (parts.length !== 3 || parts[0].length < 4) return ""; // Ungültig
  
  const [y, m, d] = parts;
  if (!y || !m || !d) return "";

  return `${d}.${m}.${y}`;
}

/**
 * Formatiert eine MAC-Adresse in das Standard-Format (AA:BB:...).
 * @param {string} s - Der Eingabe-String.
 * @returns {string|null} Die formatierte MAC oder null, wenn leer oder ungültig.
 */
window.formatMacAddress = function(s) {
    if (!s) return null;

    // 1. Entferne alle gängigen Trennzeichen und konvertiere zu Großbuchstaben
    const cleaned = String(s).replace(/[:\-.\s]/g, "").toUpperCase();

    // 2. Prüfe, ob es ein gültiger 12-stelliger Hex-String ist
    if (cleaned.length === 12 && /^[0-9A-F]{12}$/.test(cleaned)) {
        // 3. Füge Doppelpunkte ein
        // "AABBCCDDEEFF" -> ["AA", "BB", "CC", "DD", "EE", "FF"] -> "AA:BB:CC:DD:EE:FF"
        return cleaned.match(/.{1,2}/g).join(":");
    }
    
    // 4. Ungültige oder unvollständige Eingaben (z.B. "abc" oder "AA:BB")
    // werden als null gespeichert, um die Datenhygiene zu wahren.
    return null;
}

// apiFetch (ersetze die komplette Funktion)
if (typeof apiFetch === "undefined") {
  window.apiFetch = async function (url, options = {}) {
    const token = localStorage.getItem("jwtToken");
    const defaultHeaders = { "Content-Type": "application/json" };
    if (token) {
      defaultHeaders["Authorization"] = "Bearer " + token;
    }
    const headers = { ...defaultHeaders, ...options.headers }; // Merge headers

    // Ensure body is stringified if it's an object and Content-Type is JSON
    let body = options.body;
    if (
      body &&
      typeof body !== "string" &&
      headers["Content-Type"] === "application/json"
    ) {
      body = JSON.stringify(body);
    }

    const response = await fetch(url, { ...options, headers, body }); // Use potentially stringified body

    if (response.status === 401 || response.status === 403) {
      window.location.href = "/login"; // Redirect on Auth error
      throw new Error(
        "Session abgelaufen oder keine Berechtigung. Bitte neu anmelden.",
      );
    }

    if (!response.ok) {
      const contentType = response.headers.get("content-type") || "";
      let errorMessage = `API Fehler (${response.status}): ${response.statusText}`; // Default
      let detailError = ""; // For specific DB error

      try {
        if (contentType.includes("application/json")) {
          const errorJson = await response.json();
          // *** HIER DIE KORREKTUR: Prüfe message UND error ***
          errorMessage = errorJson.message || errorMessage; // Nimm die Hauptmeldung
          detailError = errorJson.error || ""; // Nimm die Detailmeldung (DB-Fehler)
          if (detailError) {
            errorMessage += ` (${detailError})`; // Füge Detail an, wenn vorhanden
          }
          // *** ENDE KORREKTUR ***
        } else {
          const errorText = await response.text();
          const strippedText = errorText.replace(/<[^>]*>/g, "").trim(); // Remove HTML tags
          if (strippedText) {
            errorMessage =
              strippedText.substring(0, 200) +
              (strippedText.length > 200 ? "..." : ""); // Shorten
          }
        }
      } catch (parseError) {
        console.error("Fehler beim Parsen der API-Fehlerantwort:", parseError);
        // Fallback, falls das Parsen der Fehlermeldung selbst fehlschlägt
        try {
          const fallbackText = await response.text();
          errorMessage =
            fallbackText.substring(0, 200) +
            (fallbackText.length > 200 ? "..." : "");
        } catch {
          /* Ignore further errors */
        }
      }
      throw new Error(errorMessage);
    }

    // Handle successful response (No Content or JSON)
    if (response.status === 204) {
      // No Content -> return null or {} ?
      return null;
    }
    const responseContentType = response.headers.get("content-type") || "";
    if (responseContentType.includes("application/json")) {
      return response.json();
    } else {
      return response.text(); // Return text for non-JSON responses
    }
  };
}

// ... (Rest von public/js/devices.js bleibt gleich) ...
// ----------------------------------------------------
let __sort = { col: "category_name", dir: "asc" };
let __filters = { category_id: "", model_id: "", room_id: "", status: "active", q: "" };

let devicesCache = []; // aktuell geladene Geräte
let modelCache = {}; // model_id -> Model (inkl. has_network)
let roomCache = []; // Räume für Filter & Historie
let categoryCache = []; // Kategorien für Filter

// ----------------------------------------------------
// Initialisierung
// ----------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {

  // HIER: Die Bedingung einfügen
  if (document.getElementById('devices-table-body')) {

  await Promise.all([loadFilterOptions(), loadModels()]);
  bindFilterEvents();
  bindSortEvents();
  bindFormSubmit();
  bindRoomHistoryEvents();
  bindModelChangeForNetworkFields();

// --- NEU: Globale Suche ---
  const searchInput = document.getElementById("filter-search-q");
  const searchClearBtn = document.getElementById("filter-search-clear-btn");

  if (searchInput && searchClearBtn) {
    // Debounce-Funktion (verhindert API-Aufrufe bei jedem Tastendruck)
    let debounceTimer;
    const debounce = (func, delay) => {
      return (...args) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => func.apply(this, args), delay);
      };
    };

    // Debounced Such-Handler
    const handleSearch = debounce(() => {
      __filters.q = searchInput.value;
      loadDevices();
    }, 300); // 300ms Verzögerung

    // Event-Listener
    searchInput.addEventListener("input", handleSearch);

    searchClearBtn.addEventListener("click", () => {
      searchInput.value = "";
      __filters.q = "";
      loadDevices();
      searchInput.focus();
    });
  }
  


  // Button "Neues Gerät"
  const btnNew = document.getElementById("btnNewDevice");
  if (btnNew) {
    btnNew.addEventListener("click", () => {
      // leeres Modal öffnen
      openEditModal(null, {
        device_id: null,
        serial_number: "",
        inventory_number: "",
        notes: "",
        purchase_date: "",
        price_cents: null,
        warranty_months: null,
        added_at: "",
        decommissioned_at: "",
        last_cleaned: "",
        last_inspected: "",
      });
    });
  }

  await loadDevices();
  }
});

// ----------------------------------------------------
// Filter-Optionen laden
// ----------------------------------------------------
async function loadFilterOptions() {
  // Kategorien
  categoryCache = await apiFetch("/api/master-data/device_categories");
  const fCat = document.getElementById("filter-category");
  if (fCat) {
    fCat.innerHTML =
      '<option value="">Alle</option>' +
      categoryCache
        .map(
          (c) =>
            `<option value="${c.category_id}">${escapeHtml(c.category_name)}</option>`,
        )
        .join("");
  }

  // Modelle (mit Kategorie-Label)
  const models = await apiFetch("/api/master-data/models_with_details"); // enthält category_name & has_network
  const fModel = document.getElementById("filter-model");
  if (fModel) {
    fModel.innerHTML =
      '<option value="">Alle</option>' +
      models
        .map((m) => {
          const cat = m.category_name || "-";
          const label = m.model_name + " (" + m.model_number + ")" || m.model_number || "Unbekannt";
          return `<option value="${m.model_id}">[${escapeHtml(cat)}] ${escapeHtml(label)}</option>`;
        })
        .join("");
  }

  // Räume
  roomCache = await apiFetch("/api/master-data/rooms"); // room_id, room_number, room_name
  const bulkRoom = document.getElementById("bulk-room");
  if (bulkRoom) {
    bulkRoom.innerHTML = roomCache
      .map((r) => {
        const label =
          (r.room_number ? `${r.room_number} — ` : "") +
          (r.room_name || `Raum ${r.room_id}`);
        return `<option value="${r.room_id}">${escapeHtml(label)}</option>`;
      })
      .join("");
  }
  const fRoom = document.getElementById("filter-room");
  if (fRoom) {
    fRoom.innerHTML =
      '<option value="">Alle</option>' +
      roomCache
        .map((r) => {
          const label =
            (r.room_number ? `${r.room_number} — ` : "") +
            (r.room_name || `Raum ${r.room_id}`);
          return `<option value="${r.room_id}">${escapeHtml(label)}</option>`;
        })
        .join("");
  }
}

// ----------------------------------------------------
// Modelle in Cache laden (für has_network & Modal)
// ----------------------------------------------------
async function loadModels() {
  const models = await apiFetch("/api/master-data/models_with_details");
  modelCache = {};
  models.forEach((m) => {
    modelCache[m.model_id] = m;
  });
}

// ----------------------------------------------------
// Filter- & Sort-Events
// ----------------------------------------------------
function bindFilterEvents() {
  ["filter-category", "filter-model", "filter-room", "filter-status"].forEach(
    (id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", () => {
        __filters.category_id = getValue("filter-category") || "";
        __filters.model_id = getValue("filter-model") || "";
        __filters.room_id = getValue("filter-room") || "";
        __filters.status = getValue("filter-status") || "active"; // 'active' ist jetzt default = (außer Ausgeschieden)
        loadDevices();
      });
    },
  );
}
function bindSortEvents() {
  document.querySelectorAll("th.sortable-header").forEach((th) => {
    th.style.cursor = "pointer";
    // ERSETZE DEN KOMPLETTEN 'click'-LISTENER:
    th.addEventListener("click", () => {
      const col = th.getAttribute("data-sort");
      if (!col) return;

      // NEUE Logik für "Raum" (data-sort="room")
      if (col === "room") {
        if (__sort.col === "room_number") {
          if (__sort.dir === "asc") {
            // 1. num asc -> 2. num desc
            __sort.dir = "desc";
          } else {
            // 2. num desc -> 3. name asc
            __sort.col = "room_name";
            __sort.dir = "asc";
          }
        } else if (__sort.col === "room_name") {
          if (__sort.dir === "asc") {
            // 3. name asc -> 4. name desc
            __sort.dir = "desc";
          } else {
            // 4. name desc -> 1. num asc
            __sort.col = "room_number";
            __sort.dir = "asc";
          }
        } else {
          // War nicht nach Raum sortiert -> Starte mit 1. num asc
          __sort.col = "room_number";
          __sort.dir = "asc";
        }
      }
      // ALTE Logik für alle anderen Spalten
      else {
        if (__sort.col === col) {
          __sort.dir = __sort.dir === "asc" ? "desc" : "asc";
        } else {
          __sort.col = col;
          __sort.dir = "asc";
        }
      }
      loadDevices();
    });
  });
}
/**
 * NEU: Hilfsfunktion zum Setzen der CSS-Klassen für Sortier-Pfeile
 */
function updateSortIndicators() {
  const table = document.querySelector("#devices-table-body").closest('table');
  if (!table) return;

  // Globale Sortiervariablen von devices.js lesen
  const currentSortCol = __sort.col;
  const currentSortDir = __sort.dir;

  table.querySelectorAll(".sortable-header").forEach((header) => {
    header.classList.remove("sort-asc", "sort-desc");
    const headerSortKey = header.dataset.sort;

    // Spezialfall "Raum": data-sort="room"
    // Die Spalte ist aktiv, wenn nach 'room_number' ODER 'room_name' sortiert wird
    if (headerSortKey === "room") {
      if (currentSortCol === "room_number" || currentSortCol === "room_name") {
        header.classList.add(currentSortDir === "asc" ? "sort-asc" : "sort-desc");
      }
    } 
    // Normalfall: data-sort="category_name" === currentSortCol
    else if (headerSortKey === currentSortCol) {
      header.classList.add(currentSortDir === "asc" ? "sort-asc" : "sort-desc");
    }
  });

  // Standard-Pfeil setzen (Kategorie), falls nichts anderes aktiv ist
  // (Basierend auf der Standard-Sortierung in r_devices.js)
  if (!currentSortCol || currentSortCol === 'category_name') {
      const defaultHeader = table.querySelector('[data-sort="category_name"]');
      if (defaultHeader && !defaultHeader.classList.contains('sort-asc') && !defaultHeader.classList.contains('sort-desc')) {
          defaultHeader.classList.add(currentSortDir === "asc" ? "sort-asc" : "sort-desc");
      }
  }
}

// ----------------------------------------------------
// Geräte-Liste laden & rendern (mit Filtern + Sortierparametern)
// ----------------------------------------------------
async function loadDevices() {
  updateSortIndicators(); // Sortier-Indikatoren aktualisieren
  const tbody = document.getElementById("devices-table-body");
  if (!tbody) return;
  tbody.innerHTML =
    '<tr><td colspan="11" class="text-center">Lade Geräte…</td></tr>';

  const params = new URLSearchParams();
  if (__filters.category_id) params.set("category_id", __filters.category_id);
  if (__filters.model_id) params.set("model_id", __filters.model_id);
  if (__filters.room_id) params.set("room_id", __filters.room_id);
  if (__filters.status) params.set("status", __filters.status);
  if (__filters.q) params.set("q", __filters.q); // <-- DIESE ZEILE HINZUFÜGEN
  if (__sort.col) params.set("sort", __sort.col);
  if (__sort.dir) params.set("dir", __sort.dir);

  try {
    devicesCache = await apiFetch(`/api/devices?${params.toString()}`);

    // ----- NEUER CODE START -----
    // Zähler in der Überschrift aktualisieren
    const countEl = document.getElementById("device-count");
    if (countEl) {
      countEl.textContent = devicesCache.length;
    }
    // ----- NEUER CODE ENDE -----

    if (!devicesCache.length) {
      tbody.innerHTML =
        '<tr><td colspan="11" class="text-center text-muted">Keine Geräte gefunden.</td></tr>';
      return;
    }
    tbody.innerHTML = devicesCache.map(renderDeviceRow).join("");
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="11" class="text-center text-danger">Laden fehlgeschlagen: ${escapeHtml(err.message || "")}</td></tr>`;
  }
}

// ---------------------------
// BULK-SELECTION + AKTIONEN
// ---------------------------

let selectedDeviceIds = new Set();

function updateBulkUI() {
  const bar = document.getElementById("bulk-bar");
  const cnt = document.getElementById("bulk-count");
  if (!bar || !cnt) return;
  const n = selectedDeviceIds.size;
  cnt.textContent = n;
  bar.classList.toggle("d-none", n === 0);
}

function clearSelection() {
  selectedDeviceIds.clear();
  document
    .querySelectorAll(".row-select")
    .forEach((cb) => (cb.checked = false));
  const all = document.getElementById("select-all-devices");
  if (all) all.checked = false;
  updateBulkUI();
}

// Checkboxes in Tabelle aktivieren
document.addEventListener("change", (e) => {
  const cb = e.target.closest(".row-select");
  if (cb) {
    const id = Number(cb.getAttribute("data-id"));
    if (cb.checked) selectedDeviceIds.add(id);
    else selectedDeviceIds.delete(id);
    updateBulkUI();
  }
});

document
  .getElementById("select-all-devices")
  ?.addEventListener("change", (e) => {
    const all = e.target;
    const boxes = document.querySelectorAll(".row-select");
    boxes.forEach((cb) => {
      cb.checked = all.checked;
      const id = Number(cb.getAttribute("data-id"));
      if (all.checked) selectedDeviceIds.add(id);
      else selectedDeviceIds.delete(id);
    });
    updateBulkUI();
  });

// Inputs je nach Aktion anzeigen
const bulkAction = document.getElementById("bulk-action");
function toggleBulkInputs() {
  const val = bulkAction.value;
  const show = (id, on) =>
    document.getElementById(id)?.classList.toggle("d-none", !on);
  show(
    "bulk-input-date",
    [
      "set-purchase-date",
      "set-added-at",
      "set-decommissioned-at",
      "set-last-cleaned",
      "set-last-inspected",
    ].includes(val),
  );
  show("bulk-input-number", ["set-price", "set-warranty-months"].includes(val));
  show(
    "bulk-input-generic",
    ["set-notes-replace", "set-notes-append"].includes(val),
  );
  const roomMode = val === "add-room-history";
  show("bulk-input-room", roomMode);
  show("bulk-input-room-from", roomMode);
  show("bulk-input-room-to", roomMode);
  show("bulk-input-room-notes", roomMode);
}
bulkAction?.addEventListener("change", toggleBulkInputs);

// Bulk Apply
document.getElementById("bulk-apply")?.addEventListener("click", async () => {
  const ids = Array.from(selectedDeviceIds);
  if (!ids.length) return alert("Keine Geräte ausgewählt.");
  const val = bulkAction.value;

  try {
    if (val.startsWith("set-status-")) {
      // Wir brauchen neue <option> values
      const status = val.replace("set-status-", ""); // z.B. 'active', 'storage'
      await apiFetch("/api/devices/bulk-update", {
        method: "POST",
        body: JSON.stringify({ device_ids: ids, set: { status } }), // Sendet 'status' statt 'active'
      });
    } else if (val === "set-price") {
      const p = eurosToCents(document.getElementById("bulk-number").value);
      await apiFetch("/api/devices/bulk-update", {
        method: "POST",
        body: JSON.stringify({ device_ids: ids, set: { price_cents: p } }),
      });
    } else if (val === "set-purchase-date") {
      const d = document.getElementById("bulk-date").value;
      await apiFetch("/api/devices/bulk-update", {
        method: "POST",
        body: JSON.stringify({ device_ids: ids, set: { purchase_date: d } }),
      });
    } else if (val === "set-warranty-months") {
      const m = document.getElementById("bulk-number").value;
      await apiFetch("/api/devices/bulk-update", {
        method: "POST",
        body: JSON.stringify({ device_ids: ids, set: { warranty_months: m } }),
      });
    } else if (
      val === "set-added-at" ||
      val === "set-decommissioned-at" ||
      val === "set-last-cleaned" ||
      val === "set-last-inspected"
    ) {
      const d = document.getElementById("bulk-date").value;
      const field = val.replace("set-", "");
      await apiFetch("/api/devices/bulk-update", {
        method: "POST",
        body: JSON.stringify({ device_ids: ids, set: { [field]: d } }),
      });
    } else if (val === "set-notes-replace" || val === "set-notes-append") {
      const notes = document.getElementById("bulk-value").value;
      const mode = val.endsWith("append") ? "append" : "replace";
      await apiFetch("/api/devices/bulk-update", {
        method: "POST",
        body: JSON.stringify({ device_ids: ids, set: { notes }, mode }),
      });
    } else if (val === "add-room-history") {
      const room_id = document.getElementById("bulk-room").value;
      const from_date = document.getElementById("bulk-room-from").value;
      const to_date = document.getElementById("bulk-room-to").value;
      const notes = document.getElementById("bulk-room-notes").value;
      await apiFetch("/api/devices/bulk-rooms-history", {
        method: "POST",
        body: JSON.stringify({
          device_ids: ids,
          room_id,
          from_date,
          to_date,
          notes,
        }),
      });
    } else if (val === "delete-selected") {
      if (
        !confirm(
          `Sollen die ${ids.length} ausgewählten Geräte wirklich gelöscht werden?`,
        )
      ) {
        return; // Aktion abbrechen
      }

      // Sende alle Lösch-Anfragen parallel
      const deletePromises = ids.map((id) =>
        apiFetch(`/api/devices/${id}`, { method: "DELETE" }),
      );

      // Warte, bis alle abgeschlossen sind
      await Promise.all(deletePromises);
    }

    alert("Sammelaktion abgeschlossen.");
    clearSelection();
    await loadDevices();
  } catch (err) {
    alert("Fehler: " + (err.message || "Unbekannt"));
  }
});

document
  .getElementById("bulk-clear")
  ?.addEventListener("click", clearSelection);

function renderDeviceRow(d) {
  const cat = d.category_name || "-";
  const model = d.model_name || d.model_number || "-";
  const host = d.hostname || "-";
  const ser = d.serial_number || "-";
  const inv = d.inventory_number || "-";
  const mac = window.formatMacAddress(d.mac_address) || "-";
  const ip = d.ip_address || "-";
  let room = "—";
  if (d.room_id) {
    const num = d.room_number;
    const name = d.room_name || `Raum ${d.room_id}`; // Fallback

    // Prüfe die aktuelle Sortierspalte
    if (__sort.col === "room_name") {
      // Sortiert nach Name: "Name (Nummer)"
      room = num ? `${name} (${num})` : name;
    } else {
      // Standard oder sortiert nach Nummer: "Nummer (Name)"
      room = num ? `${num} (${name})` : name;
    }
  }


  const statusBadges = {
    active: '<span class="badge text-bg-success">Aktiv</span>',
    storage: '<span class="badge text-bg-info">Lager</span>',
    defective: '<span class="badge text-bg-danger">Defekt</span>',
    decommissioned:
      '<span class="badge text-bg-secondary">Ausgeschieden</span>',
  };
  const statusBadge =
    statusBadges[d.status] ||
    `<span class="badge text-bg-light text-dark">${d.status || "Inaktiv"}</span>`;

const inspectedDate = formatDate(d.last_inspected);

  const json = encodeURIComponent(JSON.stringify(d));
  return `
  <tr data-id="${d.device_id}" class="device-row">
      <td><input type="checkbox" class="form-check-input row-select" data-id="${d.device_id}"></td>
      <td>${escapeHtml(cat)}</td>
      <td>${escapeHtml(model)}</td>
      <td>${escapeHtml(host)}</td>
      <td>${escapeHtml(ser)}</td>
      <td>${escapeHtml(inv)}</td>
      <td>${escapeHtml(mac)}</td>
      <td>${escapeHtml(ip)}</td>
      <td>${escapeHtml(room)}</td>
      <td>${statusBadge}</td>
      <td>${escapeHtml(inspectedDate)}</td> <td class="text-nowrap">
      <td class="text-nowrap">
        <button class="btn btn-sm btn-outline-secondary me-1" onclick="openEditModalFromList('${json}')"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger" onclick="deleteDevice(${d.device_id})"><i class="bi bi-trash"></i></button>
      </td>
    </tr>
  `;
}
window.openEditModalFromList = function (encodedJson) {
  const d = JSON.parse(decodeURIComponent(encodedJson));
  openEditModal(d.device_id, d);
};

// Ersetzen Sie die alte showModalById Funktion hiermit:
function showModalById(id) {
  const el = document.getElementById(id);
  if (!el) return;
  try {
    // Wir verlassen uns darauf, dass Bootstrap geladen ist.
    // Das ?. in window.bootstrap?.Modal ist nicht nötig,
    // wenn wir einen Fehler werfen, falls es fehlt.
    const modalInstance = window.bootstrap.Modal.getOrCreateInstance(el);
    modalInstance.show();
  } catch (e) {
    console.error(
      "Fehler beim Öffnen des Bootstrap Modals. Ist Bootstrap JS korrekt geladen?",
      e,
    );
    // Notfall-Anzeige, die zumindest die Seite nicht blockiert
    el.style.display = "block";
    alert(
      "Modal-Fehler. Bootstrap JS fehlt oder ist fehlerhaft. Seite wird neu geladen.",
    );
    location.reload();
  }
}

// Ersetzen Sie die alte hideModalById Funktion hiermit:
function hideModalById(id) {
  const el = document.getElementById(id);
  if (!el) return;
  try {
    // Wir verlassen uns darauf, dass Bootstrap geladen ist.
    const modalInstance = window.bootstrap.Modal.getOrCreateInstance(el);
    modalInstance.hide();
  } catch (e) {
    console.error(
      "Fehler beim Schließen des Bootstrap Modals. Ist Bootstrap JS korrekt geladen?",
      e,
    );
    // Notfall-Ausblenden
    el.style.display = "none";
  }
}
// ----------------------------------------------------
// Device-Modal öffnen & befüllen
// ----------------------------------------------------
// === openEditModal ANGEPASST ===
async function openEditModal(deviceId, rowFromList = null) {
  try {
    // Gerät aus Cache nehmen oder Row verwenden. WICHTIG: rowFromList enthält jetzt die effective_... Felder!
    const device = rowFromList ||
      devicesCache.find((x) => x.device_id === deviceId) || { device_id: null };

    // Formular zurücksetzen (wichtig, um alte Platzhalter zu entfernen)
    const form = document.getElementById("deviceForm");
    if (form) form.reset();

    // Hidden ID
    setValue("device-device_id", device.device_id || "");

    // Basisfelder
    setValue("device-hostname", device.hostname || ""); // Hostname hinzugefügt
    setValue("device-serial_number", device.serial_number || "");
    setValue("device-inventory_number", device.inventory_number || "");
    setValue("device-notes", device.notes || "");

    // --- Kauf & Garantie (mit Fallback und Placeholder) ---
    const purchaseDateInput = document.getElementById("device-purchase_date");
    if (purchaseDateInput) {
      // Zeige den effektiven Wert an
      setValue("device-purchase_date", device.effective_purchase_date);
      // Setze Placeholder, wenn der Geräte-eigene Wert fehlt, aber ein Modell-Wert existiert
      if (
        device.purchase_date === null &&
        device.model_purchase_date !== null
      ) {
        purchaseDateInput.placeholder = `Standard: ${device.model_purchase_date}`;
      } else {
        purchaseDateInput.placeholder = ""; // Kein Placeholder
      }
    }

    const priceInput = document.getElementById("device-price");
    if (priceInput) {
      // Zeige den effektiven Wert an (in Euro)
      setValue("device-price", centsToEurosStr(device.effective_price_cents));
      // Setze Placeholder, wenn der Geräte-eigene Wert fehlt, aber ein Modell-Wert existiert
      if (device.price_cents === null && device.model_price_cents !== null) {
        priceInput.placeholder = `Standard: ${centsToEurosStr(device.model_price_cents)}`;
      } else {
        priceInput.placeholder = "z.B. 1499.99"; // Standard Placeholder
      }
    }

    const warrantyInput = document.getElementById("device-warranty_months");
    if (warrantyInput) {
      // Zeige den effektiven Wert an
      setValue("device-warranty_months", device.effective_warranty_months);
      // Setze Placeholder, wenn der Geräte-eigene Wert fehlt, aber ein Modell-Wert existiert
      if (
        device.warranty_months === null &&
        device.model_warranty_months !== null
      ) {
        warrantyInput.placeholder = `Standard: ${device.model_warranty_months}`;
      } else {
        warrantyInput.placeholder = "z.B. 24"; // Standard Placeholder
      }
    }
    // --- Ende Kauf & Garantie ---

    // Modell-Select & Netzwerkfelder
    await ensureModelSelectPopulated();
    if (device.model_id) setValue("device-model_id", device.model_id);
    else setValue("device-model_id", ""); // Stelle sicher, dass leer ausgewählt ist, wenn keine model_id
    updateNetworkFieldVisibility(); // Rufe dies nach dem Setzen der model_id auf

    // Netzwerkdaten
    setValue("device-mac_address", device.mac_address || "");
    setValue("device-ip_address", device.ip_address || "");

    // Datumsfelder (Status)
    setValue("device-added_at", device.added_at || "");
    setValue("device-decommissioned_at", device.decommissioned_at || "");
    setValue("device-last_cleaned", device.last_cleaned || "");
    setValue("device-last_inspected", device.last_inspected || "");

    // Raum-Historie + Auswahl
    await populateRoomHistoryRoomSelect(); // Sicherstellen, dass Räume geladen sind
    if (device.device_id) {
      await loadRoomHistory(device.device_id);
    } else {
      // Bei neuem Gerät: Historie leeren
      const historyBody = document.getElementById("room-history-body");
      if (historyBody)
        historyBody.innerHTML =
          '<tr><td colspan="5" class="text-center text-muted">Für neue Geräte erst speichern.</td></tr>';
    }

    // Modal öffnen
    showModalById("deviceModal"); // Verwende die Hilfsfunktion
  } catch (err) {
    console.error("Fehler beim Öffnen des Modals:", err);
    alert("Modal konnte nicht geladen werden: " + err.message);
  }
}

let _modelSelectPopulated = false;
async function ensureModelSelectPopulated() {
  const sel = document.getElementById("device-model_id");
  if (!sel || _modelSelectPopulated) return;

  const models = Object.values(modelCache); // Alle Modelle aus dem Cache holen

  // === NEU: Sortierung ===
  // Sortiere: 1. Nach Kategorie, 2. Nach Modellname (oder Nummer)
  models.sort((a, b) => {
    const catA = a.category_name || "";
    const catB = b.category_name || "";
    // Fallback-Logik (Name oder Nummer) muss der Label-Logik entsprechen
    const nameA = a.model_name || a.model_number || "";
    const nameB = b.model_name || b.model_number || "";

    // Vergleiche zuerst Kategorie. Wenn sie gleich sind (Ergebnis 0),
    // verwende den Vergleich des Namens.
    return catA.localeCompare(catB) || nameA.localeCompare(nameB);
  });
  // === ENDE Sortierung ===

  // Baue das HTML für die <option>-Elemente
  sel.innerHTML =
    '<option value="">Bitte Modell wählen…</option>' +
    models
      .map((m) => {
        // Label-Logik (unverändert)
        const label = `[${m.category_name || "-"}] ${m.model_name || m.model_number}`;
        return `<option value="${m.model_id}">${escapeHtml(label)}</option>`;
      })
      .join("");
  
  _modelSelectPopulated = true;
}

// ----------------------------------------------------
// Netzwerkfelder (MAC/IP) nur bei has_network
// ----------------------------------------------------
function bindModelChangeForNetworkFields() {
  const sel = document.getElementById("device-model_id");
  if (!sel) return;
  sel.addEventListener("change", updateNetworkFieldVisibility);
}
function updateNetworkFieldVisibility() {
  const sel = document.getElementById("device-model_id");
  const container = document.getElementById("network-fields");
  if (!sel || !container) return;

  const model = modelCache[sel.value];
  if (model && Number(model.has_network) === 1) {
    show(container);
  } else {
    hide(container);
    const mac = document.getElementById("device-mac_address");
    const ip = document.getElementById("device-ip_address");
    if (mac) mac.value = "";
    if (ip) ip.value = "";
  }
}

// ----------------------------------------------------
// Raum-Historie (im Modal)
// ----------------------------------------------------
async function populateRoomHistoryRoomSelect() {
  const sel = document.getElementById("rh-room");
  if (!sel) return;
  sel.innerHTML = roomCache
    .map((r) => {
      const label =
        (r.room_number ? `${r.room_number} — ` : "") +
        (r.room_name || `Raum ${r.room_id}`);
      return `<option value="${r.room_id}">${escapeHtml(label)}</option>`;
    })
    .join("");
}

// devices.js

async function loadRoomHistory(deviceId) {
  const tbody = document.getElementById("room-history-body");
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Lade Historie…</td></tr>`;
  const rows = await apiFetch(`/api/devices/${deviceId}/rooms-history`);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Keine Einträge</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map((h) => {
      // === NEU: Raum-Dropdown generieren ===
      const roomSelectHtml = `
        <select class="form-select form-select-sm rh-room-select">
          ${roomCache
            .map((r) => {
              const label =
                (r.room_number ? `${r.room_number} — ` : "") +
                (r.room_name || `Raum ${r.room_id}`);
              // Wähle den Raum aus, der mit der ID des Historien-Eintrags übereinstimmt
              const selected = r.room_id == h.room_id ? "selected" : "";
              return `<option value="${r.room_id}" ${selected}>${escapeHtml(label)}</option>`;
            })
            .join("")}
        </select>
      `;
      // === ENDE NEU ===

      return `
        <tr data-history-id="${h.history_id}"> <td><input type="date" class="form-control rh-from" value="${escapeAttr((h.from_date || "").slice(0, 10))}"></td>
          <td><input type="date" class="form-control rh-to" value="${escapeAttr((h.to_date || "").slice(0, 10))}"></td>
          <td>${roomSelectHtml}</td> <td><input type="text" class="form-control rh-notes" value="${escapeAttr(h.notes || "")}"></td>
          <td class="text-nowrap">
            <button type="button" class="btn btn-sm btn-outline-primary rh-save">Speichern</button>
            <button type="button" class="btn btn-sm btn-outline-danger rh-del ms-1">Löschen</button>
          </td>
        </tr>
      `;
    })
    .join("");
}

// devices.js

function bindRoomHistoryEvents() {
  // Save bestehender Eintrag
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".rh-save");
    if (!btn) return;
    const tr = btn.closest("tr");
    const deviceId = getValue("device-device_id");
    const historyId = tr.getAttribute("data-history-id");
    const from = tr.querySelector(".rh-from").value || null;
    const to = tr.querySelector(".rh-to").value || null;
    const notes = tr.querySelector(".rh-notes").value || null;

    // === GEÄNDERT: Wert aus dem Dropdown lesen ===
    const room_id = tr.querySelector(".rh-room-select").value || null;

    try {
      await apiFetch(`/api/devices/${deviceId}/rooms-history/${historyId}`, {
        method: "PUT",
        body: JSON.stringify({ room_id, from_date: from, to_date: to, notes }),
      });
      // Wir laden die Historie neu, um die Sortierung (falls sie sich ändert)
      // und die Raumnamen korrekt anzuzeigen.
      await loadRoomHistory(deviceId);
      await loadDevices(); // Auch die Geräteliste neu laden, falls Raumänderung sichtbar ist
    } catch (err) {
      alert(err.message || "Speichern fehlgeschlagen.");
    }
  });

  // Delete bestehender Eintrag (Diese Funktion war bei dir schon vorhanden)
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".rh-del");
    if (!btn) return;
    const tr = btn.closest("tr");
    const deviceId = getValue("device-device_id");
    const historyId = tr.getAttribute("data-history-id");
    if (!confirm("Diesen Eintrag löschen?")) return;
    try {
      await apiFetch(`/api/devices/${deviceId}/rooms-history/${historyId}`, {
        method: "DELETE",
      });
      await loadRoomHistory(deviceId); // Neu laden, um die Zeile zu entfernen
      await loadDevices(); // Auch die Geräteliste neu laden, falls Raumänderung sichtbar ist 
    } catch (err) {
      alert(err.message || "Löschen fehlgeschlagen.");
    }
  });

  // Hinzufügen-Zeile (Bleibt unverändert)
  const addBtn = document.getElementById("rh-add");
  if (addBtn) {
    addBtn.addEventListener("click", async () => {
      const deviceId = getValue("device-device_id");
      const room_id = getValue("rh-room") || null;
      const from = getValue("rh-from") || null;
      const to = getValue("rh-to") || null;
      const notes = getValue("rh-notes") || null;

      if (!deviceId) return alert("Kein Gerät im Bearbeitungsdialog.");
      if (!room_id || !from)
        return alert("Bitte mindestens Raum und Von-Datum angeben.");

      try {
        await apiFetch(`/api/devices/${deviceId}/rooms-history`, {
          method: "POST",
          body: JSON.stringify({
            room_id,
            from_date: from,
            to_date: to,
            notes,
          }),
        });
        // Eingabezeile zurücksetzen
        setValue("rh-from", "");
        setValue("rh-to", "");
        setValue("rh-notes", "");
        await loadRoomHistory(deviceId);
        await loadDevices(); // Auch die Geräteliste neu laden, falls Raumänderung sichtbar ist
      } catch (err) {
        alert(err.message || "Anlegen fehlgeschlagen.");
      }
    });
  }
}

// ----------------------------------------------------
// Formular (Neu / Bearbeiten) speichern & löschen
// ----------------------------------------------------
function bindFormSubmit() {
  const form = document.getElementById("deviceForm");
  if (!form) return;
  form.addEventListener("submit", onSubmitDeviceForm);
}

async function onSubmitDeviceForm(e) {
  e.preventDefault();

  const deviceId = getValue("device-device_id");
  const isUpdate = !!deviceId;

  const payload = {
    // Basis
    model_id: getValue("device-model_id") || null,
    hostname: getValue("device-hostname") || null,
    serial_number: getValue("device-serial_number") || null,
    inventory_number: getValue("device-inventory_number") || null,
    notes: getValue("device-notes") || null,

    // Netzwerk
    mac_address: window.formatMacAddress(getValue("device-mac_address")),

    // Zeiten
    added_at: getValue("device-added_at") || null,
    decommissioned_at: getValue("device-decommissioned_at") || null,
    last_cleaned: getValue("device-last_cleaned") || null,
    last_inspected: getValue("device-last_inspected") || null,

    // Kauf/Preis/Garantie
    purchase_date: getValue("device-purchase_date") || null,
    price_cents: eurosToCents(getValue("device-price")),
    warranty_months: (function () {
      const w = getValue("device-warranty_months");
      return w === "" || w === null ? null : Number(w);
    })(),
  };

  try {
    if (isUpdate) {
      await apiFetch(`/api/devices/${deviceId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    } else {
      const res = await apiFetch(`/api/devices`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      // Neu angelegte ID setzen, damit im selben Dialog Historie hinzugefügt werden kann
      if (res && res.device_id) {
        setValue("device-device_id", res.device_id);
        // kurze Verzögerung, damit DOM-Updates sicher sind (rein defensiv)
        await new Promise((r) => setTimeout(r, 50));
        await loadRoomHistory(res.device_id);
      }
    }

    // Liste neu laden
    await loadDevices();
    closeDeviceModal();

    // Modal offen lassen (falls man danach Historie eintragen will)
    // closeDeviceModal();
  } catch (err) {
    alert(err.message || "Speichern fehlgeschlagen.");
  }
}

window.deleteDevice = async function (deviceId) {
  if (!confirm("Dieses Gerät wirklich löschen?")) return;
  try {
    await apiFetch(`/api/devices/${deviceId}`, { method: "DELETE" });
    await loadDevices();
  } catch (err) {
    alert(err.message || "Löschen fehlgeschlagen.");
  }
};

function closeDeviceModal() {
  hideModalById("deviceModal");
}

// ... deine bestehenden Funktionen ...
// z.B. openEditModal(), saveDevice(), deleteDevice(), usw.

// === Zeilenklick zum Bearbeiten aktivieren ===
document.addEventListener("click", (e) => {
  // Klicks auf Buttons oder Checkboxen ignorieren
  if (e.target.closest(".btn, .form-check-input")) return;

  const tr = e.target.closest("tr.device-row");
  if (!tr) return;
  const id = Number(tr.getAttribute("data-id"));
  if (!id) return;

  const dev = devicesCache.find((x) => x.device_id === id);
  if (dev) openEditModal(id, dev);
});

if (typeof setValue === "undefined") {
  window.setValue = function (id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    // Spezifische Behandlung für Datum
    if (el.type === "date") {
      if (!val) {
        el.value = "";
        return;
      } // Korrekt für leere Werte
      const s = String(val);
      // Akzeptiere YYYY-MM-DD direkt
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        el.value = s.slice(0, 10);
        return;
      }
      // Versuche andere Formate zu parsen
      const d = new Date(s);
      el.value = isNaN(d) ? "" : d.toISOString().slice(0, 10); // Korrekt
    } else {
      el.value = val ?? ""; // Korrekt für andere Typen
    }
  };
}

// Wenn du am Ende sowas hast:
document.addEventListener("DOMContentLoaded", () => {
  loadDevices();
  loadFilterOptions();
  loadModels();
});
