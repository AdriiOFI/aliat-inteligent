const fs = require('fs');
const path = require('path');

function buildPublicFirebaseConfig() {
    const cfgPath = path.join(process.cwd(), 'firebase-applet-config.json');
    let raw = {};
    if (fs.existsSync(cfgPath)) {
        try {
            raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        } catch (_) {
            raw = {};
        }
    }

    const publicConfig = {
        projectId: String(process.env.FIREBASE_PROJECT_ID || raw.projectId || '').trim(),
        appId: String(process.env.FIREBASE_APP_ID || raw.appId || '').trim(),
        apiKey: String(process.env.FIREBASE_API_KEY || raw.apiKey || '').trim(),
        authDomain: String(process.env.FIREBASE_AUTH_DOMAIN || raw.authDomain || '').trim(),
        storageBucket: String(process.env.FIREBASE_STORAGE_BUCKET || raw.storageBucket || '').trim(),
        messagingSenderId: String(process.env.FIREBASE_MESSAGING_SENDER_ID || raw.messagingSenderId || '').trim(),
        measurementId: String(process.env.FIREBASE_MEASUREMENT_ID || raw.measurementId || '').trim(),
        oAuthClientId: String(process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.OAUTH_CLIENT_ID || raw.oAuthClientId || '').trim(),
        recaptchaSiteKey: String(process.env.RECAPTCHA_SITE_KEY || raw.recaptchaSiteKey || '').trim()
    };

    const dbId = String(process.env.FIREBASE_DATABASE_ID || raw.firestoreDatabaseId || '').trim();
    if (dbId) {
        publicConfig.firestoreDatabaseId = dbId;
    }

    return publicConfig;
}

async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    try {
        const publicConfig = buildPublicFirebaseConfig();
        if (!publicConfig.apiKey || !publicConfig.projectId) {
            return res.status(404).json({ error: 'Config not found' });
        }
        return res.status(200).json(publicConfig);
    } catch (_) {
        return res.status(500).json({ error: 'Unable to load public Firebase config' });
    }
}

handler.buildPublicFirebaseConfig = buildPublicFirebaseConfig;
module.exports = handler;
