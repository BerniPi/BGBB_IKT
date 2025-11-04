const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { db } = require('../database');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'change_me_in_production';

// POST /api/login
router.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: "Benutzername und Passwort sind erforderlich." });
    }
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
        if (err || !user) return res.status(401).json({ message: 'Authentifizierung fehlgeschlagen.' });
        bcrypt.compare(password, user.password_hash, (err, result) => {
            if (result) {
                const token = jwt.sign({ userId: user.user_id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
                res.json({ token });
            } else {
                res.status(401).json({ message: 'Authentifizierung fehlgeschlagen.' });
            }
        });
    });
});

module.exports = router;