const { getDbClient, extractUserFromRequest } = require('../../lib/db');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const user = extractUserFromRequest(req);
        if (!user || !user.id) return res.status(401).json({ error: 'No autoritzat' });

        const client = getDbClient();

        if (req.method === 'POST') {
            const { name, theme, lang, ai_provider, ai_api_key, ai_model } = req.body || {};
            const normalizedLang = lang === 'es' ? 'es' : 'ca';
            try {
                await client.execute({
                    sql: 'UPDATE users SET name = ?, theme = ?, lang = ?, ai_provider = ?, ai_api_key = ?, ai_model = ? WHERE id = ?',
                    args: [name || '', theme || 'light', normalizedLang, ai_provider || '', ai_api_key || '', ai_model || '', user.id]
                });
            } catch (updateErr) {
                try {
                    await client.execute({
                        sql: 'UPDATE users SET name = ?, theme = ?, ai_provider = ?, ai_api_key = ?, ai_model = ? WHERE id = ?',
                        args: [name || '', theme || 'light', ai_provider || '', ai_api_key || '', ai_model || '', user.id]
                    });
                } catch (_) {
                    await client.execute({
                        sql: 'UPDATE users SET name = ?, theme = ? WHERE id = ?',
                        args: [name || '', theme || 'light', user.id]
                    });
                }
            }
            return res.status(200).json({ success: true, lang: normalizedLang });
        } else if (req.method === 'GET') {
            let result;
            try {
                result = await client.execute({
                    sql: 'SELECT name, theme, lang, ai_provider, ai_api_key, ai_model FROM users WHERE id = ?',
                    args: [user.id]
                });
            } catch (selectErr) {
                try {
                    result = await client.execute({
                        sql: 'SELECT name, theme, ai_provider, ai_api_key, ai_model FROM users WHERE id = ?',
                        args: [user.id]
                    });
                } catch (_) {
                    result = await client.execute({
                        sql: 'SELECT name, theme FROM users WHERE id = ?',
                        args: [user.id]
                    });
                }
            }
            if (result.rows && result.rows.length > 0) {
                const u = result.rows[0];
                return res.status(200).json({
                    success: true,
                    name: u.name || '',
                    theme: u.theme || 'light',
                    lang: u.lang === 'es' ? 'es' : (u.lang === 'ca' ? 'ca' : ''),
                    ai_provider: u.ai_provider || '',
                    ai_api_key: u.ai_api_key || '',
                    ai_model: u.ai_model || ''
                });
            }
            return res.status(200).json({
                success: true,
                name: user.email ? user.email.split('@')[0] : '',
                theme: 'light',
                lang: '',
                ai_provider: '',
                ai_api_key: '',
                ai_model: ''
            });
        }
    } catch (error) {
        console.error('User settings error:', error);
        return res.status(500).json({ error: 'Error: ' + error.message });
    }
};
