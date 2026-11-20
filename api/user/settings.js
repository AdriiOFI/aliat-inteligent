const { getDbClient, extractUserFromRequest } = require('../../lib/db');

function maskApiKey(rawKey) {
    const k = String(rawKey || '').trim();
    if (!k) return '';
    if (k.length <= 8) return '••••••••';
    return `${k.slice(0, 4)}••••••${k.slice(-4)}`;
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const user = extractUserFromRequest(req);
        if (!user || !user.id) return res.status(401).json({ error: 'No autoritzat' });

        const client = getDbClient();

        if (req.method === 'POST') {
            const {
                name,
                theme,
                lang,
                ai_provider,
                ai_api_key,
                ai_model,
                clear_ai_api_key,
                education_level,
                education_subcourse,
                course_onboarded,
                only_course_update
            } = req.body || {};

            const VALID_LEVELS = new Set(['primaria', 'eso', 'fp', 'batxillerat', 'universitat', 'altres']);
            const normalizedEduLevel = VALID_LEVELS.has(String(education_level || '').toLowerCase())
                ? String(education_level).toLowerCase()
                : '';
            const normalizedSubcourse = String(education_subcourse || '').trim().slice(0, 80);
            const normalizedOnboarded = (course_onboarded === true || course_onboarded === 1 || normalizedEduLevel !== '') ? 1 : 0;

            if (only_course_update === true) {
                await client.execute({
                    sql: 'UPDATE users SET education_level = ?, education_subcourse = ?, course_onboarded = ? WHERE id = ?',
                    args: [normalizedEduLevel, normalizedSubcourse, normalizedOnboarded, user.id]
                });
                return res.status(200).json({
                    success: true,
                    education_level: normalizedEduLevel,
                    education_subcourse: normalizedSubcourse,
                    course_onboarded: Boolean(normalizedOnboarded)
                });
            }

            const normalizedLang = lang === 'es' ? 'es' : 'ca';

            let existingRow = null;
            try {
                const existingRes = await client.execute({
                    sql: 'SELECT ai_api_key, education_level, education_subcourse, course_onboarded FROM users WHERE id = ?',
                    args: [user.id]
                });
                existingRow = (existingRes.rows && existingRes.rows[0]) || null;
            } catch (_) {
                existingRow = null;
            }

            let resolvedApiKey = String(ai_api_key || '').trim();
            if (clear_ai_api_key === true) {
                resolvedApiKey = '';
            } else if (!resolvedApiKey || resolvedApiKey.includes('••••')) {
                resolvedApiKey = existingRow && existingRow.ai_api_key
                    ? String(existingRow.ai_api_key).trim()
                    : '';
            }

            const finalEduLevel = normalizedEduLevel || String((existingRow && existingRow.education_level) || '');
            const finalSubcourse = (education_subcourse !== undefined)
                ? normalizedSubcourse
                : String((existingRow && existingRow.education_subcourse) || '');
            const finalOnboarded = (course_onboarded !== undefined || normalizedEduLevel !== '')
                ? normalizedOnboarded
                : (existingRow && existingRow.course_onboarded ? 1 : 0);

            try {
                await client.execute({
                    sql: 'UPDATE users SET name = ?, theme = ?, lang = ?, ai_provider = ?, ai_api_key = ?, ai_model = ?, education_level = ?, education_subcourse = ?, course_onboarded = ? WHERE id = ?',
                    args: [name || '', theme || 'light', normalizedLang, ai_provider || '', resolvedApiKey, ai_model || '', finalEduLevel, finalSubcourse, finalOnboarded, user.id]
                });
            } catch (updateErr) {
                try {
                    await client.execute({
                        sql: 'UPDATE users SET name = ?, theme = ?, lang = ?, ai_provider = ?, ai_api_key = ?, ai_model = ? WHERE id = ?',
                        args: [name || '', theme || 'light', normalizedLang, ai_provider || '', resolvedApiKey, ai_model || '', user.id]
                    });
                } catch (_) {
                    await client.execute({
                        sql: 'UPDATE users SET name = ?, theme = ? WHERE id = ?',
                        args: [name || '', theme || 'light', user.id]
                    });
                }
            }
            return res.status(200).json({
                success: true,
                lang: normalizedLang,
                education_level: finalEduLevel,
                education_subcourse: finalSubcourse,
                course_onboarded: Boolean(finalOnboarded),
                has_ai_api_key: Boolean(resolvedApiKey),
                ai_api_key_masked: maskApiKey(resolvedApiKey)
            });
        } else if (req.method === 'GET') {
            let result;
            try {
                result = await client.execute({
                    sql: 'SELECT name, theme, lang, ai_provider, ai_api_key, ai_model, education_level, education_subcourse, course_onboarded FROM users WHERE id = ?',
                    args: [user.id]
                });
            } catch (selectErr) {
                try {
                    result = await client.execute({
                        sql: 'SELECT name, theme, lang, ai_provider, ai_api_key, ai_model FROM users WHERE id = ?',
                        args: [user.id]
                    });
                } catch (_) {
                    result = await client.execute({
                        sql: 'SELECT name, theme FROM users WHERE id = ?',
                        args: [user.id]
                    });
                }
            }
            if (result.rows && result.rows.length > 0) {
                const u = result.rows[0];
                const rawKey = String(u.ai_api_key || '').trim();
                return res.status(200).json({
                    success: true,
                    name: u.name || '',
                    theme: u.theme || 'light',
                    lang: u.lang === 'es' ? 'es' : (u.lang === 'ca' ? 'ca' : ''),
                    ai_provider: u.ai_provider || '',
                    has_ai_api_key: Boolean(rawKey),
                    ai_api_key_masked: maskApiKey(rawKey),
                    ai_model: u.ai_model || '',
                    education_level: u.education_level || '',
                    education_subcourse: u.education_subcourse || '',
                    course_onboarded: Boolean(Number(u.course_onboarded) === 1 || u.course_onboarded === true || (u.education_level && String(u.education_level).trim() !== ''))
                });
            }
            return res.status(200).json({
                success: true,
                name: user.email ? user.email.split('@')[0] : '',
                theme: 'light',
                lang: '',
                ai_provider: '',
                has_ai_api_key: false,
                ai_api_key_masked: '',
                ai_model: '',
                education_level: '',
                education_subcourse: '',
                course_onboarded: false
            });
        }
    } catch (error) {
        console.error('User settings error:', error);
        return res.status(500).json({ error: 'No s\'ha pogut actualitzar la configuració de l\'usuari.' });
    }
};
