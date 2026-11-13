const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const nodemailer = require('nodemailer');
const { getDbClient } = require('../db');

const VAPID_FILE = path.join(__dirname, '../../data/vapid_keys.json');
let cachedVapidKeys = null;
let schedulerRunning = false;

function getVapidKeys() {
    if (cachedVapidKeys) return cachedVapidKeys;

    const envPub = (process.env.VAPID_PUBLIC_KEY || '').trim();
    const envPriv = (process.env.VAPID_PRIVATE_KEY || '').trim();
    const subject = (process.env.VAPID_SUBJECT || 'mailto:suport@aliat-intelligent.app').trim();

    if (envPub && envPriv) {
        cachedVapidKeys = { publicKey: envPub, privateKey: envPriv, subject };
        try {
            webpush.setVapidDetails(subject, envPub, envPriv);
        } catch (err) {
            console.warn('[Reminders] Error setting env VAPID keys:', err.message);
        }
        return cachedVapidKeys;
    }

    try {
        if (fs.existsSync(VAPID_FILE)) {
            const raw = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
            if (raw && raw.publicKey && raw.privateKey) {
                cachedVapidKeys = { publicKey: raw.publicKey, privateKey: raw.privateKey, subject };
                webpush.setVapidDetails(subject, raw.publicKey, raw.privateKey);
                return cachedVapidKeys;
            }
        }
    } catch (err) {
        console.warn('[Reminders] Error reading VAPID keys file:', err.message);
    }

    // Generate persistent VAPID keys once
    const generated = webpush.generateVAPIDKeys();
    cachedVapidKeys = { publicKey: generated.publicKey, privateKey: generated.privateKey, subject };
    try {
        const dir = path.dirname(VAPID_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(VAPID_FILE, JSON.stringify({
            publicKey: generated.publicKey,
            privateKey: generated.privateKey,
            created_at: new Date().toISOString()
        }, null, 2), 'utf8');
    } catch (err) {
        console.warn('[Reminders] Could not save VAPID keys to disk:', err.message);
    }
    webpush.setVapidDetails(subject, generated.publicKey, generated.privateKey);
    return cachedVapidKeys;
}

function getEmailTransportStatus() {
    const resendKey = (process.env.RESEND_API_KEY || '').trim();
    const smtpHost = (process.env.SMTP_HOST || '').trim();
    const smtpUser = (process.env.SMTP_USER || '').trim();
    const smtpPass = (process.env.SMTP_PASS || '').trim();

    if (resendKey) {
        return {
            configured: true,
            provider: 'resend',
            label: 'Resend API configurat al servidor'
        };
    }
    if (smtpUser && smtpPass && (smtpHost || smtpUser.toLowerCase().endsWith('@gmail.com'))) {
        return {
            configured: true,
            provider: 'smtp',
            label: smtpHost ? `SMTP (${smtpHost})` : 'SMTP (Gmail)'
        };
    }
    return {
        configured: false,
        provider: 'none',
        label: 'Requereix SMTP/Resend al servidor o compte Gmail vinculat'
    };
}

function buildReminderEmailHtml({ title, notes, frequencyLabel, timeLabel, appUrl }) {
    const safeTitle = escapeHtmlServer(title || "Sessió d'Estudi");
    const safeNotes = escapeHtmlServer(notes || '');
    const safeFreq = escapeHtmlServer(frequencyLabel || 'Periòdic');
    const safeTime = escapeHtmlServer(timeLabel || '');
    const targetUrl = escapeHtmlServer(appUrl || 'https://aliat-intelligent.app');

    return `
<!DOCTYPE html>
<html lang="ca">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#18181b;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #e4e4e7;box-shadow:0 8px 24px rgba(0,0,0,0.06);">
    <div style="background:linear-gradient(135deg,#dc2626,#e11d48);padding:24px 28px;color:#ffffff;">
      <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9;">Aliat Intel·ligent · Recordatori d'Estudi</div>
      <h1 style="margin:8px 0 0;font-size:22px;line-height:1.3;font-weight:800;">📚 ${safeTitle}</h1>
    </div>
    <div style="padding:24px 28px;">
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3f3f46;">
        És l'hora programada per a la teva sessió d'estudi. Prepara els apunts, evita distraccions i comença un bloc de focus!
      </p>
      <div style="background:#fafafa;border:1px solid #e4e4e7;border-radius:14px;padding:14px 16px;margin-bottom:18px;">
        <div style="font-size:12px;color:#71717a;margin-bottom:4px;">Freqüència programada</div>
        <div style="font-size:14px;font-weight:700;color:#18181b;">🗓️ ${safeFreq}${safeTime ? ' · ⏰ ' + safeTime : ''}</div>
        ${safeNotes ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid #e4e4e7;font-size:13px;color:#52525b;">📝 ${safeNotes}</div>` : ''}
      </div>
      <a href="${targetUrl}" style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:12px;">
        Obrir Aliat i Començar →
      </a>
    </div>
    <div style="padding:14px 28px;background:#fafafa;border-top:1px solid #e4e4e7;font-size:11px;color:#71717a;">
      Aquest correu s'ha enviat automàticament perquè tens activats els recordatoris periòdics d'estudi a Aliat Intel·ligent.
    </div>
  </div>
</body>
</html>`.trim();
}

function escapeHtmlServer(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatFrequencyLabel(reminder) {
    const freq = reminder.frequency || 'daily';
    if (freq === 'daily') return 'Cada dia';
    if (freq === 'weekdays') return 'De dilluns a divendres';
    if (freq === 'interval') {
        const mins = Number(reminder.interval_minutes || 120);
        if (mins >= 60 && mins % 60 === 0) return `Cada ${mins / 60} h`;
        return `Cada ${mins} min`;
    }
    if (freq === 'custom') {
        const dayNames = ['Dg', 'Dl', 'Dm', 'Dc', 'Dj', 'Dv', 'Ds'];
        let days = [];
        try { days = JSON.parse(reminder.days_json || '[]'); } catch (_) {}
        if (Array.isArray(days) && days.length > 0) {
            return 'Dies: ' + days.map(d => dayNames[Number(d)] || '').filter(Boolean).join(', ');
        }
        return 'Dies personalitzats';
    }
    if (freq === 'once') {
        let days = [];
        try { days = JSON.parse(reminder.days_json || '[]'); } catch (_) {}
        if (Array.isArray(days) && days[0]) {
            return `Dia ${days[0]}`;
        }
        return 'Recordatori puntual';
    }
    return 'Periòdic';
}

async function sendViaGmailOAuth(accessToken, { to, subject, text, html }) {
    const boundary = 'aliat_boundary_' + Date.now();
    const mimeLines = [
        `To: ${to.trim()}`,
        `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        '',
        text,
        '',
        `--${boundary}`,
        'Content-Type: text/html; charset=UTF-8',
        '',
        html,
        '',
        `--${boundary}--`
    ];
    const raw = Buffer.from(mimeLines.join('\r\n'))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

    const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ raw })
    });
    if (!resp.ok) {
        const details = await resp.text();
        throw new Error(`Gmail API (${resp.status}): ${details.slice(0, 200)}`);
    }
    return await resp.json();
}

async function sendReminderEmail({ to, title, notes, frequencyLabel, timeLabel, appUrl, gmailAccessToken }) {
    if (!to || !String(to).includes('@')) {
        return { sent: false, provider: 'none', error: 'Adreça de correu no vàlida.' };
    }

    const cleanTo = String(to).trim();
    const subject = `📚 Recordatori d'estudi: ${title || "Sessió programada"}`;
    const text = `Recordatori d'estudi — Aliat Intel·ligent\n\nTema: ${title}\nFreqüència: ${frequencyLabel}${timeLabel ? ' · ' + timeLabel : ''}${notes ? '\nNotes: ' + notes : ''}\n\nEntra a l'app per començar la sessió!`;
    const html = buildReminderEmailHtml({ title, notes, frequencyLabel, timeLabel, appUrl });

    const resendKey = (process.env.RESEND_API_KEY || '').trim();
    const smtpHost = (process.env.SMTP_HOST || '').trim();
    const smtpPort = Number(process.env.SMTP_PORT || 587);
    const smtpSecure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || smtpPort === 465;
    const smtpUser = (process.env.SMTP_USER || '').trim();
    const smtpPass = (process.env.SMTP_PASS || '').trim();
    const smtpFrom = (process.env.SMTP_FROM || smtpUser || 'onboarding@resend.dev').trim();

    // 1. Try Resend if configured
    if (resendKey) {
        try {
            const res = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${resendKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    from: smtpFrom.includes('@') ? smtpFrom : 'Aliat Intel·ligent <onboarding@resend.dev>',
                    to: [cleanTo],
                    subject,
                    html,
                    text
                })
            });
            if (res.ok) {
                return { sent: true, provider: 'resend' };
            }
            const errTxt = await res.text();
            console.warn('[Reminders] Resend error:', errTxt);
        } catch (err) {
            console.warn('[Reminders] Resend exception:', err.message);
        }
    }

    // 2. Try Nodemailer SMTP if configured
    if (smtpUser && smtpPass && (smtpHost || smtpUser.toLowerCase().endsWith('@gmail.com'))) {
        try {
            const transportConfig = smtpHost
                ? {
                    host: smtpHost,
                    port: smtpPort,
                    secure: smtpSecure,
                    auth: { user: smtpUser, pass: smtpPass }
                }
                : {
                    service: 'gmail',
                    auth: { user: smtpUser, pass: smtpPass }
                };
            const transporter = nodemailer.createTransport(transportConfig);
            await transporter.sendMail({
                from: `"Aliat Intel·ligent" <${smtpFrom || smtpUser}>`,
                to: cleanTo,
                subject,
                text,
                html
            });
            return { sent: true, provider: 'smtp' };
        } catch (err) {
            console.warn('[Reminders] SMTP send error:', err.message);
            return { sent: false, provider: 'smtp', error: err.message };
        }
    }

    // 3. Fallback: User's connected Google Workspace Gmail OAuth token (if available)
    if (gmailAccessToken) {
        try {
            await sendViaGmailOAuth(gmailAccessToken, { to: cleanTo, subject, text, html });
            return { sent: true, provider: 'gmail_oauth' };
        } catch (err) {
            return { sent: false, provider: 'gmail_oauth', error: err.message };
        }
    }

    return {
        sent: false,
        provider: 'none',
        error: 'Correu no enviat: no hi ha credencials SMTP/Resend configurades al servidor ni token Gmail vinculat.'
    };
}

async function sendWebPushToUser(userId, payload) {
    getVapidKeys();
    const client = getDbClient();
    let subs = [];
    try {
        const res = await client.execute({
            sql: 'SELECT * FROM push_subscriptions WHERE user_id = ?',
            args: [String(userId)]
        });
        subs = res.rows || [];
    } catch (err) {
        console.warn('[Reminders] Error querying push_subscriptions:', err.message);
        return { total: 0, sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;
    const jsonPayload = JSON.stringify({
        title: payload.title || "📚 Recordatori d'Estudi — Aliat",
        body: payload.body || "És hora d'estudiar!",
        url: payload.url || '/',
        tag: payload.tag || `aliat-reminder-${Date.now()}`,
        reminderId: payload.reminderId || null
    });

    for (const row of subs) {
        try {
            const subObj = typeof row.subscription_json === 'string'
                ? JSON.parse(row.subscription_json)
                : row.subscription_json;
            if (!subObj || !subObj.endpoint) continue;
            await webpush.sendNotification(subObj, jsonPayload);
            sent++;
        } catch (err) {
            failed++;
            const statusCode = err && err.statusCode;
            if (statusCode === 404 || statusCode === 410) {
                try {
                    await client.execute({
                        sql: 'DELETE FROM push_subscriptions WHERE endpoint = ?',
                        args: [row.endpoint]
                    });
                } catch (_) {}
            } else {
                console.warn('[Reminders] Web Push failed for endpoint:', err.message);
            }
        }
    }

    return { total: subs.length, sent, failed };
}

function getLocalDateParts(nowUtcMs, tzOffsetMinutes) {
    // JS getTimezoneOffset() returns UTC - local in minutes (e.g. -60 for UTC+1, -120 for UTC+2)
    const offsetMs = Number(tzOffsetMinutes || 0) * 60 * 1000;
    const localDate = new Date(nowUtcMs - offsetMs);
    const yyyy = localDate.getUTCFullYear();
    const mm = String(localDate.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(localDate.getUTCDate()).padStart(2, '0');
    const hh = String(localDate.getUTCHours()).padStart(2, '0');
    const min = String(localDate.getUTCMinutes()).padStart(2, '0');
    return {
        dateStr: `${yyyy}-${mm}-${dd}`,
        hhmm: `${hh}:${min}`,
        dayOfWeek: localDate.getUTCDay() // 0 = Sun, 1 = Mon, ..., 6 = Sat
    };
}

function computeDueSlot(reminder, nowUtcMs) {
    if (!reminder || Number(reminder.enabled) !== 1) return null;
    const freq = reminder.frequency || 'daily';
    const tzOffset = Number(reminder.tz_offset_minutes || 0);
    const local = getLocalDateParts(nowUtcMs, tzOffset);
    const slotPrefix = `${local.dateStr} ${local.hhmm}`;

    if (freq === 'interval') {
        const intervalMins = Math.max(15, Number(reminder.interval_minutes || 120));
        const lastMs = reminder.last_sent_at ? new Date(reminder.last_sent_at).getTime() : 0;
        if (!lastMs) {
            const createdMs = reminder.created_at ? new Date(reminder.created_at).getTime() : nowUtcMs;
            if (nowUtcMs - createdMs >= intervalMins * 60 * 1000) {
                return `interval:${slotPrefix}`;
            }
            return null;
        }
        if (nowUtcMs - lastMs >= intervalMins * 60 * 1000) {
            return `interval:${slotPrefix}`;
        }
        return null;
    }

    const targetHHMM = String(reminder.time_hhmm || '18:00').trim();
    if (local.hhmm !== targetHHMM) return null;

    if (freq === 'daily') {
        return slotPrefix;
    }
    if (freq === 'weekdays') {
        return (local.dayOfWeek >= 1 && local.dayOfWeek <= 5) ? slotPrefix : null;
    }
    if (freq === 'custom') {
        let days = [];
        try { days = JSON.parse(reminder.days_json || '[]'); } catch (_) {}
        const allowed = new Set((Array.isArray(days) ? days : []).map(Number));
        return allowed.has(local.dayOfWeek) ? slotPrefix : null;
    }
    if (freq === 'once') {
        let days = [];
        try { days = JSON.parse(reminder.days_json || '[]'); } catch (_) {}
        const targetDate = Array.isArray(days) && days[0] ? String(days[0]).trim() : '';
        return (targetDate && local.dateStr === targetDate) ? slotPrefix : null;
    }
    return null;
}

async function processDueReminders() {
    if (schedulerRunning) return;
    schedulerRunning = true;
    try {
        const client = getDbClient();
        const res = await client.execute({
            sql: 'SELECT * FROM study_reminders WHERE enabled = 1',
            args: []
        });
        const reminders = res.rows || [];
        if (reminders.length === 0) return;

        const nowMs = Date.now();
        for (const r of reminders) {
            const dueSlot = computeDueSlot(r, nowMs);
            if (!dueSlot || r.last_sent_slot === dueSlot) continue;

            const freqLabel = formatFrequencyLabel(r);
            const pushBody = r.notes
                ? `${r.title} — ${r.notes}`
                : `Sessió programada (${freqLabel}). Toca per obrir Aliat i estudiar!`;

            let pushStats = { total: 0, sent: 0, failed: 0 };
            let emailRes = { sent: false, provider: 'skipped' };

            if (Number(r.push_enabled) === 1) {
                pushStats = await sendWebPushToUser(r.user_id, {
                    title: `📚 ${r.title || "Recordatori d'Estudi"}`,
                    body: pushBody,
                    url: '/',
                    tag: `aliat-reminder-${r.id}`,
                    reminderId: r.id
                });
            }

            if (Number(r.email_enabled) === 1 && r.user_email) {
                emailRes = await sendReminderEmail({
                    to: r.user_email,
                    title: r.title,
                    notes: r.notes,
                    frequencyLabel: freqLabel,
                    timeLabel: r.frequency === 'interval' ? '' : r.time_hhmm
                });
            }

            const statusParts = [];
            if (Number(r.push_enabled) === 1) {
                statusParts.push(`Push: ${pushStats.sent}/${pushStats.total}`);
            }
            if (Number(r.email_enabled) === 1) {
                statusParts.push(emailRes.sent ? `Correu: OK (${emailRes.provider})` : `Correu: ${emailRes.error || 'sense config'}`);
            }

            const nowIso = new Date(nowMs).toISOString();
            await client.execute({
                sql: 'UPDATE study_reminders SET last_sent_slot = ?, last_sent_at = ?, last_status = ?, updated_at = ? WHERE id = ?',
                args: [dueSlot, nowIso, statusParts.join(' · '), nowIso, r.id]
            });
            if (r.frequency === 'once') {
                await client.execute({
                    sql: 'UPDATE study_reminders SET enabled = ?, updated_at = ? WHERE id = ?',
                    args: [0, nowIso, r.id]
                });
            }
        }
    } catch (err) {
        console.warn('[Reminders Scheduler] Error:', err.message);
    } finally {
        schedulerRunning = false;
    }
}

module.exports = {
    getVapidKeys,
    getEmailTransportStatus,
    formatFrequencyLabel,
    sendReminderEmail,
    sendWebPushToUser,
    processDueReminders
};
