/**
 * Aliat Intel·ligent — Pla d'Estudi Actiu, Laboratori de Jocs Interactius i Gemini Notebook Studio (NotebookLM)
 */
(function () {
    'use strict';

    const STORAGE_KEY_MASTERY = 'aliat_study_plan_mastery_v1';
    const STORAGE_KEY_NOTEBOOK = 'aliat_gemini_notebook_state_v1';

    function isEsLang() {
        const lang = (typeof window.currentAppLang === 'string' && window.currentAppLang)
            ? window.currentAppLang
            : (localStorage.getItem('aliat_app_language') || 'ca');
        return lang === 'es';
    }

    function tr(ca, es) {
        return isEsLang() ? es : ca;
    }

    function esc(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function sanitizeHtmlFragment(html) {
        return String(html || '')
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
            .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
            .replace(/javascript:/gi, '');
    }

    // --- WEB AUDIO SYNTHESIZED FEEDBACK (SENSE FITXERS EXTERNS) ---
    function playGameSound(type) {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            if (!window._aliatGameAudioCtx) window._aliatGameAudioCtx = new AudioCtx();
            const ctx = window._aliatGameAudioCtx;
            if (ctx.state === 'suspended') ctx.resume();

            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);

            if (type === 'success') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(523.25, now);
                osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.09);
                osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.2);
                gain.gain.setValueAtTime(0.08, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
                osc.start(now);
                osc.stop(now + 0.25);
            } else if (type === 'error') {
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(240, now);
                osc.frequency.exponentialRampToValueAtTime(160, now + 0.18);
                gain.gain.setValueAtTime(0.08, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
                osc.start(now);
                osc.stop(now + 0.21);
            } else if (type === 'victory') {
                const notes = [523.25, 659.25, 783.99, 1046.5];
                notes.forEach((freq, idx) => {
                    const o = ctx.createOscillator();
                    const g = ctx.createGain();
                    o.type = 'sine';
                    o.connect(g);
                    g.connect(ctx.destination);
                    o.frequency.setValueAtTime(freq, now + idx * 0.08);
                    g.gain.setValueAtTime(0.07, now + idx * 0.08);
                    g.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.22);
                    o.start(now + idx * 0.08);
                    o.stop(now + idx * 0.08 + 0.23);
                });
            } else {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(440, now);
                gain.gain.setValueAtTime(0.04, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
                osc.start(now);
                osc.stop(now + 0.08);
            }
        } catch (_) {}
    }

    // --- GESTIÓ DE PROGRÉS DEL PLA D'ESTUDI I XP ---
    function getMasteryState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY_MASTERY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') return parsed;
            }
        } catch (_) {}
        return { xp: 120, streak: 0, bestStreak: 3, gamesWon: 0, completedSessions: {} };
    }

    function saveMasteryState(state) {
        try {
            localStorage.setItem(STORAGE_KEY_MASTERY, JSON.stringify(state));
        } catch (_) {}
    }

    function awardStudyXp(points, isWin, topicLabel) {
        const state = getMasteryState();
        state.xp = Math.max(0, (Number(state.xp) || 0) + points);
        if (isWin) {
            state.streak = (Number(state.streak) || 0) + 1;
            state.bestStreak = Math.max(Number(state.bestStreak) || 0, state.streak);
            state.gamesWon = (Number(state.gamesWon) || 0) + 1;
        } else {
            state.streak = 0;
        }
        saveMasteryState(state);

        if (typeof window.updateStudentMemory === 'function' && topicLabel) {
            window.updateStudentMemory(isWin ? 'game_win' : 'game_fail', { topic: String(topicLabel).substring(0, 40) });
        }
        const xpEl = document.getElementById('study-lab-xp-val');
        const streakEl = document.getElementById('study-lab-streak-val');
        if (xpEl) xpEl.textContent = `${state.xp} XP`;
        if (streakEl) streakEl.textContent = `${state.streak}`;
        return state;
    }

    window.toggleStudySessionCompleted = function (sessionNum, sessionTopic) {
        const sessId = (typeof currentSessionId !== 'undefined' && currentSessionId) ? currentSessionId : 'default';
        const state = getMasteryState();
        if (!state.completedSessions) state.completedSessions = {};
        const key = `${sessId}_${sessionNum}`;
        const nextVal = !state.completedSessions[key];
        state.completedSessions[key] = nextVal;
        if (nextVal) {
            state.xp = (Number(state.xp) || 0) + 25;
            playGameSound('success');
            if (typeof showToast === 'function') {
                showToast(tr(`Sessió ${sessionNum} marcada com a dominada (+25 XP)`, `Sesión ${sessionNum} marcada como dominada (+25 XP)`), 'success');
            }
        }
        saveMasteryState(state);
        if (typeof window.refreshActiveStudyPlanBanner === 'function') {
            window.refreshActiveStudyPlanBanner();
        }
    };

    window.isStudySessionCompleted = function (sessionNum) {
        const sessId = (typeof currentSessionId !== 'undefined' && currentSessionId) ? currentSessionId : 'default';
        const state = getMasteryState();
        return !!(state.completedSessions && state.completedSessions[`${sessId}_${sessionNum}`]);
    };

    // --- OBTENCIÓ DEL TEMA I CONTEXT ACTUAL ---
    function resolveCurrentStudyTopic() {
        const inputEl = document.getElementById('study-lab-topic-input');
        if (inputEl && inputEl.value && inputEl.value.trim().length >= 2) {
            return inputEl.value.trim();
        }
        if (typeof window.getCurrentChatTopic === 'function') {
            const t = window.getCurrentChatTopic();
            if (t && !/^(classe activa|xatbot|aliat intel·ligent|nova conversa)$/i.test(t.trim())) {
                return t.trim();
            }
        }
        if (typeof generatedCalendarArray !== 'undefined' && Array.isArray(generatedCalendarArray) && generatedCalendarArray.length > 0) {
            return generatedCalendarArray[0].tema || tr("Temari del Pla d'Estudi", "Temario del Plan de Estudio");
        }
        const manualTopic = document.getElementById('manual-topic');
        if (manualTopic && manualTopic.value && manualTopic.value.trim()) {
            return manualTopic.value.trim().substring(0, 50);
        }
        return tr("Biologia Cel·lular, Física i Història Contemporània", "Biología Celular, Física e Historia Contemporánea");
    }

    function resolveCurrentStudyContext() {
        let parts = [];
        if (typeof finalStudyText !== 'undefined' && finalStudyText && finalStudyText.trim()) {
            parts.push(finalStudyText.trim().substring(0, 8000));
        }
        if (typeof window.getFullChatContext === 'function') {
            const chatCtx = window.getFullChatContext();
            if (chatCtx && chatCtx.trim()) parts.push(chatCtx.trim().substring(0, 5000));
        }
        if (typeof generatedCalendarArray !== 'undefined' && Array.isArray(generatedCalendarArray) && generatedCalendarArray.length > 0) {
            parts.push("Sessions del Pla d'Estudi: " + generatedCalendarArray.map(s => `${s.num}. ${s.tema}`).join(' | '));
        }
        return parts.join('\n\n');
    }

    // --- GENERADOR INTEL·LIGENT LOCAL DE DADES DE JOCS BASAT EN APUNTS / TEMA ---
    function extractConceptsFromNotes(topic, rawContext) {
        const cleanTopic = (topic || tr("Temari d'Estudi", "Temario de Estudio")).trim();
        const text = String(rawContext || '').trim();
        const extractedPairs = [];

        if (text.length > 40) {
            const lines = text.split(/\n+/).map(l => l.replace(/^[-*•#\d.)\s]+/, '').trim()).filter(l => l.length >= 18 && l.length <= 180);
            for (const line of lines) {
                const colonIdx = line.indexOf(':');
                const dashIdx = line.indexOf(' - ');
                const sepIdx = colonIdx > 3 && colonIdx < 45 ? colonIdx : (dashIdx > 3 && dashIdx < 45 ? dashIdx : -1);
                if (sepIdx !== -1) {
                    const term = line.substring(0, sepIdx).replace(/\*+/g, '').trim();
                    const match = line.substring(sepIdx + 1).replace(/^[\s\-:]+/, '').replace(/\*+/g, '').trim();
                    if (term.length >= 3 && term.length <= 42 && match.length >= 12 && extractedPairs.length < 6) {
                        if (!extractedPairs.some(p => p.term.toLowerCase() === term.toLowerCase())) {
                            extractedPairs.push({
                                term,
                                match: match.substring(0, 95),
                                explanation: tr(
                                    `Relació directa extreta dels teus apunts sobre ${cleanTopic}: "${term}" defineix ${match.substring(0, 80)}.`,
                                    `Relación directa extraída de tus apuntes sobre ${cleanTopic}: "${term}" define ${match.substring(0, 80)}.`
                                )
                            });
                        }
                    }
                }
            }
        }

        if (extractedPairs.length >= 6) return extractedPairs.slice(0, 6);

        const defaultBank = isEsLang() ? [
            {
                term: `Concepto nuclear de ${cleanTopic.substring(0, 26)}`,
                match: `Principio estructural que rige las leyes y propiedades de ${cleanTopic.substring(0, 26)}.`,
                explanation: `Dominar la definición base permite justificar el 60% de las preguntas teóricas de examen.`
            },
            {
                term: `Método de resolución paso a paso`,
                match: `Identificar variables de entrada, aplicar la relación fundamental y verificar unidades.`,
                explanation: `En los exámenes prácticos se puntúa tanto el planteamiento como la coherencia dimensional.`
            },
            {
                term: `Causa → Efecto principal`,
                match: `Al alterar el parámetro crítico del sistema, se desplaza el equilibrio hacia una respuesta adaptativa.`,
                explanation: `Las preguntas de razonamiento evalúan cómo responde el sistema ante un cambio externo.`
            },
            {
                term: `Trampa frecuente de examen`,
                match: `Confundir correlación superficial con causalidad directa o invertir las unidades del resultado.`,
                explanation: `Los distractores de opción múltiple suelen intercambiar la causa por la consecuencia.`
            },
            {
                term: `Síntesis comparativa`,
                match: `Contrastar las similitudes y diferencias entre el modelo teórico y el caso real aplicado.`,
                explanation: `Las tablas comparativas son la herramienta más eficaz para preguntas de desarrollo.`
            },
            {
                term: `Verificación del resultado`,
                match: `Comprobar que el orden de magnitud y el signo final tienen sentido físico y lógico.`,
                explanation: `Dedicar 30 segundos a revisar la coherencia evita perder puntos por errores de cálculo.`
            }
        ] : [
            {
                term: `Concepte nuclear de ${cleanTopic.substring(0, 26)}`,
                match: `Principi estructural que regeix les lleis i propietats de ${cleanTopic.substring(0, 26)}.`,
                explanation: `Dominar la definició base permet justificar el 60% de les preguntes teòriques d'examen.`
            },
            {
                term: `Mètode de resolució pas a pas`,
                match: `Identificar variables d'entrada, aplicar la relació fonamental i verificar unitats.`,
                explanation: `Als exàmens pràctics es puntua tant el plantejament com la coherència dimensional.`
            },
            {
                term: `Causa → Efecte principal`,
                match: `En alterar el paràmetre crític del sistema, es desplaça l'equilibri cap a una resposta adaptativa.`,
                explanation: `Les preguntes de raonament avaluen com respon el sistema davant d'un canvi extern.`
            },
            {
                term: `Trampa freqüent d'examen`,
                match: `Confondre correlació superficial amb causalitat directa o invertir les unitats del resultat.`,
                explanation: `Els distractors d'opció múltiple solen intercanviar la causa per la conseqüència.`
            },
            {
                term: `Síntesi comparativa`,
                match: `Contrastar les similituds i diferències entre el model teòric i el cas real aplicat.`,
                explanation: `Les taules comparatives són l'eina més eficaç per a preguntes de desenvolupament.`
            },
            {
                term: `Verificació del resultat`,
                match: `Comprovar que l'ordre de magnitud i el signe final tenen sentit físic i lògic.`,
                explanation: `Dedicar 30 segons a revisar la coherència evita perdre punts per errades de càlcul.`
            }
        ];

        while (extractedPairs.length < 6) {
            extractedPairs.push(defaultBank[extractedPairs.length]);
        }
        return extractedPairs.slice(0, 6);
    }

    function buildLocalGameData(gameType, topic, rawContext) {
        const cleanTopic = (topic || tr("Temari d'Estudi", "Temario de Estudio")).trim();
        const isEs = isEsLang();
        const pairs = extractConceptsFromNotes(cleanTopic, rawContext);

        if (gameType === 'memory_pairs') {
            return {
                title: (isEs ? "Parejas de Conceptos: " : "Parelles de Conceptes: ") + cleanTopic,
                pairs
            };
        }

        if (gameType === 'cloze_builder') {
            return {
                title: (isEs ? "Constructor de Definiciones: " : "Constructor de Definicions: ") + cleanTopic,
                items: isEs ? [
                    {
                        sentence: `Para analizar correctamente ${cleanTopic}, primero debemos identificar el __1__ principal y relacionarlo con su __2__ práctica.`,
                        blanks: ["concepto", "aplicación"],
                        distractors: ["incógnita aleatoria", "excepción nula", "desviación"],
                        explanation: `Toda pregunta de examen sobre ${cleanTopic} exige vincular el marco teórico con su aplicación directa.`
                    },
                    {
                        sentence: `En la resolución de problemas de ${cleanTopic}, conservar la coherencia de __1__ evita errores antes de validar la __2__ final.`,
                        blanks: ["unidades", "solución"],
                        distractors: ["hipótesis", "aproximación", "constante arbitraria"],
                        explanation: `El análisis dimensional de unidades es el filtro más fiable antes de entregar un ejercicio.`
                    },
                    {
                        sentence: `Cuando se produce una variación en las condiciones iniciales de ${cleanTopic}, el sistema experimenta una __1__ proporcional a la __2__ aplicada.`,
                        blanks: ["respuesta", "causa"],
                        distractors: ["anulación", "redundancia", "paradoja"],
                        explanation: `Comprender la relación causa-respuesta permite deducir qué ocurrirá sin memorizar de forma mecánica.`
                    }
                ] : [
                    {
                        sentence: `Per analitzar correctament ${cleanTopic}, primer cal identificar el __1__ principal i relacionar-lo amb la seva __2__ pràctica.`,
                        blanks: ["concepte", "aplicació"],
                        distractors: ["incògnita aleatòria", "excepció nul·la", "desviació"],
                        explanation: `Tota pregunta d'examen sobre ${cleanTopic} exigeix vincular el marc teòric amb la seva aplicació directa.`
                    },
                    {
                        sentence: `En la resolució de problemes de ${cleanTopic}, mantenir la coherència d'__1__ evita errades abans de validar la __2__ final.`,
                        blanks: ["unitats", "solució"],
                        distractors: ["hipòtesi", "aproximació", "constant arbitrària"],
                        explanation: `L'anàlisi dimensional d'unitats és el filtre més fiable abans d'entregar un exercici.`
                    },
                    {
                        sentence: `Quan es produeix una variació en les condicions inicials de ${cleanTopic}, el sistema experimenta una __1__ proporcional a la __2__ aplicada.`,
                        blanks: ["resposta", "causa"],
                        distractors: ["anul·lació", "redundància", "paradoxa"],
                        explanation: `Comprendre la relació causa-resposta permet deduir què passarà sense memoritzar de forma mecànica.`
                    }
                ]
            };
        }

        if (gameType === 'sequence_order') {
            const cal = (typeof generatedCalendarArray !== 'undefined' && Array.isArray(generatedCalendarArray) && generatedCalendarArray.length >= 5)
                ? generatedCalendarArray.slice(0, 5)
                : null;
            if (cal) {
                return {
                    title: (isEs ? "Secuencia del Plan de Estudio: " : "Seqüència del Pla d'Estudi: ") + cleanTopic,
                    prompt: isEs
                        ? `Ordena del paso 1 al 5 la progresión óptima de estudio y resolución para ${cleanTopic}:`
                        : `Ordena del pas 1 al 5 la progressió òptima d'estudi i resolució per a ${cleanTopic}:`,
                    steps: cal.map((item, idx) => ({
                        order: idx + 1,
                        label: item.tema,
                        detail: isEs ? `Fase ${idx + 1} programada en tu Plan de Estudio.` : `Fase ${idx + 1} programada al teu Pla d'Estudi.`
                    }))
                };
            }
            return {
                title: (isEs ? "Secuencia Lógica y Resolución: " : "Seqüència Lògica i Resolució: ") + cleanTopic,
                prompt: isEs
                    ? `Ordena del paso 1 al 5 el método riguroso para resolver cualquier problema o tema de ${cleanTopic}:`
                    : `Ordena del pas 1 al 5 el mètode rigorós per resoldre qualsevol problema o tema de ${cleanTopic}:`,
                steps: isEs ? [
                    { order: 1, label: `Lectura analítica del enunciado y extracción de datos clave de ${cleanTopic}`, detail: "Primero se identifican las variables conocidas y qué se pide demostrar." },
                    { order: 2, label: `Definición del marco teórico, leyes o principios aplicables`, detail: "Se selecciona el principio o fórmula que conecta los datos con la incógnita." },
                    { order: 3, label: `Estandarización de unidades y planteamiento del esquema o ecuación`, detail: "Antes de operar, todas las magnitudes deben estar en el mismo sistema." },
                    { order: 4, label: `Desarrollo paso a pas y cálculo o argumentación estructurada`, detail: "Se ejecuta la resolución justificando cada transición lógica." },
                    { order: 5, label: `Verificación crítica del resultado, signo y conclusión razonada`, detail: "Se comprueba que la solución tenga sentido real y responda a la pregunta." }
                ] : [
                    { order: 1, label: `Lectura analítica de l'enunciat i extracció de dades clau de ${cleanTopic}`, detail: "Primer s'identifiquen les variables conegudes i què es demana demostrar." },
                    { order: 2, label: `Definició del marc teòric, lleis o principis aplicables`, detail: "Es selecciona el principi o fórmula que connecta les dades amb la incògnita." },
                    { order: 3, label: `Estandardització d'unitats i plantejament de l'esquema o equació`, detail: "Abans d'operar, totes les magnituds han d'estar en el mateix sistema." },
                    { order: 4, label: `Desenvolupament pas a pas i càlcul o argumentació estructurada`, detail: "S'executa la resolució justificant cada transició lògica." },
                    { order: 5, label: `Verificació crítica del resultat, signe i conclusió raonada`, detail: "Es comprova que la solució tingui sentit real i respongui a la pregunta." }
                ]
            };
        }

        if (gameType === 'error_hunter') {
            return {
                title: (isEs ? "Cazador de Trampas de Examen: " : "Caçador de Trampes d'Examen: ") + cleanTopic,
                rounds: isEs ? [
                    {
                        context: `Ronda 1 · Detecta cuál de estas 4 afirmaciones sobre "${cleanTopic}" contiene un ERROR o trampa de examen:`,
                        statements: [
                            `Comprender la estructura conceptual de ${cleanTopic} permite deducir casos particulares sin memorizar a ciegas.`,
                            `En un examen de ${cleanTopic}, basta con escribir el número final sin indicar las unidades ni justificar el procedimiento.`,
                            `Relacionar las definiciones clave con ejemplos reales mejora la retención a largo plazo.`,
                            `Revisar la coherencia del resultado permite detectar errores de signo o de cálculo a tiempo.`
                        ],
                        errorIndex: 1,
                        correction: `¡Exacto! En cualquier examen académico, omitir el procedimiento o las unidades penaliza entre el 50% y el 75% de la puntuación aunque el número sea correcto.`
                    },
                    {
                        context: `Ronda 2 · Identifica la afirmación FALSA sobre el análisis riguroso de "${cleanTopic}":`,
                        statements: [
                            `Dividir el estudio de ${cleanTopic} en sesiones espaciadas consolida mejor la memoria que estudiar todo la última noche.`,
                            `Contrastar distintas fuentes y apuntes ayuda a detectar matices importantes del temario.`,
                            `Si dos variables cambian a la vez en un ejemplo de ${cleanTopic}, siempre significa que una es la única causa directa de la otra sin excepciones.`,
                            `Practicar con preguntas activas y esquemas mejora la velocidad de respuesta en el examen.`
                        ],
                        errorIndex: 2,
                        correction: `¡Bien visto! Confundir correlación con causalidad única e inmediata es una de las trampas conceptuales más clásicas en exámenes.`
                    },
                    {
                        context: `Ronda 3 · Encuentra el error metodológico al preparar "${cleanTopic}":`,
                        statements: [
                            `Explicar un concepto complejo con tus propias palabras (Método Feynman) revela qué partes aún no dominas.`,
                            `Si un apartado de ${cleanTopic} resulta difícil, lo más recomendable es saltárselo por completo y esperar que no salga.`,
                            `Hacer un mapa mental o esquema conecta los subtemas dentro de una visión global.`,
                            `Resolver ejercicios cronometrados entrena la gestión del tiempo real de examen.`
                        ],
                        errorIndex: 1,
                        correction: `¡Cazado! Ignorar los puntos débiles crea lagunas críticas; el Plan de Estudio registra tus fallos en la Memoria precisamente para reforzarlos.`
                    }
                ] : [
                    {
                        context: `Ronda 1 · Detecta quina d'aquestes 4 afirmacions sobre "${cleanTopic}" conté un ERROR o trampa d'examen:`,
                        statements: [
                            `Comprendre l'estructura conceptual de ${cleanTopic} permet deduir casos particulars sense memoritzar a cegues.`,
                            `En un examen de ${cleanTopic}, n'hi ha prou d'escriure el número final sense indicar les unitats ni justificar el procediment.`,
                            `Relacionar les definicions clau amb exemples reals millora la retenció a llarg termini.`,
                            `Revisar la coherència del resultat permet detectar errades de signe o de càlcul a temps.`
                        ],
                        errorIndex: 1,
                        correction: `Exacte! En qualsevol examen acadèmic, ometre el procediment o les unitats penalitza entre el 50% i el 75% de la nota encara que el número sigui correcte.`
                    },
                    {
                        context: `Ronda 2 · Identifica l'afirmació FALSA sobre l'anàlisi rigorosa de "${cleanTopic}":`,
                        statements: [
                            `Dividir l'estudi de ${cleanTopic} en sessions espaiades consolida millor la memòria que estudiar-ho tot l'última nit.`,
                            `Contrastar diferents fonts i apunts ajuda a detectar matisos importants del temari.`,
                            `Si dues variables canvien alhora en un exemple de ${cleanTopic}, sempre significa que una és l'única causa directa de l'altra sense excepcions.`,
                            `Practicar amb preguntes actives i esquemes millora la velocitat de resposta a l'examen.`
                        ],
                        errorIndex: 2,
                        correction: `Molt ben vist! Confondre correlació amb causalitat única i immediata és una de les trampes conceptuals més clàssiques als exàmens.`
                    },
                    {
                        context: `Ronda 3 · Troba l'error metodològic en preparar "${cleanTopic}":`,
                        statements: [
                            `Explicar un concepte complex amb les teves pròpies paraules (Mètode Feynman) revela quines parts encara no domines.`,
                            `Si un apartat de ${cleanTopic} resulta difícil, el més recomanable és saltar-se'l del tot i esperar que no surti.`,
                            `Fer un mapa mental o esquema connecta els subtemes dins d'una visió global.`,
                            `Resoldre exercicis cronometrats entrena la gestió del temps real d'examen.`
                        ],
                        errorIndex: 1,
                        correction: `Caçat! Ignorar els punts febles crea llacunes crítiques; el Pla d'Estudi registra les teves errades a la Memòria precisament per reforçar-les.`
                    }
                ]
            };
        }

        // speed_tf
        return {
            title: (isEs ? "Sprint Verdadero / Falso: " : "Sprint Veritat / Fals: ") + cleanTopic,
            statements: isEs ? [
                { text: `En ${cleanTopic}, justificar el procedimiento paso a paso es clave para obtener la máxima puntuación en un examen.`, isTrue: true, reason: `Los criterios de corrección valoran el razonamiento explícito tanto como el resultado.` },
                { text: `La repetición activa mediante preguntas y juegos fija mejor los conceptos de ${cleanTopic} que releer pasivamente.`, isTrue: true, reason: `El recuerdo activo (Active Recall) fortalece las conexiones de memoria a largo plazo.` },
                { text: `En un problema técnico de ${cleanTopic}, las unidades de medida son opcionales si el cálculo numérico parece aproximado.`, isTrue: false, reason: `Falso: una magnitud sin su unidad correspondiente carece de significado físico o técnico.` },
                { text: `Explicar ${cleanTopic} con palabras sencillas y ejemplos propios demuestra un dominio profundo del tema.`, isTrue: true, reason: `Es la base de la técnica Feynman: si puedes explicarlo con sencillez, realmente lo entiendes.` },
                { text: `Las preguntas trampa en exámenes de ${cleanTopic} suelen cambiar una sola condición clave del enunciado.`, isTrue: true, reason: `Leer con precisión los cuantificadores ('siempre', 'nunca', 'solo si') evita caer en distractores.` }
            ] : [
                { text: `En ${cleanTopic}, justificar el procediment pas a pas és clau per obtenir la màxima puntuació en un examen.`, isTrue: true, reason: `Els criteris de correcció valoren el raonament explícit tant com el resultat.` },
                { text: `La repetició activa mitjançant preguntes i jocs fixa millor els conceptes de ${cleanTopic} que rellegir passivament.`, isTrue: true, reason: `El record actiu (Active Recall) enforteix les connexions de memòria a llarg termini.` },
                { text: `En un problema tècnic de ${cleanTopic}, les unitats de mesura són opcionals si el càlcul numèric sembla aproximat.`, isTrue: false, reason: `Fals: una magnitud sense la seva unitat corresponent no té significat físic o tècnic.` },
                { text: `Explicar ${cleanTopic} amb paraules senzilles i exemples propis demostra un domini profund del tema.`, isTrue: true, reason: `És la base de la tècnica Feynman: si ho pots explicar amb senzillesa, realment ho entens.` },
                { text: `Les preguntes trampa en exàmens de ${cleanTopic} solen canviar una sola condició clau de l'enunciat.`, isTrue: true, reason: `Llegir amb precisió els quantificadors ('sempre', 'mai', 'només si') evita caure en distractors.` }
            ]
        };
    }

    // --- ESTAT DEL LABORATORI DE JOCS ---
    let activeStudyGameState = {
        gameType: 'memory_pairs',
        topic: '',
        loading: false,
        data: null,
        // Memory pairs state
        cards: [],
        flippedIndices: [],
        matchedPairIds: [],
        moves: 0,
        lastMatchExplanation: '',
        // Cloze state
        clozeRound: 0,
        clozeFilled: {},
        clozeChecked: false,
        clozeScore: 0,
        // Sequence state
        seqItems: [],
        seqSelectedIdx: null,
        seqChecked: false,
        seqCorrectCount: 0,
        // Error hunter state
        ehRound: 0,
        ehPicked: null,
        ehScore: 0,
        // Speed TF state
        tfIndex: 0,
        tfPicked: null,
        tfScore: 0,
        tfCombo: 0,
        tfTimer: null,
        tfTimeLeft: 15
    };

    function clearSpeedTfTimer() {
        if (activeStudyGameState.tfTimer) {
            clearInterval(activeStudyGameState.tfTimer);
            activeStudyGameState.tfTimer = null;
        }
    }

    function ensureGamesHubModalDOM() {
        let modal = document.getElementById('study-games-hub-modal');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'study-games-hub-modal';
        modal.className = 'fixed inset-0 z-[9995] hidden items-center justify-center bg-black/75 backdrop-blur-md p-2 sm:p-4 md:p-6 overflow-y-auto';
        modal.innerHTML = `
            <div class="w-full max-w-6xl bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[94dvh] animate-fade-in">
                <!-- Capçalera del Laboratori de Jocs -->
                <div class="px-4 sm:px-6 py-3.5 bg-zinc-50 dark:bg-zinc-900/90 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
                    <div class="flex items-center gap-3 min-w-0">
                        <div class="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="3"/><path d="M6 12h4"/><path d="M8 10v4"/><circle cx="15" cy="11" r="1"/><circle cx="17" cy="13" r="1"/></svg>
                        </div>
                        <div class="min-w-0">
                            <div class="flex items-center gap-2 flex-wrap">
                                <h2 id="study-lab-modal-title" class="text-sm sm:text-lg font-extrabold text-zinc-900 dark:text-zinc-100 tracking-tight truncate">Laboratori de Jocs d'Aprenentatge Actiu</h2>
                                <span id="study-lab-xp-val" class="text-xs font-mono font-bold tabular-nums text-blue-600 dark:text-sky-400">120 XP</span>
                                <span class="text-zinc-300 dark:text-zinc-700">·</span>
                                <span class="text-xs text-zinc-500 dark:text-zinc-400 font-medium">Ratxa: <strong id="study-lab-streak-val" class="font-mono tabular-nums text-emerald-600 dark:text-emerald-400">0</strong></span>
                            </div>
                            <p id="study-lab-modal-sub" class="text-[11px] sm:text-xs text-zinc-500 dark:text-zinc-400 truncate">Aprèn de veritat posant a prova els teus apunts amb mecàniques d'examen interactives</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <button type="button" onclick="openGeminiNotebookModal()" class="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/70 text-xs font-bold transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                            <span>Gemini Notebook</span>
                        </button>
                        <button type="button" onclick="closeStudyGamesHubModal()" class="p-2 rounded-xl bg-zinc-200/70 hover:bg-zinc-300/80 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 transition cursor-pointer" aria-label="Tancar">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>
                </div>

                <!-- Barra de Tema i Selector dels 6 Jocs -->
                <div class="px-4 sm:px-6 py-3 bg-white dark:bg-zinc-950 border-b border-zinc-200/80 dark:border-zinc-800/80 space-y-3 shrink-0">
                    <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                        <div class="flex-1 flex items-center gap-2 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-3 py-1.5">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" class="text-blue-600 dark:text-sky-400 shrink-0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                            <span class="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 whitespace-nowrap shrink-0" id="study-lab-topic-label">Tema actiu:</span>
                            <input id="study-lab-topic-input" type="text" class="w-full bg-transparent text-xs sm:text-sm font-semibold text-zinc-900 dark:text-zinc-100 outline-none" placeholder="Ex: Fotosíntesi, Derivades, La Segona Guerra Mundial, Dret Constitucional...">
                        </div>
                        <button type="button" onclick="regenerateCurrentStudyGameWithAI()" class="px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5 shrink-0 shadow-xs active:scale-95 whitespace-nowrap">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                            <span id="study-lab-regen-btn-text">Generar Joc amb IA sobre aquest tema</span>
                        </button>
                    </div>

                    <!-- Pestanyes dels 6 Jocs -->
                    <div class="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar" id="study-lab-game-tabs">
                        <button type="button" data-game-tab="memory_pairs" onclick="selectStudyLabGame('memory_pairs')" class="study-lab-tab-btn px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>
                            <span>01. Parelles de Conceptes</span>
                        </button>
                        <button type="button" data-game-tab="cloze_builder" onclick="selectStudyLabGame('cloze_builder')" class="study-lab-tab-btn px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                            <span>02. Constructor de Fórmules i Frases</span>
                        </button>
                        <button type="button" data-game-tab="sequence_order" onclick="selectStudyLabGame('sequence_order')" class="study-lab-tab-btn px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/></svg>
                            <span>03. Ordenació de Seqüència</span>
                        </button>
                        <button type="button" data-game-tab="error_hunter" onclick="selectStudyLabGame('error_hunter')" class="study-lab-tab-btn px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="12"/><line x1="11" y1="15" x2="11.01" y2="15"/></svg>
                            <span>04. Caçador de Trampes d'Examen</span>
                        </button>
                        <button type="button" data-game-tab="speed_tf" onclick="selectStudyLabGame('speed_tf')" class="study-lab-tab-btn px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                            <span>05. Sprint Veritat / Fals</span>
                        </button>
                        <button type="button" data-game-tab="exam_simulator" onclick="selectStudyLabGame('exam_simulator')" class="study-lab-tab-btn px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                            <span>06. Simulacre Kahoot & Anki 3D</span>
                        </button>
                    </div>
                </div>

                <!-- Escenari Principal del Joc -->
                <div id="study-lab-stage" class="flex-1 overflow-y-auto p-4 sm:p-6 bg-zinc-50/60 dark:bg-zinc-950 custom-scrollbar"></div>
            </div>
        `;
        document.body.appendChild(modal);
        return modal;
    }

    window.openStudyGamesHubModal = function (initialGameType, customTopic) {
        if (typeof Swal !== 'undefined') Swal.close();
        const modal = ensureGamesHubModalDOM();
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        const state = getMasteryState();
        const xpEl = document.getElementById('study-lab-xp-val');
        const streakEl = document.getElementById('study-lab-streak-val');
        if (xpEl) xpEl.textContent = `${state.xp} XP`;
        if (streakEl) streakEl.textContent = `${state.streak}`;

        const topicInput = document.getElementById('study-lab-topic-input');
        const resolvedTopic = customTopic || resolveCurrentStudyTopic();
        if (topicInput) topicInput.value = resolvedTopic;

        const targetGame = initialGameType || activeStudyGameState.gameType || 'memory_pairs';
        window.selectStudyLabGame(targetGame, resolvedTopic);
    };

    window.closeStudyGamesHubModal = function () {
        clearSpeedTfTimer();
        const modal = document.getElementById('study-games-hub-modal');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    };

    function syncGameTabsUI() {
        document.querySelectorAll('.study-lab-tab-btn').forEach(btn => {
            const tab = btn.getAttribute('data-game-tab');
            const active = tab === activeStudyGameState.gameType;
            btn.className = active
                ? 'study-lab-tab-btn px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 bg-blue-600 text-white shadow-xs'
                : 'study-lab-tab-btn px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap shrink-0 bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200/70 dark:hover:bg-zinc-800 border border-zinc-200/80 dark:border-zinc-800';
        });
    }

    window.selectStudyLabGame = function (gameType, customTopic) {
        clearSpeedTfTimer();
        activeStudyGameState.gameType = gameType || 'memory_pairs';
        const topic = customTopic || resolveCurrentStudyTopic();
        activeStudyGameState.topic = topic;
        syncGameTabsUI();

        if (gameType === 'exam_simulator') {
            renderExamSimulatorHubStage(topic);
            return;
        }

        const localData = buildLocalGameData(gameType, topic, resolveCurrentStudyContext());
        initializeGameWithData(gameType, localData);
    };

    window.regenerateCurrentStudyGameWithAI = async function () {
        const gameType = activeStudyGameState.gameType || 'memory_pairs';
        const topic = resolveCurrentStudyTopic();
        activeStudyGameState.topic = topic;

        if (gameType === 'exam_simulator') {
            renderExamSimulatorHubStage(topic);
            return;
        }

        const stage = document.getElementById('study-lab-stage');
        if (stage) {
            stage.innerHTML = `
                <div class="py-16 text-center space-y-3">
                    <div class="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/70 border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-sky-400 flex items-center justify-center mx-auto animate-spin">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                    </div>
                    <div class="text-sm font-bold text-zinc-900 dark:text-zinc-100">${tr('Generant repte interactiu amb IA sobre:', 'Generando reto interactivo con IA sobre:')} "${esc(topic)}"</div>
                    <p class="text-xs text-zinc-500 dark:text-zinc-400">${tr('Analitzant els apunts i estructurant les preguntes...', 'Analizando los apuntes y estructurando las preguntas...')}</p>
                </div>
            `;
        }

        try {
            const caller = typeof window.callGenerateApi === 'function'
                ? window.callGenerateApi
                : (payload => fetch('/api/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }));
            const res = await caller({
                action: 'generate_study_game',
                gameType,
                topic,
                context: resolveCurrentStudyContext()
            });
            const data = await res.json();
            if (data && data.gameData && !data.fallback) {
                initializeGameWithData(gameType, data.gameData);
                if (typeof showToast === 'function') {
                    showToast(tr('Nou joc generat amb IA a partir del teu temari', 'Nuevo juego generado con IA a partir de tu temario'), 'success');
                }
                return;
            }
        } catch (err) {
            console.warn('[regenerateCurrentStudyGameWithAI]', err);
        }

        const fallbackData = buildLocalGameData(gameType, topic, resolveCurrentStudyContext());
        initializeGameWithData(gameType, fallbackData);
    };

    function initializeGameWithData(gameType, gameData) {
        clearSpeedTfTimer();
        activeStudyGameState.data = gameData;

        if (gameType === 'memory_pairs') {
            const rawPairs = (gameData && Array.isArray(gameData.pairs) && gameData.pairs.length >= 3)
                ? gameData.pairs.slice(0, 6)
                : buildLocalGameData('memory_pairs', activeStudyGameState.topic, '').pairs;
            const deck = [];
            rawPairs.forEach((p, idx) => {
                deck.push({ id: `term_${idx}`, pairId: idx, kind: tr('Concepte', 'Concepto'), text: p.term, explanation: p.explanation || '' });
                deck.push({ id: `match_${idx}`, pairId: idx, kind: tr('Definició', 'Definición'), text: p.match, explanation: p.explanation || '' });
            });
            // Shuffle
            for (let i = deck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                const tmp = deck[i];
                deck[i] = deck[j];
                deck[j] = tmp;
            }
            activeStudyGameState.cards = deck;
            activeStudyGameState.flippedIndices = [];
            activeStudyGameState.matchedPairIds = [];
            activeStudyGameState.moves = 0;
            activeStudyGameState.lastMatchExplanation = '';
            renderMemoryPairsGame();
            return;
        }

        if (gameType === 'cloze_builder') {
            activeStudyGameState.clozeRound = 0;
            activeStudyGameState.clozeFilled = {};
            activeStudyGameState.clozeChecked = false;
            activeStudyGameState.clozeScore = 0;
            renderClozeBuilderGame();
            return;
        }

        if (gameType === 'sequence_order') {
            const rawSteps = (gameData && Array.isArray(gameData.steps) && gameData.steps.length >= 3)
                ? gameData.steps.map((s, idx) => ({
                    order: Number(s.order) || (idx + 1),
                    label: s.label || s.text || `Pas ${idx + 1}`,
                    detail: s.detail || ''
                }))
                : buildLocalGameData('sequence_order', activeStudyGameState.topic, '').steps;
            const scrambled = [...rawSteps];
            for (let i = scrambled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                const t = scrambled[i];
                scrambled[i] = scrambled[j];
                scrambled[j] = t;
            }
            // Ensure not already sorted
            if (scrambled.every((s, idx) => s.order === idx + 1) && scrambled.length > 1) {
                const tmp = scrambled[0];
                scrambled[0] = scrambled[1];
                scrambled[1] = tmp;
            }
            activeStudyGameState.seqItems = scrambled;
            activeStudyGameState.seqSelectedIdx = null;
            activeStudyGameState.seqChecked = false;
            activeStudyGameState.seqCorrectCount = 0;
            renderSequenceOrderGame();
            return;
        }

        if (gameType === 'error_hunter') {
            activeStudyGameState.ehRound = 0;
            activeStudyGameState.ehPicked = null;
            activeStudyGameState.ehScore = 0;
            renderErrorHunterGame();
            return;
        }

        if (gameType === 'speed_tf') {
            activeStudyGameState.tfIndex = 0;
            activeStudyGameState.tfPicked = null;
            activeStudyGameState.tfScore = 0;
            activeStudyGameState.tfCombo = 0;
            startSpeedTfRoundTimer();
            renderSpeedTfGame();
        }
    }

    // ============================================================================
    // JOC 1: PARELLES DE CONCEPTES (MEMORY MATCH PEDAGÒGIC)
    // ============================================================================
    function renderMemoryPairsGame() {
        const stage = document.getElementById('study-lab-stage');
        if (!stage) return;

        const cards = activeStudyGameState.cards || [];
        const totalPairs = Math.floor(cards.length / 2) || 6;
        const matchedCount = activeStudyGameState.matchedPairIds.length;
        const isCompleted = matchedCount >= totalPairs;

        const cardsHtml = cards.map((card, idx) => {
            const isMatched = activeStudyGameState.matchedPairIds.includes(card.pairId);
            const isFlipped = isMatched || activeStudyGameState.flippedIndices.includes(idx);

            if (isMatched) {
                return `
                    <div class="p-3.5 rounded-2xl bg-emerald-50/90 dark:bg-emerald-950/40 border-2 border-emerald-400 dark:border-emerald-700 text-left flex flex-col justify-between min-h-[112px] transition-all">
                        <div class="flex items-center justify-between text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                            <span>${esc(card.kind)}</span>
                            <span>✓ Parella #${card.pairId + 1}</span>
                        </div>
                        <div class="text-xs font-bold text-zinc-900 dark:text-zinc-100 leading-snug my-1.5">${esc(card.text)}</div>
                        <div class="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">${tr('Dominat', 'Dominado')}</div>
                    </div>
                `;
            }

            if (isFlipped) {
                return `
                    <button type="button" class="p-3.5 rounded-2xl bg-blue-50 dark:bg-blue-950/60 border-2 border-blue-500 text-left flex flex-col justify-between min-h-[112px] transition-all shadow-sm cursor-default">
                        <div class="flex items-center justify-between text-[10px] font-bold text-blue-600 dark:text-sky-400">
                            <span>${esc(card.kind)}</span>
                            <span>● Activa</span>
                        </div>
                        <div class="text-xs font-bold text-zinc-900 dark:text-zinc-100 leading-snug my-1.5">${esc(card.text)}</div>
                        <div class="text-[10px] text-blue-600 dark:text-sky-400 font-medium">${tr('Selecciona la seva parella...', 'Selecciona su pareja...')}</div>
                    </button>
                `;
            }

            return `
                <button type="button" onclick="flipMemoryPairCard(${idx})" class="p-3.5 rounded-2xl bg-white hover:bg-zinc-100/80 dark:bg-zinc-900 dark:hover:bg-zinc-800/80 border border-zinc-200/90 dark:border-zinc-800 hover:border-blue-400 dark:hover:border-blue-500 text-left flex flex-col justify-between min-h-[112px] transition-all cursor-pointer group shadow-2xs active:scale-[0.98]">
                    <div class="flex items-center justify-between text-[10px] font-semibold text-zinc-400 dark:text-zinc-500">
                        <span>Targeta #${idx + 1}</span>
                        <span class="group-hover:text-blue-500 transition-colors">${esc(card.kind)}</span>
                    </div>
                    <div class="my-auto flex items-center justify-center py-2">
                        <div class="w-8 h-8 rounded-xl bg-zinc-100 dark:bg-zinc-800 group-hover:bg-blue-50 dark:group-hover:bg-blue-950/60 text-zinc-500 dark:text-zinc-400 group-hover:text-blue-600 dark:group-hover:text-sky-400 flex items-center justify-center transition-colors">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                        </div>
                    </div>
                    <div class="text-[10px] text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-700 dark:group-hover:text-zinc-300 text-center font-medium">${tr('Clica per descobrir', 'Haz clic para descubrir')}</div>
                </button>
            `;
        }).join('');

        stage.innerHTML = `
            <div class="space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl px-4 py-3">
                    <div>
                        <h3 class="text-xs sm:text-sm font-extrabold text-zinc-900 dark:text-zinc-100">${esc(activeStudyGameState.data?.title || tr('Parelles de Conceptes i Definicions', 'Parejas de Conceptos y Definiciones'))}</h3>
                        <p class="text-[11px] text-zinc-500 dark:text-zinc-400">${tr('Connecta cada concepte o fórmula amb la seva definició exacta d\'examen.', 'Conecta cada concepto o fórmula con su definición exacta de examen.')}</p>
                    </div>
                    <div class="flex items-center gap-3 text-xs font-mono tabular-nums">
                        <span class="text-zinc-600 dark:text-zinc-300">${tr('Parelles', 'Parejas')}: <strong class="text-emerald-600 dark:text-emerald-400">${matchedCount}/${totalPairs}</strong></span>
                        <span class="text-zinc-300 dark:text-zinc-700">·</span>
                        <span class="text-zinc-600 dark:text-zinc-300">${tr('Moviments', 'Movimientos')}: <strong>${activeStudyGameState.moves}</strong></span>
                        <button type="button" onclick="selectStudyLabGame('memory_pairs')" class="px-2.5 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 font-sans font-bold text-[11px] cursor-pointer transition">${tr('Reiniciar', 'Reiniciar')}</button>
                    </div>
                </div>

                ${activeStudyGameState.lastMatchExplanation ? `
                    <div class="p-3.5 rounded-2xl bg-emerald-50/90 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 flex items-start gap-2.5 text-xs text-emerald-900 dark:text-emerald-200">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" class="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5"><polyline points="20 6 9 17 4 12"/></svg>
                        <div>
                            <span class="font-bold">${tr('Connexió d\'examen verificada:', 'Conexión de examen verificada:')}</span>
                            <span class="ml-1">${esc(activeStudyGameState.lastMatchExplanation)}</span>
                        </div>
                    </div>
                ` : ''}

                <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3">
                    ${cardsHtml}
                </div>

                ${isCompleted ? `
                    <div class="p-5 rounded-2xl bg-white dark:bg-zinc-900 border-2 border-emerald-500/80 text-center space-y-3">
                        <div class="text-base sm:text-lg font-extrabold text-zinc-900 dark:text-zinc-100">${tr('Has completat totes les parelles conceptuals!', '¡Has completado todas las parejas conceptuales!')}</div>
                        <p class="text-xs text-zinc-600 dark:text-zinc-400">${tr(`Completat en ${activeStudyGameState.moves} moviments · +40 XP registrats a la teva Memòria d'Estudi.`, `Completado en ${activeStudyGameState.moves} movimientos · +40 XP registrados en tu Memoria de Estudio.`)}</p>
                        <div class="flex flex-wrap items-center justify-center gap-2 pt-1">
                            <button type="button" onclick="regenerateCurrentStudyGameWithAI()" class="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition cursor-pointer">${tr('Generar Noves Parelles amb IA', 'Generar Nuevas Parejas con IA')}</button>
                            <button type="button" onclick="selectStudyLabGame('cloze_builder')" class="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900 text-xs font-bold transition cursor-pointer">${tr('Següent Joc: Constructor de Fórmules →', 'Siguiente Juego: Constructor de Fórmulas →')}</button>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }

    window.flipMemoryPairCard = function (idx) {
        const cards = activeStudyGameState.cards || [];
        const card = cards[idx];
        if (!card) return;
        if (activeStudyGameState.matchedPairIds.includes(card.pairId)) return;
        if (activeStudyGameState.flippedIndices.includes(idx)) return;
        if (activeStudyGameState.flippedIndices.length >= 2) return;

        playGameSound('click');
        activeStudyGameState.flippedIndices.push(idx);
        renderMemoryPairsGame();

        if (activeStudyGameState.flippedIndices.length === 2) {
            activeStudyGameState.moves++;
            const [firstIdx, secondIdx] = activeStudyGameState.flippedIndices;
            const firstCard = cards[firstIdx];
            const secondCard = cards[secondIdx];

            if (firstCard && secondCard && firstCard.pairId === secondCard.pairId) {
                activeStudyGameState.matchedPairIds.push(firstCard.pairId);
                activeStudyGameState.flippedIndices = [];
                activeStudyGameState.lastMatchExplanation = firstCard.explanation || `${firstCard.text} ↔ ${secondCard.text}`;
                const totalPairs = Math.floor(cards.length / 2) || 6;
                if (activeStudyGameState.matchedPairIds.length >= totalPairs) {
                    playGameSound('victory');
                    awardStudyXp(40, true, activeStudyGameState.topic);
                    if (typeof confetti === 'function') confetti({ particleCount: 60, spread: 55, origin: { y: 0.6 } });
                } else {
                    playGameSound('success');
                    awardStudyXp(10, true, activeStudyGameState.topic);
                }
                renderMemoryPairsGame();
            } else {
                playGameSound('error');
                setTimeout(() => {
                    activeStudyGameState.flippedIndices = [];
                    renderMemoryPairsGame();
                }, 850);
            }
        }
    };

    // ============================================================================
    // JOC 2: CONSTRUCTOR DE DEFINICIONS I FÓRMULES (CLOZE BUILDER)
    // ============================================================================
    function renderClozeBuilderGame() {
        const stage = document.getElementById('study-lab-stage');
        if (!stage) return;

        const items = (activeStudyGameState.data && Array.isArray(activeStudyGameState.data.items) && activeStudyGameState.data.items.length > 0)
            ? activeStudyGameState.data.items
            : buildLocalGameData('cloze_builder', activeStudyGameState.topic, '').items;

        const roundIdx = Math.min(activeStudyGameState.clozeRound || 0, items.length - 1);
        const currentItem = items[roundIdx];
        const blanks = Array.isArray(currentItem.blanks) ? currentItem.blanks : ['concepte', 'aplicació'];
        const distractors = Array.isArray(currentItem.distractors) ? currentItem.distractors : ['hipòtesi', 'excepció'];
        const allTokens = [...blanks, ...distractors];

        // Render sentence with interactive slots
        let sentenceHtml = esc(currentItem.sentence || '');
        blanks.forEach((ans, bIdx) => {
            const tokenKey = `__${bIdx + 1}__`;
            const userVal = activeStudyGameState.clozeFilled[bIdx];
            const isChecked = activeStudyGameState.clozeChecked;
            const isCorrect = isChecked && userVal && userVal.toLowerCase() === ans.toLowerCase();

            let slotClass = 'inline-flex items-center justify-center min-w-[110px] px-3 py-1 mx-1 rounded-xl border-2 font-bold text-xs transition cursor-pointer ';
            if (!userVal) {
                slotClass += 'border-dashed border-blue-400 dark:border-blue-500 bg-blue-50/50 dark:bg-blue-950/40 text-blue-600 dark:text-sky-400';
            } else if (!isChecked) {
                slotClass += 'border-blue-600 bg-blue-600 text-white shadow-2xs';
            } else if (isCorrect) {
                slotClass += 'border-emerald-600 bg-emerald-600 text-white';
            } else {
                slotClass += 'border-rose-600 bg-rose-600 text-white';
            }

            const slotHtml = `<button type="button" onclick="clearClozeBlankSlot(${bIdx})" class="${slotClass}">${userVal ? esc(userVal) : `Buit #${bIdx + 1}`}</button>`;
            if (sentenceHtml.includes(tokenKey)) {
                sentenceHtml = sentenceHtml.replace(tokenKey, slotHtml);
            } else {
                sentenceHtml += ' ' + slotHtml;
            }
        });

        const usedWords = Object.values(activeStudyGameState.clozeFilled);

        stage.innerHTML = `
            <div class="max-w-3xl mx-auto space-y-5">
                <div class="flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl px-4 py-3">
                    <div>
                        <h3 class="text-xs sm:text-sm font-extrabold text-zinc-900 dark:text-zinc-100">${esc(activeStudyGameState.data?.title || tr('Constructor de Definicions i Fórmules', 'Constructor de Definiciones y Fórmulas'))}</h3>
                        <p class="text-[11px] text-zinc-500 dark:text-zinc-400">${tr('Fes clic als termes del banc inferior per omplir els buits de la definició d\'examen.', 'Haz clic en los términos del banco inferior para completar los huecos de la definición de examen.')}</p>
                    </div>
                    <div class="text-xs font-mono tabular-nums font-bold text-blue-600 dark:text-sky-400">
                        ${tr('Repte', 'Reto')} ${roundIdx + 1} / ${items.length} · ${tr('Encerts', 'Aciertos')}: ${activeStudyGameState.clozeScore}
                    </div>
                </div>

                <!-- Targeta de la Frase / Fórmula -->
                <div class="p-6 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-5 shadow-xs">
                    <div class="text-sm sm:text-base font-semibold text-zinc-900 dark:text-zinc-100 leading-loose">
                        ${sentenceHtml}
                    </div>

                    <!-- Banc de Paraules amb Distractors -->
                    <div class="pt-4 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
                        <div class="text-[11px] font-bold text-zinc-500 dark:text-zinc-400">${tr('Banc de conceptes (inclou distractors d\'examen):', 'Banco de conceptos (incluye distractores de examen):')}</div>
                        <div class="flex flex-wrap gap-2">
                            ${allTokens.map((word) => {
                                const isUsed = usedWords.includes(word);
                                return `
                                    <button type="button" ${isUsed || activeStudyGameState.clozeChecked ? 'disabled' : ''} onclick="pickClozeWordToken('${esc(word).replace(/'/g, "\\'")}')" class="px-3.5 py-2 rounded-xl text-xs font-bold border transition cursor-pointer ${isUsed ? 'bg-zinc-100 dark:bg-zinc-800/50 text-zinc-400 dark:text-zinc-600 border-zinc-200 dark:border-zinc-800 cursor-default' : 'bg-zinc-50 hover:bg-blue-50 dark:bg-zinc-800 dark:hover:bg-blue-950/60 text-zinc-800 dark:text-zinc-100 border-zinc-200 dark:border-zinc-700 hover:border-blue-500'}">
                                        ${esc(word)}
                                    </button>
                                `;
                            }).join('')}
                        </div>
                    </div>

                    ${activeStudyGameState.clozeChecked ? `
                        <div class="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 space-y-2 text-xs">
                            <div class="font-bold text-zinc-900 dark:text-zinc-100">
                                ${tr('Solució correcta:', 'Solución correcta:')} <span class="text-emerald-600 dark:text-emerald-400">${blanks.map((b, i) => `(#${i + 1}: ${esc(b)})`).join(' · ')}</span>
                            </div>
                            <p class="text-zinc-600 dark:text-zinc-400 leading-relaxed">${esc(currentItem.explanation || '')}</p>
                        </div>
                    ` : ''}

                    <div class="flex items-center justify-end gap-2 pt-2">
                        ${!activeStudyGameState.clozeChecked ? `
                            <button type="button" onclick="verifyClozeBuilderRound()" class="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition cursor-pointer shadow-xs">${tr('Comprovar Resposta', 'Comprobar Respuesta')}</button>
                        ` : (roundIdx < items.length - 1 ? `
                            <button type="button" onclick="nextClozeBuilderRound()" class="px-5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900 text-xs font-bold transition cursor-pointer">${tr('Següent Repte →', 'Siguiente Reto →')}</button>
                        ` : `
                            <button type="button" onclick="regenerateCurrentStudyGameWithAI()" class="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition cursor-pointer">${tr('Generar Nous Reptes amb IA', 'Generar Nuevos Retos con IA')}</button>
                        `)}
                    </div>
                </div>
            </div>
        `;
    }

    window.pickClozeWordToken = function (word) {
        if (activeStudyGameState.clozeChecked) return;
        const items = (activeStudyGameState.data && Array.isArray(activeStudyGameState.data.items))
            ? activeStudyGameState.data.items
            : buildLocalGameData('cloze_builder', activeStudyGameState.topic, '').items;
        const currentItem = items[activeStudyGameState.clozeRound || 0] || items[0];
        const totalBlanks = (currentItem.blanks || []).length || 2;

        for (let i = 0; i < totalBlanks; i++) {
            if (!activeStudyGameState.clozeFilled[i]) {
                activeStudyGameState.clozeFilled[i] = word;
                playGameSound('click');
                renderClozeBuilderGame();
                return;
            }
        }
    };

    window.clearClozeBlankSlot = function (slotIdx) {
        if (activeStudyGameState.clozeChecked) return;
        delete activeStudyGameState.clozeFilled[slotIdx];
        playGameSound('click');
        renderClozeBuilderGame();
    };

    window.verifyClozeBuilderRound = function () {
        const items = (activeStudyGameState.data && Array.isArray(activeStudyGameState.data.items))
            ? activeStudyGameState.data.items
            : buildLocalGameData('cloze_builder', activeStudyGameState.topic, '').items;
        const currentItem = items[activeStudyGameState.clozeRound || 0] || items[0];
        const blanks = currentItem.blanks || [];

        const allCorrect = blanks.every((ans, idx) => {
            const picked = activeStudyGameState.clozeFilled[idx] || '';
            return picked.trim().toLowerCase() === String(ans).trim().toLowerCase();
        });

        activeStudyGameState.clozeChecked = true;
        if (allCorrect) {
            activeStudyGameState.clozeScore++;
            playGameSound('success');
            awardStudyXp(20, true, activeStudyGameState.topic);
        } else {
            playGameSound('error');
            awardStudyXp(5, false, activeStudyGameState.topic);
        }
        renderClozeBuilderGame();
    };

    window.nextClozeBuilderRound = function () {
        activeStudyGameState.clozeRound = (activeStudyGameState.clozeRound || 0) + 1;
        activeStudyGameState.clozeFilled = {};
        activeStudyGameState.clozeChecked = false;
        renderClozeBuilderGame();
    };

    // ============================================================================
    // JOC 3: ORDENACIÓ CRONOLÒGICA I SEQÜÈNCIA DE PASSOS
    // ============================================================================
    function renderSequenceOrderGame() {
        const stage = document.getElementById('study-lab-stage');
        if (!stage) return;

        const items = activeStudyGameState.seqItems || [];
        const isChecked = activeStudyGameState.seqChecked;

        const listHtml = items.map((step, idx) => {
            const isRightPos = step.order === idx + 1;
            const isSelected = activeStudyGameState.seqSelectedIdx === idx;

            let borderClass = 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900';
            if (isSelected && !isChecked) {
                borderClass = 'border-blue-500 bg-blue-50/60 dark:bg-blue-950/40 ring-2 ring-blue-500/20';
            } else if (isChecked) {
                borderClass = isRightPos
                    ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/40'
                    : 'border-rose-500 bg-rose-50/70 dark:bg-rose-950/40';
            }

            return `
                <div class="p-3.5 rounded-2xl border-2 ${borderClass} flex items-center justify-between gap-3 transition-all">
                    <div class="flex items-center gap-3 min-w-0 flex-1 cursor-pointer" onclick="selectSequenceStepToSwap(${idx})">
                        <span class="w-8 h-8 rounded-xl font-mono font-extrabold text-xs flex items-center justify-center shrink-0 ${isChecked ? (isRightPos ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white') : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200'}">
                            ${idx + 1}
                        </span>
                        <div class="min-w-0 flex-1">
                            <div class="text-xs sm:text-sm font-bold text-zinc-900 dark:text-zinc-100">${esc(step.label)}</div>
                            ${isChecked ? `<div class="text-[11px] mt-1 ${isRightPos ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}">${isRightPos ? '✓ Posició correcta' : `Posició real: Pas #${step.order}`} · ${esc(step.detail || '')}</div>` : ''}
                        </div>
                    </div>
                    ${!isChecked ? `
                        <div class="flex items-center gap-1 shrink-0">
                            <button type="button" ${idx === 0 ? 'disabled' : ''} onclick="moveSequenceStep(${idx}, -1)" class="p-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 disabled:opacity-30 cursor-pointer" title="Pujar">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="18 15 12 9 6 15"/></svg>
                            </button>
                            <button type="button" ${idx === items.length - 1 ? 'disabled' : ''} onclick="moveSequenceStep(${idx}, 1)" class="p-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 disabled:opacity-30 cursor-pointer" title="Baixar">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="6 9 12 15 18 9"/></svg>
                            </button>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        stage.innerHTML = `
            <div class="max-w-3xl mx-auto space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl px-4 py-3">
                    <div>
                        <h3 class="text-xs sm:text-sm font-extrabold text-zinc-900 dark:text-zinc-100">${esc(activeStudyGameState.data?.title || tr('Seqüència i Ordre Lògic', 'Secuencia y Orden Lógico'))}</h3>
                        <p class="text-[11px] text-zinc-500 dark:text-zinc-400">${esc(activeStudyGameState.data?.prompt || tr('Utilitza les fletxes o clica dos passos per intercanviar-los fins que estiguin en l\'ordre correcte (1 a 5).', 'Usa las flechas o haz clic en dos pasos para intercambiarlos hasta que estén en el orden correcto (1 a 5).'))}</p>
                    </div>
                </div>

                <div class="space-y-2.5">
                    ${listHtml}
                </div>

                <div class="flex flex-wrap items-center justify-between gap-2 pt-2">
                    ${isChecked ? `
                        <div class="text-xs font-bold ${activeStudyGameState.seqCorrectCount === items.length ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}">
                            ${tr('Passos en la posició exacta:', 'Pasos en la posición exacta:')} ${activeStudyGameState.seqCorrectCount} / ${items.length}
                        </div>
                        <div class="flex items-center gap-2">
                            <button type="button" onclick="selectStudyLabGame('sequence_order')" class="px-4 py-2 rounded-xl bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-xs font-bold cursor-pointer">${tr('Tornar a Ordenar', 'Volver a Ordenar')}</button>
                            <button type="button" onclick="regenerateCurrentStudyGameWithAI()" class="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold cursor-pointer">${tr('Nova Seqüència amb IA', 'Nueva Secuencia con IA')}</button>
                        </div>
                    ` : `
                        <span class="text-[11px] text-zinc-500 dark:text-zinc-400">${tr('Consell: pots clicar una targeta i després una altra per intercanviar-les.', 'Consejo: puedes hacer clic en una tarjeta y luego en otra para intercambiarlas.')}</span>
                        <button type="button" onclick="verifySequenceOrderGame()" class="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition cursor-pointer shadow-xs">${tr('Verificar Ordre (1 → 5)', 'Verificar Orden (1 → 5)')}</button>
                    `}
                </div>
            </div>
        `;
    }

    window.moveSequenceStep = function (idx, delta) {
        if (activeStudyGameState.seqChecked) return;
        const arr = activeStudyGameState.seqItems;
        const target = idx + delta;
        if (target < 0 || target >= arr.length) return;
        const tmp = arr[idx];
        arr[idx] = arr[target];
        arr[target] = tmp;
        activeStudyGameState.seqSelectedIdx = null;
        playGameSound('click');
        renderSequenceOrderGame();
    };

    window.selectSequenceStepToSwap = function (idx) {
        if (activeStudyGameState.seqChecked) return;
        if (activeStudyGameState.seqSelectedIdx === null) {
            activeStudyGameState.seqSelectedIdx = idx;
            playGameSound('click');
        } else if (activeStudyGameState.seqSelectedIdx === idx) {
            activeStudyGameState.seqSelectedIdx = null;
        } else {
            const arr = activeStudyGameState.seqItems;
            const prev = activeStudyGameState.seqSelectedIdx;
            const tmp = arr[prev];
            arr[prev] = arr[idx];
            arr[idx] = tmp;
            activeStudyGameState.seqSelectedIdx = null;
            playGameSound('click');
        }
        renderSequenceOrderGame();
    };

    window.verifySequenceOrderGame = function () {
        const arr = activeStudyGameState.seqItems || [];
        let correct = 0;
        arr.forEach((item, idx) => {
            if (item.order === idx + 1) correct++;
        });
        activeStudyGameState.seqChecked = true;
        activeStudyGameState.seqCorrectCount = correct;
        const isWin = correct === arr.length;
        if (isWin) {
            playGameSound('victory');
            awardStudyXp(35, true, activeStudyGameState.topic);
            if (typeof confetti === 'function') confetti({ particleCount: 55, spread: 60, origin: { y: 0.6 } });
        } else {
            playGameSound(correct >= 3 ? 'success' : 'error');
            awardStudyXp(correct * 5, correct >= 3, activeStudyGameState.topic);
        }
        renderSequenceOrderGame();
    };

    // ============================================================================
    // JOC 4: CAÇADOR DE TRAMPES D'EXAMEN (SPOT THE MISTAKE)
    // ============================================================================
    function renderErrorHunterGame() {
        const stage = document.getElementById('study-lab-stage');
        if (!stage) return;

        const rounds = (activeStudyGameState.data && Array.isArray(activeStudyGameState.data.rounds) && activeStudyGameState.data.rounds.length > 0)
            ? activeStudyGameState.data.rounds
            : buildLocalGameData('error_hunter', activeStudyGameState.topic, '').rounds;

        const rIdx = Math.min(activeStudyGameState.ehRound || 0, rounds.length - 1);
        const currentRound = rounds[rIdx];
        const statements = Array.isArray(currentRound.statements) ? currentRound.statements : [];
        const errorIdx = Number(currentRound.errorIndex) || 0;
        const picked = activeStudyGameState.ehPicked;
        const isAnswered = picked !== null && picked !== undefined;

        stage.innerHTML = `
            <div class="max-w-3xl mx-auto space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl px-4 py-3">
                    <div>
                        <h3 class="text-xs sm:text-sm font-extrabold text-zinc-900 dark:text-zinc-100">${esc(activeStudyGameState.data?.title || tr('Caçador de Trampes d\'Examen', 'Cazador de Trampas de Examen'))}</h3>
                        <p class="text-[11px] text-zinc-500 dark:text-zinc-400">${tr('3 afirmacions són certes i 1 amaga una trampa conceptual d\'examen. Clica l\'afirmació FALSA!', '3 afirmaciones son ciertas y 1 esconde una trampa conceptual de examen. ¡Haz clic en la afirmación FALSA!')}</p>
                    </div>
                    <div class="text-xs font-mono tabular-nums font-bold text-blue-600 dark:text-sky-400">
                        Ronda ${rIdx + 1}/${rounds.length} · ${tr('Trampes caçades', 'Trampas cazadas')}: ${activeStudyGameState.ehScore}
                    </div>
                </div>

                <div class="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-3">
                    <div class="text-xs sm:text-sm font-bold text-zinc-800 dark:text-zinc-200">${esc(currentRound.context || '')}</div>
                    <div class="space-y-2.5">
                        ${statements.map((stmt, idx) => {
                            let cls = 'w-full p-3.5 rounded-2xl border text-left text-xs sm:text-sm font-medium transition flex items-start gap-3 cursor-pointer ';
                            let badge = String.fromCharCode(65 + idx);
                            if (!isAnswered) {
                                cls += 'bg-zinc-50 hover:bg-amber-50/70 dark:bg-zinc-950 dark:hover:bg-amber-950/30 border-zinc-200 dark:border-zinc-800 hover:border-amber-500 text-zinc-800 dark:text-zinc-100';
                            } else if (idx === errorIdx) {
                                cls += 'bg-emerald-50 dark:bg-emerald-950/50 border-2 border-emerald-500 text-emerald-950 dark:text-emerald-200 font-bold';
                                badge = '✓';
                            } else if (idx === picked && picked !== errorIdx) {
                                cls += 'bg-rose-50 dark:bg-rose-950/50 border-2 border-rose-500 text-rose-950 dark:text-rose-200';
                                badge = '✗';
                            } else {
                                cls += 'bg-zinc-50/60 dark:bg-zinc-950/50 border-zinc-200 dark:border-zinc-800 text-zinc-500 opacity-70';
                            }
                            return `
                                <button type="button" ${isAnswered ? 'disabled' : ''} onclick="pickErrorHunterStatement(${idx})" class="${cls}">
                                    <span class="w-6 h-6 rounded-lg bg-zinc-200/80 dark:bg-zinc-800 font-mono font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">${badge}</span>
                                    <span class="flex-1 leading-relaxed">${esc(stmt)}</span>
                                </button>
                            `;
                        }).join('')}
                    </div>

                    ${isAnswered ? `
                        <div class="p-4 rounded-2xl ${picked === errorIdx ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-950 dark:text-emerald-200' : 'bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-950 dark:text-rose-200'} text-xs space-y-1.5">
                            <div class="font-extrabold">${picked === errorIdx ? tr('Trampa d\'examen detectada!', '¡Trampa de examen detectada!') : tr('Atenció! Aquesta afirmació era certa. La trampa era l\'opció ' + String.fromCharCode(65 + errorIdx) + ':', '¡Atención! Esa afirmación era cierta. La trampa era la opción ' + String.fromCharCode(65 + errorIdx) + ':')}</div>
                            <p class="leading-relaxed">${esc(currentRound.correction || '')}</p>
                        </div>
                        <div class="flex justify-end pt-1">
                            ${rIdx < rounds.length - 1 ? `
                                <button type="button" onclick="nextErrorHunterRound()" class="px-5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900 text-xs font-bold cursor-pointer">${tr('Següent Cas →', 'Siguiente Caso →')}</button>
                            ` : `
                                <button type="button" onclick="regenerateCurrentStudyGameWithAI()" class="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold cursor-pointer">${tr('Generar Nous Casos amb IA', 'Generar Nuevos Casos con IA')}</button>
                            `}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    window.pickErrorHunterStatement = function (idx) {
        if (activeStudyGameState.ehPicked !== null) return;
        const rounds = (activeStudyGameState.data && Array.isArray(activeStudyGameState.data.rounds))
            ? activeStudyGameState.data.rounds
            : buildLocalGameData('error_hunter', activeStudyGameState.topic, '').rounds;
        const currentRound = rounds[activeStudyGameState.ehRound || 0] || rounds[0];
        const errorIdx = Number(currentRound.errorIndex) || 0;

        activeStudyGameState.ehPicked = idx;
        const isWin = idx === errorIdx;
        if (isWin) {
            activeStudyGameState.ehScore++;
            playGameSound('success');
            awardStudyXp(25, true, activeStudyGameState.topic);
        } else {
            playGameSound('error');
            awardStudyXp(5, false, activeStudyGameState.topic);
        }
        renderErrorHunterGame();
    };

    window.nextErrorHunterRound = function () {
        activeStudyGameState.ehRound = (activeStudyGameState.ehRound || 0) + 1;
        activeStudyGameState.ehPicked = null;
        renderErrorHunterGame();
    };

    // ============================================================================
    // JOC 5: SPRINT VERITAT / FALS AMB JUSTIFICACIÓ I COMBO
    // ============================================================================
    function startSpeedTfRoundTimer() {
        clearSpeedTfTimer();
        activeStudyGameState.tfTimeLeft = 15;
        activeStudyGameState.tfTimer = setInterval(() => {
            if (activeStudyGameState.tfPicked !== null) return;
            activeStudyGameState.tfTimeLeft = Math.max(0, (activeStudyGameState.tfTimeLeft || 15) - 1);
            const bar = document.getElementById('speed-tf-timer-bar');
            const label = document.getElementById('speed-tf-timer-val');
            if (label) label.textContent = `${activeStudyGameState.tfTimeLeft}s`;
            if (bar) bar.style.width = `${(activeStudyGameState.tfTimeLeft / 15) * 100}%`;
            if (activeStudyGameState.tfTimeLeft <= 0) {
                clearSpeedTfTimer();
                window.answerSpeedTfGame(null);
            }
        }, 1000);
    }

    function renderSpeedTfGame() {
        const stage = document.getElementById('study-lab-stage');
        if (!stage) return;

        const statements = (activeStudyGameState.data && Array.isArray(activeStudyGameState.data.statements) && activeStudyGameState.data.statements.length > 0)
            ? activeStudyGameState.data.statements
            : buildLocalGameData('speed_tf', activeStudyGameState.topic, '').statements;

        const idx = Math.min(activeStudyGameState.tfIndex || 0, statements.length - 1);
        const item = statements[idx];
        const picked = activeStudyGameState.tfPicked;
        const isAnswered = picked !== null && picked !== undefined;
        const isWin = isAnswered && picked === Boolean(item.isTrue);

        stage.innerHTML = `
            <div class="max-w-2xl mx-auto space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl px-4 py-3">
                    <div class="flex items-center gap-2">
                        <span class="text-xs font-extrabold text-zinc-900 dark:text-zinc-100">${tr('Afirmació', 'Afirmación')} ${idx + 1}/${statements.length}</span>
                        <span class="text-zinc-300 dark:text-zinc-700">·</span>
                        <span class="text-xs font-mono font-bold text-amber-600 dark:text-amber-400">Combo x${Math.max(1, activeStudyGameState.tfCombo)}</span>
                    </div>
                    <div class="flex items-center gap-3 text-xs font-mono tabular-nums">
                        <span id="speed-tf-timer-val" class="font-bold text-rose-600 dark:text-rose-400">${activeStudyGameState.tfTimeLeft}s</span>
                        <span class="font-bold text-emerald-600 dark:text-emerald-400">${activeStudyGameState.tfScore}/${statements.length}</span>
                    </div>
                </div>

                <div class="w-full h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                    <div id="speed-tf-timer-bar" class="h-full bg-blue-600 transition-all duration-1000" style="width: ${(activeStudyGameState.tfTimeLeft / 15) * 100}%"></div>
                </div>

                <div class="p-6 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-5 text-center shadow-xs">
                    <p class="text-sm sm:text-base font-bold text-zinc-900 dark:text-zinc-100 leading-relaxed">${esc(item.text)}</p>

                    <div class="grid grid-cols-2 gap-3">
                        <button type="button" ${isAnswered ? 'disabled' : ''} onclick="answerSpeedTfGame(true)" class="py-3.5 px-4 rounded-2xl font-extrabold text-xs sm:text-sm border-2 transition cursor-pointer ${isAnswered ? (item.isTrue ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 border-zinc-200 dark:border-zinc-800') : 'bg-emerald-50 hover:bg-emerald-600 text-emerald-800 hover:text-white dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-600 dark:hover:text-white border-emerald-300 dark:border-emerald-800'}">
                            ${tr('VERITAT', 'VERDADERO')}
                        </button>
                        <button type="button" ${isAnswered ? 'disabled' : ''} onclick="answerSpeedTfGame(false)" class="py-3.5 px-4 rounded-2xl font-extrabold text-xs sm:text-sm border-2 transition cursor-pointer ${isAnswered ? (!item.isTrue ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 border-zinc-200 dark:border-zinc-800') : 'bg-rose-50 hover:bg-rose-600 text-rose-800 hover:text-white dark:bg-rose-950/50 dark:text-rose-300 dark:hover:bg-rose-600 dark:hover:text-white border-rose-300 dark:border-rose-800'}">
                            ${tr('FALS', 'FALSO')}
                        </button>
                    </div>

                    ${isAnswered ? `
                        <div class="p-4 rounded-2xl text-left text-xs ${isWin ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-950 dark:text-emerald-200' : 'bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-950 dark:text-rose-200'} space-y-1">
                            <div class="font-extrabold">${isWin ? tr('Correcte!', '¡Correcto!') : tr('Incorrecte / Temps exhaurit', 'Incorrecto / Tiempo agotado')}</div>
                            <p>${esc(item.reason || '')}</p>
                        </div>
                        <div class="flex justify-end">
                            ${idx < statements.length - 1 ? `
                                <button type="button" onclick="nextSpeedTfQuestion()" class="px-5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900 text-xs font-bold cursor-pointer">${tr('Següent Afirmació →', 'Siguiente Afirmación →')}</button>
                            ` : `
                                <button type="button" onclick="regenerateCurrentStudyGameWithAI()" class="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold cursor-pointer">${tr('Nou Sprint amb IA', 'Nuevo Sprint con IA')}</button>
                            `}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    window.answerSpeedTfGame = function (choice) {
        if (activeStudyGameState.tfPicked !== null) return;
        clearSpeedTfTimer();
        const statements = (activeStudyGameState.data && Array.isArray(activeStudyGameState.data.statements))
            ? activeStudyGameState.data.statements
            : buildLocalGameData('speed_tf', activeStudyGameState.topic, '').statements;
        const item = statements[activeStudyGameState.tfIndex || 0] || statements[0];

        activeStudyGameState.tfPicked = choice === null ? 'timeout' : Boolean(choice);
        const isWin = choice !== null && Boolean(choice) === Boolean(item.isTrue);
        if (isWin) {
            activeStudyGameState.tfScore++;
            activeStudyGameState.tfCombo = (activeStudyGameState.tfCombo || 0) + 1;
            playGameSound('success');
            awardStudyXp(15 * Math.min(3, activeStudyGameState.tfCombo), true, activeStudyGameState.topic);
        } else {
            activeStudyGameState.tfCombo = 0;
            playGameSound('error');
        }
        renderSpeedTfGame();
    };

    window.nextSpeedTfQuestion = function () {
        activeStudyGameState.tfIndex = (activeStudyGameState.tfIndex || 0) + 1;
        activeStudyGameState.tfPicked = null;
        startSpeedTfRoundTimer();
        renderSpeedTfGame();
    };

    // ============================================================================
    // JOC 6: LLANÇADOR DE SIMULACRE KAHOOT, FLASHCARDS 3D I ESQUEMA
    // ============================================================================
    function renderExamSimulatorHubStage(topic) {
        const stage = document.getElementById('study-lab-stage');
        if (!stage) return;

        stage.innerHTML = `
            <div class="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-4">
                <div class="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex flex-col justify-between space-y-4">
                    <div class="space-y-2">
                        <div class="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        </div>
                        <h4 class="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">${tr('Simulacre d\'Examen Kahoot (Cronometrat)', 'Simulacro de Examen Kahoot (Cronometrado)')}</h4>
                        <p class="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">${tr('Genera 5 preguntes d\'opció múltiple amb 20s per pregunta sobre el tema seleccionat i desa la nota a la Memòria.', 'Genera 5 preguntas de opción múltiple con 20s por pregunta sobre el tema seleccionado y guarda la nota en la Memoria.')}</p>
                    </div>
                    <button type="button" onclick="closeStudyGamesHubModal(); triggerToolFromChat('exam', null, 'Prepara un Test d\\'Examen Kahoot sobre: ' + ${JSON.stringify(topic)});" class="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer transition">${tr('Iniciar Kahoot al Xat →', 'Iniciar Kahoot en el Chat →')}</button>
                </div>

                <div class="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex flex-col justify-between space-y-4">
                    <div class="space-y-2">
                        <div class="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 15h10"/><path d="M7 11h6"/></svg>
                        </div>
                        <h4 class="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">${tr('Baralla Flashcards 3D (Repetició Espaiada)', 'Baraja Flashcards 3D (Repetición Espaciada)')}</h4>
                        <p class="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">${tr('Genera entre 8 i 10 targetes giratòries 3D amb autoavaluació (Difícil / Regular / Dominat) estil Anki.', 'Genera entre 8 y 10 tarjetas giratorias 3D con autoevaluación (Difícil / Regular / Dominado) estilo Anki.')}</p>
                    </div>
                    <button type="button" onclick="closeStudyGamesHubModal(); triggerToolFromChat('anki', null, 'Crea una baralla de Flashcards 3D sobre: ' + ${JSON.stringify(topic)});" class="w-full py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold cursor-pointer transition">${tr('Generar Flashcards 3D →', 'Generar Flashcards 3D →')}</button>
                </div>

                <div class="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex flex-col justify-between space-y-4">
                    <div class="space-y-2">
                        <div class="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="3"/><path d="M12 3v6M12 15v6M3 12h6M15 12h6"/></svg>
                        </div>
                        <h4 class="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">${tr('Mapa Mental Interactiu (D3.js)', 'Mapa Mental Interactivo (D3.js)')}</h4>
                        <p class="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">${tr('Visualitza l\'arbre jeràrquic de tots els conceptes, fórmules i subtemes tractats a la sessió.', 'Visualiza el árbol jerárquico de todos los conceptos, fórmulas y subtemas tratados en la sesión.')}</p>
                    </div>
                    <button type="button" onclick="closeStudyGamesHubModal(); if(typeof openMindMapModal==='function') openMindMapModal();" class="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer transition">${tr('Obrir Mapa Mental D3 →', 'Abrir Mapa Mental D3 →')}</button>
                </div>
            </div>
        `;
    }

    // ============================================================================
    // GEMINI NOTEBOOK STUDIO (ESTIL GOOGLE NOTEBOOKLM INTEGRAT A L'APP)
    // ============================================================================
    let notebookState = {
        title: "Quadern d'Estudi i Investigació",
        sources: [],
        notes: [],
        chatMessages: [],
        audioOverview: null,
        audioPlaying: false,
        audioCurrentTurn: 0,
        audioRate: 1.0
    };

    function loadNotebookState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY_NOTEBOOK);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    notebookState = Object.assign(notebookState, parsed);
                    notebookState.audioPlaying = false;
                }
            }
        } catch (_) {}

        // Sincronitzar automàticament amb apunts PDF o Pla d'Estudis actiu si no hi estan
        if (typeof finalStudyText !== 'undefined' && finalStudyText && finalStudyText.trim().length > 20) {
            const pdfTitle = (typeof uploadedPDFs !== 'undefined' && Array.isArray(uploadedPDFs) && uploadedPDFs[0]?.name)
                ? uploadedPDFs[0].name
                : tr('Apunts PDF del Pla d\'Estudi', 'Apuntes PDF del Plan de Estudio');
            if (!notebookState.sources.some(s => s.title === pdfTitle)) {
                notebookState.sources.unshift({
                    id: 'src_pdf_' + Date.now(),
                    title: pdfTitle,
                    type: 'PDF',
                    checked: true,
                    content: finalStudyText.trim().substring(0, 15000)
                });
            }
        }

        if (notebookState.sources.length === 0) {
            const topic = resolveCurrentStudyTopic();
            const ctx = resolveCurrentStudyContext();
            notebookState.title = topic;
            notebookState.sources.push({
                id: 'src_default_1',
                title: tr(`Apunts Base: ${topic}`, `Apuntes Base: ${topic}`),
                type: tr('Apunts', 'Apuntes'),
                checked: true,
                content: ctx && ctx.length > 30
                    ? ctx
                    : tr(
                        `Document de referència acadèmica sobre ${topic}.\n1. Definició i fonaments teòrics centrals.\n2. Relacions causals, fórmules i metodologia de resolució pas a pas.\n3. Casos pràctics i preguntes freqüents d'examen (PAU / Universitat).\n4. Errors habituals a evitar: omissió d'unitats, confusió entre causa i efecte i falta de justificació.`,
                        `Documento de referencia académica sobre ${topic}.\n1. Definición y fundamentos teóricos centrales.\n2. Relaciones causales, fórmulas y metodología de resolución paso a paso.\n3. Casos prácticos y preguntas frecuentes de examen (PAU / Universidad).\n4. Errores habituales a evitar: omisión de unidades, confusión entre causa y efecto y falta de justificación.`
                    )
            });
        }
    }

    function saveNotebookState() {
        try {
            localStorage.setItem(STORAGE_KEY_NOTEBOOK, JSON.stringify({
                title: notebookState.title,
                sources: notebookState.sources,
                notes: notebookState.notes,
                chatMessages: notebookState.chatMessages,
                audioOverview: notebookState.audioOverview,
                audioCurrentTurn: notebookState.audioCurrentTurn,
                audioRate: notebookState.audioRate
            }));
        } catch (_) {}
    }

    function stopNotebookPodcastSpeech() {
        notebookState.audioPlaying = false;
        try {
            if ('speechSynthesis' in window) {
                window.speechSynthesis.cancel();
            }
        } catch (_) {}
    }

    function ensureGeminiNotebookModalDOM() {
        let modal = document.getElementById('gemini-notebook-modal');
        if (modal) return modal;

        modal = document.createElement('div');
        modal.id = 'gemini-notebook-modal';
        modal.className = 'fixed inset-0 z-[9996] hidden items-center justify-center bg-black/80 backdrop-blur-md p-1.5 sm:p-3 md:p-5 overflow-hidden';
        modal.innerHTML = `
            <div class="w-full max-w-[1400px] h-[95dvh] bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-fade-in">
                <!-- Capçalera superior estil Google NotebookLM -->
                <div class="px-4 sm:px-6 py-3 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
                    <div class="flex items-center gap-3 min-w-0">
                        <div class="w-9 h-9 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                        </div>
                        <div class="min-w-0">
                            <div class="flex items-center gap-2">
                                <input id="nb-title-input" type="text" onchange="updateNotebookTitle(this.value)" class="bg-transparent text-sm sm:text-base font-extrabold text-zinc-900 dark:text-zinc-100 outline-none border-b border-transparent focus:border-indigo-500 truncate max-w-[260px] sm:max-w-md" value="Quadern d'Estudi">
                                <span class="text-xs text-zinc-400 dark:text-zinc-500">· Gemini Notebook Studio</span>
                            </div>
                            <p class="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">${tr('Fonts verificades amb citacions [Font X], Audio Overview a 2 veus (Marc i Laia), Guia d\'Estudi i Notes', 'Fuentes verificadas con citas [Font X], Audio Overview a 2 voces (Marc y Laia), Guía de Estudio y Notas')}</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <button type="button" onclick="openStudyGamesHubModal(null, notebookState.title)" class="px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 dark:hover:bg-blue-900/70 text-blue-700 dark:text-sky-300 border border-blue-200 dark:border-blue-800 text-xs font-bold transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="6" width="20" height="12" rx="3"/><path d="M6 12h4"/><path d="M8 10v4"/><circle cx="15" cy="11" r="1"/><circle cx="17" cy="13" r="1"/></svg>
                            <span>${tr('Jugar amb aquest Quadern', 'Jugar con este Cuaderno')}</span>
                        </button>
                        <button type="button" onclick="exportNotebookToWord()" class="px-3 py-1.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-bold transition cursor-pointer flex items-center gap-1.5 whitespace-nowrap">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            <span>Exportar (.doc)</span>
                        </button>
                        <button type="button" onclick="closeGeminiNotebookModal()" class="p-2 rounded-xl bg-zinc-200/70 hover:bg-zinc-300/80 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 transition cursor-pointer" aria-label="Tancar">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>
                </div>

                <!-- Cos de 3 columnes estil NotebookLM -->
                <div class="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-zinc-200 dark:divide-zinc-800 overflow-y-auto lg:overflow-hidden">
                    <!-- COLUMNA 1 (3 cols): FONTS DEL QUADERN (SOURCES) -->
                    <div class="lg:col-span-3 flex flex-col min-h-0 bg-zinc-50/50 dark:bg-zinc-950/60 p-4 space-y-3 overflow-y-auto custom-scrollbar">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-extrabold text-zinc-900 dark:text-zinc-100">${tr('Fonts del Quadern', 'Fuentes del Cuaderno')}</span>
                            <span id="nb-sources-count-label" class="text-[11px] font-mono text-zinc-500">1 activa</span>
                        </div>
                        <div class="grid grid-cols-2 gap-1.5">
                            <button type="button" onclick="promptAddNotebookTextSource()" class="py-2 px-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold transition cursor-pointer flex items-center justify-center gap-1">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                                <span>${tr('Afegir Text/Apunt', 'Añadir Texto/Apunte')}</span>
                            </button>
                            <button type="button" onclick="importCurrentChatIntoNotebook()" class="py-2 px-2.5 rounded-xl bg-white hover:bg-zinc-100 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-800 text-[11px] font-bold transition cursor-pointer flex items-center justify-center gap-1">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                                <span>${tr('Importar Xat', 'Importar Chat')}</span>
                            </button>
                        </div>
                        <div id="nb-sources-list" class="space-y-2 flex-1 overflow-y-auto pr-0.5 custom-scrollbar"></div>
                    </div>

                    <!-- COLUMNA 2 (5 cols): GUIA DEL QUADERN, ARTEFACTES EN 1 CLIC I XAT AMB CITACIONS -->
                    <div class="lg:col-span-5 flex flex-col min-h-0 bg-white dark:bg-zinc-950 p-4 space-y-3 overflow-y-auto custom-scrollbar">
                        <div>
                            <div class="text-xs font-extrabold text-zinc-900 dark:text-zinc-100 mb-2">${tr('Generador d\'Estudi del Quadern (1 Clic amb Citacions)', 'Generador de Estudio del Cuaderno (1 Clic con Citas)')}</div>
                            <div class="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                                <button type="button" onclick="generateNotebookArtifact('study_guide')" class="p-2.5 rounded-xl bg-zinc-50 hover:bg-indigo-50/70 dark:bg-zinc-900 dark:hover:bg-indigo-950/40 border border-zinc-200 dark:border-zinc-800 hover:border-indigo-400 text-left transition cursor-pointer">
                                    <div class="text-[11px] font-bold text-zinc-900 dark:text-zinc-100">${tr('Guia d\'Estudi', 'Guía de Estudio')}</div>
                                    <div class="text-[10px] text-zinc-500 truncate">${tr('Temari + Preguntes', 'Temario + Preguntas')}</div>
                                </button>
                                <button type="button" onclick="generateNotebookArtifact('briefing_doc')" class="p-2.5 rounded-xl bg-zinc-50 hover:bg-indigo-50/70 dark:bg-zinc-900 dark:hover:bg-indigo-950/40 border border-zinc-200 dark:border-zinc-800 hover:border-indigo-400 text-left transition cursor-pointer">
                                    <div class="text-[11px] font-bold text-zinc-900 dark:text-zinc-100">Briefing Doc</div>
                                    <div class="text-[10px] text-zinc-500 truncate">${tr('Síntesi executiva', 'Síntesis ejecutiva')}</div>
                                </button>
                                <button type="button" onclick="generateNotebookArtifact('faq')" class="p-2.5 rounded-xl bg-zinc-50 hover:bg-indigo-50/70 dark:bg-zinc-900 dark:hover:bg-indigo-950/40 border border-zinc-200 dark:border-zinc-800 hover:border-indigo-400 text-left transition cursor-pointer">
                                    <div class="text-[11px] font-bold text-zinc-900 dark:text-zinc-100">FAQ d'Examen</div>
                                    <div class="text-[10px] text-zinc-500 truncate">${tr('Preguntes clau', 'Preguntas clave')}</div>
                                </button>
                                <button type="button" onclick="generateNotebookArtifact('timeline')" class="p-2.5 rounded-xl bg-zinc-50 hover:bg-indigo-50/70 dark:bg-zinc-900 dark:hover:bg-indigo-950/40 border border-zinc-200 dark:border-zinc-800 hover:border-indigo-400 text-left transition cursor-pointer">
                                    <div class="text-[11px] font-bold text-zinc-900 dark:text-zinc-100">${tr('Línia Temporal', 'Línea Temporal')}</div>
                                    <div class="text-[10px] text-zinc-500 truncate">${tr('Seqüència i fases', 'Secuencia y fases')}</div>
                                </button>
                                <button type="button" onclick="generateNotebookArtifact('glossary')" class="p-2.5 rounded-xl bg-zinc-50 hover:bg-indigo-50/70 dark:bg-zinc-900 dark:hover:bg-indigo-950/40 border border-zinc-200 dark:border-zinc-800 hover:border-indigo-400 text-left transition cursor-pointer">
                                    <div class="text-[11px] font-bold text-zinc-900 dark:text-zinc-100">${tr('Glossari Clau', 'Glosario Clave')}</div>
                                    <div class="text-[10px] text-zinc-500 truncate">${tr('Definicions exactes', 'Definiciones exactas')}</div>
                                </button>
                                <button type="button" onclick="generateNotebookArtifact('exam_traps')" class="p-2.5 rounded-xl bg-zinc-50 hover:bg-indigo-50/70 dark:bg-zinc-900 dark:hover:bg-indigo-950/40 border border-zinc-200 dark:border-zinc-800 hover:border-indigo-400 text-left transition cursor-pointer">
                                    <div class="text-[11px] font-bold text-zinc-900 dark:text-zinc-100">${tr('Trampes Examen', 'Trampas Examen')}</div>
                                    <div class="text-[10px] text-zinc-500 truncate">${tr('Errors habituals', 'Errores habituales')}</div>
                                </button>
                            </div>
                        </div>

                        <!-- Xat fonamentat en les fonts -->
                        <div class="flex-1 min-h-[220px] flex flex-col border border-zinc-200 dark:border-zinc-800 rounded-2xl overflow-hidden bg-zinc-50/40 dark:bg-zinc-900/40">
                            <div class="px-3.5 py-2 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-[11px] font-bold text-zinc-600 dark:text-zinc-300">
                                <span>${tr('Xat d\'Investigació amb Citacions [Font X]', 'Chat de Investigación con Citas [Font X]')}</span>
                                <button type="button" onclick="clearNotebookChat()" class="text-[10px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer">${tr('Netejar', 'Limpiar')}</button>
                            </div>
                            <div id="nb-grounded-chat-box" class="flex-1 p-3.5 space-y-3 overflow-y-auto custom-scrollbar text-xs"></div>
                            <form onsubmit="submitNotebookGroundedQuestion(event)" class="p-2 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center gap-2">
                                <input id="nb-grounded-chat-input" type="text" class="flex-1 bg-transparent px-2.5 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 outline-none" placeholder="Pregunta sobre les fonts actives (ex: resumeix les idees clau amb citacions)...">
                                <button type="submit" class="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer shrink-0">${tr('Preguntar', 'Preguntar')}</button>
                            </form>
                        </div>
                    </div>

                    <!-- COLUMNA 3 (4 cols): AUDIO OVERVIEW PODCAST A 2 VEUS + TAULER DE NOTES -->
                    <div class="lg:col-span-4 flex flex-col min-h-0 bg-zinc-50/50 dark:bg-zinc-950/60 p-4 space-y-4 overflow-y-auto custom-scrollbar">
                        <!-- Audio Overview (Deep Dive Podcast) -->
                        <div class="p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-3 shadow-2xs">
                            <div class="flex items-center justify-between gap-2">
                                <div>
                                    <div class="text-xs font-extrabold text-zinc-900 dark:text-zinc-100">Audio Overview · Deep Dive Podcast</div>
                                    <div class="text-[10px] text-zinc-500 dark:text-zinc-400">${tr('Conversa a 2 veus (Marc i Laia) sobre els teus apunts', 'Conversación a 2 voces (Marc y Laia) sobre tus apuntes')}</div>
                                </div>
                                <button type="button" onclick="generateNotebookAudioOverview()" class="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold transition cursor-pointer shrink-0">
                                    ${tr('Generar Pòdcast IA', 'Generar Pódcast IA')}
                                </button>
                            </div>
                            <div id="nb-audio-overview-box" class="space-y-2.5"></div>
                        </div>

                        <!-- Notes Desades del Quadern -->
                        <div class="flex-1 flex flex-col min-h-[180px] space-y-2">
                            <div class="flex items-center justify-between">
                                <span class="text-xs font-extrabold text-zinc-900 dark:text-zinc-100">${tr('Notes i Documents del Quadern', 'Notas y Documentos del Cuaderno')}</span>
                                <button type="button" onclick="addCustomNoteToNotebook()" class="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer">+ ${tr('Nova Nota', 'Nueva Nota')}</button>
                            </div>
                            <div id="nb-saved-notes-list" class="space-y-2.5 flex-1 overflow-y-auto pr-0.5 custom-scrollbar"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        return modal;
    }

    window.openGeminiNotebookModal = function () {
        if (typeof Swal !== 'undefined') Swal.close();
        loadNotebookState();
        const modal = ensureGeminiNotebookModalDOM();
        modal.classList.remove('hidden');
        modal.classList.add('flex');

        const titleInput = document.getElementById('nb-title-input');
        if (titleInput) titleInput.value = notebookState.title || resolveCurrentStudyTopic();

        renderNotebookSourcesList();
        renderNotebookGroundedChat();
        renderNotebookAudioOverview();
        renderNotebookSavedNotes();
    };

    window.closeGeminiNotebookModal = function () {
        stopNotebookPodcastSpeech();
        const modal = document.getElementById('gemini-notebook-modal');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    };

    window.updateNotebookTitle = function (val) {
        if (val && val.trim()) {
            notebookState.title = val.trim();
            saveNotebookState();
        }
    };

    function getCheckedNotebookSources() {
        const checked = (notebookState.sources || []).filter(s => s.checked !== false);
        return checked.length > 0 ? checked : (notebookState.sources || []);
    }

    function renderNotebookSourcesList() {
        const listEl = document.getElementById('nb-sources-list');
        const countEl = document.getElementById('nb-sources-count-label');
        if (!listEl) return;

        const sources = notebookState.sources || [];
        const activeCount = sources.filter(s => s.checked !== false).length;
        if (countEl) countEl.textContent = `${activeCount}/${sources.length} ${tr('actives', 'activas')}`;

        listEl.innerHTML = sources.map((src, idx) => `
            <div class="p-3 rounded-2xl bg-white dark:bg-zinc-900 border ${src.checked !== false ? 'border-indigo-400/80 dark:border-indigo-600/80' : 'border-zinc-200 dark:border-zinc-800 opacity-65'} space-y-1.5 transition">
                <div class="flex items-start justify-between gap-2">
                    <label class="flex items-start gap-2 cursor-pointer min-w-0 flex-1">
                        <input type="checkbox" ${src.checked !== false ? 'checked' : ''} onchange="toggleNotebookSourceChecked(${idx})" class="mt-0.5 rounded accent-indigo-600 cursor-pointer">
                        <div class="min-w-0">
                            <div class="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">[Font ${idx + 1}] ${esc(src.title)}</div>
                            <div class="text-[10px] text-zinc-500">${esc(src.type || 'Document')} · ${String(src.content || '').length} caràct.</div>
                        </div>
                    </label>
                    ${sources.length > 1 ? `
                        <button type="button" onclick="removeNotebookSource(${idx})" class="text-zinc-400 hover:text-rose-500 p-1 cursor-pointer" title="Eliminar font">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    ` : ''}
                </div>
                <p class="text-[11px] text-zinc-600 dark:text-zinc-400 line-clamp-2 leading-snug">${esc(String(src.content || '').substring(0, 160))}</p>
            </div>
        `).join('');
    }

    window.toggleNotebookSourceChecked = function (idx) {
        if (!notebookState.sources[idx]) return;
        notebookState.sources[idx].checked = notebookState.sources[idx].checked === false;
        saveNotebookState();
        renderNotebookSourcesList();
    };

    window.removeNotebookSource = function (idx) {
        notebookState.sources.splice(idx, 1);
        saveNotebookState();
        renderNotebookSourcesList();
    };

    window.promptAddNotebookTextSource = function () {
        const title = window.prompt(tr('Títol de la nova font (ex: Tema 2 - Termodinàmica):', 'Título de la nueva fuente (ej: Tema 2 - Termodinámica):'), tr('Apunts de Classe', 'Apuntes de Clase'));
        if (!title) return;
        const content = window.prompt(tr('Enganxa el contingut o resum de la font:', 'Pega el contenido o resumen de la fuente:'), '');
        if (!content || !content.trim()) return;
        notebookState.sources.push({
            id: 'src_' + Date.now(),
            title: title.trim(),
            type: tr('Text / Apunt', 'Texto / Apunte'),
            checked: true,
            content: content.trim()
        });
        saveNotebookState();
        renderNotebookSourcesList();
        if (typeof showToast === 'function') showToast(tr('Font afegida al Gemini Notebook', 'Fuente añadida al Gemini Notebook'), 'success');
    };

    window.importCurrentChatIntoNotebook = function () {
        const ctx = resolveCurrentStudyContext();
        const topic = resolveCurrentStudyTopic();
        notebookState.sources.push({
            id: 'src_chat_' + Date.now(),
            title: tr(`Sessió actual: ${topic}`, `Sesión actual: ${topic}`),
            type: 'Sessió Xat',
            checked: true,
            content: ctx && ctx.length > 20 ? ctx : tr(`Contingut d'estudi sobre ${topic}`, `Contenido de estudio sobre ${topic}`)
        });
        notebookState.title = topic;
        const titleInput = document.getElementById('nb-title-input');
        if (titleInput) titleInput.value = topic;
        saveNotebookState();
        renderNotebookSourcesList();
        if (typeof showToast === 'function') showToast(tr('Sessió actual importada com a font del Quadern', 'Sesión actual importada como fuente del Cuaderno'), 'success');
    };

    function renderNotebookGroundedChat() {
        const box = document.getElementById('nb-grounded-chat-box');
        if (!box) return;

        if (!Array.isArray(notebookState.chatMessages) || notebookState.chatMessages.length === 0) {
            const topic = notebookState.title || resolveCurrentStudyTopic();
            const suggestions = [
                tr(`Quins són els 5 conceptes més importants de [Font 1] per a l'examen?`, `¿Cuáles son los 5 conceptos más importantes de [Font 1] para el examen?`),
                tr(`Fes una taula comparativa dels punts clau de ${topic}`, `Haz una tabla comparativa de los puntos clave de ${topic}`),
                tr(`Quines preguntes trampa poden sortir sobre aquestes fonts?`, `¿Qué preguntas trampa pueden salir sobre estas fuentes?`)
            ];
            box.innerHTML = `
                <div class="p-3 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 space-y-2.5">
                    <div class="font-bold text-zinc-900 dark:text-zinc-100">${tr('Pregunta qualsevol dubte sobre les teves fonts actives', 'Pregunta cualquier duda sobre tus fuentes activas')}</div>
                    <p class="text-[11px] text-zinc-500 dark:text-zinc-400">${tr('Cada resposta inclou citacions directes [Font 1] i es pot desar com a nota del quadern.', 'Cada respuesta incluye citas directas [Font 1] y puede guardarse como nota del cuaderno.')}</p>
                    <div class="flex flex-wrap gap-1.5 pt-1">
                        ${suggestions.map(q => `
                            <button type="button" onclick="askNotebookSuggestedQuestion('${esc(q).replace(/'/g, "\\'")}')" class="px-2.5 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/70 text-indigo-700 dark:text-indigo-300 text-[11px] font-semibold text-left transition cursor-pointer">
                                → ${esc(q)}
                            </button>
                        `).join('')}
                    </div>
                </div>
            `;
            return;
        }

        box.innerHTML = notebookState.chatMessages.map((m, idx) => {
            if (m.role === 'user') {
                return `<div class="flex justify-end"><div class="px-3.5 py-2 rounded-2xl bg-indigo-600 text-white font-semibold max-w-[85%]">${esc(m.content)}</div></div>`;
            }
            const formatted = sanitizeHtmlFragment((typeof marked !== 'undefined' && marked.parse) ? marked.parse(m.content || '') : esc(m.content || ''));
            return `
                <div class="p-3.5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-2">
                    <div class="prose prose-xs dark:prose-invert max-w-none text-zinc-800 dark:text-zinc-200 leading-relaxed">${formatted}</div>
                    <div class="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                        <span class="text-[10px] font-mono text-indigo-600 dark:text-indigo-400">${(m.citations || ['Font 1']).map(c => `[${esc(c)}]`).join(' ')}</span>
                        <button type="button" onclick="saveChatAnswerToNotebookNotes(${idx})" class="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer">+ ${tr('Desar a Notes', 'Guardar en Notas')}</button>
                    </div>
                    ${Array.isArray(m.followUps) && m.followUps.length > 0 ? `
                        <div class="flex flex-wrap gap-1 pt-1">
                            ${m.followUps.slice(0, 2).map(fq => `
                                <button type="button" onclick="askNotebookSuggestedQuestion('${esc(fq).replace(/'/g, "\\'")}')" class="px-2 py-1 rounded-lg bg-zinc-100 hover:bg-indigo-50 dark:bg-zinc-800 dark:hover:bg-indigo-950/60 text-zinc-700 dark:text-zinc-300 text-[10px] font-medium cursor-pointer text-left">
                                    ↳ ${esc(fq)}
                                </button>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
        box.scrollTop = box.scrollHeight;
    }

    window.askNotebookSuggestedQuestion = function (qText) {
        const input = document.getElementById('nb-grounded-chat-input');
        if (input) {
            input.value = qText;
            window.submitNotebookGroundedQuestion(new Event('submit'));
        }
    };

    window.clearNotebookChat = function () {
        notebookState.chatMessages = [];
        saveNotebookState();
        renderNotebookGroundedChat();
    };

    window.submitNotebookGroundedQuestion = async function (e) {
        if (e && e.preventDefault) e.preventDefault();
        const input = document.getElementById('nb-grounded-chat-input');
        if (!input || !input.value.trim()) return;
        const q = input.value.trim();
        input.value = '';

        notebookState.chatMessages.push({ role: 'user', content: q });
        renderNotebookGroundedChat();

        const box = document.getElementById('nb-grounded-chat-box');
        if (box) {
            const loadingDiv = document.createElement('div');
            loadingDiv.id = 'nb-chat-loading';
            loadingDiv.className = 'p-3 text-xs text-zinc-500 animate-pulse';
            loadingDiv.textContent = tr('Analitzant les fonts actives i verificant citacions...', 'Analizando las fuentes activas y verificando citas...');
            box.appendChild(loadingDiv);
            box.scrollTop = box.scrollHeight;
        }

        try {
            const caller = typeof window.callGenerateApi === 'function'
                ? window.callGenerateApi
                : (payload => fetch('/api/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }));
            const res = await caller({
                action: 'notebook_studio',
                subAction: 'chat',
                notebookTitle: notebookState.title,
                sources: getCheckedNotebookSources(),
                question: q
            });
            const data = await res.json();
            document.getElementById('nb-chat-loading')?.remove();
            notebookState.chatMessages.push({
                role: 'assistant',
                content: data.answer || tr('Resposta verificada a partir de [Font 1].', 'Respuesta verificada a partir de [Font 1].'),
                citations: data.citations || ['Font 1'],
                followUps: data.followUps || []
            });
            saveNotebookState();
            renderNotebookGroundedChat();
        } catch (err) {
            document.getElementById('nb-chat-loading')?.remove();
            notebookState.chatMessages.push({
                role: 'assistant',
                content: tr(`Segons [Font 1] sobre **${notebookState.title}**, els punts fonamentals responen directament a "${q}" relacionant la definició teòrica amb els casos pràctics del temari.`, `Según [Font 1] sobre **${notebookState.title}**, los puntos fundamentales responden directamente a "${q}" relacionando la definición teórica con los casos prácticos del temario.`),
                citations: ['Font 1'],
                followUps: []
            });
            saveNotebookState();
            renderNotebookGroundedChat();
        }
    };

    window.saveChatAnswerToNotebookNotes = function (msgIdx) {
        const m = notebookState.chatMessages[msgIdx];
        if (!m) return;
        notebookState.notes.unshift({
            id: 'note_' + Date.now(),
            title: tr('Resposta amb Citació', 'Respuesta con Cita') + ' · ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: m.content
        });
        saveNotebookState();
        renderNotebookSavedNotes();
        if (typeof showToast === 'function') showToast(tr('Resposta fixada al tauler de Notes del Quadern', 'Respuesta fijada en el tablero de Notas del Cuaderno'), 'success');
    };

    window.generateNotebookArtifact = async function (artifactType) {
        if (typeof showToast === 'function') {
            showToast(tr('Generant document d\'estudi des de les fonts actives...', 'Generando documento de estudio desde las fuentes activas...'), 'info');
        }
        try {
            const caller = typeof window.callGenerateApi === 'function'
                ? window.callGenerateApi
                : (payload => fetch('/api/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }));
            const res = await caller({
                action: 'notebook_studio',
                subAction: 'artifact',
                artifactType,
                notebookTitle: notebookState.title,
                sources: getCheckedNotebookSources()
            });
            const data = await res.json();
            if (data && data.content) {
                notebookState.notes.unshift({
                    id: 'art_' + Date.now(),
                    title: data.title || 'Document del Quadern',
                    content: data.content
                });
                saveNotebookState();
                renderNotebookSavedNotes();
                if (typeof showToast === 'function') {
                    showToast(tr('Document afegit a les Notes del Quadern!', '¡Documento añadido a las Notas del Cuaderno!'), 'success');
                }
            }
        } catch (err) {
            console.warn('[generateNotebookArtifact]', err);
        }
    };

    // --- AUDIO OVERVIEW (DEEP DIVE PODCAST A 2 VEUS: MARC I LAIA) ---
    function renderNotebookAudioOverview() {
        const box = document.getElementById('nb-audio-overview-box');
        if (!box) return;

        const ov = notebookState.audioOverview;
        if (!ov || !Array.isArray(ov.dialogue) || ov.dialogue.length === 0) {
            box.innerHTML = `
                <div class="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-800 text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    ${tr('Prem "Generar Pòdcast IA" perquè en Marc i la Laia sintetitzin totes les teves fonts actives en una conversa d\'àudio interactiva (amb opció d\'interrompre i preguntar en viu).', 'Pulsa "Generar Pódcast IA" para que Marc y Laia sinteticen todas tus fuentes activas en una conversación de audio interactiva (con opción de interrumpir y preguntar en vivo).')}
                </div>
            `;
            return;
        }

        const turnIdx = Math.min(notebookState.audioCurrentTurn || 0, ov.dialogue.length - 1);
        const currentTurn = ov.dialogue[turnIdx] || ov.dialogue[0];

        box.innerHTML = `
            <div class="p-3 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/80 space-y-2.5">
                <div class="flex items-center justify-between gap-2">
                    <span class="text-xs font-bold text-indigo-950 dark:text-indigo-200 truncate">${esc(ov.title || 'Deep Dive Audio')}</span>
                    <span class="text-[10px] font-mono text-indigo-600 dark:text-indigo-400"> Torn ${turnIdx + 1}/${ov.dialogue.length}</span>
                </div>

                <!-- Transcripció activa del locutor -->
                <div class="p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-indigo-200/60 dark:border-zinc-800 text-xs space-y-1">
                    <div class="flex items-center justify-between">
                        <span class="font-extrabold ${currentTurn.speaker === 'Laia' ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-600 dark:text-sky-400'}">${esc(currentTurn.speaker)}</span>
                        <span class="text-[10px] text-zinc-400">${currentTurn.speaker === 'Laia' ? tr('Especialista Pedagògica', 'Especialista Pedagógica') : tr('Presentador Analític', 'Presentador Analítico')}</span>
                    </div>
                    <p class="text-zinc-800 dark:text-zinc-200 leading-relaxed">${esc(currentTurn.text)}</p>
                </div>

                <!-- Controls de reproducció a 2 veus -->
                <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div class="flex items-center gap-1.5">
                        <button type="button" onclick="togglePlayNotebookPodcast()" class="px-3 py-1.5 rounded-xl ${notebookState.audioPlaying ? 'bg-rose-600 hover:bg-rose-500' : 'bg-indigo-600 hover:bg-indigo-500'} text-white text-[11px] font-bold cursor-pointer transition flex items-center gap-1">
                            <span>${notebookState.audioPlaying ? tr('Pausar Veu', 'Pausar Voz') : tr('Escoltar (2 Veus)', 'Escuchar (2 Voces)')}</span>
                        </button>
                        <button type="button" onclick="stepNotebookPodcastTurn(-1)" class="p-1.5 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs cursor-pointer" title="Anterior">←</button>
                        <button type="button" onclick="stepNotebookPodcastTurn(1)" class="p-1.5 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs cursor-pointer" title="Següent">→</button>
                    </div>
                    <button type="button" onclick="interruptNotebookPodcastToAsk()" class="px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[10.5px] font-bold cursor-pointer transition" title="Interrompre i preguntar als locutors">
                        ${tr('Interrompre i Preguntar', 'Interrumpir y Preguntar')}
                    </button>
                </div>
            </div>
        `;
    }

    window.generateNotebookAudioOverview = async function () {
        stopNotebookPodcastSpeech();
        const box = document.getElementById('nb-audio-overview-box');
        if (box) {
            box.innerHTML = `<div class="p-4 text-center text-xs text-indigo-600 dark:text-indigo-400 font-semibold animate-pulse">${tr('Sintetitzant el guió de pòdcast entre en Marc i la Laia a partir de les fonts...', 'Sintetizando el guion de pódcast entre Marc y Laia a partir de las fuentes...')}</div>`;
        }
        try {
            const caller = typeof window.callGenerateApi === 'function'
                ? window.callGenerateApi
                : (payload => fetch('/api/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }));
            const res = await caller({
                action: 'notebook_studio',
                subAction: 'audio_overview',
                notebookTitle: notebookState.title,
                sources: getCheckedNotebookSources()
            });
            const data = await res.json();
            if (data && data.overview) {
                notebookState.audioOverview = data.overview;
                notebookState.audioCurrentTurn = 0;
                saveNotebookState();
                renderNotebookAudioOverview();
                return;
            }
        } catch (err) {
            console.warn('[generateNotebookAudioOverview]', err);
        }
    };

    function speakCurrentNotebookTurn() {
        if (!notebookState.audioPlaying) return;
        const ov = notebookState.audioOverview;
        if (!ov || !Array.isArray(ov.dialogue) || ov.dialogue.length === 0) {
            notebookState.audioPlaying = false;
            renderNotebookAudioOverview();
            return;
        }
        const idx = notebookState.audioCurrentTurn || 0;
        if (idx >= ov.dialogue.length) {
            notebookState.audioPlaying = false;
            notebookState.audioCurrentTurn = 0;
            renderNotebookAudioOverview();
            return;
        }

        renderNotebookAudioOverview();
        const turn = ov.dialogue[idx];
        if (!('speechSynthesis' in window)) return;

        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(turn.text);
        utter.lang = isEsLang() ? 'es-ES' : 'ca-ES';
        // Distinct vocal profiles for Marc vs Laia
        utter.pitch = turn.speaker === 'Laia' ? 1.16 : 0.92;
        utter.rate = notebookState.audioRate || 1.04;

        utter.onend = () => {
            if (!notebookState.audioPlaying) return;
            if (notebookState.audioCurrentTurn < ov.dialogue.length - 1) {
                notebookState.audioCurrentTurn++;
                speakCurrentNotebookTurn();
            } else {
                notebookState.audioPlaying = false;
                renderNotebookAudioOverview();
            }
        };
        window.speechSynthesis.speak(utter);
    }

    window.togglePlayNotebookPodcast = function () {
        if (notebookState.audioPlaying) {
            stopNotebookPodcastSpeech();
            renderNotebookAudioOverview();
        } else {
            notebookState.audioPlaying = true;
            speakCurrentNotebookTurn();
        }
    };

    window.stepNotebookPodcastTurn = function (delta) {
        const ov = notebookState.audioOverview;
        if (!ov || !Array.isArray(ov.dialogue)) return;
        const wasPlaying = notebookState.audioPlaying;
        stopNotebookPodcastSpeech();
        notebookState.audioCurrentTurn = Math.max(0, Math.min(ov.dialogue.length - 1, (notebookState.audioCurrentTurn || 0) + delta));
        if (wasPlaying) {
            notebookState.audioPlaying = true;
            speakCurrentNotebookTurn();
        } else {
            renderNotebookAudioOverview();
        }
    };

    window.interruptNotebookPodcastToAsk = function () {
        stopNotebookPodcastSpeech();
        renderNotebookAudioOverview();
        const userQ = window.prompt(tr('Fes una pregunta en directe a en Marc i la Laia sobre el que estan comentant:', 'Haz una pregunta en directo a Marc y Laia sobre lo que están comentando:'), '');
        if (!userQ || !userQ.trim()) return;

        if (!notebookState.audioOverview || !Array.isArray(notebookState.audioOverview.dialogue)) return;
        const insertPos = (notebookState.audioCurrentTurn || 0) + 1;
        notebookState.audioOverview.dialogue.splice(
            insertPos,
            0,
            { speaker: "Marc", text: tr(`Atenció, Laia! Ens acaben de fer una pregunta molt interessant en directe: "${userQ.trim()}". Com ho veus segons les fonts?`, `¡Atención, Laia! Nos acaban de hacer una pregunta muy interesante en directo: "${userQ.trim()}". ¿Cómo lo ves según las fuentes?`) },
            { speaker: "Laia", text: tr(`Molt bona pregunta! Segons la Font 1 del nostre quadern sobre ${notebookState.title}, la resposta clau rau a connectar aquest concepte amb l'aplicació pràctica de l'examen.`, `¡Muy buena pregunta! Según la Font 1 de nuestro cuaderno sobre ${notebookState.title}, la respuesta clave está en conectar ese concepto con la aplicación práctica del examen.`) }
        );
        notebookState.audioCurrentTurn = insertPos;
        saveNotebookState();
        notebookState.audioPlaying = true;
        speakCurrentNotebookTurn();
    };

    // --- NOTES DESADES DEL QUADERN ---
    function renderNotebookSavedNotes() {
        const listEl = document.getElementById('nb-saved-notes-list');
        if (!listEl) return;

        const notes = notebookState.notes || [];
        if (notes.length === 0) {
            listEl.innerHTML = `
                <div class="p-3 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-[11px] text-zinc-500 dark:text-zinc-400">
                    ${tr('Encara no has desat cap nota. Clica qualsevol dels 6 botons del Generador d\'Estudi (Guia, Briefing, FAQ, Glossari...) per crear documents al teu quadern.', 'Aún no has guardado ninguna nota. Haz clic en cualquiera de los 6 botones del Generador de Estudio (Guía, Briefing, FAQ, Glosario...) para crear documentos en tu cuaderno.')}
                </div>
            `;
            return;
        }

        listEl.innerHTML = notes.map((n, idx) => {
            const rendered = sanitizeHtmlFragment((typeof marked !== 'undefined' && marked.parse) ? marked.parse(n.content || '') : esc(n.content || ''));
            return `
                <div class="p-3.5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-2">
                    <div class="flex items-center justify-between gap-2">
                        <span class="text-xs font-extrabold text-zinc-900 dark:text-zinc-100 truncate">${esc(n.title)}</span>
                        <button type="button" onclick="deleteNotebookSavedNote(${idx})" class="text-zinc-400 hover:text-rose-500 text-xs cursor-pointer" title="Eliminar">✕</button>
                    </div>
                    <div class="prose prose-xs dark:prose-invert max-w-none text-zinc-700 dark:text-zinc-300 max-h-44 overflow-y-auto custom-scrollbar text-[11.5px] leading-relaxed">${rendered}</div>
                </div>
            `;
        }).join('');
    }

    window.addCustomNoteToNotebook = function () {
        const title = window.prompt(tr('Títol de la nota:', 'Título de la nota:'), tr('Apunt clau d\'examen', 'Apunte clave de examen'));
        if (!title) return;
        const content = window.prompt(tr('Contingut de la nota:', 'Contenido de la nota:'), '');
        if (!content) return;
        notebookState.notes.unshift({ id: 'note_' + Date.now(), title: title.trim(), content: content.trim() });
        saveNotebookState();
        renderNotebookSavedNotes();
    };

    window.deleteNotebookSavedNote = function (idx) {
        notebookState.notes.splice(idx, 1);
        saveNotebookState();
        renderNotebookSavedNotes();
    };

    window.exportNotebookToWord = function () {
        const parts = [`# ${notebookState.title}\n`];
        if (notebookState.audioOverview && notebookState.audioOverview.summary) {
            parts.push(`## Audio Overview\n${notebookState.audioOverview.summary}\n`);
        }
        (notebookState.notes || []).forEach(n => {
            parts.push(`## ${n.title}\n${n.content}\n`);
        });
        (notebookState.sources || []).forEach((s, i) => {
            parts.push(`## [Font ${i + 1}] ${s.title}\n${s.content}\n`);
        });
        const fullText = parts.join('\n\n');
        if (typeof window.exportAsWordDocument === 'function') {
            window.exportAsWordDocument(fullText, `Gemini_Notebook_${(notebookState.title || 'Estudi').replace(/\s+/g, '_')}.doc`);
        } else if (typeof showToast === 'function') {
            navigator.clipboard?.writeText(fullText);
            showToast(tr('Contingut del Quadern copiat al porta-retalls!', '¡Contenido del Cuaderno copiado al portapapeles!'), 'success');
        }
    };

    // ============================================================================
    // MILLORA DE LA TARGETA ACTIVA DEL PLA D'ESTUDI I MODAL DE CALENDARI
    // ============================================================================
    window.refreshActiveStudyPlanBanner = function () {
        const welcomeCard = document.getElementById('welcome-card');
        if (!welcomeCard) return;

        // Evitem duplicar la barra d'aprenentatge actiu si ja hi és, o l'actualitzem
        let hubBar = document.getElementById('active-study-plan-interactive-bar');
        const state = getMasteryState();
        const cal = (typeof generatedCalendarArray !== 'undefined' && Array.isArray(generatedCalendarArray)) ? generatedCalendarArray : [];
        const completedCount = cal.filter(s => window.isStudySessionCompleted(s.num)).length;
        const pct = cal.length > 0 ? Math.round((completedCount / cal.length) * 100) : 0;

        const barHtml = `
            <div class="mt-3 pt-3 border-t border-zinc-200/80 dark:border-zinc-800 space-y-2.5">
                <div class="flex items-center justify-between text-[11px]">
                    <span class="font-bold text-zinc-700 dark:text-zinc-300">${tr('Domini del Pla:', 'Dominio del Plan:')} ${completedCount}/${cal.length || 1} sessions (${pct}%)</span>
                    <span class="font-mono font-bold text-blue-600 dark:text-sky-400">${state.xp} XP · Ratxa ${state.streak}</span>
                </div>
                <div class="w-full h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                    <div class="h-full bg-emerald-500 transition-all duration-300" style="width: ${Math.max(8, pct)}%"></div>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    <button type="button" onclick="openStudyGamesHubModal()" class="py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="6" width="20" height="12" rx="3"/><path d="M6 12h4"/><path d="M8 10v4"/><circle cx="15" cy="11" r="1"/><circle cx="17" cy="13" r="1"/></svg>
                        <span>${tr('Laboratori de 6 Jocs d\'Estudi', 'Laboratorio de 6 Juegos de Estudio')}</span>
                    </button>
                    <button type="button" onclick="openGeminiNotebookModal()" class="py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                        <span>${tr('Obrir Gemini Notebook Studio', 'Abrir Gemini Notebook Studio')}</span>
                    </button>
                </div>
            </div>
        `;

        const innerBox = welcomeCard.querySelector('div');
        if (!innerBox) return;
        if (!hubBar) {
            hubBar = document.createElement('div');
            hubBar.id = 'active-study-plan-interactive-bar';
            innerBox.appendChild(hubBar);
        }
        hubBar.innerHTML = barHtml;
    };

    window.studySpecificPlanSession = function (sessionNum, sessionTopic) {
        if (typeof Swal !== 'undefined') Swal.close();
        document.getElementById('welcome-view')?.classList.add('hidden');
        document.getElementById('setup-view')?.classList.add('hidden');
        document.getElementById('setup-view')?.classList.remove('flex');
        document.getElementById('quiz-view')?.classList.add('hidden');
        document.getElementById('quiz-view')?.classList.remove('flex');
        const chatView = document.getElementById('chat-view');
        if (chatView) {
            chatView.classList.remove('hidden');
            chatView.classList.add('flex');
        }
        document.getElementById('chat-form')?.classList.remove('hidden');
        document.getElementById('chat-toolbar-bottom')?.classList.remove('hidden');
        document.getElementById('global-menu-btn')?.classList.add('hidden');
        if (typeof window.updateHeaderButtonsVisibility === 'function') {
            window.updateHeaderButtonsVisibility();
        }
        const safeNum = Number(sessionNum) || 1;
        const safeTopic = String(sessionTopic || tr('Conceptes clau del temari', 'Conceptos clave del temario')).trim();
        const promptText = tr(
            `Estudiem a fons la Sessió ${safeNum}: "${safeTopic}". Explica'm els conceptes clau de manera estructurada per a examen, posa un exemple resolt pas a pas i acaba amb [BOTON_FLASHCARDS].`,
            `Estudiemos a fondo la Sesión ${safeNum}: "${safeTopic}". Explícame los conceptos clave de forma estructurada para examen, pon un ejemplo resuelto paso a paso y termina con [BOTON_FLASHCARDS].`
        );
        if (typeof appendMessage === 'function' && typeof triggerAiResponse === 'function') {
            appendMessage('user', tr(`Iniciar Sessió ${safeNum}: ${safeTopic}`, `Iniciar Sesión ${safeNum}: ${safeTopic}`));
            if (typeof chatHistory !== 'undefined' && Array.isArray(chatHistory)) {
                chatHistory.push({ role: 'user', content: promptText });
            }
            triggerAiResponse();
        }
    };

    // Observador per enriquir automàticament #welcome-card quan s'inicia una classe del Pla d'Estudi
    const observer = new MutationObserver(() => {
        if (document.getElementById('welcome-card') && !document.getElementById('active-study-plan-interactive-bar')) {
            window.refreshActiveStudyPlanBanner();
        }
    });
    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }
})();
