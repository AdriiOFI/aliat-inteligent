const getHandler = require('../lib/sessions/get');
const saveHandler = require('../lib/sessions/save');
const deleteHandler = require('../lib/sessions/delete');
const shareHandler = require('../lib/sessions/share');

const ROUTES = {
    get: getHandler,
    save: saveHandler,
    delete: deleteHandler,
    share: shareHandler
};

module.exports = async function sessionsRouter(req, res) {
    const rawAction = (req.params && req.params.action)
        || (req.query && req.query.action)
        || ((req.url || '').split('?')[0].split('/').filter(Boolean).pop())
        || '';
    const action = String(rawAction).trim().toLowerCase();

    const handler = ROUTES[action];
    if (!handler) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.status(404).json({ error: `Acció de sessió no trobada: ${action}` });
    }

    return handler(req, res);
};
