const calendarHandler = require('../lib/workspace/calendar');
const classroomHandler = require('../lib/workspace/classroom');
const docsHandler = require('../lib/workspace/docs');
const driveHandler = require('../lib/workspace/drive');
const gmailHandler = require('../lib/workspace/gmail');

const ROUTES = {
    calendar: calendarHandler,
    classroom: classroomHandler,
    docs: docsHandler,
    drive: driveHandler,
    gmail: gmailHandler
};

module.exports = async function workspaceRouter(req, res) {
    const rawService = (req.params && req.params.service)
        || (req.query && req.query.service)
        || ((req.url || '').split('?')[0].split('/').filter(Boolean).pop())
        || '';
    const service = String(rawService).trim().toLowerCase();

    const handler = ROUTES[service];
    if (!handler) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.status(404).json({ error: `Servei de Google Workspace no trobat: ${service}` });
    }

    return handler(req, res);
};
