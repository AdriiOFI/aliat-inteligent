/**
 * Google Docs API Handler for Aliat Intel·ligent
 * Creates formatted Google Documents directly in user's Google Docs and provides direct edit URLs.
 */
module.exports = async function docsHandler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token de Google Workspace necessari per accedir a Google Docs.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        if (req.method === 'POST') {
            const { title = "Document d'Estudi Aliat", content = "", category = "General" } = req.body || {};

            // 1. Create a blank Google Document
            const createRes = await fetch('https://docs.googleapis.com/v1/documents', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    title: title.trim()
                })
            });

            if (!createRes.ok) {
                const errText = await createRes.text();
                return res.status(createRes.status).json({
                    error: 'Error en crear el document a Google Docs',
                    details: errText
                });
            }

            const docData = await createRes.json();
            const documentId = docData.documentId;
            const docUrl = `https://docs.google.com/document/d/${documentId}/edit`;

            // 2. Insert formatted content if provided
            const fullBodyText = `${title}\nCategoria: ${category} | Creat amb Aliat Intel·ligent\nData: ${new Date().toLocaleDateString('ca-ES')}\n\n${content}\n`;

            const updateRes = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    requests: [
                        {
                            insertText: {
                                location: { index: 1 },
                                text: fullBodyText
                            }
                        }
                    ]
                })
            });

            if (!updateRes.ok) {
                console.warn('[Docs Update Warning]: Could not insert text into doc, but doc was created.');
            }

            return res.status(200).json({
                success: true,
                documentId,
                title: docData.title || title,
                url: docUrl
            });
        }

        return res.status(405).json({ error: 'Mètode no permès' });
    } catch (err) {
        console.error('[Docs API Error]:', err);
        return res.status(500).json({ error: err.message || 'Error intern comunicant amb Google Docs' });
    }
};
