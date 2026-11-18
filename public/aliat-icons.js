/**
 * Aliat Intel·ligent — Custom Geometric SVG Symbol System
 * Replaces generic unicode emojis across AliatMaps, Study Lab, Notebook, and App UI.
 */
(function () {
    'use strict';

    const ICON_PATHS = {
        // --- Maps & Mobility ---
        pin: '<path d="M12 21s-6-5.6-6-11a6 6 0 1 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
        map: '<polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/>',
        compass: '<circle cx="12" cy="12" r="9"/><polygon points="15.8 8.2 13.7 13.7 8.2 15.8 10.3 10.3 15.8 8.2"/>',
        gps: '<circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>',
        transit: '<rect x="5" y="3" width="14" height="14" rx="3"/><line x1="5" y1="10" x2="19" y2="10"/><line x1="12" y1="3" x2="12" y2="10"/><circle cx="8.5" cy="13.5" r="1"/><circle cx="15.5" cy="13.5" r="1"/><path d="M8 17l-2 4"/><path d="M16 17l2 4"/>',
        bus: '<rect x="4" y="4" width="16" height="13" rx="2.5"/><line x1="4" y1="11" x2="20" y2="11"/><circle cx="8" cy="19" r="1.5"/><circle cx="16" cy="19" r="1.5"/><line x1="8" y1="4" x2="8" y2="11"/><line x1="16" y1="4" x2="16" y2="11"/>',
        train: '<rect x="6" y="3" width="12" height="14" rx="3"/><line x1="6" y1="11" x2="18" y2="11"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/><path d="M8 17l-2.5 4"/><path d="M16 17l2.5 4"/><line x1="10" y1="6.5" x2="14" y2="6.5"/>',
        metro: '<rect x="5" y="4" width="14" height="13" rx="6 6 2 2"/><path d="M8.5 12V8.5L12 11.5L15.5 8.5V12"/><circle cx="8.5" cy="14.5" r="0.8"/><circle cx="15.5" cy="14.5" r="0.8"/><path d="M7 17l-2 4"/><path d="M17 17l2 4"/>',
        tram: '<rect x="6" y="5" width="12" height="12" rx="2.5"/><path d="M12 2v3"/><path d="M8.5 2h7"/><line x1="6" y1="11" x2="18" y2="11"/><circle cx="9" cy="14" r="0.9"/><circle cx="15" cy="14" r="0.9"/><path d="M8 17l-2 4"/><path d="M16 17l2 4"/>',
        ferry: '<path d="M3 16l2.5-6h13l2.5 6"/><path d="M7 10V5h10v5"/><path d="M2 19c1.5 1.2 3 1.2 4.5 0s3-1.2 4.5 0 3 1.2 4.5 0 3-1.2 4.5 0"/>',
        car: '<path d="M5 12l2-5h10l2 5"/><rect x="3" y="12" width="18" height="6" rx="2"/><circle cx="7" cy="18.5" r="1.5"/><circle cx="17" cy="18.5" r="1.5"/>',
        moto: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M9 17h4l3-7h2"/><path d="M11 10h4"/><path d="M6 14l4-2 2 5"/>',
        bike: '<circle cx="6.5" cy="16.5" r="3.5"/><circle cx="17.5" cy="16.5" r="3.5"/><path d="M6.5 16.5L10 9h4l3.5 7.5"/><path d="M10 9l2.5 7.5h5"/><path d="M14 6.5h2.5"/>',
        walk: '<circle cx="12.5" cy="5" r="2"/><path d="M10 21l2-6 3 2.5v3.5"/><path d="M12 9l-2 6-3.5 2"/><path d="M9.5 11l3-2 3.5 2.5"/>',
        home: '<path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M9.5 20v-6h5v6"/>',
        school: '<path d="M2 9l10-5 10 5-10 5-10-5z"/><path d="M6 11v5.5c0 1.8 2.7 3.5 6 3.5s6-1.7 6-3.5V11"/><path d="M22 9v6"/>',
        work: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="3" y1="12" x2="21" y2="12"/>',
        pharmacy: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8"/><path d="M8 12h8"/>',
        cart: '<circle cx="9" cy="19.5" r="1.5"/><circle cx="17" cy="19.5" r="1.5"/><path d="M3 4h2.5l2.2 10.5h10.8l2-7.5H6.5"/>',
        fuel: '<rect x="4" y="4" width="10" height="16" rx="1.5"/><line x1="6.5" y1="8.5" x2="11.5" y2="8.5"/><path d="M14 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0v-6l-2.5-2.5"/>',
        bolt: '<polygon points="13 2 4 14 11.5 14 10.5 22 20 10 12.5 10 13 2"/>',
        atm: '<rect x="3" y="5" width="18" height="14" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><rect x="7" y="13.5" width="4" height="2" rx="0.5"/>',
        coffee: '<path d="M5 8h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V8z"/><path d="M16 9.5h2a2.5 2.5 0 0 1 0 5h-2"/><path d="M8 3.5v2"/><path d="M12 3.5v2"/>',
        parking: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9.5 16V8h3.2a2.6 2.6 0 0 1 0 5.2H9.5"/>',
        gym: '<path d="M6.5 7v10"/><path d="M17.5 7v10"/><path d="M3.5 9.5v5"/><path d="M20.5 9.5v5"/><line x1="6.5" y1="12" x2="17.5" y2="12"/>',
        nearby: '<circle cx="12" cy="12" r="2.5"/><path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/><circle cx="12" cy="12" r="7.5" stroke-dasharray="3 3"/>',
        bookmark: '<path d="M6 4h12v17l-6-4-6 4V4z"/>',
        flag: '<path d="M5 21V4"/><path d="M5 4h12l-2.5 4.5L17 13H5"/>',

        // --- Common UI & Controls ---
        clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/>',
        timer: '<circle cx="12" cy="13" r="8"/><polyline points="12 9 12 13 14.5 14.5"/><line x1="9" y1="3" x2="15" y2="3"/><line x1="12" y1="3" x2="12" y2="5"/>',
        cloud: '<path d="M17.5 19H7a4.5 4.5 0 0 1-.4-9 6 6 0 0 1 11.6-1.2A4 4 0 0 1 17.5 19z"/>',
        search: '<circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.2" y2="16.2"/>',
        edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
        save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
        trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>',
        close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
        check: '<polyline points="20 6 9 17 4 12"/>',
        checkCircle: '<circle cx="12" cy="12" r="9"/><polyline points="8.5 12.5 11 15 15.5 9.5"/>',
        cross: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
        xCircle: '<circle cx="12" cy="12" r="9"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
        warn: '<path d="M10.3 3.9L1.8 18.1A2 2 0 0 0 3.5 21h17a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9.5" x2="12" y2="13.5"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
        star: '<polygon points="12 3 14.9 8.8 21.3 9.7 16.6 14.2 17.7 20.6 12 17.6 6.3 20.6 7.4 14.2 2.7 9.7 9.1 8.8 12 3"/>',
        external: '<path d="M14 4h6v6"/><line x1="10" y1="14" x2="20" y2="4"/><path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"/>',
        arrowRight: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/>',
        arrowLeft: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="11 6 5 12 11 18"/>',
        swap: '<polyline points="17 2 21 6 17 10"/><line x1="3" y1="6" x2="21" y2="6"/><polyline points="7 22 3 18 7 14"/><line x1="21" y1="18" x2="3" y2="18"/>',
        chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
        spark: '<path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z"/>',
        spinner: '<path d="M21 12a9 9 0 1 1-6.2-8.6"/>',
        target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
        statusDot: '<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>',

        // --- Study, Workspace & App Tools ---
        gamepad: '<rect x="2" y="6" width="20" height="12" rx="3"/><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><circle cx="15" cy="11" r="1"/><circle cx="17.5" cy="13" r="1"/>',
        notebook: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
        puzzle: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/>',
        pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
        numbers: '<line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
        detective: '<circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16" y2="16"/><line x1="11" y1="8" x2="11" y2="11.5"/><line x1="11" y1="14" x2="11.01" y2="14"/>',
        trophy: '<path d="M6 4h12v4a6 6 0 0 1-12 0V4z"/><path d="M6 6H3v2a3 3 0 0 0 3 3"/><path d="M18 6h3v2a3 3 0 0 1-3 3"/><line x1="12" y1="14" x2="12" y2="19"/><line x1="8" y1="19" x2="16" y2="19"/>',
        shuffle: '<polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>',
        calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
        folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>',
        mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="3 7 12 13 21 7"/>',
        doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="14" y2="17"/>',
        slides: '<rect x="3" y="4" width="18" height="13" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><polyline points="8 12 11 9 13 11 16 8"/>',
        sheet: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/>',
        brain: '<path d="M9.5 4.5a3.5 3.5 0 0 0-3.5 3.5 3.2 3.2 0 0 0-2 3 3.4 3.4 0 0 0 1.5 2.8A3.5 3.5 0 0 0 9 19.5h2.5v-15H9.5z"/><path d="M14.5 4.5A3.5 3.5 0 0 1 18 8a3.2 3.2 0 0 1 2 3 3.4 3.4 0 0 1-1.5 2.8A3.5 3.5 0 0 1 15 19.5h-2.5v-15h2z"/>',
        book: '<path d="M2 5.5A2.5 2.5 0 0 1 4.5 3H12v16H4.5A2.5 2.5 0 0 0 2 21V5.5z"/><path d="M22 5.5A2.5 2.5 0 0 0 19.5 3H12v16h7.5a2.5 2.5 0 0 1 2.5 2V5.5z"/>',
        mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><line x1="12" y1="18" x2="12" y2="21"/><line x1="9" y1="21" x2="15" y2="21"/>',
        volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
        mute: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/>',
        video: '<rect x="2" y="6" width="14" height="12" rx="2"/><polygon points="22 8 16 12 22 16 22 8"/>',
        camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
        bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
        lightbulb: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M15.1 14c.8-.9 1.9-2.2 1.9-4a5 5 0 1 0-10 0c0 1.8 1.1 3.1 1.9 4 .4.5.6 1.1.6 1.8h5c0-.7.2-1.3.6-1.8z"/>',
        rocket: '<path d="M4.5 16.5c-1.5 1.3-2 4.5-2 4.5s3.2-.5 4.5-2c.7-.7.7-1.9 0-2.6-.7-.7-1.8-.7-2.5.1z"/><path d="M12 15l-3-3a22 22 0 0 1 2-9 22 22 0 0 1 9 2 22 22 0 0 1-2 9l-3 3"/><circle cx="15" cy="9" r="1.2"/>',
        fire: '<path d="M12 2c.5 3.5-2 5.5-2 8.5a2 2 0 0 0 4 0c0-1.5-.8-2.5-.8-2.5 2.8 1.5 4.8 4.2 4.8 7a6 6 0 0 1-12 0c0-3.8 2.5-7 6-13z"/>',
        settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .3 1.8l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.65 1.65 0 0 0-1.8-.3 1.65 1.65 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.65 1.65 0 0 0-1-1.5 1.65 1.65 0 0 0-1.8.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1.65 1.65 0 0 0 .3-1.8 1.65 1.65 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.65 1.65 0 0 0 1.5-1 1.65 1.65 0 0 0-.3-1.8l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1a1.65 1.65 0 0 0 1.8.3h.1a1.65 1.65 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.65 1.65 0 0 0 1 1.5 1.65 1.65 0 0 0 1.8-.3l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.65 1.65 0 0 0-.3 1.8v.1a1.65 1.65 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.65 1.65 0 0 0-1.5 1z"/>',
        lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
        chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
        broom: '<path d="M19 3l-8.5 8.5"/><path d="M5 13l6 6 2.5-2.5-6-6L5 13z"/><path d="M3 21l3.5-3.5"/>',
        refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/>',
        plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
        upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
        clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
        palette: '<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="15.5" cy="10" r="1"/><path d="M15.5 14.5a2 2 0 0 1-2 2h-1a1.5 1.5 0 0 0-1.5 1.5"/>',
        scale: '<line x1="12" y1="3" x2="12" y2="20"/><line x1="6" y1="20" x2="18" y2="20"/><line x1="4" y1="7" x2="20" y2="7"/><path d="M4 7l-2 6h4l-2-6z"/><path d="M20 7l-2 6h4l-2-6z"/>',
        music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
        rain: '<path d="M17.5 15H7a4 4 0 0 1-.4-8 5.5 5.5 0 0 1 10.6-1A3.5 3.5 0 0 1 17.5 15z"/><line x1="8" y1="18" x2="7" y2="21"/><line x1="12" y1="18" x2="11" y2="21"/><line x1="16" y1="18" x2="15" y2="21"/>',
        waves: '<path d="M2 9c2 2 4 2 6 0s4-2 6 0 4 2 6 0"/><path d="M2 15c2 2 4 2 6 0s4-2 6 0 4 2 6 0"/>',
        leaf: '<path d="M17 4C9.5 4 4 9.5 4 17v3h3c7.5 0 13-5.5 13-13V4h-3z"/><path d="M4 20l9-9"/>',
        crown: '<path d="M3 18h18l-1.5-10-4.5 4-3-6-3 6-4.5-4L3 18z"/>',
        phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><line x1="11" y1="18" x2="13" y2="18"/>',
        layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 12 12 17 22 12"/><polyline points="2 17 12 22 22 17"/>',
        microscope: '<path d="M6 18h8"/><path d="M3 21h18"/><path d="M14 21a7 7 0 0 0 0-14h-1"/><path d="M9 14h2"/><path d="M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2Z"/><path d="M12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3"/>',
        dice: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/>',
        pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
        play: '<polygon points="6 4 20 12 6 20 6 4"/>',
        stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
        skipNext: '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>',
        trendUp: '<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
        box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><polyline points="3.3 7 12 12 20.7 7"/><line x1="12" y1="22" x2="12" y2="12"/>',
        dna: '<path d="M4 3c0 5 16 5 16 10s-16 5-16 8"/><path d="M20 3c0 5-16 5-16 10s16 5 16 8"/><line x1="7" y1="6" x2="17" y2="6"/><line x1="7" y1="18" x2="17" y2="18"/>',
        ruler: '<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><line x1="14.5" y1="12.5" x2="17" y2="10"/><line x1="11.5" y1="9.5" x2="14" y2="7"/><line x1="8.5" y1="6.5" x2="11" y2="4"/>',
        download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
        user: '<circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/>',
        eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
        celebrate: '<polygon points="12 2 14.5 9.5 22 12 14.5 14.5 12 22 9.5 14.5 2 12 9.5 9.5 12 2"/><circle cx="5" cy="5" r="1"/><circle cx="19" cy="19" r="1"/>',
        speakerLow: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 9.5a4 4 0 0 1 0 5"/>',
        badge: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14.5L7 22l5-2.5L17 22l-1.5-7.5"/>'
    };

    window.ALIAT_ICONS = ICON_PATHS;

    window.aliatSvg = function (name, cls) {
        const body = ICON_PATHS[name] || ICON_PATHS.spark;
        const safeCls = cls || 'w-4 h-4 shrink-0';
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline-block ${safeCls}" aria-hidden="true">${body}</svg>`;
    };

    window.hydrateAliatSvgIcons = function (root) {
        const scope = root && root.querySelectorAll ? root : document;
        const placeholders = scope.querySelectorAll('[data-aliat-icon]');
        placeholders.forEach((el) => {
            const name = el.getAttribute('data-aliat-icon');
            const cls = el.getAttribute('data-icon-class') || el.className || 'w-4 h-4 shrink-0';
            if (!name) return;
            el.innerHTML = window.aliatSvg(name, cls);
            el.removeAttribute('data-aliat-icon');
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => window.hydrateAliatSvgIcons(document));
    } else {
        window.hydrateAliatSvgIcons(document);
    }
})();
