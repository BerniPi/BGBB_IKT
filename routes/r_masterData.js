const express = require("express");
const { db, logActivity } = require("../database");
const router = express.Router();

// Hilfsfunktion zum Erstellen der CRUD Endpunkte (unverändert)
const createCrudEndpoints = (router, tableName, pkField) => {
  // GET all
  router.get(`/${tableName}`, (req, res) => {
    let sql = `SELECT * FROM ${tableName}`;
    if (tableName === "rooms") {
      sql += ` ORDER BY floor ASC, sort_order ASC, room_name ASC`;
    } else if (tableName === "models") {
      // Optional: Standard-Sortierung für Modelle, falls gewünscht
      // sql += ` ORDER BY model_number ASC`;
    } else if (tableName === "device_categories") {
        sql = `
            SELECT
                dc.category_id,
                dc.category_name,
                dc.description,
                
                -- Zählt die (eindeutigen) Modelle in dieser Kategorie
                COUNT(DISTINCT m.model_id) AS model_count,
                
                -- Zählt alle Geräte, die über Modelle mit dieser Kategorie verknüpft sind
                COUNT(d.device_id) AS total_devices,
                
                -- Zählt nur die 'aktiven' Geräte
                COALESCE(SUM(d.status = 'active'), 0) AS active_devices
                
            FROM device_categories dc
            
            -- Verknüpfung zu Modellen
            LEFT JOIN models m ON dc.category_id = m.category_id
            
            -- Verknüpfung von Modellen zu Geräten
            LEFT JOIN devices d ON m.model_id = d.model_id
            
            -- Gruppierung, damit die COUNT/SUM-Funktionen pro Kategorie arbeiten
            GROUP BY
                dc.category_id, dc.category_name, dc.description
            
            -- Standard-Sortierung (wird ggf. vom Frontend überschrieben)
            ORDER BY
                dc.category_name ASC
        `;
    }
    db.all(sql, [], (err, rows) => {
      if (err)
        return res
          .status(500)
          .json({ message: "Datenbankfehler", error: err.message });
      res.json(rows);
    });
  });
  // r_masterData.js

  // POST create new
  router.post(`/${tableName}`, (req, res) => {
    if (tableName === "rooms") {
      // --- KORREKTUR START (LOGIK IST OK, NUR FEHLERBEHANDLUNG WIRD VERBESSERT) ---

      // 1. Standardwert für 'floor'
      if (req.body.floor === null || req.body.floor === undefined) {
        req.body.floor = 0;
      }
      const floor = req.body.floor;

      db.get(
        "SELECT MAX(sort_order) as max_sort FROM rooms WHERE floor = ?",
        [floor],
        (err, row) => {
          if (err)
            return res
              .status(500)
              .json({ message: "Datenbankfehler", error: err.message });

          // 2. 'sort_order' nur berechnen, wenn nicht manuell
          if (req.body.sort_order === null) {
            req.body.sort_order = (row.max_sort || 0) + 1;
          }

          const columns = Object.keys(req.body);
          const values = Object.values(req.body);
          const placeholders = columns.map(() => "?").join(",");
          const sql = `INSERT INTO ${tableName} (${columns.join(",")}) VALUES (${placeholders})`;

          db.run(sql, values, function (err) {
            // --- KORREKTUR: Bessere Fehlerbehandlung hinzugefügt ---
            if (err) {
              if (err.message.includes("UNIQUE constraint")) {
                return res
                  .status(409)
                  .json({
                    message:
                      "Ein Eintrag mit diesem Namen/Nummer existiert bereits.",
                  });
              }
              return res
                .status(500)
                .json({ message: "Datenbankfehler", error: err.message });
            }
            // --- ENDE KORREKTUR ---
            res.status(201).json({ id: this.lastID, ...req.body });
          });
        },
      );
    } else {
      // Logic for other tables (unverändert)
      const columns = Object.keys(req.body);
      const values = columns.map((col) => req.body[col]);
      const placeholders = columns.map(() => "?").join(",");
      const sql = `INSERT INTO ${tableName} (${columns.join(",")}) VALUES (${placeholders})`;

      db.run(sql, values, function (err) {
        if (err) {
          if (err.message.includes("UNIQUE constraint")) {
            return res
              .status(409)
              .json({
                message:
                  "Ein Eintrag mit diesem Namen/Nummer existiert bereits.",
              });
          }
          return res
            .status(500)
            .json({
              message: "Datenbankfehler beim Speichern.",
              error: err.message,
            });
        }
        // === NEU: LOGGING (CREATE) ===
      // (Verwenden Sie req.user?.username, falls Auth-Middleware vorhanden ist, sonst 'system')
      const username = req.user?.username || 'system';
      const logData = { ...req.body };
      // (Entfernen Sie sensible Daten, falls nötig, z.B. bei 'users')
      if (tableName === 'users' && logData.password_hash) {
          logData.password_hash = '[geschützt]';
      }
      logActivity(username, 'CREATE', tableName, this.lastID, logData);
      // === ENDE LOGGING ===

        const responseData = { ...req.body };
        responseData[pkField] = this.lastID;
        res.status(201).json(responseData);
      });
    }
  });

  // PUT update
  router.put(`/${tableName}/:id`, (req, res) => {
    const { id } = req.params;

    // --- KORREKTUR START (WICHTIG FÜR FORMULAR-UPDATE) ---
    // Fängt 'null'-Werte ab, die vom Frontend (leere Formularfelder)
    // gesendet werden, um Datenbank-Constraints (NOT NULL) nicht zu verletzen.
    if (tableName === "rooms") {
      // Prüft, ob 'floor' im Request enthalten UND null ist
      if (
        req.body.hasOwnProperty("floor") &&
        (req.body.floor === null || req.body.floor === undefined)
      ) {
        req.body.floor = 0;
      }

      // Dasselbe für 'sort_order'.
      // Wenn 'null' gesendet wird (Feld geleert), setze auf 0.
      if (
        req.body.hasOwnProperty("sort_order") &&
        (req.body.sort_order === null || req.body.sort_order === undefined)
      ) {
        // Wir setzen 0 als sicheren Standard.
        // Besser wäre eine Neuberechnung, aber 0 verhindert den Absturz.
        req.body.sort_order = 0;
      }
    }
    // --- KORREKTUR ENDE ---

    const columns = Object.keys(req.body).map((col) => `${col} = ?`).join(", ");
    const values = [...Object.values(req.body), id];
    const sql = `UPDATE ${tableName} SET ${columns} WHERE ${pkField} = ?`;
    const username = req.user?.username || 'system';

    // === NEU: ALTEN DATENSATZ FÜR LOGGING HOLEN ===
    db.get(`SELECT * FROM ${tableName} WHERE ${pkField} = ?`, [id], (err, oldData) => {
      if (err) return res.status(500).json({ message: "DB-Fehler (Log-Check).", error: err.message });
      if (!oldData) return res.status(404).json({ message: "Eintrag nicht gefunden" });

      // Jetzt das Update ausführen
      db.run(sql, values, function (err) {
        if (err) {
          // ... (Fehlerbehandlung bleibt) ...
          return res.status(500).json({ /*...*/ });
        }
        
        // === NEU: LOGGING (UPDATE) ===
        try {
          const details = {};
          Object.keys(req.body).forEach(key => {
            const newValue = req.body[key];
            const oldValue = oldData[key];
            if (String(newValue ?? "") !== String(oldValue ?? "")) {
              // (Sensible Daten zensieren)
              if (tableName === 'users' && key === 'password_hash') {
                 details[key] = { old: '[geschützt]', new: '[geschützt]' };
              } else {
                 details[key] = { old: oldValue, new: newValue };
              }
            }
          });
          
          if (Object.keys(details).length > 0) {
            logActivity(username, 'UPDATE', tableName, id, details);
          }
        } catch (logErr) {
          console.error("Fehler beim Schreiben des Activity Logs (MasterData UPDATE):", logErr);
        }
        // === ENDE LOGGING ===
        
        res.json({ message: "Erfolgreich aktualisiert." });
      });
    });
  });

  // DELETE delete
  router.delete(`/${tableName}/:id`, (req, res) => {
    const { id } = req.params;
    const sql = `DELETE FROM ${tableName} WHERE ${pkField} = ?`;
    const username = req.user?.username || 'system';

    // === NEU: ALTEN DATENSATZ FÜR LOGGING HOLEN ===
    db.get(`SELECT * FROM ${tableName} WHERE ${pkField} = ?`, [id], (err, oldData) => {
      if (err) return res.status(500).json({ message: "DB-Fehler (Log-Check).", error: err.message });
      if (!oldData) return res.status(404).json({ message: "Eintrag nicht gefunden" });

      // Jetzt das Delete ausführen
      db.run(sql, [id], function (err) {
        if (err) {
          // ... (Fehlerbehandlung bleibt) ...
          return res.status(500).json({ /*...*/ });
        }
        
        // === NEU: LOGGING (DELETE) ===
        logActivity(username, 'DELETE', tableName, id, oldData);
        // === ENDE LOGGING ===
        
        res.json({ message: "Erfolgreich gelöscht." });
      });
    });
  });

  // Raum verschieben (unverändert)
  router.post("/rooms/:id/move", (req, res) => {
    /* ... unverändert ... */
    const { id } = req.params;
    const { direction } = req.body;
    db.get(
      `SELECT room_id, sort_order, floor FROM rooms WHERE room_id = ?`,
      [id],
      (err, roomA) => {
        if (err || !roomA)
          return res.status(404).json({ message: "Raum nicht gefunden" });
        let sql, params;
        if (direction === "up") {
          sql = `SELECT room_id, sort_order FROM rooms WHERE floor = ? AND sort_order < ? ORDER BY sort_order DESC LIMIT 1`;
          params = [roomA.floor, roomA.sort_order];
        } else {
          sql = `SELECT room_id, sort_order FROM rooms WHERE floor = ? AND sort_order > ? ORDER BY sort_order ASC LIMIT 1`;
          params = [roomA.floor, roomA.sort_order];
        }
        db.get(sql, params, (err, roomB) => {
          if (err || !roomB)
            return res
              .status(200)
              .json({ message: "Keine Verschiebung möglich." });
          db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            db.run(`UPDATE rooms SET sort_order = ? WHERE room_id = ?`, [
              roomB.sort_order,
              roomA.room_id,
            ]);
            db.run(`UPDATE rooms SET sort_order = ? WHERE room_id = ?`, [
              roomA.sort_order,
              roomB.room_id,
            ]);
            db.run("COMMIT", (err) => {
              if (err) {
                db.run("ROLLBACK");
                return res
                  .status(500)
                  .json({
                    error: "Transaktion fehlgeschlagen: " + err.message,
                  });
              }
              res.status(200).json({ message: "Sortierung aktualisiert." });
            });
          });
        });
      },
    );
  });
};

// CRUD Endpunkte erstellen (unverändert)
createCrudEndpoints(router, "rooms", "room_id");
createCrudEndpoints(router, "models", "model_id");
createCrudEndpoints(router, "device_categories", "category_id");
createCrudEndpoints(router, "accessories", "accessory_id");
createCrudEndpoints(router, "accessory_categories", "accessory_category_id");
createCrudEndpoints(router, "users", "user_id");

router.get("/models_with_details", (req, res) => {
  // ANGEPASST: Diese SQL-Abfrage zählt jetzt 'active' und 'total' Geräte pro Modell
  const sql = `
        SELECT
            m.model_id, m.category_id, m.manufacturer, m.type, m.model_name, m.model_number,
            m.allowed_accessory_category_ids, m.has_network, m.notes,
            dc.category_name,
            m.purchase_date,
            m.price_cents,
            m.warranty_months,
            m.maintenance_interval_months, -- <--- NEU
            
            -- NEU: Zählung der Geräte
            -- Zählt alle Geräte, die diesem Modell zugeordnet sind
            COUNT(d.device_id) AS total_devices, 
            
            -- Zählt nur Geräte mit Status 'active' (SQLite behandelt 'true' als 1)
            COALESCE(SUM(d.status = 'active'), 0) AS active_devices

        FROM models m
        LEFT JOIN device_categories dc ON m.category_id = dc.category_id
        
        -- NEU: Join zur Zählung
        LEFT JOIN devices d ON m.model_id = d.model_id 
        
        -- NEU: Gruppierung (notwendig für COUNT/SUM)
        GROUP BY 
            m.model_id, m.category_id, m.manufacturer, m.type, m.model_name, m.model_number,
            m.allowed_accessory_category_ids, m.has_network, m.notes,
            dc.category_name, m.purchase_date, m.price_cents, m.warranty_months,
            m.maintenance_interval_months -- <--- NEU
            
        ORDER BY dc.category_name, m.model_name
    `;

  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error("DB Error (GET /models_with_details):", err);
      return res.status(500).json({
        message: "Fehler beim Abrufen der Modelldaten aus der Datenbank.",
        error: err.message,
      });
    }
    res.json(rows);
  });
});

module.exports = router;