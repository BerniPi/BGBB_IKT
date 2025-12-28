const express = require("express");
const ExcelJS = require('exceljs');
const PdfPrinter = require('pdfmake');
const { db, logActivity } = require("../database");
const router = express.Router();

/**
 * HILFSFUNKTION: Status-Sync-Logik
 * Setzt 'decommissioned_at' oder 'status' basierend auf dem anderen Wert.
 */
/**
 * Parst ein YYYY-MM-DD-Datum sicher in ein UTC-Date-Objekt.
 * @param {string} s - Datumsstring
 * @returns {Date|null}
 */
function simpleParseISO(s) {
  if (!s || typeof s !== 'string') return null;
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d)); // Wichtig: UTC verwenden
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null; // Ungültiges Datum wie 2025-02-30
  }
  return dt;
}

/**
 * Gibt den Tag vor einem YYYY-MM-DD-Datum zurück, ebenfalls als YYYY-MM-DD.
 * @param {string} isoDate - Startdatum
 * @returns {string|null}
 */
function simpleDayBefore(isoDate) {
  const d = simpleParseISO(isoDate);
  if (!d) return null; // Ungültiges Eingabedatum
  d.setUTCDate(d.getUTCDate() - 1); // Einen Tag zurück (UTC)
  
  // Zurück in YYYY-MM-DD formatieren
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}


function syncDeviceStatus(deviceData) {
  const data = { ...deviceData }; // Kopie erstellen

  // 1. Logik für 'status' (aus Bulk-Update)
  if (data.status) {
    if (data.status === "decommissioned") {
      // Wenn Status auf 'decommissioned' gesetzt wird, aber Datum fehlt: Datum setzen.
      data.decommissioned_at =
        data.decommissioned_at || new Date().toISOString().slice(0, 10);
    } else {
      // Bei jedem anderen Status: 'decommissioned_at' löschen.
      data.decommissioned_at = null;
    }
  }
  // 2. Logik für 'decommissioned_at' (aus Modal-Formular)
  else if (data.decommissioned_at) {
    // Wenn Datum gesetzt wird: Status MUSS 'decommissioned' sein.
    data.status = "decommissioned";
  }
  // 3. Logik für 'decommissioned_at' WIRD ENTFERNT
  else if (
    data.hasOwnProperty("decommissioned_at") &&
    data.decommissioned_at === null
  ) {
    // Wenn Datum explizit entfernt wird: Status auf 'active' zurücksetzen.
    // (Könnte auch 'storage' sein, aber 'active' ist ein sichererer Default)
    data.status = "active";
  }

  return data;
}

/**
 * GET /api/devices
 * Alle Geräte abrufen, mit Filterung und Sortierung.
 */
router.get("/", (req, res) => {
  const { category_id, model_id, room_id, status, sort, dir, q } = req.query;

  let params = [];
  let joins = [
    "LEFT JOIN models m ON d.model_id = m.model_id", // JOIN ist schon da
    "LEFT JOIN device_categories c ON m.category_id = c.category_id",
    "LEFT JOIN room_device_history h ON h.device_id = d.device_id AND h.to_date IS NULL",
    "LEFT JOIN rooms r ON h.room_id = r.room_id",
  ];
  let wheres = [];

  // --- Filter (bleiben unverändert) ---
  if (status && status !== "all_incl_decommissioned") {
    /* ... */
    if (status === "all") {
      wheres.push("d.status != 'decommissioned'");
    } else {
      wheres.push("d.status = ?");
      params.push(status);
    }
  }
  if (category_id) {
    wheres.push("c.category_id = ?");
    params.push(category_id);
  }
  if (model_id) {
    wheres.push("d.model_id = ?");
    params.push(model_id);
  }
  if (room_id) {
    wheres.push("h.room_id = ?");
    params.push(room_id);
  }

  // ... (nach den Filtern für category_id, model_id, room_id)

  // ===  Globale Suche (q) ===
  if (q) {
    // Füge die Suchbedingung hinzu.
    // Wir durchsuchen Seriennummer, Inventarnummer und Modellnummer.
    // (d = devices, m = models)
    wheres.push(`
        (
          d.serial_number LIKE ? OR
          d.inventory_number LIKE ? OR
          m.model_number LIKE ? OR
          m.model_name LIKE ? OR
          d.hostname LIKE ? OR
          d.mac_address LIKE ? OR
          d.ip_address LIKE ? OR
          r.room_name LIKE ? OR
          r.room_number LIKE ? OR
          d.notes LIKE ?
        )
      `);
    const searchTerm = `%${q}%`;
    params.push(
      searchTerm, // serial_number
      searchTerm, // inventory_number
      searchTerm, // model_number
      searchTerm, // model_name (NEU)
      searchTerm, // hostname (NEU)
      searchTerm, // mac_address (NEU)
      searchTerm, // ip_address (NEU)
      searchTerm, // room_name (NEU)
      searchTerm, // room_number (NEU)
      searchTerm  // notes (NEU)
    );
  }
  // === ENDE NEU ===
  //
  // --- Sortierung (bleibt unverändert) ---
const sortDir = dir ? (dir === "desc" ? "DESC" : "ASC") : "DESC"; 
const sortWhitelist = {
    device_id: "d.device_id",
    category_name: "c.category_name",
    model_name: "m.model_name",
    hostname: "d.hostname",
    serial_number: "d.serial_number",
    inventory_number: "d.inventory_number",
    mac_address: "d.mac_address",
    ip_address: "d.ip_address",
    room_number: "r.room_number",
    room_name: "r.room_name",
    status: "d.status",
    notes: "d.notes",
  };
const orderBy = sortWhitelist[sort] || "d.device_id";

  // === SQL SELECT ANPASSUNG START ===
  const sql = `
    SELECT
        d.*,                     -- Alle Felder vom Gerät
        m.model_number,
        m.model_name,
        c.category_name,
        r.room_name,
        r.room_number,
        r.room_id,
        -- Effektive Werte (Gerätewert ODER Modellwert)
        COALESCE(d.purchase_date, m.purchase_date) as effective_purchase_date,
        COALESCE(d.price_cents, m.price_cents) as effective_price_cents,
        COALESCE(d.warranty_months, m.warranty_months) as effective_warranty_months,
        -- Originale Modellwerte (nützlich für Placeholders im Frontend)
        m.purchase_date AS model_purchase_date,
        m.price_cents AS model_price_cents,
        m.warranty_months AS model_warranty_months
    FROM devices d
    ${joins.join("\n")}
    ${wheres.length > 0 ? "WHERE " + wheres.join(" AND ") : ""}
    ORDER BY ${orderBy} ${sortDir}
  `;
  // === SQL SELECT ANPASSUNG ENDE ===

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error("DB Error (GET /devices):", err); // Logge den Fehler
      return res.status(500).json({
        message: "Fehler beim Abrufen der Gerätedaten.",
        error: err.message,
      });
    }
    res.json(rows);
  });
});

// ... (ganz unten in der Datei, vor module.exports)

/**
 * GET /api/devices/export
 * Exportiert Geräte als XLSX oder PDF
 */
router.get("/export", (req, res) => {
  const { category_id, model_id, room_id, status, sort, dir, q, format, columns } = req.query;

  // 1. SQL Query Aufbau (Identisch zur GET / Route, um Konsistenz zu wahren)
  // Wir kopieren die Logik hier rein, um sicherzustellen, dass der Export genau das Filterergebnis matcht.
  
  let params = [];
  let joins = [
    "LEFT JOIN models m ON d.model_id = m.model_id",
    "LEFT JOIN device_categories c ON m.category_id = c.category_id",
    "LEFT JOIN room_device_history h ON h.device_id = d.device_id AND h.to_date IS NULL",
    "LEFT JOIN rooms r ON h.room_id = r.room_id",
  ];
  let wheres = [];

  if (status && status !== "all_incl_decommissioned") {
    if (status === "all") {
      wheres.push("d.status != 'decommissioned'");
    } else {
      wheres.push("d.status = ?");
      params.push(status);
    }
  }
  if (category_id) { wheres.push("c.category_id = ?"); params.push(category_id); }
  if (model_id) { wheres.push("d.model_id = ?"); params.push(model_id); }
  if (room_id) { wheres.push("h.room_id = ?"); params.push(room_id); }

  if (q) {
    wheres.push(`(
      d.serial_number LIKE ? OR d.inventory_number LIKE ? OR m.model_number LIKE ? OR
      m.model_name LIKE ? OR d.hostname LIKE ? OR d.mac_address LIKE ? OR
      d.ip_address LIKE ? OR r.room_name LIKE ? OR r.room_number LIKE ? OR d.notes LIKE ?
    )`);
    const s = `%${q}%`;
    params.push(s, s, s, s, s, s, s, s, s, s);
  }

  const sortDir = dir ? (dir === "desc" ? "DESC" : "ASC") : "DESC";
  const sortWhitelist = {
    category_name: "c.category_name",
    model_name: "m.model_name",
    hostname: "d.hostname",
    serial_number: "d.serial_number",
    inventory_number: "d.inventory_number",
    mac_address: "d.mac_address",
    ip_address: "d.ip_address",
    room_number: "r.room_number",
    room_name: "r.room_name",
    status: "d.status",
    notes: "d.notes",
  };
  const orderBy = sortWhitelist[sort] || "d.device_id";

  const sql = `
    SELECT
        d.*, m.model_number, m.model_name, c.category_name,
        r.room_name, r.room_number,
        COALESCE(d.purchase_date, m.purchase_date) as effective_purchase_date,
        COALESCE(d.price_cents, m.price_cents) as effective_price_cents,
        COALESCE(d.warranty_months, m.warranty_months) as effective_warranty_months
    FROM devices d
    ${joins.join("\n")}
    ${wheres.length > 0 ? "WHERE " + wheres.join(" AND ") : ""}
    ORDER BY ${orderBy} ${sortDir}
  `;

  db.all(sql, params, async (err, rows) => {
    if (err) return res.status(500).send("DB Error: " + err.message);

    // 2. Daten aufbereiten (Spalten definieren)
    // Wenn 'columns' Parameter da ist, filtern wir. Sonst "Alle".
    const requestedCols = columns ? columns.split(',') : null;

    // Definition aller möglichen Spalten für den Export
    const allColDefs = [
        { key: 'device_id', header: 'ID', width: 6 },
        { key: 'category_name', header: 'Kategorie', width: 15 },
        { key: 'model_name', header: 'Modell', width: 20 },
        { key: 'model_number', header: 'Modell-Nr.', width: 15 },
        { key: 'hostname', header: 'Hostname', width: 15 },
        { key: 'serial_number', header: 'Seriennr.', width: 15 },
        { key: 'inventory_number', header: 'Inventarnr.', width: 15 },
        { key: 'mac_address', header: 'MAC', width: 17 },
        { key: 'ip_address', header: 'IP', width: 15 },
        { key: 'room_name', header: 'Raum', width: 15,
          formatter: (row) => (row.room_number ? `${row.room_number} ${row.room_name}` : row.room_name) 
        },
        { key: 'status', header: 'Status', width: 10 },
        { key: 'effective_purchase_date', header: 'Kaufdatum', width: 12 },
        { key: 'effective_price_cents', header: 'Preis (€)', width: 10, 
          formatter: (row) => row.effective_price_cents ? (row.effective_price_cents / 100).toFixed(2) : '' 
        },
        { key: 'notes', header: 'Notizen', width: 25 },
        { key: 'added_at', header: 'Hinzugefügt', width: 12 },
        { key: 'last_inspected', header: 'Geprüft', width: 12 }
    ];

    // Filtere Spalten basierend auf User-Wunsch (visible vs all)
    let exportCols = allColDefs;
    if (requestedCols) {
        // Mappe requestedCols (strings) auf ColDefs
        exportCols = allColDefs.filter(def => {
            // Spezialfall: room_name deckt 'room' ab
            if (requestedCols.includes(def.key)) return true;
            // Wenn Frontend 'room' schickt, nehmen wir 'room_name'
            if (def.key === 'room_name' && requestedCols.includes('room_name')) return true; 
            return false;
        });
        // Falls nichts matcht (Sicherheitsfallback), nimm alles
        if (exportCols.length === 0) exportCols = allColDefs;
    }

    // --- Formatierung: Excel (XLSX) ---
    if (format === 'xlsx') {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Geräteliste');

        // Header setzen
        sheet.columns = exportCols.map(c => ({ header: c.header, key: c.key, width: c.width }));

        // Zeilen hinzufügen
        rows.forEach(row => {
            const rowData = {};
            exportCols.forEach(col => {
                // Nutze Formatter wenn vorhanden, sonst Rohwert
                rowData[col.key] = col.formatter ? col.formatter(row) : row[col.key];
            });
            sheet.addRow(rowData);
        });

        // Styling (optional: Header fett)
        sheet.getRow(1).font = { bold: true };

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="geraete_export.xlsx"');

        await workbook.xlsx.write(res);
        res.end();
    } 
    
    // --- Formatierung: PDF ---
    else if (format === 'pdf') {
        const fonts = {
            Roboto: {
                normal: 'Helvetica',
                bold: 'Helvetica-Bold',
                italics: 'Helvetica-Oblique',
                bolditalics: 'Helvetica-BoldOblique'
            }
        };
        const printer = new PdfPrinter(fonts);

        // Body für PDF Tabelle bauen
        const body = [];
        
        // 1. Header Row
        const headerRow = exportCols.map(c => ({ text: c.header, style: 'tableHeader' }));
        body.push(headerRow);

        // 2. Data Rows
        rows.forEach(row => {
            const dataRow = exportCols.map(col => {
                const val = col.formatter ? col.formatter(row) : row[col.key];
                return val == null ? '' : String(val);
            });
            body.push(dataRow);
        });

        const docDefinition = {
            pageOrientation: exportCols.length > 7 ? 'landscape' : 'portrait',
            content: [
                { text: 'Geräteliste Export', style: 'header' },
                { text: `Erstellt am: ${new Date().toLocaleDateString()}`, margin: [0, 0, 0, 10] },
                {
                    table: {
                        headerRows: 1,
                        widths: Array(exportCols.length).fill('auto'), // oder 'star' für adaptive Breite
                        body: body
                    },
                    layout: 'lightHorizontalLines'
                }
            ],
            styles: {
                header: { fontSize: 18, bold: true, margin: [0, 0, 0, 10] },
                tableHeader: { bold: true, fontSize: 11, color: 'black', fillColor: '#eeeeee' }
            },
            defaultStyle: {
                fontSize: 9
            }
        };

        const pdfDoc = printer.createPdfKitDocument(docDefinition);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="geraete_export.pdf"');
        pdfDoc.pipe(res);
        pdfDoc.end();
    } else {
        res.status(400).send("Ungültiges Format. Bitte 'xlsx' oder 'pdf' wählen.");
    }
  });
});

/**
 * GET /api/devices/:id
 * Ein einzelnes Gerät mit allen JOINs abrufen (für Modal-Links).
 */
router.get("/:id", (req, res) => {
  const deviceId = req.params.id;
  // Wir verwenden dieselbe komplexe Abfrage wie in der Haupt-GET-Route
  const sql = `
    SELECT
        d.*,                     -- Alle Felder vom Gerät
        m.model_number,
        m.model_name,
        c.category_name,
        r.room_name,
        r.room_number,
        r.room_id,
        -- Effektive Werte
        COALESCE(d.purchase_date, m.purchase_date) as effective_purchase_date,
        COALESCE(d.price_cents, m.price_cents) as effective_price_cents,
        COALESCE(d.warranty_months, m.warranty_months) as effective_warranty_months,
        -- Originale Modellwerte
        m.purchase_date AS model_purchase_date,
        m.price_cents AS model_price_cents,
        m.warranty_months AS model_warranty_months
    FROM devices d
    LEFT JOIN models m ON d.model_id = m.model_id
    LEFT JOIN device_categories c ON m.category_id = c.category_id
    LEFT JOIN room_device_history h ON h.device_id = d.device_id AND h.to_date IS NULL
    LEFT JOIN rooms r ON h.room_id = r.room_id
    WHERE d.device_id = ?
  `;

  db.get(sql, [deviceId], (err, row) => {
    if (err) {
      console.error("DB Error (GET /devices/:id):", err);
      return res
        .status(500)
        .json({ message: "DB Fehler", error: err.message });
    }
    if (!row) {
      return res.status(404).json({ message: "Gerät nicht gefunden" });
    }
    res.json(row);
  });
});

/**
 * POST /api/devices
 * Ein neues Gerät erstellen.
 */
router.post("/", (req, res) => {
  // Wichtig: 'hostname' und andere Felder aus dem Body holen
  let data = req.body || {};

  // Status-Logik anwenden
  data = syncDeviceStatus(data);

  const sql = `
    INSERT INTO devices (
      model_id, hostname, serial_number, inventory_number,
      mac_address, ip_address, added_at, decommissioned_at,
      purchase_date, price_cents, warranty_months,
      status, last_cleaned, last_inspected, notes
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `;

  const params = [
    data.model_id || null,
    data.hostname || null,
    data.serial_number || null,
    data.inventory_number || null,
    data.mac_address || null,
    data.ip_address || null,
    data.added_at || null,
    data.decommissioned_at || null,
    data.purchase_date || null,
    data.price_cents || null,
    data.warranty_months || null,
    data.status || "active", // Default 'active', falls sync-Logik nicht greift
    data.last_cleaned || null,
    data.last_inspected || null,
    data.notes || null,
  ];

  db.run(sql, params, function (err) {
    if (err) {
      // Eindeutigkeitsverletzung abfangen (z.B. serial_number, hostname)
      if (err.message.includes("UNIQUE constraint failed")) {
        return res.status(409).json({
          message: `Konflikt: Ein Wert (z.B. Seriennummer oder Hostname) existiert bereits. ${err.message}`,
        });
      }
      return res.status(500).json({ message: err.message });
    }
// HIER LOGGEN:
  logActivity(
    req.user.username, // Bekommen wir vom authMiddleware
    'CREATE',
    'device',
    this.lastID,       // Die ID des neuen Geräts
    { hostname: data.hostname, model_id: data.model_id } // Kontext
  );

    res.status(201).json({ device_id: this.lastID });
  });
});

/**
 * PUT /api/devices/:id
 * Ein bestehendes Gerät aktualisieren.
 */

router.put("/:id", (req, res) => {
  const deviceId = req.params.id;
  let data = req.body || {};

  // Status-Logik anwenden
  data = syncDeviceStatus(data);

  // Dynamisch nur die Felder aktualisieren, die auch im Payload sind
  const updates = [
    { key: "model_id", value: data.model_id },
    { key: "hostname", value: data.hostname },
    { key: "serial_number", value: data.serial_number },
    { key: "inventory_number", value: data.inventory_number },
    { key: "mac_address", value: data.mac_address },
    { key: "ip_address", value: data.ip_address },
    { key: "added_at", value: data.added_at },
    { key: "decommissioned_at", value: data.decommissioned_at },
    { key: "purchase_date", value: data.purchase_date },
    { key: "price_cents", value: data.price_cents },
    { key: "warranty_months", value: data.warranty_months },
    { key: "status", value: data.status },
    { key: "last_cleaned", value: data.last_cleaned },
    { key: "last_inspected", value: data.last_inspected },
    { key: "notes", value: data.notes },
  ];

  // Filtere Felder, die 'undefined' sind (nicht im Payload waren)
  const finalUpdates = updates.filter((u) => u.value !== undefined);

  if (finalUpdates.length === 0) {
    return res
      .status(400)
      .json({ message: "Keine Daten zum Aktualisieren gesendet." });
  }

  const setClauses = finalUpdates.map((u) => `${u.key} = ?`).join(", ");
  const params = finalUpdates.map((u) => (u.value === "" ? null : u.value)); // Leere Strings als NULL speichern
  params.push(deviceId);

  const sql = `UPDATE devices SET ${setClauses} WHERE device_id = ?`;

  // =================================================================
  // NEUE LOGIK: ZUERST ALTEN DATENSATZ FÜR LOGGING HOLEN
  // =================================================================
  db.get("SELECT * FROM devices WHERE device_id = ?", [deviceId], (err, oldDevice) => {
    if (err) {
      return res.status(500).json({ 
        message: "Fehler beim Abrufen des alten Gerätestatus für das Logging.", 
        error: err.message 
      });
    }
    // (Keine Sorge, wenn oldDevice null ist, schlägt der Update-Befehl
    // unten ohnehin fehl und gibt eine 404 zurück)

    // FÜHRE JETZT DAS UPDATE DURCH
    db.run(sql, params, function (err) {
      if (err) {
        if (err.message.includes("UNIQUE constraint failed")) {
          return res.status(409).json({
            message: `Konflikt: Ein Wert (z.B. Seriennummer oder Hostname) existiert bereits. ${err.message}`,
          });
        }
        return res.status(500).json({ message: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ message: "Gerät nicht gefunden." });
      }

      // --- NEUE LOGGING-STELLE (mit oldDevice) ---
      try {
        const details = {};
        
        finalUpdates.forEach(update => {
          const key = update.key;
          const newValue = update.value === "" ? null : update.value; // "" als null behandeln
          const oldValue = oldDevice ? oldDevice[key] : null;

          // Logge nur, wenn sich der Wert wirklich geändert hat
          // (Verhindert z.B. Logs für "" vs. null)
          if (String(newValue ?? "") !== String(oldValue ?? "")) {
            
            // Notizen kürzen, um das Log nicht aufzublähen
            if (key === 'notes' && (newValue || oldValue)) {
              details[key] = { 
                old: oldValue ? '[Notiz vorhanden]' : '[leer]', 
                new: newValue ? '[Notiz aktualisiert]' : '[leer]' 
              };
            } else {
              details[key] = { old: oldValue, new: newValue };
            }
          }
        });

        // Nur loggen, wenn es echte Änderungen gab
        if (Object.keys(details).length > 0) {
          logActivity(
            req.user.username,
            'UPDATE',
            'device',
            deviceId,
            details // Das Objekt mit {old: ..., new: ...}
          );
        }
      } catch (logErr) {
        console.error("Fehler beim Schreiben des Activity Logs (UPDATE):", logErr);
      }
      // --- ENDE LOGGING ---

      res.json({ message: "Gerät aktualisiert." });
    });
  });
});
/**
 * DELETE /api/devices/:id
 * Ein Gerät löschen (mit erweitertem Logging).
 */
router.delete("/:id", (req, res) => {
  const deviceId = req.params.id;

  // --- SCHRITT 1: GERÄTEDATEN FÜR LOGGING VORABRUFEN ---
  // Wir holen alle Infos, die wir im Log speichern wollen.
  const getSql = `
    SELECT
        d.hostname,
        d.serial_number,
        d.inventory_number,
        m.model_name,
        r.room_name,
        r.room_number
    FROM devices d
    LEFT JOIN models m ON d.model_id = m.model_id
    LEFT JOIN room_device_history h ON h.device_id = d.device_id AND h.to_date IS NULL
    LEFT JOIN rooms r ON h.room_id = r.room_id
    WHERE d.device_id = ?
  `;

  db.get(getSql, [deviceId], (err, oldDeviceData) => {
    if (err) {
      return res.status(500).json({ 
        message: "Fehler beim Abrufen der Gerätedaten vor dem Löschen.", 
        error: err.message 
      });
    }
    
    // Wenn !oldDeviceData, existiert das Gerät nicht.
    // Wir können hier direkt 404 zurückgeben, da auch der DELETE fehlschlagen würde.
    if (!oldDeviceData) {
      return res.status(404).json({ message: "Gerät nicht gefunden." });
    }

    // --- SCHRITT 2: GERÄT LÖSCHEN ---
    db.run("DELETE FROM devices WHERE device_id = ?", [deviceId], function (err) {
      if (err) {
        // Falls das Löschen fehlschlägt (z.B. Foreign Key Constraint)
        return res.status(500).json({ message: err.message });
      }
      
      // (this.changes === 0 sollte dank db.get() oben nie passieren,
      // aber wir lassen die 404-Prüfung von db.get() die Hauptarbeit machen)

      // --- SCHRITT 3: LOGGEN (mit den alten Daten) ---
      
      // Bereite das Detail-Objekt für das Log vor
      const logDetails = {
        hostname: oldDeviceData.hostname,
        serial_number: oldDeviceData.serial_number,
        model_name: oldDeviceData.model_name,
        inventory_number: oldDeviceData.inventory_number,
        // Kombiniere Raum-Infos
        last_room: (oldDeviceData.room_number || oldDeviceData.room_name) 
                   ? `${oldDeviceData.room_number || ''} (${oldDeviceData.room_name || ''})`.replace(" ()", "").trim()
                   : null
      };
      
      // Entferne null/undefined-Werte aus den Details, um das Log sauber zu halten
      Object.keys(logDetails).forEach(key => {
        if (logDetails[key] === null || logDetails[key] === undefined) {
          delete logDetails[key];
        }
      });

      try {
        logActivity(
          req.user.username,
          'DELETE',
          'device',
          deviceId,
          logDetails // HIER die abgerufenen Details übergeben
        );
      } catch (logErr) {
        console.error("Fehler beim Schreiben des Activity Logs (DELETE):", logErr);
        // Wir senden trotzdem Erfolg, da das Gerät gelöscht wurde.
      }

      // --- SCHRITT 4: ERFOLG MELDEN ---
      res.status(200).json({ message: "Gerät gelöscht." });  
    });
  });
});

/**
 * PUT /api/devices/:id/mark-inspected
 * Setzt 'last_inspected' für ein Gerät auf ein bestimmtes Datum (oder heute).
 */
router.put("/:id/mark-inspected", (req, res) => {
  const username = req.user.username || "system";
  const { id } = req.params;
  const { date } = req.body; // Erlaube optionales Datum

  const inspectionDate =
    (date && String(date).slice(0, 10)) ||
    new Date().toISOString().slice(0, 10);

  // --- SCHRITT 1: ALTEN WERT FÜR LOGGING HOLEN ---
  db.get(
    "SELECT last_inspected FROM devices WHERE device_id = ?",
    [id],
    (err, oldDevice) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "DB-Fehler (Log-Check)", error: err.message });
      }
      if (!oldDevice) {
        return res.status(404).json({ message: "Gerät nicht gefunden." });
      }
      
      const oldDate = oldDevice.last_inspected;

      // --- SCHRITT 2: UPDATE DURCHFÜHREN ---
      const sql = "UPDATE devices SET last_inspected = ? WHERE device_id = ?";
      db.run(sql, [inspectionDate, id], function (err) {
        if (err) {
          return res.status(500).json({ message: err.message });
        }
        // (this.changes === 0 sollte nie passieren, da wir oben schon 404 zurückgeben)

        // --- SCHRITT 3: LOGGING (mit Alt/Neu-Vergleich) ---
        try {
          const details = {
            last_inspected: { old: oldDate, new: inspectionDate },
          };
          
          // Logge nur, wenn sich das Datum wirklich geändert hat
          if (String(oldDate ?? "") !== String(inspectionDate ?? "")) {
            logActivity(
              req.user.username,
              'UPDATE',
              'device',
              id,
              details // { last_inspected: { old: "...", new: "..." } }
            );
          }
        } catch (logErr) {
          console.error(
            "Fehler beim Schreiben des Activity Logs (mark-inspected):",
            logErr,
          );
        }
        // --- ENDE SCHRITT 3 ---

        res.json({
          message: "Gerät als kontrolliert markiert.",
          date: inspectionDate,
        });
      });
    },
  );
});

// ... (vor der Sektion RAUM-HISTORIE)

/**
 *  POST /api/devices/:id/move-to-room
 * Verschiebt ein Gerät in einen neuen Raum (schließt alten Eintrag, öffnet neuen).
 * Dies ist eine atomare Transaktion.
 */
router.post("/:id/move-to-room", (req, res) => {
  const deviceId = req.params.id;
  const { new_room_id, move_date } = req.body;

  if (!new_room_id || !move_date) {
    return res
      .status(400)
      .json({ message: "new_room_id und move_date sind erforderlich." });
  }

  // Sicherstellen, dass das Datum ein gültiges YYYY-MM-DD Format hat
  const moveDate = new Date(move_date).toISOString().slice(0, 10);

  db.serialize(() => {
    db.run("BEGIN TRANSACTION", (err) => {
      if (err) return res.status(500).json({ message: err.message });
    });

    let errorOccurred = false;

    // 1. Alle offenen Einträge für dieses Gerät schließen
    // (Offen = to_date IS NULL)
    const sqlClose = `
      UPDATE room_device_history
      SET to_date = ?
      WHERE device_id = ? AND to_date IS NULL
    `;

    db.run(sqlClose, [moveDate, deviceId], function (err) {
      if (err) {
        console.error("Fehler bei Transaktion (move-to-room / CLOSE):", err);
        errorOccurred = err;
      }
    });

    // 2. Neuen Eintrag erstellen
    const sqlInsert = `
      INSERT INTO room_device_history (device_id, room_id, from_date, to_date, notes)
      VALUES (?, ?, ?, NULL, ?)
    `;
    const insertNotes = "Per Walkthrough-Suche verschoben";

    db.run(
      sqlInsert,
      [deviceId, new_room_id, moveDate, insertNotes],
      function (err) {
        if (err) {
          console.error("Fehler bei Transaktion (move-to-room / INSERT):", err);
          errorOccurred = err;
        }
      },
    );

    // 3. Transaktion abschließen
    const finalCmd = errorOccurred ? "ROLLBACK" : "COMMIT";
    db.run(finalCmd, (err) => {
      if (err) {
        // Wenn selbst der Rollback fehlschlägt
        return res
          .status(500)
          .json({ message: `Fatal DB Error (${finalCmd}): ${err.message}` });
      }

      if (errorOccurred) {
        return res.status(500).json({
          message: "DB-Fehler beim Verschieben (Rollback durchgeführt).",
          error: errorOccurred.message,
        });
      } else {
        try {
          logActivity(
            req.user.username,
            'MOVE', // Neuer Aktionstyp
            'device',
            deviceId,
            { 
              action: "move-to-room", 
              new_room_id: new_room_id, 
              move_date: moveDate 
            }
          );
        } catch (logErr) {
          console.error("Fehler beim Schreiben des Activity Logs (move-to-room):", logErr);
        }
        return res.json({ message: "Gerät erfolgreich verschoben." });
      }
    });
  });
});


/**
 *  PUT /api/devices/:id/correct-current-room
 * Korrigiert den 'room_id' des *letzten* Historieneintrags.
 */
router.put("/:id/correct-current-room", (req, res) => {
  const deviceId = req.params.id;
  const { new_room_id } = req.body;

  if (!new_room_id) {
    return res.status(400).json({ message: "new_room_id ist erforderlich." });
  }

  const getOldSql = `
    SELECT room_id 
    FROM room_device_history 
    WHERE device_id = ? 
    ORDER BY from_date DESC, history_id DESC 
    LIMIT 1
  `;
  db.get(getOldSql, [deviceId], (err, oldEntry) => {
    if (err) return res.status(500).json({ message: "DB Fehler (Log-Check)", error: err.message });
    
    // (Fahre fort, auch wenn oldEntry nicht gefunden wird)
    const old_room_id = oldEntry ? oldEntry.room_id : null;
  // Diese Abfrage findet den history_id des Eintrags mit dem letzten 'from_date'
  // und aktualisiert dessen 'room_id'.
  const sql = `
    UPDATE room_device_history
    SET room_id = ? 
    WHERE history_id = (
        SELECT history_id
        FROM room_device_history
        WHERE device_id = ?
        ORDER BY 
            from_date DESC, 
            history_id DESC
        LIMIT 1
    )
  `;

  db.run(sql, [new_room_id, deviceId], function (err) {
    if (err) {
      return res.status(500).json({
        message: "DB-Fehler bei der Korrektur.",
        error: err.message,
      });
    }
    if (this.changes === 0) {
      return res
        .status(404)
        .json({ message: "Kein Historieneintrag zum Korrigieren gefunden." });
    }

    try {
        logActivity(
          req.user.username,
          'UPDATE',
          'device',
          deviceId,
          { 
            action: "correct-current-room",
            room_id: { old: old_room_id, new: new_room_id }
          }
        );
      } catch (logErr) {
        console.error("Fehler beim Schreiben des Activity Logs (correct-room):", logErr);
      }
      // --- ENDE NEU ---

      res.json({ message: "Raum-Historie erfolgreich korrigiert." });
    });
  });
});

/**
 *  PUT /api/devices/:id/end-current-room
 * Beendet den aktuell offenen Raumeintrag (setzt to_date).
 */
router.put("/:id/end-current-room", (req, res) => {
  const deviceId = req.params.id;
  const { to_date } = req.body; // Erwartet z.B. { "to_date": "2025-10-30" }

  if (!to_date) {
    return res.status(400).json({ message: "to_date ist erforderlich." });
  }

  // Diese Abfrage findet den letzten *offenen* Eintrag (to_date IS NULL)
  // und setzt dessen to_date.
  const sql = `
    UPDATE room_device_history
    SET to_date = ?
    WHERE history_id = (
        SELECT history_id
        FROM room_device_history
        WHERE device_id = ? AND to_date IS NULL
        ORDER BY from_date DESC
        LIMIT 1
    )
  `;

  db.run(sql, [to_date, deviceId], function (err) {
    if (err) {
      return res.status(500).json({
        message: "DB-Fehler beim Beenden des Raumeintrags.",
        error: err.message,
      });
    }
    if (this.changes === 0) {
      return res
        .status(404)
        .json({ message: "Kein offener Raumeintrag zum Beenden gefunden." });
    }
    try {
      logActivity(
        req.user.username,
        'UPDATE',
        'device',
        deviceId,
        { 
          action: "end-current-room",
          to_date: to_date
        }
      );
    } catch (logErr) {
      console.error("Fehler beim Schreiben des Activity Logs (end-room):", logErr);
    }
    res.json({ message: "Raumeintrag erfolgreich beendet." });
  });
});

/* ------------------------------
   RAUM-HISTORIE
-------------------------------*/
// ... (Rest der Datei r_devices.js)

/**
 * GET /api/devices/:id/rooms-history
 * Raum-Historie für ein Gerät abrufen.
 */
router.get("/:id/rooms-history", (req, res) => {
  const deviceId = req.params.id;
  const sql = `
    SELECT h.*, r.room_name, r.room_number
    FROM room_device_history h
    LEFT JOIN rooms r ON h.room_id = r.room_id
    WHERE h.device_id = ?
    ORDER BY h.from_date ASC
  `;
  db.all(sql, [deviceId], (err, rows) => {
    if (err) return res.status(500).json({ message: err.message });
    res.json(rows);
  });
});

// r_devices.js

/**
 * POST /api/devices/:id/rooms-history
 * Neuen Historien-Eintrag hinzufügen.
 * (MODIFIZIERT: Nutzt Transaktion, um alte Einträge zu schließen/korrigieren)
 */
router.post("/:id/rooms-history", (req, res) => {
  const deviceId = req.params.id;
  const { room_id, from_date, to_date, notes } = req.body;

  if (!room_id || !from_date) {
    return res
      .status(400)
      .json({ message: "Raum und Von-Datum sind erforderlich." });
  }

  // 1. Tag vor dem neuen Startdatum berechnen
  // (simpleDayBefore ist oben in r_devices.js definiert)
  const day_before_new_from = simpleDayBefore(from_date); 
  if (!day_before_new_from) {
     return res.status(400).json({ message: "Ungültiges 'from_date'. Bitte YYYY-MM-DD verwenden." });
  }

  // 2. Transaktion starten
  db.serialize(() => {
    db.run("BEGIN TRANSACTION", (err) => {
      if (err) return res.status(500).json({ message: `DB Error (BEGIN): ${err.message}` });
    });

    let errorOccurred = null;

    // 3. Alle Einträge korrigieren, die mit dem neuen 'from_date' kollidieren
    // (Setzt 'to_date' auf den Tag vor dem neuen Start)
    // Das betrifft:
    //    a) Offene Einträge (to_date IS NULL)
    //    b) Überlappende Einträge (to_date >= from_date)
    const sqlClose = `
      UPDATE room_device_history
      SET to_date = ?
      WHERE device_id = ?
        AND from_date < ?  -- Nur Einträge, die *vorher* gestartet sind
        AND (to_date >= ? OR to_date IS NULL) -- Und *hineinragen* oder offen sind
    `;
    
    db.run(sqlClose, [day_before_new_from, deviceId, from_date, from_date], function (err) {
      if (err) {
        console.error("Fehler bei Transaktion (room-history / CLOSE):", err);
        errorOccurred = err;
      }
    });

    // 4. Neuen Eintrag einfügen
    const sqlInsert = `
      INSERT INTO room_device_history (device_id, room_id, from_date, to_date, notes)
      VALUES (?, ?, ?, ?, ?)
    `;
    
    let newHistoryId = null; // Variable für die neue ID (für Logging)

    db.run(
      sqlInsert,
      [deviceId, room_id, from_date, to_date || null, notes || null],
      function (err) {
        if (err) {
          console.error("Fehler bei Transaktion (room-history / INSERT):", err);
          errorOccurred = err;
        }
        
        // Speichere die ID für das Logging
        newHistoryId = this.lastID;

        // 5. Transaktion abschließen
        const finalCmd = errorOccurred ? "ROLLBACK" : "COMMIT";
        db.run(finalCmd, (err) => {
          if (err) {
            return res.status(500).json({ message: `Fatal DB Error (${finalCmd}): ${err.message}` });
          }

          if (errorOccurred) {
            return res.status(500).json({
              message: "DB-Fehler beim Hinzufügen (Rollback durchgeführt).",
              error: errorOccurred.message,
            });
          }

          // 6. Logging (nur bei Erfolg)
          try {
            logActivity(
              req.user.username,
              'CREATE',
              'device', // Log auf das Gerät
              deviceId,
              { 
                action: "add-room-history",
                history_id: newHistoryId, // Verwende die gespeicherte ID
                room_id: room_id,
                from_date: from_date
              }
            );
          } catch (logErr) {
            console.error("Fehler beim Schreiben des Activity Logs (add-room-history):", logErr);
          }
          
          // 7. Erfolg melden
          res.status(201).json({ history_id: newHistoryId });
        });
      }
    );
  });
});

/**
 * PUT /api/devices/:id/rooms-history/:history_id
 * Historien-Eintrag aktualisieren (MIT ÜBERSCHNEIDUNGS-PRÜFUNG).
 */
router.put("/:id/rooms-history/:history_id", (req, res) => {
  const { id: deviceId, history_id } = req.params;
  const { room_id, from_date, to_date, notes } = req.body;

  // Bereinige 'to_date' (leerer String -> null)
  const finalToDate = to_date || null;
  const finalNotes = notes || null;

  // === 1. NEU: Interne Datumsvalidierung ===
  if (finalToDate && finalToDate < from_date) {
    return res.status(400).json({
      message:
        "Validierungsfehler: Das 'Bis'-Datum darf nicht vor dem 'Von'-Datum liegen.",
    });
  }

  // === 2. NEU: Überschneidungs-Check (Overlap Validation) ===
  // Wir suchen nach JEDEM ANDEREN Eintrag (history_id != ?) für DIESES Gerät,
  // dessen Zeitraum [F2, T2] sich mit dem NEUEN Zeitraum [F1, T1] überschneidet.
  //
  // Klassische Überlappung: (F1 <= T2) AND (T1 >= F2)
  // Wir müssen NULL (unendlich) für T1 und T2 berücksichtigen.
  const overlapSql = `
    SELECT COUNT(*) as overlap_count
    FROM room_device_history
    WHERE
      device_id = ?       -- Für dieses Gerät
      AND history_id != ?   -- Außer dem Eintrag, den wir bearbeiten
      AND (
        -- Bedingung 1: F1 <= T2 (Neues 'Von' liegt vor/an altem 'Bis')
        -- (Wenn T2 NULL ist, ist die Bedingung immer wahr, da T2 = unendlich)
        ? <= to_date OR to_date IS NULL
      )
      AND (
        -- Bedingung 2: T1 >= F2 (Neues 'Bis' liegt nach/an altem 'Von')
        -- (Wenn T1 NULL ist, ist die Bedingung immer wahr, da T1 = unendlich)
        ? >= from_date OR ? IS NULL
      )
  `;

  const overlapParams = [
    deviceId,
    history_id,
    from_date, // F1
    finalToDate, // T1
    finalToDate, // T1 (erneut für T1 >= F2 Check)
  ];

  db.get(overlapSql, overlapParams, (err, row) => {
    if (err) {
      return res.status(500).json({
        message: "DB-Fehler bei der Überschneidungsprüfung.",
        error: err.message,
      });
    }

    if (row && row.overlap_count > 0) {
      // 409 Conflict: Es wurde eine Überschneidung gefunden
      return res.status(409).json({
        message:
          "Konflikt: Der angegebene Zeitraum überschneidet sich mit einem anderen Historieneintrag für dieses Gerät.",
      });
    }

    // --- 3. KEINE ÜBERSCHNEIDUNG: ALTEN EINTRAG FÜR LOGGING HOLEN ---
    // (Dieser Teil bleibt wie bisher)
    const getOldSql = "SELECT * FROM room_device_history WHERE history_id = ?";

    db.get(getOldSql, [history_id], (err, oldEntry) => {
      if (err)
        return res
          .status(500)
          .json({ message: "DB Fehler (Log-Check)", error: err.message });
      // (Fahre fort, auch wenn oldEntry nicht gefunden wird)

      // --- 4. DAS EIGENTLICHE UPDATE DURCHFÜHREN ---
      const sql = `
        UPDATE room_device_history
        SET room_id = ?, from_date = ?, to_date = ?, notes = ?
        WHERE history_id = ? AND device_id = ?
      `;
      db.run(
        sql,
        [room_id, from_date, finalToDate, finalNotes, history_id, deviceId],
        function (err) {
          if (err) return res.status(500).json({ message: err.message });
          if (this.changes === 0)
            return res.status(404).json({ message: "Eintrag nicht gefunden." });

          // --- Logging-Logik (unverändert, nutzt jetzt finalToDate) ---
          try {
            const details = {};
            if (oldEntry) {
              if (String(oldEntry.room_id) !== String(room_id))
                details.room_id = { old: oldEntry.room_id, new: room_id };
              if (String(oldEntry.from_date).slice(0, 10) !== String(from_date).slice(0, 10))
                details.from_date = { old: oldEntry.from_date, new: from_date };
              if (String(oldEntry.to_date ?? "").slice(0, 10) !== String(finalToDate ?? "").slice(0, 10))
                details.to_date = { old: oldEntry.to_date, new: finalToDate };
              if (String(oldEntry.notes ?? "") !== String(finalNotes ?? ""))
                details.notes = { old: "[Notiz]", new: "[Notiz]" };
            }

            if (Object.keys(details).length > 0) {
              details.action = "update-room-history";
              details.history_id = history_id;
              logActivity(
                req.user.username,
                "UPDATE",
                "device",
                deviceId,
                details,
              );
            }
          } catch (logErr) {
            console.error(
              "Fehler beim Schreiben des Activity Logs (update-room-history):",
              logErr,
            );
          }
          // --- ENDE LOGGING ---

          res.json({ message: "Historie aktualisiert." });
        },
      );
    });
  });
});
/**
 * DELETE /api/devices/:id/rooms-history/:history_id
 * Historien-Eintrag löschen.
 */
router.delete("/:id/rooms-history/:history_id", (req, res) => {
  const { id: deviceId, history_id } = req.params;
// --- NEU: ALTEN EINTRAG FÜR LOGGING HOLEN ---
  const getOldSql = "SELECT * FROM room_device_history WHERE history_id = ?";
  
  db.get(getOldSql, [history_id], (err, oldEntry) => {
    if (err) return res.status(500).json({ message: "DB Fehler (Log-Check)", error: err.message });
    // (Fahre fort, auch wenn oldEntry nicht gefunden wird)

  const sql =
    "DELETE FROM room_device_history WHERE history_id = ? AND device_id = ?";
  db.run(sql, [history_id, deviceId], function (err) {
    if (err) return res.status(500).json({ message: err.message });
    if (this.changes === 0)
      return res.status(404).json({ message: "Eintrag nicht gefunden." });
    try {
        logActivity(
          req.user.username,
          'DELETE', // Oder 'UPDATE', da es das Gerät beeinflusst
          'device',
          deviceId,
          { 
            action: "delete-room-history",
            history_id: history_id,
            deleted_entry: { room_id: oldEntry?.room_id, from: oldEntry?.from_date, to: oldEntry?.to_date }
          }
        );
      } catch (logErr) {
        console.error("Fehler beim Schreiben des Activity Logs (delete-room-history):", logErr);
      }
      // --- ENDE NEU ---

res.status(200).json({ message: "Eintrag erfolgreich gelöscht." }); 
   });
  });
});

/* ------------------------------
   SAMMELAKTIONEN (BULK)
-------------------------------*/

/**
 * POST /api/devices/bulk-update
 * Mehrere Geräte auf einmal aktualisieren.
 */
router.post("/bulk-update", (req, res) => {
  const { device_ids, set, mode } = req.body; // mode = 'append' or 'replace' for notes

  if (
    !device_ids ||
    !Array.isArray(device_ids) ||
    device_ids.length === 0 ||
    !set
  ) {
    return res.status(400).json({
      message: "device_ids (Array) und set (Objekt) sind erforderlich.",
    });
  }

  // Whitelist der erlaubten Felder für Bulk-Update
  const allowed = [
    "status",
    "hostname",
    "model_id",
    "purchase_date",
    "price_cents",
    "warranty_months",
    "added_at",
    "decommissioned_at",
    "last_cleaned",
    "last_inspected",
    "notes",
  ];

  const field = Object.keys(set)[0];
  let value = set[field];

  if (!allowed.includes(field)) {
    return res.status(400).json({
      message: `Feld "${field}" wird für Bulk-Update nicht unterstützt.`,
    });
  }

  // Platzhalter für IN (...)
  const placeholders = device_ids.map(() => "?").join(",");
  let sql;
  let params;

  // Spezialfall: Notizen (anhängen oder ersetzen)
  if (field === "notes") {
    if (mode === "append") {
      sql = `UPDATE devices SET notes = COALESCE(notes, '') || ? WHERE device_id IN (${placeholders})`;
      params = ["\n" + value, ...device_ids];
    } else {
      // 'replace'
      sql = `UPDATE devices SET notes = ? WHERE device_id IN (${placeholders})`;
      params = [value, ...device_ids];
    }
  }
  // Spezialfall: Status (muss 'decommissioned_at' synchronisieren)
  else if (field === "status") {
    if (value === "decommissioned") {
      // Setze Status UND setze Datum (falls es noch nicht gesetzt ist)
      sql = `UPDATE devices
             SET status = 'decommissioned',
                 decommissioned_at = COALESCE(decommissioned_at, date('now'))
             WHERE device_id IN (${placeholders})`;
      params = device_ids;
    } else {
      // Setze Status UND lösche 'decommissioned_at'
      sql = `UPDATE devices
             SET status = ?,
                 decommissioned_at = NULL
             WHERE device_id IN (${placeholders})`;
      params = [value, ...device_ids];
    }
  }
  // Alle anderen Felder
  else {
    // ${field} ist sicher, da es gegen die Whitelist geprüft wurde
    sql = `UPDATE devices SET ${field} = ? WHERE device_id IN (${placeholders})`;
    params = [value, ...device_ids];
  }

  db.run(sql, params, function (err) {
    if (err) return res.status(500).json({ message: err.message });
    // HIER LOGGEN:
    logActivity(
      req.user.username,
      'BULK_UPDATE',
      'device',
      null, // Betrifft mehrere IDs
      { 
        action: field, 
        value: (field === 'notes' ? '[Notizen]' : value), // Passwörter/sensible Daten nicht loggen
        count: this.changes 
      }
    );
    res.json({ message: `${this.changes} Geräte aktualisiert.` });
  });
});

/**
 * POST /api/devices/bulk-rooms-history
 * Raum-Historie für mehrere Geräte auf einmal hinzufügen.
 * (KORRIGIERT: Schließt automatisch vorherige offene Einträge)
 */
router.post("/bulk-rooms-history", (req, res) => {
  const { device_ids, room_id, from_date, to_date, notes } = req.body;

  if (!device_ids || !Array.isArray(device_ids) || !room_id || !from_date) {
    return res.status(400).json({
      message: "device_ids, room_id und from_date sind erforderlich.",
    });
  }

  // --- KORREKTUR START ---
  // 1. Berechne den Tag vor dem Startdatum
  const day_before_from = simpleDayBefore(from_date);
  if (!day_before_from) {
    return res.status(400).json({ message: "Ungültiges 'from_date'. Bitte YYYY-MM-DD verwenden." });
  }

  // 2. SQL-Statements vorbereiten
  const sqlClose = `
    UPDATE room_device_history
    SET to_date = ?
    WHERE device_id = ? AND to_date IS NULL
  `;
  const sqlInsert = `
    INSERT INTO room_device_history (device_id, room_id, from_date, to_date, notes)
    VALUES (?, ?, ?, ?, ?)
  `;

  // Transaktion für Massen-Aktion
  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    const stmtClose = db.prepare(sqlClose);
    const stmtInsert = db.prepare(sqlInsert);
    let error = null;

    // 3. Für jedes Gerät: alten Eintrag schließen UND neuen einfügen
    device_ids.forEach((id) => {
      if (error) return; // Schleife bei Fehler abbrechen

      // 3a. Alten Eintrag schließen
      stmtClose.run(day_before_from, id, (err) => {
        if (err) error = err;
      });

      // 3b. Neuen Eintrag einfügen
      stmtInsert.run(
        id,
        room_id,
        from_date,
        to_date || null,
        notes || null,
        (err) => {
          if (err) error = err;
        },
      );
    });

    // 4. Beide Statements finalisieren und Transaktion abschließen
    stmtClose.finalize();
    stmtInsert.finalize((err) => {
      if (err) error = err;

      if (error) {
        db.run("ROLLBACK");
        return res
          .status(500)
          .json({ message: `Fehler bei Transaktion: ${error.message}` });
      } else {
        db.run("COMMIT");
        // --- NEU: LOGGING ---
        try {
          logActivity(
            req.user.username,
            'BULK_UPDATE',
            'device',
            null, // Betrifft mehrere IDs
            { 
              action: "bulk-room-history",
              room_id: room_id,
              from_date: from_date,
              count: device_ids.length 
            }
          );
        } catch (logErr) {
          console.error("Fehler beim Schreiben des Activity Logs (bulk-rooms-history):", logErr);
        }
        // --- ENDE NEU ---

        return res.json({
          message: `${device_ids.length} Historieneinträge hinzugefügt (und vorherige Einträge automatisch geschlossen).`,
        });
      }
    });
  });
});

// Alle Geräte eines Raums auf "heute inspiziert" setzen
router.post("/bulk/mark-inspected", (req, res) => {
  const { room_id, date } = req.body || {};
  const today =
    (date && String(date).slice(0, 10)) ||
    new Date().toISOString().slice(0, 10);

  if (!room_id) {
    return res.status(400).json({ error: "room_id fehlt" });
  }

  // Update: Alle Geräte, deren aktueller Raum = room_id ist.
  // Annahme: "aktuell" = Zeitraum deckt heute (from_date <= today <= to_date oder to_date IS NULL).
  const sql = `
    UPDATE devices
       SET last_inspected = ?
     WHERE device_id IN (
       SELECT d.device_id
         FROM devices d
         JOIN room_device_history h ON h.device_id = d.device_id
        WHERE h.room_id = ?
          AND DATE(h.from_date) <= DATE(?)
          AND (h.to_date IS NULL OR DATE(h.to_date) >= DATE(?))
     )
  `;
  const params = [today, room_id, today, today];

  db.run(sql, params, function (err) {
    if (err) {
      console.error("Bulk mark-inspected error:", err);
      return res.status(500).json({ error: "DB-Fehler beim Bulk-Update" });
    }
    // this.changes enthält die Anzahl betroffener Zeilen
    try {
      if (this.changes > 0) {
        logActivity(
          req.user.username,
          'BULK_UPDATE',
          'device',
          null,
          { 
            action: "bulk-mark-inspected",
            room_id: room_id,
            date: today,
            count: this.changes 
          }
        );
      }
    } catch (logErr) {
      console.error("Fehler beim Schreiben des Activity Logs (bulk-mark-inspected):", logErr);
    }
    return res.json({ ok: true, updated: this.changes, date: today });
  });
});





module.exports = router;
