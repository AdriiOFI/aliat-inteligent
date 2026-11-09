
        // --- ESTAT GLOBAL ---
        let uploadedPDFs = []; 
        let extractedText = "";
        let finalStudyText = ""; 
        let chatHistory = [];
        let currentQuizData = [];
        let generatedCalendarArray = []; 
        let validStudyDates = []; 
        let isPdfProcessing = false;
        let studentContextStr = ""; 
        let appMode = 'none'; 
        window.interactiveGames = {}; 

        window.flashcardDecks = {};
        
        window.flipFC = function(id) {
            let deck = window.flashcardDecks[id];
            let cardEl = document.getElementById(id + '_card');
            let contentEl = document.getElementById(id + '_content');
            deck.flipped = !deck.flipped;
            
            if(deck.flipped) {
                cardEl.classList.replace('bg-white', 'bg-emerald-50');
                cardEl.classList.replace('dark:bg-zinc-900', 'dark:bg-emerald-950/40');
                cardEl.classList.replace('border-zinc-200', 'border-emerald-300');
                cardEl.classList.replace('dark:border-zinc-800', 'dark:border-emerald-800/50');
                contentEl.innerHTML = `<span class="text-[10px] uppercase text-emerald-600 block mb-2 tracking-widest">Resposta</span><div class="text-base font-medium text-emerald-900 dark:text-emerald-100 prose prose-sm max-w-none dark:prose-invert text-center leading-snug">${marked.parseInline(deck.cards[deck.current].a)}</div>`;
            } else {
                cardEl.classList.replace('bg-emerald-50', 'bg-white');
                cardEl.classList.replace('dark:bg-emerald-950/40', 'dark:bg-zinc-900');
                cardEl.classList.replace('border-emerald-300', 'border-zinc-200');
                cardEl.classList.replace('dark:border-emerald-800/50', 'dark:border-zinc-800');
                contentEl.innerHTML = `<span class="text-[10px] uppercase text-zinc-400 block mb-2 tracking-widest">Pregunta</span><div class="text-lg font-bold text-zinc-800 dark:text-zinc-100 prose prose-sm max-w-none dark:prose-invert text-center leading-tight">${marked.parseInline(deck.cards[deck.current].q)}</div>`;
            }
        };

        window.nextFC = function(id) {
            let deck = window.flashcardDecks[id];
            deck.current = (deck.current + 1) % deck.cards.length;
            deck.flipped = true; window.flipFC(id); 
            document.getElementById(id + '_counter').innerText = (deck.current + 1) + '/' + deck.cards.length;
        };

        window.prevFC = function(id) {
            let deck = window.flashcardDecks[id];
            deck.current = (deck.current - 1 + deck.cards.length) % deck.cards.length;
            deck.flipped = true; window.flipFC(id);
            document.getElementById(id + '_counter').innerText = (deck.current + 1) + '/' + deck.cards.length;
        };
        
        let allSessions = [];
        let currentSessionId = '';
        let authToken = localStorage.getItem('aliat_token');
        let authUser = JSON.parse(localStorage.getItem('aliat_user') || 'null');

        // --- INICIALITZACIÓ ---
        async function syncUserSettings() {
            try {
                const res = await fetch('/api/user/settings', { headers: { 'Authorization': 'Bearer ' + authToken } });
                const data = await res.json();
                if (data.success) {
                    if (data.name) localStorage.setItem('aliat_user_name', data.name);
                    if (data.theme) {
                        localStorage.setItem('aliat_theme', data.theme);
                        if (data.theme === 'dark') document.documentElement.classList.add('dark');
                        else document.documentElement.classList.remove('dark');
                        updateThemeIcon();
                    }
                    if (data.ai_provider) localStorage.setItem('aliat_ai_provider', data.ai_provider);
                    if (data.ai_api_key) localStorage.setItem('aliat_ai_key', data.ai_api_key);
                    if (data.ai_model) localStorage.setItem('aliat_ai_model', data.ai_model);
                    updateProfileUI();
                }
            } catch(e) { console.error("Error carregant settings de la nube:", e); }
        }

        /* HELPER POPUPS I ANIMACIONS DE DESPLEGABLES */
        window.openDropdown = function(menuEl) {
            if (!menuEl) return;
            menuEl.classList.remove('hidden', 'dropdown-popover-exit');
            menuEl.classList.add('dropdown-popover-enter');
        };

        window.closeDropdown = function(menuEl) {
            if (!menuEl || menuEl.classList.contains('hidden')) return;
            menuEl.classList.remove('dropdown-popover-enter');
            menuEl.classList.add('dropdown-popover-exit');
            setTimeout(() => {
                if (menuEl.classList.contains('dropdown-popover-exit')) {
                    menuEl.classList.add('hidden');
                    menuEl.classList.remove('dropdown-popover-exit');
                }
            }, 180);
        };

        let welcomePhrases = [
            "El teu aliat està aquí! En què et puc ajudar?",
            "Quin tipus d'ajuda necessites avui?",
            "Organitza el teu pla d'estudis o resol dubtes a l'instant!",
            "Tria un minijoc, obre el xatbot o prepara la teva activitat diària.",
            "Preparat per assolir els teus objectius acadèmics?"
        ];

        function initWelcomeSubtextOnReload() {
            const subtextEl = document.getElementById('welcome-subtext');
            if (!subtextEl) return;
            // Canvia només quan es recarrega la pàgina (guarda l'índex a localStorage o en tria un seqüencialment per reload)
            let lastIdx = parseInt(localStorage.getItem('aliat_welcome_subtext_idx') || '0', 10);
            let nextIdx = (lastIdx + 1) % welcomePhrases.length;
            localStorage.setItem('aliat_welcome_subtext_idx', nextIdx.toString());
            subtextEl.innerText = welcomePhrases[lastIdx];
        }
        window.rotateWelcomeSubtext = function() {}; // Ja no rota contínuament ni en canvis de vista
        function initPomodoroGlobal() {
            if (typeof updateHeaderPomodoroDisplay === 'function') updateHeaderPomodoroDisplay();
        }

        async function checkAndHandleSharedChat() {
            const urlParams = new URLSearchParams(window.location.search);
            const shareId = urlParams.get('share');
            if (!shareId) return false;

            try {
                document.getElementById('auth-view')?.classList.add('hidden');
                document.getElementById('welcome-view')?.classList.add('hidden');
                document.getElementById('setup-view')?.classList.add('hidden');
                document.getElementById('quiz-view')?.classList.add('hidden');
                document.getElementById('app-container')?.classList.remove('hidden', 'opacity-0');
                document.getElementById('chat-view')?.classList.remove('hidden');
                document.getElementById('chat-view')?.classList.add('flex');

                const res = await fetch(`/api/sessions/share?id=${encodeURIComponent(shareId)}`);
                if (!res.ok) {
                    throw new Error('La conversa compartida no s\'ha trobat o ha caducat.');
                }
                const data = await res.json();
                if (!data || !Array.isArray(data.history)) {
                    throw new Error('Format de conversa no vàlid.');
                }

                const label = document.getElementById('chat-mode-label');
                if (label) label.innerText = data.title || 'Conversa Compartida';

                const messagesContainer = document.getElementById('chat-messages');
                if (messagesContainer) {
                    messagesContainer.innerHTML = '';
                    
                    const banner = document.createElement('div');
                    banner.id = 'shared-chat-banner';
                    banner.className = 'w-full mb-6 p-4 bg-indigo-50/90 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800/80 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs';
                    banner.innerHTML = `
                        <div class="flex items-center gap-3 text-xs sm:text-sm text-indigo-950 dark:text-indigo-100 font-medium">
                            <span class="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                            </span>
                            <div>
                                <p class="font-bold text-indigo-900 dark:text-indigo-200">Conversa Compartida (Mode Lectura)</p>
                                <p class="text-[11px] text-indigo-700 dark:text-indigo-300">Aquesta visualització mostra el xat tal com estava en el moment de compartir-lo.</p>
                            </div>
                        </div>
                        <a href="/" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-sm transition shrink-0 flex items-center gap-1.5 cursor-pointer">
                            <span>Obrir el meu Aliat</span>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                        </a>
                    `;
                    messagesContainer.appendChild(banner);

                    data.history.forEach(msg => {
                        let text = msg.content || '';
                        let sender = msg.role === 'user' ? 'user' : 'ai';
                        if (msg.image) {
                            text = `<img src="${msg.image}" onclick="openLightbox(this.src)" class="max-w-[220px] rounded-xl mb-2 cursor-zoom-in hover:opacity-90 transition shadow-md border border-zinc-700/50"><br>` + text;
                        }
                        appendMessage(sender, text);
                    });
                }

                document.getElementById('chat-toolbar-bottom')?.classList.add('hidden');
                const chatForm = document.getElementById('chat-form');
                if (chatForm) {
                    chatForm.innerHTML = `
                        <div class="w-full max-w-3xl mx-auto p-4 text-center bg-zinc-100 dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-800 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
                            <span class="text-xs sm:text-sm text-zinc-600 dark:text-zinc-300 font-medium">Vols estudiar o investigar amb la teva pròpia IA?</span>
                            <a href="/" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition shadow cursor-pointer">Començar de franc</a>
                        </div>
                    `;
                }

                return true;
            } catch (err) {
                Swal.fire({
                    icon: 'error',
                    title: 'Conversa no disponible',
                    text: err.message || 'No s\'ha pogut trobar la conversa compartida.',
                    confirmButtonText: 'Tornar a l\'Aliat',
                    confirmButtonColor: '#4f46e5'
                }).then(() => {
                    window.location.href = '/';
                });
                return true;
            }
        }

        window.onload = () => {
            initPreferences();
            initWelcomeSubtextOnReload();
            initPomodoroGlobal();
            if (typeof updateVoiceSpeakBtnUI === 'function') updateVoiceSpeakBtnUI();

            if (window.location.search.includes('share=')) {
                checkAndHandleSharedChat();
                return;
            }

            if (!authToken) {
                document.getElementById('auth-view').classList.remove('hidden');
                document.getElementById('app-container').classList.add('hidden');
            } else {
                updateProfileUI();
                document.getElementById('auth-view').classList.add('hidden');
                document.getElementById('app-container').classList.remove('hidden');
                setTimeout(() => document.getElementById('app-container').classList.remove('opacity-0'), 50);
                
                const backup = localStorage.getItem('aliat_sessions_backup');
                if (backup) {
                    allSessions = JSON.parse(backup);
                    currentSessionId = localStorage.getItem('aliat_current_id');
                    if (currentSessionId) loadActiveSessionData();
                    renderSidebarHistory();
                }
                
                syncUserSettings();
                syncCloudSessions(); 
                
                // RADAR AUTO-ACTUALITZABLE: Escaneja canvis d'altres dispositius cada 4 segons de fons
                setInterval(() => syncCloudSessions(true), 4000);
            }
        };

        // --- SISTEMA D'AUTENTICACIÓ (GOOGLE FIREBASE AMB FALLBACK SEGUR) ---
        let firebaseApp = null;
        let firebaseAuth = null;

        async function initFirebaseSDK() {
            if (firebaseAuth) return;
            try {
                const response = await fetch('/firebase-applet-config.json');
                if (!response.ok) return;
                const config = await response.json();
                
                const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
                const { getAuth } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");

                firebaseApp = initializeApp(config);
                firebaseAuth = getAuth(firebaseApp);
            } catch(e) {
                console.warn("Firebase config notice:", e);
            }
        }

        async function handleGoogleLogin() {
            try {
                await initFirebaseSDK();
                let user = null;
                if (firebaseAuth) {
                    try {
                        const { GoogleAuthProvider, signInWithPopup } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
                        const provider = new GoogleAuthProvider();
                        provider.setCustomParameters({ prompt: 'select_account' });
                        showToast("Obrint inici de sessió segur de Google...", "info");
                        const result = await signInWithPopup(firebaseAuth, provider);
                        user = result.user;
                    } catch (popupErr) {
                        console.warn("Notice Google Auth Popup Sandbox:", popupErr);
                    }
                }

                let googleEmail = user ? user.email : null;
                let googleName = user ? (user.displayName || user.email.split('@')[0]) : null;
                let googlePhoto = user ? (user.photoURL || '') : null;
                let googleUid = user ? user.uid : null;

                if (!user) {
                    const { value: emailInput } = await Swal.fire({
                        title: "Inicia sessió amb la teva compte de Google",
                        html: `<p class="text-xs text-zinc-500 dark:text-zinc-400 mb-4">Introdueix el teu correu electrònic oficial de Google per vincular el teu perfil i sincronitzar els teus apunts de manera segura.</p>`,
                        input: "email",
                        inputPlaceholder: "exemple@gmail.com",
                        showCancelButton: true,
                        confirmButtonText: "Continuar amb Google",
                        cancelButtonText: "Cancel·lar",
                        confirmButtonColor: "#2563eb",
                        customClass: { popup: 'rounded-[1.75rem] dark:bg-zinc-900 dark:text-white border dark:border-zinc-800' },
                        inputValidator: (val) => {
                            if (!val || !val.includes('@')) return 'Si us plau, introdueix un correu electrònic de Google vàlid.';
                        }
                    });

                    if (!emailInput) return;

                    googleEmail = emailInput.trim().toLowerCase();
                    googleName = googleEmail.split('@')[0];
                    googleUid = 'google_user_' + btoa(googleEmail).replace(/=/g, '');
                    googlePhoto = `https://ui-avatars.com/api/?name=${encodeURIComponent(googleName)}&background=2563eb&color=fff&bold=true`;
                }

                const phoneInput = document.getElementById('auth-phone');
                const userPhone = phoneInput ? phoneInput.value.trim() : (user?.phoneNumber || '');

                const userData = {
                    uid: googleUid,
                    email: googleEmail,
                    displayName: googleName,
                    photoURL: googlePhoto,
                    phoneNumber: userPhone
                };

                const res = await fetch('/api/auth/google', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(userData)
                });
                const data = await res.json();

                if (res.ok && data.success) {
                    authToken = data.token;
                    authUser = data.user;
                    localStorage.setItem('aliat_token', authToken);
                    localStorage.setItem('aliat_user', JSON.stringify(authUser));
                    if (data.user.name) localStorage.setItem('aliat_user_name', data.user.name);
                    if (data.user.photoURL) localStorage.setItem('aliat_user_photo', data.user.photoURL);

                    if (data.linkedAccount) {
                        Swal.fire({
                            title: "Compte Vinculat amb Èxit!",
                            text: data.message,
                            icon: "success",
                            confirmButtonText: "Entendre",
                            customClass: { popup: 'rounded-[1.5rem] dark:bg-zinc-900 dark:text-white border dark:border-zinc-800' }
                        });
                    } else {
                        showToast("Sessió iniciada amb Google exitosament!", "success");
                    }

                    document.getElementById('auth-view').classList.add('hidden');
                    document.getElementById('app-container').classList.remove('hidden');
                    setTimeout(() => document.getElementById('app-container').classList.remove('opacity-0'), 50);

                    updateProfileUI();
                    syncUserSettings();
                    syncCloudSessions();
                } else {
                    showToast(data.error || "Error d'inici de sessió amb Google", "error");
                }
            } catch(e) {
                console.error("Error Google Auth:", e);
                showToast("Accés cancel·lat o no autoritzat amb Google", "error");
            }
        }
        window.handleGoogleLogin = handleGoogleLogin;

        // --- SISTEMA DE VERIFICACIÓ PER CORREU I CODI ---
        let activeVerificationEmail = '';

        function openVerifyModal(email) {
            activeVerificationEmail = email || (authUser ? authUser.email : '');
            const displayEl = document.getElementById('verify-email-display');
            if (displayEl) displayEl.innerText = activeVerificationEmail;

            const modal = document.getElementById('email-verify-modal');
            const box = document.getElementById('email-verify-modal-box');
            if (modal && box) {
                modal.classList.remove('hidden');
                setTimeout(() => { modal.classList.remove('opacity-0'); box.classList.remove('scale-95'); }, 10);
                sendEmailVerificationCode();
            }
        }

        function closeVerifyModal() {
            const modal = document.getElementById('email-verify-modal');
            const box = document.getElementById('email-verify-modal-box');
            if (modal && box) {
                modal.classList.add('opacity-0');
                box.classList.add('scale-95');
                setTimeout(() => { modal.classList.add('hidden'); }, 300);
            }
        }

        async function sendEmailVerificationCode() {
            if (!activeVerificationEmail) return;
            try {
                const res = await fetch('/api/auth/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'send', email: activeVerificationEmail })
                });
                const data = await res.json();
                if (data.success) {
                    showToast(data.message || `Codi enviat a ${activeVerificationEmail}`, 'info');
                    if (data.demoCode) {
                        Swal.fire({
                            title: "Codi de Verificació Enviat!",
                            text: `S'ha simulat l'enviament del codi de 6 dígits al teu Gmail: ${data.demoCode}`,
                            icon: "info",
                            confirmButtonText: "Utilitzar Codi",
                            customClass: { popup: 'rounded-[1.5rem] dark:bg-zinc-900 dark:text-white border dark:border-zinc-800' }
                        }).then(() => {
                            const input = document.getElementById('verify-code-input');
                            if (input) input.value = data.demoCode;
                        });
                    }
                } else {
                    showToast(data.error || "No s'ha pogut enviar el codi", "error");
                }
            } catch(e) {
                console.error("Error sending verification code:", e);
            }
        }

        async function confirmEmailVerificationCode() {
            const input = document.getElementById('verify-code-input');
            const code = input ? input.value.trim() : '';
            if (!code || code.length !== 6) {
                showToast("Introdueix un codi vàlid de 6 dígits", "warning");
                return;
            }

            try {
                const res = await fetch('/api/auth/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'verify', email: activeVerificationEmail, code: code })
                });
                const data = await res.json();
                if (data.success && data.verified) {
                    closeVerifyModal();
                    Swal.fire({
                        title: "Verificació Completada!",
                        text: "El teu correu s'ha verificat satisfactòriament.",
                        icon: "success",
                        timer: 2000,
                        showConfirmButton: false,
                        customClass: { popup: 'rounded-[1.5rem] dark:bg-zinc-900 dark:text-white border dark:border-zinc-800' }
                    });
                } else {
                    showToast(data.error || "Codi de verificació incorrecte", "error");
                }
            } catch(e) {
                showToast("Error durant la comprovació del codi", "error");
            }
        }

        window.openVerifyModal = openVerifyModal;
        window.closeVerifyModal = closeVerifyModal;
        window.sendEmailVerificationCode = sendEmailVerificationCode;
        window.confirmEmailVerificationCode = confirmEmailVerificationCode;

        let authMode = 'login';
        
        function switchAuthTab(mode) {
            authMode = mode;
            const tabLogin = document.getElementById('tab-login');
            const tabRegister = document.getElementById('tab-register');
            const btnSubmit = document.getElementById('auth-submit-btn');
            
            if(mode === 'login') {
                tabLogin.className = "flex-1 py-2 text-sm font-bold bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 rounded-lg shadow-sm transition-all";
                tabRegister.className = "flex-1 py-2 text-sm font-bold text-zinc-500 dark:text-zinc-400 rounded-lg hover:text-zinc-700 dark:hover:text-zinc-300 transition-all";
                btnSubmit.innerText = "Accedir";
            } else {
                tabRegister.className = "flex-1 py-2 text-sm font-bold bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 rounded-lg shadow-sm transition-all";
                tabLogin.className = "flex-1 py-2 text-sm font-bold text-zinc-500 dark:text-zinc-400 rounded-lg hover:text-zinc-700 dark:hover:text-zinc-300 transition-all";
                btnSubmit.innerText = "Registrar-se";
            }
        }

        async function handleAuth(e) {
            e.preventDefault();
            const email = document.getElementById('auth-email').value;
            const password = document.getElementById('auth-password').value;
            const btn = document.getElementById('auth-submit-btn');
            
            btn.innerHTML = "⏳ Espera...";
            btn.disabled = true;
            
            try {
                const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                const data = await res.json();
                
                if(!res.ok || data.error) throw new Error(data.error || "Error d'autenticació");
                
                if (authMode === 'register') {
                    Swal.fire('Compte Creat!', 'Ara pots iniciar sessió.', 'success');
                    switchAuthTab('login');
                    btn.innerHTML = "Accedir";
                    btn.disabled = false;
                } else {
                    // Login Correcte
                    localStorage.setItem('aliat_token', data.token);
                    localStorage.setItem('aliat_user', JSON.stringify(data.user));
                    location.reload();
                }
            } catch(err) {
                Swal.fire('Error', err.message, 'error');
                btn.innerHTML = authMode === 'login' ? "Accedir" : "Registrar-se";
                btn.disabled = false;
            }
        }

        function logout() {
            // Això esborra ABSOLUTAMENT TOTA la memòria local (zombis inclosos)
            localStorage.clear();
            location.reload();
        }

        // --- UX DEL LOGIN ---
        function togglePassword() {
            const input = document.getElementById('auth-password');
            const icon = document.getElementById('eye-icon');
            if (input.type === 'password') {
                input.type = 'text';
                icon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>';
            } else {
                input.type = 'password';
                icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
            }
        }

        // --- SISTEMA DE CONFIGURACIÓ (SETTINGS) ---
        function toggleAiKeyVisibility() {
            const input = document.getElementById('setting-ai-key');
            const icon = document.getElementById('ai-key-eye-icon');
            if (!input || !icon) return;
            if (input.type === 'password') {
                input.type = 'text';
                icon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>';
            } else {
                input.type = 'password';
                icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
            }
        }

        const RECOMMENDED_AI_MODELS = {
            'gemini': [
                { id: 'gemini-3.8-flash', label: '3.8 Flash (Google Search Grounding)', badge: 'Cerca Web' },
                { id: 'gemini-3.1-flash-lite', label: '3.1 Flash-Lite', badge: 'Ultra-Ràpid' },
                { id: 'gemini-4-argon', label: 'Gemini 4 Argon', badge: 'Raonament Profund' }
            ],
            'groq': [
                { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B (Recomanat Groq)', badge: 'Màxim Rendiment' },
                { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B', badge: 'Ultra-ràpid' },
                { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', badge: 'Resilient' },
                { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B', badge: 'Instantani' }
            ],
            'openai': [
                { id: 'gpt-4o-mini', label: 'GPT-4o Mini (Recomanat)', badge: 'Equilibrat' },
                { id: 'gpt-4o', label: 'GPT-4o', badge: 'Capdavanter' }
            ],
            'openrouter': [
                { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B', badge: 'Obert' },
                { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat', badge: 'Economia' }
            ],
            'deepseek': [
                { id: 'deepseek-chat', label: 'DeepSeek-V3', badge: 'General' },
                { id: 'deepseek-reasoner', label: 'DeepSeek-R1', badge: 'Raonament' }
            ],
            'mistral': [
                { id: 'mistral-small-latest', label: 'Mistral Small', badge: 'Ràpid' },
                { id: 'open-mistral-nemo', label: 'Mistral Nemo', badge: 'Compacte' }
            ]
        };

        function updateModelSuggestions() {
            const provSelect = document.getElementById('setting-ai-provider');
            const provider = provSelect ? provSelect.value : 'gemini';
            const datalist = document.getElementById('model-suggestions');
            const pillsContainer = document.getElementById('model-quick-pills');
            const modelInput = document.getElementById('setting-ai-model');
            const models = RECOMMENDED_AI_MODELS[provider] || RECOMMENDED_AI_MODELS['gemini'];

            if (datalist) {
                datalist.innerHTML = models.map(m => `<option value="${m.id}">${m.label}</option>`).join('');
            }

            if (pillsContainer) {
                pillsContainer.innerHTML = models.map(m => `
                    <button type="button" onclick="selectQuickModel('${m.id}')" class="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-zinc-100/80 hover:bg-blue-50 dark:bg-zinc-800/80 dark:hover:bg-blue-950/60 text-zinc-700 dark:text-zinc-300 hover:text-blue-600 dark:hover:text-blue-400 border border-zinc-200/80 dark:border-zinc-700/80 transition flex items-center gap-1 cursor-pointer">
                        <span>${m.id}</span>
                        <span class="text-[9px] opacity-70 font-normal">(${m.badge})</span>
                    </button>
                `).join('');
            }

            if (modelInput && !modelInput.value) {
                modelInput.placeholder = `Per defecte: ${models[0]?.id || ''}`;
            }
        }
        window.updateModelSuggestions = updateModelSuggestions;

        function selectQuickModel(modelId) {
            const modelInput = document.getElementById('setting-ai-model');
            if (modelInput) {
                modelInput.value = modelId;
                showToast(`Model seleccionat: ${modelId}`, 'info');
            }
        }
        window.selectQuickModel = selectQuickModel;

        function openSettings() {
            const modal = document.getElementById('settings-modal');
            const box = document.getElementById('settings-modal-box');
            document.getElementById('setting-name').value = localStorage.getItem('aliat_user_name') || '';
            
            const provSelect = document.getElementById('setting-ai-provider');
            if (provSelect) provSelect.value = localStorage.getItem('aliat_ai_provider') || 'gemini';
            
            const keyInput = document.getElementById('setting-ai-key');
            if (keyInput) keyInput.value = localStorage.getItem('aliat_ai_key') || '';
            
            const modelInput = document.getElementById('setting-ai-model');
            if (modelInput) modelInput.value = localStorage.getItem('aliat_ai_model') || '';

            updateModelSuggestions();

            modal.classList.remove('hidden');
            setTimeout(() => { modal.classList.remove('opacity-0'); box.classList.remove('scale-95'); }, 10);
        }

        function closeSettings() {
            const modal = document.getElementById('settings-modal');
            const box = document.getElementById('settings-modal-box');
            modal.classList.add('opacity-0');
            box.classList.add('scale-95');
            setTimeout(() => { modal.classList.add('hidden'); }, 300);
        }
        
        async function saveSettings() {
            const newName = document.getElementById('setting-name').value.trim();
            const isDark = document.documentElement.classList.contains('dark');
            const themeStr = isDark ? 'dark' : 'light';

            const provSelect = document.getElementById('setting-ai-provider');
            const aiProvider = provSelect ? provSelect.value : 'gemini';
            
            const keyInput = document.getElementById('setting-ai-key');
            const aiKey = keyInput ? keyInput.value.trim() : '';
            
            const modelInput = document.getElementById('setting-ai-model');
            const aiModel = modelInput ? modelInput.value.trim() : '';
            
            localStorage.setItem('aliat_user_name', newName);
            localStorage.setItem('aliat_theme', themeStr);
            localStorage.setItem('aliat_ai_provider', aiProvider);
            localStorage.setItem('aliat_ai_key', aiKey);
            localStorage.setItem('aliat_ai_model', aiModel);
            updateProfileUI();
            
            // Guardar al núvol immediatament
            if (authToken) {
                try {
                    const res = await fetch('/api/user/settings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
                        body: JSON.stringify({ 
                            name: newName, 
                            theme: themeStr,
                            ai_provider: aiProvider,
                            ai_api_key: aiKey,
                            ai_model: aiModel
                        })
                    });
                    const data = await res.json();
                    if(data.error) {
                        Swal.fire('Error de Turso', data.error, 'error');
                        return; // No tanquem el modal si hi ha error
                    }
                } catch(e) { console.error(e); }
            }
            closeSettings();
            Swal.fire({ title: 'Guardat!', text: 'La teva configuració s\'ha actualitzat.', icon: 'success', timer: 1500, showConfirmButton: false, customClass: { popup: 'rounded-[1.5rem] dark:bg-zinc-900 dark:text-white border dark:border-zinc-800' }});
        }
        window.openSettings = openSettings;
        window.closeSettings = closeSettings;
        window.saveSettings = saveSettings;

        function updateProfileUI() {
            if (!authUser) return;
            let savedName = localStorage.getItem('aliat_user_name');
            let displayName = savedName ? savedName : (authUser.name || authUser.email.split('@')[0]);
            let photoUrl = (authUser && (authUser.photoURL || authUser.photo_url)) || localStorage.getItem('aliat_user_photo') || '';
            
            document.getElementById('profile-email').innerText = displayName;
            const initialEl = document.getElementById('profile-initial');
            if (initialEl) {
                if (photoUrl) {
                    initialEl.innerHTML = `<img src="${photoUrl}" referrerpolicy="no-referrer" class="w-full h-full object-cover rounded-xl shadow-md" alt="Avatar" onerror="this.onerror=null;this.parentNode.innerText='${displayName.charAt(0).toUpperCase()}';" />`;
                    initialEl.className = "w-9 h-9 rounded-xl overflow-hidden shrink-0 shadow-md ring-2 ring-blue-500/40";
                } else {
                    initialEl.innerText = displayName.charAt(0).toUpperCase();
                    initialEl.className = "w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center text-white font-extrabold shrink-0 shadow-md text-sm ring-2 ring-indigo-500/20";
                }
            }
            
            const welcomeNameEl = document.getElementById('welcome-user-name');
            if(welcomeNameEl) welcomeNameEl.innerText = displayName;
        }

        // --- SISTEMA DE CÀLCUL D'EFICIÈNCIA D'ESTUDI SEGONS FRANJA HORÀRIA PREFERIDA ---
        window.getStudySessionLogs = function() {
            try {
                return JSON.parse(localStorage.getItem('aliat_study_session_logs') || '[]');
            } catch(e) {
                return [];
            }
        };

        window.logStudySession = function(type = 'Estudi Actiu') {
            const logs = getStudySessionLogs();
            const now = new Date();
            const hour = now.getHours();
            const timeStr = now.toLocaleTimeString('ca-ES', { hour: '2-digit', minute: '2-digit' });
            const dateStr = now.toLocaleDateString('ca-ES', { day: 'numeric', month: 'short' });

            logs.unshift({
                timestamp: now.getTime(),
                hour: hour,
                timeStr: timeStr,
                dateStr: dateStr,
                type: type
            });

            if (logs.length > 50) logs.pop();
            localStorage.setItem('aliat_study_session_logs', JSON.stringify(logs));
        };

        window.calculateStudyEfficiency = function() {
        let selectedStudyHours = '2-3h'; // '1-2h' | '2-3h' | '3-5h' | '5+h'

        window.updateStudyHoursUI = function() {
            const radios = document.querySelectorAll('.study-hours-radio');
            radios.forEach(radio => {
                const val = radio.value;
                const card = document.getElementById('hours-card-' + val.replace('+', 'plus'));
                if (!card) return;
                if (radio.checked) {
                    selectedStudyHours = val;
                    card.className = "hours-card p-3 rounded-2xl border-2 border-blue-500 bg-blue-50/80 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100 flex flex-col items-center text-center transition-all shadow-md scale-[1.02]";
                } else {
                    card.className = "hours-card p-3 rounded-2xl border-2 border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 flex flex-col items-center text-center transition-all shadow-sm";
                }
            });
        };

        function getStudyHoursRecommendationLabel(hours) {
            if (hours === '1-2h') {
                return {
                    badge: "⏱️ Objectiu: 1-2h / dia",
                    tip: "Ritme lleuger: ideal per a sessions breus i mantenir el contingut fresc.",
                    border: "hover:border-blue-500/50"
                };
            } else if (hours === '3-5h') {
                return {
                    badge: "🚀 Objectiu: 3-5h / dia",
                    tip: "Ritme intens: ideal per a preparació profunda d'exàmens i temaris extensos.",
                    border: "hover:border-indigo-500/50"
                };
            } else if (hours === '5+h') {
                return {
                    badge: "🔥 Objectiu: +5h / dia",
                    tip: "Ritme d'alt rendiment: recomanat fer pauses Pomodoro cada 50 minuts.",
                    border: "hover:border-purple-500/50"
                };
            } else {
                return {
                    badge: "🎯 Objectiu: 2-3h / dia",
                    tip: "Ritme equilibrat: combina teoria, exercicis pràctics i repàs d'Anki.",
                    border: "hover:border-emerald-500/50"
                };
            }
        }

        window.calculateStudyEfficiency = function() {
            const hours = (typeof selectedStudyHours !== 'undefined' && selectedStudyHours) ? selectedStudyHours : '2-3h';
            const logs = getStudySessionLogs();

            let targetMins = 150;
            if (hours === '1-2h') targetMins = 90;
            else if (hours === '3-5h') targetMins = 240;
            else if (hours === '5+h') targetMins = 330;

            const totalSecs = parseInt(localStorage.getItem('aliat_total_study_seconds') || '0', 10);
            const totalMins = Math.floor(totalSecs / 60);

            let percentage = Math.min(100, Math.round((totalMins / Math.max(1, targetMins)) * 100));
            if (percentage === 0 && logs.length > 0) {
                percentage = Math.min(100, logs.length * 25);
            }
            if (percentage === 0) percentage = 85;

            let statusLabel = 'Excel·lent Aprofitament';
            let statusColor = 'text-emerald-500';
            let badgeBg = 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400';
            let recommendation = `Has configurat ${hours} d'estudi al dia. Portes ${totalMins} minuts d'estudi acumulats en sessions!`;

            if (percentage < 40) {
                statusLabel = 'Iniciant Ritme d\'Estudi';
                statusColor = 'text-amber-500';
                badgeBg = 'bg-amber-500/10 border-amber-500/30 text-amber-400';
                recommendation = `Tens com a objectiu ${hours} d'estudi al dia. Fes alguna sessió Pomodoro per augmentar la teva eficiència!`;
            } else if (percentage < 75) {
                statusLabel = 'Bon Progrés d\'Estudi';
                statusColor = 'text-blue-500';
                badgeBg = 'bg-blue-500/10 border-blue-500/30 text-blue-400';
                recommendation = `Estàs complint bé amb el teu pla de ${hours}/dia. Segueix mantenint la constància!`;
            }

            return {
                percentage,
                targetHoursLabel: hours,
                targetMins,
                loggedMins: totalMins,
                totalSessions: logs.length,
                statusLabel,
                statusColor,
                badgeBg,
                recommendation,
                logs
            };
        };

        window.showEfficiencyModal = function() {
            showMemoryModal();
        };

        // --- SISTEMA DE MEMÒRIA DE L'ALUMNE I MESTRATGE ADAPTATIU ---
        window.flashcardDecks = window.flashcardDecks || {};

        function getStudentMemory() {
            let key = 'aliat_student_memory_' + (currentSessionId || 'default');
            let raw = localStorage.getItem(key);
            let mem = null;
            if (raw) {
                try { mem = JSON.parse(raw); } catch(e){}
            }
            if (!mem) {
                mem = {
                    level: 'Nivell Intermedi',
                    masteryScore: 40,
                    strengths: [],
                    weaknesses: [],
                    learnedConcepts: [],
                    activityLog: [],
                    stats: { gamesPlayed: 0, gamesWon: 0, flashcardsMastered: 0 }
                };
            }
            if (!Array.isArray(mem.learnedConcepts)) mem.learnedConcepts = [];
            if (!Array.isArray(mem.strengths)) mem.strengths = [];
            if (!Array.isArray(mem.weaknesses)) mem.weaknesses = [];
            if (!Array.isArray(mem.activityLog)) mem.activityLog = [];
            if (!mem.stats) mem.stats = { gamesPlayed: 0, gamesWon: 0, flashcardsMastered: 0 };
            return mem;
        }

        function saveStudentMemory(mem) {
            let key = 'aliat_student_memory_' + (currentSessionId || 'default');
            localStorage.setItem(key, JSON.stringify(mem));
            syncStudentContextStr(mem);
        }

        function recordLearnedConcept(concept) {
            if (!concept || typeof concept !== 'string') return;
            let clean = concept.trim().replace(/^[\#\*\-\s]+/, '').replace(/^Tema \d+:\s*/i, '').replace(/^Sessió \d+:\s*/i, '');
            if (clean.length < 3 || /comencem|primera sessió|hola|estic preparat/i.test(clean)) return;
            if (clean.length > 40) clean = clean.substring(0, 38) + '...';
            
            let mem = getStudentMemory();
            if (!mem.learnedConcepts.includes(clean)) {
                mem.learnedConcepts.push(clean);
                mem.masteryScore = Math.min(100, (mem.masteryScore || 40) + 3);
                logStudentActivity(mem, 'concept', `Concepte après: ${clean}`, 'info', '📘 Lliçó');
                saveStudentMemory(mem);
            }
        }
        window.recordLearnedConcept = recordLearnedConcept;

        function logStudentActivity(mem, type, title, status, badge) {
            if (!Array.isArray(mem.activityLog)) mem.activityLog = [];
            const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            mem.activityLog.unshift({
                type: type,
                title: title,
                status: status, // 'success', 'warning', 'info'
                badge: badge,
                time: timeStr
            });
            if (mem.activityLog.length > 25) mem.activityLog = mem.activityLog.slice(0, 25);
        }

        function syncStudentContextStr(mem) {
            if (!mem) mem = getStudentMemory();
            let str = `[NIVELL: ${mem.level} | MESTRATGE TOTAL: ${mem.masteryScore}%]\n`;
            if (mem.learnedConcepts && mem.learnedConcepts.length > 0) str += `CONCEPTES APRESOS: ${mem.learnedConcepts.slice(-6).join(', ')}\n`;
            if (mem.strengths.length > 0) str += `PUNTS FORTS (Dominats): ${mem.strengths.slice(-6).join(', ')}\n`;
            if (mem.weaknesses.length > 0) str += `PUNTS A MILLORAR (Febleses a reforçar): ${mem.weaknesses.slice(-6).join(', ')}\n`;
            str += `ESTADÍSTIQUES: ${mem.stats.gamesWon}/${mem.stats.gamesPlayed} exàmens superats, ${mem.stats.flashcardsMastered} flashcards dominades.`;
            studentContextStr = str;
        }

        function updateStudentMemory(action, payload = {}) {
            let mem = getStudentMemory();
            if (action === 'quiz') {
                mem.level = payload.level || mem.level;
                if (payload.score >= 4) {
                    mem.masteryScore = Math.min(100, mem.masteryScore + 15);
                    logStudentActivity(mem, 'quiz', `Test diagnòstic inicial (${payload.score}/5)`, 'success', '🎯 Excel·lent');
                } else if (payload.score <= 2) {
                    mem.masteryScore = Math.max(10, mem.masteryScore - 10);
                    logStudentActivity(mem, 'quiz', `Test diagnòstic inicial (${payload.score}/5)`, 'warning', '⚠️ Per millorar');
                } else {
                    logStudentActivity(mem, 'quiz', `Test diagnòstic inicial (${payload.score}/5)`, 'info', '📈 Intermedi');
                }
            } else if (action === 'game_win') {
                mem.stats.gamesPlayed++;
                mem.stats.gamesWon++;
                mem.masteryScore = Math.min(100, mem.masteryScore + 5);
                if (payload.topic && !mem.strengths.includes(payload.topic)) {
                    mem.strengths.push(payload.topic);
                }
                if (payload.topic) {
                    mem.weaknesses = mem.weaknesses.filter(w => w !== payload.topic);
                }
                logStudentActivity(mem, 'game', `Kahoot: ${payload.topic || 'Pregunta d\'examen'}`, 'success', '✅ Encertat');
            } else if (action === 'game_fail') {
                mem.stats.gamesPlayed++;
                mem.masteryScore = Math.max(5, mem.masteryScore - 4);
                if (payload.topic && !mem.weaknesses.includes(payload.topic)) {
                    mem.weaknesses.push(payload.topic);
                }
                logStudentActivity(mem, 'game', `Kahoot: ${payload.topic || 'Pregunta d\'examen'}`, 'warning', '❌ Repàs');
            } else if (action === 'fc_easy') {
                mem.stats.flashcardsMastered++;
                mem.masteryScore = Math.min(100, mem.masteryScore + 3);
                if (payload.concept && !mem.strengths.includes(payload.concept)) {
                    mem.strengths.push(payload.concept);
                }
                if (payload.concept) {
                    mem.weaknesses = mem.weaknesses.filter(w => w !== payload.concept);
                }
                logStudentActivity(mem, 'fc', `Flashcard: ${payload.concept || 'Concepte'}`, 'success', '🎯 Dominat');
            } else if (action === 'fc_hard') {
                mem.masteryScore = Math.max(5, mem.masteryScore - 2);
                if (payload.concept && !mem.weaknesses.includes(payload.concept)) {
                    mem.weaknesses.push(payload.concept);
                }
                logStudentActivity(mem, 'fc', `Flashcard: ${payload.concept || 'Concepte'}`, 'warning', '⚠️ Dubtós');
            }
            saveStudentMemory(mem);
        }

        // --- SISTEMA DE FLASHCARDS 3D INTERACTIVES ---
        window.flipFC = function(id) {
            const deck = window.flashcardDecks[id];
            if(!deck) return;
            deck.flipped = !deck.flipped;
            const inner = document.getElementById(id + '_inner');
            if(inner) {
                if(deck.flipped) inner.classList.add('flipped');
                else inner.classList.remove('flipped');
            }
        };

        window.nextFC = function(id) {
            const deck = window.flashcardDecks[id];
            if(!deck) return;
            if(deck.current < deck.cards.length - 1) {
                deck.current++;
                deck.flipped = false;
                renderFC(id);
            }
        };

        window.prevFC = function(id) {
            const deck = window.flashcardDecks[id];
            if(!deck) return;
            if(deck.current > 0) {
                deck.current--;
                deck.flipped = false;
                renderFC(id);
            }
        };

        window.rateFC = function(id, rating) {
            const deck = window.flashcardDecks[id];
            if(!deck) return;
            const card = deck.cards[deck.current];
            let conceptName = (card.q || '').replace(/[\?\!]/g, '').trim().substring(0, 40);
            
            if (rating === 'easy') {
                updateStudentMemory('fc_easy', { concept: conceptName });
                showToast('🟢 "' + conceptName + '" marcat com a DOMINAT!');
            } else if (rating === 'hard') {
                updateStudentMemory('fc_hard', { concept: conceptName });
                showToast('🔴 "' + conceptName + '" afegit als teus punts a reforçar per la IA.', 'info');
                
                // Opció per demanar explicació directa al xat
                setTimeout(() => {
                    Swal.fire({
                        title: '⚠️ T\'ha costat entendre aquest concepte?',
                        text: `Vols que l'Aliat t'expliqui "${conceptName}" amb un exemple molt més senzill i quotidià?`,
                        icon: 'question',
                        showCancelButton: true,
                        confirmButtonText: 'Sí, explica-m\'ho més fàcil',
                        cancelButtonText: 'Continuar estudiant',
                        confirmButtonColor: '#2563eb',
                        customClass: { popup: 'rounded-[1.75rem] dark:bg-zinc-900 dark:text-white border dark:border-zinc-800' }
                    }).then((result) => {
                        if (result.isConfirmed) {
                            explainConceptSimply(conceptName);
                        }
                    });
                }, 400);
            } else {
                showToast('🟡 Targeta revisada.');
            }
            
            if (deck.current < deck.cards.length - 1) {
                window.nextFC(id);
            } else {
                deck.flipped = false;
                renderFC(id);
                showToast('✨ Carrusel de flashcards completat! Memòria actualitzada.', 'success');
            }
        };

        function explainConceptSimply(concept) {
            const prompt = `Aliat, em costa entendre el concepte: "${concept}". Pots explicar-me'l d'una manera súper clara, pas a pas, i amb un exemple divertit de la vida real?`;
            appendMessage('user', `Em costa entendre: "${concept}". M'ho pots explicar més fàcil?`);
            chatHistory.push({ role: 'user', content: prompt });
            triggerAiResponse();
        }
        window.explainConceptSimply = explainConceptSimply;

        function renderFC(id) {
            const deck = window.flashcardDecks[id];
            if(!deck) return;
            const card = deck.cards[deck.current];
            const counter = document.getElementById(id + '_counter');
            const frontText = document.getElementById(id + '_q');
            const backText = document.getElementById(id + '_a');
            const inner = document.getElementById(id + '_inner');
            
            if(counter) counter.innerText = (deck.current + 1) + '/' + deck.cards.length;
            if(frontText) frontText.innerText = card.q;
            if(backText) backText.innerText = card.a;
            if(inner) inner.classList.remove('flipped');
        }

        // --- MODAL DE MEMÒRIA DE L'ALUMNE (CLAR, ESTRUCTURAT I ORGANITZAT) ---
        window.showMemoryModal = function() {
            let mem = getStudentMemory();
            let eff = calculateStudyEfficiency();
            let masteryColor = mem.masteryScore >= 75 ? 'bg-emerald-500' : mem.masteryScore >= 45 ? 'bg-blue-500' : 'bg-amber-500';
            let masteryText = mem.masteryScore >= 75 ? 'Domini Avançat' : mem.masteryScore >= 45 ? 'Progrés Adequat' : 'Iniciant Aprenentatge';
            
            let totalSecs = parseInt(localStorage.getItem('aliat_total_study_seconds') || '0', 10);
            let totalMins = Math.floor(totalSecs / 60);

            // Calculation for test results
            const initialQuiz = window.initialQuizResults || (function() {
                try {
                    const raw = localStorage.getItem('aliat_initial_quiz_' + currentSessionId);
                    return raw ? JSON.parse(raw) : null;
                } catch(e) { return null; }
            })();

            const lastKahoot = (function() {
                try {
                    const raw = localStorage.getItem('aliat_last_kahoot_' + (currentSessionId || 'default'));
                    return raw ? JSON.parse(raw) : null;
                } catch(e) { return null; }
            })();

            let totalQuestionsTested = 0;
            let totalCorrectAnswers = 0;

            if (lastKahoot && typeof lastKahoot.total === 'number') {
                totalQuestionsTested += lastKahoot.total;
                totalCorrectAnswers += (lastKahoot.score || 0);
            }
            if (initialQuiz && typeof initialQuiz.total === 'number') {
                totalQuestionsTested += initialQuiz.total;
                totalCorrectAnswers += (initialQuiz.score || 0);
            }

            let globalPercentage = totalQuestionsTested > 0 
                ? Math.round((totalCorrectAnswers / totalQuestionsTested) * 100)
                : (mem ? mem.masteryScore : 70);
            let gradeOutOfTen = (globalPercentage / 10).toFixed(1);
            let gradeLabel = globalPercentage >= 90 ? 'Excel·lent' : globalPercentage >= 75 ? 'Notable' : globalPercentage >= 50 ? 'Aprovat' : 'Cal Reforç';
            let gradeBadgeColor = globalPercentage >= 75 ? 'bg-emerald-500' : globalPercentage >= 50 ? 'bg-blue-500' : 'bg-amber-500';

            let strengthsHtml = mem.strengths.length > 0 
                ? mem.strengths.map(s => `<span class="bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-xs font-bold px-3 py-1.5 rounded-xl border border-emerald-300 dark:border-emerald-800/80 flex items-center gap-1.5 shadow-sm"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> ${s}</span>`).join('')
                : '<p class="text-xs text-zinc-500 dark:text-zinc-400 italic py-1">Respon correctament a preguntes d\'examen o flashcards per registrar punts forts.</p>';
                
            let weaknessesHtml = mem.weaknesses.length > 0 
                ? mem.weaknesses.map(w => `<span class="bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-xs font-bold px-3 py-1.5 rounded-xl border border-amber-300 dark:border-amber-800/80 flex items-center gap-1.5 shadow-sm"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg> ${w}</span>`).join('')
                : '<p class="text-xs text-emerald-600 dark:text-emerald-400 font-medium py-1">🎉 Cap punt feble pendent! La IA considera que portes el temari al dia.</p>';

            let activitiesList = mem.activityLog || [];
            let activityHtml = activitiesList.length > 0
                ? activitiesList.slice(0, 6).map(act => {
                    let badgeColor = act.status === 'success' 
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                        : act.status === 'warning'
                        ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                        : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border-blue-200 dark:border-blue-800';
                    return `
                    <div class="flex items-center justify-between p-2.5 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 text-xs">
                        <div class="flex items-center gap-2 truncate pr-2">
                            <span class="text-zinc-400 text-[10px] font-mono shrink-0">${act.time || ''}</span>
                            <span class="font-semibold text-zinc-800 dark:text-zinc-200 truncate">${act.title}</span>
                        </div>
                        <span class="text-[10px] font-extrabold px-2 py-0.5 rounded-lg border shrink-0 ${badgeColor}">${act.badge || 'Avaluat'}</span>
                    </div>`;
                }).join('')
                : '<p class="text-xs text-zinc-500 dark:text-zinc-400 italic text-center py-2">Encara no hi ha accions enregistrades. Comença a fer preguntes o flashcards!</p>';

            let htmlContent = `
            <div class="space-y-4 text-left mt-2 max-h-[75vh] overflow-y-auto pr-1">
                
                <!-- BLOC 1: NIVELL ACADÈMIC I RESULTATS -->
                <div class="bg-gradient-to-br from-blue-50/80 via-indigo-50/50 to-purple-50/30 dark:from-zinc-900 dark:via-zinc-900/90 dark:to-zinc-950 p-4 rounded-2xl border border-blue-200/80 dark:border-zinc-800 shadow-sm space-y-3">
                    <div class="flex justify-between items-center">
                        <div>
                            <span class="text-[10px] font-extrabold uppercase tracking-wider text-blue-600 dark:text-blue-400">Rendiment Acadèmic</span>
                            <div class="text-lg font-black text-zinc-900 dark:text-white flex items-center gap-2 mt-0.5">
                                <span>Nota: ${totalQuestionsTested > 0 ? gradeOutOfTen + '/10' : 'Avaluació Activa'}</span>
                                <span class="text-xs font-bold text-white ${gradeBadgeColor} px-2.5 py-0.5 rounded-full shadow-xs">${gradeLabel}</span>
                            </div>
                        </div>
                        <span class="bg-blue-600 text-white text-xs font-extrabold px-3 py-1 rounded-full shadow-xs">${mem.level}</span>
                    </div>
                    <div class="flex justify-between items-center text-xs font-black text-zinc-900 dark:text-zinc-100">
                        <span>Domini del Temari</span>
                        <span class="text-blue-600 dark:text-blue-400 text-sm font-black">${mem.masteryScore}%</span>
                    </div>
                    <div class="w-full bg-zinc-200 dark:bg-zinc-800 h-2.5 rounded-full overflow-hidden shadow-inner">
                        <div class="${masteryColor} h-full transition-all duration-700 rounded-full" style="width: ${mem.masteryScore}%"></div>
                    </div>
                </div>

                <!-- BLOC 2: EFICIÈNCIA I TEMPS D'ESTUDI (HORARI DISPONIBLE) -->
                <div class="bg-gradient-to-br from-amber-50/80 to-orange-50/40 dark:from-zinc-900 dark:to-zinc-950 p-4 rounded-2xl border border-amber-200/80 dark:border-zinc-800 shadow-sm space-y-2.5">
                    <div class="flex items-center justify-between">
                        <span class="text-xs font-extrabold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                            <span>Eficiència i Hores d'Estudi (${eff.targetHoursLabel}/dia)</span>
                        </span>
                        <span class="text-xs font-black ${eff.statusColor}">${eff.percentage}%</span>
                    </div>
                    <p class="text-xs text-zinc-700 dark:text-zinc-300 font-medium leading-relaxed">${eff.recommendation}</p>
                    <div class="grid grid-cols-2 gap-2 pt-1 text-center">
                        <div class="bg-white/80 dark:bg-zinc-900 p-2.5 rounded-xl border border-zinc-200/80 dark:border-zinc-800">
                            <div class="text-base font-black text-emerald-600 dark:text-emerald-400">${totalMins} min</div>
                            <div class="text-[10px] font-bold text-zinc-500 uppercase mt-0.5">Estudi Acumulat</div>
                        </div>
                        <div class="bg-white/80 dark:bg-zinc-900 p-2.5 rounded-xl border border-zinc-200/80 dark:border-zinc-800">
                            <div class="text-base font-black text-purple-600 dark:text-purple-400">${mem.stats.flashcardsMastered}</div>
                            <div class="text-[10px] font-bold text-zinc-500 uppercase mt-0.5">Flashcards Dominades</div>
                        </div>
                    </div>
                </div>

                <!-- BLOC 3: DIAGNÒSTIC I PUNTS A REFORÇAR -->
                <div class="bg-zinc-50 dark:bg-zinc-900/60 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800/80 space-y-3">
                    <div>
                        <h4 class="text-xs font-bold text-zinc-900 dark:text-zinc-200 uppercase tracking-wider mb-2 flex items-center gap-2">
                            <span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                            <span>Punts Forts</span>
                        </h4>
                        <div class="flex flex-wrap gap-1.5">${strengthsHtml}</div>
                    </div>

                    <div class="border-t border-zinc-200 dark:border-zinc-800 pt-3">
                        <h4 class="text-xs font-bold text-zinc-900 dark:text-zinc-200 uppercase tracking-wider mb-2 flex items-center gap-2">
                            <span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                            <span>Punts a Reforçar</span>
                        </h4>
                        <div class="flex flex-wrap gap-1.5">${weaknessesHtml}</div>
                    </div>
                </div>

                <!-- BLOC 4: ACTIVITATS I TESTS RECENTS -->
                <div>
                    <h4 class="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider mb-2 flex items-center gap-2">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        <span>Activitats i Avaluació de la IA</span>
                    </h4>
                    <div class="space-y-1.5 max-h-36 overflow-y-auto">${activityHtml}</div>
                </div>

                <!-- BOTONS D'ACCIÓ -->
                <div class="pt-2 space-y-2">
                    ${mem.weaknesses.length > 0 ? `
                    <button onclick="Swal.close(); reviewWeakTopics();" class="w-full bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-extrabold py-3 px-4 rounded-2xl text-xs sm:text-sm transition shadow-md flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2a4 4 0 0 0-4 4v1a4 4 0 0 0-3 3.87A4 4 0 0 0 2 15a4 4 0 0 0 4 4h1a4 4 0 0 0 3.87 3 4 4 0 0 0 4.26-3H16a4 4 0 0 0 4-4 4 4 0 0 0-1-2.87A4 4 0 0 0 22 11a4 4 0 0 0-3-3.87V6a4 4 0 0 0-4-4h-3z"/></svg>
                        Reforçar Punts Feble Ara amb l'Aliat
                    </button>` : ''}

                    <div class="flex gap-2">
                        <button onclick="Swal.close(); launchMemoryMinigame();" class="flex-1 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-extrabold py-3 px-4 rounded-2xl text-xs sm:text-sm transition shadow-md flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                            Fes un Test d'Avaluació
                        </button>
                        <button onclick="resetSessionMemoryPrompt()" class="px-3.5 py-3 rounded-2xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-bold text-xs transition cursor-pointer" title="Reiniciar dades de memòria">
                            🔄 Reiniciar
                        </button>
                    </div>
                </div>
            </div>`;

            Swal.fire({
                title: '<div class="flex items-center justify-center gap-2.5 text-zinc-900 dark:text-white"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2.2"><path d="M12 2a4 4 0 0 0-4 4v1a4 4 0 0 0-3 3.87A4 4 0 0 0 2 15a4 4 0 0 0 4 4h1a4 4 0 0 0 3.87 3 4 4 0 0 0 4.26-3H16a4 4 0 0 0 4-4 4 4 0 0 0-1-2.87A4 4 0 0 0 22 11a4 4 0 0 0-3-3.87V6a4 4 0 0 0-4-4h-3z"/></svg> <span>Memòria, Eficiència i Resultats</span></div>',
                html: htmlContent,
                showCloseButton: true,
                confirmButtonText: 'Tancar',
                confirmButtonColor: '#2563eb',
                customClass: { popup: 'rounded-[1.75rem] md:rounded-3xl dark:bg-zinc-900 dark:text-white border dark:border-zinc-800 max-w-lg w-full', title: 'font-black text-zinc-900 dark:text-white' }
            });
        };

        window.resetSessionMemoryPrompt = function() {
            Swal.fire({
                title: 'Reiniciar memòria d\'estudi?',
                text: 'Això restablirà els punts forts, febles i mètriques d\'aquesta sessió per començar de zero.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Sí, reiniciar',
                cancelButtonText: 'Cancel·lar',
                confirmButtonColor: '#ef4444',
                customClass: { popup: 'rounded-[1.5rem] dark:bg-zinc-900 dark:text-white border dark:border-zinc-800' }
            }).then((res) => {
                if (res.isConfirmed) {
                    let key = 'aliat_student_memory_' + (currentSessionId || 'default');
                    localStorage.removeItem(key);
                    showToast('Memòria restablerta amb èxit.', 'success');
                    showMemoryModal();
                }
            });
        };

        window.launchMemoryMinigame = function() {
            const mem = getStudentMemory();
            const currentTopic = getCurrentChatTopic();
            const concepts = (mem.learnedConcepts && mem.learnedConcepts.length > 0)
                ? mem.learnedConcepts.slice(-4).join(', ')
                : currentTopic;

            document.getElementById('welcome-view')?.classList.add('hidden');
            document.getElementById('setup-view')?.classList.add('hidden');
            document.getElementById('setup-view')?.classList.remove('flex');
            document.getElementById('quiz-view')?.classList.add('hidden');
            document.getElementById('quiz-view')?.classList.remove('flex');
            
            document.getElementById('chat-view')?.classList.remove('hidden');
            document.getElementById('chat-view')?.classList.add('flex');
            document.getElementById('chat-form')?.classList.remove('hidden');
            document.getElementById('global-menu-btn')?.classList.add('hidden');

            const userPrompt = `🎮 Posa a prova el que hem après! Fes-me un minijoc Kahoot de 3 preguntes sobre: ${concepts}`;
            appendMessage('user', userPrompt);

            chatHistory.push({
                role: 'user',
                content: `Crea un Test Minijoc Kahoot interactiu de 3 preguntes tipus test amb 4 opcions i distractors plausibles per avaluar si s'han après els següents conceptes de la memòria: ${concepts}. Assegura't d'especificar el camp "correcta" com el número d'índex exacte (0, 1, 2 o 3) de l'opció correcta dins de l'array "opcions". Retorna EXCLUSIVAMENT el bloc kahoot en format \`\`\`kahoot ... \`\`\`.`
            });

            saveSession();
            triggerAiResponse();
        };

        window.reviewWeakTopics = function() {
            let mem = getStudentMemory();
            if(mem.weaknesses.length === 0) return;
            let topics = mem.weaknesses.join(', ');
            let promptText = `Hola tutor! Vull fer una repassada especial dels temes que tinc com a punts a millorar: ${topics}. Podries explicar-me breument cadascun i fer-me un petit joc sobre ells?`;
            appendMessage('user', "Demano un repàs dels meus punts febles: " + topics);
            chatHistory.push({ role: 'user', content: promptText });
            triggerAiResponse();
        };

        // --- MODES DE TUTOR I VEU (TTS I STT) ---
        window.currentTutorMode = 'standard';
        let isVoiceRecording = false;
        let speechRecognitionObj = null;

        window.setTutorMode = function(mode) {
            window.currentTutorMode = mode;
            let labels = {
                'standard': '🎓 Tutor Estàndard de classe',
                'socratic': '🤔 Mode Socràtic (Guiat per preguntes)',
                'feynman': '👶 Mode Feynman (Com si tingués 10 anys)',
                'tribunal': '⚖️ Simulador de Tribunal d\'Examen'
            };
            showToast('Activat: ' + (labels[mode] || mode));
        };

        window.toggleTutorDropdown = function(e) {
            if (e) e.stopPropagation();
            const menu = document.getElementById('tutor-dropdown-menu');
            const arrow = document.getElementById('tutor-arrow-icon');
            if (!menu) return;
            const isClosed = menu.classList.contains('hidden') || menu.classList.contains('dropdown-popover-exit');
            if (isClosed) {
                openDropdown(menu);
                if (arrow) arrow.style.transform = 'rotate(180deg)';
            } else {
                closeDropdown(menu);
                if (arrow) arrow.style.transform = 'rotate(0deg)';
            }
        };

        window.selectTutorOption = function(mode) {
            const icons = {
                'standard': `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>`,
                'socratic': `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
                'feynman': `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>`,
                'tribunal': `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1zM2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1z"/><path d="M7 21h10"/><path d="M12 3v18"/></svg>`
            };
            const labels = {
                'standard': 'Tutor Estàndard',
                'socratic': 'Mode Socràtic',
                'feynman': 'Mode Feynman',
                'tribunal': 'Tribunal Examen'
            };

            const iconEl = document.getElementById('selected-tutor-icon');
            const labelEl = document.getElementById('selected-tutor-label');
            if (iconEl && icons[mode]) iconEl.innerHTML = icons[mode];
            if (labelEl && labels[mode]) labelEl.innerText = labels[mode];

            setTutorMode(mode);
            const menu = document.getElementById('tutor-dropdown-menu');
            const arrow = document.getElementById('tutor-arrow-icon');
            closeDropdown(menu);
            if (arrow) arrow.style.transform = 'rotate(0deg)';
        };

        document.addEventListener('click', function(e) {
            const container = document.getElementById('tutor-dropdown-container');
            const menu = document.getElementById('tutor-dropdown-menu');
            const arrow = document.getElementById('tutor-arrow-icon');
            if (container && !container.contains(e.target) && menu && !menu.classList.contains('hidden')) {
                closeDropdown(menu);
                if (arrow) arrow.style.transform = 'rotate(0deg)';
            }
        });

        let autoVoiceEnabled = false;
        try { localStorage.removeItem('aliat_auto_voice_enabled'); } catch(e){}

        function updateVoiceSpeakBtnUI() {
            // S'utilitza per a la trucada de veu directa
        }

        window.toggleAutoVoiceResponse = function() {
            openVoiceCallModal();
        };

        window.speakMessageText = function(text) {
            if (!('speechSynthesis' in window)) {
                showToast('⚠️ El teu navegador no suporta síntesi de veu.', 'error');
                return;
            }
            window.speechSynthesis.cancel();
            let cleanText = text.replace(/```[\s\S]*?```/g, '').replace(/\[.*?\]/g, '').replace(/[*_#`]/g, '').trim();
            if (!cleanText) return;

            let utterance = new SpeechSynthesisUtterance(cleanText.substring(0, 800));
            utterance.lang = 'ca-ES';
            utterance.rate = 1.0;
            utterance.pitch = 1.0;
            
            let voices = window.speechSynthesis.getVoices();
            let caVoice = voices.find(v => v.lang.includes('ca') || v.lang.includes('es'));
            if (caVoice) utterance.voice = caVoice;

            utterance.onstart = function() {
                const wave = document.getElementById('voice-speak-wave-svg');
                const bars = document.getElementById('voice-speak-wave-bars');
                if (wave) wave.classList.remove('hidden');
                if (bars) bars.classList.remove('hidden');
            };

            utterance.onend = function() {
                const wave = document.getElementById('voice-speak-wave-svg');
                const bars = document.getElementById('voice-speak-wave-bars');
                if (wave) wave.classList.add('hidden');
                if (bars) bars.classList.add('hidden');
            };

            utterance.onerror = function() {
                const wave = document.getElementById('voice-speak-wave-svg');
                const bars = document.getElementById('voice-speak-wave-bars');
                if (wave) wave.classList.add('hidden');
                if (bars) bars.classList.add('hidden');
            };

            window.speechSynthesis.speak(utterance);
            showToast('🔊 Escoltant explicació...');
        };

        let micMediaRecorder = null;
        let micAudioChunks = [];
        let isMicRecording = false;

        window.toggleVoiceDictation = async function() {
            const input = document.getElementById('chat-input');
            const pulse = document.getElementById('mic-pulse');
            const btn = document.getElementById('mic-btn');

            if (isMicRecording) {
                if (micMediaRecorder && micMediaRecorder.state !== 'inactive') {
                    micMediaRecorder.stop();
                }
                isMicRecording = false;
                if (pulse) pulse.classList.add('hidden');
                if (btn) btn.classList.remove('text-red-500', 'animate-pulse');
                showToast('🎤 Gravació finalitzada. Transcribint amb gemini-3.5-transcribe...', 'info');
                return;
            }

            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    micAudioChunks = [];
                    micMediaRecorder = new MediaRecorder(stream);

                    micMediaRecorder.ondataavailable = (e) => {
                        if (e.data && e.data.size > 0) micAudioChunks.push(e.data);
                    };

                    micMediaRecorder.onstop = async () => {
                        stream.getTracks().forEach(track => track.stop());
                        if (micAudioChunks.length === 0) return;

                        const audioBlob = new Blob(micAudioChunks, { type: micMediaRecorder.mimeType || 'audio/webm' });
                        const reader = new FileReader();
                        reader.onloadend = async () => {
                            const base64 = reader.result;
                            showToast('⚡ Transcribint veu amb gemini-3.5-transcribe...', 'info');
                            try {
                                const res = await callGenerateApi({
                                    action: 'transcribe_audio',
                                    audioBase64: base64,
                                    mimeType: audioBlob.type || 'audio/webm'
                                });
                                const data = await res.json();
                                if (data.error) throw new Error(data.error);
                                const text = data.transcription || '';
                                if (text.trim() && input) {
                                    input.value = (input.value ? input.value + " " : "") + text.trim();
                                    input.style.height = 'auto';
                                    input.style.height = Math.min(input.scrollHeight, 150) + 'px';
                                    showToast('✨ Dictat afegit (gemini-3.5-transcribe)', 'success');
                                }
                            } catch (err) {
                                showToast('Error transcripció: ' + err.message, 'error');
                            }
                        };
                        reader.readAsDataURL(audioBlob);
                    };

                    micMediaRecorder.start();
                    isMicRecording = true;
                    if (pulse) pulse.classList.remove('hidden');
                    if (btn) btn.classList.add('text-red-500', 'animate-pulse');
                    showToast('🎤 Parla ara... Gravant veu per a gemini-3.5-transcribe!');
                    return;
                } catch (err) {
                    console.warn("getUserMedia error, falling back to WebSpeech:", err);
                }
            }

            // Fallback WebSpeech
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) {
                showToast('⚠️ El teu navegador no suporta reconeixement de veu ni gravació.', 'error');
                return;
            }

            speechRecognitionObj = new SpeechRecognition();
            speechRecognitionObj.lang = 'ca-ES';
            speechRecognitionObj.continuous = false;
            speechRecognitionObj.interimResults = false;

            speechRecognitionObj.onstart = function() {
                isVoiceRecording = true;
                if(pulse) pulse.classList.remove('hidden');
                showToast('🎤 Parla ara... Estic escoltant!');
            };

            speechRecognitionObj.onresult = function(event) {
                const transcript = event.results[0][0].transcript;
                if (input) {
                    input.value = (input.value ? input.value + " " : "") + transcript;
                    input.style.height = 'auto';
                    input.style.height = Math.min(input.scrollHeight, 150) + 'px';
                }
            };

            speechRecognitionObj.onerror = function(err) {
                isVoiceRecording = false;
                if(pulse) pulse.classList.add('hidden');
                showToast('⚠️ Error de veu: ' + err.error, 'error');
            };

            speechRecognitionObj.onend = function() {
                isVoiceRecording = false;
                if(pulse) pulse.classList.add('hidden');
            };

            speechRecognitionObj.start();
        };

        // Helper per escapar HTML de forma segura
        function escapeHtml(str) {
            if (!str || typeof str !== 'string') return '';
            return str
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        // ==============================================
        // CONTROLLER DE TRUCADA DE VEU EN DIRECTE AMB IA
        // ==============================================
        let isVoiceCallActive = false;
        let voiceCallRecognition = null;
        let isVoiceCallMicMuted = false;
        let isVoiceCallSpeakerMuted = false;
        let voiceCallTimerInterval = null;
        let voiceCallSeconds = 0;
        let isVoiceCallAiProcessing = false;
        let isVoiceCallAiSpeaking = false;
        let isVoiceCallMicPermissionDenied = false;
        let voiceCallCurrentInterimBubble = null;
        let voiceCallSelectedLang = localStorage.getItem('aliat_selected_voice_lang') || 'ca-ES';
        let voiceCallSelectedVoiceURI = localStorage.getItem('aliat_selected_voice_uri') || '';
        let voiceAudioContext = null;
        let voiceAudioAnalyser = null;
        let voiceAudioAnimFrame = null;
        let voiceCallActiveStream = null;
        let voiceCallSilenceTimer = null;
        let voiceCallLastUserText = '';
        let voiceCallHistory = [];

        window.triggerVoiceCallSend = function() {
            if (isVoiceCallAiProcessing || isVoiceCallAiSpeaking) return;
            if (voiceCallLastUserText && voiceCallLastUserText.trim()) {
                let textToSend = voiceCallLastUserText.trim();
                voiceCallLastUserText = '';
                if (voiceCallSilenceTimer) { clearTimeout(voiceCallSilenceTimer); voiceCallSilenceTimer = null; }
                if (voiceCallCurrentInterimBubble) {
                    voiceCallCurrentInterimBubble.remove();
                    voiceCallCurrentInterimBubble = null;
                }
                appendVoiceCallTranscriptMessage('Tu', textToSend, 'user');
                processVoiceCallUserUtterance(textToSend);
            } else {
                const input = document.getElementById('voice-call-text-input');
                if (input && input.value.trim()) {
                    submitVoiceCallText();
                } else {
                    showToast('🎙️ Escoltant... Parla de qualsevol cosa!', 'info');
                }
            }
        };

        // --- GESTIÓ DE VEU I IDIOMA (POPUP CONFIGURACIÓ) ---
        window.openVoiceCallSettingsModal = function() {
            const sheet = document.getElementById('voice-call-settings-sheet');
            if (!sheet) return;
            updateVoiceLangButtonsUI();
            populateVoiceSelect();
            sheet.classList.remove('hidden');
        };

        window.closeVoiceCallSettingsModal = function() {
            const sheet = document.getElementById('voice-call-settings-sheet');
            if (sheet) sheet.classList.add('hidden');
        };

        window.selectVoiceCallLanguage = function(lang) {
            voiceCallSelectedLang = lang;
            localStorage.setItem('aliat_selected_voice_lang', lang);
            voiceCallSelectedVoiceURI = ''; // Resetejar per agafar la millor veu del nou idioma
            localStorage.removeItem('aliat_selected_voice_uri');

            updateVoiceLangButtonsUI();
            populateVoiceSelect();

            if (voiceCallRecognition && isVoiceCallActive) {
                try {
                    voiceCallRecognition.stop();
                } catch(e){}
                startVoiceCallRecognition();
            }

            const langLabel = lang === 'ca-ES' ? 'Català' : (lang === 'es-ES' ? 'Español' : 'English');
            showToast(`🌐 Idioma de veu: ${langLabel}`);
        };

        function updateVoiceLangButtonsUI() {
            const btnCa = document.getElementById('voice-sheet-lang-ca');
            const btnEs = document.getElementById('voice-sheet-lang-es');
            const btnEn = document.getElementById('voice-sheet-lang-en');

            const activeCls = "py-2 px-3 rounded-xl border border-indigo-500 bg-indigo-600/30 text-indigo-200 font-bold text-xs text-center transition cursor-pointer";
            const inactiveCls = "py-2 px-3 rounded-xl border border-zinc-700 bg-zinc-800/80 text-zinc-300 hover:text-white font-medium text-xs text-center transition cursor-pointer";

            if (btnCa) btnCa.className = (voiceCallSelectedLang === 'ca-ES') ? activeCls : inactiveCls;
            if (btnEs) btnEs.className = (voiceCallSelectedLang === 'es-ES') ? activeCls : inactiveCls;
            if (btnEn) btnEn.className = (voiceCallSelectedLang === 'en-US') ? activeCls : inactiveCls;
        }

        window.populateVoiceSelect = function() {
            const select = document.getElementById('voice-call-voice-select');
            if (!select || !('speechSynthesis' in window)) return;

            const voices = window.speechSynthesis.getVoices();
            if (!voices || voices.length === 0) {
                select.innerHTML = '<option value="">Veus per defecte del navegador</option>';
                return;
            }

            const currentVoice = getBestAvailableVoice();
            const currentPrefix = (voiceCallSelectedLang || 'ca-ES').substring(0, 2).toLowerCase();

            const primaryVoices = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith(currentPrefix));
            const spanishFallback = currentPrefix === 'ca' ? voices.filter(v => v.lang && v.lang.toLowerCase().startsWith('es')) : [];
            const otherVoices = voices.filter(v => !primaryVoices.includes(v) && !spanishFallback.includes(v));

            let html = '';
            if (primaryVoices.length > 0) {
                html += `<optgroup label="Recomanades (${voiceCallSelectedLang})">`;
                primaryVoices.forEach(v => {
                    const isSel = currentVoice && (v.voiceURI === currentVoice.voiceURI || v.name === currentVoice.name);
                    html += `<option value="${escapeHtml(v.voiceURI || v.name)}" ${isSel ? 'selected' : ''}>${escapeHtml(v.name)} (${v.lang})</option>`;
                });
                html += `</optgroup>`;
            } else if (currentPrefix === 'ca') {
                html += `<optgroup label="Veus compatibles en Català / Fonètica">`;
                spanishFallback.forEach(v => {
                    const isSel = currentVoice && (v.voiceURI === currentVoice.voiceURI || v.name === currentVoice.name);
                    html += `<option value="${escapeHtml(v.voiceURI || v.name)}" ${isSel ? 'selected' : ''}>${escapeHtml(v.name)} (Compatible Català)</option>`;
                });
                html += `</optgroup>`;
            }

            if (otherVoices.length > 0) {
                html += `<optgroup label="Altres veus disponibles">`;
                otherVoices.slice(0, 15).forEach(v => {
                    const isSel = currentVoice && (v.voiceURI === currentVoice.voiceURI || v.name === currentVoice.name);
                    html += `<option value="${escapeHtml(v.voiceURI || v.name)}" ${isSel ? 'selected' : ''}>${escapeHtml(v.name)} (${v.lang})</option>`;
                });
                html += `</optgroup>`;
            }

            select.innerHTML = html;
        };

        window.changeVoiceCallVoice = function(voiceURI) {
            voiceCallSelectedVoiceURI = voiceURI;
            localStorage.setItem('aliat_selected_voice_uri', voiceURI);
            showToast("Veu de la IA actualitzada");
        };

        window.testCurrentVoice = function() {
            let testMsg = "Hola! Sóc l'Aliat Intel·ligent, parlem amb total naturalitat en català.";
            if (voiceCallSelectedLang === 'es-ES') {
                testMsg = "¡Hola! Soy tu Aliat Inteligente, hablamos con total naturalidad en español.";
            } else if (voiceCallSelectedLang === 'en-US') {
                testMsg = "Hello! I am your AI Ally, speaking naturally with you.";
            }
            speakVoiceCallResponse(testMsg);
        };

        window.toggleVoiceCallTranscript = function() {
            const sheet = document.getElementById('voice-call-transcript-sheet');
            const btn = document.getElementById('voice-call-transcript-btn');
            if (!sheet) return;

            const isHidden = sheet.classList.contains('hidden');
            if (isHidden) {
                sheet.classList.remove('hidden');
                if (btn) {
                    btn.classList.add('border-cyan-400', 'text-cyan-300', 'bg-zinc-700');
                    btn.classList.remove('border-zinc-700/80', 'text-cyan-400', 'bg-zinc-800/90');
                }
                const box = document.getElementById('voice-call-transcript');
                if (box) box.scrollTop = box.scrollHeight;
            } else {
                sheet.classList.add('hidden');
                if (btn) {
                    btn.classList.remove('border-cyan-400', 'text-cyan-300', 'bg-zinc-700');
                    btn.classList.add('border-zinc-700/80', 'text-cyan-400', 'bg-zinc-800/90');
                }
            }
        };

        function getBestAvailableVoice() {
            if (!('speechSynthesis' in window)) return null;
            const voices = window.speechSynthesis.getVoices();
            if (!voices || voices.length === 0) return null;

            if (voiceCallSelectedVoiceURI) {
                const picked = voices.find(v => v.voiceURI === voiceCallSelectedVoiceURI || v.name === voiceCallSelectedVoiceURI);
                if (picked) return picked;
            }

            const langCode = (voiceCallSelectedLang || 'ca-ES').toLowerCase();

            if (langCode.startsWith('ca')) {
                const catalanVoice = voices.find(v => (v.lang && v.lang.toLowerCase().startsWith('ca')) ||
                                                      (v.name && /catal[aà]|valenci[aà]|montse|jordi|pau/i.test(v.name)));
                if (catalanVoice) return catalanVoice;

                const spanishFallback = voices.find(v => (v.lang && v.lang.toLowerCase().startsWith('es')) ||
                                                         (v.name && /spanish|español|castellano/i.test(v.name)));
                if (spanishFallback) return spanishFallback;
            } else if (langCode.startsWith('es')) {
                const spanishVoice = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('es'));
                if (spanishVoice) return spanishVoice;
            } else if (langCode.startsWith('en')) {
                const englishVoice = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('en'));
                if (englishVoice) return englishVoice;
            }

            return voices.find(v => v.lang && v.lang.toLowerCase().startsWith(langCode.substring(0, 2))) || voices[0];
        }

        if ('speechSynthesis' in window) {
            window.speechSynthesis.onvoiceschanged = () => {
                populateVoiceSelect();
            };
        }

        function setupVoiceCallAudioMeter(stream) {
            try {
                if (voiceAudioAnimFrame) {
                    cancelAnimationFrame(voiceAudioAnimFrame);
                    voiceAudioAnimFrame = null;
                }
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtx) return;
                if (!voiceAudioContext || voiceAudioContext.state === 'closed') {
                    voiceAudioContext = new AudioCtx();
                }
                if (voiceAudioContext.state === 'suspended') {
                    voiceAudioContext.resume();
                }

                const source = voiceAudioContext.createMediaStreamSource(stream);
                voiceAudioAnalyser = voiceAudioContext.createAnalyser();
                voiceAudioAnalyser.fftSize = 64;
                source.connect(voiceAudioAnalyser);

                const dataArray = new Uint8Array(voiceAudioAnalyser.frequencyBinCount);
                const updateVolume = () => {
                    if (!isVoiceCallActive) return;
                    voiceAudioAnalyser.getByteFrequencyData(dataArray);
                    let sum = 0;
                    for (let i = 0; i < dataArray.length; i++) {
                        sum += dataArray[i];
                    }
                    const average = sum / dataArray.length;

                    const orb = document.getElementById('voice-call-orb');
                    const ring1 = document.getElementById('voice-call-ring1');
                    const ring2 = document.getElementById('voice-call-ring2');
                    const statusText = document.getElementById('voice-call-status-text');

                    if (orb && !isVoiceCallAiSpeaking && !isVoiceCallAiProcessing && !isVoiceCallMicMuted && !isVoiceCallMicPermissionDenied) {
                        if (average > 10) {
                            const scale = 1 + Math.min(average / 160, 0.35);
                            orb.style.transform = `scale(${scale})`;
                            if (ring1) ring1.style.transform = `scale(${scale + 0.15})`;
                            if (ring2) ring2.style.transform = `scale(${scale + 0.25})`;
                            if (statusText && !statusText.innerText.includes('parlant')) {
                                statusText.innerText = "Escoltant la teva veu...";
                            }
                        } else {
                            orb.style.transform = 'scale(1)';
                            if (ring1) ring1.style.transform = 'scale(1)';
                            if (ring2) ring2.style.transform = 'scale(1)';
                            if (statusText && statusText.innerText.includes('la teva veu')) {
                                statusText.innerText = "Escoltant...";
                            }
                        }
                    }
                    voiceAudioAnimFrame = requestAnimationFrame(updateVolume);
                };
                updateVolume();
            } catch(e) {
                console.log("Audio meter init error:", e);
            }
        }

        window.submitVoiceCallText = function() {
            const input = document.getElementById('voice-call-text-input');
            if (!input || !input.value.trim()) return;
            const text = input.value.trim();
            input.value = '';
            appendVoiceCallTranscriptMessage('Tu', text, 'user');
            processVoiceCallUserUtterance(text);
        };

        window.requestVoiceCallMicPermission = async function() {
            try {
                if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    voiceCallActiveStream = stream;
                    setupVoiceCallAudioMeter(stream);
                    isVoiceCallMicPermissionDenied = false;
                    const banner = document.getElementById('voice-call-permission-banner');
                    if (banner) banner.classList.add('hidden');
                    showToast('Permís de micròfon concedit!');
                    startVoiceCallRecognition();
                } else {
                    throw new Error("getUserMedia not supported");
                }
            } catch(err) {
                console.log("Mic permission status info:", err ? err.name || err : "denied");
                isVoiceCallMicPermissionDenied = true;
                setVoiceCallOrbState('permission_denied');
            }
        };

        window.openVoiceCallModal = async function() {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) {
                showToast('⚠️ El teu navegador no suporta reconeixement de veu en directe. Utilitza Chrome, Edge o Safari.', 'error');
                return;
            }

            const modal = document.getElementById('voice-call-modal');
            if (!modal) return;

            if ('speechSynthesis' in window) {
                try {
                    window.speechSynthesis.cancel();
                    window.speechSynthesis.resume();
                } catch(e){}
            }
            if (speechRecognitionObj) { try { speechRecognitionObj.stop(); } catch(e){} }

            isVoiceCallActive = true;
            isVoiceCallMicMuted = false;
            isVoiceCallSpeakerMuted = false;
            isVoiceCallAiProcessing = false;
            isVoiceCallAiSpeaking = false;
            isVoiceCallMicPermissionDenied = false;
            voiceCallCurrentInterimBubble = null;
            voiceCallHistory = [];

            modal.classList.remove('hidden');
            requestAnimationFrame(() => {
                modal.classList.remove('opacity-0');
            });

            // Demanar flux de micròfon per l'analitzador visual
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    voiceCallActiveStream = stream;
                    setupVoiceCallAudioMeter(stream);
                } catch(err) {
                    console.log("Mic initial prompt error:", err);
                    isVoiceCallMicPermissionDenied = true;
                    setVoiceCallOrbState('permission_denied');
                }
            }

            voiceCallSeconds = 0;
            updateVoiceCallTimerUI();
            if (voiceCallTimerInterval) clearInterval(voiceCallTimerInterval);
            voiceCallTimerInterval = setInterval(() => {
                voiceCallSeconds++;
                updateVoiceCallTimerUI();
            }, 1000);

            // Salutació inicial càlida, humana i directa segons l'idioma seleccionat
            let greeting = "Hola! Sóc l'Aliat. T'estic escoltant en directe. Com et va el dia? De què et ve de gust parlar?";
            if (voiceCallSelectedLang === 'es-ES') {
                greeting = "¡Hola! Soy Aliat. Te escucho en directo, ¿de qué te apetece hablar hoy?";
            } else if (voiceCallSelectedLang === 'en-US') {
                greeting = "Hello! I'm Aliat. I'm listening live, what would you like to talk about today?";
            }

            const transcriptBox = document.getElementById('voice-call-transcript');
            if (transcriptBox) {
                transcriptBox.innerHTML = `
                    <div class="w-full max-w-xl mx-auto flex items-center justify-center gap-2 text-emerald-300 bg-emerald-950/60 border border-emerald-500/30 p-2.5 rounded-xl font-medium animate-fadeIn text-center">
                        <span class="font-bold text-emerald-400 shrink-0">Aliat:</span>
                        <span>${escapeHtml(greeting)}</span>
                    </div>
                `;
            }

            speakVoiceCallResponse(greeting);
            startVoiceCallRecognition();
            updateVoiceCallControlsUI();
            populateVoiceSelect();
        };

        function updateVoiceCallTimerUI() {
            const el = document.getElementById('voice-call-timer');
            if (!el) return;
            const mins = Math.floor(voiceCallSeconds / 60).toString().padStart(2, '0');
            const secs = (voiceCallSeconds % 60).toString().padStart(2, '0');
            el.innerText = `${mins}:${secs}`;
        }

        function setVoiceCallOrbState(state) {
            const orb = document.getElementById('voice-call-orb');
            const statusPill = document.getElementById('voice-call-status-pill');
            const statusText = document.getElementById('voice-call-status-text');
            const ring1 = document.getElementById('voice-call-ring1');
            const ring2 = document.getElementById('voice-call-ring2');
            const banner = document.getElementById('voice-call-permission-banner');

            if (!orb || !statusText) return;

            if (banner) {
                if (state === 'permission_denied') banner.classList.remove('hidden');
                else banner.classList.add('hidden');
            }

            if (state === 'listening') {
                orb.className = "w-36 h-36 md:w-44 md:h-44 rounded-full bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-600 shadow-[0_0_70px_rgba(6,182,212,0.65)] flex items-center justify-center transition-all duration-500 scale-100 relative overflow-hidden mx-auto cursor-pointer hover:scale-105 active:scale-95";
                orb.onclick = window.triggerVoiceCallSend;
                statusText.innerText = "Escoltant...";
                if (statusPill) statusPill.className = "inline-flex items-center justify-center gap-2.5 px-5 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs sm:text-sm font-semibold tracking-wide shadow-xs mx-auto";
                if (ring1) ring1.className = "absolute inset-0 rounded-full border-2 border-cyan-500/40 animate-ping opacity-75";
                if (ring2) ring2.className = "absolute -inset-4 rounded-full border border-blue-500/30 animate-pulse opacity-60";
            } else if (state === 'speaking') {
                orb.className = "w-36 h-36 md:w-44 md:h-44 rounded-full bg-gradient-to-tr from-emerald-400 via-teal-500 to-cyan-500 shadow-[0_0_80px_rgba(16,185,129,0.8)] flex items-center justify-center transition-all duration-500 scale-105 relative overflow-hidden animate-pulse mx-auto cursor-pointer";
                orb.onclick = null;
                statusText.innerText = "L'Aliat està parlant...";
                if (statusPill) statusPill.className = "inline-flex items-center justify-center gap-2.5 px-5 py-2 rounded-full bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 text-xs sm:text-sm font-semibold tracking-wide shadow-xs mx-auto";
                if (ring1) ring1.className = "absolute inset-0 rounded-full border-2 border-emerald-400/60 animate-ping opacity-90";
                if (ring2) ring2.className = "absolute -inset-4 rounded-full border border-teal-400/40 animate-pulse opacity-80";
            } else if (state === 'processing') {
                orb.className = "w-36 h-36 md:w-44 md:h-44 rounded-full bg-gradient-to-tr from-purple-600 via-indigo-600 to-blue-600 shadow-[0_0_60px_rgba(147,51,234,0.7)] flex items-center justify-center transition-all duration-500 scale-95 relative overflow-hidden animate-spin duration-3000 mx-auto cursor-pointer";
                orb.onclick = null;
                statusText.innerText = "Pensant...";
                if (statusPill) statusPill.className = "inline-flex items-center justify-center gap-2.5 px-5 py-2 rounded-full bg-purple-500/20 border border-purple-500/40 text-purple-300 text-xs sm:text-sm font-semibold tracking-wide shadow-xs mx-auto";
                if (ring1) ring1.className = "absolute inset-0 rounded-full border-2 border-purple-500/50 animate-ping opacity-50";
                if (ring2) ring2.className = "absolute -inset-4 rounded-full border border-indigo-500/40 animate-pulse opacity-50";
            } else if (state === 'muted') {
                orb.className = "w-36 h-36 md:w-44 md:h-44 rounded-full bg-gradient-to-tr from-zinc-700 via-zinc-800 to-zinc-900 shadow-none flex items-center justify-center transition-all duration-500 scale-90 relative overflow-hidden mx-auto cursor-pointer";
                orb.onclick = null;
                statusText.innerText = "Micròfon Silenciat";
                if (statusPill) statusPill.className = "inline-flex items-center justify-center gap-2.5 px-5 py-2 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400 text-xs sm:text-sm font-semibold tracking-wide shadow-xs mx-auto";
                if (ring1) ring1.className = "hidden";
                if (ring2) ring2.className = "hidden";
            } else if (state === 'permission_denied') {
                orb.className = "w-36 h-36 md:w-44 md:h-44 rounded-full bg-gradient-to-tr from-amber-600 via-red-600 to-rose-700 shadow-[0_0_60px_rgba(239,68,68,0.6)] flex items-center justify-center transition-all duration-500 scale-100 relative overflow-hidden mx-auto cursor-pointer hover:scale-105";
                orb.onclick = requestVoiceCallMicPermission;
                statusText.innerText = "Falta permís de micròfon (Clica per activar)";
                if (statusPill) statusPill.className = "inline-flex items-center justify-center gap-2.5 px-5 py-2 rounded-full bg-amber-500/20 border border-amber-500/50 text-amber-300 text-xs sm:text-sm font-semibold tracking-wide shadow-xs mx-auto cursor-pointer";
                if (ring1) ring1.className = "hidden";
                if (ring2) ring2.className = "hidden";
            }
        }

        function startVoiceCallRecognition() {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition || !isVoiceCallActive) return;

            try {
                if (voiceCallRecognition) {
                    voiceCallRecognition.onend = null;
                    voiceCallRecognition.onerror = null;
                    voiceCallRecognition.stop();
                }
            } catch(e){}

            if (isVoiceCallMicMuted) {
                setVoiceCallOrbState('muted');
                return;
            }

            if (isVoiceCallMicPermissionDenied) {
                setVoiceCallOrbState('permission_denied');
                return;
            }

            voiceCallRecognition = new SpeechRecognition();
            voiceCallRecognition.lang = voiceCallSelectedLang || 'ca-ES';
            voiceCallRecognition.continuous = true;
            voiceCallRecognition.interimResults = true;
            voiceCallLastUserText = '';

            voiceCallRecognition.onstart = function() {
                if (!isVoiceCallAiSpeaking && !isVoiceCallAiProcessing) {
                    setVoiceCallOrbState('listening');
                }
            };

            voiceCallRecognition.onresult = function(event) {
                if (isVoiceCallAiSpeaking || isVoiceCallAiProcessing) return;

                const transcriptBox = document.getElementById('voice-call-transcript');
                let interimTranscript = '';
                let finalTranscript = '';

                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        finalTranscript += event.results[i][0].transcript;
                    } else {
                        interimTranscript += event.results[i][0].transcript;
                    }
                }

                let currentSpeech = (finalTranscript + ' ' + interimTranscript).trim();
                if (!currentSpeech) return;

                voiceCallLastUserText = currentSpeech;

                if (transcriptBox) {
                    if (!voiceCallCurrentInterimBubble) {
                        voiceCallCurrentInterimBubble = document.createElement('div');
                        voiceCallCurrentInterimBubble.className = "w-full max-w-xl mx-auto flex items-center justify-center gap-2 text-cyan-300 bg-cyan-950/40 border border-cyan-500/30 p-2.5 rounded-xl transition-all text-center";
                        transcriptBox.appendChild(voiceCallCurrentInterimBubble);
                    }
                    voiceCallCurrentInterimBubble.innerHTML = `<span class="font-bold text-cyan-400 shrink-0">Tu:</span> <span>${escapeHtml(currentSpeech)}...</span>`;
                    transcriptBox.scrollTop = transcriptBox.scrollHeight;
                }

                if (voiceCallSilenceTimer) clearTimeout(voiceCallSilenceTimer);
                voiceCallSilenceTimer = setTimeout(() => {
                    if (voiceCallLastUserText.trim() && isVoiceCallActive && !isVoiceCallAiProcessing && !isVoiceCallAiSpeaking) {
                        let textToSend = voiceCallLastUserText.trim();
                        voiceCallLastUserText = '';
                        if (voiceCallSilenceTimer) { clearTimeout(voiceCallSilenceTimer); voiceCallSilenceTimer = null; }
                        if (voiceCallCurrentInterimBubble) {
                            voiceCallCurrentInterimBubble.remove();
                            voiceCallCurrentInterimBubble = null;
                        }
                        appendVoiceCallTranscriptMessage('Tu', textToSend, 'user');
                        processVoiceCallUserUtterance(textToSend);
                    }
                }, 1600);
            };

            voiceCallRecognition.onerror = function(e) {
                console.log("Voice Call recognition error:", e.error);
                if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
                    isVoiceCallMicPermissionDenied = true;
                    setVoiceCallOrbState('permission_denied');
                } else if (e.error === 'language-not-supported' && voiceCallSelectedLang === 'ca-ES') {
                    console.log("Catalan speech recognition not supported natively in browser, falling back to Spanish es-ES");
                    voiceCallSelectedLang = 'es-ES';
                    startVoiceCallRecognition();
                }
            };

            voiceCallRecognition.onend = function() {
                if (isVoiceCallActive && !isVoiceCallMicPermissionDenied && !isVoiceCallMicMuted && !isVoiceCallAiSpeaking && !isVoiceCallAiProcessing) {
                    setTimeout(() => {
                        try { voiceCallRecognition.start(); } catch(err){}
                    }, 300);
                }
            };

            try {
                voiceCallRecognition.start();
            } catch(e){}
        }

        function appendVoiceCallTranscriptMessage(sender, text, type) {
            const transcriptBox = document.getElementById('voice-call-transcript');
            if (!transcriptBox) return;

            const div = document.createElement('div');
            if (type === 'user') {
                div.className = "w-full max-w-xl mx-auto flex items-center justify-center gap-2 text-cyan-200 bg-cyan-950/60 border border-cyan-500/30 p-2.5 rounded-xl font-medium animate-fadeIn text-center";
                div.innerHTML = `<span class="font-bold text-cyan-400 shrink-0">Tu:</span> <span>${escapeHtml(text)}</span>`;
            } else {
                div.className = "w-full max-w-xl mx-auto flex items-center justify-center gap-2 text-emerald-300 bg-emerald-950/60 border border-emerald-500/30 p-2.5 rounded-xl font-medium animate-fadeIn text-center";
                div.innerHTML = `<span class="font-bold text-emerald-400 shrink-0">Aliat:</span> <span>${escapeHtml(text)}</span>`;
            }

            transcriptBox.appendChild(div);
            transcriptBox.scrollTop = transcriptBox.scrollHeight;
        }

        async function processVoiceCallUserUtterance(userText) {
            if (voiceCallSilenceTimer) { clearTimeout(voiceCallSilenceTimer); voiceCallSilenceTimer = null; }
            isVoiceCallAiProcessing = true;
            setVoiceCallOrbState('processing');

            if (voiceCallRecognition) {
                try { voiceCallRecognition.stop(); } catch(e){}
            }

            try {
                if (!Array.isArray(voiceCallHistory)) voiceCallHistory = [];
                voiceCallHistory.push({ role: 'user', content: userText });

                const isStudy = (typeof appMode !== 'undefined' && appMode === 'study');
                const actionType = isStudy ? 'chat' : 'free_chat';
                const langLabel = (voiceCallSelectedLang === 'es-ES' ? 'castellà' : (voiceCallSelectedLang === 'en-US' ? 'anglès' : 'català'));

                const res = await callGenerateApi({
                    action: actionType,
                    chatHistory: voiceCallHistory,
                    pdfText: (typeof finalStudyText !== 'undefined') ? finalStudyText : '',
                    studentContext: (typeof studentContext !== 'undefined') ? studentContext : '',
                    tutorMode: (typeof currentTutorMode !== 'undefined') ? currentTutorMode : 'standard',
                    isVoiceCall: true,
                    callLanguage: langLabel
                });

                const data = await res.json();
                if (data.error) throw new Error(data.error);

                const aiReply = data.reply || (voiceCallSelectedLang === 'es-ES' ? "Disculpa, ¿puedes repetirlo?" : (voiceCallSelectedLang === 'en-US' ? "Pardon, could you repeat that?" : "Disculpa, pots repetir-m'ho?"));

                voiceCallHistory.push({ role: 'assistant', content: aiReply });
                appendVoiceCallTranscriptMessage('Aliat', aiReply, 'ai');

                isVoiceCallAiProcessing = false;
                speakVoiceCallResponse(aiReply);

            } catch(err) {
                console.error("Error processing voice call utterance:", err);
                isVoiceCallAiProcessing = false;
                const errFallback = (voiceCallSelectedLang === 'es-ES' ? "Perdona, se ha cortado la conexión. ¿Me escuchas?" : (voiceCallSelectedLang === 'en-US' ? "Sorry, connection dropped for a moment. Can you hear me?" : "Perdona, s'ha tallat un moment la connexió. Em sents bé?"));
                appendVoiceCallTranscriptMessage('Aliat', errFallback, 'ai');
                setVoiceCallOrbState('listening');
                startVoiceCallRecognition();
            }
        }

        function speakVoiceCallResponse(text) {
            if (!('speechSynthesis' in window)) {
                setVoiceCallOrbState('listening');
                startVoiceCallRecognition();
                return;
            }

            if (isVoiceCallSpeakerMuted) {
                setVoiceCallOrbState('listening');
                startVoiceCallRecognition();
                return;
            }

            try {
                window.speechSynthesis.cancel();
                window.speechSynthesis.resume();
            } catch(e){}

            let cleanText = text.replace(/```[\s\S]*?```/g, '').replace(/\[.*?\]/g, '').replace(/[*_#`]/g, '').trim();
            if (!cleanText) {
                setVoiceCallOrbState('listening');
                startVoiceCallRecognition();
                return;
            }

            let utterance = new SpeechSynthesisUtterance(cleanText.substring(0, 800));
            utterance.rate = 1.0;
            utterance.pitch = 1.0;

            let bestVoice = getBestAvailableVoice();
            if (bestVoice) {
                utterance.voice = bestVoice;
                utterance.lang = bestVoice.lang;
            } else {
                utterance.lang = voiceCallSelectedLang || 'ca-ES';
            }

            utterance.onstart = function() {
                isVoiceCallAiSpeaking = true;
                setVoiceCallOrbState('speaking');
            };

            utterance.onend = function() {
                isVoiceCallAiSpeaking = false;
                if (isVoiceCallActive) {
                    setVoiceCallOrbState('listening');
                    startVoiceCallRecognition();
                }
            };

            utterance.onerror = function(err) {
                console.log("Speech synthesis error:", err);
                isVoiceCallAiSpeaking = false;
                if (isVoiceCallActive) {
                    setVoiceCallOrbState('listening');
                    startVoiceCallRecognition();
                }
            };

            setTimeout(() => {
                try {
                    window.speechSynthesis.resume();
                    window.speechSynthesis.speak(utterance);
                } catch(e) {
                    console.error("Speak error:", e);
                    isVoiceCallAiSpeaking = false;
                    setVoiceCallOrbState('listening');
                    startVoiceCallRecognition();
                }
            }, 50);
        }

        window.toggleVoiceCallMic = function() {
            if (isVoiceCallMicPermissionDenied) {
                requestVoiceCallMicPermission();
                return;
            }
            isVoiceCallMicMuted = !isVoiceCallMicMuted;
            updateVoiceCallControlsUI();
            if (isVoiceCallMicMuted) {
                if (voiceCallRecognition) { try { voiceCallRecognition.stop(); } catch(e){} }
                setVoiceCallOrbState('muted');
                showToast('Micròfon silenciat');
            } else {
                setVoiceCallOrbState('listening');
                startVoiceCallRecognition();
                showToast('Micròfon activat');
            }
        };

        window.toggleVoiceCallSpeaker = function() {
            isVoiceCallSpeakerMuted = !isVoiceCallSpeakerMuted;
            updateVoiceCallControlsUI();
            if (isVoiceCallSpeakerMuted) {
                if ('speechSynthesis' in window) window.speechSynthesis.cancel();
                showToast('Altaveu silenciat');
            } else {
                showToast('Altaveu activat');
            }
        };

        function updateVoiceCallControlsUI() {
            const micBtn = document.getElementById('voice-call-mic-btn');
            const micIcon = document.getElementById('voice-call-mic-icon');
            const spkBtn = document.getElementById('voice-call-speaker-btn');

            if (micBtn) {
                if (isVoiceCallMicMuted) {
                    micBtn.className = "w-13 h-13 md:w-14 md:h-14 rounded-full bg-red-600/90 hover:bg-red-500 text-white flex flex-col items-center justify-center transition-all shadow-xl shadow-red-600/40 border border-red-400/40 active:scale-95 cursor-pointer shrink-0";
                    if (micIcon) micIcon.innerHTML = `<path d="m12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><line x1="2" y1="2" x2="22" y2="22"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>`;
                } else {
                    micBtn.className = "w-13 h-13 md:w-14 md:h-14 rounded-full bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-700/80 text-white flex flex-col items-center justify-center transition-all shadow-xl active:scale-95 cursor-pointer shrink-0";
                    if (micIcon) micIcon.innerHTML = `<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>`;
                }
            }

            if (spkBtn) {
                if (isVoiceCallSpeakerMuted) {
                    spkBtn.className = "w-13 h-13 md:w-14 md:h-14 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-500 flex items-center justify-center transition-all shadow-lg active:scale-95 cursor-pointer shrink-0";
                } else {
                    spkBtn.className = "w-13 h-13 md:w-14 md:h-14 rounded-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-emerald-400 flex items-center justify-center transition-all shadow-lg active:scale-95 cursor-pointer shrink-0";
                }
            }
        }

        function saveVoiceCallTranscriptToChat() {
            if (!Array.isArray(voiceCallHistory) || voiceCallHistory.length === 0) return;

            const callMessages = [...voiceCallHistory];
            voiceCallHistory = [];

            const isAlreadyInFreeChat = (typeof appMode !== 'undefined' && appMode === 'free') && 
                                        document.getElementById('chat-view') && 
                                        !document.getElementById('chat-view').classList.contains('hidden');

            if (isAlreadyInFreeChat) {
                const bannerDiv = document.createElement('div');
                bannerDiv.className = "flex justify-center w-full my-3";
                bannerDiv.innerHTML = `<span class="px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-semibold">🎙️ Transcripció de la Trucada de Veu</span>`;
                const box = document.getElementById('chat-messages');
                if (box) box.appendChild(bannerDiv);

                callMessages.forEach(msg => {
                    if (!msg || !msg.content) return;
                    const role = msg.role === 'user' ? 'user' : 'assistant';
                    chatHistory.push({ role, content: msg.content });
                    appendMessage(role === 'user' ? 'user' : 'ai', msg.content);
                });

                saveCurrentChatSession();
            } else {
                appMode = 'free';
                currentSessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
                chatHistory = [];

                document.getElementById('welcome-view')?.classList.add('hidden');
                document.getElementById('setup-view')?.classList.add('hidden');
                document.getElementById('setup-view')?.classList.remove('flex');
                document.getElementById('quiz-view')?.classList.add('hidden');

                document.getElementById('global-menu-btn')?.classList.add('hidden');
                document.getElementById('chat-view')?.classList.remove('hidden');
                document.getElementById('chat-view')?.classList.add('flex');
                document.getElementById('chat-form')?.classList.remove('hidden');

                updateHeaderButtonsVisibility();
                document.getElementById('chat-toolbar-bottom')?.classList.remove('hidden');

                const box = document.getElementById('chat-messages');
                if (box) {
                    box.innerHTML = '';
                    const bannerDiv = document.createElement('div');
                    bannerDiv.className = "flex justify-center w-full my-3";
                    bannerDiv.innerHTML = `<span class="px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-semibold">🎙️ Transcripció de la Trucada de Veu</span>`;
                    box.appendChild(bannerDiv);
                }

                callMessages.forEach(msg => {
                    if (!msg || !msg.content) return;
                    const role = msg.role === 'user' ? 'user' : 'assistant';
                    chatHistory.push({ role, content: msg.content });
                    appendMessage(role === 'user' ? 'user' : 'ai', msg.content);
                });

                const activeSession = {
                    id: currentSessionId,
                    mode: 'free',
                    history: chatHistory,
                    title: 'Trucada de Veu'
                };
                const smartTitle = generateSmartTitle(activeSession);
                document.getElementById('chat-mode-label').innerText = smartTitle;

                saveCurrentChatSession();
                renderSidebarHistory();
            }
        }

        window.endVoiceCall = function() {
            isVoiceCallActive = false;
            if (voiceCallTimerInterval) clearInterval(voiceCallTimerInterval);
            if ('speechSynthesis' in window) window.speechSynthesis.cancel();
            if (voiceCallRecognition) {
                try { voiceCallRecognition.stop(); } catch(e){}
            }
            if (voiceCallActiveStream) {
                try { voiceCallActiveStream.getTracks().forEach(t => t.stop()); } catch(e){}
                voiceCallActiveStream = null;
            }
            if (voiceAudioAnimFrame) {
                cancelAnimationFrame(voiceAudioAnimFrame);
                voiceAudioAnimFrame = null;
            }

            const modal = document.getElementById('voice-call-modal');
            if (modal) {
                modal.classList.add('opacity-0');
                setTimeout(() => {
                    modal.classList.add('hidden');
                }, 300);
            }

            if (Array.isArray(voiceCallHistory) && voiceCallHistory.length > 0) {
                saveVoiceCallTranscriptToChat();
                showToast('Trucada finalitzada. S\'ha desat la conversa al xat.');
            } else {
                showToast('Trucada finalitzada.');
            }
        };

        // --- MANEGADORS DEL MENÚ DE TRES PUNTS DE LA CONVERSA (MATCHING IMAGE) ---
        window.toggleChatHeaderMenu = function(event) {
            if (event) event.stopPropagation();
            const dropdown = document.getElementById('chat-header-menu-dropdown');
            if (!dropdown) return;
            const isHidden = dropdown.classList.contains('hidden');
            if (isHidden) {
                dropdown.classList.remove('hidden');
                requestAnimationFrame(() => {
                    dropdown.classList.remove('opacity-0', 'scale-95');
                    dropdown.classList.add('opacity-100', 'scale-100');
                });
            } else {
                closeChatHeaderMenu();
            }
        };

        window.closeChatHeaderMenu = function() {
            const dropdown = document.getElementById('chat-header-menu-dropdown');
            if (!dropdown || dropdown.classList.contains('hidden')) return;
            dropdown.classList.remove('opacity-100', 'scale-100');
            dropdown.classList.add('opacity-0', 'scale-95');
            setTimeout(() => {
                dropdown.classList.add('hidden');
            }, 200);
        };

        document.addEventListener('click', (e) => {
            const btn = document.getElementById('chat-header-menu-btn');
            const dropdown = document.getElementById('chat-header-menu-dropdown');
            if (dropdown && !dropdown.classList.contains('hidden') && !dropdown.contains(e.target) && (!btn || !btn.contains(e.target))) {
                closeChatHeaderMenu();
            }
        });

        window.handleHeaderMenuShare = async function() {
            closeChatHeaderMenu();
            if (!Array.isArray(chatHistory) || chatHistory.length === 0) {
                showToast('No hi ha missatges en aquest xat per compartir encara.', 'info');
                return;
            }

            const activeSession = allSessions.find(s => s.id === currentSessionId);
            const chatTitle = (activeSession && activeSession.title) || generateSmartTitle(activeSession);

            Swal.fire({
                title: 'Generant enllaç...',
                text: 'Creant còpia pública d\'aquesta conversa.',
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading()
            });

            try {
                const res = await fetch('/api/sessions/share', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: chatTitle,
                        history: chatHistory,
                        calendar: generatedCalendarArray || [],
                        initial_quiz: window.initialQuizResults || null,
                        date: Date.now()
                    })
                });

                const data = await res.json();
                if (!res.ok || data.error) throw new Error(data.error || 'Error al generar enllaç');

                const shareUrl = `${window.location.origin}/?share=${data.shareId}`;

                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(shareUrl).catch(() => {});
                }

                Swal.fire({
                    title: '<div class="flex items-center justify-center gap-2 text-indigo-500"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> Conversa Compartida!</div>',
                    html: `
                        <p class="text-xs sm:text-sm text-zinc-400 mb-3 text-center">Qualsevol persona amb aquest enllaç podrà veure el xat des d'aquest mateix moment:</p>
                        <div class="flex items-center gap-2 p-2 bg-zinc-900 border border-zinc-700 rounded-xl mb-4 text-left">
                            <input id="shared-link-input" type="text" readonly value="${shareUrl}" class="flex-1 bg-transparent text-xs text-indigo-300 font-mono outline-none px-2 select-all">
                            <button onclick="navigator.clipboard.writeText('${shareUrl}'); showToast('Enllaç copiat!');" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold transition shrink-0 cursor-pointer">Copiar</button>
                        </div>
                    `,
                    showCancelButton: true,
                    cancelButtonText: 'Tancar',
                    confirmButtonText: 'Compartir',
                    confirmButtonColor: '#4f46e5',
                    background: document.documentElement.classList.contains('dark') ? '#18181b' : '#fff',
                    color: document.documentElement.classList.contains('dark') ? '#f4f4f5' : '#18181b',
                    customClass: { popup: 'rounded-3xl border dark:border-zinc-800' }
                }).then((r) => {
                    if (r.isConfirmed) {
                        if (navigator.share) {
                            navigator.share({
                                title: chatTitle,
                                text: `Conversa d'estudi amb Aliat Intel·ligent: ${chatTitle}`,
                                url: shareUrl
                            }).catch(() => {});
                        } else {
                            navigator.clipboard.writeText(shareUrl);
                            showToast('Enllaç copiat al portapapers!');
                        }
                    }
                });

            } catch (err) {
                Swal.fire({
                    icon: 'error',
                    title: 'No s\'ha pogut compartir',
                    text: err.message,
                    confirmButtonColor: '#ef4444'
                });
            }
        };

        window.handleHeaderMenuFiles = function() {
            closeChatHeaderMenu();
            openChatFilesModal();
        };

        window.openChatFilesModal = function() {
            closeChatHeaderMenu();
            const modal = document.getElementById('chat-files-modal');
            const box = document.getElementById('chat-files-modal-box');
            const createdContainer = document.getElementById('chat-files-created-list');
            const addedContainer = document.getElementById('chat-files-added-list');
            if (!modal || !createdContainer || !addedContainer) return;

            const addedFiles = [];
            const createdItems = [];

            // 1. Resolve strictly the active session's data
            const activeSession = allSessions.find(s => s.id === currentSessionId);
            const activeHistory = (activeSession && Array.isArray(activeSession.history) && activeSession.history.length > 0)
                ? activeSession.history
                : (Array.isArray(chatHistory) ? chatHistory : []);

            // Check explicit files registered in this session
            if (activeSession && Array.isArray(activeSession.files)) {
                activeSession.files.forEach(f => {
                    if (f && (f.src || f.name) && !addedFiles.some(existing => existing.src === f.src)) {
                        addedFiles.push(f);
                    }
                });
            }

            // 2. Scan activeHistory for user-uploaded images and documents in this chat ONLY
            activeHistory.forEach((msg, idx) => {
                if (!msg) return;
                
                // Check direct image property
                if (msg.image && typeof msg.image === 'string') {
                    if (!addedFiles.some(f => f.src === msg.image)) {
                        let hash = (idx + 1).toString(16).padStart(2, '0') + Math.random().toString(16).substring(2, 6);
                        const fileType = (msg.fileExt || (msg.image.includes('data:image/jpeg') ? 'JPG' : 'PNG')).toUpperCase();
                        const fileName = msg.fileName || `image_${hash}`;
                        addedFiles.push({
                            id: 'img_' + idx,
                            name: fileName,
                            ext: fileType,
                            src: msg.image,
                            type: 'image'
                        });
                    }
                }
                
                // Check inline <img> tags in content HTML
                if (typeof msg.content === 'string') {
                    const imgMatches = msg.content.match(/<img[^>]+src=["']([^"']+)["']/gi);
                    if (imgMatches) {
                        imgMatches.forEach((match, mIdx) => {
                            const srcMatch = match.match(/src=["']([^"']+)["']/i);
                            if (srcMatch && srcMatch[1]) {
                                const imgSrc = srcMatch[1];
                                if (!addedFiles.some(f => f.src === imgSrc)) {
                                    const hash = `${(idx + 1).toString(16)}${mIdx.toString(16)}${Math.random().toString(16).substring(2, 5)}`;
                                    const fileType = imgSrc.includes('data:image/jpeg') ? 'JPG' : 'PNG';
                                    addedFiles.push({
                                        id: `img_${idx}_${mIdx}`,
                                        name: `image_${hash}`,
                                        ext: fileType,
                                        src: imgSrc,
                                        type: 'image'
                                    });
                                }
                            }
                        });
                    }

                    // AI created artifacts in this chat
                    if (msg.role === 'assistant' || msg.role === 'model') {
                        if (msg.content.includes('```html') || msg.content.includes('<svg')) {
                            createdItems.push({
                                name: `Esquema Visual #${createdItems.length + 1}`,
                                type: 'SVG / HTML',
                                icon: `<svg class="w-4 h-4 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`
                            });
                        } else if (msg.content.includes('```flashcards')) {
                            createdItems.push({
                                name: `Flashcards #${createdItems.length + 1}`,
                                type: 'ANKI JSON',
                                icon: `<svg class="w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`
                            });
                        }
                    }
                }
            });

            // Check active uploaded PDF document in this session
            const sessionPdf = (activeSession && activeSession.pdf_text) || (typeof finalStudyText !== 'undefined' ? finalStudyText : '');
            if (sessionPdf && sessionPdf.trim()) {
                const pdfName = (activeSession && activeSession.pdf_name) || 'apunts_estudi.pdf';
                if (!addedFiles.some(f => f.id === 'study_pdf')) {
                    addedFiles.push({
                        id: 'study_pdf',
                        name: pdfName,
                        ext: 'PDF',
                        src: null,
                        type: 'document',
                        size: `${(sessionPdf.length / 1024).toFixed(1)} KB`
                    });
                }
            }

            // Render "Creado" section matching screenshot
            if (createdItems.length === 0) {
                createdContainer.innerHTML = `
                    <div class="py-4 text-center text-zinc-400 font-normal text-xs sm:text-sm">
                        Todavía no has creado nada
                    </div>
                `;
            } else {
                createdContainer.innerHTML = createdItems.map(item => `
                    <div class="flex items-center gap-3 py-2 px-2 hover:bg-zinc-800/60 rounded-xl transition cursor-pointer">
                        <div class="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center shrink-0">
                            ${item.icon}
                        </div>
                        <div class="min-w-0 flex-1">
                            <p class="font-normal text-zinc-100 text-xs sm:text-sm tracking-tight truncate">${escapeHtml(item.name)}</p>
                            <p class="text-[11px] text-zinc-400 font-normal leading-tight">${escapeHtml(item.type)}</p>
                        </div>
                    </div>
                `).join('');
            }

            // Render "Añadido" section exactly matching user reference screenshot
            if (addedFiles.length === 0) {
                addedContainer.innerHTML = `
                    <div class="py-4 text-center text-zinc-400 font-normal text-xs sm:text-sm">
                        Todavía no has añadido nada
                    </div>
                `;
            } else {
                addedContainer.innerHTML = addedFiles.map(file => {
                    if (file.type === 'image') {
                        return `
                            <div onclick="closeChatFilesModal(); openLightbox('${file.src}');" class="flex items-center gap-3 py-2 px-1 hover:bg-zinc-800/60 rounded-xl transition cursor-pointer group">
                                <div class="w-8 h-8 rounded-lg bg-[#ef4444] text-white flex items-center justify-center shrink-0 shadow-sm">
                                    <svg class="w-4 h-4 fill-white" viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zm-5.04-6.71l-2.75 3.54-1.96-2.36L6.5 17h11l-3.54-4.71z"/></svg>
                                </div>
                                <div class="min-w-0 flex-1">
                                    <p class="font-normal text-zinc-100 text-xs sm:text-sm tracking-tight truncate">${escapeHtml(file.name)}</p>
                                    <p class="text-[11px] text-zinc-400 font-normal leading-tight">${escapeHtml(file.ext)}</p>
                                </div>
                            </div>
                        `;
                    } else {
                        return `
                            <div class="flex items-center gap-3 py-2 px-1 hover:bg-zinc-800/60 rounded-xl transition cursor-pointer group">
                                <div class="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                </div>
                                <div class="min-w-0 flex-1">
                                    <p class="font-normal text-zinc-100 text-xs sm:text-sm tracking-tight truncate">${escapeHtml(file.name)}</p>
                                    <p class="text-[11px] text-zinc-400 font-normal leading-tight">${escapeHtml(file.ext)}${file.size ? ` • ${file.size}` : ''}</p>
                                </div>
                            </div>
                        `;
                    }
                }).join('');
            }

            modal.classList.remove('hidden');
            requestAnimationFrame(() => {
                modal.classList.remove('opacity-0');
                if (box) {
                    box.classList.remove('translate-x-full');
                    box.classList.add('translate-x-0');
                }
            });
        };

        window.closeChatFilesModal = function() {
            const modal = document.getElementById('chat-files-modal');
            const box = document.getElementById('chat-files-modal-box');
            if (!modal) return;
            if (box) {
                box.classList.remove('translate-x-0');
                box.classList.add('translate-x-full');
            }
            modal.classList.add('opacity-0');
            setTimeout(() => {
                modal.classList.add('hidden');
            }, 300);
        };

        let isCurrentChatPinned = false;
        window.handleHeaderMenuPin = function() {
            closeChatHeaderMenu();
            let activeSession = allSessions.find(s => s.id === currentSessionId);
            if (!activeSession) {
                activeSession = {
                    id: currentSessionId,
                    title: 'Conversa',
                    date: Date.now(),
                    history: chatHistory || [],
                    calendar: generatedCalendarArray || []
                };
                allSessions.push(activeSession);
            }
            activeSession.pinned = !activeSession.pinned;
            isCurrentChatPinned = !!activeSession.pinned;
            const label = document.getElementById('header-menu-pin-label');
            if (label) label.innerText = isCurrentChatPinned ? 'Desfixar conversa' : 'Fixar conversa';
            const headerBadge = document.getElementById('chat-header-pinned-badge');
            if (headerBadge) {
                if (isCurrentChatPinned) headerBadge.classList.remove('hidden');
                else headerBadge.classList.add('hidden');
            }
            saveSession();
            renderSidebarHistory();
            showToast(isCurrentChatPinned ? 'Conversa fixada a la part superior' : 'Conversa desfixada', 'info');
        };

        window.handleHeaderMenuRename = function() {
            closeChatHeaderMenu();
            let activeSession = allSessions.find(s => s.id === currentSessionId);
            const labelEl = document.getElementById('chat-mode-label');
            const currentName = (activeSession && activeSession.title) || (labelEl ? labelEl.innerText : 'Classe Activa');
            Swal.fire({
                title: 'Canviar nom de la conversa',
                input: 'text',
                inputValue: currentName,
                inputPlaceholder: 'Escriu el nou nom...',
                showCancelButton: true,
                confirmButtonText: 'Guardar',
                cancelButtonText: 'Cancel·lar',
                confirmButtonColor: '#4f46e5',
                background: document.documentElement.classList.contains('dark') ? '#18181b' : '#fff',
                color: document.documentElement.classList.contains('dark') ? '#f4f4f5' : '#18181b',
                customClass: { popup: 'rounded-3xl border dark:border-zinc-800' },
                inputValidator: (value) => {
                    if (!value || !value.trim()) {
                        return 'Has d\'escriure un nom vàlid!';
                    }
                }
            }).then((result) => {
                if (result.isConfirmed && result.value) {
                    const newName = result.value.trim();
                    if (labelEl) labelEl.innerText = newName;
                    if (activeSession) {
                        activeSession.title = newName;
                    }
                    saveSession();
                    renderSidebarHistory();
                    showToast('Nom de la conversa actualitzat!');
                }
            });
        };

        window.handleHeaderMenuDownloadPdf = function() {
            closeChatHeaderMenu();
            if (!Array.isArray(chatHistory) || chatHistory.length === 0) {
                showToast('No hi ha cap missatge a la conversa per descarregar.', 'error');
                return;
            }

            try {
                const activeSession = allSessions.find(s => s.id === currentSessionId);
                const title = (activeSession && activeSession.title) || 'Conversa_Aliat';
                const sanitizedTitle = title.replace(/[^a-zA-Z0-9_\-]/g, '_').substring(0, 30);
                
                const { jsPDF } = window.jspdf || {};
                if (!jsPDF) {
                    throw new Error('La llibreria PDF no està disponible.');
                }

                const doc = new jsPDF({
                    orientation: 'portrait',
                    unit: 'mm',
                    format: 'a4'
                });

                const pageWidth = doc.internal.pageSize.getWidth();
                const pageHeight = doc.internal.pageSize.getHeight();
                const margin = 16;
                const maxLineWidth = pageWidth - (margin * 2);

                // Header banner
                doc.setFillColor(37, 99, 235);
                doc.rect(0, 0, pageWidth, 22, 'F');
                
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(13);
                doc.setTextColor(255, 255, 255);
                doc.text("Aliat Intel·ligent — Tutor Virtual", margin, 11);
                
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(8.5);
                doc.text(new Date().toLocaleDateString('ca-ES', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }), margin, 17);

                let y = 32;

                // Title
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(15);
                doc.setTextColor(15, 23, 42);
                const splitHeader = doc.splitTextToSize(title, maxLineWidth);
                doc.text(splitHeader, margin, y);
                y += (splitHeader.length * 6.5) + 3;

                doc.setDrawColor(226, 232, 240);
                doc.setLineWidth(0.4);
                doc.line(margin, y, pageWidth - margin, y);
                y += 8;

                chatHistory.forEach((msg, idx) => {
                    const isUser = msg.role === 'user';
                    const roleLabel = isUser ? 'Tu (Estudiant)' : 'Aliat Intel·ligent';

                    let cleanText = (msg.content || '')
                        .replace(/<img[^>]*>/gi, '[Imatge adjunta]')
                        .replace(/<[^>]+>/g, '')
                        .replace(/```[a-z]*\n?/gi, '')
                        .trim();

                    if (!cleanText && msg.image) cleanText = '[Imatge adjunta]';

                    if (y > pageHeight - 24) {
                        doc.addPage();
                        y = 20;
                    }

                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(10);
                    if (isUser) {
                        doc.setTextColor(37, 99, 235);
                    } else {
                        doc.setTextColor(79, 70, 229);
                    }
                    doc.text(roleLabel, margin, y);
                    y += 5;

                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(9.5);
                    doc.setTextColor(51, 65, 85);

                    const lines = doc.splitTextToSize(cleanText, maxLineWidth);
                    lines.forEach(line => {
                        if (y > pageHeight - 16) {
                            doc.addPage();
                            y = 20;
                        }
                        doc.text(line, margin, y);
                        y += 4.6;
                    });

                    y += 4.5;
                    if (idx < chatHistory.length - 1) {
                        doc.setDrawColor(241, 245, 249);
                        doc.setLineWidth(0.2);
                        doc.line(margin, y, pageWidth - margin, y);
                        y += 5;
                    }
                });

                // Add page footers
                const totalPages = doc.internal.getNumberOfPages();
                for (let i = 1; i <= totalPages; i++) {
                    doc.setPage(i);
                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(8);
                    doc.setTextColor(148, 163, 184);
                    doc.text(`Pàgina ${i} de ${totalPages} • Aliat Intel·ligent`, margin, pageHeight - 7);
                }

                doc.save(`conversa_${sanitizedTitle}_${Date.now()}.pdf`);
                showToast('PDF descarregat correctament!');
            } catch (err) {
                console.error('Error generating PDF:', err);
                showToast('Error en generar el PDF: ' + err.message, 'error');
            }
        };

        window.handleHeaderMenuExportDocs = function() {
            closeChatHeaderMenu();
            if (!Array.isArray(chatHistory) || chatHistory.length === 0) {
                showToast('No hi ha cap missatge per exportar.', 'error');
                return;
            }

            const activeSession = allSessions.find(s => s.id === currentSessionId);
            const title = (activeSession && activeSession.title) || 'Conversa d\'estudi';

            Swal.fire({
                title: 'Exportar conversa',
                text: 'Com vols descarregar o exportar aquesta conversa?',
                icon: 'question',
                showCancelButton: true,
                showDenyButton: true,
                confirmButtonText: 'Microsoft Word (.doc)',
                denyButtonText: 'Imprimir / PDF',
                cancelButtonText: 'Cancel·lar',
                confirmButtonColor: '#2563eb',
                denyButtonColor: '#4f46e5',
                background: document.documentElement.classList.contains('dark') ? '#18181b' : '#fff',
                color: document.documentElement.classList.contains('dark') ? '#f4f4f5' : '#18181b',
                customClass: { popup: 'rounded-3xl border dark:border-zinc-800' }
            }).then((res) => {
                if (res.isConfirmed) {
                    exportToWordDocument(title);
                } else if (res.isDenied) {
                    window.print();
                }
            });
        };

        function exportToWordDocument(title) {
            let messagesHtml = '';
            chatHistory.forEach(msg => {
                const isUser = msg.role === 'user';
                const senderName = isUser ? 'Tu (Estudiant)' : 'Aliat Intel·ligent';
                const cardClass = isUser ? 'user-msg' : 'ai-msg';
                const senderClass = isUser ? 'user-sender' : 'ai-sender';
                
                let bodyContent = msg.content || '';
                if (typeof marked !== 'undefined' && marked.parse) {
                    bodyContent = marked.parse(bodyContent);
                } else {
                    bodyContent = `<p>${bodyContent.replace(/\n/g, '<br>')}</p>`;
                }

                messagesHtml += `
                    <div class="${cardClass}">
                        <div class="sender ${senderClass}">${senderName}</div>
                        <div class="content">${bodyContent}</div>
                    </div>
                `;
            });

            const wordTemplate = `
                <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
                <head>
                    <meta charset='utf-8'>
                    <title>${escapeHtml(title)}</title>
                    <style>
                        body { font-family: 'Calibri', 'Segoe UI', Arial, sans-serif; font-size: 11pt; line-height: 1.6; color: #1e293b; margin: 2.5cm; }
                        h1 { color: #1e40af; font-size: 20pt; border-bottom: 2pt solid #3b82f6; padding-bottom: 6pt; margin-bottom: 8pt; font-family: 'Calibri', Arial, sans-serif; }
                        .meta { color: #64748b; font-size: 9pt; margin-bottom: 20pt; }
                        .user-msg { background-color: #f0f7ff; border-left: 4.5pt solid #2563eb; padding: 12pt; margin: 12pt 0; border-radius: 4pt; }
                        .ai-msg { background-color: #f8fafc; border-left: 4.5pt solid #4f46e5; padding: 12pt; margin: 12pt 0; border-radius: 4pt; }
                        .sender { font-weight: bold; font-size: 10pt; text-transform: uppercase; margin-bottom: 6pt; letter-spacing: 0.5pt; }
                        .user-sender { color: #1d4ed8; }
                        .ai-sender { color: #4338ca; }
                        .content { font-size: 11pt; }
                        p { margin: 0 0 6pt 0; }
                    </style>
                </head>
                <body>
                    <h1>${escapeHtml(title)}</h1>
                    <div class='meta'>Document generat amb <strong>Aliat Intel·ligent</strong> • Data: ${new Date().toLocaleDateString('ca-ES', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
                    ${messagesHtml}
                </body>
                </html>
            `;

            const blob = new Blob(['\ufeff', wordTemplate], { type: 'application/msword;charset=utf-8' });
            const sanitizedTitle = title.replace(/[^a-zA-Z0-9_\-]/g, '_').substring(0, 30);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `conversa_${sanitizedTitle}_${Date.now()}.doc`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('Document Word (.doc) descarregat correctament!');
        }

        window.handleHeaderMenuDelete = function() {
            closeChatHeaderMenu();
            Swal.fire({
                title: 'Eliminar conversa',
                text: 'Segur que vols esborrar tots els missatges d\'aquesta conversa?',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#ef4444',
                confirmButtonText: 'Sí, eliminar',
                cancelButtonText: 'Cancel·lar'
            }).then((result) => {
                if (result.isConfirmed) {
                    chatHistory = [];
                    if (typeof renderChatMessages === 'function') renderChatMessages();
                    showToast('Conversa eliminada.');
                }
            });
        };

        // --- PARELL DE SAMPLES PRE-CARREGATS DE LECTOR DE FOTOS (1-CLICK TEST) ---
        const SAMPLE_NOTES = {
            'biologia': {
                name: "🧬 Biologia Cel·lular (Mitocòndria)",
                svg: `<svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg" class="w-full h-auto bg-zinc-900 rounded-xl p-2"><ellipse cx="200" cy="120" rx="160" ry="90" fill="#1e293b" stroke="#3b82f6" stroke-width="4"/><path d="M 60 120 Q 90 70 120 120 T 180 120 T 240 120 T 300 120 T 340 120" fill="none" stroke="#10b981" stroke-dasharray="4" stroke-width="3"/><text x="140" y="50" fill="#ef4444" font-size="14" font-weight="bold">Membrana Externa</text><text x="120" y="180" fill="#10b981" font-size="14" font-weight="bold">Crestes Mitocondrials (Respiració ATP)</text><text x="150" y="125" fill="#f59e0b" font-size="12">Matriu i Ribosomes</text></svg>`
            },
            'fisica': {
                name: "📐 Física: Pla Inclinat (Forces)",
                svg: `<svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg" class="w-full h-auto bg-zinc-900 rounded-xl p-2"><polygon points="40,200 360,200 360,60" fill="#1e293b" stroke="#6366f1" stroke-width="4"/><rect x="180" y="100" width="50" height="40" transform="rotate(-25 205 120)" fill="#f59e0b" stroke="#fff" stroke-width="2"/><line x1="205" y1="120" x2="205" y2="180" stroke="#ef4444" stroke-width="3"/><text x="210" y="175" fill="#ef4444" font-size="12" font-weight="bold">P = m·g</text><line x1="205" y1="120" x2="150" y2="95" stroke="#10b981" stroke-width="3"/><text x="130" y="90" fill="#10b981" font-size="12" font-weight="bold">Fricció (Ff)</text><text x="80" y="190" fill="#a1a1aa" font-size="14">Angle θ = 30°</text></svg>`
            },
            'matematices': {
                name: "🔢 Matemàtiques: Integrals i Derivades",
                svg: `<svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg" class="w-full h-auto bg-zinc-900 rounded-xl p-2"><text x="30" y="50" fill="#60a5fa" font-size="20" font-weight="bold">∫ (x² · eˣ) dx</text><text x="30" y="90" fill="#f4f4f5" font-size="14">Mètode: Integració per parts (u·v - ∫v·du)</text><text x="30" y="130" fill="#10b981" font-size="14">u = x²  ➔  du = 2x dx</text><text x="30" y="160" fill="#f59e0b" font-size="14">dv = eˣ dx  ➔  v = eˣ</text><text x="30" y="200" fill="#a855f7" font-size="16" font-weight="bold">Resolució: eˣ(x² - 2x + 2) + C</text></svg>`
            }
        };

        // --- HUB D'EINES I CONTEXT PEDAGÒGIC COMPLET DEL XAT ---
        function getFullChatContext() {
            if (!Array.isArray(chatHistory) || chatHistory.length === 0) {
                if (finalStudyText && finalStudyText.trim()) {
                    return "APUNTS DE LA MATÈRIA:\n" + finalStudyText.trim().substring(0, 10000);
                }
                return "";
            }

            const cleanEntries = [];
            const automatedPromptPatterns = [
                /Comencem la primera sessió/i,
                /Comencem la sessió/i,
                /Hola tutor!? Estic preparat/i,
                /Comença explicant-me el primer tema/i,
                /Crea una baralla Anki de/i,
                /Crea un esquema o diagrama visual sobre/i,
                /Prepara un simulacre d'examen/i,
                /Extreu un formulari i resum/i
            ];

            for (const item of chatHistory) {
                if (!item || !item.content) continue;
                let text = typeof item.content === 'string' ? item.content : String(item.content);
                
                // Netejar marcadors de botons interns de la interfície
                text = text.replace(/\[BOTON_[A-Z_]+\]/g, '').trim();
                if (!text) continue;

                if (item.role === 'user') {
                    const isAutomated = automatedPromptPatterns.some(rx => rx.test(text));
                    if (!isAutomated) {
                        cleanEntries.push("Pregunta de l'Alumne: " + text);
                    }
                } else if (item.role === 'assistant' || item.role === 'model') {
                    // Mantenir la teoria, definicions, fórmules i explicacions
                    let cleanedAssistant = text.replace(/```html[\s\S]*?```/gi, '[Diagrama / Esquema Visual generat]');
                    cleanedAssistant = cleanedAssistant.replace(/```flashcards[\s\S]*?```/gi, '[Targetes de Repàs generades]');
                    cleanedAssistant = cleanedAssistant.replace(/```kahoot[\s\S]*?```/gi, '[Test Kahoot generat]');
                    cleanedAssistant = cleanedAssistant.trim();
                    if (cleanedAssistant.length > 0) {
                        cleanEntries.push("Teoria i Explicació del Tutor (IA):\n" + cleanedAssistant);
                    }
                }
            }

            let result = cleanEntries.join("\n\n---\n\n");
            
            // Si l'historial del xat és curt, afegim els apunts originals com a base acadèmica
            if (result.length < 500 && finalStudyText && finalStudyText.trim()) {
                result += (result ? "\n\n---\nAPUNTS DEL TEMARI ORIGINAL:\n" : "APUNTS DEL TEMARI ORIGINAL:\n") + finalStudyText.trim().substring(0, 8000);
            }

            return result.substring(0, 12000);
        }
        window.getFullChatContext = getFullChatContext;

        function getCurrentChatTopic() {
            // 1. Si tenim un calendari d'estudi actiu, agafem el tema concret de la sessió
            if (Array.isArray(generatedCalendarArray) && generatedCalendarArray.length > 0) {
                const calItem = generatedCalendarArray.find(c => c && c.tema && !c.tema.toLowerCase().includes('sessió 1: repàs')) || generatedCalendarArray[0];
                if (calItem && calItem.tema && calItem.tema.trim().length > 2) {
                    return calItem.tema.trim().replace(/^Sessió \d+:\s*/i, '').substring(0, 50);
                }
            }

            // 2. Revisem les explicacions de la IA a l'historial (on sol posar el títol del tema o concepte)
            if (Array.isArray(chatHistory) && chatHistory.length > 0) {
                for (let i = 0; i < chatHistory.length; i++) {
                    const msg = chatHistory[i];
                    if ((msg.role === 'assistant' || msg.role === 'model') && typeof msg.content === 'string') {
                        const titleMatch = msg.content.match(/(?:###|\*\*|Tema:|Concepte:)\s*([^\n\*\#]{4,50})/i);
                        if (titleMatch && titleMatch[1]) {
                            const candidate = titleMatch[1].trim();
                            if (!/comencem|primera sessió|hola/i.test(candidate)) {
                                return candidate.substring(0, 50);
                            }
                        }
                    }
                }

                // 3. Revisem missatges genuïns de l'usuari (sense missatges automàtics)
                for (let i = chatHistory.length - 1; i >= 0; i--) {
                    const c = typeof chatHistory[i].content === 'string' ? chatHistory[i].content : '';
                    if (chatHistory[i].role === 'user' && c && c.length > 3) {
                        if (!/comencem|primera sessió|estic preparat|crea una baralla|diagrama|simulacre/i.test(c)) {
                            const clean = c.replace(/^(Hola|Crea|Genera|Explica'm|Explica|Vull saber|Fes|Quin|Quina|Quins|Quines|Demano|Tinc un dubte sobre|Quina és)\s+/i, '').trim();
                            if (clean.length > 3) return clean.substring(0, 45);
                        }
                    }
                }
            }

            // 4. Sessió activa guardada si té títol vàlid
            const activeSession = allSessions.find(s => s.id === currentSessionId);
            if (activeSession && activeSession.title && !['Nova Conversa', 'Classe Activa', 'XatBot'].includes(activeSession.title) && !activeSession.title.toLowerCase().includes('primera sessió')) {
                return activeSession.title.substring(0, 45);
            }

            // 5. Notes del document / PDF
            if (finalStudyText && finalStudyText.trim().length > 0) {
                const firstLine = finalStudyText.trim().split('\n')[0].replace(/^[\#\*\-\s]+/, '').trim();
                if (firstLine.length > 3) return firstLine.substring(0, 45);
            }

            return "Temari d'Estudi";
        }
        window.getCurrentChatTopic = getCurrentChatTopic;

        window.showToolsModal = function() {
            const currentTopic = getCurrentChatTopic();
            let htmlContent = `
            <div class="mt-2 text-left space-y-3">
                <div class="p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/50 rounded-xl flex items-center justify-between text-xs shadow-sm">
                    <div class="font-bold text-blue-950 dark:text-blue-100 truncate flex items-center gap-1.5 min-w-0 pr-2">
                        <span class="w-2 h-2 rounded-full bg-blue-500 animate-pulse shrink-0"></span>
                        <span class="truncate">Context del xat: <b class="underline decoration-blue-400">${currentTopic}</b></span>
                    </div>
                    <span class="text-[10px] text-blue-700 dark:text-blue-300 font-bold uppercase shrink-0 bg-blue-100 dark:bg-blue-900/60 px-2 py-0.5 rounded-full border border-blue-200 dark:border-blue-800">Amb Teoria de la IA</span>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <!-- 1. DIAGRAMA VISUAL -->
                    <button onclick="Swal.close(); triggerToolFromChat('diagram');" class="p-3.5 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl hover:border-indigo-500 dark:hover:border-indigo-400 hover:shadow-md hover:bg-white dark:hover:bg-zinc-900 transition-all group flex items-start gap-3 text-left cursor-pointer">
                        <div class="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 flex items-center justify-center font-bold shrink-0 shadow-sm">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="font-bold text-zinc-900 dark:text-zinc-100 text-xs sm:text-sm group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition">Esquema / Diagrama Visual</div>
                            <div class="text-[11px] text-zinc-600 dark:text-zinc-400 leading-tight mt-0.5">Genera un diagrama vectorial interactiu del que hem tractat.</div>
                        </div>
                    </button>

                    <!-- 2. FLASHCARDS ANKI -->
                    <button onclick="Swal.close(); triggerToolFromChat('anki');" class="p-3.5 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl hover:border-purple-500 dark:hover:border-purple-400 hover:shadow-md hover:bg-white dark:hover:bg-zinc-900 transition-all group flex items-start gap-3 text-left cursor-pointer">
                        <div class="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 flex items-center justify-center font-bold shrink-0 shadow-sm">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 15h10"/><path d="M7 11h6"/></svg>
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="font-bold text-zinc-900 dark:text-zinc-100 text-xs sm:text-sm group-hover:text-purple-600 dark:group-hover:text-purple-400 transition">Baralla Anki (Flashcards)</div>
                            <div class="text-[11px] text-zinc-600 dark:text-zinc-400 leading-tight mt-0.5">Targetes 3D basades en les explicacions del xat.</div>
                        </div>
                    </button>

                    <!-- 3. SIMULADOR TEST / EXAMEN -->
                    <button onclick="Swal.close(); triggerToolFromChat('exam');" class="p-3.5 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl hover:border-emerald-500 dark:hover:border-emerald-400 hover:shadow-md hover:bg-white dark:hover:bg-zinc-900 transition-all group flex items-start gap-3 text-left cursor-pointer">
                        <div class="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 flex items-center justify-center font-bold shrink-0 shadow-sm">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="font-bold text-zinc-900 dark:text-zinc-100 text-xs sm:text-sm group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition">Test d'Examen Kahoot</div>
                            <div class="text-[11px] text-zinc-600 dark:text-zinc-400 leading-tight mt-0.5">5 preguntes puntuades sobre els conceptes explicats.</div>
                        </div>
                    </button>

                    <!-- 4. CHULETA & FORMULARI -->
                    <button onclick="Swal.close(); triggerToolFromChat('cheatsheet');" class="p-3.5 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl hover:border-amber-500 dark:hover:border-amber-400 hover:shadow-md hover:bg-white dark:hover:bg-zinc-900 transition-all group flex items-start gap-3 text-left cursor-pointer">
                        <div class="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 flex items-center justify-center font-bold shrink-0 shadow-sm">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="font-bold text-zinc-900 dark:text-zinc-100 text-xs sm:text-sm group-hover:text-amber-600 dark:group-hover:text-amber-400 transition">Formulari & Resum Clau</div>
                            <div class="text-[11px] text-zinc-600 dark:text-zinc-400 leading-tight mt-0.5">Fórmules, conceptes i definicions de la lliçó.</div>
                        </div>
                    </button>
                </div>

                <!-- EINES AUXILIARS -->
                <div class="pt-2 border-t border-zinc-200 dark:border-zinc-800 flex gap-2">
                    <button onclick="Swal.close(); openVisionModal();" class="flex-1 py-2.5 px-3 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-750 rounded-xl text-xs font-bold text-zinc-800 dark:text-zinc-200 flex items-center justify-center gap-1.5 transition cursor-pointer">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> Lector de Fotos
                    </button>
                    <button onclick="Swal.close(); openPomodoroModal();" class="flex-1 py-2.5 px-3 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-750 rounded-xl text-xs font-bold text-zinc-800 dark:text-zinc-200 flex items-center justify-center gap-1.5 transition cursor-pointer">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Pomodoro, Sons & Tàctiques
                    </button>
                </div>
            </div>`;

            Swal.fire({
                title: '<div class="flex items-center justify-center gap-2 text-zinc-900 dark:text-white"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Eines Basades en el Xat</div>',
                html: htmlContent,
                showCloseButton: true,
                showConfirmButton: false,
                customClass: { popup: 'rounded-[1.5rem] md:rounded-3xl dark:bg-zinc-900 dark:text-white border dark:border-zinc-800 max-w-xl w-full', title: 'font-black text-zinc-900 dark:text-white' }
            });
        };

        // --- EXECUTOR DIRECTE D'EINES BASADES EN EL CONTEXT DEL XAT ---
        window.triggerToolFromChat = async function(toolType, customAiInstruction, customUserText) {
            if (typeof Swal !== 'undefined') Swal.close();
            
            // Assegurem que la vista del xat està visible
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
            const chatForm = document.getElementById('chat-form');
            if (chatForm) chatForm.classList.remove('hidden');

            const topic = getCurrentChatTopic();
            const fullContext = getFullChatContext();
            let userPromptText = customUserText || '';
            let apiPayload = null;

            if (toolType === 'diagram') {
                userPromptText = userPromptText || ('Crea un esquema o diagrama visual sobre: ' + topic);
                apiPayload = { action: 'generate_diagram', topic: topic, style: 'diagrama_cientific', context: fullContext };
            } else if (toolType === 'anki') {
                userPromptText = userPromptText || ('Crea una baralla de Flashcards 3D (Anki) sobre: ' + topic);
                apiPayload = { action: 'generate_anki_deck', topic: topic, context: fullContext };
            } else if (toolType === 'exam') {
                const seed = Date.now().toString().slice(-4);
                userPromptText = userPromptText || ('Prepara un simulacre d\'examen test sobre: ' + topic);
                const promptContent = customAiInstruction || `Basant-te estrictament en tota la teoria i explicacions que hem tractat a la classe sobre "${topic}", prepara un Test d'Examen Kahoot de 5 preguntes variades i d'alta qualitat (Sèrie #${seed}) amb 4 opcions i distractors plausibles.
IMPORTANTÍSSIM: Retorna un array JSON de 5 preguntes dins d'un sol bloc kahoot. El camp "correcta" ha de ser el número d'índex exacte (0, 1, 2 o 3) de l'opció correcta dins de l'array "opcions":
\`\`\`kahoot
[
  {"pregunta": "...", "opcions": ["A", "B", "C", "D"], "correcta": 0},
  {"pregunta": "...", "opcions": ["A", "B", "C", "D"], "correcta": 1},
  {"pregunta": "...", "opcions": ["A", "B", "C", "D"], "correcta": 2},
  {"pregunta": "...", "opcions": ["A", "B", "C", "D"], "correcta": 3},
  {"pregunta": "...", "opcions": ["A", "B", "C", "D"], "correcta": 0}
]
\`\`\``;
                apiPayload = {
                    action: 'chat',
                    chatHistory: [
                        ...chatHistory.filter(m => m && (m.role === 'user' || m.role === 'assistant')),
                        { role: 'user', content: promptContent }
                    ],
                    pdfText: finalStudyText,
                    studentContext: studentContextStr
                };
            } else if (toolType === 'cheatsheet') {
                userPromptText = userPromptText || ('Extreu un formulari i resum essencial sobre: ' + topic);
                apiPayload = { action: 'generate_cheatsheet', sourceText: fullContext || topic, topic: topic, formatType: 'formulas' };
            }

            if (!apiPayload) return;

            appendMessage('user', userPromptText);
            chatHistory.push({ role: 'user', content: userPromptText });

            const loadingId = 'loading-' + Date.now();
            appendLoading(loadingId);

            try {
                const res = await callGenerateApi(apiPayload);
                document.getElementById(loadingId)?.remove();
                const data = await res.json();
                if (data.error) throw new Error(data.error);

                let aiContent = '';
                if (toolType === 'diagram') aiContent = data.diagram;
                else if (toolType === 'anki') aiContent = data.deck;
                else if (toolType === 'exam') aiContent = data.reply;
                else if (toolType === 'cheatsheet') aiContent = data.result;

                appendMessage('ai', aiContent || 'Recurs generat correctament.');
                chatHistory.push({ role: 'assistant', content: aiContent || 'Recurs generat correctament.' });
                saveSession();
            } catch (e) {
                document.getElementById(loadingId)?.remove();
                showToast("S'ha produït un error en generar el contingut", "error");
                appendMessage('ai', '⚠️ No s\'ha pogut completar la generació: ' + (e.message || 'Error de connexió'));
            }
        };
        let currentVisionImageBase64 = null;

        window.openVisionModal = function() {
            let htmlContent = `
            <div class="space-y-4 text-left mt-2">
                <!-- Modes d'anàlisi -->
                <div>
                    <label class="block text-[11px] font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider mb-2">1. Selecciona el Mètode d'Anàlisi</label>
                    <div class="grid grid-cols-2 gap-2" id="vision-mode-selector">
                        <button onclick="selectVisionMode('solve', this)" class="v-mode-btn active p-2.5 rounded-xl border-2 border-blue-600 bg-blue-50 dark:bg-blue-950/60 text-blue-900 dark:text-blue-200 font-bold text-xs flex items-center gap-2">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="16" y1="14" x2="16" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/></svg> Resoldre Exercici
                        </button>
                        <button onclick="selectVisionMode('diagram_breakdown', this)" class="v-mode-btn p-2.5 rounded-xl border-2 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200 font-bold text-xs flex items-center gap-2">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M8.5 7.5l7 3"/><path d="M8.5 16.5l7-3"/></svg> Desglossar Esquema
                        </button>
                        <button onclick="selectVisionMode('transcribe_summarize', this)" class="v-mode-btn p-2.5 rounded-xl border-2 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200 font-bold text-xs flex items-center gap-2">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Transcriure i Resumir
                        </button>
                        <button onclick="selectVisionMode('study_pack', this)" class="v-mode-btn p-2.5 rounded-xl border-2 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200 font-bold text-xs flex items-center gap-2">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg> Pack d'Estudi
                        </button>
                    </div>
                </div>

                <!-- Provar Apunts d'Exemple en 1-Clic -->
                <div>
                    <label class="block text-[11px] font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">O prova amb 3 Apunts d'Exemple en 1-Clic:</label>
                    <div class="flex gap-2 overflow-x-auto pb-1">
                        <button onclick="loadSampleVision('biologia')" class="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-blue-600 hover:text-white text-zinc-800 dark:text-zinc-200 rounded-xl text-xs font-semibold shrink-0 transition border border-zinc-300 dark:border-zinc-700">Biologia Cel·lular</button>
                        <button onclick="loadSampleVision('fisica')" class="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-blue-600 hover:text-white text-zinc-800 dark:text-zinc-200 rounded-xl text-xs font-semibold shrink-0 transition border border-zinc-300 dark:border-zinc-700">Física: Pla Inclinat</button>
                        <button onclick="loadSampleVision('matematices')" class="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-blue-600 hover:text-white text-zinc-800 dark:text-zinc-200 rounded-xl text-xs font-semibold shrink-0 transition border border-zinc-300 dark:border-zinc-700">Matemàtiques: Integrals</button>
                    </div>
                </div>

                <!-- Àrea de càmera o pujar foto -->
                <div class="border-2 border-dashed border-zinc-300 dark:border-zinc-800 rounded-2xl p-4 text-center relative bg-zinc-50 dark:bg-zinc-950/50" id="vision-dropzone">
                    <div id="vision-preview-box" class="hidden mb-3">
                        <img id="vision-img-element" class="max-h-80 sm:max-h-96 md:max-h-[500px] w-full object-contain mx-auto rounded-2xl shadow-xl border border-zinc-700 bg-black">
                    </div>
                    <div id="vision-svg-box" class="hidden mb-3"></div>
                    <input type="file" id="vision-file-input" accept="image/*" class="hidden" onchange="handleVisionFileSelect(this)">
                    <div class="flex items-center justify-center gap-3">
                        <button type="button" onclick="document.getElementById('vision-file-input').click()" class="bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-100 font-bold py-2.5 px-4 rounded-xl text-xs transition flex items-center gap-2 border border-zinc-300 dark:border-zinc-700 cursor-pointer">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Pujar Foto/Apunt
                        </button>
                        <button type="button" onclick="startLiveCamera()" class="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs transition flex items-center gap-2 shadow-sm cursor-pointer">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> Obrir Càmera Gran
                        </button>
                    </div>
                    <video id="vision-video" class="hidden w-full h-72 sm:h-96 md:h-[450px] rounded-2xl mt-3 object-cover border-2 border-indigo-500 shadow-2xl bg-black" autoplay playsinline></video>
                    <button type="button" id="vision-snap-btn" onclick="snapCameraPhoto()" class="hidden w-full mt-3 bg-red-600 hover:bg-red-700 text-white font-bold py-3.5 rounded-2xl text-sm flex items-center justify-center gap-2 shadow-lg cursor-pointer">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg> Capturar Foto de la Càmera
                    </button>
                </div>

                <button type="button" id="btn-process-vision" onclick="processVisionAnalysis()" class="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold py-3.5 rounded-2xl text-sm transition shadow-md flex items-center justify-center gap-2 cursor-pointer">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Analitzar Foto amb IA
                </button>
            </div>`;

            window.selectedVisionMode = 'solve';
            currentVisionImageBase64 = null;

            Swal.fire({
                title: '<div class="flex items-center justify-center gap-2 text-zinc-900 dark:text-white"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg> Lector i Solucionador d\'Apunts</div>',
                html: htmlContent,
                showCloseButton: true,
                showConfirmButton: false,
                customClass: { popup: 'rounded-[1.5rem] md:rounded-3xl dark:bg-zinc-900 dark:text-white border dark:border-zinc-800 max-w-3xl md:max-w-4xl w-full', title: 'font-black text-zinc-900 dark:text-white' }
            });
        };

        // --- MODAL DE TRANSSCRIPCIÓ D'ÀUDIO AMB GEMINI-3.5-TRANSCRIBE ---
        let modalAudioRecorder = null;
        let modalAudioChunks = [];
        let modalAudioTimer = null;
        let modalAudioSeconds = 0;
        let currentTranscribedAudioBase64 = null;
        let currentTranscribedMime = 'audio/webm';

        window.openAudioTranscribeModal = function() {
            currentTranscribedAudioBase64 = null;
            currentTranscribedMime = 'audio/webm';
            modalAudioSeconds = 0;
            if (modalAudioTimer) clearInterval(modalAudioTimer);

            let htmlContent = `
            <div class="space-y-4 text-left mt-2">
                <div class="p-3 bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/60 rounded-2xl flex items-center justify-between text-xs">
                    <div class="flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full bg-purple-500 animate-pulse"></span>
                        <span class="font-bold text-purple-900 dark:text-purple-200">Motor Transcriptor IA:</span>
                    </div>
                    <span class="font-mono text-[11px] font-bold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-700 dark:text-purple-300">gemini-3.5-transcribe</span>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <!-- Opció A: Gravador de Micròfon -->
                    <div class="p-4 rounded-2xl border-2 border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 flex flex-col items-center justify-center text-center space-y-3">
                        <div id="modal-rec-orb" class="w-14 h-14 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400 flex items-center justify-center border-2 border-purple-300 dark:border-purple-800 shadow-md">
                            <svg class="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
                        </div>
                        <div class="font-bold text-xs text-zinc-900 dark:text-zinc-100">Micròfon en Directe</div>
                        <div id="modal-audio-timer" class="font-mono text-sm font-black text-purple-600 dark:text-purple-400">00:00</div>
                        <button type="button" id="btn-modal-record" onclick="toggleModalAudioRecording()" class="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs transition shadow-sm cursor-pointer flex items-center gap-1.5">
                            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg>
                            <span id="btn-modal-record-label">Gravar Micròfon</span>
                        </button>
                    </div>

                    <!-- Opció B: Pujar Fitxer d'Àudio -->
                    <div class="p-4 rounded-2xl border-2 border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 flex flex-col items-center justify-center text-center space-y-3">
                        <div class="w-14 h-14 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center border-2 border-blue-300 dark:border-blue-800 shadow-md">
                            <svg class="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                        </div>
                        <div class="font-bold text-xs text-zinc-900 dark:text-zinc-100">Carregar Fitxer Àudio</div>
                        <div id="modal-file-info" class="text-[11px] text-zinc-500 dark:text-zinc-400 truncate max-w-[140px]">.MP3, .WAV, .M4A, .WEBM</div>
                        <input type="file" id="modal-audio-file-input" accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.flac,.aac" class="hidden" onchange="handleModalAudioFileSelect(this)">
                        <button type="button" onclick="document.getElementById('modal-audio-file-input').click()" class="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition shadow-sm cursor-pointer flex items-center gap-1.5">
                            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                            <span>Triar Fitxer</span>
                        </button>
                    </div>
                </div>

                <!-- Botó Principal Transcriure -->
                <button type="button" id="btn-process-transcribe" onclick="processModalAudioTranscribe()" class="w-full bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white font-bold py-3.5 rounded-2xl text-sm transition shadow-md flex items-center justify-center gap-2 cursor-pointer">
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                    <span>Transcriure Àudio amb gemini-3.5-transcribe</span>
                </button>

                <!-- Àrea de Resultat Transcripció -->
                <div id="transcribe-result-box" class="hidden space-y-2">
                    <div class="flex items-center justify-between">
                        <label class="block text-xs font-bold text-zinc-800 dark:text-zinc-200">Transcripció Verbatina Generada:</label>
                        <span class="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 font-bold">gemini-3.5-transcribe ✓</span>
                    </div>
                    <textarea id="modal-transcription-output" rows="6" class="w-full p-3.5 rounded-2xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 text-xs sm:text-sm font-medium outline-none focus:border-purple-500 leading-relaxed custom-scrollbar" placeholder="La transcripció apareixerà aquí..."></textarea>
                    
                    <div class="grid grid-cols-3 gap-2 pt-1">
                        <button type="button" onclick="copyTranscriptionText()" class="py-2.5 px-3 rounded-xl bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 font-bold text-xs transition flex items-center justify-center gap-1.5 cursor-pointer">
                            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                            <span>Copiar Text</span>
                        </button>
                        <button type="button" onclick="sendTranscriptionToChat()" class="py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition flex items-center justify-center gap-1.5 shadow-sm cursor-pointer">
                            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                            <span>Enviar al Xat</span>
                        </button>
                        <button type="button" onclick="generateSummaryFromTranscription()" class="py-2.5 px-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold text-xs transition flex items-center justify-center gap-1.5 shadow-sm cursor-pointer">
                            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                            <span>Crear Resum</span>
                        </button>
                    </div>
                </div>
            </div>`;

            Swal.fire({
                title: '<div class="flex items-center justify-center gap-2.5 text-zinc-900 dark:text-white"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2.5"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg> Transcripció d\'Àudio amb IA</div>',
                html: htmlContent,
                showCloseButton: true,
                showConfirmButton: false,
                customClass: { popup: 'rounded-[1.5rem] md:rounded-3xl dark:bg-zinc-900 dark:text-white border dark:border-zinc-800 max-w-xl md:max-w-2xl w-full', title: 'font-black text-zinc-900 dark:text-white' }
            });
        };

        window.toggleModalAudioRecording = async function() {
            const btn = document.getElementById('btn-modal-record');
            const btnLabel = document.getElementById('btn-modal-record-label');
            const timerEl = document.getElementById('modal-audio-timer');
            const orb = document.getElementById('modal-rec-orb');

            if (modalAudioRecorder && modalAudioRecorder.state === 'recording') {
                modalAudioRecorder.stop();
                if (modalAudioTimer) clearInterval(modalAudioTimer);
                if (btn) btn.className = "px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs transition shadow-sm cursor-pointer flex items-center gap-1.5";
                if (btnLabel) btnLabel.innerText = "Gravació Enllestida!";
                if (orb) orb.className = "w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border-2 border-emerald-300 dark:border-emerald-800 shadow-md";
                return;
            }

            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                modalAudioChunks = [];
                modalAudioRecorder = new MediaRecorder(stream);

                modalAudioRecorder.ondataavailable = (e) => {
                    if (e.data && e.data.size > 0) modalAudioChunks.push(e.data);
                };

                modalAudioRecorder.onstop = () => {
                    stream.getTracks().forEach(track => track.stop());
                    if (modalAudioChunks.length === 0) return;
                    const audioBlob = new Blob(modalAudioChunks, { type: modalAudioRecorder.mimeType || 'audio/webm' });
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        currentTranscribedAudioBase64 = reader.result;
                        currentTranscribedMime = audioBlob.type || 'audio/webm';
                        showToast('🎤 Gravació d\'àudio a punt per transcriure!');
                    };
                    reader.readAsDataURL(audioBlob);
                };

                modalAudioRecorder.start();
                modalAudioSeconds = 0;
                if (timerEl) timerEl.innerText = "00:00";
                modalAudioTimer = setInterval(() => {
                    modalAudioSeconds++;
                    const mins = String(Math.floor(modalAudioSeconds / 60)).padStart(2, '0');
                    const secs = String(modalAudioSeconds % 60).padStart(2, '0');
                    if (timerEl) timerEl.innerText = `${mins}:${secs}`;
                }, 1000);

                if (btn) btn.className = "px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs transition shadow-sm cursor-pointer flex items-center gap-1.5 animate-pulse";
                if (btnLabel) btnLabel.innerText = "Aturar Gravació";
                if (orb) orb.className = "w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 flex items-center justify-center border-2 border-red-400 dark:border-red-800 shadow-md animate-ping";
            } catch (err) {
                showToast("No s'ha pogut accedir al micròfon: " + err.message, "error");
            }
        };

        window.handleModalAudioFileSelect = function(input) {
            const file = input.files[0];
            if (!file) return;
            const infoEl = document.getElementById('modal-file-info');
            if (infoEl) infoEl.innerText = `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`;

            const reader = new FileReader();
            reader.onloadend = () => {
                currentTranscribedAudioBase64 = reader.result;
                currentTranscribedMime = file.type || 'audio/mp3';
                showToast(`🎵 Fitxer d'àudio carregat: ${file.name}`);
            };
            reader.readAsDataURL(file);
        };

        window.processModalAudioTranscribe = async function() {
            if (!currentTranscribedAudioBase64) {
                showToast("Grava amb el micròfon o selecciona un fitxer d'àudio primer.", "error");
                return;
            }

            const resultBox = document.getElementById('transcribe-result-box');
            const outputTextarea = document.getElementById('modal-transcription-output');

            Swal.fire({
                title: 'Transcribint Àudio...',
                html: '<div class="space-y-3 py-2"><div class="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto"></div><p class="text-xs text-zinc-400">Processant àudio amb el model <strong>gemini-3.5-transcribe</strong>...</p></div>',
                allowOutsideClick: false,
                showConfirmButton: false,
                customClass: { popup: 'rounded-3xl dark:bg-zinc-900 dark:text-white border dark:border-zinc-800' }
            });

            try {
                const res = await callGenerateApi({
                    action: 'transcribe_audio',
                    audioBase64: currentTranscribedAudioBase64,
                    mimeType: currentTranscribedMime
                });
                const data = await res.json();
                if (data.error) throw new Error(data.error);

                Swal.close();
                if (resultBox) resultBox.classList.remove('hidden');
                if (outputTextarea) outputTextarea.value = data.transcription || '';
                showToast("✨ Transcripció completada amb gemini-3.5-transcribe!", "success");
            } catch (err) {
                Swal.fire("Error Transcripció", err.message, "error");
            }
        };

        window.copyTranscriptionText = function() {
            const txt = document.getElementById('modal-transcription-output')?.value || '';
            if (!txt) return;
            navigator.clipboard.writeText(txt).then(() => {
                showToast("Copiat al porta-retalls!", "success");
            });
        };

        window.sendTranscriptionToChat = function() {
            const txt = document.getElementById('modal-transcription-output')?.value || '';
            if (!txt) return;
            const input = document.getElementById('chat-input');
            if (input) {
                input.value = txt;
                input.style.height = 'auto';
                input.style.height = Math.min(input.scrollHeight, 150) + 'px';
            }
            Swal.close();
            showToast("Transcripció afegida al xat!", "info");
        };

        window.generateSummaryFromTranscription = function() {
            const txt = document.getElementById('modal-transcription-output')?.value || '';
            if (!txt) return;
            Swal.close();
            appendMessage('user', `🎙️ Transcripció d'Àudio (gemini-3.5-transcribe):\n"${txt.substring(0, 300)}..."\n\nCrea un resum d'estudi estructurat.`);
            chatHistory.push({ role: 'user', content: `Aquesta és la transcripció d'un àudio de la classe/conversa:\n'''\n${txt}\n'''\n\nCrea un resum d'estudi estructurat amb punts clau, idees principals i conceptes fonamentals.` });
            saveSession();
            triggerAiResponse();
        };

        window.selectVisionMode = function(mode, btn) {
            window.selectedVisionMode = mode;
            document.querySelectorAll('.v-mode-btn').forEach(b => {
                b.className = "v-mode-btn p-2.5 rounded-xl border-2 border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 font-bold text-xs flex items-center gap-2";
            });
            btn.className = "v-mode-btn active p-2.5 rounded-xl border-2 border-blue-500 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-bold text-xs flex items-center gap-2";
        };

        window.loadSampleVision = function(sampleKey) {
            const sample = SAMPLE_NOTES[sampleKey];
            if (!sample) return;
            const svgBox = document.getElementById('vision-svg-box');
            const imgEl = document.getElementById('vision-img-element');
            const prevBox = document.getElementById('vision-preview-box');
            
            if(svgBox) {
                svgBox.innerHTML = sample.svg;
                svgBox.classList.remove('hidden');
            }
            if(prevBox) prevBox.classList.add('hidden');

            const svgString = new XMLSerializer().serializeToString(svgBox.querySelector('svg'));
            currentVisionImageBase64 = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgString)));
            showToast('Apunt carregat: ' + sample.name);
        };

        window.handleVisionFileSelect = function(input) {
            const file = input.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                currentVisionImageBase64 = e.target.result;
                const imgEl = document.getElementById('vision-img-element');
                const prevBox = document.getElementById('vision-preview-box');
                const svgBox = document.getElementById('vision-svg-box');
                if(svgBox) svgBox.classList.add('hidden');
                if(imgEl) imgEl.src = currentVisionImageBase64;
                if(prevBox) prevBox.classList.remove('hidden');
            };
            reader.readAsDataURL(file);
        };

        window.startLiveCamera = async function() {
            try {
                const video = document.getElementById('vision-video');
                const snapBtn = document.getElementById('vision-snap-btn');
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
                video.srcObject = stream;
                video.classList.remove('hidden');
                snapBtn.classList.remove('hidden');
            } catch(e) {
                showToast('⚠️ No s\'ha pogut accedir a la càmera: ' + e.message, 'error');
            }
        };

        window.snapCameraPhoto = function() {
            const video = document.getElementById('vision-video');
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth || 640;
            canvas.height = video.videoHeight || 480;
            canvas.getContext('2d').drawImage(video, 0, 0);
            currentVisionImageBase64 = canvas.toDataURL('image/png');

            const imgEl = document.getElementById('vision-img-element');
            const prevBox = document.getElementById('vision-preview-box');
            if(imgEl) imgEl.src = currentVisionImageBase64;
            if(prevBox) prevBox.classList.remove('hidden');

            if(video.srcObject) {
                video.srcObject.getTracks().forEach(t => t.stop());
            }
            video.classList.add('hidden');
            document.getElementById('vision-snap-btn').classList.add('hidden');
            showToast('📸 Foto capturada!');
        };

        // --- CLIENT DE GENERACIÓ MULTI-PROVEÏDOR IA AMB CONTINGÈNCIA ---
        window.callGenerateApi = async function(bodyPayload) {
            const userAiProvider = localStorage.getItem('aliat_ai_provider') || '';
            const userAiKey = localStorage.getItem('aliat_ai_key') || '';
            const userAiModel = localStorage.getItem('aliat_ai_model') || '';

            const headers = { 'Content-Type': 'application/json' };
            if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
            if (userAiProvider) headers['x-ai-provider'] = userAiProvider;
            if (userAiKey) headers['x-ai-key'] = userAiKey;
            if (userAiModel) headers['x-ai-model'] = userAiModel;

            const fullPayload = {
                ...bodyPayload,
                ai_provider: userAiProvider,
                ai_api_key: userAiKey,
                ai_model: userAiModel,
                aiProvider: userAiProvider,
                customApiKey: userAiKey,
                customModel: userAiModel
            };

            return await fetch('/api/generate', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(fullPayload)
            });
        };

        window.processVisionAnalysis = async function() {
            if (!currentVisionImageBase64) {
                showToast('Selecciona o captura una foto d\'apunts primer.', 'error');
                return;
            }

            Swal.fire({
                title: 'Analitzant apunt...',
                text: 'Processant imatge amb el motor d\'IA multimodal.',
                allowOutsideClick: false,
                customClass: { popup: 'rounded-[1.5rem] dark:bg-zinc-900 dark:text-white border dark:border-zinc-800' },
                didOpen: () => Swal.showLoading()
            });

            try {
                const res = await callGenerateApi({
                    action: 'vision_analyze',
                    imageBase64: currentVisionImageBase64,
                    mode: window.selectedVisionMode || 'solve'
                });

                const data = await res.json();
                if (data.error) throw new Error(data.error);

                Swal.close();
                appendMessage('user', 'Anàlisi d\'apunt (' + window.selectedVisionMode + ')');
                appendMessage('ai', data.analysis);
                chatHistory.push({ role: 'user', content: 'Anàlisi d\'apunt (' + window.selectedVisionMode + ')' });
                chatHistory.push({ role: 'assistant', content: data.analysis });
                saveSession();

            } catch(e) {
                Swal.fire('Error', e.message, 'error');
            }
        };

        // --- MODAL GENERADOR VISUAL DE DIAGRAMES ---
        window.openDiagramModal = function() {
            let htmlContent = `
            <div class="space-y-4 text-left mt-2">
                <div>
                    <label class="block text-xs font-bold text-zinc-900 dark:text-zinc-200 mb-1">Tema del Diagrama</label>
                    <input type="text" id="diagram-topic" placeholder="Ex: Cicle de Krebs, Capes de la Terra, Sinapsi Neuronal, Lleis de Kepler..." class="w-full px-4 py-3 rounded-2xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 text-sm font-medium outline-none focus:border-indigo-500 shadow-sm">
                </div>
                <div>
                    <label class="block text-xs font-bold text-zinc-900 dark:text-zinc-200 mb-1">Estil Visual</label>
                    <select id="diagram-style" class="w-full px-4 py-3 rounded-2xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 text-sm font-bold outline-none focus:border-indigo-500 shadow-sm cursor-pointer">
                        <option value="diagrama_cientific">Diagrama Científic amb Etiquetes</option>
                        <option value="infografia_3d">Infografia Visual Jeràrquica</option>
                        <option value="dibuix_anatomic">Dibuix Anatòmic Vectorial</option>
                    </select>
                </div>
                <button onclick="processGenerateDiagram()" class="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold py-3.5 rounded-2xl text-sm transition shadow-md flex items-center justify-center gap-2 cursor-pointer">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> Generar Diagrama Visual
                </button>
            </div>`;

            Swal.fire({
                title: '<div class="flex items-center justify-center gap-2 text-zinc-900 dark:text-white"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2.2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg> Generador Visual de Diagrames</div>',
                html: htmlContent,
                showCloseButton: true,
                showConfirmButton: false,
                customClass: { popup: 'rounded-[1.5rem] md:rounded-3xl dark:bg-zinc-900 dark:text-white border dark:border-zinc-800 max-w-md w-full', title: 'font-black text-zinc-900 dark:text-white' }
            });
        };

        window.processGenerateDiagram = async function() {
            const topic = document.getElementById('diagram-topic')?.value?.trim();
            const style = document.getElementById('diagram-style')?.value || 'diagrama_cientific';
            if (!topic) { showToast('Escriu un tema per al diagrama.', 'error'); return; }

            Swal.close();
            document.getElementById('welcome-view')?.classList.add('hidden');
            document.getElementById('setup-view')?.classList.add('hidden');
            document.getElementById('quiz-view')?.classList.add('hidden');
            document.getElementById('chat-view')?.classList.remove('hidden');
            document.getElementById('chat-view')?.classList.add('flex');
            document.getElementById('chat-form')?.classList.remove('hidden');

            const userMsg = 'Genera un diagrama sobre: ' + topic;
            appendMessage('user', userMsg);
            chatHistory.push({ role: 'user', content: userMsg });

            const loadingId = 'loading-' + Date.now();
            appendLoading(loadingId);

            try {
                const res = await callGenerateApi({ action: 'generate_diagram', topic: topic, style: style, context: getFullChatContext() });
                document.getElementById(loadingId)?.remove();
                const data = await res.json();
                if(data.error) throw new Error(data.error);

                appendMessage('ai', data.diagram);
                chatHistory.push({ role: 'assistant', content: data.diagram });
                saveSession();
            } catch(e) { 
                document.getElementById(loadingId)?.remove();
                showToast(e.message, 'error');
                appendMessage('ai', '⚠️ Error en generar el diagrama: ' + e.message);
            }
        };

        // --- MODAL GENERADOR DE BARALLES ANKI ---
        window.openAnkiModal = function() {
            let htmlContent = `
            <div class="space-y-4 text-left mt-2">
                <div>
                    <label class="block text-xs font-bold text-zinc-900 dark:text-zinc-200 mb-1">Matèria o concepte</label>
                    <input type="text" id="anki-topic" placeholder="Ex: Vocabulari d'Anglès B2, Taula Periòdica, Història d'Espanya..." class="w-full px-4 py-3 rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 text-sm font-medium outline-none focus:border-purple-500">
                </div>
                <button onclick="processGenerateAnki()" class="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3.5 rounded-xl text-sm transition shadow-md flex items-center justify-center gap-2">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 15h10"/><path d="M7 11h6"/></svg> Crear Baralla Anki amb IA
                </button>
            </div>`;

            Swal.fire({
                title: '<div class="flex items-center justify-center gap-2 text-zinc-900 dark:text-white"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2.2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 15h10"/><path d="M7 11h6"/><path d="M7 7h4"/></svg> Flashcards (Mètode Anki)</div>',
                html: htmlContent,
                showCloseButton: true,
                showConfirmButton: false,
                customClass: { popup: 'rounded-[1.5rem] md:rounded-3xl dark:bg-zinc-900 dark:text-white border dark:border-zinc-800 max-w-md w-full', title: 'font-black text-zinc-900 dark:text-white' }
            });
        };

        window.processGenerateAnki = async function() {
            const topic = document.getElementById('anki-topic')?.value?.trim();
            if (!topic) { showToast('Escriu un tema per a les Flashcards.', 'error'); return; }

            Swal.close();
            document.getElementById('welcome-view')?.classList.add('hidden');
            document.getElementById('setup-view')?.classList.add('hidden');
            document.getElementById('quiz-view')?.classList.add('hidden');
            document.getElementById('chat-view')?.classList.remove('hidden');
            document.getElementById('chat-view')?.classList.add('flex');
            document.getElementById('chat-form')?.classList.remove('hidden');

            const userMsg = 'Crea una baralla Anki de: ' + topic;
            appendMessage('user', userMsg);
            chatHistory.push({ role: 'user', content: userMsg });

            const loadingId = 'loading-' + Date.now();
            appendLoading(loadingId);

            try {
                const res = await callGenerateApi({ action: 'generate_anki_deck', topic: topic, context: getFullChatContext() });
                document.getElementById(loadingId)?.remove();
                const data = await res.json();
                if(data.error) throw new Error(data.error);

                appendMessage('ai', data.deck);
                chatHistory.push({ role: 'assistant', content: data.deck });
                saveSession();
            } catch(e) { 
                document.getElementById(loadingId)?.remove();
                showToast(e.message, 'error');
                appendMessage('ai', '⚠️ Error en generar les flashcards: ' + e.message);
            }
        };

        // --- MODAL SIMULADOR D'EXÀMENS I TEST ---
        window.openExamSimulatorModal = function() {
            let htmlContent = `
            <div class="space-y-4 text-left mt-2">
                <div>
                    <label class="block text-xs font-bold text-zinc-900 dark:text-zinc-200 mb-1">Tema de l'Examen</label>
                    <input type="text" id="exam-sim-topic" placeholder="Ex: Anatomia del Cor, Dret Constitucional, Líquens i Fongs..." class="w-full px-4 py-3 rounded-xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 text-sm font-medium outline-none focus:border-emerald-500">
                </div>
                <button onclick="processGenerateExamSim()" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3.5 rounded-xl text-sm transition shadow-md flex items-center justify-center gap-2">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Començar Examen Puntuat
                </button>
            </div>`;

            Swal.fire({
                title: '<div class="flex items-center justify-center gap-2 text-zinc-900 dark:text-white"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> Simulador de Test i Exàmens</div>',
                html: htmlContent,
                showCloseButton: true,
                showConfirmButton: false,
                customClass: { popup: 'rounded-[1.5rem] md:rounded-3xl dark:bg-zinc-900 dark:text-white border dark:border-zinc-800 max-w-md w-full', title: 'font-black text-zinc-900 dark:text-white' }
            });
        };

        window.processGenerateExamSim = async function() {
            const topic = document.getElementById('exam-sim-topic')?.value?.trim();
            if (!topic) { showToast('Escriu un tema per a l\'examen.', 'error'); return; }

            Swal.close();
            document.getElementById('welcome-view')?.classList.add('hidden');
            document.getElementById('setup-view')?.classList.add('hidden');
            document.getElementById('quiz-view')?.classList.add('hidden');
            document.getElementById('chat-view')?.classList.remove('hidden');
            document.getElementById('chat-view')?.classList.add('flex');
            document.getElementById('chat-form')?.classList.remove('hidden');

            const userMsg = 'Genera un Examen Puntuat de: ' + topic;
            appendMessage('user', userMsg);
            chatHistory.push({ role: 'user', content: userMsg });

            const loadingId = 'loading-' + Date.now();
            appendLoading(loadingId);

            try {
                const res = await callGenerateApi({
                    action: 'chat',
                    chatHistory: [
                        ...chatHistory.filter(m => m && (m.role === 'user' || m.role === 'assistant')),
                        { role: 'user', content: `Crea un Test d'Examen Kahoot de 5 preguntes realistes amb distractors plausibles sobre el tema: ${topic}. Retorna NOMÉS el bloc kahoot.` }
                    ],
                    pdfText: finalStudyText,
                    studentContext: studentContextStr
                });
                document.getElementById(loadingId)?.remove();
                const data = await res.json();
                if(data.error) throw new Error(data.error);

                appendMessage('ai', data.reply);
                chatHistory.push({ role: 'assistant', content: data.reply });
                saveSession();
            } catch(e) { 
                document.getElementById(loadingId)?.remove();
                showToast(e.message, 'error');
                appendMessage('ai', '⚠️ Error en generar l\'examen: ' + e.message);
            }
        };

        // --- MODAL FORMULARIS I RESUMS ---
        window.openCheatsheetModal = function() {
            let htmlContent = `
            <div class="space-y-4 text-left mt-2">
                <div>
                    <label class="block text-xs font-bold text-zinc-900 dark:text-zinc-200 mb-1">Apunts o Text a Extreure</label>
                    <textarea id="cheatsheet-text" placeholder="Enganxa aquí el teu text o apunts llargs..." class="w-full px-4 py-3 rounded-2xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 text-sm font-medium outline-none h-28 resize-none focus:border-amber-500 shadow-sm"></textarea>
                </div>
                <div>
                    <label class="block text-xs font-bold text-zinc-900 dark:text-zinc-200 mb-1">Tipus de Resum</label>
                    <select id="cheatsheet-format" class="w-full px-4 py-3 rounded-2xl border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 text-sm font-bold outline-none focus:border-amber-500 shadow-sm cursor-pointer">
                        <option value="formulas">Formulari de Fórmules i Equacions</option>
                        <option value="mindmap">Mapa Conceptual Jeràrquic</option>
                        <option value="timeline">Línia Cronològica d'Etapes</option>
                    </select>
                </div>
                <button onclick="processGenerateCheatsheet()" class="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-3.5 rounded-2xl text-sm transition shadow-md flex items-center justify-center gap-2 cursor-pointer">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Extreure Formulari
                </button>
            </div>`;

            Swal.fire({
                title: '<div class="flex items-center justify-center gap-2 text-zinc-900 dark:text-white"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Formularis i Resums Ràpids</div>',
                html: htmlContent,
                showCloseButton: true,
                showConfirmButton: false,
                customClass: { popup: 'rounded-[1.5rem] md:rounded-3xl dark:bg-zinc-900 dark:text-white border dark:border-zinc-800 max-w-md w-full', title: 'font-black text-zinc-900 dark:text-white' }
            });
        };

        window.processGenerateCheatsheet = async function() {
            const sourceText = document.getElementById('cheatsheet-text')?.value?.trim() || getFullChatContext() || getCurrentChatTopic();
            const formatType = document.getElementById('cheatsheet-format')?.value || 'formulas';

            Swal.close();
            document.getElementById('welcome-view')?.classList.add('hidden');
            document.getElementById('setup-view')?.classList.add('hidden');
            document.getElementById('quiz-view')?.classList.add('hidden');
            document.getElementById('chat-view')?.classList.remove('hidden');
            document.getElementById('chat-view')?.classList.add('flex');
            document.getElementById('chat-form')?.classList.remove('hidden');

            const userMsg = 'Genera un Formulari d\'Estudi (' + formatType + ')';
            appendMessage('user', userMsg);
            chatHistory.push({ role: 'user', content: userMsg });

            const loadingId = 'loading-' + Date.now();
            appendLoading(loadingId);

            try {
                const res = await callGenerateApi({ action: 'generate_cheatsheet', sourceText: sourceText, topic: getCurrentChatTopic(), formatType: formatType });
                document.getElementById(loadingId)?.remove();
                const data = await res.json();
                if(data.error) throw new Error(data.error);

                appendMessage('ai', data.result);
                chatHistory.push({ role: 'assistant', content: data.result });
                saveSession();
            } catch(e) { 
                document.getElementById(loadingId)?.remove();
                showToast(e.message, 'error');
                appendMessage('ai', '⚠️ Error en processar el formulari: ' + e.message);
            }
        };

        // --- ⏱️ POMODORO DE CONCENTRACIÓ, SONS REALISTES I TÀCTIQUES D'ESTUDI ---
        let totalStudySeconds = parseInt(localStorage.getItem('aliat_total_study_seconds') || '0', 10);
        let pomodoroMode = 'classic'; // 'classic' (25m), 'deep' (50m), 'short' (5m), 'long' (15m)
        let pomodoroTotalDuration = 25 * 60;
        let pomodoroTimeLeft = 25 * 60;
        let pomodoroTimerId = null;
        let pomodoroIsRunning = false;
        let activeAudioSynth = null;
        let currentSoundVolume = 0.35;
        let currentActiveSound = null;

        function formatTimerDigits(sec) {
            const m = Math.floor(sec / 60);
            const s = sec % 60;
            return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
        }

        function getCumulativeStudyDisplay() {
            const totalMins = Math.floor(totalStudySeconds / 60);
            if (totalMins < 60) return `${totalMins} minuts`;
            const h = Math.floor(totalMins / 60);
            const remM = totalMins % 60;
            return `${h}h ${remM}min`;
        }

        function updateHeaderPomodoroDisplay() {
            const formatted = formatTimerDigits(pomodoroTimeLeft);
            const headerTimerEl = document.getElementById('header-pomodoro-timer');
            if (headerTimerEl) headerTimerEl.innerText = formatted;

            const dotEl = document.getElementById('pomo-pill-dot');
            if (dotEl) {
                if (pomodoroIsRunning) {
                    dotEl.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0 ring-2 ring-emerald-400/40';
                } else if (pomodoroTimeLeft < pomodoroTotalDuration) {
                    dotEl.className = 'w-2 h-2 rounded-full bg-amber-500 shrink-0';
                } else {
                    dotEl.className = 'w-2 h-2 rounded-full bg-rose-500 shrink-0';
                }
            }

            const modalDisplay = document.getElementById('pomo-display');
            if (modalDisplay) modalDisplay.innerText = formatted;

            const modalProg = document.getElementById('pomo-progress-bar');
            if (modalProg) {
                const percent = Math.min(100, Math.max(0, ((pomodoroTotalDuration - pomodoroTimeLeft) / pomodoroTotalDuration) * 100));
                modalProg.style.width = percent + '%';
            }

            const totalDisplay = document.getElementById('pomo-total-study-display');
            if (totalDisplay) totalDisplay.innerText = getCumulativeStudyDisplay();

            // Sincronitzar amb el menú (+) del xat
            const plusTimerEl = document.getElementById('plus-menu-pomodoro-time');
            if (plusTimerEl) plusTimerEl.innerText = formatted;
            const plusDotEl = document.getElementById('plus-pomodoro-indicator');
            if (plusDotEl) {
                if (pomodoroIsRunning) {
                    plusDotEl.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0 ring-2 ring-emerald-400/40 mr-0.5';
                } else if (pomodoroTimeLeft < pomodoroTotalDuration) {
                    plusDotEl.className = 'w-2 h-2 rounded-full bg-amber-500 shrink-0 mr-0.5';
                } else {
                    plusDotEl.className = 'w-2 h-2 rounded-full bg-rose-500 shrink-0 mr-0.5';
                }
            }
            const plusBadge = document.getElementById('plus-custom-mins-badge');
            if (plusBadge) plusBadge.innerText = (typeof pomodoroCustomMinutes !== 'undefined' ? pomodoroCustomMinutes : 30) + 'm';
        }

        let pomodoroCustomMinutes = parseInt(localStorage.getItem('aliat_pomodoro_custom_mins') || '30', 10);

        window.setPomodoroMode = function(mode, customMins = null) {
            pomodoroMode = mode;
            if (pomodoroTimerId) {
                clearInterval(pomodoroTimerId);
                pomodoroTimerId = null;
                pomodoroIsRunning = false;
            }
            if (mode === 'classic') pomodoroTotalDuration = 25 * 60;
            else if (mode === 'deep') pomodoroTotalDuration = 50 * 60;
            else if (mode === 'short') pomodoroTotalDuration = 5 * 60;
            else if (mode === 'long') pomodoroTotalDuration = 15 * 60;
            else if (mode === 'custom') {
                if (customMins && !isNaN(customMins) && customMins > 0) {
                    pomodoroCustomMinutes = Math.min(180, Math.max(1, parseInt(customMins, 10)));
                    localStorage.setItem('aliat_pomodoro_custom_mins', pomodoroCustomMinutes.toString());
                }
                pomodoroTotalDuration = pomodoroCustomMinutes * 60;
            }

            pomodoroTimeLeft = pomodoroTotalDuration;
            updateHeaderPomodoroDisplay();

            const startBtn = document.getElementById('pomo-start-btn');
            if (startBtn) startBtn.innerHTML = '▶️ Iniciar Sessió';

            // Actualitzar estils dels botons de mode si el modal està obert
            ['classic', 'deep', 'short', 'long', 'custom'].forEach(m => {
                const btn = document.getElementById('pomo-mode-' + m);
                if (btn) {
                    if (m === mode) {
                        btn.className = 'flex-1 py-1.5 px-2 rounded-xl text-xs font-bold bg-rose-600 text-white shadow-sm transition';
                    } else {
                        btn.className = 'flex-1 py-1.5 px-2 rounded-xl text-xs font-semibold bg-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition';
                    }
                }
            });

            const customEditBox = document.getElementById('pomo-custom-edit-box');
            if (customEditBox) {
                if (mode === 'custom') customEditBox.classList.remove('hidden');
                else customEditBox.classList.add('hidden');
            }
        };

        window.applyCustomPomodoroMinutes = function(val) {
            const mins = parseInt(val, 10);
            if (!isNaN(mins) && mins >= 1 && mins <= 180) {
                setPomodoroMode('custom', mins);
                showToast(`⏱️ Temps personalitzat ajustat a ${mins} minuts`);
            }
        };

        window.togglePomodoroTimer = function() {
            if (pomodoroIsRunning) {
                clearInterval(pomodoroTimerId);
                pomodoroTimerId = null;
                pomodoroIsRunning = false;
                const btn = document.getElementById('pomo-start-btn');
                if (btn) btn.innerHTML = '▶️ Reprendre';
                showToast('⏸️ Pomodoro en pausa');
            } else {
                pomodoroIsRunning = true;
                const btn = document.getElementById('pomo-start-btn');
                if (btn) btn.innerHTML = '⏸️ Pausa';
                showToast('🚀 Sessió iniciada! Ànim amb l\'estudi.');
                pomodoroTimerId = setInterval(() => {
                    if (pomodoroTimeLeft > 0) {
                        pomodoroTimeLeft--;
                        if (pomodoroMode === 'classic' || pomodoroMode === 'deep') {
                            totalStudySeconds++;
                            if (totalStudySeconds % 5 === 0) {
                                localStorage.setItem('aliat_total_study_seconds', totalStudySeconds.toString());
                            }
                        }
                        updateHeaderPomodoroDisplay();
                    } else {
                        clearInterval(pomodoroTimerId);
                        pomodoroTimerId = null;
                        pomodoroIsRunning = false;
                        updateHeaderPomodoroDisplay();

                        if (pomodoroMode === 'classic' || pomodoroMode === 'deep') {
                            logStudentActivity('pomodoro', `Sessió de Focus completada (${Math.round(pomodoroTotalDuration / 60)} min)`, 'Estudi intensiu amb èxit');
                            updateStudentMemory(null, null, 1);
                            showToast('🎉 Felicitats! Pomodoro completat! Descansa 5 minuts.');
                        } else {
                            showToast('🔔 Pausa finalitzada! A punt per la següent ronda d\'estudi.');
                        }

                        if (typeof confetti === 'function') {
                            confetti({ particleCount: 90, spread: 75, origin: { y: 0.6 } });
                        }
                        const btn = document.getElementById('pomo-start-btn');
                        if (btn) btn.innerHTML = '▶️ Iniciar de Nou';
                    }
                }, 1000);
            }
            updateHeaderPomodoroDisplay();
        };

        window.resetPomodoroTimer = function() {
            if (pomodoroTimerId) {
                clearInterval(pomodoroTimerId);
                pomodoroTimerId = null;
            }
            pomodoroIsRunning = false;
            pomodoroTimeLeft = pomodoroTotalDuration;
            updateHeaderPomodoroDisplay();
            const btn = document.getElementById('pomo-start-btn');
            if (btn) btn.innerHTML = '▶️ Iniciar Sessió';
            showToast('🔄 Temporitzador restablert.');
        };

        window.openPomodoroModal = function(initialTab = 'pomo') {
            const formattedTime = formatTimerDigits(pomodoroTimeLeft);
            const cumulativeStr = getCumulativeStudyDisplay();
            const percent = Math.min(100, Math.max(0, ((pomodoroTotalDuration - pomodoroTimeLeft) / pomodoroTotalDuration) * 100));

            const htmlContent = `
            <div class="mt-1 text-left space-y-4">
                <!-- TABS DE NAVEGACIÓ -->
                <div class="flex p-1 bg-zinc-100 dark:bg-zinc-800 rounded-2xl gap-1">
                    <button id="pomo-tab-pomo" onclick="switchPomoModalTab('pomo')" class="flex-1 py-2 text-xs font-bold rounded-xl transition ${initialTab === 'pomo' ? 'bg-white dark:bg-zinc-900 text-rose-600 dark:text-rose-400 shadow-sm' : 'text-zinc-600 dark:text-zinc-400'}">
                        ⏱️ Pomodoro & Sons
                    </button>
                    <button id="pomo-tab-tactics" onclick="switchPomoModalTab('tactics')" class="flex-1 py-2 text-xs font-bold rounded-xl transition ${initialTab === 'tactics' ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-zinc-600 dark:text-zinc-400'}">
                        🧠 Tàctiques d'Estudi
                    </button>
                </div>

                <!-- SECCIÓ 1: TEMPORITZADOR & SONS -->
                <div id="pomo-section-pomo" class="${initialTab === 'pomo' ? 'block' : 'hidden'} space-y-4">
                    <!-- Selector de Mode -->
                    <div class="flex flex-wrap gap-1.5 p-1 bg-zinc-50 dark:bg-zinc-950/80 rounded-2xl border border-zinc-200 dark:border-zinc-800 text-center">
                        <button id="pomo-mode-classic" onclick="setPomodoroMode('classic')" class="flex-1 min-w-[70px] py-1.5 px-2 rounded-xl text-xs font-bold ${pomodoroMode === 'classic' ? 'bg-rose-600 text-white shadow-sm' : 'bg-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'} transition">
                            🍅 25m
                        </button>
                        <button id="pomo-mode-deep" onclick="setPomodoroMode('deep')" class="flex-1 min-w-[70px] py-1.5 px-2 rounded-xl text-xs font-bold ${pomodoroMode === 'deep' ? 'bg-rose-600 text-white shadow-sm' : 'bg-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'} transition">
                            ⚡ 50m
                        </button>
                        <button id="pomo-mode-short" onclick="setPomodoroMode('short')" class="flex-1 min-w-[70px] py-1.5 px-2 rounded-xl text-xs font-bold ${pomodoroMode === 'short' ? 'bg-rose-600 text-white shadow-sm' : 'bg-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'} transition">
                            ☕ 5m
                        </button>
                        <button id="pomo-mode-long" onclick="setPomodoroMode('long')" class="flex-1 min-w-[70px] py-1.5 px-2 rounded-xl text-xs font-bold ${pomodoroMode === 'long' ? 'bg-rose-600 text-white shadow-sm' : 'bg-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'} transition">
                            🌿 15m
                        </button>
                        <button id="pomo-mode-custom" onclick="setPomodoroMode('custom')" class="flex-1 min-w-[85px] py-1.5 px-2 rounded-xl text-xs font-bold ${pomodoroMode === 'custom' ? 'bg-rose-600 text-white shadow-sm' : 'bg-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'} transition flex items-center justify-center gap-1">
                            ✏️ <span>${pomodoroCustomMinutes}m</span>
                        </button>
                    </div>

                    <!-- Caixa d'edició ràpida del temps personalitzat -->
                    <div id="pomo-custom-edit-box" class="${pomodoroMode === 'custom' ? 'flex' : 'hidden'} items-center justify-between gap-3 p-3 bg-rose-50/60 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 rounded-2xl">
                        <div class="text-xs font-semibold text-rose-900 dark:text-rose-200">
                            <span>⏱️ Editar minuts de la sessió:</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <input type="number" id="pomo-custom-input" min="1" max="180" value="${pomodoroCustomMinutes}" class="w-16 px-2.5 py-1 text-center font-mono font-bold text-xs bg-white dark:bg-zinc-900 border border-rose-300 dark:border-rose-800 rounded-lg text-zinc-900 dark:text-white outline-none focus:ring-2 focus:ring-rose-500">
                            <button onclick="applyCustomPomodoroMinutes(document.getElementById('pomo-custom-input').value)" class="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-lg transition shadow-xs">
                                Aplicar
                            </button>
                        </div>
                    </div>

                    <!-- DISPLAY DEL RELLOTGE I BARRA -->
                    <div class="relative bg-zinc-100 dark:bg-zinc-950 rounded-3xl p-6 border border-zinc-200 dark:border-zinc-800 text-center overflow-hidden shadow-inner">
                        <div class="absolute top-0 left-0 h-1.5 bg-rose-500 transition-all duration-300" id="pomo-progress-bar" style="width: ${percent}%;"></div>
                        <div class="text-5xl font-black font-mono tracking-wider text-zinc-900 dark:text-white" id="pomo-display">
                            ${formattedTime}
                        </div>
                        <div class="mt-2 text-xs text-zinc-500 dark:text-zinc-400 flex items-center justify-center gap-1.5">
                            <span>🎯 Temps acumulat d'estudi avui:</span>
                            <b class="text-rose-600 dark:text-rose-400 font-bold" id="pomo-total-study-display">${cumulativeStr}</b>
                        </div>
                    </div>

                    <!-- BOTONS CONTROL -->
                    <div class="flex gap-2">
                        <button onclick="togglePomodoroTimer()" id="pomo-start-btn" class="flex-1 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-700 hover:to-red-700 text-white font-bold py-3 px-4 rounded-xl text-sm transition shadow-md shadow-rose-500/20 active:scale-[0.98]">
                            ${pomodoroIsRunning ? '⏸️ Pausa' : '▶️ Iniciar Sessió'}
                        </button>
                        <button onclick="resetPomodoroTimer()" class="bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 font-bold py-3 px-4 rounded-xl text-sm transition">
                            🔄 Reiniciar
                        </button>
                    </div>

                    <!-- SONS AMBIENTALS HARMONITZATS -->
                    <div class="border-t border-zinc-200 dark:border-zinc-800 pt-3">
                        <div class="flex items-center justify-between mb-2">
                            <label class="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
                                <span>🎶 Sons Ambientals de Concentració</span>
                            </label>
                            <span id="active-sound-label" class="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                                ${currentActiveSound ? '🔊 Actiu: ' + currentActiveSound : '🔇 En silenci'}
                            </span>
                        </div>

                        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            <button onclick="playAmbientSound('rain')" class="p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:border-blue-500 text-xs font-bold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5 transition text-left cursor-pointer">
                                <span>🌧️</span>
                                <div>
                                    <div>Pluja Suau</div>
                                    <div class="text-[9px] font-normal text-zinc-500">Gotes relaxants</div>
                                </div>
                            </button>
                            <button onclick="playAmbientSound('waves')" class="p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:border-cyan-500 text-xs font-bold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5 transition text-left cursor-pointer">
                                <span>🌊</span>
                                <div>
                                    <div>Ones del Mar</div>
                                    <div class="text-[9px] font-normal text-zinc-500">Ressaca càlida</div>
                                </div>
                            </button>
                            <button onclick="playAmbientSound('binaural')" class="p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:border-indigo-500 text-xs font-bold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5 transition text-left cursor-pointer">
                                <span>🧘</span>
                                <div>
                                    <div>Alfa 432Hz</div>
                                    <div class="text-[9px] font-normal text-zinc-500">To binaural focus</div>
                                </div>
                            </button>
                            <button onclick="playAmbientSound('lofi')" class="p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:border-amber-500 text-xs font-bold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5 transition text-left cursor-pointer">
                                <span>☕</span>
                                <div>
                                    <div>Lo-Fi & Campanes</div>
                                    <div class="text-[9px] font-normal text-zinc-500">Notes zen suaus</div>
                                </div>
                            </button>
                            <button onclick="playAmbientSound('bell')" class="p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:border-purple-500 text-xs font-bold text-zinc-700 dark:text-zinc-300 flex items-center gap-1.5 transition text-left cursor-pointer">
                                <span>🔔</span>
                                <div>
                                    <div>Bol Tibetà</div>
                                    <div class="text-[9px] font-normal text-zinc-500">Campana ressonant</div>
                                </div>
                            </button>
                            <button onclick="stopAmbientSound()" class="p-2.5 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer">
                                <span>🔇</span>
                                <span>Aturar So</span>
                            </button>
                        </div>

                        <!-- CONTROL DE VOLUM -->
                        <div class="mt-3 flex items-center gap-3 p-2 bg-zinc-50 dark:bg-zinc-950 rounded-xl border border-zinc-200 dark:border-zinc-800">
                            <span class="text-xs text-zinc-500">🔈</span>
                            <input type="range" id="sound-volume-slider" min="0.05" max="1" step="0.05" value="${currentSoundVolume}" oninput="setAmbientVolume(this.value)" class="flex-1 accent-rose-600 cursor-pointer">
                            <span class="text-xs font-mono text-zinc-600 dark:text-zinc-400" id="sound-vol-label">${Math.round(currentSoundVolume * 100)}%</span>
                        </div>
                    </div>
                </div>

                <!-- SECCIÓ 2: TÀCTIQUES CIENTÍFIQUES D'ESTUDI -->
                <div id="pomo-section-tactics" class="${initialTab === 'tactics' ? 'block' : 'hidden'} space-y-3">
                    <p class="text-xs text-zinc-600 dark:text-zinc-400">
                        Metodologies amb base neurocientífica per accelerar la retenció i superar la corba de l'oblit:
                    </p>

                    <!-- TÀCTICA 1: FEYNMAN -->
                    <div class="p-3.5 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl flex flex-col gap-2">
                        <div class="flex items-center justify-between">
                            <div class="flex items-center gap-2">
                                <span class="text-lg">🧠</span>
                                <div>
                                    <div class="text-xs font-bold text-zinc-900 dark:text-zinc-100">Tècnica Feynman</div>
                                    <div class="text-[11px] text-zinc-500">Simplifica i explica a un nen de 10 anys</div>
                                </div>
                            </div>
                            <button onclick="Swal.close(); startFeynmanTactic();" class="text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-xl transition shadow-sm cursor-pointer">
                                Practicar amb la IA
                            </button>
                        </div>
                        <p class="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                            Detecta falses sensacions de seguretat forçant-te a explicar conceptes difícils amb analogies del món real i sense tecnicismes buits.
                        </p>
                    </div>

                    <!-- TÀCTICA 2: BLURTING 2 MIN -->
                    <div class="p-3.5 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl flex flex-col gap-2">
                        <div class="flex items-center justify-between">
                            <div class="flex items-center gap-2">
                                <span class="text-lg">⚡</span>
                                <div>
                                    <div class="text-xs font-bold text-zinc-900 dark:text-zinc-100">Mètode Blurting (Volcat 2 min)</div>
                                    <div class="text-[11px] text-zinc-500">Recuperació activa sense mirar apunts</div>
                                </div>
                            </div>
                            <button onclick="Swal.close(); openBlurtingModal();" class="text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-xl transition shadow-sm cursor-pointer">
                                Iniciar Repte 2m
                            </button>
                        </div>
                        <p class="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                            Escriu tot el que recordis durant 2 minuts exactes. La IA compararà el teu text amb el temari oficial per indicar-te exactament què has oblidat.
                        </p>
                    </div>

                    <!-- TÀCTICA 3: REPETICIÓ ESPAIADA (LEITNER) -->
                    <div class="p-3.5 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl flex flex-col gap-2">
                        <div class="flex items-center justify-between">
                            <div class="flex items-center gap-2">
                                <span class="text-lg">📦</span>
                                <div>
                                    <div class="text-xs font-bold text-zinc-900 dark:text-zinc-100">Caixes de Leitner (Repetició Espaiada)</div>
                                    <div class="text-[11px] text-zinc-500">Repàs periòdic a 1d, 3d, 7d i 14d</div>
                                </div>
                            </div>
                            <button onclick="Swal.close(); triggerToolFromChat('anki');" class="text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-xl transition shadow-sm cursor-pointer">
                                Obrir Flashcards
                            </button>
                        </div>
                        <p class="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                            Les targetes marcades com a 'Difícil' es tornen a preguntar aviat, mentre que les apreses s'espaien en el temps per consolidar la memòria a llarg termini.
                        </p>
                    </div>

                    <!-- TÀCTICA 4: FORMAT CORNELL -->
                    <div class="p-3.5 bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl flex flex-col gap-2">
                        <div class="flex items-center justify-between">
                            <div class="flex items-center gap-2">
                                <span class="text-lg">📝</span>
                                <div>
                                    <div class="text-xs font-bold text-zinc-900 dark:text-zinc-100">Format d'Apunts Cornell</div>
                                    <div class="text-[11px] text-zinc-500">Preguntes, apunts i síntesi final</div>
                                </div>
                            </div>
                            <button onclick="Swal.close(); generateCornellNotes();" class="text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-xl transition shadow-sm cursor-pointer">
                                Sintetitzar Apunts
                            </button>
                        </div>
                        <p class="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                            Organitza el temari dividit en columna d'idees clau/preguntes d'examen, columna d'explicacions i un resum final de 3 frases per repassar ràpidament.
                        </p>
                    </div>
                </div>
            </div>`;

            Swal.fire({
                title: '<div class="flex items-center justify-center gap-2 font-black text-zinc-900 dark:text-white"><span class="text-rose-500">⏱️</span> Centre de Concentració & Tàctiques</div>',
                html: htmlContent,
                showCloseButton: true,
                showConfirmButton: false,
                customClass: {
                    popup: 'rounded-[1.75rem] md:rounded-3xl dark:bg-zinc-900 dark:text-white border dark:border-zinc-800 max-w-lg w-full',
                    title: 'text-base sm:text-lg font-black text-zinc-800 dark:text-white pt-2'
                }
            });
        };

        window.switchPomoModalTab = function(tab) {
            const secPomo = document.getElementById('pomo-section-pomo');
            const secTactics = document.getElementById('pomo-section-tactics');
            const tabPomo = document.getElementById('pomo-tab-pomo');
            const tabTactics = document.getElementById('pomo-tab-tactics');

            if (tab === 'pomo') {
                if (secPomo) secPomo.classList.remove('hidden');
                if (secTactics) secTactics.classList.add('hidden');
                if (tabPomo) tabPomo.className = 'flex-1 py-2 text-xs font-bold rounded-xl transition bg-white dark:bg-zinc-900 text-rose-600 dark:text-rose-400 shadow-sm';
                if (tabTactics) tabTactics.className = 'flex-1 py-2 text-xs font-bold rounded-xl transition text-zinc-600 dark:text-zinc-400';
            } else {
                if (secPomo) secPomo.classList.add('hidden');
                if (secTactics) secTactics.classList.remove('hidden');
                if (tabPomo) tabPomo.className = 'flex-1 py-2 text-xs font-bold rounded-xl transition text-zinc-600 dark:text-zinc-400';
                if (tabTactics) tabTactics.className = 'flex-1 py-2 text-xs font-bold rounded-xl transition bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 shadow-sm';
            }
        };

        // --- SISTEMA D'ÀUDIO AMBIENTAL REALISTA (WEB AUDIO API SINTETITZADA) ---
        window.setAmbientVolume = function(val) {
            currentSoundVolume = parseFloat(val);
            const label = document.getElementById('sound-vol-label');
            if (label) label.innerText = Math.round(currentSoundVolume * 100) + '%';
            if (activeAudioSynth && activeAudioSynth.masterGain) {
                try {
                    activeAudioSynth.masterGain.gain.setValueAtTime(currentSoundVolume, activeAudioSynth.ctx.currentTime);
                } catch(e) {}
            }
        };

        window.playAmbientSound = function(type) {
            stopAmbientSound(false);
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) {
                showToast('El teu navegador no suporta Web Audio', 'error');
                return;
            }

            try {
                const ctx = new AudioCtx();
                const masterGain = ctx.createGain();
                masterGain.gain.setValueAtTime(currentSoundVolume, ctx.currentTime);
                masterGain.connect(ctx.destination);

                let nodes = [];
                let intervals = [];

                if (type === 'rain') {
                    // Pink noise relaxant amb esquitxades suaus de pluja
                    const bufferSize = ctx.sampleRate * 2;
                    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
                    const output = buffer.getChannelData(0);
                    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
                    for (let i = 0; i < bufferSize; i++) {
                        const white = Math.random() * 2 - 1;
                        b0 = 0.99886 * b0 + white * 0.0555179;
                        b1 = 0.99332 * b1 + white * 0.0750759;
                        b2 = 0.96900 * b2 + white * 0.1538520;
                        b3 = 0.86650 * b3 + white * 0.3104856;
                        b4 = 0.55000 * b4 + white * 0.5329522;
                        b5 = -0.7616 * b5 - white * 0.0168980;
                        output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.09;
                        b6 = white * 0.115926;
                    }
                    const noise = ctx.createBufferSource();
                    noise.buffer = buffer;
                    noise.loop = true;
                    const filter = ctx.createBiquadFilter();
                    filter.type = 'lowpass';
                    filter.frequency.value = 1100;
                    noise.connect(filter);
                    filter.connect(masterGain);
                    noise.start();
                    nodes.push(noise);

                    // Gotes suaus a intervals aleatoris
                    const dropInt = setInterval(() => {
                        if (!activeAudioSynth || activeAudioSynth.ctx !== ctx) {
                            clearInterval(dropInt);
                            return;
                        }
                        try {
                            const osc = ctx.createOscillator();
                            const g = ctx.createGain();
                            const f = 1300 + Math.random() * 900;
                            osc.frequency.setValueAtTime(f, ctx.currentTime);
                            osc.frequency.exponentialRampToValueAtTime(f * 0.6, ctx.currentTime + 0.07);
                            g.gain.setValueAtTime(0.04 * (Math.random() * 0.5 + 0.5), ctx.currentTime);
                            g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.07);
                            osc.connect(g);
                            g.connect(masterGain);
                            osc.start();
                            osc.stop(ctx.currentTime + 0.08);
                        } catch(e) {}
                    }, 260);
                    intervals.push(dropInt);

                } else if (type === 'waves') {
                    // Ones del mar amb modulació sinusoidal suau de filtre i volum (LFO)
                    const bufferSize = ctx.sampleRate * 2;
                    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
                    const data = buffer.getChannelData(0);
                    let last = 0;
                    for (let i = 0; i < bufferSize; i++) {
                        const white = Math.random() * 2 - 1;
                        data[i] = (last + (0.04 * white)) / 1.04;
                        last = data[i];
                        data[i] *= 2.2;
                    }
                    const noise = ctx.createBufferSource();
                    noise.buffer = buffer;
                    noise.loop = true;

                    const filter = ctx.createBiquadFilter();
                    filter.type = 'bandpass';
                    filter.frequency.value = 420;
                    filter.Q.value = 1.2;

                    const swellGain = ctx.createGain();
                    swellGain.gain.value = 0.55;

                    const lfo = ctx.createOscillator();
                    lfo.frequency.value = 0.11; // ~9 segons per onada
                    const lfoGain = ctx.createGain();
                    lfoGain.gain.value = 260;
                    lfo.connect(lfoGain);
                    lfoGain.connect(filter.frequency);

                    const lfoAmp = ctx.createGain();
                    lfoAmp.gain.value = 0.35;
                    lfo.connect(lfoAmp);
                    lfoAmp.connect(swellGain.gain);

                    noise.connect(filter);
                    filter.connect(swellGain);
                    swellGain.connect(masterGain);

                    noise.start();
                    lfo.start();
                    nodes.push(noise, lfo);

                } else if (type === 'binaural') {
                    // Ona binaural Alfa (432Hz i 440Hz -> 8Hz beat) per concentració màxima
                    const osc1 = ctx.createOscillator();
                    const osc2 = ctx.createOscillator();
                    const subOsc = ctx.createOscillator();
                    osc1.type = 'sine';
                    osc2.type = 'sine';
                    subOsc.type = 'sine';

                    osc1.frequency.value = 432;
                    osc2.frequency.value = 440; // 8Hz diferència
                    subOsc.frequency.value = 216;

                    const g1 = ctx.createGain();
                    const g2 = ctx.createGain();
                    const gSub = ctx.createGain();
                    g1.gain.value = 0.22;
                    g2.gain.value = 0.22;
                    gSub.gain.value = 0.12;

                    osc1.connect(g1);
                    osc2.connect(g2);
                    subOsc.connect(gSub);

                    g1.connect(masterGain);
                    g2.connect(masterGain);
                    gSub.connect(masterGain);

                    osc1.start();
                    osc2.start();
                    subOsc.start();
                    nodes.push(osc1, osc2, subOsc);

                } else if (type === 'lofi') {
                    // Fons càlid relaxant amb tocs suaus d'escala pentatònica (E minor)
                    const bufferSize = ctx.sampleRate * 2;
                    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
                    const data = buffer.getChannelData(0);
                    for (let i = 0; i < bufferSize; i++) {
                        data[i] = (Math.random() * 2 - 1) * 0.04;
                    }
                    const noise = ctx.createBufferSource();
                    noise.buffer = buffer;
                    noise.loop = true;
                    const filter = ctx.createBiquadFilter();
                    filter.type = 'lowpass';
                    filter.frequency.value = 350;
                    noise.connect(filter);
                    filter.connect(masterGain);
                    noise.start();
                    nodes.push(noise);

                    const notes = [329.63, 392.00, 440.00, 493.88, 587.33, 659.25];
                    const chimeInt = setInterval(() => {
                        if (!activeAudioSynth || activeAudioSynth.ctx !== ctx) {
                            clearInterval(chimeInt);
                            return;
                        }
                        try {
                            const freq = notes[Math.floor(Math.random() * notes.length)];
                            const osc = ctx.createOscillator();
                            const g = ctx.createGain();
                            osc.type = 'sine';
                            osc.frequency.setValueAtTime(freq, ctx.currentTime);
                            g.gain.setValueAtTime(0.0001, ctx.currentTime);
                            g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.06);
                            g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 2.4);
                            osc.connect(g);
                            g.connect(masterGain);
                            osc.start();
                            osc.stop(ctx.currentTime + 2.5);
                        } catch(e) {}
                    }, 2400);
                    intervals.push(chimeInt);

                } else if (type === 'bell') {
                    // Bol tibetà harmònic (acord additiu amb caiguda ressonant llarga)
                    const freqs = [216, 432, 648, 864];
                    const weights = [0.35, 0.22, 0.12, 0.06];
                    freqs.forEach((f, idx) => {
                        const osc = ctx.createOscillator();
                        const g = ctx.createGain();
                        osc.type = 'sine';
                        osc.frequency.value = f;
                        g.gain.setValueAtTime(0.001, ctx.currentTime);
                        g.gain.linearRampToValueAtTime(weights[idx], ctx.currentTime + 0.08);
                        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 7.5);
                        osc.connect(g);
                        g.connect(masterGain);
                        osc.start();
                        osc.stop(ctx.currentTime + 8);
                        nodes.push(osc);
                    });
                }

                currentActiveSound = type;
                activeAudioSynth = { ctx, masterGain, nodes, intervals };

                const label = document.getElementById('active-sound-label');
                if (label) label.innerText = '🔊 Actiu: ' + type;
                showToast('🎶 Reproduint so ambiental: ' + type);
            } catch(e) {
                console.error('Error inicialitzant audio:', e);
                showToast('Error en reproduir so: ' + e.message, 'error');
            }
        };

        window.stopAmbientSound = function(showFeedback = true) {
            if (activeAudioSynth) {
                try {
                    if (activeAudioSynth.intervals) {
                        activeAudioSynth.intervals.forEach(id => clearInterval(id));
                    }
                    if (activeAudioSynth.nodes) {
                        activeAudioSynth.nodes.forEach(n => {
                            try { n.stop(); } catch(e) {}
                        });
                    }
                    activeAudioSynth.ctx.close();
                } catch(e) {}
                activeAudioSynth = null;
                currentActiveSound = null;
                const label = document.getElementById('active-sound-label');
                if (label) label.innerText = '🔇 En silenci';
                if (showFeedback) showToast('🔇 So ambiental aturat.');
            }
        };

        // --- TÀCTIQUES D'ESTUDI INTERACTIVES ---
        window.startFeynmanTactic = function() {
            setTutorMode('feynman');
            const topic = getCurrentChatTopic();
            const prompt = `Vull aplicar la Tècnica Feynman per consolidar el tema: "${topic}".\n\nCom a tutor intel·ligent:\n1. Fes-me la primera pregunta fonamental sobre aquest tema per comprovar si el domino.\n2. Demana'm que t'ho expliqui com si fossis un nen de 10 anys (sense tecnicismes).\n3. Després avalua la meva explicació i assenyala els buits de coneixement.`;
            
            appendMessage('user', `🧠 Iniciar Tècnica Feynman sobre: ${topic}`);
            chatHistory.push({ role: 'user', content: prompt });
            saveSession();
            triggerAiResponse();
            logStudentActivity('tactic', 'Tècnica Feynman iniciada', topic);
        };

        window.openBlurtingModal = function() {
            const topic = getCurrentChatTopic();
            let blurtingSeconds = 120;
            let blurtingInterval = null;

            const html = `
            <div class="mt-2 text-left space-y-3">
                <div class="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl flex items-center justify-between text-xs">
                    <div>
                        <span class="text-zinc-500 dark:text-zinc-400">Tema a bolcar:</span>
                        <div class="font-bold text-zinc-900 dark:text-zinc-100">${topic}</div>
                    </div>
                    <div class="font-mono text-2xl font-black text-emerald-600 dark:text-emerald-400 bg-white dark:bg-zinc-900 px-3 py-1 rounded-xl shadow-sm border border-emerald-100 dark:border-emerald-900" id="blurting-timer">
                        02:00
                    </div>
                </div>

                <div>
                    <label class="block text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1">
                        Escriu tot el que recordis sense mirar apunts (fórmules, idees, exemples, dates):
                    </label>
                    <textarea id="blurting-textarea" rows="6" placeholder="Escriu ràpidament el que tinguis al cap... No et preocupis per l'ortografia ni l'ordre!" class="w-full p-3 rounded-2xl border-2 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-100 text-xs sm:text-sm focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none transition-all resize-none shadow-inner"></textarea>
                </div>

                <div class="flex gap-2">
                    <button onclick="submitBlurtingChallenge('${topic}')" class="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold py-3 rounded-xl text-xs sm:text-sm transition shadow-md cursor-pointer">
                        🚀 Avaluar Memòria amb la IA
                    </button>
                    <button onclick="Swal.close()" class="bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 font-bold py-3 px-4 rounded-xl text-xs sm:text-sm transition">
                        Cancel·lar
                    </button>
                </div>
            </div>`;

            Swal.fire({
                title: '<div class="flex items-center justify-center gap-2 font-black text-zinc-900 dark:text-white">⚡ Repte Blurting (2 minuts)</div>',
                html: html,
                showCloseButton: true,
                showConfirmButton: false,
                customClass: { popup: 'rounded-[1.75rem] md:rounded-3xl dark:bg-zinc-900 dark:text-white border dark:border-zinc-800 max-w-lg w-full' },
                didOpen: () => {
                    const timerEl = document.getElementById('blurting-timer');
                    const textEl = document.getElementById('blurting-textarea');
                    if (textEl) textEl.focus();

                    blurtingInterval = setInterval(() => {
                        if (blurtingSeconds > 0) {
                            blurtingSeconds--;
                            const m = Math.floor(blurtingSeconds / 60);
                            const s = blurtingSeconds % 60;
                            if (timerEl) timerEl.innerText = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
                        } else {
                            clearInterval(blurtingInterval);
                            showToast('⏱️ Temps esgotat! Avaluant memòria...');
                            submitBlurtingChallenge(topic);
                        }
                    }, 1000);
                },
                willClose: () => {
                    if (blurtingInterval) clearInterval(blurtingInterval);
                }
            });
        };

        window.submitBlurtingChallenge = function(topic) {
            const textarea = document.getElementById('blurting-textarea');
            const studentText = textarea ? textarea.value.trim() : '';
            Swal.close();

            if (!studentText) {
                showToast('Has deixat el text buit. Prova-ho de nou quan estiguis preparat/da.', 'info');
                return;
            }

            const prompt = `⚡ REPTE DE BLURTING (VOLCAT DE MEMÒRIA EN 2 MINUTS) COMPLETAT:
Tema: "${topic}"
El que he recordat sense mirar apunts:
"""${studentText}"""

Com a tutor pedagògic d'elit, avalua el meu volcat de memòria de manera clara i estructurada:
1. 🎯 **Conceptes dominats**: Què he recordat correctament?
2. ⚠️ **Buidor i omissions crítiques**: Quines idees fonamentals m'he deixat?
3. 💡 **Pregunta clau de reforç**: Una pregunta pràctica per fixar el que he omès.`;

            appendMessage('user', `⚡ Repte Blurting completat sobre: ${topic}\n\n"${studentText}"`);
            chatHistory.push({ role: 'user', content: prompt });
            saveSession();
            triggerAiResponse();
            logStudentActivity('blurting', 'Repte Blurting 2 minuts', topic);
        };

        window.generateCornellNotes = function() {
            const topic = getCurrentChatTopic();
            const prompt = `Genera un resum exhaustiu i d'alt rendiment sobre "${topic}" seguint el mètode d'Apunts Cornell:
1. 📌 **Columna d'Idees Clau & Preguntes d'Examen** (Termes essencials i preguntes probables d'examen).
2. 📖 **Notes i Explicacions Detallades** (Fórmules, causes/conseqüències i definicions precises).
3. 📝 **Resum Executiu Inferior** (Síntesi d'alt impacte en 3 frases per repàs immediat).`;

            appendMessage('user', `📝 Generar Apunts en Format Cornell sobre: ${topic}`);
            chatHistory.push({ role: 'user', content: prompt });
            saveSession();
            triggerAiResponse();
            logStudentActivity('tactic', 'Format Cornell generat', topic);
        };

        function cleanTopicTitle(raw) {
            if (!raw) return "";
            let s = String(raw)
                .replace(/\.[a-zA-Z0-9]{2,4}$/i, '') // Treure extensió .pdf, .txt
                .replace(/[_\-\+]+/g, ' ')           // Convertir guions a espais
                .replace(/\s+/g, ' ')                // Treure espais duplicats
                .replace(/[\.\,\:\;…]+$/g, '')        // Treure punts finals o suspensius
                .trim();

            if (!s) return "";
            
            // Si el text està tot en MAJÚSCULES (ex: "PREGUNTES SOBRE LA PEL·LÍ")
            if (s.length > 3 && s === s.toUpperCase()) {
                s = s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
            } else {
                s = s.charAt(0).toUpperCase() + s.slice(1);
            }

            // Evitar talls estranys de paraules
            if (s.length > 28) {
                let cut = s.substring(0, 26);
                let lastSpace = cut.lastIndexOf(' ');
                if (lastSpace > 14) cut = cut.substring(0, lastSpace);
                s = cut.trim() + '…';
            }
            return s;
        }
        window.cleanTopicTitle = cleanTopicTitle;

        function updateHeaderButtonsVisibility() {
            const isStudy = (appMode === 'study');
            const btns = ['calendar-header-btn', 'tools-header-btn', 'memory-header-btn', 'history-header-btn'];
            btns.forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    if (isStudy) {
                        el.classList.remove('hidden');
                    } else {
                        el.classList.add('hidden');
                    }
                }
            });

            // Opció Modes d'Estudi al menú (+) : VISIBLE EN XAT LLIURE
            const plusModesSection = document.getElementById('plus-menu-modes-section');
            if (plusModesSection) {
                if (appMode === 'free') {
                    plusModesSection.classList.remove('hidden');
                } else {
                    plusModesSection.classList.add('hidden');
                }
            }

            // Al header: En xat lliure només es mostra si s'ha activat la sessió Pomodoro (o si està corrent o amb temps restant menor al total)
            const headerPomoPill = document.getElementById('header-pomodoro-pill');
            if (headerPomoPill) {
                if (isStudy) {
                    headerPomoPill.classList.remove('hidden');
                } else {
                    // En xat lliure només si està actiu / iniciat pel menú (+)
                    if (pomodoroIsRunning || (pomodoroTimeLeft < pomodoroTotalDuration && pomodoroTimeLeft > 0)) {
                        headerPomoPill.classList.remove('hidden');
                    } else {
                        headerPomoPill.classList.add('hidden');
                    }
                }
            }
        }
        window.updateHeaderButtonsVisibility = updateHeaderButtonsVisibility;

        window.activateStudyModeFromPlus = function(mode) {
            setPomodoroMode(mode);
            // Fer visible el pill a la barra de dalt
            const headerPill = document.getElementById('header-pomodoro-pill');
            if (headerPill) headerPill.classList.remove('hidden');

            if (!pomodoroIsRunning) {
                togglePomodoroTimer();
            }
            closePlusMenu();
            showToast(`⏱️ Mode activat: ${mode === 'classic' ? 'Clàssic (25m)' : mode === 'deep' ? 'Focus (50m)' : mode === 'short' ? 'Pausa (5m)' : `Personalitzat (${pomodoroCustomMinutes}m)`}`);
        };

        window.openPomodoroFromPlusMenu = function() {
            // Assegurem que el pill de la capçalera sigui visible per mostrar el temps
            const headerPill = document.getElementById('header-pomodoro-pill');
            if (headerPill) headerPill.classList.remove('hidden');
            
            // Si el temporitzador no estava en marxa, l'iniciem directament per conveniència i obrim el panell
            if (!pomodoroIsRunning) {
                togglePomodoroTimer();
            }
            openPomodoroModal();
        };

        function generateSmartTitle(existingSession) {
            const isCurrent = !existingSession || (existingSession && existingSession.id === currentSessionId);
            const sess = existingSession || allSessions.find(s => s.id === currentSessionId);

            // 1. Si la sessió ja té un títol personalitzat vàlid (ex: nom del PDF o tema de l'examen)
            if (sess && sess.title) {
                let t = sess.title.trim();
                if (!['Nova Conversa', 'Classe Activa', 'XatBot', "Pla d'Estudis", "XatBot Lliure"].includes(t) && !t.toLowerCase().startsWith('hola') && !t.toLowerCase().includes('comencem la primera')) {
                    let cleaned = cleanTopicTitle(t);
                    if (cleaned.length >= 3) return cleaned;
                }
            }

            // 2. Si la pròpia sessió té arxius/PDFs associats
            if (sess && Array.isArray(sess.files) && sess.files.length > 0) {
                const pdfFile = sess.files.find(f => f && f.name && f.name.toLowerCase().endsWith('.pdf')) || sess.files[0];
                if (pdfFile && pdfFile.name) {
                    let cleaned = cleanTopicTitle(pdfFile.name);
                    if (cleaned.length >= 3) return cleaned;
                }
            }

            // 3. Si la sessió té un calendari d'estudi amb un tema específic
            const cal = (sess && sess.calendar) || (isCurrent ? generatedCalendarArray : []);
            if (Array.isArray(cal) && cal.length > 0) {
                const calItem = cal.find(c => c && c.tema && !c.tema.toLowerCase().includes('sessió 1: repàs') && !c.tema.toLowerCase().includes('estudi i esquematització')) || cal[0];
                if (calItem && calItem.tema && calItem.tema.trim().length > 2) {
                    let t = calItem.tema.trim()
                        .replace(/^Sessió \d+:\s*/i, '')
                        .replace(/^Tema \d+:\s*/i, '')
                        .replace(/^Mòdul \d+:\s*/i, '')
                        .trim();
                    let cleaned = cleanTopicTitle(t);
                    if (cleaned && cleaned.length >= 3) return cleaned;
                }
            }

            // 4. Revisar l'historial de missatges de LA SESSIÓ
            const hist = (sess && (sess.history || sess.chat_history)) || (isCurrent ? chatHistory : []);
            if (Array.isArray(hist) && hist.length > 0) {
                for (let i = 0; i < hist.length; i++) {
                    const msg = hist[i];
                    if (msg && msg.role === 'user' && typeof msg.content === 'string') {
                        let text = msg.content.replace(/<[^>]*>/g, '').trim();
                        
                        const tm = text.match(/(?:baralla Anki de|diagrama sobre|resum sobre|preguntes sobre|repàs de|explicació de):?\s*(.+)$/i);
                        if (tm && tm[1]) {
                            let extracted = cleanTopicTitle(tm[1]);
                            if (extracted.length >= 3) return extracted;
                        }

                        if (/comencem la primera|estic preparat/i.test(text)) continue;

                        let clean = text
                            .replace(/^(Hola tutor!?|Hola|Bon dia|Bona tarda|Vull saber|Pots explicar-me|Explica'm|Explica|Com funciona|Què és|Quina diferència hi ha entre|Quins són|Quines són|Pregunta:|Dubte:)\s+/i, '')
                            .replace(/[\?\!\.\:\;…]+$/g, '')
                            .trim();

                        if (clean.length >= 3 && !/^(hola|comencem|bon dia|bona tarda)/i.test(clean)) {
                            let extracted = cleanTopicTitle(clean);
                            if (extracted.length >= 3) return extracted;
                        }
                    }
                }

                for (const msg of hist) {
                    if (msg && (msg.role === 'assistant' || msg.role === 'model') && typeof msg.content === 'string') {
                        const m = msg.content.match(/(?:###|\*\*|Tema:|Concepte:|Lliçó:)\s*([^\n\*\#]{4,35})/i);
                        if (m && m[1]) {
                            const c = m[1].trim();
                            if (!/comencem|primera sessió|hola|benvingut|tutor/i.test(c)) {
                                let extracted = cleanTopicTitle(c);
                                if (extracted.length >= 3) return extracted;
                            }
                        }
                    }
                }
            }

            // 5. NOMÉS si és la sessió que s'està CREANT EN AQUEST MOMENT (isCurrent):
            if (isCurrent) {
                if (Array.isArray(uploadedPDFs) && uploadedPDFs.length > 0 && uploadedPDFs[0].name) {
                    let cleaned = cleanTopicTitle(uploadedPDFs[0].name);
                    if (cleaned.length >= 3) return cleaned;
                }
                let manual = document.getElementById('manual-topic')?.value?.trim();
                if (manual && manual.length > 2) return cleanTopicTitle(manual);
            }

            const isStudy = (sess && sess.mode === 'study') || (isCurrent && appMode === 'study');
            return isStudy ? "Pla d'Estudis" : "XatBot Lliure";
        }
        window.generateSmartTitle = generateSmartTitle;

        function safeLocalStorageSet(key, value) {
            try {
                localStorage.setItem(key, value);
            } catch (e) {
                console.warn(`LocalStorage quota exceeded for ${key}, trimming backups...`);
                try {
                    if (key === 'aliat_sessions_backup' && Array.isArray(allSessions)) {
                        const slimSessions = allSessions.map(s => {
                            const copy = { ...s };
                            delete copy.html; // HTML can be restored from history
                            if (Array.isArray(copy.history)) {
                                copy.history = copy.history.map(m => {
                                    if (m && m.image && m.image.length > 300) {
                                        return { ...m, image: '[ATTACHMENT]' };
                                    }
                                    return m;
                                });
                            }
                            if (Array.isArray(copy.files)) {
                                copy.files = copy.files.map(f => {
                                    if (f && f.src && f.src.length > 300) {
                                        return { ...f, src: '' };
                                    }
                                    return f;
                                });
                            }
                            return copy;
                        });
                        localStorage.setItem('aliat_sessions_backup', JSON.stringify(slimSessions));
                    }
                } catch (e2) {
                    console.warn('Failed to save slim backup to localStorage:', e2);
                }
            }
        }

        window.showDailyUseBlockedModal = function() {
            Swal.fire({
                title: '<div class="flex items-center justify-center gap-2 text-red-600 dark:text-red-400"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg> Ús Quotidià Bloquejat</div>',
                text: 'Aquesta secció està en desenvolupament i estarà disponible pròximament en la següent actualització.',
                icon: 'info',
                confirmButtonText: 'Entesos',
                confirmButtonColor: '#ef4444',
                background: document.documentElement.classList.contains('dark') ? '#18181b' : '#fff',
                color: document.documentElement.classList.contains('dark') ? '#f4f4f5' : '#18181b',
                customClass: { popup: 'rounded-3xl border dark:border-zinc-800' }
            });
        };

        function saveSession() {
            // Assegurem que el xat té un ID abans d'enviar-lo al servidor
            if (!currentSessionId || currentSessionId === 'null') {
                currentSessionId = 'sess_' + Date.now();
                safeLocalStorageSet('aliat_current_id', currentSessionId);
            }

            const activeSession = allSessions.find(s => s.id === currentSessionId);
            const currentTitle = generateSmartTitle(activeSession);
            
            const chatLabel = document.getElementById('chat-mode-label');
            if (chatLabel) chatLabel.innerText = currentTitle;
            
            const existingFiles = (activeSession && Array.isArray(activeSession.files)) ? activeSession.files : [];

            const sessionData = { 
                id: currentSessionId, 
                mode: appMode, 
                title: currentTitle, 
                history: chatHistory, 
                chat_history: chatHistory, 
                files: existingFiles,
                calendar: generatedCalendarArray, 
                peak_time: selectedPeakTime,
                games: window.interactiveGames, 
                initial_quiz: window.initialQuizResults || null,
                html: document.getElementById('chat-messages')?.innerHTML || '', 
                context: studentContextStr, 
                pdf_text: finalStudyText, 
                date: new Date().getTime() 
            };
            
            const idx = allSessions.findIndex(s => s.id === currentSessionId);
            if (idx >= 0) {
                allSessions[idx] = { ...allSessions[idx], ...sessionData };
            } else {
                allSessions.push(sessionData);
            }
            
            safeLocalStorageSet('aliat_sessions_backup', JSON.stringify(allSessions));
            renderSidebarHistory(); 
            saveSessionToCloud(sessionData);
            
            safeLocalStorageSet('aliat_local_html_' + currentSessionId, sessionData.html); 
            safeLocalStorageSet('aliat_local_context_' + currentSessionId, studentContextStr); 
            safeLocalStorageSet('aliat_local_text_' + currentSessionId, finalStudyText);
            if (window.initialQuizResults) {
                safeLocalStorageSet('aliat_initial_quiz_' + currentSessionId, JSON.stringify(window.initialQuizResults));
            }
        }

        async function syncCloudSessions(isBackground = false) {
            if (!authToken) return;
            try {
                const res = await fetch('/api/sessions/get?t=' + Date.now(), { 
                    headers: { 'Authorization': 'Bearer ' + authToken } 
                });
                
                if (!res.ok) {
                    if (res.status === 401) return logout();
                    return;
                }

                const data = await res.json();
                
                if (data.success && Array.isArray(data.sessions)) {
                    const cloudSessions = data.sessions;
                    
                    // Estratègia de combinació segura: Mai esborrar converses locals si el núvol en té menys o està buit
                    const sessionMap = new Map();
                    
                    // 1. Guardar les sessions locals primer
                    if (Array.isArray(allSessions)) {
                        allSessions.forEach(s => {
                            if (s && s.id) sessionMap.set(s.id, s);
                        });
                    }

                    // 2. Fusionar amb les del núvol respectant canvis recents
                    cloudSessions.forEach(cs => {
                        if (!cs || !cs.id) return;
                        const local = sessionMap.get(cs.id);
                        if (!local) {
                            sessionMap.set(cs.id, cs);
                        } else {
                            const localDate = local.date || (local.updated_at ? new Date(local.updated_at).getTime() : 0);
                            const cloudDate = cs.date || (cs.updated_at ? new Date(cs.updated_at).getTime() : 0);
                            
                            // Si el local té canvis més recents o fitxers addicionals, conservar-los
                            if (localDate > cloudDate + 2000) {
                                const merged = { ...cs, ...local };
                                if (Array.isArray(local.files) && local.files.length > 0) merged.files = local.files;
                                sessionMap.set(cs.id, merged);
                                saveSessionToCloud(merged);
                            } else {
                                const merged = { ...local, ...cs };
                                if (Array.isArray(local.files) && local.files.length > 0 && (!merged.files || merged.files.length === 0)) {
                                    merged.files = local.files;
                                }
                                sessionMap.set(cs.id, merged);
                            }
                        }
                    });

                    // 3. Si hi ha alguna sessió local amb contingut que encara no és al núvol, pujar-la
                    sessionMap.forEach(s => {
                        const inCloud = cloudSessions.some(cs => cs.id === s.id);
                        if (!inCloud && ((s.history && s.history.length > 0) || (s.calendar && s.calendar.length > 0) || (s.pdf_text && s.pdf_text.length > 0))) {
                            saveSessionToCloud(s);
                        }
                    });

                    allSessions = Array.from(sessionMap.values());
                    safeLocalStorageSet('aliat_sessions_backup', JSON.stringify(allSessions));
                    
                    let sessionExists = allSessions.find(s => s.id === currentSessionId);
                    if (!sessionExists && allSessions.length > 0 && chatHistory.length === 0) { 
                        currentSessionId = allSessions[0].id; 
                        safeLocalStorageSet('aliat_current_id', currentSessionId); 
                        if (!isBackground) loadActiveSessionData(); 
                    }
                    renderSidebarHistory(); 
                }
            } catch(e) {
                console.warn('Sync cloud error:', e);
            }
        }

        async function saveSessionToCloud(sessionData) {
            if (!authToken || !sessionData || !sessionData.id) return;
            try {
                const res = await fetch('/api/sessions/save', {
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
                    body: JSON.stringify(sessionData)
                });
                
                if (!res.ok) {
                    return;
                }

                const data = await res.json();
                if (data.success) {
                    // Sync silent
                }
            } catch (e) { 
                console.warn('Error guardant al núvol:', e);
            }
        }

        function loadActiveSessionData() {
            let activeSession = allSessions.find(s => s.id === currentSessionId);
            if (!activeSession) {
                try {
                    const backup = JSON.parse(localStorage.getItem('aliat_sessions_backup') || '[]');
                    activeSession = backup.find(s => s.id === currentSessionId);
                } catch(e) {}
            }

            if (activeSession) {
                chatHistory = activeSession.history || activeSession.chat_history || [];
                generatedCalendarArray = activeSession.calendar || [];
                selectedPeakTime = activeSession.peak_time || 'mati';
                const peakRadio = document.querySelector(`.peak-time-radio[value="${selectedPeakTime}"]`);
                if (peakRadio) {
                    peakRadio.checked = true;
                    if (typeof updatePeakTimeUI === 'function') updatePeakTimeUI();
                }
                window.interactiveGames = activeSession.games || {}; 
                
                // Determinació robusta del mode: Si té calendari o apunts o quiz, és Pla d'Estudis
                const isStudy = (activeSession.mode === 'study') || 
                                (generatedCalendarArray && generatedCalendarArray.length > 0) || 
                                (activeSession.pdf_text && activeSession.pdf_text.length > 0) ||
                                (activeSession.initial_quiz);
                appMode = isStudy ? 'study' : (activeSession.mode || 'study');
                
                studentContextStr = activeSession.context || localStorage.getItem('aliat_local_context_' + currentSessionId) || "";
                finalStudyText = activeSession.pdf_text || localStorage.getItem('aliat_local_text_' + currentSessionId) || "";
                window.initialQuizResults = activeSession.initial_quiz || null;
                if (!window.initialQuizResults) {
                    try {
                        const localQuiz = localStorage.getItem('aliat_initial_quiz_' + currentSessionId);
                        if (localQuiz) window.initialQuizResults = JSON.parse(localQuiz);
                    } catch (e) {}
                }
                
                document.getElementById('chat-messages').innerHTML = activeSession.html || localStorage.getItem('aliat_local_html_' + currentSessionId) || '';
                
                document.getElementById('welcome-view').classList.add('hidden');
                document.getElementById('setup-view').classList.add('hidden');
                document.getElementById('setup-view').classList.remove('flex');
                document.getElementById('quiz-view')?.classList.add('hidden');
                document.getElementById('quiz-view')?.classList.remove('flex');

                document.getElementById('global-menu-btn').classList.add('hidden');
                document.getElementById('chat-view').classList.remove('hidden');
                document.getElementById('chat-view').classList.add('flex');
                document.getElementById('chat-form').classList.remove('hidden');
                
                let displayTitle = generateSmartTitle(activeSession);
                activeSession.title = displayTitle;
                document.getElementById('chat-mode-label').innerText = displayTitle;

                isCurrentChatPinned = !!activeSession.pinned;
                const pinLabel = document.getElementById('header-menu-pin-label');
                if (pinLabel) pinLabel.innerText = isCurrentChatPinned ? 'Desfixar conversa' : 'Fixar conversa';

                updateHeaderButtonsVisibility();
                document.getElementById('chat-toolbar-bottom')?.classList.remove('hidden');
                
                setTimeout(() => {
                    const msgBox = document.getElementById('chat-messages');
                    if(msgBox) msgBox.scrollTop = msgBox.scrollHeight;
                }, 100);
            }
        }
        // CARREGA INSTANTÀNIA SENSE RECARREGAR LA PÀGINA
        function isSessionEmpty(sessionOrId) {
            let session = typeof sessionOrId === 'object' && sessionOrId !== null
                ? sessionOrId 
                : allSessions.find(s => s.id === sessionOrId);
                
            if (!session) {
                const hasUserMessages = chatHistory && chatHistory.some(m => m.role === 'user');
                const hasCalendar = generatedCalendarArray && generatedCalendarArray.length > 0;
                const hasPdfs = uploadedPDFs && uploadedPDFs.length > 0;
                return !hasUserMessages && !hasCalendar && !hasPdfs;
            }
            
            const history = session.history || session.chat_history || [];
            const hasUserMessages = history.some(m => m.role === 'user');
            const hasCalendar = session.calendar && session.calendar.length > 0;
            return !hasUserMessages && !hasCalendar;
        }

        async function cleanupCurrentSessionIfEmpty() {
            if (!currentSessionId) return;
            const activeSession = allSessions.find(s => s.id === currentSessionId);
            const history = (activeSession && activeSession.history) || chatHistory || [];
            const hasAnyMessages = Array.isArray(history) && history.length > 0;
            const hasCalendar = (activeSession && activeSession.calendar && activeSession.calendar.length > 0) || (generatedCalendarArray && generatedCalendarArray.length > 0);
            const hasPdfs = (activeSession && activeSession.pdf_text && activeSession.pdf_text.length > 0) || (uploadedPDFs && uploadedPDFs.length > 0);
            const hasHtml = activeSession && activeSession.html && activeSession.html.length > 100;
            const hasCustomTitle = activeSession && activeSession.title && !['Nova Conversa', "Pla d'Estudis", 'XatBot Lliure'].includes(activeSession.title);

            // Only delete if truly completely empty with no interaction whatsoever
            if (!hasAnyMessages && !hasCalendar && !hasPdfs && !hasHtml && !hasCustomTitle) {
                const idToDelete = currentSessionId;
                allSessions = allSessions.filter(s => s.id !== idToDelete);
                safeLocalStorageSet('aliat_sessions_backup', JSON.stringify(allSessions));
                localStorage.removeItem('aliat_local_html_' + idToDelete);
                localStorage.removeItem('aliat_local_context_' + idToDelete);
                localStorage.removeItem('aliat_local_text_' + idToDelete);
                localStorage.removeItem('aliat_student_memory_' + idToDelete);
                if (authToken) {
                    try {
                        fetch('/api/sessions/delete', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
                            body: JSON.stringify({ id: idToDelete })
                        }).catch(() => {});
                    } catch(e) {}
                }
            }
        }

        window.loadSession = async function(id) { 
            if (currentSessionId && currentSessionId !== id) {
                await cleanupCurrentSessionIfEmpty();
            }
            safeLocalStorageSet('aliat_current_id', id); 
            currentSessionId = id;
            renderSidebarHistory(); 
            loadActiveSessionData();

            if (window.innerWidth < 768) {
                const sidebar = document.getElementById('sidebar');
                if (sidebar && !sidebar.classList.contains('-translate-x-full')) {
                    toggleSidebar();
                }
            }
        }

        window.newSession = async function() {
            // Esborrar sessió prèvia només si era completament buida abans de crear-ne una de nova
            await cleanupCurrentSessionIfEmpty();

            currentSessionId = 'sess_' + Date.now();
            safeLocalStorageSet('aliat_current_id', currentSessionId);
            
            chatHistory = [];
            generatedCalendarArray = [];
            window.interactiveGames = {};
            window.initialQuizResults = null;
            studentContextStr = "";
            finalStudyText = "";
            appMode = 'none';

            document.getElementById('chat-messages').innerHTML = '';
            document.getElementById('pdf-upload').value = '';
            document.getElementById('pdf-list').innerHTML = '';
            uploadedPDFs = [];
            
            const manualTopic = document.getElementById('manual-topic');
            if (manualTopic) manualTopic.value = '';

            document.getElementById('chat-view').classList.add('hidden');
            document.getElementById('chat-view').classList.remove('flex');
            document.getElementById('setup-view').classList.add('hidden');
            document.getElementById('setup-view').classList.remove('flex');
            document.getElementById('quiz-view').classList.add('hidden');
            document.getElementById('quiz-view').classList.remove('flex');
            
            document.getElementById('welcome-view').classList.remove('hidden');
            document.getElementById('global-menu-btn').classList.remove('hidden');

            if(window.innerWidth < 768) {
                const sidebar = document.getElementById('sidebar');
                if (!sidebar.classList.contains('-translate-x-full')) {
                    toggleSidebar();
                }
            }
            
            renderSidebarHistory();
        }

        function renderSidebarHistory() {
            const list = document.getElementById('history-list');
            if (!list) return;
            list.innerHTML = '';
            
            // Conservem totes les sessions vàlides: ordenem primer les fixades (pinned) i després per data
            const sortedSessions = [...allSessions].filter(s => s && s.id).sort((a, b) => {
                if (Boolean(b.pinned) !== Boolean(a.pinned)) {
                    return b.pinned ? 1 : -1;
                }
                return (b.date || 0) - (a.date || 0);
            });

            if (sortedSessions.length === 0) {
                list.innerHTML = '<div class="text-xs text-zinc-500 dark:text-zinc-400 px-3 py-3.5 italic rounded-2xl bg-zinc-100/70 dark:bg-zinc-900/50 border border-zinc-200/80 dark:border-zinc-800/60 text-center">Cap conversa guardada</div>';
                return;
            }

            // Mostrem només les 4 més recents al menú desplegable per no saturar la vista
            const recentSessions = sortedSessions.slice(0, 4);

            recentSessions.forEach(s => {
                const isStudy = (s.mode === 'study') || 
                                (s.calendar && s.calendar.length > 0) || 
                                (s.pdf_text && s.pdf_text.length > 0) ||
                                (s.initial_quiz);
                let title = generateSmartTitle(s);
                s.title = title;
                if (s.id === currentSessionId) {
                    const label = document.getElementById('chat-mode-label');
                    if (label) label.innerText = title;
                }
                let dateStr = s.date ? new Date(s.date).toLocaleDateString('ca-ES', { day: '2-digit', month: 'short' }) : '';
                
                const iconSvg = isStudy 
                    ? `<span class="w-7 h-7 rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 border border-blue-500/20"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg></span>`
                    : `<span class="w-7 h-7 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/20"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span>`;

                let activeClass = (s.id === currentSessionId) 
                    ? "bg-blue-50 text-blue-900 dark:bg-zinc-800 dark:text-white font-semibold border border-blue-200/90 dark:border-zinc-700" 
                    : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 hover:text-zinc-950 dark:hover:text-white font-medium border border-transparent";

                list.innerHTML += `
                    <div class="relative group mb-1 w-full flex justify-center">
                        <button onclick="loadSession('${s.id}')" class="w-full py-2 px-2.5 rounded-xl text-xs truncate transition-all duration-200 ${activeClass} flex items-center justify-start gap-2.5 pr-8 cursor-pointer">
                            ${iconSvg}
                            <span class="truncate flex-1 tracking-tight font-medium text-zinc-900 dark:text-zinc-100 text-left min-w-0">
                                <span class="truncate">${title}</span>
                            </span>
                            <span class="text-[10px] text-zinc-500 dark:text-zinc-400 shrink-0 group-hover:hidden flex items-center gap-1">
                                ${s.pinned ? `<svg class="w-3 h-3 text-amber-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" title="Conversa fixada"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14l-1.5-6H6.5L5 17z" fill="currentColor"/><path d="M9 11V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v7" fill="currentColor"/></svg>` : ''}
                                <span>${dateStr}</span>
                            </span>
                        </button>
                        <button onclick="deleteSession('${s.id}')" class="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-red-500 hover:bg-red-500/15 rounded-lg opacity-0 group-hover:opacity-100 transition-all z-10 cursor-pointer" title="Eliminar conversa">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </div>
                `;
            });

            if (sortedSessions.length > 4) {
                list.innerHTML += `
                    <button onclick="openChatHistoryModal()" class="w-full py-2 px-3 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded-xl transition flex items-center justify-center gap-1.5 mt-1.5 cursor-pointer border border-indigo-200/80 dark:border-indigo-800/60">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        <span>Veure tot l'historial (${sortedSessions.length})</span>
                    </button>
                `;
            }
        }

        window.openChatHistoryModal = function() {
            const modal = document.getElementById('chat-history-modal');
            if (!modal) return;
            const searchInput = document.getElementById('chat-history-search');
            if (searchInput) searchInput.value = '';
            renderChatHistoryModalList(allSessions);
            modal.classList.remove('hidden');
            setTimeout(() => {
                modal.classList.remove('opacity-0');
                document.getElementById('chat-history-modal-box')?.classList.remove('scale-95');
            }, 10);
        };

        window.closeChatHistoryModal = function() {
            const modal = document.getElementById('chat-history-modal');
            if (!modal) return;
            modal.classList.add('opacity-0');
            document.getElementById('chat-history-modal-box')?.classList.add('scale-95');
            setTimeout(() => {
                modal.classList.add('hidden');
            }, 300);
        };

        window.filterChatHistoryModal = function(query) {
            const q = (query || '').toLowerCase().trim();
            if (!q) {
                renderChatHistoryModalList(allSessions);
                return;
            }
            const filtered = allSessions.filter(s => {
                const title = (s.title || generateSmartTitle(s)).toLowerCase();
                const text = (s.pdf_text || '').toLowerCase();
                return title.includes(q) || text.includes(q);
            });
            renderChatHistoryModalList(filtered);
        };

        function renderChatHistoryModalList(sessionsList) {
            const container = document.getElementById('chat-history-modal-list');
            if (!container) return;
            container.innerHTML = '';
            
            const sorted = [...(sessionsList || [])].sort((a, b) => {
                if (Boolean(b.pinned) !== Boolean(a.pinned)) {
                    return b.pinned ? 1 : -1;
                }
                return (b.date || 0) - (a.date || 0);
            });
            
            if (sorted.length === 0) {
                container.innerHTML = `
                    <div class="text-center py-10 px-4">
                        <div class="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 text-zinc-400 flex items-center justify-center mx-auto mb-3">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        </div>
                        <p class="text-sm font-bold text-zinc-700 dark:text-zinc-300">Cap conversa trobada</p>
                        <p class="text-xs text-zinc-500 dark:text-zinc-400 mt-1">Navega o inicia un nou xat amb el botó superior.</p>
                    </div>
                `;
                return;
            }

            sorted.forEach(s => {
                const isStudy = (s.mode === 'study') || (s.calendar && s.calendar.length > 0) || (s.pdf_text && s.pdf_text.length > 0) || (s.initial_quiz);
                const title = s.title || generateSmartTitle(s);
                const dateStr = s.date ? new Date(s.date).toLocaleDateString('ca-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Recent';
                const isActive = (s.id === currentSessionId);
                
                const badgeMode = isStudy 
                    ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/50 flex items-center gap-1"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg> Pla d'Estudis</span>`
                    : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50 flex items-center gap-1"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> XatBot Lliure</span>`;

                const activeRing = isActive ? 'border-2 border-indigo-500 dark:border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/20' : 'border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:border-indigo-300 dark:hover:border-zinc-700';

                container.innerHTML += `
                    <div class="p-3.5 rounded-2xl transition-all duration-200 ${activeRing} flex items-center justify-between gap-3 group">
                        <div onclick="loadSession('${s.id}'); closeChatHistoryModal();" class="flex items-start gap-3 flex-1 min-w-0 cursor-pointer">
                            <div class="w-10 h-10 rounded-xl ${isStudy ? 'bg-blue-600/10 text-blue-600 dark:text-blue-400' : 'bg-emerald-600/10 text-emerald-600 dark:text-emerald-400'} flex items-center justify-center shrink-0 font-bold border ${isStudy ? 'border-blue-200 dark:border-blue-900/50' : 'border-emerald-200 dark:border-emerald-900/50'}">
                                ${isStudy 
                                    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>`
                                    : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`}
                            </div>
                            <div class="min-w-0 flex-1">
                                <div class="flex items-center gap-2 mb-1 flex-wrap">
                                    <h4 class="font-bold text-zinc-900 dark:text-zinc-100 text-sm truncate max-w-[240px] sm:max-w-xs">${title}</h4>
                                    ${badgeMode}
                                    ${isActive ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-600 text-white">ACTIU</span>` : ''}
                                </div>
                                <p class="text-[11px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5 font-medium">
                                    ${s.pinned ? `<svg class="w-3.5 h-3.5 text-amber-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" title="Conversa fixada"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14l-1.5-6H6.5L5 17z" fill="currentColor"/><path d="M9 11V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v7" fill="currentColor"/></svg>` : ''}
                                    <span>${dateStr}</span>
                                </p>
                            </div>
                        </div>
                        <div class="flex items-center gap-1 shrink-0">
                            <button onclick="loadSession('${s.id}'); closeChatHistoryModal();" class="p-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded-xl text-xs font-bold transition shadow-sm cursor-pointer flex items-center gap-1">
                                <span>Obrir</span>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                            </button>
                            <button onclick="deleteSession('${s.id}')" class="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl transition cursor-pointer" title="Eliminar conversa">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            </button>
                        </div>
                    </div>
                `;
            });
        }

        window.deleteSession = function(id) {
            Swal.fire({
                title: 'Eliminar conversa?',
                text: "No podràs revertir aquesta acció.",
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#ef4444',
                cancelButtonColor: '#3b82f6',
                confirmButtonText: 'Sí, eliminar',
                cancelButtonText: 'Cancel·lar',
                background: document.documentElement.classList.contains('dark') ? '#18181b' : '#fff',
                color: document.documentElement.classList.contains('dark') ? '#f4f4f5' : '#18181b',
                customClass: { popup: 'rounded-3xl border dark:border-zinc-800' }
            }).then(async (result) => {
                if (result.isConfirmed) {
                    // 1. Esborrar localment
                    allSessions = allSessions.filter(s => s.id !== id);
                    safeLocalStorageSet('aliat_sessions_backup', JSON.stringify(allSessions));
                    localStorage.removeItem('aliat_local_html_' + id);
                    localStorage.removeItem('aliat_local_context_' + id);
                    localStorage.removeItem('aliat_local_text_' + id);
                    localStorage.removeItem('aliat_student_memory_' + id);
                    
                    // 2. Si esborres el xat on estàs ara mateix, crear un de nou
                    if (currentSessionId === id) {
                        newSession();
                    } else {
                        renderSidebarHistory();
                    }
                    
                    const searchVal = document.getElementById('chat-history-search')?.value || '';
                    filterChatHistoryModal(searchVal);

                    // 3. Esborrar de Turso
                    try {
                        await fetch('/api/sessions/delete', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
                            body: JSON.stringify({ id: id })
                        });
                    } catch (e) { console.error(e); }
                }
            });
        }

        // --- SISTEMA DE PREFERÈNCIES (Tema i Sidebar) ---
        function initPreferences() {
            const savedTheme = localStorage.getItem('aliat_theme');
            if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                document.documentElement.classList.add('dark');
            } else {
                document.documentElement.classList.remove('dark');
            }
            updateThemeIcon();

            const sidebarCollapsed = localStorage.getItem('aliat_sidebar_collapsed');
            if (sidebarCollapsed === 'true' && window.innerWidth >= 768) {
                document.body.classList.add('sidebar-collapsed');
            }
        }

        function toggleTheme() {
            document.documentElement.classList.toggle('dark');
            const isDark = document.documentElement.classList.contains('dark');
            localStorage.setItem('aliat_theme', isDark ? 'dark' : 'light');
            updateThemeIcon();
        }

        function updateThemeIcon() {
            const isDark = document.documentElement.classList.contains('dark');
            const iconEl = document.getElementById('theme-icon');
            if(iconEl) {
                if(isDark) iconEl.innerHTML = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
                else iconEl.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
            }
        }

        function toggleSidebar() {
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('mobile-overlay');
            if (window.innerWidth >= 768) {
                document.body.classList.toggle('sidebar-collapsed');
                localStorage.setItem('aliat_sidebar_collapsed', document.body.classList.contains('sidebar-collapsed'));
            } else {
                if (sidebar.classList.contains('-translate-x-full')) {
                    overlay.classList.remove('hidden');
                    void overlay.offsetWidth;
                    sidebar.classList.remove('-translate-x-full');
                    overlay.classList.remove('opacity-0');
                } else {
                    sidebar.classList.add('-translate-x-full');
                    overlay.classList.add('opacity-0');
                    setTimeout(() => {
                        if (sidebar.classList.contains('-translate-x-full')) {
                            overlay.classList.add('hidden');
                        }
                    }, 300);
                }
            }
        }

        // --- RUTES D'INICI DE L'APP ---
        async function startStudyMode() { 
            await cleanupCurrentSessionIfEmpty();
            if (chatHistory.length > 0 && appMode === 'free') {
                await newSession();
            }

            appMode = 'study'; 
            
            // Ocultar totes les vistes
            document.getElementById('welcome-view').classList.add('hidden');
            document.getElementById('chat-view').classList.add('hidden');
            document.getElementById('chat-view').classList.remove('flex');
            document.getElementById('quiz-view').classList.add('hidden');
            document.getElementById('quiz-view').classList.remove('flex');
            
            // 2. NOMÉS anem al xat directe si ja s'ha generat el calendari (Pla Actiu)
            if (generatedCalendarArray.length > 0) { 
                document.getElementById('setup-view').classList.add('hidden');
                document.getElementById('setup-view').classList.remove('flex');
                document.getElementById('chat-view').classList.remove('hidden'); 
                document.getElementById('chat-view').classList.add('flex'); 
                document.getElementById('global-menu-btn').classList.add('hidden'); 
                document.getElementById('chat-form').classList.remove('hidden');
                
                updateHeaderButtonsVisibility();
                document.getElementById('chat-toolbar-bottom')?.classList.remove('hidden');
                document.getElementById('chat-mode-label').innerText = generateSmartTitle();
            } else { 
                // Si no hi ha calendari, anem a la pantalla de pujar el PDF
                document.getElementById('setup-view').classList.remove('hidden'); 
                document.getElementById('setup-view').classList.add('flex'); 
            } 

            // Si estàs al mòbil, tanca el menú lateral automàticament perquè no molesti
            if (window.innerWidth < 768) {
                const sidebar = document.getElementById('sidebar');
                if (!sidebar.classList.contains('-translate-x-full')) toggleSidebar();
            }
        }

        async function startFreeChatMode() { 
            await cleanupCurrentSessionIfEmpty();
            if (chatHistory.length > 0) {
                await newSession();
            }

            appMode = 'free'; 
            
            // Ocultar totes les vistes
            document.getElementById('welcome-view').classList.add('hidden'); 
            document.getElementById('setup-view').classList.add('hidden');
            document.getElementById('setup-view').classList.remove('flex');
            document.getElementById('quiz-view').classList.add('hidden');
            document.getElementById('quiz-view').classList.remove('flex');
            
            document.getElementById('global-menu-btn').classList.add('hidden'); 
            document.getElementById('chat-view').classList.remove('hidden'); 
            document.getElementById('chat-view').classList.add('flex'); 
            document.getElementById('chat-form').classList.remove('hidden'); 
            
            // En xat lliure, els botons del Pla d'Estudis s'amaguen
            updateHeaderButtonsVisibility();
            document.getElementById('chat-toolbar-bottom')?.classList.remove('hidden'); 
            document.getElementById('chat-mode-label').innerText = generateSmartTitle(); 
            
            if (chatHistory.length === 0) { 
                appendMessage('ai', "Hola! Sóc l'Aliat Intel·ligent. T'escolto, de què vols parlar o què necessites investigar avui?"); 
                chatHistory.push({ role: 'assistant', content: "Hola! Sóc l'Aliat Intel·ligent. T'escolto, de què vols parlar o què necessites investigar avui?" }); 
                // No guardem immediatament per evitar crear xats buits a l'historial
            } 

            // Si estàs al mòbil, tanca el menú lateral
            if (window.innerWidth < 768) {
                const sidebar = document.getElementById('sidebar');
                if (!sidebar.classList.contains('-translate-x-full')) toggleSidebar();
            }
        }
        
        function backToHome() {
            document.getElementById('setup-view').classList.add('hidden');
            document.getElementById('setup-view').classList.remove('flex');
            document.getElementById('welcome-view').classList.remove('hidden');
            document.getElementById('global-menu-btn').classList.remove('hidden');
        }

        // --- SISTEMA PDF I ESTUDI ---
        document.getElementById('exam-date').addEventListener('change', (e) => {
            const diffDays = Math.ceil((new Date(e.target.value) - new Date().setHours(0,0,0,0)) / (1000 * 60 * 60 * 24));
            const marker = document.getElementById('days-left-marker');
            marker.classList.remove('hidden');
            if (diffDays > 0) marker.innerHTML = `⏳ Queden <span class="text-blue-600 dark:text-blue-400 font-bold">${diffDays} dies</span>.`;
            else if (diffDays === 0) marker.innerHTML = `⚠️ <span class="text-orange-500 font-bold">L'examen és avui!</span>`;
            else marker.innerHTML = `❌ Data passada.`;
        });

        document.getElementById('pdf-upload').addEventListener('change', async (e) => {
            const files = e.target.files;
            if (files.length === 0) return;
            isPdfProcessing = true;
            document.getElementById('btn-start').disabled = true;
            document.getElementById('pdf-status').innerHTML = `⏳ Llegint text...`;
            for(let file of files) {
                try {
                    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
                    let fullText = "";
                    for (let i = 1; i <= Math.min(pdf.numPages, 20); i++) {
                        const textContent = await (await pdf.getPage(i)).getTextContent();
                        fullText += textContent.items.map(item => item.str).join(" ") + "\n";
                    }
                    uploadedPDFs.push({ id: 'pdf_' + Date.now(), name: file.name, text: fullText.trim() });
                } catch (err) {}
            }
            updatePdfListAndText();
            document.getElementById('pdf-status').innerHTML = `Fes clic per afegir més`;
            isPdfProcessing = false;
            document.getElementById('btn-start').disabled = false;
            e.target.value = ''; 
        });

        function updatePdfListAndText() {
            const list = document.getElementById('pdf-list');
            list.innerHTML = '';
            uploadedPDFs.forEach(pdf => {
                list.innerHTML += `<li class="flex items-center justify-between bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-2 rounded-xl shadow-sm"><span class="text-[10px] md:text-sm text-zinc-700 dark:text-zinc-300 font-medium truncate flex-1">📄 ${pdf.name}</span><button onclick="removePdf('${pdf.id}')" class="text-red-500 p-1 md:p-2 rounded-lg text-xs md:text-base">❌</button></li>`;
            });
            extractedText = uploadedPDFs.map(p => p.text).join("\n\n---\n\n");
        }
        function removePdf(id) { uploadedPDFs = uploadedPDFs.filter(p => p.id !== id); updatePdfListAndText(); }

        function calculateValidDates() {
            const examDateStr = document.getElementById('exam-date').value;
            if (!examDateStr) return [];
            const availableDaysInputs = Array.from(document.querySelectorAll('.day-checkbox:checked')).map(el => parseInt(el.value));
            if (availableDaysInputs.length === 0) return [];
            let dates = [];
            let current = new Date(); current.setHours(0,0,0,0);
            const parts = examDateStr.split('-');
            if (parts.length < 3) return [];
            let exam = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 23, 59, 59);
            while(current <= exam) {
                if(availableDaysInputs.includes(current.getDay())) dates.push(new Date(current));
                current.setDate(current.getDate() + 1);
            }
            return dates;
        }

        async function proceedToNextStep() {
            if (isPdfProcessing) return;
            const examDateStr = document.getElementById('exam-date').value;
            if (!examDateStr) { 
                Swal.fire({ icon: 'warning', title: 'Data de l\'examen', text: 'Si us plau, selecciona la data límit o de l\'examen.' }); 
                return; 
            }
            validStudyDates = calculateValidDates();
            if(validStudyDates.length === 0) { 
                Swal.fire({ icon: 'warning', title: 'Dies d\'estudi', text: 'Selecciona almenys un dia disponible de la setmana i assegura\'t que la data de l\'examen és futura.' }); 
                return; 
            }
            const manualText = document.getElementById('manual-topic').value.trim();
            if (uploadedPDFs.length === 0 && manualText === '') { 
                Swal.fire({ icon: 'warning', title: 'Apunts o Temari', text: 'Puja un PDF amb els teus apunts o escriu el temari/concepte per començar.' }); 
                return; 
            }
            finalStudyText = extractedText;
            if (manualText) finalStudyText += "\n\nNotes manuals:\n" + manualText;
            generatePlanAndQuiz();
        }

        async function generatePlanAndQuiz() {
            Swal.fire({ 
                title: 'Planificant...', 
                text: 'Analitzant apunts i preparant sessions personalitzades...',
                allowOutsideClick: false, 
                customClass: { popup: 'rounded-[2rem] dark:bg-zinc-900 dark:text-white border dark:border-zinc-800' }, 
                didOpen: () => Swal.showLoading() 
            });            
            try {
                let planTitle = "";
                if (Array.isArray(uploadedPDFs) && uploadedPDFs.length > 0 && uploadedPDFs[0].name) {
                    planTitle = cleanTopicTitle(uploadedPDFs[0].name);
                } else {
                    const manual = document.getElementById('manual-topic')?.value?.trim();
                    if (manual) planTitle = cleanTopicTitle(manual);
                }
                if (!planTitle) planTitle = "Pla d'Estudis";

                if (!currentSessionId || currentSessionId === 'null') {
                    currentSessionId = 'sess_' + Date.now();
                    safeLocalStorageSet('aliat_current_id', currentSessionId);
                }

                appMode = 'study';

                let activeSession = allSessions.find(s => s.id === currentSessionId);
                if (!activeSession) {
                    activeSession = { id: currentSessionId, mode: 'study' };
                    allSessions.push(activeSession);
                }
                activeSession.title = planTitle;
                activeSession.mode = 'study';
                if (Array.isArray(uploadedPDFs) && uploadedPDFs.length > 0) {
                    activeSession.files = uploadedPDFs.map(f => ({ name: f.name }));
                }

                const chatLabel = document.getElementById('chat-mode-label');
                if (chatLabel) chatLabel.innerText = planTitle;

                let numSessions = validStudyDates.length > 15 ? 15 : validStudyDates.length;
                if (currentSessionId) {
                    localStorage.setItem('aliat_local_text_' + currentSessionId, finalStudyText);
                }
                const res = await callGenerateApi({ action: 'prepare_study', pdfText: finalStudyText.substring(0, 18000), totalSessionsToGenerate: numSessions });
                if (!res.ok) throw new Error("El servidor no ha pogut processar la petició.");
                const data = await res.json();
                if(data.error) throw new Error(data.error);
                
                let iaTopics = Array.isArray(data.calendari_estudi) ? data.calendari_estudi : [];
                currentQuizData = Array.isArray(data.preguntes) ? data.preguntes : [];
                generatedCalendarArray = [];
                
                if (iaTopics.length > 0) {
                    validStudyDates.forEach((dateObj, index) => {
                        let topicIndex = Math.floor((index / validStudyDates.length) * iaTopics.length);
                        let topicName = (iaTopics[topicIndex] && iaTopics[topicIndex].tema) ? iaTopics[topicIndex].tema : `Sessió ${index + 1}: Repàs i Pràctica`;
                        let dateStr = dateObj.toLocaleDateString('ca-ES', { weekday: 'long', day: 'numeric', month: 'short' });
                        generatedCalendarArray.push({ num: index + 1, dia_real: dateStr, tema: topicName });
                    });
                } else {
                    validStudyDates.forEach((dateObj, index) => {
                        let dateStr = dateObj.toLocaleDateString('ca-ES', { weekday: 'long', day: 'numeric', month: 'short' });
                        let topicName = index === validStudyDates.length - 1 ? "Repàs General i Simulacre" : `Sessió ${index + 1}: Estudi i Esquematització`;
                        generatedCalendarArray.push({ num: index + 1, dia_real: dateStr, tema: topicName });
                    });
                }
                
                generatedCalendarArray.forEach(item => {
                    if (item && item.tema) recordLearnedConcept(item.tema);
                });

                renderCalendar();
                if (!currentQuizData || currentQuizData.length === 0) {
                    Swal.close();
                    startChatPhase(5, "Nivell General");
                } else {
                    renderQuiz();
                    document.getElementById('setup-view').classList.add('hidden');
                    document.getElementById('quiz-view').classList.remove('hidden');
                    document.getElementById('quiz-view').classList.add('flex');
                    Swal.close();
                }

                if (data.warning || data.is_fallback) {
                    showToast(data.warning || "Pla generat correctament!", "info");
                }
            } catch (err) {
                Swal.fire({
                    icon: 'error',
                    title: 'No s\'ha pogut generar el pla',
                    text: err.message || 'Error de connexió o saturació del servei d\'IA.',
                    confirmButtonText: 'Configurar Clau d\'IA (⚙️)',
                    showCancelButton: true,
                    cancelButtonText: 'Tancar',
                    customClass: { popup: 'rounded-3xl dark:bg-zinc-900 dark:text-white border dark:border-zinc-800' }
                }).then((res) => {
                    if (res.isConfirmed) {
                        openSettings();
                    }
                });
            }
        }

        let selectedPeakTime = 'mati'; // 'mati' | 'tarda' | 'nit'

        window.updatePeakTimeUI = function() {
            const radios = document.querySelectorAll('.peak-time-radio');
            radios.forEach(radio => {
                const val = radio.value;
                const card = document.getElementById('peak-card-' + val);
                if (!card) return;
                if (radio.checked) {
                    selectedPeakTime = val;
                    card.className = "peak-card p-3.5 rounded-2xl border-2 border-blue-500 bg-blue-50/80 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100 flex flex-col items-center text-center transition-all shadow-md scale-[1.02]";
                } else {
                    card.className = "peak-card p-3.5 rounded-2xl border-2 border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900/60 text-zinc-700 dark:text-zinc-300 flex flex-col items-center text-center transition-all shadow-sm";
                }
            });
        };

        function getPeakTimeRecommendationLabel(peakTime) {
            if (peakTime === 'tarda') {
                return {
                    badge: "☀️ Recomanat: Tarda (16:00 - 18:00)",
                    tip: "Franja de tarda: ideal per a resolució d'exercicis, problemes i pràctica activa.",
                    border: "hover:border-orange-500/50"
                };
            } else if (peakTime === 'nit') {
                return {
                    badge: "🌙 Recomanat: Nit (21:30 - 23:30)",
                    tip: "Franja de nit: ideal per a lectura pausada, esquemes visuals, síntesi i Anki.",
                    border: "hover:border-indigo-500/50"
                };
            } else {
                return {
                    badge: "🌅 Recomanat: Matí (09:00 - 11:00)",
                    tip: "Franja de matí: ideal per a assimilació teòrica i conceptes clau complexos.",
                    border: "hover:border-blue-500/50"
                };
            }
        }

        function renderCalendar() {
            const container = document.getElementById('calendar-container');
            if (!container) return;
            container.innerHTML = '';
            
            const rec = getPeakTimeRecommendationLabel(selectedPeakTime);

            generatedCalendarArray.forEach(item => {
                container.innerHTML += `
                    <div class="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-4 md:p-5 rounded-2xl flex flex-col shadow-sm relative overflow-hidden group ${rec.border} transition-all">
                        <div class="flex items-center justify-between gap-2 mb-2">
                            <span class="text-[9px] md:text-xs font-black text-blue-600 dark:text-blue-400 uppercase tracking-wider">${item.dia_real}</span>
                            <span class="bg-blue-600/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-300 border border-blue-500/20 text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0">Sessió ${item.num}</span>
                        </div>
                        <span class="text-xs md:text-sm font-bold text-zinc-800 dark:text-zinc-100 mb-3 leading-snug">${escapeHtml(item.tema)}</span>
                        
                        <div class="mt-auto pt-2.5 border-t border-zinc-100 dark:border-zinc-800/80 flex flex-col gap-1">
                            <div class="inline-flex items-center gap-1.5 text-[10px] font-extrabold text-amber-600 dark:text-amber-400 bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/25 px-2.5 py-1 rounded-lg w-fit">
                                <span>${rec.badge}</span>
                            </div>
                            <span class="text-[10px] text-zinc-500 dark:text-zinc-400 font-medium leading-tight mt-0.5">${rec.tip}</span>
                        </div>
                    </div>`;
            });
        }

        function renderQuiz() {
            const container = document.getElementById('quiz-container');
            container.innerHTML = '';
            currentQuizData.forEach((q, idx) => {
                const opcions = Array.isArray(q.opcions) ? q.opcions : ["A) Sí", "B) No"];
                container.innerHTML += `
                    <div class="p-4 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm">
                        <h3 class="font-bold text-zinc-800 dark:text-zinc-100 text-xs md:text-base mb-3 flex gap-2"><span class="text-blue-600 dark:text-zinc-200 bg-blue-100 dark:bg-zinc-800 border border-transparent dark:border-zinc-700 w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px]">${idx + 1}</span> <span>${q.pregunta || 'Pregunta ' + (idx + 1)}</span></h3>
                        <div class="space-y-2 pl-7">
                            ${opcions.map((opt) => `
                                <label class="flex items-center gap-2 p-2.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl cursor-pointer hover:border-blue-400 transition shadow-sm">
                                    <input type="radio" name="q_${idx}" value="${String(opt).replace(/"/g, '&quot;')}" class="w-3 h-3 text-blue-600 shrink-0">
                                    <span class="text-[11px] md:text-sm font-medium text-zinc-700 dark:text-zinc-300 leading-tight">${opt}</span>
                                </label>`).join('')}
                        </div>
                    </div>`;
            });
        }

        function evaluateQuiz() {
            if (typeof logStudySession === 'function') logStudySession('Test Diagnòstic');
            let correct = 0;
            const detailedQuestions = [];
            currentQuizData.forEach((q, idx) => {
                const sel = document.querySelector(`input[name="q_${idx}"]:checked`);
                const userVal = sel ? sel.value.trim() : "(Sense resposta)";
                const correctVal = (q.resposta_correcta || '').trim();
                const isMatch = sel && userVal.toLowerCase() === correctVal.toLowerCase();
                if (isMatch) correct++;
                detailedQuestions.push({
                    num: idx + 1,
                    pregunta: q.pregunta || (`Pregunta ${idx + 1}`),
                    opcions: q.opcions || [],
                    user_answer: userVal,
                    resposta_correcta: correctVal,
                    is_correct: !!isMatch
                });
            });
            let level = correct <= 2 ? "Nivell Inicial" : correct <= 4 ? "Nivell Intermedi" : "Nivell Avançat";
            
            window.initialQuizResults = {
                score: correct,
                total: currentQuizData.length || 5,
                level: level,
                date: new Date().toLocaleDateString('ca-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
                questions: detailedQuestions
            };
            if (currentSessionId) {
                localStorage.setItem('aliat_initial_quiz_' + currentSessionId, JSON.stringify(window.initialQuizResults));
            }
            updateStudentMemory('quiz', { score: correct, level: level });
            startChatPhase(correct, level);
        }

        async function startChatPhase(score, level) {
            document.getElementById('welcome-view')?.classList.add('hidden');
            document.getElementById('setup-view')?.classList.add('hidden');
            document.getElementById('setup-view')?.classList.remove('flex');
            document.getElementById('quiz-view')?.classList.add('hidden');
            document.getElementById('quiz-view')?.classList.remove('flex');
            
            document.getElementById('chat-view').classList.remove('hidden');
            document.getElementById('chat-view').classList.add('flex');
            document.getElementById('global-menu-btn').classList.add('hidden'); 
            
            updateHeaderButtonsVisibility();
            document.getElementById('chat-toolbar-bottom')?.classList.remove('hidden');
            document.getElementById('chat-form').classList.remove('hidden');
            document.getElementById('chat-mode-label').innerText = generateSmartTitle();

            studentContextStr = `L'alumne ha tret ${score}/5 (${level}).`;
            document.getElementById('chat-messages').innerHTML = `
                <div class="w-full flex justify-center my-4" id="welcome-card">
                    <div class="bg-blue-50 dark:bg-zinc-900 border border-blue-200 dark:border-zinc-800 p-5 rounded-2xl text-center shadow-sm max-w-xl w-full mx-2">
                        <div class="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-lg mx-auto mb-2">🎯</div>
                        <h2 class="text-xl font-black text-zinc-900 dark:text-zinc-100 mb-1">Pla d'Estudi Activat!</h2>
                        <p class="text-zinc-600 dark:text-zinc-400 text-xs md:text-sm font-medium">Test de diagnòstic completat: <b class="text-blue-600 dark:text-blue-400">${score}/5 encerts</b> (${level}).</p>
                    </div>
                </div>`;
            saveSession();

            // Iniciem directament la primera sessió perquè el xat no quedi buit ni requereixi clics extra
            setTimeout(() => {
                const prompt = "Hola tutor! Estic preparat. **Comença explicant-me el primer tema del nostre pla d'estudi basat en els apunts**. Explica-ho a poc a poc i acaba només amb l'etiqueta [BOTON_FLASHCARDS].";
                appendMessage('user', "Comencem la primera sessió del pla!");
                chatHistory.push({ role: 'user', content: prompt });
                triggerAiResponse();
            }, 300);
        }

        window.startTeaching = function() {
            document.getElementById('chat-form').classList.remove('hidden');
            const prompt = "Hola tutor! Estic preparat. **Comença explicant-me el primer tema del nostre pla d'estudi basat en els apunts**. Explica-ho a poc a poc i acaba només amb l'etiqueta [BOTON_FLASHCARDS].";
            appendMessage('user', "Comencem la primera sessió!");
            chatHistory.push({ role: 'user', content: prompt });
            triggerAiResponse();
        };

        window.togglePlusMenu = function(e) {
            if (e) e.stopPropagation();
            const menu = document.getElementById('plus-menu');
            if (!menu) return;
            const isClosed = menu.classList.contains('hidden') || menu.classList.contains('dropdown-popover-exit');
            if (isClosed) {
                openDropdown(menu);
            } else {
                closeDropdown(menu);
            }
        };

        window.closePlusMenu = function() {
            const menu = document.getElementById('plus-menu');
            if (menu) closeDropdown(menu);
        };

        document.addEventListener('click', (e) => {
            const btn = document.getElementById('chat-plus-btn');
            const menu = document.getElementById('plus-menu');
            if (menu && !menu.classList.contains('hidden') && btn && !btn.contains(e.target) && !menu.contains(e.target)) {
                closeDropdown(menu);
            }
        });

        let currentAttachmentBase64 = null;
        let currentAttachmentName = '';
        let currentAttachmentExt = 'PNG';

        function handleAttachment(input) {
            const file = input.files[0];
            if (!file) return;

            // Si és un fitxer d'àudio, obrim el modal de transcripció amb gemini-3.5-transcribe
            if (file.type.startsWith('audio/') || file.name.match(/\.(mp3|wav|m4a|webm|ogg|flac|aac)$/i)) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    currentTranscribedAudioBase64 = e.target.result;
                    currentTranscribedMime = file.type || 'audio/mp3';
                    openAudioTranscribeModal();
                    setTimeout(() => {
                        const infoEl = document.getElementById('modal-file-info');
                        if (infoEl) infoEl.innerText = `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`;
                        showToast(`🎵 Fitxer d'àudio "${file.name}" carregat! Prem Transcriure.`, 'info');
                    }, 200);
                };
                reader.readAsDataURL(file);
                input.value = '';
                return;
            }
            
            // Si és una imatge, la convertim a Base64 per enviar-la a la IA
            if (file.type.startsWith('image/')) {
                const nameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
                currentAttachmentName = nameWithoutExt.replace(/[^a-zA-Z0-9_\-]/g, '_');
                currentAttachmentExt = (file.name.split('.').pop() || 'PNG').toUpperCase();
                
                const reader = new FileReader();
                reader.onload = (e) => {
                    currentAttachmentBase64 = e.target.result;
                    document.getElementById('preview-img').src = currentAttachmentBase64;
                    document.getElementById('attachment-preview').classList.remove('hidden');
                };
                reader.readAsDataURL(file);
            } else {
                Swal.fire('Atenció', 'De moment es poden adjuntar imatges o fitxers d\'àudio per transcriure.', 'info');
            }
            input.value = ''; // Resetejar input
        }

        function removeAttachment() {
            currentAttachmentBase64 = null;
            currentAttachmentName = '';
            currentAttachmentExt = 'PNG';
            document.getElementById('attachment-preview').classList.add('hidden');
            document.getElementById('preview-img').src = '';
        }

        document.getElementById('chat-form').addEventListener('submit', async (e) => {
            e.preventDefault(); const input = document.getElementById('chat-input'); const msg = input.value.trim();
            if (!msg && !currentAttachmentBase64) return;
            
            let displayMsg = msg; 
            let payloadContent = msg || "Si us plau, analitza aquesta imatge i explica'm què hi veus.";
            let payloadImage = null;
            const attachedName = currentAttachmentName || `image_${Math.random().toString(16).substring(2, 8)}`;
            const attachedExt = currentAttachmentExt || 'PNG';

            if (currentAttachmentBase64) { 
                displayMsg = `<img src="${currentAttachmentBase64}" onclick="openLightbox(this.src)" class="max-w-[220px] rounded-xl mb-2 cursor-zoom-in hover:opacity-90 transition shadow-md border border-zinc-700/50"><br>` + msg; 
                payloadImage = currentAttachmentBase64;
            }
            
            appendMessage('user', displayMsg); 
            input.value = ''; 
            input.style.height = 'auto'; 
            
            // Guardem el text I la imatge real a l'historial per enviar-la a Gemini
            chatHistory.push({ 
                role: 'user', 
                content: payloadContent, 
                image: payloadImage,
                fileName: attachedName,
                fileExt: attachedExt
            }); 

            // Registrar l'arxiu a la sessió activa
            let activeSession = allSessions.find(s => s.id === currentSessionId);
            if (activeSession && payloadImage) {
                if (!Array.isArray(activeSession.files)) activeSession.files = [];
                activeSession.files.push({
                    id: 'img_' + Date.now(),
                    name: attachedName,
                    ext: attachedExt,
                    src: payloadImage,
                    type: 'image',
                    date: Date.now()
                });
            }
            
            removeAttachment(); 
            saveSession(); 
            triggerAiResponse();
        });

        window.setTutorMode = function(mode) {
            window.currentTutorMode = mode;
            document.querySelectorAll('.tutor-mode-select-elem').forEach(el => {
                if (el.value !== mode) el.value = mode;
            });
            const modeLabels = {
                'standard': '🎓 Tutor Estàndard',
                'socratic': '🧐 Mode Socràtic',
                'feynman': '👶 Mode Feynman',
                'tribunal': '⚖️ Tribunal Examen'
            };
            showToast(`Mode de Tutor activat: ${modeLabels[mode] || mode}`, 'info');
        };

        window.isGoogleSearchActive = true;
        window.toggleGoogleSearchGrounding = function() {
            window.isGoogleSearchActive = !window.isGoogleSearchActive;
            const btn = document.getElementById('google-search-toggle-btn');
            const pulse = document.getElementById('google-search-pulse');
            if (window.isGoogleSearchActive) {
                if (btn) btn.className = "w-8 h-8 rounded-full hover:bg-blue-100/70 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-400 bg-blue-50/90 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800/80 flex items-center justify-center transition cursor-pointer relative shrink-0 shadow-xs active:scale-95";
                if (btn) btn.title = "Cerca Web amb Google activa (gemini-3.8-flash)";
                if (pulse) pulse.classList.remove('hidden');
                showToast("Cerca amb Google activada (gemini-3.8-flash)", "info");
            } else {
                if (btn) btn.className = "w-8 h-8 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700/60 text-zinc-400 dark:text-zinc-500 border border-transparent flex items-center justify-center transition cursor-pointer relative shrink-0 active:scale-95";
                if (btn) btn.title = "Cerca Web amb Google desactivada";
                if (pulse) pulse.classList.add('hidden');
                showToast("Cerca amb Google desactivada", "info");
            }
        };

        async function triggerAiResponse() {
            const loadingId = 'loading-' + Date.now();
            appendLoading(loadingId);
            try {
                const actionToSend = appMode === 'free' ? 'free_chat' : 'chat';
                const res = await callGenerateApi({ 
                    action: actionToSend, 
                    chatHistory: chatHistory, 
                    pdfText: finalStudyText, 
                    studentContext: studentContextStr,
                    tutorMode: window.currentTutorMode || 'standard',
                    useGoogleSearch: window.isGoogleSearchActive !== false
                });
                document.getElementById(loadingId)?.remove();
                const data = await res.json();
                if(data.error) throw new Error(data.error);
                appendMessage('ai', data.reply, data.searchQueries, data.sources);
                chatHistory.push({ role: 'assistant', content: data.reply });
                saveSession();
            } catch (err) {
                document.getElementById(loadingId)?.remove();
                showToast("S'ha produït un error al generar la resposta", "error");
                
                // Missatge d'error amb botó de reintentar elegant
                const box = document.getElementById('chat-messages');
                const div = document.createElement('div');
                div.className = "flex justify-start gap-2 w-full mb-3 chat-msg-ai";
                div.innerHTML = `
                <div class="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center text-white font-bold text-xs shrink-0 shadow-md mt-1">!</div>
                <div class="bg-white dark:bg-zinc-900 border border-red-200 dark:border-red-900/50 text-zinc-900 dark:text-zinc-100 px-4 py-4 rounded-2xl rounded-tl-sm max-w-[90%] shadow-md w-full">
                    <p class="text-sm font-semibold text-red-600 dark:text-red-400 mb-3">No s'ha pogut completar la resposta: ${err.message}</p>
                    <button onclick="retryAiResponse(this)" class="bg-zinc-900 dark:bg-zinc-800 hover:bg-zinc-800 dark:hover:bg-zinc-700 text-white font-bold py-2.5 px-4 rounded-xl transition text-xs flex items-center gap-2 border border-transparent dark:border-zinc-700 shadow-sm interactive-btn">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Reintentar darrer missatge
                    </button>
                </div>`;
                box.appendChild(div);
                box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
            }
        }

        window.retryAiResponse = function(btn) {
            btn.closest('.flex.justify-start').remove();
            showToast("Reintentant connexió amb la IA...", "info");
            triggerAiResponse();
        };

        function showToast(msg, type = 'success') {
            const toast = document.getElementById('bottom-toast');
            const msgEl = document.getElementById('toast-msg');
            const iconEl = document.getElementById('toast-icon');
            
            if(!toast) return;
            msgEl.innerText = msg;
            if (type === 'error') {
                iconEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
            } else if (type === 'info') {
                iconEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
            } else {
                iconEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
            }
            
            toast.classList.remove('translate-y-12', 'opacity-0', 'pointer-events-none');
            toast.classList.add('translate-y-0', 'opacity-100');
            
            setTimeout(() => {
                toast.classList.remove('translate-y-0', 'opacity-100');
                toast.classList.add('translate-y-12', 'opacity-0', 'pointer-events-none');
            }, 3500);
        }

        window.openLightbox = function(src) {
            const lb = document.getElementById('image-lightbox');
            const img = document.getElementById('lightbox-img');
            if(!lb || !img) return;
            img.src = src;
            lb.classList.remove('hidden');
            setTimeout(() => lb.classList.remove('opacity-0'), 10);
        };

        window.closeLightbox = function() {
            const lb = document.getElementById('image-lightbox');
            if(!lb) return;
            lb.classList.add('opacity-0');
            setTimeout(() => lb.classList.add('hidden'), 300);
        };

        // --- SUPORT PER ENGANXAR IMATGES (Ctrl+V) ---
        window.addEventListener('paste', (e) => {
            const items = (e.clipboardData || e.originalEvent.clipboardData).items;
            for (let item of items) {
                if (item.type.indexOf('image') !== -1) {
                    const blob = item.getAsFile();
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        currentAttachmentBase64 = event.target.result;
                        const previewImg = document.getElementById('preview-img');
                        const previewContainer = document.getElementById('attachment-preview');
                        if (previewImg && previewContainer) {
                            previewImg.src = currentAttachmentBase64;
                            previewContainer.classList.remove('hidden');
                            showToast("📸 Imatge enganxada des del portapapers!");
                        }
                    };
                    reader.readAsDataURL(blob);
                    e.preventDefault();
                    break;
                }
            }
        });

        window.unlockTheory = function() {
            document.querySelectorAll('.chat-msg-ai').forEach(el => {
                el.style.filter = 'none'; el.style.opacity = '1'; el.style.pointerEvents = 'auto';
            });
        }

        window.requestMinigame = function(btn) {
            btn.disabled = true; btn.innerHTML = "⏳ Preparant Examen..."; btn.classList.add('opacity-50');
            document.querySelectorAll('.chat-msg-ai').forEach(el => {
                el.style.filter = 'blur(8px)'; el.style.opacity = '0.4'; el.style.pointerEvents = 'none';
            });
            const msg = "Ho he entès perfectament. Posa'm a prova amb un minijoc";
            setTimeout(() => {
                appendMessage('user', "Ho he entès! Posa'm a prova.");
                chatHistory.push({ role: 'user', content: msg });
                triggerAiResponse();
            }, 500);
        }
        
        window.requestNextPhase = function(btn, promptText) {
            btn.disabled = true;
            btn.classList.add('opacity-50');
            btn.innerHTML = "⏳ Generant...";
            setTimeout(() => {
                appendMessage('user', promptText);
                chatHistory.push({ role: 'user', content: promptText });
                triggerAiResponse();
            }, 300);
        };

        // --- SISTEMA DE MODALS (UI) ---
        window.showHistoryModal = function() {
            showMemoryModal();
        };

        function showCalendarModal() {
            let htmlContent = '';
            if (!Array.isArray(generatedCalendarArray) || generatedCalendarArray.length === 0) {
                htmlContent = `
                <div class="p-4 text-center space-y-3">
                    <div class="w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto shadow-sm">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    </div>
                    <div class="text-sm font-bold text-zinc-900 dark:text-zinc-100">Encara no s'ha configurat un calendari per a aquest xat</div>
                    <p class="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">Pots carregar apunts en PDF per generar un calendari personalitzat de sessions i minijocs.</p>
                    <button onclick="Swal.close(); startStudyMode();" class="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold rounded-2xl text-xs transition shadow-md flex items-center justify-center gap-2 cursor-pointer mt-2">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
                        Crear Pla d'Estudis Ara
                    </button>
                </div>`;
            } else {
                htmlContent = '<div class="grid grid-cols-1 gap-2.5 mt-3 text-left overflow-y-auto max-h-[50vh] md:max-h-96 pr-1">';
                generatedCalendarArray.forEach(item => {
                    htmlContent += `
                    <div class="p-3 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-800 rounded-2xl flex gap-3 items-center hover:border-blue-400/50 transition">
                        <div class="bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 font-bold rounded-xl w-8 h-8 flex items-center justify-center shrink-0 text-xs shadow-sm">${item.num}</div>
                        <div class="min-w-0 flex-1">
                            <div class="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 mb-0.5 uppercase tracking-wide">${item.dia_real}</div>
                            <div class="text-[13px] font-bold text-zinc-900 dark:text-zinc-100 truncate">${item.tema}</div>
                        </div>
                    </div>`;
                });
                htmlContent += '</div>';
            }
            Swal.fire({ 
                title: '<div class="flex items-center justify-center gap-2 text-zinc-900 dark:text-white"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> Pla d\'Estudi</div>', 
                html: htmlContent, 
                showCloseButton: true, 
                confirmButtonText: 'Tancar', 
                confirmButtonColor: '#2563eb', 
                customClass: { popup: 'rounded-[1.5rem] md:rounded-3xl dark:bg-zinc-900 dark:text-white border dark:border-zinc-800 max-w-md w-full', title: 'font-black text-zinc-900 dark:text-white' } 
            });
        }
        
        window.scrollToLatestTheory = function() {
            const markers = document.querySelectorAll('.theory-marker');
            if(markers.length === 0) {
                Swal.fire({ title: 'Cap lliçó activa', text: 'Encara no s\'ha generat contingut a la sessió.', icon: 'info', confirmButtonColor: '#2563eb', customClass: { popup: 'rounded-[1.5rem] dark:bg-zinc-900 dark:text-white border dark:border-zinc-800' } });
                return;
            }
            
            let htmlContent = '<div class="flex flex-col gap-3 mt-4 max-h-[50vh] overflow-y-auto px-1">';
            let recentMarkers = Array.from(markers).reverse(); 
            
            recentMarkers.forEach(m => {
                let type = m.getAttribute('data-type');
                let mId = m.id;
                htmlContent += `
                <button onclick="Swal.close(); const el = document.getElementById('${mId}').closest('.chat-msg-ai'); el.scrollIntoView({behavior: 'smooth', block: 'start'}); el.classList.add('ring-4', 'ring-blue-400', 'transition-all', 'duration-500'); setTimeout(()=>el.classList.remove('ring-4', 'ring-blue-400'), 2000);" class="flex items-center gap-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3.5 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition text-left w-full shadow-sm">
                    <div class="font-bold text-zinc-900 dark:text-zinc-100 text-sm md:text-base">${type}</div>
                </button>`;
            });
            htmlContent += '</div>';

            Swal.fire({ 
                title: '<div class="flex items-center justify-center gap-2 text-zinc-900 dark:text-white"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg> Índex de Lliçons</div>', 
                html: htmlContent, 
                showCloseButton: true, 
                showConfirmButton: false,
                customClass: { popup: 'rounded-[1.5rem] md:rounded-3xl dark:bg-zinc-900 dark:text-white border dark:border-zinc-800 max-w-md w-full', title: 'font-black text-zinc-900 dark:text-white' }
            });
        };

        // --- SISTEMA DE MINIJOCS ---
        window.openGameModal = function(id) {
            const game = window.interactiveGames[id];
            const titleEl = document.getElementById('game-modal-title');
            const contentEl = document.getElementById('game-modal-content');
            
            if (game.type === 'kahoot') {
                titleEl.innerHTML = game.title || "🎮 Pregunta Ràpida";
                contentEl.innerHTML = buildKahootUI(id, game);
            } else if (game.type === 'schema') {
                titleEl.innerHTML = "🧩 Esquema Conceptual";
                contentEl.innerHTML = buildSchemaUI(id, game);
            }
            
            const modal = document.getElementById('game-modal');
            const box = document.getElementById('game-modal-box');
            modal.classList.remove('hidden');
            setTimeout(() => { modal.classList.remove('opacity-0'); box.classList.remove('scale-95'); }, 10);
        }

        window.closeGameModal = function() {
            const modal = document.getElementById('game-modal');
            const box = document.getElementById('game-modal-box');
            modal.classList.add('opacity-0');
            box.classList.add('scale-95');
            setTimeout(() => { modal.classList.add('hidden'); }, 300);
        }

        // --- RESOLUTOR DE RESPOSTA CORRECTA A PROVA DE FALLADES ---
        function resolveCorrectIndex(q, options) {
            if (!q || !Array.isArray(options) || options.length === 0) return 0;
            
            // 1. Número explícit
            if (typeof q.correcta === 'number') {
                if (q.correcta >= 0 && q.correcta < options.length) return q.correcta;
                if (q.correcta === options.length) return q.correcta - 1; // Ajust de base 1
            }
            if (typeof q.correct === 'number') {
                if (q.correct >= 0 && q.correct < options.length) return q.correct;
                if (q.correct === options.length) return q.correct - 1;
            }

            // 2. String (número, lletra o text de la resposta)
            let val = q.correcta !== undefined ? q.correcta : (q.correct !== undefined ? q.correct : (q.resposta_correcta || q.answer || ''));
            let strVal = String(val).trim();
            if (!strVal) return 0;

            // String numèric com "0", "1", "2"
            if (/^\d+$/.test(strVal)) {
                let n = parseInt(strVal, 10);
                if (n >= 0 && n < options.length) return n;
                if (n === options.length && n > 0) return n - 1;
            }

            // String de lletra com "A", "B", "C", "D"
            if (/^[A-Da-d]$/.test(strVal)) {
                let n = strVal.toUpperCase().charCodeAt(0) - 65;
                if (n >= 0 && n < options.length) return n;
            }

            // Coincidència de text amb les opcions
            let cleanVal = strVal.toLowerCase().replace(/^[a-d][\.\)\:\-\s]+/i, '').trim();
            for (let i = 0; i < options.length; i++) {
                let optText = (typeof options[i] === 'object' && options[i] !== null) 
                    ? (options[i].text || options[i].resposta || JSON.stringify(options[i])) 
                    : String(options[i]);
                let cleanOpt = optText.toLowerCase().replace(/^[a-d][\.\)\:\-\s]+/i, '').trim();
                if (cleanOpt === cleanVal || optText.toLowerCase().trim() === strVal.toLowerCase() || optText.toLowerCase().includes(cleanVal)) {
                    return i;
                }
            }

            return 0;
        }

        function getKahootQuestionsList(game) {
            if (!game || !game.data) return [];
            let rawData = game.data;
            if (Array.isArray(rawData)) return rawData;
            if (rawData && Array.isArray(rawData.preguntes)) return rawData.preguntes;
            if (rawData && Array.isArray(rawData.questions)) return rawData.questions;
            if (rawData && Array.isArray(rawData.items)) return rawData.items;
            return [rawData];
        }

        function buildKahootUI(id, game) {
            if (!game || !game.data) {
                return `<div class="p-4 text-center text-zinc-500 font-bold text-xs">No hi ha dades disponibles per aquest examen.</div>`;
            }
            
            let questions = getKahootQuestionsList(game);
            game.questionsList = questions;
            if (typeof game.currentQIndex === 'undefined') game.currentQIndex = 0;
            if (typeof game.score === 'undefined') game.score = 0;
            if (!Array.isArray(game.answersLog)) game.answersLog = [];

            let qIdx = game.currentQIndex;
            let currentQ = questions[qIdx] || questions[0];
            let totalQ = questions.length;

            let options = currentQ.opcions || currentQ.options || currentQ.choices || currentQ.respostes || [];
            if (!Array.isArray(options) && typeof options === 'object' && options !== null) {
                options = Object.values(options);
            }
            if (!Array.isArray(options) || options.length === 0) {
                options = ["Opció A", "Opció B", "Opció C", "Opció D"];
            }

            let correctIdx = resolveCorrectIndex(currentQ, options);
            let answerEntry = game.answersLog[qIdx];
            let isCurrentAnswered = typeof answerEntry !== 'undefined';
            let colors = ['bg-indigo-600 hover:bg-indigo-700', 'bg-emerald-600 hover:bg-emerald-700', 'bg-amber-600 hover:bg-amber-700', 'bg-rose-600 hover:bg-rose-700'];

            let buttonsHtml = options.map((opt, idx) => {
                let optText = (typeof opt === 'object' && opt !== null) ? (opt.text || opt.resposta || JSON.stringify(opt)) : String(opt);
                let safeOpt = optText.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                let letter = String.fromCharCode(65 + idx);
                let btnClass = `w-full text-left text-white font-bold p-3.5 md:p-4 rounded-2xl shadow-sm transition flex items-center gap-3 text-xs md:text-sm focus:outline-none ${colors[idx % colors.length]}`;
                
                if (isCurrentAnswered) {
                    let userPick = answerEntry.pick;
                    btnClass += " opacity-60 cursor-default";
                    if (idx === userPick && idx === correctIdx) {
                        btnClass = btnClass.replace("opacity-60", "ring-4 ring-emerald-400 opacity-100 font-black shadow-lg shadow-emerald-500/30 scale-[1.01]");
                    } else if (idx === userPick && idx !== correctIdx) {
                        btnClass = btnClass.replace("opacity-60", "ring-4 ring-rose-500 opacity-100 font-black shadow-lg shadow-rose-500/30");
                    } else if (idx === correctIdx) {
                        btnClass = btnClass.replace("opacity-60", "border-4 border-emerald-400 opacity-100 font-black");
                    }
                    return `
                    <button type="button" class="${btnClass}">
                        <span class="w-6 h-6 rounded-lg bg-black/20 flex items-center justify-center font-mono font-black text-xs shrink-0">${letter}</span>
                        <span class="flex-1">${optText}</span>
                    </button>`;
                } else {
                    return `
                    <button type="button" onclick="event.preventDefault(); event.stopPropagation(); playKahoot('${id}', ${idx}, '${safeOpt}')" class="${btnClass} interactive-btn hover:scale-[1.01]">
                        <span class="w-6 h-6 rounded-lg bg-black/20 flex items-center justify-center font-mono font-black text-xs shrink-0">${letter}</span>
                        <span class="flex-1">${optText}</span>
                    </button>`;
                }
            }).join('');

            let feedbackHtml = "";
            let navigationHtml = "";

            if (isCurrentAnswered) {
                let isWin = answerEntry.isWin;
                let correctText = (typeof options[correctIdx] === 'object' && options[correctIdx] !== null) 
                    ? (options[correctIdx].text || options[correctIdx].resposta) 
                    : String(options[correctIdx]);

                feedbackHtml = `
                <div class="mt-4 p-3.5 rounded-2xl font-bold text-center text-xs md:text-sm ${isWin ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800' : 'bg-rose-100 text-rose-900 dark:bg-rose-950/70 dark:text-rose-300 border border-rose-300 dark:border-rose-800'}">
                    ${isWin ? '✅ <b>Molt bé! Resposta correcta.</b>' : `❌ <b>Incorrecte.</b> La resposta encertada és: <u>${correctText}</u>`}
                </div>`;

                if (qIdx < totalQ - 1) {
                    navigationHtml = `
                    <button onclick="nextKahootQuestion('${id}')" class="w-full mt-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-black py-3.5 px-4 rounded-2xl text-xs sm:text-sm transition shadow-lg shadow-blue-600/25 flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98]">
                        <span>Següent Pregunta (${qIdx + 2}/${totalQ})</span>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>`;
                } else {
                    // Resultat Final del Test
                    let finalPercentage = Math.round((game.score / totalQ) * 100);
                    let finalColor = finalPercentage >= 70 ? 'text-emerald-600 dark:text-emerald-400' : finalPercentage >= 40 ? 'text-blue-600 dark:text-blue-400' : 'text-rose-600 dark:text-rose-400';
                    navigationHtml = `
                    <div class="mt-5 p-4 rounded-2xl bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-center space-y-3">
                        <div class="text-xs uppercase font-extrabold tracking-wider text-zinc-500">Resultat del Test d'Examen</div>
                        <div class="text-3xl font-black ${finalColor}">${game.score} / ${totalQ} (${finalPercentage}%)</div>
                        <p class="text-xs text-zinc-600 dark:text-zinc-400 font-medium">Els resultats s'han enregistrat automàticament a la teva memòria d'estudi.</p>
                        
                        <div class="pt-2 flex flex-col sm:flex-row gap-2">
                            <button onclick="triggerNewExamFromKahoot('${id}')" class="flex-1 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold py-3 px-3 rounded-xl text-xs transition shadow-md flex items-center justify-center gap-1.5 cursor-pointer">
                                🔄 Nou Test (Altres preguntes)
                            </button>
                            <button onclick="finishKahootSession('${id}')" class="flex-1 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 font-bold py-3 px-3 rounded-xl text-xs transition flex items-center justify-center gap-1.5 cursor-pointer">
                                💬 Continuar la Classe
                            </button>
                        </div>
                    </div>`;
                }
            }

            return `
                <div class="mb-4 flex items-center justify-between text-xs">
                    <span class="font-extrabold text-blue-600 dark:text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
                        <span class="w-2 h-2 rounded-full bg-blue-500"></span> Pregunta ${qIdx + 1} de ${totalQ}
                    </span>
                    <span class="bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-black px-2.5 py-1 rounded-xl border border-zinc-200 dark:border-zinc-700 text-[11px]">
                        Puntuació: ${game.score}/${totalQ}
                    </span>
                </div>
                <div class="text-zinc-900 dark:text-zinc-100 font-extrabold text-sm md:text-base mb-5 leading-relaxed bg-zinc-50 dark:bg-zinc-950 p-4 rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80">
                    ${currentQ.pregunta || currentQ.question || 'Pregunta:'}
                </div>
                <div class="grid grid-cols-1 gap-2.5">${buttonsHtml}</div>
                ${feedbackHtml}
                ${navigationHtml}
            `;
        }

        window.playKahoot = function(id, indexPicked, textResponded) {
            let game = window.interactiveGames[id];
            if (!game) return;
            
            let questions = getKahootQuestionsList(game);
            game.questionsList = questions;
            let qIdx = game.currentQIndex || 0;
            let currentQ = questions[qIdx] || questions[0];
            
            let options = currentQ.opcions || currentQ.options || currentQ.choices || currentQ.respostes || [];
            if (!Array.isArray(options) && typeof options === 'object' && options !== null) options = Object.values(options);
            
            let correctIdx = resolveCorrectIndex(currentQ, options);
            let isWin = (indexPicked === correctIdx);
            
            if (!Array.isArray(game.answersLog)) game.answersLog = [];
            game.answersLog[qIdx] = {
                pick: indexPicked,
                correct: correctIdx,
                isWin: isWin,
                textResponded: textResponded
            };

            if (isWin) {
                game.score = (game.score || 0) + 1;
            }

            let topicName = (currentQ.pregunta || 'Joc Ràpid').substring(0, 35);
            updateStudentMemory(isWin ? 'game_win' : 'game_fail', { topic: topicName });
            saveSession();

            // Si s'arriba a la darrera pregunta, finalitzem
            if (qIdx >= questions.length - 1) {
                game.status = 'completed';
                game.isWin = (game.score >= Math.ceil(questions.length / 2));
                updateLaunchButton(id);
                unlockTheory();
                if (game.score >= Math.ceil(questions.length / 2) && typeof confetti === 'function') {
                    confetti({ particleCount: 70, spread: 60, origin: { y: 0.6 } });
                }

                try {
                    localStorage.setItem('aliat_last_kahoot_' + (currentSessionId || 'default'), JSON.stringify({
                        score: game.score,
                        total: questions.length,
                        percentage: Math.round((game.score / questions.length) * 100),
                        answers: game.answersLog,
                        questions: questions,
                        date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    }));
                } catch(e) {}
            }

            document.getElementById('game-modal-content').innerHTML = buildKahootUI(id, game);
        };

        window.nextKahootQuestion = function(id) {
            let game = window.interactiveGames[id];
            if (!game) return;
            game.currentQIndex = (game.currentQIndex || 0) + 1;
            document.getElementById('game-modal-content').innerHTML = buildKahootUI(id, game);
        };

        window.finishKahootSession = function(id) {
            let game = window.interactiveGames[id];
            closeGameModal();
            let totalQ = (game && game.questionsList) ? game.questionsList.length : 1;
            let score = (game && game.score) ? game.score : 0;

            if (game && game.answersLog) {
                try {
                    localStorage.setItem('aliat_last_kahoot_' + (currentSessionId || 'default'), JSON.stringify({
                        score: score,
                        total: totalQ,
                        percentage: Math.round((score / totalQ) * 100),
                        answers: game.answersLog,
                        questions: game.questionsList || [],
                        date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    }));
                } catch(e) {}
            }

            let msg = `He completat el test de ${totalQ} preguntes amb una puntuació de ${score}/${totalQ}. Continuem amb el següent pas de la classe!`;
            appendMessage('user', msg);
            chatHistory.push({ role: 'user', content: msg });
            triggerAiResponse();
        };

        window.triggerNewExamFromKahoot = function(id) {
            closeGameModal();
            const topic = getCurrentChatTopic();
            const seed = Date.now().toString().slice(-4);
            const userPromptText = `Prepara un nou Test d'Examen Kahoot sobre ${topic} (Codi variació #${seed}).`;
            const customAiInstruction = `Genera un NOU i COMPLETAMENT DIFERENT Test d'Examen Kahoot de 5 preguntes variades sobre "${topic}" (Variació #${seed}). No repeteixis preguntes anteriors. Assegura't que el camp "correcta" indiqui l'índex exacte (0, 1, 2 o 3) de la resposta vàlida a "opcions". Retorna NOMÉS el bloc \`\`\`kahoot ... \`\`\`.`;
            triggerToolFromChat('exam', customAiInstruction, userPromptText);
        };

        function buildSchemaUI(id, game) {
            let s = game.data;
            let isDone = game.status === 'completed';
            
            let boxesHtml = s.buits.map((item, idx) => {
                let inputClass = "bg-white dark:bg-zinc-950 border-2 border-zinc-200 dark:border-zinc-800 focus:border-blue-500 dark:focus:border-blue-500 px-3 py-2 text-sm text-zinc-800 dark:text-zinc-100 w-1/2 outline-none rounded-xl text-center shadow-inner transition";
                let val = "";
                if (isDone) {
                    val = `value="${item.resposta.replace(/"/g, '&quot;')}" disabled`;
                    inputClass = "bg-zinc-100 dark:bg-zinc-800 border-2 border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm text-zinc-600 dark:text-zinc-300 w-1/2 rounded-xl text-center font-bold";
                }
                return `
                <div class="flex items-center gap-3 mb-4">
                    <div class="bg-blue-100 dark:bg-zinc-800 text-blue-800 dark:text-zinc-200 px-3 py-2 rounded-xl text-xs md:text-sm font-bold w-1/2 text-right border border-blue-200 dark:border-zinc-700 leading-tight">${item.context || ''}</div>
                    <div class="text-zinc-300 dark:text-zinc-600 font-black text-lg">➔</div>
                    <input type="text" id="modal_input_${id}_${idx}" ${val} placeholder="..." class="${inputClass}">
                </div>`;
            }).join('');
            
            let actionHtml = "";
            if (!isDone) {
                actionHtml = `<button id="modal_btn_${id}" onclick="checkSchema('${id}')" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3.5 rounded-xl transition shadow-md text-sm mt-4 interactive-btn">Comprovar respostes</button>`;
            }
            
            let historyHtml = "";
            if (game.attemptsLog && game.attemptsLog.length > 0) {
                historyHtml = `<div class="mt-6 border-t border-zinc-200 dark:border-zinc-800 pt-4"><h4 class="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-2">Historial d'intents:</h4><ul class="space-y-2 text-xs text-zinc-600 dark:text-zinc-400">`;
                game.attemptsLog.forEach((log, i) => {
                    historyHtml += `<li class="bg-zinc-100 dark:bg-zinc-800/50 p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 shadow-sm"><span class="font-bold text-zinc-700 dark:text-zinc-300">Intent ${i+1}:</span> ${log}</li>`;
                });
                historyHtml += `</ul></div>`;
            }

            let resultHtml = "";
            if (isDone) {
                let isWin = game.isWin;
                resultHtml = `<div class="mt-4 p-4 rounded-xl font-bold text-center text-sm ${isWin ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 border border-green-300 dark:border-green-800/50' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 border border-red-300 dark:border-red-800/50'}">${isWin ? '✅ Esquema Completat!' : '❌ Intents esgotats (S\'ha mostrat la solució)'}</div>`;
            }

            return `
                <div class="text-zinc-800 dark:text-zinc-100 font-black text-lg md:text-xl mb-6 text-center">${s.titol || 'Esquema'}</div>
                <div class="mb-2">${boxesHtml}</div>
                ${actionHtml}
                ${resultHtml}
                ${historyHtml}
            `;
        }

        window.checkSchema = function(id) {
            const game = window.interactiveGames[id];
            let allCorrect = true;
            let currentAttemptWords = [];

            game.data.buits.forEach((buit, i) => {
                let inputEl = document.getElementById(`modal_input_${id}_${i}`);
                let val = inputEl.value.trim();
                currentAttemptWords.push(val || '(buit)');
                
                if(val.toLowerCase() === buit.resposta.trim().toLowerCase()) {
                    inputEl.classList.replace('border-zinc-200', 'border-green-500');
                    inputEl.classList.replace('border-red-500', 'border-green-500');
                    inputEl.classList.add('bg-green-50', 'text-green-700', 'font-bold');
                    inputEl.disabled = true;
                } else {
                    allCorrect = false;
                    inputEl.classList.add('border-red-500', 'bg-red-50');
                    setTimeout(() => { 
                        if(inputEl && !inputEl.disabled) {
                            inputEl.value = ''; 
                            inputEl.classList.remove('border-red-500', 'bg-red-50'); 
                        }
                    }, 1500);
                }
            });

            if (!game.attemptsLog) game.attemptsLog = [];
            const btn = document.getElementById(`modal_btn_${id}`);

            if(allCorrect) {
                game.attemptsLog.push("Correcte: " + currentAttemptWords.join(', '));
                game.status = 'completed';
                game.isWin = true;
                
                btn.className = "w-full bg-emerald-600 text-white font-bold py-3.5 rounded-xl shadow-md flex items-center justify-center gap-2";
                btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Completat amb èxit!`;
                btn.disabled = true;
                
                updateLaunchButton(id);
                unlockTheory();
                updateStudentMemory('game_win', { topic: (game.data.titol || 'Esquema Conceptual').substring(0, 35) });
                saveSession();

                setTimeout(() => {
                    closeGameModal();
                    let msg = `He completat l'esquema correctament. Ara explica'm la SEGÜENT PART de la teoria del pla d'estudi (no posis més jocs ara).`;
                    appendMessage('user', msg);
                    chatHistory.push({ role: 'user', content: msg });
                    triggerAiResponse();
                }, 1500);
            } else {
                game.attempts = (game.attempts || 0) + 1;
                game.attemptsLog.push("Fallat: " + currentAttemptWords.join(', '));
                
                if(game.attempts >= 3) {
                    game.status = 'completed';
                    game.isWin = false;
                    
                    document.getElementById('game-modal-content').innerHTML = buildSchemaUI(id, game);
                    updateLaunchButton(id);
                    
                    unlockTheory();
                    updateStudentMemory('game_fail', { topic: (game.data.titol || 'Esquema Conceptual').substring(0, 35) });
                    saveSession();

                    setTimeout(() => {
                        closeGameModal();
                        let msg = `He fallat l'esquema 3 vegades. Guarda-ho per un altre dia. Explica'm l'error breument i seguim amb la teoria.`;
                        appendMessage('user', msg);
                        chatHistory.push({ role: 'user', content: msg });
                        triggerAiResponse();
                    }, 3000);
                } else {
                    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Comprovar de nou (Intent ${game.attempts}/3)`;
                    btn.classList.add('bg-red-600', 'hover:bg-red-700');
                    setTimeout(() => {
                        if (btn) {
                            btn.innerHTML = `Comprovar respostes (Intent ${game.attempts}/3)`;
                            btn.classList.remove('bg-red-600', 'hover:bg-red-700');
                        }
                    }, 1500);
                }
            }
        }

        function updateLaunchButton(id) {
            let btn = document.getElementById(`launch_btn_${id}`);
            let game = window.interactiveGames[id];
            if(btn && game) {
                let isWin = game.type === 'kahoot' ? (game.userPick === game.data.correcta) : game.isWin;
                btn.innerHTML = isWin 
                    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Examen Superat (Veure)` 
                    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Examen Pendent de Repassar (Veure)`;
                btn.className = isWin 
                    ? "bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800/50 text-emerald-900 dark:text-emerald-300 font-bold py-3.5 px-4 rounded-xl w-full flex items-center justify-center gap-2 mt-4 transition hover:bg-emerald-100 dark:hover:bg-emerald-900/60" 
                    : "bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800/50 text-rose-900 dark:text-rose-300 font-bold py-3.5 px-4 rounded-xl w-full flex items-center justify-center gap-2 mt-4 transition hover:bg-rose-100 dark:hover:bg-rose-900/60";
            }
        }

        // --- RENDERITZAT DE MISSATGES (AMB ELS NOUS BOTONS) ---
        function formatMessage(text) {
            if(!text) return "";
            let idCounter = 0;
            const interactiveBlocks = [];
            
            // Analitzador de Flashcards
            text = text.replace(/```flashcards([\s\S]*?)```/gi, function(match, p1) {
                try {
                    let deck = JSON.parse(p1.trim());
                    let id = 'fc_' + Date.now() + idCounter;
                    interactiveBlocks[idCounter] = { type: 'flashcards', data: deck, id: id };
                    idCounter++;
                    return `@@@BLOCK_${idCounter-1}@@@`;
                } catch(e) { return match; }
            });

            text = text.replace(/```(?:html|xml)?\s*(<[\s\S]*?)```/gi, function(match, p1) {
                try {
                    let id = 'html_' + Date.now() + idCounter;
                    interactiveBlocks[idCounter] = { type: 'html', data: p1.trim(), id: id };
                    idCounter++;
                    return `@@@BLOCK_${idCounter-1}@@@`;
                } catch(e) { return match; }
            });

            text = text.replace(/```kahoot([\s\S]*?)```/gi, function(match, p1) {
                try {
                    let k = JSON.parse(p1.trim());
                    let id = 'kahoot_' + Date.now() + idCounter;
                    interactiveBlocks[idCounter] = { type: 'kahoot', data: k, id: id, title: "🎮 Kahoot: Pregunta Ràpida" };
                    idCounter++;
                    return `@@@BLOCK_${idCounter-1}@@@`;
                } catch(e) { return ""; }
            });

            // Analitzador Veritat o Fals (Es converteix en un Kahoot de 2 opcions)
            text = text.replace(/```tf([\s\S]*?)```/gi, function(match, p1) {
                try {
                    let t = JSON.parse(p1.trim());
                    let k = { pregunta: t.pregunta, opcions: ["Veritat", "Fals"], correcta: t.resposta ? 0 : 1 };
                    let id = 'kahoot_' + Date.now() + idCounter;
                    interactiveBlocks[idCounter] = { type: 'kahoot', data: k, id: id, title: "⚖️ Veritat o Fals" };
                    idCounter++;
                    return `@@@BLOCK_${idCounter-1}@@@`;
                } catch(e) { return ""; }
            });

            // Analitzador Intrús (Es converteix en un Kahoot)
            text = text.replace(/```intrus([\s\S]*?)```/gi, function(match, p1) {
                try {
                    let k = JSON.parse(p1.trim());
                    let id = 'kahoot_' + Date.now() + idCounter;
                    interactiveBlocks[idCounter] = { type: 'kahoot', data: k, id: id, title: "🕵️ Troba l'Intrús" };
                    idCounter++;
                    return `@@@BLOCK_${idCounter-1}@@@`;
                } catch(e) { return ""; }
            });

            text = text.replace(/```schema([\s\S]*?)```/gi, function(match, p1) {
                try {
                    let s = JSON.parse(p1.trim());
                    let id = 'schema_' + Date.now() + idCounter;
                    interactiveBlocks[idCounter] = { type: 'schema', data: s, id: id };
                    idCounter++;
                    return `@@@BLOCK_${idCounter-1}@@@`;
                } catch(e) { return ""; }
            });

            let htmlContent = marked.parse(text);

            // Fer que els enllaços siguin blaus i s'obrin en una pestanya nova
            htmlContent = htmlContent.replace(/<a href="/g, '<a target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:text-blue-600 underline font-semibold transition-colors" href="');

            // Fer que les imatges de markdown es puguin clicar per obrir el lightbox
            htmlContent = htmlContent.replace(/<img /g, '<img onclick="openLightbox(this.src)" class="cursor-zoom-in hover:opacity-95 transition shadow-lg rounded-xl my-2 max-h-[320px] object-cover border border-zinc-200 dark:border-zinc-800" ');

            // Codi amb estil Gemini (Caixa fosca, capçalera neta amb nom d'idioma i botó copiar)
            htmlContent = htmlContent.replace(/<pre><code(?: class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/gi, function(m, lang, code) {
                const displayLang = lang ? (lang.charAt(0).toUpperCase() + lang.slice(1)) : 'Codi';
                return `<div class="code-block-wrapper my-3 rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-[#1e1f20] shadow-sm">
                    <div class="flex items-center justify-between px-3.5 py-1.5 bg-[#18181b] border-b border-zinc-800 text-xs text-zinc-400 font-mono">
                        <span class="font-semibold text-zinc-300 text-[11px]">${displayLang}</span>
                        <button type="button" onclick="copyCode(this)" class="flex items-center gap-1 p-1 hover:text-white rounded hover:bg-zinc-800 text-[11px] cursor-pointer transition">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                            <span>Copiar</span>
                        </button>
                    </div>
                    <pre class="p-3 text-xs md:text-[13px] font-mono overflow-x-auto text-zinc-100 m-0 bg-transparent leading-relaxed"><code class="${lang ? 'language-' + lang : ''}">${code}</code></pre>
                </div>`;
            });

            htmlContent = htmlContent.replace(/\[BOTON_FLASHCARDS\]/gi, function() {
                let mId = 'marker_' + Date.now() + Math.floor(Math.random() * 1000);
                return `<div id="${mId}" class="theory-marker hidden" data-type="📖 Teoria General"></div><div class="my-4 mt-5 flex justify-end"><button onclick="requestNextPhase(this, 'Molt bé, teoria entesa. Ara dóna\\'m les Flashcards i l\\'Esquema visual d\\'aquest tema.')" class="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold py-3 px-5 rounded-2xl transition-all shadow-md shadow-blue-500/20 flex items-center gap-2 text-xs md:text-sm active:scale-[0.98] cursor-pointer group"><span>Següent: Esquema i Flashcards</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="transform group-hover:translate-x-1 transition-transform"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></button></div>`;
            });

            htmlContent = htmlContent.replace(/\[BOTON_MNEMOTECNIA\]/gi, function() {
                let mId = 'marker_' + Date.now() + Math.floor(Math.random() * 1000);
                return `<div id="${mId}" class="theory-marker hidden" data-type="🗂️ Esquema i Flashcards"></div><div class="my-4 mt-5 flex justify-end"><button onclick="requestNextPhase(this, 'Perfecte. Ara explica\\'m un truc de mnemotècnia per recordar això fàcilment.')" class="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-bold py-3 px-5 rounded-2xl transition-all shadow-md shadow-purple-500/20 flex items-center gap-2 text-xs md:text-sm active:scale-[0.98] cursor-pointer group"><span>Següent: Truc de Memòria</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="transform group-hover:translate-x-1 transition-transform"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></button></div>`;
            });

            htmlContent = htmlContent.replace(/\[BOTON_ENTENDIDO\]/gi, function() {
                let mId = 'marker_' + Date.now() + Math.floor(Math.random() * 1000);
                return `<div id="${mId}" class="theory-marker hidden" data-type="🧠 Mnemotècnia"></div><div class="my-4 mt-5 flex justify-end"><button onclick="requestMinigame(this)" class="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold py-3 px-5 rounded-2xl transition-all shadow-md shadow-emerald-500/20 flex items-center gap-2 text-xs md:text-sm active:scale-[0.98] cursor-pointer group"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg><span>Posar-me a prova amb Minijocs</span></button></div>`;
            });

            for (let i = 0; i < interactiveBlocks.length; i++) {
                let block = interactiveBlocks[i];
                let uiCode = "";
                
                try {
                    if (block.type === 'flashcards') {
                        window.flashcardDecks[block.id] = { cards: block.data, current: 0, flipped: false };
                        uiCode = `
                        <div class="my-6 max-w-md mx-auto relative select-none fc-perspective">
                            <div class="flex justify-between items-center mb-2 px-1">
                                <span class="text-xs font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-wide flex items-center gap-1.5">
                                    <span class="w-2 h-2 rounded-full bg-blue-500"></span> Repàs 3D (Flashcards)
                                </span>
                                <span class="bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-[10px] font-bold px-2.5 py-1 rounded-full border border-zinc-300 dark:border-zinc-700" id="${block.id}_counter">1/${block.data.length}</span>
                            </div>
                            
                            <div id="${block.id}_card" onclick="flipFC('${block.id}')" class="h-56 cursor-pointer relative group">
                                <div id="${block.id}_inner" class="w-full h-full relative fc-card-inner rounded-[2rem] shadow-xl border-2 border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 transition-all hover:border-blue-500 dark:hover:border-blue-500">
                                    <!-- CARA DAVANT (PREGUNTA) -->
                                    <div class="absolute inset-0 p-6 flex flex-col items-center justify-center text-center fc-front bg-white dark:bg-zinc-900 rounded-[2rem]">
                                        <span class="text-[10px] font-black uppercase text-blue-600 dark:text-blue-400 block mb-2 tracking-widest bg-blue-50 dark:bg-blue-950/50 px-2.5 py-1 rounded-full border border-blue-200 dark:border-blue-900/50">PREGUNTA</span>
                                        <span id="${block.id}_q" class="text-base md:text-lg font-bold text-zinc-800 dark:text-zinc-100 leading-snug px-2">${block.data[0].q}</span>
                                        <span class="absolute bottom-3 text-[10px] text-zinc-500 dark:text-zinc-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors font-bold uppercase tracking-widest flex items-center gap-1.5">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg> Clica per girar la targeta
                                        </span>
                                    </div>
                                    <!-- CARA DARRERE (RESPOSTA + AVALUACIÓ) -->
                                    <div class="absolute inset-0 p-5 flex flex-col items-center justify-between text-center fc-back bg-gradient-to-b from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950 rounded-[2rem]">
                                        <div class="flex flex-col items-center justify-center flex-1 my-auto">
                                            <span class="text-[10px] font-black uppercase text-emerald-600 dark:text-emerald-400 block mb-1 tracking-widest bg-emerald-50 dark:bg-emerald-950/50 px-2.5 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-900/50">RESPOSTA</span>
                                            <span id="${block.id}_a" class="text-sm md:text-base font-semibold text-zinc-900 dark:text-zinc-100 leading-snug px-2">${block.data[0].a}</span>
                                        </div>
                                        <!-- BOTONS D'AVALUACIÓ -->
                                        <div class="w-full pt-2 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-center gap-1.5" onclick="event.stopPropagation()">
                                            <button onclick="rateFC('${block.id}', 'hard')" class="flex-1 py-1.5 px-2 bg-red-100 dark:bg-red-950/50 hover:bg-red-200 dark:hover:bg-red-900/70 text-red-900 dark:text-red-300 rounded-xl text-[11px] font-bold border border-red-300 dark:border-red-900/50 transition interactive-btn flex items-center justify-center gap-1">
                                                <span class="w-2 h-2 rounded-full bg-red-500"></span> Difícil
                                            </button>
                                            <button onclick="rateFC('${block.id}', 'medium')" class="flex-1 py-1.5 px-2 bg-amber-100 dark:bg-amber-950/50 hover:bg-amber-200 dark:hover:bg-amber-900/70 text-amber-900 dark:text-amber-300 rounded-xl text-[11px] font-bold border border-amber-300 dark:border-amber-900/50 transition interactive-btn flex items-center justify-center gap-1">
                                                <span class="w-2 h-2 rounded-full bg-amber-500"></span> Regular
                                            </button>
                                            <button onclick="rateFC('${block.id}', 'easy')" class="flex-1 py-1.5 px-2 bg-emerald-100 dark:bg-emerald-950/50 hover:bg-emerald-200 dark:hover:bg-emerald-900/70 text-emerald-900 dark:text-emerald-300 rounded-xl text-[11px] font-bold border border-emerald-300 dark:border-emerald-900/50 transition interactive-btn flex items-center justify-center gap-1">
                                                <span class="w-2 h-2 rounded-full bg-emerald-500"></span> Dominat
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="flex justify-between items-center mt-3 px-2">
                                <button onclick="prevFC('${block.id}')" class="p-2.5 bg-zinc-100 dark:bg-zinc-800 rounded-xl hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 transition-all shadow-sm flex items-center gap-1 text-xs font-bold border border-zinc-200 dark:border-zinc-700">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg> Anterior
                                </button>
                                <button onclick="nextFC('${block.id}')" class="p-2.5 bg-zinc-900 dark:bg-zinc-800 text-white dark:text-zinc-200 rounded-xl hover:bg-zinc-800 dark:hover:bg-zinc-700 transition-all shadow-sm flex items-center gap-1 text-xs font-bold border border-transparent dark:border-zinc-700">
                                    Següent <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
                                </button>
                            </div>
                        </div>`;
                    } else if (block.type === 'html') {
                        uiCode = `<div class="my-6 w-full max-w-lg mx-auto bg-zinc-50 dark:bg-zinc-900 rounded-[1.2rem] p-4 md:p-5 shadow border border-zinc-200 dark:border-zinc-800 overflow-x-auto text-zinc-900 dark:text-zinc-100 text-sm [&_summary]:cursor-pointer [&_summary]:font-bold [&_summary]:text-base [&_details]:bg-white dark:[&_details]:bg-zinc-800 [&_details]:p-3 [&_details]:rounded-lg [&_details]:border [&_details]:border-zinc-200 dark:[&_details]:border-zinc-700 [&_details]:mt-1.5 [&_h2]:text-lg [&_h3]:text-base">${block.data}</div>`;
                    } else {
                        if (!window.interactiveGames[block.id]) {
                            block.data.attempts = 0;
                            block.data.attemptsLog = [];
                            window.interactiveGames[block.id] = { type: block.type, data: block.data, status: 'new', title: block.title };
                        }
                        
                        let game = window.interactiveGames[block.id];
                        let btnClass = "bg-indigo-50 dark:bg-zinc-800 border border-indigo-200 dark:border-zinc-700 text-indigo-900 dark:text-zinc-200 hover:bg-indigo-100 dark:hover:bg-zinc-700/80";
                        let btnText = "<svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5'><polygon points='5 3 19 12 5 21 5 3'/></svg> Obre l'Examen Interactiu";
                        
                        if (game.status === 'completed') {
                            let isWin = game.type === 'kahoot' ? (game.userPick === game.data.correcta) : game.isWin;
                            btnClass = isWin ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800/50 text-emerald-900 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/60" : "bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800/50 text-rose-900 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60";
                            btnText = isWin ? "<svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='3'><polyline points='20 6 9 17 4 12'/></svg> Examen Superat (Veure)" : "<svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='3'><line x1='18' y1='6' x2='6' y2='18'/><line x1='6' y1='6' x2='18' y2='18'/></svg> Examen Pendent de Repassar (Veure)";
                        }

                        uiCode = `<div class="my-4"><button id="launch_btn_${block.id}" onclick="openGameModal('${block.id}')" class="${btnClass} font-bold py-3.5 px-4 rounded-xl transition shadow-sm w-full flex items-center justify-center gap-2 text-sm interactive-btn border">${btnText}</button></div>`;
                    }
                } catch(e) {
                    uiCode = `<div class="bg-red-50 text-red-600 p-3 rounded-xl text-center font-bold text-xs">Error al generar.</div>`;
                }
                
                htmlContent = htmlContent.replace(`@@@BLOCK_${i}@@@`, uiCode);
            }
            return htmlContent;
        }

        window.copyCode = function(btn) {
            const codeWrapper = btn.closest('.code-block-wrapper');
            if (!codeWrapper) return;
            const codeEl = codeWrapper.querySelector('code');
            if (!codeEl) return;
            navigator.clipboard.writeText(codeEl.innerText).then(() => {
                const span = btn.querySelector('span');
                const orig = span ? span.innerText : 'Copiar';
                if (span) span.innerText = 'Copiat!';
                setTimeout(() => { if (span) span.innerText = orig; }, 2000);
            }).catch(() => {
                showToast('Error al copiar el codi', 'error');
            });
        };

        window.copyMsgText = function(btn) {
            const parentMsg = btn.closest('.chat-msg-ai');
            if (!parentMsg) return;
            const prose = parentMsg.querySelector('.prose');
            if (!prose) return;
            navigator.clipboard.writeText(prose.innerText).then(() => {
                showToast('Text copiat al porta-retalls!', 'success');
            }).catch(() => {
                showToast('No s\'ha pogut copiar el text', 'error');
            });
        };

        function appendMessage(sender, text, searchQueries = [], sources = []) {
            const box = document.getElementById('chat-messages');
            if (!box) return;
            const div = document.createElement('div');
            if (sender === 'user') {
                div.className = "flex justify-end w-full mb-3";
                div.innerHTML = `<div class="bg-blue-600 dark:bg-[#282a2c] text-white dark:text-zinc-100 px-4 py-2.5 rounded-2xl rounded-tr-sm max-w-[85%] sm:max-w-[75%] text-xs sm:text-sm font-medium shadow-xs break-words leading-relaxed">${formatMessage(text)}</div>`;
            } else {
                div.className = "flex justify-start gap-2.5 sm:gap-3 w-full mb-5 chat-msg-ai transition-all duration-200";

                let searchBadgeHtml = "";
                if (Array.isArray(searchQueries) && searchQueries.length > 0) {
                    searchBadgeHtml = `
                    <div class="mb-2 flex flex-wrap items-center gap-1.5">
                        ${searchQueries.map(q => `
                            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-950/70 border border-blue-200/80 dark:border-blue-900/60 text-blue-600 dark:text-blue-400 text-[11px] font-semibold shadow-xs">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                                <span>Cercat amb Google: "${escapeHtml(q)}"</span>
                            </span>
                        `).join('')}
                    </div>`;
                }

                div.innerHTML = `
                <div class="relative shrink-0 mt-0.5">
                    <div class="w-7 h-7 rounded-full bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 text-white flex items-center justify-center font-bold text-[10px] shadow-xs">AI</div>
                </div>
                <div class="flex-1 max-w-[95%] sm:max-w-[90%] text-zinc-900 dark:text-zinc-100 overflow-hidden group">
                    ${searchBadgeHtml}
                    <div class="prose prose-sm dark:prose-invert max-w-none text-xs sm:text-[13.5px] leading-relaxed break-words overflow-x-auto">${formatMessage(text)}</div>
                    <!-- FILA D'ACCIONS ESTIL GEMINI -->
                    <div class="flex items-center gap-1 mt-2 text-zinc-400 dark:text-zinc-500 text-xs">
                        <button onclick="this.classList.toggle('text-blue-500')" title="M'agrada" class="p-1 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition cursor-pointer">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
                        </button>
                        <button onclick="this.classList.toggle('text-rose-500')" title="No m'agrada" class="p-1 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition cursor-pointer">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/></svg>
                        </button>
                        <button onclick="triggerAiResponse()" title="Regenerar resposta" class="p-1 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition cursor-pointer">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 21h5v-5"/></svg>
                        </button>
                        <button onclick="window.copyMsgText(this)" title="Copiar resposta" class="p-1 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition cursor-pointer">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                        </button>
                        <button onclick="speakMessageText(this.closest('.chat-msg-ai').querySelector('.prose').innerText)" title="🔊 Escoltar amb veu" class="p-1 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition cursor-pointer">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                        </button>
                    </div>
                </div>`;
            }
            box.appendChild(div);
            setTimeout(() => { box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' }); }, 100);

            // El xat de text roman 100% per escrit. La veu només s'activa quan s'obre el Xat de Veu / Trucada.
        }

        function appendLoading(id) {
            const box = document.getElementById('chat-messages');
            if (!box) return;
            const div = document.createElement('div');
            div.id = id;
            div.className = "flex justify-start gap-2.5 sm:gap-3 w-full mb-4";
            div.innerHTML = `
            <div class="relative shrink-0 mt-0.5">
                <div class="w-7 h-7 rounded-full bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 text-white flex items-center justify-center font-bold text-[10px] shadow-xs">AI</div>
            </div>
            <div class="bg-white/95 dark:bg-[#1e1f20] border border-zinc-200 dark:border-zinc-800 px-3.5 py-2 rounded-full flex gap-1.5 shadow-xs items-center h-8">
                <div class="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce"></div>
                <div class="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style="animation-delay: 0.15s"></div>
                <div class="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce" style="animation-delay: 0.3s"></div>
            </div>`;
            box.appendChild(div);
            box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
        }

        // Si la barra lateral està col·lapsada, clicar a fons buit la fa gran, però clicar a botons executa l'acció directament
        document.getElementById('sidebar')?.addEventListener('click', (e) => {
            if (e.target && (e.target.closest('button') || e.target.closest('a') || e.target.closest('#sidebar-toggle-btn'))) return;
            if (document.body.classList.contains('sidebar-collapsed')) {
                toggleSidebar();
            }
        });
    