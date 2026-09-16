import assert from 'node:assert/strict';
import test from 'node:test';
import { createZip, crc32, embedOutfitText, extractOutfitText, safeFilename } from '../transfer.js';

// Well-known 1x1 PNG; the module never re-encodes pixels, only inserts a text chunk.
const PNG = new Uint8Array(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
));

function chunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set([...type].map(c => c.charCodeAt(0)), 4);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
}

function itxt(keyword, text) {
    return chunk('iTXt', new Uint8Array([
        ...[...keyword].map(c => c.charCodeAt(0)), 0, 0, 0, 0, 0,
        ...new TextEncoder().encode(text),
    ]));
}

test('crc32 matches the standard check vector', () => {
    assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
});

test('embedded outfit text roundtrips, including Cyrillic', () => {
    const text = 'Льняная туника с вышивкой на вороте и тканым поясом.';
    const png = embedOutfitText(PNG, text);
    assert.deepEqual([...png.subarray(0, 8)], [...PNG.subarray(0, 8)]);
    assert.equal(new TextDecoder().decode(png.subarray(37, 41)), 'iTXt'); // right after IHDR
    assert.equal(extractOutfitText(png), text);
});

test('the newest embedded description wins when a PNG is exported twice', () => {
    const once = embedOutfitText(PNG, 'Старая версия');
    assert.equal(extractOutfitText(embedOutfitText(once, 'Новая версия')), 'Новая версия');
});

test('pictures without embedded text return null, corrupt ones are not fatal', () => {
    assert.equal(extractOutfitText(PNG), null);
    assert.equal(extractOutfitText(PNG.subarray(0, PNG.length - 10)), null);
});

test('a generic Description chunk is accepted when VEFARI keyword is absent', () => {
    const withDescription = new Uint8Array([...PNG.subarray(0, 33), ...itxt('Description', 'A wool coat'), ...PNG.subarray(33)]);
    assert.equal(extractOutfitText(withDescription), 'A wool coat');
    const both = new Uint8Array([...PNG.subarray(0, 33), ...itxt('Description', 'Generic'), ...embedOutfitText(PNG, 'VEFARI').subarray(33)]);
    assert.equal(extractOutfitText(both), 'VEFARI');
});

test('non-PNG files and empty texts are rejected', () => {
    assert.throws(() => embedOutfitText(new Uint8Array([1, 2, 3]), 'текст'), /PNG/);
    assert.throws(() => extractOutfitText(new Uint8Array([1, 2, 3])), /PNG/);
    assert.throws(() => embedOutfitText(PNG, '   '), /Пустой/);
    assert.throws(() => embedOutfitText(PNG.subarray(0, 20), 'текст'), /IHDR/);
});

test('zip stores entries verbatim with UTF-8 names and consistent directory', () => {
    const entries = [
        { name: 'туника.png', data: embedOutfitText(PNG, 'Первая') },
        { name: 'boots.png', data: embedOutfitText(PNG, 'Second') },
    ];
    const zip = createZip(entries);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    assert.equal(view.getUint32(0, true), 0x04034B50);
    assert.equal(view.getUint16(6, true) & 0x0800, 0x0800); // UTF-8 name flag
    assert.equal(view.getUint32(14, true), crc32(entries[0].data));
    const nameLength = view.getUint16(26, true);
    assert.deepEqual([...zip.subarray(30 + nameLength, 30 + nameLength + entries[0].data.length)], [...entries[0].data]);
    const end = zip.length - 22;
    assert.equal(view.getUint32(end, true), 0x06054B50);
    assert.equal(view.getUint16(end + 8, true), 2);
    assert.equal(view.getUint16(end + 10, true), 2);
    const central = view.getUint32(end + 16, true);
    assert.equal(view.getUint32(central, true), 0x02014B50);
    const encoded = new TextEncoder().encode('туника.png');
    assert.deepEqual([...zip.subarray(30, 30 + nameLength)], [...encoded]);
});

test('zip requires at least one valid file entry', () => {
    assert.throws(() => createZip([]), /хотя бы один/);
    assert.throws(() => createZip([{ name: '', data: PNG }]), /запись/);
    assert.throws(() => createZip([{ name: 'x.png', data: new Uint8Array() }]), /запись/);
});

test('filenames are stripped of path separators, controls and excess length', () => {
    assert.equal(safeFilename('a/b\\c: d*e?f"g<h>i|j'), 'a b c d e f g h i j');
    assert.equal(safeFilename(`плащ${String.fromCharCode(7)}северный`), 'плащ северный');
    assert.equal(safeFilename('   '), 'outfit');
    assert.equal(safeFilename(null), 'outfit');
    assert.equal(safeFilename('д'.repeat(200)).length, 80);
});
