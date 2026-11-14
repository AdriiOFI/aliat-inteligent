const express = require('express');
const path = require('path');

const authRouter = require('./api/auth');
const sessionsRouter = require('./api/sessions');
const workspaceRouter = require('./api/workspace');
const remindersRouter = require('./api/reminders');
const { processDueReminders } = require('./lib/reminders/service');
const generateHandler = require('./api/generate');
const userSettingsHandler = require('./api/user/settings');
const generateVideoHandler = require('./api/generate-video');
const generateImageHandler = require('./api/generate-image');
const analyzeMultimodalHandler = require('./api/analyze-multimodal');

const app = express();
app.disable('x-powered-by');
const PORT = 3000;
const HOST = '0.0.0.0';

// Middleware for parsing body with generous limits for uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 1. Hardened Security Headers Middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
    next();
});

// 2. Input Sanitization (Prototype Pollution & Null Byte Protection)
app.use((req, res, next) => {
    if (req.body && typeof req.body === 'object') {
        delete req.body.__proto__;
        delete req.body.constructor;
        delete req.body.prototype;
    }
    next();
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// API Routes
app.all('/api/auth/:action', (req, res) => authRouter(req, res));
app.all('/api/auth', (req, res) => authRouter(req, res));
app.all('/api/generate', (req, res) => generateHandler(req, res));
app.all('/api/sessions/:action', (req, res) => sessionsRouter(req, res));
app.all('/api/sessions', (req, res) => sessionsRouter(req, res));
app.all('/api/user/settings', (req, res) => userSettingsHandler(req, res));
app.all('/api/reminders/:action', (req, res) => remindersRouter(req, res));
app.all('/api/reminders', (req, res) => remindersRouter(req, res));

// Google Workspace 1P API Proxies
app.all('/api/workspace/:service', (req, res) => workspaceRouter(req, res));
app.all('/api/workspace', (req, res) => workspaceRouter(req, res));

// Advanced AI Capabilities (Video, Image aspect ratios, Multimodal analysis)
app.all('/api/generate-video', (req, res) => generateVideoHandler(req, res));
app.all('/api/generate-image', (req, res) => generateImageHandler(req, res));
app.all('/api/analyze-multimodal', (req, res) => analyzeMultimodalHandler(req, res));

const fs = require('fs');

// Explicit safe Firebase Web SDK config endpoint (public client identifiers only — never server secrets)
app.get('/firebase-applet-config.json', (req, res) => {
    try {
        const cfgPath = path.join(__dirname, 'firebase-applet-config.json');
        if (!fs.existsSync(cfgPath)) {
            return res.status(404).json({ error: 'Config not found' });
        }
        const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        const publicConfig = {
            projectId: raw.projectId || '',
            appId: raw.appId || '',
            apiKey: raw.apiKey || '',
            authDomain: raw.authDomain || '',
            storageBucket: raw.storageBucket || '',
            messagingSenderId: raw.messagingSenderId || '',
            measurementId: raw.measurementId || '',
            oAuthClientId: raw.oAuthClientId || '',
            recaptchaSiteKey: raw.recaptchaSiteKey || ''
        };
        if (raw.firestoreDatabaseId) {
            publicConfig.firestoreDatabaseId = raw.firestoreDatabaseId;
        }
        res.setHeader('Cache-Control', 'no-store');
        return res.json(publicConfig);
    } catch (_) {
        return res.status(500).json({ error: 'Unable to load public Firebase config' });
    }
});

// Explicitly serve main entry HTML, login route, privacy policy, and terms of use pages
app.get(['/', '/login'], (req, res) => {
    return res.sendFile(path.join(__dirname, 'index.html'));
});
app.get(['/privacidad.html', '/privacidad'], (req, res) => {
    const rootFile = path.join(__dirname, 'privacidad.html');
    if (fs.existsSync(rootFile)) return res.sendFile(rootFile);
    return res.sendFile(path.join(__dirname, 'public', 'privacidad.html'));
});
app.get(['/condiciones.html', '/condiciones', '/terminos.html', '/terminos'], (req, res) => {
    const rootFile = path.join(__dirname, 'condiciones.html');
    if (fs.existsSync(rootFile)) return res.sendFile(rootFile);
    return res.sendFile(path.join(__dirname, 'public', 'condiciones.html'));
});

// Static assets: ONLY serve the dedicated public directory (never expose root source/data files)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/public', express.static(path.join(__dirname, 'public')));

// Block direct HTTP access to internal source, database, key, and configuration files
app.use((req, res, next) => {
    const p = (req.path || '').toLowerCase();
    const blockedPrefixes = ['/data', '/lib', '/api/', '/.git', '/.env', '/.aistudio', '/app', '/node_modules'];
    const blockedExact = [
        '/server.js',
        '/package.json',
        '/bun.lock',
        '/vercel.json',
        '/firebase-blueprint.json',
        '/firestore.rules',
        '/security_spec.md',
        '/eslint.config.mjs',
        '/metadata.json',
        '/deep_check.js',
        '/find_onclick_vars.js'
    ];
    if (
        blockedPrefixes.some(prefix => {
            const clean = prefix.replace(/\/$/, '');
            return p === clean || p.startsWith(clean + '/');
        }) ||
        blockedExact.includes(p) ||
        /^\/temp_script_\d+\.js$/i.test(p) ||
        /\.(db|sqlite|sqlite3|log|bak|old|env)$/i.test(p)
    ) {
        return res.status(404).end();
    }
    return next();
});

// SPA fallback
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const server = app.listen(PORT, HOST, () => {
    console.log(`Aliat Intel·ligent server listening on http://${HOST}:${PORT}`);
});

// Periodic study reminder scheduler (every 30s)
const reminderInterval = setInterval(() => {
    processDueReminders().catch((err) => console.warn('[Reminders] Tick error:', err.message));
}, 30000);
setTimeout(() => {
    processDueReminders().catch(() => {});
}, 5000);

server.on('error', (err) => {
    console.error('Server error:', err);
});

process.on('SIGTERM', () => {
    clearInterval(reminderInterval);
    server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
    clearInterval(reminderInterval);
    server.close(() => process.exit(0));
});
