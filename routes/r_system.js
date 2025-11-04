// routes/r_system.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const { db } = require('../database');

// Hilfsfunktionen für die DB (Promises)
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Upload-Config (wie beim Geräte-Import)
const upload = multer({ storage: multer.memoryStorage() });

// --- DEFINITION DER TABELLEN ---
// WICHTIG: 'users' wird aus Sicherheitsgründen ignoriert.
const EXPORT_TABLES = [
  'device_categories',
  'accessory_categories',
  'models',
  'accessories',
  'rooms',
  'devices',
  'room_device_history',
  'device_accessories',
  'device_maintenance',
  'maintenance_files',
  'tasks'
];

// WICHTIG: Die Reihenfolge ist entscheidend für den Import (Abhängigkeiten zuerst)
const IMPORT_TABLES = [
  'device_categories',
  'accessory_categories',
  'models',
  'accessories',
  'rooms',
  'devices', // Benötigt models, rooms
  'room_device_history', // Benötigt devices, rooms
  'device_accessories', // Benötigt devices, accessories
  'device_maintenance', // Benötigt devices
  'maintenance_files', // Benötigt device_maintenance
  'tasks' // Benötigt rooms
];


/**
 * GET /api/system/export
 * Erstellt eine Excel-Datei mit allen Tabellen auf separaten Blättern.
 */
router.get('/export', async (req, res) => {
  try {
    const wb = XLSX.utils.book_new();

    for (const tableName of EXPORT_TABLES) {
      console.log(`Exportiere Tabelle: ${tableName}`);
      const data = await dbAll(`SELECT * FROM ${tableName}`);
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, tableName);
    }

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const timestamp = new Date().toISOString().slice(0, 10);
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="backup_inventardb_${timestamp}.xlsx"`);
    res.send(buffer);

  } catch (err) {
    console.error("Export-Fehler:", err);
    res.status(500).send(`Export fehlgeschlagen: ${err.message}`);
  }
});


/**
 * POST /api/system/import
 * Liest eine Excel-Datei und überschreibt die Datenbank-Tabellen.
 * HOCHGRADIG DESTRUKTIV!
 */
router.post('/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Keine Datei hochgeladen.' });

  const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
  const stats = { imported: 0, skipped: 0, errors: 0 };
  const errorDetails = [];

  try {
    await dbRun("BEGIN TRANSACTION");
    await dbRun("PRAGMA foreign_keys = OFF"); // Foreign Keys deaktivieren

    for (const tableName of IMPORT_TABLES) {
      const ws = wb.Sheets[tableName];
      if (!ws) {
        console.warn(`Blatt '${tableName}' nicht in Excel gefunden. Übersprungen.`);
        stats.skipped++;
        continue;
      }

      const rows = XLSX.utils.sheet_to_json(ws);
      console.log(`Importiere Blatt: ${tableName} (${rows.length} Zeilen)`);

      // 1. Tabelle komplett leeren
      await dbRun(`DELETE FROM ${tableName}`);
      // 2. Autoincrement-Zähler zurücksetzen (wichtig, damit alte IDs wieder eingefügt werden können)
      await dbRun(`DELETE FROM sqlite_sequence WHERE name = ?`, [tableName]);

      if (rows.length === 0) {
        stats.imported++; // Zählt als "erfolgreich importiert" (leer)
        continue;
      }
      
      // 3. Alle Zeilen neu einfügen
      // Spalten aus der ersten Zeile der Excel-Datei holen
      const keys = Object.keys(rows[0]);
      const placeholders = keys.map(() => '?').join(',');
      const sql = `INSERT INTO ${tableName} (${keys.join(',')}) VALUES (${placeholders})`;
      
      const stmt = db.prepare(sql);
      for (const row of rows) {
        // Sicherstellen, dass die Reihenfolge der Werte mit den Keys übereinstimmt
        const values = keys.map(k => row[k]);
        // Promise-Wrapper für stmt.run
        await new Promise((resolve, reject) => {
          stmt.run(values, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
      // Statement finalisieren
      await new Promise((resolve, reject) => {
        stmt.finalize((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      
      stats.imported++;
    }

    await dbRun("PRAGMA foreign_keys = ON"); // Foreign Keys reaktivieren
    await dbRun("COMMIT"); // Transaktion abschließen

    res.json({
      success: true,
      message: `Import erfolgreich! ${stats.imported} Tabellen importiert, ${stats.skipped} übersprungen.`,
      stats: stats
    });

  } catch (err) {
    await dbRun("ROLLBACK"); // Bei Fehler alles zurückrollen
    console.error("Import-Fehler:", err);
    errorDetails.push(err.message);
    res.status(500).json({
      success: false,
      message: `Import fehlgeschlagen: ${err.message}`,
      errors: errorDetails
    });
  }
});


module.exports = router;