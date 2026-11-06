const jwt = require('jsonwebtoken');
const { getDbClient, JWT_SECRET } = require('../db');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Mètode no permès' });

    try {
        const { uid, email, displayName, photoURL, phoneNumber } = req.body || {};
        if (!email && !uid) return res.status(400).json({ error: 'Identificador d\'usuari invàlid' });

        const normalizedEmail = String(email || `${uid}@google.auth`).trim().toLowerCase();
        const client = getDbClient();

        // Buscar si ja existeix un usuari amb aquest correu a la base de dades
        const result = await client.execute({
            sql: 'SELECT * FROM users WHERE email = ?',
            args: [normalizedEmail]
        });

        let userId = uid || 'usr_' + Date.now();
        let wasLinked = false;
        let photo = photoURL || '';

        if (result.rows && result.rows.length > 0) {
            const existingUser = result.rows[0];
            userId = existingUser.id;
            wasLinked = true;
            const newName = displayName || existingUser.name || normalizedEmail.split('@')[0];
            photo = photoURL || existingUser.photo_url || '';

            await client.execute({
                sql: 'UPDATE users SET name = ?, photo_url = ? WHERE id = ?',
                args: [newName, photo, userId]
            });
        } else {
            await client.execute({
                sql: 'INSERT INTO users (id, email, password_hash, name, photo_url) VALUES (?, ?, ?, ?, ?)',
                args: [userId, normalizedEmail, 'google-oauth-authenticated', displayName || normalizedEmail.split('@')[0], photo]
            });
        }

        const token = jwt.sign(
            { id: userId, email: normalizedEmail, googleUid: uid },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        return res.status(200).json({
            success: true,
            token: token,
            linkedAccount: wasLinked,
            message: wasLinked 
                ? `S'ha trobat un compte registrat prèviament amb ${normalizedEmail}. S'ha vinculat el teu perfil de Google correctament!`
                : "Compte de Google creat i integrat amb èxit.",
            user: {
                id: userId,
                email: normalizedEmail,
                name: displayName || normalizedEmail.split('@')[0],
                photoURL: photo,
                phoneNumber: phoneNumber || ''
            }
        });

    } catch (error) {
        console.error('Google Auth Error:', error);
        return res.status(500).json({ error: 'Error en la vinculació de Google: ' + error.message });
    }
};
