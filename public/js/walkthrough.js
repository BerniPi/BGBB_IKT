/*
 * public/js/walkthrough.js
 *
 * NOTE: This file is loaded AFTER devices.js.
 * It relies on devices.js providing all modal functions
 * (apiFetch, openEditModal, helpers, etc.).
 */

document.addEventListener("DOMContentLoaded", () => {
  // --- NEUER Globaler Status ---
  let allRoomsCache = []; // Speichert alle Räume von der API
  let currentFloorRooms = []; // Speichert nur die gefilterten/sortierten Räume des Stockwerks
  let currentRoomIndex = 0;
  let scannerModalInstance = null; // NEU
  let html5QrcodeScanner = null; // NEU

  //  Modal-Instanz für das Verschieben
  let moveDeviceModalInstance = null;

  //  QR-Code Scanner
  let qrCodeScanner = null;

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

    // ===  Standard-Stockwerk "0" auswählen ===
  const sessionRoomId = getCurrentRoomFromSession(); // (Funktion aus devices.js)
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
          // `currentFloorRooms` ist bereits korrekt sortiert (nach sort_order)
          const roomIndex = currentFloorRooms.findIndex(r => r.room_id == sessionRoomId);
          
          if (roomIndex > -1) {
            // Schritt 4: Raum auswählen (das lädt auch die Geräte)
            updateRoomSelection(roomIndex);
            restoredSession = true; // Erfolg!
          }
        }
      }
    }

    // --- Fallback (Alte Logik) ---
    // Wenn nichts wiederhergestellt wurde (keine Session, Raum nicht gefunden, ...)
    if (!restoredSession) {
      // === Standard-Stockwerk "0" auswählen ===
      const defaultFloor = "0"; // Stockwerk "0" als String
      const defaultFloorExists = Array.from(floorSelect.options).some(
        (opt) => opt.value === defaultFloor,
      );
      if (defaultFloorExists) {
        floorSelect.value = defaultFloor; // Setze den <select> Wert
        handleFloorChange(defaultFloor); // Lade die Räume für Stockwerk "0"
      } else {
        // Fallback auf den ursprünglichen Zustand (nichts ausgewählt)
        resetRoomSelection();
      }
    }

    // Prüfen, ob die Option <option value="0"> existiert
    const defaultFloorExists = Array.from(floorSelect.options).some(
      (opt) => opt.value === defaultFloor,
    );

    if (defaultFloorExists) {
      // Ja, Stockwerk "0" existiert:
      floorSelect.value = defaultFloor; // Setze den <select> Wert
      handleFloorChange(defaultFloor); // Lade die Räume für Stockwerk "0"
    } else {
      // Nein (oder keine Stockwerke geladen):
      // Fallback auf den ursprünglichen Zustand (nichts ausgewählt)
      resetRoomSelection();
    }
    // === ENDE NEU ===
  }

  // --- Daten Lade-Logik (NEU) ---

  /**
   * Lädt alle Räume, extrahiert die Stockwerke und füllt die Stockwerk-Auswahl.
   */

  async function loadAndGroupRooms() {
    try {
      allRoomsCache = await apiFetch("/api/master-data/rooms");

      // 1. Stockwerke extrahieren
      // WICHTIG: Konvertiere alle Stockwerk-Werte konsistent zu Strings.
      const floorSet = new Set(
        allRoomsCache.map((r) => {
          if (r.floor === null || r.floor === undefined || r.floor === "") {
            return "Unbekannt";
          }
          return String(r.floor); // Konvertiert 0 zu "0", 1 zu "1"
        }),
      );

      // 2. Stockwerke sortieren (numerisch, wenn möglich, sonst alphabetisch)
      const floors = Array.from(floorSet).sort((a, b) => {
        const numA = parseFloat(a);
        const numB = parseFloat(b);
        if (!isNaN(numA) && !isNaN(numB)) {
          return numA - numB; // Numerische Sortierung (z.B. 2 vor 10)
        }
        // Alphabetisch für "EG", "1. OG" etc.
        return a.localeCompare(b);
      });

      if (floors.length === 0) {
        floorSelect.innerHTML =
          '<option value="">Keine Stockwerke gefunden</option>';
        return;
      }

      // 3. Stockwerk-Select-Box füllen
      floorSelect.innerHTML =
        '<option value="">Bitte Stockwerk wählen...</option>' +
        floors
          .map((floor) => {
            // Der "value" ist jetzt garantiert ein String (z.B. "0", "1", "EG")
            return `<option value="${escapeAttr(floor)}">${escapeHtml(floor)}</option>`;
          })
          .join("");
    } catch (err) {
      floorSelect.innerHTML = '<option value="">Fehler beim Laden</option>';
    }
  }

  /**
   * Wird aufgerufen, wenn ein Stockwerk ausgewählt wird.
   * Filtert und sortiert die Räume für dieses Stockwerk.
   * @param {string} selectedFloor - Der Name des ausgewählten Stockwerks.
   */
  // walkthrough.js

  /**
   * Wird aufgerufen, wenn ein Stockwerk ausgewählt wird.
   * Filtert und sortiert die Räume für dieses Stockwerk.
   * @param {string} selectedFloor - Der Name des ausgewählten Stockwerks (ist immer ein String).
   */
  function handleFloorChange(selectedFloor) {
    if (!selectedFloor) {
      resetRoomSelection();
      return;
    }

    // 1. Räume filtern
    // HIER IST DER FIX: Wir konvertieren den Stockwerk-Wert des Raums
    // in einen String, bevor wir ihn mit dem (String) selectedFloor vergleichen.
    currentFloorRooms = allRoomsCache.filter((r) => {
      let roomFloor;
      if (r.floor === null || r.floor === undefined || r.floor === "") {
        roomFloor = "Unbekannt";
      } else {
        roomFloor = String(r.floor); // Konvertiert 0 zu "0", 1 zu "1"
      }
      // Strikter Vergleich (Text === Text)
      return roomFloor === selectedFloor;
    });

    // 2. Räume SORTIEREN (Der entscheidende Fix!)
    // Sortiert die gefilterten Räume nach 'sort_order'.
    currentFloorRooms.sort((a, b) => {
      const soA = a.sort_order ?? 9999;
      const soB = b.sort_order ?? 9999;
      return soA - soB;
    });

    // 3. Raum-Select-Box füllen
    if (currentFloorRooms.length === 0) {
      roomSelect.innerHTML = '<option value="">Keine Räume hier</option>';

      // Manuelles Zurücksetzen, OHNE die Raum-Auswahl (roomSelect) zu überschreiben
      currentRoomId = null;
      roomNameLabel.textContent = "Kein Raum ausgewählt";
      deviceTbody.innerHTML =
        '<tr><td colspan="10" class="text-center text-muted">Keine Räume in diesem Stockwerk.</td></tr>';
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
  /**
   * Setzt die Raum-Auswahl und Geräteliste zurück.
   */
  function resetRoomSelection() {
    currentRoomId = null;
    roomSelect.innerHTML = '<option value="">-</option>';
    roomNameLabel.textContent = "Kein Raum ausgewählt";
    deviceTbody.innerHTML =
      '<tr><td colspan="10" class="text-center text-muted">Bitte Stockwerk wählen.</td></tr>';
    deviceCountLabel.textContent = "0";
    btnPrev.disabled = true;
    btnNext.disabled = true;
  }




/**
 *  Bindet Klick-Events an die Tabellen-Header
 */
function bindSortEvents() {
  document.querySelectorAll("#walkthrough-devices-body").forEach(tbody => {
      const table = tbody.closest('table');
      if (!table) return;

      table.querySelectorAll("th.sortable-header").forEach((th) => {
        th.addEventListener("click", () => {
          const col = th.getAttribute("data-sort");
          if (!col) return;

          // Einfache Sortierlogik (kein "Raum"-Spezialfall hier)
          if (__sort.col === col) {
            __sort.dir = __sort.dir === "asc" ? "desc" : "asc";
          } else {
            __sort.col = col;
            __sort.dir = "asc";
          }

          // Prüfen, ob wir in der Such- oder Raumansicht sind, und neu laden
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

/**
 *  Aktualisiert die Sortierpfeile (CSS-Klassen)
 */
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

  /**
   * Lädt die Geräte für die gegebene Raum-ID.
   */

  async function loadDevicesForRoom(roomId) {
    //  Titel zurücksetzen
    document.getElementById("walkthrough-devices-body-title").textContent =
      "Geräte in diesem Raum";

      updateSortIndicators(); // Sortier-Indikatoren aktualisieren

    deviceTbody.innerHTML =
      '<tr><td colspan="10" class="text-center">Loading devices...</td></tr>';

    if (!roomId) {
      deviceTbody.innerHTML =
        '<tr><td colspan="10" class="text-center text-muted">Please select a room.</td></tr>';
      deviceCountLabel.textContent = "0";
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

      if (devices.length === 0) {
        deviceTbody.innerHTML =
          '<tr><td colspan="7" class="text-center text-muted">No devices found in this room.</td></tr>';
        return;
      }
      //  Ruft renderDeviceRow mit der aktuellen Raum-ID auf
      deviceTbody.innerHTML = devices
        .map((d) => renderDeviceRow(d, roomId))
        .join("");
    } catch (err) {
      deviceTbody.innerHTML = `<tr><td colspan="10" class="text-center text-danger">Error: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  /**
   *  Führt eine globale Gerätesuche durch (ersetzt handleDeviceSearch).
   * Diese Funktion wird durch den 'input'-Event-Listener (debounced) aufgerufen.
   *
   * @param {string} searchTerm Der Suchbegriff aus dem Input-Feld
   */
  async function handleGlobalDeviceSearch(searchTerm) {
    searchTerm = searchTerm.trim();
    updateSortIndicators(); // Sortier-Indikatoren aktualisieren

    // Wenn das Suchfeld leer ist, zeige die normale Raumansicht
    if (!searchTerm) {
      loadDevicesForRoom(currentRoomId);
      return;
    }

    // Titel auf "Suchergebnisse" ändern
    document.getElementById("walkthrough-devices-body-title").textContent =
      "Suchergebnisse";
    deviceTbody.innerHTML = `<tr><td colspan="7" class="text-center">Suche nach "${escapeHtml(searchTerm)}"...</td></tr>`;

    try {
      // Wir nehmen an, dass Ihre API /api/devices einen ?q= Parameter unterstützt,
      // der (wie in r_tasks.js) Volltextsuche auf relevanten Feldern (Inventar, Serie, Modell...) durchführt.
      const params = new URLSearchParams({
        q: searchTerm,
        status: "all",
        sort: __sort.col, 
        dir: __sort.dir,
      });
      const devices = await apiFetch(`/api/devices?${params.toString()}`);

      deviceCountLabel.textContent = devices.length;

      if (devices.length === 0) {
        deviceTbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">Keine Geräte für "${escapeHtml(searchTerm)}" gefunden.</td></tr>`;
        return;
      }

      // WICHTIG: Rufe renderDeviceRow mit der 'currentRoomId' auf,
      // damit die Funktion die Geräte einfärben kann.
      deviceTbody.innerHTML = devices
        .map((d) => renderDeviceRow(d, currentRoomId))
        .join("");
    } catch (err) {
      deviceTbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Fehler bei der Suche: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  /**
   * Entfernt alle Hervorhebungen von der Tabelle.
   */
  function clearDeviceSearchHighlight() {
    document
      .querySelectorAll("#walkthrough-devices-body tr.table-primary")
      .forEach((row) => {
        row.classList.remove("table-primary");
      });
  }

  // --- Event Binding (Angepasst) ---
  function bindEvents() {
    const maintForm = document.getElementById("maintenanceForm");
    if (maintForm) {
      maintForm.addEventListener("submit", handleMaintenanceFormSubmit);
    }

    //  Stockwerk-Auswahl
    floorSelect.addEventListener("change", () => {
      handleFloorChange(floorSelect.value);
    });

    // Raum-Auswahl (Logik bleibt gleich)
    roomSelect.addEventListener("change", () => {
      const newIndex = parseInt(roomSelect.value, 10);
      updateRoomSelection(newIndex);
    });

    // Prev/Next buttons (Logik leicht angepasst)
    btnPrev.addEventListener("click", () => {
      let newIndex = currentRoomIndex - 1;
      if (newIndex < 0) newIndex = currentFloorRooms.length - 1; // Wrap around (im Stockwerk)
      updateRoomSelection(newIndex);
    });

    btnNext.addEventListener("click", () => {
      let newIndex = currentRoomIndex + 1;
      if (newIndex >= currentFloorRooms.length) newIndex = 0; // Wrap around (im Stockwerk)
      updateRoomSelection(newIndex);
    });

    if (btnMarkInspected) {
      btnMarkInspected.addEventListener("click", markRoomInspectedToday);
    }

    const findInput = document.getElementById("walkthrough-find-inventory");
    const findClearBtn = document.getElementById("walkthrough-find-clear-btn");
    const scanBtn = document.getElementById("walkthrough-scan-btn");

    //  Debounced Suchfunktion erstellen
    const debouncedGlobalSearch = debounce(handleGlobalDeviceSearch, 300);

    if (findInput) {
      // Reagiert auf "input" (tippen, löschen, einfügen)
      findInput.addEventListener("input", (e) => {
        // Ruft die debounced Suchfunktion auf
        debouncedGlobalSearch(e.target.value);
      });
    }

    // walkthrough.js (ca. Zeile 339)

    if (findClearBtn) {
      findClearBtn.addEventListener("click", () => {
        findInput.value = "";
        // Ruft die Suche mit leerem Text auf, was die Raumansicht wiederherstellt
        handleGlobalDeviceSearch("");
        findInput.focus();
      });
    }

    //  Event-Listener für Kamera-Scan-Button
    if (scanBtn) {
      scanBtn.addEventListener("click", () => {
        startScanner();
      });
    }

    const btnNewWalkthrough = document.getElementById("walkthrough-new-device");
    if (btnNewWalkthrough) {
      btnNewWalkthrough.addEventListener("click", () => {
        // ... (Dieser Teil bleibt unverändert)
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
      });
    }
    const moveForm = document.getElementById("moveDeviceForm");
    if (moveForm) {
      moveForm.addEventListener("submit", handleMoveDeviceSubmit);
    }
  }


  // NEUER LISTENER:
    // Reagiert auf das 'deviceSaved'-Event, das wir in devices.js auslösen.
    document.addEventListener('deviceSaved', (e) => {
      // Lade die aktuelle Walkthrough-Ansicht neu (entweder Suche oder Raum)
      const findInput = document.getElementById("walkthrough-find-inventory");
      
      if (findInput && findInput.value) {
        // Wenn eine Suche aktiv ist, lade die Suche neu
        handleGlobalDeviceSearch(findInput.value);
      } else {
        // Sonst lade die Raumansicht neu
        loadDevicesForRoom(currentRoomId);
      }
    });
  // --- Core Logic (Angepasst) ---

  /**
   * Setzt 'last_inspected' für alle Geräte im aktuellen Raum auf heute.
   */
  async function markRoomInspectedToday() {
    // Nimmt den Raum aus der (jetzt gefilterten) Liste
    const room = currentFloorRooms[currentRoomIndex];
    if (!room) return;

    const today = new Date().toISOString().slice(0, 10);
    const ok = confirm(
      `Für den Raum "${room.room_name || room.room_number}" wirklich ` +
        `bei ALLEN Geräten 'Letzte Inspektion' auf ${today} setzen?`,
    );
    if (!ok) return;

    try {
      const result = await apiFetch("/api/devices/bulk/mark-inspected", {
        method: "POST",
        body: JSON.stringify({ room_id: room.room_id, date: today }),
      });
      await loadDevicesForRoom(room.room_id);
    } catch (err) {
      alert(
        "Fehler beim Bulk-Update: " + (err.message || "Unbekannter Fehler"),
      );
    }
  }

  /**
   * Zentrale Funktion, um den Raum zu wechseln (innerhalb des Stockwerks).
   */
  function updateRoomSelection(index) {
    if (index < 0 || index >= currentFloorRooms.length) return;

    currentRoomIndex = index;
    const room = currentFloorRooms[index];
    currentRoomId = room && room.room_id ? room.room_id : null;


    saveCurrentRoomToSession(currentRoomId);


    // 1. Update Raum-Select-Box
    roomSelect.value = index;

    // 2. Update Raum-Name Label
    roomNameLabel.textContent = room.room_name || `Raum ${room.room_number}`;

    // 3. Update buttons
    const disabled = currentFloorRooms.length <= 1;
    btnPrev.disabled = disabled;
    btnNext.disabled = disabled;

    // 4. Geräte laden
    loadDevicesForRoom(room.room_id);

    //  Suchfeld zurücksetzen
    const findInput = document.getElementById("walkthrough-find-inventory");
    if (findInput) findInput.value = "";
    clearDeviceSearchHighlight();
  }

  // --- Row Rendering (ANGEPASST für Inline-Notizen UND Globale Suche) ---
  function renderDeviceRow(d, activeRoomId) {
    //  'activeRoomId' Parameter
    const cat = d.category_name || "-";
    const model = d.model_name || d.model_number || "-";
    const host = d.hostname || "-";
    const ser = d.serial_number || "-";
    const inv = d.inventory_number || "-";
    const mac = window.formatMacAddress(d.mac_address) || d.mac_address || "-";
    const ip = d.ip_address || "-";
    const notes = d.notes || "";
    const escapedNotes = escapeHtml(notes);

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
    const json = encodeURIComponent(JSON.stringify(d));

    // ---  Logik zur Hervorhebung und Standort-Anzeige ---
    // ---  Logik zur Hervorhebung und Standort-Anzeige ---
    let rowClass = "";
    let roomInfo = "";
    let moveButtonHtml = ""; // <-- NEU
    const searchTerm = document
      .getElementById("walkthrough-find-inventory")
      .value.trim();

    // Färbe Zeilen nur ein, WENN eine Suche aktiv ist
    if (searchTerm) {
      if (d.room_id && d.room_id == activeRoomId) {
        rowClass = 'class="table-success"'; // Grün: Im aktuellen Raum
      } else {
        rowClass = 'class="table-danger"'; // Rot: In einem anderen Raum

        // Finde den Raumnamen aus dem Cache (allRoomsCache)
        const foundRoom = allRoomsCache.find((r) => r.room_id == d.room_id);
        const roomName = foundRoom
          ? foundRoom.room_name || foundRoom.room_number
          : d.room_id
            ? `Unbek. Raum (ID ${d.room_id})`
            : "Kein Raum zugewiesen";

        roomInfo = `<br><small class="text-danger fw-bold">IST IN: ${escapeHtml(roomName)}</small>`;

        // ---  Move-Button hinzufügen ---
        // Nur hinzufügen, wenn ein Zielraum (activeRoomId) ausgewählt ist
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
        // --- ENDE NEU ---
      }
    }
    // --- ENDE NEU ---

    // ---  Inline-Edit-Struktur (angepasst mit roomInfo) ---
    const editableNotesCell = `
          <div class="editable-cell" onclick="switchToDeviceEditMode(this)">
              <span class="cell-text">${escapedNotes || "-"}${roomInfo}</span>
              <textarea class="form-control form-control-sm cell-input d-none"
                        rows="2"
                        data-device-id="${d.device_id}"
                        onblur="saveDeviceNoteChange(this)"
                        onkeydown="handleDeviceInputKeyDown(event, this)">${escapedNotes}</textarea>
          </div>`;
    // --- ENDE NEU ---

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
                    title="Gerät aus diesem Raum entfernen" 
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

  // --- Wartungs-Modal Logik (Unverändert) ---

  window.createMaintenanceEntry = function (
    deviceId,
    modelNumber = "",
    serialNumber = "",
  ) {
    const modalEl = document.getElementById("maintenanceModal");
    if (!modalEl) return;
    setValue("maint-device_id", deviceId);
    const deviceInfoEl = document.getElementById("maint-device-info");
    if (deviceInfoEl) {
      let infoText = `ID ${deviceId}`;
      if (modelNumber && modelNumber !== "-")
        infoText += `, Modell: ${modelNumber}`;
      if (serialNumber && serialNumber !== "-")
        infoText += `, SN: ${serialNumber}`;
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
    const form = event.target;
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

    if (
      !payload.device_id ||
      !payload.event_date ||
      !payload.event_type ||
      !payload.title
    ) {
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
      alert(
        "Fehler beim Speichern des Wartungseintrags: " +
          (err.message || "Unbekannter Fehler"),
      );
    }
  }

  // --- Helpers (Unverändert) ---

  if (typeof escapeHtml === "undefined") {
    window.escapeHtml = function (s) {
      return String(s ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    };
  }

  // Helper für Attribute (wird oben verwendet)
  function escapeAttr(s) {
    return String(s ?? "")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Helper zum Setzen/Lesen von Werten (falls nicht global von devices.js geladen)
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

  // walkthrough.js

  // --- NEUE FUNKTIONEN für Inline-Notiz-Bearbeitung ---

  /**
   * Wechselt zur Input-Ansicht (kopiert von master-data.js)
   */
  window.switchToDeviceEditMode = function (cellDiv) {
    const textSpan = cellDiv.querySelector(".cell-text");
    const inputField = cellDiv.querySelector(".cell-input");

    if (textSpan && inputField) {
      textSpan.classList.add("d-none"); // Text verstecken
      inputField.classList.remove("d-none"); // Input anzeigen
      inputField.focus(); // Fokus auf das Input-Feld setzen
      inputField.select(); // Text im Input-Feld markieren
    }
  };

  /**
   * Speichert die Notiz-Änderung (bei Blur)
   * Angepasst von master-data.js für Geräte-Notizen
   */
  window.saveDeviceNoteChange = async function (inputElement) {
    const deviceId = inputElement.getAttribute("data-device-id");
    const newNotes = inputElement.value.trim();
    const cellDiv = inputElement.closest(".editable-cell");
    const textSpan = cellDiv.querySelector(".cell-text");
    // Originalen Text holen (Fallback für '-')
    const originalNotes =
      textSpan.textContent === "-" ? "" : textSpan.textContent;

    // Nur speichern, wenn sich die Notiz geändert hat
    if (newNotes === originalNotes) {
      inputElement.classList.add("d-none");
      textSpan.classList.remove("d-none");
      return;
    }

    try {
      // PUT Request an die /api/devices/ Route senden
      await apiFetch(`/api/devices/${deviceId}`, {
        method: "PUT",
        body: JSON.stringify({ notes: newNotes }), // Nur die Notizen senden
      });

      // UI aktualisieren: Neuen Text anzeigen
      textSpan.textContent = newNotes || "-";
      inputElement.value = newNotes; // Wert im <textarea> auch aktualisieren

      // WICHTIG: Lokalen Cache aktualisieren, damit das Modal die neuen Daten hat
      if (window.devicesCache) {
        const deviceInCache = window.devicesCache.find(
          (d) => d.device_id == deviceId,
        );
        if (deviceInCache) {
          deviceInCache.notes = newNotes;
        }
      }
    } catch (error) {
      alert(`Speichern der Notiz fehlgeschlagen: ${error.message}`);
      inputElement.value = originalNotes; // Bei Fehler auf alten Wert zurücksetzen
    } finally {
      // Zurück zur Textansicht wechseln
      inputElement.classList.add("d-none");
      textSpan.classList.remove("d-none");
    }
  };

  /**
   * Behandelt Tastendrücke im Input-Feld (angepasst für <textarea>)
   */
  window.handleDeviceInputKeyDown = function (event, inputElement) {
    if (event.key === "Escape") {
      // Änderung verwerfen und zurück zur Textansicht
      const cellDiv = inputElement.closest(".editable-cell");
      const textSpan = cellDiv.querySelector(".cell-text");
      const originalNotes =
        textSpan.textContent === "-" ? "" : textSpan.textContent;

      inputElement.value = originalNotes; // Alten Wert wiederherstellen
      inputElement.blur(); // Fokus verlieren
    }

    // Für <textarea>: 'Enter' soll einen Zeilenumbruch machen.
    // Speichern mit Strg+Enter (oder Cmd+Enter)
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      inputElement.blur(); // Löst das Speichern über den onblur-Handler aus
    }
  };

  /**
   * Startet den Kamera-Scanner
   * (Dies ist die korrigierte Version, die 'Html5QrcodeScanner' verwendet)
   */
  function startScanner() {
    if (!scannerModalInstance) {
      alert("Scanner-Modal nicht gefunden!");
      return;
    }

    // Modal anzeigen
    scannerModalInstance.show();

    // Stellt sicher, dass der Viewport leer ist
    document.getElementById("scanner-viewport").innerHTML = "";

    // Verhindert doppelte Initialisierung
    if (html5QrcodeScanner) {
      stopScanner(); // Ruft die verbleibende stopScanner-Funktion auf
    }

    // Erstellt die Scanner-UI (dies war der Fix aus der vorigen Antwort)
    html5QrcodeScanner = new Html5QrcodeScanner(
      "scanner-viewport", // ID des HTML-Elements im Modal
      {
        fps: 10, // Scan-Geschwindigkeit
        qrbox: { width: 250, height: 150 }, // Größe des Scan-Fensters
        rememberLastUsedCamera: true,
        // 'facingMode' und 'supportedScanTypes' entfernt, um Fehler zu vermeiden
      },
      /* verbose= */ false,
    );

    // Scan starten (verwendet die Callbacks, die bereits in Ihrer Datei sind)
    html5QrcodeScanner.render(onScanSuccess, onScanFailure);
  }

  /**
   * Callback bei erfolgreichem Scan
   */
  function onScanSuccess(decodedText, decodedResult) {
    // `decodedText` enthält die Inventarnummer

    // 1. Modal schließen (löst automatisch `stopScanner()` aus)
    scannerModalInstance.hide();

    // 2. Den gescannten Wert in das Suchfeld eintragen
    const findInput = document.getElementById("walkthrough-find-inventory");
    if (findInput) {
      findInput.value = decodedText;
    }

    // 3. Die vorhandene Suchlogik aufrufen
    handleGlobalDeviceSearch(decodedText);
  }

  /**
   * Callback bei Scan-Fehler (wird bei jedem Frame aufgerufen, der nichts findet)
   */
  function onScanFailure(error) {
    // Leer lassen, um die Konsole nicht vollzuspammen.
  }

  /**
   * Stoppt den Scanner und gibt die Kamera frei.
   * Wird durch das 'hidden.bs.modal' Event aufgerufen.
   */
  function stopScanner() {
    if (html5QrcodeScanner) {
      try {
        html5QrcodeScanner.clear().catch((err) => {
          console.error("Fehler beim Stoppen des Scanners:", err);
        });
        html5QrcodeScanner = null; // Objekt zerstören
      } catch (err) {
        console.error("Fehler beim Stoppen des Scanners:", err);
      }
    }
  }

 /**
   *  Lädt die Raum-Historie für das Verschiebe-Modal.
   */
  async function loadMoveHistory(deviceId) {
    const tbody = document.getElementById("move-history-body");
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">Lade Historie...</td></tr>`;

    try {
      // Nutzt denselben Endpunkt wie das Haupt-Device-Modal
      const rows = await apiFetch(`/api/devices/${deviceId}/rooms-history`);
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">Keine Einträge</td></tr>`;
        return;
      }
      // Rendert eine einfache Tabellenansicht
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

  /**
   *  Ersetzt die alte Funktion. Öffnet das Modal zum Verschieben.
   */
  window.moveDeviceToCurrentRoom = async function (
    deviceId,
    newRoomId,
    deviceIdentifier,
    newRoomName,
  ) {
    if (!deviceId || !newRoomId || !moveDeviceModalInstance) return;

    const today = new Date().toISOString().slice(0, 10);

    // 1. Modal-Inhalte füllen
    setValue("move-device-id", deviceId);
    setValue("move-target-room-id", newRoomId);
    setValue("move-date", today);

    document.getElementById("move-device-info").textContent =
      deviceIdentifier || `Gerät ID: ${deviceId}`;
    document.getElementById("move-target-room-info").textContent =
      newRoomName || `Raum ID: ${newRoomId}`;

    // Standard-Aktion auf "neu" setzen
    const radioNew = document.getElementById("move-action-new");
    if (radioNew) radioNew.checked = true;

    // 2. Historie laden
    await loadMoveHistory(deviceId);

    // 3. Modal anzeigen
    moveDeviceModalInstance.show();
  };

  /**
   *  Verarbeitet das Absenden des Verschiebe-Formulars.
   */
  async function handleMoveDeviceSubmit(event) {
    event.preventDefault();

    const deviceId = getValue("move-device-id");
    const newRoomId = getValue("move-target-room-id");
    const moveDate = getValue("move-date");
    const action =
      document.querySelector('input[name="moveAction"]:checked')?.value || "new";

    if (!deviceId || !newRoomId) {
      alert("Fehler: Geräte-ID oder Raum-ID fehlt.");
      return;
    }

    try {
      if (action === "new") {
        // --- AKTION A: Neuen Eintrag erstellen ---
        if (!moveDate) {
          alert("Bitte ein Datum für den neuen Eintrag angeben.");
          return;
        }
        await apiFetch(`/api/devices/${deviceId}/move-to-room`, {
          method: "POST",
          body: JSON.stringify({
            new_room_id: newRoomId,
            move_date: moveDate,
          }),
        });
      } else if (action === "correct") {
        // --- AKTION B: Letzten Eintrag korrigieren ---
        await apiFetch(`/api/devices/${deviceId}/correct-current-room`, {
          method: "PUT",
          body: JSON.stringify({
            new_room_id: newRoomId,
          }),
        });
      }

      // Bei Erfolg: Modal schließen und Suche aktualisieren
      moveDeviceModalInstance.hide();
      const findInput = document.getElementById("walkthrough-find-inventory");
      if (findInput) {
        handleGlobalDeviceSearch(findInput.value);
      }
    } catch (err) {
      alert(`Fehler beim Verschieben des Geräts: ${err.message}`);
    }
  }


  /**
   *  Entfernt ein Gerät aus dem aktuellen Raum, indem der
   *Raumeintrag auf Gestern beendet wird.
   */
  window.removeDeviceFromRoom = async function (deviceId, deviceIdentifier, roomName) {
    const confirmation = confirm(
      `Soll das Gerät '${deviceIdentifier}' wirklich aus dem Raum '${roomName}' entfernt werden?\n\nDer aktuelle Raumeintrag wird auf GESTERN beendet.`
    );
    if (!confirmation) {
      return;
    }

    // 1. Berechne "Gestern"
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const yesterdayISO = yesterday.toISOString().slice(0, 10);

    try {
      // 2. Rufe den NEUEN API-Endpunkt auf
      await apiFetch(`/api/devices/${deviceId}/end-current-room`, {
        method: "PUT",
        body: JSON.stringify({ to_date: yesterdayISO }),
      });

      // 3. Erfolgreich: Lade die Ansicht neu (entfernt das Gerät aus der Liste)
      const findInput = document.getElementById("walkthrough-find-inventory");
      if (findInput && findInput.value) {
        handleGlobalDeviceSearch(findInput.value); // Suchansicht neu laden
      } else {
        loadDevicesForRoom(currentRoomId); // Raumansicht neu laden
      }
    } catch (err) {
      alert(`Fehler beim Entfernen des Geräts: ${err.message}`);
    }
  };
  /**
   *  Debounce-Funktion
   */
  function debounce(func, delay) {
    // ... (Diese Funktion bleibt unverändert) ...
    return function (...args) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        func.apply(this, args);
      }, delay);
    };
  }
  // --- App Start ---
  initialize();
});
