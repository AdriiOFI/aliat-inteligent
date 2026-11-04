const { createClient } = require('@libsql/client/web');
const jwt = require('jsonwebtoken');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'No autoritzat' });
        
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
        const { id } = req.body;

        const client = createClient({
            url: process.env.TURSO_DATABASE_URL,
            authToken: process.env.TURSO_AUTH_TOKEN,
        });

        // Eliminar el xat només si pertany a l'usuari que ho demana
        await client.execute({
            sql: 'DELETE FROM sessions WHERE id = ? AND user_id = ?',
            args: [id, decoded.id]
        });

        return res.status(200).json({ success: true });
    } catch (error) {
        return res.status(500).json({ error: 'Error: ' + error.message });
    }
}
