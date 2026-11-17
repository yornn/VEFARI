import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createController } from '../integration.js';
import { garment, inventory, owner, wear } from './fixtures.js';

function fakeScope() {
    const scope = { sent: [] };
    scope.fetch = scope.original = (input, init) => { scope.sent.push([input, init]); return Promise.resolve('ok'); };
    return scope;
}

function host(options = {}) {
    const scope = fakeScope();
    const prompts = new Map();
    const errors = [];
    let saves = 0;
    let context = {
        extensionSettings: { vefari: wear(inventory(garment('coat')), 'coat') },
        characters: [{ name: 'Alice', avatar: 'alice.png' }, { name: 'Bob', avatar: 'bob.png' }],
        characterId: 0, groupId: null, name1: 'Player',
        eventSource: new EventEmitter(),
        eventTypes: { APP_READY: 'ready', CHAT_CHANGED: 'chat', GENERATION_STARTED: 'generate', GENERATION_AFTER_COMMANDS: 'commands' },
        saveSettingsDebounced: () => saves++,
        setExtensionPrompt: (key, ...args) => prompts.set(key, args),
    };
    const controller = createController(() => context, { reportError: error => errors.push(error), scope, ...options });
    return {
        controller, prompts, errors, scope,
        get context() { return context; },
        get saves() { return saves; },
        switchContext(next) { context = next; },
        prompt: () => prompts.get('vefari_outfit')?.[0],
    };
}

test('the saved depth decides where the outfit lines go in the chat', () => {
    const h = host();
    h.controller.connect();
    h.controller.dispatch({ type: 'set-inject-depth', depth: 0 });
    assert.deepEqual(h.prompts.get('vefari_outfit'), ['clothes Alice: coat description', 1, 0, false, 0]);
    h.controller.dispatch({ type: 'set-inject-depth', depth: 12 });
    h.context.eventSource.emit('generate');
    assert.deepEqual(h.prompts.get('vefari_outfit').slice(1), [1, 12, false, 0]);
    assert.equal(h.saves, 2);
});

test('connect is idempotent; generation maintains one system prompt at the default depth', () => {
    const h = host();
    h.controller.connect();
    h.controller.connect();
    assert.equal(h.context.eventSource.listenerCount('generate'), 1);
    for (const type of ['normal', 'swipe', 'regenerate', 'quiet']) {
        h.context.eventSource.emit('generate', type);
        assert.equal(h.prompt(), 'clothes Alice: coat description');
    }
    assert.equal(h.prompts.size, 1);
    assert.deepEqual(h.prompts.get('vefari_outfit').slice(1), [1, 4, false, 0]);
    assert.equal(h.saves, 0);
});

test('dispatch persists once, refreshes prompt and notifies observers', () => {
    const h = host();
    let renders = 0;
    const unsubscribe = h.controller.subscribe(() => renders++);
    h.controller.dispatch({ type: 'edit-item', item: { ...garment('coat'), description: 'Green coat' } });
    assert.equal(h.saves, 1);
    assert.equal(renders, 1);
    assert.match(h.prompt(), /Green coat/);
    unsubscribe();
    h.controller.dispatch({ type: 'set-enabled', enabled: false });
    assert.equal(h.prompt(), '');
    assert.equal(renders, 1);
    h.controller.dispatch({ type: 'set-enabled', enabled: true });
    assert.match(h.prompt(), /Green coat/);
});

test('invalid mutation neither persists nor changes the active instruction', () => {
    const h = host();
    h.controller.connect();
    const previous = h.prompt();
    const stored = h.context.extensionSettings.vefari;
    assert.throws(() => h.controller.dispatch({ type: 'wear', ...owner, itemId: 'missing' }));
    assert.equal(h.saves, 0);
    assert.equal(h.context.extensionSettings.vefari, stored);
    assert.equal(h.prompt(), previous);
});

test('one faulty view listener does not block persistence, injection or other listeners', () => {
    const h = host();
    let observed = false;
    h.controller.subscribe(() => { throw new Error('View failed'); });
    h.controller.subscribe(() => { observed = true; });
    assert.doesNotThrow(() => h.controller.dispatch({ type: 'set-enabled', enabled: false }));
    assert.equal(h.prompt(), '');
    assert.equal(h.saves, 1);
    assert.equal(h.errors[0].message, 'View failed');
    assert.equal(observed, true);
});

test('events resolve fresh context including after slash commands', () => {
    const h = host();
    h.controller.connect();
    const source = h.context.eventSource;
    h.switchContext({ ...h.context, characterId: 1 });
    source.emit('chat');
    assert.equal(h.prompt(), '');
    h.switchContext({ ...h.context, characterId: 0 });
    source.emit('commands');
    assert.match(h.prompt(), /coat description/);
    h.switchContext({ ...h.context, groupId: 'group' });
    source.emit('generate');
    assert.equal(h.prompt(), '');
});

test('malformed settings clear the old injection without deleting saved data', () => {
    const h = host();
    h.controller.connect();
    const broken = { schemaVersion: 99, items: [] };
    h.context.extensionSettings.vefari = broken;
    h.context.eventSource.emit('generate');
    assert.equal(h.prompt(), '');
    assert.equal(h.context.extensionSettings.vefari, broken);
    assert.equal(h.errors.length, 1);
    assert.equal(h.saves, 0);
});

test('legacy event names and missing optional events are supported', () => {
    const h = host();
    h.context.event_types = h.context.eventTypes;
    delete h.context.eventTypes;
    delete h.context.event_types.GENERATION_AFTER_COMMANDS;
    let renders = 0;
    h.controller.subscribe(() => renders++);
    h.controller.connect();
    h.context.eventSource.emit('ready');
    h.context.eventSource.emit('chat');
    assert.equal(renders, 3);
});

test('dispose detaches events and clears the prompt', () => {
    const h = host();
    h.controller.connect();
    h.controller.dispose();
    assert.equal(h.context.eventSource.eventNames().length, 0);
    assert.equal(h.prompt(), '');
    h.controller.connect();
    assert.equal(h.context.eventSource.listenerCount('generate'), 1);
    assert.match(h.prompt(), /coat description/);
});

test('public snapshots are isolated and text-only or disabled outfits do not load images', async () => {
    let reads = 0;
    const h = host({ readImage: async () => { reads++; return { mimeType: 'image/png', base64: 'abc' }; } });
    const api = h.controller.api;
    api.getActiveOutfits().bot.items[0].description = 'Mutated';
    assert.equal(api.getActiveOutfits().bot.items[0].description, 'coat description');
    assert.deepEqual(await api.getImageReferences(), []);
    h.controller.dispatch({ type: 'edit-item', item: { ...garment('coat'), imagePath: '/user/images/vefari_refs/coat.png' } });
    assert.equal((await api.getImageReferences()).length, 1);
    assert.equal(reads, 1);
    h.controller.dispatch({ type: 'set-send-mode', target: 'bot', mode: 'text' });
    assert.deepEqual(await api.getImageReferences(), []);
    assert.equal(reads, 1);
    h.controller.dispatch({ type: 'set-send-mode', target: 'bot', mode: 'image' });
    h.controller.dispatch({ type: 'set-enabled', enabled: false });
    assert.deepEqual(await api.getImageReferences(), []);
    assert.equal(reads, 1);
    h.context.characterId = undefined;
    assert.equal(api.getActiveOutfits(), null);
    await assert.rejects(api.getImageReferences('npc'));
});

test('asynchronous reference loading cannot mix characters when chat changes mid-read', async () => {
    let complete;
    const h = host({ readImage: () => new Promise(resolve => { complete = resolve; }) });
    h.controller.dispatch({ type: 'edit-item', item: { ...garment('coat'), imagePath: '/user/images/vefari_refs/coat.png' } });
    const pending = h.controller.api.getImageReferences();
    h.context.characterId = 1;
    h.controller.dispatch({ type: 'edit-item', item: { ...garment('coat'), description: 'Edited after read started' } });
    complete({ mimeType: 'image/png', base64: 'abc' });
    const references = await pending;
    assert.equal(references.length, 1);
    assert.equal(references[0].description, 'coat description');
    assert.equal(references[0].base64, 'abc');
    assert.deepEqual(await h.controller.api.getImageReferences(), []);
});

test('reference failures reject rather than silently dropping garments', async () => {
    const h = host({ readImage: async () => { throw new Error('Image unavailable'); } });
    h.controller.dispatch({ type: 'edit-item', item: { ...garment('coat'), imagePath: '/user/images/vefari_refs/coat.png' } });
    await assert.rejects(h.controller.api.getImageReferences(), /Image unavailable/);
});
const GENERATOR_URL = 'https://img.example/v1beta/models/m:generateContent';
const geminiBody = (text = 'Alice in the rain') => JSON.stringify({
    contents: [{ role: 'user', parts: [{ text }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
});

function bridgeHost(options = {}, before = () => {}) {
    const h = host({ readImage: async () => ({ mimeType: 'image/png', base64: 'COAT' }), ...options });
    h.context.extensionSettings.inline_image_gen = {
        apiType: 'gemini', endpoint: 'https://img.example', geminiSendRefs: true,
        charRefAlways: false, userRefAlways: false, charRef: { name: '' }, userRef: { name: '' },
    };
    h.controller.dispatch({ type: 'edit-item', item: { ...garment('coat'), imagePath: '/user/images/vefari_refs/coat.png' } });
    before(h.context);
    h.controller.connect();
    return h;
}

const generate = (h, body = geminiBody()) => h.scope.fetch(GENERATOR_URL, { method: 'POST', body });
const sentParts = h => JSON.parse(h.scope.sent.at(-1)[1].body).contents[0].parts;
const redress = (h, description = 'red dress') => h.controller.dispatch({
    type: 'edit-item', item: { ...garment('coat'), description, imagePath: '/user/images/vefari_refs/coat.png' },
});

// A host whose SillyTavern runs the newer macro engine (true) or only the older parser (false).
function macroHost(engine) {
    const registry = new Map();
    const h = bridgeHost({}, context => {
        context.powerUserSettings = { experimental_macro_engine: engine };
        context.macros = {
            category: { MISC: 'misc' },
            registry: { registerMacro: (name, options) => registry.set(name, options), unregisterMacro: name => registry.delete(name) },
        };
        context.registerMacro = (name, handler, description) => registry.set(`legacy:${name}`, { handler, description });
        context.unregisterMacro = name => registry.delete(`legacy:${name}`);
    });
    return { h, registry };
}

test('bridge stays silent while the prompt already has the outfit, and says so in the report', async () => {
    const h = bridgeHost();
    let renders = 0;
    h.controller.subscribe(() => renders++);
    const body = geminiBody();
    await generate(h, body);
    await generate(h, body);
    assert.deepEqual(h.scope.sent.map(([, init]) => init.body), [body, body]);
    assert.deepEqual(h.controller.view().report, { sides: [], changed: false });
    assert.equal(renders, 2);
    assert.deepEqual(h.errors, []);
});

test('after a change of outfit the same prompt gets the picture and a closing update note', async () => {
    const h = bridgeHost();
    await generate(h);
    redress(h);
    await generate(h);
    const parts = sentParts(h);
    assert.match(parts[0].text, /^Outfit reference for Alice: coat\. Use it only for the design/);
    assert.deepEqual(parts[1], { inlineData: { mimeType: 'image/png', data: 'COAT' } });
    assert.ok(parts.at(-1).text.startsWith('Alice in the rain\n\n[Outfit update: '));
    assert.ok(parts.at(-1).text.endsWith('\nclothes Alice: red dress]'));
    assert.deepEqual(h.controller.view().report, { sides: [{ name: 'Alice', images: ['clothes'], text: [] }] });
    // Back in what the prompt describes: silent again.
    redress(h, 'coat description');
    const body = geminiBody();
    await generate(h, body);
    assert.equal(h.scope.sent.at(-1)[1].body, body);
});

test('a prompt written from the chat before a change is noted; dry runs, quiet requests and chat changes are not writers', async () => {
    const h = bridgeHost();
    h.context.eventSource.emit('generate', 'normal', {}, false);
    redress(h);
    h.context.eventSource.emit('generate', 'normal', {}, true);
    h.context.eventSource.emit('generate', 'quiet', {}, false);
    // A rewrite of the picture's prompt from the reply's chat, which still had the coat.
    await generate(h, geminiBody('Alice by the fire'));
    assert.match(sentParts(h).at(-1).text, /\nclothes Alice: red dress]$/);
    // A new reply is written with the dress in the chat: its pictures need nothing.
    h.context.eventSource.emit('generate', 'normal', {}, false);
    const next = geminiBody('Alice at dawn');
    await generate(h, next);
    assert.equal(h.scope.sent.at(-1)[1].body, next);
    // Another chat: what was seen in this one says nothing about prompts written there.
    redress(h, 'green cloak');
    h.context.eventSource.emit('chat');
    const elsewhere = geminiBody('Alice on the road');
    await generate(h, elsewhere);
    assert.equal(h.scope.sent.at(-1)[1].body, elsewhere);
});

test('{{outfits}} registers with the macro engine in use, gives the current lines and is removed on dispose', () => {
    const modern = macroHost(true);
    assert.deepEqual([...modern.registry.keys()], ['outfits']);
    assert.equal(modern.registry.get('outfits').category, 'misc');
    assert.match(modern.registry.get('outfits').description, /VEFARI/);
    assert.equal(modern.registry.get('outfits').handler(), 'clothes Alice: coat description');
    redress(modern.h);
    assert.equal(modern.registry.get('outfits').handler(), 'clothes Alice: red dress');
    modern.h.controller.dispose();
    assert.equal(modern.registry.size, 0);
    const legacy = macroHost(false);
    assert.deepEqual([...legacy.registry.keys()], ['legacy:outfits']);
    assert.equal(legacy.registry.get('legacy:outfits').handler('nonce'), 'clothes Alice: coat description');
    legacy.h.controller.dispatch({ type: 'set-enabled', enabled: false });
    assert.equal(legacy.registry.get('legacy:outfits').handler('nonce'), '');
});

test('a prompt rewritten through {{outfits}} after a change already has the new outfit and gets nothing', async () => {
    const { h, registry } = macroHost(true);
    h.context.eventSource.emit('generate', 'normal', {}, false);
    redress(h);
    // The prompt model expands {{outfits}} from its OOC field while it rewrites the prompt.
    registry.get('outfits').handler();
    const rewritten = geminiBody('Alice by the fire in a red dress');
    await generate(h, rewritten);
    assert.equal(h.scope.sent.at(-1)[1].body, rewritten);
    assert.deepEqual(h.controller.view().report, { sides: [], changed: false });
});

test('a broken macro registration is reported and the rest still works', async () => {
    const h = bridgeHost({}, context => {
        context.registerMacro = () => { throw new Error('No macros here'); };
    });
    assert.equal(h.errors[0].message, 'No macros here');
    await generate(h);
    redress(h);
    await generate(h);
    assert.match(sentParts(h).at(-1).text, /red dress]$/);
});

test('disabled wardrobe leaves request untouched', async () => {
    const h = bridgeHost();
    h.controller.dispatch({ type: 'set-enabled', enabled: false });
    const body = geminiBody();
    await generate(h, body);
    assert.equal(h.scope.sent.at(-1)[1].body, body);
    assert.equal(h.controller.view().report, null);
});

test('missing image falls back to text', async t => {
    const warn = t.mock.method(console, 'warn', () => {});
    const h = bridgeHost({ readImage: async () => { throw new Error('gone'); } });
    await generate(h);
    redress(h);
    await generate(h);
    const parts = sentParts(h);
    assert.equal(parts.some(part => part.inlineData), false);
    assert.match(parts.at(-1).text, /clothes Alice: red dress]$/);
    assert.deepEqual(h.controller.view().report, { sides: [{ name: 'Alice', images: [], text: ['clothes'] }] });
    assert.equal(warn.mock.callCount(), 1);
});

test('non-generator requests and absent generator are untouched', async () => {
    const h = bridgeHost();
    const chat = { method: 'POST', body: geminiBody() };
    await h.scope.fetch('/api/backends/chat-completions/generate', chat);
    assert.equal(h.scope.sent.at(-1)[1], chat);
    delete h.context.extensionSettings.inline_image_gen;
    const image = { method: 'POST', body: geminiBody() };
    await h.scope.fetch(GENERATOR_URL, image);
    assert.equal(h.scope.sent.at(-1)[1], image);
    assert.equal(h.controller.view().report, null);
});

test('malformed generator settings warn once', async () => {
    const h = bridgeHost();
    h.context.extensionSettings.inline_image_gen = { endpoint: 'x' };
    const body = geminiBody();
    await generate(h, body);
    await generate(h, body);
    assert.equal(h.errors.length, 1);
    assert.match(h.errors[0].message, /не распознаны/);
    assert.deepEqual(h.scope.sent.map(([, init]) => init.body), [body, body]);
});

test('dispose removes the interceptor', async () => {
    const h = bridgeHost();
    assert.notEqual(h.scope.fetch, h.scope.original);
    h.controller.dispose();
    assert.equal(h.scope.fetch, h.scope.original);
    const body = geminiBody();
    await generate(h, body);
    assert.equal(h.scope.sent.at(-1)[1].body, body);
});

test('chat traffic is sent synchronously, without waiting for the bridge', () => {
    const h = bridgeHost();
    const chat = { method: 'POST', body: '{"messages":[]}' };
    void h.scope.fetch('/api/backends/chat-completions/generate', chat);
    assert.equal(h.scope.sent.length, 1);
    assert.equal(h.scope.sent[0][1], chat);
});
