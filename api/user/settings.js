const jwt = require('jsonwebtoken');
const { getDbClient, JWT_SECRET } = require('../../lib/db');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'No autoritzat' });
        
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        const client = getDbClient();

        if (req.method === 'POST') {
            const { name, theme, ai_provider, ai_api_key, ai_model } = req.body || {};
            try {
                await client.execute({
                    sql: 'UPDATE users SET name = ?, theme = ?, ai_provider = ?, ai_api_key = ?, ai_model = ? WHERE id = ?',
                    args: [name || '', theme || 'light', ai_provider || '', ai_api_key || '', ai_model || '', decoded.id]
                });
            } catch (updateErr) {
                // Fallback for older schema without new columns in external database
                await client.execute({
                    sql: 'UPDATE users SET name = ?, theme = ? WHERE id = ?',
                    args: [name || '', theme || 'light', decoded.id]
                });
            }
            return res.status(200).json({ success: true });
        } else if (req.method === 'GET') {
            let result;
            try {
                result = await client.execute({
                    sql: 'SELECT name, theme, ai_provider, ai_api_key, ai_model FROM users WHERE id = ?',
                    args: [decoded.id]
                });
            } catch (selectErr) {
                result = await client.execute({
                    sql: 'SELECT name, theme FROM users WHERE id = ?',
                    args: [decoded.id]
                });
            }
            if (result.rows && result.rows.length > 0) {
                const u = result.rows[0];
                return res.status(200).json({
                    success: true,
                    name: u.name || '',
                    theme: u.theme || 'light',
                    ai_provider: u.ai_provider || '',
                    ai_api_key: u.ai_api_key || '',
                    ai_model: u.ai_model || ''
                });
            }
            return res.status(404).json({ error: 'Usuari no trobat' });
        }
    } catch (error) {
        console.error('User settings error:', error);
        return res.status(500).json({ error: 'Error: ' + error.message });
    }
};
