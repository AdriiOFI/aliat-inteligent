const crypto = require('crypto');
const { memoryStore, saveStoreToDisk, extractUserFromRequest } = require('../db');

function sanitizeSharedHtml(rawHtml) {
    return String(rawHtml || '')
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
        .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/javascript:/gi, '');
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        if (req.method === 'POST') {
            const user = extractUserFromRequest(req);
            if (!user || !user.id) {
                return res.status(401).json({ error: 'Inicia sessió per compartir una conversa.' });
            }

            const { title, history, calendar, initial_quiz, html, date } = req.body || {};
            if (!history || !Array.isArray(history) || history.length === 0) {
                return res.status(400).json({ error: 'La conversa no té missatges per compartir.' });
            }

            const shareId = 'share_' + crypto.randomBytes(12).toString('hex');
            const shareSnapshot = {
                id: shareId,
                title: String(title || 'Conversa Compartida').slice(0, 160),
                history: history.slice(0, 120).map(m => ({
                    role: m && m.role === 'assistant' ? 'assistant' : 'user',
                    content: String((m && m.content) || '').slice(0, 20000)
                })),
                calendar: Array.isArray(calendar) ? calendar.slice(0, 60) : [],
                initial_quiz: initial_quiz || null,
                html: sanitizeSharedHtml(html),
                date: Number(date) || Date.now(),
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
            const shareId = String(req.query.id || '').trim();
            if (!shareId || !/^share_[a-zA-Z0-9_-]{8,40}$/.test(shareId)) {
                return res.status(400).json({ error: 'Identificador de compartició invàlid.' });
            }

            const share = memoryStore.shares.get(shareId);
            if (!share) {
                return res.status(404).json({ error: 'Conversa compartida no trobada o caducada.' });
            }

            return res.status(200).json({
                success: true,
                share: {
                    ...share,
                    html: sanitizeSharedHtml(share.html)
                }
            });
        }

        return res.status(405).json({ error: 'Mètode no permès' });
    } catch (e) {
        console.error('[Share Handler Error]:', e);
        return res.status(500).json({ error: 'No s\'ha pogut processar la conversa compartida.' });
    }
};
