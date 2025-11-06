const express = require("express");
const { db } = require("../database");
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

  // === NEU: Globale Suche (q) ===
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
          r.room_number LIKE ?
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
      searchTerm  // room_number (NEU)
    );
  }
  // === ENDE NEU ===
  //
  // --- Sortierung (bleibt unverändert) ---
  const sortDir = dir === "desc" ? "DESC" : "ASC";
  const sortWhitelist = {
    category_name: "c.category_name",
    model_name: "m.model_name", // KORRIGIERT (war 'model_number')
    hostname: "d.hostname",
    serial_number: "d.serial_number",
    inventory_number: "d.inventory_number",
    mac_address: "d.mac_address",
    ip_address: "d.ip_address",
    room_number: "r.room_number", // HINZUGEFÜGT
    room_name: "r.room_name",
    status: "d.status",
    last_inspected: "d.last_inspected",
  };
  const orderBy = sortWhitelist[sort] || "c.category_name";

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
  // (außer 'status', das wird von syncDeviceStatus gesteuert)

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
    res.json({ message: "Gerät aktualisiert." });
  });
});

/**
 * DELETE /api/devices/:id
 * Ein Gerät löschen.
 */
router.delete("/:id", (req, res) => {
  const deviceId = req.params.id;
  db.run("DELETE FROM devices WHERE device_id = ?", [deviceId], function (err) {
    if (err) return res.status(500).json({ message: err.message });
    if (this.changes === 0) {
      return res.status(404).json({ message: "Gerät nicht gefunden." });
    }
    res.status(204).send(); // 204 No Content
  });
});

/**
 * PUT /api/devices/:id/mark-inspected
 * Setzt 'last_inspected' für ein Gerät auf ein bestimmtes Datum (oder heute).
 */
router.put("/:id/mark-inspected", (req, res) => {
  const { id } = req.params;
  const { date } = req.body; // Erlaube optionales Datum, falls in der Vergangenheit nachgetragen

  // Wenn kein Datum gesendet wird, nimm das heutige
  const inspectionDate =
    (date && String(date).slice(0, 10)) ||
    new Date().toISOString().slice(0, 10);

  const sql = "UPDATE devices SET last_inspected = ? WHERE device_id = ?";

  db.run(sql, [inspectionDate, id], function (err) {
    if (err) {
      return res.status(500).json({ message: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ message: "Gerät nicht gefunden." });
    }
    res.json({
      message: "Gerät als kontrolliert markiert.",
      date: inspectionDate,
    });
  });
});

// ... (vor der Sektion RAUM-HISTORIE)

/**
 * NEU: POST /api/devices/:id/move-to-room
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
        return res.json({ message: "Gerät erfolgreich verschoben." });
      }
    });
  });
});


/**
 * NEU: PUT /api/devices/:id/correct-current-room
 * Korrigiert den 'room_id' des *letzten* Historieneintrags.
 */
router.put("/:id/correct-current-room", (req, res) => {
  const deviceId = req.params.id;
  const { new_room_id } = req.body;

  if (!new_room_id) {
    return res.status(400).json({ message: "new_room_id ist erforderlich." });
  }

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
    res.json({ message: "Raum-Historie erfolgreich korrigiert." });
  });
});

/**
 * NEU: PUT /api/devices/:id/end-current-room
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
    ORDER BY h.from_date DESC
  `;
  db.all(sql, [deviceId], (err, rows) => {
    if (err) return res.status(500).json({ message: err.message });
    res.json(rows);
  });
});

/**
 * POST /api/devices/:id/rooms-history
 * Neuen Historien-Eintrag hinzufügen.
 */
router.post("/:id/rooms-history", (req, res) => {
  const deviceId = req.params.id;
  const { room_id, from_date, to_date, notes } = req.body;
  if (!room_id || !from_date) {
    return res
      .status(400)
      .json({ message: "Raum und Von-Datum sind erforderlich." });
  }
  const sql = `
    INSERT INTO room_device_history (device_id, room_id, from_date, to_date, notes)
    VALUES (?, ?, ?, ?, ?)
  `;
  db.run(
    sql,
    [deviceId, room_id, from_date, to_date || null, notes || null],
    function (err) {
      if (err) return res.status(500).json({ message: err.message });
      res.status(201).json({ history_id: this.lastID });
    },
  );
});

/**
 * PUT /api/devices/:id/rooms-history/:history_id
 * Historien-Eintrag aktualisieren.
 */
router.put("/:id/rooms-history/:history_id", (req, res) => {
  const { id: deviceId, history_id } = req.params;
  // Wichtig: 'room_id' wird im Frontend mitgesendet!
  const { room_id, from_date, to_date, notes } = req.body;

  const sql = `
    UPDATE room_device_history
    SET room_id = ?, from_date = ?, to_date = ?, notes = ?
    WHERE history_id = ? AND device_id = ?
  `;
  db.run(
    sql,
    [room_id, from_date, to_date || null, notes || null, history_id, deviceId],
    function (err) {
      if (err) return res.status(500).json({ message: err.message });
      if (this.changes === 0)
        return res.status(404).json({ message: "Eintrag nicht gefunden." });
      res.json({ message: "Historie aktualisiert." });
    },
  );
});

/**
 * DELETE /api/devices/:id/rooms-history/:history_id
 * Historien-Eintrag löschen.
 */
router.delete("/:id/rooms-history/:history_id", (req, res) => {
  const { id: deviceId, history_id } = req.params;
  const sql =
    "DELETE FROM room_device_history WHERE history_id = ? AND device_id = ?";
  db.run(sql, [history_id, deviceId], function (err) {
    if (err) return res.status(500).json({ message: err.message });
    if (this.changes === 0)
      return res.status(404).json({ message: "Eintrag nicht gefunden." });
    res.status(204).send();
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
        return res.json({
          message: `${device_ids.length} Historieneinträge hinzugefügt (und vorherige Einträge automatisch geschlossen).`,
        });
      }
    });
  });
  // --- KORREKTUR ENDE ---
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
    return res.json({ ok: true, updated: this.changes, date: today });
  });
});

module.exports = router;
