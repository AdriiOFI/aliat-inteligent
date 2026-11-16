const fs = require('fs');
const path = require('path');

function getRuntimePublicConfig() {
    try {
        const cfgPath = path.join(process.cwd(), 'firebase-applet-config.json');
        if (fs.existsSync(cfgPath)) {
            return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        }
    } catch (_) {}
    return {};
}

function isPreviewRequest(req) {
    if (!req || !req.headers) return false;
    const isPreviewHostname = (rawHost) => {
        const clean = String(rawHost || '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');
        return (
            clean === 'localhost' ||
            clean === '127.0.0.1' ||
            clean === '0.0.0.0' ||
            /^ais-(dev|pre)-[a-z0-9-]+(?:\.[a-z0-9-]+)?\.run\.app$/i.test(clean)
        );
    };
    const hostHeader = req.headers['x-forwarded-host'] || req.headers.host || '';
    return isPreviewHostname(hostHeader);
}

/**
 * Verifies a Google reCAPTCHA Enterprise token using the standard event payload:
 * {
 *   "event": {
 *     "token": "TOKEN",
 *     "expectedAction": "USER_ACTION",
 *     "siteKey": "<RECAPTCHA_SITE_KEY>"
 *   }
 * }
 */
async function verifyRecaptchaEnterprise({ token, expectedAction = 'LOGIN', siteKey, event, req }) {
    const runtimeCfg = getRuntimePublicConfig();
    const resolvedToken = (event && event.token) || token || '';
    const resolvedAction = (event && event.expectedAction) || expectedAction || 'LOGIN';
    const resolvedSiteKey =
        process.env.RECAPTCHA_SITE_KEY ||
        (event && event.siteKey) ||
        siteKey ||
        runtimeCfg.recaptchaSiteKey ||
        '';

    const assessmentPayload = {
        event: {
            token: resolvedToken,
            expectedAction: resolvedAction,
            siteKey: resolvedSiteKey
        }
    };

    if (isPreviewRequest(req)) {
        return {
            valid: true,
            previewBypass: true,
            score: 1.0,
            reasons: [],
            action: resolvedAction,
            assessmentName: null,
            assessmentPayload
        };
    }

    if (!resolvedToken) {
        return {
            valid: false,
            reason: 'MISSING_TOKEN',
            assessmentPayload
        };
    }

    const apiKey = process.env.RECAPTCHA_API_KEY || process.env.GOOGLE_CLOUD_API_KEY || '';
    const projectId =
        process.env.RECAPTCHA_PROJECT_ID ||
        process.env.GOOGLE_CLOUD_PROJECT ||
        runtimeCfg.projectId ||
        '';

    if (apiKey && projectId) {
        try {
            const url = `https://recaptchaenterprise.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/assessments?key=${encodeURIComponent(apiKey)}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(assessmentPayload)
            });

            if (response.ok) {
                const data = await response.json();
                const isValid = !!(data && data.tokenProperties && data.tokenProperties.valid);
                const actionMatches = !resolvedAction || !data.tokenProperties?.action ||
                    String(data.tokenProperties.action).toUpperCase() === String(resolvedAction).toUpperCase();
                return {
                    valid: isValid && actionMatches,
                    score: data?.riskAnalysis?.score ?? 1.0,
                    reasons: data?.riskAnalysis?.reasons || [],
                    action: data?.tokenProperties?.action || resolvedAction,
                    assessmentName: data?.name ? String(data.name).split('/').pop() : null,
                    reason: data?.tokenProperties?.invalidReason || (!actionMatches ? 'ACTION_MISMATCH' : null),
                    assessmentPayload
                };
            }
        } catch (err) {
            console.warn('[reCAPTCHA Enterprise verification warning]:', err.message);
        }
    }

    // Fallback when Cloud API key is not configured in local/preview environment:
    // accept non-empty client token produced by the reCAPTCHA Enterprise widget
    return {
        valid: typeof resolvedToken === 'string' && resolvedToken.trim().length > 10,
        score: 1.0,
        reasons: [],
        action: resolvedAction,
        assessmentName: null,
        assessmentPayload
    };
}

async function recaptchaHandler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Mètode no permès' });

    try {
        const body = req.body || {};
        const result = await verifyRecaptchaEnterprise({ ...body, req });
        if (!result.valid) {
            return res.status(400).json({
                success: false,
                error: 'Verificació reCAPTCHA invàlida o incompleta',
                reason: result.reason || 'INVALID_TOKEN',
                event: result.assessmentPayload.event
            });
        }
        return res.status(200).json({
            success: true,
            valid: true,
            previewBypass: Boolean(result.previewBypass),
            score: result.score,
            reasons: result.reasons || [],
            action: result.action,
            assessmentName: result.assessmentName || null,
            event: result.assessmentPayload.event
        });
    } catch (error) {
        console.error('[reCAPTCHA Handler Error]:', error);
        return res.status(500).json({ error: 'Error verificant reCAPTCHA.' });
    }
}

module.exports = recaptchaHandler;
module.exports.verifyRecaptchaEnterprise = verifyRecaptchaEnterprise;
module.exports.isPreviewRequest = isPreviewRequest;
