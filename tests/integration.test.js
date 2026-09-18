import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createController } from '../integration.js';
import { garment, inventory, owner, wear } from './fixtures.js';

function host(options = {}) {
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
    const controller = createController(() => context, { reportError: error => errors.push(error), ...options });
    return {
        controller, prompts, errors,
        get context() { return context; },
        get saves() { return saves; },
        switchContext(next) { context = next; },
        prompt: () => prompts.get('vefari_outfit')?.[0],
    };
}

test('connect is idempotent; generation maintains one depth-zero system prompt', () => {
    const h = host();
    h.controller.connect();
    h.controller.connect();
    assert.equal(h.context.eventSource.listenerCount('generate'), 1);
    for (const type of ['normal', 'swipe', 'regenerate', 'quiet']) {
        h.context.eventSource.emit('generate', type);
        assert.equal(h.prompt(), '[OUTFIT: Alice is currently wearing: FULL: coat description.]');
    }
    assert.equal(h.prompts.size, 1);
    assert.deepEqual(h.prompts.get('vefari_outfit').slice(1), [1, 0, false, 0]);
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
    h.controller.dispatch({ type: 'edit-item', item: { ...garment('coat'), imagePath: '/user/images/vefari_refs/coat.png', sendImage: false } });
    assert.deepEqual(await api.getImageReferences(), []);
    assert.equal(reads, 1);
    h.controller.dispatch({ type: 'edit-item', item: { ...garment('coat'), imagePath: '/user/images/vefari_refs/coat.png' } });
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