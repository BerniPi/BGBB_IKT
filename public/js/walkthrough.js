/*
 * public/js/walkthrough.js
 *
 * NOTE: This file is loaded AFTER devices.js.
 * It relies on devices.js providing all modal functions
 * (apiFetch, openEditModal, helpers, etc.).
 */

// --- NEUE KONSTANTEN für Datums-Speicher ---
const RECENT_MOVE_DATES_KEY = 'walkthrough_recentMoveDates';
const MAX_RECENT_DATES = 5; // Speichert die letzten 5 Daten

document.addEventListener("DOMContentLoaded", () => {
  // --- NEUER Globaler Status ---
  let allRoomsCache = []; // Speichert alle Räume von der API
  let currentFloorRooms = []; // Speichert nur die gefilterten/sortierten Räume des Stockwerks
  let currentRoomIndex = 0;
  let scannerModalInstance = null;
  let html5QrcodeScanner = null;

  //  Modal-Instanz für das Verschieben
  let moveDeviceModalInstance = null;

  // NEU FÜR GLOBALE SUCHE
  let currentRoomId = null; // ID des aktuell gewählten Raums
  let debounceTimer = null; // Timer für die Debounce-Funktion

  //  Globale Sortiervariablen
  let __sort = { col: "category_name", dir: "asc" };

  // --- DOM Elements ---
  const floorSelect = document.getElementById("walkthrough-floor-select");
  const roomSelect = document.getElementById("walkthrough-room-select");
  const roomNameLabel = document.getElementById("current-room-name");
  const deviceTbody = document.getElementById("walkthrough-devices-body");
  const deviceCountLabel = document.getElementById("walkthrough-device-count");
  const btnPrev = document.getElementById("btn-prev-room");
  const btnNext = document.getElementById("btn-next-room");
  const btnMarkInspected = document.getElementById("btn-mark-inspected-today");

  if (!floorSelect || !roomSelect || !deviceTbody) {
    console.error("Walkthrough UI elements (floor or room) not found.");
    return;
  }

  // --- Main Init ---
  async function initialize() {
    // SICHERHEITS-CHECK:
  if (typeof window.apiFetch !== "function" || typeof window.openEditModal !== "function") {
    deviceTbody.innerHTML = `
      <tr>
        <td colspan="10" class="text-center text-danger p-4">
          <strong>Kritischer Fehler:</strong> Die Haupt-Bibliothek (devices.js) konnte nicht geladen werden.<br>
          Bitte laden Sie die Seite neu (F5).
        </td>
      </tr>`;
    console.error("devices.js fehlt! Walkthrough gestoppt.");
    return; // Stop execution
  }
  
    await loadAndGroupRooms(); // Lädt Räume und füllt floorSelect

    //  Scanner Modal initialisieren
    const modalEl = document.getElementById("scannerModal");
    if (modalEl) {
      scannerModalInstance = new bootstrap.Modal(modalEl);

      // WICHTIG: Scanner stoppen, wenn Modal geschlossen wird (Kamera freigeben)
      modalEl.addEventListener("hidden.bs.modal", () => {
        stopScanner();
      });
    }

    //  Move Device Modal initialisieren
    const moveModalEl = document.getElementById("moveDeviceModal");
    if (moveModalEl) {
      moveDeviceModalInstance = new bootstrap.Modal(moveModalEl);
    }

    bindEvents();
    bindSortEvents();

    // ===  Standard-Stockwerk auswählen ===
    // (Versucht Session wiederherzustellen, sonst Fallback auf "0")
    if (typeof getCurrentRoomFromSession !== "undefined") {
        const sessionRoomId = getCurrentRoomFromSession(); 
        let restoredSession = false;

        // Prüfen, ob eine Raum-ID gespeichert ist UND der Raum-Cache geladen wurde
        if (sessionRoomId && allRoomsCache.length > 0) {
        const room = allRoomsCache.find(r => r.room_id == sessionRoomId);
        
        if (room) {
            // Schritt 1: Finde das zugehörige Stockwerk
            let floorToSelect = "Unbekannt";
            if (room.floor !== null && room.floor !== undefined && room.floor !== "") {
            floorToSelect = String(room.floor); // z.B. 0 -> "0"
            }
            
            // Prüfen, ob dieses Stockwerk im <select> existiert
            const floorOption = Array.from(floorSelect.options).find(opt => opt.value === floorToSelect);
            
            if (floorOption) {
            // Schritt 2: Stockwerk auswählen und Räume laden
            floorSelect.value = floorToSelect;
            handleFloorChange(floorToSelect); // Füllt `currentFloorRooms`

            // Schritt 3: Den Raum im (jetzt gefüllten) Raum-Select finden
            const roomIndex = currentFloorRooms.findIndex(r => r.room_id == sessionRoomId);
            
            if (roomIndex > -1) {
                // Schritt 4: Raum auswählen (das lädt auch die Geräte)
                updateRoomSelection(roomIndex);
                restoredSession = true; // Erfolg!
            }
            }
        }
        }

        // --- Fallback ---
        if (!restoredSession) {
            const defaultFloor = "0"; 
            const defaultFloorExists = Array.from(floorSelect.options).some(
                (opt) => opt.value === defaultFloor,
            );
            if (defaultFloorExists) {
                floorSelect.value = defaultFloor;
                handleFloorChange(defaultFloor);
            } else {
                resetRoomSelection();
            }
        }
    } else {
        // Fallback falls devices.js noch nicht geladen/aktualisiert ist
        resetRoomSelection();
    }
  }

  // --- Daten Lade-Logik ---

  async function loadAndGroupRooms() {
    try {
      allRoomsCache = await apiFetch("/api/master-data/rooms");

      // 1. Stockwerke extrahieren
      const floorSet = new Set(
        allRoomsCache.map((r) => {
          if (r.floor === null || r.floor === undefined || r.floor === "") {
            return "Unbekannt";
          }
          return String(r.floor);
        }),
      );

      // 2. Stockwerke sortieren
      const floors = Array.from(floorSet).sort((a, b) => {
        const numA = parseFloat(a);
        const numB = parseFloat(b);
        if (!isNaN(numA) && !isNaN(numB)) {
          return numA - numB;
        }
        return a.localeCompare(b);
      });

      if (floors.length === 0) {
        floorSelect.innerHTML = '<option value="">Keine Stockwerke gefunden</option>';
        return;
      }

      floorSelect.innerHTML =
        '<option value="">Bitte Stockwerk wählen...</option>' +
        floors
          .map((floor) => {
            return `<option value="${escapeAttr(floor)}">${escapeHtml(floor)}</option>`;
          })
          .join("");
    } catch (err) {
      floorSelect.innerHTML = '<option value="">Fehler beim Laden</option>';
    }
  }

  function handleFloorChange(selectedFloor) {
    if (!selectedFloor) {
      resetRoomSelection();
      return;
    }

    // 1. Räume filtern
    currentFloorRooms = allRoomsCache.filter((r) => {
      let roomFloor;
      if (r.floor === null || r.floor === undefined || r.floor === "") {
        roomFloor = "Unbekannt";
      } else {
        roomFloor = String(r.floor);
      }
      return roomFloor === selectedFloor;
    });

    // 2. Räume SORTIEREN
    currentFloorRooms.sort((a, b) => {
      const soA = a.sort_order ?? 9999;
      const soB = b.sort_order ?? 9999;
      return soA - soB;
    });

    // 3. Raum-Select-Box füllen
    if (currentFloorRooms.length === 0) {
      roomSelect.innerHTML = '<option value="">Keine Räume hier</option>';
      currentRoomId = null;
      roomNameLabel.textContent = "Kein Raum ausgewählt";
      deviceTbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted">Keine Räume in diesem Stockwerk.</td></tr>';
      deviceCountLabel.textContent = "0";
      btnPrev.disabled = true;
      btnNext.disabled = true;
      return;
    }

    roomSelect.innerHTML = currentFloorRooms
      .map((r, index) => {
        const label = `${r.room_number || ""} — ${r.room_name}`;
        return `<option value="${index}">${escapeHtml(label)}</option>`;
      })
      .join("");

    // 4. Ersten Raum im Stockwerk laden
    updateRoomSelection(0);
  }

  function resetRoomSelection() {
    currentRoomId = null;
    roomSelect.innerHTML = '<option value="">-</option>';
    roomNameLabel.textContent = "Kein Raum ausgewählt";
    deviceTbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted">Bitte Stockwerk wählen.</td></tr>';
    deviceCountLabel.textContent = "0";
    btnPrev.disabled = true;
    btnNext.disabled = true;
  }

  // --- Sortierung ---
  function bindSortEvents() {
    document.querySelectorAll("#walkthrough-devices-body").forEach(tbody => {
        const table = tbody.closest('table');
        if (!table) return;

        table.querySelectorAll("th.sortable-header").forEach((th) => {
          th.addEventListener("click", () => {
            const col = th.getAttribute("data-sort");
            if (!col) return;

            if (__sort.col === col) {
              __sort.dir = __sort.dir === "asc" ? "desc" : "asc";
            } else {
              __sort.col = col;
              __sort.dir = "asc";
            }

            // Neu laden
            const findInput = document.getElementById("walkthrough-find-inventory");
            if (findInput && findInput.value) {
              handleGlobalDeviceSearch(findInput.value);
            } else {
              loadDevicesForRoom(currentRoomId);
            }
          });
        });
    });
  }

  function updateSortIndicators() {
    const table = document.querySelector("#walkthrough-devices-body").closest('table');
    if (!table) return;

    table.querySelectorAll(".sortable-header").forEach((header) => {
      header.classList.remove("sort-asc", "sort-desc");
      if (header.dataset.sort === __sort.col) {
        header.classList.add(__sort.dir === "asc" ? "sort-asc" : "sort-desc");
      }
    });
  }

  // --- Geräte laden & Suche ---

async function loadDevicesForRoom(roomId) {
    document.getElementById("walkthrough-devices-body-title").textContent = "Geräte in diesem Raum";
    updateSortIndicators();

    deviceTbody.innerHTML = '<tr><td colspan="10" class="text-center">Loading devices...</td></tr>';

    // Button referenzieren
    const btnMarkInspected = document.getElementById("btn-mark-inspected-today");

    if (!roomId) {
      deviceTbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted">Bitte Raum wählen.</td></tr>';
      deviceCountLabel.textContent = "0";
      // Auch hier Button deaktivieren
      if (btnMarkInspected) {
          btnMarkInspected.disabled = true;
          btnMarkInspected.classList.add("disabled");
      }
      return;
    }

    try {
      const params = new URLSearchParams({
        room_id: roomId,
        status: "all",
        sort: __sort.col,
        dir: __sort.dir,
      });
      const devices = await apiFetch(`/api/devices?${params.toString()}`);

      window.devicesCache = devices;
      deviceCountLabel.textContent = devices.length;

      // --- HIER IST DER FIX: Button-Logik VOR dem return ---
      if (btnMarkInspected) {
        if (devices.length === 0) {
          btnMarkInspected.disabled = true;
          btnMarkInspected.classList.add("disabled");
        } else {
          btnMarkInspected.disabled = false;
          btnMarkInspected.classList.remove("disabled");
        }
      }
      // -----------------------------------------------------

      if (devices.length === 0) {
        deviceTbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted">Keine Geräte in diesem Raum.</td></tr>';
        return; // Jetzt ist das return sicher, da der Button schon bearbeitet wurde
      }
      
      deviceTbody.innerHTML = devices
        .map((d) => renderDeviceRow(d, roomId))
        .join("");
    } catch (err) {
      deviceTbody.innerHTML = `<tr><td colspan="10" class="text-center text-danger">Error: ${escapeHtml(err.message)}</td></tr>`;
    }
  }


  async function handleGlobalDeviceSearch(searchTerm) {
    searchTerm = searchTerm.trim();
    updateSortIndicators();

    if (!searchTerm) {
      loadDevicesForRoom(currentRoomId);
      return;
    }

    document.getElementById("walkthrough-devices-body-title").textContent = "Suchergebnisse";
    deviceTbody.innerHTML = `<tr><td colspan="10" class="text-center">Suche nach "${escapeHtml(searchTerm)}"...</td></tr>`;

    try {
      const params = new URLSearchParams({
        q: searchTerm,
        status: "all",
        sort: __sort.col, 
        dir: __sort.dir,
      });
      const devices = await apiFetch(`/api/devices?${params.toString()}`);

      deviceCountLabel.textContent = devices.length;

      if (devices.length === 0) {
        deviceTbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted">Keine Geräte für "${escapeHtml(searchTerm)}" gefunden.</td></tr>`;
        return;
      }

      deviceTbody.innerHTML = devices
        .map((d) => renderDeviceRow(d, currentRoomId))
        .join("");
    } catch (err) {
      deviceTbody.innerHTML = `<tr><td colspan="10" class="text-center text-danger">Fehler bei der Suche: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function clearDeviceSearchHighlight() {
    document.querySelectorAll("#walkthrough-devices-body tr.table-primary")
      .forEach((row) => row.classList.remove("table-primary"));
  }

  // --- Events ---
  function bindEvents() {
    const maintForm = document.getElementById("maintenanceForm");
    if (maintForm) {
      maintForm.addEventListener("submit", handleMaintenanceFormSubmit);
    }

    floorSelect.addEventListener("change", () => {
      handleFloorChange(floorSelect.value);
    });

    roomSelect.addEventListener("change", () => {
      const newIndex = parseInt(roomSelect.value, 10);
      updateRoomSelection(newIndex);
    });

    btnPrev.addEventListener("click", () => {
      let newIndex = currentRoomIndex - 1;
      if (newIndex < 0) newIndex = currentFloorRooms.length - 1;
      updateRoomSelection(newIndex);
    });

    btnNext.addEventListener("click", () => {
      let newIndex = currentRoomIndex + 1;
      if (newIndex >= currentFloorRooms.length) newIndex = 0;
      updateRoomSelection(newIndex);
    });

    if (btnMarkInspected) {
      btnMarkInspected.addEventListener("click", markRoomInspectedToday);
    }

    const findInput = document.getElementById("walkthrough-find-inventory");
    const findClearBtn = document.getElementById("walkthrough-find-clear-btn");
    const scanBtn = document.getElementById("walkthrough-scan-btn"); // Button in EJS (auskommentiert in deinem Code, aber hier für Vollständigkeit)

    const debouncedGlobalSearch = debounce(handleGlobalDeviceSearch, 300);

    if (findInput) {
      findInput.addEventListener("input", (e) => {
        debouncedGlobalSearch(e.target.value);
      });
    }

    if (findClearBtn) {
      findClearBtn.addEventListener("click", () => {
        findInput.value = "";
        handleGlobalDeviceSearch("");
        findInput.focus();
      });
    }

    // Wenn der Scan-Button im EJS wieder einkommentiert wird:
    if (scanBtn) {
      scanBtn.addEventListener("click", () => {
        startScanner();
      });
    }

    const btnNewWalkthrough = document.getElementById("walkthrough-new-device");
    if (btnNewWalkthrough) {
      btnNewWalkthrough.addEventListener("click", () => {
        if (typeof openEditModal !== "undefined") {
            openEditModal(null, {
            device_id: null,
            model_id: null,
            hostname: "",
            serial_number: "",
            inventory_number: "",
            mac_address: "",
            ip_address: "",
            added_at: new Date().toISOString().slice(0, 10),
            decommissioned_at: null,
            purchase_date: null,
            price_cents: null,
            warranty_months: null,
            status: "active",
            last_cleaned: null,
            last_inspected: null,
            notes: "",
            });
        }
      });
    }
    const moveForm = document.getElementById("moveDeviceForm");
    if (moveForm) {
      moveForm.addEventListener("submit", handleMoveDeviceSubmit);
    }
  }

  // Reagiert auf das 'deviceSaved'-Event (aus devices.js)
  document.addEventListener('deviceSaved', (e) => {
    const findInput = document.getElementById("walkthrough-find-inventory");
    if (findInput && findInput.value) {
      handleGlobalDeviceSearch(findInput.value);
    } else {
      loadDevicesForRoom(currentRoomId);
    }
  });

  // --- Logic ---

  async function markRoomInspectedToday() {
    const room = currentFloorRooms[currentRoomIndex];
    if (!room) return;

    const today = new Date().toISOString().slice(0, 10);
    const ok = confirm(
      `Für den Raum "${room.room_name || room.room_number}" wirklich ` +
        `bei ALLEN Geräten 'Letzte Inspektion' auf ${today} setzen?`,
    );
    if (!ok) return;

    try {
      await apiFetch("/api/devices/bulk/mark-inspected", {
        method: "POST",
        body: JSON.stringify({ room_id: room.room_id, date: today }),
      });
      await loadDevicesForRoom(room.room_id);
    } catch (err) {
      alert("Fehler beim Bulk-Update: " + (err.message || "Unbekannter Fehler"));
    }
  }

  function updateRoomSelection(index) {
    if (index < 0 || index >= currentFloorRooms.length) return;

    currentRoomIndex = index;
    const room = currentFloorRooms[index];
    currentRoomId = room && room.room_id ? room.room_id : null;

    if (typeof saveCurrentRoomToSession !== "undefined") {
        saveCurrentRoomToSession(currentRoomId);
    }

    roomSelect.value = index;
    roomNameLabel.textContent = room.room_name || `Raum ${room.room_number}`;

    const disabled = currentFloorRooms.length <= 1;
    btnPrev.disabled = disabled;
    btnNext.disabled = disabled;

    loadDevicesForRoom(room.room_id);

    const findInput = document.getElementById("walkthrough-find-inventory");
    if (findInput) findInput.value = "";
    clearDeviceSearchHighlight();
  }

  // --- Rendering ---
  function renderDeviceRow(d, activeRoomId) {
    const cat = d.category_name || "-";
    const model = d.model_name || d.model_number || "-";
    const host = d.hostname || "-";
    const ser = d.serial_number || "-";
    const inv = d.inventory_number || "-";
    const mac = (window.formatMacAddress ? window.formatMacAddress(d.mac_address) : d.mac_address) || "-";
    const ip = d.ip_address || "-";
    const notes = d.notes || "";
    const escapedNotes = escapeHtml(notes);

    const statusBadges = {
      active: '<span class="badge text-bg-success">Aktiv</span>',
      storage: '<span class="badge text-bg-info">Lager</span>',
      defective: '<span class="badge text-bg-danger">Defekt</span>',
      decommissioned: '<span class="badge text-bg-secondary">Ausgeschieden</span>',
    };
    const statusBadge = statusBadges[d.status] || `<span class="badge text-bg-light text-dark">${d.status || "Inaktiv"}</span>`;
    const json = encodeURIComponent(JSON.stringify(d));

    let rowClass = "";
    let roomInfo = "";
    let moveButtonHtml = ""; 
    const searchTerm = document.getElementById("walkthrough-find-inventory").value.trim();

    // Hervorhebung bei Suche
    if (searchTerm) {
      if (d.room_id && d.room_id == activeRoomId) {
        rowClass = 'class="table-success"'; 
      } else {
        rowClass = 'class="table-danger"'; 

        const foundRoom = allRoomsCache.find((r) => r.room_id == d.room_id);
        const roomName = foundRoom
          ? foundRoom.room_name || foundRoom.room_number
          : d.room_id
            ? `Unbek. Raum (ID ${d.room_id})`
            : "Kein Raum zugewiesen";

        roomInfo = `<br><small class="text-danger fw-bold">IST IN: ${escapeHtml(roomName)}</small>`;

        const currentRoomName = roomNameLabel.textContent || "aktuellen Raum";
        if (activeRoomId) {
          moveButtonHtml = `
                <button class="btn btn-sm btn-warning me-1"
                        title="In Raum '${escapeAttr(currentRoomName)}' verschieben (Heute)"
                        onclick="moveDeviceToCurrentRoom(
                          ${d.device_id},
                          ${activeRoomId},
                          '${escapeAttr(d.serial_number || d.inventory_number)}',
                          '${escapeAttr(currentRoomName)}'
                        )">
                  <i class="bi bi-arrow-return-right"></i>
                </button>
              `;
        }
      }
    }

    const editableNotesCell = `
          <div class="editable-cell" onclick="switchToDeviceEditMode(this)">
              <span class="cell-text">${escapedNotes || "-"}${roomInfo}</span>
              <textarea class="form-control form-control-sm cell-input d-none"
                        rows="2"
                        data-device-id="${d.device_id}"
                        onblur="saveDeviceNoteChange(this)"
                        onkeydown="handleDeviceInputKeyDown(event, this)">${escapedNotes}</textarea>
          </div>`;

    return `
        <tr ${rowClass}>
          <td>${escapeHtml(cat)}</td>
          <td>${escapeHtml(model)}</td>
          <td>${escapeHtml(host)}</td>
          <td>${escapeHtml(ser)}</td>
          <td>${escapeHtml(inv)}</td>
          <td>${escapeHtml(mac)}</td>
          <td>${escapeHtml(ip)}</td>
          <td>${statusBadge}</td>
          <td>${editableNotesCell}</td>
          <td class="text-nowrap">
            ${moveButtonHtml}
            <button class="btn btn-sm btn-outline-info me-1" title="Wartung anlegen" onclick="createMaintenanceEntry(${d.device_id}, '${escapeAttr(model)}', '${escapeAttr(ser)}')">
            <i class="bi bi-tools"></i>
            </button>
            <button class="btn btn-sm btn-outline-secondary me-1" title="Gerät bearbeiten" onclick="openEditModalFromList('${json}')">
              <i class="bi bi-pencil"></i>
            </button>
            <button class="btn btn-sm btn-outline-danger" 
                    title="Gerät aus diesem Raum entfernen (Setzt Enddatum auf Gestern)" 
                    onclick="removeDeviceFromRoom(
                        ${d.device_id}, 
                        '${escapeAttr(d.serial_number || d.inventory_number || 'ID ' + d.device_id)}', 
                        '${escapeAttr(roomNameLabel.textContent)}'
                    )">
              <i class="bi bi-box-arrow-left"></i>
            </button>
          </td>
        </tr>
      `;
  }

  // --- Wartung ---
  window.createMaintenanceEntry = function (deviceId, modelNumber = "", serialNumber = "") {
    const modalEl = document.getElementById("maintenanceModal");
    if (!modalEl) return;
    setValue("maint-device_id", deviceId);
    const deviceInfoEl = document.getElementById("maint-device-info");
    if (deviceInfoEl) {
      let infoText = `ID ${deviceId}`;
      if (modelNumber && modelNumber !== "-") infoText += `, Modell: ${modelNumber}`;
      if (serialNumber && serialNumber !== "-") infoText += `, SN: ${serialNumber}`;
      deviceInfoEl.textContent = infoText;
    }
    setValue("maint-event_date", new Date().toISOString().slice(0, 10));
    setValue("maint-event_type", "inspection");
    setValue("maint-title", "");
    setValue("maint-description", "");
    setValue("maint-performed_by", "");
    try {
      const bsModal = bootstrap.Modal.getOrCreateInstance(modalEl);
      bsModal.show();
    } catch (e) {
      console.error("Bootstrap Modal Error:", e);
      alert("Fehler beim Öffnen des Wartungs-Modals.");
    }
  };

  async function handleMaintenanceFormSubmit(event) {
    event.preventDefault();
    const modalEl = document.getElementById("maintenanceModal");

    const payload = {
      device_id: parseInt(getValue("maint-device_id"), 10),
      event_date: getValue("maint-event_date"),
      event_type: getValue("maint-event_type"),
      title: getValue("maint-title"),
      description: getValue("maint-description") || null,
      performed_by: getValue("maint-performed_by") || null,
      status: "done",
    };

    if (!payload.device_id || !payload.event_date || !payload.event_type || !payload.title) {
      alert("Bitte fülle alle Pflichtfelder (*) aus.");
      return;
    }

    try {
      await apiFetch("/api/maintenance", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (modalEl) {
        const bsModal = bootstrap.Modal.getInstance(modalEl);
        if (bsModal) bsModal.hide();
      }
    } catch (err) {
      alert("Fehler beim Speichern des Wartungseintrags: " + (err.message || "Unbekannter Fehler"));
    }
  }

  // --- Helpers ---
  if (typeof escapeHtml === "undefined") {
    window.escapeHtml = function (s) {
      return String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
    };
  }
  function escapeAttr(s) {
    return String(s ?? "").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }
  if (typeof getValue === "undefined") {
    window.getValue = function (id) {
      const el = document.getElementById(id);
      return el ? el.value : null;
    };
  }
  if (typeof setValue === "undefined") {
    window.setValue = function (id, val) {
      const el = document.getElementById(id);
      if (el) el.value = val ?? "";
    };
  }

  // --- Inline-Notizen ---
  window.switchToDeviceEditMode = function (cellDiv) {
    const textSpan = cellDiv.querySelector(".cell-text");
    const inputField = cellDiv.querySelector(".cell-input");
    if (textSpan && inputField) {
      textSpan.classList.add("d-none");
      inputField.classList.remove("d-none");
      inputField.focus();
      inputField.select();
    }
  };

  window.saveDeviceNoteChange = async function (inputElement) {
    const deviceId = inputElement.getAttribute("data-device-id");
    const newNotes = inputElement.value.trim();
    const cellDiv = inputElement.closest(".editable-cell");
    const textSpan = cellDiv.querySelector(".cell-text");
    const originalNotes = textSpan.textContent === "-" ? "" : textSpan.textContent;

    if (newNotes === originalNotes) {
      inputElement.classList.add("d-none");
      textSpan.classList.remove("d-none");
      return;
    }

    try {
      await apiFetch(`/api/devices/${deviceId}`, {
        method: "PUT",
        body: JSON.stringify({ notes: newNotes }),
      });

      textSpan.textContent = newNotes || "-";
      inputElement.value = newNotes;

      if (window.devicesCache) {
        const deviceInCache = window.devicesCache.find((d) => d.device_id == deviceId);
        if (deviceInCache) deviceInCache.notes = newNotes;
      }
    } catch (error) {
      alert(`Speichern der Notiz fehlgeschlagen: ${error.message}`);
      inputElement.value = originalNotes;
    } finally {
      inputElement.classList.add("d-none");
      textSpan.classList.remove("d-none");
    }
  };

  window.handleDeviceInputKeyDown = function (event, inputElement) {
    if (event.key === "Escape") {
      const cellDiv = inputElement.closest(".editable-cell");
      const textSpan = cellDiv.querySelector(".cell-text");
      const originalNotes = textSpan.textContent === "-" ? "" : textSpan.textContent;
      inputElement.value = originalNotes;
      inputElement.blur();
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      inputElement.blur();
    }
  };

  // --- Scanner ---
  function startScanner() {
    if (!scannerModalInstance) {
      alert("Scanner-Modal nicht gefunden!");
      return;
    }
    scannerModalInstance.show();
    document.getElementById("scanner-viewport").innerHTML = "";

    // Falls noch einer läuft, stoppen
    if (html5QrcodeScanner) {
      stopScanner();
    }

    html5QrcodeScanner = new Html5QrcodeScanner(
      "scanner-viewport",
      { fps: 10, qrbox: { width: 250, height: 150 }, rememberLastUsedCamera: true },
      false,
    );
    html5QrcodeScanner.render(onScanSuccess, onScanFailure);
  }

  // === HIER WURDE DIE FEHLENDE FUNKTION EINGEFÜGT ===
  async function stopScanner() {
    if (html5QrcodeScanner) {
      try {
        await html5QrcodeScanner.clear(); // Beendet Kamera und UI
        html5QrcodeScanner = null;
      } catch (error) {
        console.error("Fehler beim Stoppen des Scanners:", error);
      }
    }
  }
  // ==================================================

  function onScanSuccess(decodedText, decodedResult) {
    scannerModalInstance.hide(); // stopScanner wird via EventListener aufgerufen
    const findInput = document.getElementById("walkthrough-find-inventory");
    if (findInput) {
      findInput.value = decodedText;
    }
    handleGlobalDeviceSearch(decodedText);
  }

  function onScanFailure(error) {
    // console.warn(error);
  }

  // --- Verschieben ---
  function saveRecentMoveDate(isoDate) {
    if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return;
    try {
      let recentDates = getRecentMoveDates();
      recentDates = recentDates.filter(d => d !== isoDate);
      recentDates.unshift(isoDate);
      const finalDates = recentDates.slice(0, MAX_RECENT_DATES);
      localStorage.setItem(RECENT_MOVE_DATES_KEY, JSON.stringify(finalDates));
    } catch (e) {
      console.warn("Konnte 'Zuletzt verwendete Daten' nicht speichern:", e);
    }
  }

  function getRecentMoveDates() {
    try {
      const rawData = localStorage.getItem(RECENT_MOVE_DATES_KEY);
      if (rawData) {
        const dates = JSON.parse(rawData);
        if (Array.isArray(dates)) return dates;
      }
    } catch (e) { }
    return [];
  }

  async function loadMoveHistory(deviceId) {
    const tbody = document.getElementById("move-history-body");
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">Lade Historie...</td></tr>`;

    try {
      const rows = await apiFetch(`/api/devices/${deviceId}/rooms-history`);
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">Keine Einträge</td></tr>`;
        return;
      }
      tbody.innerHTML = rows
        .map((h) => {
          return `
            <tr>
              <td>${escapeHtml((h.from_date || "").slice(0, 10))}</td>
              <td>${escapeHtml((h.to_date || "").slice(0, 10)) || '<span class="text-success">Aktuell</span>'}</td>
              <td>${escapeHtml(h.room_number || "")} ${escapeHtml(h.room_name || "")}</td>
            </tr>
          `;
        })
        .join("");
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="3" class="text-center text-danger">Historie laden fehlgeschlagen.</td></tr>`;
    }
  }

  window.moveDeviceToCurrentRoom = async function (deviceId, newRoomId, deviceIdentifier, newRoomName) {
    if (!deviceId || !newRoomId || !moveDeviceModalInstance) return;

    const today = new Date().toISOString().slice(0, 10);
    const recentDates = getRecentMoveDates();
    const dateToSet = (recentDates.length > 0 && recentDates[0]) ? recentDates[0] : today;

    setValue("move-device-id", deviceId);
    setValue("move-target-room-id", newRoomId);
    setValue("move-date", dateToSet);

    document.getElementById("move-device-info").textContent = deviceIdentifier || `Gerät ID: ${deviceId}`;
    document.getElementById("move-target-room-info").textContent = newRoomName || `Raum ID: ${newRoomId}`;

    const radioNew = document.getElementById("move-action-new");
    if (radioNew) radioNew.checked = true;

    const datalist = document.getElementById('recent-move-dates');
    if (datalist) {
      datalist.innerHTML = recentDates.map(d => `<option value="${escapeAttr(d)}"></option>`).join('');
    }

    await loadMoveHistory(deviceId);
    moveDeviceModalInstance.show();
  };

  async function handleMoveDeviceSubmit(event) {
    event.preventDefault();

    const deviceId = getValue("move-device-id");
    const newRoomId = getValue("move-target-room-id");
    const moveDate = getValue("move-date");
    const action = document.querySelector('input[name="moveAction"]:checked')?.value || "new";

    if (!deviceId || !newRoomId) {
      alert("Fehler: Geräte-ID oder Raum-ID fehlt.");
      return;
    }

    try {
      if (action === "new") {
        if (!moveDate) {
          alert("Bitte ein Datum für den neuen Eintrag angeben.");
          return;
        }
        await apiFetch(`/api/devices/${deviceId}/move-to-room`, {
          method: "POST",
          body: JSON.stringify({ new_room_id: newRoomId, move_date: moveDate }),
        });
        saveRecentMoveDate(moveDate);

      } else if (action === "correct") {
        await apiFetch(`/api/devices/${deviceId}/correct-current-room`, {
          method: "PUT",
          body: JSON.stringify({ new_room_id: newRoomId }),
        });
      }

      moveDeviceModalInstance.hide();
      const findInput = document.getElementById("walkthrough-find-inventory");
      if (findInput) {
        handleGlobalDeviceSearch(findInput.value);
      }
    } catch (err) {
      alert(`Fehler beim Verschieben des Geräts: ${err.message}`);
    }
  }

  window.removeDeviceFromRoom = async function (deviceId, deviceIdentifier, roomName) {
    const confirmation = confirm(
      `Soll das Gerät '${deviceIdentifier}' wirklich aus dem Raum '${roomName}' entfernt werden?\n\nDer aktuelle Raumeintrag wird auf GESTERN beendet.`
    );
    if (!confirmation) return;

    // "Gestern" berechnen
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const yesterdayISO = yesterday.toISOString().slice(0, 10);

    try {
      await apiFetch(`/api/devices/${deviceId}/end-current-room`, {
        method: "PUT",
        body: JSON.stringify({ to_date: yesterdayISO }),
      });

      const findInput = document.getElementById("walkthrough-find-inventory");
      if (findInput && findInput.value) {
        handleGlobalDeviceSearch(findInput.value);
      } else {
        loadDevicesForRoom(currentRoomId);
      }
    } catch (err) {
      // Spezieller Hinweis für den Fehler "End-Datum < Start-Datum"
      let msg = err.message;
      if (msg.includes("Validierungsfehler") || msg.includes("vor dem 'Von'-Datum")) {
         msg = "Das Gerät wurde vermutlich erst heute diesem Raum hinzugefügt. Ein Entfernen 'zu gestern' ist daher nicht möglich. Bitte bearbeiten Sie die Historie manuell im Bearbeiten-Dialog.";
      }
      alert(`Fehler beim Entfernen: ${msg}`);
    }
  };

  function debounce(func, delay) {
    return function (...args) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        func.apply(this, args);
      }, delay);
    };
  }

  initialize();
});