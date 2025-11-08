// public/js/tasks.js

// Hilfsfunktion, falls nicht global vorhanden
if (typeof escapeHtml === "undefined") {
  window.escapeHtml = function (s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/[&<>"']/g, function (match) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[match];
    });
  };
}

/**
 * NEU: Prüft, ob ein 'edit_id' URL-Parameter vorhanden ist
 * und öffnet das Modal für diesen Task.
 */
async function checkUrlForTaskEdit() {
  const urlParams = new URLSearchParams(window.location.search);
  const taskIdToEdit = urlParams.get('edit_id');

  if (taskIdToEdit) {
    console.log("URL-Parameter 'edit_id' (Task) gefunden:", taskIdToEdit);
    
    try {
      // Die 'editTask'-Funktion existiert bereits
      // und kümmert sich um das Abrufen der Daten und das Öffnen des Modals.
      await editTask(taskIdToEdit); 
      
      // URL "aufräumen", damit beim Neuladen
      // nicht wieder das Modal aufgeht.
      const cleanUrl = window.location.pathname; // Ohne Query-String
      window.history.replaceState({}, document.title, cleanUrl);

    } catch (err) {
      // editTask() sollte bereits einen alert() anzeigen
      console.error("Fehler beim Auto-Öffnen des Tasks:", err);
    }
  }
}


let completeTaskModalInstance = null;
let taskModalInstance = null;

//  Globale Variablen für die Sortierung
let currentSortColumn = "date";
let currentSortOrder = "desc";

let maintSortColumn = "last_inspected"; // Standard-Sortierung
let maintSortOrder = "asc"; // Standard-Sortierung

document.addEventListener("DOMContentLoaded", () => {
  // loadTasks() wird aufgerufen, liest den 'selected' Status "open"
  loadTasks();
  loadMaintenanceTasks();
  populateRoomsSelect();

  taskModalInstance = new bootstrap.Modal(document.getElementById("taskModal"));
  completeTaskModalInstance = new bootstrap.Modal(
    document.getElementById("completeTaskModal"),
  );

checkUrlForTaskEdit();

  document.getElementById("newTaskBtn").addEventListener("click", () => {
    document.getElementById("taskForm").reset();
    document.getElementById("taskId").value = "";
    document.getElementById("taskModalTitle").textContent =
      "Neue Aufgabe erstellen";
    document.getElementById("task-date").value = new Date()
      .toISOString()
      .split("T")[0];
    taskModalInstance.show(); // <-- GEÄNDERT
  });

  // Filter-Events für sofortige Anwendung
  document
    .getElementById("filter-status")
    .addEventListener("change", loadTasks);
  document
    .getElementById("filter-priority")
    .addEventListener("change", loadTasks);
  document.getElementById("filter-q").addEventListener("input", loadTasks);


// KORREKTUR: Listener für die HAUPT-Taskliste
  document.querySelector("#tasks-table-body").closest('table').querySelectorAll("th.sortable-header").forEach((header) => {
    header.addEventListener("click", () => {
      const newSortColumn = header.dataset.sort;

      if (newSortColumn === currentSortColumn) {
        currentSortOrder = currentSortOrder === "asc" ? "desc" : "asc";
      } else {
        currentSortColumn = newSortColumn;
        currentSortOrder = "asc"; // Standard-Sortierung
      }
      // Ruft die Funktion zum Laden der HAUPT-Aufgabenliste auf
      loadTasks();
    });
  });


  //  Listener für die WARTUNGS-Taskliste
  document.querySelector("#maintenance-tasks-table-body").closest('table').querySelectorAll("th.sortable-header").forEach((header) => {
    header.addEventListener("click", () => {
      const newSortColumn = header.dataset.sort;

      if (newSortColumn === maintSortColumn) {
        maintSortOrder = maintSortOrder === "asc" ? "desc" : "asc";
      } else {
        maintSortColumn = newSortColumn;
        // Standard-Sortierrichtung für neue Spalten
        maintSortOrder = (newSortColumn === 'last_inspected' || newSortColumn === 'due_date') ? 'asc' : 'asc';
      }
      // Ruft die Funktion zum Laden der Wartungsliste auf
      loadMaintenanceTasks();
    });
  });

  // Submit-Handler für das "Neue/Bearbeiten"-Modal
  document.getElementById("taskForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("taskId").value;
    const isUpdate = !!id;
    const url = isUpdate ? `/api/tasks/${id}` : "/api/tasks";
    const method = isUpdate ? "PUT" : "POST";

    const body = {
      date: document.getElementById("task-date").value,
      category: document.getElementById("task-category").value,
      task: document.getElementById("task-task").value,
      priority: document.getElementById("task-priority").value,
      status: document.getElementById("task-status").value,
      reported_by: document.getElementById("task-reported_by").value,
      assigned_to: document.getElementById("task-assigned_to").value,
      room_id: document.getElementById("task-room_id").value || null,
      notes: document.getElementById("task-notes").value,
      completed_at: document.getElementById("task-completed_at").value || null,
      completed_by: document.getElementById("task-completed_by").value || null,
    };

    try {
      await apiFetch(url, { method, body: JSON.stringify(body) });
      taskModalInstance.hide();
      loadTasks();
    } catch (error) {
      alert(`Speichern fehlgeschlagen: ${error.message}`);
    }
  });

  //  Submit-Handler für das "Abschließen"-Modal
  document
    .getElementById("completeTaskForm")
    .addEventListener("submit", handleCompleteTaskSubmit);
});

// (Status- und Prioritäts-Badges bleiben unverändert)
const taskStatusBadges = {
  open: '<span class="badge bg-primary">Offen</span>',
  in_progress: '<span class="badge bg-warning text-dark">In Arbeit</span>',
  done: '<span class="badge bg-success">Erledigt</span>',
  canceled: '<span class="badge bg-secondary">Abgebrochen</span>',
};
const taskPriorityBadges = {
  low: '<span class="badge bg-info text-dark">Niedrig</span>',
  normal: '<span class="badge bg-light text-dark">Normal</span>',
  high: '<span class="badge bg-danger">Hoch</span>',
  urgent:
    '<span class="badge bg-danger-subtle text-danger-emphasis">Dringend</span>',
};

async function loadTasks() {
  // Sortier-Indikatoren (Pfeile) in der Tabelle aktualisieren
  updateSortIndicators();

  const params = new URLSearchParams();

  const status = document.getElementById("filter-status").value;
  const priority = document.getElementById("filter-priority").value;
  const searchTerm = document.getElementById("filter-q").value;

  if (status) params.append("status", status);
  if (priority) params.append("priority", priority);
  if (searchTerm) params.append("q", searchTerm);

  // Sortierparameter zur API-Anfrage hinzufügen
  if (currentSortColumn) params.append("sort", currentSortColumn);
  if (currentSortOrder) params.append("order", currentSortOrder);

  const paramsString = params.toString();
  const tbody = document.getElementById("tasks-table-body");
  tbody.innerHTML =
    '<tr><td colspan="8" class="text-center">Lade Aufgaben...</td></tr>';

  try {
    const tasks = await apiFetch(`/api/tasks?${paramsString}`);
    if (tasks.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="8" class="text-center text-muted">Keine Aufgaben für die gewählten Filter gefunden.</td></tr>';
      return;
    }

    tbody.innerHTML = tasks
      .map((task) => {
        // Daten für das "Abschließen"-Modal vorbereiten
        const taskTitleEscaped = escapeHtml(task.task);

        // Raumformatierung (Raumnummer (Raumname))
        let roomDisplay = "-";
        if (task.room_id) {
            const roomName = escapeHtml(task.room_name) || `Raum ${task.room_id}`;
            const roomNum = escapeHtml(task.room_number);
            // Zeige "Nummer (Name)" an, wenn Nummer vorhanden, sonst nur Name
            roomDisplay = roomNum ? `${roomNum} (${roomName})` : roomName;
        }

        return `
                            <tr>
                                <td>${task.date}</td>
                                <td>${taskStatusBadges[task.status] || task.status}</td>
                                <td>${taskPriorityBadges[task.priority] || task.priority}</td>
                                <td>${escapeHtml(task.category)}</td>
                                <td>${escapeHtml(task.task)}<br><small class="text-muted">${escapeHtml(task.notes)}</small></td>
                                <td>${roomDisplay}</td>
                                <td>${escapeHtml(task.assigned_to) || "-"}</td>
                                <td class="text-nowrap">
                                    ${
                                      task.status !== "done" &&
                                      task.status !== "canceled"
                                        ? `<button class="btn btn-sm btn-outline-success me-1"
                                                title="Aufgabe abschließen..."
                                                data-task-id="${task.task_id}"
                                                data-task-room-id="${task.room_id || ""}"
                                                data-task-title="${taskTitleEscaped}"
                                                data-task-notes="${escapeHtml(task.notes)}"
                                                onclick="openCompleteTaskModal(this)">
                                            <i class="bi bi-check-lg"></i>
                                         </button>`
                                        : ""
                                    }
                                    <button class="btn btn-sm btn-outline-secondary" onclick="editTask(${task.task_id})"><i class="bi bi-pencil"></i></button>
                                    <button class="btn btn-sm btn-outline-danger" onclick="deleteTask(${task.task_id})"><i class="bi bi-trash"></i></button>
                                </td>
                            </tr>
                        `;
      })
      .join("");
  } catch (error) {
    console.error("Fehler beim Laden der Tasks:", error);
    tbody.innerHTML =
      '<tr><td colspan="8" class="text-center text-danger">Laden der Aufgaben fehlgeschlagen.</td></tr>';
  }
}

async function editTask(id) {
  try {
    const task = await apiFetch(`/api/tasks/${id}`);
    document.getElementById("taskForm").reset();
    document.getElementById("taskModalTitle").textContent =
      "Aufgabe bearbeiten";
    document.getElementById("taskId").value = task.task_id;
    document.getElementById("task-date").value = task.date;
    document.getElementById("task-task").value = task.task;
    document.getElementById("task-category").value = task.category;
    document.getElementById("task-priority").value = task.priority;
    document.getElementById("task-status").value = task.status;
    document.getElementById("task-reported_by").value = task.reported_by;
    document.getElementById("task-assigned_to").value = task.assigned_to;
    document.getElementById("task-room_id").value = task.room_id || "";
    document.getElementById("task-notes").value = task.notes;
    document.getElementById("task-completed_at").value = task.completed_at;
    document.getElementById("task-completed_by").value = task.completed_by;
    taskModalInstance.show();
  } catch (error) {
    console.error(`Fehler beim Laden von Task ${id}:`, error);
  }
}

async function deleteTask(id) {
  if (!confirm(`Möchtest du die Aufgabe #${id} wirklich löschen?`)) return;
  try {
    await apiFetch(`/api/tasks/${id}`, { method: "DELETE" });
    loadTasks();
  } catch (error) {
    alert("Löschen fehlgeschlagen!");
  }
}
async function populateRoomsSelect() {
  try {
    const rooms = await apiFetch("/api/master-data/rooms");
    const select = document.getElementById("task-room_id"); 
    select.innerHTML = '<option value="">Kein Raum</option>';
    
    // Sortieren und Formatieren für "Nummer (Name)"
    rooms
      .sort((a, b) => (a.room_number || "").localeCompare(b.room_number || ""))
      .forEach((room) => {
        const roomName = escapeHtml(room.room_name) || `Raum ${room.room_id}`;
        const roomNum = escapeHtml(room.room_number);
        // Label im Format "Nummer (Name)" oder nur "Name"
        const label = roomNum ? `${roomNum} (${roomName})` : roomName;
        select.innerHTML += `<option value="${room.room_id}">${label}</option>`;
      });

  } catch (error) {
    console.error("Fehler beim Laden der Räume:", error);
  }
}

//  Hilfsfunktion zum Setzen der CSS-Klassen für Sortier-Pfeile
function updateSortIndicators() {
  // KORREKTUR: Nur die Header der HAUPT-Tabelle auswählen
  const table = document.querySelector("#tasks-table-body").closest('table');
  if (!table) return;

  table.querySelectorAll(".sortable-header").forEach((header) => {
    // Zuerst alle Indikatoren entfernen
    header.classList.remove("sort-asc", "sort-desc");

    // Den Indikator für die aktuell gewählte Spalte setzen
    if (header.dataset.sort === currentSortColumn) {
      header.classList.add(
        currentSortOrder === "asc" ? "sort-asc" : "sort-desc",
      );
    }
  });
}

// -----------------------------------------------------------------
// NEUE FUNKTIONEN für den "Aufgabe abschließen"-Workflow
// -----------------------------------------------------------------

/**
 * Öffnet das "Aufgabe abschließen"-Modal und lädt die Geräteliste.
 * @param {HTMLElement} button - Der Button, der geklickt wurde (enthält data-Attribute)
 */
function openCompleteTaskModal(button) {
  const taskId = button.dataset.taskId;
  const roomId = button.dataset.taskRoomId;
  const taskTitle = button.dataset.taskTitle;
  const taskNotes = button.dataset.taskNotes;

  // Formular zurücksetzen
  const form = document.getElementById("completeTaskForm");
  form.reset();

  // Versteckte Felder befüllen
  document.getElementById("complete-task-id").value = taskId;
  document.getElementById("complete-task-room-id").value = roomId;
  document.getElementById("complete-task-title").value = taskTitle;
  document.getElementById("complete-task-notes").value = taskNotes;

  // Geräteliste laden
  loadDevicesForTaskModal(roomId);

  // Modal anzeigen
  completeTaskModalInstance.show();
}

/**
 * Lädt die Geräte für den "Aufgabe abschließen"-Modal, gefiltert nach Raum.
 * @param {string} roomId - Die ID des Raums, nach dem gefiltert werden soll.
 */
async function loadDevicesForTaskModal(roomId) {
  const container = document.getElementById("complete-task-device-list");

  if (!roomId) {
    container.innerHTML =
      '<span class="text-muted">Diese Aufgabe ist keinem Raum zugewiesen. Es können keine Geräte vorgeschlagen werden.</span>';
    return;
  }

  container.innerHTML =
    '<span class="text-muted">Lade Geräte für diesen Raum...</span>';

  try {
    // HINWEIS: Dies setzt voraus, dass Ihre /api/devices-Route
    // einen Query-Parameter `?roomId=...` unterstützt.
    // Ggf. müssen Sie auch `?status=in_operation` o.ä. hinzufügen.
    const devices = await apiFetch(`/api/devices?roomId=${roomId}`);

    if (devices.length === 0) {
      container.innerHTML =
        '<span class="text-muted">Keine Geräte in diesem Raum gefunden.</span>';
      return;
    }

    // Checkboxen für jedes Gerät erstellen
    container.innerHTML = devices
      .map((d) => {
        const label = escapeHtml(
          d.inventory_number ||
            d.serial_number ||
            d.hostname ||
            `ID ${d.device_id}`,
        );
        const model = escapeHtml(d.model_number || "N/A");
        return `
                <div class="form-check">
                    <input class="form-check-input" type="checkbox" name="task-device" value="${d.device_id}" id="task-dev-${d.device_id}">
                    <label class="form-check-label" for="task-dev-${d.device_id}">
                        ${label} (${model})
                    </label>
                </div>
            `;
      })
      .join("");
  } catch (error) {
    console.error("Fehler beim Laden der Geräte für das Modal:", error);
    container.innerHTML =
      '<span class="text-danger">Fehler beim Laden der Gerätedaten.</span>';
  }
}

/**
 * Verarbeitet das Absenden des "Aufgabe abschließen"-Modals.
 * @param {Event} event - Das Submit-Event des Formulars.
 */
async function handleCompleteTaskSubmit(event) {
  event.preventDefault();

  const taskId = document.getElementById("complete-task-id").value;
  const taskTitle = document.getElementById("complete-task-title").value;
  const taskNotes = document.getElementById("complete-task-notes").value;
  const createMaintenance = document.getElementById(
    "complete-task-create-maintenance",
  ).checked;

  const selectedDevices = Array.from(
    document.querySelectorAll('input[name="task-device"]:checked'),
  ).map((cb) => cb.value);

  if (createMaintenance && selectedDevices.length === 0) {
    alert(
      "Bitte wählen Sie mindestens ein Gerät aus, um einen Wartungseintrag zu erstellen, oder deaktivieren Sie die Checkbox.",
    );
    return;
  }

  try {
    // Schritt 1: Task als "erledigt" markieren (Backend-Fix ist hier wichtig!)
    await apiFetch(`/api/tasks/${taskId}`, {
      method: "PUT",
      body: JSON.stringify({ status: "done" }),
    });

    // Schritt 2: Ggf. Wartungseinträge erstellen
    if (createMaintenance) {
      // --- NEUE Beschreibung ---
      let newDescription = `Task: ${taskTitle}`;
      if (taskNotes && taskNotes !== "null") {
        // Sicherstellen, dass 'null' nicht als Text erscheint
        newDescription += `\n\nNotizen:\n${taskNotes}`;
      }
      newDescription += `\n\n(Automatisch aus Task #${taskId} erstellt.)`;
      // --- ENDE ---

      // Titel ggf. kürzen, falls er zu lang für das Wartungs-Titelfeld ist
      const maintTitle = `Abgeschl. Task: ${taskTitle.substring(0, 50)}${taskTitle.length > 50 ? "..." : ""}`;

      const maintBodyBase = {
        event_date: new Date().toISOString().split("T")[0],
        event_type: "other", // 'other' oder 'repair'
        title: `Abgeschlossene Aufgabe: ${taskTitle}`,
        description: newDescription,
        status: "done",
      };

      const maintenancePromises = selectedDevices.map((deviceId) => {
        const deviceMaintBody = { ...maintBodyBase, device_id: deviceId };
        // Ruft /api/maintenance (aus r_maintenance.js) auf
        return apiFetch("/api/maintenance", {
          method: "POST",
          body: JSON.stringify(deviceMaintBody),
        });
      });

      // Warte, bis alle Einträge erstellt wurden
      await Promise.all(maintenancePromises);
    }

    // Schritt 3: Aufräumen
    completeTaskModalInstance.hide();
    loadTasks(); // Tabelle neu laden, um den "done"-Status anzuzeigen
  } catch (error) {
    console.error("Fehler beim Abschließen der Aufgabe:", error);
    alert(`Fehler beim Abschließen: ${error.message}`);
  }
}


// -----------------------------------------------------------------
// NEUE FUNKTIONEN für die fälligen Wartungen
// (Füge diese Funktionen am Ende der Datei tasks.js ein)
// -----------------------------------------------------------------

/**
 *  Hilfsfunktion zum Setzen der CSS-Klassen für Wartungs-Sortier-Pfeile
 */
function updateMaintSortIndicators() {
  // Wichtig: Nur die Header der Wartungstabelle auswählen
  const table = document.querySelector("#maintenance-tasks-table-body").closest('table');
  if (!table) return;

  table.querySelectorAll("th.sortable-header").forEach((header) => {
    // Zuerst alle Indikatoren entfernen
    header.classList.remove("sort-asc", "sort-desc");

    // Den Indikator für die aktuell gewählte Spalte setzen
    if (header.dataset.sort === maintSortColumn) {
      header.classList.add(maintSortOrder === "asc" ? "sort-asc" : "sort-desc");
    }
  });
}

/**
 * Lädt die Liste der fälligen Wartungen von der neuen API-Route.
 */
async function loadMaintenanceTasks() {
  updateMaintSortIndicators(); 

    const tbody = document.getElementById("maintenance-tasks-table-body");
    const countBadge = document.getElementById("maintenance-task-count");
    if (!tbody) return; // Stellt sicher, dass das Element existiert

    tbody.innerHTML = '<tr><td colspan="7" class="text-center">Lade fällige Wartungen...</td></tr>';
    
    //  Sortierparameter zur URL hinzufügen
    const params = new URLSearchParams();
    params.append("sort", maintSortColumn);
    params.append("order", maintSortOrder);

    const paramsString = params.toString();

    try {
        // Ruft die neue API-Route aus r_tasks.js auf
        const tasks = await apiFetch(`/api/tasks/due-maintenance?${paramsString}`);

        if (countBadge) countBadge.textContent = tasks.length;

        if (tasks.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Keine fälligen Wartungen gefunden.</td></tr>';
            return;
        }

        // Rendert jede Zeile mit der Hilfsfunktion
        tbody.innerHTML = tasks.map(renderMaintenanceTaskRow).join('');

    } catch (error) {
        console.error("Fehler beim Laden der fälligen Wartungen:", error);
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Laden fehlgeschlagen: ${error.message}</td></tr>`;
    }
}

/**
 * Erstellt das HTML für eine einzelne "Fällige Wartung"-Zeile.
 * @param {object} task - Das Gerät-Objekt von der API
 */
function renderMaintenanceTaskRow(task) {
    const deviceName = escapeHtml(task.hostname || task.serial_number || `ID ${task.device_id}`);
    const modelName = escapeHtml(task.model_name || 'N/A');
    const room = escapeHtml(task.room_id ? `${task.room_number || '?'} (${task.room_name || 'N/A'})` : 'Kein Raum');
    const interval = escapeHtml(task.maintenance_interval_months);
    const lastInspected = escapeHtml(task.last_inspected || 'Nie');

    // Fälligkeitsdatum formatieren und hervorheben
    let dueDate = 'N/A';
    let dueClass = '';
    if (task.due_date === 'Sofort') {
        dueDate = '<strong class="text-danger">Unbekannt</strong>';
    } else if (task.due_date) {
        // Prüfen, ob das Datum heute oder in der Vergangenheit liegt
        const isOverdue = new Date(task.due_date) <= new Date(new Date().setHours(0,0,0,0));
        dueDate = escapeHtml(task.due_date);
        if (isOverdue) {
            dueClass = 'text-danger fw-bold';
        }
    }

return `
        <tr id="maint-task-row-${task.device_id}">
            <td>${deviceName}</td> <td>${modelName}</td>
            <td>${room}</td>
            <td>${lastInspected}</td>
            <td>${interval} M.</td>
            <td class="${dueClass}">${dueDate}</td>
            <td>
                <button class="btn btn-sm btn-outline-success" 
                        title="Als 'heute kontrolliert' markieren"
                        onclick="markDeviceAsInspected(${task.device_id})">
                    <i class="bi bi-check-lg"></i>
                </button>
            </td>
        </tr>
    `;
}

/**
 * Ruft die API auf, um ein Gerät als kontrolliert zu markieren.
 * Muss im globalen Scope (window.) sein, um von onclick() gefunden zu werden.
 * @param {number} deviceId - Die ID des Geräts
 */
window.markDeviceAsInspected = async function(deviceId) {
    
    try {
        // Ruft die neue API-Route aus r_devices.js auf
        await apiFetch(`/api/devices/${deviceId}/mark-inspected`, {
            method: 'PUT'
            // Body ist optional, da das Backend 'today' als Default nimmt
        });
        
        // Erfolgreich - lade die Liste neu, um die Zeile zu entfernen
        loadMaintenanceTasks();

    } catch (error) {
        alert(`Fehler beim Markieren: ${error.message}`);
    }
}