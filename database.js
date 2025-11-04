const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const DB_PATH = './db.sqlite';

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error("Fehler beim Öffnen der Datenbank:", err.message);
    } else {
        console.log("Erfolgreich mit der SQLite-Datenbank verbunden.");
    }
});

const initializeDb = () => {
    db.serialize(() => {
        // --- Kerntabellen ---
        db.run(`CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'admin',
            notes TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS device_categories (
            category_id INTEGER PRIMARY KEY AUTOINCREMENT,
            category_name TEXT UNIQUE NOT NULL,
            description TEXT,
            notes TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS accessory_categories (
            accessory_category_id INTEGER PRIMARY KEY AUTOINCREMENT,
            accessory_category_name TEXT UNIQUE NOT NULL,
            description TEXT,
            notes TEXT
        )`);
        
        db.run(`CREATE TABLE IF NOT EXISTS models (
            model_id INTEGER PRIMARY KEY AUTOINCREMENT,
            category_id INTEGER,
            manufacturer TEXT,
            type TEXT,
            model_name TEXT,
            model_number TEXT NOT NULL,
            allowed_accessory_category_ids TEXT,
            has_network INTEGER DEFAULT 0,
            purchase_date TEXT,          
            price_cents INTEGER,         
            warranty_months INTEGER,     
            maintenance_interval_months INTEGER,
            notes TEXT,
            FOREIGN KEY (category_id) REFERENCES device_categories(category_id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS accessories (
            accessory_id INTEGER PRIMARY KEY AUTOINCREMENT,
            accessory_category_id INTEGER,
            type TEXT,
            model_id INTEGER,
            notes TEXT,
            FOREIGN KEY (accessory_category_id) REFERENCES accessory_categories(accessory_category_id)
        )`);

        // ----- KORRIGIERTER BLOCK START -----
        // 'active' (INTEGER) wurde durch 'status' (TEXT) ersetzt.
        db.run(`CREATE TABLE IF NOT EXISTS devices (
            device_id INTEGER PRIMARY KEY AUTOINCREMENT,
            model_id INTEGER,
            hostname TEXT UNIQUE,
            serial_number TEXT UNIQUE,
            inventory_number TEXT UNIQUE,
            mac_address TEXT UNIQUE,
            ip_address TEXT,
            added_at TEXT,
            decommissioned_at TEXT,
            purchase_date TEXT,
            price_cents INTEGER,
            warranty_months INTEGER,
            status TEXT DEFAULT 'active' NOT NULL CHECK(status IN ('active', 'storage', 'defective', 'decommissioned')),
            last_cleaned TEXT,
            last_inspected TEXT,
            notes TEXT,
            FOREIGN KEY (model_id) REFERENCES models(model_id)
        )`);
        // ----- KORRIGIERTER BLOCK ENDE -----


        db.run(`CREATE TABLE IF NOT EXISTS device_accessories (
            link_id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id INTEGER,
            accessory_id INTEGER,
            notes TEXT,
            FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE,
            FOREIGN KEY (accessory_id) REFERENCES accessories(accessory_id) ON DELETE CASCADE,
            UNIQUE(device_id, accessory_id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS rooms (
            room_id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_number TEXT UNIQUE NOT NULL,
            room_name TEXT NOT NULL,
            floor INTEGER,
            sort_order INTEGER,
            notes TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS room_device_history (
            history_id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id INTEGER,
            room_id INTEGER,
            from_date TEXT NOT NULL,
            to_date TEXT,
            notes TEXT,
            FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE,
            FOREIGN KEY (room_id) REFERENCES rooms(room_id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS device_maintenance (
            maintenance_id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id INTEGER NOT NULL,
            event_date TEXT NOT NULL,
            event_type TEXT NOT NULL CHECK(event_type IN ('repair', 'upgrade', 'config', 'cleaning', 'inspection', 'other')),
            title TEXT NOT NULL,
            description TEXT,
            performed_by TEXT,
            duration_minutes INTEGER,
            cost_cents INTEGER,
            parts_json TEXT,
            next_due_date TEXT,
            status TEXT DEFAULT 'done' CHECK(status IN ('planned', 'in_progress', 'done', 'canceled')),
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
        )`);
        
        db.run(`CREATE TABLE IF NOT EXISTS maintenance_files (
            file_id INTEGER PRIMARY KEY AUTOINCREMENT,
            maintenance_id INTEGER,
            file_name TEXT NOT NULL,
            mime_type TEXT,
            file_path TEXT NOT NULL,
            notes TEXT,
            uploaded_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (maintenance_id) REFERENCES device_maintenance(maintenance_id) ON DELETE CASCADE
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS tasks (
            task_id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            category TEXT NOT NULL CHECK(category IN ('Hardware', 'Software', 'Allgemein', 'Bestellung', 'Inventar', 'Laptops', 'Problem', 'Test', 'Switch', 'WLAN')),
            task TEXT NOT NULL,
            reported_by TEXT,
            entered_by TEXT,
            room_id INTEGER,
            priority TEXT DEFAULT 'normal' CHECK(priority IN ('low', 'normal', 'high', 'urgent')),
            status TEXT DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'done', 'canceled')),
            assigned_to TEXT,
            completed_at TEXT,
            completed_by TEXT,
            notes TEXT,
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE SET NULL
        )`);

        db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_status_priority ON tasks (status, priority)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_room_id ON tasks (room_id)`);

        const adminPassword = 'adminpass';
        db.get('SELECT * FROM users WHERE username = ?', ['admin'], (err, row) => {
            if (!row) {
                bcrypt.hash(adminPassword, 10, (err, hash) => {
                    if (err) return console.error("Fehler beim Hashen:", err);
                    db.run('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', ['admin', hash, 'admin']);
                    console.log('Admin-Benutzer "admin" mit Passwort "adminpass" erstellt.');
                });
            }
        });
    });
};

module.exports = { db, initializeDb };