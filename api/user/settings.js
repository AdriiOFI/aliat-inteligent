const { createClient } = require('@libsql/client/web');
const jwt = require('jsonwebtoken');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'No autoritzat' });
        
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
        const client = createClient({
            url: process.env.TURSO_DATABASE_URL,
            authToken: process.env.TURSO_AUTH_TOKEN,
        });

        if (req.method === 'POST') {
            const { name, theme } = req.body;
            await client.execute({
                sql: 'UPDATE users SET name = ?, theme = ? WHERE id = ?',
                args: [name || '', theme || 'light', decoded.id]
            });
            return res.status(200).json({ success: true });
        } else if (req.method === 'GET') {
            const result = await client.execute({
                sql: 'SELECT name, theme FROM users WHERE id = ?',
                args: [decoded.id]
            });
            if (result.rows.length > 0) {
                return res.status(200).json({ success: true, name: result.rows[0].name, theme: result.rows[0].theme });
            }
            return res.status(404).json({ error: 'Usuari no trobat' });
        }
    } catch (error) {
        return res.status(500).json({ error: 'Error: ' + error.message });
    }
}
