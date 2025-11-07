// routes/r_settings.js
const express = require("express");
const { db } = require("../database");

// Dieser Router wird unter /api/settings/public registriert (siehe index.js)
// und ist für alle angemeldeten Benutzer zugänglich.
const publicRouter = express.Router();

// Dieser Router wird unter /api/settings/admin registriert (siehe index.js)
// und ist nur für Admins zugänglich.
const adminRouter = express.Router();

/**
 * Helper: Konvertiert DB-Zeilen (Key-Value) in ein JSON-Objekt
 * @param {Array} rows - z.B. [{setting_key: 'k1', setting_value: 'v1'}, ...]
 * @returns {Object} - z.B. { k1: 'v1', ... }
 */
function rowsToSettingsObject(rows) {
  return rows.reduce((acc, row) => {
    acc[row.setting_key] = row.setting_value;
    return acc;
  }, {});
}

// ----------------------------------------------------
// PUBLIC ROUTER (/api/settings/public)
// ----------------------------------------------------

/**
 * GET /api/settings/public
 * Holt nur "sichere" Einstellungen, die von anderen Skripten (z.B. devices.js)
 * benötigt werden.
 */
publicRouter.get("/", (req, res) => {
  // Whitelist der öffentlichen Schlüssel
  const publicKeys = ["default_ip_prefix"];
  const placeholders = publicKeys.map(() => "?").join(",");

  const sql = `SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (${placeholders})`;

  db.all(sql, publicKeys, (err, rows) => {
    if (err) {
      return res.status(500).json({ message: "DB-Fehler", error: err.message });
    }
    res.json(rowsToSettingsObject(rows));
  });
});

// ----------------------------------------------------
// ADMIN ROUTER (/api/settings/admin)
// ----------------------------------------------------

/**
 * GET /api/settings/admin
 * Holt ALLE Einstellungen für die Admin-Settings-Seite.
 */
adminRouter.get("/", (req, res) => {
  db.all("SELECT * FROM app_settings", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ message: "DB-Fehler", error: err.message });
    }
    res.json(rowsToSettingsObject(rows));
  });
});

/**
 * PUT /api/settings/admin
 * Speichert ALLE Einstellungen von der Admin-Settings-Seite.
 * Akzeptiert ein Objekt: { "key1": "value1", "key2": "value2" }
 */
adminRouter.put("/", (req, res) => {
  const settings = req.body;
  if (typeof settings !== "object" || settings === null) {
    return res.status(400).json({ message: "Ungültiger Payload." });
  }

  const keys = Object.keys(settings);
  if (keys.length === 0) {
    return res.json({ message: "Nichts zu speichern." });
  }

  const sql = `INSERT OR REPLACE INTO app_settings (setting_key, setting_value) VALUES (?, ?)`;
  let error = null;

  db.serialize(() => {
    db.run("BEGIN TRANSACTION", (err) => {
      if (err) return res.status(500).json({ message: "DB-Fehler (Transaktion Start)", error: err.message });
    });

    const stmt = db.prepare(sql);
    
    for (const key of keys) {
      const value = settings[key];
      // Führe UPSERT für jeden Schlüssel aus
      stmt.run(key, value, (err) => {
        if (err) {
          console.error("Fehler beim Speichern der Einstellung:", key, err);
          error = err;
        }
      });
    }

    stmt.finalize((err) => {
      if (err) error = err;

      const finalCmd = error ? "ROLLBACK" : "COMMIT";
      
      db.run(finalCmd, (err) => {
        if (err) {
            return res.status(500).json({ message: `DB-Fehler (${finalCmd})`, error: err.message });
        }
        if (error) {
            return res.status(500).json({ message: "Speichern einer Einstellung fehlgeschlagen (Rollback).", error: error.message });
        }
        res.json({ message: "Einstellungen erfolgreich gespeichert." });
      });
    });
  });
});

module.exports = { publicRouter, adminRouter };