 // NEU: Übersetzungs-Map für Detail-Felder
const detailKeyTranslations = {
// Gerätefelder (unverändert)
  model_id: "Modell",
  hostname: "Hostname",
  serial_number: "Seriennummer",
  inventory_number: "Inventarnummer",
  mac_address: "MAC-Adresse",
  ip_address: "IP-Adresse",
  added_at: "Hinzugefügt am",
  decommissioned_at: "Ausgeschieden am",
  purchase_date: "Kaufdatum",
  price_cents: "Preis",
  warranty_months: "Garantie (Monate)",
  last_cleaned: "Zuletzt gereinigt",
  last_inspected: "Zuletzt kontrolliert",
  
  // Log-spezifische Felder (aus DELETE)
  model_name: "Modell",
  last_room: "Letzter Raum",

  // --- NEU: Task-Felder ---
  task: "Aufgabe",
  task_id: "Task ID",
  category: "Kategorie",
  priority: "Priorität",
  status: "Status", // 'status' ist jetzt für Tasks & Geräte gültig
  date: "Datum",
  reported_by: "Gemeldet von",
  assigned_to: "Zugewiesen an",
  completed_at: "Erledigt am",
  completed_by: "Erledigt von",
  notes: "Notizen", // 'notes' ist jetzt für Tasks & Geräte gültig
  room_id: "Raum",
  
  // Task-Löschfelder (falls sie auftauchen)
  created_at: "Erstellt am",
  updated_at: "Geändert am",
  entered_by: "Erstellt von",

  // Bulk Felder
  action: "Aktion",
  count: "Anzahl",
};

/**
 * NEU: Helfer-Funktion zum Übersetzen
 * Nimmt einen DB-Key und gibt das deutsche Label zurück.
 * @param {string} key - z.B. "serial_number"
 * @returns {string} - z.B. "Seriennummer"
 */
function translateDetailKey(key) {
  // Schlägt in der Map nach. Wenn nichts gefunden wird,
  // wird der Original-Key (sicher escaped) zurückgegeben.
  return detailKeyTranslations[key] || escapeHtml(key);
}

document.addEventListener("DOMContentLoaded", async () => {

 
  // apiFetch ist global verfügbar (aus devices.js)
  if (typeof apiFetch === "undefined") {
    console.error("apiFetch ist nicht definiert. Stelle sicher, dass main.js oder devices.js geladen wird.");
    return;
  }

  const tbody = document.getElementById("log-table-body");
 tbody.innerHTML = '<tr><td colspan="6" class="text-center">Lade Protokoll...</td></tr>';
  try {
    const logs = await apiFetch("/api/activity/log?limit=100");

   if (!logs.length) {
      // --- MODIFIZIERT: colspan="6" ---
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Keine Einträge gefunden.</td></tr>';
      return;
    }

    tbody.innerHTML = logs.map(renderLogEntry).join("");

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">Fehler: ${err.message}</td></tr>`;
  }

  // === NEU: Globaler Klick-Listener für die Tabelle ===
  tbody.addEventListener("click", (e) => {
    // Finde die geklickte TR-Zeile
    const row = e.target.closest("tr.clickable-log-row");
    if (!row) return; // Klick war nicht auf einer klickbaren Zeile

    const type = row.dataset.entityType;
    const id = row.dataset.entityId;

    // Weiterleiten zur entsprechenden Seite mit einem URL-Parameter
    if (type === "device" && id) {
      window.location.href = `/devices?edit_id=${id}`;
    } else if (type === "task" && id) {
      window.location.href = `/tasks?edit_id=${id}`;
    }
  });
  // === ENDE NEU ===
});

// activities.js

function renderLogEntry(log) {
  // 1. Zeitstempel, Benutzer, Aktion (unverändert)
  const ts = new Date(log.timestamp).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  const user = escapeHtml(log.username || 'Unbekannt');
  const actionBadge = getActionBadge(log.action_type);

  // 2. Aktionstyp und Details (aus JSON) FRÜHZEITIG bestimmen
  const isDeleteAction = log.action_type.toUpperCase() === 'DELETE';
  let detailsData = null; // Wird die geparsten JSON-Daten enthalten
  
  if (log.details_json) {
    try {
      detailsData = JSON.parse(log.details_json);
    } catch (e) {
      console.error("Fehler beim Parsen der Log-Details:", e, log.details_json);
    }
  }

  // 3. Objekt (entity) und Raum (room) bestimmen
  let entity = 'System';
  let room = '<span class="text-muted">—</span>';

  if (log.entity_type === 'device') {
    
    // Fall A: DELETE-Aktion. Daten MÜSSEN aus den Details (detailsData) kommen.
    if (isDeleteAction && detailsData) {
      const model = escapeHtml(detailsData.model_name || 'Gelöschtes Modell');
      const identifier = escapeHtml(
        detailsData.serial_number || 
        detailsData.hostname || 
        detailsData.inventory_number || 
        `ID ${log.entity_id}`
      );
      entity = `${model}<br><small class="text-muted">${identifier}</small>`;
      
      if (detailsData.last_room) {
        room = escapeHtml(detailsData.last_room);
      }
    } 
    // Fall B: CREATE/UPDATE-Aktion. Daten kommen aus dem LEFT JOIN.
    else if (!isDeleteAction) { 
      const model = escapeHtml(log.model_name || 'Unbek. Modell');
      const serial = escapeHtml(log.serial_number || `ID ${log.entity_id}`);
      entity = `${model}<br><small class="text-muted">${serial}</small>`;
      
      if (log.device_room_name || log.device_room_number) {
        const rName = escapeHtml(log.device_room_name || '');
        const rNum = escapeHtml(log.device_room_number || '');
        room = rNum ? `${rNum} (${rName})` : rName;
      }
    }
  
  } else if (log.entity_type === 'task') {
    entity = escapeHtml(log.task_name || `Task ID ${log.entity_id}`);
    if (log.task_room_name || log.task_room_number) {
      const rName = escapeHtml(log.task_room_name || '');
      const rNum = escapeHtml(log.task_room_number || '');
      room = rNum ? `${rNum} (${rName})` : rName;
    }

  } else if (log.entity_type) {
    entity = escapeHtml(log.entity_type);
    if (log.entity_id) {
      entity += ` <span class="text-muted">#${log.entity_id}</span>`;
    }
  }

  // 4. Klickbare Zeile (Logik unverändert)
  let rowProps = "";
  if (log.entity_type === "device" && log.entity_id && !isDeleteAction) {
    rowProps = ` data-entity-type="device" data-entity-id="${log.entity_id}" class="clickable-log-row" title="Gerät ID ${log.entity_id} bearbeiten"`;
  } else if (log.entity_type === "task" && log.entity_id && !isDeleteAction) {
    rowProps = ` data-entity-type="task" data-entity-id="${log.entity_id}" class="clickable-log-row" title="Task ID ${log.entity_id} bearbeiten"`;
  }

  // 5. Details-Spalte (verwendet 'detailsData' wieder)
  let details = '<span class="text-muted">—</span>';
  if (detailsData) {
    try {
      const d = detailsData;
      const action = log.action_type.toUpperCase();

      // Helfer-Funktion (unverändert)
      const formatVal = (val) => {
        if (val === null || val === undefined || val === "") {
          return '<span class="text-muted fst-italic">[leer]</span>';
        }
        let s = String(val);
        if (s.length > 50 && s.includes(' ')) {
           s = s.substring(0, 50) + '...';
        }
        return escapeHtml(s);
      };
      
      const rowStyle = 'style="font-size: 0.9em; line-height: 1.3;"';
      let changesHtml = '';

      switch (action) {
        case 'UPDATE':
          changesHtml = Object.keys(d).map(key => {
            const change = d[key]; 
            if (typeof change !== 'object' || change === null) return '';
            const oldVal = formatVal(change.old);
            const newVal = formatVal(change.new);
            
            // *** HIER IST DIE ÄNDERUNG ***
            const germanKey = translateDetailKey(key);

            return `
              <div class="mb-1" ${rowStyle}>
                <strong class="text-body-secondary">${germanKey}:</strong><br>
                <span class="text-danger" style="text-decoration: line-through;">${oldVal}</span>
                <i class="bi bi-arrow-right-short mx-1"></i>
                <span class="text-success fw-medium">${newVal}</span>
              </div>
            `;
          }).join('');
          break;

        case 'CREATE':
          changesHtml = Object.keys(d).map(key => {
            const newVal = formatVal(d[key]);
            
            // *** HIER IST DIE ÄNDERUNG ***
            const germanKey = translateDetailKey(key);

            return `
              <div ${rowStyle}>
                <strong class="text-body-secondary">${germanKey}:</strong>
                <span class="text-success ms-1">${newVal}</span>
              </div>
            `;
          }).join('');
          break;

        case 'DELETE':
          changesHtml = Object.keys(d).map(key => {
            const oldVal = formatVal(d[key]);
            
            // *** HIER IST DIE ÄNDERUNG ***
            const germanKey = translateDetailKey(key);
            
            return `
              <div ${rowStyle}>
                <strong class="text-body-secondary">${germanKey}:</strong>
                <span class="text-danger ms-1" style="text-decoration: line-through;">${oldVal}</span>
              </div>
            `;
          }).join('');
          break;

        case 'BULK_UPDATE':
        case 'IMPORT':
        default:
          if (typeof d === 'object' && d !== null && !Array.isArray(d)) {
            changesHtml = Object.keys(d).map(key => {
              const val = formatVal(d[key]);
              
              // *** HIER IST DIE ÄNDERUNG ***
              const germanKey = translateDetailKey(key);
              
              return `
                <div ${rowStyle}>
                  <strong class="text-body-secondary">${germanKey}:</strong>
                  <span class="text-body ms-1">${val}</span>
                </div>
              `;
            }).join('');
          } else {
            details = `<pre class="mb-0" style="font-size: 0.8em;">${escapeHtml(JSON.stringify(d, null, 2))}</pre>`;
          }
          break;
      }
      
      if (changesHtml) {
          details = changesHtml || '<span class="text-muted">(Keine Details)</span>';
      }

    } catch (e) {
      console.error("Fehler beim Rendern der Log-Details:", e);
      details = '<span class="text-danger">Log-Details ungültig</span>';
    }
  }

  // 6. Das <tr>-Rendering (unverändert)
  return `
    <tr ${rowProps}>
      <td class="text-nowrap">${ts}</td>
      <td class="text-nowrap">${user}</td>
      <td class="text-nowrap">${actionBadge}</td>
      <td>${entity}</td>
      <td>${room}</td>
      <td>${details}</td>
    </tr>
  `;
}

function getActionBadge(action) {
  const type = String(action).toUpperCase();
  let color = 'secondary';
  if (type === 'CREATE') color = 'success';
  if (type === 'UPDATE' || type === 'BULK_UPDATE') color = 'primary';
  if (type === 'DELETE') color = 'danger';
  if (type === 'MOVE') color = 'info';
  return `<span class="badge text-bg-${color}">${escapeHtml(type)}</span>`;
}

// (Die escapeHtml-Funktion aus devices.js hierher kopieren,
//  oder sicherstellen, dass sie global geladen wird)
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}