// public/js/activities.js

// NEU: Übersetzungs-Map für Detail-Felder
const detailKeyTranslations = {
// ... (deine ganzen Übersetzungen bleiben unverändert) ...
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
  model_name: "Modell",
  last_room: "Letzter Raum",
  task: "Aufgabe",
  task_id: "Task ID",
  category: "Kategorie",
  priority: "Priorität",
  status: "Status",
  date: "Datum",
  reported_by: "Gemeldet von",
  assigned_to: "Zugewiesen an",
  completed_at: "Erledigt am",
  completed_by: "Erledigt von",
  notes: "Notizen",
  room_id: "Raum",
  created_at: "Erstellt am",
  updated_at: "Geändert am",
  entered_by: "Erstellt von",
  action: "Aktion",
  count: "Anzahl",
  from_date: "Ab-Datum",
  to_date: "Bis-Datum",
  deleted_entry: "Gelöschter Eintrag",
  delete_room_history: "Raum-Eintrag löschen"
};

/**
 * NEU: Helfer-Funktion zum Übersetzen
 * (unverändert)
 */
function translateDetailKey(key) {
  return detailKeyTranslations[key] || escapeHtml(key);
}

// === NEU: Regex-Helfer für Datumsformatierung ===
// Erkennt YYYY-MM-DD
const isoDateOnlyRegex = /^\d{4}-\d{2}-\d{2}$/;
// Erkennt YYYY-MM-DDTHH:mm... (voller Zeitstempel)
const isoTimestampRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
// ==================================================

document.addEventListener("DOMContentLoaded", async () => {
  // ... (dein ganzer DOMContentLoaded-Code bleibt unverändert) ...
 
  if (typeof apiFetch === "undefined") {
    console.error("apiFetch ist nicht definiert. Stelle sicher, dass main.js oder devices.js geladen wird.");
    return;
  }

  const tbody = document.getElementById("log-table-body");
  tbody.innerHTML = '<tr><td colspan="6" class="text-center">Lade Protokoll...</td></tr>';
  
  try {
    const response = await apiFetch("/api/activity/log?limit=100");
    
    if (!response || !response.logs) {
      throw new Error("Ungültige Antwort vom Server erhalten.");
    }
    
    const logs = response.logs;
    const rooms = response.rooms || [];

    const roomLookup = new Map();
    for (const room of rooms) {
      const rName = room.room_name || '';
      const rNum = room.room_number || '';
      const roomLabel = rNum ? `${rNum} (${rName})` : (rName || String(room.room_id));
      roomLookup.set(String(room.room_id), escapeHtml(roomLabel.trim().replace(" ()", "")));
    }


    if (!logs.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Keine Einträge gefunden.</td></tr>';
      return;
    }

    tbody.innerHTML = logs.map(log => renderLogEntry(log, roomLookup)).join("");

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">Fehler: ${err.message}</td></tr>`;
  }

  tbody.addEventListener("click", (e) => {
    const row = e.target.closest("tr.clickable-log-row");
    if (!row) return; 

    const type = row.dataset.entityType;
    const id = row.dataset.entityId;

    if (type === "device" && id) {
      window.location.href = `/devices?edit_id=${id}`;
    } else if (type === "task" && id) {
      window.location.href = `/tasks?edit_id=${id}`;
    }
  });
});


function renderLogEntry(log, roomLookup = new Map()) {
  // ... (Zeitstempel, Benutzer, Aktion, Entity, Raum... bleibt alles unverändert) ...
  const ts = new Date(log.timestamp).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  const user = escapeHtml(log.username || 'Unbekannt');
  const actionBadge = getActionBadge(log.action_type);
  const isDeleteAction = log.action_type.toUpperCase() === 'DELETE';
  let detailsData = null; 
  
  if (log.details_json) {
    try {
      detailsData = JSON.parse(log.details_json);
    } catch (e) {
      console.error("Fehler beim Parsen der Log-Details:", e, log.details_json);
    }
  }

  let entity = 'System';
  let room = '<span class="text-muted">—</span>';

  if (log.entity_type === 'device') {
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

  let rowProps = "";
  if (log.entity_type === "device" && log.entity_id && !isDeleteAction) {
    rowProps = ` data-entity-type="device" data-entity-id="${log.entity_id}" class="clickable-log-row" title="Gerät ID ${log.entity_id} bearbeiten"`;
  } else if (log.entity_type === "task" && log.entity_id && !isDeleteAction) {
    rowProps = ` data-entity-type="task" data-entity-id="${log.entity_id}" class="clickable-log-row" title="Task ID ${log.entity_id} bearbeiten"`;
  }


  // 5. Details-Spalte (HIER IST DIE ÄNDERUNG)
  let details = '<span class="text-muted">—</span>';
  if (detailsData) {
    try {
      const d = detailsData;
      const action = log.action_type.toUpperCase();

      // === MODIFIZIERT: formatVal kann jetzt DATUMSANGABEN formatieren ===
      const formatVal = (val, key) => {
        // 1. Raum-ID-Übersetzung (wie bisher)
        if (key === 'room_id' && (val !== null && val !== undefined && val !== "")) {
          const roomName = roomLookup.get(String(val));
          if (roomName) {
            return roomName; // Gibt "101 (Lager)" zurück (ist bereits escaped)
          }
          return escapeHtml(`[Gelöschter Raum: ID ${val}]`);
        }

        // 2. Leere Werte (wie bisher)
        if (val === null || val === undefined || val === "") {
          return '<span class="text-muted fst-italic">[leer]</span>';
        }

        // 3. === NEU: Datumsformatierung ===
        if (typeof val === 'string') {
          // Fall A: Reiner Datumsstring (YYYY-MM-DD)
          if (isoDateOnlyRegex.test(val)) {
            // Einfache String-Umkehrung, vermeidet Zeitzonenprobleme
            const [y, m, d] = val.split('-');
            return `${d}.${m}.${y}`; 
          }
          
          // Fall B: Voller Zeitstempel (z.B. created_at, updated_at)
          if (isoTimestampRegex.test(val)) {
            try {
               // formatiert als "15.11.2025, 10:30"
               return new Date(val).toLocaleString('de-DE', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
               });
            } catch (e) { /* fallback zum Standard-String */ }
          }
        }
        // === ENDE NEU ===

        // 4. Bisherige Logik für alle anderen Strings
        let s = String(val);
        if (s.length > 50 && s.includes(' ')) {
           s = s.substring(0, 50) + '...';
        }
        return escapeHtml(s);
      };
      
      const rowStyle = 'style="font-size: 0.9em; line-height: 1.3;"';
      let changesHtml = '';

      // Der Rest der renderLogEntry-Funktion (switch (action) ...)
      // bleibt ABSOLUT UNVERÄNDERT, da er jetzt automatisch
      // die korrigierte formatVal-Funktion nutzt.
      
      // ... (switch case 'UPDATE':) ...
      switch (action) {
        case 'UPDATE':
          changesHtml = Object.keys(d).map(key => {
            const change = d[key]; 
            if (typeof change !== 'object' || change === null) return '';
            
            const oldVal = formatVal(change.old, key); // Nutzt jetzt Datumsformatierung
            const newVal = formatVal(change.new, key); // Nutzt jetzt Datumsformatierung
            
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
      // ... (case 'CREATE':) ...
        case 'CREATE':
          changesHtml = Object.keys(d).map(key => {
            const newVal = formatVal(d[key], key); // Nutzt jetzt Datumsformatierung
            const germanKey = translateDetailKey(key);
            return `
              <div ${rowStyle}>
                <strong class="text-body-secondary">${germanKey}:</strong>
                <span class="text-success ms-1">${newVal}</span>
              </div>
            `;
          }).join('');
          break;
      // ... (case 'DELETE':) ...
        case 'DELETE':
          changesHtml = Object.keys(d).map(key => {
            const oldVal = formatVal(d[key], key); // Nutzt jetzt Datumsformatierung
            const germanKey = translateDetailKey(key);
            return `
              <div ${rowStyle}>
                <strong class="text-body-secondary">${germanKey}:</strong>
                <span class="text-danger ms-1" style="text-decoration: line-through;">${oldVal}</span>
              </div>
            `;
          }).join('');
          break;
      // ... (case 'BULK_UPDATE' / default:) ...
        case 'BULK_UPDATE':
        case 'IMPORT':
        default:
          if (typeof d === 'object' && d !== null && !Array.isArray(d)) {
            changesHtml = Object.keys(d).map(key => {
              const val = formatVal(d[key], key); // Nutzt jetzt Datumsformatierung
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
  // ... (unverändert) ...
  const type = String(action).toUpperCase();
  let color = 'secondary';
  if (type === 'CREATE') color = 'success';
  if (type === 'UPDATE' || type === 'BULK_UPDATE') color = 'primary';
  if (type === 'DELETE') color = 'danger';
  if (type === 'MOVE') color = 'info';
  return `<span class="badge text-bg-${color}">${escapeHtml(type)}</span>`;
}

function escapeHtml(s) {
  // ... (unverändert) ...
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}