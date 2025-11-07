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

  


  // Details lesbar machen (NEUE LOGIK)
  let details = '<span class="text-muted">—</span>';
  if (log.details_json) {
    // ... (Diese Logik bleibt unverändert) ...
    try {
      const d = JSON.parse(log.details_json);
      if (log.action_type === 'UPDATE' && typeof d === 'object' && d !== null && !Array.isArray(d)) {
        // ... (UPDATE-Formatierung) ...
        const changesHtml = Object.keys(d).map(key => {
          const change = d[key];
          const formatVal = (val) => { /*...*/ };
          const oldVal = formatVal(change.old);
          const newVal = formatVal(change.new);
          return `
            <div class="mb-1" style="font-size: 0.9em; line-height: 1.3;">
              <strong class="text-body-secondary">${escapeHtml(key)}:</strong><br>
              <span class="text-danger" style="text-decoration: line-through;">${oldVal}</span>
              <i class="bi bi-arrow-right-short mx-1"></i>
              <span class="text-success fw-medium">${newVal}</span>
            </div>
          `;
        }).join('');
        details = changesHtml || '<span class="text-muted">(Keine relevanten Änderungen)</span>';
      } else {
        details = `<pre class="mb-0" style="font-size: 0.8em;">${escapeHtml(JSON.stringify(d, null, 2))}</pre>`;
      }
    } catch (e) {
      details = '<span class="text-danger">Log-Details ungültig</span>';
    }
  }

  // Das <tr>-Rendering bleibt gleich (verwendet die neuen 'entity' und 'room' Variablen)
  return `
    <tr>
      <td class="text-nowrap">${ts} Uhr</td>
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