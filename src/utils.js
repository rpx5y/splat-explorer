/** JSON analysis helpers: preserve the original data, only transform what is displayed. */
const mojibakePattern = /[繝縺繧譁蜷螟荳蜃莨蟄邉驛驥]/gu;
let reverseShiftJis;

function countMojibake(text) {
    return [...text.matchAll(mojibakePattern)].length;
}

function buildReverseShiftJis() {
    if (reverseShiftJis) return reverseShiftJis;
    const map = new Map();
    const decoder = new TextDecoder('shift_jis', { fatal: true });
    function register(bytes) {
        try {
            const letter = decoder.decode(Uint8Array.from(bytes));
            if ([...letter].length === 1 && !map.has(letter)) map.set(letter, bytes);
        } catch {
            // Ignore invalid Shift-JIS sequences.
        }
    }
    for (let byte = 0; byte <= 255; byte++) register([byte]);
    for (let lead = 0x81; lead <= 0xfc; lead++) {
        if (lead > 0x9f && lead < 0xe0) continue;
        for (let trail = 0x40; trail <= 0xfc; trail++) {
            if (trail === 0x7f) continue;
            register([lead, trail]);
        }
    }
    reverseShiftJis = map;
    return map;
}

export function repairJapaneseMojibake(text) {
    if (typeof text !== 'string' || countMojibake(text) === 0) return null;
    const map = buildReverseShiftJis();
    const bytes = [];
    let lossy = false;
    for (const char of text) {
        if (char === '\ufffd') {
            bytes.push(0x3f);
            lossy = true;
            continue;
        }
        const encoded = map.get(char);
        if (!encoded) return null;
        bytes.push(...encoded);
    }
    const result = new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(bytes));
    if (result === text || countMojibake(result) >= countMojibake(text)) return null;
    if (!/[\u3040-\u30ff\u3400-\u9fff]/u.test(result)) return null;
    return { text: result, lossy: lossy || result.includes('\ufffd') };
}

export function decodeSplatoonId(value) {
    if (typeof value !== 'string' || value.length < 16 || value.length > 4096 || !/^[a-z\d+/]+={0,2}$/i.test(value)) return null;
    try {
        const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
        const result = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (/^(XRanking(?:Holder|Season)|Weapon|Badge|NameplateBackground|Player|User|XRankingTop|WeaponCategory)-[\x20-\x7e]+$/u.test(result)) return result;
        return null;
    } catch {
        return null;
    }
}

export function playerIdFromRankingId(value) {
    const decoded = decodeSplatoonId(value);
    return decoded?.match(/:(u-[a-z0-9]+)$/iu)?.[1] ?? null;
}

export function formatJsonPath(tokens) {
    return tokens.reduce((path, part) => {
        if (typeof part === 'number') return `${path}[${part}]`;
        if (/^[a-z_$][a-z\d_$]*$/i.test(part)) return `${path}.${part}`;
        return `${path}[${JSON.stringify(part)}]`;
    }, '$');
}

export function lookupPath(root, tokens) {
    return tokens.reduce((obj, key) => obj?.[key], root);
}

export function typeOf(value) {
    return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
}

export function shortValue(value, limit = 160) {
    const text = String(value);
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function searchJson(root, query, { maxMatches = 500, maxNodes = 600000 } = {}) {
    if (!query.trim()) return { matches: [], truncated: false };
    const needle = query.toLocaleLowerCase();
    const stack = [{ value: root, path: [], key: '$' }];
    const matches = [];
    let scanned = 0;
    let truncated = false;
    while (stack.length) {
        const item = stack.pop();
        if (++scanned > maxNodes) { truncated = true; break; }
        const value = item.value;
        const kind = typeOf(value);
        const keyText = String(item.key).toLocaleLowerCase();
        const valueText = kind === 'array' || kind === 'object' ? '' : String(value).toLocaleLowerCase();
        const decoded = kind === 'string' ? decodeSplatoonId(value) : null;
        const repaired = kind === 'string' ? repairJapaneseMojibake(value)?.text : null;
        if (keyText.includes(needle) || valueText.includes(needle) || decoded?.toLocaleLowerCase().includes(needle) || repaired?.toLocaleLowerCase().includes(needle)) {
            matches.push({ path: item.path, key: item.key, value });
            if (matches.length >= maxMatches) { truncated = true; break; }
        }
        if (kind === 'object') {
            const keys = Object.keys(value);
            for (let i = keys.length - 1; i >= 0; i--) {
                const key = keys[i];
                stack.push({ value: value[key], key, path: [...item.path, key] });
            }
        } else if (kind === 'array') {
            for (let i = value.length - 1; i >= 0; i--) {
                stack.push({ value: value[i], key: i, path: [...item.path, i] });
            }
        }
    }
    return { matches, truncated };
}
