import { readdir, readFile } from 'node:fs/promises';
import { weaponNames } from '../src/xrank-weapons.js';

const names = JSON.parse(await readFile('./data/search-index.json', 'utf8'));
const found = new Set();
const unknown = new Set();
let records = 0;

function fileIndex(id) {
    let hash = 2166136261;
    for (const char of id) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) & 63;
}

for (const file of await readdir('./data/players')) {
    const expectedIndex = parseInt(file.split('.')[0], 16);
    for (const player of JSON.parse(await readFile(`./data/players/${file}`, 'utf8'))) {
        if (fileIndex(player.id) !== expectedIndex) throw new Error(`Wrong bucket: ${player.id}`);
        if (found.has(player.id)) throw new Error(`Duplicate: ${player.id}`);
        if (!Array.isArray(names[player.id])) throw new Error(`Missing name: ${player.id}`);
        for (const history of names[player.id]) {
            if (typeof history.name !== 'string' || !Array.isArray(history.seen)) throw new Error(`Bad name: ${player.id}`);
        }
        for (const record of player.records) {
            if (!weaponNames[record.weaponId]) unknown.add(record.weaponId);
            records++;
        }
        found.add(player.id);
    }
}
if (found.size !== Object.keys(names).length) throw new Error('Search index does not match player data');
if (unknown.size) throw new Error(`Unmapped weapons: ${[...unknown].join(', ')}`);
console.log(`Validated ${found.size} players, ${records} records, all weapon names and bucket files.`);
