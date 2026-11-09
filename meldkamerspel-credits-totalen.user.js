// ==UserScript==
// @name         Meldkamerspel Credits Totalen
// @namespace    meldkamerspel-credit-totalen
// @version      2.1.1
// @description  Live credit-totalen voor eigen, team- en eventinzetten, deelname en zichtbare meldingen.
// @author       Meldkamerspel Credits Totalen contributors
// @license      MIT
// @match        https://www.meldkamerspel.com/*
// @match        https://politie.meldkamerspel.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const PANEL_ID = 'mks-credit-totalen-v2';
    const formatCredits = new Intl.NumberFormat('nl-NL');

    function getCredits(entry) {
        try {
            const raw = entry.getAttribute('data-sortable-by');

            if (raw) {
                const data = JSON.parse(raw);
                const credits = Number(data.average_credits);

                if (Number.isFinite(credits)) {
                    return credits;
                }
            }
        } catch (error) {
            // Stil doorgaan naar fallback.
        }

        const possibleCreditElements = [
            ...entry.querySelectorAll(
                '.missionCredits, ' +
                '[class*="credit"], ' +
                '[class*="Credit"]'
            )
        ];

        for (const element of possibleCreditElements) {
            const text = element.textContent || '';
            const match = text.match(
                /(?:≈\s*)?([\d.]+)\s*(?:credits?|cr\b)?/i
            );

            if (match) {
                const value = Number(
                    match[1].replace(/\./g, '')
                );

                if (Number.isFinite(value)) {
                    return value;
                }
            }
        }

        return 0;
    }

    function isVisible(entry) {
        if (!entry.isConnected || entry.hidden) {
            return false;
        }

        if (
            entry.classList.contains('filterHide') ||
            entry.classList.contains('hidden')
        ) {
            return false;
        }

        const style = getComputedStyle(entry);

        if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            Number(style.opacity) === 0
        ) {
            return false;
        }

        return entry.getClientRects().length > 0;
    }

    function isParticipating(entry) {
        const missionId =
            entry.getAttribute('mission_id') ||
            entry.dataset.missionId;

        if (missionId) {
            const escaped = CSS.escape(String(missionId));

            const selectors = [
                `#mission_participant_${escaped}`,
                `[id="mission_participant_${escaped}"]`,
                '.mission_participant',
                '.mission-participant',
                '[data-mission-participant]'
            ];

            for (const selector of selectors) {
                const el = entry.querySelector(selector);

                if (!el) continue;

                const style = getComputedStyle(el);

                if (
                    !el.hidden &&
                    !el.classList.contains('hidden') &&
                    style.display !== 'none' &&
                    style.visibility !== 'hidden'
                ) {
                    return true;
                }
            }
        }

        const participation = (
            entry.getAttribute(
                'data-mission-participation-filter'
            ) || ''
        )
            .trim()
            .toLowerCase();

        if (participation === 'new') {
            return false;
        }

        if (
            participation === 'participating' ||
            participation === 'participated' ||
            participation === 'own' ||
            participation === 'yes' ||
            participation === 'true'
        ) {
            return true;
        }

        if (
            participation &&
            participation !== 'new' &&
            participation !== 'false' &&
            participation !== '0'
        ) {
            return true;
        }

        const classes = String(entry.className).toLowerCase();

        return (
            classes.includes('mission_participating') ||
            classes.includes('mission-participating') ||
            classes.includes('participant')
        );
    }

    function isEventMission(entry) {
        if (
            entry.closest(
                '#mission_list_alliance_event, ' +
                '#mission_list_alliance_event_missions, ' +
                '#mission_list_event, ' +
                '#mission_list_events, ' +
                '.alliance-event, ' +
                '.alliance_event, ' +
                '.event-mission, ' +
                '.event_mission'
            )
        ) {
            return true;
        }

        for (const attr of entry.attributes) {
            const name = attr.name.toLowerCase();
            const value = String(attr.value).toLowerCase();

            if (
                (
                    name.includes('event') ||
                    value.includes('alliance_event') ||
                    value.includes('alliance-event')
                ) &&
                value !== 'false' &&
                value !== '0' &&
                value !== ''
            ) {
                return true;
            }
        }

        const identity = [
            entry.id || '',
            entry.className || '',
            entry.parentElement?.id || '',
            entry.parentElement?.className || ''
        ]
            .join(' ')
            .toLowerCase();

        if (
            identity.includes('alliance_event') ||
            identity.includes('alliance-event') ||
            identity.includes('event_mission') ||
            identity.includes('event-mission')
        ) {
            return true;
        }

        const titleElement =
            entry.querySelector(
                '.missionSideBarEntryTitle, ' +
                '.mission_title, ' +
                '.mission-title'
            );

        const title = (
            titleElement?.textContent ||
            entry.textContent ||
            ''
        ).toLowerCase();

        return (
            title.includes('[event]') ||
            title.includes('[team-event]') ||
            title.includes('[teamevent]')
        );
    }

    function isTeamMission(entry) {
        if (isEventMission(entry)) {
            return false;
        }

        if (
            entry.closest(
                '#mission_list_alliance, ' +
                '.mission-alliance, ' +
                '.alliance-mission, ' +
                '.alliance_mission, ' +
                '[data-alliance-mission="true"], ' +
                '[data-shared-mission="true"]'
            )
        ) {
            return true;
        }

        for (const attr of entry.attributes) {
            const name = attr.name.toLowerCase();
            const value = String(attr.value).toLowerCase();

            if (
                (
                    name.includes('alliance') ||
                    name.includes('verband')
                ) &&
                !name.includes('event') &&
                !value.includes('event') &&
                value !== '' &&
                value !== '0' &&
                value !== 'false' &&
                value !== 'null'
            ) {
                return true;
            }
        }

        const identity = [
            entry.id || '',
            entry.className || '',
            entry.parentElement?.id || '',
            entry.parentElement?.className || ''
        ]
            .join(' ')
            .toLowerCase();

        return (
            (
                identity.includes('alliance') ||
                identity.includes('verband') ||
                identity.includes('shared-mission')
            ) &&
            !identity.includes('event')
        );
    }

    function getMissionType(entry) {
        if (isEventMission(entry)) {
            return 'event';
        }

        if (isTeamMission(entry)) {
            return 'team';
        }

        return 'own';
    }

    function getMissionEntries() {
        const candidates = [
            ...document.querySelectorAll(
                '.missionSideBarEntry[mission_id], ' +
                '[mission_id].mission_visibility, ' +
                '[mission_id][id^="mission_"]'
            )
        ];

        const seen = new Set();

        return candidates.filter(entry => {
            // Geplande inzetten hebben hun eigen teller in Meldkamerspel
            // en worden daarom bewust niet in dit dashboard meegeteld.
            if (
                entry.closest(
                    '#mission_list_sicherheitswache, ' +
                    '#mission_list_sicherheitswache_alliance'
                )
            ) {
                return false;
            }

            const id =
                entry.getAttribute('mission_id') ||
                entry.dataset.missionId;

            if (!id) {
                return false;
            }

            if (
                entry.classList.contains('mission_deleted') ||
                entry.classList.contains('deleted')
            ) {
                return false;
            }

            if (seen.has(String(id))) {
                return false;
            }

            seen.add(String(id));
            return true;
        });
    }

    function createEmptyTotals() {
        return {
            ownOpen: 0,
            ownOpenCount: 0,
            teamOpen: 0,
            teamOpenCount: 0,
            eventOpen: 0,
            eventOpenCount: 0,
            ownParticipating: 0,
            ownParticipatingCount: 0,
            teamParticipating: 0,
            teamParticipatingCount: 0,
            eventParticipating: 0,
            eventParticipatingCount: 0,
            visible: 0,
            visibleCount: 0
        };
    }

    function calculateTotals() {
        const totals = createEmptyTotals();
        const missions = getMissionEntries();

        for (const mission of missions) {
            const credits = getCredits(mission);
            const type = getMissionType(mission);
            const participating = isParticipating(mission);
            const visible = isVisible(mission);

            if (type === 'own') {
                totals.ownOpen += credits;
                totals.ownOpenCount++;
            }

            if (type === 'team') {
                totals.teamOpen += credits;
                totals.teamOpenCount++;
            }

            if (type === 'event') {
                totals.eventOpen += credits;
                totals.eventOpenCount++;
            }

            if (participating) {
                if (type === 'own') {
                    totals.ownParticipating += credits;
                    totals.ownParticipatingCount++;
                }

                if (type === 'team') {
                    totals.teamParticipating += credits;
                    totals.teamParticipatingCount++;
                }

                if (type === 'event') {
                    totals.eventParticipating += credits;
                    totals.eventParticipatingCount++;
                }
            }

            if (visible) {
                totals.visible += credits;
                totals.visibleCount++;
            }
        }

        return totals;
    }

    function createTile(icon, label, valueId, countId, extraClass = '') {
        return `
            <div class="mks-credit-item ${extraClass}">
                <span class="mks-credit-label">${icon} ${label}</span>
                <strong id="${valueId}">–</strong>
                <small id="${countId}"></small>
            </div>
        `;
    }

    function createPanel() {
        let panel = document.getElementById(PANEL_ID);

        if (panel) {
            return panel;
        }

        panel = document.createElement('div');
        panel.id = PANEL_ID;

        panel.innerHTML = `
            <div class="mks-credit-grid">

                ${createTile(
                    '🏠',
                    'Eigen open',
                    'mks-own-open',
                    'mks-own-open-count'
                )}

                ${createTile(
                    '👥',
                    'Team open',
                    'mks-team-open',
                    'mks-team-open-count'
                )}

                ${createTile(
                    '🎉',
                    'Event open',
                    'mks-event-open',
                    'mks-event-open-count',
                    'mks-event-tile'
                )}

                ${createTile(
                    '🏠',
                    'Eigen deelname',
                    'mks-own-participating',
                    'mks-own-participating-count'
                )}

                ${createTile(
                    '👤',
                    'Team deelname',
                    'mks-team-participating',
                    'mks-team-participating-count'
                )}

                ${createTile(
                    '🎉',
                    'Event deelname',
                    'mks-event-participating',
                    'mks-event-participating-count',
                    'mks-event-tile'
                )}

                <div class="mks-credit-summary">
                    <span class="mks-summary-label">👁 Zichtbaar</span>
                    <strong id="mks-visible">–</strong>
                    <small id="mks-visible-count"></small>
                </div>

            </div>
        `;

        const style = document.createElement('style');

        style.textContent = `
            #${PANEL_ID} {
                width: 100%;
                margin: 6px 0 8px 0;
            }

            #${PANEL_ID} .mks-credit-grid {
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 6px;
            }

            #${PANEL_ID} .mks-credit-grid.mks-no-event {
                grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            #${PANEL_ID} .mks-event-tile {
                display: block;
            }

            #${PANEL_ID} .mks-credit-grid.mks-no-event .mks-event-tile {
                display: none;
            }

            #${PANEL_ID} .mks-credit-item {
                min-width: 0;
                padding: 7px 10px;
                border: 1px solid rgba(127,127,127,.35);
                border-radius: 6px;
                background: rgba(127,127,127,.08);
            }

            #${PANEL_ID} .mks-credit-label {
                display: block;
                font-size: 12px;
                line-height: 16px;
                opacity: .78;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            #${PANEL_ID} strong {
                display: block;
                margin-top: 1px;
                font-size: 17px;
                line-height: 21px;
                white-space: nowrap;
            }

            #${PANEL_ID} small {
                display: block;
                margin-top: 1px;
                font-size: 11px;
                line-height: 14px;
                opacity: .65;
            }

            #${PANEL_ID} .mks-credit-summary {
                grid-column: 1 / -1;
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 4px 10px;
                border: 1px solid rgba(127,127,127,.35);
                border-radius: 5px;
                background: rgba(127,127,127,.12);
            }

            #${PANEL_ID} .mks-credit-summary .mks-summary-label {
                font-size: 12px;
                opacity: .75;
            }

            #${PANEL_ID} .mks-credit-summary strong {
                margin: 0;
                font-size: 14px;
                line-height: 18px;
            }

            #${PANEL_ID} .mks-credit-summary small {
                margin: 0;
                font-size: 11px;
                line-height: 18px;
                opacity: .65;
            }

            @media (max-width: 700px) {
                #${PANEL_ID} .mks-credit-grid {
                    grid-template-columns: 1fr;
                }

                #${PANEL_ID} .mks-credit-summary {
                    grid-column: auto;
                }
            }
        `;

        document.head.appendChild(style);

        const missionList =
            document.querySelector('#mission_list') ||
            document.querySelector('[id*="mission_list"]');

        if (missionList) {
            missionList.parentNode.insertBefore(
                panel,
                missionList
            );
        }

        return panel;
    }

    function setText(id, text) {
        const el = document.getElementById(id);

        if (el) {
            el.textContent = text;
        }
    }

    function setCreditTile(valueId, countId, credits, count) {
        setText(
            valueId,
            `${formatCredits.format(credits)} cr`
        );

        setText(
            countId,
            `${formatCredits.format(count)} ${
                count === 1 ? 'inzet' : 'inzetten'
            }`
        );
    }

    function updatePanel() {
        createPanel();

        const totals = calculateTotals();

        const grid = document.querySelector(
            `#${PANEL_ID} .mks-credit-grid`
        );

        if (grid) {
            grid.classList.toggle(
                'mks-no-event',
                totals.eventOpenCount === 0
            );
        }

        setCreditTile(
            'mks-own-open',
            'mks-own-open-count',
            totals.ownOpen,
            totals.ownOpenCount
        );

        setCreditTile(
            'mks-team-open',
            'mks-team-open-count',
            totals.teamOpen,
            totals.teamOpenCount
        );

        setCreditTile(
            'mks-event-open',
            'mks-event-open-count',
            totals.eventOpen,
            totals.eventOpenCount
        );

        setCreditTile(
            'mks-own-participating',
            'mks-own-participating-count',
            totals.ownParticipating,
            totals.ownParticipatingCount
        );

        setCreditTile(
            'mks-team-participating',
            'mks-team-participating-count',
            totals.teamParticipating,
            totals.teamParticipatingCount
        );

        setCreditTile(
            'mks-event-participating',
            'mks-event-participating-count',
            totals.eventParticipating,
            totals.eventParticipatingCount
        );

        setCreditTile(
            'mks-visible',
            'mks-visible-count',
            totals.visible,
            totals.visibleCount
        );
    }

    let updateTimer = null;

    function scheduleUpdate() {
        clearTimeout(updateTimer);

        updateTimer = setTimeout(
            updatePanel,
            200
        );
    }

    function start() {
        const missionList =
            document.querySelector('#mission_list') ||
            document.querySelector('[id*="mission_list"]');

        if (!missionList) {
            setTimeout(start, 750);
            return;
        }

        createPanel();
        updatePanel();

        const observer = new MutationObserver(
            scheduleUpdate
        );

        observer.observe(
            missionList,
            {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: [
                    'class',
                    'style',
                    'hidden',
                    'data-mission-participation-filter',
                    'data-sortable-by'
                ]
            }
        );

        setInterval(
            updatePanel,
            5000
        );
    }

    start();

})();
