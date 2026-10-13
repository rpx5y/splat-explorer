import { ZSTDDecoder } from './vendor/zstddec-stream.js';
import { TarIndexer, isZstd } from './tar.js';

const decoder = new ZSTDDecoder();
const INPUT_CHUNK = 64 * 1024;
const MAX_JSON_BYTES = 64 * 1024 * 1024;
let compressed = null;
let entries = [];

function* inputChunks(bytes) {
    for (let start = 0; start < bytes.length; start += INPUT_CHUNK) {
        yield bytes.subarray(start, start + INPUT_CHUNK);
    }
}

function checkArchive(bytes) {
    if (!isZstd(bytes)) throw new Error('Zstandard形式ではありません（.tar.zstを選択してください）');
}

async function openArchive(buffer, id) {
    compressed = null;
    entries = [];
    const bytes = new Uint8Array(buffer);
    checkArchive(bytes);
    await decoder.init();

    const indexer = new TarIndexer();
    let lastReport = 0;
    for (const chunk of decoder.decodeStreaming(inputChunks(bytes))) {
        indexer.push(chunk);
        if (indexer.entries.length >= lastReport + 30) {
            lastReport = indexer.entries.length;
            self.postMessage({ op: 'progress', id, count: lastReport });
        }
    }
    entries = indexer.finish();
    compressed = bytes;
    self.postMessage({ op: 'opened', id, entries });
}

async function readEntry(index, id) {
    if (!compressed) throw new Error('アーカイブが読み込まれていません');
    const entry = entries[index];
    if (!entry) throw new Error('ファイルが見つかりません');
    if (entry.size > MAX_JSON_BYTES) throw new Error('選択したJSONが大きすぎます（上限64 MB）');
    const output = new Uint8Array(entry.size);
    const end = entry.offset + entry.size;
    let position = 0;
    let copied = 0;
    let lastReport = 0;
    // Read only the selected JSON into memory. Streaming keeps the other ~400 MB out of JS.
    // Stopping the iterator releases WASM buffers in the decoder's finally blocks.
    for (const chunk of decoder.decodeStreaming(inputChunks(compressed))) {
        const chunkEnd = position + chunk.length;
        const start = Math.max(position, entry.offset);
        const stop = Math.min(chunkEnd, end);
        if (stop > start) {
            output.set(chunk.subarray(start - position, stop - position), start - entry.offset);
            copied += stop - start;
        }
        position = chunkEnd;
        if (position > lastReport + 64 * 1024 * 1024 && position < end) {
            lastReport = position;
            self.postMessage({ op: 'reading', id, progress: Math.min(100, Math.round(position / end * 100)) });
        }
        if (copied === entry.size) break;
    }
    if (copied !== entry.size) throw new Error('JSONが途中で終了しました');
    self.postMessage({ op: 'file', id, index, buffer: output.buffer }, [output.buffer]);
}

self.onmessage = async (event) => {
    const { op, id } = event.data;
    try {
        if (op === 'open') await openArchive(event.data.buffer, id);
        else if (op === 'read') await readEntry(event.data.index, id);
    } catch (error) {
        self.postMessage({ op: 'error', id, message: error?.message || String(error) });
    }
};
