const inMemoryCodes = new Map();

function verifyCodeForEmail(email, code, consume = true) {
    if (!email || !code) return false;
    const normalizedEmail = String(email).trim().toLowerCase();
    const inputCode = String(code).trim();
    const entry = inMemoryCodes.get(normalizedEmail);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
        inMemoryCodes.delete(normalizedEmail);
        return false;
    }
    if (String(entry.code) !== inputCode) {
        entry.attempts = (entry.attempts || 0) + 1;
        if (entry.attempts >= 5) {
            inMemoryCodes.delete(normalizedEmail);
        }
        return false;
    }
    if (consume) {
        inMemoryCodes.delete(normalizedEmail);
    } else {
        entry.verified = true;
    }
    return true;
}

async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Mètode no permès' });

    try {
        const { action, email, code } = req.body || {};
        if (!email) return res.status(400).json({ error: 'Correu electrònic necessari' });

        const normalizedEmail = String(email).trim().toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(normalizedEmail)) {
            return res.status(400).json({ error: 'Format de correu electrònic invàlid' });
        }

        if (action === 'send') {
            const generatedCode = String(Math.floor(100000 + Math.random() * 900000));
            inMemoryCodes.set(normalizedEmail, {
                code: generatedCode,
                sentAt: Date.now(),
                expiresAt: Date.now() + 10 * 60 * 1000,
                attempts: 0,
                verified: false
            });

            console.log(`[Seguretat Aliat] Codi de verificació per a ${normalizedEmail}: ${generatedCode}`);

            return res.status(200).json({
                success: true,
                message: `S'ha generat el codi de seguretat de 6 dígits per a ${normalizedEmail}`,
                demoCode: generatedCode
            });
        }

        if (action === 'verify') {
            const isValid = verifyCodeForEmail(normalizedEmail, code, false);
            if (isValid) {
                return res.status(200).json({
                    success: true,
                    verified: true,
                    message: 'Correu electrònic verificat satisfactòriament!'
                });
            }

            return res.status(400).json({
                error: 'Codi de 6 dígits incorrecte o expirat. Genera un codi nou i torna a intentar-ho.'
            });
        }

        return res.status(400).json({ error: 'Acció de verificació no vàlida' });

    } catch (e) {
        return res.status(500).json({ error: 'Error en la verificació: ' + e.message });
    }
}

handler.verifyCodeForEmail = verifyCodeForEmail;
handler.inMemoryCodes = inMemoryCodes;
module.exports = handler;
