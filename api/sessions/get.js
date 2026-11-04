const { createClient } = require('@libsql/client/web');
const jwt = require('jsonwebtoken');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Prohibim a Vercel cachear res
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'No autoritzat' });
        
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
        const client = createClient({
            url: process.env.TURSO_DATABASE_URL,
            authToken: process.env.TURSO_AUTH_TOKEN,
        });

        const result = await client.execute({
            sql: 'SELECT * FROM sessions WHERE user_id = ? ORDER BY updated_at DESC',
            args: [decoded.id]
        });

        const sessions = result.rows.map(row => {
            let pHistory = [], pCalendar = [], pGames = {};
            try { pHistory = JSON.parse(row.chat_history || '[]'); } catch(e) {}
            try { pCalendar = JSON.parse(row.calendar || '[]'); } catch(e) {}
            try { pGames = JSON.parse(row.games || '{}'); } catch(e) {}
            
            return {
                id: row.id,
                mode: row.mode,
                title: row.title,
                history: pHistory,
                calendar: pCalendar,
                games: pGames,
                html: row.html || '',
                context: row.context || '',
                pdf_text: row.pdf_text || '',
                date: new Date(row.updated_at).getTime()
            };
        });
        
        return res.status(200).json({ success: true, sessions });
    } catch (error) { 
        return res.status(500).json({ error: 'Error intern: ' + error.message }); 
    }
}
