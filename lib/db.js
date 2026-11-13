const { createClient } = require('@libsql/client/web');

const fs = require('fs');
const path = require('path');
const STORE_FILE = path.join(__dirname, '../data/local_db_store.json');

// In-memory store with disk persistence fallback when TURSO credentials are not configured
const memoryStore = {
    users: new Map(),       // email -> { id, email, password_hash, name, theme }
    usersById: new Map(),   // id -> user
    sessions: new Map(),    // id -> session
    shares: new Map()       // id -> shared snapshot
};

function loadStoreFromDisk() {
    try {
        const dir = path.dirname(STORE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        if (fs.existsSync(STORE_FILE)) {
            const raw = fs.readFileSync(STORE_FILE, 'utf8');
            const data = JSON.parse(raw);
            if (data.users && Array.isArray(data.users)) {
                for (const u of data.users) {
                    if (u && u.email) memoryStore.users.set(u.email, u);
                    if (u && u.id) memoryStore.usersById.set(u.id, u);
                }
            }
            if (data.sessions && Array.isArray(data.sessions)) {
                for (const s of data.sessions) {
                    if (s && s.id) memoryStore.sessions.set(s.id, s);
                }
            }
            if (data.shares && Array.isArray(data.shares)) {
                for (const sh of data.shares) {
                    if (sh && sh.id) memoryStore.shares.set(sh.id, sh);
                }
            }
            console.log(`[Aliat DB] Loaded ${memoryStore.sessions.size} sessions, ${memoryStore.shares.size} shares and ${memoryStore.users.size} users from disk.`);
        }
    } catch (e) {
        console.error('[Aliat DB] Error loading store from disk:', e.message);
    }
}

function saveStoreToDisk() {
    try {
        const dir = path.dirname(STORE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const users = Array.from(memoryStore.usersById.values());
        const sessions = Array.from(memoryStore.sessions.values());
        const shares = Array.from(memoryStore.shares.values());
        const data = { users, sessions, shares, saved_at: new Date().toISOString() };
        fs.writeFileSync(STORE_FILE, JSON.stringify(data), 'utf8');
    } catch (e) {
        console.error('[Aliat DB] Error saving store to disk:', e.message);
    }
}

// Initialize from disk
loadStoreFromDisk();

const mockClient = {
    execute: async (query) => {
        const sql = typeof query === 'string' ? query : query.sql;
        const args = typeof query === 'object' && query.args ? query.args : [];

        // 1. Ping / Test
        if (sql.includes('SELECT 1')) {
            return { rows: [{ 1: 1 }] };
        }

        // 2. Select user by email
        if (sql.includes('FROM users WHERE email = ?')) {
            const email = (args[0] || '').trim().toLowerCase();
            const user = memoryStore.users.get(email);
            return { rows: user ? [user] : [] };
        }

        // 3. Select user name, theme and AI settings by id
        if (sql.includes('FROM users WHERE id = ?')) {
            const id = args[0];
            const user = memoryStore.usersById.get(id);
            if (!user) return { rows: [] };
            return {
                rows: [{
                    name: user.name || '',
                    theme: user.theme || 'light',
                    ai_provider: user.ai_provider || '',
                    ai_api_key: user.ai_api_key || '',
                    ai_model: user.ai_model || ''
                }]
            };
        }

        // 4. Insert user
        if (sql.includes('INSERT INTO users')) {
            const [id, rawEmail, password_hash, nameArg, photoArg] = args;
            const email = (rawEmail || '').trim().toLowerCase();
            const newUser = {
                id,
                email,
                password_hash: password_hash || '',
                name: nameArg || '',
                photo_url: photoArg || '',
                theme: 'light',
                ai_provider: '',
                ai_api_key: '',
                ai_model: ''
            };
            memoryStore.users.set(email, newUser);
            memoryStore.usersById.set(id, newUser);
            saveStoreToDisk();
            return { rowsAffected: 1 };
        }

        // 5. Update user
        if (sql.includes('UPDATE users SET')) {
            const user = memoryStore.usersById.get(args[args.length - 1]);
            if (user) {
                if (sql.includes('password_hash = ?') && sql.includes('photo_url = ?')) {
                    const [name, photo_url, password_hash] = args;
                    if (name) user.name = name;
                    if (photo_url !== undefined) user.photo_url = photo_url;
                    if (password_hash) user.password_hash = password_hash;
                } else if (sql.includes('photo_url = ?')) {
                    const [name, photo_url] = args;
                    if (name) user.name = name;
                    if (photo_url !== undefined) user.photo_url = photo_url;
                } else if (args.length >= 6) {
                    const [name, theme, ai_provider, ai_api_key, ai_model] = args;
                    user.name = name;
                    user.theme = theme;
                    user.ai_provider = ai_provider;
                    user.ai_api_key = ai_api_key;
                    user.ai_model = ai_model;
                } else if (args.length >= 3) {
                    const [name, theme] = args;
                    user.name = name;
                    user.theme = theme;
                }
                saveStoreToDisk();
            }
            return { rowsAffected: user ? 1 : 0 };
        }

        // 6. Select sessions for user
        if (sql.includes('FROM sessions WHERE user_id = ?')) {
            const userId = args[0];
            const userSessions = [];
            for (const session of memoryStore.sessions.values()) {
                if (session.user_id === userId) {
                    userSessions.push(session);
                }
            }
            // Sort by updated_at descending
            userSessions.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
            return { rows: userSessions };
        }

        // 7. Insert or update session
        if (sql.includes('INSERT INTO sessions')) {
            const [id, user_id, mode, title, chat_history, calendar, games, html, context, pdf_text] = args;
            const existing = memoryStore.sessions.get(id);
            const session = {
                id,
                user_id,
                mode: mode || (existing ? existing.mode : 'free'),
                title: title || (existing ? existing.title : 'Nova Conversa'),
                chat_history,
                calendar,
                games,
                html: html || '',
                context: context || '',
                pdf_text: pdf_text || '',
                updated_at: new Date().toISOString()
            };
            memoryStore.sessions.set(id, session);
            saveStoreToDisk();
            return { rowsAffected: 1 };
        }

        // 8. Delete session
        if (sql.includes('DELETE FROM sessions WHERE id = ? AND user_id = ?')) {
            const [id, userId] = args;
            const session = memoryStore.sessions.get(id);
            if (session && session.user_id === userId) {
                memoryStore.sessions.delete(id);
                saveStoreToDisk();
                return { rowsAffected: 1 };
            }
            return { rowsAffected: 0 };
        }

        return { rows: [] };
    }
};

let cachedRealClient = null;
let migrationStarted = false;

async function ensureSchema(client) {
    if (migrationStarted) return;
    migrationStarted = true;
    try {
        await client.execute(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE,
                password_hash TEXT,
                name TEXT DEFAULT '',
                theme TEXT DEFAULT 'light',
                ai_provider TEXT DEFAULT '',
                ai_api_key TEXT DEFAULT '',
                ai_model TEXT DEFAULT '',
                created_at TEXT DEFAULT (datetime('now'))
            )
        `);
        await client.execute(`
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                mode TEXT DEFAULT 'free',
                title TEXT DEFAULT 'Nova Conversa',
                chat_history TEXT,
                calendar TEXT,
                games TEXT,
                html TEXT DEFAULT '',
                context TEXT DEFAULT '',
                pdf_text TEXT DEFAULT '',
                updated_at TEXT DEFAULT (datetime('now'))
            )
        `);
        const userCols = ['ai_provider', 'ai_api_key', 'ai_model', 'photo_url'];
        for (const col of userCols) {
            try {
                await client.execute(`ALTER TABLE users ADD COLUMN ${col} TEXT DEFAULT ''`);
            } catch (ignore) {}
        }
    } catch (e) {
        console.warn('[Aliat Intel·ligent] Schema migration notice:', e.message);
    }
}

function getDbClient() {
    const dbUrl = (process.env.TURSO_DATABASE_URL || '').trim();
    const dbToken = (process.env.TURSO_AUTH_TOKEN || '').trim();

    if (dbUrl && dbToken && (dbUrl.includes('turso.io') || dbUrl.startsWith('libsql://'))) {
        try {
            if (!cachedRealClient) {
                cachedRealClient = createClient({
                    url: dbUrl,
                    authToken: dbToken
                });
                ensureSchema(cachedRealClient).catch(() => {});
            }

            return {
                execute: async (query) => {
                    const sqlStr = typeof query === 'string' ? query : (query.sql || '');
                    // Always mirror mutations to local disk store so nothing is ever lost
                    if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sqlStr)) {
                        try { await mockClient.execute(query); } catch (_) {}
                    }
                    try {
                        const remoteRes = await cachedRealClient.execute(query);
                        if (sqlStr.includes('FROM sessions WHERE user_id = ?')) {
                            const localRes = await mockClient.execute(query);
                            const mergedMap = new Map();
                            for (const r of (remoteRes.rows || [])) {
                                if (r && r.id) mergedMap.set(r.id, r);
                            }
                            for (const l of (localRes.rows || [])) {
                                if (l && l.id && !mergedMap.has(l.id)) mergedMap.set(l.id, l);
                            }
                            return { rows: Array.from(mergedMap.values()) };
                        }
                        return remoteRes;
                    } catch (err) {
                        // Si falta alguna columna, intentem la migració i reintentem la consulta
                        if (err.message && err.message.includes('no such column')) {
                            try {
                                await ensureSchema(cachedRealClient);
                                return await cachedRealClient.execute(query);
                            } catch (retryErr) {
                                console.warn('[Aliat Intel·ligent] Remote database retry failed, falling back to mock memory store:', retryErr.message);
                                return await mockClient.execute(query);
                            }
                        }
                        console.warn('[Aliat Intel·ligent] Remote database query failed, falling back to mock memory store:', err.message);
                        return await mockClient.execute(query);
                    }
                }
            };
        } catch (err) {
            console.warn('[Aliat Intel·ligent] Failed to create Turso client, using in-memory mock store:', err.message);
            return mockClient;
        }
    }

    return mockClient;
}

const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'aliat-intelligent-secret-key-ai-studio-2026';

function extractUserFromRequest(req) {
    const authHeader = req.headers && req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const rawToken = authHeader.split(' ')[1];
        if (rawToken && rawToken !== 'null' && rawToken !== 'undefined') {
            let decoded = null;
            try {
                decoded = jwt.verify(rawToken, JWT_SECRET);
            } catch (verifyErr) {
                try {
                    const fallbackDecoded = jwt.decode(rawToken);
                    if (fallbackDecoded && (fallbackDecoded.id || fallbackDecoded.userId || fallbackDecoded.sub || fallbackDecoded.email)) {
                        decoded = fallbackDecoded;
                    }
                } catch (_) {}
            }
            if (decoded && (decoded.id || decoded.userId || decoded.sub || decoded.email)) {
                const rawEmail = decoded.email ? String(decoded.email).trim().toLowerCase() : '';
                const existingByEmail = rawEmail ? memoryStore.users.get(rawEmail) : null;
                const tokenUserId = decoded.id || decoded.userId || decoded.sub;
                const userId = String(
                    (existingByEmail && existingByEmail.id) ||
                    tokenUserId ||
                    `usr_${Buffer.from(rawEmail || 'anon').toString('base64').replace(/[^a-zA-Z0-9]/g, '')}`
                );
                const email = rawEmail || `${userId}@aliat.local`;
                if (!memoryStore.usersById.has(userId)) {
                    const hydratedUser = {
                        id: userId,
                        email,
                        password_hash: 'hydrated',
                        name: decoded.name || email.split('@')[0],
                        photo_url: '',
                        theme: 'light',
                        ai_provider: '',
                        ai_api_key: '',
                        ai_model: ''
                    };
                    memoryStore.usersById.set(userId, hydratedUser);
                    memoryStore.users.set(email, hydratedUser);
                    saveStoreToDisk();
                }
                return { id: userId, email };
            }
        }
    }
    const fallbackUserId = (req.body && req.body.user_id) || (req.query && req.query.user_id);
    if (fallbackUserId) {
        return { id: String(fallbackUserId), email: `${fallbackUserId}@aliat.local` };
    }
    return null;
}

module.exports = {
    getDbClient,
    JWT_SECRET,
    extractUserFromRequest,
    mockClient,
    memoryStore,
    saveStoreToDisk
};
