const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getDbClient, JWT_SECRET } = require('../db');
const verifyHandler = require('./verify');

async function verifyGoogleTokens({ idToken, accessToken, expectedEmail }) {
    // 1. Verify Google / Firebase ID Token if provided
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
            console.warn('[Google Auth] ID token verification warning:', e.message);
        }
    }

    // 2. Verify Google OAuth2 Access Token if provided
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
            accessToken,
            password,
            verificationCode
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

        // SECURITY GATE: Never allow email-only account linking!
        // Require either a verified Google OAuth token OR 2-Step Verification (Password + 6-digit OTP code)
        if (!verifiedGoogleProfile.verified) {
            if (!password || String(password).length < 6) {
                return res.status(401).json({
                    error: 'Per seguretat, no es permet vincular el compte només amb el correu. Cal iniciar sessió amb la finestra oficial de Google o introduir la teva contrasenya (mínim 6 caràcters) i el codi de verificació de 6 dígits.',
                    requiresTwoFactor: true
                });
            }

            const isOtpValid = verifyHandler.verifyCodeForEmail
                ? verifyHandler.verifyCodeForEmail(normalizedEmail, verificationCode, true)
                : false;

            if (!isOtpValid) {
                return res.status(401).json({
                    error: 'El codi de seguretat de 6 dígits és incorrecte o ha expirat. Fes clic a "Enviar codi de 6 dígits" per verificar la propietat del correu.',
                    requiresTwoFactor: true
                });
            }

            // If user already exists with a real password hash, verify password matches!
            if (
                existingUser &&
                existingUser.password_hash &&
                existingUser.password_hash !== 'google-oauth-authenticated'
            ) {
                const isPasswordValid = await bcrypt.compare(String(password), existingUser.password_hash);
                if (!isPasswordValid) {
                    return res.status(401).json({
                        error: 'La contrasenya introduïda no coincideix amb la d\'aquest compte registrat.'
                    });
                }
            }
        }

        let userId = (verifiedGoogleProfile.uid ? `google_${verifiedGoogleProfile.uid}` : uid) || 'usr_' + Date.now();
        let wasLinked = false;
        let photo = verifiedGoogleProfile.picture || photoURL || '';
        const finalName = verifiedGoogleProfile.name || displayName || (existingUser && existingUser.name) || normalizedEmail.split('@')[0];

        if (existingUser) {
            userId = existingUser.id;
            wasLinked = true;
            photo = photo || existingUser.photo_url || '';

            if (password && String(password).length >= 6 && existingUser.password_hash === 'google-oauth-authenticated') {
                const newHash = await bcrypt.hash(String(password), 10);
                await client.execute({
                    sql: 'UPDATE users SET name = ?, photo_url = ?, password_hash = ? WHERE id = ?',
                    args: [finalName, photo, newHash, userId]
                });
            } else {
                await client.execute({
                    sql: 'UPDATE users SET name = ?, photo_url = ? WHERE id = ?',
                    args: [finalName, photo, userId]
                });
            }
        } else {
            const passwordHashToSave = (password && String(password).length >= 6)
                ? await bcrypt.hash(String(password), 10)
                : 'google-oauth-authenticated';

            await client.execute({
                sql: 'INSERT INTO users (id, email, password_hash, name, photo_url) VALUES (?, ?, ?, ?, ?)',
                args: [userId, normalizedEmail, passwordHashToSave, finalName, photo]
            });
        }

        const token = jwt.sign(
            {
                id: userId,
                email: normalizedEmail,
                googleUid: verifiedGoogleProfile.uid || uid || null,
                authMethod: verifiedGoogleProfile.verified ? 'google_oauth_verified' : 'google_2fa_verified'
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        return res.status(200).json({
            success: true,
            token: token,
            linkedAccount: wasLinked,
            verifiedMethod: verifiedGoogleProfile.verified ? 'oauth_token' : 'two_factor_code',
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
