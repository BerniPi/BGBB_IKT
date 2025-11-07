// routes/import_devices.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');

const { db, logActivity } = require('../database');

// Upload-Config (im RAM)
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const ok = /\.(xlsx|xlsm|xls)$/i.test(file.originalname);
    cb(ok ? null : new Error('Nur Excel-Dateien erlaubt'), ok);
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB Limit
});

// Konstanten für Standard-Datum
const START_DATE_DEFAULT = '2025-09-01'; // Fallback

// --- Hilfsfunktionen (VOLLSTÄNDIG) ---
function fmt(dateObj) {
  if (!dateObj || !(dateObj instanceof Date)) return null;
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseISO(s) {
  if (!s || typeof s !== 'string') return null;
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
      return null;
  }
  return dt;
}

function dayBefore(iso) {
  const d = parseISO(iso);
  if (!d) return null;
  d.setUTCDate(d.getUTCDate() - 1);
  return fmt(d);
}

function norm(s) {
  return String(s ?? '').trim();
}

function toNullIfEmpty(s) {
  const t = norm(s);
  return t === '' ? null : t;
}

function normalizeMac(mac) {
    const t = norm(mac).toUpperCase().replace(/[^A-F0-9]/g, '');
    if (t.length !== 12) return null;
    return t.match(/.{1,2}/g)?.join(':') || null;
}

function floorToInt(val) {
  if (val === null || val === undefined || val === '') return null;
  const s = String(val).trim().toUpperCase();
  if (s === 'EG') return 0;
  if (s === 'OG' || s === '1.OG' || s === '1. OG') return 1;
  if (s === '2.OG' || s === '2. OG') return 2;
  if (s === '3.OG' || s === '3. OG') return 3;
  if (s === 'UG' || s === '1.UG' || s === '1. UG') return -1;
  if (s === 'KG') return -1;
  if (s === '2.UG' || s === '2. UG') return -2;
  const n = parseInt(s, 10);
  if (Number.isFinite(n)) return n;
  return null;
}

function parseDateExcel(val) {
    if (val === null || val === undefined || val === '') return null;
    if (typeof val === 'number') {
        if (val > 0) {
            const excelEpochDiff = val > 60 ? -2 : -1;
            const excelBaseDate = new Date(Date.UTC(1900, 0, val + excelEpochDiff));
            if (!isNaN(excelBaseDate)) return excelBaseDate.toISOString().slice(0, 10);
        }
    }
    if (typeof val === 'string') {
        const s = norm(val);
        let d = null;
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) d = parseISO(s.slice(0, 10));
        else if (/^(\d{1,2})\.(\d{1,2})\.(\d{4})/.test(s)) {
            const [, day, month, year] = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
            d = parseISO(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
        }
        else if (/^(\d{1,2})\/(\d{1,2})\/(\d{4})/.test(s)) {
            const [, month, day, year] = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
             d = parseISO(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
        }
        if (d && !isNaN(d)) return d.toISOString().slice(0, 10);
    }
    if (val instanceof Date && !isNaN(val)) return val.toISOString().slice(0, 10);
    return null;
}

function eurosToCentsLoose(val) {
    if (val === null || val === undefined) return null;
    const s = String(val).trim().replace(/[^0-9.,-]+/g, '');
    const normalized = s.replace(/\./g, '').replace(',', '.');
    const n = parseFloat(normalized);
    if (isNaN(n)) return null;
    return Math.round(n * 100);
}

// --- DB-Helfer als Promise (VOLLSTÄNDIG) ---
function dbGet(sql, params = []) { /* ... (wie zuvor) ... */
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}
function dbAll(sql, params = []) { /* ... (wie zuvor) ... */
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}
function dbRun(sql, params = []) { /* ... (wie zuvor) ... */
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { // 'function' wegen 'this'
      if (err) reject(err);
      // 'this' enthält lastID und changes
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}


// --- Stammdaten-Helfer ---
async function ensureCategory(category_name) { /* ... (wie zuvor) ... */
  if (!category_name) return null;
  const row = await dbGet(`SELECT category_id FROM device_categories WHERE category_name = ?`, [category_name]);
  if (row) return row.category_id;
  const ins = await dbRun(`INSERT INTO device_categories (category_name) VALUES (?)`, [category_name]);
  return ins.lastID;
}
async function ensureModel({ category_id, type, model_number, has_network }) { /* ... (wie zuvor) ... */
  if (!model_number) return null; // Modellnummer ist zwingend
  const row = await dbGet(
    `SELECT model_id FROM models WHERE model_number = ?`,
    [model_number]
  );
  if (row) {
    // Optional: Update category if it was missing before
     const existingModel = await dbGet(`SELECT category_id, type FROM models WHERE model_id = ?`, [row.model_id]);
     if (existingModel && category_id && !existingModel.category_id) {
       await dbRun(`UPDATE models SET category_id = ? WHERE model_id = ?`, [category_id, row.model_id]);
     }
      if (existingModel && type && !existingModel.type) { // Typ aktualisieren, falls leer
        await dbRun(`UPDATE models SET type = ? WHERE model_id = ?`, [type, row.model_id]);
     }
    return row.model_id;
  }

  const ins = await dbRun(
    `INSERT INTO models (category_id, type, model_number, has_network) VALUES (?, ?, ?, ?)`,
    [category_id || null, type || null, model_number, has_network ? 1 : 0]
  );
  return ins.lastID;
}
async function ensureRoom({ roomNumber, roomName, floorStr }) { /* ... (wie zuvor) ... */
  if (!roomNumber) return null; // Raum Nummer ist zwingend
  const floor = floorToInt(floorStr);
  const name = toNullIfEmpty(roomName) || roomNumber;
  let roomRow = await dbGet(`SELECT room_id, room_name, floor FROM rooms WHERE room_number = ?`, [roomNumber]);
  if (roomRow) {
    const updates = [];
    const params = [];
    if (name && !roomRow.room_name) { updates.push("room_name = ?"); params.push(name); }
    if (floor !== null && roomRow.floor === null) { updates.push("floor = ?"); params.push(floor); }
    if (updates.length > 0) {
      params.push(roomRow.room_id);
      await dbRun(`UPDATE rooms SET ${updates.join(', ')} WHERE room_id = ?`, params);
    }
    return roomRow.room_id;
  } else {
    const maxSortRow = await dbGet(`SELECT MAX(sort_order) as max_sort FROM rooms`);
    const newSortOrder = (maxSortRow?.max_sort || 0) + 1;
    const ins = await dbRun(
      `INSERT INTO rooms (room_number, room_name, floor, sort_order, notes) VALUES (?, ?, ?, ?, NULL)`,
      [roomNumber, name, floor, newSortOrder]
    );
    return ins.lastID;
  }
}
async function findExistingDevice({ serial_number, inventory_number, mac_address, hostname }) { /* ... (wie zuvor) ... */
  let row = null;
  if (serial_number) row = await dbGet(`SELECT * FROM devices WHERE serial_number = ?`, [serial_number]);
  if (row) return row;
  if (inventory_number) row = await dbGet(`SELECT * FROM devices WHERE inventory_number = ?`, [inventory_number]);
  if (row) return row;
  if (mac_address) row = await dbGet(`SELECT * FROM devices WHERE mac_address = ?`, [mac_address]);
  if (row) return row;
  if (hostname) row = await dbGet(`SELECT * FROM devices WHERE hostname = ?`, [hostname]);
  if (row) return row;
  return row;
}

// --- Raum-Historie Helfer (VOLLSTÄNDIG) ---
async function upsertRoomHistory(device_id, room_id, startDateISO, note = 'import') {
  if (!device_id || !room_id || !startDateISO) return 0;
  const dayBeforeStart = dayBefore(startDateISO);
  const identicalExists = await dbGet(
    `SELECT history_id FROM room_device_history WHERE device_id = ? AND room_id = ? AND from_date = ?`,
    [device_id, room_id, startDateISO]
  );
  if (identicalExists) return 0;
  await dbRun( `DELETE FROM room_device_history WHERE device_id = ? AND from_date >= ?`, [device_id, startDateISO] );
  const prevEntry = await dbGet( `SELECT history_id FROM room_device_history WHERE device_id = ? AND from_date < ? ORDER BY from_date DESC LIMIT 1`, [device_id, startDateISO] );
  if (prevEntry) {
    await dbRun( `UPDATE room_device_history SET to_date = ? WHERE history_id = ?`, [dayBeforeStart, prevEntry.history_id] );
  }
  await dbRun( `INSERT INTO room_device_history (device_id, room_id, from_date, to_date, notes) VALUES (?, ?, ?, NULL, ?)`, [device_id, room_id, startDateISO, note] );
  return 1;
}

// --- Routen ---

// GET: Import-Seite
router.get('/import', (req, res) => {
  res.render('import_devices', { page: 'devices-import' });
});

// POST: Datei hochladen und verarbeiten
router.post('/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).send('Keine Datei hochgeladen.');

  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });

    // Spaltenzuordnung
    const h = (name) => Object.keys(rows[0] || {}).find(k => norm(k).toLowerCase() === norm(name).toLowerCase());
    const COL = { /* ... (wie zuvor) ... */
      roomNumber: h('Raum Nummer'), roomName: h('Raum Name'), floor: h('Etage'), category: h('Gerätekategorie'),
      hersteller: h('Hersteller'), type: h('Type'), hostname: h('Netzwerkname/Kurzname'), modelNumber: h('Modell Nummer'),
      serial: h('Seriennummer'), inventory: h('Inventarnummer') || h('Inventaar NR. ?'), beamerLampType: h('Beamer-LAMP-TYPE'),
      mac: h('Mac Adresse'), bleMac: h('BLE Mac Adresse'), ram: h('Ram(MB)'), drive: h('Drive (GB)'),
      beamerFilterCleaned: h('"Beamer Filter gereinigt Am:"'), cleanedFlag: h('Gereinigt'), cleanedAt: h('Gereinigt AM'),
      macCountOk: h('Check MAC Lenght-Count OK ?'), notes: h('Bemerkung'),
    };

    if (!COL.category || !COL.serial && !COL.inventory && !COL.mac && !COL.hostname && !COL.modelNumber && !COL.type) { // Modell/Typ zur Prüfung hinzugefügt
        throw new Error('Wichtige Spalten (z.B. Gerätekategorie UND mind. eine ID wie Seriennr., Inventarnr., MAC, Hostname ODER Modell/Typ) nicht im Header gefunden.');
    }

    let created = 0, updated = 0, historyCreated = 0, modelsCreated = 0, categoriesCreated = 0, roomsCreated = 0;
    const problems = [];
    const createdRoomIds = new Set();

    await dbRun("BEGIN TRANSACTION");

    try {
      for (const [i, r] of rows.entries()) {
        const rowNum = i + 2;
        const isEmpty = Object.values(r).every(v => norm(v) === '');
        if (isEmpty) continue;

        // --- Daten extrahieren ---
        const roomNumber = toNullIfEmpty(r[COL.roomNumber]);
        const roomName   = toNullIfEmpty(r[COL.roomName]);
        const floorStr   = toNullIfEmpty(r[COL.floor]);
        const categoryName = toNullIfEmpty(r[COL.category]);
        const hersteller = toNullIfEmpty(r[COL.hersteller]);
        const type       = toNullIfEmpty(r[COL.type]);
        const hostname   = toNullIfEmpty(r[COL.hostname]);
        const modelNumber = toNullIfEmpty(r[COL.modelNumber]);
        const serial_number = toNullIfEmpty(r[COL.serial]);
        const inventory_number = toNullIfEmpty(r[COL.inventory]);
        const mac_address = normalizeMac(r[COL.mac]);
        const ble_mac = normalizeMac(r[COL.bleMac]);
        const cleaned1 = parseDateExcel(r[COL.beamerFilterCleaned]);
        const cleaned2 = parseDateExcel(r[COL.cleanedAt]);
        const last_cleaned = cleaned1 || cleaned2 || null;
        const chosenStartDate = cleaned2 || START_DATE_DEFAULT;
        const notesParts = [];
        if (hersteller) notesParts.push(`Hersteller: ${hersteller}`);
        if (r[COL.beamerLampType]) notesParts.push(`Beamer-LAMP-TYPE: ${norm(r[COL.beamerLampType])}`);
        if (r[COL.ram]) notesParts.push(`RAM: ${norm(r[COL.ram])} MB`);
        if (r[COL.drive]) notesParts.push(`Drive: ${norm(r[COL.drive])} GB`);
        if (ble_mac) notesParts.push(`BLE-MAC: ${ble_mac}`);
        if (r[COL.cleanedFlag]) notesParts.push(`Gereinigt: ${norm(r[COL.cleanedFlag])}`);
        if (r[COL.macCountOk]) notesParts.push(`MAC OK?: ${norm(r[COL.macCountOk])}`);
        if (r[COL.notes]) notesParts.push(norm(r[COL.notes]));
        const notes = notesParts.join(' | ') || null;

        // --- Stammdaten ---
        let room_id = null;
        if (roomNumber) {
          const originalRoomCount = createdRoomIds.size; // Größe VOR dem Aufruf
          room_id = await ensureRoom({ roomNumber, roomName, floorStr });
          // Prüfen, ob die ID neu ist und der Set gewachsen ist
          if (room_id && !createdRoomIds.has(room_id) && createdRoomIds.add(room_id) && createdRoomIds.size > originalRoomCount) {
             roomsCreated++; // Nur zählen, wenn wirklich neu hinzugefügt
          }
        }

        let category_id = await ensureCategory(categoryName); // ensureCategory kümmert sich um Zählung nicht direkt
        if (category_id && !await dbGet('SELECT 1 FROM device_categories WHERE category_id = ?', [category_id])) {
            categoriesCreated++; // Zähle nur, wenn die ID wirklich neu war (vereinfacht)
        }


        let model_id = null;
        const finalModelNumber = modelNumber || type;
        const has_network = mac_address ? 1 : 0;
        if (finalModelNumber) {
             const modelData = { category_id, type: (modelNumber ? type : null), model_number: finalModelNumber, has_network };
             const originalModelCount = await dbGet('SELECT COUNT(*) as count FROM models'); // Zähle vorher
             model_id = await ensureModel(modelData);
             const newModelCount = await dbGet('SELECT COUNT(*) as count FROM models'); // Zähle nachher
             if (newModelCount.count > originalModelCount.count) {
                 modelsCreated++; // Zähle, wenn sich Anzahl erhöht hat
             }
        }

        // --- Gerät finden oder anlegen ---
        const existing = await findExistingDevice({ serial_number, inventory_number, mac_address, hostname });

        // === KORREKTUR START ===
        if (!existing) {
          // NEU anlegen
          // Prüfe, ob genug Daten da sind
          if (!finalModelNumber && !serial_number && !inventory_number && !hostname) { // finalModelNumber statt model_id prüfen
             problems.push(`Zeile ${rowNum}: Übersprungen - Weder Modell/Typ noch eindeutige ID (Seriennr., Inventarnr., Hostname) zum Anlegen vorhanden.`);
             continue;
          }

          const insDev = await dbRun(
            `INSERT INTO devices (
               model_id, hostname, serial_number, inventory_number, mac_address,
               added_at, purchase_date, last_cleaned,
               notes, status
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
            [ model_id, hostname, serial_number, inventory_number, mac_address,
              chosenStartDate, chosenStartDate, last_cleaned, notes ]
          );
          created++;
          const newId = insDev.lastID;
          // *** HIER: Raum-Historie für NEUES Gerät anlegen ***
          if (room_id) {
            await upsertRoomHistory(newId, room_id, chosenStartDate, 'import');
          }

        } else {
          // UPDATE (sanft)
          const patch = { /* ... (wie zuvor) ... */
            model_id: existing.model_id || model_id || null,
            hostname: (hostname && (!existing.hostname || existing.hostname === hostname)) ? hostname : existing.hostname,
            serial_number: existing.serial_number || serial_number || null,
            inventory_number: existing.inventory_number || inventory_number || null,
            mac_address: existing.mac_address || mac_address || null,
            added_at: existing.added_at || chosenStartDate,
            purchase_date: existing.purchase_date || chosenStartDate,
            last_cleaned: existing.last_cleaned || last_cleaned || null,
            notes: existing.notes ? (notes ? `${existing.notes}\n---\nIMPORT ${new Date().toISOString().slice(0,10)}:\n${notes}` : existing.notes) : (notes || null),
          };

          await dbRun(
            `UPDATE devices
             SET model_id = ?, hostname = ?, serial_number = ?, inventory_number = ?, mac_address = ?,
                 added_at = ?, purchase_date = ?, last_cleaned = ?, notes = ?
             WHERE device_id = ?`,
            [ patch.model_id, patch.hostname, patch.serial_number, patch.inventory_number, patch.mac_address,
              patch.added_at, patch.purchase_date, patch.last_cleaned, patch.notes, existing.device_id ]
          );
          updated++;

          // *** HIER: Raum-Historie für BESTEHENDES Gerät aktualisieren/anlegen ***
          if (room_id) {
            await upsertRoomHistory(existing.device_id, room_id, chosenStartDate, 'import-update');
          }
        }
        // === KORREKTUR ENDE ===

      } // Ende for loop

      await dbRun("COMMIT");

      // Korrekte Zählung der Historie
      const historyCountResult = await dbGet(`SELECT COUNT(*) as count FROM room_device_history WHERE notes LIKE '%import%'`);
      historyCreated = historyCountResult?.count || 0;

      res.render('import_devices_result', {
        page: 'devices-import',
        created, updated, historyCreated, modelsCreated, categoriesCreated, roomsCreated, problems
      });

    } catch (loopError) {
      await dbRun("ROLLBACK");
      throw loopError;
    }

  } catch (err) {
    console.error("Import-Fehler:", err);
    res.status(500).send(err.message || 'Unbekannter Importfehler');
  }
});

module.exports = router;