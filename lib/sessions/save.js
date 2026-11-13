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

        const { id, mode, title, studyTitle, studyPreferences, files, history, chat_history, calendar, games, initial_quiz, pinned, userCustomTitle, html, context, pdf_text, date } = req.body || {};

        if (!id) return res.status(400).json({ error: 'Falta ID de sessió' });

        const client = getDbClient();

        // Ensure the user exists in the database (prevents FOREIGN KEY constraint failed on Turso)
        let effectiveUserId = user.id;
        const userEmail = (user.email || `${effectiveUserId}@aliat.local`).trim().toLowerCase();
        try {
            const existingUserRes = await client.execute({
                sql: 'SELECT id FROM users WHERE email = ?',
                args: [userEmail]
            });
            if (existingUserRes.rows && existingUserRes.rows.length > 0 && existingUserRes.rows[0].id) {
                effectiveUserId = String(existingUserRes.rows[0].id);
            } else {
                await client.execute({
                    sql: 'INSERT OR IGNORE INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)',
                    args: [effectiveUserId, userEmail, 'hydrated', userEmail.split('@')[0]]
                });
            }
        } catch (userEnsureErr) {
            console.warn('Notice ensuring user before session save:', userEnsureErr.message);
        }

        let gamesObj = {};
        try {
            gamesObj = typeof games === 'string' ? JSON.parse(games || '{}') : { ...(games || {}) };
        } catch (e) { gamesObj = {}; }
        if (initial_quiz) {
            gamesObj.__initial_quiz = initial_quiz;
        }
        if (pinned !== undefined) {
            gamesObj.__pinned = Boolean(pinned);
        }
        if (userCustomTitle !== undefined) {
            gamesObj.__userCustomTitle = Boolean(userCustomTitle);
        }
        if (studyTitle) {
            gamesObj.__studyTitle = String(studyTitle);
        }
        if (studyPreferences && typeof studyPreferences === 'object') {
            gamesObj.__studyPreferences = studyPreferences;
        }
        if (Array.isArray(files) && files.length > 0) {
            gamesObj.__files = files.map(f => ({
                id: f.id || '',
                name: f.name || '',
                ext: f.ext || '',
                type: f.type || ''
            })).filter(f => f.name);
        }

        const effectiveHistory = chat_history || history || [];
        const hasCalendar = (Array.isArray(calendar) && calendar.length > 0) || (typeof calendar === 'string' && calendar.length > 10);
        const detectedMode = (mode === 'free' || mode === 'daily_use') ? mode : (hasCalendar ? 'study' : (mode || 'free'));

        const nowMs = Date.now();
        let validMs = Number(date);
        if (!Number.isFinite(validMs) || validMs <= 0) {
            validMs = nowMs;
        }
        if (validMs > nowMs + 60000) {
            validMs = nowMs;
        }
        const updatedAtIso = new Date(validMs).toISOString();

        await client.execute({
            sql: `INSERT INTO sessions (id, user_id, mode, title, chat_history, calendar, games, html, context, pdf_text, updated_at) 
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(id) DO UPDATE SET 
                  user_id = excluded.user_id,
                  mode = excluded.mode,
                  title = excluded.title,
                  chat_history = excluded.chat_history,
                  calendar = excluded.calendar,
                  games = excluded.games,
                  html = excluded.html,
                  context = excluded.context,
                  pdf_text = excluded.pdf_text,
                  updated_at = excluded.updated_at`,
            args: [
                id,
                effectiveUserId,
                detectedMode,
                title || 'Nova Conversa',
                typeof effectiveHistory === 'string' ? effectiveHistory : JSON.stringify(effectiveHistory),
                typeof calendar === 'string' ? calendar : JSON.stringify(calendar || []),
                JSON.stringify(gamesObj),
                html || '',
                context || '',
                pdf_text || '',
                updatedAtIso
            ]
        });
        return res.status(200).json({ success: true, id, date: validMs });
    } catch (error) {
        console.error('Sessions save error:', error);
        return res.status(500).json({ error: 'Error BD Guardar: ' + error.message });
    }
};
