/**
 * Google Calendar API Handler for Aliat Intel·ligent
 * Handles listing events, creating study/daily routine events, and deleting events with user confirmation.
 */
module.exports = async function calendarHandler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token de Google Workspace necessari per accedir a Google Calendar.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        if (req.method === 'GET') {
            const timeMin = new Date().toISOString();
            const calRes = await fetch(
                `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&maxResults=25&singleEvents=true&orderBy=startTime`,
                {
                    headers: { Authorization: `Bearer ${token}` }
                }
            );

            if (!calRes.ok) {
                const errText = await calRes.text();
                return res.status(calRes.status).json({ error: 'Error obtenint esdeveniments de Google Calendar', details: errText });
            }

            const data = await calRes.json();
            const events = (data.items || []).map(item => ({
                id: item.id,
                summary: item.summary || '(Sense títol)',
                description: item.description || '',
                start: item.start?.dateTime || item.start?.date || '',
                end: item.end?.dateTime || item.end?.date || '',
                htmlLink: item.htmlLink || 'https://calendar.google.com',
                location: item.location || ''
            }));

            return res.status(200).json({ events });
        }

        if (req.method === 'POST') {
            const {
                summary = "Sessió d'Estudi Aliat",
                description = "",
                startTime,
                durationMinutes = 45,
                location = "Aliat Intel·ligent"
            } = req.body || {};

            const start = startTime ? new Date(startTime) : new Date(Date.now() + 5 * 60 * 1000);
            const end = new Date(start.getTime() + Math.max(10, durationMinutes) * 60 * 1000);

            const eventPayload = {
                summary: summary.trim(),
                description: (description + "\n\nPlanificat amb Aliat Intel·ligent.").trim(),
                location: location,
                start: {
                    dateTime: start.toISOString(),
                },
                end: {
                    dateTime: end.toISOString(),
                },
                reminders: {
                    useDefault: false,
                    overrides: [
                        { method: 'popup', minutes: 10 },
                        { method: 'popup', minutes: 30 }
                    ]
                }
            };

            const createRes = await fetch(
                'https://www.googleapis.com/calendar/v3/calendars/primary/events',
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(eventPayload)
                }
            );

            if (!createRes.ok) {
                const errText = await createRes.text();
                return res.status(createRes.status).json({ error: 'Error creant l\'esdeveniment a Google Calendar', details: errText });
            }

            const newEvent = await createRes.json();
            return res.status(200).json({
                success: true,
                event: {
                    id: newEvent.id,
                    summary: newEvent.summary,
                    htmlLink: newEvent.htmlLink,
                    start: newEvent.start?.dateTime || newEvent.start?.date,
                    end: newEvent.end?.dateTime || newEvent.end?.date
                }
            });
        }

        if (req.method === 'DELETE') {
            const { eventId } = req.body || req.query || {};
            if (!eventId) {
                return res.status(400).json({ error: 'ID de l\'esdeveniment requerit.' });
            }

            const delRes = await fetch(
                `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
                {
                    method: 'DELETE',
                    headers: { Authorization: `Bearer ${token}` }
                }
            );

            if (!delRes.ok && delRes.status !== 204) {
                const errText = await delRes.text();
                return res.status(delRes.status).json({ error: 'Error eliminant l\'esdeveniment a Google Calendar', details: errText });
            }

            return res.status(200).json({ success: true, message: 'Esdeveniment eliminat correctament.' });
        }

        return res.status(405).json({ error: 'Mètode no permès' });
    } catch (err) {
        console.error('[Calendar API Error]:', err);
        return res.status(500).json({ error: err.message || 'Error intern comunicant amb Google Calendar' });
    }
};
