const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { getDbClient, JWT_SECRET } = require('../db');

function getFirebaseApiKey() {
    try {
        const cfgPath = path.join(process.cwd(), 'firebase-applet-config.json');
        if (fs.existsSync(cfgPath)) {
            const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            return cfg.apiKey || '';
        }
    } catch (_) {}
    return '';
}

async function verifyGoogleTokens({ idToken, accessToken, expectedEmail }) {
    // 1. Verify Google OAuth2 Access Token if provided (most reliable for Workspace scopes)
    if (accessToken && typeof accessToken === 'string' && accessToken.length > 15) {
        try {
            const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            if (resp.ok) {
                const profile = await resp.json();
                if (profile && profile.email && (!expectedEmail || profile.email.toLowerCase() === expectedEmail.toLowerCase())) {
                    return {
                        verified: true,
                        email: profile.email.toLowerCase(),
                        uid: profile.sub || '',
                        name: profile.name || '',
                        picture: profile.picture || ''
                    };
                }
            }
        } catch (e) {
            console.warn('[Google Auth] Access token verification warning:', e.message);
        }
    }

    // 2. Verify Google OAuth ID Token if provided
    if (idToken && typeof idToken === 'string' && idToken.length > 20) {
        try {
            const resp = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
            if (resp.ok) {
                const info = await resp.json();
                if (info && info.email && (!expectedEmail || info.email.toLowerCase() === expectedEmail.toLowerCase())) {
                    return {
                        verified: true,
                        email: info.email.toLowerCase(),
                        uid: info.sub || info.user_id,
                        name: info.name || '',
                        picture: info.picture || ''
                    };
                }
            }
        } catch (e) {
            console.warn('[Google Auth] Google ID token verification warning:', e.message);
        }

        // 3. Verify Firebase Auth ID Token via Identity Toolkit accounts:lookup
        const apiKey = getFirebaseApiKey();
        if (apiKey) {
            try {
                const fbResp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ idToken })
                });
                if (fbResp.ok) {
                    const fbData = await fbResp.json();
                    const acct = fbData && Array.isArray(fbData.users) ? fbData.users[0] : null;
                    if (acct && acct.email && (!expectedEmail || acct.email.toLowerCase() === expectedEmail.toLowerCase())) {
                        return {
                            verified: true,
                            email: acct.email.toLowerCase(),
                            uid: acct.localId || '',
                            name: acct.displayName || '',
                            picture: acct.photoUrl || ''
                        };
                    }
                }
            } catch (e) {
                console.warn('[Google Auth] Firebase ID token verification warning:', e.message);
            }
        }
    }

    return { verified: false };
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Mètode no permès' });

    try {
        const {
            uid,
            email,
            displayName,
            photoURL,
            phoneNumber,
            idToken,
            accessToken
        } = req.body || {};

        if (!email && !idToken && !accessToken) {
            return res.status(400).json({ error: 'Cal proporcionar credencials vàlides de Google.' });
        }

        let normalizedEmail = String(email || '').trim().toLowerCase();
        let verifiedGoogleProfile = await verifyGoogleTokens({
            idToken,
            accessToken,
            expectedEmail: normalizedEmail
        });

        // If verified via official Google OAuth token, use the authoritative email from Google
        if (verifiedGoogleProfile.verified && verifiedGoogleProfile.email) {
            normalizedEmail = verifiedGoogleProfile.email;
        }

        if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            return res.status(400).json({ error: 'Format de correu electrònic invàlid.' });
        }

        const client = getDbClient();
        const result = await client.execute({
            sql: 'SELECT * FROM users WHERE email = ?',
            args: [normalizedEmail]
        });
        const existingUser = (result.rows && result.rows.length > 0) ? result.rows[0] : null;

        // SECURITY GATE: Require genuine Google OAuth token verification (ID token or OAuth access token).
        // Never allow email-only or simulated/manual code linking on the Google endpoint.
        if (!verifiedGoogleProfile.verified) {
            return res.status(401).json({
                error: "Per vincular o iniciar sessió amb Google de forma segura cal autenticar-se mitjançant la finestra oficial d'autorització de Google OAuth.",
                requiresGoogleOAuth: true
            });
        }

        let userId = (verifiedGoogleProfile.uid ? `google_${verifiedGoogleProfile.uid}` : uid) || 'usr_' + Date.now();
        let wasLinked = false;
        let photo = verifiedGoogleProfile.picture || photoURL || '';
        const finalName = verifiedGoogleProfile.name || displayName || (existingUser && existingUser.name) || normalizedEmail.split('@')[0];

        if (existingUser) {
            userId = existingUser.id;
            wasLinked = true;
            photo = photo || existingUser.photo_url || '';

            await client.execute({
                sql: 'UPDATE users SET name = ?, photo_url = ? WHERE id = ?',
                args: [finalName, photo, userId]
            });
        } else {
            await client.execute({
                sql: 'INSERT INTO users (id, email, password_hash, name, photo_url) VALUES (?, ?, ?, ?, ?)',
                args: [userId, normalizedEmail, 'google-oauth-authenticated', finalName, photo]
            });
        }

        const token = jwt.sign(
            {
                id: userId,
                email: normalizedEmail,
                googleUid: verifiedGoogleProfile.uid || uid || null,
                authMethod: 'google_oauth_verified'
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        return res.status(200).json({
            success: true,
            token: token,
            linkedAccount: wasLinked,
            verifiedMethod: 'oauth_token',
            message: wasLinked
                ? `Compte verificat i vinculat de forma segura amb ${normalizedEmail}!`
                : 'Compte de Google verificat i protegit amb èxit.',
            user: {
                id: userId,
                email: normalizedEmail,
                name: finalName,
                photoURL: photo,
                phoneNumber: phoneNumber || ''
            }
        });

    } catch (error) {
        console.error('Google Auth Error:', error);
        return res.status(500).json({ error: 'Error en la vinculació segura de Google: ' + error.message });
    }
};
