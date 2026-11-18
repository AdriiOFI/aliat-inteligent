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
    const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30-day ToS cache limit
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
            return String(localStorage.getItem('aliat_user_email') || '').trim().toLowerCase();
        } catch (_) {
            return '';
        }
    }

    function schedulePushPlacesToServer() {
        if (suppressRemotePush) return;
        const token = localStorage.getItem('aliat_token') || '';
        if (!token) return;
        if (pushPlacesTimeoutId) clearTimeout(pushPlacesTimeoutId);
        pushPlacesTimeoutId = setTimeout(() => {
            pushPlacesTimeoutId = null;
            pushMapsPlacesToServerNow().catch(() => {});
        }, 120);
    }

    async function pushMapsPlacesToServerNow() {
        try {
            const token = localStorage.getItem('aliat_token') || '';
            if (!token) return false;
            const places = loadSavedEverydayPlaces();
            const parkedVehicle = loadParkedVehicleState();
            const res = await fetch('/api/maps/places', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ places, parkedVehicle })
            });
            if (res.ok) {
                transitState.placesSyncedWithAccount = true;
                const email = getCurrentUserEmailSafe();
                if (email) localStorage.setItem(STORAGE_KEY_OWNER, email);
                return true;
            }
        } catch (_) {}
        return false;
    }

    async function syncMapsPlacesFromServer() {
        try {
            const token = localStorage.getItem('aliat_token') || '';
            if (!token) {
                transitState.placesSyncedWithAccount = false;
                return false;
            }
            const currentEmail = getCurrentUserEmailSafe();
            const storedOwner = String(localStorage.getItem(STORAGE_KEY_OWNER) || '').trim().toLowerCase();
            if (currentEmail && storedOwner && storedOwner !== currentEmail) {
                localStorage.removeItem(STORAGE_KEY_PLACES);
                localStorage.removeItem(STORAGE_KEY_PARKING);
            }

            const res = await fetch('/api/maps/places', {
                headers: { 'Authorization': `Bearer ${token}` },
                cache: 'no-store'
            });
            if (!res.ok) return false;
            const data = await res.json().catch(() => null);
            if (!data || !data.success) return false;

            const remotePlaces = Array.isArray(data.places) ? data.places : [];
            const remoteParking = data.parkedVehicle || null;
            const localPlaces = loadSavedEverydayPlaces();
            const localParking = loadParkedVehicleState();

            suppressRemotePush = true;
            try {
                if (remotePlaces.length > 0) {
                    localStorage.setItem(STORAGE_KEY_PLACES, JSON.stringify(remotePlaces));
                } else if (localPlaces.length > 0 && (!storedOwner || !currentEmail || storedOwner === currentEmail)) {
                    // Initial upload of local places created before login/sync
                    suppressRemotePush = false;
                    await pushMapsPlacesToServerNow();
                    suppressRemotePush = true;
                } else {
                    localStorage.removeItem(STORAGE_KEY_PLACES);
                }

                if (remoteParking) {
                    localStorage.setItem(STORAGE_KEY_PARKING, JSON.stringify(remoteParking));
                } else if (localParking && (!storedOwner || !currentEmail || storedOwner === currentEmail)) {
                    suppressRemotePush = false;
                    await pushMapsPlacesToServerNow();
                    suppressRemotePush = true;
                } else {
                    localStorage.removeItem(STORAGE_KEY_PARKING);
                }

                if (currentEmail) localStorage.setItem(STORAGE_KEY_OWNER, currentEmail);
                transitState.placesSyncedWithAccount = true;
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
            const raw = localStorage.getItem(STORAGE_KEY_PARKING);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed.lat !== 'number' || typeof parsed.lng !== 'number') return null;
            if (parsed.savedAt && Date.now() - parsed.savedAt > MAX_CACHE_AGE_MS) {
                localStorage.removeItem(STORAGE_KEY_PARKING);
                return null;
            }
            return parsed;
        } catch (_) {
            return null;
        }
    }

    function saveParkedVehicleState(data) {
        try {
            const email = getCurrentUserEmailSafe();
            if (email) localStorage.setItem(STORAGE_KEY_OWNER, email);
            if (!data) {
                localStorage.removeItem(STORAGE_KEY_PARKING);
                schedulePushPlacesToServer();
                return;
            }
            localStorage.setItem(STORAGE_KEY_PARKING, JSON.stringify({
                ...data,
                savedAt: data.savedAt || Date.now()
            }));
            schedulePushPlacesToServer();
        } catch (_) {}
    }

    function loadSavedEverydayPlaces() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY_PLACES);
            if (!raw) return [];
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr)) return [];
            const now = Date.now();
            return arr.filter((item) => item && typeof item.lat === 'number' && typeof item.lng === 'number' && (!item.savedAt || now - item.savedAt <= MAX_CACHE_AGE_MS));
        } catch (_) {
            return [];
        }
    }

    function saveEverydayPlaces(list) {
        try {
            const email = getCurrentUserEmailSafe();
            if (email) localStorage.setItem(STORAGE_KEY_OWNER, email);
            localStorage.setItem(STORAGE_KEY_PLACES, JSON.stringify(list || []));
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
        const cat = isHome ? 'Casa' : (isSchool ? 'Institut / Universitat' : 'Feina / Estudis');
        const finalTitle = title || (isHome ? 'Casa' : (isSchool ? 'Institut / Universitat' : 'Feina'));

        const filtered = list.filter((p) => {
            if (isHome) return !/casa|llar|home/i.test(`${p.title} ${p.category}`);
            if (isSchool) return !/insti|institut|instituto|uni|universit|escola|estud|cole/i.test(`${p.title} ${p.category}`);
            return true;
        });

        const item = {
            id: 'pl_' + Date.now(),
            title: finalTitle,
            category: cat,
            lat: Number(lat),
            lng: Number(lng),
            address: address || finalTitle,
            savedAt: Date.now()
        };
        filtered.unshift(item);
        saveEverydayPlaces(filtered.slice(0, 20));

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
            btn.innerHTML = `${iconSvg('spinner', 'w-4 h-4 animate-spin')}<span>Obtenint GPS exacte...</span>`;
        }
        const loc = await requestUserGeolocation(false);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `${iconSvg('gps', 'w-4 h-4')}<span>Guardar on he aparcat ara (GPS)</span>`;
        }
        if (!loc) return;
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
        const expiresAt = (!isNaN(timerMins) && timerMins > 0) ? (now + timerMins * 60 * 1000) : (existing.expiresAt || null);

        const state = {
            lat,
            lng,
            address,
            floorSpot,
            notes,
            vehicleType,
            savedAt: now,
            expiresAt
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
        } else if (timerMins === 0) {
            parked.expiresAt = null;
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
        if (isHome || isSchool) {
            upsertSavedRolePlace(isHome ? 'home' : 'school', {
                lat: coords.lat,
                lng: coords.lng,
                address: coords.address,
                title: name || (isHome ? 'Casa' : 'Institut / Universitat')
            });
        } else {
            const list = loadSavedEverydayPlaces();
            list.unshift({
                id: 'pl_' + Date.now(),
                title: name || cat,
                category: cat,
                lat: coords.lat,
                lng: coords.lng,
                address: coords.address || `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`,
                savedAt: Date.now()
            });
            saveEverydayPlaces(list.slice(0, 20));
        }

        window.pendingSavedPlaceCoords = null;
        if (nameInput) nameInput.value = '';
        if (addrInput) addrInput.value = '';
        renderSavedHomeAndSchoolMarkers();
        renderSavedPlacesTabContent();
        if (typeof window.showToast === 'function') {
            window.showToast('Lloc quotidià desat!', 'success');
        }
    };

    window.deleteSavedEverydayPlace = function (id) {
        const next = loadSavedEverydayPlaces().filter((p) => p.id !== id);
        saveEverydayPlaces(next);
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

    // --- RENDER SIDEBAR TABS ---
    function renderParkingTabContent() {
        const box = document.getElementById('daily-maps-tab-panel');
        if (!box || activeTab !== 'parking') return;
        const parked = loadParkedVehicleState();

        if (parkingCountdownInterval) {
            clearInterval(parkingCountdownInterval);
            parkingCountdownInterval = null;
        }

        let timerBadgeHtml = '';
        if (parked && parked.expiresAt) {
            const diffMs = parked.expiresAt - Date.now();
            if (diffMs > 0) {
                const minsLeft = Math.ceil(diffMs / 60000);
                timerBadgeHtml = `<span id="daily-parking-countdown-badge" class="px-2 py-0.5 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-[10.5px] font-extrabold tabular-nums inline-flex items-center gap-1">${iconSvg('timer', 'w-3 h-3')}<span>Parquímetre: queden ${minsLeft} min</span></span>`;
            } else {
                timerBadgeHtml = `<span class="px-2 py-0.5 rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30 text-[10.5px] font-extrabold inline-flex items-center gap-1">${iconSvg('warn', 'w-3 h-3')}<span>Temps de parquímetre esgotat!</span></span>`;
            }
        }

        box.innerHTML = `
            <div class="space-y-3">
                <div class="p-3.5 rounded-2xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-900/60 space-y-2.5">
                    <div class="flex items-center justify-between gap-2">
                        <span class="text-xs font-extrabold text-zinc-900 dark:text-white flex items-center gap-1.5">
                            ${iconSvg('car', 'w-4 h-4 text-blue-600 dark:text-sky-400')}
                            <span>On he deixat el cotxe / vehicle?</span>
                        </span>
                        ${timerBadgeHtml}
                    </div>
                    <p class="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                        Guarda el punt exacte on has aparcat amb el GPS o fent clic a qualsevol carrer del mapa. Quan acabis les teves gestions, traça la ruta a peu fins al teu vehicle.
                    </p>
                    <button id="daily-save-gps-parking-btn" type="button" onclick="window.saveCurrentGpsAsParkedVehicle()" class="w-full py-2.5 px-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-xs transition cursor-pointer flex items-center justify-center gap-2 shadow-xs">
                        ${iconSvg('gps', 'w-4 h-4')}<span>Guardar on he aparcat ara (GPS)</span>
                    </button>
                </div>

                ${parked ? `
                <div class="p-3.5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-2.5 shadow-2xs">
                    <div class="flex items-start justify-between gap-2">
                        <div class="space-y-0.5 min-w-0">
                            <span class="text-[10px] font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">${iconSvg('check', 'w-3 h-3')}<span>Vehicle guardat al mapa</span></span>
                            <div class="text-xs font-bold text-zinc-900 dark:text-white break-words">${esc(parked.address)}</div>
                            <div class="text-[10.5px] text-zinc-400 tabular-nums">Guardat a les ${new Date(parked.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                        </div>
                        <button type="button" onclick="window.focusDailyMapPoint(${parked.lat}, ${parked.lng})" class="px-2.5 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-[10.5px] font-bold shrink-0 cursor-pointer">
                            Centrar
                        </button>
                    </div>
                    <div class="grid grid-cols-2 gap-2 pt-1">
                        <button type="button" onclick="window.routeBackToParkedVehicle('WALKING')" class="py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-extrabold transition cursor-pointer flex items-center justify-center gap-1.5">
                            ${iconSvg('walk', 'w-3.5 h-3.5')}<span>Ruta a peu al cotxe</span>
                        </button>
                        <button type="button" onclick="window.routeBackToParkedVehicle('DRIVING')" class="py-2 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 text-[11px] font-extrabold transition cursor-pointer flex items-center justify-center gap-1.5">
                            ${iconSvg('car', 'w-3.5 h-3.5')}<span>Ruta en vehicle</span>
                        </button>
                    </div>
                    <div class="flex items-center justify-between pt-1 border-t border-zinc-100 dark:border-zinc-800">
                        <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${parked.lat},${parked.lng}`)}" target="_blank" rel="noopener noreferrer" class="text-[11px] font-bold text-blue-600 dark:text-sky-400 hover:underline inline-flex items-center gap-1">
                            <span>Obrir ubicació a Google Maps</span>${iconSvg('external', 'w-3 h-3')}
                        </a>
                        <button type="button" onclick="window.clearParkedVehicle()" class="text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer">
                            Esborrar aparcament
                        </button>
                    </div>
                </div>
                ` : `
                <div class="p-3 rounded-2xl bg-zinc-100/80 dark:bg-zinc-900/60 border border-dashed border-zinc-300 dark:border-zinc-800 text-center text-[11px] text-zinc-500 dark:text-zinc-400">
                    Encara no has marcat cap aparcament. Prem el botó blau o fes clic directament sobre el mapa a la dreta.
                </div>
                `}

                <!-- Detalls addicionals d'aparcament (Planta, Plaça, Parquímetre, Notes) -->
                <div class="p-3.5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 space-y-2.5">
                    <div class="text-xs font-extrabold text-zinc-900 dark:text-white">Detalls del pàrquing i parquímetre</div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                            <label class="block text-[10px] font-bold uppercase text-zinc-400 mb-1">Tipus de vehicle</label>
                            <select id="daily-parking-vehicle-type" class="w-full px-2.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                                <option value="cotxe" ${(!parked || parked.vehicleType === 'cotxe') ? 'selected' : ''}>Cotxe</option>
                                <option value="moto" ${(parked && parked.vehicleType === 'moto') ? 'selected' : ''}>Moto / Ciclomotor</option>
                                <option value="bici" ${(parked && parked.vehicleType === 'bici') ? 'selected' : ''}>Bici / Patinet</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold uppercase text-zinc-400 mb-1">Parquímetre (minuts)</label>
                            <input id="daily-parking-timer-mins" type="number" min="0" max="1440" placeholder="Ex: 90 min" class="w-full px-2.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-800 dark:text-zinc-100 tabular-nums">
                        </div>
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold uppercase text-zinc-400 mb-1">Planta, plaça o zona (Blava / Verda)</label>
                        <input id="daily-parking-floor" type="text" value="${esc(parked?.floorSpot || '')}" placeholder="Ex: Planta -2 · Plaça 44 · Sector B" class="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-800 dark:text-zinc-100">
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold uppercase text-zinc-400 mb-1">Nota o referència visual</label>
                        <input id="daily-parking-notes" type="text" value="${esc(parked?.notes || '')}" placeholder="Ex: Davant de la farmàcia / Sortida ascensor Nord" class="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-800 dark:text-zinc-100">
                    </div>
                    <button type="button" onclick="window.updateParkedVehicleDetails()" class="w-full py-2 px-3 rounded-xl bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 text-xs font-bold transition cursor-pointer">
                        Guardar detalls de la plaça i avís
                    </button>
                </div>
            </div>
        `;
    }

    function renderNearbyTabContent() {
        const box = document.getElementById('daily-maps-tab-panel');
        if (!box || activeTab !== 'nearby') return;

        const catBtns = NEARBY_CATEGORIES.map((c) => `
            <button type="button" onclick="window.searchEverydayNearbyCategory('${c.id}')" class="p-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 hover:border-blue-500 dark:hover:border-sky-400 transition flex items-center gap-2 text-left cursor-pointer shadow-2xs">
                <span class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style="background-color:${c.color}1a;color:${c.color}">${iconSvg(c.iconName, 'w-4 h-4')}</span>
                <span class="text-[11px] font-bold text-zinc-800 dark:text-zinc-100 truncate">${esc(c.label)}</span>
            </button>
        `).join('');

        box.innerHTML = `
            <div class="space-y-3">
                <div class="space-y-1.5">
                    <div class="text-xs font-extrabold text-zinc-900 dark:text-white">Serveis quotidians a prop teu</div>
                    <p class="text-[11px] text-zinc-500 dark:text-zinc-400">Prem qualsevol categoria per trobar establiments oberts i traçar la ruta al moment.</p>
                    <div class="grid grid-cols-2 gap-1.5 pt-1">
                        ${catBtns}
                    </div>
                </div>

                <div class="flex items-center gap-1.5">
                    <input id="daily-nearby-custom-query" type="text" onkeydown="if(event.key==='Enter'){event.preventDefault();window.searchEverydayByTextQuery();}" placeholder="Cerca lliure: ferreteria, correus, gimnàs..." class="flex-1 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs text-zinc-800 dark:text-zinc-100">
                    <button type="button" onclick="window.searchEverydayByTextQuery()" class="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-extrabold cursor-pointer shrink-0 inline-flex items-center gap-1">
                        ${iconSvg('search', 'w-3.5 h-3.5')}<span>Cercar</span>
                    </button>
                </div>

                <div id="daily-nearby-results-list" class="space-y-2 pt-1">
                    <div class="p-4 rounded-2xl bg-zinc-100/70 dark:bg-zinc-900/60 border border-zinc-200/70 dark:border-zinc-800 text-center text-xs text-zinc-500 dark:text-zinc-400">
                        Selecciona una categoria (Farmàcies, Supermercats, Gasolineres, Caixers...) per veure els llocs més propers al mapa.
                    </div>
                </div>
            </div>
        `;
    }

    function renderRoutesTabContent() {
        const box = document.getElementById('daily-maps-tab-panel');
        if (!box || activeTab !== 'routes') return;

        box.innerHTML = `
            <div class="space-y-3">
                <div class="p-3.5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 space-y-3">
                    <div class="space-y-1">
                        <div class="text-xs font-extrabold text-zinc-900 dark:text-white">Calculadora de Trajectes i Encàrrecs</div>
                        <p class="text-[11px] text-zinc-500 dark:text-zinc-400">Calcula el temps i la distància des de la teva posició fins a qualsevol adreça o fes clic al mapa.</p>
                    </div>

                    <div>
                        <label class="block text-[10px] font-bold uppercase text-zinc-400 mb-1">Destinació (o fes clic al mapa)</label>
                        <input id="daily-route-dest-input" type="text" value="${esc(routeDestinationLabel)}" placeholder="Escriu una adreça o usa el cercador superior..." class="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-800 dark:text-zinc-100">
                    </div>

                    <div>
                        <label class="block text-[10px] font-bold uppercase text-zinc-400 mb-1">Mitjà de transport</label>
                        <div class="grid grid-cols-2 gap-1.5">
                            <button type="button" onclick="window.setDailyTravelModeAndCompute('WALKING')" class="py-2 px-2.5 rounded-xl border text-xs font-bold cursor-pointer transition inline-flex items-center justify-center gap-1.5 ${selectedTravelMode === 'WALKING' ? 'bg-blue-600 text-white border-blue-600' : 'bg-zinc-50 dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800'}">${iconSvg('walk', 'w-3.5 h-3.5')}<span>A peu</span></button>
                            <button type="button" onclick="window.setDailyTravelModeAndCompute('DRIVING')" class="py-2 px-2.5 rounded-xl border text-xs font-bold cursor-pointer transition inline-flex items-center justify-center gap-1.5 ${selectedTravelMode === 'DRIVING' ? 'bg-blue-600 text-white border-blue-600' : 'bg-zinc-50 dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800'}">${iconSvg('car', 'w-3.5 h-3.5')}<span>En cotxe</span></button>
                            <button type="button" onclick="window.setDailyTravelModeAndCompute('BICYCLING')" class="py-2 px-2.5 rounded-xl border text-xs font-bold cursor-pointer transition inline-flex items-center justify-center gap-1.5 ${selectedTravelMode === 'BICYCLING' ? 'bg-blue-600 text-white border-blue-600' : 'bg-zinc-50 dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800'}">${iconSvg('bike', 'w-3.5 h-3.5')}<span>Bici / Patinet</span></button>
                            <button type="button" onclick="window.setDailyTravelModeAndCompute('TRANSIT')" class="py-2 px-2.5 rounded-xl border text-xs font-bold cursor-pointer transition inline-flex items-center justify-center gap-1.5 ${selectedTravelMode === 'TRANSIT' ? 'bg-blue-600 text-white border-blue-600' : 'bg-zinc-50 dark:bg-zinc-950 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800'}">${iconSvg('metro', 'w-3.5 h-3.5')}<span>Transport públic</span></button>
                        </div>
                    </div>

                    <button type="button" onclick="window.computeCustomDailyRoute()" class="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-extrabold transition cursor-pointer">
                        Calcular ruta ara
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

    function renderSavedPlacesTabContent() {
        const box = document.getElementById('daily-maps-tab-panel');
        if (!box || activeTab !== 'saved') return;
        const list = loadSavedEverydayPlaces();

        const itemsHtml = list.length
            ? list.map((item) => `
                <div class="p-2.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 flex items-center justify-between gap-2">
                    <div class="w-7 h-7 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 flex items-center justify-center shrink-0">
                        ${iconSvg(getPlaceRoleIconName(`${item.title} ${item.category}`), 'w-4 h-4')}
                    </div>
                    <div class="min-w-0 flex-1 cursor-pointer" onclick="window.focusDailyMapPoint(${item.lat}, ${item.lng})">
                        <div class="text-xs font-extrabold text-zinc-900 dark:text-white truncate">${esc(item.title)}</div>
                        <div class="text-[10.5px] text-zinc-500 dark:text-zinc-400 truncate">${esc(item.address)}</div>
                    </div>
                    <div class="flex items-center gap-1 shrink-0">
                        <button type="button" onclick="window.traceDailyRouteTo(${item.lat}, ${item.lng}, '${esc(item.title)}')" class="px-2.5 py-1 rounded-lg bg-blue-600 text-white text-[10.5px] font-bold cursor-pointer">Ruta</button>
                        <button type="button" onclick="window.deleteSavedEverydayPlace('${esc(item.id)}')" class="p-1 text-zinc-400 hover:text-rose-500 cursor-pointer" title="Eliminar">${iconSvg('close', 'w-3.5 h-3.5')}</button>
                    </div>
                </div>
            `).join('')
            : `<div class="p-4 rounded-2xl bg-zinc-100/70 dark:bg-zinc-900/60 border border-dashed border-zinc-300 dark:border-zinc-800 text-center text-xs text-zinc-500 dark:text-zinc-400">Encara no tens llocs quotidians guardats (Casa, Feina, Gimnàs...). Fes clic al mapa o usa el teu GPS per desar-ne un.</div>`;

        box.innerHTML = `
            <div class="space-y-3">
                <div class="p-3.5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 space-y-2.5">
                    <div class="text-xs font-extrabold text-zinc-900 dark:text-white">Desar un lloc quotidià freqüent</div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <select id="daily-saved-place-cat" class="px-2.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs font-semibold text-zinc-800 dark:text-zinc-100">
                            <option value="Casa">Casa</option>
                            <option value="Institut / Universitat">Institut / Universitat</option>
                            <option value="Feina / Estudis">Feina / Estudis</option>
                            <option value="Gimnàs / Esport">Gimnàs / Esport</option>
                            <option value="Supermercat habitual">Supermercat habitual</option>
                            <option value="Punt de trobada">Punt de trobada</option>
                        </select>
                        <input id="daily-saved-place-name" type="text" placeholder="Nom (ex: Casa meva / Institut)" class="px-2.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-800 dark:text-zinc-100">
                    </div>
                    <input id="daily-saved-place-addr" type="text" placeholder="Escriu l'adreça o ciutat (ex: Carrer Major 15, Sabadell)..." class="w-full px-2.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-800 dark:text-zinc-100">
                    <div class="flex flex-wrap gap-1.5">
                        <button type="button" onclick="window.startMapPickMode(document.getElementById('daily-saved-place-cat')?.value?.includes('Institut') ? 'school' : 'home')" class="px-2.5 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-[11px] font-bold text-emerald-700 dark:text-emerald-300 cursor-pointer inline-flex items-center gap-1.5">${iconSvg('map', 'w-3.5 h-3.5')}<span>Marcar al mapa</span></button>
                        <button type="button" onclick="window.setHomeFromCurrentGps()" class="px-2.5 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-[11px] font-bold text-blue-700 dark:text-sky-300 cursor-pointer inline-flex items-center gap-1.5">${iconSvg('gps', 'w-3.5 h-3.5')}<span>Posició actual com a Casa</span></button>
                    </div>
                    <div id="daily-saved-coords-hint" class="text-[10.5px] text-zinc-500 dark:text-zinc-400">
                        Escriu l'adreça a dalt, fes clic al mapa o usa el teu GPS. Si deses "Casa" i "Institut", AliatMaps calcularà busos i trens i plans a prop de casa!
                    </div>
                    <button type="button" onclick="window.addSavedEverydayPlace()" class="w-full py-2 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 text-xs font-extrabold transition cursor-pointer inline-flex items-center justify-center gap-1.5">
                        ${iconSvg('plus', 'w-3.5 h-3.5')}<span>Guardar lloc quotidià</span>
                    </button>
                </div>

                <div class="space-y-2">
                    <div class="text-[11px] font-extrabold uppercase tracking-wider text-zinc-400 px-1">Els meus llocs guardats</div>
                    ${itemsHtml}
                </div>
            </div>
        `;
    }

    // --- TAB 5: ALIAMAPS PUBLIC TRANSIT & NATURAL-LANGUAGE COMMUTE ASSISTANT ---
    function findSavedPlaceByRole(role) {
        const list = loadSavedEverydayPlaces();
        if (role === 'home') {
            return list.find((p) => /casa|llar|home/i.test(`${p.title} ${p.category}`)) || null;
        }
        if (role === 'school') {
            return list.find((p) => /insti|institut|instituto|uni|universit|escola|estud|cole/i.test(`${p.title} ${p.category}`)) || null;
        }
        if (role === 'work') {
            return list.find((p) => /feina|trabajo|oficina|work/i.test(`${p.title} ${p.category}`)) || null;
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

            return {
                isTransit,
                travelMode: isTransit ? 'TRANSIT' : 'WALK',
                vehicleType: vType,
                vehicleLabel: line?.vehicle?.name?.text || vType,
                lineShort: line?.nameShort || line?.name || (isTransit ? 'Línia' : ''),
                lineName: line?.name || line?.nameShort || '',
                lineColor: line?.color || (String(vType).includes('BUS') ? '#2563eb' : '#7c3aed'),
                lineTextColor: line?.textColor || '#ffffff',
                headsign: td?.headsign || '',
                departureStopName: depStop?.name || '',
                departureTimeMs: depMs,
                departureTimeText: td?.localizedValues?.departureTime?.time?.text || (depMs ? formatTimeHHMM(depMs) : ''),
                arrivalStopName: arrStop?.name || '',
                arrivalTimeMs: arrMs,
                arrivalTimeText: td?.localizedValues?.arrivalTime?.time?.text || (arrMs ? formatTimeHHMM(arrMs) : ''),
                stopCount: td?.stopCount || 0,
                durationSec: parseDurationSec(s.staticDuration),
                durationText: s.localizedValues?.staticDuration?.text || '',
                distanceText: s.localizedValues?.distance?.text || '',
                instruction: s.navigationInstruction?.instructions || '',
                encodedPolyline: s.polyline?.encodedPolyline || '',
                departureStopLatLng: depStop?.location?.latLng
                    ? { lat: depStop.location.latLng.latitude, lng: depStop.location.latLng.longitude }
                    : null,
                arrivalStopLatLng: arrStop?.location?.latLng
                    ? { lat: arrStop.location.latLng.latitude, lng: arrStop.location.latLng.longitude }
                    : null
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

        return {
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
        };
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

            return {
                isTransit,
                travelMode: isTransit ? 'TRANSIT' : 'WALK',
                vehicleType: vType,
                vehicleLabel: line?.vehicle?.name || vType,
                lineShort: line?.nameShort || line?.name || (isTransit ? 'Transport' : ''),
                lineName: line?.name || line?.nameShort || '',
                lineColor: line?.color || (String(vType).includes('BUS') ? '#2563eb' : '#7c3aed'),
                lineTextColor: line?.textColor || '#ffffff',
                headsign: td?.headsign || '',
                departureStopName: stopDetails.departureStop?.name || '',
                departureTimeMs: depTimeVal,
                departureTimeText: td?.localizedValues?.departureTime || (depTimeVal ? formatTimeHHMM(depTimeVal) : ''),
                arrivalStopName: stopDetails.arrivalStop?.name || '',
                arrivalTimeMs: arrTimeVal,
                arrivalTimeText: td?.localizedValues?.arrivalTime || (arrTimeVal ? formatTimeHHMM(arrTimeVal) : ''),
                stopCount: td?.stopCount || 0,
                durationSec: s.staticDurationMillis ? Math.round(s.staticDurationMillis / 1000) : 0,
                durationText: s.localizedValues?.staticDuration || '',
                distanceText: s.localizedValues?.distance || '',
                instruction: s.instructions || '',
                path: Array.isArray(s.path) ? s.path : null,
                departureStopLatLng: stopDetails.departureStop?.location
                    ? { lat: stopDetails.departureStop.location.lat(), lng: stopDetails.departureStop.location.lng() }
                    : null,
                arrivalStopLatLng: stopDetails.arrivalStop?.location
                    ? { lat: stopDetails.arrivalStop.location.lat(), lng: stopDetails.arrivalStop.location.lng() }
                    : null
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

        return {
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
        };
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
                if (Array.isArray(data.routes) && data.routes.length > 0) {
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
                transitState.homeEditorOpen = true;
                renderTransitTabContent();
                setTimeout(() => {
                    const inp = document.getElementById('daily-home-quick-search');
                    if (inp) inp.focus();
                }, 40);
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
            if (role === 'school') {
                window.startMapPickMode('school');
            } else if (typeof window.showToast === 'function') {
                window.showToast(`Escriu la destinació o fes clic al mapa!`, 'info');
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
            if (isHome) {
                transitState.homeEditorOpen = true;
                renderTransitTabContent();
            } else {
                window.startMapPickMode('school');
            }
            return;
        }

        upsertSavedRolePlace(role, {
            lat: resolved.lat,
            lng: resolved.lng,
            address: resolved.label,
            title: isHome ? 'Casa' : (rawText || 'Institut / Universitat')
        });

        if (typeof window.showToast === 'function') {
            window.showToast(`${isHome ? 'Casa' : 'Institut'} desat correctament!`, 'success');
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

    window.drawTransitRouteOnMap = async function (routeIndex) {
        const route = transitState.routes[routeIndex];
        if (!route || !mapInstance || !mapClasses) return;

        transitState.selectedRouteIdx = routeIndex;
        clearActiveRouteGraphics();

        const bounds = new mapClasses.LatLngBounds();

        if (route.rawSdkRoute && typeof route.rawSdkRoute.createPolylines === 'function') {
            const polylines = route.rawSdkRoute.createPolylines();
            polylines.forEach((p) => {
                p.setMap(mapInstance);
                activeRoutePolylines.push(p);
            });
            if (route.viewport) mapInstance.fitBounds(route.viewport, 48);
        } else {
            let hasAnyPath = false;
            route.steps.forEach((step) => {
                let path = step.path || null;
                if (!path && step.encodedPolyline && mapClasses.encoding?.decodePath) {
                    try {
                        path = mapClasses.encoding.decodePath(step.encodedPolyline);
                    } catch (_) {}
                }
                if (Array.isArray(path) && path.length > 0 && window.google?.maps?.Polyline) {
                    hasAnyPath = true;
                    path.forEach((pt) => bounds.extend(pt));
                    const isWalk = !step.isTransit;
                    const pline = new window.google.maps.Polyline({
                        path,
                        map: mapInstance,
                        geodesic: true,
                        strokeColor: isWalk ? '#64748b' : (step.lineColor || '#2563eb'),
                        strokeOpacity: isWalk ? 0.7 : 0.92,
                        strokeWeight: isWalk ? 4 : 6,
                        icons: isWalk ? [{
                            icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 },
                            offset: '0',
                            repeat: '12px'
                        }] : undefined
                    });
                    activeRoutePolylines.push(pline);
                }
            });

            if (route.viewport?.low && route.viewport?.high) {
                bounds.extend({ lat: route.viewport.low.latitude, lng: route.viewport.low.longitude });
                bounds.extend({ lat: route.viewport.high.latitude, lng: route.viewport.high.longitude });
                mapInstance.fitBounds(bounds, 48);
            } else if (hasAnyPath) {
                mapInstance.fitBounds(bounds, 48);
            }
        }

        // Drop informative transit stop markers
        route.steps.forEach((step) => {
            if (!step.isTransit) return;
            if (step.departureStopLatLng) {
                const badge = document.createElement('div');
                badge.className = 'px-2 py-1 rounded-xl text-[10px] font-extrabold shadow-md border-2 border-white flex items-center gap-1 cursor-pointer';
                badge.style.backgroundColor = step.lineColor || '#2563eb';
                badge.style.color = step.lineTextColor || '#ffffff';
                badge.innerHTML = `${vehicleSvg(step.vehicleType, 'w-3 h-3 shrink-0')}<span>${esc(step.lineShort)} · ${esc(step.departureTimeText)}</span>`;
                const m = new mapClasses.AdvancedMarkerElement({
                    map: mapInstance,
                    position: step.departureStopLatLng,
                    title: `${step.departureStopName} (${step.departureTimeText})`,
                    content: badge
                });
                m.addListener('click', () => {
                    if (!sharedInfoWindow) sharedInfoWindow = new mapClasses.InfoWindow();
                    sharedInfoWindow.setContent(`
                        <div class="p-1.5 text-xs text-zinc-900 space-y-0.5 max-w-[230px]">
                            <div class="font-extrabold flex items-center gap-1.5">${vehicleSvg(step.vehicleType, 'w-3.5 h-3.5')}<span>${esc(step.lineShort)} ${step.headsign ? `→ ${esc(step.headsign)}` : ''}</span></div>
                            <div class="text-[11px]">Parada pujada: <strong>${esc(step.departureStopName)}</strong> (${esc(step.departureTimeText)})</div>
                            <div class="text-[11px] text-zinc-600">Parada baixada: ${esc(step.arrivalStopName)} (${esc(step.arrivalTimeText)}) · ${step.stopCount} parades</div>
                        </div>
                    `);
                    sharedInfoWindow.open({ anchor: m, map: mapInstance });
                });
                activeRouteMarkers.push(m);
            }
        });

        renderTransitResultsOnly();
    };

    window.sendTransitResultToChat = function () {
        if (!transitState.verdictPlainText) return;
        const chatInput = document.getElementById('chat-input');
        const sel = transitState.routes[transitState.selectedRouteIdx];
        let extra = '';
        if (sel) {
            const stepsSummary = sel.steps.map((s) => s.isTransit
                ? `${vehicleTextLabel(s.vehicleType)} ${s.lineShort} (${s.departureStopName} ${s.departureTimeText} -> ${s.arrivalStopName} ${s.arrivalTimeText})`
                : `A peu ${s.durationText || ''}`
            ).join(' | ');
            extra = `\nDetall del trajecte: ${stepsSummary}`;
        }
        window.closeDailyMapsModal();
        if (chatInput) {
            chatInput.value = `${transitState.verdictPlainText}${extra}\nAjuda'm a organitzar-me l'alarma o recordatori per sortir puntual!`;
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

    window.askAliatMapsTransit = async function (forceDirectTransit = false) {
        const qInput = document.getElementById('daily-transit-question-input');
        const question = forceDirectTransit ? '' : (qInput ? qInput.value.trim() : '');
        if (!forceDirectTransit) transitState.question = question;
        transitState.needsPlaceSetup = null;
        transitState.setPlaceCandidates = [];
        transitState.loading = true;
        renderTransitResultsOnly();

        const originInput = document.getElementById('daily-transit-origin-input');
        const destInput = document.getElementById('daily-transit-dest-input');
        const timeInput = document.getElementById('daily-transit-time-input');
        const daySelect = document.getElementById('daily-transit-day-select');

        let originValText = originInput ? originInput.value.trim() : transitState.originAddress;
        let destValText = destInput ? destInput.value.trim() : transitState.destAddress;
        if (timeInput && timeInput.value) transitState.timeStr = timeInput.value;
        if (daySelect) transitState.dayOffset = parseInt(daySelect.value, 10) === 1 ? 1 : 0;

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
                    if (askJson.intent === 'followup') {
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
                            await window.setPlaceRoleFromCoords(role, cands[0].lat, cands[0].lng, role === 'home' ? 'Casa' : 'Institut / Universitat', cands[0].formattedAddress || cands[0].displayName);
                            return;
                        }
                        transitState.setPlaceCandidates = cands;
                        transitState.routes = [];
                        transitState.verdictHtml = cands.length === 0
                            ? `<div class="flex items-start gap-2">${iconSvg('warn', 'w-4 h-4 text-amber-600 shrink-0 mt-0.5')}<span>No s'ha trobat l'adreça "${esc(askJson.query || question)}". Prova d'escriure el carrer i ciutat o prem "Marcar al mapa" a la targeta de Casa.</span></div>`
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

        // Apply parsed natural-language constraints onto structured inputs
        if (parsedMeta) {
            transitState.lang = parsedMeta.language || transitState.lang;
            transitState.dayOffset = parsedMeta.dayOffset === 1 ? 1 : 0;
            transitState.autoShiftedToTomorrow = Boolean(parsedMeta.autoShiftedToTomorrow);
            transitState.arrivalSlightlyBefore = Boolean(parsedMeta.arrivalSlightlyBefore);

            if (Array.isArray(parsedMeta.allowedModes) && parsedMeta.allowedModes.length > 0) {
                if (parsedMeta.allowedModes.includes('BUS') && parsedMeta.allowedModes.length === 1) transitState.modeFilter = 'BUS';
                else if (parsedMeta.allowedModes.includes('RAIL')) transitState.modeFilter = 'RAIL';
                else if (parsedMeta.allowedModes.includes('SUBWAY')) transitState.modeFilter = 'SUBWAY';
                else transitState.modeFilter = 'ALL';
            }

            if (typeof parsedMeta.departureHour === 'number') {
                transitState.timeMode = 'departure';
                transitState.timeStr = `${pad2(parsedMeta.departureHour)}:${pad2(parsedMeta.departureMinute || 0)}`;
            }
            if (typeof parsedMeta.arrivalHour === 'number') {
                transitState.deadlineTimeStr = `${pad2(parsedMeta.arrivalHour)}:${pad2(parsedMeta.arrivalMinute || 0)}`;
                if (typeof parsedMeta.departureHour !== 'number') {
                    transitState.timeMode = 'arrival';
                    transitState.timeStr = transitState.deadlineTimeStr;
                }
            } else if (typeof parsedMeta.departureHour === 'number') {
                transitState.deadlineTimeStr = '';
            }

            // Resolve Origin from saved places or hint
            if (parsedMeta.matchedOriginPlaceId) {
                const sp = loadSavedEverydayPlaces().find((x) => x.id === parsedMeta.matchedOriginPlaceId);
                if (sp) {
                    transitState.originMode = 'saved';
                    transitState.originCoords = { lat: sp.lat, lng: sp.lng };
                    transitState.originAddress = sp.address || sp.title;
                    transitState.originLabel = sp.title;
                    originValText = sp.address || sp.title;
                }
            } else if (parsedMeta.originType === 'saved_home' && !originValText) {
                transitState.needsPlaceSetup = { missingHome: true, missingSchool: false };
            } else if (parsedMeta.originHint && !originValText) {
                originValText = parsedMeta.originHint;
                transitState.originCoords = null;
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
            } else if (parsedMeta.destinationType === 'saved_school' && !destValText) {
                transitState.needsPlaceSetup = {
                    ...(transitState.needsPlaceSetup || {}),
                    missingSchool: true
                };
            } else if (parsedMeta.destinationHint && !destValText) {
                destValText = parsedMeta.destinationHint;
                transitState.destCoords = null;
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

        let routes = await fetchTransitRoutesSmart({
            origin: originWp,
            destination: destWp,
            departureTime: transitState.timeMode === 'departure' ? targetDate.toISOString() : undefined,
            arrivalTime: transitState.timeMode === 'arrival' ? targetDate.toISOString() : undefined,
            allowedTravelModes: allowedModes,
            languageCode: lang
        });

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
                routes = [...earlierRoutes.map((r, i) => ({ ...r, index: i, recommendedEarlier: true })), ...routes.map((r, i) => ({ ...r, index: i + earlierRoutes.length }))];
            }
        }

        transitState.loading = false;
        transitState.routes = routes;
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
            await window.drawTransitRouteOnMap(transitState.selectedRouteIdx);
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
        return `
            <div class="p-3 rounded-2xl bg-indigo-50/80 dark:bg-indigo-950/30 border border-indigo-200/90 dark:border-indigo-800/70 space-y-2">
                <div class="flex items-center justify-between gap-2">
                    <span class="text-[10.5px] font-extrabold uppercase tracking-wider text-indigo-700 dark:text-indigo-300 inline-flex items-center gap-1.5">${iconSvg('chat', 'w-3.5 h-3.5')}<span>Comentaris sobre aquesta ruta</span></span>
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
            resBox.innerHTML = `
                <div class="p-3.5 rounded-2xl bg-zinc-100/80 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 text-[11px] text-zinc-600 dark:text-zinc-400 space-y-2">
                    <div class="font-extrabold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">${iconSvg('lightbulb', 'w-3.5 h-3.5 text-blue-600')}<span>Com fer servir AliatMaps en 3 passos</span></div>
                    <div class="space-y-1.5">
                        <div class="flex items-start gap-2"><span class="w-4 h-4 rounded-md bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 text-[10px] font-black inline-flex items-center justify-center shrink-0 mt-0.5">1</span><span>Desa <strong>Casa</strong> i <strong>Insti</strong> a dalt (es guarden al teu compte).</span></div>
                        <div class="flex items-start gap-2"><span class="w-4 h-4 rounded-md bg-blue-600/15 text-blue-700 dark:text-sky-300 text-[10px] font-black inline-flex items-center justify-center shrink-0 mt-0.5">2</span><span>Escriu la pregunta com parles o tria <strong>Origen i Destinació</strong>.</span></div>
                        <div class="flex items-start gap-2"><span class="w-4 h-4 rounded-md bg-indigo-600/15 text-indigo-700 dark:text-indigo-300 text-[10px] font-black inline-flex items-center justify-center shrink-0 mt-0.5">3</span><span>Quan surti la ruta, pregunta dubtes de seguiment (on baixar, transbords o temps a peu).</span></div>
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
            <div class="p-3.5 rounded-2xl border ${statusClasses} space-y-2 shadow-2xs">
                <div class="text-xs leading-relaxed">${transitState.verdictHtml}</div>
                ${transitState.verdictPlainText ? `
                <div class="flex items-center justify-between gap-2 pt-1.5 border-t border-black/10 dark:border-white/10">
                    <span class="text-[10px] font-bold opacity-75">Dades oficials Google Maps Transit</span>
                    <button type="button" onclick="window.sendTransitResultToChat()" class="px-2.5 py-1 rounded-lg bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 text-white dark:text-zinc-900 text-[10.5px] font-extrabold cursor-pointer inline-flex items-center gap-1">
                        ${iconSvg('chat', 'w-3 h-3')}<span>Enviar al xat</span>
                    </button>
                </div>` : ''}
            </div>
        ` : '';

        const routesHtml = (transitState.routes || []).map((route, idx) => {
            const isSelected = idx === transitState.selectedRouteIdx;
            const badgesHtml = route.steps.map((s) => {
                if (!s.isTransit) {
                    return `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-[10px] font-bold">${iconSvg('walk', 'w-3 h-3')}<span>${esc(s.durationText || `${Math.max(1, Math.round(s.durationSec / 60))}m`)}</span></span>`;
                }
                return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-black shadow-2xs" style="background-color:${esc(s.lineColor || '#2563eb')};color:${esc(s.lineTextColor || '#ffffff')}">${vehicleSvg(s.vehicleType, 'w-3 h-3')}<span>${esc(s.lineShort)}</span></span>`;
            }).join('<span class="text-zinc-400 text-[10px] mx-0.5">›</span>');

            const stepsDetailHtml = isSelected ? `
                <div class="mt-2.5 pt-2.5 border-t border-zinc-200/80 dark:border-zinc-800 space-y-2">
                    ${route.steps.map((s) => {
                        if (!s.isTransit) {
                            return `
                                <div class="flex items-start gap-2 text-[11px] text-zinc-600 dark:text-zinc-400">
                                    <span class="shrink-0 mt-0.5 text-zinc-500">${iconSvg('walk', 'w-3.5 h-3.5')}</span>
                                    <div class="min-w-0 flex-1">
                                        <span class="font-bold text-zinc-800 dark:text-zinc-200">Camina ${esc(s.durationText || '')}</span>
                                        ${s.distanceText ? `<span>(${esc(s.distanceText)})</span>` : ''}
                                        ${s.instruction ? `<span class="block text-[10px] text-zinc-500">${esc(s.instruction)}</span>` : ''}
                                    </div>
                                </div>
                            `;
                        }
                        return `
                            <div class="p-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-950 border border-zinc-200/80 dark:border-zinc-800 space-y-1">
                                <div class="flex items-center justify-between gap-2">
                                    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-black" style="background-color:${esc(s.lineColor || '#2563eb')};color:${esc(s.lineTextColor || '#ffffff')}">
                                        ${vehicleSvg(s.vehicleType, 'w-3 h-3')}<span>${esc(s.lineShort)}</span>
                                    </span>
                                    <span class="text-[10.5px] font-bold text-zinc-500 dark:text-zinc-400 tabular-nums">${s.stopCount ? `${s.stopCount} parades · ` : ''}${esc(s.durationText || '')}</span>
                                </div>
                                ${s.headsign ? `<div class="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">Direcció: ${esc(s.headsign)}</div>` : ''}
                                <div class="text-[11px] text-zinc-800 dark:text-zinc-200 space-y-1 tabular-nums pt-0.5">
                                    <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span><span><strong>${esc(s.departureTimeText)}</strong> · Puja a <strong>${esc(s.departureStopName)}</strong></span></div>
                                    <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-blue-600 shrink-0"></span><span><strong>${esc(s.arrivalTimeText)}</strong> · Baixa a <strong>${esc(s.arrivalStopName)}</strong></span></div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                    <div class="text-[10px] text-zinc-400 pt-0.5 flex items-center gap-1">${iconSvg('warn', 'w-3 h-3 text-amber-500')}<span>Els trams a peu són orientatius.</span></div>
                </div>
            ` : '';

            return `
                <div onclick="window.drawTransitRouteOnMap(${idx})" class="p-3 rounded-2xl bg-white dark:bg-zinc-900 border ${isSelected ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-zinc-200/90 dark:border-zinc-800 hover:border-blue-400'} transition cursor-pointer space-y-1.5 shadow-2xs">
                    <div class="flex items-center justify-between gap-2">
                        <div class="text-xs sm:text-sm font-black text-zinc-900 dark:text-white tabular-nums inline-flex items-center gap-1.5">
                            <span>${esc(route.departureTimeText)}</span>
                            ${iconSvg('arrowRight', 'w-3.5 h-3.5 text-zinc-400')}
                            <span>${esc(route.arrivalTimeText)}</span>
                        </div>
                        <div class="flex items-center gap-1.5">
                            ${route.recommendedEarlier ? `<span class="px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[9.5px] font-extrabold">Recomanada</span>` : ''}
                            <span class="px-2 py-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-[10.5px] font-extrabold tabular-nums">${esc(route.durationText)}</span>
                        </div>
                    </div>
                    <div class="flex flex-wrap items-center gap-1 pt-0.5">${badgesHtml}</div>
                    ${stepsDetailHtml}
                </div>
            `;
        }).join('');

        resBox.innerHTML = `${transitState.loading ? loadingBannerHtml : ''}${verdictCardHtml}${renderFollowupThreadHtml()}<div class="space-y-2">${routesHtml}</div>`;
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
        const syncBadgeHtml = transitState.placesSyncedWithAccount
            ? `<span class="px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[9.5px] font-bold inline-flex items-center gap-1">${iconSvg('cloud', 'w-3 h-3')}<span>Compte</span></span>`
            : '';

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
            <div class="p-3.5 rounded-2xl ${hasFollowupTarget ? 'bg-indigo-50/75 dark:bg-indigo-950/30 border-indigo-200/90 dark:border-indigo-800/70' : 'bg-blue-50/80 dark:bg-blue-950/35 border-blue-200/90 dark:border-blue-800/70'} border space-y-2.5">
                <div class="flex items-center justify-between gap-2">
                    <span class="text-xs font-extrabold text-zinc-900 dark:text-white flex items-center gap-1.5">
                        ${iconSvg(hasFollowupTarget ? 'chat' : 'spark', `w-3.5 h-3.5 ${hasFollowupTarget ? 'text-indigo-600 dark:text-indigo-400' : 'text-blue-600 dark:text-sky-400'}`)}
                        <span>${hasFollowupTarget ? 'Comenta sobre aquesta ruta' : 'Pregunta el que necessitis'}</span>
                    </span>
                    ${hasFollowupTarget
                        ? `<button type="button" onclick="window.resetAliatTransitSession()" class="text-[10.5px] font-bold text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 cursor-pointer inline-flex items-center gap-1">${iconSvg('refresh', 'w-3 h-3')}<span>Nova consulta</span></button>`
                        : `<span class="text-[10px] font-bold text-blue-700 dark:text-sky-300">IA + Horaris reals</span>`
                    }
                </div>
                <textarea id="daily-transit-question-input" rows="2" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();window.askAliatMapsTransit();}" placeholder="${esc(promptPlaceholder)}" class="w-full px-3 py-2 rounded-xl border border-zinc-200/90 dark:border-zinc-700/80 bg-white dark:bg-zinc-950 text-xs text-zinc-900 dark:text-zinc-100 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500">${esc(transitState.question)}</textarea>
                <div class="flex flex-wrap items-center justify-between gap-1.5">
                    <div class="flex flex-wrap items-center gap-1">
                        ${hasFollowupTarget ? `
                            <button type="button" onclick="window.askTransitFollowupChip('On he de baixar exactament?')" class="px-2 py-1 rounded-lg bg-white/90 dark:bg-zinc-900 border border-indigo-200/80 dark:border-zinc-700 text-[10px] font-bold text-indigo-700 dark:text-indigo-300 cursor-pointer hover:bg-indigo-50">On baixo?</button>
                            <button type="button" onclick="window.askTransitFollowupChip('Quant es camina en total?')" class="px-2 py-1 rounded-lg bg-white/90 dark:bg-zinc-900 border border-indigo-200/80 dark:border-zinc-700 text-[10px] font-bold text-indigo-700 dark:text-indigo-300 cursor-pointer hover:bg-indigo-50">Quant es camina?</button>
                        ` : `
                            <button type="button" onclick="window.runTransitExamplePrompt('school')" class="px-2 py-1 rounded-lg bg-white/90 dark:bg-zinc-900 border border-blue-200/80 dark:border-zinc-700 text-[10px] font-bold text-blue-700 dark:text-sky-300 cursor-pointer hover:bg-blue-100/60 inline-flex items-center gap-1">${iconSvg('bus', 'w-3 h-3')}<span>8h &lt; 9h</span></button>
                            <button type="button" onclick="window.runTransitExamplePrompt('train')" class="px-2 py-1 rounded-lg bg-white/90 dark:bg-zinc-900 border border-blue-200/80 dark:border-zinc-700 text-[10px] font-bold text-blue-700 dark:text-sky-300 cursor-pointer hover:bg-blue-100/60 inline-flex items-center gap-1">${iconSvg('train', 'w-3 h-3')}<span>Proper bus/tren</span></button>
                            <button type="button" onclick="window.runTransitExamplePrompt('explore')" class="px-2 py-1 rounded-lg bg-white/90 dark:bg-zinc-900 border border-teal-300/80 dark:border-teal-800 text-[10px] font-bold text-teal-700 dark:text-teal-300 cursor-pointer hover:bg-teal-50 inline-flex items-center gap-1">${iconSvg('compass', 'w-3 h-3')}<span>Què fer a prop</span></button>
                        `}
                    </div>
                    <button type="button" onclick="window.askAliatMapsTransit()" class="px-3.5 py-2 rounded-xl ${hasFollowupTarget ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-blue-600 hover:bg-blue-500'} text-white text-xs font-extrabold transition cursor-pointer shrink-0 shadow-2xs inline-flex items-center gap-1.5">
                        ${iconSvg(hasFollowupTarget ? 'chat' : 'spark', 'w-3.5 h-3.5')}<span>${hasFollowupTarget ? 'Preguntar' : 'Consultar IA'}</span>
                    </button>
                </div>
            </div>
        `;

        const manualCardHtml = `
            <div class="p-3.5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 space-y-2.5">
                <div class="flex items-center justify-between gap-2">
                    <span class="text-xs font-extrabold text-zinc-900 dark:text-white flex items-center gap-1.5">
                        ${iconSvg('clock', 'w-3.5 h-3.5 text-blue-600 dark:text-sky-400')}
                        <span>Cerca d'horari Origen i Destinació</span>
                    </span>
                    <button type="button" onclick="window.swapAliatTransitPoints()" title="Intercanviar origen i destinació" class="px-2 py-1 rounded-lg bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-[10px] font-bold text-zinc-700 dark:text-zinc-200 cursor-pointer inline-flex items-center gap-1">
                        ${iconSvg('swap', 'w-3 h-3')}<span>Invertir</span>
                    </button>
                </div>

                <div class="space-y-2">
                    <div>
                        <div class="flex items-center justify-between gap-1 mb-1">
                            <label class="text-[10px] font-extrabold uppercase text-zinc-400">Sortida (Origen)</label>
                            <div class="flex items-center gap-1">
                                <button type="button" onclick="window.applyTransitPresetOrigin('current')" class="px-2 py-0.5 rounded-md text-[10px] font-bold cursor-pointer inline-flex items-center gap-1 ${transitState.originMode === 'current' ? 'bg-blue-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'}">${iconSvg('gps', 'w-3 h-3')}<span>Ara</span></button>
                                <button type="button" onclick="window.applyTransitPresetOrigin('home')" class="px-2 py-0.5 rounded-md text-[10px] font-bold cursor-pointer inline-flex items-center gap-1 ${transitState.originMode === 'saved' ? 'bg-blue-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300'}">${iconSvg('home', 'w-3 h-3')}<span>Casa</span></button>
                            </div>
                        </div>
                        <input id="daily-transit-origin-input" type="text" value="${esc(transitState.originAddress)}" oninput="window.updateTransitOriginInput(this.value)" onchange="window.updateTransitOriginInput(this.value)" placeholder="GPS actual o escriu carrer/estació d'origen..." class="w-full px-2.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-800 dark:text-zinc-100">
                    </div>

                    <div>
                        <div class="flex items-center justify-between gap-1 mb-1">
                            <label class="text-[10px] font-extrabold uppercase text-zinc-400">Destinació (o clic al mapa)</label>
                            <div class="flex items-center gap-1">
                                <button type="button" onclick="window.applyTransitPresetDest('school')" class="px-2 py-0.5 rounded-md text-[10px] font-bold cursor-pointer inline-flex items-center gap-1 ${transitState.destMode === 'saved' && schoolSaved && transitState.destAddress === (schoolSaved.address || schoolSaved.title) ? 'bg-indigo-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'}">${iconSvg('school', 'w-3 h-3')}<span>Insti</span></button>
                                ${workSaved ? `<button type="button" onclick="window.applyTransitPresetDest('work')" class="px-2 py-0.5 rounded-md text-[10px] font-bold cursor-pointer bg-zinc-100 hover:bg-blue-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 inline-flex items-center gap-1">${iconSvg('work', 'w-3 h-3')}<span>Feina</span></button>` : ''}
                            </div>
                        </div>
                        <input id="daily-transit-dest-input" type="text" value="${esc(transitState.destAddress)}" oninput="window.updateTransitDestInput(this.value)" onchange="window.updateTransitDestInput(this.value)" placeholder="Escriu parada, estació, institut o adreça..." class="w-full px-2.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-xs text-zinc-800 dark:text-zinc-100">
                    </div>
                </div>

                <div class="grid grid-cols-12 gap-1.5 items-end pt-1">
                    <div class="col-span-5">
                        <label class="block text-[10px] font-bold uppercase text-zinc-400 mb-1">Quan</label>
                        <select onchange="window.setTransitTimeMode(this.value)" class="w-full px-2 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-[11px] font-bold text-zinc-800 dark:text-zinc-100">
                            <option value="departure" ${transitState.timeMode === 'departure' ? 'selected' : ''}>Sortir a les</option>
                            <option value="arrival" ${transitState.timeMode === 'arrival' ? 'selected' : ''}>Arribar abans de</option>
                        </select>
                    </div>
                    <div class="col-span-4">
                        <label class="block text-[10px] font-bold uppercase text-zinc-400 mb-1">Hora</label>
                        <input id="daily-transit-time-input" type="time" value="${esc(transitState.timeStr)}" onchange="window.updateTransitTimeInput(this.value)" class="w-full px-2 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-[11px] font-bold text-zinc-800 dark:text-zinc-100 tabular-nums">
                    </div>
                    <div class="col-span-3">
                        <label class="block text-[10px] font-bold uppercase text-zinc-400 mb-1">Dia</label>
                        <select id="daily-transit-day-select" onchange="window.updateTransitDayOffset(this.value)" class="w-full px-2 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 text-[11px] font-bold text-zinc-800 dark:text-zinc-100">
                            <option value="0" ${transitState.dayOffset === 0 ? 'selected' : ''}>Avui</option>
                            <option value="1" ${transitState.dayOffset === 1 ? 'selected' : ''}>Demà</option>
                        </select>
                    </div>
                </div>

                <div class="grid grid-cols-4 gap-1">
                    <button type="button" onclick="window.setTransitModeFilter('ALL')" class="py-1.5 rounded-xl text-[10.5px] font-bold border cursor-pointer ${transitState.modeFilter === 'ALL' ? 'bg-blue-600 text-white border-blue-600' : 'bg-zinc-50 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800'}">Tot</button>
                    <button type="button" onclick="window.setTransitModeFilter('BUS')" class="py-1.5 rounded-xl text-[10.5px] font-bold border cursor-pointer inline-flex items-center justify-center gap-1 ${transitState.modeFilter === 'BUS' ? 'bg-blue-600 text-white border-blue-600' : 'bg-zinc-50 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800'}">${iconSvg('bus', 'w-3 h-3')}<span>Bus</span></button>
                    <button type="button" onclick="window.setTransitModeFilter('RAIL')" class="py-1.5 rounded-xl text-[10.5px] font-bold border cursor-pointer inline-flex items-center justify-center gap-1 ${transitState.modeFilter === 'RAIL' ? 'bg-blue-600 text-white border-blue-600' : 'bg-zinc-50 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800'}">${iconSvg('train', 'w-3 h-3')}<span>Tren</span></button>
                    <button type="button" onclick="window.setTransitModeFilter('SUBWAY')" class="py-1.5 rounded-xl text-[10.5px] font-bold border cursor-pointer inline-flex items-center justify-center gap-1 ${transitState.modeFilter === 'SUBWAY' ? 'bg-blue-600 text-white border-blue-600' : 'bg-zinc-50 dark:bg-zinc-950 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-800'}">${iconSvg('metro', 'w-3 h-3')}<span>Metro</span></button>
                </div>

                <button type="button" onclick="window.askAliatMapsTransit(true)" class="w-full py-2.5 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-white text-white dark:text-zinc-900 text-xs font-extrabold transition cursor-pointer inline-flex items-center justify-center gap-1.5 shadow-2xs">
                    ${iconSvg('search', 'w-3.5 h-3.5')}<span>Cercar horaris de bus i tren</span>
                </button>
            </div>
        `;

        box.innerHTML = `
            <div class="space-y-3">
                <!-- Llocs habituals (Casa & Insti) -->
                <div class="space-y-2">
                    <div class="flex items-center justify-between px-0.5">
                        <span class="text-[10.5px] font-extrabold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Els teus llocs habituals</span>
                        ${syncBadgeHtml}
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <button type="button" onclick="window.openPlaceRoleEditor('home')" class="p-2.5 rounded-2xl border text-left transition cursor-pointer flex items-center gap-2 min-w-0 ${editingRole === 'home' ? 'ring-2 ring-emerald-500/40 border-emerald-500' : (homeSaved ? 'bg-emerald-50/70 dark:bg-emerald-950/25 border-emerald-200/80 dark:border-emerald-800/70' : 'bg-white dark:bg-zinc-900 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-emerald-400')}">
                            <span class="w-7 h-7 rounded-xl ${homeSaved ? 'bg-emerald-600 text-white' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'} flex items-center justify-center shrink-0">${iconSvg('home', 'w-3.5 h-3.5')}</span>
                            <div class="min-w-0 flex-1">
                                <div class="text-[10.5px] font-extrabold text-zinc-900 dark:text-white flex items-center justify-between gap-1">
                                    <span>${homeSaved ? 'Casa' : 'Fixar Casa'}</span>
                                    ${homeSaved ? iconSvg('edit', 'w-2.5 h-2.5 text-zinc-400 shrink-0') : ''}
                                </div>
                                <div class="text-[10px] text-zinc-500 dark:text-zinc-400 truncate">${homeSaved ? esc(homeSaved.address || homeSaved.title) : 'GPS, carrer o mapa'}</div>
                            </div>
                        </button>
                        <button type="button" onclick="window.openPlaceRoleEditor('school')" class="p-2.5 rounded-2xl border text-left transition cursor-pointer flex items-center gap-2 min-w-0 ${editingRole === 'school' ? 'ring-2 ring-indigo-500/40 border-indigo-500' : (schoolSaved ? 'bg-indigo-50/70 dark:bg-indigo-950/25 border-indigo-200/80 dark:border-indigo-800/70' : 'bg-white dark:bg-zinc-900 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-indigo-400')}">
                            <span class="w-7 h-7 rounded-xl ${schoolSaved ? 'bg-indigo-600 text-white' : 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300'} flex items-center justify-center shrink-0">${iconSvg('school', 'w-3.5 h-3.5')}</span>
                            <div class="min-w-0 flex-1">
                                <div class="text-[10.5px] font-extrabold text-zinc-900 dark:text-white flex items-center justify-between gap-1">
                                    <span>${schoolSaved ? 'Insti' : 'Fixar Insti'}</span>
                                    ${schoolSaved ? iconSvg('edit', 'w-2.5 h-2.5 text-zinc-400 shrink-0') : ''}
                                </div>
                                <div class="text-[10px] text-zinc-500 dark:text-zinc-400 truncate">${schoolSaved ? esc(schoolSaved.address || schoolSaved.title) : 'Centre o feina'}</div>
                            </div>
                        </button>
                    </div>
                    ${inlineEditorHtml}
                </div>

                <!-- Selector clar entre Preguntar amb IA o Cercar horari manual -->
                <div class="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-zinc-200/60 dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800">
                    <button type="button" onclick="window.setTransitInputMode('ai')" class="py-1.5 px-2.5 rounded-xl text-[11px] font-extrabold transition cursor-pointer inline-flex items-center justify-center gap-1.5 ${transitState.inputMode !== 'manual' ? 'bg-white dark:bg-zinc-800 text-blue-700 dark:text-sky-300 shadow-2xs' : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'}">
                        ${iconSvg('spark', 'w-3.5 h-3.5')}<span>Pregunta amb IA</span>
                    </button>
                    <button type="button" onclick="window.setTransitInputMode('manual')" class="py-1.5 px-2.5 rounded-xl text-[11px] font-extrabold transition cursor-pointer inline-flex items-center justify-center gap-1.5 ${transitState.inputMode === 'manual' ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-2xs' : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'}">
                        ${iconSvg('clock', 'w-3.5 h-3.5')}<span>Horari manual</span>
                    </button>
                </div>

                ${transitState.inputMode === 'manual' ? manualCardHtml : aiCardHtml}

                <!-- Resultats immediats a sota sense haver de fer scroll -->
                <div id="daily-transit-results-box" class="space-y-2"></div>
            </div>
        `;
        renderTransitResultsOnly();
    }

    window.switchDailyMapsTab = function (tab) {
        activeTab = tab || 'transit';
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
    };
    window.openAliatMapsModal = window.openDailyMapsModal;

    window.closeDailyMapsModal = function () {
        const modal = document.getElementById('daily-maps-modal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    };
})();
