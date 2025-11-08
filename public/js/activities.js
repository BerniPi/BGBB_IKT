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

function renderLogEntry(log) {
  // Zeitstempel lesbar formatieren
  const ts = new Date(log.timestamp).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const user = escapeHtml(log.username || 'Unbekannt');
  const actionBadge = getActionBadge(log.action_type);

  // --- MODIFIZIERT: Objekt (z.B. "device #101") ---
  let entity = 'System';
    let room = '<span class="text-muted">—</span>';

  if (log.entity_type === 'device') {
    // --- Fall 1: Es ist ein GERÄT ---
    const model = escapeHtml(log.model_name || 'Unbek. Modell');
    const serial = escapeHtml(log.serial_number || `ID ${log.entity_id}`);
    entity = `${model}<br><small class="text-muted">${serial}</small>`;
    
    // Raum des GERÄTS (benutzt die umbenannten Felder)
    if (log.device_room_name || log.device_room_number) {
      const rName = escapeHtml(log.device_room_name || '');
      const rNum = escapeHtml(log.device_room_number || '');
      room = rNum ? `${rNum} (${rName})` : rName;
    }
  
  } else if (log.entity_type === 'task') {
    // --- Fall 2: Es ist ein TASK (NEU) ---
    // Zeige den Task-Namen (Text) an
    entity = escapeHtml(log.task_name || `Task ID ${log.entity_id}`);
    
    // Raum des TASKS
    if (log.task_room_name || log.task_room_number) {
      const rName = escapeHtml(log.task_room_name || '');
      const rNum = escapeHtml(log.task_room_number || '');
      room = rNum ? `${rNum} (${rName})` : rName;
    }

  } else if (log.entity_type) {
    // --- Fall 3: Fallback für andere Typen (room, model, etc.) ---
    entity = escapeHtml(log.entity_type);
    if (log.entity_id) {
      entity += ` <span class="text-muted">#${log.entity_id}</span>`;
    }
    // Raum bleibt '—'
  }

  let rowProps = "";
  const isDeleteAction = log.action_type.toUpperCase() === 'DELETE';

  // Mache die Zeile nur klickbar, wenn es KEINE "DELETE"-Aktion ist.
  if (log.entity_type === "device" && log.entity_id && !isDeleteAction) {
    rowProps = ` data-entity-type="device" data-entity-id="${log.entity_id}" class="clickable-log-row" title="Gerät ID ${log.entity_id} bearbeiten"`;
  
  } else if (log.entity_type === "task" && log.entity_id && !isDeleteAction) {
    rowProps = ` data-entity-type="task" data-entity-id="${log.entity_id}" class="clickable-log-row" title="Task ID ${log.entity_id} bearbeiten"`;
  }

// --- MODIFIKATION: Details lesbar machen (NEUE LOGIK) ---
  let details = '<span class="text-muted">—</span>';
  if (log.details_json) {
    try {
      const d = JSON.parse(log.details_json);
      const action = log.action_type.toUpperCase();

      // Helfer-Funktion
      const formatVal = (val) => {
        if (val === null || val === undefined || val === "") {
          return '<span class="text-muted fst-italic">[leer]</span>';
        }
        let s = String(val);
        // Notizen oder lange Texte kürzen
        if (s.length > 50 && s.includes(' ')) {
           s = s.substring(0, 50) + '...';
        }
        return escapeHtml(s);
      };

      // Basis-Stil für Zeilen
      const rowStyle = 'style="font-size: 0.9em; line-height: 1.3;"';
      let changesHtml = '';

      switch (action) {
        // Fall 1: UPDATE (Dein alter Code, funktioniert gut)
        case 'UPDATE':
          changesHtml = Object.keys(d).map(key => {
            const change = d[key]; // { old: "...", new: "..." }
            if (typeof change !== 'object' || change === null) return '';
            const oldVal = formatVal(change.old);
            const newVal = formatVal(change.new);
            return `
              <div class="mb-1" ${rowStyle}>
                <strong class="text-body-secondary">${escapeHtml(key)}:</strong><br>
                <span class="text-danger" style="text-decoration: line-through;">${oldVal}</span>
                <i class="bi bi-arrow-right-short mx-1"></i>
                <span class="text-success fw-medium">${newVal}</span>
              </div>
            `;
          }).join('');
          break;

        // Fall 2: CREATE (Zeigt neue Werte in grün)
        case 'CREATE':
          changesHtml = Object.keys(d).map(key => {
            const newVal = formatVal(d[key]);
            return `
              <div ${rowStyle}>
                <strong class="text-body-secondary">${escapeHtml(key)}:</strong>
                <span class="text-success ms-1">${newVal}</span>
              </div>
            `;
          }).join('');
          break;

        // Fall 3: DELETE (Zeigt alte Werte durchgestrichen)
        case 'DELETE':
          changesHtml = Object.keys(d).map(key => {
            const oldVal = formatVal(d[key]);
            return `
              <div ${rowStyle}>
                <strong class="text-body-secondary">${escapeHtml(key)}:</strong>
                <span class="text-danger ms-1" style="text-decoration: line-through;">${oldVal}</span>
              </div>
            `;
          }).join('');
          break;

        // Fall 4: BULK_UPDATE, IMPORT und alle anderen (Standard Key-Value-Liste)
        case 'BULK_UPDATE':
        case 'IMPORT':
        default:
          if (typeof d === 'object' && d !== null && !Array.isArray(d)) {
            changesHtml = Object.keys(d).map(key => {
              const val = formatVal(d[key]);
              return `
                <div ${rowStyle}>
                  <strong class="text-body-secondary">${escapeHtml(key)}:</strong>
                  <span class="text-body ms-1">${val}</span>
                </div>
              `;
            }).join('');
          } else {
            // Fallback, wenn 'd' kein Objekt ist (z.B. nur eine Zahl)
            details = `<pre class="mb-0" style="font-size: 0.8em;">${escapeHtml(JSON.stringify(d, null, 2))}</pre>`;
          }
          break;
      }
      
      // Setze 'details', wenn 'changesHtml' generiert wurde
      if (changesHtml) {
          details = changesHtml || '<span class="text-muted">(Keine Details)</span>';
      }
      // (Sonst bleibt 'details' der <pre>-Tag vom 'default'-Fall)

    } catch (e) {
      console.error("Fehler beim Parsen der Log-Details:", e, log.details_json);
      details = '<span class="text-danger">Log-Details ungültig</span>';
    }
  }
  // --- ENDE MODIFIKATION ---


  // Das <tr>-Rendering bleibt gleich (verwendet die neuen 'entity' und 'room' Variablen)
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