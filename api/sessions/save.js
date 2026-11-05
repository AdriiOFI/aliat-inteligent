const jwt = require('jsonwebtoken');
const { getDbClient, JWT_SECRET } = require('../db');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'No autoritzat' });
        
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
        const { id, mode, title, chat_history, calendar, games, initial_quiz, html, context, pdf_text } = req.body || {};

        // Assegurem que l'ID sempre existeix per evitar bloquejos a la BD
        if (!id) return res.status(400).json({ error: 'Falta ID de sessió' });

        const client = getDbClient();

        let gamesObj = {};
        try {
            gamesObj = typeof games === 'string' ? JSON.parse(games || '{}') : (games || {});
        } catch (e) { gamesObj = {}; }
        if (initial_quiz) {
            gamesObj.__initial_quiz = initial_quiz;
        }

        await client.execute({
            sql: `INSERT INTO sessions (id, user_id, mode, title, chat_history, calendar, games, html, context, pdf_text, updated_at) 
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                  ON CONFLICT(id) DO UPDATE SET 
                  title = excluded.title,
                  chat_history = excluded.chat_history,
                  calendar = excluded.calendar,
                  games = excluded.games,
                  html = excluded.html,
                  context = excluded.context,
                  pdf_text = excluded.pdf_text,
                  updated_at = CURRENT_TIMESTAMP`,
            args: [
                id,
                decoded.id, 
                mode || 'free', 
                title || 'Nova Conversa',
                typeof chat_history === 'string' ? chat_history : JSON.stringify(chat_history || []), 
                typeof calendar === 'string' ? calendar : JSON.stringify(calendar || []), 
                JSON.stringify(gamesObj),
                html || '',
                context || '',
                pdf_text || ''
            ]
        });
        return res.status(200).json({ success: true });
    } catch (error) { 
        console.error('Sessions save error:', error);
        return res.status(500).json({ error: 'Error BD Guardar: ' + error.message }); 
    }
};
