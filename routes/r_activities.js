// z.B. in routes/r_system.js oder einer neuen r_activity.js
const express = require("express");
const { db } = require("../database");
const router = express.Router();

/**
 * GET /api/activity-log
 * Ruft die letzten N Aktivitätseinträge ab.
 */
router.get("/log", (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 100; // Standard: 100 Einträge

  const sql = `
    SELECT
      log.*,
      d.serial_number,
      m.model_name,
      r.room_name,
      r.room_number
    FROM activity_log log
    
    -- Verknüpfe Gerät, falls es ein 'device'-Log ist
    LEFT JOIN devices d ON log.entity_type = 'device' AND log.entity_id = d.device_id
    
    -- Verknüpfe Modell (basierend auf Gerät)
    LEFT JOIN models m ON d.model_id = m.model_id
    
    -- Verknüpfe den AKTUELLEN Raum (basierend auf Gerät)
    LEFT JOIN room_device_history h ON d.device_id = h.device_id AND h.to_date IS NULL
    LEFT JOIN rooms r ON h.room_id = r.room_id
    
    ORDER BY log.timestamp DESC
    LIMIT ?
  `;

  db.all(sql, [limit], (err, rows) => {
    if (err) {
      return res.status(500).json({ message: "Log konnte nicht geladen werden.", error: err.message });
    }
    res.json(rows);
  });
});

module.exports = router;