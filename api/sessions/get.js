const jwt = require('jsonwebtoken');
const { getDbClient, JWT_SECRET } = require('../db');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Prohibim cachear res
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'No autoritzat' });
        
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        const client = getDbClient();

        const result = await client.execute({
            sql: 'SELECT * FROM sessions WHERE user_id = ? ORDER BY updated_at DESC',
            args: [decoded.id]
        });

        const sessions = (result.rows || []).map(row => {
            let pHistory = [], pCalendar = [], pGames = {}, pInitialQuiz = null;
            try { pHistory = typeof row.chat_history === 'string' ? JSON.parse(row.chat_history || '[]') : (row.chat_history || []); } catch(e) {}
            try { pCalendar = typeof row.calendar === 'string' ? JSON.parse(row.calendar || '[]') : (row.calendar || []); } catch(e) {}
            try { 
                pGames = typeof row.games === 'string' ? JSON.parse(row.games || '{}') : (row.games || {}); 
                if (pGames && pGames.__initial_quiz) {
                    pInitialQuiz = pGames.__initial_quiz;
                    delete pGames.__initial_quiz;
                }
            } catch(e) {}
            
            return {
                id: row.id,
                mode: row.mode,
                title: row.title,
                history: pHistory,
                calendar: pCalendar,
                games: pGames,
                initial_quiz: pInitialQuiz,
                html: row.html || '',
                context: row.context || '',
                pdf_text: row.pdf_text || '',
                date: new Date(row.updated_at || Date.now()).getTime()
            };
        });
        
        return res.status(200).json({ success: true, sessions });
    } catch (error) { 
        console.error('Sessions get error:', error);
        return res.status(500).json({ error: 'Error intern: ' + error.message }); 
    }
};
