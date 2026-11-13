const { getDbClient, extractUserFromRequest } = require('../db');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const user = extractUserFromRequest(req);
        if (!user || !user.id) return res.status(401).json({ error: 'No autoritzat' });

        const { id } = req.body || {};

        const client = getDbClient();

        let effectiveUserId = user.id;
        if (user.email) {
            try {
                const uRes = await client.execute({
                    sql: 'SELECT id FROM users WHERE email = ?',
                    args: [user.email.trim().toLowerCase()]
                });
                if (uRes.rows && uRes.rows.length > 0 && uRes.rows[0].id) {
                    effectiveUserId = String(uRes.rows[0].id);
                }
            } catch (_) {}
        }

        // Eliminar el xat només si pertany a l'usuari que ho demana
        await client.execute({
            sql: 'DELETE FROM sessions WHERE id = ? AND user_id = ?',
            args: [id, effectiveUserId]
        });

        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('Sessions delete error:', error);
        return res.status(500).json({ error: 'Error: ' + error.message });
    }
};
