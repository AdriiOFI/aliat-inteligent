/**
 * Google Slides API Handler for Aliat Intel·ligent
 * Creates formatted Google Slides presentations directly in the user's Google account.
 */
function buildSlidesFromRawText(rawText, fallbackTitle) {
    const clean = String(rawText || '').trim();
    if (!clean) {
        return [{
            title: fallbackTitle || 'Resum principal',
            body: 'Presentació creada amb Aliat Intel·ligent.'
        }];
    }

    const lines = clean.split(/\r?\n/);
    const sections = [];
    let current = null;

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        const headingMatch = line.match(/^#{1,3}\s+(.+)$/) || line.match(/^\*\*(.{3,80})\*\*:?$/);
        if (headingMatch) {
            if (current && (current.bodyLines.length > 0 || current.title)) {
                sections.push(current);
            }
            current = {
                title: headingMatch[1].replace(/\*\*/g, '').trim().slice(0, 120),
                bodyLines: []
            };
        } else {
            if (!current) {
                current = { title: fallbackTitle || 'Introducció i Punts Clau', bodyLines: [] };
            }
            current.bodyLines.push(line.replace(/^[-*]\s+/, '• ').replace(/\*\*/g, ''));
            if (current.bodyLines.length >= 8) {
                sections.push(current);
                current = null;
            }
        }
    }
    if (current && (current.bodyLines.length > 0 || current.title)) {
        sections.push(current);
    }

    if (sections.length === 0) {
        return [{ title: fallbackTitle || 'Contingut', body: clean.slice(0, 1200) }];
    }

    return sections.slice(0, 15).map((sec, i) => ({
        title: sec.title || `Diapositiva ${i + 1}`,
        body: sec.bodyLines.join('\n').slice(0, 1400) || 'Contingut generat des de la sessió.'
    }));
}

module.exports = async function slidesHandler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token de Google Workspace necessari per accedir a Google Slides.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        if (req.method === 'GET') {
            const presentationId = String((req.query && req.query.presentationId) || '').trim();
            if (!presentationId) {
                return res.status(400).json({ error: 'Falta el paràmetre presentationId.' });
            }
            const getRes = await fetch(`https://slides.googleapis.com/v1/presentations/${encodeURIComponent(presentationId)}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await getRes.json().catch(() => ({}));
            if (!getRes.ok) {
                return res.status(getRes.status).json({ error: data.error?.message || 'Error consultant Google Slides', details: data });
            }
            return res.status(200).json({ success: true, presentation: data });
        }

        if (req.method === 'POST') {
            const {
                title = "Presentació d'Estudi Aliat",
                subtitle = '',
                slides = [],
                rawText = '',
                category = 'General'
            } = req.body || {};

            const cleanTitle = String(title || "Presentació d'Estudi Aliat").trim().slice(0, 180);

            // 1. Create presentation
            const createRes = await fetch('https://slides.googleapis.com/v1/presentations', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ title: cleanTitle })
            });

            if (!createRes.ok) {
                const errText = await createRes.text();
                return res.status(createRes.status).json({
                    error: 'Error en crear la presentació a Google Slides',
                    details: errText
                });
            }

            const presData = await createRes.json();
            const presentationId = presData.presentationId;
            const presUrl = `https://docs.google.com/presentation/d/${presentationId}/edit`;

            // 2. Prepare structured slides
            let normalizedSlides = [];
            if (Array.isArray(slides) && slides.length > 0) {
                normalizedSlides = slides.slice(0, 18).map((s, idx) => {
                    const sTitle = String((s && (s.title || s.heading)) || `Diapositiva ${idx + 1}`).trim().slice(0, 150);
                    let sBody = '';
                    if (s && Array.isArray(s.bullets) && s.bullets.length > 0) {
                        sBody = s.bullets.map(b => `• ${String(b).trim()}`).join('\n');
                    } else if (s && s.body) {
                        sBody = String(s.body).trim();
                    }
                    return { title: sTitle, body: sBody.slice(0, 1600) };
                });
            } else {
                normalizedSlides = buildSlidesFromRawText(rawText, cleanTitle);
            }

            // 3. Populate first title slide + append content slides in batchUpdate
            const batchRequests = [];
            const firstSlide = Array.isArray(presData.slides) ? presData.slides[0] : null;
            if (firstSlide && Array.isArray(firstSlide.pageElements)) {
                for (const el of firstSlide.pageElements) {
                    const phType = el.shape && el.shape.placeholder && el.shape.placeholder.type;
                    if (phType === 'CENTERED_TITLE' || phType === 'TITLE') {
                        batchRequests.push({
                            insertText: {
                                objectId: el.objectId,
                                insertionIndex: 0,
                                text: cleanTitle
                            }
                        });
                    } else if (phType === 'SUBTITLE') {
                        const subText = String(subtitle || '').trim()
                            || `${category} · Generat amb Aliat Intel·ligent (${new Date().toLocaleDateString('ca-ES')})`;
                        batchRequests.push({
                            insertText: {
                                objectId: el.objectId,
                                insertionIndex: 0,
                                text: subText
                            }
                        });
                    }
                }
            }

            const suffix = Date.now().toString(36);
            normalizedSlides.forEach((slide, idx) => {
                const slideId = `aliat_slide_${suffix}_${idx}`;
                const titleId = `aliat_title_${suffix}_${idx}`;
                const bodyId = `aliat_body_${suffix}_${idx}`;

                batchRequests.push({
                    createSlide: {
                        objectId: slideId,
                        insertionIndex: idx + 1,
                        slideLayoutReference: { predefinedLayout: 'TITLE_AND_BODY' },
                        placeholderIdMappings: [
                            {
                                layoutPlaceholder: { type: 'TITLE', index: 0 },
                                objectId: titleId
                            },
                            {
                                layoutPlaceholder: { type: 'BODY', index: 0 },
                                objectId: bodyId
                            }
                        ]
                    }
                });

                if (slide.title) {
                    batchRequests.push({
                        insertText: {
                            objectId: titleId,
                            insertionIndex: 0,
                            text: slide.title
                        }
                    });
                }
                if (slide.body) {
                    batchRequests.push({
                        insertText: {
                            objectId: bodyId,
                            insertionIndex: 0,
                            text: slide.body
                        }
                    });
                }
            });

            if (batchRequests.length > 0) {
                const batchRes = await fetch(`https://slides.googleapis.com/v1/presentations/${presentationId}:batchUpdate`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ requests: batchRequests })
                });
                if (!batchRes.ok) {
                    const warnTxt = await batchRes.text();
                    console.warn('[Slides BatchUpdate Warning]:', warnTxt);
                }
            }

            return res.status(200).json({
                success: true,
                presentationId,
                title: presData.title || cleanTitle,
                slideCount: normalizedSlides.length + 1,
                url: presUrl
            });
        }

        return res.status(405).json({ error: 'Mètode no permès' });
    } catch (err) {
        console.error('[Slides API Error]:', err);
        return res.status(500).json({ error: err.message || 'Error intern comunicant amb Google Slides' });
    }
};
