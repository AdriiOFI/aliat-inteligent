/**
 * Aliat Intel·ligent — Sistema d'Introducció Guiada Pas a Pas (Onboarding Tour)
 * Mini pestanyes contextuals interactives per a usuaris nous (amb sessió iniciada o sense sessió).
 * Entra dins dels xats per explicar cada mode, els botons superiors, el menú «+» i la barra d'eines.
 * Permet saltar a l'inici o en qualsevol pas, i tornar-la a obrir en qualsevol moment.
 */
(function () {
    const STORAGE_KEYS = {
        landing: 'aliat_onboarding_landing_v1',
        guest: 'aliat_onboarding_guest_v2',
        auth: 'aliat_onboarding_auth_v2',
        maps: 'aliat_onboarding_maps_v1'
    };

    const state = {
        active: false,
        flow: 'landing', // 'landing' | 'guest' | 'auth' | 'maps'
        steps: [],
        index: -1, // -1 = pantalla inicial de benvinguda, 0..N-1 = passos
        openedMobileSidebar: false,
        targetEl: null,
        snapshot: null,
        hasUserChatAtStart: false,
        transitionToken: 0,
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
        try {
            const saved = localStorage.getItem('aliat_lang') || localStorage.getItem('aliat_app_language');
            return saved === 'es' ? 'es' : 'ca';
        } catch (_) {
            return 'ca';
        }
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

    function isMapsModalOpen() {
        const mapsModal = document.getElementById('daily-maps-modal');
        return Boolean(mapsModal && !mapsModal.classList.contains('hidden'));
    }

    function isAnyBlockingModalOpen(requestedFlow = '') {
        const authView = document.getElementById('auth-view');
        if (authView && !authView.classList.contains('hidden')) return true;
        const cookieBanner = document.getElementById('aliat-cookie-banner');
        if (cookieBanner && isElVisible(cookieBanner)) return true;
        const cookieModal = document.getElementById('aliat-cookie-modal');
        if (cookieModal && !cookieModal.classList.contains('hidden')) return true;
        if (document.querySelector('.swal2-container')) return true;
        if (requestedFlow !== 'maps' && isMapsModalOpen()) return true;
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

    function getTourHooks() {
        return window._aliatTourHooks || null;
    }

    function buildInAppSteps(isEs, isGuestFlow, hasUserChat) {
        const hooks = getTourHooks();
        const steps = [];

        if (!hasUserChat) {
            steps.push({
                selector: '#sidebar-mode-study, #welcome-view .grid',
                requiresSidebarOnMobile: true,
                onEnter: async () => {
                    if (hooks) hooks.closeAllMenus();
                    if (typeof window.backToHome === 'function') await window.backToHome();
                },
                actionLabel: isEs ? 'Los 3 modos de chat' : 'Els 3 modes de xat',
                title: isEs ? 'Tres espacios diseñados para cada tarea' : 'Tres espais dissenyats per a cada tasca',
                desc: isEs
                    ? 'Vamos a entrar dentro de cada chat para enseñarte qué hace y todos sus botones. Puedes cambiar de modo aquí en cualquier momento:'
                    : 'Entrarem dins de cada xat per ensenyar-te què fa i tots els seus botons. Pots canviar de mode aquí en qualsevol moment:',
                bullets: isEs
                    ? [
                        'Pla d’Estudis: planificador con fecha de examen, PDFs, calendario, diagnóstico y seguimiento.',
                        'XatBot: resolución libre de dudas paso a paso o charla abierta con internet en directo.',
                        'Ús Quotidià: redacción rápida, correos, tablas, Google Workspace y recordatorios.'
                    ]
                    : [
                        'Pla d’Estudis: planificador amb data d’examen, PDFs, calendari, diagnòstic i seguiment.',
                        'XatBot: resolució lliure de dubtes pas a pas o xerrada oberta amb internet en directe.',
                        'Ús Quotidià: redacció ràpida, correus, taules, Google Workspace i recordatoris.'
                    ]
            });

            if (!isGuestFlow) {
                steps.push({
                    selector: '#setup-view h1, #setup-view',
                    onEnter: async () => {
                        if (hooks) await hooks.enterStudySetupOrChat();
                    },
                    actionLabel: isEs ? 'Modo Pla d’Estudis' : 'Mode Pla d’Estudis',
                    title: isEs ? '1. Pla d’Estudis: tu entrenador de exámenes' : '1. Pla d’Estudis: el teu entrenador d’exàmens',
                    desc: isEs
                        ? 'En este modo indicas la fecha de tu examen, qué días puedes estudiar y subes tus apuntes en PDF:'
                        : 'En aquest mode indiques la data del teu examen, quins dies pots estudiar i puges els teus apunts en PDF:',
                    bullets: isEs
                        ? [
                            'Crea automáticamente un calendario repartido por sesiones reales.',
                            'Genera un minijuego diagnóstico para medir tu nivel antes de empezar.',
                            'Adapta cada clase del chat a tus PDFs, nivel y tiempo disponible.'
                        ]
                        : [
                            'Crea automàticament un calendari repartit per sessions reals.',
                            'Genera un minijoc diagnòstic per mesurar el teu nivell abans de començar.',
                            'Adapta cada classe del xat als teus PDFs, nivell i temps disponible.'
                        ]
                });
            }

            steps.push({
                selector: '#notebook-header-btn, #tools-header-btn, #memory-header-btn',
                onEnter: async () => {
                    if (hooks) await hooks.enterStudyChat();
                    else if (typeof window.startStudyMode === 'function') await window.startStudyMode(false);
                },
                actionLabel: isEs ? 'Botones superiores del chat' : 'Botons superiors del xat',
                title: isEs ? 'AliatNotebook, Eines (con Jocs) y Memòria (con Calendari)' : 'AliatNotebook, Eines (amb Jocs) i Memòria (amb Calendari)',
                desc: isEs
                    ? 'En la barra superior del chat tienes todo organizado en 3 botones principales:'
                    : 'A la barra superior del xat tens tot organitzat en 3 botons principals:',
                bullets: isEs
                    ? [
                        'AliatNotebook: cuaderno multifuente con citas clicables [Font X], 8 generadores en 1 clic y Podcast IA a 2 voces.',
                        'Eines: incluye el Laboratorio de 6 Jocs de aprendizaje activo, generador de examen, mapas mentales y Google Workspace.',
                        'Memòria: revisa tus puntos, resultados y pulsa el botón «Calendari del Pla d’Estudi» para ver y marcar todas las sesiones por día.'
                    ]
                    : [
                        'AliatNotebook: quadern multifont amb citacions clicables [Font X], 8 generadors en 1 clic i Podcast IA a 2 veus.',
                        'Eines: inclou el Laboratori de 6 Jocs d’aprenentatge actiu, generador d’examen, mapes mentals i Google Workspace.',
                        'Memòria: revisa els teus punts, resultats i prem el botó «Calendari del Pla d’Estudi» per veure i marcar totes les sessions per dia.'
                    ]
            });

            steps.push({
                selector: '#chat-header-menu-dropdown, #chat-header-menu-btn',
                onEnter: async () => {
                    if (hooks) {
                        await hooks.enterStudyChat();
                        hooks.openHeaderMenu();
                    }
                },
                onLeave: () => {
                    if (hooks) hooks.closeHeaderMenu();
                },
                actionLabel: isEs ? 'Menú «⋮» arriba a la derecha' : 'Menú «⋮» a dalt a la dreta',
                title: isEs ? 'Opciones de la conversación (⋮)' : 'Opcions de la conversa (⋮)',
                desc: isEs
                    ? 'Al pulsar los tres puntos arriba a la derecha controlas todo sobre el chat actual:'
                    : 'En prémer els tres punts a dalt a la dreta ho controles tot sobre el xat actual:',
                bullets: isEs
                    ? [
                        'Compartir enlace, ver los archivos subidos al chat o buscar mensajes concretos.',
                        'Fijar la conversación arriba, renombrarla, duplicarla o pedir un resumen IA.',
                        'Copiar o descargar toda la conversación en PDF, Word (.doc) o Markdown.'
                    ]
                    : [
                        'Compartir enllaç, veure els arxius pujats al xat o cercar missatges concrets.',
                        'Fixar la conversa a dalt, canviar-li el nom, duplicar-la o demanar un resum IA.',
                        'Copiar o descarregar tota la conversa en PDF, Word (.doc) o Markdown.'
                    ]
            });

            steps.push({
                selector: '#xatbot-submode-header-pill',
                onEnter: async () => {
                    if (hooks) await hooks.enterFreeChat('study_free');
                    else if (typeof window.startFreeChatMode === 'function') await window.startFreeChatMode();
                },
                actionLabel: isEs ? 'Modo 2: XatBot (Selector superior)' : 'Mode 2: XatBot (Selector superior)',
                title: isEs ? '2. XatBot: Estudio Libre vs Libre Total' : '2. XatBot: Estudi Lliure vs Lliure Total',
                desc: isEs
                    ? 'Dentro de XatBot tienes arriba este interruptor con dos personalidades distintas:'
                    : 'Dins de XatBot tens a dalt aquest selector amb dues personalitats diferents:',
                bullets: isEs
                    ? [
                        'Estudi Lliure (birrete): resuelve dudas de mates, ciencia, código o idiomas paso a paso sin calendarios rígidos y activa los modos de Tutor.',
                        'Lliure Total (globo): charla sobre cualquier tema (noticias, deportes, cine, ocio o ideas) con búsqueda web de Google en directo.'
                    ]
                    : [
                        'Estudi Lliure (birret): resol dubtes de mates, ciència, codi o idiomes pas a pas sense calendaris rígids i activa els modes de Tutor.',
                        'Lliure Total (globus): parla de qualsevol tema (notícies, esports, cinema, oci o idees) amb cerca web de Google en directe.'
                    ]
            });

            steps.push({
                selector: '#tutor-dropdown-btn',
                onEnter: async () => {
                    if (hooks) await hooks.enterFreeChat('study_free');
                },
                actionLabel: isEs ? 'Selector de Tutor (en la barra inferior)' : 'Selector de Tutor (a la barra inferior)',
                title: isEs ? 'Elige cómo te enseña el Tutor IA' : 'Tria com t’ensenya el Tutor IA',
                desc: isEs
                    ? 'Disponible en Pla d’Estudis y en Estudi Lliure para cambiar el estilo pedagógico de las respuestas:'
                    : 'Disponible a Pla d’Estudis i a Estudi Lliure per canviar l’estil pedagògic de les respostes:',
                bullets: isEs
                    ? [
                        'Tutor Estàndard: explicación clara, ordenada y con ejemplos.',
                        'Mode Socràtic: te guía con pistas y preguntas para que deduzcas tú.',
                        'Mode Feynman / Tribunal: lenguaje ultra sencillo o evaluación exigente de examen.'
                    ]
                    : [
                        'Tutor Estàndard: explicació clara, ordenada i amb exemples.',
                        'Mode Socràtic: et guia amb pistes i preguntes perquè ho dedueixis tu.',
                        'Mode Feynman / Tribunal: llenguatge ultra senzill o avaluació exigent d’examen.'
                    ]
            });

            steps.push({
                selector: '#google-search-toggle-btn',
                onEnter: async () => {
                    if (hooks) await hooks.enterFreeChat('study_free');
                },
                actionLabel: isEs ? 'Botones de Búsqueda, Micrófono y Voz' : 'Botons de Cerca, Micròfon i Veu',
                title: isEs ? 'Internet en vivo, Dictado y Llamada IA' : 'Internet en viu, Dictat i Trucada IA',
                desc: isEs
                    ? 'A la derecha de la barra donde escribes tienes los controles rápidos de interacción:'
                    : 'A la dreta de la barra on escrius tens els controls ràpids d’interacció:',
                bullets: isEs
                    ? [
                        'Lupa (+): activa o desactiva la búsqueda en Google en directo para contrastar datos actuales.',
                        'Micrófono: dicta tus preguntas hablando en lugar de escribir.',
                        'Barras verdes de audio: inicia una llamada de voz en tiempo real para conversar con Aliat.'
                    ]
                    : [
                        'Lupa (+): activa o desactiva la cerca a Google en directe per contrastar dades actuals.',
                        'Micròfon: dicta les teves preguntes parlant en lloc d’escriure.',
                        'Barres verdes d’àudio: inicia una trucada de veu en temps real per conversar amb Aliat.'
                    ]
            });

            steps.push({
                selector: '#plus-menu, #chat-plus-btn',
                onEnter: async () => {
                    if (hooks) {
                        await hooks.enterFreeChat('study_free');
                        hooks.openPlusRoot();
                    }
                },
                onLeave: () => {
                    if (hooks) hooks.closePlus();
                },
                actionLabel: isEs ? 'Botón «+» y sus 4 carpetas' : 'Botó «+» i les seves 4 carpetes',
                title: isEs ? 'Todo lo que hay dentro del botón «+»' : 'Tot el que hi ha dins del botó «+»',
                desc: isEs
                    ? 'Hemos abierto el menú «+» para que veas sus 4 carpetas de herramientas y sus 2 accesos directos:'
                    : 'Hem obert el menú «+» perquè vegis les seves 4 carpetes d’eines i els 2 accessos directes:',
                bullets: isEs
                    ? [
                        'Google Workspace (8): Calendar, Classroom, Picker, Drive, Gmail, Docs, Slides y Sheets.',
                        'IA Creativa & Multimodal (5): Crear Imágenes (1:1/9:16/16:9), Vídeo IA, OCR/Analizar, Transcribir Audio y Cámara.',
                        'Eines d’Estudi & Focus: Quiz Kahoot, Mapa Mental D3, Editor Redacción, Rutinas, Pomodoro y Adjuntar Fitxer / PDF → Pla.'
                    ]
                    : [
                        'Google Workspace (8): Calendar, Classroom, Picker, Drive, Gmail, Docs, Slides i Sheets.',
                        'IA Creativa & Multimodal (5): Crear Imatges (1:1/9:16/16:9), Vídeo IA, OCR/Analitzar, Transcriure Àudio i Càmera.',
                        'Eines d’Estudi & Focus: Quiz Kahoot, Mapa Mental D3, Editor Redacció, Rutines, Pomodoro i Adjuntar Fitxer / PDF → Pla.'
                    ]
            });

            steps.push({
                selector: '#daily-tools-header-btn',
                onEnter: async () => {
                    if (hooks) await hooks.enterDailyChat();
                    else if (typeof window.startDailyUseMode === 'function') await window.startDailyUseMode();
                },
                actionLabel: isEs ? 'Modo 3: Ús Quotidià (Botón superior)' : 'Mode 3: Ús Quotidià (Botó superior)',
                title: isEs ? '3. Ús Quotidià: productividad y Google Workspace' : '3. Ús Quotidià: productivitat i Google Workspace',
                desc: isEs
                    ? 'Pensado para redactar, planificar rutinas y trabajar con tus apps. Arriba aparece «Eines Ús Quotidià» con:'
                    : 'Pensat per redactar, planificar rutines i treballar amb les teves apps. A dalt apareix «Eines Ús Quotidià» amb:',
                bullets: isEs
                    ? [
                        'Modo «Ja fet» (texto final directo listo para copiar/enviar) o «Guiat» (explicado paso a paso).',
                        'Accesos a Gmail, Calendar, Classroom, Slides, Sheets, Editor de Redacción y Tablas de horarios.',
                        'Recordatorios periódicos de estudio por notificación Push al móvil y correo.'
                    ]
                    : [
                        'Mode «Ja fet» (text final directe llest per copiar/enviar) o «Guiat» (explicat pas a pas).',
                        'Accessos a Gmail, Calendar, Classroom, Slides, Sheets, Editor de Redacció i Taules d’horaris.',
                        'Recordatoris periòdics d’estudi per notificació Push al mòbil i correu.'
                    ]
            });
        } else {
            // User manually replayed tour while inside an existing conversation with messages: explain current view safely without wiping it
            steps.push({
                selector: '#notebook-header-btn, #tools-header-btn, #memory-header-btn, #daily-tools-header-btn',
                actionLabel: isEs ? 'Botones superiores del modo activo' : 'Botons superiors del mode actiu',
                title: isEs ? 'AliatNotebook, Eines (con Jocs) y Memòria (con Calendari)' : 'AliatNotebook, Eines (amb Jocs) i Memòria (amb Calendari)',
                desc: isEs
                    ? 'Arriba a la derecha tienes AliatNotebook (8 generadores, citas [Font X] y Podcast IA), Eines (donde están los 6 Jocs de aprendizaje activo) y Memòria (con el botón del Calendari del Pla d’Estudi).'
                    : 'A dalt a la dreta tens AliatNotebook (8 generadors, citacions [Font X] i Podcast IA), Eines (on hi ha els 6 Jocs d’aprenentatge actiu) i Memòria (amb el botó del Calendari del Pla d’Estudi).'
            });
            steps.push({
                selector: '#chat-header-menu-dropdown, #chat-header-menu-btn',
                onEnter: () => { if (hooks) hooks.openHeaderMenu(); },
                onLeave: () => { if (hooks) hooks.closeHeaderMenu(); },
                actionLabel: isEs ? 'Menú «⋮» superior' : 'Menú «⋮» superior',
                title: isEs ? 'Opciones de la conversación (⋮)' : 'Opcions de la conversa (⋮)',
                desc: isEs
                    ? 'Desde los tres puntos puedes compartir, ver archivos del chat, buscar, fijar arriba, duplicar, resumir con IA o exportar a PDF, Word y Markdown.'
                    : 'Des dels tres punts pots compartir, veure arxius del xat, cercar, fixar a dalt, duplicar, resumir amb IA o exportar a PDF, Word i Markdown.'
            });
            steps.push({
                selector: '#plus-menu, #chat-plus-btn',
                onEnter: () => { if (hooks) hooks.openPlusRoot(); },
                onLeave: () => { if (hooks) hooks.closePlus(); },
                actionLabel: isEs ? 'Botón «+» de la barra' : 'Botó «+» de la barra',
                title: isEs ? 'Carpetas de herramientas del «+»' : 'Carpetes d’eines del «+»',
                desc: isEs
                    ? 'Incluye 4 carpetas: Google Workspace (8 apps), IA Creativa & Multimodal (Imágenes, Vídeo, OCR, Audio, Cámara), Eines d’Estudi & Tests y Pomodoro, además de Adjuntar fitxer.'
                    : 'Inclou 4 carpetes: Google Workspace (8 apps), IA Creativa & Multimodal (Imatges, Vídeo, OCR, Àudio, Càmera), Eines d’Estudi & Tests i Pomodoro, a més d’Adjuntar fitxer.'
            });
            steps.push({
                selector: '#tutor-dropdown-btn, #google-search-toggle-btn, #mic-btn',
                actionLabel: isEs ? 'Tutor, Cerca Web, Micrófono y Voz' : 'Tutor, Cerca Web, Micròfon i Veu',
                title: isEs ? 'Controles de respuesta y voz' : 'Controls de resposta i veu',
                desc: isEs
                    ? 'Elige estilo de Tutor (Estàndard, Socràtic, Feynman, Tribunal), activa la lupa para buscar en Google en directo, dicta con el micrófono o inicia llamada de voz con las barras verdes.'
                    : 'Tria estil de Tutor (Estàndard, Socràtic, Feynman, Tribunal), activa la lupa per cercar a Google en directe, dicta amb el micròfon o inicia trucada de veu amb les barres verdes.'
            });
        }

        if (isGuestFlow) {
            steps.push({
                selector: '#guest-mode-banner button[onclick*="openAuthModal"]',
                onEnter: () => { if (hooks) hooks.closeAllMenus(); },
                actionLabel: isEs ? 'Botón «Acceder / Iniciar Sesión»' : 'Botó «Accedir / Iniciar Sessió»',
                title: isEs ? 'Guarda tus chats y conecta Google' : 'Desa els teus xats i connecta Google',
                desc: isEs
                    ? 'En modo sin sesión puedes probar los chats al instante. Cuando quieras guardar tu historial en la nube, subir PDFs largos o vincular Google Workspace, inicia sesión aquí.'
                    : 'En mode sense sessió pots provar els xats a l’instant. Quan vulguis desar l’historial al núvol, pujar PDFs llargs o vincular Google Workspace, inicia sessió aquí.'
            });
        } else {
            steps.push({
                selector: '#sidebar-settings-btn',
                requiresSidebarOnMobile: true,
                onEnter: () => { if (hooks) hooks.closeAllMenus(); },
                actionLabel: isEs ? 'Configuración y ayuda' : 'Configuració i ajuda',
                title: isEs ? 'Ajustes, idioma, API y repetir guía' : 'Ajustos, idioma, API i repetir guia',
                desc: isEs
                    ? 'Aquí ajustas idioma (Català/Español), modo oscuro, tu clave API o cookies. Y con el botón «?» justo al lado puedes volver a abrir esta guía cuando quieras.'
                    : 'Aquí ajustes l’idioma (Català/Español), mode fosc, la teva clau API o cookies. I amb el botó «?» just al costat pots tornar a obrir aquesta guia quan vulguis.'
            });
        }

        return steps;
    }

    function buildAliatMapsSteps(isEs) {
        return [
            {
                selector: '#daily-maps-habitual-places-card',
                onEnter: async () => {
                    if (typeof window.switchDailyMapsTab === 'function') window.switchDailyMapsTab('transit');
                },
                actionLabel: isEs ? 'Casa e Instituto (Tu perfil)' : 'Casa i Institut (El teu perfil)',
                title: isEs ? '1. Guarda Casa y tu Instituto para siempre' : '1. Desa Casa i el teu Institut per sempre',
                desc: isEs
                    ? 'Pulsa «Fixar Casa» o «Fixar Insti» para guardar tus ubicaciones habituales en tu perfil de Firebase Firestore (accesibles en cualquier dispositivo):'
                    : 'Prem «Fixar Casa» o «Fixar Insti» per desar les teves ubicacions habituals al teu perfil de Firebase Firestore (accessibles des de qualsevol dispositiu):',
                bullets: isEs
                    ? [
                        'Por búsqueda: escribe tu calle o centro educativo y pulsa «Cercar».',
                        'Con GPS o clic en mapa: usa «Usar GPS actual» o «Marcar clicant al mapa» para señalar el punto exacto.',
                        'Se guardan permanentemente en tu perfil para responder al instante en rutas e IA.'
                    ]
                    : [
                        'Per cerca: escriu el teu carrer o centre educatiu i prem «Cercar».',
                        'Amb GPS o clic al mapa: usa «Usar GPS actual» o «Marcar clicant al mapa» per assenyalar el punt exacte.',
                        'Es desen permanentment al teu perfil per respondre a l’instant en rutes i IA.'
                    ]
            },
            {
                selector: '#daily-gmp-autocomplete-host',
                onEnter: async () => {
                    if (typeof window.switchDailyMapsTab === 'function') window.switchDailyMapsTab('transit');
                },
                actionLabel: isEs ? 'Buscador sobre el mapa' : 'Cercador sobre el mapa',
                title: isEs ? '2. Busca direcciones y sitios al instante' : '2. Cerca adreces i llocs a l’instant',
                desc: isEs
                    ? 'Usa esta barra flotante con autocompletado de Google Places para localizar calles, estaciones, tiendas o puntos de interés:'
                    : 'Fes servir aquesta barra flotant amb autocompletat de Google Places per localitzar carrers, estacions, botigues o punts d’interès:',
                bullets: isEs
                    ? [
                        'Escribe el nombre o dirección y elige una sugerencia para centrar el mapa.',
                        'En la tarjeta emergente podrás fijarlo como destino, guardarlo o trazar ruta.'
                    ]
                    : [
                        'Escriu el nom o adreça i tria un suggeriment per centrar el mapa.',
                        'A la fitxa emergent podràs fixar-lo com a destinació, desar-lo o traçar ruta.'
                    ]
            },
            {
                selector: '#daily-maps-search-section',
                onEnter: async () => {
                    if (typeof window.switchDailyMapsTab === 'function') window.switchDailyMapsTab('transit');
                    if (typeof window.setTransitInputMode === 'function') window.setTransitInputMode('ai');
                },
                actionLabel: isEs ? 'Búsqueda IA y Horario Manual' : 'Cerca IA i Horari Manual',
                title: isEs ? '3. Pregunta a la IA o busca horarios exactos' : '3. Pregunta a la IA o cerca horaris exactes',
                desc: isEs
                    ? 'Alterna entre «Pregunta amb IA» (consultas libres con horarios reales) u «Horari manual» (filtros exactos):'
                    : 'Alterna entre «Pregunta amb IA» (consultes lliures amb horaris reals) o «Horari manual» (filtres exactes):',
                bullets: isEs
                    ? [
                        'Con IA: escribe «¿A qué hora salgo de casa para llegar a las 9 al insti?» o «¿Qué hacer cerca?».',
                        'Seguimiento: cuando ya haya una ruta, usa este mismo cuadro para preguntar dudas sobre ella.',
                        'Manual: elige origen, destino, hora de salida/llegada y filtra Bus, Tren o Metro.'
                    ]
                    : [
                        'Amb IA: escriu «A quina hora surto de casa per arribar a les 9 a l’insti?» o «Què fer a prop?».',
                        'Seguiment: quan ja hi hagi una ruta, usa el mateix quadre per comentar-la.',
                        'Manual: tria origen, destinació, hora de sortida/arribada i filtra Bus, Tren o Metro.'
                    ]
            },
            {
                selector: '#daily-gmp-map-canvas',
                onEnter: async () => {
                    if (typeof window.switchDailyMapsTab === 'function') window.switchDailyMapsTab('transit');
                },
                actionLabel: isEs ? 'Mapa interactivo' : 'Mapa interactiu',
                title: isEs ? '4. Haz clic directo en el mapa' : '4. Fes clic directe al mapa',
                desc: isEs
                    ? 'Toca cualquier punto del mapa para interactuar directamente sin escribir direcciones largas:'
                    : 'Toca qualsevol punt del mapa per interactuar directament sense escriure adreces llargues:',
                bullets: isEs
                    ? [
                        'En modo «Marcar clicant al mapa», tu próximo toque fijará Casa o Instituto.',
                        'Fuera de ese modo, tocar el mapa te permite consultar esa dirección, guardar el punto o ir hasta allí.'
                    ]
                    : [
                        'En mode «Marcar clicant al mapa», el teu pròxim toc fixarà Casa o Institut.',
                        'Fora d’aquest mode, tocar el mapa et permet consultar l’adreça, desar el punt o traçar ruta.'
                    ]
            },
            {
                selector: '#daily-maps-saved-form, [data-daily-maps-tab="saved"]',
                onEnter: async () => {
                    if (typeof window.switchDailyMapsTab === 'function') window.switchDailyMapsTab('saved');
                },
                onLeave: () => {
                    if (typeof window.switchDailyMapsTab === 'function') window.switchDailyMapsTab('transit');
                },
                actionLabel: isEs ? 'Pestaña «Llocs» (Favoritos)' : 'Pestanya «Llocs» (Preferits)',
                title: isEs ? '5. Gestiona todos tus lugares guardados' : '5. Gestiona tots els teus llocs desats',
                desc: isEs
                    ? 'En la pestaña «Llocs» puedes añadir trabajo, gimnasio, supermercados o puntos de encuentro sincronizados en tu perfil:'
                    : 'A la pestanya «Llocs» pots afegir feina, gimnàs, supermercats o punts de trobada sincronitzats al teu perfil:',
                bullets: isEs
                    ? [
                        'Añade cualquier lugar por dirección, marcador del mapa o GPS.',
                        'Pulsa un lugar de tu lista para enfocarlo, trazar ruta en 1 clic o eliminarlo de Firestore.'
                    ]
                    : [
                        'Afegeix qualsevol lloc per adreça, marcador al mapa o GPS.',
                        'Prem un lloc de la llista per enfocar-lo, traçar ruta en 1 clic o eliminar-lo de Firestore.'
                    ]
            },
            {
                selector: '#daily-maps-tour-btn',
                onEnter: async () => {
                    if (typeof window.switchDailyMapsTab === 'function') window.switchDailyMapsTab('transit');
                },
                actionLabel: isEs ? 'Más pestañas y ayuda «?»' : 'Més pestanyes i ajuda «?»',
                title: isEs ? '6. Explora «A prop», «Cotxe» y «Rutes»' : '6. Explora «A prop», «Cotxe» i «Rutes»',
                desc: isEs
                    ? 'Arriba tienes también «Cotxe» (dónde aparcaste), «A prop» (farmacias, supermercados, metro...) y «Rutes» (a pie, coche o bici).'
                    : 'A dalt tens també «Cotxe» (on vas aparcar), «A prop» (farmàcies, supermercats, metro...) i «Rutes» (a peu, cotxe o bici).',
                bullets: isEs
                    ? [
                        'Pulsa este botón «?» en cualquier momento si quieres volver a ver esta guía de AliatMaps.'
                    ]
                    : [
                        'Prem aquest botó «?» en qualsevol moment si vols tornar a veure aquesta guia d’AliatMaps.'
                    ]
            }
        ];
    }

    function getCopy(isEs) {
        return {
            introBadge: isEs ? 'Guía interactiva · Paso a paso' : 'Guia interactiva · Pas a pas',
            stepOf: (cur, total) => isEs ? `Paso ${cur} de ${total}` : `Pas ${cur} de ${total}`,
            clickCue: isEs ? 'Zona:' : 'Zona:',
            skipStart: isEs ? 'Saltar introducción' : 'Saltar introducció',
            skipStep: isEs ? 'Saltar' : 'Saltar',
            startBtn: isEs ? 'Empezar recorrido' : 'Començar recorregut',
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
                            title: isEs ? 'Prueba los chats al instante sin cuenta' : 'Prova els xats a l’instant sense compte',
                            desc: isEs
                                ? 'Si prefieres explorar primero, haz clic aquí para entrar directamente en el modo sin sesión y ver los chats por dentro.'
                                : 'Si prefereixes explorar primer, fes clic aquí per entrar directament al mode sense sessió i veure els xats per dins.'
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
                    introTitle: isEs ? 'Recorrido dentro de los chats y botones' : 'Recorregut dins dels xats i botons',
                    introDesc: isEs
                        ? 'Entraremos contigo en cada modo de chat para explicarte sus características, los botones superiores y todo lo que hay en el «+».'
                        : 'Entrarem amb tu a cada mode de xat per explicar-te les seves característiques, els botons superiors i tot el que hi ha al «+».',
                    steps: buildInAppSteps(isEs, true, state.hasUserChatAtStart)
                },
                auth: {
                    introTitle: isEs ? 'Guía completa por modos, chats y botones' : 'Guia completa per modes, xats i botons',
                    introDesc: isEs
                        ? 'Nos meteremos dentro de los chats para mostrarte qué hace cada modo, los botones de arriba, el menú «⋮» y todas las carpetas del «+».'
                        : 'Ens ficarem dins dels xats per mostrar-te què fa cada mode, els botons de dalt, el menú «⋮» i totes les carpetes del «+».',
                    steps: buildInAppSteps(isEs, false, state.hasUserChatAtStart)
                },
                maps: {
                    introTitle: isEs ? 'Domina AliatMaps en pocos clics' : 'Domina AliatMaps en pocs clics',
                    introDesc: isEs
                        ? 'Te enseñamos a guardar Casa, tu Instituto y tus sitios favoritos en tu perfil (Firestore) y a buscar rutas y ubicaciones paso a paso.'
                        : 'T’ensenyem a desar Casa, el teu Institut i els teus llocs favorits al perfil (Firestore) i a cercar rutes i ubicacions pas a pas.',
                    steps: buildAliatMapsSteps(isEs)
                }
            }
        };
    }

    function ensureStyles() {
        const existing = document.getElementById('aliat-onboarding-styles');
        if (existing) return;
        const style = document.createElement('style');
        style.id = 'aliat-onboarding-styles';
        style.textContent = `
            @keyframes aliatTourFadeIn {
                from { opacity: 0.01; transform: translateY(6px) scale(0.985); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }
            #aliat-onboarding-root {
                position: fixed !important;
                inset: 0 !important;
                z-index: 2147483000 !important;
                pointer-events: none;
            }
            #aliat-onboarding-backdrop {
                position: fixed !important;
                inset: 0 !important;
                pointer-events: auto;
            }
            #aliat-onboarding-spotlight {
                position: fixed !important;
                border-radius: 14px;
                border: 2px solid #2563eb;
                box-shadow: 0 0 0 9999px rgba(9, 9, 11, 0.56), 0 0 0 5px rgba(37, 99, 235, 0.24);
                pointer-events: none;
                transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.18s ease;
                z-index: 2147483001 !important;
            }
            html.dark #aliat-onboarding-spotlight {
                border-color: #38bdf8;
                box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.68), 0 0 0 5px rgba(56, 189, 248, 0.25);
            }
            #aliat-onboarding-card {
                position: fixed !important;
                pointer-events: auto;
                z-index: 2147483002 !important;
                width: min(380px, calc(100vw - 24px));
                max-height: calc(100dvh - 24px);
                overflow-y: auto;
                background-color: #ffffff;
                color: #18181b;
                border: 1px solid #e4e4e7;
                border-radius: 1rem;
                padding: 1.15rem;
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.35);
                opacity: 1;
                animation: aliatTourFadeIn 0.16s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            }
            html.dark #aliat-onboarding-card {
                background-color: #18181b;
                color: #f4f4f5;
                border-color: #3f3f46;
            }
            #aliat-onboarding-arrow {
                position: absolute;
                width: 12px;
                height: 12px;
                transform: rotate(45deg);
                background-color: #ffffff;
            }
            html.dark #aliat-onboarding-arrow {
                background-color: #18181b;
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

    function closeMobileSidebarNow() {
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

    function stopTour(markCompleted = true, skipRestore = false) {
        state.transitionToken += 1;
        const prevFlow = state.flow;
        const prevStep = state.index >= 0 ? state.steps[state.index] : null;
        if (prevStep && typeof prevStep.onLeave === 'function') {
            try { prevStep.onLeave(); } catch (_) {}
        }
        const hooks = getTourHooks();
        if (hooks && prevFlow !== 'maps') {
            try { hooks.closeAllMenus(); } catch (_) {}
        }
        if (markCompleted && prevFlow) {
            markFlowDone(prevFlow);
        }
        const snap = state.snapshot;
        state.snapshot = null;
        state.active = false;
        state.index = -1;
        cleanupDOM(false);
        if (!skipRestore && prevFlow !== 'maps' && snap && hooks && !hooks.hasUserChat()) {
            Promise.resolve(hooks.restoreSnapshot(snap)).catch(() => {});
        }
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
        const cardW = cardRect.width || Math.min(375, vw - 24);
        const cardH = cardRect.height || 230;
        const pad = 12;

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
        else {
            const best = Math.max(spaceBelow, spaceAbove, vw >= 640 ? spaceRight : 0, vw >= 640 ? spaceLeft : 0);
            if (best === spaceRight && vw >= 640) placement = 'right';
            else if (best === spaceLeft && vw >= 640) placement = 'left';
            else placement = spaceBelow >= spaceAbove ? 'bottom' : 'top';
        }

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
            const overlapsTargetHoriz = !(left + cardW < sx || left > sx + sw);
            const overlapsTargetVert = !(top + cardH < sy || top > sy + sh);
            if (overlapsTargetHoriz && overlapsTargetVert) {
                arrow.style.display = 'none';
                return;
            }
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
            e.stopPropagation();
            if (state.targetEl && isElVisible(state.targetEl)) {
                const r = state.targetEl.getBoundingClientRect();
                if (e.clientX >= r.left - 6 && e.clientX <= r.right + 6 && e.clientY >= r.top - 6 && e.clientY <= r.bottom + 6) {
                    const stack = document.elementsFromPoint ? document.elementsFromPoint(e.clientX, e.clientY) : [];
                    const realTarget = stack.find(el => el && !el.id?.startsWith('aliat-onboarding') && !el.closest?.('#aliat-onboarding-root')) || state.targetEl;
                    if (realTarget && typeof realTarget.click === 'function') {
                        const isLast = state.index >= state.steps.length - 1;
                        if (isLast) stopTour(true, true);
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
        card.addEventListener('click', (e) => e.stopPropagation());

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
                const pos = window.getComputedStyle(target).position;
                if (pos !== 'fixed' && !target.closest('.fixed')) {
                    try {
                        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
                    } catch (_) {}
                }
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
            desc.className = 'text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed mb-2.5';
            desc.textContent = step.desc;
            card.appendChild(desc);

            if (Array.isArray(step.bullets) && step.bullets.length > 0) {
                const list = document.createElement('ul');
                list.className = 'space-y-1.5 mb-3 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/80 dark:border-zinc-700/70 rounded-xl p-2.5';
                step.bullets.forEach((bText) => {
                    const li = document.createElement('li');
                    li.className = 'flex items-start gap-2 text-[11px] leading-snug text-zinc-700 dark:text-zinc-200';
                    const dot = document.createElement('span');
                    dot.className = 'w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-sky-400 shrink-0 mt-1.5';
                    const span = document.createElement('span');
                    span.textContent = bText;
                    li.appendChild(dot);
                    li.appendChild(span);
                    list.appendChild(li);
                });
                card.appendChild(list);
            }

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
        setTimeout(positionCardAndSpotlight, 120);
        setTimeout(positionCardAndSpotlight, 300);
    }

    async function goToStep(idx) {
        if (idx < -1 || idx >= state.steps.length) {
            stopTour(true);
            return;
        }
        const token = ++state.transitionToken;
        const prevStep = state.index >= 0 ? state.steps[state.index] : null;
        if (prevStep && typeof prevStep.onLeave === 'function') {
            try { prevStep.onLeave(); } catch (_) {}
        }
        state.index = idx;
        const nextStep = idx >= 0 ? state.steps[idx] : null;
        if (nextStep && typeof nextStep.onEnter === 'function') {
            try {
                await nextStep.onEnter();
            } catch (_) {}
        }
        if (!state.active || state.transitionToken !== token) return;
        // Wait one animation frame so toggled views/dropdowns settle before measuring bounding rects
        requestAnimationFrame(() => {
            if (!state.active || state.transitionToken !== token) return;
            renderTourUI();
        });
    }

    function isChatViewCurrentlyOpen() {
        const chatView = document.getElementById('chat-view');
        return Boolean(chatView && !chatView.classList.contains('hidden'));
    }

    function buildStepsForFlow(flow, forceFallback = false) {
        const isEs = getLang() === 'es';
        const copy = getCopy(isEs);
        const flowData = copy.flows[flow] || copy.flows.landing;
        const filtered = flowData.steps.filter((s) => {
            // Steps with an onEnter transition dynamically navigate into the target view/menu at step activation
            if (typeof s.onEnter === 'function' || s.requiresSidebarOnMobile) return true;
            return Boolean(resolveTargetElement(s.selector));
        });
        if (filtered.length > 0) return filtered;
        return forceFallback ? flowData.steps.slice() : [];
    }

    window.__ALIAT_ONBOARDING_VERSION = 11;
    let _lastTourStartTs = 0;

    window.startAliatOnboarding = function (requestedFlow = 'auto', forceReplay = false) {
        const now = Date.now();
        if (forceReplay && state.active && now - _lastTourStartTs < 250) return;
        _lastTourStartTs = now;

        const flow = (!requestedFlow || requestedFlow === 'auto') ? detectFlow() : requestedFlow;
        if (flow === 'maps' && !isMapsModalOpen()) return;
        if (!forceReplay && isFlowDone(flow)) return;
        if (!forceReplay && isAnyBlockingModalOpen(flow)) return;

        // If mobile sidebar drawer was left open over the app while clicking ?, collapse it first so UI is unobstructed
        if (window.innerWidth < 768 && flow !== 'maps') {
            closeMobileSidebarNow();
        }

        const hooks = getTourHooks();
        state.hasUserChatAtStart = Boolean(hooks && flow !== 'maps' && isChatViewCurrentlyOpen() && hooks.hasUserChat());
        state.snapshot = (flow !== 'landing' && flow !== 'maps' && hooks && !state.hasUserChatAtStart) ? hooks.getSnapshot() : null;

        const steps = buildStepsForFlow(flow, Boolean(forceReplay));
        if (!steps || steps.length === 0) return;

        state.active = true;
        state.flow = flow;
        state.steps = steps;
        state.index = -1;
        state.transitionToken += 1;
        renderTourUI();
    };

    window.startAliatMapsOnboarding = function (forceReplay = false) {
        if (!isMapsModalOpen()) return;
        if (state.active && state.flow !== 'maps') {
            stopTour(false, true);
        }
        window.startAliatOnboarding('maps', Boolean(forceReplay));
    };

    window.stopAliatMapsOnboardingIfActive = function () {
        if (state.active && state.flow === 'maps') {
            stopTour(false, true);
        }
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
            if (isAnyBlockingModalOpen(flow)) {
                return;
            }
            window.startAliatOnboarding(flow, false);
        }, delayMs);
    }

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

    window.addEventListener('aliat:cookie-consent-updated', () => {
        scheduleAutoCheck(550);
    });

    function hookLifecycleFunctions() {
        if (typeof window.enterGuestMode === 'function' && !window.enterGuestMode._onboardingHooked) {
            const origGuest = window.enterGuestMode;
            window.enterGuestMode = function (...args) {
                if (state.active) stopTour(false, true);
                const res = origGuest.apply(this, args);
                scheduleAutoCheck(550);
                return res;
            };
            window.enterGuestMode._onboardingHooked = true;
        }

        if (typeof window.applyAuthSuccess === 'function' && !window.applyAuthSuccess._onboardingHooked) {
            const origAuth = window.applyAuthSuccess;
            window.applyAuthSuccess = function (...args) {
                if (state.active) stopTour(false, true);
                const res = origAuth.apply(this, args);
                scheduleAutoCheck(650);
                return res;
            };
            window.applyAuthSuccess._onboardingHooked = true;
        }

        if (typeof window.openAuthModal === 'function' && !window.openAuthModal._onboardingHooked) {
            const origOpenAuth = window.openAuthModal;
            window.openAuthModal = function (...args) {
                if (state.active) stopTour(false, true);
                return origOpenAuth.apply(this, args);
            };
            window.openAuthModal._onboardingHooked = true;
        }
    }

    document.addEventListener('click', (e) => {
        const target = e.target && e.target.closest ? e.target.closest('#sidebar-tour-btn, #welcome-tour-btn, #landing-tour-btn, [data-aliat-tour-trigger]') : null;
        if (!target) return;
        e.preventDefault();
        e.stopPropagation();
        const flow = target.id === 'landing-tour-btn' ? 'landing' : 'auto';
        window.startAliatOnboarding(flow, true);
    });

    function init() {
        hookLifecycleFunctions();
        scheduleAutoCheck(900);
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
