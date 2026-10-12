import assert from 'node:assert/strict';
import test from 'node:test';
import { augmentGeminiBody, formatReport, nameMatches, parseGeneratorRequest, planOutfits } from '../bridge.js';
import { freezeDeep } from './fixtures.js';

const generator = { apiType: 'gemini', endpoint: 'https://img.example/proxy', sendRefs: true, always: { bot: false, user: false }, names: { bot: 'Маша, Masha', user: 'Петя' } };
const url = 'https://img.example/proxy/v1beta/models/gemini-3-pro-image:generateContent';
const body = (text = 'Маша идёт по улице') => ({
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: 'FACE' } }, { text }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
});
const request = (overrides = {}) => ({ method: 'POST', url, body: JSON.stringify(body()), ...overrides });
const item = (id, category, extra = {}) => ({
    id, category, name: id, description: `${id} desc`, imagePath: `/user/images/vefari_refs/${id}.png`, audiences: ['bot', 'user'], sendImage: true, ...extra,
});
const snapshot = (bot = [], user = []) => ({ characterName: 'Маша', userName: 'Петя', enabled: true, bot: { items: bot }, user: { items: user } });
const settings = { generatorImages: true, maxImageRefs: 4 };
const plan = (overrides = {}) => planOutfits({ snapshot: snapshot(), promptText: 'Маша идёт', generator, settings, ...overrides });
const ids = items => items.map(entry => entry.id);

test('nameMatches follows the generator rule', () => {
    assert.equal(nameMatches('Маша, Masha', 'masha smiles'), true);
    assert.equal(nameMatches('Ace', 'open space'), false);
    assert.equal(nameMatches('Ace', 'Ace!'), true);
    assert.equal(nameMatches('Mary  Jane', 'mary jane waves'), true);
    assert.equal(nameMatches('Dr. (X)', 'Dr. (X) sits'), true);
    assert.equal(nameMatches('', 'x'), false);
});

test('recognizes only generator image requests', () => {
    assert.equal(parseGeneratorRequest(request(), generator).promptText, 'Маша идёт по улице');
    assert.equal(parseGeneratorRequest(request({ method: 'post' }), generator).promptText, 'Маша идёт по улице');
    assert.equal(parseGeneratorRequest(request({ method: 'GET' }), generator), null);
    assert.equal(parseGeneratorRequest(request(), { ...generator, apiType: 'openai' }), null);
    assert.equal(parseGeneratorRequest(request(), null), null);
    assert.equal(parseGeneratorRequest(request(), { ...generator, endpoint: '' }), null);
    const textOnly = { ...body(), generationConfig: { responseModalities: ['TEXT'] } };
    assert.equal(parseGeneratorRequest(request({ body: JSON.stringify(textOnly) }), generator), null);
    assert.equal(parseGeneratorRequest(request({ url: 'https://img.example/other/v1beta/models/m:generateContent' }), generator), null);
    assert.equal(parseGeneratorRequest(request({ url: 'https://img.example/proxyx/v1beta/models/m:generateContent' }), generator), null);
});

test('other URL is rejected before parsing', () => {
    assert.equal(parseGeneratorRequest({ method: 'POST', url: '/api/backends/chat-completions/generate', body: 'not json' }, generator), null);
});

test('malformed gemini bodies are ignored', () => {
    const noText = { ...body(), contents: [{ parts: [{ inlineData: { mimeType: 'image/png', data: 'FACE' } }] }] };
    for (const payload of ['{}', JSON.stringify(noText), 'not json', JSON.stringify({ ...body(), contents: [{ parts: null }] })]) {
        assert.equal(parseGeneratorRequest(request({ body: payload }), generator), null);
    }
    assert.equal(parseGeneratorRequest(request({ body: undefined }), generator), null);
});

test('plan gates sides like the generator face refs', () => {
    const worn = snapshot([item('dress', 'full')], [item('suit', 'full')]);
    assert.deepEqual(plan({ snapshot: worn }).sides.map(side => side.target), ['bot']);
    assert.deepEqual(plan({ snapshot: worn, generator: { ...generator, always: { bot: false, user: true } } }).sides.map(side => side.target), ['bot', 'user']);
    assert.deepEqual(plan({ snapshot: worn, promptText: 'пейзаж' }).sides, []);
    assert.equal(plan({ snapshot: null }).sides.length, 0);
    assert.equal(plan({ snapshot: snapshot([], [item('suit', 'full')]), promptText: 'Маша и Петя' }).sides[0].name, 'Петя');
});

test('image items respect global switch, item mode, generator refs and missing files', () => {
    const worn = snapshot([item('jacket', 'top'), item('jeans', 'bottom', { sendImage: false }), item('boots', 'shoes', { imagePath: '' })]);
    const [side] = plan({ snapshot: worn }).sides;
    assert.deepEqual(ids(side.items), ['jacket', 'jeans', 'boots']);
    assert.deepEqual(ids(side.imageItems), ['jacket']);
    assert.deepEqual(plan({ snapshot: worn, settings: { ...settings, generatorImages: false } }).sides[0].imageItems, []);
    assert.deepEqual(plan({ snapshot: worn, generator: { ...generator, sendRefs: false } }).sides[0].imageItems, []);
});

test('limit is shared with bot first', () => {
    const worn = snapshot([item('top1', 'top'), item('bottom1', 'bottom'), item('shoes1', 'shoes')], [item('top2', 'top'), item('bottom2', 'bottom')]);
    const sides = plan({ snapshot: worn, generator: { ...generator, always: { bot: false, user: true } } }).sides;
    assert.deepEqual(ids(sides[0].imageItems), ['top1', 'bottom1', 'shoes1']);
    assert.deepEqual(ids(sides[1].imageItems), ['top2']);
    assert.deepEqual(ids(sides[1].items), ['top2', 'bottom2']);
});

test('augment inserts labelled images before the prompt and keeps the source intact', () => {
    const source = freezeDeep(body());
    const outfit = plan({ snapshot: snapshot([item('jacket', 'top'), item('jeans', 'bottom', { sendImage: false })]) });
    const result = augmentGeminiBody(source, outfit, new Map([['jacket', { mimeType: 'image/png', base64: 'JACKET' }]]));
    assert.deepEqual(result.contents[0].parts, [
        { inlineData: { mimeType: 'image/png', data: 'FACE' } },
        { text: 'Outfit reference for Маша — TOP: jacket. Dress Маша in exactly this item; it overrides clothing visible in any face or character reference.' },
        { inlineData: { mimeType: 'image/png', data: 'JACKET' } },
        { text: '[Outfits: follow exactly, they override clothing from any other reference]\n[OUTFIT: Маша is currently wearing: TOP: jacket desc. BOTTOM: jeans desc.]\n\nМаша идёт по улице' },
    ]);
    assert.deepEqual(result.generationConfig, source.generationConfig);
    assert.equal(result.contents[0].role, 'user');
    assert.deepEqual(source, body());
});

test('unloaded image falls back to text', () => {
    const outfit = plan({ snapshot: snapshot([item('jacket', 'top')]) });
    const parts = augmentGeminiBody(body(), outfit, new Map()).contents[0].parts;
    assert.equal(parts.filter(part => part.inlineData).length, 1);
    assert.match(parts.at(-1).text, /TOP: jacket desc\./);
});

test('empty plan returns body unchanged', () => {
    const source = body();
    assert.deepEqual(augmentGeminiBody(source, { sides: [] }, new Map()), source);
});

test('formatReport speaks Russian plurals', () => {
    assert.equal(formatReport(null), 'ещё не было');
    assert.equal(formatReport({ sides: [{ name: 'Маша', images: ['top', 'bottom'], text: ['shoes'] }, { name: 'Петя', images: ['full'], text: [] }] }),
        'Маша — 2 картинки, 1 текстом; Петя — 1 картинка');
    assert.equal(formatReport({ sides: [{ name: 'Маша', images: ['a', 'b', 'c', 'd', 'e'], text: [] }] }), 'Маша — 5 картинок');
    assert.equal(formatReport({ sides: [{ name: 'Петя', images: [], text: ['top', 'bottom'] }] }), 'Петя — 2 текстом');
    assert.equal(formatReport({ sides: [{ name: 'Маша', images: Array(11).fill('x'), text: [] }] }), 'Маша — 11 картинок');
});
