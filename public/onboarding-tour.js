/**
 * Aliat Intel·ligent — Sistema d'Introducció Guiada Pas a Pas (Onboarding Tour)
 * Mini pestanyes contextuals interactives per a usuaris nous (amb sessió iniciada o sense sessió).
 * Permet saltar a l'inici o en qualsevol pas, i tornar-la a obrir en qualsevol moment.
 */
(function () {
    const STORAGE_KEYS = {
        landing: 'aliat_onboarding_landing_v1',
        guest: 'aliat_onboarding_guest_v1',
        auth: 'aliat_onboarding_auth_v1'
    };

    const state = {
        active: false,
        flow: 'landing', // 'landing' | 'guest' | 'auth'
        steps: [],
        index: -1, // -1 = pantalla inicial de benvinguda (es pot saltar d'entrada), 0..N-1 = passos
        openedMobileSidebar: false,
        targetEl: null,
        rafId: null,
        autoTimer: null
    };

    function getLang() {
        if (typeof window.getAppLanguage === 'function') {
            return window.getAppLanguage() === 'es' ? 'es' : 'ca';
        }
        if (typeof window.currentAppLang === 'string') {
            return window.currentAppLang === 'es' ? 'es' : 'ca';
        }
        const saved = localStorage.getItem('aliat_lang') || localStorage.getItem('aliat_app_language');
        return saved === 'es' ? 'es' : 'ca';
    }

    function isLoggedIn() {
        try {
            return Boolean(localStorage.getItem('aliat_token')) || document.documentElement.classList.contains('is-logged-in');
        } catch (_) {
            return false;
        }
    }

    function isElVisible(el) {
        if (!el || !el.getBoundingClientRect) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 4 && rect.height > 4;
    }

    function isLandingVisible() {
        const landing = document.getElementById('public-landing-view');
        return Boolean(landing && !landing.classList.contains('hidden') && isElVisible(landing));
    }

    function isAppVisible() {
        const app = document.getElementById('app-container');
        return Boolean(app && !app.classList.contains('hidden'));
    }

    function isAnyBlockingModalOpen() {
        const authView = document.getElementById('auth-view');
        if (authView && !authView.classList.contains('hidden')) return true;
        const cookieBanner = document.getElementById('aliat-cookie-banner');
        if (cookieBanner && isElVisible(cookieBanner)) return true;
        const cookieModal = document.getElementById('aliat-cookie-modal');
        if (cookieModal && !cookieModal.classList.contains('hidden')) return true;
        if (document.querySelector('.swal2-container')) return true;
        return false;
    }

    function detectFlow() {
        if (isLandingVisible()) return 'landing';
        if (isAppVisible()) return isLoggedIn() ? 'auth' : 'guest';
        return isLoggedIn() ? 'auth' : 'landing';
    }

    function markFlowDone(flow) {
        const key = STORAGE_KEYS[flow];
        if (!key) return;
        try {
            localStorage.setItem(key, 'done');
        } catch (_) {}
    }

    function isFlowDone(flow) {
        const key = STORAGE_KEYS[flow];
        if (!key) return false;
        try {
            return Boolean(localStorage.getItem(key));
        } catch (_) {
            return false;
        }
    }

    function getCopy(isEs) {
        return {
            introBadge: isEs ? 'Guía rápida · Paso a paso' : 'Guia ràpida · Pas a pas',
            stepOf: (cur, total) => isEs ? `Paso ${cur} de ${total}` : `Pas ${cur} de ${total}`,
            clickCue: isEs ? 'Haz clic aquí:' : 'Fes clic aquí:',
            skipStart: isEs ? 'Saltar introducción' : 'Saltar introducció',
            skipStep: isEs ? 'Saltar' : 'Saltar',
            startBtn: isEs ? 'Empezar guía' : 'Començar guia',
            prevBtn: isEs ? 'Anterior' : 'Anterior',
            nextBtn: isEs ? 'Siguiente' : 'Següent',
            finishBtn: isEs ? 'Finalizar' : 'Finalitzar',
            hintEsc: isEs ? 'Puedes saltar en cualquier momento' : 'Pots saltar en qualsevol moment',
            flows: {
                landing: {
                    introTitle: isEs ? 'Te enseñamos Aliat en 4 clics' : 'T’ensenyem Aliat en 4 clics',
                    introDesc: isEs
                        ? 'Antes de empezar o iniciar sesión, estas mini pestañas te mostrarán dónde hacer clic y para qué sirve cada zona.'
                        : 'Abans de començar o iniciar sessió, aquestes mini pestanyes t’indicaran on fer clic i per a què serveix cada zona.',
                    steps: [
                        {
                            selector: '#landing-lang-theme-controls',
                            actionLabel: isEs ? 'Selector de idioma y tema' : 'Selector d’idioma i tema',
                            title: isEs ? 'Personaliza idioma y apariencia' : 'Personalitza idioma i aparença',
                            desc: isEs
                                ? 'Cambia entre Català y Español al instante o alterna entre modo claro y oscuro según tu comodidad.'
                                : 'Canvia entre Català i Español a l’instant o alterna entre mode clar i fosc segons la teva comoditat.'
                        },
                        {
                            selector: '#landing-auth-btn',
                            actionLabel: isEs ? 'Botón «Acceder / Iniciar Sesión»' : 'Botó «Accedir / Iniciar Sessió»',
                            title: isEs ? 'Entra con Google o correo' : 'Entra amb Google o correu',
                            desc: isEs
                                ? 'Inicia sesión para guardar conversaciones en la nube, subir apuntes PDF, usar la cámara OCR y conectar Google Workspace.'
                                : 'Inicia sessió per desar converses al núvol, pujar apunts PDF, fer servir la càmera OCR i connectar Google Workspace.'
                        },
                        {
                            selector: '#landing-guest-btn',
                            actionLabel: isEs ? 'Botón «Probar sin sesión»' : 'Botó «Provar sense sessió»',
                            title: isEs ? 'Prueba el chat al instante sin cuenta' : 'Prova el xat a l’instant sense compte',
                            desc: isEs
                                ? 'Si prefieres explorar primero, haz clic aquí para entrar directamente en el modo invitado y chatear con Aliat.'
                                : 'Si prefereixes explorar primer, fes clic aquí per entrar directament al mode convidat i xatejar amb Aliat.'
                        },
                        {
                            selector: '#landing-modos',
                            actionLabel: isEs ? 'Tarjetas de Modos de Trabajo' : 'Targetes de Modes de Treball',
                            title: isEs ? 'Elige el modo según tu objetivo' : 'Tria el mode segons el teu objectiu',
                            desc: isEs
                                ? 'Usa Pla d’Estudis para exámenes, XatBot para resolver dudas libres o Ús Quotidià para redactar textos y organizar tu día.'
                                : 'Utilitza Pla d’Estudis per a exàmens, XatBot per a dubtes lliures o Ús Quotidià per redactar textos i organitzar el dia.'
                        }
                    ]
                },
                guest: {
                    introTitle: isEs ? 'Recorrido rápido en modo sin sesión' : 'Recorregut ràpid en mode sense sessió',
                    introDesc: isEs
                        ? 'Descubre con estas mini pestañas dónde hacer clic para probar los chats, juegos y cómo iniciar sesión cuando quieras.'
                        : 'Descobreix amb aquestes mini pestanyes on fer clic per provar els xats, jocs i com iniciar sessió quan vulguis.',
                    steps: [
                        {
                            selector: '#sidebar-mode-study, #welcome-view .grid, #global-menu-btn',
                            requiresSidebarOnMobile: true,
                            actionLabel: isEs ? 'Modos en el menú lateral' : 'Modes al menú lateral',
                            title: isEs ? 'Cambia entre los 3 modos principales' : 'Canvia entre els 3 modes principals',
                            desc: isEs
                                ? 'Pulsa Pla d’Estudis para organizar exámenes, XatBot para preguntar cualquier tema o Ús Quotidià para tareas prácticas.'
                                : 'Prem Pla d’Estudis per organitzar exàmens, XatBot per preguntar qualsevol tema o Ús Quotidià per a tasques pràctiques.'
                        },
                        {
                            selector: '#welcome-view .grid, #chat-form, #setup-view',
                            actionLabel: isEs ? 'Área principal de trabajo' : 'Àrea principal de treball',
                            title: isEs ? 'Haz clic para abrir tu primer espacio' : 'Fes clic per obrir el teu primer espai',
                            desc: isEs
                                ? 'Selecciona una de estas tarjetas (o escribe directamente en la barra de chat si ya estás dentro) para empezar a interactuar.'
                                : 'Selecciona una d’aquestes targetes (o escriu directament a la barra de xat si ja hi ets dins) per començar a interactuar.'
                        },
                        {
                            selector: '#games-header-btn, #notebook-header-btn, #welcome-view .grid button:first-child',
                            actionLabel: isEs ? 'Juegos y Gemini Notebook' : 'Jocs i Gemini Notebook',
                            title: isEs ? 'Practica con juegos y cuadernos IA' : 'Practica amb jocs i quaderns IA',
                            desc: isEs
                                ? 'Dentro del chat encontrarás acceso rápido al Laboratorio de 6 Juegos Interactivos y a Gemini Notebook para estudiar con fuentes.'
                                : 'Dins del xat trobaràs accés ràpid al Laboratori de 6 Jocs Interactius i a Gemini Notebook per estudiar amb fonts.'
                        },
                        {
                            selector: '#guest-mode-banner button[onclick*="openAuthModal"]',
                            actionLabel: isEs ? 'Botón «Acceder / Iniciar Sesión»' : 'Botó «Accedir / Iniciar Sessió»',
                            title: isEs ? 'Desbloquea todas las herramientas' : 'Desbloqueja totes les eines',
                            desc: isEs
                                ? 'Cuando quieras guardar tu historial en la nube, subir PDFs o conectar Google Workspace, haz clic aquí para iniciar sesión.'
                                : 'Quan vulguis desar el teu historial al núvol, pujar PDFs o connectar Google Workspace, fes clic aquí per iniciar sessió.'
                        }
                    ]
                },
                auth: {
                    introTitle: isEs ? 'Bienvenido a tu espacio completo' : 'Benvingut al teu espai complet',
                    introDesc: isEs
                        ? 'Te guiamos en 5 mini pestañas por las funciones clave para estudiar, jugar, usar el menú de herramientas y guardar tu progreso.'
                        : 'Et guiem en 5 mini pestanyes per les funcions clau per estudiar, jugar, fer servir el menú d’eines i desar el teu progrés.',
                    steps: [
                        {
                            selector: '#sidebar-new-session-btn',
                            requiresSidebarOnMobile: true,
                            actionLabel: isEs ? 'Botón «Nueva conversación» y Modos' : 'Botó «Nova conversa» i Modes',
                            title: isEs ? 'Inicia chats o cambia de espacio' : 'Inicia xats o canvia d’espai',
                            desc: isEs
                                ? 'Desde el menú izquierdo puedes crear una sesión nueva o alternar en un clic entre Pla d’Estudis, XatBot y Ús Quotidià.'
                                : 'Des del menú esquerre pots crear una sessió nova o alternar en un clic entre Pla d’Estudis, XatBot i Ús Quotidià.'
                        },
                        {
                            selector: '#chat-form, #setup-view button[onclick*="generatePlan"], #welcome-view .grid',
                            actionLabel: isEs ? 'Zona de creación y conversación' : 'Zona de creació i conversa',
                            title: isEs ? 'Empieza tu plan o pregunta a la IA' : 'Comença el teu pla o pregunta a la IA',
                            desc: isEs
                                ? 'Elige un modo aquí (o configura tu fecha de examen y PDFs en Pla d’Estudis) para recibir explicaciones paso a paso.'
                                : 'Tria un mode aquí (o configura la data d’examen i PDFs a Pla d’Estudis) per rebre explicacions pas a pas.'
                        },
                        {
                            selector: '#chat-plus-btn, #sidebar-mode-study',
                            requiresSidebarOnMobile: true,
                            actionLabel: isEs ? 'Botón «+» y Herramientas de estudio' : 'Botó «+» i Eines d’estudi',
                            title: isEs ? 'Sube PDFs, usa Google Workspace y más' : 'Puja PDFs, fes servir Google Workspace i més',
                            desc: isEs
                                ? 'Al entrar al chat verás el botón «+» con 4 carpetas: Google Workspace, Generador de Imágenes/Vídeo/OCR, Tests/Mapas y Pomodoro.'
                                : 'En entrar al xat veuràs el botó «+» amb 4 carpetes: Google Workspace, Generador d’Imatges/Vídeo/OCR, Tests/Mapes i Pomodoro.'
                        },
                        {
                            selector: '#games-header-btn, #notebook-header-btn, #sidebar-nav-history-btn',
                            requiresSidebarOnMobile: true,
                            actionLabel: isEs ? 'Jocs, Notebook e Historial' : 'Jocs, Notebook i Historial',
                            title: isEs ? 'Juegos activos, Notebook y tu Historial' : 'Jocs actius, Notebook i el teu Historial',
                            desc: isEs
                                ? 'Practica con 6 juegos interactivos, genera guías con citas en Gemini Notebook y recupera cualquier sesión desde el Historial.'
                                : 'Practica amb 6 jocs interactius, genera guies amb citacions a Gemini Notebook i recupera qualsevol sessió des de l’Historial.'
                        },
                        {
                            selector: '#sidebar-settings-btn',
                            requiresSidebarOnMobile: true,
                            actionLabel: isEs ? 'Icono de Configuración' : 'Icona de Configuració',
                            title: isEs ? 'Idioma, tema, clave API y cookies' : 'Idioma, tema, clau API i cookies',
                            desc: isEs
                                ? 'Haz clic aquí en cualquier momento para cambiar entre Català/Español, modo oscuro, añadir tu API key personal o ajustar la privacidad.'
                                : 'Fes clic aquí en qualsevol moment per canviar entre Català/Español, mode fosc, afegir la teva API key personal o ajustar la privadesa.'
                        }
                    ]
                }
            }
        };
    }

    function ensureStyles() {
        if (document.getElementById('aliat-onboarding-styles')) return;
        const style = document.createElement('style');
        style.id = 'aliat-onboarding-styles';
        style.textContent = `
            @keyframes aliatTourFadeIn {
                from { opacity: 0; transform: translateY(6px) scale(0.985); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }
            #aliat-onboarding-root {
                position: fixed;
                inset: 0;
                z-index: 260;
                pointer-events: none;
            }
            #aliat-onboarding-backdrop {
                position: fixed;
                inset: 0;
                pointer-events: auto;
            }
            #aliat-onboarding-spotlight {
                position: fixed;
                border-radius: 14px;
                border: 2px solid #2563eb;
                box-shadow: 0 0 0 9999px rgba(9, 9, 11, 0.56), 0 0 0 5px rgba(37, 99, 235, 0.24);
                pointer-events: none;
                transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.18s ease;
                z-index: 261;
            }
            html.dark #aliat-onboarding-spotlight {
                border-color: #38bdf8;
                box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.68), 0 0 0 5px rgba(56, 189, 248, 0.25);
            }
            #aliat-onboarding-card {
                position: fixed;
                pointer-events: auto;
                z-index: 262;
                width: min(350px, calc(100vw - 24px));
                animation: aliatTourFadeIn 0.18s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            }
            #aliat-onboarding-arrow {
                position: absolute;
                width: 12px;
                height: 12px;
                transform: rotate(45deg);
            }
            @media (prefers-reduced-motion: reduce) {
                #aliat-onboarding-card,
                #aliat-onboarding-spotlight {
                    animation: none !important;
                    transition: none !important;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function restoreMobileSidebarIfNeeded() {
        if (!state.openedMobileSidebar) return;
        state.openedMobileSidebar = false;
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('mobile-overlay');
        if (sidebar && window.innerWidth < 768) {
            sidebar.classList.add('-translate-x-full');
        }
        if (overlay && window.innerWidth < 768) {
            overlay.classList.add('hidden', 'opacity-0');
        }
    }

    function openMobileSidebarForStep() {
        if (window.innerWidth >= 768) return;
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;
        if (sidebar.classList.contains('-translate-x-full')) {
            sidebar.classList.remove('-translate-x-full');
            state.openedMobileSidebar = true;
        }
    }

    function resolveTargetElement(selectorList) {
        if (!selectorList) return null;
        const candidates = String(selectorList).split(',').map(s => s.trim()).filter(Boolean);
        for (const sel of candidates) {
            try {
                const el = document.querySelector(sel);
                if (el && isElVisible(el)) return el;
            } catch (_) {}
        }
        return null;
    }

    function cleanupDOM(keepMobileSidebar = false) {
        if (!keepMobileSidebar) restoreMobileSidebarIfNeeded();
        if (state.rafId) {
            cancelAnimationFrame(state.rafId);
            state.rafId = null;
        }
        const root = document.getElementById('aliat-onboarding-root');
        if (root) root.remove();
        state.targetEl = null;
    }

    function stopTour(markCompleted = true) {
        if (markCompleted && state.flow) {
            markFlowDone(state.flow);
        }
        state.active = false;
        state.index = -1;
        cleanupDOM(false);
    }

    function positionCardAndSpotlight() {
        if (!state.active) return;
        const card = document.getElementById('aliat-onboarding-card');
        const spotlight = document.getElementById('aliat-onboarding-spotlight');
        const backdrop = document.getElementById('aliat-onboarding-backdrop');
        const arrow = document.getElementById('aliat-onboarding-arrow');
        if (!card) return;

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const cardRect = card.getBoundingClientRect();
        const cardW = cardRect.width || Math.min(350, vw - 24);
        const cardH = cardRect.height || 210;
        const pad = 12;

        // Intro screen (index === -1) or fallback without target element
        if (state.index < 0 || !state.targetEl || !isElVisible(state.targetEl)) {
            if (spotlight) spotlight.style.display = 'none';
            if (arrow) arrow.style.display = 'none';
            if (backdrop) {
                backdrop.style.background = 'rgba(9, 9, 11, 0.56)';
                backdrop.style.backdropFilter = 'blur(2px)';
            }
            const left = Math.max(pad, Math.round((vw - cardW) / 2));
            const top = Math.max(pad, Math.min(vh - cardH - pad, Math.round((vh - cardH) / 2)));
            card.style.left = left + 'px';
            card.style.top = top + 'px';
            return;
        }

        if (backdrop) {
            backdrop.style.background = 'transparent';
            backdrop.style.backdropFilter = 'none';
        }

        const r = state.targetEl.getBoundingClientRect();
        const spotPad = 6;
        const sx = Math.max(4, Math.round(r.left - spotPad));
        const sy = Math.max(4, Math.round(r.top - spotPad));
        const sw = Math.min(vw - sx - 4, Math.round(r.width + spotPad * 2));
        const sh = Math.min(vh - sy - 4, Math.round(r.height + spotPad * 2));

        if (spotlight) {
            spotlight.style.display = 'block';
            spotlight.style.left = sx + 'px';
            spotlight.style.top = sy + 'px';
            spotlight.style.width = Math.max(24, sw) + 'px';
            spotlight.style.height = Math.max(24, sh) + 'px';
        }

        const gap = 14;
        const spaceBelow = vh - (sy + sh) - pad;
        const spaceAbove = sy - pad;
        const spaceRight = vw - (sx + sw) - pad;
        const spaceLeft = sx - pad;

        let placement = 'bottom';
        if (spaceBelow >= cardH + gap) placement = 'bottom';
        else if (spaceAbove >= cardH + gap) placement = 'top';
        else if (vw >= 640 && spaceRight >= cardW + gap) placement = 'right';
        else if (vw >= 640 && spaceLeft >= cardW + gap) placement = 'left';
        else placement = spaceBelow >= spaceAbove ? 'bottom' : 'top';

        let left = 0;
        let top = 0;

        if (placement === 'bottom') {
            top = Math.min(vh - cardH - pad, sy + sh + gap);
            left = Math.max(pad, Math.min(vw - cardW - pad, sx + sw / 2 - cardW / 2));
        } else if (placement === 'top') {
            top = Math.max(pad, sy - cardH - gap);
            left = Math.max(pad, Math.min(vw - cardW - pad, sx + sw / 2 - cardW / 2));
        } else if (placement === 'right') {
            left = Math.min(vw - cardW - pad, sx + sw + gap);
            top = Math.max(pad, Math.min(vh - cardH - pad, sy + sh / 2 - cardH / 2));
        } else {
            left = Math.max(pad, sx - cardW - gap);
            top = Math.max(pad, Math.min(vh - cardH - pad, sy + sh / 2 - cardH / 2));
        }

        card.style.left = Math.round(left) + 'px';
        card.style.top = Math.round(top) + 'px';

        if (arrow) {
            arrow.style.display = 'block';
            arrow.style.left = '';
            arrow.style.right = '';
            arrow.style.top = '';
            arrow.style.bottom = '';
            arrow.style.borderTop = '';
            arrow.style.borderLeft = '';
            arrow.style.borderRight = '';
            arrow.style.borderBottom = '';

            const targetCenterX = sx + sw / 2;
            const targetCenterY = sy + sh / 2;

            if (placement === 'bottom') {
                const arrowX = Math.max(18, Math.min(cardW - 30, targetCenterX - left - 6));
                arrow.style.top = '-7px';
                arrow.style.left = Math.round(arrowX) + 'px';
                arrow.className = 'bg-white dark:bg-zinc-900 border-t border-l border-zinc-200 dark:border-zinc-700';
            } else if (placement === 'top') {
                const arrowX = Math.max(18, Math.min(cardW - 30, targetCenterX - left - 6));
                arrow.style.bottom = '-7px';
                arrow.style.left = Math.round(arrowX) + 'px';
                arrow.className = 'bg-white dark:bg-zinc-900 border-b border-r border-zinc-200 dark:border-zinc-700';
            } else if (placement === 'right') {
                const arrowY = Math.max(18, Math.min(cardH - 30, targetCenterY - top - 6));
                arrow.style.left = '-7px';
                arrow.style.top = Math.round(arrowY) + 'px';
                arrow.className = 'bg-white dark:bg-zinc-900 border-b border-l border-zinc-200 dark:border-zinc-700';
            } else {
                const arrowY = Math.max(18, Math.min(cardH - 30, targetCenterY - top - 6));
                arrow.style.right = '-7px';
                arrow.style.top = Math.round(arrowY) + 'px';
                arrow.className = 'bg-white dark:bg-zinc-900 border-t border-r border-zinc-200 dark:border-zinc-700';
            }
        }
    }

    function renderTourUI() {
        ensureStyles();
        const nextStepNeedsSidebar = state.index >= 0 && state.steps[state.index] && state.steps[state.index].requiresSidebarOnMobile;
        cleanupDOM(Boolean(nextStepNeedsSidebar));

        const isEs = getLang() === 'es';
        const copy = getCopy(isEs);
        const flowData = copy.flows[state.flow] || copy.flows.landing;
        const steps = state.steps;

        const root = document.createElement('div');
        root.id = 'aliat-onboarding-root';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');

        const backdrop = document.createElement('div');
        backdrop.id = 'aliat-onboarding-backdrop';
        backdrop.addEventListener('click', (e) => {
            if (state.targetEl && isElVisible(state.targetEl)) {
                const r = state.targetEl.getBoundingClientRect();
                if (e.clientX >= r.left - 6 && e.clientX <= r.right + 6 && e.clientY >= r.top - 6 && e.clientY <= r.bottom + 6) {
                    const stack = document.elementsFromPoint ? document.elementsFromPoint(e.clientX, e.clientY) : [];
                    const realTarget = stack.find(el => el && !el.id?.startsWith('aliat-onboarding') && !el.closest?.('#aliat-onboarding-root')) || state.targetEl;
                    if (realTarget && typeof realTarget.click === 'function') {
                        const isLast = state.index >= state.steps.length - 1;
                        if (isLast) stopTour(true);
                        realTarget.click();
                        return;
                    }
                }
            }
        });
        root.appendChild(backdrop);

        const spotlight = document.createElement('div');
        spotlight.id = 'aliat-onboarding-spotlight';
        root.appendChild(spotlight);

        const card = document.createElement('div');
        card.id = 'aliat-onboarding-card';
        card.className = 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700 rounded-2xl shadow-2xl p-4 sm:p-5';

        const arrow = document.createElement('div');
        arrow.id = 'aliat-onboarding-arrow';
        card.appendChild(arrow);

        if (state.index < 0) {
            state.targetEl = null;

            const topRow = document.createElement('div');
            topRow.className = 'flex items-center justify-between gap-2 mb-2.5';

            const label = document.createElement('span');
            label.className = 'text-[11px] font-bold text-blue-600 dark:text-sky-400 tracking-tight';
            label.textContent = `${copy.introBadge} · ${steps.length} ${isEs ? 'pasos' : 'passos'}`;

            const skipTopBtn = document.createElement('button');
            skipTopBtn.type = 'button';
            skipTopBtn.className = 'text-[11px] font-semibold text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white px-2 py-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer shrink-0';
            skipTopBtn.textContent = copy.skipStep;
            skipTopBtn.addEventListener('click', () => stopTour(true));

            topRow.appendChild(label);
            topRow.appendChild(skipTopBtn);
            card.appendChild(topRow);

            const title = document.createElement('h3');
            title.className = 'text-base font-extrabold text-zinc-900 dark:text-white tracking-tight mb-1.5';
            title.textContent = flowData.introTitle;
            card.appendChild(title);

            const desc = document.createElement('p');
            desc.className = 'text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed mb-4';
            desc.textContent = flowData.introDesc;
            card.appendChild(desc);

            const actions = document.createElement('div');
            actions.className = 'flex items-center justify-between gap-2 pt-3 border-t border-zinc-100 dark:border-zinc-800';

            const skipBtn = document.createElement('button');
            skipBtn.type = 'button';
            skipBtn.className = 'px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer whitespace-nowrap';
            skipBtn.textContent = copy.skipStart;
            skipBtn.addEventListener('click', () => stopTour(true));

            const startBtn = document.createElement('button');
            startBtn.type = 'button';
            startBtn.className = 'px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-zinc-900 text-xs font-bold transition cursor-pointer whitespace-nowrap shadow-xs';
            startBtn.textContent = copy.startBtn;
            startBtn.addEventListener('click', () => goToStep(0));

            actions.appendChild(skipBtn);
            actions.appendChild(startBtn);
            card.appendChild(actions);
        } else {
            const step = steps[state.index];
            if (step && step.requiresSidebarOnMobile) {
                openMobileSidebarForStep();
            }
            const target = step ? resolveTargetElement(step.selector) : null;
            state.targetEl = target;

            if (target && typeof target.scrollIntoView === 'function') {
                try {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
                } catch (_) {}
            }

            const topRow = document.createElement('div');
            topRow.className = 'flex items-center justify-between gap-2 mb-2';

            const counter = document.createElement('span');
            counter.className = 'text-[11px] font-bold text-blue-600 dark:text-sky-400 tabular-nums';
            counter.textContent = `${copy.stepOf(state.index + 1, steps.length)} · ${copy.clickCue} ${step.actionLabel}`;

            const skipBtn = document.createElement('button');
            skipBtn.type = 'button';
            skipBtn.className = 'text-[11px] font-semibold text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white px-2 py-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer shrink-0';
            skipBtn.textContent = copy.skipStep;
            skipBtn.addEventListener('click', () => stopTour(true));

            topRow.appendChild(counter);
            topRow.appendChild(skipBtn);
            card.appendChild(topRow);

            const title = document.createElement('h3');
            title.className = 'text-sm sm:text-[15px] font-extrabold text-zinc-900 dark:text-white tracking-tight mb-1';
            title.textContent = step.title;
            card.appendChild(title);

            const desc = document.createElement('p');
            desc.className = 'text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed mb-3.5';
            desc.textContent = step.desc;
            card.appendChild(desc);

            // Progress bar
            const progressWrap = document.createElement('div');
            progressWrap.className = 'flex items-center gap-1 mb-3';
            steps.forEach((_, idx) => {
                const seg = document.createElement('span');
                seg.className = idx <= state.index
                    ? 'h-1 flex-1 rounded-full bg-blue-600 dark:bg-sky-400 transition-colors'
                    : 'h-1 flex-1 rounded-full bg-zinc-200 dark:bg-zinc-800 transition-colors';
                progressWrap.appendChild(seg);
            });
            card.appendChild(progressWrap);

            const footer = document.createElement('div');
            footer.className = 'flex items-center justify-between gap-2 pt-2.5 border-t border-zinc-100 dark:border-zinc-800';

            const leftGroup = document.createElement('div');
            leftGroup.className = 'flex items-center gap-1.5';

            if (state.index > 0) {
                const prevBtn = document.createElement('button');
                prevBtn.type = 'button';
                prevBtn.className = 'px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer whitespace-nowrap';
                prevBtn.textContent = copy.prevBtn;
                prevBtn.addEventListener('click', () => goToStep(state.index - 1));
                leftGroup.appendChild(prevBtn);
            } else {
                const hint = document.createElement('span');
                hint.className = 'text-[10.5px] text-zinc-400 dark:text-zinc-500';
                hint.textContent = copy.hintEsc;
                leftGroup.appendChild(hint);
            }

            const isLast = state.index === steps.length - 1;
            const nextBtn = document.createElement('button');
            nextBtn.type = 'button';
            nextBtn.className = 'px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition cursor-pointer whitespace-nowrap shadow-xs';
            nextBtn.textContent = isLast ? copy.finishBtn : copy.nextBtn;
            nextBtn.addEventListener('click', () => {
                if (isLast) stopTour(true);
                else goToStep(state.index + 1);
            });

            footer.appendChild(leftGroup);
            footer.appendChild(nextBtn);
            card.appendChild(footer);
        }

        root.appendChild(card);
        document.body.appendChild(root);

        positionCardAndSpotlight();
        // Recalculate after scroll settles (e.g., mobile sidebar slide or smooth scroll)
        setTimeout(positionCardAndSpotlight, 180);
        setTimeout(positionCardAndSpotlight, 360);
    }

    function goToStep(idx) {
        if (idx < -1 || idx >= state.steps.length) {
            stopTour(true);
            return;
        }
        state.index = idx;
        renderTourUI();
    }

    function buildStepsForFlow(flow) {
        const isEs = getLang() === 'es';
        const copy = getCopy(isEs);
        const flowData = copy.flows[flow] || copy.flows.landing;
        // Filter out steps whose target cannot be resolved unless they require mobile sidebar (handled at step render)
        return flowData.steps.filter((s) => {
            if (s.requiresSidebarOnMobile) return true;
            return Boolean(resolveTargetElement(s.selector));
        });
    }

    window.startAliatOnboarding = function (requestedFlow = 'auto', forceReplay = false) {
        const flow = requestedFlow === 'auto' ? detectFlow() : requestedFlow;
        if (!forceReplay && isFlowDone(flow)) return;
        if (!forceReplay && isAnyBlockingModalOpen()) return;

        const steps = buildStepsForFlow(flow);
        if (!steps || steps.length === 0) return;

        state.active = true;
        state.flow = flow;
        state.steps = steps;
        state.index = -1; // Always open with intro mini-tab so user can skip at the start
        renderTourUI();
    };

    window.stopAliatOnboarding = function (markDone = true) {
        stopTour(markDone);
    };

    window.refreshAliatOnboardingLang = function () {
        if (!state.active) return;
        const currentIdx = state.index;
        const steps = buildStepsForFlow(state.flow);
        if (steps && steps.length > 0) {
            state.steps = steps;
            state.index = Math.min(currentIdx, steps.length - 1);
            renderTourUI();
        }
    };

    function scheduleAutoCheck(delayMs = 700) {
        if (state.autoTimer) clearTimeout(state.autoTimer);
        state.autoTimer = setTimeout(() => {
            if (state.active) return;
            if (window.location.search.includes('share=')) return;
            const flow = detectFlow();
            if (isFlowDone(flow)) return;
            if (isAnyBlockingModalOpen()) {
                // Retry calmly once cookies or login dialog closes
                return;
            }
            window.startAliatOnboarding(flow, false);
        }, delayMs);
    }

    // Event bindings for resize, scroll, keyboard & lifecycle transitions
    window.addEventListener('resize', () => {
        if (state.active) positionCardAndSpotlight();
    });

    window.addEventListener('scroll', () => {
        if (state.active) {
            if (state.rafId) cancelAnimationFrame(state.rafId);
            state.rafId = requestAnimationFrame(positionCardAndSpotlight);
        }
    }, true);

    document.addEventListener('keydown', (e) => {
        if (!state.active) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            stopTour(true);
        } else if (e.key === 'ArrowRight') {
            if (state.index < state.steps.length - 1) goToStep(state.index + 1);
        } else if (e.key === 'ArrowLeft') {
            if (state.index > 0) goToStep(state.index - 1);
        }
    });

    // Trigger onboarding smoothly once cookie banner is handled
    window.addEventListener('aliat:cookie-consent-updated', () => {
        scheduleAutoCheck(550);
    });

    // Hook into enterGuestMode & applyAuthSuccess so first-time users get guided automatically
    function hookLifecycleFunctions() {
        if (typeof window.enterGuestMode === 'function' && !window.enterGuestMode._onboardingHooked) {
            const origGuest = window.enterGuestMode;
            window.enterGuestMode = function (...args) {
                if (state.active) stopTour(false);
                const res = origGuest.apply(this, args);
                scheduleAutoCheck(550);
                return res;
            };
            window.enterGuestMode._onboardingHooked = true;
        }

        if (typeof window.applyAuthSuccess === 'function' && !window.applyAuthSuccess._onboardingHooked) {
            const origAuth = window.applyAuthSuccess;
            window.applyAuthSuccess = function (...args) {
                if (state.active) stopTour(false);
                const res = origAuth.apply(this, args);
                scheduleAutoCheck(650);
                return res;
            };
            window.applyAuthSuccess._onboardingHooked = true;
        }

        if (typeof window.openAuthModal === 'function' && !window.openAuthModal._onboardingHooked) {
            const origOpenAuth = window.openAuthModal;
            window.openAuthModal = function (...args) {
                if (state.active) stopTour(false);
                return origOpenAuth.apply(this, args);
            };
            window.openAuthModal._onboardingHooked = true;
        }
    }

    function init() {
        hookLifecycleFunctions();
        scheduleAutoCheck(900);
        // Re-check hooks right after window load in case inline script defined functions later
        window.addEventListener('load', () => {
            hookLifecycleFunctions();
            scheduleAutoCheck(900);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
