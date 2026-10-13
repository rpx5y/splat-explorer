import { decodeSplatoonId, formatJsonPath, repairJapaneseMojibake, searchJson, shortValue, typeOf } from './utils.js';
const $ = (id) => document.getElementById(id);
const CHUNK = 100;
const MAX_EXPAND_NODES = 4000;
let data = null;
let loaded = false;
let rootNode = null;
let selected = null;
let matches = [];
let activeMatch = -1;
let searchTimer = null;
let toastTimer = null;
let requestController = null;

function notify(message, error = false) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.toggle('error', error);
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 4000);
}

function status(message, error = false) {
    $('notice').textContent = message;
    $('notice').style.color = error ? '#e8a3a3' : '';
    if (error) notify(message, true);
}

function loading(busy) {
    $('load-url').disabled = busy;
    $('load-url').textContent = busy ? '取得中…' : '取得';
}

function bytesLabel(size) {
    return size > 1048576 ? (size / 1048576).toFixed(2) + ' MB' : (size / 1024).toFixed(1) + ' KB';
}

function parseContent(content, source) {
    try {
        loadData(JSON.parse(content.replace(/^\ufeff/u, '')), source, new Blob([content]).size);
        return true;
    } catch (error) {
        status('JSONの解析に失敗: ' + error.message, true);
        return false;
    }
}

function loadData(json, name = 'Untitled JSON', size) {
    if (requestController) { requestController.abort(); requestController = null; }
    data = json;
    loaded = true;
    matches = [];
    activeMatch = -1;
    $('search-input').value = '';
    $('search-count').textContent = '';
    $('loaded-status').textContent = '読込済み';
    $('loaded-status').classList.add('has-data');
    $('document-name').textContent = name;
    $('document-size').textContent = bytesLabel(size ?? new Blob([JSON.stringify(json)]).size);
    $('empty-state').hidden = true;
    $('tree-root').hidden = false;
    for (const id of ['search-input', 'expand-all', 'collapse-all', 'copy-json', 'download-json', 'copy-path']) $(id).disabled = false;
    $('search-prev').disabled = true;
    $('search-next').disabled = true;
    renderTree();
    status('読み込み完了');
}

function clearData() {
    requestController?.abort();
    requestController = null;
    data = null;
    loaded = false;
    rootNode = null;
    selected = null;
    matches = [];
    $('tree-root').replaceChildren();
    $('tree-root').hidden = true;
    $('empty-state').hidden = false;
    $('loaded-status').textContent = '未読み込み';
    $('loaded-status').classList.remove('has-data');
    $('document-name').textContent = '未読み込み';
    $('document-size').textContent = '—';
    $('summary').textContent = '—';
    $('path-display').textContent = '$';
    $('search-input').value = '';
    $('search-count').textContent = '';
    for (const id of ['search-input', 'expand-all', 'collapse-all', 'copy-json', 'download-json', 'copy-path', 'search-prev', 'search-next']) $(id).disabled = true;
}

async function loadUrl() {
    const input = $('json-url').value.trim();
    let url;
    try {
        url = new URL(input);
        if (!['https:', 'http:'].includes(url.protocol)) throw new Error('HTTP(S) URL only');
    } catch {
        status('http:// または https:// から始まるURLを指定してください。', true);
        return;
    }
    requestController?.abort();
    const controller = new AbortController();
    requestController = controller;
    loading(true);
    status(url.hostname + ' からJSONをGETしています…');
    try {
        const response = await fetch(url.href, { method: 'GET', mode: 'cors', credentials: 'omit', signal: controller.signal });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const content = await response.text();
        if (requestController !== controller) return;
        if (parseContent(content, url.href)) notify('JSONを取得しました');
    } catch (error) {
        if (error.name !== 'AbortError') {
            status(error instanceof TypeError
                ? 'CORSまたは通信エラーです。取得元がブラウザGETを許可していない場合は、JSONを保存してファイルとして開いてください。'
                : 'URL取得に失敗: ' + error.message, true);
        }
    } finally {
        if (requestController === controller) requestController = null;
        loading(false);
    }
}

async function loadFile(file) {
    if (!file) return;
    try {
        if (parseContent(await file.text(), file.name)) notify(file.name + ' を読み込みました');
    } catch (error) {
        status('ファイル読込エラー: ' + error.message, true);
    }
}

function appendSpan(parent, className, content, title = '') {
    const span = document.createElement('span');
    span.className = className;
    span.textContent = content;
    if (title) span.title = title;
    parent.append(span);
    return span;
}

function makeNode(value, key, path, depth = 0, range = null) {
    const kind = range ? 'range' : typeOf(value);
    const foldable = ['range', 'object', 'array'].includes(kind);
    const item = { value, key, path, depth, kind, range, foldable, expanded: false, childMap: new Map() };
    item.row = document.createElement('div');
    item.row.className = 'tree-row';
    item.row.style.setProperty('--depth', String(depth));
    item.row.tabIndex = 0;
    item.row.setAttribute('role', 'treeitem');
    if (foldable) item.row.setAttribute('aria-expanded', 'false');
    item.twisty = document.createElement('button');
    item.twisty.type = 'button';
    item.twisty.className = 'twisty ' + (foldable ? 'foldable' : 'none');
    item.twisty.textContent = foldable ? '▸' : '·';
    item.twisty.disabled = !foldable;
    item.twisty.setAttribute('aria-label', String(key) + ' ' + (foldable ? '展開' : '値'));
    item.twisty.addEventListener('click', e => { e.stopPropagation(); toggleNode(item); });
    item.row.append(item.twisty);
    appendSpan(item.row, 'key ' + (typeof key === 'number' ? 'array-key' : ''), depth === 0 ? '$' : typeof key === 'number' ? '[' + key + ']' : String(key));
    appendSpan(item.row, 'colon', ':');
    if (foldable) {
        const count = range ? range.end - range.start : kind === 'array' ? value.length : Object.keys(value).length;
        appendSpan(item.row, 'value preview', (kind === 'array' || kind === 'range' ? 'Array[' + count + ']' : 'Object{' + count + '}'));
    } else {
        item.valueSpan = appendSpan(item.row, 'value ' + (kind === 'boolean' ? 'bool' : kind), '');
        updateLeaf(item);
    }
    const actions = document.createElement('span');
    actions.className = 'node-actions';
    for (const [label, hint, handler] of [
        ['JSON', 'この値をJSONとしてコピー', () => copyText(JSON.stringify(range ? value.slice(range.start, range.end) : value, null, 2))],
        ['PATH', 'JSONPathをコピー', () => copyText(formatJsonPath(path))]
    ]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'node-action';
        button.title = hint;
        button.textContent = label;
        button.addEventListener('click', e => { e.stopPropagation(); handler(); });
        actions.append(button);
    }
    item.row.append(actions);
    item.row.addEventListener('click', () => selectNode(item));
    item.row.addEventListener('dblclick', () => { if (foldable) toggleNode(item); });
    item.row.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); selectNode(item); if (foldable) toggleNode(item); }
        if (e.key === 'ArrowRight' && foldable && !item.expanded) { e.preventDefault(); toggleNode(item); }
        if (e.key === 'ArrowLeft' && foldable && item.expanded) { e.preventDefault(); toggleNode(item); }
    });
    item.wrapper = document.createElement('div');
    item.wrapper.className = 'tree-item';
    item.wrapper.append(item.row);
    return item;
}

function updateLeaf(item) {
    const { value, kind } = item;
    const span = item.valueSpan;
    if (!span) return;
    span.classList.remove('repaired', 'lossy');
    item.decodedSpan?.remove();
    item.decodedSpan = null;
    if (kind === 'string') {
        const recovered = $('repair-text').checked ? repairJapaneseMojibake(value) : null;
        const display = recovered ? recovered.text : value;
        span.textContent = '"' + shortValue(display) + '"';
        if (recovered) {
            span.classList.add('repaired');
            if (recovered.lossy) span.classList.add('lossy');
            span.title = '元データ: ' + value + (recovered.lossy ? '\n一部の文字は元データから失われています' : '');
        } else {
            span.title = value.length > 160 ? value : '';
        }
        if ($('decode-ids').checked) {
            const decoded = decodeSplatoonId(value);
            if (decoded) item.decodedSpan = appendSpan(item.row, 'decoded-value', '→ ' + decoded, decoded);
        }
    } else if (kind === 'null') span.textContent = 'null';
    else span.textContent = String(value);
}

function ensureChildren(item) {
    if (item.children) return;
    const children = document.createElement('div');
    children.className = 'tree-children';
    children.setAttribute('role', 'group');
    item.children = children;
    if (item.kind === 'range') {
        for (let i = item.range.start; i < item.range.end; i++) {
            const child = makeNode(item.value[i], i, [...item.path, i], item.depth + 1);
            item.childMap.set(i, child);
            children.append(child.wrapper);
        }
    } else if (item.kind === 'array') {
        if (item.value.length > CHUNK * 1.2) {
            for (let start = 0; start < item.value.length; start += CHUNK) {
                const end = Math.min(start + CHUNK, item.value.length);
                const child = makeNode(item.value, '[' + start + '–' + (end - 1) + ']', item.path, item.depth + 1, { start, end });
                item.childMap.set('range-' + Math.floor(start / CHUNK), child);
                children.append(child.wrapper);
            }
        } else {
            item.value.forEach((value, index) => {
                const child = makeNode(value, index, [...item.path, index], item.depth + 1);
                item.childMap.set(index, child);
                children.append(child.wrapper);
            });
        }
    } else if (item.kind === 'object') {
        for (const [key, value] of Object.entries(item.value)) {
            const child = makeNode(value, key, [...item.path, key], item.depth + 1);
            item.childMap.set(key, child);
            children.append(child.wrapper);
        }
    }
    item.wrapper.append(children);
}

function toggleNode(item, expanded = !item.expanded) {
    if (!item.foldable || item.expanded === expanded) return;
    if (expanded) ensureChildren(item);
    item.expanded = expanded;
    item.row.setAttribute('aria-expanded', String(expanded));
    item.twisty.textContent = expanded ? '▾' : '▸';
    if (item.children) item.children.hidden = !expanded;
}

function selectNode(item) {
    selected?.row.classList.remove('selected');
    selected = item;
    item.row.classList.add('selected');
    $('path-display').textContent = formatJsonPath(item.path);
    $('path-display').title = formatJsonPath(item.path);
}

function renderTree() {
    if (!loaded) return;
    rootNode = makeNode(data, '$', []);
    $('tree-root').replaceChildren(rootNode.wrapper);
    $('summary').textContent = typeOf(data).toUpperCase();
    selected = null;
    if (rootNode.foldable) toggleNode(rootNode, true);
    if (rootNode.kind === 'object' && rootNode.childMap.size === 1) {
        const child = [...rootNode.childMap.values()][0];
        if (child.foldable) toggleNode(child, true);
    }
    selectNode(rootNode);
}

function renderedNodes(callback) {
    if (!rootNode) return;
    const stack = [rootNode];
    let count = 0;
    while (stack.length && count++ < MAX_EXPAND_NODES) {
        const current = stack.pop();
        callback(current);
        for (const child of current.childMap.values()) stack.push(child);
    }
}

function expandRendered() {
    if (!rootNode) return;
    const queue = [rootNode];
    let position = 0;
    while (position < queue.length && position < MAX_EXPAND_NODES) {
        const current = queue[position++];
        if (current.foldable) toggleNode(current, true);
        for (const child of current.childMap.values()) queue.push(child);
    }
    if (position < queue.length) notify('大量のデータがあるため一部のノードまで展開しました。');
}

function collapseRendered() {
    renderedNodes(node => toggleNode(node, false));
    if (rootNode?.foldable) toggleNode(rootNode, true);
}

function revealPath(path) {
    if (!rootNode) return null;
    let item = rootNode;
    for (const key of path) {
        if (!item.expanded) toggleNode(item, true);
        if (item.kind === 'array' && item.value.length > CHUNK * 1.2) {
            item = item.childMap.get('range-' + Math.floor(key / CHUNK));
            if (!item) return null;
            if (!item.expanded) toggleNode(item, true);
        }
        item = item.childMap.get(key);
        if (!item) return null;
    }
    return item;
}

function runSearch() {
    if (!loaded) return;
    const query = $('search-input').value.trim();
    document.querySelectorAll('.match-current').forEach(el => el.classList.remove('match-current'));
    if (!query) {
        matches = [];
        activeMatch = -1;
        $('search-count').textContent = '';
    } else {
        const result = searchJson(data, query);
        matches = result.matches;
        activeMatch = -1;
        $('search-count').textContent = result.truncated ? matches.length + '+ 件' : matches.length + ' 件';
    }
    $('search-prev').disabled = matches.length === 0;
    $('search-next').disabled = matches.length === 0;
    if (matches.length) goToMatch(0);
}

function goToMatch(index) {
    if (!matches.length) return;
    activeMatch = (index + matches.length) % matches.length;
    document.querySelectorAll('.match-current').forEach(el => el.classList.remove('match-current'));
    const item = revealPath(matches[activeMatch].path);
    if (item) {
        selectNode(item);
        item.row.classList.add('match-current');
        item.row.scrollIntoView({ block: 'center' });
    }
    $('search-count').textContent = (activeMatch + 1) + ' / ' + matches.length + (matches.length === 500 ? '+' : '');
}

async function copyText(content) {
    try {
        await navigator.clipboard.writeText(content);
        notify('コピーしました');
    } catch {
        notify('クリップボードへのコピーに失敗しました。HTTPSで利用してください。', true);
    }
}

function downloadData() {
    if (!loaded) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'json-tree-export.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setupTabs() {
    for (const tab of document.querySelectorAll('[data-tab]')) {
        tab.addEventListener('click', () => {
            for (const other of document.querySelectorAll('[data-tab]')) {
                const active = tab.dataset.tab === other.dataset.tab;
                other.classList.toggle('is-active', active);
                other.setAttribute('aria-selected', String(active));
                $(other.getAttribute('aria-controls')).hidden = !active;
            }
        });
    }
}

function boot() {
    setupTabs();
    $('load-url').addEventListener('click', loadUrl);
    $('json-url').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); loadUrl(); } });
    $('load-paste').addEventListener('click', () => parseContent($('json-paste').value, '貼り付けJSON'));
    $('json-paste').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); parseContent($('json-paste').value, '貼り付けJSON'); } });
    $('json-file').addEventListener('change', e => loadFile(e.target.files?.[0]));
    const zone = $('dropzone');
    for (const type of ['dragenter', 'dragover']) zone.addEventListener(type, e => { e.preventDefault(); zone.classList.add('dragging'); });
    for (const type of ['dragleave', 'drop']) zone.addEventListener(type, e => { e.preventDefault(); zone.classList.remove('dragging'); });
    zone.addEventListener('drop', e => loadFile(e.dataTransfer?.files?.[0]));
    $('clear-data').addEventListener('click', clearData);
    $('expand-all').addEventListener('click', expandRendered);
    $('collapse-all').addEventListener('click', collapseRendered);
    $('copy-json').addEventListener('click', () => { if (loaded) copyText(JSON.stringify(data, null, 2)); });
    $('download-json').addEventListener('click', downloadData);
    $('copy-path').addEventListener('click', () => copyText(formatJsonPath(selected?.path ?? [])));
    for (const id of ['decode-ids', 'repair-text']) $(id).addEventListener('change', () => renderedNodes(node => { if (node.valueSpan) updateLeaf(node); }));
    $('search-input').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 220); });
    $('search-input').addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        if (matches.length) goToMatch(activeMatch + (e.shiftKey ? -1 : 1));
        else runSearch();
    });
    $('search-prev').addEventListener('click', () => goToMatch(activeMatch - 1));
    $('search-next').addEventListener('click', () => goToMatch(activeMatch + 1));
    document.addEventListener('keydown', e => {
        if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
            e.preventDefault();
            $('search-input').focus();
        }
    });
}

boot();
