const express = require("express");
const { db, logActivity } = require("../database");
const router = express.Router();

// GET all tasks with filters
router.get("/", (req, res) => {
  let query = `
        SELECT t.*, r.room_name, r.room_number
        FROM tasks t
        LEFT JOIN rooms r ON t.room_id = r.room_id
        WHERE 1=1`;
  const params = [];

  if (req.query.status) {
    if (req.query.status === "active") {
      // Der neue Standardwert "active" wird zu "Offen" ODER "In Arbeit"
      query += ` AND t.status IN ('open', 'in_progress')`;
    } else {
      // Alle anderen Werte (open, done, etc.) werden normal gefiltert
      query += ` AND t.status = ?`;
      params.push(req.query.status);
    }
  }

  if (req.query.priority) {
    query += ` AND t.priority = ?`;
    params.push(req.query.priority);
  }

  // --- ENTFERNT: Kategorie-Filterung ---

  if (req.query.q) {
    const searchTerm = `%${req.query.q}%`;
    query += ` AND (t.task LIKE ? OR t.notes LIKE ?)`;
    params.push(searchTerm, searchTerm);
  }

  // --- NEU: Dynamische Sortierung ---
  const allowedSortColumns = {
    date: "t.date",
    status: "t.status",
    priority: "t.priority",
    category: "t.category",
    task: "t.task",
    room_name: "r.room_name", // Wichtig: Alias 'r' aus dem JOIN
    assigned_to: "t.assigned_to",
  };

  // Standard-Sortierung festlegen
  const sortColumnInput = req.query.sort || "date";
  const sortOrderInput = req.query.order || "desc";

  // Validierung (Whitelist), um SQL-Injection zu verhindern
  const sortColumn = allowedSortColumns[sortColumnInput] || "t.date";

  // Validierung der Sortierrichtung
  const sortOrder = sortOrderInput.toUpperCase() === "DESC" ? "DESC" : "ASC";

  // Die statische ORDER BY Klausel wird hiermit ersetzt
  // t.created_at als sekundäre Sortierung, um bei gleichen Werten (z.B. gleiches Datum) eine stabile Reihenfolge zu haben
  query += ` ORDER BY ${sortColumn} ${sortOrder}, t.created_at DESC`;

  db.all(query, params, (err, rows) => {
    // [Ref: tasks.js, line 27]
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

/**
 * GET /api/tasks/due-maintenance
 * Ruft alle Geräte ab, deren 'last_inspected'-Datum abgelaufen ist.
 * JETZT MIT SORTIERUNG.
 */
router.get("/due-maintenance", (req, res) => {
  const { sort, order } = req.query;

  // Whitelist der Spalten, nach denen sortiert werden darf
  const sortWhitelist = {
    device: "d.hostname", // Sortiert nach Hostname für "Gerät"
    model: "m.model_name",
    room: "r.room_name",
    last_inspected: "d.last_inspected",
    interval: "m.maintenance_interval_months",
    due_date: "due_date", // Der berechnete Alias
  };

  const sortOrder = (order || "asc").toUpperCase() === "DESC" ? "DESC" : "ASC";
  let orderByClause;

  if (sort && sortWhitelist[sort]) {
    // Wenn eine gültige Sortierung angefordert wurde
    orderByClause = `ORDER BY ${sortWhitelist[sort]} ${sortOrder}`;
  } else {
    // Standard-Sortierung (wie bisher: "Sofort" und älteste Fälligkeit zuerst)
    orderByClause = `ORDER BY d.last_inspected ASC, due_date ASC`;
  }

  const sql = `
    SELECT
        d.device_id,
        d.hostname,
        d.serial_number,
        d.inventory_number,
        d.last_inspected,
        m.model_name,
        m.maintenance_interval_months,
        r.room_id,
        r.room_name,
        r.room_number,
        CASE
            WHEN d.last_inspected IS NULL THEN 'Sofort'
            ELSE DATE(d.last_inspected, '+' || m.maintenance_interval_months || ' months')
        END AS due_date
    FROM devices d
    JOIN models m ON d.model_id = m.model_id
    LEFT JOIN room_device_history h ON h.device_id = d.device_id AND h.to_date IS NULL
    LEFT JOIN rooms r ON h.room_id = r.room_id
    WHERE
        m.maintenance_interval_months > 0
        AND d.status = 'active'
        AND r.room_id IS NOT NULL 
        AND r.room_name != 'Archiv' 
        AND (
            d.last_inspected IS NULL
            OR d.last_inspected < DATE('now', '-' || m.maintenance_interval_months || ' months')
        )
    ${orderByClause} -- HIER WIRD DIE DYNAMISCHE SORTIERUNG EINGEFÜGT
  `;

  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error("DB Error (GET /due-maintenance):", err);
      return res.status(500).json({
        message: "Fehler beim Abrufen der fälligen Wartungen.",
        error: err.message,
      });
    }
    res.json(rows);
  });
});

// GET a single task
router.get("/:id", (req, res) => {
  db.get(
    "SELECT * FROM tasks WHERE task_id = ?",
    [req.params.id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ message: "Task nicht gefunden" });
      res.json(row);
    },
  );
});

// POST a new task
router.post("/", (req, res) => {
  const {
    date,
    category,
    task,
    reported_by,
    room_id,
    priority,
    status,
    assigned_to,
    notes,
  } = req.body;
  if (!date || !category || !task)
    return res
      .status(400)
      .json({ message: "Datum, Kategorie und Aufgabe sind erforderlich." });

  const entered_by = req.user.username;
  const sql = `INSERT INTO tasks (date, category, task, reported_by, entered_by, room_id, priority, status, assigned_to, notes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  db.run(
    sql,
    [
      date,
      category,
      task,
      reported_by,
      entered_by,
      room_id,
      priority,
      status,
      assigned_to,
      notes,
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ id: this.lastID });
    },
  );
});

// PUT (update) an existing task
router.put("/:id", (req, res) => {
  const { id } = req.params;
  const body = req.body;

  // Felder, die aktualisiert werden sollen
  const updates = [];
  const params = [];

  // Erlaubte Felder aus dem Body sammeln
  const allowedFields = [
    "date",
    "category",
    "task",
    "reported_by",
    "room_id",
    "priority",
    "status",
    "assigned_to",
    "completed_at",
    "completed_by",
    "notes",
  ];

  allowedFields.forEach((field) => {
    if (body[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(body[field]);
    }
  });

  // Sonderlogik: Wenn Status auf 'done' gesetzt wird, aber kein 'completed_at' mitkam
  if (body.status === "done" && body.completed_at === undefined) {
    updates.push("completed_at = ?");
    params.push(new Date().toISOString().split("T")[0]); // Heutiges Datum

    // Setze 'completed_by' nur, wenn es nicht explizit mitgesendet wurde
    if (body.completed_by === undefined) {
      updates.push("completed_by = ?");
      params.push(req.user.username || "system"); // req.user.username vom Login
    }
  }

  // Wenn keine Felder gesendet wurden, passiert nichts
  if (updates.length === 0) {
    return res.json({ message: "Keine Felder zum Aktualisieren angegeben." });
  }

  // Immer das updated_at-Datum setzen
  updates.push("updated_at = datetime('now', 'localtime')");

  const sql = `UPDATE tasks SET
        ${updates.join(", ")}
        WHERE task_id = ?`;

  params.push(id); // Die ID als letzten Parameter für die WHERE-Klausel

  db.run(sql, params, function (err) {
    if (err) {
      console.error("DB Error (PUT /tasks/:id):", err.message);
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ message: "Task nicht gefunden" });
    }
    res.json({ message: "Task erfolgreich aktualisiert." });
  });
});

// DELETE a task
router.delete("/:id", (req, res) => {
  db.run(
    "DELETE FROM tasks WHERE task_id = ?",
    [req.params.id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0)
        return res.status(404).json({ message: "Task nicht gefunden" });
      res.status(200).json({ message: "Task endgültig gelöscht." });
    },
  );
});

// ... (alle anderen Routen)



module.exports = router;
