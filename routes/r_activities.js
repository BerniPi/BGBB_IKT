// routes/r_activities.js
const express = require("express");
const { db } = require("../database");
const router = express.Router();

/**
 * GET /api/activity/log
 * Ruft die letzten N Aktivitätseinträge UND eine Liste aller Räume ab.
 */
router.get("/log", (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 100; // Standard: 100 Einträge

  const sqlLogs = `
    SELECT
      log.*,
      
      -- Geräte-Infos
      d.serial_number,
      m.model_name,
      
      -- Aktueller Raum des GERÄTS (umbenannt)
      r.room_name AS device_room_name,
      r.room_number AS device_room_number,
      
      -- NEU: Task-Infos
      t.task AS task_name,
      
      -- NEU: Raum des TASKS (mit Alias 'tr')
      tr.room_name AS task_room_name,
      tr.room_number AS task_room_number
      
    FROM activity_log log
    
    -- Verknüpfe Gerät, falls es ein 'device'-Log ist
    LEFT JOIN devices d ON log.entity_type = 'device' AND log.entity_id = d.device_id
    LEFT JOIN models m ON d.model_id = m.model_id
    LEFT JOIN room_device_history h ON d.device_id = h.device_id AND h.to_date IS NULL
    LEFT JOIN rooms r ON h.room_id = r.room_id
    
    -- NEU: Verknüpfe Task, falls es ein 'task'-Log ist
    LEFT JOIN tasks t ON log.entity_type = 'task' AND log.entity_id = t.task_id
    -- NEU: Verknüpfe den Raum des Tasks
    LEFT JOIN rooms tr ON t.room_id = tr.room_id
    
    ORDER BY log.timestamp DESC
    LIMIT ?
  `;
  
  const sqlRooms = `SELECT room_id, room_name, room_number FROM rooms`;

  // 1. Logs abrufen
  db.all(sqlLogs, [limit], (err, logs) => {
    if (err) {
      return res.status(500).json({ message: "Log konnte nicht geladen werden.", error: err.message });
    }
    
    // 2. Räume abrufen
    db.all(sqlRooms, [], (roomErr, rooms) => {
      if (roomErr) {
        // Bei Fehler hier: Logs trotzdem senden, aber mit leeren Räumen
        console.error("Fehler beim Laden der Räume für das Log:", roomErr);
        return res.json({ logs: logs, rooms: [] });
      }
      
      // 3. Beides kombiniert senden
      res.json({ 
        logs: logs, 
        rooms: rooms 
      });
    });
  });
});

module.exports = router;