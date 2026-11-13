/**
 * Gmail API Handler for Aliat Intel·ligent
 * Allows reading recent emails, creating drafts, and sending emails via user's Gmail account.
 */
module.exports = async function gmailHandler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token de Google Workspace necessari per gestionar Gmail.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        if (req.method === 'GET') {
            // Get recent email messages list
            const listRes = await fetch(
                'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&q=' + encodeURIComponent('category:primary OR is:unread'),
                {
                    headers: { Authorization: `Bearer ${token}` }
                }
            );

            if (!listRes.ok) {
                const errText = await listRes.text();
                return res.status(listRes.status).json({ error: 'Error obtenint correus de Gmail', details: errText });
            }

            const listData = await listRes.json();
            const messageIds = (listData.messages || []).slice(0, 8);

            // Fetch details of top messages in parallel
            const messages = await Promise.all(
                messageIds.map(async (m) => {
                    try {
                        const mRes = await fetch(
                            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
                            { headers: { Authorization: `Bearer ${token}` } }
                        );
                        if (!mRes.ok) return null;
                        const msgDetail = await mRes.json();
                        const headers = msgDetail.payload?.headers || [];
                        const subjectHeader = headers.find(h => h.name.toLowerCase() === 'subject');
                        const fromHeader = headers.find(h => h.name.toLowerCase() === 'from');
                        const dateHeader = headers.find(h => h.name.toLowerCase() === 'date');
                        return {
                            id: m.id,
                            threadId: m.threadId,
                            snippet: msgDetail.snippet || '',
                            subject: subjectHeader ? subjectHeader.value : '(Sense assumpte)',
                            from: fromHeader ? fromHeader.value : '',
                            date: dateHeader ? dateHeader.value : ''
                        };
                    } catch (e) {
                        return null;
                    }
                })
            );

            return res.status(200).json({
                messages: messages.filter(Boolean)
            });
        }

        if (req.method === 'POST') {
            const { action = 'send', to, subject = "Apunts d'estudi Aliat", body = "" } = req.body || {};

            if (!to || !body) {
                return res.status(400).json({ error: 'Destinatari (to) i cos del missatge (body) són obligatoris.' });
            }

            // Encode RFC 2822 email format
            const emailLines = [
                `To: ${to.trim()}`,
                `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`,
                'MIME-Version: 1.0',
                'Content-Type: text/plain; charset=UTF-8',
                'Content-Transfer-Encoding: 7bit',
                '',
                body
            ];

            const rawBase64Url = Buffer.from(emailLines.join('\r\n'))
                .toString('base64')
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');

            const endpoint = action === 'draft'
                ? 'https://gmail.googleapis.com/gmail/v1/users/me/drafts'
                : 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

            const payload = action === 'draft'
                ? { message: { raw: rawBase64Url } }
                : { raw: rawBase64Url };

            const sendRes = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!sendRes.ok) {
                const errText = await sendRes.text();
                return res.status(sendRes.status).json({
                    error: action === 'draft' ? 'Error desant esborrany a Gmail' : 'Error enviant correu amb Gmail',
                    details: errText
                });
            }

            const result = await sendRes.json();
            return res.status(200).json({
                success: true,
                action,
                id: result.id,
                message: action === 'draft' ? 'Esborrany creat a Gmail!' : 'Correu enviat correctament via Gmail!'
            });
        }

        return res.status(405).json({ error: 'Mètode no permès' });
    } catch (err) {
        console.error('[Gmail API Error]:', err);
        return res.status(500).json({ error: err.message || 'Error intern comunicant amb Gmail' });
    }
};
