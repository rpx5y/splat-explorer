import assert from 'node:assert/strict';
import test from 'node:test';
import { TarIndexer, isZstd } from '../src/tar.js';
import { ZSTDDecoder } from '../src/vendor/zstddec-stream.js';

function makeEntry(name, content, type = '0') {
    const payload = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, 'utf8');
    header.write(payload.length.toString(8).padStart(11, '0') + '\0', 124, 12);
    header.fill(32, 148, 156);
    header.write(type, 156, 1);
    header.write('ustar\0', 257, 6);
    const sum = header.reduce((value, byte) => value + byte, 0);
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    return Buffer.concat([header, payload, Buffer.alloc((512 - (payload.length % 512)) % 512)]);
}

test('streaming TAR lists only JSON entries with exact byte offsets', () => {
    const first = makeEntry('2024-01-01.xrank.detail.json', '{"id":1}');
    const other = makeEntry('notes.txt', 'ignored');
    const last = makeEntry('dir/gear.json', '{"a":2}');
    const tar = Buffer.concat([first, other, last, Buffer.alloc(1024)]);
    const indexer = new TarIndexer();
    for (let i = 0; i < tar.length; i += 73) indexer.push(tar.subarray(i, i + 73));
    assert.deepEqual(indexer.finish(), [
        { path: '2024-01-01.xrank.detail.json', size: 8, offset: 512 },
        { path: 'dir/gear.json', size: 7, offset: first.length + other.length + 512 }
    ]);
    assert.equal(tar.subarray(indexer.entries[1].offset, indexer.entries[1].offset + 7).toString(), '{"a":2}');
});

test('reject invalid or truncated TAR', () => {
    const bad = Buffer.from(makeEntry('a.json', '{}'));
    bad[0] ^= 1;
    assert.throws(() => new TarIndexer().push(bad), /チェックサム/u);
    const indexer = new TarIndexer();
    indexer.push(makeEntry('a.json', '{}'));
    assert.throws(() => indexer.finish(), /途中/u);
});

test('vendored WASM streaming Zstandard decoder works without a CDN', async () => {
    const bytes = Buffer.from('KLUv/QRYEQEAeyJoZWxsbyI6IndvcmxkIiwi5pel5pys6KqeIjp0cnVlfTY0jjs=', 'base64');
    assert.equal(isZstd(bytes), true);
    const decoder = new ZSTDDecoder();
    await decoder.init();
    const outputs = [...decoder.decodeStreaming([bytes.subarray(0, 9), bytes.subarray(9)])];
    const text = Buffer.concat(outputs.map((chunk) => Buffer.from(chunk))).toString('utf8');
    assert.equal(text, '{"hello":"world","日本語":true}');
});
