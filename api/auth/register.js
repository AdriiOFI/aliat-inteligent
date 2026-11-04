const { createClient } = require('@libsql/client/web');
const bcrypt = require('bcryptjs');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const { email, password } = req.body;
        
        const dbUrl = process.env.TURSO_DATABASE_URL;
        const dbToken = process.env.TURSO_AUTH_TOKEN;

        // 1. Comprobar que las variables existen en Vercel
        if (!dbUrl || !dbToken) {
            return res.status(500).json({ error: "Faltan las variables TURSO_DATABASE_URL o TURSO_AUTH_TOKEN en Vercel." });
        }

        // 2. Limpiar espacios en blanco accidentales
        const cleanUrl = dbUrl.trim();
        const cleanToken = dbToken.trim();

        if (!cleanUrl.includes('turso.io')) {
            return res.status(500).json({ error: `La URL de la base de datos es incorrecta. Debería terminar en turso.io. URL actual: ${cleanUrl.substring(0, 20)}...` });
        }

        const client = createClient({
            url: cleanUrl,
            authToken: cleanToken,
        });

        // 3. Prueba de conexión aislada para forzar el error real
        try {
            await client.execute('SELECT 1');
        } catch (connErr) {
            return res.status(500).json({ error: `Fallo de conexión a Turso: Comprueba que el Token es de la base de datos y no de la plataforma. Detalle: ${connErr.message}` });
        }

        const existingUser = await client.execute({
            sql: 'SELECT * FROM users WHERE email = ?',
            args: [email]
        });

        if (existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'Aquest usuari ja està registrat' });
        }

        const id = 'usr_' + Date.now();
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        await client.execute({
            sql: 'INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)',
            args: [id, email, password_hash]
        });

        return res.status(200).json({ success: true, message: 'Usuari registrat correctament' });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: `Error crítico: ${error.message} (Código: ${error.code || 'Desconocido'})` });
    }
}
