const crypto = require('crypto');
const { getDbClient, extractUserFromRequest } = require('../lib/db');
const {
    getVapidKeys,
    getEmailTransportStatus,
    formatFrequencyLabel,
    sendReminderEmail,
    sendWebPushToUser
} = require('../lib/reminders/service');

function parseAction(req) {
    if (req.params && req.params.action) return req.params.action;
    if (req.query && req.query.action) return String(req.query.action);
    const urlPath = (req.url || '').split('?')[0];
    const parts = urlPath.split('/').filter(Boolean);
    const last = parts[parts.length - 1];
    return (last && last !== 'reminders') ? last : 'list';
}

function getUserIdentifiers(user) {
    const ids = new Set([String(user.id)]);
    if (user.email) {
        ids.add(`usr_${Buffer.from(user.email).toString('base64').replace(/[^a-zA-Z0-9]/g, '')}`);
    }
    return Array.from(ids);
}

module.exports = async function remindersHandler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const action = parseAction(req);

    // Public config endpoint for VAPID public key + email transport capabilities
    if (action === 'config' && req.method === 'GET') {
        const vapid = getVapidKeys();
        const emailStatus = getEmailTransportStatus();
        return res.status(200).json({
            success: true,
            vapidPublicKey: vapid.publicKey,
            emailConfigured: emailStatus.configured,
            emailProvider: emailStatus.provider,
            emailLabel: emailStatus.label,
            serverTime: new Date().toISOString()
        });
    }

    const user = extractUserFromRequest(req);
    if (!user || !user.id) {
        return res.status(401).json({ error: 'Inicia sessió per gestionar els recordatoris d\'estudi.' });
    }

    const client = getDbClient();
    const userIds = getUserIdentifiers(user);

    try {
        if (action === 'list' && req.method === 'GET') {
            const remindersRows = [];
            const seen = new Set();
            for (const uid of userIds) {
                const rRes = await client.execute({
                    sql: 'SELECT * FROM study_reminders WHERE user_id = ?',
                    args: [uid]
                });
                for (const row of (rRes.rows || [])) {
                    if (row && row.id && !seen.has(row.id)) {
                        seen.add(row.id);
                        let days = [];
                        try { days = JSON.parse(row.days_json || '[]'); } catch (_) {}
                        remindersRows.push({
                            ...row,
                            days,
                            push_enabled: Number(row.push_enabled) === 1,
                            email_enabled: Number(row.email_enabled) === 1,
                            enabled: Number(row.enabled) === 1
                        });
                    }
                }
            }

            let pushCount = 0;
            for (const uid of userIds) {
                const pRes = await client.execute({
                    sql: 'SELECT * FROM push_subscriptions WHERE user_id = ?',
                    args: [uid]
                });
                pushCount += (pRes.rows || []).length;
            }

            remindersRows.sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());
            const emailStatus = getEmailTransportStatus();
            const vapid = getVapidKeys();

            return res.status(200).json({
                success: true,
                reminders: remindersRows,
                pushDevicesCount: pushCount,
                vapidPublicKey: vapid.publicKey,
                emailConfigured: emailStatus.configured,
                emailProvider: emailStatus.provider,
                emailLabel: emailStatus.label
            });
        }

        if (action === 'save' && req.method === 'POST') {
            const body = req.body || {};
            const id = body.id ? String(body.id) : ('rem_' + crypto.randomBytes(6).toString('hex'));
            const title = String(body.title || "Sessió d'Estudi").trim().slice(0, 120);
            const notes = String(body.notes || '').trim().slice(0, 400);
            const email = String(body.email || user.email || '').trim().toLowerCase();
            const frequency = ['daily', 'weekdays', 'custom', 'interval'].includes(body.frequency)
                ? body.frequency
                : 'daily';
            const daysArr = Array.isArray(body.days) ? body.days.map(Number).filter(n => n >= 0 && n <= 6) : [];
            const timeHHMM = /^\d{2}:\d{2}$/.test(String(body.time || '')) ? String(body.time) : '18:00';
            const intervalMinutes = Math.max(0, Number(body.interval_minutes || 0));
            const tzOffsetMinutes = Number.isFinite(Number(body.tz_offset_minutes)) ? Number(body.tz_offset_minutes) : 0;
            const pushEnabled = body.push_enabled !== false ? 1 : 0;
            const emailEnabled = body.email_enabled !== false ? 1 : 0;
            const enabled = body.enabled !== false ? 1 : 0;
            const nowIso = new Date().toISOString();

            await client.execute({
                sql: `INSERT INTO study_reminders (
                    id, user_id, user_email, title, notes, frequency, days_json,
                    time_hhmm, interval_minutes, tz_offset_minutes,
                    push_enabled, email_enabled, enabled,
                    last_sent_slot, last_sent_at, last_status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    user_email = excluded.user_email,
                    title = excluded.title,
                    notes = excluded.notes,
                    frequency = excluded.frequency,
                    days_json = excluded.days_json,
                    time_hhmm = excluded.time_hhmm,
                    interval_minutes = excluded.interval_minutes,
                    tz_offset_minutes = excluded.tz_offset_minutes,
                    push_enabled = excluded.push_enabled,
                    email_enabled = excluded.email_enabled,
                    enabled = excluded.enabled,
                    updated_at = excluded.updated_at`,
                args: [
                    id, String(user.id), email, title, notes, frequency, JSON.stringify(daysArr),
                    timeHHMM, intervalMinutes, tzOffsetMinutes,
                    pushEnabled, emailEnabled, enabled,
                    '', '', '', nowIso, nowIso
                ]
            });

            return res.status(200).json({
                success: true,
                reminder: {
                    id,
                    user_id: String(user.id),
                    user_email: email,
                    title,
                    notes,
                    frequency,
                    days: daysArr,
                    time_hhmm: timeHHMM,
                    interval_minutes: intervalMinutes,
                    tz_offset_minutes: tzOffsetMinutes,
                    push_enabled: pushEnabled === 1,
                    email_enabled: emailEnabled === 1,
                    enabled: enabled === 1,
                    updated_at: nowIso
                }
            });
        }

        if (action === 'toggle' && req.method === 'POST') {
            const { id, enabled } = req.body || {};
            if (!id) return res.status(400).json({ error: 'ID del recordatori obligatori.' });
            const existingRes = await client.execute({
                sql: 'SELECT * FROM study_reminders WHERE id = ?',
                args: [String(id)]
            });
            const row = existingRes.rows && existingRes.rows[0];
            if (!row || !userIds.includes(String(row.user_id))) {
                return res.status(404).json({ error: 'Recordatori no trobat.' });
            }
            const nextVal = enabled !== undefined ? (enabled ? 1 : 0) : (Number(row.enabled) === 1 ? 0 : 1);
            await client.execute({
                sql: 'UPDATE study_reminders SET enabled = ?, updated_at = ? WHERE id = ?',
                args: [nextVal, new Date().toISOString(), String(id)]
            });
            return res.status(200).json({ success: true, enabled: nextVal === 1 });
        }

        if (action === 'delete' && (req.method === 'POST' || req.method === 'DELETE')) {
            const id = (req.body && req.body.id) || (req.query && req.query.id);
            if (!id) return res.status(400).json({ error: 'ID del recordatori obligatori.' });
            const existingRes = await client.execute({
                sql: 'SELECT * FROM study_reminders WHERE id = ?',
                args: [String(id)]
            });
            const row = existingRes.rows && existingRes.rows[0];
            if (!row || !userIds.includes(String(row.user_id))) {
                return res.status(404).json({ error: 'Recordatori no trobat.' });
            }
            await client.execute({
                sql: 'DELETE FROM study_reminders WHERE id = ?',
                args: [String(id)]
            });
            return res.status(200).json({ success: true });
        }

        if (action === 'subscribe-push' && req.method === 'POST') {
            const { subscription } = req.body || {};
            if (!subscription || !subscription.endpoint) {
                return res.status(400).json({ error: 'Subscripció Web Push invàlida.' });
            }
            const nowIso = new Date().toISOString();
            const subId = 'push_' + crypto.createHash('sha1').update(String(subscription.endpoint)).digest('hex').slice(0, 12);
            const ua = String(req.headers['user-agent'] || '').slice(0, 200);
            await client.execute({
                sql: `INSERT INTO push_subscriptions (
                    id, user_id, endpoint, subscription_json, user_agent, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(endpoint) DO UPDATE SET
                    user_id = excluded.user_id,
                    subscription_json = excluded.subscription_json,
                    user_agent = excluded.user_agent,
                    updated_at = excluded.updated_at`,
                args: [subId, String(user.id), String(subscription.endpoint), JSON.stringify(subscription), ua, nowIso, nowIso]
            });
            return res.status(200).json({ success: true, message: 'Dispositiu registrat per a notificacions Push!' });
        }

        if (action === 'unsubscribe-push' && req.method === 'POST') {
            const { endpoint } = req.body || {};
            if (!endpoint) return res.status(400).json({ error: 'Endpoint requerit.' });
            await client.execute({
                sql: 'DELETE FROM push_subscriptions WHERE endpoint = ?',
                args: [String(endpoint)]
            });
            return res.status(200).json({ success: true });
        }

        if (action === 'test' && req.method === 'POST') {
            const {
                id,
                title = "Sessió d'Estudi de Prova",
                notes = "Prova de notificació push i correu electrònic d'Aliat Intel·ligent.",
                email,
                push_enabled = true,
                email_enabled = true,
                gmailAccessToken = '',
                originUrl = '/'
            } = req.body || {};

            let reminderData = {
                title,
                notes,
                user_email: email || user.email || '',
                frequency: 'daily',
                time_hhmm: '',
                push_enabled: push_enabled ? 1 : 0,
                email_enabled: email_enabled ? 1 : 0
            };

            if (id) {
                const existingRes = await client.execute({
                    sql: 'SELECT * FROM study_reminders WHERE id = ?',
                    args: [String(id)]
                });
                if (existingRes.rows && existingRes.rows[0] && userIds.includes(String(existingRes.rows[0].user_id))) {
                    reminderData = existingRes.rows[0];
                }
            }

            const freqLabel = formatFrequencyLabel(reminderData);
            let pushResult = { total: 0, sent: 0, failed: 0 };
            let emailResult = { sent: false, provider: 'skipped' };

            if (Number(reminderData.push_enabled) === 1 || push_enabled) {
                // Collect push results across all matching userIds
                for (const uid of userIds) {
                    const stats = await sendWebPushToUser(uid, {
                        title: `📚 ${reminderData.title || "Prova d'Estudi"}`,
                        body: reminderData.notes || "És hora d'estudiar! Toca per obrir Aliat.",
                        url: originUrl || '/',
                        tag: `aliat-test-${Date.now()}`
                    });
                    pushResult.total += stats.total;
                    pushResult.sent += stats.sent;
                    pushResult.failed += stats.failed;
                }
            }

            if ((Number(reminderData.email_enabled) === 1 || email_enabled) && reminderData.user_email) {
                emailResult = await sendReminderEmail({
                    to: reminderData.user_email,
                    title: reminderData.title,
                    notes: reminderData.notes,
                    frequencyLabel: freqLabel,
                    timeLabel: reminderData.time_hhmm || '',
                    appUrl: originUrl && originUrl.startsWith('http') ? originUrl : undefined,
                    gmailAccessToken
                });
            }

            return res.status(200).json({
                success: true,
                push: pushResult,
                email: emailResult
            });
        }

        return res.status(404).json({ error: `Acció no reconeguda: ${action}` });
    } catch (err) {
        console.error('[Reminders API Error]:', err);
        return res.status(500).json({ error: err.message || 'Error intern de recordatoris' });
    }
};
