const { handlePlaces } = require('../../lib/maps/service');

module.exports = async function mapsPlacesHandler(req, res) {
    return handlePlaces(req, res);
};
