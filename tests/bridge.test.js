import assert from 'node:assert/strict';
import test from 'node:test';
import {
    augmentGeminiBody, changedTargets, createOutfitMemory, formatReport, nameMatches, outfitSignatures, parseGeneratorRequest, planOutfits, sceneText,
} from '../bridge.js';
import { freezeDeep } from './fixtures.js';

const generator = { apiType: 'gemini', endpoint: 'https://img.example/proxy', sendRefs: true, always: { bot: false, user: false }, names: { bot: 'Маша, Masha', user: 'Петя' } };
const url = 'https://img.example/proxy/v1beta/models/gemini-3-pro-image:generateContent';
const body = (text = 'Маша идёт по улице') => ({
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: 'FACE' } }, { text }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
});
const request = (overrides = {}) => ({ method: 'POST', url, body: JSON.stringify(body()), ...overrides });
const item = (id, category, extra = {}) => ({
    id, category, name: id, description: `${id} desc`, imagePath: `/user/images/vefari_refs/${id}.png`, audiences: ['bot', 'user'], ...extra,
});
const snapshot = (bot = [], user = []) => ({ characterName: 'Маша', userName: 'Петя', enabled: true, bot: { items: bot }, user: { items: user } });
const settings = { sendModes: { bot: 'image', user: 'image' }, maxImageRefs: 4 };
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
    const worn = snapshot([item('dress', 'clothes')], [item('suit', 'clothes')]);
    assert.deepEqual(plan({ snapshot: worn }).sides.map(side => side.target), ['bot']);
    assert.deepEqual(plan({ snapshot: worn, generator: { ...generator, always: { bot: false, user: true } } }).sides.map(side => side.target), ['bot', 'user']);
    assert.deepEqual(plan({ snapshot: worn, promptText: 'пейзаж' }).sides, []);
    assert.equal(plan({ snapshot: null }).sides.length, 0);
    assert.equal(plan({ snapshot: snapshot([], [item('suit', 'clothes')]), promptText: 'Маша и Петя' }).sides[0].name, 'Петя');
});

test('image items follow each side\'s send mode, generator refs and missing files', () => {
    const worn = snapshot([item('jacket', 'clothes'), item('braid', 'hair', { imagePath: '' })]);
    const [side] = plan({ snapshot: worn }).sides;
    assert.deepEqual(ids(side.items), ['jacket', 'braid']);
    assert.deepEqual(ids(side.imageItems), ['jacket']);
    assert.deepEqual(plan({ snapshot: worn, settings: { ...settings, sendModes: { bot: 'text', user: 'image' } } }).sides[0].imageItems, []);
    assert.deepEqual(plan({ snapshot: worn, generator: { ...generator, sendRefs: false } }).sides[0].imageItems, []);
});

test('a text-mode side keeps its descriptions and leaves the image budget to the other', () => {
    const both = snapshot([item('dress', 'clothes')], [item('suit', 'clothes'), item('bun', 'hair')]);
    const userText = plan({ snapshot: both, generator: { ...generator, always: { bot: true, user: true } }, settings: { ...settings, sendModes: { bot: 'image', user: 'text' } } });
    assert.deepEqual(userText.sides.map(entry => [entry.target, ids(entry.items), ids(entry.imageItems)]), [['bot', ['dress'], ['dress']], ['user', ['suit', 'bun'], []]]);
    const botText = plan({ snapshot: both, generator: { ...generator, always: { bot: true, user: true } }, settings: { sendModes: { bot: 'text', user: 'image' }, maxImageRefs: 2 } });
    assert.deepEqual(botText.sides.map(entry => ids(entry.imageItems)), [[], ['suit', 'bun']]);
});

test('limit is shared with bot first', () => {
    const worn = snapshot([item('dress', 'clothes'), item('braid', 'hair')], [item('suit', 'clothes'), item('bun', 'hair')]);
    const sides = plan({ snapshot: worn, generator: { ...generator, always: { bot: false, user: true } }, settings: { ...settings, maxImageRefs: 3 } }).sides;
    assert.deepEqual(ids(sides[0].imageItems), ['dress', 'braid']);
    assert.deepEqual(ids(sides[1].imageItems), ['suit']);
    assert.deepEqual(ids(sides[1].items), ['suit', 'bun']);
});

const NOTE = '[Outfit update: the clothes or hairstyle described above have changed. '
    + 'Keep the framing, crop, pose and composition exactly as described and show only what is in frame, but dress them like this:';

test('augment puts labelled pictures before the prompt and the update note after the scene', () => {
    const source = freezeDeep(body());
    const outfit = plan({ snapshot: snapshot([item('jacket', 'clothes'), item('braid', 'hair')]) });
    const images = new Map([['jacket', { mimeType: 'image/png', base64: 'JACKET' }], ['braid', { mimeType: 'image/png', base64: 'BRAID' }]]);
    const result = augmentGeminiBody(source, outfit, images);
    assert.deepEqual(result.contents[0].parts, [
        { inlineData: { mimeType: 'image/png', data: 'FACE' } },
        { text: "Outfit reference for Маша: jacket. Use it only for the design, colors and materials of Маша's clothes; ignore the person, pose, framing, crop and background of this picture." },
        { inlineData: { mimeType: 'image/png', data: 'JACKET' } },
        { text: "Hairstyle reference for Маша: braid. Use it only for Маша's hairstyle; ignore the face, pose, framing, crop and background of this picture." },
        { inlineData: { mimeType: 'image/png', data: 'BRAID' } },
        { text: `Маша идёт по улице\n\n${NOTE}\nclothes Маша: jacket desc; hairstyle: braid desc]` },
    ]);
    assert.deepEqual(result.generationConfig, source.generationConfig);
    assert.equal(result.contents[0].role, 'user');
    assert.deepEqual(source, body());
});

test('the old orders and the generator instruction are gone from what VEFARI adds', () => {
    const instruction = '[CRITICAL: The reference image(s) attached show the EXACT appearance of the character(s). You MUST precisely copy their: face structure, eye color, hair color and style, skin tone, body type, clothing, and all distinctive features. Do not deviate from the reference appearances.]';
    const outfit = plan({ snapshot: snapshot([item('jacket', 'clothes')]), generator: { ...generator, always: { bot: true, user: true } } });
    const parts = augmentGeminiBody(body(`${instruction}\n\n[Style: anime] Маша идёт`), outfit, new Map()).contents[0].parts;
    assert.equal(parts.at(-1).text, `${instruction}\n\n[Style: anime] Маша идёт\n\n${NOTE}\nclothes Маша: jacket desc]`);
    assert.doesNotMatch(JSON.stringify(parts), /follow exactly|overrides|Dress Маша in exactly/);
});

test('unloaded image falls back to text', () => {
    const outfit = plan({ snapshot: snapshot([item('jacket', 'clothes')]) });
    const parts = augmentGeminiBody(body(), outfit, new Map()).contents[0].parts;
    assert.equal(parts.filter(part => part.inlineData).length, 1);
    assert.match(parts.at(-1).text, /\nclothes Маша: jacket desc]$/);
});

test('the scene is the prompt without the generator reference instruction', () => {
    const instruction = '[CRITICAL: The reference image(s) attached show the EXACT appearance. Copy them.]';
    assert.equal(sceneText(`${instruction}\n\n[Style: anime] Маша идёт`), '[Style: anime] Маша идёт');
    assert.equal(sceneText('[Style: anime] Маша идёт'), '[Style: anime] Маша идёт');
    assert.equal(sceneText(undefined), '');
});

test('signatures are the outfit lines; only participants dressed differently count as changed', () => {
    const worn = snapshot([item('dress', 'clothes')], [item('bun', 'hair')]);
    assert.deepEqual(outfitSignatures(worn), { bot: 'clothes Маша: dress desc', user: 'hairstyle Петя: bun desc' });
    assert.deepEqual(outfitSignatures(null), { bot: '', user: '' });
    const before = outfitSignatures(worn);
    assert.deepEqual(changedTargets(before, before), []);
    const after = outfitSignatures(snapshot([item('gown', 'clothes')], [item('bun', 'hair')]));
    assert.deepEqual(changedTargets(after, before), ['bot']);
    // Taking everything off is not news for the picture.
    assert.deepEqual(changedTargets(outfitSignatures(snapshot([], [item('bun', 'hair')])), before), []);
    assert.deepEqual(changedTargets(after, { bot: '', user: '' }), ['bot', 'user']);
});

test('memory keeps the outfit each prompt was written with, from what the writer last saw', () => {
    const x = { bot: 'clothes Маша: x', user: '' };
    const y = { bot: 'clothes Маша: y', user: '' };
    const memory = createOutfitMemory(2);
    // Nothing seen yet: a new prompt is taken to match the current outfit.
    assert.deepEqual(memory.baseline('first', y), y);
    memory.sawWriter(x);
    assert.deepEqual(memory.baseline('second', y), x);
    assert.deepEqual(memory.baseline('first', x), y, 'a known prompt keeps its outfit');
    memory.sawWriter(y);
    assert.deepEqual(memory.baseline('second', y), x);
    memory.baseline('third', y);
    memory.sawWriter(null);
    assert.deepEqual(memory.baseline('first', x), x, 'the oldest prompt is forgotten first');
    assert.deepEqual(memory.baseline('third', x), y, 'newer prompts are kept');
});

test('plan covers only the participants it is asked about', () => {
    const both = snapshot([item('dress', 'clothes')], [item('suit', 'clothes')]);
    const always = { ...generator, always: { bot: true, user: true } };
    assert.deepEqual(plan({ snapshot: both, generator: always, targets: ['user'] }).sides.map(side => side.target), ['user']);
    assert.deepEqual(plan({ snapshot: both, generator: always, targets: [] }).sides, []);
    assert.deepEqual(plan({ snapshot: both, generator: always }).sides.map(side => side.target), ['bot', 'user']);
});

test('empty plan returns body unchanged', () => {
    const source = body();
    assert.deepEqual(augmentGeminiBody(source, { sides: [] }, new Map()), source);
});

test('formatReport speaks Russian plurals', () => {
    assert.equal(formatReport(null), 'ещё не было');
    assert.equal(formatReport({ sides: [{ name: 'Маша', images: ['clothes', 'hair'], text: ['clothes'] }, { name: 'Петя', images: ['clothes'], text: [] }] }),
        'Маша — 2 картинки, 1 текстом; Петя — 1 картинка');
    assert.equal(formatReport({ sides: [{ name: 'Маша', images: ['a', 'b', 'c', 'd', 'e'], text: [] }] }), 'Маша — 5 картинок');
    assert.equal(formatReport({ sides: [{ name: 'Петя', images: [], text: ['clothes', 'hair'] }] }), 'Петя — 2 текстом');
    assert.equal(formatReport({ sides: [{ name: 'Маша', images: Array(11).fill('x'), text: [] }] }), 'Маша — 11 картинок');
    assert.equal(formatReport({ sides: [], changed: false }), 'ничего: наряды не менялись, промпт уже с ними');
    assert.equal(formatReport({ sides: [], changed: true }), 'ничего: тех, кто переоделся, нет в кадре');
});
