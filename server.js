const express = require('express');
const path = require('path');

const loginHandler = require('./api/auth/login');
const registerHandler = require('./api/auth/register');
const googleHandler = require('./api/auth/google');
const verifyHandler = require('./api/auth/verify');
const generateHandler = require('./api/generate');
const sessionsGetHandler = require('./api/sessions/get');
const sessionsSaveHandler = require('./api/sessions/save');
const sessionsDeleteHandler = require('./api/sessions/delete');
const userSettingsHandler = require('./api/user/settings');

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

// Middleware for parsing body with generous limits for uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// API Routes
app.all('/api/auth/login', (req, res) => loginHandler(req, res));
app.all('/api/auth/register', (req, res) => registerHandler(req, res));
app.all('/api/auth/google', (req, res) => googleHandler(req, res));
app.all('/api/auth/verify', (req, res) => verifyHandler(req, res));
app.all('/api/generate', (req, res) => generateHandler(req, res));
app.all('/api/sessions/get', (req, res) => sessionsGetHandler(req, res));
app.all('/api/sessions/save', (req, res) => sessionsSaveHandler(req, res));
app.all('/api/sessions/delete', (req, res) => sessionsDeleteHandler(req, res));
app.all('/api/user/settings', (req, res) => userSettingsHandler(req, res));

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
