const express = require('express');
const path = require('path');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { initializeDb, db } = require('./database');

const https = require('https'); // Require the https module
const fs = require('fs');       // Require the fs module

const app = express();
const PORT = process.env.PORT || 4001;
const HTTPS_PORT = process.env.HTTPS_PORT || 4002; // Define HTTPS por
const JWT_SECRET = process.env.JWT_SECRET || 'change_me_in_production';


// +++ Define paths to your key and cert files +++
// Adjust paths if you place files elsewhere (e.g., './ssl/key.pem')
const options = {
  key: fs.readFileSync('key.pem'),
  cert: fs.readFileSync('cert.pem')
};
// ++++++++++++++++++++++++++++++++++++++++++++++

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// EJS als Template-Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Datenbank
initializeDb();

// Auth Middleware
const authMiddleware = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'Access denied. No token provided.' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (ex) {
    return res.status(400).json({ message: 'Invalid token.' });
  }
};

// NEU: Admin-Auth Middleware
const adminAuthMiddleware = (req, res, next) => {
  // Führt zuerst die normale Authentifizierung aus
  authMiddleware(req, res, () => {
    // Prüft dann die Rolle aus dem Token
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin role required.' });
    }
    next();
  });
};

const pageAuthMiddleware = (req, res, next) => {
    // Diese Middleware ist für EJS-Seiten gedacht und leitet bei Fehler auf /login um
    const token = req.headers['authorization']?.split(' ')[1]; // Simuliert Abruf, real in einer echten App aus Cookie/Header
    if (!token) return res.redirect('/login');
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (ex) {
        return res.redirect('/login');
    }
};

// --- ROUTEN ---

// Login Seite & API
app.get('/login', (req, res) => res.render('login'));
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: "Benutzername und Passwort sind erforderlich." });
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
        if (err || !user) return res.status(401).json({ message: 'Authentifizierung fehlgeschlagen.' });
        bcrypt.compare(password, user.password_hash, (err, result) => {
            if (result) {
                // ALT:
                // const token = jwt.sign({ userId: user.user_id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
                
                // NEU: 'role' zum Token hinzufügen
                const token = jwt.sign(
                    { userId: user.user_id, username: user.username, role: user.role }, // <-- HIER
                    JWT_SECRET, 
                    { expiresIn: '30d' }
                );
                res.json({ token });
            } else {
                res.status(401).json({ message: 'Authentifizierung fehlgeschlagen.' });
            }
        });
    });
});

// Wrapper für EJS Seiten, der das Token aus dem LocalStorage liest
const renderPage = (page) => (req, res) => {
    res.render(page, { page });
};

// Anwendungsseiten (HTML wird gerendert)
// Wir brauchen eine Dummy-Route, damit der Browser die Seite anfragt. Auth passiert im Frontend-JS
app.get('/', (req, res) => res.redirect('/tasks'));
app.get('/tasks', renderPage('tasks'));
app.get('/maintenance', renderPage('maintenance'));
app.get('/master-data', renderPage('master-data'));
app.get('/devices', renderPage('devices'));
app.get('/walkthrough', renderPage('walkthrough'));
app.get('/devices/import', renderPage('import_devices'));
app.get('/system-io', renderPage('system_io'));
app.get('/users', renderPage('users'));

// Geschützte API Endpunkte
const masterDataRouter = require('./routes/r_masterData');
const devicesRouter = require('./routes/r_devices');
 const tasksRouter = require('./routes/r_tasks'); // Annahme: Du erstellst diese Dateien
 const maintenanceRouter = require('./routes/r_maintenance'); // Annahme: Du erstellst diese Dateien
const importDevicesRouter = require('./routes/r_import_devices');
const systemRouter = require('./routes/r_system');
const usersRouter = require('./routes/r_users');

app.use('/api/master-data', authMiddleware, masterDataRouter);
app.use('/api/tasks', authMiddleware, tasksRouter);
app.use('/api/maintenance', authMiddleware, maintenanceRouter);
app.use('/api/devices', authMiddleware, devicesRouter);
app.use('/api/devices', authMiddleware, importDevicesRouter);
app.use('/api/system', authMiddleware, systemRouter);
app.use('/api/users', adminAuthMiddleware, usersRouter);

// Server Start

https.createServer(options, app).listen(HTTPS_PORT, () => {
    console.log(`🚀 Server läuft sicher auf https://localhost:${HTTPS_PORT}`); // Update log message
});
/*
app.listen(PORT, () => {
    console.log(`🚀 Server läuft auf http://localhost:${PORT}`);
});
*/