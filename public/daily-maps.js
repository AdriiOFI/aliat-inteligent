/**
 * AliatMaps · Mòdul Google Maps per a Ús Quotidià (Aliat Intel·ligent)
 * Horaris reals de bus/tren (Routes API TRANSIT), pregunta en llenguatge natural, cotxe aparcat, serveis propers i rutes.
 * Docs:
 * - Maps JS API: https://developers.google.com/maps/documentation/javascript/overview?utm_campaign=gmp_mcp_codeassist_v1_aistudio
 * - Places API (New): https://developers.google.com/maps/documentation/javascript/place?utm_campaign=gmp_mcp_codeassist_v1_aistudio
 * - Routes API (Route class / REST TRANSIT): https://developers.google.com/maps/documentation/javascript/routes?utm_campaign=gmp_mcp_codeassist_v1_aistudio
 * - Geocoding API: https://developers.google.com/maps/documentation/geocoding/overview?utm_campaign=gmp_mcp_codeassist_v1_aistudio
 */
(function () {
    'use strict';

    const ATTRIBUTION_ID = 'gmp_mcp_codeassist_v1_aistudio';
    const STORAGE_KEY_PARKING = 'aliat_daily_parked_vehicle_v1';
    const STORAGE_KEY_PLACES = 'aliat_daily_saved_places_v1';
    const STORAGE_KEY_OWNER = 'aliat_daily_maps_owner_v1';
    const DEFAULT_CENTER = { lat: 41.3874, lng: 2.1686 }; // Barcelona center fallback

    // --- Tier 1: Global Maps JavaScript API Quota & Auth Defense ---
    window.gm_authFailure = () => {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
    };
    const origConsoleError = console.error;
    console.error = (...args) => {
        origConsoleError.apply(console, args);
        const msg = args.map((a) => String(a)).join(' ');
        if (msg.includes('OverQuotaMapError') || msg.includes('QuotaExceededError')) {
            window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
    };

    window.addEventListener('gmp-quota-exceeded', () => {
        const banner = document.getElementById('gmp-quota-exceeded-banner');
        if (banner) {
            banner.classList.remove('hidden');
        }
    });

    function isQuotaError(errOrStatus) {
        if (!errOrStatus) return false;
        const msg = String(errOrStatus?.message || errOrStatus?.status || errOrStatus || '');
        return (
            msg.includes('429') ||
            msg.includes('RESOURCE_EXHAUSTED') ||
            msg.includes('OVER_QUERY_LIMIT') ||
            msg.includes('OverQuotaMapError') ||
            msg.includes('QuotaExceededError')
        );
    }

    function esc(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function iconSvg(name, cls = 'w-4 h-4 shrink-0') {
        if (typeof window.aliatSvg === 'function') {
            return window.aliatSvg(name, cls);
        }
        return `<span data-aliat-icon="${esc(name)}" data-icon-class="${esc(cls)}" class="inline-flex items-center justify-center shrink-0"></span>`;
    }

    // State
    let loaderConfigured = false;
    let loaderModulePromise = null;
    let mapInstance = null;
    let mapClasses = null; // { Map, InfoWindow, LatLngBounds, AdvancedMarkerElement, PinElement, Place, PlaceAutocompleteElement, Route, encoding }
    let activeTab = 'transit'; // 'transit' | 'parking' | 'nearby' | 'routes' | 'saved'
    let userLocation = null;
    let userMarker = null;
    let parkingMarker = null;
    let homeMarker = null;
    let schoolMarker = null;
    let mapPickMode = null; // null | 'home' | 'school'
    let activePlaceMarkers = [];
    let activeRoutePolylines = [];
    let activeRouteMarkers = [];
    let sharedInfoWindow = null;
    let parkingCountdownInterval = null;
    let selectedTravelMode = 'WALKING'; // 'WALKING' | 'DRIVING' | 'BICYCLING' | 'TRANSIT'
    let routeDestinationCoords = null;
    let routeDestinationLabel = '';
    let trafficLayer = null;
    let trafficEnabled = false;
    let satelliteEnabled = false;

    // State for AliatMaps Public Transit & AI Assistant
    const transitState = {
        question: '',
        aiMode: 'transit', // 'transit' | 'explore' | 'set_place'
        originMode: 'current', // 'current' | 'saved' | 'custom'
        originAddress: '',
        originCoords: null,
        originLabel: 'Ubicació actual (GPS)',
        destMode: 'custom', // 'saved' | 'custom'
        destAddress: '',
        destCoords: null,
        destLabel: '',
        timeMode: 'departure', // 'departure' | 'arrival'
        timeStr: '08:00',
        deadlineTimeStr: '09:00',
        arrivalSlightlyBefore: true,
        dayOffset: 0, // 0 = Avui, 1 = Demà
        autoShiftedToTomorrow: false,
        modeFilter: 'ALL', // 'ALL' | 'BUS' | 'RAIL' | 'SUBWAY'
        lang: 'ca',
        routes: [],
        selectedRouteIdx: 0,
        selectedPhaseIdx: null,
        expandedWalkPhases: {},
        routeListFilter: 'ALL',
        verdictHtml: '',
        verdictPlainText: '',
        verdictStatus: 'ok',
        loading: false,
        needsPlaceSetup: null,
        exploreAnswerText: '',
        exploreCenterLabel: '',
        explorePlaces: [],
        lastExploreContext: null,
        conversation: [],
        placesSyncedWithAccount: false,
        placesSyncedWithFirestore: false,
        setPlaceRole: null,
        setPlaceCandidates: [],
        homeEditorOpen: false,
        homeSearchQuery: '',
        homeSearchCandidates: [],
        homeSearchLoading: false,
        placeEditorRole: null, // null | 'home' | 'school'
        placeSearchQuery: '',
        placeSearchCandidates: [],
        placeSearchLoading: false,
        inputMode: 'ai', // 'ai' | 'manual'
        manualFiltersOpen: true
    };

    // Authoritative in-memory cache backed by Firebase Firestore user profile
    let firestoreProfilePlaces = null;
    let firestoreProfileParking = null;

    // Everyday nearby categories (Places API New)
    const NEARBY_CATEGORIES = [
        { id: 'pharmacy', label: 'Farmàcies', iconName: 'pharmacy', types: ['pharmacy'], color: '#10b981' },
        { id: 'supermarket', label: 'Supermercats', iconName: 'cart', types: ['supermarket', 'grocery_store'], color: '#f59e0b' },
        { id: 'gas', label: 'Gasolineres', iconName: 'fuel', types: ['gas_station'], color: '#ef4444' },
        { id: 'ev', label: 'Càrrega EV', iconName: 'bolt', types: ['electric_vehicle_charging_station'], color: '#06b6d4' },
        { id: 'atm', label: 'Caixers / Bancs', iconName: 'atm', types: ['atm', 'bank'], color: '#6366f1' },
        { id: 'cafe', label: 'Cafeteries / Wi-Fi', iconName: 'coffee', types: ['cafe', 'bakery'], color: '#d97706' },
        { id: 'parking', label: 'Pàrquings', iconName: 'parking', types: ['parking'], color: '#2563eb' },
        { id: 'transit', label: 'Transport Públic', iconName: 'metro', types: ['transit_station', 'subway_station', 'bus_station'], color: '#8b5cf6' }
    ];

    let pushPlacesTimeoutId = null;
    let suppressRemotePush = false;

    function getCurrentUserEmailSafe() {
        try {
            const direct = String(localStorage.getItem('aliat_user_email') || '').trim().toLowerCase();
            if (direct) return direct;
            const rawUser = localStorage.getItem('aliat_user');
            if (rawUser) {
                const parsed = JSON.parse(rawUser);
                if (parsed && parsed.email) return String(parsed.email).trim().toLowerCase();
            }
            if (window.authUser && window.authUser.email) {
                return String(window.authUser.email).trim().toLowerCase();
            }
            if (window.googleWorkspaceAccountEmail) {
                return String(window.googleWorkspaceAccountEmail).trim().toLowerCase();
            }
            return '';
        } catch (_) {
            return '';
        }
    }

    function getUserPlacesBackupKey(email) {
        const clean = String(email || '').trim().toLowerCase().replace(/[^a-z0-9@._-]/g, '');
        return clean ? `aliat_daily_saved_places_u_${clean}` : '';
    }

    function getUserParkingBackupKey(email) {
        const clean = String(email || '').trim().toLowerCase().replace(/[^a-z0-9@._-]/g, '');
        return clean ? `aliat_daily_parked_u_${clean}` : '';
    }

    function getPlaceRoleKeyForMerge(p) {
        if (!p) return '';
        if (p.role === 'home' || p.role === 'school' || p.role === 'work') return `role:${p.role}`;
        const txt = `${p.title || ''} ${p.category || ''}`;
        if (/casa|llar|home/i.test(txt)) return 'role:home';
        if (/insti|institut|instituto|uni|universit|escola|estud|cole/i.test(txt)) return 'role:school';
        if (/feina|trabajo|oficina|work/i.test(txt)) return 'role:work';
        return `id:${p.id || `${Number(p.lat).toFixed(4)},${Number(p.lng).toFixed(4)}`}`;
    }

    function isFirebaseProfileActive() {
        return typeof window.hasFirebaseMapsProfile === 'function' && window.hasFirebaseMapsProfile();
    }

    function mergeSavedPlacesLists(...lists) {
        const map = new Map();
        for (const list of lists) {
            if (!Array.isArray(list)) continue;
            for (const item of list) {
                if (!item || typeof item.lat !== 'number' || typeof item.lng !== 'number') continue;
                const key = getPlaceRoleKeyForMerge(item);
                const prev = map.get(key);
                const prevTs = typeof prev?.savedAt === 'number' ? prev.savedAt : 0;
                const curTs = typeof item.savedAt === 'number' ? item.savedAt : 0;
                if (!prev || curTs >= prevTs) {
                    map.set(key, item);
                }
            }
        }
        return Array.from(map.values())
            .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
            .slice(0, 30);
    }

    function schedulePushPlacesToServer() {
        if (suppressRemotePush) return;
        if (pushPlacesTimeoutId) clearTimeout(pushPlacesTimeoutId);
        pushPlacesTimeoutId = setTimeout(() => {
            pushPlacesTimeoutId = null;
            pushMapsPlacesToServerNow().catch(() => {});
        }, 80);
    }

    async function pushMapsPlacesToServerNow() {
        try {
            const token = localStorage.getItem('aliat_token') || '';
            const places = loadSavedEverydayPlaces();
            const parkedVehicle = loadParkedVehicleState();
            let syncedAny = false;
            let syncedFirestore = false;

            if (typeof window.saveAliatMapsPlacesToFirestore === 'function' && isFirebaseProfileActive()) {
                try {
                    const fsOk = await window.saveAliatMapsPlacesToFirestore(places, parkedVehicle);
                    if (fsOk) {
                        syncedAny = true;
                        syncedFirestore = true;
                        firestoreProfilePlaces = places.slice();
                        firestoreProfileParking = parkedVehicle ? { ...parkedVehicle } : null;
                    }
                } catch (_) {}
            }

            if (token) {
                try {
                    const res = await fetch('/api/maps/places', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({ places, parkedVehicle })
                    });
                    if (res.ok) syncedAny = true;
                } catch (_) {}
            }

            if (syncedAny) {
                transitState.placesSyncedWithAccount = true;
                transitState.placesSyncedWithFirestore = syncedFirestore;
                const email = getCurrentUserEmailSafe();
                if (email && !syncedFirestore) localStorage.setItem(STORAGE_KEY_OWNER, email);
                return true;
            }
        } catch (_) {}
        return false;
    }

    window.onAliatFirebaseMapsSignOut = function () {
        firestoreProfilePlaces = null;
        firestoreProfileParking = null;
        transitState.placesSyncedWithAccount = false;
        transitState.placesSyncedWithFirestore = false;
        if (mapInstance && mapClasses) {
            renderSavedHomeAndSchoolMarkers();
            renderParkingMarkerOnMap();
        }
        if (activeTab === 'transit') renderTransitTabContent();
        else if (activeTab === 'saved') renderSavedPlacesTabContent();
        else if (activeTab === 'parking') renderParkingTabContent();
    };

    async function syncMapsPlacesFromServer() {
        try {
            const token = localStorage.getItem('aliat_token') || '';
            const currentEmail = getCurrentUserEmailSafe();
            const fbActive = isFirebaseProfileActive();

            // When signed in to Firebase Auth, Firebase Firestore is the authoritative user profile store.
            // Only migrate temporary localStorage places once if the user added them right before signing in.
            const [firestoreData, tursoData] = await Promise.all([
                (async () => {
                    if (typeof window.loadAliatMapsPlacesFromFirestore !== 'function') return null;
                    try {
                        return await window.loadAliatMapsPlacesFromFirestore();
                    } catch (_) {
                        return null;
                    }
                })(),
                (async () => {
                    if (!token) return null;
                    try {
                        const res = await fetch('/api/maps/places', {
                            headers: { 'Authorization': `Bearer ${token}` },
                            cache: 'no-store'
                        });
                        if (!res.ok) return null;
                        const d = await res.json().catch(() => null);
                        return (d && d.success) ? d : null;
                    } catch (_) {
                        return null;
                    }
                })()
            ]);

            if (firestoreData || fbActive) {
                const fsPlaces = Array.isArray(firestoreData?.places) ? firestoreData.places : [];
                const tursoPlaces = Array.isArray(tursoData?.places) ? tursoData.places : [];

                // Check temporary unauthenticated localStorage places solely for one-time migration on sign-in
                let tempPlaces = [];
                let tempParking = null;
                try {
                    const rawTempPlaces = localStorage.getItem(STORAGE_KEY_PLACES);
                    if (rawTempPlaces) {
                        const parsed = JSON.parse(rawTempPlaces);
                        if (Array.isArray(parsed)) {
                            tempPlaces = parsed.filter(p => p && typeof p.lat === 'number' && typeof p.lng === 'number');
                        }
                    }
                    const rawTempPark = localStorage.getItem(STORAGE_KEY_PARKING);
                    if (rawTempPark) {
                        const pk = JSON.parse(rawTempPark);
                        if (pk && typeof pk.lat === 'number' && typeof pk.lng === 'number') tempParking = pk;
                    }
                } catch (_) {}

                const mergedPlaces = mergeSavedPlacesLists(fsPlaces, tursoPlaces, tempPlaces);
                const fsParking = firestoreData?.parkedVehicle || null;
                const tursoParking = tursoData?.parkedVehicle || null;
                const mergedParking = [fsParking, tursoParking, tempParking]
                    .filter(p => p && typeof p.lat === 'number' && typeof p.lng === 'number')
                    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0] || null;

                firestoreProfilePlaces = mergedPlaces;
                firestoreProfileParking = mergedParking;
                transitState.placesSyncedWithAccount = true;
                transitState.placesSyncedWithFirestore = true;

                // Replace & retire temporary localStorage once migrated into Firestore profile
                try {
                    localStorage.removeItem(STORAGE_KEY_PLACES);
                    localStorage.removeItem(STORAGE_KEY_PARKING);
                    localStorage.removeItem('aliat_daily_deleted_places_v1');
                    if (currentEmail) {
                        const bKey = getUserPlacesBackupKey(currentEmail);
                        const bPkKey = getUserParkingBackupKey(currentEmail);
                        if (bKey) localStorage.removeItem(bKey);
                        if (bPkKey) localStorage.removeItem(bPkKey);
                    }
                } catch (_) {}

                // Persist migrated entries to Firestore if temp or Turso had items missing from Firestore
                if ((tempPlaces.length > 0 || tursoPlaces.length > fsPlaces.length || (mergedParking && !fsParking)) && typeof window.saveAliatMapsPlacesToFirestore === 'function') {
                    window.saveAliatMapsPlacesToFirestore(mergedPlaces, mergedParking).catch(() => {});
                }

                if (mapInstance && mapClasses) {
                    renderSavedHomeAndSchoolMarkers();
                    renderParkingMarkerOnMap();
                }
                if (activeTab === 'transit') renderTransitTabContent();
                else if (activeTab === 'saved') renderSavedPlacesTabContent();
                else if (activeTab === 'parking') renderParkingTabContent();
                return true;
            }

            // Fallback for non-Firebase accounts (legacy JWT or local guest session)
            const storedOwner = String(localStorage.getItem(STORAGE_KEY_OWNER) || '').trim().toLowerCase();
            if (currentEmail && storedOwner && storedOwner !== currentEmail) {
                const backupPlacesKey = getUserPlacesBackupKey(currentEmail);
                const backupParkKey = getUserParkingBackupKey(currentEmail);
                const backupPlaces = backupPlacesKey ? localStorage.getItem(backupPlacesKey) : null;
                const backupPark = backupParkKey ? localStorage.getItem(backupParkKey) : null;
                if (backupPlaces) localStorage.setItem(STORAGE_KEY_PLACES, backupPlaces);
                else localStorage.removeItem(STORAGE_KEY_PLACES);
                if (backupPark) localStorage.setItem(STORAGE_KEY_PARKING, backupPark);
                else localStorage.removeItem(STORAGE_KEY_PARKING);
                localStorage.setItem(STORAGE_KEY_OWNER, currentEmail);
            }

            if (!token && !currentEmail) {
                transitState.placesSyncedWithAccount = false;
                transitState.placesSyncedWithFirestore = false;
                return false;
            }

            const tursoPlaces = Array.isArray(tursoData?.places) ? tursoData.places : [];
            const localPlaces = loadSavedEverydayPlaces();
            let tombstones = {};
            try { tombstones = JSON.parse(localStorage.getItem('aliat_daily_deleted_places_v1') || '{}') || {}; } catch (_) {}
            const filterDeleted = (arr) => arr.filter((item) => {
                if (!item) return false;
                const ts = typeof item.savedAt === 'number' ? item.savedAt : 0;
                const rKey = getPlaceRoleKeyForMerge(item);
                const delIdTs = tombstones[`id:${item.id}`] || 0;
                const delRoleTs = tombstones[rKey] || 0;
                return ts >= Math.max(delIdTs, delRoleTs);
            });
            const mergedPlaces = mergeSavedPlacesLists(filterDeleted(tursoPlaces), localPlaces);

            const tursoParking = tursoData?.parkedVehicle || null;
            const localParking = loadParkedVehicleState();
            const parkingCandidates = [tursoParking, localParking]
                .filter(p => p && typeof p.lat === 'number' && typeof p.lng === 'number')
                .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
            const mergedParking = parkingCandidates[0] || null;

            suppressRemotePush = true;
            try {
                if (mergedPlaces.length > 0) {
                    const serialized = JSON.stringify(mergedPlaces);
                    localStorage.setItem(STORAGE_KEY_PLACES, serialized);
                    const bKey = getUserPlacesBackupKey(currentEmail);
                    if (bKey) localStorage.setItem(bKey, serialized);
                }

                if (mergedParking) {
                    const serializedPk = JSON.stringify(mergedParking);
                    localStorage.setItem(STORAGE_KEY_PARKING, serializedPk);
                    const bPkKey = getUserParkingBackupKey(currentEmail);
                    if (bPkKey) localStorage.setItem(bPkKey, serializedPk);
                }

                if (currentEmail) localStorage.setItem(STORAGE_KEY_OWNER, currentEmail);
                transitState.placesSyncedWithAccount = Boolean(tursoData || (mergedPlaces.length > 0 && currentEmail));
                transitState.placesSyncedWithFirestore = false;

                if ((mergedPlaces.length > 0 && token && tursoPlaces.length < mergedPlaces.length) || (mergedParking && token && !tursoParking)) {
                    suppressRemotePush = false;
                    pushMapsPlacesToServerNow().catch(() => {});
                    suppressRemotePush = true;
                }
            } finally {
                suppressRemotePush = false;
            }

            if (mapInstance && mapClasses) {
                renderSavedHomeAndSchoolMarkers();
                renderParkingMarkerOnMap();
            }
            if (activeTab === 'transit') renderTransitTabContent();
            else if (activeTab === 'saved') renderSavedPlacesTabContent();
            else if (activeTab === 'parking') renderParkingTabContent();
            return true;
        } catch (_) {
            return false;
        }
    }
    window.syncAliatMapsPlacesFromDb = syncMapsPlacesFromServer;

    function loadParkedVehicleState() {
        try {
            if (isFirebaseProfileActive() && firestoreProfileParking !== null) {
                return firestoreProfileParking;
            }
            let raw = localStorage.getItem(STORAGE_KEY_PARKING);
            if (!raw) {
                const email = getCurrentUserEmailSafe();
                const bKey = getUserParkingBackupKey(email);
                if (bKey) raw = localStorage.getItem(bKey);
            }
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed.lat !== 'number' || typeof parsed.lng !== 'number') return null;
            return parsed;
        } catch (_) {
            return null;
        }
    }

    function saveParkedVehicleState(data) {
        try {
            const payload = data ? { ...data, savedAt: data.savedAt || Date.now() } : null;
            if (isFirebaseProfileActive()) {
                firestoreProfileParking = payload;
                schedulePushPlacesToServer();
                return;
            }
            const email = getCurrentUserEmailSafe();
            if (email) localStorage.setItem(STORAGE_KEY_OWNER, email);
            const bKey = getUserParkingBackupKey(email);
            if (!payload) {
                localStorage.removeItem(STORAGE_KEY_PARKING);
                if (bKey) localStorage.removeItem(bKey);
                schedulePushPlacesToServer();
                return;
            }
            const serialized = JSON.stringify(payload);
            localStorage.setItem(STORAGE_KEY_PARKING, serialized);
            if (bKey) localStorage.setItem(bKey, serialized);
            schedulePushPlacesToServer();
        } catch (_) {}
    }

    function loadSavedEverydayPlaces() {
        try {
            if (isFirebaseProfileActive() && Array.isArray(firestoreProfilePlaces)) {
                return firestoreProfilePlaces.filter((item) => item && typeof item.lat === 'number' && typeof item.lng === 'number');
            }
            let raw = localStorage.getItem(STORAGE_KEY_PLACES);
            if (!raw || raw === '[]') {
                const email = getCurrentUserEmailSafe();
                const bKey = getUserPlacesBackupKey(email);
                const backupRaw = bKey ? localStorage.getItem(bKey) : null;
                if (backupRaw && backupRaw !== '[]') {
                    raw = backupRaw;
                    localStorage.setItem(STORAGE_KEY_PLACES, backupRaw);
                }
            }
            if (!raw) return [];
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr)) return [];
            return arr.filter((item) => item && typeof item.lat === 'number' && typeof item.lng === 'number');
        } catch (_) {
            return [];
        }
    }

    function saveEverydayPlaces(list) {
        try {
            const clean = Array.isArray(list) ? list : [];
            if (isFirebaseProfileActive()) {
                firestoreProfilePlaces = clean;
                schedulePushPlacesToServer();
                return;
            }
            const email = getCurrentUserEmailSafe();
            if (email) localStorage.setItem(STORAGE_KEY_OWNER, email);
            const serialized = JSON.stringify(clean);
            localStorage.setItem(STORAGE_KEY_PLACES, serialized);
            const bKey = getUserPlacesBackupKey(email);
            if (bKey) localStorage.setItem(bKey, serialized);
            schedulePushPlacesToServer();
        } catch (_) {}
    }

    async function loadGoogleMapsLibraries() {
        if (mapClasses) return mapClasses;

        if (!loaderModulePromise) {
            loaderModulePromise = (async () => {
                const cfgRes = await fetch('/api/maps/config');
                const cfg = await cfgRes.json().catch(() => ({}));
                const apiKey = (cfg && cfg.apiKey) ? String(cfg.apiKey).trim() : '';
                if (!apiKey) {
                    throw new Error('MISSING_MAPS_KEY');
                }
                let loaderMod;
                try {
                    loaderMod = await import('/vendor/googlemaps-js-api-loader.mjs');
                } catch (_) {
                    loaderMod = await import('/public/vendor/googlemaps-js-api-loader.mjs');
                }
                if (!loaderConfigured) {
                    const lang = (window.currentAppLang === 'es') ? 'es' : 'ca';
                    loaderMod.setOptions({
                        key: apiKey,
                        v: 'weekly',
                        language: lang,
                        region: 'ES'
                    });
                    loaderConfigured = true;
                }
                const [mapsLib, markerLib, placesLib, routesLib, coreLib, geometryLib] = await Promise.all([
                    loaderMod.importLibrary('maps'),
                    loaderMod.importLibrary('marker'),
                    loaderMod.importLibrary('places'),
                    loaderMod.importLibrary('routes'),
                    loaderMod.importLibrary('core'),
                    loaderMod.importLibrary('geometry').catch(() => null)
                ]);
                mapClasses = {
                    Map: mapsLib.Map,
                    InfoWindow: mapsLib.InfoWindow,
                    LatLngBounds: coreLib.LatLngBounds,
                    AdvancedMarkerElement: markerLib.AdvancedMarkerElement,
                    PinElement: markerLib.PinElement,
                    Place: placesLib.Place,
                    PlaceAutocompleteElement: placesLib.PlaceAutocompleteElement,
                    Route: routesLib.Route,
                    encoding: geometryLib?.encoding || (window.google?.maps?.geometry?.encoding || null)
                };
                return mapClasses;
            })();
        }

        try {
            return await loaderModulePromise;
        } catch (err) {
            loaderModulePromise = null;
            if (isQuotaError(err)) {
                window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
            }
            throw err;
        }
    }

    async function reverseGeocodeCoords(lat, lng) {
        try {
            const lang = (window.currentAppLang === 'es') ? 'es' : 'ca';
            const res = await fetch(`/api/maps/geocode?latlng=${encodeURIComponent(`${lat},${lng}`)}&language=${encodeURIComponent(lang)}`);
            if (res.status === 429) {
                window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
                return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
            }
            const data = await res.json().catch(() => ({}));
            if (data.status === 'OVER_QUERY_LIMIT' || data.status === 'RESOURCE_EXHAUSTED') {
                window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
                return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
            }
            const first = data?.results?.[0];
            return first?.formatted_address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        } catch (_) {
            return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        }
    }

    function clearActiveRouteGraphics() {
        activeRoutePolylines.forEach((p) => {
            try { p.setMap(null); } catch (_) {}
        });
        activeRoutePolylines = [];
        activeRouteMarkers.forEach((m) => {
            try { m.map = null; } catch (_) {}
        });
        activeRouteMarkers = [];
    }

    function clearActivePlaceMarkers() {
        activePlaceMarkers.forEach((m) => {
            try { m.map = null; } catch (_) {}
        });
        activePlaceMarkers = [];
    }

    function renderParkingMarkerOnMap() {
        if (!mapInstance || !mapClasses) return;
        if (parkingMarker) {
            try { parkingMarker.map = null; } catch (_) {}
            parkingMarker = null;
        }
        const parked = loadParkedVehicleState();
        if (!parked) return;

        const { AdvancedMarkerElement } = mapClasses;
        const badge = document.createElement('div');
        const vIconName = parked.vehicleType === 'moto' ? 'moto' : (parked.vehicleType === 'bici' ? 'bike' : 'car');
        const vIcon = iconSvg(vIconName, 'w-3.5 h-3.5 shrink-0');
        badge.className = 'px-2.5 py-1.5 rounded-2xl bg-blue-600 text-white font-extrabold text-xs shadow-lg border-2 border-white flex items-center gap-1.5 cursor-pointer';
        badge.innerHTML = `${vIcon}<span>El meu vehicle</span>`;

        parkingMarker = new AdvancedMarkerElement({
            map: mapInstance,
            position: { lat: parked.lat, lng: parked.lng },
            title: parked.address || 'Vehicle aparcat',
            content: badge
        });

        parkingMarker.addListener('click', () => {
            if (!sharedInfoWindow) sharedInfoWindow = new mapClasses.InfoWindow();
            const spotInfo = [parked.floorSpot, parked.notes].filter(Boolean).join(' · ');
            sharedInfoWindow.setContent(`
                <div class="p-1.5 text-zinc-900 text-xs max-w-[230px] space-y-1">
                    <div class="font-extrabold text-blue-700 flex items-center gap-1.5">${vIcon}<span>Vehicle aparcat aquí</span></div>
                    <div class="text-[11px] font-medium text-zinc-700">${esc(parked.address || '')}</div>
                    ${spotInfo ? `<div class="text-[11px] text-zinc-500">${esc(spotInfo)}</div>` : ''}
                </div>
            `);
            sharedInfoWindow.open({ anchor: parkingMarker, map: mapInstance });
        });
    }

    function renderUserLocationMarker() {
        if (!mapInstance || !mapClasses || !userLocation) return;
        if (userMarker) {
            try { userMarker.map = null; } catch (_) {}
            userMarker = null;
        }
        const { AdvancedMarkerElement } = mapClasses;
        const dot = document.createElement('div');
        dot.className = 'w-4 h-4 rounded-full bg-sky-500 border-2 border-white shadow-md ring-4 ring-sky-500/30';
        userMarker = new AdvancedMarkerElement({
            map: mapInstance,
            position: userLocation,
            title: 'La teva ubicació actual',
            content: dot
        });
    }

    function renderSavedHomeAndSchoolMarkers() {
        if (!mapInstance || !mapClasses) return;
        if (homeMarker) {
            try { homeMarker.map = null; } catch (_) {}
            homeMarker = null;
        }
        if (schoolMarker) {
            try { schoolMarker.map = null; } catch (_) {}
            schoolMarker = null;
        }

        const { AdvancedMarkerElement } = mapClasses;
        const home = findSavedPlaceByRole('home');
        if (home && typeof home.lat === 'number' && typeof home.lng === 'number') {
            const badge = document.createElement('div');
            badge.className = 'px-2.5 py-1 rounded-xl bg-emerald-600 text-white font-extrabold text-[11px] shadow-md border-2 border-white flex items-center gap-1 cursor-pointer';
            badge.innerHTML = `${iconSvg('home', 'w-3.5 h-3.5 shrink-0')}<span>Casa</span>`;
            homeMarker = new AdvancedMarkerElement({
                map: mapInstance,
                position: { lat: home.lat, lng: home.lng },
                title: home.address || 'Casa teva',
                content: badge
            });
            homeMarker.addListener('click', () => {
                if (!sharedInfoWindow) sharedInfoWindow = new mapClasses.InfoWindow();
                sharedInfoWindow.setContent(`
                    <div class="p-1.5 text-zinc-900 text-xs max-w-[230px] space-y-1">
                        <div class="font-extrabold text-emerald-700 flex items-center gap-1.5">${iconSvg('home', 'w-3.5 h-3.5 shrink-0')}<span>Casa teva</span></div>
                        <div class="text-[11px] text-zinc-600">${esc(home.address || home.title)}</div>
                        <div class="pt-1 flex gap-1.5">
                            <button type="button" onclick="window.applyTransitPresetOrigin('home')" class="px-2 py-1 rounded-lg bg-emerald-600 text-white font-bold text-[10px] cursor-pointer">Usar com a origen</button>
                            <button type="button" onclick="window.openHomeEditor(true)" class="px-2 py-1 rounded-lg bg-zinc-200 text-zinc-800 font-bold text-[10px] cursor-pointer">Canviar</button>
                        </div>
                    </div>
                `);
                sharedInfoWindow.open({ anchor: homeMarker, map: mapInstance });
            });
        }

        const school = findSavedPlaceByRole('school');
        if (school && typeof school.lat === 'number' && typeof school.lng === 'number') {
            const badge = document.createElement('div');
            badge.className = 'px-2.5 py-1 rounded-xl bg-indigo-600 text-white font-extrabold text-[11px] shadow-md border-2 border-white flex items-center gap-1 cursor-pointer';
            badge.innerHTML = `${iconSvg('school', 'w-3.5 h-3.5 shrink-0')}<span>${esc(school.title === 'Institut / Universitat' ? 'Insti' : school.title.slice(0, 14))}</span>`;
            schoolMarker = new AdvancedMarkerElement({
                map: mapInstance,
                position: { lat: school.lat, lng: school.lng },
                title: school.address || school.title,
                content: badge
            });
        }
    }

    function updateMapPickBannerUI() {
        const banner = document.getElementById('daily-gmp-map-pick-banner');
        const canvas = document.getElementById('daily-gmp-map-canvas');
        if (canvas) {
            canvas.style.cursor = mapPickMode ? 'crosshair' : '';
        }
        if (!banner) return;
        if (!mapPickMode) {
            banner.classList.add('hidden');
            banner.innerHTML = '';
            return;
        }
        const label = mapPickMode === 'home'
            ? `<span class="inline-flex items-center gap-1.5">${iconSvg('home', 'w-4 h-4 shrink-0')}<span>Fes clic a qualsevol punt del mapa per situar CASA teva</span></span>`
            : `<span class="inline-flex items-center gap-1.5">${iconSvg('school', 'w-4 h-4 shrink-0')}<span>Fes clic a qualsevol punt del mapa per situar el teu INSTITUT / FEINA</span></span>`;
        banner.classList.remove('hidden');
        banner.innerHTML = `
            <div class="px-3.5 py-2.5 rounded-2xl bg-emerald-600 text-white shadow-xl border-2 border-white flex items-center justify-between gap-3 text-xs font-extrabold">
                ${label}
                <button type="button" onclick="window.cancelMapPickMode()" class="px-2.5 py-1 rounded-xl bg-black/25 hover:bg-black/40 text-white text-[11px] font-bold cursor-pointer shrink-0">Cancel·lar</button>
            </div>
        `;
    }

    window.startMapPickMode = function (role) {
        mapPickMode = role === 'school' ? 'school' : 'home';
        updateMapPickBannerUI();
        if (typeof window.showToast === 'function') {
            window.showToast(
                mapPickMode === 'home'
                    ? 'Fes clic sobre el mapa per marcar on és Casa teva.'
                    : 'Fes clic sobre el mapa per marcar el teu Institut.',
                'info'
            );
        }
    };

    window.cancelMapPickMode = function () {
        mapPickMode = null;
        updateMapPickBannerUI();
    };

    function requestUserGeolocation(silent = false) {
        return new Promise((resolve) => {
            if (!navigator.geolocation) {
                if (!silent && typeof window.showToast === 'function') {
                    window.showToast('El teu navegador no suporta geolocalització GPS.', 'warning');
                }
                resolve(null);
                return;
            }
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    userLocation = {
                        lat: pos.coords.latitude,
                        lng: pos.coords.longitude
                    };
                    renderUserLocationMarker();
                    resolve(userLocation);
                },
                () => {
                    if (!silent && typeof window.showToast === 'function') {
                        window.showToast('Permet l\'accés a la ubicació o fes clic directament sobre el mapa per marcar el punt.', 'info');
                    }
                    resolve(null);
                },
                { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
            );
        });
    }

    async function ensureMapInitialized() {
        const container = document.getElementById('daily-gmp-map-canvas');
        const statusOverlay = document.getElementById('daily-gmp-map-status');
        if (!container) return;

        try {
            const libs = await loadGoogleMapsLibraries();
            if (statusOverlay) statusOverlay.classList.add('hidden');

            if (!mapInstance) {
                const parked = loadParkedVehicleState();
                const initialCenter = parked
                    ? { lat: parked.lat, lng: parked.lng }
                    : (userLocation || DEFAULT_CENTER);

                mapInstance = new libs.Map(container, {
                    center: initialCenter,
                    zoom: parked ? 17 : 15,
                    mapId: 'DEMO_MAP_ID',
                    internalUsageAttributionIds: [ATTRIBUTION_ID],
                    mapTypeControl: false,
                    streetViewControl: true,
                    fullscreenControl: true,
                    zoomControl: true
                });

                sharedInfoWindow = new libs.InfoWindow();

                // Click on map behavior depends on active tab
                mapInstance.addListener('click', async (e) => {
                    if (!e.latLng) return;
                    const lat = e.latLng.lat();
                    const lng = e.latLng.lng();
                    handleMapCanvasClick(lat, lng);
                });

                renderParkingMarkerOnMap();
                renderUserLocationMarker();
                renderSavedHomeAndSchoolMarkers();
                updateMapPickBannerUI();

                if (!parked && !userLocation) {
                    requestUserGeolocation(true).then((loc) => {
                        if (loc && mapInstance && !loadParkedVehicleState()) {
                            mapInstance.panTo(loc);
                            mapInstance.setZoom(16);
                        }
                    });
                }
            }

            mountPlaceAutocompleteInputs();
        } catch (err) {
            if (statusOverlay) {
                statusOverlay.classList.remove('hidden');
                statusOverlay.innerHTML = `
                    <div class="max-w-sm text-center p-5 space-y-2">
                        <div class="w-10 h-10 rounded-2xl bg-rose-500/15 text-rose-500 flex items-center justify-center mx-auto font-bold">!</div>
                        <div class="text-xs font-extrabold text-zinc-900 dark:text-white">No s'ha pogut carregar Google Maps</div>
                        <p class="text-[11px] text-zinc-500 dark:text-zinc-400">Verifica la connexió de xarxa o la quota de la clau de Google Maps Platform.</p>
                    </div>
                `;
            }
        }
    }

    function updateFloatingMapControlButtons() {
        const satBtn = document.getElementById('daily-map-sat-btn');
        if (satBtn) {
            satBtn.className = satelliteEnabled
                ? 'h-9 px-2.5 rounded-xl bg-blue-600 text-white border border-blue-500 shadow-lg flex items-center justify-center gap-1.5 cursor-pointer transition text-[11px] font-extrabold'
                : 'h-9 px-2.5 rounded-xl bg-white/95 dark:bg-zinc-900/95 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-100 border border-zinc-200/90 dark:border-zinc-700/90 shadow-lg flex items-center justify-center gap-1.5 cursor-pointer transition text-[11px] font-bold backdrop-blur-md';
        }
        const trafficBtn = document.getElementById('daily-map-traffic-btn');
        if (trafficBtn) {
            trafficBtn.className = trafficEnabled
                ? 'h-9 px-2.5 rounded-xl bg-amber-500 text-white border border-amber-400 shadow-lg flex items-center justify-center gap-1.5 cursor-pointer transition text-[11px] font-extrabold'
                : 'h-9 px-2.5 rounded-xl bg-white/95 dark:bg-zinc-900/95 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-100 border border-zinc-200/90 dark:border-zinc-700/90 shadow-lg flex items-center justify-center gap-1.5 cursor-pointer transition text-[11px] font-bold backdrop-blur-md';
        }
    }

    window.centerDailyMapOnGps = async function () {
        if (!mapInstance) await ensureMapInitialized();
        const loc = await requestUserGeolocation(false);
        if (loc && mapInstance) {
            mapInstance.panTo(loc);
            mapInstance.setZoom(16);
        }
    };

    window.fitDailyMapView = async function () {
        if (!mapInstance) await ensureMapInitialized();
        if (!mapInstance || !window.google?.maps?.LatLngBounds) return;
        const bounds = new window.google.maps.LatLngBounds();
        let count = 0;
        const pushPt = (lat, lng) => {
            if (typeof lat === 'number' && typeof lng === 'number' && !Number.isNaN(lat) && !Number.isNaN(lng)) {
                bounds.extend({ lat, lng });
                count++;
            }
        };

        if (userLocation) pushPt(userLocation.lat, userLocation.lng);
        const parked = loadParkedVehicleState();
        if (parked) pushPt(parked.lat, parked.lng);
        loadSavedEverydayPlaces().forEach((p) => {
            if (p.role === 'home' || p.role === 'school' || p.id === 'home' || p.id === 'school') {
                pushPt(p.lat, p.lng);
            }
        });
        if (routeDestinationCoords) pushPt(routeDestinationCoords.lat, routeDestinationCoords.lng);
        if (transitState.originCoords) pushPt(transitState.originCoords.lat, transitState.originCoords.lng);
        if (transitState.destCoords) pushPt(transitState.destCoords.lat, transitState.destCoords.lng);

        activePlaceMarkers.forEach((m) => {
            try {
                const pos = m?.position;
                if (pos) {
                    const lat = typeof pos.lat === 'function' ? pos.lat() : pos.lat;
                    const lng = typeof pos.lng === 'function' ? pos.lng() : pos.lng;
                    pushPt(lat, lng);
                }
            } catch (_) {}
        });

        activeRoutePolylines.forEach((pline) => {
            try {
                const path = pline?.getPath?.();
                const arr = path ? path.getArray() : [];
                arr.forEach((pt) => {
                    bounds.extend(pt);
                    count++;
                });
            } catch (_) {}
        });

        if (count === 0) {
            window.centerDailyMapOnGps();
            return;
        }
        if (count === 1) {
            mapInstance.panTo(bounds.getCenter());
            mapInstance.setZoom(16);
            return;
        }
        mapInstance.fitBounds(bounds, 52);
    };

    window.toggleDailyMapSatellite = async function () {
        if (!mapInstance) await ensureMapInitialized();
        if (!mapInstance) return;
        satelliteEnabled = !satelliteEnabled;
        try {
            mapInstance.setMapTypeId(satelliteEnabled ? 'hybrid' : 'roadmap');
        } catch (_) {}
        updateFloatingMapControlButtons();
    };

    window.toggleDailyMapTraffic = async function () {
        if (!mapInstance) await ensureMapInitialized();
        if (!mapInstance || !window.google?.maps?.TrafficLayer) return;
        trafficEnabled = !trafficEnabled;
        if (!trafficLayer) {
            trafficLayer = new window.google.maps.TrafficLayer();
        }
        trafficLayer.setMap(trafficEnabled ? mapInstance : null);
        updateFloatingMapControlButtons();
    };

    function mountPlaceAutocompleteInputs() {
        if (!mapClasses || !mapClasses.PlaceAutocompleteElement) return;
        const searchHost = document.getElementById('daily-gmp-autocomplete-host');
        if (searchHost && !searchHost.dataset.mounted) {
            searchHost.dataset.mounted = '1';
            searchHost.innerHTML = '';
            try {
                const autocompleteEl = new mapClasses.PlaceAutocompleteElement({});
                autocompleteEl.style.width = '100%';
                autocompleteEl.addEventListener('gmp-select', async (event) => {
                    try {
                        const placePrediction = event.placePrediction;
                        if (!placePrediction) return;
                        const place = placePrediction.toPlace();
                        await place.fetchFields({
                            fields: ['displayName', 'formattedAddress', 'location', 'rating', 'userRatingCount', 'googleMapsURI']
                        });
                        if (place.location && mapInstance) {
                            const lat = place.location.lat();
                            const lng = place.location.lng();
                            mapInstance.panTo({ lat, lng });
                            mapInstance.setZoom(17);
                            routeDestinationCoords = { lat, lng };
                            routeDestinationLabel = place.displayName || place.formattedAddress || 'Destinació seleccionada';

                            const destInput = document.getElementById('daily-route-dest-input');
                            if (destInput) destInput.value = routeDestinationLabel;

                            transitState.destCoords = { lat, lng };
                            transitState.destAddress = routeDestinationLabel;
                            transitState.destLabel = routeDestinationLabel;
                            const transitDestInput = document.getElementById('daily-transit-dest-input');
                            if (transitDestInput) transitDestInput.value = routeDestinationLabel;

                            showSelectedPlaceOnMap(place, lat, lng);
                        }
                    } catch (err) {
                        if (isQuotaError(err)) window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
                    }
                });
                searchHost.appendChild(autocompleteEl);
            } catch (_) {}
        }
    }

    function upsertSavedRolePlace(role, { lat, lng, address, title }) {
        const list = loadSavedEverydayPlaces();
        const isHome = role === 'home';
        const isSchool = role === 'school';
        const isWork = role === 'work';
        const normRole = isHome ? 'home' : (isSchool ? 'school' : (isWork ? 'work' : 'favorite'));
        const cat = isHome ? 'Casa' : (isSchool ? 'Institut / Universitat' : 'Feina / Estudis');
        const finalTitle = title || (isHome ? 'Casa' : (isSchool ? 'Institut / Universitat' : 'Feina'));

        const filtered = list.filter((p) => {
            if (isHome) return p.role !== 'home' && !/casa|llar|home/i.test(`${p.title} ${p.category}`);
            if (isSchool) return p.role !== 'school' && !/insti|institut|instituto|uni|universit|escola|estud|cole/i.test(`${p.title} ${p.category}`);
            if (isWork) return p.role !== 'work' && !/feina|trabajo|oficina|work/i.test(`${p.title} ${p.category}`);
            return true;
        });

        const item = {
            id: normRole === 'favorite' ? ('pl_' + Date.now()) : ('role_' + normRole),
            role: normRole,
            title: finalTitle,
            category: cat,
            lat: Number(lat),
            lng: Number(lng),
            address: address || finalTitle,
            savedAt: Date.now()
        };
        filtered.unshift(item);
        saveEverydayPlaces(filtered.slice(0, 20));
        if (typeof window.saveAliatMapsPlaceToFirestore === 'function' && isFirebaseProfileActive()) {
            window.saveAliatMapsPlaceToFirestore(item).catch(() => {});
        }

        if (isHome) {
            transitState.originMode = 'saved';
            transitState.originCoords = { lat: item.lat, lng: item.lng };
            transitState.originAddress = item.address;
            transitState.originLabel = item.title;
            transitState.homeEditorOpen = false;
            transitState.homeSearchCandidates = [];
            transitState.homeSearchQuery = '';
            transitState.placeEditorRole = null;
            transitState.placeSearchCandidates = [];
            transitState.placeSearchQuery = '';
            transitState.needsPlaceSetup = null;
        } else if (isSchool) {
            transitState.destMode = 'saved';
            transitState.destCoords = { lat: item.lat, lng: item.lng };
            transitState.destAddress = item.address;
            transitState.destLabel = item.title;
            transitState.placeEditorRole = null;
            transitState.placeSearchCandidates = [];
            transitState.placeSearchQuery = '';
            transitState.needsPlaceSetup = null;
        }
        renderSavedHomeAndSchoolMarkers();
        if (mapInstance) {
            mapInstance.panTo({ lat: item.lat, lng: item.lng });
            mapInstance.setZoom(16);
        }
        return item;
    }

    window.setPlaceRoleFromCoords = async function (role, lat, lng, title, address) {
        const cleanAddr = address || (await reverseGeocodeCoords(lat, lng));
        const item = upsertSavedRolePlace(role, {
            lat: Number(lat),
            lng: Number(lng),
            address: cleanAddr,
            title: title || (role === 'home' ? 'Casa' : 'Institut / Universitat')
        });
        if (sharedInfoWindow) {
            try { sharedInfoWindow.close(); } catch (_) {}
        }
        if (typeof window.showToast === 'function') {
            window.showToast(`${item.category} desat: ${item.address}`, 'success');
        }
        if (activeTab === 'transit') renderTransitTabContent();
        else if (activeTab === 'saved') renderSavedPlacesTabContent();
        pushMapsPlacesToServerNow().catch(() => {});
    };

    window.setTransitDestAndOpen = function (lat, lng, label) {
        transitState.destCoords = { lat: Number(lat), lng: Number(lng) };
        transitState.destAddress = label || '';
        transitState.destLabel = label || 'Destinació';
        transitState.aiMode = 'transit';
        window.switchDailyMapsTab('transit');
        window.askAliatMapsTransit(true);
    };

    function showSelectedPlaceOnMap(place, lat, lng) {
        if (!mapInstance || !mapClasses) return;
        clearActivePlaceMarkers();
        const { AdvancedMarkerElement } = mapClasses;
        const markerBadge = document.createElement('div');
        markerBadge.className = 'w-8 h-8 rounded-full bg-rose-600 text-white border-2 border-white shadow-lg flex items-center justify-center cursor-pointer';
        markerBadge.innerHTML = iconSvg('pin', 'w-4 h-4');
        const marker = new AdvancedMarkerElement({
            map: mapInstance,
            position: { lat, lng },
            title: place.displayName || 'Lloc seleccionat',
            content: markerBadge
        });
        activePlaceMarkers.push(marker);

        const rawAddr = place.formattedAddress || place.displayName || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        const safeTitle = esc(place.displayName || 'Destinació');
        const safeAddr = esc(rawAddr);
        if (!sharedInfoWindow) sharedInfoWindow = new mapClasses.InfoWindow();
        sharedInfoWindow.setContent(`
            <div class="p-1.5 text-zinc-900 text-xs max-w-[270px] space-y-1.5">
                <div class="font-extrabold text-zinc-900">${esc(place.displayName || 'Ubicació')}</div>
                <div class="text-[11px] text-zinc-600">${esc(rawAddr)}</div>
                <div class="pt-1 flex flex-wrap items-center gap-1.5">
                    <button type="button" onclick="window.setPlaceRoleFromCoords('home', ${lat}, ${lng}, 'Casa', '${safeAddr}')" class="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold text-[10.5px] cursor-pointer inline-flex items-center gap-1">${iconSvg('home', 'w-3 h-3')}<span>Posar com a Casa</span></button>
                    <button type="button" onclick="window.setPlaceRoleFromCoords('school', ${lat}, ${lng}, '${safeTitle}', '${safeAddr}')" class="px-2.5 py-1 rounded-lg bg-indigo-600 text-white font-bold text-[10.5px] cursor-pointer inline-flex items-center gap-1">${iconSvg('school', 'w-3 h-3')}<span>Posar com a Insti</span></button>
                    <button type="button" onclick="window.setTransitDestAndOpen(${lat}, ${lng}, '${safeTitle}')" class="px-2.5 py-1 rounded-lg bg-blue-600 text-white font-bold text-[10.5px] cursor-pointer inline-flex items-center gap-1">${iconSvg('train', 'w-3 h-3')}<span>Bus / Tren</span></button>
                    <button type="button" onclick="window.traceDailyRouteTo(${lat}, ${lng}, '${safeTitle}')" class="px-2.5 py-1 rounded-lg bg-sky-600 text-white font-bold text-[10.5px] cursor-pointer">Traçar ruta</button>
                    <button type="button" onclick="window.saveSpotAsParkedVehicle(${lat}, ${lng})" class="px-2.5 py-1 rounded-lg bg-zinc-900 text-white font-bold text-[10.5px] cursor-pointer">Aparcar aquí</button>
                </div>
            </div>
        `);
        sharedInfoWindow.open({ anchor: marker, map: mapInstance });
    }

    async function handleMapCanvasClick(lat, lng) {
        if (mapPickMode === 'home' || mapPickMode === 'school') {
            const role = mapPickMode;
            mapPickMode = null;
            updateMapPickBannerUI();
            const addr = await reverseGeocodeCoords(lat, lng);
            await window.setPlaceRoleFromCoords(role, lat, lng, role === 'home' ? 'Casa' : 'Institut / Universitat', addr);
            return;
        }

        if (activeTab === 'parking') {
            await window.saveSpotAsParkedVehicle(lat, lng);
        } else if (activeTab === 'saved') {
            const nameInput = document.getElementById('daily-saved-place-name');
            const label = (nameInput && nameInput.value.trim()) ? nameInput.value.trim() : '';
            const addr = await reverseGeocodeCoords(lat, lng);
            if (nameInput && !label) {
                nameInput.value = addr.split(',')[0] || 'Lloc guardat';
            }
            window.pendingSavedPlaceCoords = { lat, lng, address: addr };
            const coordsHint = document.getElementById('daily-saved-coords-hint');
            if (coordsHint) {
                coordsHint.innerHTML = `<span class="inline-flex items-center gap-1">${iconSvg('pin', 'w-3.5 h-3.5 text-blue-600')}<span>Punt seleccionat al mapa: ${esc(addr)}</span></span>`;
            }
        } else if (activeTab === 'transit') {
            const addr = await reverseGeocodeCoords(lat, lng);
            transitState.destCoords = { lat, lng };
            transitState.destAddress = addr;
            transitState.destLabel = addr;
            const destInput = document.getElementById('daily-transit-dest-input');
            if (destInput) destInput.value = addr;
            showSelectedPlaceOnMap({ displayName: 'Punt seleccionat al mapa', formattedAddress: addr }, lat, lng);
            if (typeof window.showToast === 'function') {
                window.showToast('Punt marcat! Pots posar-lo com a Casa, Insti o Destinació al quadre del mapa.', 'info');
            }
        } else {
            const addr = await reverseGeocodeCoords(lat, lng);
            routeDestinationCoords = { lat, lng };
            routeDestinationLabel = addr;
            const destInput = document.getElementById('daily-route-dest-input');
            if (destInput) destInput.value = addr;
            showSelectedPlaceOnMap({ displayName: 'Punt seleccionat al mapa', formattedAddress: addr }, lat, lng);
        }
    }

    // --- TAB 1: SAVE & FIND PARKED VEHICLE ---
    window.saveCurrentGpsAsParkedVehicle = async function () {
        const btn = document.getElementById('daily-save-gps-parking-btn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `
                <div class="flex items-center gap-3">
                    <span class="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">${iconSvg('spinner', 'w-5 h-5 animate-spin')}</span>
                    <div class="text-left">
                        <div class="text-xs font-extrabold">Obtenint GPS exacte...</div>
                        <div class="text-[10.5px] text-blue-100">Un moment...</div>
                    </div>
                </div>
            `;
        }
        const loc = await requestUserGeolocation(false);
        if (!loc) {
            renderParkingTabContent();
            return;
        }
        await window.saveSpotAsParkedVehicle(loc.lat, loc.lng);
    };

    window.saveSpotAsParkedVehicle = async function (lat, lng) {
        const floorInput = document.getElementById('daily-parking-floor');
        const notesInput = document.getElementById('daily-parking-notes');
        const timerInput = document.getElementById('daily-parking-timer-mins');
        const vehicleSelect = document.getElementById('daily-parking-vehicle-type');

        const existing = loadParkedVehicleState() || {};
        const floorSpot = floorInput ? floorInput.value.trim() : (existing.floorSpot || '');
        const notes = notesInput ? notesInput.value.trim() : (existing.notes || '');
        const vehicleType = vehicleSelect ? vehicleSelect.value : (existing.vehicleType || 'cotxe');
        const timerMins = timerInput ? parseInt(timerInput.value, 10) : 0;

        const address = await reverseGeocodeCoords(lat, lng);
        const now = Date.now();
        const hasNewTimer = !isNaN(timerMins) && timerMins > 0;
        const expiresAt = hasNewTimer ? (now + timerMins * 60 * 1000) : (existing.expiresAt || null);
        const timerDurationMins = hasNewTimer ? timerMins : (existing.timerDurationMins || null);

        const state = {
            lat,
            lng,
            address,
            floorSpot,
            notes,
            vehicleType,
            savedAt: now,
            expiresAt,
            timerDurationMins
        };
        saveParkedVehicleState(state);

        if (mapInstance) {
            mapInstance.panTo({ lat, lng });
            mapInstance.setZoom(17);
        }
        renderParkingMarkerOnMap();
        renderParkingTabContent();
        if (typeof window.showToast === 'function') {
            window.showToast('Ubicació del vehicle guardada al mapa!', 'success');
        }
    };

    window.updateParkedVehicleDetails = function () {
        const parked = loadParkedVehicleState();
        if (!parked) {
            if (typeof window.showToast === 'function') {
                window.showToast('Primer marca al mapa o amb el GPS on has aparcat el vehicle.', 'info');
            }
            return;
        }
        const floorInput = document.getElementById('daily-parking-floor');
        const notesInput = document.getElementById('daily-parking-notes');
        const timerInput = document.getElementById('daily-parking-timer-mins');
        const vehicleSelect = document.getElementById('daily-parking-vehicle-type');

        parked.floorSpot = floorInput ? floorInput.value.trim() : parked.floorSpot;
        parked.notes = notesInput ? notesInput.value.trim() : parked.notes;
        parked.vehicleType = vehicleSelect ? vehicleSelect.value : parked.vehicleType;

        const timerMins = timerInput ? parseInt(timerInput.value, 10) : 0;
        if (!isNaN(timerMins) && timerMins > 0) {
            parked.expiresAt = Date.now() + timerMins * 60 * 1000;
            parked.timerDurationMins = timerMins;
        } else if (timerMins === 0) {
            parked.expiresAt = null;
            parked.timerDurationMins = null;
        }

        saveParkedVehicleState(parked);
        renderParkingMarkerOnMap();
        renderParkingTabContent();
        if (typeof window.showToast === 'function') {
            window.showToast('Detalls de l\'aparcament actualitzats!', 'success');
        }
    };

    window.clearParkedVehicle = function () {
        saveParkedVehicleState(null);
        clearActiveRouteGraphics();
        if (parkingMarker) {
            try { parkingMarker.map = null; } catch (_) {}
            parkingMarker = null;
        }
        renderParkingTabContent();
        if (typeof window.showToast === 'function') {
            window.showToast('Aparcament esborrat.', 'info');
        }
    };

    window.routeBackToParkedVehicle = async function (mode = 'WALKING') {
        const parked = loadParkedVehicleState();
        if (!parked) return;
        selectedTravelMode = mode;
        await window.traceDailyRouteTo(parked.lat, parked.lng, 'El meu vehicle aparcat', mode);
    };

    // --- ROUTES API (Route.computeRoutes) ---
    window.traceDailyRouteTo = async function (destLat, destLng, destTitle = 'Destinació', modeOverride = null) {
        try {
            const libs = await loadGoogleMapsLibraries();
            const mode = modeOverride || selectedTravelMode || 'WALKING';

            let originCoords = userLocation;
            if (!originCoords) {
                originCoords = await requestUserGeolocation(true);
            }
            if (!originCoords) {
                const center = mapInstance ? mapInstance.getCenter() : null;
                originCoords = center
                    ? { lat: center.lat() + 0.0035, lng: center.lng() - 0.0035 }
                    : { lat: DEFAULT_CENTER.lat + 0.0035, lng: DEFAULT_CENTER.lng - 0.0035 };
            }

            clearActiveRouteGraphics();

            const request = {
                origin: originCoords,
                destination: { lat: Number(destLat), lng: Number(destLng) },
                travelMode: mode,
                fields: ['path', 'legs', 'distanceMeters', 'Duration', 'localizedValues', 'viewport']
            };

            const { routes } = await libs.Route.computeRoutes(request);
            const route = routes?.[0];
            if (!route) {
                if (typeof window.showToast === 'function') {
                    window.showToast('No s\'ha trobat cap ruta disponible per a aquest trajecte.', 'warning');
                }
                return;
            }

            const polylines = route.createPolylines();
            polylines.forEach((pline) => {
                pline.setMap(mapInstance);
                activeRoutePolylines.push(pline);
            });

            try {
                const markers = await route.createWaypointAdvancedMarkers({ map: mapInstance });
                if (Array.isArray(markers)) {
                    activeRouteMarkers.push(...markers);
                }
            } catch (_) {}

            if (route.viewport && mapInstance) {
                mapInstance.fitBounds(route.viewport, 48);
            }

            const distText = route.localizedValues?.distance || (route.distanceMeters ? `${(route.distanceMeters / 1000).toFixed(2)} km` : '');
            const durText = route.localizedValues?.duration || (route.durationMillis ? `${Math.round(route.durationMillis / 60000)} min` : '');

            const summaryBox = document.getElementById('daily-route-live-summary');
            if (summaryBox) {
                const modeIconName = mode === 'DRIVING' ? 'car' : (mode === 'BICYCLING' ? 'bike' : (mode === 'TRANSIT' ? 'metro' : 'walk'));
                const modeLabelText = mode === 'DRIVING' ? 'En cotxe' : (mode === 'BICYCLING' ? 'En bici/patinet' : (mode === 'TRANSIT' ? 'Transport públic' : 'A peu'));
                const betaNote = (mode === 'WALKING' || mode === 'BICYCLING')
                    ? `<div class="w-full text-[10px] text-zinc-500 dark:text-zinc-400 pt-1 border-t border-blue-200/60 dark:border-blue-800/50 flex items-center gap-1.5">${iconSvg('warn', 'w-3.5 h-3.5 text-amber-500 shrink-0')}<span>Nota: les indicacions a peu i en bicicleta són orientatives; comprova voreres i passos senyalitzats.</span></div>`
                    : '';
                summaryBox.classList.remove('hidden');
                summaryBox.innerHTML = `
                    <div class="p-3 rounded-2xl bg-blue-50/90 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/80 flex flex-wrap items-center justify-between gap-2">
                        <div class="space-y-0.5">
                            <div class="text-[10px] font-extrabold uppercase tracking-wider text-blue-600 dark:text-sky-400 flex items-center gap-1.5">${iconSvg(modeIconName, 'w-3.5 h-3.5')}<span>${modeLabelText} fins a ${esc(destTitle)}</span></div>
                            <div class="text-xs sm:text-sm font-black text-zinc-900 dark:text-white tabular-nums">${esc(distText)} · ${esc(durText)}</div>
                        </div>
                        <div class="flex items-center gap-1.5">
                            <button type="button" onclick="window.sendDailyMapSummaryToChat('${esc(destTitle)}', '${esc(distText)}', '${esc(durText)}', '${mode}')" class="px-2.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold transition cursor-pointer">
                                Enviar al xat
                            </button>
                            <a href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${destLat},${destLng}`)}&travelmode=${mode.toLowerCase()}" target="_blank" rel="noopener noreferrer" class="px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200 text-[11px] font-bold transition inline-flex items-center gap-1">
                                <span>Obrir Maps</span>${iconSvg('external', 'w-3 h-3')}
                            </a>
                        </div>
                        ${betaNote}
                    </div>
                `;
            }
        } catch (err) {
            if (isQuotaError(err)) {
                window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
                return;
            }
            if (typeof window.showToast === 'function') {
                window.showToast('No s\'ha pogut calcular la ruta en aquest moment.', 'warning');
            }
        }
    };

    // --- TAB 2: NEARBY EVERYDAY SERVICES (Place.searchNearby & Place.searchByText) ---
    window.searchEverydayNearbyCategory = async function (categoryId) {
        const cat = NEARBY_CATEGORIES.find((c) => c.id === categoryId) || NEARBY_CATEGORIES[0];
        const resultsBox = document.getElementById('daily-nearby-results-list');
        if (resultsBox) {
            resultsBox.innerHTML = `<div class="p-4 text-center text-xs text-zinc-500 dark:text-zinc-400 flex items-center justify-center gap-2">${iconSvg('spinner', 'w-4 h-4 animate-spin text-blue-600')}<span>Cercant ${esc(cat.label.toLowerCase())} a prop teu amb Google Places...</span></div>`;
        }

        try {
            const libs = await loadGoogleMapsLibraries();
            const centerLoc = userLocation || (mapInstance ? { lat: mapInstance.getCenter().lat(), lng: mapInstance.getCenter().lng() } : DEFAULT_CENTER);

            const { places } = await libs.Place.searchNearby({
                fields: ['id', 'displayName', 'formattedAddress', 'location', 'rating', 'userRatingCount', 'regularOpeningHours', 'googleMapsURI'],
                locationRestriction: {
                    center: centerLoc,
                    radius: 1800
                },
                includedPrimaryTypes: cat.types,
                maxResultCount: 10
            });

            renderPlacesResultsList(places || [], cat);
        } catch (err) {
            if (isQuotaError(err)) {
                window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
                return;
            }
            if (resultsBox) {
                resultsBox.innerHTML = `<div class="p-4 text-center text-xs text-rose-600 dark:text-rose-400">No s'han pogut carregar els llocs propers.</div>`;
            }
        }
    };

    window.searchEverydayByTextQuery = async function () {
        const input = document.getElementById('daily-nearby-custom-query');
        const query = input ? input.value.trim() : '';
        if (!query) return;

        const resultsBox = document.getElementById('daily-nearby-results-list');
        if (resultsBox) {
            resultsBox.innerHTML = `<div class="p-4 text-center text-xs text-zinc-500 dark:text-zinc-400 flex items-center justify-center gap-2">${iconSvg('spinner', 'w-4 h-4 animate-spin text-blue-600')}<span>Cercant "${esc(query)}"...</span></div>`;
        }

        try {
            const libs = await loadGoogleMapsLibraries();
            const centerLoc = userLocation || (mapInstance ? { lat: mapInstance.getCenter().lat(), lng: mapInstance.getCenter().lng() } : DEFAULT_CENTER);

            const { places } = await libs.Place.searchByText({
                textQuery: query,
                fields: ['id', 'displayName', 'formattedAddress', 'location', 'rating', 'userRatingCount', 'regularOpeningHours', 'googleMapsURI'],
                locationBias: {
                    center: centerLoc,
                    radius: 3000
                },
                maxResultCount: 10
            });

            renderPlacesResultsList(places || [], { label: query, iconName: 'pin', color: '#2563eb' });
        } catch (err) {
            if (isQuotaError(err)) {
                window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
                return;
            }
            if (resultsBox) {
                resultsBox.innerHTML = `<div class="p-4 text-center text-xs text-rose-600 dark:text-rose-400">Error en cercar "${esc(query)}".</div>`;
            }
        }
    };

    function renderPlacesResultsList(places, categoryMeta) {
        const resultsBox = document.getElementById('daily-nearby-results-list');
        clearActivePlaceMarkers();

        if (!places || places.length === 0) {
            if (resultsBox) {
                resultsBox.innerHTML = `<div class="p-4 text-center text-xs text-zinc-500 dark:text-zinc-400">No s'han trobat resultats per a ${esc(categoryMeta.label)} en aquesta zona. Mou el mapa o amplia la cerca.</div>`;
            }
            return;
        }

        const bounds = new mapClasses.LatLngBounds();
        const cardsHtml = [];

        places.forEach((place, idx) => {
            if (!place.location) return;
            const lat = place.location.lat();
            const lng = place.location.lng();
            bounds.extend({ lat, lng });

            const pin = new mapClasses.PinElement({
                background: categoryMeta.color || '#2563eb',
                borderColor: '#ffffff',
                glyphColor: '#ffffff',
                glyphText: String(idx + 1)
            });

            const marker = new mapClasses.AdvancedMarkerElement({
                map: mapInstance,
                position: { lat, lng },
                title: place.displayName || categoryMeta.label
            });
            marker.append(pin);

            marker.addListener('click', () => {
                if (!sharedInfoWindow) sharedInfoWindow = new mapClasses.InfoWindow();
                sharedInfoWindow.setContent(`
                    <div class="p-1.5 text-zinc-900 text-xs max-w-[230px] space-y-1">
                        <div class="font-extrabold">${idx + 1}. ${esc(place.displayName || '')}</div>
                        <div class="text-[11px] text-zinc-600">${esc(place.formattedAddress || '')}</div>
                        ${place.rating ? `<div class="text-[11px] font-bold text-amber-600 inline-flex items-center gap-1">${iconSvg('star', 'w-3 h-3')}<span>${place.rating.toFixed(1)} (${place.userRatingCount || 0})</span></div>` : ''}
                        <div class="pt-1">
                            <button type="button" onclick="window.traceDailyRouteTo(${lat}, ${lng}, '${esc(place.displayName || '')}')" class="px-2.5 py-1 rounded-lg bg-blue-600 text-white font-bold text-[10.5px] cursor-pointer">Com arribar-hi</button>
                        </div>
                    </div>
                `);
                sharedInfoWindow.open({ anchor: marker, map: mapInstance });
            });
            activePlaceMarkers.push(marker);

            cardsHtml.push(`
                <div class="p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 hover:border-blue-400 dark:hover:border-sky-500 transition flex items-start justify-between gap-2.5">
                    <div class="min-w-0 flex-1 space-y-0.5 cursor-pointer" onclick="window.focusDailyMapPoint(${lat}, ${lng})">
                        <div class="text-xs font-extrabold text-zinc-900 dark:text-white truncate">${idx + 1}. ${esc(place.displayName || 'Establiment')}</div>
                        <div class="text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-1">${esc(place.formattedAddress || '')}</div>
                        <div class="flex items-center gap-2 pt-0.5">
                            ${place.rating ? `<span class="text-[10.5px] font-bold text-amber-600 dark:text-amber-400 tabular-nums inline-flex items-center gap-0.5">${iconSvg('star', 'w-3 h-3')}<span>${place.rating.toFixed(1)} (${place.userRatingCount || 0})</span></span>` : ''}
                            ${place.googleMapsURI ? `<a href="${esc(place.googleMapsURI)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation();" class="text-[10.5px] font-bold text-blue-600 dark:text-sky-400 hover:underline inline-flex items-center gap-0.5"><span>Fitxa Maps</span>${iconSvg('external', 'w-3 h-3')}</a>` : ''}
                        </div>
                    </div>
                    <button type="button" onclick="window.traceDailyRouteTo(${lat}, ${lng}, '${esc(place.displayName || 'Destinació')}')" class="px-2.5 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 dark:hover:bg-blue-900/60 text-blue-700 dark:text-sky-300 border border-blue-200/80 dark:border-blue-800 text-[10.5px] font-extrabold shrink-0 cursor-pointer">
                        Ruta
                    </button>
                </div>
            `);
        });

        if (mapInstance && places.length > 0) {
            mapInstance.fitBounds(bounds, 52);
        }

        if (resultsBox) {
            resultsBox.innerHTML = cardsHtml.join('');
        }
    }

    window.focusDailyMapPoint = function (lat, lng) {
        if (!mapInstance) return;
        mapInstance.panTo({ lat: Number(lat), lng: Number(lng) });
        mapInstance.setZoom(17);
    };

    // --- TAB 4: SAVED EVERYDAY PLACES ---
    window.addSavedEverydayPlace = async function () {
        const nameInput = document.getElementById('daily-saved-place-name');
        const categorySelect = document.getElementById('daily-saved-place-cat');
        const addrInput = document.getElementById('daily-saved-place-addr');
        const name = nameInput ? nameInput.value.trim() : '';
        const cat = categorySelect ? categorySelect.value : 'Casa';
        const typedAddr = addrInput ? addrInput.value.trim() : '';

        let coords = window.pendingSavedPlaceCoords;
        if (!coords && typedAddr) {
            const resolved = await resolveTextAddressOrPlace(typedAddr);
            if (resolved && typeof resolved.lat === 'number') {
                coords = { lat: resolved.lat, lng: resolved.lng, address: resolved.label };
            }
        }
        if (!coords) {
            const loc = userLocation || (await requestUserGeolocation(true));
            if (loc) {
                const addr = await reverseGeocodeCoords(loc.lat, loc.lng);
                coords = { lat: loc.lat, lng: loc.lng, address: addr };
            } else if (mapInstance) {
                const c = mapInstance.getCenter();
                const addr = await reverseGeocodeCoords(c.lat(), c.lng());
                coords = { lat: c.lat(), lng: c.lng(), address: addr };
            }
        }
        if (!coords) return;

        const isHome = cat.includes('Casa');
        const isSchool = cat.includes('Institut');
        const isWork = cat.includes('Feina');
        if (isHome || isSchool || isWork) {
            upsertSavedRolePlace(isHome ? 'home' : (isSchool ? 'school' : 'work'), {
                lat: coords.lat,
                lng: coords.lng,
                address: coords.address,
                title: name || (isHome ? 'Casa' : (isSchool ? 'Institut / Universitat' : 'Feina'))
            });
        } else {
            const list = loadSavedEverydayPlaces();
            const favItem = {
                id: 'pl_' + Date.now(),
                role: 'favorite',
                title: name || cat,
                category: cat,
                lat: coords.lat,
                lng: coords.lng,
                address: coords.address || `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`,
                savedAt: Date.now()
            };
            list.unshift(favItem);
            saveEverydayPlaces(list.slice(0, 20));
            if (typeof window.saveAliatMapsPlaceToFirestore === 'function' && isFirebaseProfileActive()) {
                window.saveAliatMapsPlaceToFirestore(favItem).catch(() => {});
            }
        }

        window.pendingSavedPlaceCoords = null;
        if (nameInput) nameInput.value = '';
        if (addrInput) addrInput.value = '';
        renderSavedHomeAndSchoolMarkers();
        renderSavedPlacesTabContent();
        pushMapsPlacesToServerNow().catch(() => {});
        if (typeof window.showToast === 'function') {
            window.showToast(
                isFirebaseProfileActive()
                    ? 'Ubicació desada al teu perfil de Firebase Firestore!'
                    : 'Ubicació desada temporalment (inicia sessió per desar-la al núvol).',
                'success'
            );
        }
    };

    window.deleteSavedEverydayPlace = function (id) {
        const current = loadSavedEverydayPlaces();
        const removed = current.find((p) => p.id === id);
        if (removed && !isFirebaseProfileActive()) {
            try {
                const tomb = JSON.parse(localStorage.getItem('aliat_daily_deleted_places_v1') || '{}') || {};
                const nowTs = Date.now();
                if (removed.id) tomb[`id:${removed.id}`] = nowTs;
                const rKey = getPlaceRoleKeyForMerge(removed);
                if (rKey) tomb[rKey] = nowTs;
                localStorage.setItem('aliat_daily_deleted_places_v1', JSON.stringify(tomb));
            } catch (_) {}
        }
        const next = current.filter((p) => p.id !== id);
        saveEverydayPlaces(next);
        if (removed && typeof window.deleteAliatMapsPlaceFromFirestore === 'function' && isFirebaseProfileActive()) {
            const rHint = removed.role || (getPlaceRoleKeyForMerge(removed).startsWith('role:') ? getPlaceRoleKeyForMerge(removed).slice(5) : null);
            window.deleteAliatMapsPlaceFromFirestore(removed.id, rHint).catch(() => {});
        }
        pushMapsPlacesToServerNow().catch(() => {});
        renderSavedHomeAndSchoolMarkers();
        renderSavedPlacesTabContent();
    };

    // --- SEND MAP SUMMARY TO DAILY USE CHAT ---
    window.sendDailyMapSummaryToChat = function (title, distance, duration, mode) {
        const parked = loadParkedVehicleState();
        const chatInput = document.getElementById('chat-input');
        let text = '';
        if (title === 'El meu vehicle aparcat' && parked) {
            const extra = [parked.floorSpot ? `Planta/Plaça: ${parked.floorSpot}` : '', parked.notes ? `Nota: ${parked.notes}` : ''].filter(Boolean).join(' · ');
            text = `He aparcat el meu vehicle a ${parked.address} (${extra || 'sense notes addicionals'}). El trajecte de tornada (${mode === 'DRIVING' ? 'en cotxe' : 'a peu'}) és de ${distance} (${duration}). Organitza'm els propers passos o un recordatori.`;
        } else {
            text = `Tinc previst un desplaçament fins a "${title}" (${distance}, temps estimat ${duration}). Incorpora aquest trajecte dins de la meva planificació o tasques d'avui.`;
        }
        window.closeDailyMapsModal();
        if (chatInput) {
            chatInput.value = text;
            chatInput.focus();
            if (typeof window.autoResizeChatInput === 'function') window.autoResizeChatInput(chatInput);
        }
        if (typeof window.showToast === 'function') {
            window.showToast('Dades del trajecte copiades al xat d\'Ús Quotidià!', 'success');
        }
    };

    // --- RENDER SIDEBAR TABS (GRAPHICAL & VISUAL) ---
    window.selectParkingVehicleType = function (vType) {
        const input = document.getElementById('daily-parking-vehicle-type');
        if (input) input.value = vType;
        document.querySelectorAll('[data-parking-vehicle-btn]').forEach((btn) => {
            const active = btn.getAttribute('data-parking-vehicle-btn') === vType;
            btn.className = active
                ? 'p-2 rounded-xl border-2 border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-sky-300 flex flex-col items-center justify-center gap-1 cursor-pointer transition shadow-2xs'
                : 'p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-300 hover:border-blue-400 flex flex-col items-center justify-center gap-1 cursor-pointer transition';
        });
    };

    window.applyParkingTimerPreset = function (mins) {
        const input = document.getElementById('daily-parking-timer-mins');
        if (input) input.value = mins > 0 ? String(mins) : '0';
        document.querySelectorAll('[data-parking-timer-preset]').forEach((btn) => {
            const val = parseInt(btn.getAttribute('data-parking-timer-preset') || '0', 10);
            const active = val === mins;
            btn.className = active
                ? 'py-1.5 px-2 rounded-xl bg-amber-500 text-white text-[11px] font-extrabold cursor-pointer transition shadow-2xs'
                : 'py-1.5 px-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-amber-50 dark:hover:bg-amber-950/40 text-zinc-700 dark:text-zinc-200 text-[11px] font-bold cursor-pointer transition border border-zinc-200/80 dark:border-zinc-700/80';
        });
    };

    function renderParkingTabContent() {
        const box = document.getElementById('daily-maps-tab-panel');
        if (!box || activeTab !== 'parking') return;
        const parked = loadParkedVehicleState();

        if (parkingCountdownInterval) {
            clearInterval(parkingCountdownInterval);
            parkingCountdownInterval = null;
        }

        let timerGraphicHtml = '';
        let hasActiveCountdown = false;
        if (parked && parked.expiresAt) {
            const diffMs = parked.expiresAt - Date.now();
            if (diffMs > 0) {
                hasActiveCountdown = true;
                const minsLeft = Math.ceil(diffMs / 60000);
                const totalMins = Math.max(minsLeft, parked.timerDurationMins || 60);
                const pct = Math.max(6, Math.min(100, Math.round((minsLeft / totalMins) * 100)));
                timerGraphicHtml = `
                    <div class="p-2.5 rounded-xl bg-amber-50/90 dark:bg-amber-950/35 border border-amber-200/80 dark:border-amber-800/60 space-y-1.5">
                        <div class="flex items-center justify-between text-[11px] font-extrabold text-amber-800 dark:text-amber-300">
                            <span class="inline-flex items-center gap-1.5">${iconSvg('timer', 'w-3.5 h-3.5')}<span>Parquímetre</span></span>
                            <span id="daily-parking-countdown-badge" class="tabular-nums font-mono">${minsLeft} min</span>
                        </div>
                        <div class="w-full h-2 rounded-full bg-amber-200/70 dark:bg-amber-900/60 overflow-hidden">
                            <div id="daily-parking-countdown-bar" class="h-full rounded-full bg-amber-500 transition-all duration-500" style="width:${pct}%"></div>
                        </div>
                    </div>
                `;
            } else {
                timerGraphicHtml = `
                    <div class="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 flex items-center justify-between text-[11px] font-extrabold text-rose-600 dark:text-rose-400">
                        <span class="inline-flex items-center gap-1.5">${iconSvg('warn', 'w-3.5 h-3.5')}<span>Temps esgotat</span></span>
                        <span>0 min</span>
                    </div>
                `;
            }
        }

        const currentVType = parked?.vehicleType || 'cotxe';
        const vehicleBtnClass = (v) => v === currentVType
            ? 'p-2 rounded-xl border-2 border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-sky-300 flex flex-col items-center justify-center gap-1 cursor-pointer transition shadow-2xs'
            : 'p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-300 hover:border-blue-400 flex flex-col items-center justify-center gap-1 cursor-pointer transition';

        box.innerHTML = `
            <div class="space-y-3">
                <button id="daily-save-gps-parking-btn" type="button" onclick="window.saveCurrentGpsAsParkedVehicle()" class="w-full p-3.5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white transition cursor-pointer flex items-center justify-between gap-3 shadow-sm active:scale-[0.99]">
                    <div class="flex items-center gap-3">
                        <span class="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">${iconSvg('gps', 'w-5 h-5')}</span>
                        <div class="text-left">
                            <div class="text-xs font-extrabold">He aparcat aquí (GPS)</div>
                            <div class="text-[10.5px] text-blue-100">O toca el mapa</div>
                        </div>
                    </div>
                    ${iconSvg('arrowRight', 'w-4 h-4 shrink-0')}
                </button>

                ${parked ? `
                <div class="p-3.5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-2.5 shadow-2xs">
                    <div class="flex items-start justify-between gap-2">
                        <div class="flex items-start gap-2.5 min-w-0">
                            <span class="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">${iconSvg(currentVType === 'moto' ? 'moto' : (currentVType === 'bici' ? 'bike' : 'car'), 'w-4 h-4')}</span>
                            <div class="min-w-0">
                                <div class="text-xs font-extrabold text-zinc-900 dark:text-white truncate">${esc(parked.address)}</div>
                                <div class="text-[10.5px] text-zinc-500 dark:text-zinc-400 tabular-nums">${new Date(parked.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${parked.floorSpot ? ` · ${esc(parked.floorSpot)}` : ''}</div>
                            </div>
                        </div>
                        <button type="button" onclick="window.focusDailyMapPoint(${parked.lat}, ${parked.lng})" class="px-2.5 py-1.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-[10.5px] font-bold shrink-0 cursor-pointer inline-flex items-center gap-1">
                            ${iconSvg('target', 'w-3.5 h-3.5')}<span>Veure</span>
                        </button>
                    </div>
                    ${timerGraphicHtml}
                    <div class="grid grid-cols-2 gap-2">
                        <button type="button" onclick="window.routeBackToParkedVehicle('WALKING')" class="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-extrabold transition cursor-pointer flex items-center justify-center gap-1.5">
                            ${iconSvg('walk', 'w-4 h-4')}<span>Tornar a peu</span>
                        </button>
                        <button type="button" onclick="window.routeBackToParkedVehicle('DRIVING')" class="py-2.5 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 text-[11px] font-extrabold transition cursor-pointer flex items-center justify-center gap-1.5">
                            ${iconSvg('car', 'w-4 h-4')}<span>En vehicle</span>
                        </button>
                    </div>
                    <div class="flex items-center justify-between pt-1 border-t border-zinc-100 dark:border-zinc-800">
                        <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${parked.lat},${parked.lng}`)}" target="_blank" rel="noopener noreferrer" class="text-[11px] font-bold text-blue-600 dark:text-sky-400 hover:underline inline-flex items-center gap-1">
                            ${iconSvg('external', 'w-3 h-3')}<span>Google Maps</span>
                        </a>
                        <button type="button" onclick="window.clearParkedVehicle()" class="text-[11px] font-bold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer inline-flex items-center gap-1">
                            ${iconSvg('trash', 'w-3 h-3')}<span>Esborrar</span>
                        </button>
                    </div>
                </div>
                ` : `
                <div class="p-4 rounded-2xl bg-zinc-100/80 dark:bg-zinc-900/60 border border-dashed border-zinc-300 dark:border-zinc-800 flex flex-col items-center gap-1.5 text-center">
                    <span class="w-9 h-9 rounded-xl bg-zinc-200/80 dark:bg-zinc-800 text-zinc-500 flex items-center justify-center">${iconSvg('parking', 'w-5 h-5')}</span>
                    <span class="text-[11px] font-bold text-zinc-500 dark:text-zinc-400">Cap vehicle marcat · Toca el mapa</span>
                </div>
                `}

                <div class="p-3.5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 space-y-2.5">
                    <input type="hidden" id="daily-parking-vehicle-type" value="${esc(currentVType)}">
                    <div class="grid grid-cols-3 gap-1.5">
                        <button type="button" data-parking-vehicle-btn="cotxe" onclick="window.selectParkingVehicleType('cotxe')" class="${vehicleBtnClass('cotxe')}">
                            ${iconSvg('car', 'w-4 h-4')}<span class="text-[10.5px] font-extrabold">Cotxe</span>
                        </button>
                        <button type="button" data-parking-vehicle-btn="moto" onclick="window.selectParkingVehicleType('moto')" class="${vehicleBtnClass('moto')}">
                            ${iconSvg('moto', 'w-4 h-4')}<span class="text-[10.5px] font-extrabold">Moto</span>
                        </button>
                        <button type="button" data-parking-vehicle-btn="bici" onclick="window.selectParkingVehicleType('bici')" class="${vehicleBtnClass('bici')}">
                            ${iconSvg('bike', 'w-4 h-4')}<span class="text-[10.5px] font-extrabold">Bici</span>
                        </button>
                    </div>

                    <div class="space-y-1.5">
                        <div class="flex items-center justify-between">
                            <span class="text-[10px] font-extrabold uppercase text-zinc-400">Parquímetre</span>
                            <input id="daily-parking-timer-mins" type="number" min="0" max="1440" placeholder="min" class="w-20 px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-[11px] font-bold text-zinc-800 dark:text-zinc-100 tabular-nums text-right">
                        </div>
                        <div class="grid grid-cols-4 gap-1">
                            <button type="button" data-parking-timer-preset="30" onclick="window.applyParkingTimerPreset(30)" class="py-1.5 px-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-amber-50 dark:hover:bg-amber-950/40 text-zinc-700 dark:text-zinc-200 text-[11px] font-bold cursor-pointer border border-zinc-200/80 dark:border-zinc-700/80">30m</button>
                            <button type="button" data-parking-timer-preset="60" onclick="window.applyParkingTimerPreset(60)" class="py-1.5 px-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-amber-50 dark:hover:bg-amber-950/40 text-zinc-700 dark:text-zinc-200 text-[11px] font-bold cursor-pointer border border-zinc-200/80 dark:border-zinc-700/80">1h</button>
                            <button type="button" data-parking-timer-preset="120" onclick="window.applyParkingTimerPreset(120)" class="py-1.5 px-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-amber-50 dark:hover:bg-amber-950/40 text-zinc-700 dark:text-zinc-200 text-[11px] font-bold cursor-pointer border border-zinc-200/80 dark:border-zinc-700/80">2h</button>
                            <button type="button" data-parking-timer-preset="0" onclick="window.applyParkingTimerPreset(0)" class="py-1.5 px-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-amber-50 dark:hover:bg-amber-950/40 text-zinc-700 dark:text-zinc-200 text-[11px] font-bold cursor-pointer border border-zinc-200/80 dark:border-zinc-700/80">Lliure</button>
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-1.5">
                        <input id="daily-parking-floor" type="text" value="${esc(parked?.floorSpot || '')}" placeholder="Planta / Plaça" class="px-2.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-800 dark:text-zinc-100">
                        <input id="daily-parking-notes" type="text" value="${esc(parked?.notes || '')}" placeholder="Referència" class="px-2.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-800 dark:text-zinc-100">
                    </div>
                    <button type="button" onclick="window.updateParkedVehicleDetails()" class="w-full py-2 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 text-xs font-extrabold transition cursor-pointer inline-flex items-center justify-center gap-1.5">
                        ${iconSvg('save', 'w-3.5 h-3.5')}<span>Guardar detalls</span>
                    </button>
                </div>
            </div>
        `;

        if (hasActiveCountdown && parked && parked.expiresAt) {
            const expiresAtMs = parked.expiresAt;
            const totalDurationMins = Math.max(1, parked.timerDurationMins || 60);
            parkingCountdownInterval = setInterval(() => {
                if (activeTab !== 'parking') {
                    clearInterval(parkingCountdownInterval);
                    parkingCountdownInterval = null;
                    return;
                }
                const remMs = expiresAtMs - Date.now();
                const badgeEl = document.getElementById('daily-parking-countdown-badge');
                const barEl = document.getElementById('daily-parking-countdown-bar');
                if (remMs <= 0) {
                    clearInterval(parkingCountdownInterval);
                    parkingCountdownInterval = null;
                    renderParkingTabContent();
                    return;
                }
                const minsNow = Math.ceil(remMs / 60000);
                const pctNow = Math.max(6, Math.min(100, Math.round((minsNow / Math.max(minsNow, totalDurationMins)) * 100)));
                if (badgeEl) badgeEl.textContent = `${minsNow} min`;
                if (barEl) barEl.style.width = `${pctNow}%`;
            }, 15000);
        }
    }

    function renderNearbyTabContent() {
        const box = document.getElementById('daily-maps-tab-panel');
        if (!box || activeTab !== 'nearby') return;

        const catBtns = NEARBY_CATEGORIES.map((c) => `
            <button type="button" onclick="window.searchEverydayNearbyCategory('${c.id}')" class="p-2.5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 hover:border-blue-500 dark:hover:border-sky-400 transition flex flex-col items-center justify-center gap-1.5 text-center cursor-pointer shadow-2xs active:scale-[0.97]">
                <span class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style="background-color:${c.color}1a;color:${c.color}">${iconSvg(c.iconName, 'w-5 h-5')}</span>
                <span class="text-[10.5px] font-extrabold text-zinc-800 dark:text-zinc-100 truncate w-full">${esc(c.label)}</span>
            </button>
        `).join('');

        box.innerHTML = `
            <div class="space-y-3">
                <div class="grid grid-cols-4 sm:grid-cols-4 gap-1.5">
                    ${catBtns}
                </div>

                <div class="flex items-center gap-1.5">
                    <input id="daily-nearby-custom-query" type="text" onkeydown="if(event.key==='Enter'){event.preventDefault();window.searchEverydayByTextQuery();}" placeholder="Cercar lloc..." class="flex-1 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs text-zinc-800 dark:text-zinc-100">
                    <button type="button" onclick="window.searchEverydayByTextQuery()" class="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-extrabold cursor-pointer shrink-0 inline-flex items-center gap-1">
                        ${iconSvg('search', 'w-3.5 h-3.5')}<span>Cercar</span>
                    </button>
                </div>

                <div id="daily-nearby-results-list" class="space-y-2 pt-0.5">
                    <div class="p-4 rounded-2xl bg-zinc-100/70 dark:bg-zinc-900/60 border border-zinc-200/70 dark:border-zinc-800 flex flex-col items-center gap-1.5 text-center">
                        <span class="w-8 h-8 rounded-xl bg-zinc-200/80 dark:bg-zinc-800 text-zinc-500 flex items-center justify-center">${iconSvg('nearby', 'w-4 h-4')}</span>
                        <span class="text-[11px] font-bold text-zinc-500 dark:text-zinc-400">Tria una icona a dalt</span>
                    </div>
                </div>
            </div>
        `;
    }

    window.applyCustomRoutePresetDest = async function (lat, lng, label) {
        routeDestinationCoords = { lat: Number(lat), lng: Number(lng) };
        routeDestinationLabel = String(label || 'Destinació');
        const input = document.getElementById('daily-route-dest-input');
        if (input) input.value = routeDestinationLabel;
        await window.traceDailyRouteTo(routeDestinationCoords.lat, routeDestinationCoords.lng, routeDestinationLabel, selectedTravelMode);
    };

    function renderRoutesTabContent() {
        const box = document.getElementById('daily-maps-tab-panel');
        if (!box || activeTab !== 'routes') return;

        const saved = loadSavedEverydayPlaces();
        const parked = loadParkedVehicleState();
        const quickChips = [];
        const homePlace = saved.find((p) => p.role === 'home' || p.id === 'home');
        const schoolPlace = saved.find((p) => p.role === 'school' || p.id === 'school');
        if (homePlace) quickChips.push({ label: homePlace.label || 'Casa', icon: 'home', lat: homePlace.lat, lng: homePlace.lng, cls: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-sky-300 border-blue-200 dark:border-blue-800' });
        if (schoolPlace) quickChips.push({ label: schoolPlace.label || 'Insti', icon: 'school', lat: schoolPlace.lat, lng: schoolPlace.lng, cls: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800' });
        if (parked) quickChips.push({ label: 'Cotxe', icon: 'car', lat: parked.lat, lng: parked.lng, cls: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' });
        saved.filter((p) => p !== homePlace && p !== schoolPlace).slice(0, 2).forEach((p) => {
            quickChips.push({ label: p.label || p.address || 'Lloc', icon: 'bookmark', lat: p.lat, lng: p.lng, cls: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border-zinc-200 dark:border-zinc-700' });
        });

        const quickChipsHtml = quickChips.length > 0 ? `
            <div class="flex flex-wrap items-center gap-1.5">
                ${quickChips.map((q) => `
                    <button type="button" onclick="window.applyCustomRoutePresetDest(${q.lat}, ${q.lng}, '${esc(q.label).replace(/'/g, "\\'")}')" class="px-2.5 py-1 rounded-xl border text-[11px] font-bold cursor-pointer inline-flex items-center gap-1 transition hover:opacity-90 ${q.cls}">
                        ${iconSvg(q.icon, 'w-3.5 h-3.5')}<span class="truncate max-w-[110px]">${esc(q.label)}</span>
                    </button>
                `).join('')}
            </div>
        ` : '';

        const modeBtnClass = (m) => `p-2.5 rounded-2xl border cursor-pointer transition flex flex-col items-center justify-center gap-1 ${selectedTravelMode === m ? 'bg-blue-600 text-white border-blue-600 shadow-xs' : 'bg-zinc-50 dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800 hover:border-blue-400'}`;

        box.innerHTML = `
            <div class="space-y-3">
                <div class="p-3.5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 space-y-3">
                    <div class="flex items-center gap-2 text-xs font-extrabold text-zinc-900 dark:text-white">
                        <span class="w-7 h-7 rounded-xl bg-blue-600/10 text-blue-600 dark:text-sky-400 flex items-center justify-center">${iconSvg('compass', 'w-4 h-4')}</span>
                        <span>Traçar ruta</span>
                    </div>

                    ${quickChipsHtml}

                    <input id="daily-route-dest-input" type="text" value="${esc(routeDestinationLabel)}" placeholder="Adreça o toca el mapa..." class="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-800 dark:text-zinc-100">

                    <div class="grid grid-cols-4 gap-1.5">
                        <button type="button" onclick="window.setDailyTravelModeAndCompute('WALKING')" class="${modeBtnClass('WALKING')}">${iconSvg('walk', 'w-5 h-5')}<span class="text-[10.5px] font-extrabold">A peu</span></button>
                        <button type="button" onclick="window.setDailyTravelModeAndCompute('DRIVING')" class="${modeBtnClass('DRIVING')}">${iconSvg('car', 'w-5 h-5')}<span class="text-[10.5px] font-extrabold">Cotxe</span></button>
                        <button type="button" onclick="window.setDailyTravelModeAndCompute('BICYCLING')" class="${modeBtnClass('BICYCLING')}">${iconSvg('bike', 'w-5 h-5')}<span class="text-[10.5px] font-extrabold">Bici</span></button>
                        <button type="button" onclick="window.setDailyTravelModeAndCompute('TRANSIT')" class="${modeBtnClass('TRANSIT')}">${iconSvg('metro', 'w-5 h-5')}<span class="text-[10.5px] font-extrabold">Transit</span></button>
                    </div>

                    <button type="button" onclick="window.computeCustomDailyRoute()" class="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-extrabold transition cursor-pointer inline-flex items-center justify-center gap-1.5">
                        ${iconSvg('arrowRight', 'w-4 h-4')}<span>Calcular</span>
                    </button>
                </div>
            </div>
        `;
    }

    window.setDailyTravelModeAndCompute = function (mode) {
        selectedTravelMode = mode;
        renderRoutesTabContent();
        if (routeDestinationCoords) {
            window.traceDailyRouteTo(routeDestinationCoords.lat, routeDestinationCoords.lng, routeDestinationLabel || 'Destinació', mode);
        }
    };

    window.computeCustomDailyRoute = async function () {
        const destInput = document.getElementById('daily-route-dest-input');
        const text = destInput ? destInput.value.trim() : '';
        if (routeDestinationCoords && (!text || text === routeDestinationLabel)) {
            await window.traceDailyRouteTo(routeDestinationCoords.lat, routeDestinationCoords.lng, routeDestinationLabel || 'Destinació', selectedTravelMode);
            return;
        }
        if (!text) {
            if (typeof window.showToast === 'function') {
                window.showToast('Escriu una destinació o fes clic en un punt del mapa.', 'info');
            }
            return;
        }
        try {
            const libs = await loadGoogleMapsLibraries();
            const { places } = await libs.Place.searchByText({
                textQuery: text,
                fields: ['displayName', 'formattedAddress', 'location'],
                maxResultCount: 1
            });
            const first = places?.[0];
            if (first && first.location) {
                routeDestinationCoords = { lat: first.location.lat(), lng: first.location.lng() };
                routeDestinationLabel = first.displayName || first.formattedAddress || text;
                await window.traceDailyRouteTo(routeDestinationCoords.lat, routeDestinationCoords.lng, routeDestinationLabel, selectedTravelMode);
            } else if (typeof window.showToast === 'function') {
                window.showToast('No s\'ha trobat aquesta adreça.', 'warning');
            }
        } catch (err) {
            if (isQuotaError(err)) window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
    };

    function getPlaceRoleIconName(catOrTitle) {
        const s = String(catOrTitle || '').toLowerCase();
        if (/casa|llar|home/.test(s)) return 'home';
        if (/insti|uni|escola|estud|cole/.test(s)) return 'school';
        if (/feina|oficina|trabajo/.test(s)) return 'work';
        if (/gimn|esport/.test(s)) return 'gym';
        if (/super|compra/.test(s)) return 'cart';
        return 'pin';
    }

    const SAVED_CAT_PRESETS = [
        { val: 'Casa', label: 'Casa', icon: 'home', tint: '#10b981' },
        { val: 'Institut / Universitat', label: 'Insti', icon: 'school', tint: '#6366f1' },
        { val: 'Feina / Estudis', label: 'Feina', icon: 'work', tint: '#2563eb' },
        { val: 'Gimnàs / Esport', label: 'Gimnàs', icon: 'gym', tint: '#f59e0b' },
        { val: 'Supermercat habitual', label: 'Súper', icon: 'cart', tint: '#ec4899' },
        { val: 'Punt de trobada', label: 'Trobar', icon: 'pin', tint: '#14b8a6' }
    ];

    window.selectSavedPlaceCat = function (val) {
        const input = document.getElementById('daily-saved-place-cat');
        if (input) input.value = val;
        document.querySelectorAll('[data-saved-cat-btn]').forEach((btn) => {
            const active = btn.getAttribute('data-saved-cat-btn') === val;
            btn.className = active
                ? 'p-2 rounded-xl border-2 border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-sky-300 flex flex-col items-center gap-1 cursor-pointer transition'
                : 'p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-300 hover:border-blue-400 flex flex-col items-center gap-1 cursor-pointer transition';
        });
    };

    function renderSavedPlacesTabContent() {
        const box = document.getElementById('daily-maps-tab-panel');
        if (!box || activeTab !== 'saved') return;
        const list = loadSavedEverydayPlaces();

        const itemsHtml = list.length
            ? list.map((item) => `
                <div class="p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 flex items-center justify-between gap-2">
                    <div class="w-8 h-8 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 flex items-center justify-center shrink-0">
                        ${iconSvg(getPlaceRoleIconName(`${item.title} ${item.category}`), 'w-4 h-4')}
                    </div>
                    <div class="min-w-0 flex-1 cursor-pointer" onclick="window.focusDailyMapPoint(${item.lat}, ${item.lng})">
                        <div class="text-xs font-extrabold text-zinc-900 dark:text-white truncate">${esc(item.title)}</div>
                        <div class="text-[10.5px] text-zinc-500 dark:text-zinc-400 truncate">${esc(item.address)}</div>
                    </div>
                    <div class="flex items-center gap-1 shrink-0">
                        <button type="button" onclick="window.traceDailyRouteTo(${item.lat}, ${item.lng}, '${esc(item.title)}')" class="p-2 rounded-lg bg-blue-600 text-white cursor-pointer" title="Ruta">${iconSvg('arrowRight', 'w-3.5 h-3.5')}</button>
                        <button type="button" onclick="window.deleteSavedEverydayPlace('${esc(item.id)}')" class="p-1.5 text-zinc-400 hover:text-rose-500 cursor-pointer" title="Eliminar">${iconSvg('trash', 'w-3.5 h-3.5')}</button>
                    </div>
                </div>
            `).join('')
            : `<div class="p-4 rounded-2xl bg-zinc-100/70 dark:bg-zinc-900/60 border border-dashed border-zinc-300 dark:border-zinc-800 flex flex-col items-center gap-1.5 text-center">${iconSvg('bookmark', 'w-5 h-5 text-zinc-400')}<span class="text-[11px] font-bold text-zinc-500 dark:text-zinc-400">Cap lloc guardat</span></div>`;

        const catTiles = SAVED_CAT_PRESETS.map((c, idx) => `
            <button type="button" data-saved-cat-btn="${esc(c.val)}" onclick="window.selectSavedPlaceCat('${esc(c.val)}')" class="${idx === 0 ? 'p-2 rounded-xl border-2 border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-sky-300' : 'p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-300 hover:border-blue-400'} flex flex-col items-center gap-1 cursor-pointer transition">
                ${iconSvg(c.icon, 'w-4 h-4')}
                <span class="text-[10px] font-extrabold truncate w-full text-center">${esc(c.label)}</span>
            </button>
        `).join('');

        box.innerHTML = `
            <div class="space-y-3">
                <div id="daily-maps-saved-form" class="p-3.5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 space-y-2.5">
                    <div class="flex items-center justify-between gap-2">
                        <span class="text-xs font-extrabold text-zinc-900 dark:text-white inline-flex items-center gap-1.5">${iconSvg('pin', 'w-3.5 h-3.5 text-blue-600')}<span>Nou lloc freqüent</span></span>
                        ${isFirebaseProfileActive()
                            ? `<span class="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">${iconSvg('cloud', 'w-3 h-3')}<span>Firestore</span></span>`
                            : `<span class="text-[10px] font-bold text-zinc-400">Temporal</span>`}
                    </div>
                    <input type="hidden" id="daily-saved-place-cat" value="Casa">
                    <div class="grid grid-cols-3 gap-1.5">
                        ${catTiles}
                    </div>
                    <div class="grid grid-cols-2 gap-1.5">
                        <input id="daily-saved-place-name" type="text" placeholder="Nom..." class="px-2.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-800 dark:text-zinc-100">
                        <input id="daily-saved-place-addr" type="text" placeholder="Adreça o ciutat..." class="px-2.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-800 dark:text-zinc-100">
                    </div>
                    <div class="grid grid-cols-2 gap-1.5">
                        <button type="button" onclick="window.startMapPickMode(document.getElementById('daily-saved-place-cat')?.value?.includes('Institut') ? 'school' : 'home')" class="py-2 px-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 cursor-pointer inline-flex items-center justify-center gap-1.5">${iconSvg('map', 'w-3.5 h-3.5')}<span>Mapa</span></button>
                        <button type="button" onclick="window.setHomeFromCurrentGps()" class="py-2 px-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-[11px] font-bold text-blue-700 dark:text-sky-300 cursor-pointer inline-flex items-center justify-center gap-1.5">${iconSvg('gps', 'w-3.5 h-3.5')}<span>GPS = Casa</span></button>
                    </div>
                    <div id="daily-saved-coords-hint" class="text-[10px] font-semibold text-zinc-400 text-center">Toca la categoria i desa</div>
                    <button type="button" onclick="window.addSavedEverydayPlace()" class="w-full py-2 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 text-xs font-extrabold transition cursor-pointer inline-flex items-center justify-center gap-1.5">
                        ${iconSvg('save', 'w-3.5 h-3.5')}<span>Guardar lloc</span>
                    </button>
                </div>

                <div class="space-y-1.5">
                    <div class="text-[10.5px] font-extrabold uppercase tracking-wider text-zinc-400 px-1">Guardats (${list.length})</div>
                    ${itemsHtml}
                </div>
            </div>
        `;
    }

    // --- TAB 5: ALIAMAPS PUBLIC TRANSIT & NATURAL-LANGUAGE COMMUTE ASSISTANT ---
    function findSavedPlaceByRole(role) {
        const list = loadSavedEverydayPlaces();
        if (role === 'home') {
            return list.find((p) => p.role === 'home' || /casa|llar|home/i.test(`${p.title} ${p.category}`)) || null;
        }
        if (role === 'school') {
            return list.find((p) => p.role === 'school' || /insti|institut|instituto|uni|universit|escola|estud|cole/i.test(`${p.title} ${p.category}`)) || null;
        }
        if (role === 'work') {
            return list.find((p) => p.role === 'work' || /feina|trabajo|oficina|work/i.test(`${p.title} ${p.category}`)) || null;
        }
        return null;
    }

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    function formatTimeHHMM(ms) {
        if (!ms || isNaN(ms)) return '--:--';
        const d = new Date(ms);
        return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    }

    function buildTargetDateFromTimeStr(timeStr, dayOffset = 0) {
        const parts = String(timeStr || '08:00').split(':');
        const hh = Math.min(23, Math.max(0, parseInt(parts[0], 10) || 8));
        const mm = Math.min(59, Math.max(0, parseInt(parts[1], 10) || 0));
        const d = new Date();
        d.setDate(d.getDate() + (dayOffset === 1 ? 1 : 0));
        d.setHours(hh, mm, 0, 0);
        // Safety against past timestamp on today's date when requesting future transit
        if (dayOffset === 0 && d.getTime() < Date.now() - 2 * 60 * 1000) {
            d.setDate(d.getDate() + 1);
            transitState.dayOffset = 1;
            transitState.autoShiftedToTomorrow = true;
        }
        return d;
    }

    function parseDurationSec(durStrOrObj) {
        if (!durStrOrObj) return 0;
        if (typeof durStrOrObj === 'number') return Math.round(durStrOrObj / 1000);
        const m = String(durStrOrObj).match(/(\d+(?:\.\d+)?)s/);
        return m ? Math.round(parseFloat(m[1])) : 0;
    }

    function vehicleSvg(vehicleType, cls = 'w-3.5 h-3.5 shrink-0') {
        const t = String(vehicleType || '').toUpperCase();
        if (t.includes('BUS') || t.includes('TROLLEYBUS')) return iconSvg('bus', cls);
        if (t.includes('SUBWAY') || t.includes('METRO')) return iconSvg('metro', cls);
        if (t.includes('TRAM') || t.includes('LIGHT_RAIL') || t.includes('MONORAIL')) return iconSvg('tram', cls);
        if (t.includes('FERRY')) return iconSvg('ferry', cls);
        return iconSvg('train', cls);
    }

    function vehicleTextLabel(vehicleType) {
        const t = String(vehicleType || '').toUpperCase();
        if (t.includes('BUS') || t.includes('TROLLEYBUS')) return 'Bus';
        if (t.includes('SUBWAY') || t.includes('METRO')) return 'Metro';
        if (t.includes('TRAM') || t.includes('LIGHT_RAIL') || t.includes('MONORAIL')) return 'Tram';
        if (t.includes('FERRY')) return 'Ferri';
        return 'Tren';
    }

    function isMapsUiEs() {
        return (transitState.lang || window.currentAppLang) === 'es';
    }

    function approxStepDistanceMeters(s) {
        if (typeof s?.distanceMeters === 'number' && s.distanceMeters > 0) return s.distanceMeters;
        const txt = String(s?.distanceText || '').trim().toLowerCase().replace(',', '.');
        const mKm = txt.match(/([\d.]+)\s*km/);
        if (mKm) return Math.round(parseFloat(mKm[1]) * 1000);
        const mM = txt.match(/([\d.]+)\s*m/);
        if (mM) return Math.round(parseFloat(mM[1]));
        return 0;
    }

    function formatMetersCompact(meters) {
        const m = Math.round(Number(meters) || 0);
        if (m <= 0) return '';
        if (m >= 1000) return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
        return `${m} m`;
    }

    function formatTransitBadgeCode(step) {
        const kind = vehicleTextLabel(step?.vehicleType);
        const rawShort = String(step?.lineShort || '').trim();
        const rawName = String(step?.lineName || '').trim();
        const codeMatch = rawShort.match(/\b([A-Z]?\d{1,4}[A-Z]?|R\d{1,2}[A-Z]?|S\d{1,2}|L\d{1,2}|T\d{1,2}|E\d{1,2}(?:\.\d+)?|N\d{1,3}|H\d{1,2}|V\d{1,2}|D\d{1,2})\b/i)
            || rawName.match(/\b(R\d{1,2}[A-Z]?|S\d{1,2}|L\d{1,2}|T\d{1,2}|E\d{1,2}(?:\.\d+)?)\b/);

        let shortCode = rawShort;
        let extraLineTitle = (rawName && rawName !== rawShort) ? rawName : '';
        if (shortCode.length > 12) {
            extraLineTitle = shortCode;
            shortCode = codeMatch ? codeMatch[1].toUpperCase() : '';
        }

        const pillLabel = shortCode ? `${kind} ${shortCode}` : kind;
        return { kind, shortCode, pillLabel, extraLineTitle };
    }

    function groupRouteStepsForDisplay(steps) {
        const list = Array.isArray(steps) ? steps : [];
        const phases = [];
        let walkBucket = [];

        const flushWalk = (nextTransitStep) => {
            if (walkBucket.length === 0) return;
            const totalSec = walkBucket.reduce((acc, st) => acc + (st.durationSec || 0), 0);
            const totalMeters = walkBucket.reduce((acc, st) => acc + approxStepDistanceMeters(st), 0);
            const mins = Math.max(1, Math.round(totalSec / 60));
            const subSteps = walkBucket.filter((st) => st.instruction || approxStepDistanceMeters(st) > 15);
            const isEs = isMapsUiEs();
            const targetStopName = nextTransitStep?.departureStopName
                ? (isEs ? `hasta ${nextTransitStep.departureStopName}` : `fins a ${nextTransitStep.departureStopName}`)
                : (isEs ? 'hasta tu destino' : 'fins a la destinació');

            phases.push({
                phaseIdx: phases.length,
                type: 'walk',
                durationSec: totalSec,
                durationText: `${mins} min`,
                distanceMeters: totalMeters,
                distanceText: formatMetersCompact(totalMeters),
                targetStopName,
                subSteps,
                polylineSteps: walkBucket.slice()
            });
            walkBucket = [];
        };

        for (let i = 0; i < list.length; i++) {
            const st = list[i];
            if (!st.isTransit) {
                walkBucket.push(st);
            } else {
                flushWalk(st);
                const badge = formatTransitBadgeCode(st);
                const mins = Math.max(1, Math.round((st.durationSec || 60) / 60));
                phases.push({
                    phaseIdx: phases.length,
                    type: 'transit',
                    step: st,
                    badge,
                    durationSec: st.durationSec || 0,
                    durationText: st.durationText || `${mins} min`,
                    polylineSteps: [st]
                });
            }
        }
        flushWalk(null);
        return phases;
    }

    function enrichNormalizedRoute(routeObj) {
        const steps = Array.isArray(routeObj.steps) ? routeObj.steps : [];
        const phases = groupRouteStepsForDisplay(steps);
        const transitPhases = phases.filter((p) => p.type === 'transit');
        const walkSec = phases.filter((p) => p.type === 'walk').reduce((acc, p) => acc + (p.durationSec || 0), 0);
        const walkMin = walkSec > 0 ? Math.max(1, Math.round(walkSec / 60)) : 0;
        const hasBus = transitPhases.some((p) => /BUS|TROLLEY/i.test(p.step.vehicleType));
        const hasRail = transitPhases.some((p) => /RAIL|TRAIN|SUBWAY|METRO|TRAM/i.test(p.step.vehicleType));
        const signature = `${routeObj.departureTimeText}|${routeObj.arrivalTimeText}|${transitPhases.map((p) => `${p.badge.pillLabel}@${p.step.departureStopName}`).join('+')}`;

        return {
            ...routeObj,
            phases,
            transitPhases,
            walkMin,
            transfers: Math.max(0, transitPhases.length - 1),
            hasBus,
            hasRail,
            signature
        };
    }

    function normalizeRestTransitRoute(rawRoute, idx, baseQueryTimeMs, isArrivalQuery) {
        const durationSec = parseDurationSec(rawRoute.duration);
        const leg = rawRoute.legs?.[0] || {};
        const rawSteps = Array.isArray(leg.steps) ? leg.steps : [];

        const steps = rawSteps.map((s) => {
            const td = s.transitDetails || null;
            const isTransit = Boolean(td) || String(s.travelMode || '').toUpperCase() === 'TRANSIT';
            const stopDetails = td?.stopDetails || {};
            const depStop = stopDetails.departureStop || {};
            const arrStop = stopDetails.arrivalStop || {};
            const line = td?.transitLine || {};
            const vType = line?.vehicle?.type || (isTransit ? 'BUS' : 'WALK');
            const depMs = stopDetails.departureTime ? new Date(stopDetails.departureTime).getTime() : null;
            const arrMs = stopDetails.arrivalTime ? new Date(stopDetails.arrivalTime).getTime() : null;
            const startLL = s.startLocation?.latLng ? { lat: s.startLocation.latLng.latitude, lng: s.startLocation.latLng.longitude } : null;
            const endLL = s.endLocation?.latLng ? { lat: s.endLocation.latLng.latitude, lng: s.endLocation.latLng.longitude } : null;

            return {
                isTransit,
                travelMode: isTransit ? 'TRANSIT' : 'WALK',
                vehicleType: vType,
                vehicleLabel: line?.vehicle?.name?.text || vType,
                lineShort: line?.nameShort || line?.name || (isTransit ? 'Línia' : ''),
                lineName: line?.name || line?.nameShort || '',
                lineColor: line?.color || (String(vType).includes('BUS') ? '#2563eb' : (String(vType).includes('SUBWAY') || String(vType).includes('METRO') ? '#dc2626' : '#0284c7')),
                lineTextColor: line?.textColor || '#ffffff',
                headsign: td?.headsign || '',
                departureStopName: depStop?.name || '',
                departureTimeMs: depMs,
                departureTimeText: td?.localizedValues?.departureTime?.time?.text || (depMs ? formatTimeHHMM(depMs) : ''),
                arrivalStopName: arrStop?.name || '',
                arrivalTimeMs: arrMs,
                arrivalTimeText: td?.localizedValues?.arrivalTime?.time?.text || (arrMs ? formatTimeHHMM(arrMs) : ''),
                stopCount: td?.stopCount || 0,
                distanceMeters: Number(s.distanceMeters) || 0,
                durationSec: parseDurationSec(s.staticDuration),
                durationText: s.localizedValues?.staticDuration?.text || '',
                distanceText: s.localizedValues?.distance?.text || '',
                instruction: s.navigationInstruction?.instructions || '',
                encodedPolyline: s.polyline?.encodedPolyline || '',
                startLatLng: startLL,
                endLatLng: endLL,
                departureStopLatLng: depStop?.location?.latLng
                    ? { lat: depStop.location.latLng.latitude, lng: depStop.location.latLng.longitude }
                    : startLL,
                arrivalStopLatLng: arrStop?.location?.latLng
                    ? { lat: arrStop.location.latLng.latitude, lng: arrStop.location.latLng.longitude }
                    : endLL
            };
        });

        // Compute route-level exact departure/arrival timestamps including walking lead-in/out
        const firstTransitIdx = steps.findIndex((s) => s.isTransit && s.departureTimeMs);
        let lastTransitIdx = -1;
        for (let i = steps.length - 1; i >= 0; i--) {
            if (steps[i].isTransit && steps[i].arrivalTimeMs) {
                lastTransitIdx = i;
                break;
            }
        }

        let routeDepartureMs = baseQueryTimeMs;
        let routeArrivalMs = baseQueryTimeMs + durationSec * 1000;

        if (firstTransitIdx !== -1) {
            const walkBeforeSec = steps.slice(0, firstTransitIdx).reduce((acc, st) => acc + (st.durationSec || 0), 0);
            routeDepartureMs = steps[firstTransitIdx].departureTimeMs - walkBeforeSec * 1000;
            const walkAfterSec = steps.slice(lastTransitIdx + 1).reduce((acc, st) => acc + (st.durationSec || 0), 0);
            routeArrivalMs = steps[lastTransitIdx].arrivalTimeMs + walkAfterSec * 1000;
        } else if (isArrivalQuery) {
            routeArrivalMs = baseQueryTimeMs;
            routeDepartureMs = baseQueryTimeMs - durationSec * 1000;
        }

        return enrichNormalizedRoute({
            index: idx,
            durationSec,
            durationText: rawRoute.localizedValues?.duration?.text || `${Math.max(1, Math.round(durationSec / 60))} min`,
            distanceText: rawRoute.localizedValues?.distance?.text || (rawRoute.distanceMeters ? `${(rawRoute.distanceMeters / 1000).toFixed(1)} km` : ''),
            departureMs: routeDepartureMs,
            arrivalMs: routeArrivalMs,
            departureTimeText: formatTimeHHMM(routeDepartureMs),
            arrivalTimeText: formatTimeHHMM(routeArrivalMs),
            steps,
            encodedPolyline: rawRoute.polyline?.encodedPolyline || '',
            viewport: rawRoute.viewport || null,
            rawSdkRoute: null
        });
    }

    function normalizeSdkTransitRoute(sdkRoute, idx, baseQueryTimeMs, isArrivalQuery) {
        const durationSec = sdkRoute.durationMillis ? Math.round(sdkRoute.durationMillis / 1000) : 0;
        const leg = sdkRoute.legs?.[0] || {};
        const rawSteps = Array.isArray(leg.steps) ? leg.steps : [];

        const steps = rawSteps.map((s) => {
            const td = s.transitDetails || null;
            const isTransit = Boolean(td) || String(s.travelMode || '').toUpperCase() === 'TRANSIT';
            const stopDetails = td?.stopDetails || {};
            const depTimeVal = stopDetails.departureTime ? new Date(stopDetails.departureTime).getTime() : null;
            const arrTimeVal = stopDetails.arrivalTime ? new Date(stopDetails.arrivalTime).getTime() : null;
            const line = td?.transitLine || {};
            const vType = line?.vehicle?.type || (isTransit ? 'BUS' : 'WALK');
            const pathArr = Array.isArray(s.path) ? s.path : null;
            const firstPathLL = pathArr?.[0] ? { lat: typeof pathArr[0].lat === 'function' ? pathArr[0].lat() : pathArr[0].lat, lng: typeof pathArr[0].lng === 'function' ? pathArr[0].lng() : pathArr[0].lng } : null;
            const lastPathItem = pathArr?.[pathArr.length - 1];
            const lastPathLL = lastPathItem ? { lat: typeof lastPathItem.lat === 'function' ? lastPathItem.lat() : lastPathItem.lat, lng: typeof lastPathItem.lng === 'function' ? lastPathItem.lng() : lastPathItem.lng } : null;

            return {
                isTransit,
                travelMode: isTransit ? 'TRANSIT' : 'WALK',
                vehicleType: vType,
                vehicleLabel: line?.vehicle?.name || vType,
                lineShort: line?.nameShort || line?.name || (isTransit ? 'Transport' : ''),
                lineName: line?.name || line?.nameShort || '',
                lineColor: line?.color || (String(vType).includes('BUS') ? '#2563eb' : (String(vType).includes('SUBWAY') || String(vType).includes('METRO') ? '#dc2626' : '#0284c7')),
                lineTextColor: line?.textColor || '#ffffff',
                headsign: td?.headsign || '',
                departureStopName: stopDetails.departureStop?.name || '',
                departureTimeMs: depTimeVal,
                departureTimeText: td?.localizedValues?.departureTime || (depTimeVal ? formatTimeHHMM(depTimeVal) : ''),
                arrivalStopName: stopDetails.arrivalStop?.name || '',
                arrivalTimeMs: arrTimeVal,
                arrivalTimeText: td?.localizedValues?.arrivalTime || (arrTimeVal ? formatTimeHHMM(arrTimeVal) : ''),
                stopCount: td?.stopCount || 0,
                distanceMeters: Number(s.distanceMeters) || 0,
                durationSec: s.staticDurationMillis ? Math.round(s.staticDurationMillis / 1000) : 0,
                durationText: s.localizedValues?.staticDuration || '',
                distanceText: s.localizedValues?.distance || '',
                instruction: s.instructions || '',
                path: pathArr,
                startLatLng: firstPathLL,
                endLatLng: lastPathLL,
                departureStopLatLng: stopDetails.departureStop?.location
                    ? { lat: stopDetails.departureStop.location.lat(), lng: stopDetails.departureStop.location.lng() }
                    : firstPathLL,
                arrivalStopLatLng: stopDetails.arrivalStop?.location
                    ? { lat: stopDetails.arrivalStop.location.lat(), lng: stopDetails.arrivalStop.location.lng() }
                    : lastPathLL
            };
        });

        const firstTransitIdx = steps.findIndex((s) => s.isTransit && s.departureTimeMs);
        let lastTransitIdx = -1;
        for (let i = steps.length - 1; i >= 0; i--) {
            if (steps[i].isTransit && steps[i].arrivalTimeMs) {
                lastTransitIdx = i;
                break;
            }
        }
        let routeDepartureMs = baseQueryTimeMs;
        let routeArrivalMs = baseQueryTimeMs + durationSec * 1000;
        if (firstTransitIdx !== -1) {
            const walkBeforeSec = steps.slice(0, firstTransitIdx).reduce((acc, st) => acc + (st.durationSec || 0), 0);
            routeDepartureMs = steps[firstTransitIdx].departureTimeMs - walkBeforeSec * 1000;
            const walkAfterSec = steps.slice(lastTransitIdx + 1).reduce((acc, st) => acc + (st.durationSec || 0), 0);
            routeArrivalMs = steps[lastTransitIdx].arrivalTimeMs + walkAfterSec * 1000;
        } else if (isArrivalQuery) {
            routeArrivalMs = baseQueryTimeMs;
            routeDepartureMs = baseQueryTimeMs - durationSec * 1000;
        }

        return enrichNormalizedRoute({
            index: idx,
            durationSec,
            durationText: sdkRoute.localizedValues?.duration || `${Math.max(1, Math.round(durationSec / 60))} min`,
            distanceText: sdkRoute.localizedValues?.distance || '',
            departureMs: routeDepartureMs,
            arrivalMs: routeArrivalMs,
            departureTimeText: formatTimeHHMM(routeDepartureMs),
            arrivalTimeText: formatTimeHHMM(routeArrivalMs),
            steps,
            viewport: sdkRoute.viewport || null,
            rawSdkRoute: sdkRoute
        });
    }

    async function fetchTransitRoutesSmart({ origin, destination, departureTime, arrivalTime, allowedTravelModes, languageCode }) {
        const queryTimeMs = new Date(arrivalTime || departureTime).getTime();
        const isArrivalQuery = Boolean(arrivalTime && !departureTime);

        try {
            const res = await fetch('/api/maps/transit-routes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    origin,
                    destination,
                    departureTime: departureTime || undefined,
                    arrivalTime: arrivalTime || undefined,
                    allowedTravelModes,
                    languageCode,
                    computeAlternativeRoutes: true
                })
            });
            if (res.status === 429) {
                window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
                return [];
            }
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.routes)) {
                    return data.routes.map((r, i) => normalizeRestTransitRoute(r, i, queryTimeMs, isArrivalQuery));
                }
            }
        } catch (_) {}

        // Seamless fallback via Maps JS SDK Route.computeRoutes (browser-side)
        try {
            const libs = await loadGoogleMapsLibraries();
            const originLatLng = (typeof origin.lat === 'number') ? { lat: origin.lat, lng: origin.lng } : origin.address;
            const destLatLng = (typeof destination.lat === 'number') ? { lat: destination.lat, lng: destination.lng } : destination.address;
            const sdkReq = {
                origin: originLatLng,
                destination: destLatLng,
                travelMode: 'TRANSIT',
                computeAlternativeRoutes: true,
                fields: ['path', 'legs', 'distanceMeters', 'durationMillis', 'localizedValues', 'viewport']
            };
            if (Array.isArray(allowedTravelModes) && allowedTravelModes.length > 0) {
                sdkReq.transitPreferences = { allowedTravelModes };
            }
            if (arrivalTime && !departureTime) sdkReq.arrivalTime = new Date(arrivalTime);
            else if (departureTime) sdkReq.departureTime = new Date(departureTime);

            const { routes } = await libs.Route.computeRoutes(sdkReq);
            if (Array.isArray(routes) && routes.length > 0) {
                return routes.map((r, i) => normalizeSdkTransitRoute(r, i, queryTimeMs, isArrivalQuery));
            }
        } catch (err) {
            if (isQuotaError(err)) window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        return [];
    }

    async function resolveTextAddressOrPlace(queryText) {
        const clean = String(queryText || '').trim();
        if (!clean) return null;
        try {
            const libs = await loadGoogleMapsLibraries();
            const biasLoc = userLocation || (mapInstance ? { lat: mapInstance.getCenter().lat(), lng: mapInstance.getCenter().lng() } : DEFAULT_CENTER);
            const { places } = await libs.Place.searchByText({
                textQuery: clean,
                fields: ['displayName', 'formattedAddress', 'location'],
                locationBias: { center: biasLoc, radius: 30000 },
                maxResultCount: 1
            });
            const p = places?.[0];
            if (p && p.location) {
                return {
                    lat: p.location.lat(),
                    lng: p.location.lng(),
                    label: p.displayName || p.formattedAddress || clean
                };
            }
        } catch (_) {}

        try {
            const lang = (window.currentAppLang === 'es') ? 'es' : 'ca';
            const res = await fetch(`/api/maps/geocode?address=${encodeURIComponent(clean)}&language=${lang}`);
            const data = await res.json().catch(() => ({}));
            const loc = data?.results?.[0]?.geometry?.location;
            if (loc) {
                return {
                    lat: loc.lat,
                    lng: loc.lng,
                    label: data.results[0].formatted_address || clean
                };
            }
        } catch (_) {}
        return { address: clean, label: clean };
    }

    window.openPlaceRoleEditor = function (role) {
        const nextRole = (role === 'home' || role === 'school')
            ? (transitState.placeEditorRole === role ? null : role)
            : null;
        transitState.placeEditorRole = nextRole;
        transitState.homeEditorOpen = nextRole === 'home';
        transitState.placeSearchQuery = '';
        transitState.placeSearchCandidates = [];
        transitState.placeSearchLoading = false;
        renderTransitTabContent();
        if (nextRole) {
            setTimeout(() => {
                const inp = document.getElementById('daily-place-role-search');
                if (inp) inp.focus();
            }, 30);
        }
    };

    window.openHomeEditor = function (isOpen = true) {
        transitState.homeEditorOpen = Boolean(isOpen);
        transitState.placeEditorRole = isOpen ? 'home' : null;
        transitState.placeSearchQuery = '';
        transitState.placeSearchCandidates = [];
        renderTransitTabContent();
        if (transitState.placeEditorRole) {
            setTimeout(() => {
                const inp = document.getElementById('daily-place-role-search');
                if (inp) inp.focus();
            }, 30);
        }
    };

    window.updatePlaceRoleSearchInput = function (val) {
        transitState.placeSearchQuery = String(val || '');
        transitState.homeSearchQuery = transitState.placeSearchQuery;
    };
    window.updateHomeQuickSearchInput = window.updatePlaceRoleSearchInput;

    window.setHomeFromCurrentGps = async function () {
        const loc = userLocation || (await requestUserGeolocation(false));
        if (!loc) return;
        const addr = await reverseGeocodeCoords(loc.lat, loc.lng);
        const role = transitState.placeEditorRole === 'school' ? 'school' : 'home';
        await window.setPlaceRoleFromCoords(role, loc.lat, loc.lng, role === 'home' ? 'Casa' : 'Institut / Universitat', addr);
    };

    window.searchPlaceRoleCandidates = async function () {
        const role = transitState.placeEditorRole || 'home';
        const inp = document.getElementById('daily-place-role-search');
        const q = (inp ? inp.value.trim() : transitState.placeSearchQuery.trim());
        transitState.placeSearchQuery = q;
        if (!q) {
            if (typeof window.showToast === 'function') {
                window.showToast(
                    role === 'school'
                        ? 'Escriu el nom o adreça del teu institut o universitat.'
                        : 'Escriu el teu carrer, número o població per trobar Casa teva.',
                    'info'
                );
            }
            return;
        }
        transitState.placeSearchLoading = true;
        transitState.placeSearchCandidates = [];
        renderTransitTabContent();

        try {
            const libs = await loadGoogleMapsLibraries();
            const biasLoc = userLocation || (mapInstance ? { lat: mapInstance.getCenter().lat(), lng: mapInstance.getCenter().lng() } : DEFAULT_CENTER);
            const { places } = await libs.Place.searchByText({
                textQuery: q,
                fields: ['id', 'displayName', 'formattedAddress', 'location'],
                locationBias: { center: biasLoc, radius: 50000 },
                maxResultCount: 4
            });
            transitState.placeSearchCandidates = (places || [])
                .filter((p) => p && p.location)
                .map((p) => ({
                    displayName: p.displayName || q,
                    formattedAddress: p.formattedAddress || p.displayName || q,
                    lat: p.location.lat(),
                    lng: p.location.lng()
                }));
        } catch (_) {}

        if (transitState.placeSearchCandidates.length === 0) {
            const single = await resolveTextAddressOrPlace(q);
            if (single && typeof single.lat === 'number') {
                transitState.placeSearchCandidates = [{
                    displayName: q,
                    formattedAddress: single.label || q,
                    lat: single.lat,
                    lng: single.lng
                }];
            }
        }

        transitState.placeSearchLoading = false;
        if (transitState.placeSearchCandidates.length === 1) {
            const only = transitState.placeSearchCandidates[0];
            const finalTitle = role === 'home' ? 'Casa' : (only.displayName || q || 'Institut / Universitat');
            await window.setPlaceRoleFromCoords(role, only.lat, only.lng, finalTitle, only.formattedAddress);
            return;
        }
        renderTransitTabContent();
    };
    window.searchHomeCandidates = window.searchPlaceRoleCandidates;

    window.pickPlaceRoleCandidate = async function (idx) {
        const list = transitState.placeSearchCandidates || [];
        const cand = list[idx];
        if (!cand) return;
        const role = transitState.placeEditorRole || 'home';
        const finalTitle = role === 'home' ? 'Casa' : (cand.displayName || 'Institut / Universitat');
        await window.setPlaceRoleFromCoords(role, cand.lat, cand.lng, finalTitle, cand.formattedAddress || cand.displayName);
    };
    window.pickHomeCandidate = window.pickPlaceRoleCandidate;

    window.pickAiSetPlaceCandidate = async function (idx) {
        const list = transitState.setPlaceCandidates || [];
        const cand = list[idx];
        if (!cand) return;
        const role = transitState.setPlaceRole || 'home';
        transitState.setPlaceCandidates = [];
        await window.setPlaceRoleFromCoords(role, cand.lat, cand.lng, role === 'home' ? 'Casa' : (cand.displayName || 'Institut / Universitat'), cand.formattedAddress || cand.displayName);
    };

    window.applyTransitPresetOrigin = async function (preset) {
        if (preset === 'current') {
            transitState.originMode = 'current';
            transitState.originCoords = null;
            transitState.originAddress = '';
            transitState.originLabel = 'Ubicació actual (GPS)';
            const loc = userLocation || (await requestUserGeolocation(false));
            if (loc) {
                transitState.originCoords = loc;
            }
        } else if (preset === 'home') {
            const saved = findSavedPlaceByRole('home');
            if (!saved) {
                window.openPlaceRoleEditor('home');
                return;
            }
            transitState.originMode = 'saved';
            transitState.originCoords = { lat: saved.lat, lng: saved.lng };
            transitState.originAddress = saved.address || saved.title;
            transitState.originLabel = saved.title || 'Casa';
        }
        renderTransitTabContent();
    };

    window.applyTransitPresetDest = function (preset) {
        const role = preset === 'school' ? 'school' : (preset === 'work' ? 'work' : 'home');
        const saved = findSavedPlaceByRole(role);
        if (!saved) {
            if (role === 'school' || role === 'home') {
                window.openPlaceRoleEditor(role);
                return;
            }
            if (typeof window.showToast === 'function') {
                window.showToast('Escriu la destinació o fes clic al mapa!', 'info');
            }
            const inp = document.getElementById('daily-transit-dest-input');
            if (inp) inp.focus();
            return;
        }
        transitState.destMode = 'saved';
        transitState.destCoords = { lat: saved.lat, lng: saved.lng };
        transitState.destAddress = saved.address || saved.title;
        transitState.destLabel = saved.title || 'Destinació';
        renderTransitTabContent();
    };

    window.setTransitModeFilter = function (mode) {
        transitState.modeFilter = mode;
        renderTransitTabContent();
    };

    window.setTransitTimeMode = function (mode) {
        transitState.timeMode = mode;
        renderTransitTabContent();
    };

    window.runTransitExamplePrompt = function (type) {
        const inp = document.getElementById('daily-transit-question-input');
        const lang = (window.currentAppLang === 'es') ? 'es' : 'ca';
        let q = '';
        if (type === 'explore') {
            q = lang === 'es'
                ? '¿Qué puedo hacer por aquí cerca ahora mismo?'
                : 'Què puc fer per aquí a prop ara mateix?';
        } else if (type === 'study') {
            q = lang === 'es'
                ? '¿Dónde puedo ir a estudiar o tomar un café tranquilo cerca?'
                : 'On puc anar a estudiar o prendre un cafè tranquil a prop?';
        } else if (type === 'school') {
            q = lang === 'es'
                ? '¿Puedo salir de casa a las 8:00, coger algún bus de esas horas y llegar un poco antes de las 9:00 al insti?'
                : 'Puc sortir de casa a les 8:00, agafar algun bus i arribar una mica abans de les 9:00 a l\'institut?';
        } else if (type === 'train') {
            q = lang === 'es'
                ? '¿Qué tren o bus sale ahora desde mi ubicación?'
                : 'Quin tren o bus surt ara des de la meva ubicació?';
        }
        if (inp) inp.value = q;
        transitState.question = q;
        window.askAliatMapsTransit();
    };

    window.saveQuickHomeOrSchoolFromInput = async function (role) {
        const isHome = role === 'home';
        const inputEl = document.getElementById(isHome ? 'daily-transit-origin-input' : 'daily-transit-dest-input');
        const rawText = inputEl ? inputEl.value.trim() : '';
        let resolved = null;

        if (rawText) {
            resolved = await resolveTextAddressOrPlace(rawText);
        } else if (isHome) {
            const loc = userLocation || (await requestUserGeolocation(false));
            if (loc) {
                const addr = await reverseGeocodeCoords(loc.lat, loc.lng);
                resolved = { lat: loc.lat, lng: loc.lng, label: addr };
            }
        } else if (transitState.destCoords) {
            resolved = {
                lat: transitState.destCoords.lat,
                lng: transitState.destCoords.lng,
                label: transitState.destAddress || 'Institut / Universitat'
            };
        }

        if (!resolved || typeof resolved.lat !== 'number') {
            window.openPlaceRoleEditor(isHome ? 'home' : 'school');
            return;
        }

        upsertSavedRolePlace(role, {
            lat: resolved.lat,
            lng: resolved.lng,
            address: resolved.label,
            title: isHome ? 'Casa' : (rawText || 'Institut / Universitat')
        });
        pushMapsPlacesToServerNow().catch(() => {});

        if (typeof window.showToast === 'function') {
            window.showToast(`${isHome ? 'Casa' : 'Institut'} desat per sempre!`, 'success');
        }
        renderTransitTabContent();
    };

    function buildCommuteVerdict(routes, { deadlineMs, requestedDepMs, originLabel, destLabel, lang, dayOffset, autoShifted, slightlyBefore }) {
        const isEs = lang === 'es';
        const whenTag = dayOffset === 1
            ? (isEs ? (autoShifted ? 'mañana (hora ya pasada hoy)' : 'mañana') : (autoShifted ? 'demà (l\'hora d\'avui ja ha passat)' : 'demà'))
            : (isEs ? 'hoy' : 'avui');

        if (!routes || routes.length === 0) {
            return {
                status: 'none',
                html: isEs
                    ? `<div class="flex items-start gap-2">${iconSvg('xCircle', 'w-4 h-4 text-rose-600 shrink-0 mt-0.5')}<span>No se han encontrado rutas en transporte público entre <strong>${esc(originLabel)}</strong> y <strong>${esc(destLabel)}</strong> para ${whenTag}. Revisa que las direcciones sean concretas (ciudad/parada) o prueba "Todos los transportes".</span></div>`
                    : `<div class="flex items-start gap-2">${iconSvg('xCircle', 'w-4 h-4 text-rose-600 shrink-0 mt-0.5')}<span>No s'han trobat rutes en transport públic entre <strong>${esc(originLabel)}</strong> i <strong>${esc(destLabel)}</strong> per ${whenTag}. Revisa que les adreces siguin concretes o prova "Tots els transports".</span></div>`,
                plainText: isEs
                    ? `No se han encontrado rutas en transporte público entre ${originLabel} y ${destLabel}.`
                    : `No s'han trobat rutes en transport públic entre ${originLabel} i ${destLabel}.`
            };
        }

        const primary = routes[0];
        const transitSteps = primary.steps.filter((s) => s.isTransit);
        const linesDesc = transitSteps.map((s) => `<span class="inline-flex items-center gap-1 font-bold">${vehicleSvg(s.vehicleType, 'w-3.5 h-3.5')} ${esc(s.lineShort)}${s.departureStopName ? ` (${esc(s.departureStopName)} ${esc(s.departureTimeText)})` : ''}</span>`).join(' → ');
        const linesText = transitSteps.map((s) => `${vehicleTextLabel(s.vehicleType)} ${s.lineShort}${s.departureStopName ? ` (${s.departureStopName} ${s.departureTimeText})` : ''}`).join(' -> ');

        if (deadlineMs) {
            const fittingRoutes = routes.filter((r) => r.arrivalMs <= deadlineMs);
            const chosen = fittingRoutes[0] || primary;
            const cTransit = chosen.steps.filter((s) => s.isTransit);
            const cMain = cTransit[0] || null;
            const cLinesHtml = cTransit.map((s) => `<span class="inline-flex items-center gap-1">${vehicleSvg(s.vehicleType, 'w-3.5 h-3.5')} ${esc(s.lineShort)}</span>`).join(' + ') || (isEs ? 'Transporte público' : 'Transport públic');
            const cLinesPlain = cTransit.map((s) => `${vehicleTextLabel(s.vehicleType)} ${s.lineShort}`).join(' + ') || (isEs ? 'Transporte público' : 'Transport públic');
            const diffMin = Math.round((deadlineMs - chosen.arrivalMs) / 60000);
            const deadlineTxt = formatTimeHHMM(deadlineMs);

            if (chosen.arrivalMs <= deadlineMs) {
                const marginNoteEs = diffMin > 0
                    ? `llegas ${diffMin} min antes de las ${deadlineTxt}`
                    : `llegas justo a las ${deadlineTxt}`;
                const marginNoteCa = diffMin > 0
                    ? `arribes ${diffMin} min abans de les ${deadlineTxt}`
                    : `arribes just a les ${deadlineTxt}`;
                const stopNote = cMain
                    ? (isEs
                        ? ` Coges <strong>${cLinesHtml}</strong> en <em>${esc(cMain.departureStopName)}</em> (${esc(cMain.departureTimeText)}) y bajas en <em>${esc(cMain.arrivalStopName)}</em> (${esc(cMain.arrivalTimeText)}).`
                        : ` Agafes <strong>${cLinesHtml}</strong> a <em>${esc(cMain.departureStopName)}</em> (${esc(cMain.departureTimeText)}) i baixes a <em>${esc(cMain.arrivalStopName)}</em> (${esc(cMain.arrivalTimeText)}).`)
                    : '';

                const plain = isEs
                    ? `Sí, puedes llegar antes de las ${deadlineTxt} (${whenTag}): si sales a las ${chosen.departureTimeText} desde ${originLabel}, ${marginNoteEs} (llegada ${chosen.arrivalTimeText}, duración ${chosen.durationText}). Línea: ${cTransit.map(s => `${s.lineShort} en ${s.departureStopName} a las ${s.departureTimeText}`).join(' -> ')}.`
                    : `Sí, pots arribar abans de les ${deadlineTxt} (${whenTag}): si surts a les ${chosen.departureTimeText} des de ${originLabel}, ${marginNoteCa} (arribada ${chosen.arrivalTimeText}, durada ${chosen.durationText}). Línia: ${cTransit.map(s => `${s.lineShort} a ${s.departureStopName} a les ${s.departureTimeText}`).join(' -> ')}.`;

                return {
                    status: (slightlyBefore && diffMin < 2) ? 'tight' : 'ok',
                    bestIdx: chosen.index,
                    html: isEs
                        ? `<div class="flex items-start gap-2">${iconSvg('checkCircle', 'w-4 h-4 text-emerald-600 shrink-0 mt-0.5')}<span><strong>¡Sí, llegas a tiempo!</strong> (${esc(whenTag)}): saliendo a las <strong>${esc(chosen.departureTimeText)}</strong> llegas a las <strong>${esc(chosen.arrivalTimeText)}</strong> (${esc(marginNoteEs)}, ${esc(chosen.durationText)}).${stopNote}</span></div>`
                        : `<div class="flex items-start gap-2">${iconSvg('checkCircle', 'w-4 h-4 text-emerald-600 shrink-0 mt-0.5')}<span><strong>Sí, hi arribes a temps!</strong> (${esc(whenTag)}): sortint a les <strong>${esc(chosen.departureTimeText)}</strong> arribes a les <strong>${esc(chosen.arrivalTimeText)}</strong> (${esc(marginNoteCa)}, ${esc(chosen.durationText)}).${stopNote}</span></div>`,
                    plainText: plain
                };
            } else {
                const lateMin = Math.abs(diffMin);
                const plain = isEs
                    ? `Saliendo sobre esa hora llegarías a las ${chosen.arrivalTimeText} (${lateMin} min después de las ${deadlineTxt}). Línea: ${cLinesPlain}.`
                    : `Sortint cap a aquella hora arribaries a les ${chosen.arrivalTimeText} (${lateMin} min després de les ${deadlineTxt}). Línia: ${cLinesPlain}.`;
                return {
                    status: 'late',
                    bestIdx: chosen.index,
                    html: isEs
                        ? `<div class="flex items-start gap-2">${iconSvg('warn', 'w-4 h-4 text-rose-600 shrink-0 mt-0.5')}<span><strong>Con esa salida llegarías ${lateMin} min tarde</strong> (llegada a las <strong>${esc(chosen.arrivalTimeText)}</strong> en lugar de antes de las ${esc(deadlineTxt)}). Línea: ${linesDesc || esc(cLinesPlain)}.</span></div>`
                        : `<div class="flex items-start gap-2">${iconSvg('warn', 'w-4 h-4 text-rose-600 shrink-0 mt-0.5')}<span><strong>Amb aquesta sortida arribaries ${lateMin} min tard</strong> (arribada a les <strong>${esc(chosen.arrivalTimeText)}</strong> en comptes d'abans de les ${esc(deadlineTxt)}). Línia: ${linesDesc || esc(cLinesPlain)}.</span></div>`,
                    plainText: plain
                };
            }
        }

        const plain = isEs
            ? `Próxima opción (${whenTag}): salida a las ${primary.departureTimeText}, llegada a las ${primary.arrivalTimeText} (${primary.durationText}). ${linesText}.`
            : `Propera opció (${whenTag}): sortida a les ${primary.departureTimeText}, arribada a les ${primary.arrivalTimeText} (${primary.durationText}). ${linesText}.`;

        return {
            status: 'ok',
            bestIdx: 0,
            html: isEs
                ? `<div class="flex items-start gap-2">${iconSvg('clock', 'w-4 h-4 text-emerald-600 shrink-0 mt-0.5')}<span><strong>Horario encontrado (${esc(whenTag)}):</strong> Sales a las <strong>${esc(primary.departureTimeText)}</strong> y llegas a las <strong>${esc(primary.arrivalTimeText)}</strong> (${esc(primary.durationText)}). ${linesDesc}</span></div>`
                : `<div class="flex items-start gap-2">${iconSvg('clock', 'w-4 h-4 text-emerald-600 shrink-0 mt-0.5')}<span><strong>Horari trobat (${esc(whenTag)}):</strong> Surts a les <strong>${esc(primary.departureTimeText)}</strong> i arribes a les <strong>${esc(primary.arrivalTimeText)}</strong> (${esc(primary.durationText)}). ${linesDesc}</span></div>`,
            plainText: plain
        };
    }

    function decodeStepLatLngPath(step) {
        if (!step) return [];
        if (Array.isArray(step.path) && step.path.length > 0) {
            return step.path.map((pt) => ({
                lat: typeof pt.lat === 'function' ? pt.lat() : pt.lat,
                lng: typeof pt.lng === 'function' ? pt.lng() : pt.lng
            }));
        }
        if (step.encodedPolyline && mapClasses?.encoding?.decodePath) {
            try {
                const decoded = mapClasses.encoding.decodePath(step.encodedPolyline);
                if (Array.isArray(decoded) && decoded.length > 0) return decoded;
            } catch (_) {}
        }
        const pts = [];
        if (step.departureStopLatLng) pts.push(step.departureStopLatLng);
        else if (step.startLatLng) pts.push(step.startLatLng);
        if (step.arrivalStopLatLng) pts.push(step.arrivalStopLatLng);
        else if (step.endLatLng) pts.push(step.endLatLng);
        return pts;
    }

    function openPhaseInfoWindowOnMap(route, phase, anchorLatLng) {
        if (!mapInstance || !mapClasses || !anchorLatLng) return;
        if (!sharedInfoWindow) sharedInfoWindow = new mapClasses.InfoWindow();
        const isEs = isMapsUiEs();

        if (phase.type === 'walk') {
            const firstInst = phase.subSteps?.[0]?.instruction ? `<div class="text-[11px] text-zinc-600">${esc(phase.subSteps[0].instruction)}</div>` : '';
            sharedInfoWindow.setContent(`
                <div class="p-1.5 text-xs text-zinc-900 space-y-1 max-w-[235px]">
                    <div class="font-extrabold text-slate-800 flex items-center gap-1.5">${iconSvg('walk', 'w-3.5 h-3.5')}<span>${isEs ? 'Tramo a pie' : 'Tram a peu'} · ${esc(phase.durationText)}${phase.distanceText ? ` (${esc(phase.distanceText)})` : ''}</span></div>
                    <div class="text-[11px] font-semibold text-zinc-700">${esc(phase.targetStopName)}</div>
                    ${firstInst}
                </div>
            `);
        } else {
            const st = phase.step;
            sharedInfoWindow.setContent(`
                <div class="p-1.5 text-xs text-zinc-900 space-y-1 max-w-[245px]">
                    <div class="font-extrabold flex items-center gap-1.5">
                        <span class="px-1.5 py-0.5 rounded text-[10px] font-black" style="background-color:${esc(st.lineColor || '#2563eb')};color:${esc(st.lineTextColor || '#ffffff')}">${esc(phase.badge.pillLabel)}</span>
                        ${st.headsign ? `<span class="text-[11px] text-zinc-600 truncate">→ ${esc(st.headsign)}</span>` : ''}
                    </div>
                    <div class="text-[11px]">${isEs ? 'Sube' : 'Puja'}: <strong>${esc(st.departureStopName)}</strong> (${esc(st.departureTimeText)})</div>
                    <div class="text-[11px] text-zinc-700">${isEs ? 'Baja' : 'Baixa'}: <strong>${esc(st.arrivalStopName)}</strong> (${esc(st.arrivalTimeText)})${st.stopCount ? ` · ${st.stopCount} ${isEs ? 'paradas' : 'parades'}` : ''}</div>
                </div>
            `);
        }
        sharedInfoWindow.setPosition(anchorLatLng);
        sharedInfoWindow.open({ map: mapInstance });
    }

    window.focusTransitPhaseOnMap = async function (routeIndex, phaseIdx) {
        const nextPhase = (transitState.selectedRouteIdx === routeIndex && transitState.selectedPhaseIdx === phaseIdx)
            ? null
            : phaseIdx;
        await window.drawTransitRouteOnMap(routeIndex, nextPhase);
    };

    window.toggleWalkSubSteps = function (ev, routeIdx, phaseIdx) {
        if (ev) {
            ev.stopPropagation();
            ev.preventDefault();
        }
        const key = `${routeIdx}_${phaseIdx}`;
        transitState.expandedWalkPhases[key] = !transitState.expandedWalkPhases[key];
        renderTransitResultsOnly();
    };

    window.setTransitRouteListFilter = async function (filterKind) {
        transitState.routeListFilter = ['BUS', 'RAIL'].includes(filterKind) ? filterKind : 'ALL';
        const visible = getFilteredTransitRoutes();
        if (visible.length > 0 && !visible.some((r) => r.index === transitState.selectedRouteIdx)) {
            await window.drawTransitRouteOnMap(visible[0].index, null);
        } else {
            renderTransitResultsOnly();
        }
    };

    window.drawTransitRouteOnMap = async function (routeIndex, focusPhaseIdx = null) {
        const route = transitState.routes[routeIndex];
        if (!route || !mapInstance || !mapClasses) return;

        transitState.selectedRouteIdx = routeIndex;
        transitState.selectedPhaseIdx = (typeof focusPhaseIdx === 'number') ? focusPhaseIdx : null;
        clearActiveRouteGraphics();
        if (sharedInfoWindow) {
            try { sharedInfoWindow.close(); } catch (_) {}
        }

        const phases = route.phases || groupRouteStepsForDisplay(route.steps);
        const fullBounds = new mapClasses.LatLngBounds();
        const focusBounds = new mapClasses.LatLngBounds();
        let hasFullPts = false;
        let hasFocusPts = false;
        let allRoutePts = [];
        let focusedPhaseObj = null;
        let focusedMidPoint = null;

        phases.forEach((phase) => {
            const isSelectedPhase = transitState.selectedPhaseIdx === null || transitState.selectedPhaseIdx === phase.phaseIdx;
            const isExplicitFocus = transitState.selectedPhaseIdx === phase.phaseIdx;
            if (isExplicitFocus) focusedPhaseObj = phase;

            const phasePts = [];
            (phase.polylineSteps || []).forEach((step) => {
                const path = decodeStepLatLngPath(step);
                if (!Array.isArray(path) || path.length === 0 || !window.google?.maps?.Polyline) return;

                hasFullPts = true;
                path.forEach((pt) => {
                    fullBounds.extend(pt);
                    allRoutePts.push(pt);
                    phasePts.push(pt);
                    if (isExplicitFocus) {
                        focusBounds.extend(pt);
                        hasFocusPts = true;
                    }
                });

                const isWalk = phase.type === 'walk';
                const lineColor = isWalk ? (isSelectedPhase ? '#334155' : '#94a3b8') : (phase.step?.lineColor || '#2563eb');

                if (isExplicitFocus) {
                    const halo = new window.google.maps.Polyline({
                        path,
                        map: mapInstance,
                        geodesic: true,
                        strokeColor: '#ffffff',
                        strokeOpacity: 0.92,
                        strokeWeight: isWalk ? 8 : 11,
                        zIndex: 8
                    });
                    activeRoutePolylines.push(halo);
                }

                const pline = new window.google.maps.Polyline({
                    path,
                    map: mapInstance,
                    geodesic: true,
                    clickable: true,
                    strokeColor: lineColor,
                    strokeOpacity: isWalk ? (isSelectedPhase ? 0.0 : 0.0) : (isSelectedPhase ? 0.96 : 0.28),
                    strokeWeight: isWalk ? (isSelectedPhase ? 4 : 3) : (isExplicitFocus ? 7 : (isSelectedPhase ? 6 : 4)),
                    zIndex: isExplicitFocus ? 10 : (isSelectedPhase ? 5 : 2),
                    icons: isWalk ? [{
                        icon: {
                            path: window.google.maps.SymbolPath.CIRCLE,
                            fillColor: isExplicitFocus ? '#2563eb' : (isSelectedPhase ? '#334155' : '#94a3b8'),
                            fillOpacity: isSelectedPhase ? 0.95 : 0.35,
                            strokeColor: '#ffffff',
                            strokeWeight: 1,
                            scale: isExplicitFocus ? 3.8 : 2.8
                        },
                        offset: '0',
                        repeat: '11px'
                    }] : undefined
                });
                pline.addListener('click', () => {
                    window.focusTransitPhaseOnMap(routeIndex, phase.phaseIdx);
                });
                activeRoutePolylines.push(pline);
            });

            if (isExplicitFocus && phasePts.length > 0) {
                focusedMidPoint = phase.type === 'transit' && phase.step?.departureStopLatLng
                    ? phase.step.departureStopLatLng
                    : phasePts[Math.floor(phasePts.length / 2)];
            }
        });

        // Origin & Destination markers
        const firstCoord = allRoutePts[0] || route.steps?.[0]?.departureStopLatLng || route.steps?.[0]?.startLatLng || null;
        const lastCoord = allRoutePts[allRoutePts.length - 1] || route.steps?.[route.steps.length - 1]?.arrivalStopLatLng || route.steps?.[route.steps.length - 1]?.endLatLng || null;

        if (firstCoord) {
            const originPin = document.createElement('div');
            originPin.className = 'px-2 py-1 rounded-full bg-emerald-600 text-white text-[10px] font-black shadow-md border-2 border-white flex items-center gap-1';
            originPin.innerHTML = `${iconSvg('pin', 'w-3 h-3 shrink-0')}<span>${esc(route.departureTimeText)}</span>`;
            const mOrigin = new mapClasses.AdvancedMarkerElement({
                map: mapInstance,
                position: firstCoord,
                title: `Sortida (${route.departureTimeText})`,
                content: originPin
            });
            activeRouteMarkers.push(mOrigin);
        }

        if (lastCoord) {
            const destPin = document.createElement('div');
            destPin.className = 'px-2 py-1 rounded-full bg-zinc-900 text-white text-[10px] font-black shadow-md border-2 border-white flex items-center gap-1';
            destPin.innerHTML = `${iconSvg('target', 'w-3 h-3 shrink-0')}<span>${esc(route.arrivalTimeText)}</span>`;
            const mDest = new mapClasses.AdvancedMarkerElement({
                map: mapInstance,
                position: lastCoord,
                title: `Arribada (${route.arrivalTimeText})`,
                content: destPin
            });
            activeRouteMarkers.push(mDest);
        }

        // Boarding & Alighting transit stop markers
        phases.forEach((phase) => {
            if (phase.type !== 'transit') return;
            const step = phase.step;
            const isActivePhase = transitState.selectedPhaseIdx === null || transitState.selectedPhaseIdx === phase.phaseIdx;

            if (step.departureStopLatLng) {
                const badge = document.createElement('div');
                badge.className = `px-2 py-1 rounded-xl text-[10px] font-extrabold shadow-md border-2 border-white flex items-center gap-1 cursor-pointer transition ${isActivePhase ? 'opacity-100' : 'opacity-50'}`;
                badge.style.backgroundColor = step.lineColor || '#2563eb';
                badge.style.color = step.lineTextColor || '#ffffff';
                badge.innerHTML = `${vehicleSvg(step.vehicleType, 'w-3 h-3 shrink-0')}<span>${esc(phase.badge.shortCode || phase.badge.kind)} · ${esc(step.departureTimeText)}</span>`;
                const m = new mapClasses.AdvancedMarkerElement({
                    map: mapInstance,
                    position: step.departureStopLatLng,
                    title: `${step.departureStopName} (${step.departureTimeText})`,
                    content: badge
                });
                m.addListener('click', () => {
                    window.focusTransitPhaseOnMap(routeIndex, phase.phaseIdx);
                });
                activeRouteMarkers.push(m);
            }

            if (step.arrivalStopLatLng) {
                const arrPin = document.createElement('div');
                arrPin.className = `px-2 py-0.5 rounded-lg bg-white text-zinc-900 text-[9.5px] font-extrabold shadow-md border-2 flex items-center gap-1 cursor-pointer ${isActivePhase ? 'opacity-100' : 'opacity-45'}`;
                arrPin.style.borderColor = step.lineColor || '#2563eb';
                arrPin.innerHTML = `<span class="w-2 h-2 rounded-full shrink-0" style="background:${esc(step.lineColor || '#2563eb')}"></span><span>${esc(step.arrivalTimeText)}</span>`;
                const mArr = new mapClasses.AdvancedMarkerElement({
                    map: mapInstance,
                    position: step.arrivalStopLatLng,
                    title: `${isMapsUiEs() ? 'Bajar en' : 'Baixar a'} ${step.arrivalStopName} (${step.arrivalTimeText})`,
                    content: arrPin
                });
                mArr.addListener('click', () => {
                    openPhaseInfoWindowOnMap(route, phase, step.arrivalStopLatLng);
                });
                activeRouteMarkers.push(mArr);
            }
        });

        if (transitState.selectedPhaseIdx !== null && hasFocusPts) {
            mapInstance.fitBounds(focusBounds, 72);
            if (window.google?.maps?.event) {
                window.google.maps.event.addListenerOnce(mapInstance, 'idle', () => {
                    if (mapInstance.getZoom() > 17) mapInstance.setZoom(17);
                });
            }
            if (focusedPhaseObj && focusedMidPoint) {
                openPhaseInfoWindowOnMap(route, focusedPhaseObj, focusedMidPoint);
            }
        } else if (route.viewport?.low && route.viewport?.high && !hasFullPts) {
            fullBounds.extend({ lat: route.viewport.low.latitude, lng: route.viewport.low.longitude });
            fullBounds.extend({ lat: route.viewport.high.latitude, lng: route.viewport.high.longitude });
            mapInstance.fitBounds(fullBounds, 54);
        } else if (hasFullPts) {
            mapInstance.fitBounds(fullBounds, 54);
        }

        renderTransitResultsOnly();
    };

    window.sendTransitResultToChat = function () {
        const sel = transitState.routes[transitState.selectedRouteIdx];
        if (!transitState.verdictPlainText && !sel) return;
        const chatInput = document.getElementById('chat-input');
        let extra = '';
        if (sel) {
            const stepsSummary = sel.steps.map((s) => s.isTransit
                ? `${vehicleTextLabel(s.vehicleType)} ${s.lineShort} (${s.departureStopName} ${s.departureTimeText} -> ${s.arrivalStopName} ${s.arrivalTimeText})`
                : `A peu ${s.durationText || ''}`
            ).join(' | ');
            extra = `Opcio ${sel.departureTimeText} -> ${sel.arrivalTimeText} (${sel.durationText})\nDetall del trajecte: ${stepsSummary}`;
        }
        const baseHeader = transitState.verdictPlainText
            ? `${transitState.verdictPlainText}\n${extra}`
            : extra;
        window.closeDailyMapsModal();
        if (chatInput) {
            chatInput.value = `${baseHeader}\nAjuda'm a organitzar-me l'alarma o recordatori per sortir puntual!`;
            chatInput.focus();
            if (typeof window.autoResizeChatInput === 'function') window.autoResizeChatInput(chatInput);
        }
        if (typeof window.showToast === 'function') {
            window.showToast('Horari copiat al xat d\'Ús Quotidià!', 'success');
        }
    };

    function buildAliatMapsAiHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        try {
            const token = localStorage.getItem('aliat_token') || '';
            const provider = localStorage.getItem('aliat_ai_provider') || '';
            const rawKey = localStorage.getItem('aliat_ai_key') || '';
            const aiKey = rawKey.includes('••••') ? '' : rawKey;
            const model = localStorage.getItem('aliat_ai_model') || '';
            const lang = (window.currentAppLang === 'es') ? 'es' : 'ca';
            if (token) headers['Authorization'] = `Bearer ${token}`;
            if (provider) headers['x-ai-provider'] = provider;
            if (aiKey) headers['x-ai-key'] = aiKey;
            if (model) headers['x-ai-model'] = model;
            headers['x-app-lang'] = lang;
        } catch (_) {}
        return headers;
    }

    function drawExplorePlacesOnMap(places, center) {
        if (!mapInstance || !mapClasses) return;
        clearActivePlaceMarkers();
        const bounds = new mapClasses.LatLngBounds();
        let hasPts = false;

        places.forEach((p, idx) => {
            if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
            hasPts = true;
            bounds.extend({ lat: p.lat, lng: p.lng });
            const pin = new mapClasses.PinElement({
                background: '#0d9488',
                borderColor: '#ffffff',
                glyphColor: '#ffffff',
                glyphText: String(idx + 1)
            });
            const marker = new mapClasses.AdvancedMarkerElement({
                map: mapInstance,
                position: { lat: p.lat, lng: p.lng },
                title: p.displayName || 'Lloc recomanat'
            });
            marker.append(pin);
            marker.addListener('click', () => {
                if (!sharedInfoWindow) sharedInfoWindow = new mapClasses.InfoWindow();
                const safeTitle = esc(p.displayName || 'Lloc');
                sharedInfoWindow.setContent(`
                    <div class="p-1.5 text-zinc-900 text-xs max-w-[240px] space-y-1">
                        <div class="font-extrabold">${idx + 1}. ${safeTitle}</div>
                        ${p.primaryType ? `<div class="text-[10.5px] font-bold text-teal-700">${esc(p.primaryType)}</div>` : ''}
                        <div class="text-[11px] text-zinc-600">${esc(p.formattedAddress || '')}</div>
                        ${p.rating ? `<div class="text-[11px] font-bold text-amber-600 inline-flex items-center gap-1">${iconSvg('star', 'w-3 h-3')}<span>${p.rating.toFixed(1)} (${p.userRatingCount || 0})</span></div>` : ''}
                        <div class="pt-1 flex flex-wrap gap-1">
                            <button type="button" onclick="window.setTransitDestAndOpen(${p.lat}, ${p.lng}, '${safeTitle}')" class="px-2 py-1 rounded-lg bg-blue-600 text-white font-bold text-[10px] cursor-pointer inline-flex items-center gap-1">${iconSvg('train', 'w-3 h-3')}<span>Bus / Tren</span></button>
                            <button type="button" onclick="window.traceDailyRouteTo(${p.lat}, ${p.lng}, '${safeTitle}', 'WALKING')" class="px-2 py-1 rounded-lg bg-emerald-600 text-white font-bold text-[10px] cursor-pointer inline-flex items-center gap-1">${iconSvg('walk', 'w-3 h-3')}<span>A peu</span></button>
                        </div>
                    </div>
                `);
                sharedInfoWindow.open({ anchor: marker, map: mapInstance });
            });
            activePlaceMarkers.push(marker);
        });

        if (hasPts) {
            if (places.length > 1) mapInstance.fitBounds(bounds, 52);
            else if (center) {
                mapInstance.panTo(center);
                mapInstance.setZoom(16);
            }
        }
    }

    window.sendExploreResultToChat = function () {
        if (!transitState.exploreAnswerText) return;
        const chatInput = document.getElementById('chat-input');
        const placesLine = (transitState.explorePlaces || []).slice(0, 5).map((p, i) => `${i + 1}. ${p.displayName} (${p.formattedAddress})`).join('\n');
        window.closeDailyMapsModal();
        if (chatInput) {
            chatInput.value = `Opcions trobades a AliatMaps (${transitState.exploreCenterLabel}):\n${transitState.exploreAnswerText}\n\n${placesLine ? `Llocs:\n${placesLine}\n` : ''}Ajuda'm a triar un pla!`;
            chatInput.focus();
            if (typeof window.autoResizeChatInput === 'function') window.autoResizeChatInput(chatInput);
        }
    };

    function serializeRouteContextForAi() {
        if (!Array.isArray(transitState.routes) || transitState.routes.length === 0) return null;
        return {
            originLabel: transitState.originLabel || transitState.originAddress || 'Origen',
            destLabel: transitState.destLabel || transitState.destAddress || 'Destinació',
            verdictPlainText: transitState.verdictPlainText || '',
            selectedRouteIdx: transitState.selectedRouteIdx || 0,
            routes: transitState.routes.slice(0, 4).map((r) => ({
                departureTimeText: r.departureTimeText,
                arrivalTimeText: r.arrivalTimeText,
                durationText: r.durationText,
                distanceText: r.distanceText,
                steps: (r.steps || []).map((s) => ({
                    isTransit: Boolean(s.isTransit),
                    vehicleType: s.vehicleType,
                    vehicleLabel: s.vehicleLabel,
                    lineShort: s.lineShort,
                    headsign: s.headsign,
                    departureStopName: s.departureStopName,
                    departureTimeText: s.departureTimeText,
                    arrivalStopName: s.arrivalStopName,
                    arrivalTimeText: s.arrivalTimeText,
                    stopCount: s.stopCount,
                    durationSec: s.durationSec,
                    durationText: s.durationText,
                    distanceText: s.distanceText,
                    instruction: s.instruction
                }))
            }))
        };
    }

    window.clearAliatMapsFollowupChat = function () {
        transitState.conversation = (transitState.conversation || []).filter(m => !m.isFollowup);
        renderTransitResultsOnly();
    };

    function getCurrentClockHHMM() {
        const d = new Date();
        return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    }

    window.askAliatMapsTransit = async function (forceDirectTransit = false) {
        const qInput = document.getElementById('daily-transit-question-input');
        const question = forceDirectTransit ? '' : (qInput ? qInput.value.trim() : '');
        if (!forceDirectTransit && !question) {
            if (typeof window.showToast === 'function') {
                window.showToast('Escriu una pregunta o canvia a "Horari manual" per cercar directament.', 'info');
            }
            if (qInput) qInput.focus();
            return;
        }
        if (!forceDirectTransit) transitState.question = question;
        transitState.needsPlaceSetup = null;
        transitState.setPlaceCandidates = [];
        transitState.loading = true;
        renderTransitResultsOnly();

        const originInput = document.getElementById('daily-transit-origin-input');
        const destInput = document.getElementById('daily-transit-dest-input');
        const timeInput = document.getElementById('daily-transit-time-input');
        const daySelect = document.getElementById('daily-transit-day-select');

        let originValText = forceDirectTransit
            ? (originInput ? originInput.value.trim() : transitState.originAddress)
            : '';
        let destValText = forceDirectTransit
            ? (destInput ? destInput.value.trim() : transitState.destAddress)
            : '';
        if (forceDirectTransit) {
            if (timeInput && timeInput.value) transitState.timeStr = timeInput.value;
            if (daySelect) transitState.dayOffset = parseInt(daySelect.value, 10) === 1 ? 1 : 0;
        }

        let parsedMeta = null;
        if (question && !forceDirectTransit) {
            try {
                const savedPlaces = loadSavedEverydayPlaces();
                const mapCenterObj = mapInstance ? { lat: mapInstance.getCenter().lat(), lng: mapInstance.getCenter().lng() } : null;
                const askRes = await fetch('/api/maps/ask-ai', {
                    method: 'POST',
                    headers: buildAliatMapsAiHeaders(),
                    body: JSON.stringify({
                        question,
                        savedPlaces,
                        currentCenter: mapCenterObj,
                        userLocation,
                        clientNowIso: new Date().toISOString(),
                        lastRouteContext: serializeRouteContextForAi(),
                        lastExploreContext: transitState.lastExploreContext,
                        conversationHistory: (transitState.conversation || []).slice(-8)
                    })
                });
                if (askRes.status === 429) {
                    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
                    transitState.loading = false;
                    renderTransitResultsOnly();
                    return;
                }
                if (askRes.ok) {
                    const askJson = await askRes.json();
                    if (askJson.intent === 'followup' || askJson.intent === 'chat') {
                        transitState.loading = false;
                        transitState.conversation = [
                            ...(transitState.conversation || []),
                            { role: 'user', text: question, isFollowup: true },
                            { role: 'assistant', text: askJson.answerText || '', isFollowup: true }
                        ];
                        transitState.question = '';
                        renderTransitTabContent();
                        return;
                    }
                    if (askJson.intent === 'set_place') {
                        const role = askJson.role || 'home';
                        const cands = Array.isArray(askJson.candidates) ? askJson.candidates : [];
                        transitState.loading = false;
                        transitState.aiMode = 'set_place';
                        transitState.setPlaceRole = role;
                        transitState.question = '';
                        if (cands.length === 1) {
                            const roleTitle = role === 'home' ? 'Casa' : (role === 'work' ? 'Feina' : (cands[0].displayName || 'Institut / Universitat'));
                            await window.setPlaceRoleFromCoords(role, cands[0].lat, cands[0].lng, roleTitle, cands[0].formattedAddress || cands[0].displayName);
                            return;
                        }
                        transitState.setPlaceCandidates = cands;
                        transitState.routes = [];
                        transitState.verdictHtml = cands.length === 0
                            ? `<div class="flex items-start gap-2">${iconSvg('warn', 'w-4 h-4 text-amber-600 shrink-0 mt-0.5')}<span>No s'ha trobat l'adreça "${esc(askJson.query || question)}". Prova d'escriure el carrer i ciutat o prem "Fixar Casa / Fixar Insti" a dalt.</span></div>`
                            : '';
                        renderTransitTabContent();
                        return;
                    }
                    if (askJson.intent === 'explore') {
                        transitState.loading = false;
                        transitState.aiMode = 'explore';
                        transitState.routes = [];
                        transitState.verdictHtml = '';
                        transitState.exploreAnswerText = askJson.answerText || '';
                        transitState.exploreCenterLabel = askJson.centerLabel || 'a prop teu';
                        transitState.explorePlaces = Array.isArray(askJson.places) ? askJson.places : [];
                        transitState.lastExploreContext = {
                            centerLabel: transitState.exploreCenterLabel,
                            answerText: transitState.exploreAnswerText,
                            places: transitState.explorePlaces
                        };
                        transitState.conversation = [
                            { role: 'user', text: question, isFollowup: false },
                            { role: 'assistant', text: transitState.exploreAnswerText, isFollowup: false }
                        ];
                        transitState.question = '';
                        clearActiveRouteGraphics();
                        renderTransitTabContent();
                        drawExplorePlacesOnMap(transitState.explorePlaces, askJson.center);
                        return;
                    }
                    parsedMeta = askJson?.parsed || null;
                }
            } catch (_) {}
        }

        transitState.exploreAnswerText = '';
        transitState.explorePlaces = [];
        transitState.lastExploreContext = null;
        transitState.aiMode = 'transit';

        // Apply parsed natural-language constraints cleanly without reusing stale coords/hours from older AI turns
        if (parsedMeta) {
            transitState.lang = parsedMeta.language || transitState.lang;
            transitState.dayOffset = parsedMeta.dayOffset === 1 ? 1 : 0;
            transitState.autoShiftedToTomorrow = Boolean(parsedMeta.autoShiftedToTomorrow);
            transitState.arrivalSlightlyBefore = Boolean(parsedMeta.arrivalSlightlyBefore);

            transitState.modeFilter = 'ALL';
            if (Array.isArray(parsedMeta.allowedModes) && parsedMeta.allowedModes.length > 0) {
                if (parsedMeta.allowedModes.includes('BUS') && parsedMeta.allowedModes.length === 1) transitState.modeFilter = 'BUS';
                else if (parsedMeta.allowedModes.includes('RAIL') || parsedMeta.allowedModes.includes('TRAIN')) transitState.modeFilter = 'RAIL';
                else if (parsedMeta.allowedModes.includes('SUBWAY')) transitState.modeFilter = 'SUBWAY';
            }

            if (typeof parsedMeta.departureHour === 'number') {
                transitState.timeMode = 'departure';
                transitState.timeStr = `${pad2(parsedMeta.departureHour)}:${pad2(parsedMeta.departureMinute || 0)}`;
            } else if (typeof parsedMeta.arrivalHour === 'number') {
                transitState.deadlineTimeStr = `${pad2(parsedMeta.arrivalHour)}:${pad2(parsedMeta.arrivalMinute || 0)}`;
                transitState.timeMode = 'arrival';
                transitState.timeStr = transitState.deadlineTimeStr;
            } else {
                transitState.timeMode = 'departure';
                transitState.timeStr = getCurrentClockHHMM();
                transitState.deadlineTimeStr = '';
            }
            if (typeof parsedMeta.arrivalHour === 'number' && typeof parsedMeta.departureHour === 'number') {
                transitState.deadlineTimeStr = `${pad2(parsedMeta.arrivalHour)}:${pad2(parsedMeta.arrivalMinute || 0)}`;
            } else if (typeof parsedMeta.arrivalHour !== 'number') {
                transitState.deadlineTimeStr = '';
            }

            // Reset stale origin/dest coords before resolving this AI request
            transitState.originCoords = null;
            transitState.originAddress = '';
            transitState.originMode = 'current';
            transitState.originLabel = 'Ubicació actual (GPS)';

            transitState.destCoords = null;
            transitState.destAddress = '';
            transitState.destMode = 'custom';
            transitState.destLabel = '';

            // Resolve Origin from saved places, hint, or current GPS
            if (parsedMeta.matchedOriginPlaceId) {
                const sp = loadSavedEverydayPlaces().find((x) => x.id === parsedMeta.matchedOriginPlaceId);
                if (sp) {
                    transitState.originMode = 'saved';
                    transitState.originCoords = { lat: sp.lat, lng: sp.lng };
                    transitState.originAddress = sp.address || sp.title;
                    transitState.originLabel = sp.title;
                    originValText = sp.address || sp.title;
                }
            } else if (parsedMeta.originType === 'saved_home') {
                const sp = findSavedPlaceByRole('home');
                if (sp) {
                    transitState.originMode = 'saved';
                    transitState.originCoords = { lat: sp.lat, lng: sp.lng };
                    transitState.originAddress = sp.address || sp.title;
                    transitState.originLabel = sp.title;
                    originValText = sp.address || sp.title;
                } else {
                    transitState.needsPlaceSetup = { missingHome: true, missingSchool: false };
                }
            } else if (parsedMeta.originType === 'saved_school') {
                const sp = findSavedPlaceByRole('school');
                if (sp) {
                    transitState.originMode = 'saved';
                    transitState.originCoords = { lat: sp.lat, lng: sp.lng };
                    transitState.originAddress = sp.address || sp.title;
                    transitState.originLabel = sp.title;
                    originValText = sp.address || sp.title;
                } else {
                    transitState.needsPlaceSetup = { missingHome: false, missingSchool: true };
                }
            } else if (parsedMeta.originHint && parsedMeta.originType === 'custom') {
                originValText = parsedMeta.originHint;
                transitState.originMode = 'custom';
                transitState.originLabel = parsedMeta.originHint;
            }

            // Resolve Destination from saved places or hint
            if (parsedMeta.matchedDestPlaceId) {
                const sp = loadSavedEverydayPlaces().find((x) => x.id === parsedMeta.matchedDestPlaceId);
                if (sp) {
                    transitState.destMode = 'saved';
                    transitState.destCoords = { lat: sp.lat, lng: sp.lng };
                    transitState.destAddress = sp.address || sp.title;
                    transitState.destLabel = sp.title;
                    destValText = sp.address || sp.title;
                }
            } else if (parsedMeta.destinationType === 'saved_school') {
                const sp = findSavedPlaceByRole('school');
                if (sp) {
                    transitState.destMode = 'saved';
                    transitState.destCoords = { lat: sp.lat, lng: sp.lng };
                    transitState.destAddress = sp.address || sp.title;
                    transitState.destLabel = sp.title;
                    destValText = sp.address || sp.title;
                } else {
                    transitState.needsPlaceSetup = {
                        ...(transitState.needsPlaceSetup || {}),
                        missingSchool: true
                    };
                }
            } else if (parsedMeta.destinationType === 'saved_home') {
                const sp = findSavedPlaceByRole('home');
                if (sp) {
                    transitState.destMode = 'saved';
                    transitState.destCoords = { lat: sp.lat, lng: sp.lng };
                    transitState.destAddress = sp.address || sp.title;
                    transitState.destLabel = sp.title;
                    destValText = sp.address || sp.title;
                } else {
                    transitState.needsPlaceSetup = {
                        ...(transitState.needsPlaceSetup || {}),
                        missingHome: true
                    };
                }
            } else if (parsedMeta.destinationHint) {
                destValText = parsedMeta.destinationHint;
                transitState.destMode = 'custom';
                transitState.destLabel = parsedMeta.destinationHint;
            }
        }

        if (transitState.needsPlaceSetup && ((!originValText && transitState.needsPlaceSetup.missingHome) || (!destValText && transitState.needsPlaceSetup.missingSchool))) {
            transitState.loading = false;
            transitState.routes = [];
            transitState.verdictHtml = '';
            if (transitState.needsPlaceSetup.missingHome) {
                transitState.homeEditorOpen = true;
                transitState.placeEditorRole = 'home';
            } else if (transitState.needsPlaceSetup.missingSchool) {
                transitState.placeEditorRole = 'school';
            }
            renderTransitTabContent();
            return;
        }

        // Resolve final Origin waypoint
        let originWp = null;
        let originLabel = 'Ubicació actual';
        if (transitState.originCoords && (!originValText || originValText === transitState.originAddress)) {
            originWp = { lat: transitState.originCoords.lat, lng: transitState.originCoords.lng };
            originLabel = transitState.originLabel || transitState.originAddress || 'Origen';
        } else if (originValText) {
            const resolvedOrigin = await resolveTextAddressOrPlace(originValText);
            if (resolvedOrigin && typeof resolvedOrigin.lat === 'number') {
                originWp = { lat: resolvedOrigin.lat, lng: resolvedOrigin.lng };
                originLabel = resolvedOrigin.label;
                transitState.originCoords = originWp;
                transitState.originAddress = resolvedOrigin.label;
                transitState.originLabel = resolvedOrigin.label;
            } else if (resolvedOrigin?.address) {
                originWp = { address: resolvedOrigin.address };
                originLabel = resolvedOrigin.address;
            }
        } else {
            const loc = userLocation || (await requestUserGeolocation(true));
            if (loc) {
                originWp = { lat: loc.lat, lng: loc.lng };
                originLabel = 'La teva ubicació actual';
                transitState.originCoords = loc;
            }
        }

        // Resolve final Destination waypoint
        let destWp = null;
        let destLabel = 'Destinació';
        if (transitState.destCoords && (!destValText || destValText === transitState.destAddress)) {
            destWp = { lat: transitState.destCoords.lat, lng: transitState.destCoords.lng };
            destLabel = transitState.destLabel || transitState.destAddress || 'Destinació';
        } else if (destValText) {
            const resolvedDest = await resolveTextAddressOrPlace(destValText);
            if (resolvedDest && typeof resolvedDest.lat === 'number') {
                destWp = { lat: resolvedDest.lat, lng: resolvedDest.lng };
                destLabel = resolvedDest.label;
                transitState.destCoords = destWp;
                transitState.destAddress = resolvedDest.label;
                transitState.destLabel = resolvedDest.label;
            } else if (resolvedDest?.address) {
                destWp = { address: resolvedDest.address };
                destLabel = resolvedDest.address;
            }
        }

        if (!originWp || !destWp) {
            transitState.loading = false;
            transitState.routes = [];
            transitState.verdictHtml = (!originWp
                ? `<div class="flex items-center gap-2">${iconSvg('pin', 'w-4 h-4 text-blue-600 shrink-0')}<span>Selecciona un <strong>origen</strong> (GPS o configura Casa teva a sota).</span></div>`
                : `<div class="flex items-center gap-2">${iconSvg('target', 'w-4 h-4 text-blue-600 shrink-0')}<span>Indica una <strong>destinació</strong> (escriu l'adreça, cerca-la a dalt o fes clic sobre el mapa).</span></div>`);
            renderTransitTabContent();
            return;
        }

        const targetDate = buildTargetDateFromTimeStr(transitState.timeStr || '08:00', transitState.dayOffset);
        let deadlineMs = null;
        if (transitState.deadlineTimeStr) {
            const dlDate = buildTargetDateFromTimeStr(transitState.deadlineTimeStr, transitState.dayOffset);
            deadlineMs = dlDate.getTime();
        }

        const allowedModes = transitState.modeFilter === 'ALL'
            ? undefined
            : (transitState.modeFilter === 'RAIL' ? ['RAIL', 'TRAIN'] : [transitState.modeFilter]);

        const lang = parsedMeta?.language || (window.currentAppLang === 'es' ? 'es' : 'ca');

        const [primaryRoutes, busOnlyRoutes] = await Promise.all([
            fetchTransitRoutesSmart({
                origin: originWp,
                destination: destWp,
                departureTime: transitState.timeMode === 'departure' ? targetDate.toISOString() : undefined,
                arrivalTime: transitState.timeMode === 'arrival' ? targetDate.toISOString() : undefined,
                allowedTravelModes: allowedModes,
                languageCode: lang
            }),
            (!allowedModes)
                ? fetchTransitRoutesSmart({
                    origin: originWp,
                    destination: destWp,
                    departureTime: transitState.timeMode === 'departure' ? targetDate.toISOString() : undefined,
                    arrivalTime: transitState.timeMode === 'arrival' ? targetDate.toISOString() : undefined,
                    allowedTravelModes: ['BUS'],
                    languageCode: lang
                }).catch(() => [])
                : Promise.resolve([])
        ]);

        const mergeUniqueTransitRoutes = (...groups) => {
            const seen = new Set();
            const merged = [];
            groups.forEach((grp) => {
                (Array.isArray(grp) ? grp : []).forEach((r) => {
                    const sig = r.signature || `${r.departureTimeText}|${r.arrivalTimeText}|${r.durationSec}`;
                    if (seen.has(sig)) return;
                    seen.add(sig);
                    merged.push({ ...r, index: merged.length });
                });
            });
            return merged.slice(0, 6);
        };

        let routes = mergeUniqueTransitRoutes(primaryRoutes, busOnlyRoutes);

        if ((!routes || routes.length === 0) && allowedModes) {
            routes = await fetchTransitRoutesSmart({
                origin: originWp,
                destination: destWp,
                departureTime: transitState.timeMode === 'departure' ? targetDate.toISOString() : undefined,
                arrivalTime: transitState.timeMode === 'arrival' ? targetDate.toISOString() : undefined,
                languageCode: lang
            });
        }

        if (deadlineMs && transitState.timeMode === 'departure' && routes.length > 0 && !routes.some((r) => r.arrivalMs <= deadlineMs)) {
            const idealArrMs = transitState.arrivalSlightlyBefore ? (deadlineMs - 5 * 60 * 1000) : deadlineMs;
            const earlierRoutes = await fetchTransitRoutesSmart({
                origin: originWp,
                destination: destWp,
                arrivalTime: new Date(idealArrMs).toISOString(),
                allowedTravelModes: allowedModes,
                languageCode: lang
            });
            if (earlierRoutes.length > 0) {
                routes = mergeUniqueTransitRoutes(
                    earlierRoutes.map((r) => ({ ...r, recommendedEarlier: true })),
                    routes
                );
            }
        }

        transitState.loading = false;
        transitState.routes = routes;
        transitState.selectedPhaseIdx = null;
        transitState.expandedWalkPhases = {};
        transitState.routeListFilter = 'ALL';
        const verdict = buildCommuteVerdict(routes, {
            deadlineMs,
            requestedDepMs: transitState.timeMode === 'departure' ? targetDate.getTime() : null,
            originLabel,
            destLabel,
            lang,
            dayOffset: transitState.dayOffset,
            autoShifted: transitState.autoShiftedToTomorrow,
            slightlyBefore: transitState.arrivalSlightlyBefore
        });
        transitState.verdictHtml = verdict.html;
        transitState.verdictPlainText = verdict.plainText;
        transitState.verdictStatus = verdict.status;
        transitState.selectedRouteIdx = typeof verdict.bestIdx === 'number' ? verdict.bestIdx : 0;
        transitState.originLabel = originLabel;
        transitState.destLabel = destLabel;
        transitState.conversation = routes.length > 0
            ? [
                ...(question ? [{ role: 'user', text: question, isFollowup: false }] : []),
                { role: 'assistant', text: verdict.plainText, isFollowup: false }
            ]
            : [];
        if (question) transitState.question = '';

        renderTransitTabContent();
        if (routes.length > 0) {
            await window.drawTransitRouteOnMap(transitState.selectedRouteIdx, null);
        }
    };

    function formatExploreMarkdownLight(text) {
        return esc(text || '')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
    }

    function renderFollowupThreadHtml() {
        const followups = (transitState.conversation || []).filter((m) => m && m.isFollowup);
        if (followups.length === 0) return '';
        const hasRoutes = Array.isArray(transitState.routes) && transitState.routes.length > 0;
        return `
            <div class="p-3 rounded-2xl bg-indigo-50/80 dark:bg-indigo-950/30 border border-indigo-200/90 dark:border-indigo-800/70 space-y-2">
                <div class="flex items-center justify-between gap-2">
                    <span class="text-[10.5px] font-extrabold uppercase tracking-wider text-indigo-700 dark:text-indigo-300 inline-flex items-center gap-1.5">${iconSvg('chat', 'w-3.5 h-3.5')}<span>${hasRoutes ? 'Comentaris sobre aquesta ruta' : 'Resposta d\'AliatMaps IA'}</span></span>
                    <button type="button" onclick="window.clearAliatMapsFollowupChat()" class="text-[10px] font-bold text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 cursor-pointer">Netejar</button>
                </div>
                <div class="space-y-1.5">
                    ${followups.map((m) => m.role === 'user'
                        ? `<div class="flex justify-end"><div class="px-2.5 py-1.5 rounded-xl bg-blue-600 text-white text-[11px] font-semibold max-w-[90%]">${esc(m.text)}</div></div>`
                        : `<div class="flex justify-start"><div class="px-3 py-2 rounded-xl bg-white dark:bg-zinc-900 border border-indigo-200/70 dark:border-indigo-800/60 text-xs text-zinc-900 dark:text-zinc-100 leading-relaxed max-w-[96%] shadow-2xs">${formatExploreMarkdownLight(m.text)}</div></div>`
                    ).join('')}
                </div>
            </div>
        `;
    }

    function renderTransitResultsOnly() {
        const resBox = document.getElementById('daily-transit-results-box');
        if (!resBox) return;

        const loadingBannerHtml = `
            <div class="p-3.5 rounded-2xl bg-blue-50/80 dark:bg-blue-950/35 border border-blue-200 dark:border-blue-800/70 text-center space-y-1">
                <div class="text-xs font-extrabold text-blue-700 dark:text-sky-300 inline-flex items-center justify-center gap-2">${iconSvg('spinner', 'w-4 h-4 animate-spin')}<span>Consultant AliatMaps IA i Google Maps en directe...</span></div>
                <div class="text-[11px] text-zinc-500 dark:text-zinc-400">Analitzant la consulta, parades i horaris reals.</div>
            </div>
        `;

        if (transitState.loading && (!transitState.routes || transitState.routes.length === 0) && (!transitState.explorePlaces || transitState.explorePlaces.length === 0)) {
            resBox.innerHTML = loadingBannerHtml;
            return;
        }

        if (transitState.aiMode === 'set_place' && transitState.setPlaceCandidates && transitState.setPlaceCandidates.length > 0) {
            const roleIcon = transitState.setPlaceRole === 'school' ? iconSvg('school', 'w-4 h-4') : iconSvg('home', 'w-4 h-4');
            const roleLabel = transitState.setPlaceRole === 'school' ? 'Institut / Universitat' : 'Casa';
            resBox.innerHTML = `
                <div class="p-3.5 rounded-2xl bg-emerald-50/90 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 space-y-2">
                    <div class="text-xs font-extrabold text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">${roleIcon}<span>Tria l'adreça exacta per desar com a ${roleLabel}:</span></div>
                    <div class="space-y-1.5">
                        ${transitState.setPlaceCandidates.map((c, idx) => `
                            <button type="button" onclick="window.pickAiSetPlaceCandidate(${idx})" class="w-full p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-emerald-200 dark:border-emerald-800 hover:border-emerald-500 text-left cursor-pointer transition">
                                <div class="text-xs font-extrabold text-zinc-900 dark:text-white">${esc(c.displayName)}</div>
                                <div class="text-[10.5px] text-zinc-500 dark:text-zinc-400">${esc(c.formattedAddress)}</div>
                            </button>
                        `).join('')}
                    </div>
                </div>
            `;
            return;
        }

        if (transitState.aiMode === 'explore' && (transitState.exploreAnswerText || (transitState.explorePlaces && transitState.explorePlaces.length > 0))) {
            const cardsHtml = (transitState.explorePlaces || []).map((p, idx) => {
                const safeTitle = esc(p.displayName || 'Lloc');
                const openBadge = p.openNow === true
                    ? `<span class="px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[9.5px] font-extrabold">Obert ara</span>`
                    : (p.openNow === false ? `<span class="px-1.5 py-0.5 rounded-md bg-rose-500/15 text-rose-600 dark:text-rose-400 text-[9.5px] font-extrabold">Tancat ara</span>` : '');
                return `
                    <div class="p-2.5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 hover:border-teal-400 transition space-y-1.5 shadow-2xs">
                        <div class="flex items-start justify-between gap-2 cursor-pointer" onclick="window.focusDailyMapPoint(${p.lat}, ${p.lng})">
                            <div class="min-w-0 flex-1">
                                <div class="text-xs font-extrabold text-zinc-900 dark:text-white truncate">${idx + 1}. ${safeTitle}</div>
                                <div class="text-[10.5px] text-zinc-500 dark:text-zinc-400 truncate">${esc(p.formattedAddress || '')}</div>
                            </div>
                            <div class="flex items-center gap-1 shrink-0">
                                ${openBadge}
                                ${p.rating ? `<span class="text-[10.5px] font-bold text-amber-600 dark:text-amber-400 tabular-nums inline-flex items-center gap-0.5">${iconSvg('star', 'w-3 h-3')}<span>${p.rating.toFixed(1)}</span></span>` : ''}
                            </div>
                        </div>
                        <div class="flex flex-wrap items-center gap-1.5 pt-0.5">
                            ${p.primaryType ? `<span class="px-1.5 py-0.5 rounded-md bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 text-[9.5px] font-bold">${esc(p.primaryType)}</span>` : ''}
                            <button type="button" onclick="window.setTransitDestAndOpen(${p.lat}, ${p.lng}, '${safeTitle}')" class="px-2 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold cursor-pointer inline-flex items-center gap-1">${iconSvg('train', 'w-3 h-3')}<span>Bus / Tren</span></button>
                            <button type="button" onclick="window.traceDailyRouteTo(${p.lat}, ${p.lng}, '${safeTitle}', 'WALKING')" class="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold cursor-pointer inline-flex items-center gap-1">${iconSvg('walk', 'w-3 h-3')}<span>Ruta a peu</span></button>
                            ${p.googleMapsURI ? `<a href="${esc(p.googleMapsURI)}" target="_blank" rel="noopener noreferrer" class="ml-auto text-[10px] font-bold text-blue-600 dark:text-sky-400 hover:underline inline-flex items-center gap-0.5"><span>Fitxa Maps</span>${iconSvg('external', 'w-3 h-3')}</a>` : ''}
                        </div>
                    </div>
                `;
            }).join('');

            resBox.innerHTML = `
                ${transitState.loading ? loadingBannerHtml : ''}
                <div class="p-3.5 rounded-2xl bg-teal-50/90 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800/80 space-y-2 shadow-2xs">
                    <div class="flex items-center justify-between gap-2">
                        <span class="text-[10.5px] font-extrabold uppercase tracking-wider text-teal-700 dark:text-teal-300 inline-flex items-center gap-1.5">${iconSvg('spark', 'w-3.5 h-3.5')}<span>AliatMaps IA · ${esc(transitState.exploreCenterLabel || 'A prop teu')}</span></span>
                        <button type="button" onclick="window.sendExploreResultToChat()" class="px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 text-white dark:text-zinc-900 text-[10px] font-extrabold cursor-pointer inline-flex items-center gap-1">${iconSvg('chat', 'w-3 h-3')}<span>Enviar al xat</span></button>
                    </div>
                    <div class="text-xs text-zinc-900 dark:text-zinc-100 leading-relaxed">${formatExploreMarkdownLight(transitState.exploreAnswerText)}</div>
                </div>
                ${renderFollowupThreadHtml()}
                <div class="space-y-2">${cardsHtml}</div>
            `;
            return;
        }

        if (transitState.needsPlaceSetup && (transitState.needsPlaceSetup.missingHome || transitState.needsPlaceSetup.missingSchool)) {
            resBox.innerHTML = `
                <div class="p-3.5 rounded-2xl bg-amber-50/90 dark:bg-amber-950/30 border border-amber-300/80 dark:border-amber-800/70 space-y-2.5">
                    <div class="text-xs font-extrabold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">${iconSvg('pin', 'w-4 h-4')}<span>Faltava saber on és Casa teva o el teu Institut</span></div>
                    <p class="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
                        Configura-ho en un clic escrivint l'adreça, usant el teu GPS o clicant sobre el mapa:
                    </p>
                    <div class="flex flex-wrap gap-1.5">
                        ${transitState.needsPlaceSetup.missingHome ? `<button type="button" onclick="window.startMapPickMode('home')" class="px-2.5 py-1.5 rounded-xl bg-emerald-600 text-white text-[11px] font-bold cursor-pointer inline-flex items-center gap-1.5">${iconSvg('map', 'w-3.5 h-3.5')}<span>Marcar Casa al mapa</span></button><button type="button" onclick="window.setHomeFromCurrentGps()" class="px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-amber-300 dark:border-amber-700 text-[11px] font-bold cursor-pointer inline-flex items-center gap-1.5">${iconSvg('gps', 'w-3.5 h-3.5')}<span>GPS actual és Casa</span></button>` : ''}
                        ${transitState.needsPlaceSetup.missingSchool ? `<button type="button" onclick="window.startMapPickMode('school')" class="px-2.5 py-1.5 rounded-xl bg-indigo-600 text-white text-[11px] font-bold cursor-pointer inline-flex items-center gap-1.5">${iconSvg('school', 'w-3.5 h-3.5')}<span>Marcar Insti al mapa</span></button>` : ''}
                    </div>
                </div>
            `;
            return;
        }

        if (!transitState.verdictHtml && (!transitState.routes || transitState.routes.length === 0)) {
            const followupHtml = renderFollowupThreadHtml();
            if (followupHtml) {
                resBox.innerHTML = `${transitState.loading ? loadingBannerHtml : ''}${followupHtml}`;
                return;
            }
            resBox.innerHTML = `
                <div class="grid grid-cols-3 gap-1.5">
                    <div class="p-2.5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/60 flex flex-col items-center text-center gap-1">
                        <span class="w-7 h-7 rounded-xl bg-emerald-600 text-white flex items-center justify-center">${iconSvg('home', 'w-3.5 h-3.5')}</span>
                        <span class="text-[10.5px] font-extrabold text-zinc-900 dark:text-white">1. Casa / Insti</span>
                    </div>
                    <div class="p-2.5 rounded-2xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-800/60 flex flex-col items-center text-center gap-1">
                        <span class="w-7 h-7 rounded-xl bg-blue-600 text-white flex items-center justify-center">${iconSvg('spark', 'w-3.5 h-3.5')}</span>
                        <span class="text-[10.5px] font-extrabold text-zinc-900 dark:text-white">2. Tria o IA</span>
                    </div>
                    <div class="p-2.5 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200/80 dark:border-indigo-800/60 flex flex-col items-center text-center gap-1">
                        <span class="w-7 h-7 rounded-xl bg-indigo-600 text-white flex items-center justify-center">${iconSvg('map', 'w-3.5 h-3.5')}</span>
                        <span class="text-[10.5px] font-extrabold text-zinc-900 dark:text-white">3. Veure mapa</span>
                    </div>
                </div>
            `;
            return;
        }

        const statusClasses = transitState.verdictStatus === 'late'
            ? 'bg-rose-50/90 dark:bg-rose-950/35 border-rose-200 dark:border-rose-800/80 text-rose-950 dark:text-rose-100'
            : (transitState.verdictStatus === 'tight'
                ? 'bg-amber-50/90 dark:bg-amber-950/35 border-amber-200 dark:border-amber-800/80 text-amber-950 dark:text-amber-100'
                : 'bg-emerald-50/90 dark:bg-emerald-950/35 border-emerald-200 dark:border-emerald-800/80 text-emerald-950 dark:text-emerald-100');

        const verdictCardHtml = transitState.verdictHtml ? `
            <div class="p-3 rounded-2xl border ${statusClasses} space-y-2 shadow-2xs">
                <div class="text-xs">${transitState.verdictHtml}</div>
                ${transitState.verdictPlainText ? `
                <div class="flex items-center justify-end pt-1">
                    <button type="button" onclick="window.sendTransitResultToChat()" class="px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 text-white dark:text-zinc-900 text-[10.5px] font-extrabold cursor-pointer inline-flex items-center gap-1">
                        ${iconSvg('chat', 'w-3 h-3')}<span>Al xat</span>
                    </button>
                </div>` : ''}
            </div>
        ` : '';

        const allRoutes = transitState.routes || [];
        const getFilteredRoutesLocal = () => {
            if (transitState.routeListFilter === 'BUS') return allRoutes.filter((r) => r.hasBus);
            if (transitState.routeListFilter === 'RAIL') return allRoutes.filter((r) => r.hasRail);
            return allRoutes;
        };
        const visibleRoutes = getFilteredRoutesLocal();
        const busCount = allRoutes.filter((r) => r.hasBus).length;
        const railCount = allRoutes.filter((r) => r.hasRail).length;
        const isEs = isMapsUiEs();

        const routeFilterBarHtml = allRoutes.length > 1 ? `
            <div class="flex items-center justify-between gap-2 px-0.5 pt-0.5">
                <span class="text-[10.5px] font-extrabold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    ${isEs ? 'Opciones' : 'Opcions'} (${visibleRoutes.length})
                </span>
                ${(busCount > 0 || railCount > 0) ? `
                <div class="flex items-center gap-1">
                    <button type="button" onclick="window.setTransitRouteListFilter('ALL')" class="px-2 py-1 rounded-lg text-[10px] font-bold cursor-pointer border ${transitState.routeListFilter === 'ALL' ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-white dark:text-zinc-900 dark:border-white' : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700'}">${isEs ? 'Todo' : 'Tot'} (${allRoutes.length})</button>
                    ${busCount > 0 ? `<button type="button" onclick="window.setTransitRouteListFilter('BUS')" class="px-2 py-1 rounded-lg text-[10px] font-bold cursor-pointer border inline-flex items-center gap-1 ${transitState.routeListFilter === 'BUS' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700'}">${iconSvg('bus', 'w-3 h-3')}<span>${busCount}</span></button>` : ''}
                    ${railCount > 0 ? `<button type="button" onclick="window.setTransitRouteListFilter('RAIL')" class="px-2 py-1 rounded-lg text-[10px] font-bold cursor-pointer border inline-flex items-center gap-1 ${transitState.routeListFilter === 'RAIL' ? 'bg-sky-600 text-white border-sky-600' : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700'}">${iconSvg('train', 'w-3 h-3')}<span>${railCount}</span></button>` : ''}
                </div>` : ''}
            </div>
        ` : '';

        const routesHtml = visibleRoutes.map((route) => {
            const idx = route.index;
            const isSelected = idx === transitState.selectedRouteIdx;
            const phases = route.phases || groupRouteStepsForDisplay(route.steps);
            const totalPhaseSec = Math.max(1, phases.reduce((acc, p) => acc + Math.max(30, p.durationSec || 60), 0));

            // Proportional visual journey bar (color segments for walk vs transit)
            const segmentBarHtml = `
                <div class="flex h-2 w-full rounded-full overflow-hidden gap-0.5 bg-zinc-100 dark:bg-zinc-800">
                    ${phases.map((p) => {
                        const wPct = Math.max(8, Math.round((Math.max(30, p.durationSec || 60) / totalPhaseSec) * 100));
                        const bg = p.type === 'walk' ? '' : `background-color:${esc(p.step.lineColor || '#2563eb')}`;
                        const cls = p.type === 'walk' ? 'bg-zinc-300 dark:bg-zinc-700' : '';
                        return `<div class="h-full rounded-full ${cls}" style="width:${wPct}%;${bg}"></div>`;
                    }).join('')}
                </div>
            `;

            // Clean grouped icons/tags: ONE per walk block and ONE compact per transit line
            const badgesHtml = phases.map((p) => {
                if (p.type === 'walk') {
                    return `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-[10.5px] font-bold">${iconSvg('walk', 'w-3 h-3')}<span>${esc(p.durationText)}</span></span>`;
                }
                return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10.5px] font-black shadow-2xs" style="background-color:${esc(p.step.lineColor || '#2563eb')};color:${esc(p.step.lineTextColor || '#ffffff')}">${vehicleSvg(p.step.vehicleType, 'w-3 h-3')}<span>${esc(p.badge.pillLabel)}</span></span>`;
            }).join('<span class="text-zinc-400 text-[10px] mx-0.5">›</span>');

            const firstTransit = route.transitPhases?.[0];
            const quickMetaLine = firstTransit
                ? `${firstTransit.step.departureStopName ? `${esc(firstTransit.step.departureStopName)} (${esc(firstTransit.step.departureTimeText)}) · ` : ''}${route.walkMin > 0 ? `${route.walkMin}m peu · ` : ''}${route.transfers === 0 ? (isEs ? 'Directo' : 'Directe') : `${route.transfers} ${route.transfers === 1 ? 'transb.' : 'transb.'}`}`
                : `${route.walkMin > 0 ? `${route.walkMin}m peu` : ''}`;

            const gmapsOriginParam = transitState.originCoords
                ? `${transitState.originCoords.lat},${transitState.originCoords.lng}`
                : (userLocation ? `${userLocation.lat},${userLocation.lng}` : (transitState.originAddress || ''));
            const gmapsDestParam = transitState.destCoords
                ? `${transitState.destCoords.lat},${transitState.destCoords.lng}`
                : (transitState.destAddress || transitState.destLabel || '');
            const gmapsTransitUrl = gmapsDestParam
                ? `https://www.google.com/maps/dir/?api=1&${gmapsOriginParam ? `origin=${encodeURIComponent(gmapsOriginParam)}&` : ''}destination=${encodeURIComponent(gmapsDestParam)}&travelmode=transit`
                : '';

            const timelineHtml = isSelected ? `
                <div class="mt-3 pt-3 border-t border-zinc-200/80 dark:border-zinc-800 space-y-2.5" onclick="event.stopPropagation()">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <span class="text-[10.5px] font-extrabold text-zinc-500 dark:text-zinc-400 inline-flex items-center gap-1">
                            ${iconSvg('map', 'w-3.5 h-3.5 text-blue-600 dark:text-sky-400')}
                            <span>${isEs ? 'Clica cualquier tramo' : 'Clica qualsevol tram'}</span>
                        </span>
                        <div class="flex items-center gap-1.5 shrink-0">
                            ${transitState.selectedPhaseIdx !== null
                                ? `<button type="button" onclick="window.drawTransitRouteOnMap(${idx}, null)" class="px-2 py-0.5 rounded-lg bg-blue-50 dark:bg-sky-950/60 text-blue-700 dark:text-sky-300 text-[10px] font-extrabold cursor-pointer border border-blue-200 dark:border-sky-800">${isEs ? 'Ver ruta' : 'Veure ruta'}</button>`
                                : ''}
                            <button type="button" onclick="window.sendTransitResultToChat()" class="px-2 py-0.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 text-[10px] font-extrabold cursor-pointer inline-flex items-center gap-1">
                                ${iconSvg('chat', 'w-3 h-3')}<span>${isEs ? 'Al chat' : 'Al xat'}</span>
                            </button>
                            ${gmapsTransitUrl ? `
                            <a href="${gmapsTransitUrl}" target="_blank" rel="noopener noreferrer" class="px-2 py-0.5 rounded-lg bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 text-blue-600 dark:text-sky-400 border border-zinc-200 dark:border-zinc-700 text-[10px] font-extrabold inline-flex items-center gap-1">
                                ${iconSvg('external', 'w-3 h-3')}<span>Maps</span>
                            </a>` : ''}
                        </div>
                    </div>

                    <div class="space-y-2">
                        ${phases.map((p, pIdx) => {
                            const isFocused = transitState.selectedPhaseIdx === p.phaseIdx;
                            const isLastPhase = pIdx === phases.length - 1;

                            if (p.type === 'walk') {
                                const expandKey = `${idx}_${p.phaseIdx}`;
                                const isExpanded = Boolean(transitState.expandedWalkPhases[expandKey]);
                                const subCount = (p.subSteps || []).length;
                                return `
                                    <div onclick="window.focusTransitPhaseOnMap(${idx}, ${p.phaseIdx})" class="group relative p-2.5 rounded-xl border transition cursor-pointer ${isFocused ? 'bg-blue-50/80 dark:bg-sky-950/35 border-blue-500 ring-2 ring-blue-500/20' : 'bg-zinc-50/90 dark:bg-zinc-950/80 border-zinc-200/80 dark:border-zinc-800 hover:border-blue-400'}">
                                        <div class="flex items-start gap-2.5">
                                            <div class="flex flex-col items-center shrink-0 pt-0.5">
                                                <span class="w-6 h-6 rounded-full ${isFocused ? 'bg-blue-600 text-white' : 'bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200'} flex items-center justify-center">${iconSvg('walk', 'w-3.5 h-3.5')}</span>
                                                ${!isLastPhase ? `<span class="w-0.5 h-3 border-l-2 border-dotted border-zinc-300 dark:border-zinc-700 mt-1"></span>` : ''}
                                            </div>
                                            <div class="min-w-0 flex-1 space-y-1">
                                                <div class="flex items-center justify-between gap-2">
                                                    <div class="text-xs font-extrabold text-zinc-900 dark:text-white">
                                                        ${isEs ? 'Camina' : 'Camina'} ${esc(p.durationText)} ${p.distanceText ? `<span class="font-semibold text-zinc-500 dark:text-zinc-400">(${esc(p.distanceText)})</span>` : ''}
                                                    </div>
                                                    <span class="text-[9.5px] font-bold px-1.5 py-0.5 rounded-md shrink-0 ${isFocused ? 'bg-blue-600 text-white' : 'bg-zinc-200/70 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 group-hover:bg-blue-100 group-hover:text-blue-700'}">
                                                        ${isFocused ? (isEs ? 'En el mapa' : 'Al mapa') : (isEs ? 'Ver recorrido' : 'Veure tram')}
                                                    </span>
                                                </div>
                                                <div class="text-[11px] text-zinc-600 dark:text-zinc-300 font-medium">${esc(p.targetStopName)}</div>
                                                ${subCount > 0 ? `
                                                    <button type="button" onclick="window.toggleWalkSubSteps(event, ${idx}, ${p.phaseIdx})" class="text-[10.5px] font-bold text-blue-600 dark:text-sky-400 hover:underline cursor-pointer inline-flex items-center gap-1 pt-0.5">
                                                        <span>${isExpanded ? (isEs ? 'Ocultar indicaciones' : 'Amagar indicacions') : (isEs ? `Ver ${subCount} indicaciones paso a paso` : `Veure ${subCount} indicacions pas a pas`)}</span>
                                                    </button>
                                                    ${isExpanded ? `
                                                        <div class="mt-1.5 pl-2.5 border-l-2 border-zinc-200 dark:border-zinc-700 space-y-1">
                                                            ${p.subSteps.map((sub) => {
                                                                const subDur = sub.durationText || (sub.durationSec ? `${Math.max(1, Math.round(sub.durationSec / 60))} min` : '1 min');
                                                                const subDist = sub.distanceText || formatMetersCompact(approxStepDistanceMeters(sub));
                                                                return `
                                                                <div class="text-[10.5px] text-zinc-600 dark:text-zinc-400 leading-snug">
                                                                    <span class="font-bold text-zinc-800 dark:text-zinc-200">${esc(subDur)}</span>
                                                                    ${subDist ? `(${esc(subDist)})` : ''}
                                                                    ${sub.instruction ? `· ${esc(sub.instruction)}` : ''}
                                                                </div>
                                                            `;
                                                            }).join('')}
                                                        </div>
                                                    ` : ''}
                                                ` : ''}
                                            </div>
                                        </div>
                                    </div>
                                `;
                            }

                            const st = p.step;
                            return `
                                <div onclick="window.focusTransitPhaseOnMap(${idx}, ${p.phaseIdx})" class="group relative p-3 rounded-xl border transition cursor-pointer ${isFocused ? 'bg-blue-50/85 dark:bg-sky-950/40 border-blue-500 ring-2 ring-blue-500/25' : 'bg-white dark:bg-zinc-950 border-zinc-200/90 dark:border-zinc-800 hover:border-blue-400'}">
                                    <div class="flex items-start gap-2.5">
                                        <div class="flex flex-col items-center shrink-0 pt-0.5">
                                            <span class="w-6 h-6 rounded-lg flex items-center justify-center shadow-2xs" style="background-color:${esc(st.lineColor || '#2563eb')};color:${esc(st.lineTextColor || '#ffffff')}">${vehicleSvg(st.vehicleType, 'w-3.5 h-3.5')}</span>
                                        </div>
                                        <div class="min-w-0 flex-1 space-y-1.5">
                                            <div class="flex flex-wrap items-center justify-between gap-1.5">
                                                <div class="flex flex-wrap items-center gap-1.5 min-w-0">
                                                    <span class="px-2 py-0.5 rounded-md text-[11px] font-black shadow-2xs" style="background-color:${esc(st.lineColor || '#2563eb')};color:${esc(st.lineTextColor || '#ffffff')}">${esc(p.badge.pillLabel)}</span>
                                                    ${st.headsign ? `<span class="text-[11px] font-bold text-zinc-700 dark:text-zinc-200 truncate">→ ${esc(st.headsign)}</span>` : ''}
                                                </div>
                                                <span class="text-[9.5px] font-bold px-1.5 py-0.5 rounded-md shrink-0 ${isFocused ? 'bg-blue-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 group-hover:bg-blue-100 group-hover:text-blue-700'}">
                                                    ${isFocused ? (isEs ? 'En el mapa' : 'Al mapa') : (isEs ? 'Ver recorrido' : 'Veure per on passa')}
                                                </span>
                                            </div>
                                            ${p.badge.extraLineTitle ? `<div class="text-[10.5px] font-semibold text-zinc-500 dark:text-zinc-400">${esc(p.badge.extraLineTitle)}</div>` : ''}

                                            <div class="relative pl-3 space-y-1.5 pt-0.5 before:content-[''] before:absolute before:left-[3px] before:top-2 before:bottom-2 before:w-0.5 before:bg-zinc-300 dark:before:bg-zinc-700">
                                                <div class="relative flex items-baseline justify-between gap-2 text-[11.5px] tabular-nums">
                                                    <span class="flex items-center gap-1.5 min-w-0">
                                                        <span class="w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white dark:border-zinc-900 -ml-[13px] shrink-0"></span>
                                                        <span class="text-zinc-900 dark:text-white font-extrabold shrink-0">${esc(st.departureTimeText)}</span>
                                                        <span class="text-zinc-700 dark:text-zinc-200 font-semibold truncate">${isEs ? 'Sube en' : 'Puja a'} <strong>${esc(st.departureStopName)}</strong></span>
                                                    </span>
                                                </div>
                                                <div class="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 pl-1">
                                                    ${st.stopCount ? `${st.stopCount} ${isEs ? 'paradas' : 'parades'} · ` : ''}${esc(p.durationText)}
                                                </div>
                                                <div class="relative flex items-baseline justify-between gap-2 text-[11.5px] tabular-nums">
                                                    <span class="flex items-center gap-1.5 min-w-0">
                                                        <span class="w-2.5 h-2.5 rounded-full border-2 border-white dark:border-zinc-900 -ml-[13px] shrink-0" style="background-color:${esc(st.lineColor || '#2563eb')}"></span>
                                                        <span class="text-zinc-900 dark:text-white font-extrabold shrink-0">${esc(st.arrivalTimeText)}</span>
                                                        <span class="text-zinc-700 dark:text-zinc-200 font-semibold truncate">${isEs ? 'Baja en' : 'Baixa a'} <strong>${esc(st.arrivalStopName)}</strong></span>
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            ` : '';

            return `
                <div onclick="window.drawTransitRouteOnMap(${idx}, null)" class="p-3 rounded-2xl bg-white dark:bg-zinc-900 border ${isSelected ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-zinc-200/90 dark:border-zinc-800 hover:border-blue-400'} transition cursor-pointer space-y-2 shadow-2xs">
                    <div class="flex items-center justify-between gap-2">
                        <div class="text-xs sm:text-sm font-black text-zinc-900 dark:text-white tabular-nums inline-flex items-center gap-1.5">
                            <span>${esc(route.departureTimeText)}</span>
                            ${iconSvg('arrowRight', 'w-3.5 h-3.5 text-zinc-400')}
                            <span>${esc(route.arrivalTimeText)}</span>
                        </div>
                        <div class="flex items-center gap-2 text-[10.5px] font-extrabold tabular-nums">
                            ${route.recommendedEarlier ? `<span class="text-emerald-600 dark:text-emerald-400">${isEs ? 'Óptima' : 'Òptima'}</span>` : ''}
                            ${isSelected ? `<span class="text-blue-600 dark:text-sky-400">${isEs ? 'Activa' : 'Activa'}</span>` : ''}
                            <span class="px-2 py-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200">${esc(route.durationText)}</span>
                        </div>
                    </div>
                    ${segmentBarHtml}
                    <div class="flex flex-wrap items-center gap-1">${badgesHtml}</div>
                    ${quickMetaLine ? `<div class="text-[10.5px] text-zinc-500 dark:text-zinc-400 truncate">${quickMetaLine}</div>` : ''}
                    ${timelineHtml}
                </div>
            `;
        }).join('');

        resBox.innerHTML = `${transitState.loading ? loadingBannerHtml : ''}${verdictCardHtml}${renderFollowupThreadHtml()}<div class="space-y-2">${routeFilterBarHtml}${routesHtml}</div>`;
    }

    function getFilteredTransitRoutes() {
        const all = transitState.routes || [];
        if (transitState.routeListFilter === 'BUS') return all.filter((r) => r.hasBus);
        if (transitState.routeListFilter === 'RAIL') return all.filter((r) => r.hasRail);
        return all;
    }

    window.updateTransitOriginInput = function (val) {
        transitState.originCoords = null;
        transitState.originMode = 'custom';
        transitState.originAddress = String(val || '');
    };
    window.updateTransitDestInput = function (val) {
        transitState.destCoords = null;
        transitState.destMode = 'custom';
        transitState.destAddress = String(val || '');
    };
    window.updateTransitTimeInput = function (val) {
        transitState.timeStr = String(val || '08:00');
    };
    window.updateTransitDayOffset = function (val) {
        transitState.dayOffset = parseInt(val, 10) === 1 ? 1 : 0;
    };
    window.swapAliatTransitPoints = function () {
        const tmpMode = transitState.originMode;
        const tmpAddr = transitState.originAddress;
        const tmpCoords = transitState.originCoords;
        const tmpLabel = transitState.originLabel;

        transitState.originMode = transitState.destMode === 'saved' ? 'saved' : 'custom';
        transitState.originAddress = transitState.destAddress || '';
        transitState.originCoords = transitState.destCoords || null;
        transitState.originLabel = transitState.destLabel || transitState.destAddress || 'Origen';

        transitState.destMode = tmpMode === 'saved' ? 'saved' : 'custom';
        transitState.destAddress = tmpAddr || '';
        transitState.destCoords = tmpCoords || null;
        transitState.destLabel = tmpLabel || tmpAddr || 'Destinació';
        renderTransitTabContent();
    };
    window.setTransitInputMode = function (mode) {
        transitState.inputMode = mode === 'manual' ? 'manual' : 'ai';
        renderTransitTabContent();
    };

    window.resetAliatTransitSession = function () {
        transitState.question = '';
        transitState.routes = [];
        transitState.verdictHtml = '';
        transitState.verdictPlainText = '';
        transitState.exploreAnswerText = '';
        transitState.explorePlaces = [];
        transitState.lastExploreContext = null;
        transitState.conversation = [];
        transitState.aiMode = 'transit';
        clearActiveRouteGraphics();
        clearActivePlaceMarkers();
        renderTransitTabContent();
    };

    window.askTransitFollowupChip = function (promptText) {
        const inp = document.getElementById('daily-transit-question-input');
        if (inp) inp.value = promptText;
        transitState.question = promptText;
        window.askAliatMapsTransit();
    };

    function renderTransitTabContent() {
        const box = document.getElementById('daily-maps-tab-panel');
        if (!box || activeTab !== 'transit') return;

        const homeSaved = findSavedPlaceByRole('home');
        const schoolSaved = findSavedPlaceByRole('school');
        const workSaved = findSavedPlaceByRole('work');
        const syncBadgeHtml = isFirebaseProfileActive() || transitState.placesSyncedWithFirestore
            ? `<span class="px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[9.5px] font-bold inline-flex items-center gap-1">${iconSvg('cloud', 'w-3 h-3')}<span>Perfil Firestore</span></span>`
            : (transitState.placesSyncedWithAccount
                ? `<span class="px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[9.5px] font-bold inline-flex items-center gap-1">${iconSvg('cloud', 'w-3 h-3')}<span>Compte</span></span>`
                : `<span class="px-1.5 py-0.5 rounded-md bg-zinc-200/70 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 text-[9.5px] font-bold">Temporal</span>`);

        const editingRole = transitState.placeEditorRole;
        const isEditingSchool = editingRole === 'school';
        const candidatesHtml = (transitState.placeSearchCandidates && transitState.placeSearchCandidates.length > 0)
            ? `<div class="space-y-1 pt-1">
                ${transitState.placeSearchCandidates.map((c, idx) => `
                    <button type="button" onclick="window.pickPlaceRoleCandidate(${idx})" class="w-full p-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 hover:border-blue-500 text-left cursor-pointer transition">
                        <div class="text-[11px] font-extrabold text-zinc-900 dark:text-white truncate">${esc(c.displayName)}</div>
                        <div class="text-[10px] text-zinc-500 dark:text-zinc-400 truncate">${esc(c.formattedAddress)}</div>
                    </button>
                `).join('')}
               </div>`
            : '';

        const inlineEditorHtml = editingRole ? `
            <div class="p-3 rounded-2xl bg-zinc-100/90 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 space-y-2">
                <div class="flex items-center justify-between gap-2">
                    <span class="text-xs font-extrabold text-zinc-900 dark:text-white flex items-center gap-1.5">
                        ${isEditingSchool ? iconSvg('school', 'w-4 h-4 text-indigo-600') : iconSvg('home', 'w-4 h-4 text-emerald-600')}
                        <span>${isEditingSchool ? 'Configurar Institut / Centre' : 'Configurar Casa teva'}</span>
                    </span>
                    <button type="button" onclick="window.openPlaceRoleEditor(null)" class="text-[10.5px] font-bold text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 cursor-pointer">Tancar</button>
                </div>
                <div class="flex items-center gap-1.5">
                    <input id="daily-place-role-search" type="text" value="${esc(transitState.placeSearchQuery)}" oninput="window.updatePlaceRoleSearchInput(this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();window.searchPlaceRoleCandidates();}" placeholder="${isEditingSchool ? 'Nom de l\'institut o adreça...' : 'Carrer, número i ciutat...'}" class="flex-1 px-2.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100">
                    <button type="button" onclick="window.searchPlaceRoleCandidates()" class="px-2.5 py-1.5 rounded-xl ${isEditingSchool ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-emerald-600 hover:bg-emerald-500'} text-white text-[11px] font-extrabold cursor-pointer shrink-0 inline-flex items-center gap-1">
                        ${transitState.placeSearchLoading ? iconSvg('spinner', 'w-3.5 h-3.5 animate-spin') : 'Cercar'}
                    </button>
                </div>
                <div class="flex flex-wrap gap-1.5">
                    <button type="button" onclick="window.startMapPickMode('${isEditingSchool ? 'school' : 'home'}')" class="px-2.5 py-1 rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 text-[10.5px] font-bold text-zinc-700 dark:text-zinc-200 cursor-pointer inline-flex items-center gap-1">${iconSvg('map', 'w-3 h-3 text-blue-600')}<span>Marcar clicant al mapa</span></button>
                    ${!isEditingSchool ? `<button type="button" onclick="window.setHomeFromCurrentGps()" class="px-2.5 py-1 rounded-lg bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 text-[10.5px] font-bold text-zinc-700 dark:text-zinc-200 cursor-pointer inline-flex items-center gap-1">${iconSvg('gps', 'w-3 h-3 text-emerald-600')}<span>Usar GPS actual</span></button>` : ''}
                </div>
                ${candidatesHtml}
            </div>
        ` : '';

        const hasFollowupTarget = (transitState.routes && transitState.routes.length > 0) || (transitState.explorePlaces && transitState.explorePlaces.length > 0);
        const promptPlaceholder = hasFollowupTarget
            ? "Comenta o pregunta sobre aquesta ruta (ex: 'On baixo?', 'Quant es camina?', 'I si surto abans?')..."
            : "Ex: 'Puc sortir de casa a les 8 en bus i arribar abans de les 9 a l'insti?'";

        const aiCardHtml = `
            <div id="daily-maps-ai-card" class="p-3.5 rounded-2xl ${hasFollowupTarget ? 'bg-indigo-50/75 dark:bg-indigo-950/30 border-indigo-200/90 dark:border-indigo-800/70' : 'bg-blue-50/80 dark:bg-blue-950/35 border-blue-200/90 dark:border-blue-800/70'} border space-y-2.5">
                <div class="flex items-center justify-between gap-2">
                    <span class="text-xs font-extrabold text-zinc-900 dark:text-white flex items-center gap-1.5">
                        ${iconSvg(hasFollowupTarget ? 'chat' : 'spark', `w-4 h-4 ${hasFollowupTarget ? 'text-indigo-600 dark:text-indigo-400' : 'text-blue-600 dark:text-sky-400'}`)}
                        <span>${hasFollowupTarget ? 'Dubtes de la ruta' : 'Pregunta ràpida'}</span>
                    </span>
                    ${hasFollowupTarget
                        ? `<button type="button" onclick="window.resetAliatTransitSession()" class="text-[10.5px] font-bold text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 cursor-pointer inline-flex items-center gap-1">${iconSvg('refresh', 'w-3 h-3')}<span>Nova</span></button>`
                        : `<span class="text-[10px] font-bold text-blue-700 dark:text-sky-300">IA · Directe</span>`
                    }
                </div>
                ${hasFollowupTarget ? `
                <div class="grid grid-cols-2 gap-1.5">
                    <button type="button" onclick="window.askTransitFollowupChip('On he de baixar exactament?')" class="p-2 rounded-xl bg-white/90 dark:bg-zinc-900 border border-indigo-200/80 dark:border-zinc-700 text-[11px] font-extrabold text-indigo-700 dark:text-indigo-300 cursor-pointer hover:border-indigo-400 flex items-center gap-1.5">${iconSvg('pin', 'w-3.5 h-3.5')}<span>On baixo?</span></button>
                    <button type="button" onclick="window.askTransitFollowupChip('Quant es camina en total?')" class="p-2 rounded-xl bg-white/90 dark:bg-zinc-900 border border-indigo-200/80 dark:border-zinc-700 text-[11px] font-extrabold text-indigo-700 dark:text-indigo-300 cursor-pointer hover:border-indigo-400 flex items-center gap-1.5">${iconSvg('walk', 'w-3.5 h-3.5')}<span>Temps a peu</span></button>
                </div>
                ` : `
                <div class="grid grid-cols-2 gap-1.5">
                    <button type="button" onclick="window.runTransitExamplePrompt('school')" class="p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-blue-200/80 dark:border-zinc-700 hover:border-blue-500 cursor-pointer flex items-center gap-2 text-left transition">
                        <span class="w-7 h-7 rounded-lg bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">${iconSvg('school', 'w-4 h-4')}</span>
                        <span class="text-[11px] font-extrabold text-zinc-900 dark:text-white leading-tight">Cap a l'Insti</span>
                    </button>
                    <button type="button" onclick="window.runTransitExamplePrompt('train')" class="p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-blue-200/80 dark:border-zinc-700 hover:border-blue-500 cursor-pointer flex items-center gap-2 text-left transition">
                        <span class="w-7 h-7 rounded-lg bg-blue-500/15 text-blue-600 dark:text-sky-400 flex items-center justify-center shrink-0">${iconSvg('train', 'w-4 h-4')}</span>
                        <span class="text-[11px] font-extrabold text-zinc-900 dark:text-white leading-tight">Proper ara</span>
                    </button>
                    <button type="button" onclick="window.runTransitExamplePrompt('home')" class="p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-blue-200/80 dark:border-zinc-700 hover:border-blue-500 cursor-pointer flex items-center gap-2 text-left transition">
                        <span class="w-7 h-7 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">${iconSvg('home', 'w-4 h-4')}</span>
                        <span class="text-[11px] font-extrabold text-zinc-900 dark:text-white leading-tight">Cap a Casa</span>
                    </button>
                    <button type="button" onclick="window.runTransitExamplePrompt('explore')" class="p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-teal-200/80 dark:border-teal-800/70 hover:border-teal-500 cursor-pointer flex items-center gap-2 text-left transition">
                        <span class="w-7 h-7 rounded-lg bg-teal-500/15 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0">${iconSvg('compass', 'w-4 h-4')}</span>
                        <span class="text-[11px] font-extrabold text-zinc-900 dark:text-white leading-tight">Què fer a prop</span>
                    </button>
                </div>
                `}
                <div class="flex items-center gap-1.5">
                    <input id="daily-transit-question-input" type="text" value="${esc(transitState.question)}" onkeydown="if(event.key==='Enter'){event.preventDefault();window.askAliatMapsTransit();}" placeholder="${esc(promptPlaceholder)}" class="flex-1 px-3 py-2 rounded-xl border border-zinc-200/90 dark:border-zinc-700/80 bg-white dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <button type="button" onclick="window.askAliatMapsTransit()" class="p-2.5 px-3.5 rounded-xl ${hasFollowupTarget ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-blue-600 hover:bg-blue-500'} text-white text-xs font-extrabold transition cursor-pointer shrink-0 shadow-2xs inline-flex items-center gap-1.5">
                        ${iconSvg(hasFollowupTarget ? 'chat' : 'spark', 'w-3.5 h-3.5')}<span>${hasFollowupTarget ? 'Enviar' : 'Cercar'}</span>
                    </button>
                </div>
            </div>
        `;

        const manualCardHtml = `
            <div id="daily-maps-manual-card" class="p-3.5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 space-y-2.5">
                <div class="flex items-center justify-between gap-2">
                    <span class="text-xs font-extrabold text-zinc-900 dark:text-white flex items-center gap-1.5">
                        ${iconSvg('clock', 'w-3.5 h-3.5 text-blue-600 dark:text-sky-400')}
                        <span>Origen i Destí</span>
                    </span>
                    <button type="button" onclick="window.swapAliatTransitPoints()" title="Intercanviar origen i destinació" class="px-2 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-[10px] font-bold text-zinc-700 dark:text-zinc-200 cursor-pointer inline-flex items-center gap-1">
                        ${iconSvg('swap', 'w-3 h-3')}<span>Invertir</span>
                    </button>
                </div>

                <div class="space-y-2">
                    <div>
                        <div class="flex items-center justify-between gap-1 mb-1">
                            <label class="text-[10px] font-extrabold uppercase text-zinc-400">Sortida</label>
                            <div class="flex items-center gap-1">
                                <button type="button" onclick="window.applyTransitPresetOrigin('current')" class="px-2 py-0.5 rounded-md text-[10px] font-bold cursor-pointer inline-flex items-center gap-1 ${transitState.originMode === 'current' ? 'bg-blue-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'}">${iconSvg('gps', 'w-3 h-3')}<span>GPS</span></button>
                                <button type="button" onclick="window.applyTransitPresetOrigin('home')" class="px-2 py-0.5 rounded-md text-[10px] font-bold cursor-pointer inline-flex items-center gap-1 ${transitState.originMode === 'saved' ? 'bg-blue-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'}">${iconSvg('home', 'w-3 h-3')}<span>Casa</span></button>
                            </div>
                        </div>
                        <input id="daily-transit-origin-input" type="text" value="${esc(transitState.originAddress)}" oninput="window.updateTransitOriginInput(this.value)" onchange="window.updateTransitOriginInput(this.value)" placeholder="GPS o adreça de sortida..." class="w-full px-2.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-800 dark:text-zinc-100">
                    </div>

                    <div>
                        <div class="flex items-center justify-between gap-1 mb-1">
                            <label class="text-[10px] font-extrabold uppercase text-zinc-400">Destí</label>
                            <div class="flex items-center gap-1">
                                <button type="button" onclick="window.applyTransitPresetDest('school')" class="px-2 py-0.5 rounded-md text-[10px] font-bold cursor-pointer inline-flex items-center gap-1 ${transitState.destMode === 'saved' && schoolSaved && transitState.destAddress === (schoolSaved.address || schoolSaved.title) ? 'bg-indigo-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'}">${iconSvg('school', 'w-3 h-3')}<span>Insti</span></button>
                                ${workSaved ? `<button type="button" onclick="window.applyTransitPresetDest('work')" class="px-2 py-0.5 rounded-md text-[10px] font-bold cursor-pointer bg-zinc-100 hover:bg-blue-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 inline-flex items-center gap-1">${iconSvg('work', 'w-3 h-3')}<span>Feina</span></button>` : ''}
                            </div>
                        </div>
                        <input id="daily-transit-dest-input" type="text" value="${esc(transitState.destAddress)}" oninput="window.updateTransitDestInput(this.value)" onchange="window.updateTransitDestInput(this.value)" placeholder="Parada, estació o adreça..." class="w-full px-2.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-800 dark:text-zinc-100">
                    </div>
                </div>

                <div class="grid grid-cols-12 gap-1.5 items-end">
                    <div class="col-span-5">
                        <select onchange="window.setTransitTimeMode(this.value)" class="w-full px-2 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-[11px] font-bold text-zinc-800 dark:text-zinc-100">
                            <option value="departure" ${transitState.timeMode === 'departure' ? 'selected' : ''}>Sortir a</option>
                            <option value="arrival" ${transitState.timeMode === 'arrival' ? 'selected' : ''}>Arribar a</option>
                        </select>
                    </div>
                    <div class="col-span-4">
                        <input id="daily-transit-time-input" type="time" value="${esc(transitState.timeStr)}" onchange="window.updateTransitTimeInput(this.value)" class="w-full px-2 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-[11px] font-bold text-zinc-800 dark:text-zinc-100 tabular-nums">
                    </div>
                    <div class="col-span-3">
                        <select id="daily-transit-day-select" onchange="window.updateTransitDayOffset(this.value)" class="w-full px-2 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-[11px] font-bold text-zinc-800 dark:text-zinc-100">
                            <option value="0" ${transitState.dayOffset === 0 ? 'selected' : ''}>Avui</option>
                            <option value="1" ${transitState.dayOffset === 1 ? 'selected' : ''}>Demà</option>
                        </select>
                    </div>
                </div>

                <div class="grid grid-cols-4 gap-1.5">
                    <button type="button" onclick="window.setTransitModeFilter('ALL')" class="py-2 rounded-xl text-[10.5px] font-extrabold border cursor-pointer flex flex-col items-center gap-0.5 ${transitState.modeFilter === 'ALL' ? 'bg-blue-600 text-white border-blue-600' : 'bg-zinc-50 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800'}">${iconSvg('transit', 'w-4 h-4')}<span>Tot</span></button>
                    <button type="button" onclick="window.setTransitModeFilter('BUS')" class="py-2 rounded-xl text-[10.5px] font-extrabold border cursor-pointer flex flex-col items-center gap-0.5 ${transitState.modeFilter === 'BUS' ? 'bg-blue-600 text-white border-blue-600' : 'bg-zinc-50 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800'}">${iconSvg('bus', 'w-4 h-4')}<span>Bus</span></button>
                    <button type="button" onclick="window.setTransitModeFilter('RAIL')" class="py-2 rounded-xl text-[10.5px] font-extrabold border cursor-pointer flex flex-col items-center gap-0.5 ${transitState.modeFilter === 'RAIL' ? 'bg-blue-600 text-white border-blue-600' : 'bg-zinc-50 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800'}">${iconSvg('train', 'w-4 h-4')}<span>Tren</span></button>
                    <button type="button" onclick="window.setTransitModeFilter('SUBWAY')" class="py-2 rounded-xl text-[10.5px] font-extrabold border cursor-pointer flex flex-col items-center gap-0.5 ${transitState.modeFilter === 'SUBWAY' ? 'bg-blue-600 text-white border-blue-600' : 'bg-zinc-50 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800'}">${iconSvg('metro', 'w-4 h-4')}<span>Metro</span></button>
                </div>

                <button type="button" onclick="window.askAliatMapsTransit(true)" class="w-full py-2.5 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 text-xs font-extrabold transition cursor-pointer inline-flex items-center justify-center gap-1.5 shadow-2xs">
                    ${iconSvg('search', 'w-3.5 h-3.5')}<span>Cercar horaris</span>
                </button>
            </div>
        `;

        box.innerHTML = `
            <div class="space-y-3">
                <!-- Llocs habituals (Casa & Insti) -->
                <div id="daily-maps-habitual-places-card" class="space-y-2">
                    <div class="flex items-center justify-between px-0.5">
                        <span class="text-[10.5px] font-extrabold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Llocs fixos</span>
                        ${syncBadgeHtml}
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <button type="button" onclick="window.openPlaceRoleEditor('home')" class="p-2.5 rounded-2xl border text-left transition cursor-pointer flex items-center gap-2 min-w-0 ${editingRole === 'home' ? 'ring-2 ring-emerald-500/40 border-emerald-500' : (homeSaved ? 'bg-emerald-50/70 dark:bg-emerald-950/25 border-emerald-200/80 dark:border-emerald-800/70' : 'bg-white dark:bg-zinc-900 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-emerald-400')}">
                            <span class="w-8 h-8 rounded-xl ${homeSaved ? 'bg-emerald-600 text-white' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'} flex items-center justify-center shrink-0">${iconSvg('home', 'w-4 h-4')}</span>
                            <div class="min-w-0 flex-1">
                                <div class="text-[11px] font-extrabold text-zinc-900 dark:text-white flex items-center justify-between gap-1">
                                    <span>${homeSaved ? 'Casa' : '+ Casa'}</span>
                                    ${homeSaved ? iconSvg('edit', 'w-2.5 h-2.5 text-zinc-400 shrink-0') : ''}
                                </div>
                                <div class="text-[10px] text-zinc-500 dark:text-zinc-400 truncate">${homeSaved ? esc(homeSaved.address || homeSaved.title) : 'Fixar'}</div>
                            </div>
                        </button>
                        <button type="button" onclick="window.openPlaceRoleEditor('school')" class="p-2.5 rounded-2xl border text-left transition cursor-pointer flex items-center gap-2 min-w-0 ${editingRole === 'school' ? 'ring-2 ring-indigo-500/40 border-indigo-500' : (schoolSaved ? 'bg-indigo-50/70 dark:bg-indigo-950/25 border-indigo-200/80 dark:border-indigo-800/70' : 'bg-white dark:bg-zinc-900 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-indigo-400')}">
                            <span class="w-8 h-8 rounded-xl ${schoolSaved ? 'bg-indigo-600 text-white' : 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300'} flex items-center justify-center shrink-0">${iconSvg('school', 'w-4 h-4')}</span>
                            <div class="min-w-0 flex-1">
                                <div class="text-[11px] font-extrabold text-zinc-900 dark:text-white flex items-center justify-between gap-1">
                                    <span>${schoolSaved ? 'Insti' : '+ Insti'}</span>
                                    ${schoolSaved ? iconSvg('edit', 'w-2.5 h-2.5 text-zinc-400 shrink-0') : ''}
                                </div>
                                <div class="text-[10px] text-zinc-500 dark:text-zinc-400 truncate">${schoolSaved ? esc(schoolSaved.address || schoolSaved.title) : 'Fixar'}</div>
                            </div>
                        </button>
                    </div>
                    ${inlineEditorHtml}
                </div>

                <!-- Selector clar entre Preguntar amb IA o Cercar horari manual -->
                <div id="daily-maps-search-section" class="space-y-3">
                    <div id="daily-maps-mode-toggle" class="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-zinc-200/60 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800">
                        <button type="button" onclick="window.setTransitInputMode('ai')" class="py-1.5 px-2.5 rounded-xl text-[11px] font-extrabold transition cursor-pointer inline-flex items-center justify-center gap-1.5 ${transitState.inputMode !== 'manual' ? 'bg-white dark:bg-zinc-800 text-blue-700 dark:text-sky-300 shadow-2xs' : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'}">
                            ${iconSvg('spark', 'w-3.5 h-3.5')}<span>Amb IA</span>
                        </button>
                        <button type="button" onclick="window.setTransitInputMode('manual')" class="py-1.5 px-2.5 rounded-xl text-[11px] font-extrabold transition cursor-pointer inline-flex items-center justify-center gap-1.5 ${transitState.inputMode === 'manual' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-2xs' : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'}">
                            ${iconSvg('clock', 'w-3.5 h-3.5')}<span>Manual</span>
                        </button>
                    </div>

                    ${transitState.inputMode === 'manual' ? manualCardHtml : aiCardHtml}
                </div>

                <!-- Resultats immediats a sota sense haver de fer scroll -->
                <div id="daily-transit-results-box" class="space-y-2"></div>
            </div>
        `;
        renderTransitResultsOnly();
    }

    window.switchDailyMapsTab = function (tab) {
        activeTab = tab || 'transit';
        if (activeTab !== 'parking' && parkingCountdownInterval) {
            clearInterval(parkingCountdownInterval);
            parkingCountdownInterval = null;
        }
        document.querySelectorAll('[data-daily-maps-tab]').forEach((btn) => {
            const isAct = btn.getAttribute('data-daily-maps-tab') === activeTab;
            btn.className = isAct
                ? 'py-1.5 px-2.5 sm:px-3 rounded-xl text-xs font-extrabold transition cursor-pointer bg-blue-600 text-white shadow-2xs flex items-center gap-1.5 whitespace-nowrap'
                : 'py-1.5 px-2.5 sm:px-3 rounded-xl text-xs font-bold transition cursor-pointer text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200/70 dark:hover:bg-zinc-700/70 flex items-center gap-1.5 whitespace-nowrap';
        });

        if (activeTab === 'transit') renderTransitTabContent();
        else if (activeTab === 'parking') renderParkingTabContent();
        else if (activeTab === 'nearby') renderNearbyTabContent();
        else if (activeTab === 'routes') renderRoutesTabContent();
        else if (activeTab === 'saved') renderSavedPlacesTabContent();
    };

    window.openDailyMapsModal = async function (initialTab = 'transit') {
        const modal = document.getElementById('daily-maps-modal');
        if (!modal) return;
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        if (typeof window.hydrateAliatSvgIcons === 'function') {
            window.hydrateAliatSvgIcons(modal);
        }
        window.switchDailyMapsTab(initialTab);
        syncMapsPlacesFromServer().catch(() => {});
        await ensureMapInitialized();
        updateFloatingMapControlButtons();
        requestAnimationFrame(() => {
            try { window.dispatchEvent(new Event('resize')); } catch (_) {}
        });
        if (typeof window.startAliatMapsOnboarding === 'function') {
            setTimeout(() => {
                const m = document.getElementById('daily-maps-modal');
                if (m && !m.classList.contains('hidden')) {
                    window.startAliatMapsOnboarding(false);
                }
            }, 380);
        }
    };
    window.openAliatMapsModal = window.openDailyMapsModal;

    window.closeDailyMapsModal = function () {
        if (parkingCountdownInterval) {
            clearInterval(parkingCountdownInterval);
            parkingCountdownInterval = null;
        }
        if (typeof window.stopAliatMapsOnboardingIfActive === 'function') {
            window.stopAliatMapsOnboardingIfActive();
        }
        const modal = document.getElementById('daily-maps-modal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    };
})();
