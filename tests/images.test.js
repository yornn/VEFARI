import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteUnusedImage, imageUrl, loadReference, MAX_IMAGE_BYTES, prepareImage, uploadImage } from '../images.js';

const context = { getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'test' }) };

test('image paths are restricted to VEFARI-owned files', () => {
    assert.equal(imageUrl('user/images/vefari_refs/coat.png'), '/user/images/vefari_refs/coat.png');
    for (const path of [
        'https://example.com/x.png', '//example.com/x.png', 'javascript:alert(1)',
        '/user/images/wardrobe_refs/x.png', '/user/images/vefari_refs/../x.png',
        '/user/images/vefari_refs/%2e%2e.png', '/user/images/vefari_refs/x.svg',
        '/user/images/vefari_refs/x.png?foo=1', null,
    ]) assert.equal(imageUrl(path), '');
});

test('upload uses ST headers and stores only a server path', async t => {
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        assert.equal(url, '/api/images/upload');
        assert.equal(options.headers['X-CSRF-Token'], 'test');
        const body = JSON.parse(options.body);
        assert.equal(body.ch_name, 'vefari_refs');
        assert.equal(body.format, 'png');
        assert.equal(body.image, 'aGVsbG8=');
        assert.match(body.filename, /^vefari_/);
        return Response.json({ path: 'user/images/vefari_refs/coat.png' });
    });
    assert.equal(await uploadImage('aGVsbG8=', context), '/user/images/vefari_refs/coat.png');
});

test('upload failures and unexpected response paths are reported', async t => {
    const mock = t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 500 }));
    await assert.rejects(uploadImage('x', context), /HTTP 500/);
    mock.mock.mockImplementation(async () => Response.json({ path: '/elsewhere.png' }));
    await assert.rejects(uploadImage('x', context), /путь/);
});

test('deleting images never touches other folders or still-referenced files', async t => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected request'); });
    assert.equal(await deleteUnusedImage('/user/images/wardrobe_refs/x.png', [], context), false);
    assert.equal(await deleteUnusedImage('/user/images/vefari_refs/x.png', [{ imagePath: 'user/images/vefari_refs/x.png' }], context), false);
    assert.equal(fetchMock.mock.callCount(), 0);
});

test('deletion uses relative server paths and treats absent files as already deleted', async t => {
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        assert.equal(url, '/api/images/delete');
        assert.deepEqual(JSON.parse(options.body), { path: 'user/images/vefari_refs/x.png' });
        return new Response('', { status: 404 });
    });
    assert.equal(await deleteUnusedImage('/user/images/vefari_refs/x.png', [], context), true);
});

test('failed image deletion is not silently accepted', async t => {
    t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 403 }));
    await assert.rejects(deleteUnusedImage('/user/images/vefari_refs/x.png', [], context), /HTTP 403/);
});

test('file type and size checked before any browser decoding', async () => {
    await assert.rejects(prepareImage({ type: 'image/svg+xml', size: 1 }), /PNG/);
    await assert.rejects(prepareImage({ type: 'image/png', size: MAX_IMAGE_BYTES + 1 }), /10 МБ/);
});

test('invalid, missing and non-image references are rejected', async t => {
    await assert.rejects(loadReference('https://example.com/x.png'), /путь/);
    const mock = t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }));
    await assert.rejects(loadReference('/user/images/vefari_refs/x.png'), /HTTP 404/);
    mock.mock.mockImplementation(async () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }));
    await assert.rejects(loadReference('/user/images/vefari_refs/x.png'), /не изображение/);
});

test('reference loading returns exact binary contents in base64', async t => {
    const bytes = new Uint8Array([0, 1, 128, 255]);
    t.mock.method(globalThis, 'fetch', async () => new Response(bytes, { headers: { 'Content-Type': 'image/png' } }));
    const reference = await loadReference('/user/images/vefari_refs/x.png');
    assert.equal(reference.mimeType, 'image/png');
    assert.equal(reference.base64, Buffer.from(bytes).toString('base64'));
});