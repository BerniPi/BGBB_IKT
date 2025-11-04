// routes/r_users.js
const express = require("express");
const { db } = require("../database");
const bcrypt = require("bcrypt");
const router = express.Router();

// GET all users (ohne Passwörter!)
router.get("/", (req, res) => {
  db.all("SELECT user_id, username, role, notes FROM users", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// GET single user (für das Edit-Modal)
router.get("/:id", (req, res) => {
  db.get(
    "SELECT user_id, username, role, notes FROM users WHERE user_id = ?",
    [req.params.id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ message: "Benutzer nicht gefunden" });
      res.json(row);
    },
  );
});

// POST a new user
router.post("/", (req, res) => {
  const { username, password, role, notes } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: "Benutzername und Passwort sind erforderlich." });
  }

  bcrypt.hash(password, 10, (err, hash) => {
    if (err) return res.status(500).json({ error: "Fehler beim Hashen des Passworts." });

    const sql = `INSERT INTO users (username, password_hash, role, notes) VALUES (?, ?, ?, ?)`;
    db.run(sql, [username, hash, role || 'user', notes], function (err) {
      if (err) {
        if (err.message.includes("UNIQUE constraint failed")) {
          return res.status(409).json({ message: "Benutzername existiert bereits." });
        }
        return res.status(500).json({ error: err.message });
      }
      res.status(201).json({ id: this.lastID });
    });
  });
});

// PUT (update) an existing user
router.put("/:id", (req, res) => {
  const { id } = req.params;
  const { username, password, role, notes } = req.body;

  if (!username || !role) {
    return res.status(400).json({ message: "Benutzername und Rolle sind erforderlich." });
  }

  // Sicherheitscheck: Verhindern, dass der Admin seine eigene Rolle ändert
  if (req.user.userId == id && req.user.role !== role) {
    return res.status(403).json({ message: "Sie können Ihre eigene Rolle nicht ändern." });
  }

  let sql;
  const params = [];

  if (password) {
    // Fall 1: Passwort WIRD geändert
    bcrypt.hash(password, 10, (err, hash) => {
      if (err) return res.status(500).json({ error: "Fehler beim Hashen des Passworts." });
      
      sql = `UPDATE users SET username = ?, password_hash = ?, role = ?, notes = ? WHERE user_id = ?`;
      params.push(username, hash, role, notes, id);
      runUpdate(sql, params, res, id);
    });
  } else {
    // Fall 2: Passwort wird NICHT geändert
    sql = `UPDATE users SET username = ?, role = ?, notes = ? WHERE user_id = ?`;
    params.push(username, role, notes, id);
    runUpdate(sql, params, res, id);
  }
});

// Hilfsfunktion für PUT
function runUpdate(sql, params, res, id) {
  db.run(sql, params, function (err) {
    if (err) {
       if (err.message.includes("UNIQUE constraint failed")) {
          return res.status(409).json({ message: "Benutzername existiert bereits." });
        }
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ message: "Benutzer nicht gefunden" });
    }
    res.json({ message: "Benutzer erfolgreich aktualisiert." });
  });
}

// DELETE a user
router.delete("/:id", (req, res) => {
  const { id } = req.params;

  // Sicherheitscheck: Admin kann sich nicht selbst löschen
  if (req.user.userId == id) {
    return res.status(403).json({ message: "Sie können sich nicht selbst löschen." });
  }

  db.run("DELETE FROM users WHERE user_id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ message: "Benutzer nicht gefunden" });
    res.status(200).json({ message: "Benutzer endgültig gelöscht." });
  });
});

module.exports = router;