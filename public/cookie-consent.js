/**
 * Aliat Intel·ligent — Gestor Real de Consentiment de Cookies, Emmagatzematge Local i Dades d'IA
 * Compliment normatiu: RGPD (UE 2016/679), LOPDGDD (Llei Orgànica 3/2018), LSSI-CE (Art. 22.2) i Guia AEPD.
 */
(function () {
    const CONSENT_KEY = 'aliat_cookie_consent';
    const CONSENT_VERSION = '2026.11';

    function getLang() {
        if (typeof window.currentAppLang === 'string' && (window.currentAppLang === 'es' || window.currentAppLang === 'ca')) {
            return window.currentAppLang;
        }
        const ls = localStorage.getItem('aliat_app_language') || localStorage.getItem('aliat_lang');
        if (ls === 'es' || ls === 'ca') return ls;
        const m = document.cookie.match(/(?:^|;\s*)aliat_lang=(ca|es)/);
        if (m && m[1]) return m[1];
        return (document.documentElement.lang === 'es') ? 'es' : 'ca';
    }

    function readConsent() {
        try {
            const raw = localStorage.getItem(CONSENT_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && parsed.version === CONSENT_VERSION) {
                    return parsed;
                }
            }
            const m = document.cookie.match(/(?:^|;\s*)aliat_cookie_consent=([^;]+)/);
            if (m && m[1]) {
                const parsed = JSON.parse(decodeURIComponent(m[1]));
                if (parsed && typeof parsed === 'object') return parsed;
            }
        } catch (_) {}
        return null;
    }

    function writeCookie(name, value, maxAgeSeconds) {
        document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax`;
    }

    function deleteCookie(name) {
        document.cookie = `${encodeURIComponent(name)}=; path=/; max-age=0; SameSite=Lax`;
    }

    function enforceConsentOnStorage(consent) {
        if (!consent) return;

        // Si l'usuari rebutja les cookies de preferències i personalització, esborrem cookies no essencials
        if (!consent.preferences) {
            deleteCookie('aliat_lang');
            deleteCookie('aliat_theme');
            const prefKeys = [
                'aliat_welcome_subtext_idx',
                'aliat_pomodoro_custom_mins',
                'aliat_sidebar_collapsed',
                'aliat_voice_call_rate',
                'aliat_voice_call_silence'
            ];
            prefKeys.forEach(k => {
                try { localStorage.removeItem(k); } catch (_) {}
            });
        } else {
            const currentLang = getLang();
            writeCookie('aliat_lang', currentLang, 31536000);
            const currentTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
            writeCookie('aliat_theme', currentTheme, 31536000);
        }

        // Si l'usuari desactiva l'emmagatzematge opcional de context d'IA i cerca web
        if (!consent.ai_processing) {
            window.isGoogleSearchActive = false;
            const pulse = document.getElementById('google-search-pulse');
            if (pulse) pulse.classList.add('hidden');
            try {
                for (let i = localStorage.length - 1; i >= 0; i--) {
                    const k = localStorage.key(i);
                    if (k && k.startsWith('aliat_local_context_')) {
                        localStorage.removeItem(k);
                    }
                }
            } catch (_) {}
        }

        window.aliatCookieConsent = consent;
        window.dispatchEvent(new CustomEvent('aliat:cookie-consent-updated', { detail: consent }));
    }

    function saveConsent(choices) {
        const consentObj = {
            version: CONSENT_VERSION,
            timestamp: new Date().toISOString(),
            necessary: true, // Sempre obligatòries segons Art. 22.2 LSSI-CE
            preferences: !!choices.preferences,
            ai_processing: !!choices.ai_processing,
            workspace: !!choices.workspace
        };
        try {
            localStorage.setItem(CONSENT_KEY, JSON.stringify(consentObj));
        } catch (_) {}
        writeCookie(CONSENT_KEY, JSON.stringify(consentObj), 31536000); // 12 mesos
        enforceConsentOnStorage(consentObj);
        hideCookieBanner();
        closeCookieModal();
        updateCookieStatusBadges();
    }

    function getTexts() {
        const isEs = getLang() === 'es';
        return {
            isEs,
            bannerBadge: isEs ? 'AVISO LEGAL DE COOKIES, ALMACENAMIENTO E IA (RGPD / LSSI-CE)' : 'AVÍS LEGAL DE COOKIES, EMMAGATZEMATGE I IA (RGPD / LSSI-CE)',
            bannerTitle: isEs ? 'Transparencia sobre Cookies, Datos Locales y lo que procesa la IA' : 'Transparència sobre Cookies, Dades Locals i el que processa la IA',
            bannerDesc: isEs
                ? 'Utilizamos cookies técnicas y almacenamiento local (localStorage) para mantener tu sesión segura, recordar tu idioma/tema y guardar tu progreso de estudio. Además, cuando usas el chat o subes apuntes (PDF, fotos o voz), los fragmentos necesarios se envían de forma cifrada a los motores de Inteligencia Artificial (Google Gemini API) para generar tus respuestas y planes de estudio. No utilizamos cookies publicitarias ni vendemos tus datos a terceros.'
                : 'Utilitzem cookies tècniques i emmagatzematge local (localStorage) per mantenir la teva sessió segura, recordar el teu idioma/tema i desar el teu progrés d\'estudi. A més, quan utilitzes el xat o puges apunts (PDF, fotos o veu), els fragments necessaris s\'envien de forma xifrada als motors d\'Intel·ligència Artificial (Google Gemini API) per generar les teves respostes i plans d\'estudi. No utilitzem cookies publicitàries ni venem les teves dades a tercers.',
            btnAcceptAll: isEs ? 'Aceptar todas' : 'Acceptar totes',
            btnRejectOptional: isEs ? 'Rechazar opcionales' : 'Rebutjar opcionals',
            btnConfigure: isEs ? 'Configurar cookies y datos IA' : 'Configurar cookies i dades IA',
            linkCookiesPolicy: isEs ? 'Política de Cookies e IA' : 'Política de Cookies i IA',
            linkPrivacy: isEs ? 'Política de Privacidad' : 'Política de Privadesa',
            linkTerms: isEs ? 'Condiciones de Uso' : 'Condicions d\'Ús',
            modalTitle: isEs ? 'Configuración Legal de Cookies, Almacenamiento Local y Datos de IA' : 'Configuració Legal de Cookies, Emmagatzematge Local i Dades d\'IA',
            modalSubtitle: isEs
                ? 'Gestiona con total transparencia qué cookies, variables de almacenamiento local y envíos de contexto a la Inteligencia Artificial autorizas en tu navegador según el RGPD y la LSSI-CE.'
                : 'Gestiona amb total transparència quines cookies, variables d\'emmagatzematge local i enviaments de context a la Intel·ligència Artificial autoritzes al teu navegador segons el RGPD i la LSSI-CE.',
            savePrefsBtn: isEs ? 'Guardar mi configuración' : 'Desar la meva configuració',
            alwaysActive: isEs ? 'Siempre activas (Obligatorias)' : 'Sempre actives (Obligatòries)',
            viewDetails: isEs ? 'Ver listado técnico exacto' : 'Veure llistat tècnic exacte',
            categories: [
                {
                    id: 'necessary',
                    required: true,
                    title: isEs ? '1. Cookies Técnicas, Seguridad y Sesión (Estrictamente Necesarias)' : '1. Cookies Tècniques, Seguretat i Sessió (Estrictament Necessàries)',
                    desc: isEs
                        ? 'Imprescindibles para el funcionamiento básico de la web, el inicio de sesión seguro (JWT y Firebase Auth), la protección antispam contra bots (Google reCAPTCHA Enterprise) y el registro legal de tu consentimiento de cookies.'
                        : 'Imprescindibles per al funcionament bàsic del web, l\'inici de sessió segur (JWT i Firebase Auth), la protecció antispam contra bots (Google reCAPTCHA Enterprise) i el registre legal del teu consentiment de cookies.',
                    items: [
                        { name: 'aliat_cookie_consent', type: 'Cookie HTTP + localStorage', duration: '12 mesos', desc: isEs ? 'Guarda tu decisión legal sobre las categorías de cookies aceptadas o rechazadas.' : 'Desa la teva decisió legal sobre les categories de cookies acceptades o rebutjades.' },
                        { name: 'aliat_token / aliat_user', type: 'localStorage (Cifrado JWT)', duration: isEs ? 'Sesión / 7 días' : 'Sessió / 7 dies', desc: isEs ? 'Mantiene tu cuenta autenticada de forma segura tras iniciar sesión.' : 'Manté el teu compte autenticat de manera segura després d\'iniciar sessió.' },
                        { name: '_GRECAPTCHA', type: 'Cookie HTTP (Google reCAPTCHA)', duration: '6 mesos', desc: isEs ? 'Protege los formularios de login y registro frente a ataques automatizados y bots.' : 'Protegeix els formularis de login i registre davant d\'atacs automatitzats i bots.' }
                    ]
                },
                {
                    id: 'ai_processing',
                    required: false,
                    title: isEs ? '2. Procesamiento de Inteligencia Artificial, Apuntes y Búsqueda Web' : '2. Processament d\'Intel·ligència Artificial, Apunts i Cerca Web',
                    desc: isEs
                        ? 'Detalla exactamente lo que pide y procesa la IA cuando interactúas con ella: el historial de mensajes de la conversación (chatHistory), el texto extraído de tus apuntes PDF (pdfText), imágenes/fotos de ejercicios, transcripción de voz y el contexto académico para que Google Gemini API (o el proveedor elegido) genere respuestas, esquemas, flashcards y tests.'
                        : 'Detalla exactament el que demana i processa la IA quan hi interactues: l\'historial de missatges de la conversa (chatHistory), el text extret dels teus apunts PDF (pdfText), imatges/fotos d\'exercicis, transcripció de veu i el context acadèmic perquè Google Gemini API (o el proveïdor triat) generi respostes, esquemes, flashcards i tests.',
                    items: [
                        { name: 'chatHistory / pdfText / studentContext', type: isEs ? 'Petición HTTPS a /api/generate' : 'Petició HTTPS a /api/generate', duration: isEs ? 'Tiempo real (por consulta)' : 'Temps real (per consulta)', desc: isEs ? 'Mensajes escritos en el chat, fragmentos de apuntes subidos e instrucciones de tutoría enviados al modelo de IA para responderte.' : 'Missatges escrits al xat, fragments d\'apunts pujats i instruccions de tutoria enviats al model d\'IA per respondre\'t.' },
                        { name: 'aliat_local_context_* / aliat_ai_model', type: 'localStorage', duration: isEs ? 'Persistente hasta borrado' : 'Persistent fins a esborrat', desc: isEs ? 'Memoria contextual de tus sesiones de estudio y preferencia de modelo de IA.' : 'Memòria contextual de les teves sessions d\'estudi i preferència de model d\'IA.' },
                        { name: 'useGoogleSearch (Google Grounding)', type: isEs ? 'Consulta Web bajo demanda' : 'Consulta Web sota demanda', duration: isEs ? 'Efímero (solo si se activa)' : 'Efímer (només si s\'activa)', desc: isEs ? 'Desactivado por defecto. Solo cuando activas el botón de búsqueda web o preguntas por resultados en directo, consulta fuentes públicas de internet.' : 'Desactivat per defecte. Només quan actives el botó de cerca web o preguntes per resultats en directe, consulta fonts públiques d\'internet.' }
                    ]
                },
                {
                    id: 'preferences',
                    required: false,
                    title: isEs ? '3. Cookies de Preferencias, Idioma, Tema y Progreso Local' : '3. Cookies de Preferències, Idioma, Tema i Progrés Local',
                    desc: isEs
                        ? 'Permiten recordar tu idioma preferido (Català / Español), el modo visual (Claro / Oscuro), el respaldo local de tus sesiones de estudio en el navegador, la configuración de voz y el temporizador Pomodoro.'
                        : 'Permeten recordar el teu idioma preferit (Català / Español), el mode visual (Clar / Fosc), la còpia de seguretat local de les teves sessions d\'estudi al navegador, la configuració de veu i el temporitzador Pomodoro.',
                    items: [
                        { name: 'aliat_lang / aliat_app_language', type: 'Cookie HTTP + localStorage', duration: '12 mesos', desc: isEs ? 'Recuerda si prefieres la interfaz en Català (ca) o Español (es).' : 'Recorda si prefereixes la interfície en Català (ca) o Español (es).' },
                        { name: 'aliat_theme', type: 'Cookie HTTP + localStorage', duration: '12 mesos', desc: isEs ? 'Recuerda tu preferencia de modo oscuro (dark) o modo claro (light).' : 'Recorda la teva preferència de mode fosc (dark) o mode clar (light).' },
                        { name: 'aliat_sessions_backup / aliat_free_chat_submode', type: 'localStorage', duration: isEs ? 'Persistente local' : 'Persistent local', desc: isEs ? 'Guarda localmente tus conversaciones, planes de estudio, flashcards, tests Kahoot y submodo activo del chat.' : 'Desa localment les teves converses, plans d\'estudi, flashcards, tests Kahoot i submode actiu del xat.' }
                    ]
                },
                {
                    id: 'workspace',
                    required: false,
                    title: isEs ? '4. Integraciones Opcionales con Google Workspace (OAuth 2.0)' : '4. Integracions Opcionals amb Google Workspace (OAuth 2.0)',
                    desc: isEs
                        ? 'Solo se utilizan si conectas voluntariamente tu cuenta de Google para exportar apuntes a Google Docs, guardar archivos en Google Drive, sincronizar exámenes en Google Calendar o enviar recordatorios por Gmail.'
                        : 'Només s\'utilitzen si connectes voluntàriament el teu compte de Google per exportar apunts a Google Docs, desar fitxers a Google Drive, sincronitzar exàmens a Google Calendar o enviar recordatoris per Gmail.',
                    items: [
                        { name: 'Google OAuth 2.0 Bearer Token', type: isEs ? 'Memoria activa de sesión (RAM)' : 'Memòria activa de sessió (RAM)', duration: isEs ? '1 hora (se borra al cerrar)' : '1 hora (s\'esborra en tancar)', desc: isEs ? 'Token temporal autorizado por ti ante Google para sincronizar Calendar, Drive, Docs, Sheets o Gmail sin guardar nunca tu contraseña.' : 'Token temporal autoritzat per tu davant Google per sincronitzar Calendar, Drive, Docs, Sheets o Gmail sense desar mai la teva contrasenya.' }
                    ]
                }
            ]
        };
    }

    function hideCookieBanner() {
        const banner = document.getElementById('aliat-legal-cookie-banner');
        if (banner) {
            banner.classList.add('-translate-y-4', 'opacity-0');
            setTimeout(() => {
                if (banner.parentNode) banner.parentNode.removeChild(banner);
            }, 200);
        }
    }

    function closeCookieModal() {
        const modal = document.getElementById('aliat-legal-cookie-modal');
        if (modal) {
            modal.classList.add('opacity-0');
            setTimeout(() => {
                if (modal.parentNode) modal.parentNode.removeChild(modal);
            }, 180);
        }
    }

    function renderCookieBanner() {
        if (document.getElementById('aliat-legal-cookie-banner')) return;
        const t = getTexts();

        const banner = document.createElement('aside');
        banner.id = 'aliat-legal-cookie-banner';
        banner.setAttribute('role', 'region');
        banner.setAttribute('aria-label', t.bannerBadge);
        banner.className = 'fixed top-2 sm:top-3 inset-x-0 z-[140] px-2.5 sm:px-4 pointer-events-none transition-all duration-200';
        banner.innerHTML = `
            <div class="max-w-5xl mx-auto pointer-events-auto rounded-2xl sm:rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl p-3 sm:p-5 text-zinc-900 dark:text-zinc-100">
                <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-5">
                    <div class="space-y-1.5 flex-1 min-w-0">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-sky-300 text-[10px] font-black uppercase tracking-wider">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"/><path d="M8.5 8.5v.01"/><path d="M16 15.5v.01"/><path d="M12 12v.01"/><path d="M11 17v.01"/><path d="M7 14v.01"/></svg>
                                <span>${t.bannerBadge}</span>
                            </span>
                        </div>
                        <h3 class="text-xs sm:text-sm font-extrabold text-zinc-900 dark:text-white leading-snug">${t.bannerTitle}</h3>
                        <p class="text-[11px] sm:text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed line-clamp-2 sm:line-clamp-none">${t.bannerDesc}</p>
                        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-[11px] font-bold">
                            <a href="/cookies.html" class="text-blue-600 dark:text-sky-400 hover:underline">${t.linkCookiesPolicy} ↗</a>
                            <span class="text-zinc-300 dark:text-zinc-700">·</span>
                            <a href="/privacidad.html" class="text-blue-600 dark:text-sky-400 hover:underline">${t.linkPrivacy}</a>
                            <span class="text-zinc-300 dark:text-zinc-700">·</span>
                            <a href="/condiciones.html" class="text-blue-600 dark:text-sky-400 hover:underline">${t.linkTerms}</a>
                        </div>
                    </div>

                    <div class="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
                        <button type="button" onclick="window.rejectOptionalAliatCookies()" class="flex-1 sm:flex-initial py-2 px-3.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 text-xs font-extrabold transition cursor-pointer whitespace-nowrap">
                            ${t.btnRejectOptional}
                        </button>
                        <button type="button" onclick="window.openAliatCookieSettingsModal()" class="flex-1 sm:flex-initial py-2 px-3.5 rounded-xl bg-white hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700 text-xs font-extrabold transition cursor-pointer whitespace-nowrap">
                            ${t.btnConfigure}
                        </button>
                        <button type="button" onclick="window.acceptAllAliatCookies()" class="w-full sm:w-auto py-2 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-extrabold transition cursor-pointer shadow-sm whitespace-nowrap">
                            ${t.btnAcceptAll}
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(banner);
    }

    window.openAliatCookieSettingsModal = function () {
        closeCookieModal();
        const t = getTexts();
        const current = readConsent() || {
            necessary: true,
            preferences: true,
            ai_processing: true,
            workspace: true
        };

        const categoriesHtml = t.categories.map(cat => {
            const checked = cat.required ? true : (current[cat.id] !== false);
            const rowsHtml = cat.items.map(item => `
                <div class="p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-[11px] space-y-1">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <code class="font-mono font-extrabold text-indigo-600 dark:text-indigo-400">${item.name}</code>
                        <div class="flex items-center gap-1.5">
                            <span class="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 font-semibold text-[10px]">${item.type}</span>
                            <span class="px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-sky-300 font-semibold text-[10px]">${item.duration}</span>
                        </div>
                    </div>
                    <p class="text-zinc-600 dark:text-zinc-400 leading-relaxed">${item.desc}</p>
                </div>
            `).join('');

            return `
                <div class="p-4 sm:p-5 rounded-2xl bg-zinc-50 dark:bg-zinc-950/90 border border-zinc-200/90 dark:border-zinc-800 space-y-3">
                    <div class="flex items-start justify-between gap-3">
                        <div class="space-y-1 flex-1 min-w-0">
                            <h4 class="text-xs sm:text-sm font-extrabold text-zinc-900 dark:text-white">${cat.title}</h4>
                            <p class="text-[11px] sm:text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">${cat.desc}</p>
                        </div>
                        <div class="shrink-0 pt-0.5">
                            ${cat.required
                                ? `<span class="inline-flex items-center px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-[10px] font-black">${t.alwaysActive}</span>`
                                : `<label class="relative inline-flex items-center cursor-pointer select-none">
                                    <input type="checkbox" id="cookie-cat-${cat.id}" ${checked ? 'checked' : ''} class="sr-only peer">
                                    <div class="w-11 h-6 bg-zinc-300 dark:bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                   </label>`
                            }
                        </div>
                    </div>
                    <details class="group pt-1">
                        <summary class="text-[11px] font-bold text-blue-600 dark:text-sky-400 cursor-pointer hover:underline list-none flex items-center gap-1.5">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" class="transition-transform group-open:rotate-90"><polyline points="9 18 15 12 9 6"/></svg>
                            <span>${t.viewDetails} (${cat.items.length})</span>
                        </summary>
                        <div class="mt-2.5 space-y-2">
                            ${rowsHtml}
                        </div>
                    </details>
                </div>
            `;
        }).join('');

        const modal = document.createElement('div');
        modal.id = 'aliat-legal-cookie-modal';
        modal.className = 'fixed inset-0 z-[150] bg-black/65 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto';
        modal.innerHTML = `
            <div class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl max-w-3xl w-full max-h-[92dvh] flex flex-col overflow-hidden shadow-2xl text-zinc-900 dark:text-zinc-100">
                <div class="px-5 sm:px-7 py-4 sm:py-5 border-b border-zinc-200 dark:border-zinc-800 flex items-start justify-between gap-3 shrink-0">
                    <div>
                        <span class="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-sky-300">RGPD · LOPDGDD · LSSI-CE</span>
                        <h3 class="text-base sm:text-lg font-black text-zinc-900 dark:text-white mt-1">${t.modalTitle}</h3>
                        <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">${t.modalSubtitle}</p>
                    </div>
                    <button type="button" onclick="window.closeAliatCookieSettingsModal()" class="w-8 h-8 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 flex items-center justify-center shrink-0 cursor-pointer">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>

                <div class="p-5 sm:p-7 overflow-y-auto space-y-4 flex-1 custom-scrollbar">
                    ${categoriesHtml}
                </div>

                <div class="px-5 sm:px-7 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/80 dark:bg-zinc-950/60 flex flex-wrap items-center justify-between gap-2.5 shrink-0">
                    <a href="/cookies.html" class="text-xs font-bold text-blue-600 dark:text-sky-400 hover:underline">${t.linkCookiesPolicy} ↗</a>
                    <div class="flex flex-wrap items-center gap-2">
                        <button type="button" onclick="window.rejectOptionalAliatCookies()" class="py-2 px-3.5 rounded-xl bg-zinc-200/80 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-extrabold transition cursor-pointer">
                            ${t.btnRejectOptional}
                        </button>
                        <button type="button" onclick="window.saveCustomAliatCookies()" class="py-2 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-white dark:hover:bg-zinc-200 dark:text-zinc-900 text-xs font-extrabold transition cursor-pointer">
                            ${t.savePrefsBtn}
                        </button>
                        <button type="button" onclick="window.acceptAllAliatCookies()" class="py-2 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-extrabold transition cursor-pointer shadow-xs">
                            ${t.btnAcceptAll}
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    };

    window.closeAliatCookieSettingsModal = closeCookieModal;

    window.acceptAllAliatCookies = function () {
        saveConsent({
            preferences: true,
            ai_processing: true,
            workspace: true
        });
    };

    window.rejectOptionalAliatCookies = function () {
        saveConsent({
            preferences: false,
            ai_processing: false,
            workspace: false
        });
    };

    window.saveCustomAliatCookies = function () {
        const preferences = !!document.getElementById('cookie-cat-preferences')?.checked;
        const ai_processing = !!document.getElementById('cookie-cat-ai_processing')?.checked;
        const workspace = !!document.getElementById('cookie-cat-workspace')?.checked;
        saveConsent({ preferences, ai_processing, workspace });
    };

    function updateCookieStatusBadges() {
        const el = document.getElementById('cookie-policy-live-status');
        if (!el) return;
        const c = readConsent();
        const isEs = getLang() === 'es';
        if (!c) {
            el.innerHTML = `<span class="px-3 py-1 rounded-xl bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 text-xs font-bold">${isEs ? 'Pendiente de configurar' : 'Pendent de configurar'}</span>`;
            return;
        }
        const dateStr = c.timestamp ? new Date(c.timestamp).toLocaleString(isEs ? 'es-ES' : 'ca-ES') : '';
        el.innerHTML = `
            <div class="flex flex-wrap items-center gap-2 text-xs">
                <span class="px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 font-bold inline-flex items-center gap-1">${typeof window.aliatSvg === 'function' ? window.aliatSvg('check', 'w-3.5 h-3.5') : ''}${isEs ? 'Técnicas: Activas' : 'Tècniques: Actives'}</span>
                <span class="px-2.5 py-1 rounded-lg ${c.ai_processing ? 'bg-blue-100 dark:bg-blue-950/80 text-blue-800 dark:text-sky-300' : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'} font-bold">${isEs ? 'Datos IA:' : 'Dades IA:'} ${c.ai_processing ? (isEs ? 'Autorizado' : 'Autoritzat') : (isEs ? 'Limitado' : 'Limitat')}</span>
                <span class="px-2.5 py-1 rounded-lg ${c.preferences ? 'bg-indigo-100 dark:bg-indigo-950/80 text-indigo-800 dark:text-indigo-300' : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'} font-bold">${isEs ? 'Preferencias:' : 'Preferències:'} ${c.preferences ? (isEs ? 'Activas' : 'Actives') : (isEs ? 'Rechazadas' : 'Rebutjades')}</span>
                <span class="px-2.5 py-1 rounded-lg ${c.workspace ? 'bg-purple-100 dark:bg-purple-950/80 text-purple-800 dark:text-purple-300' : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'} font-bold">Workspace: ${c.workspace ? (isEs ? 'Autorizado' : 'Autoritzat') : (isEs ? 'Desactivado' : 'Desactivat')}</span>
                ${dateStr ? `<span class="text-[11px] text-zinc-500 dark:text-zinc-400 ml-1">(${dateStr})</span>` : ''}
            </div>
        `;
    }

    function initCookieManager() {
        const existingConsent = readConsent();
        if (existingConsent) {
            enforceConsentOnStorage(existingConsent);
        } else {
            renderCookieBanner();
        }
        updateCookieStatusBadges();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCookieManager);
    } else {
        initCookieManager();
    }
})();
