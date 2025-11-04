// public/js/master-data.js

// Sicherstellen, dass Hilfsfunktionen aus devices.js verfügbar sind
if (typeof apiFetch === 'undefined' || typeof escapeHtml === 'undefined' || typeof centsToEurosStr === 'undefined' || typeof eurosToCents === 'undefined') {
    console.warn("Wichtige Hilfsfunktionen (apiFetch, escapeHtml, centsToEurosStr, eurosToCents) nicht gefunden. Stellen Sie sicher, dass devices.js vor master-data.js geladen wird.");
    // Fallback-Definitionen (rudimentär, nur damit es nicht crasht)
    if(typeof escapeHtml === 'undefined') window.escapeHtml = s => s;
    if(typeof centsToEurosStr === 'undefined') window.centsToEurosStr = c => c ? (c/100).toFixed(2) : '';
    if(typeof eurosToCents === 'undefined') window.eurosToCents = e => e ? Math.round(parseFloat(String(e).replace(',', '.')) * 100) : null;
    // apiFetch muss existieren!
}

// NEU: escapeAttr definieren, das in Ihrer renderRoomsTable-Funktion verwendet wurde, aber fehlte.
window.escapeAttr = s => String(s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

document.addEventListener('DOMContentLoaded', () => {
    // Event Listeners (unverändert)
    document.querySelector('#collapseRooms')?.addEventListener('show.bs.collapse', () => loadMasterData('rooms'));
    document.querySelector('#collapseModels')?.addEventListener('show.bs.collapse', () => {
        loadMasterData('models_with_details', 'models'); // Nutzt jetzt die erweiterte Route
        populateCategorySelect();
    });
    document.querySelector('#collapseDeviceCats')?.addEventListener('show.bs.collapse', () => loadMasterData('device_categories'));

    // Formular-Submit-Handler (unverändert)
    document.getElementById('roomForm')?.addEventListener('submit', (e) => handleFormSubmit(e, 'rooms', 'room_id'));
    document.getElementById('modelForm')?.addEventListener('submit', (e) => handleFormSubmit(e, 'models', 'model_id'));
    document.getElementById('deviceCategoryForm')?.addEventListener('submit', (e) => handleFormSubmit(e, 'device_categories', 'category_id'));
});

// Lädt und rendert die Daten (unverändert)
async function loadMasterData(endpoint, resourceName = null) {
    resourceName = resourceName || endpoint;
    const tbody = document.getElementById(`${resourceName.replace(/_/g, '-')}-table-body`);
    if (!tbody) return;
    // Bestimme colspan dynamisch basierend auf der Tabelle
    const colspan = tbody.closest('table')?.querySelector('thead tr')?.childElementCount || 5; // Default 5
    tbody.innerHTML = `<tr><td colspan="${colspan}" class="text-center">Lade...</td></tr>`;

    try {
        const data = await apiFetch(`/api/master-data/${endpoint}`); // Nutzt jetzt /models_with_details
        tbody.innerHTML = '';
        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${colspan}" class="text-center text-muted">Keine Einträge vorhanden.</td></tr>`;
            return;
        }
        let html = '';
        if (resourceName === 'rooms') {
            html = renderRoomsTable(data);
        } else if (resourceName === 'models') {
            html = renderModelsTable(data); // Angepasste Funktion wird aufgerufen
        } else if (resourceName === 'device_categories') {
            html = renderCategoriesTable(data);
        }
        tbody.innerHTML = html;
    } catch (error) {
        console.error(`Fehler beim Laden von ${resourceName}:`, error);
        const colspan = tbody.closest('table')?.querySelector('thead tr')?.childElementCount || 5;
        tbody.innerHTML = `<tr><td colspan="${colspan}" class="text-center text-danger">Laden fehlgeschlagen.</td></tr>`;
    }
}

// ERSETZE die komplette renderRoomsTable Funktion
function renderRoomsTable(data) {
    let html = '';
    let currentFloor = Symbol(); // Eindeutiger Wert, um Stockwerkswechsel zu erkennen
    data.forEach((item, index) => {
        // Stockwerk-Trennlinie (unverändert)
        if (item.floor !== currentFloor) {
            currentFloor = item.floor;
            html += `<tr class="table-light"><td colspan="6"><strong>Stockwerk: ${currentFloor === null ? 'Nicht definiert' : currentFloor}</strong></td></tr>`; // Colspan 6 [Ref: master-data.js, 61]
        }
        // Pfeile (unverändert)
        const prevItem = data[index - 1], nextItem = data[index + 1];
        const showUp = prevItem && prevItem.floor === item.floor;
        const showDown = nextItem && nextItem.floor === item.floor;
        const upArrow = showUp ? `<button class="btn btn-sm btn-outline-secondary py-0 px-1" onclick="moveRoom(${item.room_id}, 'up')"><i class="bi bi-arrow-up"></i></button>` : ''; // [Ref: master-data.js, 64-66]
        const downArrow = showDown ? `<button class="btn btn-sm btn-outline-secondary py-0 px-1" onclick="moveRoom(${item.room_id}, 'down')"><i class="bi bi-arrow-down"></i></button>` : ''; // [Ref: master-data.js, 66]

        // --- NEUE STRUKTUR FÜR RAUMNAME ---
        // --- VERWENDET JETZT createEditableCell ---
        const editableNameCell = createEditableCell('rooms', item.room_id, 'room_name', item.room_name);
        // --- ENDE NEUE STRUKTUR ---

        html += `<tr data-room-id="${item.room_id}">
            <td>${upArrow} ${downArrow}</td>
            <td>${escapeHtml(item.room_number)}</td>
            <td>${editableNameCell}</td>
            <td>${item.floor ?? '-'}</td>
            <td>${item.sort_order ?? '-'}</td>
            <td>${createActionButtons('rooms', 'room_id', item.room_id, item)}</td>
        </tr>`;
    });
    return html;
}

// ANGEPASST: Rendert Modell-Tabelle mit neuen Feldern
function renderModelsTable(data) {
   return data.map(item => `
        <tr>
            <td>${escapeHtml(item.category_name || '-')}</td>
            <td>${createEditableCell('models', item.model_id, 'manufacturer', item.manufacturer)}</td>
            <td>${createEditableCell('models', item.model_id, 'type', item.type)}</td>
            <td>${createEditableCell('models', item.model_id, 'model_name', item.model_name)}</td>
            <td>${createEditableCell('models', item.model_id, 'model_number', item.model_number)}</td>
            <td>${item.active_devices} (${item.total_devices})</td>
            <td>${Number(item.has_network) ? '<i class="bi bi-wifi text-success" title="Netzwerkfähig"></i>' : '<i class="bi bi-wifi-off text-muted" title="Nicht Netzwerkfähig"></i>'}</td>
            <td>${escapeHtml(item.purchase_date || '-')}</td>  
            <td>${escapeHtml(centsToEurosStr(item.price_cents) || '-')}</td> 
            <td>${escapeHtml(item.warranty_months || '-')}</td> 
            <td>${createEditableCell('models', item.model_id, 'maintenance_interval_months', item.maintenance_interval_months)}</td>
            <td>${createActionButtons('models', 'model_id', item.model_id, item)}</td>
        </tr>
    `).join('');
}


function renderCategoriesTable(data) { /* ... (unverändert) ... */
    return data.map(item => `
        <tr>
            <td>${escapeHtml(item.category_name)}</td>
            <td>${escapeHtml(item.description || '-')}</td>
            <td>${createActionButtons('device_categories', 'category_id', item.category_id, item)}</td>
        </tr>
    `).join('');
}

// --- Formular- & Aktions-Logik ---
const formPrefixes = { /* ... (unverändert) ... */
    rooms: 'room', models: 'model', device_categories: 'cat'
};


// NEUE FUNKTIONEN für Inline-Editing

// Wechselt zur Input-Ansicht
window.switchToEditMode = function(cellDiv) {
    const textSpan = cellDiv.querySelector('.cell-text');
    const inputField = cellDiv.querySelector('.cell-input');

    if (textSpan && inputField) {
        textSpan.classList.add('d-none'); // Text verstecken
        inputField.classList.remove('d-none'); // Input anzeigen
        inputField.focus(); // Fokus auf das Input-Feld setzen
        inputField.select(); // Text im Input-Feld markieren
    }
}

window.saveInlineChange = async function(inputElement) {
    const resource = inputElement.getAttribute('data-resource');
    const id = inputElement.getAttribute('data-id');
    const field = inputElement.getAttribute('data-field');
    const newValue = inputElement.value; // .trim() entfernt, falls Leerzeichen gewollt sind

    const cellDiv = inputElement.closest('.editable-cell');
    const textSpan = cellDiv.querySelector('.cell-text');
    const originalName = textSpan.textContent === '-' ? '' : textSpan.textContent; // '-' als leer interpretieren

    // Nur speichern, wenn sich der Name geändert hat
    if (newValue === originalName) {
        inputElement.classList.add('d-none');
        textSpan.classList.remove('d-none');
        return;
    }

    // Leeren Wert in 'null' umwandeln (wichtig für die DB)
    const valueToSend = newValue === '' ? null : newValue;

    try {
        // Generischen PUT Request an die bestehende Backend-Route senden
        // Das Backend (r_masterData.js) verarbeitet Teil-Updates bereits korrekt.
        await apiFetch(`/api/master-data/${resource}/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ [field]: valueToSend }) // Nur das geänderte Feld senden
        });

        // UI aktualisieren: Neuen Namen im Text anzeigen
        textSpan.textContent = newValue || '-'; // Bei leerem Wert '-' anzeigen

    } catch (error) {
        alert(`Speichern fehlgeschlagen: ${error.message}`);
        inputElement.value = originalName; // Bei Fehler auf alten Wert zurücksetzen
    } finally {
        // Zurück zur Textansicht wechseln
        inputElement.classList.add('d-none');
        textSpan.classList.remove('d-none');
    }
}

// Speichert die Änderung (bei Enter oder Blur)
window.saveRoomNameChange = async function(inputElement) {
    const roomId = inputElement.getAttribute('data-room-id');
    const newName = inputElement.value.trim();
    const cellDiv = inputElement.closest('.editable-cell');
    const textSpan = cellDiv.querySelector('.cell-text');
    const originalName = textSpan.textContent; // Den alten Namen speichern

    // Nur speichern, wenn sich der Name geändert hat
    if (newName === originalName) {
        // Zurück zur Textansicht ohne Speichern
        inputElement.classList.add('d-none');
        textSpan.classList.remove('d-none');
        return;
    }

    // Leeren Namen verhindern (optional, aber sinnvoll)
    if (newName === "") {
        alert("Der Raumname darf nicht leer sein.");
        inputElement.value = originalName; // Zurücksetzen auf alten Wert
        inputElement.focus();
        return;
    }

    try {
        // PUT Request an die bestehende Backend-Route senden
        await apiFetch(`/api/master-data/rooms/${roomId}`, {
            method: 'PUT',
            body: JSON.stringify({ room_name: newName }) // Nur den geänderten Namen senden
        });

        // UI aktualisieren: Neuen Namen im Text anzeigen
        textSpan.textContent = newName;

    } catch (error) {
        alert(`Speichern fehlgeschlagen: ${error.message}`);
        inputElement.value = originalName; // Bei Fehler auf alten Wert zurücksetzen
    } finally {
        // Zurück zur Textansicht wechseln, egal ob erfolgreich oder nicht
        inputElement.classList.add('d-none');
        textSpan.classList.remove('d-none');
    }
}

// Behandelt Tastendrücke im Input-Feld
window.handleInputKeyDown = function(event, inputElement) {
    if (event.key === 'Enter') {
        event.preventDefault(); // Verhindert ggf. Formular-Submit
        inputElement.blur(); // Löst das Speichern über den onblur-Handler aus
    } else if (event.key === 'Escape') {
        // Änderung verwerfen und zurück zur Textansicht
        const cellDiv = inputElement.closest('.editable-cell');
        const textSpan = cellDiv.querySelector('.cell-text');
        inputElement.value = textSpan.textContent; // Alten Wert wiederherstellen
        inputElement.classList.add('d-none');
        textSpan.classList.remove('d-none');
    }
}

const pkFields = {
  rooms: 'room_id',
  models: 'model_id',
  device_categories: 'category_id'
};

const formIds = { /* ... (unverändert) ... */
     rooms: 'roomForm', models: 'modelForm', device_categories: 'deviceCategoryForm'
};

function createActionButtons(resourceName, pkField, id, item) { /* ... (unverändert) ... */
    const itemJson = JSON.stringify(item).replace(/"/g, '&quot;'); // Sichereres Escaping für Attribute
    return `
        <button class="btn btn-sm btn-outline-secondary me-1" onclick='editMasterData("${resourceName}", ${itemJson})'><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger" onclick='deleteMasterData("${resourceName}", "${pkField}", ${id})'><i class="bi bi-trash"></i></button>
    `;
}

// ANGEPASST: Befüllt Formular, inkl. neuer Modell-Felder
function editMasterData(resourceName, item) {
  const formPrefix = formPrefixes[resourceName];
  const formId = formIds[resourceName];
  const pkField = pkFields[resourceName];     // <— NEU
  const form = document.getElementById(formId);
  if (!form) return;

  form.reset();

  // Primärschlüssel in hidden Feld setzen
  const idField = form.querySelector(`#${formPrefix}-${pkField}`);
  if (idField) idField.value = item[pkField];

  // Alle bekannten Felder ins Formular übertragen
  for (const key in item) {
    const input = document.getElementById(`${formPrefix}-${key}`);
    if (!input) continue;

    if (input.type === 'checkbox') {
      input.checked = !!Number(item[key]);
    } else if (resourceName === 'models' && key === 'price_cents') {
      const priceInput = document.getElementById('model-price');
      if (priceInput) priceInput.value = centsToEurosStr(item[key]);
    } else if (input.type === 'date') {
      input.value = item[key] ? String(item[key]).slice(0, 10) : '';
    } else {
      input.value = item[key] ?? '';
    }
  }
}


function createEditableCell(resource, id, field, value) {
    const displayValue = escapeHtml(value || '-');
    const inputValue = escapeAttr(value || ''); // escapeAttr für 'value' Attribut

    return `
        <div class="editable-cell" onclick="switchToEditMode(this)">
            <span class="cell-text">${displayValue}</span>
            <input type="text"
                   class="form-control form-control-sm cell-input d-none"
                   value="${inputValue}"
                   data-resource="${resource}"
                   data-id="${id}"
                   data-field="${field}"
                   onblur="saveInlineChange(this)"
                   onkeydown="handleInputKeyDown(event, this)">
        </div>`;
}


async function deleteMasterData(resourceName, pkField, id) { /* ... (unverändert) ... */
     if (!confirm(`Soll der Eintrag #${id} wirklich gelöscht werden?`)) return;
    try {
        await apiFetch(`/api/master-data/${resourceName}/${id}`, { method: 'DELETE' });
        // Lade die richtige Ressource neu
        const endpoint = (resourceName === 'models') ? 'models_with_details' : resourceName;
        loadMasterData(endpoint, resourceName);
    } catch (error) {
        alert(`Löschen fehlgeschlagen! ${error.message}`);
    }
}

// ANGEPASST: Liest Formular aus, inkl. neuer Modell-Felder
async function handleFormSubmit(event, resourceName, pkField) {
    event.preventDefault();
    const form = event.target;
    const formPrefix = formPrefixes[resourceName];
    const idField = form.querySelector(`#${formPrefix}-${pkField}`);
    const id = idField ? idField.value : null; // ID holen oder null
    const isUpdate = !!id;
    const url = isUpdate ? `/api/master-data/${resourceName}/${id}` : `/api/master-data/${resourceName}`;
    const method = isUpdate ? 'PUT' : 'POST';

    const body = {};
    // Iteriere über alle Elemente mit passender ID im Formular
    form.querySelectorAll(`[id^="${formPrefix}-"]`).forEach(input => {
        // Ignoriere das ID-Feld selbst und Submit-Buttons
        if (input.type === 'submit' || input.id === `${formPrefix}-${pkField}`) return;

        const key = input.id.replace(`${formPrefix}-`, '');

        if (input.type === 'checkbox') {
            body[key] = input.checked ? 1 : 0;
        // *** NEU: Spezielle Behandlung für Preis (Euro String -> Cents) ***
        } else if (resourceName === 'models' && input.id === 'model-price') {
             body['price_cents'] = eurosToCents(input.value); // Speichere als price_cents
        // *** ENDE NEU ***
        } else if (input.type === 'number') {
            // Stelle sicher, dass leere Zahlenfelder als null gesendet werden
             body[key] = input.value === '' ? null : Number(input.value);
        } else {
             body[key] = input.value.trim() === '' ? null : input.value.trim(); // Leere Strings als null
        }
    });

     // *** NEU: Entferne das temporäre 'price'-Feld, falls es existiert ***
     if (body.hasOwnProperty('price')) {
         delete body.price;
     }

    try {
        await apiFetch(url, { method, body: JSON.stringify(body) });
        form.reset();
        if (idField) idField.value = ''; // ID-Feld nach Erfolg leeren

        // Lade die richtige Ressource neu
        const endpoint = (resourceName === 'models') ? 'models_with_details' : resourceName;
        loadMasterData(endpoint, resourceName);
    } catch (error) {
        alert(`Speichern fehlgeschlagen: ${error.message}`);
    }
}


async function moveRoom(roomId, direction) { /* ... (unverändert) ... */
    try {
        await apiFetch(`/api/master-data/rooms/${roomId}/move`, { method: 'POST', body: JSON.stringify({ direction }) });
        await loadMasterData('rooms');
        const rowElement = document.querySelector(`tr[data-room-id="${roomId}"]`);
        if (rowElement) rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (error) {
        alert('Raum konnte nicht verschoben werden: ' + (error.message || 'Unbekannter Fehler'));
    }
}
async function populateCategorySelect() { /* ... (unverändert) ... */
    const select = document.getElementById('model-category_id');
    if(!select) return; // Frühzeitiger Ausstieg, falls Element nicht da
    try {
        const categories = await apiFetch('/api/master-data/device_categories');
        select.innerHTML = '<option value="">Bitte wählen...</option>';
        categories.forEach(cat => {
            select.innerHTML += `<option value="${cat.category_id}">${escapeHtml(cat.category_name)}</option>`;
        });
    } catch(error) {
        select.innerHTML = '<option value="">Fehler beim Laden</option>';
    }
}