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

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

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
