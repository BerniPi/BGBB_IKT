const express = require("express");
const { db } = require("../database");
const router = express.Router();

// GET all tasks with filters
router.get("/", (req, res) => {
  let query = `
        SELECT t.*, r.room_name
        FROM tasks t
        LEFT JOIN rooms r ON t.room_id = r.room_id
        WHERE 1=1`;
  const params = [];

  if (req.query.status) {
    query += ` AND t.status = ?`;
    params.push(req.query.status);
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
  } // [Ref: tasks.js, lines 19-23]

  query += ` ORDER BY t.date DESC, t.created_at DESC`; // [Ref: tasks.js, line 25]

  // Logging the final query and params can be helpful for debugging:
  // console.log("SQL Query:", query);
  // console.log("SQL Params:", params);

  db.all(query, params, (err, rows) => {
    // [Ref: tasks.js, line 27]
    if (err) return res.status(500).json({ error: err.message });
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

module.exports = router;
