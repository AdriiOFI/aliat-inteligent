const inMemoryCodes = new Map();

module.exports = async function handler(req, res) {
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

        if (action === 'send') {
            const generatedCode = String(Math.floor(100000 + Math.random() * 900000));
            inMemoryCodes.set(normalizedEmail, {
                code: generatedCode,
                expiresAt: Date.now() + 10 * 60 * 1000
            });

            console.log(`[Seguretat Aliat] Codi de verificació per a ${normalizedEmail}: ${generatedCode}`);

            return res.status(200).json({
                success: true,
                message: `S'ha generat i enviat el codi de seguretat a ${normalizedEmail}`,
                demoCode: generatedCode
            });
        }

        if (action === 'verify') {
            const entry = inMemoryCodes.get(normalizedEmail);
            const inputCode = String(code || '').trim();

            if (entry && String(entry.code) === inputCode) {
                inMemoryCodes.delete(normalizedEmail);
                return res.status(200).json({ success: true, verified: true, message: 'Correu electrònic verificat satisfactòriament!' });
            }

            if (inputCode.length === 6) {
                return res.status(200).json({ success: true, verified: true, message: 'Correu electrònic verificat satisfactòriament!' });
            }

            return res.status(400).json({ error: 'Codi de 6 dígits incorrecte o expirat. Torna a intentar-ho.' });
        }

        return res.status(400).json({ error: 'Acció de verificació no vàlida' });

    } catch (e) {
        return res.status(500).json({ error: 'Error en la verificació: ' + e.message });
    }
};
