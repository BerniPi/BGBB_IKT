// routes/maintenance.js
const express = require('express');
const { db } = require('../database');
const router = express.Router();

// Hilfsfunktion: Aktualisiert last_cleaned/last_inspected am Gerät
function updateDeviceStatus(maintenanceId) {
  db.get(
    `SELECT device_id, event_type, event_date
     FROM device_maintenance
     WHERE maintenance_id = ? AND status = 'done'`,
    [maintenanceId],
    (err, maintenance) => {
      if (err || !maintenance) return;
      let fieldToUpdate = null;
      if (maintenance.event_type === 'cleaning') fieldToUpdate = 'last_cleaned';
      if (maintenance.event_type === 'inspection') fieldToUpdate = 'last_inspected';
      if (fieldToUpdate) {
        // Nur aktualisieren, wenn das Wartungsdatum neuer ist als das aktuelle Datum im Gerät
        db.run(
          `UPDATE devices
           SET ${fieldToUpdate} = ?
           WHERE device_id = ? AND (devices.${fieldToUpdate} IS NULL OR devices.${fieldToUpdate} < ?)`,
          [maintenance.event_date, maintenance.device_id, maintenance.event_date]
        );
      }
    }
  );
}

/**
 * GET / : Alle Wartungseinträge – mit Filtern und Sortierung.
 * Query-Parameter:
 * q           – Volltextsuche in title/description/performed_by/device-info
 * type        – event_type (repair|upgrade|config|cleaning|inspection|other)
 * status      – done|planned|in_progress|canceled
 * from        – Startdatum (YYYY-MM-DD)
 * to          – Enddatum   (YYYY-MM-DD)
 * deviceId    – auf bestimmtes Gerät filtern
 * sort        – Spaltenname (event_date|title|event_type|status|performed_by|device_info)
 * dir         – asc|desc (Standard: desc bei Datum, sonst asc)
 */
router.get('/', (req, res) => {
  const {
    q, type, status, from, to, deviceId,
    sort = 'event_date', // Standard-Sortierung
    dir,
  } = req.query;

  const where = [];
  const params = [];

  if (deviceId) { where.push('dm.device_id = ?'); params.push(deviceId); }
  if (type)     { where.push('dm.event_type = ?'); params.push(type); }
  if (status)   { where.push('dm.status = ?'); params.push(status); }
  if (from)     { where.push('dm.event_date >= ?'); params.push(from); }
  if (to)       { where.push('dm.event_date <= ?'); params.push(to); }
  if (q) {
    // Suche in Wartungstitel/-beschreibung/-person UND Geräte-Infos
    where.push(`(
      dm.title LIKE ? OR dm.description LIKE ? OR dm.performed_by LIKE ?
      OR d.serial_number LIKE ? OR d.inventory_number LIKE ? OR m.model_number LIKE ? OR d.hostname LIKE ?
    )`);
    const qParam = `%${q}%`;
    params.push(qParam, qParam, qParam, qParam, qParam, qParam, qParam);
  }

  // Sortierung definieren
  const allowedSort = new Set(['event_date', 'title', 'event_type', 'status', 'performed_by', 'device_info']);
  const sortCol = allowedSort.has(sort) ? sort : 'event_date';
  // Standard-Richtung abhängig von Spalte
  let sortDir = (sortCol === 'event_date') ? 'DESC' : 'ASC';
  if (dir && (dir.toUpperCase() === 'ASC' || dir.toUpperCase() === 'DESC')) {
    sortDir = dir.toUpperCase();
  }
  // Mapping von Frontend-Sortiernamen zu DB-Spalten/Ausdrücken
  const sortMapping = {
      event_date: 'dm.event_date',
      title: 'dm.title',
      event_type: 'dm.event_type',
      status: 'dm.status',
      performed_by: 'dm.performed_by',
      device_info: 'COALESCE(d.inventory_number, d.serial_number, d.hostname, m.model_number)' // Sortiere nach erster verfügbarer Geräte-ID
  };
  const orderBy = sortMapping[sortCol] || 'dm.event_date';


  const sql = `
    SELECT
      dm.*,
      d.serial_number,
      d.inventory_number,
      d.hostname,
      m.model_number
      -- Optional: Weitere Geräte- oder Modell-Infos hier hinzufügen
    FROM device_maintenance dm
    JOIN devices d ON d.device_id = dm.device_id
    LEFT JOIN models m ON d.model_id = m.model_id -- LEFT JOIN falls Modell fehlt
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${orderBy} ${sortDir}, dm.maintenance_id DESC -- Sekundäre Sortierung nach ID
  `;

  db.all(sql, params, (err, rows) => {
    if (err) {
        console.error("DB Error (GET /maintenance):", err.message);
        return res.status(500).json({ message: "Fehler beim Abrufen der Wartungsdaten.", error: err.message });
    }
    res.json(rows);
  });
});

// GET einzelner Eintrag (für Bearbeiten)
router.get('/:id', (req, res) => {
  db.get(
    'SELECT * FROM device_maintenance WHERE maintenance_id = ?',
    [req.params.id],
    (err, row) => {
      if (err) return res.status(500).json({ message: "DB Fehler", error: err.message });
      if (!row) return res.status(404).json({ message: 'Wartungseintrag nicht gefunden' });
      res.json(row);
    }
  );
});

// POST neuer Eintrag (erwartet device_id im body)
router.post('/', (req, res) => {
  const {
    device_id, event_date, event_type, title, description,
    performed_by, status = 'done' // Default Status 'done'
    // Hier weitere Felder aus Body holen, falls im Modal hinzugefügt
  } = req.body;

  if (!device_id || !event_date || !event_type || !title) {
    return res.status(400).json({ message: 'Geräte-ID, Datum, Typ und Titel sind erforderlich.' });
  }

  const sql = `
    INSERT INTO device_maintenance (
        device_id, event_date, event_type, title, description, performed_by, status,
        created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
  `;
  const params = [ device_id, event_date, event_type, title, description, performed_by, status ];

  db.run(sql, params, function (err) {
    if (err) {
        console.error("DB Error (POST /maintenance):", err.message);
        return res.status(500).json({ message: 'Fehler beim Speichern.', error: err.message });
    }
    if (status === 'done') updateDeviceStatus(this.lastID); // Gerät aktualisieren
    res.status(201).json({ message: "Eintrag erstellt", maintenance_id: this.lastID });
  });
});

// PUT Update
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const {
      // device_id wird NICHT geändert
      event_date, event_type, title, description, performed_by, status
      // Hier weitere Felder holen
  } = req.body;

   if (!event_date || !event_type || !title) {
    return res.status(400).json({ message: 'Datum, Typ und Titel sind erforderlich.' });
  }

  const sql = `
    UPDATE device_maintenance
    SET event_date = ?, event_type = ?, title = ?, description = ?, performed_by = ?, status = ?,
        updated_at = datetime('now', 'localtime')
    WHERE maintenance_id = ?
  `;
  const params = [ event_date, event_type, title, description, performed_by, status, id ];

  db.run(sql, params, function (err) {
    if (err) {
        console.error("DB Error (PUT /maintenance/:id):", err.message);
        return res.status(500).json({ message: 'Fehler beim Aktualisieren.', error: err.message });
    }
    if (this.changes === 0) return res.status(404).json({ message: 'Eintrag nicht gefunden' });
    if (status === 'done') updateDeviceStatus(id); // Gerät aktualisieren
    res.json({ message: 'Eintrag erfolgreich aktualisiert.' });
  });
});

// DELETE
router.delete('/:id', (req, res) => {
  db.run('DELETE FROM device_maintenance WHERE maintenance_id = ?', [req.params.id], function (err) {
    if (err) {
        console.error("DB Error (DELETE /maintenance/:id):", err.message);
        return res.status(500).json({ message: 'Fehler beim Löschen.', error: err.message });
    }
    if (this.changes === 0) return res.status(404).json({ message: 'Eintrag nicht gefunden' });
    res.status(200).json({ message: 'Eintrag gelöscht.' }); // Oder 204 No Content
  });
});

// GET für einzelnes Gerät bleibt optional erhalten, wird aber von dieser Seite nicht direkt genutzt
router.get('/device/:deviceId', (req, res) => { /* ... (wie zuvor) ... */
  db.all(
    'SELECT * FROM device_maintenance WHERE device_id = ? ORDER BY event_date DESC',
    [req.params.deviceId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});


module.exports = router;