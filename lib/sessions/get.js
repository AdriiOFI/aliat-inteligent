const { getDbClient, extractUserFromRequest } = require('../db');

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
        const user = extractUserFromRequest(req);
        if (!user || !user.id) return res.status(401).json({ error: 'No autoritzat' });

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

        const result = await client.execute({
            sql: 'SELECT * FROM sessions WHERE user_id = ? ORDER BY updated_at DESC',
            args: [effectiveUserId]
        });

        const sessions = (result.rows || []).map(row => {
            let pHistory = [], pCalendar = [], pGames = {}, pInitialQuiz = null, pPinned = false, pCustomTitle = false;
            try { pHistory = typeof row.chat_history === 'string' ? JSON.parse(row.chat_history || '[]') : (row.chat_history || []); } catch(e) {}
            try { pCalendar = typeof row.calendar === 'string' ? JSON.parse(row.calendar || '[]') : (row.calendar || []); } catch(e) {}
            try { 
                pGames = typeof row.games === 'string' ? JSON.parse(row.games || '{}') : { ...(row.games || {}) }; 
                if (pGames && pGames.__initial_quiz) {
                    pInitialQuiz = pGames.__initial_quiz;
                    delete pGames.__initial_quiz;
                }
                if (pGames && pGames.__pinned !== undefined) {
                    pPinned = Boolean(pGames.__pinned);
                    delete pGames.__pinned;
                }
                if (pGames && pGames.__userCustomTitle !== undefined) {
                    pCustomTitle = Boolean(pGames.__userCustomTitle);
                    delete pGames.__userCustomTitle;
                }
            } catch(e) {}
            
            return {
                id: row.id,
                mode: row.mode,
                title: row.title,
                pinned: pPinned,
                userCustomTitle: pCustomTitle,
                history: pHistory,
                chat_history: pHistory,
                calendar: pCalendar,
                games: pGames,
                initial_quiz: pInitialQuiz,
                html: row.html || '',
                context: row.context || '',
                pdf_text: row.pdf_text || '',
                date: (() => {
                    if (!row.updated_at) return Date.now();
                    const raw = String(row.updated_at).trim();
                    const iso = raw.includes('T') ? raw : raw.replace(' ', 'T') + (raw.endsWith('Z') ? '' : 'Z');
                    const parsed = new Date(iso).getTime();
                    return (!isNaN(parsed) && parsed <= Date.now() + 60000) ? parsed : Date.now();
                })()
            };
        });
        
        return res.status(200).json({ success: true, sessions });
    } catch (error) { 
        console.error('Sessions get error:', error);
        return res.status(500).json({ error: 'Error intern: ' + error.message }); 
    }
};
