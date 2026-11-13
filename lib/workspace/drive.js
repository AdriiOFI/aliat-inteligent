/**
 * Google Drive API Handler for Aliat Intel·ligent
 * Handles listing files, uploading study notes and searching Google Drive files.
 */
module.exports = async function driveHandler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token de Google Workspace necessari per accedir a Google Drive.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        if (req.method === 'GET') {
            // List user's files in Google Drive
            const query = encodeURIComponent("trashed = false");
            const driveRes = await fetch(
                `https://www.googleapis.com/drive/v3/files?q=${query}&pageSize=25&fields=files(id,name,mimeType,webViewLink,webContentLink,createdTime,modifiedTime,size,iconLink)&orderBy=modifiedTime desc`,
                {
                    headers: { Authorization: `Bearer ${token}` }
                }
            );

            if (!driveRes.ok) {
                const errData = await driveRes.text();
                return res.status(driveRes.status).json({ error: 'Error accedint a Google Drive', details: errData });
            }

            const data = await driveRes.json();
            return res.status(200).json({ files: data.files || [] });
        }

        if (req.method === 'POST') {
            const { name, content, mimeType = 'text/plain' } = req.body || {};
            if (!name || content === undefined) {
                return res.status(400).json({ error: 'Cal especificar nom i contingut del fitxer.' });
            }

            // Create a file in Google Drive using multipart upload
            const boundary = '-------314159265358979323846';
            const metadata = {
                name: name,
                mimeType: mimeType
            };

            const multipartRequestBody =
                `--${boundary}\r\n` +
                `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
                `${JSON.stringify(metadata)}\r\n` +
                `--${boundary}\r\n` +
                `Content-Type: ${mimeType}\r\n\r\n` +
                `${content}\r\n` +
                `--${boundary}--`;

            const uploadRes = await fetch(
                'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': `multipart/related; boundary=${boundary}`
                    },
                    body: multipartRequestBody
                }
            );

            if (!uploadRes.ok) {
                const errText = await uploadRes.text();
                return res.status(uploadRes.status).json({ error: 'Error creant fitxer a Google Drive', details: errText });
            }

            const fileData = await uploadRes.json();
            return res.status(200).json({
                success: true,
                file: fileData
            });
        }

        return res.status(405).json({ error: 'Mètode no permès' });
    } catch (err) {
        console.error('[Drive API Error]:', err);
        return res.status(500).json({ error: err.message || 'Error intern comunicant amb Google Drive' });
    }
};
