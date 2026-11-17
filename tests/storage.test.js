import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeSettings, readSettings, retainedImages, writeSettings } from '../storage.js';
import { createState, selectWardrobe } from '../wardrobe.js';
import { freezeDeep, garment, inventory, owner, wear } from './fixtures.js';

function prototype() {
    return {
        enabled: false,
        items: [garment('dress', 'full'), garment('shirt', 'top'), { ...garment('ring', 'accessories'), imagePath: '/user/images/vefari_refs/ring.png' }],
        activeOutfits: { [owner.characterKey]: { botMode: 'parts', userMode: 'full', bot: { full: 'dress', top: 'shirt', accessories: 'ring' }, user: { full: 'dress' } } },
    };
}

// A 0.8 wardrobe: six categories, Char wearing parts with a hidden full outfit, User wearing a full outfit.
function schema3() {
    const items = [
        garment('dress', 'full'), garment('shirt', 'top'), garment('skirt', 'bottom'), garment('boots', 'shoes'),
        { ...garment('ring', 'accessories'), imagePath: '/user/images/vefari_refs/ring.png' }, garment('braid', 'hair'),
        { ...garment('cloak', 'full'), audiences: ['user'] },
    ];
    return {
        schemaVersion: 3, enabled: true, items, sendModes: { bot: 'image', user: 'text' }, maxImageRefs: 6,
        describer: { source: 'profile', profileId: 'p1', customUrl: '', customModel: '' },
        assignments: [
            { characterKey: owner.characterKey, target: 'bot', mode: 'parts', itemIds: ['dress', 'boots', 'ring', 'shirt', 'braid'] },
            { characterKey: owner.characterKey, target: 'user', mode: 'full', itemIds: ['ring', 'cloak', 'shirt'] },
            { characterKey: 'character:bob.png', target: 'bot', mode: 'full', itemIds: ['missing', 'cloak', 'skirt'] },
        ],
    };
}

test('new installation starts empty without mutating host settings', () => {
    const context = { extensionSettings: {} };
    assert.deepEqual(readSettings(context), createState());
    assert.deepEqual(context.extensionSettings, {});
});

test('prototype migration keeps inventory and disabled state, and the piece its mode showed first', () => {
    const raw = freezeDeep(prototype());
    const state = decodeSettings(raw);
    assert.equal(state.schemaVersion, 4);
    assert.equal(state.enabled, false);
    assert.deepEqual(state.items, raw.items.map(item => ({ ...item, category: 'clothes' })));
    assert.deepEqual(selectWardrobe(state, owner.characterKey, 'bot').items.map(item => item.id), ['shirt']);
    assert.deepEqual(state.assignments[0].itemIds, ['shirt']);
    assert.equal(selectWardrobe(state, owner.characterKey, 'user').items[0].id, 'dress');
});

test('schema 3 collapses six categories into clothes and hair and keeps one piece of clothing per owner', () => {
    const raw = freezeDeep(schema3());
    const state = decodeSettings(raw);
    assert.equal(state.schemaVersion, 4);
    assert.deepEqual(state.items.map(item => [item.id, item.category]), [
        ['dress', 'clothes'], ['shirt', 'clothes'], ['skirt', 'clothes'], ['boots', 'clothes'], ['ring', 'clothes'], ['braid', 'hair'], ['cloak', 'clothes'],
    ]);
    const worn = (characterKey, target) => selectWardrobe(state, characterKey, target).items.map(item => item.id);
    // Parts mode showed the shirt first; the dress was hidden under it.
    assert.deepEqual(worn(owner.characterKey, 'bot'), ['shirt', 'braid']);
    // Full mode showed the cloak before the accessories; the shirt was hidden.
    assert.deepEqual(worn(owner.characterKey, 'user'), ['cloak']);
    // A missing piece and one from the other collection do not take the place.
    assert.deepEqual(worn('character:bob.png', 'bot'), ['skirt']);
    assert.ok(state.assignments.every(entry => !Object.hasOwn(entry, 'mode')));
    assert.deepEqual([state.sendModes, state.maxImageRefs, state.describer.profileId], [{ bot: 'image', user: 'text' }, 6, 'p1']);
});

test('schema 3 moves from depth 0 to the default depth and is backed up once on the first save', () => {
    const raw = schema3();
    const context = { extensionSettings: { vefari: raw }, saveSettingsDebounced() {} };
    const upgraded = readSettings(context);
    assert.equal(upgraded.injectDepth, 4);
    writeSettings(context, upgraded);
    assert.deepEqual(context.extensionSettings.vefari_v3_backup, raw);
    assert.notEqual(context.extensionSettings.vefari_v3_backup, raw);
    writeSettings(context, createState());
    assert.deepEqual(context.extensionSettings.vefari_v3_backup, raw);
    assert.ok(retainedImages(context).some(item => item.imagePath.endsWith('ring.png')));
    assert.equal(Object.hasOwn(context.extensionSettings, 'vefari_v2_backup'), false);
});

test('first save after migration creates exactly one backup and retains its images', () => {
    const original = prototype();
    let saves = 0;
    const context = { extensionSettings: { vefari: original, unrelated: { enabled: true } }, saveSettingsDebounced: () => saves++ };
    writeSettings(context, decodeSettings(original));
    assert.deepEqual(context.extensionSettings.vefari_v1_backup, original);
    assert.notEqual(context.extensionSettings.vefari_v1_backup, original);
    writeSettings(context, createState());
    assert.deepEqual(context.extensionSettings.vefari_v1_backup, original);
    assert.ok(retainedImages(context).some(item => item.imagePath.endsWith('ring.png')));
    assert.equal(saves, 2);
    assert.deepEqual(context.extensionSettings.unrelated, { enabled: true });
});

test('current schema survives roundtrip and returns a detached value', () => {
    const state = wear(inventory(garment('coat')), 'coat');
    const result = decodeSettings(JSON.parse(JSON.stringify(state)));
    assert.deepEqual(result, state);
    result.assignments[0].itemIds.length = 0;
    result.items[0].description = 'Changed';
    assert.equal(state.assignments[0].itemIds.length, 1);
    assert.equal(state.items[0].description, 'coat description');
});

test('invalid or future schemas fail without overwriting saved data', () => {
    const badStates = [
        [], 'not settings', { schemaVersion: 99 }, { schemaVersion: 2, items: [], assignments: null },
        { schemaVersion: 2, enabled: true, items: null, assignments: [] },
        { schemaVersion: 2, enabled: 'false', items: [], assignments: [] },
        { items: 'bad' }, { items: [null] },
        { items: [garment('coat'), garment('coat')] },
        { items: [], activeOutfits: [] },
        { schemaVersion: 3, enabled: true, items: [], assignments: [{ characterKey: 'character:a.png', target: 'bot', mode: 'cloak', itemIds: [] }] },
        { schemaVersion: 3, enabled: true, items: [garment('hat', 'headwear')], assignments: [] },
        { schemaVersion: 4, enabled: true, items: [garment('top', 'top')], assignments: [] },
        { ...createState(), injectDepth: -1 },
        { ...createState(), injectDepth: '4' },
    ];
    for (const raw of badStates) {
        const context = { extensionSettings: { vefari: raw } };
        assert.throws(() => readSettings(context));
        assert.equal(context.extensionSettings.vefari, raw);
    }
});

test('dangling IDs are ignored; duplicate owner or clothing category is rejected', () => {
    const state = wear(inventory(garment('coat'), garment('dress')), 'coat');
    state.assignments[0].itemIds.push('missing');
    assert.deepEqual(decodeSettings(state).assignments[0].itemIds, ['coat']);
    state.assignments[0].itemIds.push('dress');
    assert.throws(() => decodeSettings(state));
    state.assignments[0].itemIds = ['coat'];
    state.assignments.push({ ...state.assignments[0] });
    assert.throws(() => decodeSettings(state));
});

test('schema 2 migration makes unclassified items available in both collections with backup', () => {
    const state = wear(inventory(garment('coat')), 'coat');
    const raw = {
        ...state, schemaVersion: 2, items: state.items.map(({ audiences, ...item }) => ({ ...item, category: 'full' })),
        assignments: state.assignments.map(entry => ({ ...entry, mode: 'full' })),
    };
    const context = { extensionSettings: { vefari: freezeDeep(raw) }, saveSettingsDebounced() {} };
    const upgraded = readSettings(context);
    assert.equal(upgraded.schemaVersion, 4);
    assert.deepEqual(upgraded.items[0].audiences, ['bot', 'user']);
    assert.equal(upgraded.items[0].category, 'clothes');
    assert.deepEqual(upgraded.assignments, state.assignments);
    writeSettings(context, upgraded);
    assert.deepEqual(context.extensionSettings.vefari_v2_backup, raw);
    writeSettings(context, createState());
    assert.deepEqual(context.extensionSettings.vefari_v2_backup, raw);
});

test('the current schema validates collection membership and does not revive mismatched assignments', () => {
    const state = wear(inventory(garment('coat')), 'coat');
    state.items[0].audiences = ['user'];
    assert.equal(decodeSettings(state).assignments[0].itemIds.length, 0);
    state.items[0].audiences = [];
    assert.throws(() => decodeSettings(state));
});
test('generator settings default when absent and are validated when present', () => {
    const legacy = JSON.parse(JSON.stringify(wear(inventory(garment('coat')), 'coat')));
    delete legacy.sendModes;
    delete legacy.maxImageRefs;
    const state = decodeSettings(legacy);
    assert.deepEqual(state.sendModes, { bot: 'image', user: 'image' });
    assert.equal(state.maxImageRefs, 4);
    assert.equal(decodeSettings({ ...legacy, maxImageRefs: 9 }).maxImageRefs, 9);
    assert.throws(() => decodeSettings({ ...legacy, maxImageRefs: 50 }));
    assert.deepEqual(decodeSettings({ ...legacy, sendModes: { bot: 'text', user: 'image' } }).sendModes, { bot: 'text', user: 'image' });
    assert.throws(() => decodeSettings({ ...legacy, sendModes: { bot: 'text' } }));
    assert.throws(() => decodeSettings({ ...legacy, sendModes: 'text' }));
});

test('injection depth defaults when absent and keeps a saved value', () => {
    const saved = JSON.parse(JSON.stringify(inventory(garment('coat'))));
    delete saved.injectDepth;
    assert.equal(decodeSettings(saved).injectDepth, 4);
    for (const depth of [0, 12, 100]) assert.equal(decodeSettings({ ...saved, injectDepth: depth }).injectDepth, depth);
    assert.throws(() => decodeSettings({ ...saved, injectDepth: 101 }), /от 0 до 100/);
});

test('the single generator switch of 0.7 becomes the same mode for both, and item flags are dropped', () => {
    const legacy = JSON.parse(JSON.stringify(wear(inventory(garment('coat')), 'coat')));
    delete legacy.sendModes;
    legacy.items[0].sendImage = false;
    const off = decodeSettings({ ...legacy, generatorImages: false });
    assert.deepEqual(off.sendModes, { bot: 'text', user: 'text' });
    assert.equal(Object.hasOwn(off, 'generatorImages'), false);
    assert.equal(Object.hasOwn(off.items[0], 'sendImage'), false);
    assert.deepEqual(decodeSettings({ ...legacy, generatorImages: true }).sendModes, { bot: 'image', user: 'image' });
    assert.throws(() => decodeSettings({ ...legacy, generatorImages: 'no' }));
    // A saved mode wins over a stale legacy switch.
    assert.deepEqual(decodeSettings({ ...legacy, generatorImages: false, sendModes: { bot: 'image', user: 'text' } }).sendModes, { bot: 'image', user: 'text' });
});

test('feather connection defaults when absent and never stores a key', () => {
    const legacy = JSON.parse(JSON.stringify(inventory(garment('coat'))));
    delete legacy.describer;
    assert.deepEqual(decodeSettings(legacy).describer, { source: 'profile', profileId: '', customUrl: '', customModel: '' });
    const tampered = { ...legacy, describer: { source: 'custom', customUrl: 'https://api.example.com/v1', customModel: 'm', key: 'sk-secret', apiKey: 'sk-secret' } };
    const context = { extensionSettings: {}, saveSettingsDebounced() {} };
    writeSettings(context, decodeSettings(tampered));
    assert.ok(!JSON.stringify(context.extensionSettings).includes('sk-secret'));
    assert.equal(context.extensionSettings.vefari.describer.customUrl, 'https://api.example.com/v1');
    assert.throws(() => decodeSettings({ ...legacy, describer: { source: 'custom', customUrl: 'https://u:p@api.example.com' } }));
    assert.throws(() => decodeSettings({ ...legacy, describer: 'custom' }));
});
