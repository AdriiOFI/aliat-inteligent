const { memoryStore, saveStoreToDisk } = require('../db');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        if (req.method === 'POST') {
            const { title, history, calendar, initial_quiz, html, date } = req.body || {};
            if (!history || !Array.isArray(history) || history.length === 0) {
                return res.status(400).json({ error: 'La conversa no té missatges per compartir.' });
            }

            const shareId = 'share_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
            const shareSnapshot = {
                id: shareId,
                title: title || 'Conversa Compartida',
                history: history,
                calendar: calendar || [],
                initial_quiz: initial_quiz || null,
                html: html || '',
                date: date || Date.now(),
                created_at: new Date().toISOString()
            };

            memoryStore.shares.set(shareId, shareSnapshot);
            saveStoreToDisk();

            return res.status(200).json({
                success: true,
                shareId: shareId
            });
        }

        if (req.method === 'GET') {
            const shareId = req.query.id;
            if (!shareId) return res.status(400).json({ error: 'Falta paràmetre id' });

            const share = memoryStore.shares.get(shareId);
            if (!share) {
                return res.status(404).json({ error: 'Conversa compartida no trobada o caducada.' });
            }

            return res.status(200).json({
                success: true,
                share: share
            });
        }

        return res.status(405).json({ error: 'Mètode no permès' });
    } catch (e) {
        console.error('[Share Handler Error]:', e);
        return res.status(500).json({ error: 'Error intern: ' + e.message });
    }
};
