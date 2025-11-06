// public/js/master-data-models.js

// HIER: Umbenannt zu __modelSort, um Konflikt mit devices.js zu beheben
let __modelSort = { col: "category_name", dir: "asc" };

document.addEventListener('DOMContentLoaded', () => {
    window.loadData = loadModels; // Global verfügbar machen
    loadModels();
    populateCategorySelect(); // Modal-Dropdown füllen
    
    document.getElementById('modelForm').addEventListener('submit', handleModelFormSubmit);
    bindSortEvents();
});

function bindSortEvents() {
  document.querySelectorAll("th.sortable-header").forEach(th => {
    th.style.cursor = "pointer";
    th.addEventListener("click", () => {
      const col = th.getAttribute("data-sort");
      if (!col) return;
      
      // HIER: __modelSort verwenden
      if (__modelSort.col === col) {
        __modelSort.dir = __modelSort.dir === "asc" ? "desc" : "asc";
      } else {
        __modelSort.col = col;
        __modelSort.dir = "asc";
      }
      loadModels(); // Tabelle mit neuer Sortierung laden
    });
  });
}

function updateSortIndicators() {
    const table = document.querySelector("#models-table-body").closest('table');
    if (!table) return;

    table.querySelectorAll(".sortable-header").forEach(header => {
        header.classList.remove("sort-asc", "sort-desc");
        const headerSortKey = header.dataset.sort;
        
        // HIER: __modelSort verwenden
        if (headerSortKey === __modelSort.col) {
            header.classList.add(__modelSort.dir === "asc" ? "sort-asc" : "sort-desc");
        }
    });
}

async function loadModels() {
    updateSortIndicators();
    const tbody = document.getElementById('models-table-body');
    tbody.innerHTML = `<tr><td colspan="12" class="text-center">Lade...</td></tr>`;

    // Sortierparameter an die URL anhängen
    const params = new URLSearchParams();
    // HIER: __modelSort verwenden
    if (__modelSort.col) params.set("sort", __modelSort.col);
    if (__modelSort.dir) params.set("dir", __modelSort.dir);

    try {
        const data = await apiFetch('/api/master-data/models_with_details');

        // Frontend-Sortierung
        data.sort((a, b) => {
            // HIER: __modelSort verwenden
            let valA = a[__modelSort.col];
            let valB = b[__modelSort.col];

            if (typeof valA === 'number' || typeof valB === 'number') {
                valA = parseFloat(valA || 0);
                valB = parseFloat(valB || 0);
            } else {
                valA = String(valA || '').toLowerCase();
                valB = String(valB || '').toLowerCase();
            }

            // HIER: __modelSort verwenden
            if (valA < valB) return __modelSort.dir === 'asc' ? -1 : 1;
            if (valA > valB) return __modelSort.dir === 'asc' ? 1 : -1;
            return 0;
        });


        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="12" class="text-center text-muted">Keine Modelle vorhanden.</td></tr>`;
            return;
        }
        tbody.innerHTML = data.map(renderModelRow).join('');
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="12" class="text-center text-danger">Laden fehlgeschlagen: ${error.message}</td></tr>`;
    }
}

function renderModelRow(item) {
    // Zellen für Inline-Bearbeitung
    const cat = escapeHtml(item.category_name || '-');
    const manufacturer = createEditableCell('models', item.model_id, 'manufacturer', item.manufacturer);
    const type = createEditableCell('models', item.model_id, 'type', item.type);
    const model_name = createEditableCell('models', item.model_id, 'model_name', item.model_name);
    const model_number = createEditableCell('models', item.model_id, 'model_number', item.model_number);
    const devices = `${item.active_devices} (${item.total_devices})`;
    const currentNetworkVal = Number(item.has_network);
    const networkIcon = currentNetworkVal === 1
        ? '<i class="bi bi-wifi text-success" title="Netzwerkfähig (klicken zum Ändern)"></i>'
        : '<i class="bi bi-wifi-off text-muted" title="Nicht Netzwerkfähig (klicken zum Ändern)"></i>';
    
    // Erstellt ein klickbares Span-Element, das die Funktion toggleNetworkStatus aufruft
    const network = `
        <span style="cursor: pointer;" onclick="toggleNetworkStatus(this, ${item.model_id}, ${currentNetworkVal})">
            ${networkIcon}
        </span>
    `;
    const purchase_date = createEditableCell('models', item.model_id, 'purchase_date', item.purchase_date, formatDateToDDMMYYYY(item.purchase_date), 'date');
    const price = createEditableCell('models', item.model_id, 'price_cents', item.price_cents, centsToEurosStr(item.price_cents), 'price');
    const warranty = createEditableCell('models', item.model_id, 'warranty_months', item.warranty_months, null, 'text');
    const maintenance = createEditableCell('models', item.model_id, 'maintenance_interval_months', item.maintenance_interval_months, null, 'text');

    return `
        <tr>
            <td>${cat}</td>
            <td>${manufacturer}</td>
            <td>${type}</td>
            <td>${model_name}</td>
            <td>${model_number}</td>
            <td>${devices}</td>
            <td>${network}</td>
            <td>${purchase_date}</td>
            <td>${price}</td>
            <td>${warranty}</td>
            <td>${maintenance}</td>
            <td>${createActionButtons('models', 'model_id', item.model_id)}</td>
        </tr>
    `;
}

// Speichert das "Neues Modell anlegen"-Modal
async function handleModelFormSubmit(event) {
    event.preventDefault();
    const form = event.target;

    try {
        const isoDate = formatDateToYYYYMMDD(document.getElementById('model-purchase_date').value);
        if (document.getElementById('model-purchase_date').value.trim() !== '' && isoDate === null) {
            alert("Das Kaufdatum ist ungültig. Bitte tt.mm.jjjj verwenden.");
            return;
        }

        const body = {
            category_id: document.getElementById('model-category_id').value,
            manufacturer: document.getElementById('model-manufacturer').value || null,
            type: document.getElementById('model-type').value || null,
            model_name: document.getElementById('model-model_name').value || null,
            model_number: document.getElementById('model-model_number').value,
            has_network: document.getElementById('model-has_network').value,
            purchase_date: isoDate,
            price_cents: eurosToCents(document.getElementById('model-price').value),
            warranty_months: document.getElementById('model-warranty_months').value || null,
            maintenance_interval_months: document.getElementById('model-maintenance_interval_months').value || null,
        };

        await apiFetch('/api/master-data/models', {
            method: 'POST',
            body: JSON.stringify(body)
        });
        
        form.reset();
        bootstrap.Modal.getInstance(document.getElementById('modelModal')).hide();
        loadModels(); // Tabelle neu laden
    } catch (error) {
        alert(`Speichern fehlgeschlagen: ${error.message}`);
    }
}

// Füllt das Kategorie-Dropdown im Modal
async function populateCategorySelect() {
    const select = document.getElementById('model-category_id');
    if(!select) return;
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

// *** NEUE FUNKTION HINZUGEFÜGT ***
/**
 * Schaltet den Netzwerk-Status (has_network) für ein Modell um.
 * Wird per onclick von renderModelRow aufgerufen.
 */
window.toggleNetworkStatus = async function(element, modelId, currentValue) {
    // Den neuen Wert berechnen (1 -> 0, 0 -> 1)
    const newValue = 1 - Number(currentValue);
    
    // HTML für die Icons
    const icon_on = '<i class="bi bi-wifi text-success" title="Netzwerkfähig (klicken zum Ändern)"></i>';
    const icon_off = '<i class="bi bi-wifi-off text-muted" title="Nicht Netzwerkfähig (klicken zum Ändern)"></i>';
    const newIconHtml = (newValue === 1) ? icon_on : icon_off;

    try {
        // API-Aufruf, um den neuen Wert zu speichern
        await apiFetch(`/api/master-data/models/${modelId}`, {
            method: 'PUT',
            body: JSON.stringify({ has_network: newValue }) // Sendet NUR das geänderte Feld
        });

        // Bei Erfolg: Icon im DOM aktualisieren
        element.innerHTML = newIconHtml;
        
        // WICHTIG: Den onclick-Handler aktualisieren, damit der nächste Klick
        // den dann *aktuellen* Wert (newValue) als 'currentValue' übergibt.
        element.setAttribute('onclick', `toggleNetworkStatus(this, ${modelId}, ${newValue})`);

    } catch (error) {
        alert(`Speichern fehlgeschlagen: ${error.message}`);
        // Bei einem Fehler wird das Icon nicht geändert
    }
}