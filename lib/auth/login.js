const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDbClient, JWT_SECRET } = require('../db');

module.exports = async function handler(req, res) {
    // Habilitar CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Mètode no permès' });

    try {
        const { email, password } = req.body || {};
        if (!email || !password) return res.status(400).json({ error: 'Email i contrasenya obligatoris' });

        const normalizedEmail = String(email).trim().toLowerCase();
        const client = getDbClient();

        // Buscar l'usuari a la base de dades
        const result = await client.execute({
            sql: 'SELECT * FROM users WHERE email = ?',
            args: [normalizedEmail]
        });

        if (!result.rows || result.rows.length === 0) {
            return res.status(401).json({ error: 'Usuari no trobat o contrasenya incorrecta' });
        }

        const user = result.rows[0];

        // Comprovar si la contrasenya escrita coincideix amb l'encriptada
        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
            return res.status(401).json({ error: 'Usuari no trobat o contrasenya incorrecta' });
        }

        // Crear el bitllet d'accés (Token JWT) vàlid per 30 dies
        const token = jwt.sign(
            { id: user.id, email: user.email },
            JWT_SECRET,
            { expiresIn: '30d' } 
        );

        return res.status(200).json({ 
            success: true, 
            token: token,
            user: { id: user.id, email: user.email }
        });

    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({ error: 'Error intern del servidor: ' + error.message });
    }
};
