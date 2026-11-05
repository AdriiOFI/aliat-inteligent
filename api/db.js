const { createClient } = require('@libsql/client/web');

// In-memory store for fallback when TURSO credentials are not configured or unreachable
const memoryStore = {
    users: new Map(),       // email -> { id, email, password_hash, name, theme }
    usersById: new Map(),   // id -> user
    sessions: new Map()     // id -> session
};

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
            const [id, rawEmail, password_hash] = args;
            const email = (rawEmail || '').trim().toLowerCase();
            const newUser = { id, email, password_hash, name: '', theme: 'light', ai_provider: '', ai_api_key: '', ai_model: '' };
            memoryStore.users.set(email, newUser);
            memoryStore.usersById.set(id, newUser);
            return { rowsAffected: 1 };
        }

        // 5. Update user
        if (sql.includes('UPDATE users SET')) {
            const user = memoryStore.usersById.get(args[args.length - 1]);
            if (user) {
                if (args.length >= 6) {
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
            return { rowsAffected: 1 };
        }

        // 8. Delete session
        if (sql.includes('DELETE FROM sessions WHERE id = ? AND user_id = ?')) {
            const [id, userId] = args;
            const session = memoryStore.sessions.get(id);
            if (session && session.user_id === userId) {
                memoryStore.sessions.delete(id);
                return { rowsAffected: 1 };
            }
            return { rowsAffected: 0 };
        }

        return { rows: [] };
    }
};

function getDbClient() {
    const dbUrl = (process.env.TURSO_DATABASE_URL || '').trim();
    const dbToken = (process.env.TURSO_AUTH_TOKEN || '').trim();

    if (dbUrl && dbToken && dbUrl.includes('turso.io')) {
        try {
            const realClient = createClient({
                url: dbUrl,
                authToken: dbToken
            });
            return {
                execute: async (query) => {
                    try {
                        return await realClient.execute(query);
                    } catch (err) {
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

    // In-memory fallback
    return mockClient;
}

const JWT_SECRET = process.env.JWT_SECRET || 'aliat-intelligent-secret-key-ai-studio-2026';

module.exports = {
    getDbClient,
    JWT_SECRET,
    mockClient
};
