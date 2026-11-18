const {
    handleConfig,
    handleGeocode,
    handleParseCommute,
    handleAskAi,
    handleTransitRoutes,
    handlePlaces
} = require('../lib/maps/service');

const ROUTES = {
    config: handleConfig,
    geocode: handleGeocode,
    'parse-commute': handleParseCommute,
    'ask-ai': handleAskAi,
    'transit-routes': handleTransitRoutes,
    places: handlePlaces
};

module.exports = async function mapsRouter(req, res) {
    const rawAction = (req.params && req.params.action)
        || (req.query && req.query.action)
        || ((req.url || '').split('?')[0].split('/').filter(Boolean).pop())
        || '';
    const action = String(rawAction).trim().toLowerCase();

    const handler = ROUTES[action];
    if (!handler) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.status(404).json({ error: `Acció d'AliatMaps no trobada: ${action}` });
    }

    return handler(req, res);
};
