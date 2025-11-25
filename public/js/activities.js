// public/js/activities.js

// Übersetzungs-Map für Detail-Felder
const detailKeyTranslations = {
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
  delete_room_history: "Raum-Eintrag löschen",
  move_date: "Verschiebe-Datum",
  new_room_id: "Neuer Raum"
};

function translateDetailKey(key) {
  return detailKeyTranslations[key] || escapeHtml(key);
}

// Regex-Helfer
const isoDateOnlyRegex = /^\d{4}-\d{2}-\d{2}$/;

// Globaler Zähler
let currentLimit = 100;

document.addEventListener("DOMContentLoaded", async () => {
  if (typeof apiFetch === "undefined") {
    console.error("apiFetch ist nicht definiert.");
    return;
  }

  const tbody = document.getElementById("log-table-body");
  
  // Click-Listener für Zeilen
  tbody.addEventListener("click", (e) => {
    const row = e.target.closest("tr.clickable-log-row");
    if (!row) return; 
    const type = row.dataset.entityType;
    const id = row.dataset.entityId;
    if (type === "device" && id) window.location.href = `/devices?edit_id=${id}`;
    else if (type === "task" && id) window.location.href = `/tasks?edit_id=${id}`;
  });

  // Click-Listener für "Mehr laden"
  const btnMore = document.getElementById("btn-load-more");
  if(btnMore) {
    btnMore.addEventListener("click", async () => {
        const icon = btnMore.querySelector("i");
        icon.classList.add("bi-arrow-clockwise", "fa-spin"); 
        btnMore.disabled = true;
        
        currentLimit += 100;
        await loadLogs(currentLimit);
        
        btnMore.disabled = false;
        icon.classList.remove("fa-spin");
    });
  }
  
  // Initiales Laden
  await loadLogs(100);
});

async function loadLogs(limit) {
    const tbody = document.getElementById("log-table-body");
    
    // ÄNDERUNG: Tabelle nur beim ersten Aufruf (Start) leeren.
    // Beim "Nachladen" bleiben die alten Zeilen sichtbar, bis die neuen da sind.
    // Das verhindert das Springen des Scrollbalkens.
    if (limit === 100) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">Lade Daten...</td></tr>';
    }
    
    try {
        const response = await apiFetch(`/api/activity/log?limit=${limit}`);
        
        if (!response || !response.logs) throw new Error("Ungültige Antwort.");
        
        // Zähler aktualisieren
        const countSpan = document.getElementById("log-count");
        if (countSpan) {
            countSpan.textContent = limit; // Zeigt an, wie viele geladen wurden (z.B. 200)
        }
        
        const logs = response.logs;
        const rooms = response.rooms || [];
        const roomLookup = new Map();
        
        // Raum-Lookup Map bauen
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

        // Inhalt austauschen (Browser behält Scroll-Position bei, da die Tabelle nur länger wird)
        tbody.innerHTML = logs.map(log => renderLogEntry(log, roomLookup)).join("");

    } catch(err) {
        // Bei Fehler: Nur leeren, wenn es der erste Aufruf war.
        // Sonst Alert zeigen, damit die bisherigen Daten nicht verschwinden.
        if (limit === 100) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">Fehler: ${err.message}</td></tr>`;
        } else {
            alert(`Fehler beim Laden weiterer Daten: ${err.message}`);
        }
    }
}


function renderLogEntry(log, roomLookup = new Map()) {
  const ts = new Date(log.timestamp).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  const user = escapeHtml(log.username || 'Unbekannt');
  const actionBadge = getActionBadge(log.action_type);
  const isDeleteAction = log.action_type.toUpperCase() === 'DELETE';
  
  let detailsData = null; 
  if (log.details_json) {
    try { detailsData = JSON.parse(log.details_json); } catch (e) {}
  }

  let entity = 'System';
  let room = '<span class="text-muted">—</span>';

  // Entity & Room Logik
  if (log.entity_type === 'device') {
    if (isDeleteAction && detailsData) {
      const model = escapeHtml(detailsData.model_name || 'Gelöschtes Modell');
      const identifier = escapeHtml(detailsData.serial_number || detailsData.hostname || detailsData.inventory_number || `ID ${log.entity_id}`);
      entity = `${model}<br><small class="text-muted">${identifier}</small>`;
      if (detailsData.last_room) room = escapeHtml(detailsData.last_room);
    } else { 
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
    if (log.entity_id) entity += ` <span class="text-muted">#${log.entity_id}</span>`;
  }

  let rowProps = "";
  if (!isDeleteAction && log.entity_id) {
     if (log.entity_type === "device") rowProps = ` data-entity-type="device" data-entity-id="${log.entity_id}" class="clickable-log-row"`;
     else if (log.entity_type === "task") rowProps = ` data-entity-type="task" data-entity-id="${log.entity_id}" class="clickable-log-row"`;
  }

  // Details-Rendering
  let details = '<span class="text-muted">—</span>';
  if (detailsData) {
      const formatVal = (val, key) => {
        if (key === 'room_id' || key === 'new_room_id') {
           const r = roomLookup.get(String(val));
           return r ? r : escapeHtml(val);
        }
        if (val == null || val === "") return '<span class="text-muted fst-italic">[leer]</span>';
        if (typeof val === 'string' && isoDateOnlyRegex.test(val)) {
            const [y, m, d] = val.split('-');
            return `${d}.${m}.${y}`;
        }
        return escapeHtml(String(val));
      };

      const rowStyle = 'style="font-size: 0.9em; line-height: 1.3;"';
      let html = '';
      const act = log.action_type.toUpperCase();

      if (act === 'UPDATE') {
          html = Object.keys(detailsData).map(k => {
              const chg = detailsData[k];
              if(!chg || typeof chg !== 'object') return '';
              return `<div class="mb-1" ${rowStyle}>
                 <strong class="text-body-secondary">${translateDetailKey(k)}:</strong><br>
                 <span class="text-danger" style="text-decoration: line-through;">${formatVal(chg.old, k)}</span>
                 <i class="bi bi-arrow-right-short mx-1"></i>
                 <span class="text-success fw-medium">${formatVal(chg.new, k)}</span>
              </div>`;
          }).join('');
      } else if (act === 'CREATE' || act === 'DELETE') {
          const color = act === 'CREATE' ? 'text-success' : 'text-danger';
          const decor = act === 'DELETE' ? 'style="text-decoration: line-through;"' : '';
          html = Object.keys(detailsData).map(k => `
              <div ${rowStyle}>
                 <strong class="text-body-secondary">${translateDetailKey(k)}:</strong>
                 <span class="${color} ms-1" ${decor}>${formatVal(detailsData[k], k)}</span>
              </div>`).join('');
      } else {
           html = Object.keys(detailsData).map(k => `
              <div ${rowStyle}>
                 <strong class="text-body-secondary">${translateDetailKey(k)}:</strong>
                 <span class="text-body ms-1">${formatVal(detailsData[k], k)}</span>
              </div>`).join('');
      }
      if(html) details = html;
  }

  return `
    <tr ${rowProps}>
      <td class="text-nowrap">${ts}</td>
      <td class="text-nowrap">${user}</td>
      <td class="text-nowrap">${actionBadge}</td>
      <td>${entity}</td>
      <td>${room}</td>
      <td class="col-details">${details}</td>
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

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[m]);
}