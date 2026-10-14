import { weaponName } from './xrank-weapons.js';

const $ = (id) => document.getElementById(id);
const REGION = { a: 'アロメ', p: 'ヤコ' };
const RULE = {
    ar: { label: 'ガチエリア', icon: 'area.svg' },
    lf: { label: 'ガチヤグラ', icon: 'yagura.svg' },
    gl: { label: 'ガチホコ', icon: 'hoko.svg' },
    cl: { label: 'ガチアサリ', icon: 'asari.svg' },
};
const SEASONS = ['冬', '春', '夏', '秋'];
const SEASON_CLASSES = ['winter', 'spring', 'summer', 'autumn'];
const DATA_ROOT = new URL('../data/', import.meta.url);
const RULE_ASSETS = new URL('./assets/rules/', import.meta.url);
const SEARCH_PAGE = 16;
const RECORD_PAGE = 15;

let indexPromise;
let searchEntries = [];
let matches = [];
let selected = null;
let shownSearch = SEARCH_PAGE;
let shownRecords = RECORD_PAGE;
let activeName = -1;
let debounceTimer;
let requestId = 0;
const buckets = new Map();

function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
}

function seasonInfo(season) {
    const index = ((Number(season) - 2) % 4 + 4) % 4;
    return {
        label: `${String(2022 + Math.floor((Number(season) + 1) / 4)).slice(-2)}${SEASONS[index]}`,
        className: `xrank-${SEASON_CLASSES[index]}`,
    };
}

function seasonChip(code) {
    const [region, season] = code.split('-');
    const info = seasonInfo(season);
    const chip = element('span', 'xrank-season-chip');
    chip.title = REGION[region] || region;
    chip.append(
        element('span', 'xrank-season-code', code),
        element('span', `xrank-season-label ${info.className}`, info.label),
    );
    return chip;
}

function shortSeason(season) {
    const info = seasonInfo(season);
    return element('span', `xrank-season-label ${info.className}`, info.label);
}

function modeIcon(rule) {
    const icon = element('img', 'xrank-rule-icon');
    icon.src = new URL(RULE[rule]?.icon || 'area.svg', RULE_ASSETS).href;
    icon.alt = RULE[rule]?.label ?? '不明なルール';
    icon.title = icon.alt;
    icon.width = 26;
    icon.height = 26;
    icon.loading = 'lazy';
    return icon;
}

function normalizedNames(names) {
    return Array.isArray(names) ? names.map((n) => typeof n === 'string' ? { name: n, seen: [] } : n) : [];
}

function latestSeen(names) {
    return [...names].sort((a, b) => {
        const maxSeason = (value) => Math.max(0, ...value.seen.map((code) => Number(code.split('-')[1])));
        return maxSeason(b) - maxSeason(a);
    });
}

function getFileIndex(id) {
    let hash = 2166136261;
    for (const char of id) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) & 63;
}

async function getJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

async function loadIndex() {
    if (!indexPromise) {
        indexPromise = getJson(new URL('search-index.json', DATA_ROOT))
            .then((index) => {
                searchEntries = Object.entries(index).map(([id, raw]) => {
                    const names = latestSeen(normalizedNames(raw));
                    return { id, names, lower: id.toLocaleLowerCase(), searchable: names.map((n) => n.name.toLocaleLowerCase()) };
                });
                return searchEntries;
            }).catch((error) => {
                indexPromise = undefined;
                throw error;
            });
    }
    return indexPromise;
}

function setStatus(message) {
    $('xrank-status').textContent = message;
}

function displayName(entry, query) {
    const found = query ? entry.names.find((n) => n.name.toLocaleLowerCase().includes(query)) : undefined;
    return found?.name ?? entry.names[0]?.name ?? entry.id;
}

function renderMatches(query) {
    const container = $('xrank-search-results');
    container.replaceChildren();
    container.hidden = !query;
    $('xrank-more-results').hidden = shownSearch >= matches.length;
    if (!query) return;
    if (matches.length === 0) {
        container.append(element('div', 'xrank-empty', '見つかりませんでした'));
        return;
    }
    const fragment = document.createDocumentFragment();
    for (const entry of matches.slice(0, shownSearch)) {
        const button = element('button', 'xrank-result');
        button.type = 'button';
        button.setAttribute('aria-current', entry.id === selected?.id ? 'true' : 'false');
        const main = element('div', 'xrank-result-main');
        main.append(
            element('div', 'xrank-result-name', displayName(entry, query)),
            element('small', 'xrank-result-id', entry.id),
        );
        button.append(main, element('span', 'xrank-result-arrow', '›'));
        button.addEventListener('click', () => selectPlayer(entry));
        fragment.append(button);
    }
    container.append(fragment);
}

async function runSearch() {
    const query = $('xrank-query').value.trim().toLocaleLowerCase();
    const currentRequest = ++requestId;
    if (!query) {
        matches = [];
        shownSearch = SEARCH_PAGE;
        renderMatches('');
        setStatus('');
        return;
    }
    setStatus('検索中…');
    try {
        await loadIndex();
        if (requestId !== currentRequest) return;
        matches = searchEntries.filter((entry) => entry.lower.includes(query) || entry.searchable.some((name) => name.includes(query)));
        // Exact ID matches first; otherwise keep archive order.
        matches.sort((a, b) => Number(b.lower === query) - Number(a.lower === query));
        shownSearch = SEARCH_PAGE;
        renderMatches(query);
        setStatus('');
    } catch (error) {
        if (requestId !== currentRequest) return;
        setStatus('データを読み込めませんでした');
        $('xrank-search-results').hidden = true;
        console.error('X ranking search failed', error);
    }
}

async function loadPlayerRecords(id) {
    const index = getFileIndex(id);
    const path = `players/${index.toString(16).padStart(2, '0')}.json`;
    if (!buckets.has(index)) {
        const loading = getJson(new URL(path, DATA_ROOT)).catch((error) => {
            buckets.delete(index);
            throw error;
        });
        buckets.set(index, loading);
    }
    const bucket = await buckets.get(index);
    return bucket.find((p) => p.id === id)?.records ?? [];
}

async function selectPlayer(entry) {
    const localId = ++requestId;
    setStatus('読み込み中…');
    try {
        const records = await loadPlayerRecords(entry.id);
        if (localId !== requestId) return;
        selected = { id: entry.id, names: entry.names, records };
        activeName = -1;
        shownRecords = RECORD_PAGE;
        $('xrank-player').hidden = false;
        $('xrank-player-name').textContent = displayName(entry, $('xrank-query').value.trim().toLocaleLowerCase());
        $('xrank-player-id').textContent = entry.id;
        $('xrank-region').value = '';
        $('xrank-rule').value = '';
        $('xrank-sort').value = 'season';
        renderNames();
        renderRanking();
        renderMatches($('xrank-query').value.trim().toLocaleLowerCase());
        setStatus('');
        $('xrank-player').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
        if (localId !== requestId) return;
        setStatus('ランキングを読み込めませんでした');
        console.error('X ranking player failed', error);
    }
}

function renderNames() {
    const container = $('xrank-names');
    const scrollLeft = container.scrollLeft;
    container.replaceChildren();
    const names = selected.names;
    for (const [index, n] of names.entries()) {
        const button = element('button', 'xrank-name-button', n.name);
        button.type = 'button';
        button.setAttribute('aria-expanded', String(index === activeName));
        button.addEventListener('click', () => {
            activeName = activeName === index ? -1 : index;
            renderNames();
        });
        container.append(button);
    }
    container.scrollLeft = scrollLeft;
    const detail = $('xrank-name-detail');
    detail.hidden = activeName === -1;
    detail.replaceChildren();
    if (activeName === -1) return;
    const item = names[activeName];
    detail.append(element('div', 'xrank-name-detail-title', item.name));
    const list = element('div', 'xrank-name-seasons');
    for (const code of [...item.seen].sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))) {
        list.append(seasonChip(code));
    }
    if (!item.seen.length) list.append(element('span', 'xrank-empty', '記録時期不明'));
    detail.append(list);
}

function matchingRecords() {
    if (!selected) return [];
    const region = $('xrank-region').value;
    const rule = $('xrank-rule').value;
    const sort = $('xrank-sort').value;
    const records = selected.records.filter((r) => (!region || r.region === region) && (!rule || r.rule === rule));
    records.sort((a, b) => {
        if (sort === 'rank') return a.rank - b.rank || b.season - a.season;
        if (sort === 'power') return b.power - a.power || b.season - a.season;
        return b.season - a.season || a.rank - b.rank;
    });
    return records;
}

function renderRanking() {
    const records = matchingRecords();
    const table = $('xrank-table-body');
    const cards = $('xrank-cards');
    table.replaceChildren();
    cards.replaceChildren();
    const tableFragment = document.createDocumentFragment();
    const cardFragment = document.createDocumentFragment();
    for (const record of records.slice(0, shownRecords)) {
        const row = element('tr');
        const s = element('td');
        s.append(shortSeason(record.season));
        const m = element('td');
        m.append(modeIcon(record.rule));
        row.append(
            s,
            element('td', '', REGION[record.region] || record.region),
            m,
            element('td', 'xrank-rank', `${record.rank}位`),
            element('td', 'xrank-xp', `XP ${record.power}`),
            element('td', 'xrank-weapon', weaponName(record.weaponId)),
        );
        tableFragment.append(row);

        const card = element('div', 'xrank-card');
        const top = element('div', 'xrank-card-top');
        const context = element('div', 'xrank-card-context');
        const rule = element('span', 'xrank-card-rule');
        rule.append(modeIcon(record.rule), element('span', '', REGION[record.region] || record.region));
        context.append(shortSeason(record.season), rule);
        const figures = element('div', 'xrank-card-figures');
        figures.append(element('strong', 'xrank-rank', `${record.rank}位`), element('strong', 'xrank-xp', `XP ${record.power}`));
        top.append(context, figures);
        card.append(top, element('div', 'xrank-card-weapon', weaponName(record.weaponId)));
        cardFragment.append(card);
    }
    if (!records.length) {
        tableFragment.append(element('tr'));
        cards.append(element('div', 'xrank-empty', '該当する記録はありません'));
    }
    table.append(tableFragment);
    cards.append(cardFragment);
    $('xrank-more-records').hidden = shownRecords >= records.length;
}

$('xrank-query').addEventListener('input', () => {
    clearTimeout(debounceTimer);
    // Invalidate prior async selection/search immediately.
    requestId++;
    debounceTimer = setTimeout(runSearch, 130);
});
$('xrank-more-results').addEventListener('click', () => {
    shownSearch += SEARCH_PAGE;
    renderMatches($('xrank-query').value.trim().toLocaleLowerCase());
});
$('xrank-more-records').addEventListener('click', () => {
    shownRecords += RECORD_PAGE;
    renderRanking();
});
for (const id of ['xrank-region', 'xrank-rule', 'xrank-sort']) {
    $(id).addEventListener('change', () => {
        shownRecords = RECORD_PAGE;
        renderRanking();
    });
}
$('xrank-copy-id').addEventListener('click', async () => {
    if (!selected) return;
    try {
        await navigator.clipboard.writeText(selected.id);
        $('xrank-copy-id').textContent = 'コピーしました';
        setTimeout(() => $('xrank-copy-id').textContent = 'IDをコピー', 1200);
    } catch {
        window.prompt('IDをコピー', selected.id);
    }
});
