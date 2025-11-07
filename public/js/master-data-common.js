// public/js/master-data-common.js
// Geteilte Funktionen für alle Stammdaten-Seiten

// Sicherstellen, dass Hilfsfunktionen aus devices.js verfügbar sind
if (typeof apiFetch === 'undefined' || typeof escapeHtml === 'undefined' || typeof centsToEurosStr === 'undefined' || typeof eurosToCents === 'undefined') {
    console.warn("Wichtige Hilfsfunktionen (apiFetch, escapeHtml, centsToEurosStr, eurosToCents) nicht gefunden. Stellen Sie sicher, dass devices.js vor master-data-common.js geladen wird.");
}

window.escapeAttr = s => String(s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// *** DATUMSKONVERTIERUNG (Für Modelle) ***
window.formatDateToDDMMYYYY = function(isoDate) {
    if (!isoDate) return '';
    const datePart = String(isoDate).split('T')[0];
    const parts = datePart.split('-');
    if (parts.length === 3 && parts[0].length === 4) {
        return `${parts[2]}.${parts[1]}.${parts[0]}`;
    }
    return '';
}

window.formatDateToYYYYMMDD = function(deDate) {
    if (!deDate || String(deDate).trim() === '') return null;
    const parts = String(deDate).trim().split('.');
    if (parts.length === 3) {
         const d = parts[0].padStart(2, '0');
         const m = parts[1].padStart(2, '0');
         const y = parts[2];
         if (y.length !== 4) return null;
         const isoStr = `${y}-${m}-${d}`;
         const date = new Date(isoStr);
         if (date && date.toISOString().startsWith(isoStr)) {
             return isoStr;
         }
    }
    return null;
}

// *** INLINE-EDITING FUNKTIONEN ***
window.switchToEditMode = function(cellDiv) {
    const textSpan = cellDiv.querySelector('.cell-text');
    const inputField = cellDiv.querySelector('.cell-input');
    if (textSpan && inputField) {
        textSpan.classList.add('d-none');
        inputField.classList.remove('d-none');
        inputField.focus();
        inputField.select();
    }
}

window.saveInlineChange = async function(inputElement) {
    const resource = inputElement.getAttribute('data-resource');
    const id = inputElement.getAttribute('data-id');
    const field = inputElement.getAttribute('data-field');
    const newValue = inputElement.value;

    const cellDiv = inputElement.closest('.editable-cell');
    const textSpan = cellDiv.querySelector('.cell-text');
    const originalValue = textSpan.dataset.originalValue || ''; // Speichern des 'echten' Werts

    // Prüfen, ob sich der Wert geändert hat
    if (newValue === originalValue) {
        inputElement.classList.add('d-none');
        textSpan.classList.remove('d-none');
        return;
    }

    // Leeren Wert in 'null' umwandeln (wichtig für die DB)
    let valueToSend = newValue === '' ? null : newValue;
    let displayValue = newValue || '-';

    // Spezielle Konvertierung für Datums- und Preis-Felder
    const dataType = inputElement.getAttribute('data-type');
    if (dataType === 'date') {
        valueToSend = formatDateToYYYYMMDD(newValue);
        if (newValue.trim() !== '' && valueToSend === null) {
             alert(`Ungültiges Datum: ${newValue}. Bitte tt.mm.jjjj verwenden.`);
             inputElement.value = originalValue; // Zurücksetzen
             inputElement.classList.add('d-none');
             textSpan.classList.remove('d-none');
             return;
        }
        displayValue = formatDateToDDMMYYYY(valueToSend) || '-';
    } else if (dataType === 'price') {
        valueToSend = eurosToCents(newValue);
        displayValue = centsToEurosStr(valueToSend) || '-';
    }

    try {
        await apiFetch(`/api/master-data/${resource}/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ [field]: valueToSend })
        });
        
        textSpan.textContent = displayValue;
        textSpan.dataset.originalValue = valueToSend; // Neuen 'echten' Wert speichern (z.B. Cents oder ISO-Datum)
    } catch (error) {
        alert(`Speichern fehlgeschlagen: ${error.message}`);
        inputElement.value = originalValue; // Bei Fehler auf alten Wert zurücksetzen
    } finally {
        inputElement.classList.add('d-none');
        textSpan.classList.remove('d-none');
    }
}

window.handleInputKeyDown = function(event, inputElement) {
    if (event.key === 'Enter') {
        event.preventDefault();
        inputElement.blur();
    } else if (event.key === 'Escape') {
        const cellDiv = inputElement.closest('.editable-cell');
        const textSpan = cellDiv.querySelector('.cell-text');
        inputElement.value = textSpan.dataset.originalValue || ''; // Auf Originalwert zurücksetzen
        inputElement.classList.add('d-none');
        textSpan.classList.remove('d-none');
    }
}

// Erstellt die Zelle für Inline-Bearbeitung
//  data-type für spezielle Konvertierungen (price, date)
window.createEditableCell = function(resource, id, field, value, displayValue = null, dataType = 'text') {
 const finalDisplayValue = escapeHtml(displayValue !== null ? (displayValue ?? '-') : (value ?? '-'));
    
    const inputValue = escapeAttr(value ?? ''); // '??' auch hier verwenden
    
    // Speichert den "echten" Wert (z.B. Cents, ISO-Datum) im Text-Span
    // während der Input-Wert der "Anzeige"-Wert ist (z.B. Euro-String, tt.mm.jjjj)
    let originalValueForSpan = inputValue;
    let inputValueForInput = inputValue;

    if (dataType === 'date') {
        // value = ISO (2025-10-25)
        // inputValueForInput = tt.mm.jjjj (25.10.2025)
        inputValueForInput = formatDateToDDMMYYYY(value);
        originalValueForSpan = inputValueForInput; // Hier ist der Anzeige-Wert der Originalwert
    } else if (dataType === 'price') {
        // value = Cents (14999)
        // inputValueForInput = Euro (149.99)
        inputValueForInput = centsToEurosStr(value);
        originalValueForSpan = inputValueForInput;
    }

    return `
        <div class="editable-cell" onclick="switchToEditMode(this)">
            <span class="cell-text" data-original-value="${escapeAttr(originalValueForSpan)}">${finalDisplayValue}</span>
            <input type="text"
                   class="form-control form-control-sm cell-input d-none"
                   value="${escapeAttr(inputValueForInput)}"
                   data-resource="${resource}"
                   data-id="${id}"
                   data-field="${field}"
                   data-type="${dataType}"
                   onblur="saveInlineChange(this)"
                   onkeydown="handleInputKeyDown(event, this)">
        </div>`;
}

// *** AKTIONEN (Löschen) ***

const pkFields = {
  rooms: 'room_id',
  models: 'model_id',
  device_categories: 'category_id'
};

// Erstellt nur noch den Löschen-Button, da Bearbeiten inline erfolgt
window.createActionButtons = function(resourceName, pkField, id) {
    return `
        <button class="btn btn-sm btn-outline-danger" onclick='deleteMasterData("${resourceName}", "${pkField}", ${id})'><i class="bi bi-trash"></i></button>
    `;
}

window.deleteMasterData = async function(resourceName, pkField, id) {
     if (!confirm(`Soll der Eintrag #${id} wirklich gelöscht werden?`)) return;
    try {
        await apiFetch(`/api/master-data/${resourceName}/${id}`, { method: 'DELETE' });
        // Die Seite muss die Funktion 'loadData' global bereitstellen
        if (typeof window.loadData === 'function') {
            window.loadData();
        } else {
            location.reload(); // Fallback
        }
    } catch (error) {
        alert(`Löschen fehlgeschlagen! ${error.message}`);
    }
}