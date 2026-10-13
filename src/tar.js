const BLOCK = 512;
const MAX_ENTRIES = 100000;
const MAX_METADATA = 1024 * 1024;
const textDecoder = new TextDecoder('utf-8');

function readString(bytes, start, length) {
    const field = bytes.subarray(start, start + length);
    const nul = field.indexOf(0);
    return textDecoder.decode(nul === -1 ? field : field.subarray(0, nul));
}

function readNumber(bytes, start, length) {
    const field = bytes.subarray(start, start + length);
    if (field[0] & 0x80) {
        let value = BigInt(field[0] & 0x7f);
        for (let i = 1; i < field.length; i++) value = (value << 8n) | BigInt(field[i]);
        const number = Number(value);
        if (!Number.isSafeInteger(number)) throw new Error('TARのサイズが大きすぎます');
        return number;
    }
    const value = readString(bytes, start, length).trim();
    if (!value) return 0;
    if (!/^[0-7]+$/u.test(value)) throw new Error('TARの数値フィールドが不正です');
    const number = parseInt(value, 8);
    if (!Number.isSafeInteger(number)) throw new Error('TARのサイズが大きすぎます');
    return number;
}

function checkHeader(header) {
    const expected = readNumber(header, 148, 8);
    let actual = 0;
    for (let i = 0; i < BLOCK; i++) actual += i >= 148 && i < 156 ? 32 : header[i];
    if (expected !== actual) throw new Error('TARヘッダーのチェックサムが一致しません');
}

function parsePax(bytes) {
    const fields = {};
    let offset = 0;
    while (offset < bytes.length) {
        const space = bytes.indexOf(32, offset);
        if (space < 0) break;
        const lengthText = textDecoder.decode(bytes.subarray(offset, space));
        if (!/^\d+$/u.test(lengthText)) throw new Error('PAXヘッダーが不正です');
        const length = Number(lengthText);
        if (length <= 0 || offset + length > bytes.length) throw new Error('PAXヘッダーが不正です');
        const record = textDecoder.decode(bytes.subarray(space + 1, offset + length - 1));
        const equal = record.indexOf('=');
        if (equal > 0) fields[record.slice(0, equal)] = record.slice(equal + 1);
        offset += length;
    }
    return fields;
}

/** Incremental TAR indexer. Keeps filenames and offsets, not JSON payloads. */
export class TarIndexer {
    constructor() {
        this.entries = [];
        this.offset = 0;
        this.header = new Uint8Array(BLOCK);
        this.headerUsed = 0;
        this.skip = 0;
        this.bodyLeft = 0;
        this.metadata = null;
        this.pendingType = '';
        this.paxPath = null;
        this.longPath = null;
        this.finished = false;
    }

    push(bytes) {
        if (this.finished) return;
        let position = 0;
        while (position < bytes.length && !this.finished) {
            if (this.skip) {
                const take = Math.min(this.skip, bytes.length - position);
                if (this.metadata && this.bodyLeft > 0) {
                    const copy = Math.min(take, this.bodyLeft);
                    this.metadata.set(bytes.subarray(position, position + copy), this.metadata.length - this.bodyLeft);
                }
                this.bodyLeft = Math.max(0, this.bodyLeft - take);
                this.skip -= take;
                position += take;
                this.offset += take;
                if (!this.skip && this.metadata) {
                    const content = this.metadata;
                    if (this.pendingType === 'x') this.paxPath = parsePax(content).path ?? this.paxPath;
                    if (this.pendingType === 'L') this.longPath = readString(content, 0, content.length);
                    this.metadata = null;
                }
                continue;
            }

            const take = Math.min(BLOCK - this.headerUsed, bytes.length - position);
            this.header.set(bytes.subarray(position, position + take), this.headerUsed);
            this.headerUsed += take;
            position += take;
            this.offset += take;
            if (this.headerUsed !== BLOCK) continue;
            this.headerUsed = 0;
            if (this.header.every((byte) => byte === 0)) {
                this.finished = true;
                break;
            }
            checkHeader(this.header);
            const size = readNumber(this.header, 124, 12);
            const type = String.fromCharCode(this.header[156] || 48);
            const rawName = readString(this.header, 0, 100);
            const prefix = readString(this.header, 345, 155);
            const name = this.paxPath ?? this.longPath ?? (prefix ? prefix + '/' + rawName : rawName);
            if (type !== 'x' && type !== 'g' && type !== 'L') {
                this.paxPath = null;
                this.longPath = null;
            }

            if ((type === '0' || type === '7') && name.toLowerCase().endsWith('.json')) {
                if (this.entries.length >= MAX_ENTRIES) throw new Error('アーカイブ内のファイル数が多すぎます');
                this.entries.push({ path: name, size, offset: this.offset });
            }
            this.skip = Math.ceil(size / BLOCK) * BLOCK;
            this.bodyLeft = size;
            this.pendingType = type;
            this.metadata = ['x', 'L'].includes(type) && size <= MAX_METADATA ? new Uint8Array(size) : null;
            if (!this.skip) this.metadata = null;
        }
    }

    finish() {
        if (!this.finished || this.skip || this.headerUsed) throw new Error('TARデータが途中で終了しました');
        if (!this.entries.length) throw new Error('アーカイブ内にJSONがありません');
        return this.entries;
    }
}

/** Validate Zstandard frame magic (0xFD2FB528). */
export function isZstd(bytes) {
    return bytes.length >= 4 && bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f && bytes[3] === 0xfd;
}
