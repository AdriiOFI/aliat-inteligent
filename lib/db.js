const { createClient } = require('@libsql/client/web');

const fs = require('fs');
const path = require('path');
const STORE_FILE = path.join(__dirname, '../data/local_db_store.json');

// In-memory store with disk persistence fallback when TURSO credentials are not configured
const memoryStore = {
    users: new Map(),             // email -> { id, email, password_hash, name, theme }
    usersById: new Map(),         // id -> user
    sessions: new Map(),          // id -> session
    shares: new Map(),            // id -> shared snapshot
    reminders: new Map(),         // id -> study reminder
    pushSubscriptions: new Map()  // endpoint -> push subscription record
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
            if (data.reminders && Array.isArray(data.reminders)) {
                for (const r of data.reminders) {
                    if (r && r.id) memoryStore.reminders.set(r.id, r);
                }
            }
            if (data.pushSubscriptions && Array.isArray(data.pushSubscriptions)) {
                for (const sub of data.pushSubscriptions) {
                    if (sub && sub.endpoint) memoryStore.pushSubscriptions.set(sub.endpoint, sub);
                }
            }
            console.log(`[Aliat DB] Loaded ${memoryStore.sessions.size} sessions, ${memoryStore.reminders.size} reminders, ${memoryStore.pushSubscriptions.size} push subs and ${memoryStore.users.size} users from disk.`);
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
        const reminders = Array.from(memoryStore.reminders.values());
        const pushSubscriptions = Array.from(memoryStore.pushSubscriptions.values());
        const data = { users, sessions, shares, reminders, pushSubscriptions, saved_at: new Date().toISOString() };
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
            const allowedUsers = new Set(args.filter(Boolean).map(String));
            const userSessions = [];
            for (const session of memoryStore.sessions.values()) {
                if (allowedUsers.has(String(session.user_id))) {
                    userSessions.push(session);
                }
            }
            // Sort by updated_at descending
            userSessions.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
            return { rows: userSessions };
        }

        // 7. Insert or update session
        if (sql.includes('INSERT INTO sessions')) {
            const [id, user_id, mode, title, chat_history, calendar, games, html, context, pdf_text, updatedAtArg] = args;
            const existing = memoryStore.sessions.get(id);
            const updated_at = (typeof updatedAtArg === 'string' && updatedAtArg.trim())
                ? updatedAtArg.trim()
                : new Date().toISOString();
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
                updated_at
            };
            memoryStore.sessions.set(id, session);
            saveStoreToDisk();
            return { rowsAffected: 1 };
        }

        // 8. Delete session
        if (sql.includes('DELETE FROM sessions WHERE id = ?')) {
            const id = args[0];
            const allowedUsers = args.slice(1).filter(Boolean).map(String);
            const session = memoryStore.sessions.get(id);
            if (session && (allowedUsers.length === 0 || allowedUsers.includes(String(session.user_id)))) {
                memoryStore.sessions.delete(id);
                saveStoreToDisk();
                return { rowsAffected: 1 };
            }
            return { rowsAffected: 0 };
        }

        // 9. Study Reminders CRUD
        if (sql.includes('FROM study_reminders WHERE user_id = ?')) {
            const allowedUsers = new Set(args.filter(Boolean).map(String));
            const rows = [];
            for (const r of memoryStore.reminders.values()) {
                if (allowedUsers.has(String(r.user_id))) rows.push(r);
            }
            rows.sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
            return { rows };
        }

        if (sql.includes('FROM study_reminders WHERE enabled = 1')) {
            const rows = Array.from(memoryStore.reminders.values()).filter(r => Number(r.enabled) === 1);
            return { rows };
        }

        if (sql.includes('FROM study_reminders WHERE id = ?')) {
            const r = memoryStore.reminders.get(args[0]);
            return { rows: r ? [r] : [] };
        }

        if (sql.includes('INSERT INTO study_reminders')) {
            const [
                id, user_id, user_email, title, notes, frequency, days_json,
                time_hhmm, interval_minutes, tz_offset_minutes,
                push_enabled, email_enabled, enabled,
                last_sent_slot, last_sent_at, last_status, created_at, updated_at
            ] = args;
            const existing = memoryStore.reminders.get(id);
            const rec = {
                id,
                user_id: String(user_id),
                user_email: String(user_email || ''),
                title: String(title || 'Sessió d\'Estudi'),
                notes: String(notes || ''),
                frequency: String(frequency || 'daily'),
                days_json: String(days_json || '[]'),
                time_hhmm: String(time_hhmm || '18:00'),
                interval_minutes: Number(interval_minutes || 0),
                tz_offset_minutes: Number(tz_offset_minutes || 0),
                push_enabled: Number(push_enabled) ? 1 : 0,
                email_enabled: Number(email_enabled) ? 1 : 0,
                enabled: Number(enabled) ? 1 : 0,
                last_sent_slot: last_sent_slot !== undefined ? String(last_sent_slot || '') : (existing?.last_sent_slot || ''),
                last_sent_at: last_sent_at !== undefined ? String(last_sent_at || '') : (existing?.last_sent_at || ''),
                last_status: last_status !== undefined ? String(last_status || '') : (existing?.last_status || ''),
                created_at: (existing && existing.created_at) || created_at || new Date().toISOString(),
                updated_at: updated_at || new Date().toISOString()
            };
            memoryStore.reminders.set(id, rec);
            saveStoreToDisk();
            return { rowsAffected: 1 };
        }

        if (sql.includes('UPDATE study_reminders SET enabled = ?')) {
            const [enabled, updated_at, id] = args;
            const r = memoryStore.reminders.get(id);
            if (r) {
                r.enabled = Number(enabled) ? 1 : 0;
                r.updated_at = updated_at || new Date().toISOString();
                saveStoreToDisk();
                return { rowsAffected: 1 };
            }
            return { rowsAffected: 0 };
        }

        if (sql.includes('UPDATE study_reminders SET last_sent_slot = ?')) {
            const [last_sent_slot, last_sent_at, last_status, updated_at, id] = args;
            const r = memoryStore.reminders.get(id);
            if (r) {
                r.last_sent_slot = String(last_sent_slot || '');
                r.last_sent_at = String(last_sent_at || '');
                r.last_status = String(last_status || '');
                r.updated_at = updated_at || new Date().toISOString();
                saveStoreToDisk();
                return { rowsAffected: 1 };
            }
            return { rowsAffected: 0 };
        }

        if (sql.includes('DELETE FROM study_reminders WHERE id = ?')) {
            const id = args[0];
            const deleted = memoryStore.reminders.delete(id);
            if (deleted) saveStoreToDisk();
            return { rowsAffected: deleted ? 1 : 0 };
        }

        // 10. Push Subscriptions CRUD
        if (sql.includes('FROM push_subscriptions WHERE user_id = ?')) {
            const allowedUsers = new Set(args.filter(Boolean).map(String));
            const rows = [];
            for (const sub of memoryStore.pushSubscriptions.values()) {
                if (allowedUsers.has(String(sub.user_id))) rows.push(sub);
            }
            return { rows };
        }

        if (sql.includes('INSERT INTO push_subscriptions')) {
            const [id, user_id, endpoint, subscription_json, user_agent, created_at, updated_at] = args;
            const rec = {
                id,
                user_id: String(user_id),
                endpoint: String(endpoint),
                subscription_json: String(subscription_json),
                user_agent: String(user_agent || ''),
                created_at: created_at || new Date().toISOString(),
                updated_at: updated_at || new Date().toISOString()
            };
            memoryStore.pushSubscriptions.set(String(endpoint), rec);
            saveStoreToDisk();
            return { rowsAffected: 1 };
        }

        if (sql.includes('DELETE FROM push_subscriptions WHERE endpoint = ?')) {
            const endpoint = String(args[0] || '');
            const deleted = memoryStore.pushSubscriptions.delete(endpoint);
            if (deleted) saveStoreToDisk();
            return { rowsAffected: deleted ? 1 : 0 };
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
        await client.execute(`
            CREATE TABLE IF NOT EXISTS study_reminders (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                user_email TEXT DEFAULT '',
                title TEXT,
                notes TEXT DEFAULT '',
                frequency TEXT DEFAULT 'daily',
                days_json TEXT DEFAULT '[]',
                time_hhmm TEXT DEFAULT '18:00',
                interval_minutes INTEGER DEFAULT 0,
                tz_offset_minutes INTEGER DEFAULT 0,
                push_enabled INTEGER DEFAULT 1,
                email_enabled INTEGER DEFAULT 1,
                enabled INTEGER DEFAULT 1,
                last_sent_slot TEXT DEFAULT '',
                last_sent_at TEXT DEFAULT '',
                last_status TEXT DEFAULT '',
                created_at TEXT,
                updated_at TEXT
            )
        `);
        await client.execute(`
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                endpoint TEXT UNIQUE,
                subscription_json TEXT,
                user_agent TEXT DEFAULT '',
                created_at TEXT,
                updated_at TEXT
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
                        // When Turso succeeds on SELECT sessions, trust Turso as authoritative and sync local mirror
                        if (sqlStr.includes('FROM sessions WHERE user_id = ?')) {
                            const queryArgs = typeof query === 'object' && Array.isArray(query.args) ? query.args : [];
                            const allowedUsers = new Set(queryArgs.filter(Boolean).map(String));
                            for (const [sid, s] of memoryStore.sessions.entries()) {
                                if (allowedUsers.has(String(s.user_id))) {
                                    memoryStore.sessions.delete(sid);
                                }
                            }
                            for (const r of (remoteRes.rows || [])) {
                                if (r && r.id) memoryStore.sessions.set(r.id, r);
                            }
                            saveStoreToDisk();
                            return remoteRes;
                        }
                        if (/^\s*DELETE\s+FROM\s+sessions\s+WHERE\s+id\s*=/i.test(sqlStr)) {
                            const queryArgs = typeof query === 'object' && Array.isArray(query.args) ? query.args : [];
                            if (queryArgs[0] && memoryStore.sessions.has(queryArgs[0])) {
                                memoryStore.sessions.delete(queryArgs[0]);
                                saveStoreToDisk();
                            }
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
