const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDbClient, JWT_SECRET } = require('../db');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { email, password } = req.body || {};
        if (!email || !password) {
            return res.status(400).json({ error: 'Email i contrasenya obligatoris' });
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        const client = getDbClient();

        // Prova de connexió
        try {
            await client.execute('SELECT 1');
        } catch (connErr) {
            console.warn('DB check fallback:', connErr.message);
        }

        const existingUser = await client.execute({
            sql: 'SELECT * FROM users WHERE email = ?',
            args: [normalizedEmail]
        });

        if (existingUser.rows && existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'Aquest usuari ja està registrat' });
        }

        const id = 'usr_' + Date.now();
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        await client.execute({
            sql: 'INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)',
            args: [id, normalizedEmail, password_hash]
        });

        // Crear el bitllet d'accés (Token JWT) vàlid per 30 dies
        const token = jwt.sign(
            { id: id, email: normalizedEmail },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        return res.status(200).json({ 
            success: true, 
            message: 'Usuari registrat correctament',
            token: token,
            user: { id: id, email: normalizedEmail }
        });

    } catch (error) {
        console.error('Register error:', error);
        return res.status(500).json({ error: `Error crític: ${error.message}` });
    }
};

