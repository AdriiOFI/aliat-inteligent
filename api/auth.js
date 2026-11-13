const loginHandler = require('../lib/auth/login');
const registerHandler = require('../lib/auth/register');
const googleHandler = require('../lib/auth/google');
const verifyHandler = require('../lib/auth/verify');

const ROUTES = {
    login: loginHandler,
    register: registerHandler,
    google: googleHandler,
    verify: verifyHandler
};

module.exports = async function authRouter(req, res) {
    const rawAction = (req.params && req.params.action)
        || (req.query && req.query.action)
        || ((req.url || '').split('?')[0].split('/').filter(Boolean).pop())
        || '';
    const action = String(rawAction).trim().toLowerCase();

    const handler = ROUTES[action];
    if (!handler) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.status(404).json({ error: `Acció d'autenticació no trobada: ${action}` });
    }

    return handler(req, res);
};
