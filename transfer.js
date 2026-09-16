// VEFARI outfit exchange: outfit text embedded in PNG iTXt chunks and ZIP packaging.
// Pure byte-level module: no browser, storage or SillyTavern dependencies.
// SPDX-License-Identifier: AGPL-3.0-or-later

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const KEYWORD = 'vefari';
const FALLBACK_KEYWORDS = ['Description'];
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
});

export function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function bytesOf(value) {
    return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function isPng(bytes) {
    return bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function ascii(text) {
    return [...text].map(character => character.charCodeAt(0) & 0xFF);
}

function pngChunk(type, data) {
    const chunk = new Uint8Array(12 + data.length);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, data.length);
    chunk.set(ascii(type), 4);
    chunk.set(data, 8);
    view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
    return chunk;
}

// iTXt layout: keyword NUL, compression flag, method, language NUL, translated keyword NUL, UTF-8 text.
function itxtData(keyword, text) {
    return new Uint8Array([...ascii(keyword), 0, 0, 0, 0, 0, ...encoder.encode(text)]);
}

/** Embed the outfit description into a PNG without re-encoding the picture. */
export function embedOutfitText(png, text) {
    const bytes = bytesOf(png);
    if (!isPng(bytes)) throw new Error('Файл не является PNG-изображением.');
    if (bytes.length < 33) throw new Error('Повреждённый PNG: нет заголовка IHDR.');
    const description = typeof text === 'string' ? text.trim() : '';
    if (!description) throw new Error('Пустой текст наряда вшивать нечего.');
    const insertAt = 8 + 12 + new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8);
    if (insertAt > bytes.length) throw new Error('Повреждённый PNG: нет заголовка IHDR.');
    const chunk = pngChunk('iTXt', itxtData(KEYWORD, description));
    const result = new Uint8Array(bytes.length + chunk.length);
    result.set(bytes.subarray(0, insertAt));
    result.set(chunk, insertAt);
    result.set(bytes.subarray(insertAt), insertAt + chunk.length);
    return result;
}

function readTextChunk(type, data) {
    const nul = data.indexOf(0);
    if (nul <= 0) return null;
    const keyword = decoder.decode(data.subarray(0, nul));
    if (type === 'tEXt') {
        const text = decoder.decode(data.subarray(nul + 1)).trim();
        return text ? { keyword, text } : null;
    }
    // VEFARI never writes compressed iTXt; skip chunks this module cannot inflate.
    if (data[nul + 1] !== 0 || data[nul + 2] !== 0) return null;
    const languageEnd = data.indexOf(0, nul + 3);
    if (languageEnd < 0) return null;
    const translatedEnd = data.indexOf(0, languageEnd + 1);
    if (translatedEnd < 0) return null;
    const text = decoder.decode(data.subarray(translatedEnd + 1)).trim();
    return text ? { keyword, text } : null;
}

/** Read an embedded outfit description, preferring VEFARI's own keyword. */
export function extractOutfitText(png) {
    const bytes = bytesOf(png);
    if (!isPng(bytes)) throw new Error('Файл не является PNG-изображением.');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let fallback = '';
    let offset = PNG_SIGNATURE.length;
    while (offset + 12 <= bytes.length) {
        const length = view.getUint32(offset);
        if (offset + 12 + length > bytes.length) break;
        const type = decoder.decode(bytes.subarray(offset + 4, offset + 8));
        if (type === 'iTXt' || type === 'tEXt') {
            const found = readTextChunk(type, bytes.subarray(offset + 8, offset + 8 + length));
            if (found?.keyword === KEYWORD) return found.text;
            if (found && FALLBACK_KEYWORDS.includes(found.keyword) && !fallback) fallback = found.text;
        }
        if (type === 'IEND') break;
        offset += 12 + length;
    }
    return fallback || null;
}

/** Package files into an uncompressed ZIP; PNG payloads are already compressed. */
export function createZip(entries) {
    if (!Array.isArray(entries) || !entries.length) throw new Error('В архиве должен быть хотя бы один файл.');
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const DOS_DATE = 0x21; // 1980-01-01 00:00 keeps archives deterministic.
    for (const entry of entries) {
        const name = encoder.encode(String(entry?.name || ''));
        const data = bytesOf(entry?.data);
        if (!name.length || !data.length) throw new Error('Некорректная запись архива.');
        const crc = crc32(data);
        const local = new Uint8Array(30 + name.length);
        const localView = new DataView(local.buffer);
        localView.setUint32(0, 0x04034B50, true);
        localView.setUint16(4, 20, true);
        localView.setUint16(6, 0x0800, true); // Entry names are UTF-8.
        localView.setUint16(12, DOS_DATE, true);
        localView.setUint32(14, crc, true);
        localView.setUint32(18, data.length, true);
        localView.setUint32(22, data.length, true);
        localView.setUint16(26, name.length, true);
        local.set(name, 30);
        const central = new Uint8Array(46 + name.length);
        const centralView = new DataView(central.buffer);
        centralView.setUint32(0, 0x02014B50, true);
        centralView.setUint16(4, 20, true);
        centralView.setUint16(6, 20, true);
        centralView.setUint16(8, 0x0800, true);
        centralView.setUint16(14, DOS_DATE, true);
        centralView.setUint32(16, crc, true);
        centralView.setUint32(20, data.length, true);
        centralView.setUint32(24, data.length, true);
        centralView.setUint16(28, name.length, true);
        centralView.setUint32(42, offset, true);
        central.set(name, 46);
        localParts.push(local, data);
        centralParts.push(central);
        offset += local.length + data.length;
    }
    const centralSize = centralParts.reduce((size, part) => size + part.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054B50, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, offset, true);
    const zip = new Uint8Array(offset + centralSize + end.length);
    let cursor = 0;
    for (const part of [...localParts, ...centralParts, end]) {
        zip.set(part, cursor);
        cursor += part.length;
    }
    return zip;
}

export function safeFilename(name, fallback = 'outfit') {
    const cleaned = String(name ?? '')
        .replace(/[\\/:*?"<>|\u0000-\u001F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80)
        .trim();
    return cleaned || fallback;
}
