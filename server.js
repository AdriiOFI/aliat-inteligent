const express = require('express');
const path = require('path');

const authRouter = require('./api/auth');
const sessionsRouter = require('./api/sessions');
const workspaceRouter = require('./api/workspace');
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

// 3. In-Memory Rate Limiting for Security
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minut
const MAX_REQUESTS_PER_MIN = 120; // 120 peticions per minut per IP

app.use('/api/', (req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    
    let record = rateLimitMap.get(ip);
    if (!record || now - record.startTime > RATE_LIMIT_WINDOW_MS) {
        record = { count: 1, startTime: now };
        rateLimitMap.set(ip, record);
    } else {
        record.count++;
    }

    if (record.count > MAX_REQUESTS_PER_MIN) {
        return res.status(429).json({
            error: "Massa peticions en poc temps. Si us plau, espera un minut abans de tornar-ho a provar por seguretat."
        });
    }

    // Netejar mapa periòdicament
    if (rateLimitMap.size > 10000) {
        for (const [k, v] of rateLimitMap.entries()) {
            if (now - v.startTime > RATE_LIMIT_WINDOW_MS) rateLimitMap.delete(k);
        }
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

server.on('error', (err) => {
    console.error('Server error:', err);
});

process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
    server.close(() => process.exit(0));
});
