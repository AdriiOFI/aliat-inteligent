/**
 * Google Sheets API Handler for Aliat Intel·ligent
 * Creates formatted Google Spreadsheets and populates structured tables in the user's Google account.
 */
function sanitizeSheetTabName(name) {
    return String(name || 'Dades Aliat')
        .replace(/[\\/?*\[\]:]/g, ' ')
        .trim()
        .slice(0, 80) || 'Dades Aliat';
}

function escapeSheetRangeName(sheetName) {
    return `'${String(sheetName).replace(/'/g, "''")}'`;
}

module.exports = async function sheetsHandler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token de Google Workspace necessari per accedir a Google Sheets.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        if (req.method === 'GET') {
            const spreadsheetId = String((req.query && req.query.spreadsheetId) || '').trim();
            if (!spreadsheetId) {
                return res.status(400).json({ error: 'Falta el paràmetre spreadsheetId.' });
            }

            // Always inspect spreadsheet metadata first to identify actual tab names
            const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const meta = await metaRes.json().catch(() => ({}));
            if (!metaRes.ok) {
                return res.status(metaRes.status).json({ error: meta.error?.message || 'Error consultant Google Sheets', details: meta });
            }

            const firstTab = (meta.sheets && meta.sheets[0] && meta.sheets[0].properties && meta.sheets[0].properties.title) || 'Dades';
            const range = String((req.query && req.query.range) || `${escapeSheetRangeName(firstTab)}!A1:Z100`);

            const valRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const valData = await valRes.json().catch(() => ({}));

            return res.status(200).json({
                success: true,
                title: meta.properties && meta.properties.title,
                sheets: (meta.sheets || []).map(s => s.properties && s.properties.title).filter(Boolean),
                values: valData.values || []
            });
        }

        if (req.method === 'POST') {
            const {
                title = 'Taula de Dades - Aliat Intel·ligent',
                sheetTitle = 'Dades',
                headers = [],
                rows = []
            } = req.body || {};

            const cleanTitle = String(title || 'Taula de Dades - Aliat Intel·ligent').trim().slice(0, 180);
            const cleanTabName = sanitizeSheetTabName(sheetTitle);

            // 1. Create spreadsheet with named tab and frozen header row
            const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    properties: { title: cleanTitle },
                    sheets: [
                        {
                            properties: {
                                title: cleanTabName,
                                gridProperties: {
                                    frozenRowCount: Array.isArray(headers) && headers.length > 0 ? 1 : 0
                                }
                            }
                        }
                    ]
                })
            });

            if (!createRes.ok) {
                const errText = await createRes.text();
                return res.status(createRes.status).json({
                    error: 'Error en crear el full de càlcul a Google Sheets',
                    details: errText
                });
            }

            const sheetMeta = await createRes.json();
            const spreadsheetId = sheetMeta.spreadsheetId;
            const firstSheetProps = sheetMeta.sheets && sheetMeta.sheets[0] && sheetMeta.sheets[0].properties;
            const actualTabName = (firstSheetProps && firstSheetProps.title) || cleanTabName;
            const actualSheetId = (firstSheetProps && typeof firstSheetProps.sheetId === 'number') ? firstSheetProps.sheetId : 0;
            const sheetUrl = sheetMeta.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

            // 2. Build normalized values matrix
            const matrix = [];
            if (Array.isArray(headers) && headers.length > 0) {
                matrix.push(headers.map(h => String(h ?? '').trim()));
            }
            if (Array.isArray(rows)) {
                rows.slice(0, 500).forEach(r => {
                    if (Array.isArray(r)) {
                        matrix.push(r.map(cell => (cell === null || cell === undefined) ? '' : String(cell)));
                    }
                });
            }

            if (matrix.length > 0) {
                const targetRange = `${escapeSheetRangeName(actualTabName)}!A1`;
                const valUpdateRes = await fetch(
                    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(targetRange)}?valueInputOption=USER_ENTERED`,
                    {
                        method: 'PUT',
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ values: matrix })
                    }
                );
                if (!valUpdateRes.ok) {
                    const warnText = await valUpdateRes.text();
                    console.warn('[Sheets Values Update Warning]:', warnText);
                }

                // 3. Apply clean formatting on header row + auto-resize columns
                const colCount = Math.max(...matrix.map(r => r.length), 1);
                const formatRequests = [];
                if (Array.isArray(headers) && headers.length > 0) {
                    formatRequests.push({
                        repeatCell: {
                            range: {
                                sheetId: actualSheetId,
                                startRowIndex: 0,
                                endRowIndex: 1,
                                startColumnIndex: 0,
                                endColumnIndex: colCount
                            },
                            cell: {
                                userEnteredFormat: {
                                    backgroundColor: { red: 0.08, green: 0.45, blue: 0.25 },
                                    textFormat: {
                                        foregroundColor: { red: 1, green: 1, blue: 1 },
                                        bold: true
                                    }
                                }
                            },
                            fields: 'userEnteredFormat(backgroundColor,textFormat)'
                        }
                    });
                }
                formatRequests.push({
                    autoResizeDimensions: {
                        dimensions: {
                            sheetId: actualSheetId,
                            dimension: 'COLUMNS',
                            startIndex: 0,
                            endIndex: colCount
                        }
                    }
                });

                await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ requests: formatRequests })
                }).catch(() => {});
            }

            return res.status(200).json({
                success: true,
                spreadsheetId,
                title: (sheetMeta.properties && sheetMeta.properties.title) || cleanTitle,
                sheetTitle: actualTabName,
                rowCount: matrix.length,
                url: sheetUrl
            });
        }

        return res.status(405).json({ error: 'Mètode no permès' });
    } catch (err) {
        console.error('[Sheets API Error]:', err);
        return res.status(500).json({ error: err.message || 'Error intern comunicant amb Google Sheets' });
    }
};
