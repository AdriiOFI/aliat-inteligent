const { getDbClient, extractUserFromRequest, JWT_SECRET } = require('../db');

function setCors(res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-ai-provider, x-ai-key, x-ai-model, x-app-lang');
}

function getBody(req) {
    if (!req || req.body === undefined || req.body === null) return {};
    if (typeof req.body === 'string') {
        try { return JSON.parse(req.body); } catch (_) { return {}; }
    }
    return typeof req.body === 'object' ? req.body : {};
}

function resolveGoogleMapsApiKey() {
    const candidates = [
        process.env.VITE_GOOGLE_MAPS_API_KEY,
        process.env.GOOGLE_MAPS_API_KEY,
        process.env.GOOGLE_MAPS_PLATFORM_KEY,
        process.env.MAPS_API_KEY,
        process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    ];
    for (const raw of candidates) {
        const clean = String(raw || '').trim();
        if (clean.length >= 20 && !/^your_|^my_|^todo/i.test(clean)) {
            return clean;
        }
    }
    return '';
}

function isPlaceholderSecretKey(k) {
    if (!k || typeof k !== 'string') return true;
    const clean = k.trim();
    if (clean.length < 10) return true;
    if (clean === 'MY_GEMINI_API_KEY' || clean === 'YOUR_API_KEY') return true;
    if (/^(TODO|YOUR_|MY_)/i.test(clean) || clean.includes('EXAMPLE') || clean.includes('INSERT_KEY')) return true;
    return false;
}

async function resolveMapsAiCredentials(req) {
    const body = getBody(req);
    const headers = req.headers || {};
    let userPreferredProvider = String((body.ai_provider || body.aiProvider || headers['x-ai-provider'] || '')).trim().toLowerCase();
    let userCustomKey = String((body.ai_api_key || body.customApiKey || headers['x-ai-key'] || '')).trim();
    let userCustomModel = String((body.ai_model || body.customModel || headers['x-ai-model'] || '')).trim();
    let userPreferredLang = String((body.lang || headers['x-app-lang'] || '')).trim().toLowerCase();

    try {
        const authHeader = headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const jwt = require('jsonwebtoken');
            const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
            const client = getDbClient();
            const uRes = await client.execute({
                sql: 'SELECT ai_provider, ai_api_key, ai_model, lang FROM users WHERE id = ?',
                args: [decoded.id]
            });
            if (uRes.rows && uRes.rows[0]) {
                const saved = uRes.rows[0];
                if (!userPreferredProvider && saved.ai_provider) userPreferredProvider = String(saved.ai_provider).trim().toLowerCase();
                if (!userCustomKey && saved.ai_api_key) userCustomKey = String(saved.ai_api_key).trim();
                if (!userCustomModel && saved.ai_model) userCustomModel = String(saved.ai_model).trim();
                if (!userPreferredLang && saved.lang) userPreferredLang = String(saved.lang).trim().toLowerCase();
            }
        }
    } catch (_) {}

    let geminiApiKey = (!isPlaceholderSecretKey(process.env.GEMINI_API_KEY) ? process.env.GEMINI_API_KEY : '') ||
                       (!isPlaceholderSecretKey(process.env.API_KEY) ? process.env.API_KEY : '') || '';
    let groqApiKey = !isPlaceholderSecretKey(process.env.GROQ_API_KEY) ? process.env.GROQ_API_KEY : '';
    let openRouterApiKey = !isPlaceholderSecretKey(process.env.OPENROUTER_API_KEY) ? process.env.OPENROUTER_API_KEY : '';
    let openAiApiKey = !isPlaceholderSecretKey(process.env.OPENAI_API_KEY) ? process.env.OPENAI_API_KEY : '';
    let deepseekApiKey = !isPlaceholderSecretKey(process.env.DEEPSEEK_API_KEY) ? process.env.DEEPSEEK_API_KEY : '';
    let mistralApiKey = !isPlaceholderSecretKey(process.env.MISTRAL_API_KEY) ? process.env.MISTRAL_API_KEY : '';

    if (userCustomKey && !isPlaceholderSecretKey(userCustomKey)) {
        const prov = userPreferredProvider || 'gemini';
        if (prov === 'groq') groqApiKey = userCustomKey;
        else if (prov === 'openrouter') openRouterApiKey = userCustomKey;
        else if (prov === 'openai') openAiApiKey = userCustomKey;
        else if (prov === 'deepseek') deepseekApiKey = userCustomKey;
        else if (prov === 'mistral') mistralApiKey = userCustomKey;
        else geminiApiKey = userCustomKey;
    }

    return {
        userPreferredProvider,
        userCustomModel,
        userPreferredLang,
        geminiApiKey,
        groqApiKey,
        openRouterApiKey,
        openAiApiKey,
        deepseekApiKey,
        mistralApiKey
    };
}

async function runMapsLLM({ req, systemPrompt, userPrompt, jsonMode = false }) {
    const creds = await resolveMapsAiCredentials(req);
    const runners = [];

    if (creds.geminiApiKey) {
        const m = (creds.userPreferredProvider === 'gemini' && creds.userCustomModel) ? creds.userCustomModel : 'gemini-2.5-flash';
        runners.push({ type: 'gemini', key: creds.geminiApiKey, model: m });
    }
    if (creds.userPreferredProvider === 'groq' && creds.groqApiKey) {
        runners.push({ type: 'groq', key: creds.groqApiKey, model: creds.userCustomModel || 'openai/gpt-oss-120b' });
    } else if (creds.userPreferredProvider === 'openrouter' && creds.openRouterApiKey) {
        runners.push({ type: 'openrouter', key: creds.openRouterApiKey, model: creds.userCustomModel || 'meta-llama/llama-3.3-70b-instruct' });
    } else if (creds.userPreferredProvider === 'openai' && creds.openAiApiKey) {
        runners.push({ type: 'openai', key: creds.openAiApiKey, model: creds.userCustomModel || 'gpt-4o-mini' });
    } else if (creds.userPreferredProvider === 'deepseek' && creds.deepseekApiKey) {
        runners.push({ type: 'deepseek', key: creds.deepseekApiKey, model: creds.userCustomModel || 'deepseek-chat' });
    } else if (creds.userPreferredProvider === 'mistral' && creds.mistralApiKey) {
        runners.push({ type: 'mistral', key: creds.mistralApiKey, model: creds.userCustomModel || 'mistral-small-latest' });
    }

    if (creds.groqApiKey && creds.userPreferredProvider !== 'groq') {
        runners.push({ type: 'groq', key: creds.groqApiKey, model: 'openai/gpt-oss-120b' });
    }
    if (creds.openAiApiKey && creds.userPreferredProvider !== 'openai') {
        runners.push({ type: 'openai', key: creds.openAiApiKey, model: 'gpt-4o-mini' });
    }
    if (creds.openRouterApiKey && creds.userPreferredProvider !== 'openrouter') {
        runners.push({ type: 'openrouter', key: creds.openRouterApiKey, model: 'meta-llama/llama-3.3-70b-instruct' });
    }
    runners.push({ type: 'pollinations', model: 'openai' });

    const callOpenAICompat = async (endpoint, key, model) => {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), 9000);
        try {
            const messages = [];
            if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
            messages.push({ role: 'user', content: jsonMode ? `${userPrompt}\n\nRespond ONLY with valid JSON.` : userPrompt });
            const payload = { model, messages, temperature: jsonMode ? 0.1 : 0.6 };
            if (jsonMode) payload.response_format = { type: 'json_object' };
            const headers = { 'Content-Type': 'application/json' };
            if (key) headers['Authorization'] = `Bearer ${key}`;
            const r = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json();
            const txt = data?.choices?.[0]?.message?.content || '';
            if (!txt) throw new Error('Empty reply');
            return { text: txt, engine: model };
        } finally {
            clearTimeout(tid);
        }
    };

    for (const runner of runners) {
        try {
            if (runner.type === 'gemini') {
                const { GoogleGenAI } = require('@google/genai');
                const ai = new GoogleGenAI({
                    apiKey: runner.key,
                    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
                });
                const aiRes = await ai.models.generateContent({
                    model: runner.model,
                    contents: systemPrompt ? `${systemPrompt}\n\n${userPrompt}` : userPrompt,
                    config: jsonMode ? { responseMimeType: 'application/json', temperature: 0.1 } : { temperature: 0.6 }
                });
                const txt = String(aiRes?.text || '').trim();
                if (txt) return { text: txt, engine: 'gemini' };
            } else if (runner.type === 'groq') {
                return await callOpenAICompat('https://api.groq.com/openai/v1/chat/completions', runner.key, runner.model);
            } else if (runner.type === 'openrouter') {
                return await callOpenAICompat('https://openrouter.ai/api/v1/chat/completions', runner.key, runner.model);
            } else if (runner.type === 'openai') {
                return await callOpenAICompat('https://api.openai.com/v1/chat/completions', runner.key, runner.model);
            } else if (runner.type === 'deepseek') {
                return await callOpenAICompat('https://api.deepseek.com/chat/completions', runner.key, runner.model);
            } else if (runner.type === 'mistral') {
                return await callOpenAICompat('https://api.mistral.ai/v1/chat/completions', runner.key, runner.model);
            } else if (runner.type === 'pollinations') {
                const controller = new AbortController();
                const tid = setTimeout(() => controller.abort(), 7000);
                try {
                    const messages = [];
                    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
                    messages.push({ role: 'user', content: jsonMode ? `${userPrompt}\n\nRespond ONLY with valid JSON.` : userPrompt });
                    const r = await fetch('https://text.pollinations.ai/openai', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ model: 'openai', messages, temperature: jsonMode ? 0.1 : 0.6, jsonMode: !!jsonMode }),
                        signal: controller.signal
                    });
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    const raw = await r.text();
                    let reply = raw;
                    try {
                        const p = JSON.parse(raw);
                        if (p?.choices?.[0]?.message?.content) reply = p.choices[0].message.content;
                    } catch (_) {}
                    reply = String(reply || '').replace(/\n*---\s*\*\*Support Pollinations[\s\S]*$/i, '').trim();
                    if (reply) return { text: reply, engine: 'pollinations' };
                } finally {
                    clearTimeout(tid);
                }
            }
        } catch (_) {}
    }
    return null;
}

function deterministicParseCommuteQuestion(question, savedPlaces = [], clientNowIso = '', hasActiveContext = false) {
    const q = String(question || '').trim();
    const low = q.toLowerCase();

    const spanishHits = (low.match(/\b(puedo|salir|coger|llegar|antes|mañana|alg[uú]n|autobus|autob[uú]s|para|hacia|desde|donde|d[oó]nde|c[oó]mo|tengo|instituto|trabajo|qu[eé]|hacer|aqu[ií]|sitios|planes|caf[eé]|comer|cenar|cerca|vivo|pon|guarda|ruta|parada|bajar|camino|caminar)\b/g) || []).length;
    const catalanHits = (low.match(/\b(puc|sortir|agafar|arribar|abans|dem[aà]|algun|cap|per|fins|des de|on|com|tinc|institut|feina|mica|qu[eè]|fer|aqu[ií]|llocs|plans|menjar|sopar|prop|visc|posa|desa|guarda|ruta|parada|baixar|camino|caminar)\b/g) || []).length;
    const detectedLang = spanishHits > catalanHits ? 'es' : (catalanHits > 0 ? 'ca' : 'ca');

    let intent = 'transit';

    const setHomeMatch = q.match(/(?:mi\s+casa\s+(?:est[aá]\s+en|es|queda\s+en)|casa\s+meva\s+(?:[eé]s\s+a|est[aà]\s+a)|pon(?:er)?\s+(?:mi\s+)?casa\s+(?:en|a)|posa(?:r)?\s+(?:la\s+meva\s+)?casa\s+(?:a|en)|guarda(?:r)?\s+(?:mi\s+)?casa\s+(?:en|a)|desa(?:r)?\s+(?:la\s+meva\s+)?casa\s+(?:a|en)|vivo\s+en|visc\s+a)\s+(.+)/i);
    const setSchoolMatch = q.match(/(?:mi\s+(?:insti|instituto|colegio|universidad|uni)\s+(?:est[aá]\s+en|es)|(?:el\s+meu\s+)?(?:insti|institut|universitat)\s+(?:[eé]s\s+a|est[aà]\s+a)|pon(?:er)?\s+(?:mi\s+)?(?:insti|instituto)\s+(?:en|a)|posa(?:r)?\s+(?:el\s+meu\s+)?(?:insti|institut)\s+(?:a|en))\s+(.+)/i);
    let setPlaceRole = null;
    let setPlaceQuery = '';
    if (setHomeMatch && setHomeMatch[1]) {
        intent = 'set_place';
        setPlaceRole = 'home';
        setPlaceQuery = setHomeMatch[1].replace(/[?.!]+$/, '').trim();
    } else if (setSchoolMatch && setSchoolMatch[1]) {
        intent = 'set_place';
        setPlaceRole = 'school';
        setPlaceQuery = setSchoolMatch[1].replace(/[?.!]+$/, '').trim();
    }

    const isTransitExplicit = /\b(bus|autob[uú]s|buses|autobuses|autocar|tren|trens|rodalies|renfe|fgc|cercan[ií]as|metro|tram|tranv[ií]a|horari|horario|salir\s+a\s+las|sortir\s+a\s+les|llegar\s+(?:antes|a\s+las)|arribar\s+(?:abans|a\s+les))\b/i.test(low);
    const isExplorePattern = /\b(qu[eé]\s+(?:puedo|puc|se\s+puede|es\s+pot)\s+(?:hacer|fer|ver|veure|visitar)|qu[eé]\s+(?:hay|hi\s+ha)|plans?|planes|activitats?|actividades|recomi[eé]nda(?:me)?|recomana(?:'m)?|llocs?\s+(?:per|para)|sitios?\s+(?:para|per|de)|d[oó]nde\s+(?:puedo|comer|cenar|estudiar|ir|tomar)|on\s+(?:puc|menjar|sopar|estudiar|anar|prendre)|museos?|parques?|parcs?|cafeter[ií]a|bibliotec|turism[eo]|oci[o]?)\b/i.test(low);

    if (intent !== 'set_place' && isExplorePattern && !isTransitExplicit) {
        intent = 'explore';
    }

    const hasExplicitNewClockQuery = /\b(?:salir|sortir|salgo|surto|llegar|arribar|a partir de)\s+(?:a\s+)?(?:las|les|la|l')?\s*\d{1,2}/i.test(low);
    const isFollowupCue = /\b(esa ruta|aquesta ruta|esta ruta|ese bus|aquest bus|ese tren|aquest tren|esa parada|aquesta parada|esa opci[oó]n|aquesta opci[oó]|opci[oó]n?\s*[1-4]|opci[oó]\s*[1-4]|sitio\s*[1-4]|lloc\s*[1-4]|el primero|el segon|el segundo|el tercero|la parada|donde me bajo|d[oó]nde bajo|on baixo|donde subo|on pujo|cu[aá]nto\s+(?:se\s+)?(?:anda|camina|camino|tardo)|quant\s+(?:es\s+)?camina|transbordo|transbord|m[aá]s r[aá]pid[oa]|m[eé]s r[aà]pid|caminar?\s+(?:lento|despacio|r[aá]pido|a poc a poc)|andar\s+lento|alternativa|cu[aá]l\s+(?:es\s+mejor|recomiendas|prefieres|em conv[eé]|me conviene)|quin\s+(?:[eé]s\s+millor|recomanes|conv[eé])|a qu[eé] hora tengo que salir|a quina hora haig de sortir|sobre la ruta|d'aquesta ruta|de esa ruta|d'aquest bus|de ese bus|me da tiempo|em dona temps|abre hoy|obre avui)\b/i.test(low)
        || (/^(?:y |i |pero |per[oò] |entonces |llavors |vale |ok |oye |escolta )/i.test(low) && !hasExplicitNewClockQuery && !isExplorePattern);

    if (hasActiveContext && intent !== 'set_place' && isFollowupCue && !hasExplicitNewClockQuery) {
        intent = 'followup';
    }

    let departureHour = null;
    let departureMinute = 0;
    let arrivalHour = null;
    let arrivalMinute = 0;
    let arrivalSlightlyBefore = false;

    const depRegex = /(?:salir|salgo|sortir|surto|partir|a partir de|desde\s+las|des\s+de\s+les|a\s+las|sobre\s+las|sobre\s+les)\s*(?:de\s*)?(?:a\s*)?(?:las|les|la|l')?\s*(\d{1,2})(?:[:h.](\d{2}))?/i;
    const depMatch = low.match(depRegex);
    if (depMatch) {
        departureHour = Math.min(23, Math.max(0, parseInt(depMatch[1], 10)));
        departureMinute = depMatch[2] ? Math.min(59, Math.max(0, parseInt(depMatch[2], 10))) : 0;
    }

    const arrRegex = /(?:llegar|llego|arribar|arribo|estar\s+a|estigui\s+a|antes\s+(?:de|a)|abans\s+(?:de|a))\s*(?:un\s+poco\s*|una\s+mica\s*)?(?:(?:antes|abans)(?:\s+(?:de|a))?)?\s*(?:a\s*)?(?:las|les|la|l')?\s*(\d{1,2})(?:[:h.](\d{2}))?/i;
    const arrMatch = low.match(arrRegex);
    if (arrMatch) {
        arrivalHour = Math.min(23, Math.max(0, parseInt(arrMatch[1], 10)));
        arrivalMinute = arrMatch[2] ? Math.min(59, Math.max(0, parseInt(arrMatch[2], 10))) : 0;
        if (/(?:antes\s+(?:de|a)|abans\s+(?:de|a)|un\s+poco\s+antes|una\s+mica\s+abans)/i.test(low)) {
            arrivalSlightlyBefore = true;
        }
    }

    if (departureHour === null && arrivalHour === null && intent === 'transit') {
        const bareMatches = [...low.matchAll(/\b(?:las|les)?\s*(\d{1,2})(?:[:h](\d{2}))?\b/g)]
            .map(m => ({ h: parseInt(m[1], 10), m: m[2] ? parseInt(m[2], 10) : 0 }))
            .filter(t => t.h >= 0 && t.h <= 23);
        if (bareMatches.length >= 2) {
            departureHour = bareMatches[0].h;
            departureMinute = bareMatches[0].m;
            arrivalHour = bareMatches[1].h;
            arrivalMinute = bareMatches[1].m;
        } else if (bareMatches.length === 1) {
            departureHour = bareMatches[0].h;
            departureMinute = bareMatches[0].m;
        }
    }

    const allowedModes = [];
    if (/\b(bus|autob[uú]s|buses|autobuses|autocar)\b/i.test(low)) allowedModes.push('BUS');
    if (/\b(tren|trens|rodalies|renfe|fgc|cercan[ií]as|rail|ave|avant|regional)\b/i.test(low)) allowedModes.push('RAIL');
    if (/\b(metro|subterr[aà]ni)\b/i.test(low)) allowedModes.push('SUBWAY');
    if (/\b(tram|tranv[ií]a|trambaix|trambes[oò]s)\b/i.test(low)) allowedModes.push('LIGHT_RAIL');

    let dayOffset = 0;
    if (/\b(mañana|dem[aà]|tomorrow)\b/i.test(low)) {
        dayOffset = 1;
    }

    let originHint = '';
    let destinationHint = '';
    let originType = 'current';
    let destinationType = 'custom';

    if (/\b(casa|cada|mi casa|casa meva|domicilio|home|llar)\b/i.test(low)) {
        if (/\b(ir a casa|volver a casa|anar a casa|tornar a casa|fins a casa|hasta casa|llegar a casa|arribar a casa)\b/i.test(low)) {
            destinationType = 'saved_home';
            destinationHint = 'Casa';
        } else {
            originType = 'saved_home';
            originHint = 'Casa';
        }
    }

    if (/\b(insti|institut|instituto|universitat|universidad|uni|escola|escuela|colegio|cole|facultat|facultad)\b/i.test(low)) {
        destinationType = 'saved_school';
        destinationHint = 'Institut / Universitat';
    } else if (/\b(feina|trabajo|oficina|curro)\b/i.test(low)) {
        destinationType = 'saved_work';
        destinationHint = 'Feina';
    }

    if (!destinationHint && intent === 'transit') {
        const toMatch = q.match(/(?:ir\s+a|anar\s+a|hasta|fins\s+a|llegar\s+a|arribar\s+a)\s+(?:el|la|l'|las|los|els|les)?\s*([^?,.;]+?)(?:\s+(?:antes|abans|a las|a les|en bus|en tren|$))/i);
        if (toMatch && toMatch[1]) {
            const candidate = toMatch[1].trim();
            if (candidate.length >= 2 && candidate.length <= 60 && !/^(las|les|\d)/.test(candidate.toLowerCase())) {
                destinationHint = candidate;
            }
        }
    }
    if (!originHint && intent === 'transit') {
        const fromMatch = q.match(/(?:salir\s+de|sortir\s+de|desde|des\s+de)\s+(?:mi\s+|el\s+|la\s+|l')?([^?,.;]+?)(?:\s+(?:a las|a les|y |i |en |sobre|$))/i);
        if (fromMatch && fromMatch[1]) {
            const candidate = fromMatch[1].trim();
            if (candidate.length >= 2 && candidate.length <= 60 && !/^(aquí|aqui|las|les|\d)/.test(candidate.toLowerCase())) {
                originType = 'custom';
                originHint = candidate;
            }
        }
    }

    const findSavedByRole = (role) => {
        if (!Array.isArray(savedPlaces)) return null;
        if (role === 'saved_home') {
            return savedPlaces.find(p => /casa|llar|home/i.test(`${p.title} ${p.category}`)) || null;
        }
        if (role === 'saved_school') {
            return savedPlaces.find(p => /insti|institut|instituto|uni|universit|escola|estud|cole/i.test(`${p.title} ${p.category}`)) || null;
        }
        if (role === 'saved_work') {
            return savedPlaces.find(p => /feina|trabajo|oficina|work|estud/i.test(`${p.title} ${p.category}`)) || null;
        }
        return null;
    };

    const matchedOriginPlace = originType.startsWith('saved_') ? findSavedByRole(originType) : null;
    const matchedDestPlace = destinationType.startsWith('saved_') ? findSavedByRole(destinationType) : null;

    let autoShiftedToTomorrow = false;
    const nowRef = clientNowIso ? new Date(clientNowIso) : new Date();
    if (!isNaN(nowRef.getTime()) && dayOffset === 0 && intent === 'transit') {
        const refHour = departureHour !== null ? departureHour : arrivalHour;
        const refMin = departureHour !== null ? departureMinute : arrivalMinute;
        if (refHour !== null) {
            const candidateDate = new Date(nowRef);
            candidateDate.setHours(refHour, refMin || 0, 0, 0);
            if (candidateDate.getTime() < nowRef.getTime() - 5 * 60 * 1000) {
                dayOffset = 1;
                autoShiftedToTomorrow = true;
            }
        }
    }

    let exploreCenterTarget = 'current';
    if (/\b(casa|mi casa|casa meva)\b/i.test(low)) exploreCenterTarget = 'saved_home';
    else if (/\b(insti|institut|instituto|uni|universitat)\b/i.test(low)) exploreCenterTarget = 'saved_school';

    let exploreLocationQuery = '';
    const locInMatch = q.match(/(?:cerca\s+de|a\s+prop\s+de|en\s+el\s+barrio\s+de|en|por)\s+([A-ZÀ-ÿa-zà-ÿ0-9\s'-]{3,40}?)(?:\s*[?.!]|$)/i);
    if (locInMatch && locInMatch[1] && !/^(aqu[ií]|casa|mi casa|casa meva|esta zona|aquesta zona|los alrededores|el barri)$/i.test(locInMatch[1].trim())) {
        exploreLocationQuery = locInMatch[1].trim();
        exploreCenterTarget = 'custom_place';
    }

    let exploreQueryText = '';
    if (/estudiar|estudio|biblioteca|caf[eé]|cafeter/i.test(low)) exploreQueryText = 'cafeteries tranquil·les o biblioteques per estudiar';
    else if (/comer|cenar|sopar|menjar|restaurant|tapas|pizz/i.test(low)) exploreQueryText = 'restaurants i llocs recomanats per menjar';
    else if (/parque|parc|pasear|passejar|aire libre|natura/i.test(low)) exploreQueryText = 'parcs i zones verdes';
    else if (/museo|museu|cultura|exposicion|visitar/i.test(low)) exploreQueryText = 'museus i punts culturals';
    else if (/comprar|botigues|tiendas|centro comercial|compres/i.test(low)) exploreQueryText = 'zones comercials i botigues';
    else if (/gimnasio|gimn[aà]s|esport|deporte/i.test(low)) exploreQueryText = 'gimnasos i instal·lacions esportives';

    return {
        intent,
        setPlaceRole,
        setPlaceQuery,
        language: detectedLang,
        originType,
        originHint,
        matchedOriginPlaceId: matchedOriginPlace ? matchedOriginPlace.id : null,
        destinationType,
        destinationHint,
        matchedDestPlaceId: matchedDestPlace ? matchedDestPlace.id : null,
        departureHour,
        departureMinute,
        arrivalHour,
        arrivalMinute,
        arrivalSlightlyBefore,
        dayOffset,
        autoShiftedToTomorrow,
        allowedModes,
        exploreCenterTarget,
        exploreLocationQuery,
        exploreQueryText
    };
}

function safeParseJsonFromText(rawText) {
    if (!rawText) return null;
    let t = String(rawText).trim();
    const block = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (block) t = block[1].trim();
    const s = t.indexOf('{');
    const e = t.lastIndexOf('}');
    if (s !== -1 && e > s) t = t.slice(s, e + 1);
    try {
        return JSON.parse(t);
    } catch (_) {
        return null;
    }
}

async function fetchGooglePlacesNewText({ apiKey, textQuery, center, radius = 3500, maxResultCount = 8, languageCode = 'ca' }) {
    const fieldMask = [
        'places.id',
        'places.displayName',
        'places.formattedAddress',
        'places.location',
        'places.rating',
        'places.userRatingCount',
        'places.primaryTypeDisplayName',
        'places.currentOpeningHours.openNow',
        'places.regularOpeningHours.openNow',
        'places.googleMapsUri'
    ].join(',');

    const body = {
        textQuery: String(textQuery),
        languageCode: languageCode === 'es' ? 'es' : 'ca',
        maxResultCount
    };
    if (center && typeof center.lat === 'number' && typeof center.lng === 'number') {
        body.locationBias = {
            circle: {
                center: { latitude: center.lat, longitude: center.lng },
                radius
            }
        };
    }

    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': fieldMask
        },
        body: JSON.stringify(body)
    });
    if (res.status === 429) return { quotaExceeded: true, places: [] };
    if (!res.ok) return { places: [] };
    const data = await res.json().catch(() => ({}));
    return { places: Array.isArray(data.places) ? data.places : [] };
}

async function fetchGooglePlacesNewNearby({ apiKey, center, radius = 2000, includedTypes = [], maxResultCount = 10, languageCode = 'ca' }) {
    const fieldMask = [
        'places.id',
        'places.displayName',
        'places.formattedAddress',
        'places.location',
        'places.rating',
        'places.userRatingCount',
        'places.primaryTypeDisplayName',
        'places.currentOpeningHours.openNow',
        'places.regularOpeningHours.openNow',
        'places.googleMapsUri'
    ].join(',');

    const body = {
        languageCode: languageCode === 'es' ? 'es' : 'ca',
        locationRestriction: {
            circle: {
                center: { latitude: center.lat, longitude: center.lng },
                radius
            }
        },
        rankPreference: 'POPULARITY',
        maxResultCount
    };
    if (Array.isArray(includedTypes) && includedTypes.length > 0) {
        body.includedTypes = includedTypes;
    }

    const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': fieldMask
        },
        body: JSON.stringify(body)
    });
    if (res.status === 429) return { quotaExceeded: true, places: [] };
    if (!res.ok) return { places: [] };
    const data = await res.json().catch(() => ({}));
    return { places: Array.isArray(data.places) ? data.places : [] };
}

function normalizePlaceItem(p) {
    if (!p || !p.location) return null;
    const openNowVal = typeof p.currentOpeningHours?.openNow === 'boolean'
        ? p.currentOpeningHours.openNow
        : (typeof p.regularOpeningHours?.openNow === 'boolean' ? p.regularOpeningHours.openNow : null);
    return {
        id: p.id || '',
        displayName: p.displayName?.text || p.displayName || 'Lloc',
        formattedAddress: p.formattedAddress || '',
        lat: p.location.latitude,
        lng: p.location.longitude,
        rating: typeof p.rating === 'number' ? p.rating : null,
        userRatingCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : 0,
        primaryType: p.primaryTypeDisplayName?.text || '',
        openNow: openNowVal,
        googleMapsURI: p.googleMapsUri || p.googleMapsURI || ''
    };
}

function formatActiveMapsContext(lastRouteContext, lastExploreContext) {
    const parts = [];
    if (lastRouteContext && Array.isArray(lastRouteContext.routes) && lastRouteContext.routes.length > 0) {
        parts.push(`RUTA EN CURS (${lastRouteContext.originLabel || 'Origen'} -> ${lastRouteContext.destLabel || 'Destí'}):`);
        if (lastRouteContext.verdictPlainText) {
            parts.push(`Resum donat: ${lastRouteContext.verdictPlainText}`);
        }
        lastRouteContext.routes.slice(0, 4).forEach((r, idx) => {
            const selectedMark = idx === lastRouteContext.selectedRouteIdx ? ' [SELECCIONADA]' : '';
            const stepLines = (Array.isArray(r.steps) ? r.steps : []).map((st) => {
                if (!st.isTransit) {
                    return `  - Caminar ${st.durationText || ''} ${st.distanceText ? `(${st.distanceText})` : ''} ${st.instruction || ''}`.trim();
                }
                return `  - ${st.vehicleLabel || st.vehicleType} ${st.lineShort}${st.headsign ? ` (dir. ${st.headsign})` : ''}: puja a "${st.departureStopName}" a les ${st.departureTimeText}, baixa a "${st.arrivalStopName}" a les ${st.arrivalTimeText} (${st.stopCount || '?'} parades, ${st.durationText || ''})`;
            }).join('\n');
            parts.push(`Opció ${idx + 1}${selectedMark}: Sortida ${r.departureTimeText} -> Arribada ${r.arrivalTimeText} (${r.durationText}, ${r.distanceText || ''})\n${stepLines}`);
        });
    }
    if (lastExploreContext && Array.isArray(lastExploreContext.places) && lastExploreContext.places.length > 0) {
        parts.push(`LLOCS EXPLORATS (${lastExploreContext.centerLabel || 'Zona'}):`);
        lastExploreContext.places.slice(0, 8).forEach((p, idx) => {
            const st = p.openNow === true ? 'Obert ara' : (p.openNow === false ? 'Tancat ara' : '');
            parts.push(`${idx + 1}. ${p.displayName} | ${p.primaryType || 'Lloc'} | ${p.formattedAddress || ''} ${p.rating ? `| ★${p.rating}` : ''} ${st}`.trim());
        });
    }
    return parts.join('\n\n');
}

function sanitizeMapsPlacesArray(rawList) {
    if (!Array.isArray(rawList)) return [];
    const cleaned = [];
    for (const item of rawList.slice(0, 30)) {
        if (!item || typeof item !== 'object') continue;
        const lat = Number(item.lat);
        const lng = Number(item.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        cleaned.push({
            id: String(item.id || ('pl_' + Date.now() + '_' + cleaned.length)).slice(0, 80),
            title: String(item.title || 'Lloc').slice(0, 160),
            category: String(item.category || 'Punt de trobada').slice(0, 80),
            lat,
            lng,
            address: String(item.address || '').slice(0, 320),
            savedAt: typeof item.savedAt === 'number' ? item.savedAt : Date.now()
        });
    }
    return cleaned;
}

function sanitizeParkedVehicle(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const lat = Number(raw.lat);
    const lng = Number(raw.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return {
        lat,
        lng,
        address: String(raw.address || '').slice(0, 320),
        floorSpot: String(raw.floorSpot || '').slice(0, 120),
        notes: String(raw.notes || '').slice(0, 240),
        vehicleType: ['cotxe', 'moto', 'bici'].includes(raw.vehicleType) ? raw.vehicleType : 'cotxe',
        savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : Date.now(),
        expiresAt: typeof raw.expiresAt === 'number' ? raw.expiresAt : null
    };
}

// --- Handlers shared by Express (server.js) and Vercel Serverless (/api/maps*) ---

async function handleConfig(req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    res.setHeader('Cache-Control', 'no-store');
    const apiKey = resolveGoogleMapsApiKey();
    return res.status(200).json({
        apiKey,
        attributionId: 'gmp_mcp_codeassist_v1_aistudio'
    });
}

async function handleGeocode(req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    try {
        const apiKey = resolveGoogleMapsApiKey();
        if (!apiKey) {
            return res.status(503).json({ error: 'Maps API key not configured' });
        }
        const q = req.query || {};
        const { latlng, address, place_id, language = 'ca' } = q;
        const lang = String(language || 'ca');
        const params = new URLSearchParams({ key: apiKey, language: lang });
        if (latlng) params.set('latlng', String(latlng));
        else if (address) params.set('address', String(address));
        else if (place_id) params.set('place_id', String(place_id));
        else return res.status(400).json({ error: 'Missing latlng, address, or place_id parameter' });

        const url = `https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`;
        const upstream = await fetch(url);
        const data = await upstream.json().catch(() => ({}));
        if (
            upstream.status === 429 ||
            data.status === 'OVER_QUERY_LIMIT' ||
            data.status === 'RESOURCE_EXHAUSTED'
        ) {
            return res.status(429).json({
                status: 'RESOURCE_EXHAUSTED',
                error_message: data.error_message || 'Quota exceeded'
            });
        }

        if (data.status === 'REQUEST_DENIED' || !upstream.ok) {
            if (latlng) {
                const [latStr, lngStr] = String(latlng).split(',');
                const latNum = parseFloat(latStr);
                const lngNum = parseFloat(lngStr);
                if (!isNaN(latNum) && !isNaN(lngNum)) {
                    const nbRes = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Goog-Api-Key': apiKey,
                            'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location'
                        },
                        body: JSON.stringify({
                            languageCode: lang === 'es' ? 'es' : 'ca',
                            locationRestriction: {
                                circle: {
                                    center: { latitude: latNum, longitude: lngNum },
                                    radius: 180
                                }
                            },
                            maxResultCount: 1
                        })
                    });
                    if (nbRes.status === 429) {
                        return res.status(429).json({ status: 'RESOURCE_EXHAUSTED', error_message: 'Quota exceeded' });
                    }
                    const nbData = await nbRes.json().catch(() => ({}));
                    const first = nbData?.places?.[0];
                    if (first) {
                        const formatted = first.formattedAddress || first.displayName?.text || `${latNum.toFixed(5)}, ${lngNum.toFixed(5)}`;
                        return res.json({
                            status: 'OK',
                            results: [{
                                formatted_address: first.displayName?.text && first.formattedAddress && !first.formattedAddress.includes(first.displayName.text)
                                    ? `${first.displayName.text}, ${first.formattedAddress}`
                                    : formatted,
                                geometry: {
                                    location: {
                                        lat: first.location?.latitude ?? latNum,
                                        lng: first.location?.longitude ?? lngNum
                                    }
                                }
                            }]
                        });
                    }
                }
            } else if (address) {
                const txtRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Goog-Api-Key': apiKey,
                        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location'
                    },
                    body: JSON.stringify({
                        textQuery: String(address),
                        languageCode: lang === 'es' ? 'es' : 'ca',
                        maxResultCount: 1
                    })
                });
                if (txtRes.status === 429) {
                    return res.status(429).json({ status: 'RESOURCE_EXHAUSTED', error_message: 'Quota exceeded' });
                }
                const txtData = await txtRes.json().catch(() => ({}));
                const first = txtData?.places?.[0];
                if (first && first.location) {
                    return res.json({
                        status: 'OK',
                        results: [{
                            formatted_address: first.formattedAddress || first.displayName?.text || String(address),
                            geometry: {
                                location: {
                                    lat: first.location.latitude,
                                    lng: first.location.longitude
                                }
                            }
                        }]
                    });
                }
            }
        }

        return res.status(upstream.ok ? 200 : upstream.status).json(data);
    } catch (err) {
        return res.status(500).json({ error: 'Geocoding request failed' });
    }
}

async function handleParseCommute(req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    try {
        const { question, savedPlaces = [], clientNowIso = '' } = getBody(req);
        if (!question || typeof question !== 'string' || !question.trim()) {
            return res.status(400).json({ error: 'Missing question' });
        }

        const deterministic = deterministicParseCommuteQuestion(question, savedPlaces, clientNowIso);
        const savedSummary = Array.isArray(savedPlaces) && savedPlaces.length
            ? savedPlaces.slice(0, 12).map(p => `- id:${p.id} | title:${p.title} | cat:${p.category} | addr:${p.address}`).join('\n')
            : '(cap lloc desat)';

        const llmOut = await runMapsLLM({
            req,
            jsonMode: true,
            systemPrompt: 'Analitza consultes de mobilitat urbana i ubicacions en català o castellà i retorna NOMÉS JSON vàlid.',
            userPrompt: `Data/hora client: ${clientNowIso || new Date().toISOString()}
Llocs guardats:
${savedSummary}

Pregunta: "${question.trim()}"

Retorna JSON amb aquests camps:
{
  "intent": "transit" | "explore" | "set_place",
  "setPlaceRole": "home" | "school" | "work" | null,
  "setPlaceQuery": string,
  "language": "es" | "ca",
  "originType": "current" | "saved_home" | "saved_school" | "saved_work" | "custom",
  "originHint": string,
  "matchedOriginPlaceId": string | null,
  "destinationType": "saved_school" | "saved_home" | "saved_work" | "custom",
  "destinationHint": string,
  "matchedDestPlaceId": string | null,
  "departureHour": number | null,
  "departureMinute": number,
  "arrivalHour": number | null,
  "arrivalMinute": number,
  "arrivalSlightlyBefore": boolean,
  "dayOffset": 0 | 1,
  "allowedModes": array dins ["BUS", "RAIL", "SUBWAY", "LIGHT_RAIL"],
  "exploreCenterTarget": "current" | "saved_home" | "saved_school" | "custom_place",
  "exploreLocationQuery": string,
  "exploreQueryText": string
}`
        });

        const parsedAi = llmOut ? safeParseJsonFromText(llmOut.text) : null;
        if (!parsedAi) {
            return res.json({ parsed: deterministic, engine: 'deterministic' });
        }

        const merged = {
            ...deterministic,
            intent: ['transit', 'explore', 'set_place'].includes(parsedAi.intent) ? parsedAi.intent : deterministic.intent,
            setPlaceRole: parsedAi.setPlaceRole || deterministic.setPlaceRole,
            setPlaceQuery: typeof parsedAi.setPlaceQuery === 'string' && parsedAi.setPlaceQuery.trim() ? parsedAi.setPlaceQuery.trim() : deterministic.setPlaceQuery,
            language: parsedAi.language === 'es' || parsedAi.language === 'ca' ? parsedAi.language : deterministic.language,
            originType: parsedAi.originType || deterministic.originType,
            originHint: typeof parsedAi.originHint === 'string' && parsedAi.originHint.trim() ? parsedAi.originHint.trim() : deterministic.originHint,
            matchedOriginPlaceId: parsedAi.matchedOriginPlaceId || deterministic.matchedOriginPlaceId,
            destinationType: parsedAi.destinationType || deterministic.destinationType,
            destinationHint: typeof parsedAi.destinationHint === 'string' && parsedAi.destinationHint.trim() ? parsedAi.destinationHint.trim() : deterministic.destinationHint,
            matchedDestPlaceId: parsedAi.matchedDestPlaceId || deterministic.matchedDestPlaceId,
            departureHour: typeof parsedAi.departureHour === 'number' ? parsedAi.departureHour : deterministic.departureHour,
            departureMinute: typeof parsedAi.departureMinute === 'number' ? parsedAi.departureMinute : deterministic.departureMinute,
            arrivalHour: typeof parsedAi.arrivalHour === 'number' ? parsedAi.arrivalHour : deterministic.arrivalHour,
            arrivalMinute: typeof parsedAi.arrivalMinute === 'number' ? parsedAi.arrivalMinute : deterministic.arrivalMinute,
            arrivalSlightlyBefore: typeof parsedAi.arrivalSlightlyBefore === 'boolean' ? parsedAi.arrivalSlightlyBefore : deterministic.arrivalSlightlyBefore,
            dayOffset: (parsedAi.dayOffset === 1 || deterministic.dayOffset === 1) ? 1 : 0,
            autoShiftedToTomorrow: deterministic.autoShiftedToTomorrow,
            allowedModes: Array.isArray(parsedAi.allowedModes) && parsedAi.allowedModes.length
                ? parsedAi.allowedModes.filter(m => ['BUS', 'RAIL', 'SUBWAY', 'LIGHT_RAIL', 'TRAIN'].includes(m))
                : deterministic.allowedModes,
            exploreCenterTarget: parsedAi.exploreCenterTarget || deterministic.exploreCenterTarget,
            exploreLocationQuery: typeof parsedAi.exploreLocationQuery === 'string' && parsedAi.exploreLocationQuery.trim() ? parsedAi.exploreLocationQuery.trim() : deterministic.exploreLocationQuery,
            exploreQueryText: typeof parsedAi.exploreQueryText === 'string' && parsedAi.exploreQueryText.trim() ? parsedAi.exploreQueryText.trim() : deterministic.exploreQueryText
        };
        return res.json({ parsed: merged, engine: llmOut.engine });
    } catch (err) {
        return res.status(500).json({ error: 'Unable to parse commute question' });
    }
}

async function handleAskAi(req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    try {
        const {
            question,
            savedPlaces = [],
            currentCenter = null,
            userLocation = null,
            clientNowIso = '',
            lastRouteContext = null,
            lastExploreContext = null,
            conversationHistory = []
        } = getBody(req);

        if (!question || typeof question !== 'string' || !question.trim()) {
            return res.status(400).json({ error: 'Missing question' });
        }

        const apiKey = resolveGoogleMapsApiKey();
        const activeContextText = formatActiveMapsContext(lastRouteContext, lastExploreContext);
        const hasActiveContext = activeContextText.length > 0;
        const deterministic = deterministicParseCommuteQuestion(question, savedPlaces, clientNowIso, hasActiveContext);
        const savedSummary = Array.isArray(savedPlaces) && savedPlaces.length
            ? savedPlaces.slice(0, 12).map(p => `- id:${p.id} | title:${p.title} | cat:${p.category} | addr:${p.address}`).join('\n')
            : '(cap lloc desat)';

        const recentConvoText = Array.isArray(conversationHistory) && conversationHistory.length > 0
            ? conversationHistory.slice(-6).map(m => `${m.role === 'user' ? 'Usuari' : 'AliatMaps'}: ${String(m.text || m.content || '').slice(0, 320)}`).join('\n')
            : '';

        const classifyOut = await runMapsLLM({
            req,
            jsonMode: true,
            systemPrompt: `Ets el classificador intel·ligent d'AliatMaps. Classifica la petició de l'usuari en una d'aquestes intencions exactes:
${hasActiveContext ? `0. "followup": L'usuari fa un comentari o pregunta de seguiment sobre la ruta de transport públic, parades, temps caminant, alternatives o llocs que AliatMaps ja li acaba de mostrar al context actiu (ex: "¿Dónde me bajo exactamente?", "¿Cuánto se camina?", "¿Y si voy lento?", "¿Cuál tiene menos transbordos?", "¿El sitio 2 está abierto?", "¿Puedo preguntar algo de esa ruta?"). IMPORTANT: si demana recalcular una NOVA ruta a un altre destí o a una NOVA hora explícita (ex: "y si salgo a las 8:30?"), usa "transit".` : ''}
1. "set_place": L'usuari vol establir o canviar la seva Casa, Institut/Universitat o Feina (ex: "Mi casa está en Calle Mayor 5", "Vivo en Girona", "Pon mi instituto en...", "Casa meva és a...").
2. "explore": L'usuari pregunta què pot fer per la zona, plans, llocs per visitar, cafeteries per estudiar, restaurants, botigues, parcs, museus, oci o serveis (ex: "¿Qué puedo hacer por aquí?", "Què puc fer a prop de casa?", "Sitios para estudiar", "Planes hoy").
3. "transit": L'usuari pregunta per horaris de bus, tren, metro o com arribar en transport públic d'un punt a un altre a una hora concreta.`,
            userPrompt: `Data/hora client: ${clientNowIso || new Date().toISOString()}
Llocs guardats:
${savedSummary}
${hasActiveContext ? `\nContext actiu recent d'AliatMaps:\n${activeContextText.slice(0, 2200)}` : ''}
${recentConvoText ? `\nConversa recent:\n${recentConvoText}` : ''}

Pregunta de l'usuari: "${question.trim()}"

Retorna NOMÉS JSON vàlid:
{
  "intent": ${hasActiveContext ? '"followup" | ' : ''}"transit" | "explore" | "set_place",
  "language": "es" | "ca",
  "setPlaceRole": "home" | "school" | "work" | null,
  "setPlaceQuery": string,
  "exploreCenterTarget": "current" | "saved_home" | "saved_school" | "custom_place",
  "exploreLocationQuery": string,
  "exploreQueryText": string,
  "originType": "current" | "saved_home" | "saved_school" | "saved_work" | "custom",
  "originHint": string,
  "matchedOriginPlaceId": string | null,
  "destinationType": "saved_school" | "saved_home" | "saved_work" | "custom",
  "destinationHint": string,
  "matchedDestPlaceId": string | null,
  "departureHour": number | null,
  "departureMinute": number,
  "arrivalHour": number | null,
  "arrivalMinute": number,
  "arrivalSlightlyBefore": boolean,
  "dayOffset": 0 | 1,
  "allowedModes": array dins ["BUS", "RAIL", "SUBWAY", "LIGHT_RAIL"]
}`
        });

        const allowedIntents = hasActiveContext ? ['followup', 'transit', 'explore', 'set_place'] : ['transit', 'explore', 'set_place'];
        const aiParsed = classifyOut ? safeParseJsonFromText(classifyOut.text) : null;
        const parsed = aiParsed ? {
            ...deterministic,
            intent: allowedIntents.includes(aiParsed.intent) ? aiParsed.intent : deterministic.intent,
            language: aiParsed.language === 'es' || aiParsed.language === 'ca' ? aiParsed.language : deterministic.language,
            setPlaceRole: aiParsed.setPlaceRole || deterministic.setPlaceRole,
            setPlaceQuery: typeof aiParsed.setPlaceQuery === 'string' && aiParsed.setPlaceQuery.trim() ? aiParsed.setPlaceQuery.trim() : deterministic.setPlaceQuery,
            exploreCenterTarget: aiParsed.exploreCenterTarget || deterministic.exploreCenterTarget,
            exploreLocationQuery: typeof aiParsed.exploreLocationQuery === 'string' ? aiParsed.exploreLocationQuery.trim() : deterministic.exploreLocationQuery,
            exploreQueryText: typeof aiParsed.exploreQueryText === 'string' ? aiParsed.exploreQueryText.trim() : deterministic.exploreQueryText,
            originType: aiParsed.originType || deterministic.originType,
            originHint: typeof aiParsed.originHint === 'string' && aiParsed.originHint.trim() ? aiParsed.originHint.trim() : deterministic.originHint,
            matchedOriginPlaceId: aiParsed.matchedOriginPlaceId || deterministic.matchedOriginPlaceId,
            destinationType: aiParsed.destinationType || deterministic.destinationType,
            destinationHint: typeof aiParsed.destinationHint === 'string' && aiParsed.destinationHint.trim() ? aiParsed.destinationHint.trim() : deterministic.destinationHint,
            matchedDestPlaceId: aiParsed.matchedDestPlaceId || deterministic.matchedDestPlaceId,
            departureHour: typeof aiParsed.departureHour === 'number' ? aiParsed.departureHour : deterministic.departureHour,
            departureMinute: typeof aiParsed.departureMinute === 'number' ? aiParsed.departureMinute : deterministic.departureMinute,
            arrivalHour: typeof aiParsed.arrivalHour === 'number' ? aiParsed.arrivalHour : deterministic.arrivalHour,
            arrivalMinute: typeof aiParsed.arrivalMinute === 'number' ? aiParsed.arrivalMinute : deterministic.arrivalMinute,
            arrivalSlightlyBefore: typeof aiParsed.arrivalSlightlyBefore === 'boolean' ? aiParsed.arrivalSlightlyBefore : deterministic.arrivalSlightlyBefore,
            dayOffset: (aiParsed.dayOffset === 1 || deterministic.dayOffset === 1) ? 1 : 0,
            allowedModes: Array.isArray(aiParsed.allowedModes) && aiParsed.allowedModes.length
                ? aiParsed.allowedModes.filter(m => ['BUS', 'RAIL', 'SUBWAY', 'LIGHT_RAIL', 'TRAIN'].includes(m))
                : deterministic.allowedModes
        } : deterministic;

        const lang = parsed.language === 'es' ? 'es' : 'ca';
        const isEs = lang === 'es';

        if (parsed.intent === 'followup' && hasActiveContext) {
            const followupOut = await runMapsLLM({
                req,
                jsonMode: false,
                systemPrompt: `Ets AliatMaps IA, un assistent de mobilitat i mapa proper i clar.
REGLES OBLIGATÒRIES:
1. Respon en ${isEs ? 'ESPAÑOL' : 'CATALÀ'} natural, directe i pràctic.
2. Respon basant-te EXCLUSIVAMENT en les dades reals del context actiu (rutes calculades, parades, línies, temps a peu o llocs trobats) i els llocs guardats de l'usuari.
3. NO inventis mai horaris, línies ni adreces que no surtin al context. Si l'usuari pregunta per una hora o destí completament nou no present a les opcions, digues-li breument que pot escriure aquella nova hora (ex: "Sortir a les 8:30") per recalcular l'horari oficial al moment.`,
                userPrompt: `Context real actiu d'AliatMaps:
${activeContextText}

Llocs guardats:
${savedSummary}

${recentConvoText ? `Conversa recent:\n${recentConvoText}\n` : ''}Comentari / pregunta de l'usuari: "${question.trim()}"`
            });

            let answerText = followupOut?.text || '';
            if (!answerText) {
                if (lastRouteContext?.routes?.length) {
                    const sel = lastRouteContext.routes[lastRouteContext.selectedRouteIdx || 0] || lastRouteContext.routes[0];
                    const tSteps = (sel.steps || []).filter(s => s.isTransit);
                    const walkMins = Math.round(((sel.steps || []).filter(s => !s.isTransit).reduce((acc, s) => acc + (s.durationSec || 0), 0)) / 60);
                    const linesDesc = tSteps.map(s => `${s.lineShort} (${s.departureStopName} ${s.departureTimeText} -> ${s.arrivalStopName} ${s.arrivalTimeText})`).join(', ');
                    answerText = isEs
                        ? `Sobre la ruta seleccionada (${sel.departureTimeText} -> ${sel.arrivalTimeText}, ${sel.durationText}): caminarás aprox. ${walkMins} min en total. ${linesDesc ? `Tramos: ${linesDesc}.` : ''}`
                        : `Sobre la ruta seleccionada (${sel.departureTimeText} -> ${sel.arrivalTimeText}, ${sel.durationText}): caminaràs aprox. ${walkMins} min en total. ${linesDesc ? `Trams: ${linesDesc}.` : ''}`;
                } else {
                    answerText = isEs
                        ? 'Aquí tienes los detalles guardados de los sitios actuales. Puedes pulsar "Bus / Tren" en cualquiera para ver cómo llegar.'
                        : 'Aquí tens els detalls dels llocs actuals. Pots prémer "Bus / Tren" a qualsevol per veure com arribar-hi.';
                }
            }

            return res.json({
                intent: 'followup',
                language: lang,
                answerText,
                engine: followupOut?.engine || 'deterministic'
            });
        }

        if (parsed.intent === 'set_place') {
            if (!apiKey) {
                return res.status(503).json({ error: 'Maps API key not configured' });
            }
            const bias = userLocation || currentCenter || { lat: 41.3874, lng: 2.1686 };
            const query = parsed.setPlaceQuery || question.trim();
            const found = await fetchGooglePlacesNewText({
                apiKey,
                textQuery: query,
                center: bias,
                radius: 50000,
                maxResultCount: 4,
                languageCode: lang
            });
            if (found.quotaExceeded) {
                return res.status(429).json({ status: 'RESOURCE_EXHAUSTED', error: 'Quota exceeded' });
            }
            const candidates = (found.places || []).map(normalizePlaceItem).filter(Boolean);
            return res.json({
                intent: 'set_place',
                language: lang,
                role: parsed.setPlaceRole || 'home',
                query,
                candidates,
                parsed,
                engine: classifyOut?.engine || 'deterministic'
            });
        }

        if (parsed.intent === 'explore') {
            if (!apiKey) {
                return res.status(503).json({ error: 'Maps API key not configured' });
            }

            let center = (userLocation && typeof userLocation.lat === 'number')
                ? userLocation
                : ((currentCenter && typeof currentCenter.lat === 'number') ? currentCenter : { lat: 41.3874, lng: 2.1686 });
            let centerLabel = isEs ? 'tu zona actual' : 'la teva zona actual';

            if (parsed.exploreCenterTarget === 'saved_home') {
                const h = savedPlaces.find(p => /casa|llar|home/i.test(`${p.title} ${p.category}`));
                if (h && typeof h.lat === 'number') {
                    center = { lat: h.lat, lng: h.lng };
                    centerLabel = isEs ? `tu Casa (${h.address || h.title})` : `Casa teva (${h.address || h.title})`;
                }
            } else if (parsed.exploreCenterTarget === 'saved_school') {
                const s = savedPlaces.find(p => /insti|institut|instituto|uni|universit|escola|estud|cole/i.test(`${p.title} ${p.category}`));
                if (s && typeof s.lat === 'number') {
                    center = { lat: s.lat, lng: s.lng };
                    centerLabel = s.title;
                }
            } else if (parsed.exploreCenterTarget === 'custom_place' && parsed.exploreLocationQuery) {
                const geoRes = await fetchGooglePlacesNewText({
                    apiKey,
                    textQuery: parsed.exploreLocationQuery,
                    center,
                    radius: 50000,
                    maxResultCount: 1,
                    languageCode: lang
                });
                const gFirst = geoRes.places?.[0];
                if (gFirst?.location) {
                    center = { lat: gFirst.location.latitude, lng: gFirst.location.longitude };
                    centerLabel = gFirst.displayName?.text || parsed.exploreLocationQuery;
                }
            }

            let placesResult;
            if (parsed.exploreQueryText) {
                placesResult = await fetchGooglePlacesNewText({
                    apiKey,
                    textQuery: `${parsed.exploreQueryText}${parsed.exploreLocationQuery ? ` ${parsed.exploreLocationQuery}` : ''}`,
                    center,
                    radius: 3000,
                    maxResultCount: 8,
                    languageCode: lang
                });
            } else {
                placesResult = await fetchGooglePlacesNewNearby({
                    apiKey,
                    center,
                    radius: 2200,
                    includedTypes: ['tourist_attraction', 'park', 'museum', 'library', 'cafe', 'restaurant', 'shopping_mall', 'movie_theater', 'cultural_center'],
                    maxResultCount: 8,
                    languageCode: lang
                });
                if (!placesResult.quotaExceeded && (!placesResult.places || placesResult.places.length < 3)) {
                    placesResult = await fetchGooglePlacesNewNearby({
                        apiKey,
                        center,
                        radius: 3500,
                        includedTypes: [],
                        maxResultCount: 8,
                        languageCode: lang
                    });
                }
            }

            if (placesResult?.quotaExceeded) {
                return res.status(429).json({ status: 'RESOURCE_EXHAUSTED', error: 'Quota exceeded' });
            }

            const places = (placesResult?.places || []).map(normalizePlaceItem).filter(Boolean);
            let answerText = '';
            let answerEngine = 'deterministic';

            if (places.length > 0) {
                const placesContext = places.map((p, idx) => {
                    const statusTxt = p.openNow === true ? (isEs ? 'Abierto ahora' : 'Obert ara') : (p.openNow === false ? (isEs ? 'Cerrado ahora' : 'Tancat ara') : '');
                    const ratingTxt = p.rating ? `${p.rating.toFixed(1)} (${p.userRatingCount})` : '';
                    return `${idx + 1}. ${p.displayName} | ${p.primaryType || 'Lloc'} | ${p.formattedAddress} | ${ratingTxt} ${statusTxt}`.trim();
                }).join('\n');

                const recOut = await runMapsLLM({
                    req,
                    jsonMode: false,
                    systemPrompt: `Ets AliatMaps IA, un assistent local proper i pràctic.
REGLES OBLIGATÒRIES:
1. Respon en ${isEs ? 'ESPAÑOL' : 'CATALÀ'} natural i útil.
2. Recomana EXCLUSIVAMENT llocs de la llista REAL de Google Places proporcionada a continuació. NO inventis cap altre lloc, adreça ni horari!
3. Agrupa o destaca 4-6 plans concrets amb el seu número [1], [2]... i explica breument què hi pot fer (prendre un cafè, passejar, estudiar, menjar, visitar) i recorda que pot prémer "Bus / Tren" a cada targeta per anar-hi en transport públic.`,
                    userPrompt: `Zona consultada: ${centerLabel}
Pregunta de l'usuari: "${question.trim()}"

Llocs reals trobats a Google Maps ara mateix:
${placesContext}`
                });

                if (recOut && recOut.text) {
                    answerText = recOut.text;
                    answerEngine = recOut.engine;
                } else {
                    answerText = isEs
                        ? `He encontrado ${places.length} opciones reales cerca de ${centerLabel}:\n` +
                          places.slice(0, 5).map((p, i) => `• ${i + 1}. ${p.displayName}${p.primaryType ? ` (${p.primaryType})` : ''}${p.rating ? ` — ${p.rating.toFixed(1)}/5` : ''}`).join('\n')
                        : `He trobat ${places.length} opcions reals a prop de ${centerLabel}:\n` +
                          places.slice(0, 5).map((p, i) => `• ${i + 1}. ${p.displayName}${p.primaryType ? ` (${p.primaryType})` : ''}${p.rating ? ` — ${p.rating.toFixed(1)}/5` : ''}`).join('\n');
                }
            } else {
                answerText = isEs
                    ? `No he encontrado puntos destacados registrados justo en ${centerLabel}. Prueba a mover el mapa o concretar qué buscas (ej: "cafeterías para estudiar" o "parques cerca").`
                    : `No he trobat punts destacats registrats just a ${centerLabel}. Prova de moure el mapa o concretar què busques (ex: "cafeteries per estudiar" o "parcs a prop").`;
            }

            return res.json({
                intent: 'explore',
                language: lang,
                center,
                centerLabel,
                places,
                answerText,
                parsed,
                engine: answerEngine
            });
        }

        return res.json({
            intent: 'transit',
            language: lang,
            parsed,
            engine: classifyOut?.engine || 'deterministic'
        });
    } catch (err) {
        return res.status(500).json({ error: 'Unable to process AliatMaps AI request' });
    }
}

async function handleTransitRoutes(req, res) {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    try {
        const apiKey = resolveGoogleMapsApiKey();
        if (!apiKey) {
            return res.status(503).json({ error: 'Maps API key not configured' });
        }

        const {
            origin,
            destination,
            departureTime,
            arrivalTime,
            allowedTravelModes,
            routingPreference,
            languageCode = 'ca',
            computeAlternativeRoutes = true
        } = getBody(req);

        const buildWaypoint = (wp) => {
            if (!wp) return null;
            if (typeof wp.lat === 'number' && typeof wp.lng === 'number') {
                return { location: { latLng: { latitude: wp.lat, longitude: wp.lng } } };
            }
            if (wp.placeId) {
                return { placeId: String(wp.placeId) };
            }
            if (wp.address && String(wp.address).trim()) {
                return { address: String(wp.address).trim() };
            }
            return null;
        };

        const originWp = buildWaypoint(origin);
        const destWp = buildWaypoint(destination);
        if (!originWp || !destWp) {
            return res.status(400).json({ error: 'Valid origin and destination are required' });
        }

        const payload = {
            origin: originWp,
            destination: destWp,
            travelMode: 'TRANSIT',
            computeAlternativeRoutes: Boolean(computeAlternativeRoutes),
            languageCode: languageCode === 'es' ? 'es' : 'ca',
            regionCode: 'ES',
            units: 'METRIC'
        };

        if (arrivalTime && !departureTime) {
            payload.arrivalTime = String(arrivalTime);
        } else if (departureTime) {
            payload.departureTime = String(departureTime);
        }

        const transitPrefs = {};
        if (Array.isArray(allowedTravelModes) && allowedTravelModes.length > 0) {
            const validModes = allowedTravelModes
                .map(m => String(m).toUpperCase())
                .filter(m => ['BUS', 'SUBWAY', 'TRAIN', 'LIGHT_RAIL', 'RAIL'].includes(m));
            if (validModes.length > 0) {
                transitPrefs.allowedTravelModes = validModes;
            }
        }
        if (routingPreference === 'LESS_WALKING' || routingPreference === 'FEWER_TRANSFERS') {
            transitPrefs.routingPreference = routingPreference;
        }
        if (Object.keys(transitPrefs).length > 0) {
            payload.transitPreferences = transitPrefs;
        }

        const fieldMask = [
            'routes.duration',
            'routes.staticDuration',
            'routes.distanceMeters',
            'routes.localizedValues',
            'routes.polyline.encodedPolyline',
            'routes.viewport',
            'routes.routeLabels',
            'routes.legs.duration',
            'routes.legs.distanceMeters',
            'routes.legs.localizedValues',
            'routes.legs.steps.distanceMeters',
            'routes.legs.steps.staticDuration',
            'routes.legs.steps.localizedValues',
            'routes.legs.steps.travelMode',
            'routes.legs.steps.navigationInstruction',
            'routes.legs.steps.polyline.encodedPolyline',
            'routes.legs.steps.transitDetails'
        ].join(',');

        const headers = {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': fieldMask,
            'X-Goog-Maps-Solution-ID': 'gmp_git_agentskills_v1'
        };
        if (req.headers && req.headers.referer) {
            headers['Referer'] = req.headers.referer;
        }

        const upstream = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });

        const data = await upstream.json().catch(() => ({}));
        if (
            upstream.status === 429 ||
            data?.error?.status === 'RESOURCE_EXHAUSTED' ||
            data?.status === 'OVER_QUERY_LIMIT'
        ) {
            return res.status(429).json({
                status: 'RESOURCE_EXHAUSTED',
                error: data?.error?.message || 'Quota exceeded'
            });
        }

        if (!upstream.ok) {
            return res.status(upstream.status).json({
                error: data?.error?.message || 'Routes API request failed',
                details: data?.error || null
            });
        }

        return res.json({
            routes: Array.isArray(data.routes) ? data.routes : [],
            fallbackInfo: data.fallbackInfo || null
        });
    } catch (err) {
        return res.status(500).json({ error: 'Transit route calculation failed' });
    }
}

async function resolveTargetUserId(client, user) {
    let targetId = user.id;
    let row = null;

    const rById = await client.execute({
        sql: 'SELECT maps_places_json, maps_parking_json FROM users WHERE id = ?',
        args: [targetId]
    });
    if (rById?.rows?.[0]) {
        row = rById.rows[0];
        return { targetId, row };
    }

    if (user.email) {
        const rByEmail = await client.execute({
            sql: 'SELECT * FROM users WHERE email = ?',
            args: [String(user.email).trim().toLowerCase()]
        });
        if (rByEmail?.rows?.[0]) {
            row = rByEmail.rows[0];
            targetId = row.id || targetId;
            return { targetId, row };
        }
    }

    return { targetId, row: null };
}

async function handlePlaces(req, res) {
    setCors(res);
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const user = extractUserFromRequest(req);
        if (!user || !user.id) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const client = getDbClient();
        const { targetId, row } = await resolveTargetUserId(client, user);

        if (req.method === 'GET') {
            let places = [];
            let parkedVehicle = null;
            try {
                if (row?.maps_places_json) places = sanitizeMapsPlacesArray(JSON.parse(row.maps_places_json));
            } catch (_) {}
            try {
                if (row?.maps_parking_json) parkedVehicle = sanitizeParkedVehicle(JSON.parse(row.maps_parking_json));
            } catch (_) {}

            return res.status(200).json({ success: true, places, parkedVehicle });
        }

        if (req.method === 'POST') {
            const { places: rawPlaces, parkedVehicle: rawParking } = getBody(req);

            if (!row) {
                try {
                    await client.execute({
                        sql: 'INSERT INTO users (id, email, password_hash, name) VALUES (?, ?, ?, ?)',
                        args: [targetId, user.email || `${targetId}@aliat.local`, 'hydrated', (user.email || 'user').split('@')[0]]
                    });
                } catch (_) {}
            }

            let finalPlaces = [];
            if (rawPlaces !== undefined) {
                finalPlaces = sanitizeMapsPlacesArray(rawPlaces);
            } else if (row?.maps_places_json) {
                try { finalPlaces = sanitizeMapsPlacesArray(JSON.parse(row.maps_places_json)); } catch (_) {}
            }

            let finalParking = null;
            if (rawParking !== undefined) {
                finalParking = sanitizeParkedVehicle(rawParking);
            } else if (row?.maps_parking_json) {
                try { finalParking = sanitizeParkedVehicle(JSON.parse(row.maps_parking_json)); } catch (_) {}
            }

            await client.execute({
                sql: 'UPDATE users SET maps_places_json = ?, maps_parking_json = ? WHERE id = ?',
                args: [JSON.stringify(finalPlaces), finalParking ? JSON.stringify(finalParking) : '', targetId]
            });

            return res.status(200).json({ success: true, places: finalPlaces, parkedVehicle: finalParking });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (err) {
        return res.status(500).json({ error: 'Failed to process user maps places' });
    }
}

module.exports = {
    resolveGoogleMapsApiKey,
    handleConfig,
    handleGeocode,
    handleParseCommute,
    handleAskAi,
    handleTransitRoutes,
    handlePlaces
};
