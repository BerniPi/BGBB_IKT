// public/js/maintenance.js

// ----------------------------------------------------
// Utilities (ggf. aus globalem Skript oder hier definieren)
// ----------------------------------------------------
if (typeof apiFetch === 'undefined') { window.apiFetch = async function (url, options={}) { /*...*/ }; } // Basis-Implementierung hier
if (typeof escapeHtml === 'undefined') { window.escapeHtml = function(s) { /*...*/ }; } // Basis-Implementierung hier
function getValue(id) { /*...*/ return document.getElementById(id)?.value ?? null; }
function setValue(id, val) { /*...*/ const el = document.getElementById(id); if(el) el.value = val ?? ''; }
function show(elOrId) { /*...*/ }
function hide(elOrId) { /*...*/ }

// ----------------------------------------------------
// Globaler Status für Filter & Sortierung
// ----------------------------------------------------
let __maintFilters = {
  q: '', deviceId: '', type: '', status: '', from: '', to: ''
};
let __maintSort = { col: 'event_date', dir: 'desc' };
let maintenanceCache = []; // Cache der aktuell angezeigten Einträge
let devicesForSelectCache = []; // Cache der Geräte für Select-Felder

// ----------------------------------------------------
// Initialisierung
// ----------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
    // Bootstrap Modal Instanz erstellen
    const modalElement = document.getElementById('maintenanceModal');
    const maintenanceModal = modalElement ? new bootstrap.Modal(modalElement) : null;

    await loadDevicesForSelect(); // Geräte für Filter und Modal laden
    bindFilterEvents();
    bindSortEvents();
    bindModalEvents(maintenanceModal);

    // Initialen Ladevorgang starten
    await loadMaintenance();

     // Parameter aus URL lesen (z.B. von Walkthrough) und Filter/Modal setzen
    handleUrlParameters(maintenanceModal);
});

// ----------------------------------------------------
// Hilfsfunktionen
// ----------------------------------------------------

// Lädt Geräte und füllt die Select-Boxen (Filter + Modal)
async function loadDevicesForSelect() {
    try {
        // Lade alle Geräte, auch die ausgeschiedenen, für den Fall, dass man alte Einträge sieht
        devicesForSelectCache = await apiFetch('/api/devices?status=all_incl_decommissioned&sort=inventory_number'); // Nach Inventarnr sortiert

        const filterSelect = document.getElementById('filter-device');
        const modalSelect = document.getElementById('maintenance-device_id');

        const optionsHtml = devicesForSelectCache.map(device => {
            // Aussagekräftigeren Namen erstellen
            let label = device.inventory_number || device.serial_number || device.hostname || `ID ${device.device_id}`;
            if (device.model_number) label += ` (${device.model_number})`;
            if (device.status === 'decommissioned') label += ' [ausgeschieden]';
            return `<option value="${device.device_id}">${escapeHtml(label)}</option>`;
        }).join('');

        if (filterSelect) {
            filterSelect.innerHTML = '<option value="">Alle Geräte</option>' + optionsHtml;
        }
        if (modalSelect) {
            // Wichtig: Die "Bitte wählen"-Option bleibt erhalten
             modalSelect.innerHTML = '<option value="" disabled selected>Bitte Gerät wählen...</option>' + optionsHtml;
        }

    } catch (error) {
        console.error("Fehler beim Laden der Geräte für Select:", error);
        // Optional: Fehlermeldung in Selects anzeigen
        const filterSelect = document.getElementById('filter-device');
        const modalSelect = document.getElementById('maintenance-device_id');
        if(filterSelect) filterSelect.innerHTML = '<option value="">Fehler</option>';
        if(modalSelect) modalSelect.innerHTML = '<option value="">Fehler</option>';
    }
}


// --- Haupt-Ladefunktion ---
async function loadMaintenance() {
    const tbody = document.getElementById('maintenance-table-body');
    const countSpan = document.getElementById('maintenance-count');
    if (!tbody || !countSpan) return;

    tbody.innerHTML = '<tr><td colspan="7" class="text-center">Lade Daten...</td></tr>'; // Colspan auf 7
    countSpan.textContent = '-';

    // Query-Parameter aus __maintFilters und __maintSort erstellen
    const params = new URLSearchParams();
    for (const key in __maintFilters) {
        if (__maintFilters[key]) params.set(key, __maintFilters[key]);
    }
    if (__maintSort.col) params.set('sort', __maintSort.col);
    if (__maintSort.dir) params.set('dir', __maintSort.dir);

    try {
        maintenanceCache = await apiFetch(`/api/maintenance?${params.toString()}`);
        countSpan.textContent = maintenanceCache.length;

        if (maintenanceCache.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Keine Einträge gefunden.</td></tr>'; // Colspan auf 7
            return;
        }
        tbody.innerHTML = maintenanceCache.map(renderMaintenanceRow).join('');

        // Sortierungsindikatoren aktualisieren
        updateSortIndicators();

    } catch (error) {
        console.error("Fehler beim Laden der Wartungsdaten:", error);
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Laden fehlgeschlagen: ${escapeHtml(error.message)}</td></tr>`; // Colspan auf 7
    }
}

// --- Rendering ---
function renderMaintenanceRow(item) {
    // Geräte-Info zusammenstellen (Inventar > Serie > Hostname > Modell)
    const deviceInfo = item.inventory_number || item.serial_number || item.hostname || item.model_number || `ID ${item.device_id}`;

    // Status-Badge erstellen
    const statusBadges = {
        done: 'bg-success', planned: 'bg-info', in_progress: 'bg-warning text-dark', canceled: 'bg-secondary'
    };
    const statusClass = statusBadges[item.status] || 'bg-light text-dark';
    const statusText = item.status.charAt(0).toUpperCase() + item.status.slice(1).replace('_', ' '); // z.B. In progress

    // JSON für Edit-Button sicher kodieren
    const itemJson = encodeURIComponent(JSON.stringify(item));

    return `
        <tr>
            <td>${escapeHtml(item.event_date)}</td>
            <td>${escapeHtml(deviceInfo)}</td>
            <td>${escapeHtml(item.event_type)}</td>
            <td>${escapeHtml(item.title)}</td>
            <td><span class="badge ${statusClass}">${escapeHtml(statusText)}</span></td>
            <td>${escapeHtml(item.performed_by || '-')}</td>
            <td class="text-nowrap">
                <button class="btn btn-sm btn-outline-secondary me-1" title="Bearbeiten" onclick="editMaintenance('${itemJson}')"> 
                    <i class="bi bi-pencil"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger" title="Löschen" onclick="deleteMaintenance(${item.maintenance_id})">
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        </tr>
    `;
}

// --- Event Handling ---
function bindFilterEvents() {
    const filterIds = ['filter-q', 'filter-device', 'filter-type', 'filter-status', 'filter-from', 'filter-to'];
    filterIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            // 'input' für Textfeld, 'change' für Selects/Dates
            const eventType = (id === 'filter-q') ? 'input' : 'change';
            el.addEventListener(eventType, () => {
                __maintFilters.q = getValue('filter-q');
                __maintFilters.deviceId = getValue('filter-device');
                __maintFilters.type = getValue('filter-type');
                __maintFilters.status = getValue('filter-status');
                __maintFilters.from = getValue('filter-from');
                __maintFilters.to = getValue('filter-to');
                loadMaintenance(); // Bei jeder Änderung neu laden
            });
        }
    });

    // Button zum Filter zurücksetzen
     const clearBtn = document.getElementById('clear-filters-btn');
     if(clearBtn) {
         clearBtn.addEventListener('click', () => {
             filterIds.forEach(id => setValue(id, '')); // Alle Felder leeren
             // __maintFilters zurücksetzen
              __maintFilters = { q: '', deviceId: '', type: '', status: '', from: '', to: '' };
              loadMaintenance(); // Neu laden
         });
     }
}

function bindSortEvents() {
    document.querySelectorAll('th.sortable').forEach(th => {
        th.style.cursor = 'pointer';
        th.addEventListener('click', () => {
            const col = th.getAttribute('data-sort');
            if (!col) return;
            if (__maintSort.col === col) {
                __maintSort.dir = (__maintSort.dir === 'asc') ? 'desc' : 'asc';
            } else {
                __maintSort.col = col;
                // Standard-Richtung abhängig von Spalte
                __maintSort.dir = (col === 'event_date') ? 'desc' : 'asc';
            }
            loadMaintenance(); // Bei Klick neu laden
        });
    });
}

function updateSortIndicators() {
    document.querySelectorAll('th.sortable').forEach(th => {
        const col = th.getAttribute('data-sort');
        // Entferne alte Icons
        th.querySelectorAll('.sort-icon').forEach(icon => icon.remove());
        // Füge neues Icon hinzu, wenn diese Spalte aktiv ist
        if (col === __maintSort.col) {
            const icon = document.createElement('i');
            icon.classList.add('bi', __maintSort.dir === 'asc' ? 'bi-sort-up' : 'bi-sort-down', 'ms-1', 'sort-icon');
            th.appendChild(icon);
        }
    });
}


function bindModalEvents(modalInstance) {
    if (!modalInstance) return;

    const form = document.getElementById('maintenanceForm');
    const newBtn = document.getElementById('new-maintenance-btn');

    // "Neuer Eintrag"-Button
    if (newBtn) {
        newBtn.addEventListener('click', () => {
            form.reset();
            setValue('maintenanceId', ''); // ID leeren für "Neu"-Modus
            setValue('maintenance-device_id', ''); // Geräteauswahl leeren
            setValue('maintenance-event_date', new Date().toISOString().split('T')[0]); // Heutiges Datum
            setValue('maintenance-status', 'done'); // Standard-Status
            setValue('maintenance-event_type', 'inspection'); // Standard-Typ
            document.getElementById('maintenanceModalTitle').textContent = 'Neuer Wartungseintrag';

            // Geräteauswahl anzeigen/aktivieren, Info-Text ausblenden
            show('modal-device-select-container');
            document.getElementById('maintenance-device_id').disabled = false;
            hide('modal-device-info-display');


            modalInstance.show();
        });
    }

    // Formular-Submit
    if (form) {
        form.addEventListener('submit', (e) => handleMaintenanceFormSubmit(e, modalInstance));
    }
}

// Bearbeiten-Funktion (wird von onclick in Tabelle aufgerufen)
window.editMaintenance = function (itemJson) {
    const item = JSON.parse(decodeURIComponent(itemJson));
    const modalElement = document.getElementById('maintenanceModal');
    if (!modalElement || !item) return;
    const modalInstance = bootstrap.Modal.getOrCreateInstance(modalElement);

    const form = document.getElementById('maintenanceForm');
    form.reset();

    // IDs setzen
    setValue('maintenanceId', item.maintenance_id);
    // Geräteauswahl befüllen und deaktivieren
    setValue('maintenance-device_id', item.device_id);
    document.getElementById('maintenance-device_id').disabled = true; // Im Edit-Modus nicht änderbar
    hide('modal-device-select-container'); // Select ausblenden

     // Geräte-Info anzeigen (statt Select)
    const deviceInfoDisplay = document.getElementById('modal-device-info-display');
    const deviceInfo = item.inventory_number || item.serial_number || item.hostname || item.model_number || `ID ${item.device_id}`;
    if(deviceInfoDisplay) {
        deviceInfoDisplay.textContent = `Gerät: ${deviceInfo} (ID: ${item.device_id})`;
        show(deviceInfoDisplay);
    }


    // Andere Felder befüllen
    setValue('maintenance-event_date', item.event_date);
    setValue('maintenance-title', item.title);
    setValue('maintenance-event_type', item.event_type);
    setValue('maintenance-status', item.status);
    setValue('maintenance-performed_by', item.performed_by);
    setValue('maintenance-description', item.description);
    // Hier weitere Felder befüllen, falls vorhanden

    document.getElementById('maintenanceModalTitle').textContent = 'Wartungseintrag bearbeiten';
    modalInstance.show();
}

// Löschen-Funktion (wird von onclick in Tabelle aufgerufen)
window.deleteMaintenance = async function (id) {
    if (!confirm(`Soll der Wartungseintrag #${id} wirklich gelöscht werden?`)) return;
    try {
        await apiFetch(`/api/maintenance/${id}`, { method: 'DELETE' });
        loadMaintenance(); // Liste neu laden
    } catch (error) {
        alert('Löschen fehlgeschlagen: ' + (error.message || 'Unbekannter Fehler'));
    }
}

// Handler für Formular-Submit (Neu & Bearbeiten)
async function handleMaintenanceFormSubmit(event, modalInstance) {
    event.preventDefault();
    const form = event.target;
    const id = getValue('maintenanceId');
    const isUpdate = !!id;
    // Wichtig: device_id kommt jetzt immer aus dem (ggf. deaktivierten) Select
    const deviceId = getValue('maintenance-device_id');

    const url = isUpdate ? `/api/maintenance/${id}` : `/api/maintenance`; // POST geht jetzt an /api/maintenance
    const method = isUpdate ? 'PUT' : 'POST';

    const body = {
        // device_id nur bei NEU mitsenden (bei Update wird es ignoriert oder könnte Fehler verursachen)
        // Bei Update ist device_id bereits über die URL /:id bekannt
        ...( !isUpdate && { device_id: deviceId }),
        event_date: getValue('maintenance-event_date'),
        title: getValue('maintenance-title'),
        event_type: getValue('maintenance-event_type'),
        status: getValue('maintenance-status'),
        performed_by: getValue('maintenance-performed_by') || null,
        description: getValue('maintenance-description') || null,
        // Hier weitere Felder auslesen
    };

    // Validierung
     if (!body.event_date || !body.title || !body.event_type || (!isUpdate && !body.device_id)) {
        alert('Bitte alle Pflichtfelder (*) ausfüllen.');
        return;
    }


    try {
        await apiFetch(url, { method, body: JSON.stringify(body) });
        if (modalInstance) modalInstance.hide();
        loadMaintenance(); // Liste neu laden
    } catch (error) {
        alert(`Speichern fehlgeschlagen: ${error.message || 'Unbekannter Fehler'}`);
    }
}

 // URL-Parameter verarbeiten (z.B. ?deviceId=123)
 function handleUrlParameters(modalInstance) {
    const urlParams = new URLSearchParams(window.location.search);
    const deviceIdFromUrl = urlParams.get('deviceId');

    if (deviceIdFromUrl) {
      // 1. Filter setzen und Daten laden
      const deviceFilterSelect = document.getElementById('filter-device');
      if (deviceFilterSelect) {
        deviceFilterSelect.value = deviceIdFromUrl;
        // Trigger change event manually if needed, or directly update filter state and load
         __maintFilters.deviceId = deviceIdFromUrl;
         // loadMaintenance(); // Wird sowieso initial geladen

         // 2. Optional: Direkt das "Neuer Eintrag"-Modal für dieses Gerät öffnen
         // Finde Gerätedaten aus Cache
         const device = devicesForSelectCache.find(d => d.device_id == deviceIdFromUrl);
         if (device && modalInstance) {
             const form = document.getElementById('maintenanceForm');
             form.reset();
             setValue('maintenanceId', '');
             setValue('maintenance-device_id', deviceIdFromUrl); // Gerät vorselektieren
             setValue('maintenance-event_date', new Date().toISOString().split('T')[0]);
             setValue('maintenance-status', 'done');
             setValue('maintenance-event_type', 'inspection');
             document.getElementById('maintenanceModalTitle').textContent = `Neuer Eintrag für Gerät ID ${deviceIdFromUrl}`;

             // Geräteauswahl deaktivieren und Info anzeigen
            document.getElementById('maintenance-device_id').disabled = true;
            hide('modal-device-select-container');
            const deviceInfoDisplay = document.getElementById('modal-device-info-display');
             const deviceInfo = device.inventory_number || device.serial_number || device.hostname || device.model_number || `ID ${device.device_id}`;
             if(deviceInfoDisplay) {
                 deviceInfoDisplay.textContent = `Gerät: ${deviceInfo} (ID: ${device.device_id})`;
                 show(deviceInfoDisplay);
             }


             modalInstance.show();

             // Clean URL parameter after using it (optional)
             // window.history.replaceState({}, document.title, window.location.pathname);
         }
      }
    }
 }