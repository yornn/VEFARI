import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeSettings, readSettings, retainedImages, writeSettings } from '../storage.js';
import { createState, selectWardrobe } from '../wardrobe.js';
import { freezeDeep, garment, inventory, owner, wear } from './fixtures.js';

function prototype() {
    return {
        enabled: false,
        items: [garment('dress'), garment('shirt', 'top'), { ...garment('ring', 'accessories'), imagePath: '/user/images/vefari_refs/ring.png' }],
        activeOutfits: { [owner.characterKey]: { botMode: 'parts', userMode: 'full', bot: { full: 'dress', top: 'shirt', accessories: 'ring' }, user: { full: 'dress' } } },
    };
}

test('new installation starts empty without mutating host settings', () => {
    const context = { extensionSettings: {} };
    assert.deepEqual(readSettings(context), createState());
    assert.deepEqual(context.extensionSettings, {});
});

test('prototype migration preserves inventory, disabled state, modes and hidden choices', () => {
    const raw = freezeDeep(prototype());
    const state = decodeSettings(raw);
    assert.equal(state.schemaVersion, 3);
    assert.equal(state.enabled, false);
    assert.deepEqual(state.items, raw.items);
    assert.deepEqual(selectWardrobe(state, owner.characterKey, 'bot').items.map(item => item.id), ['shirt', 'ring']);
    assert.deepEqual(state.assignments[0].itemIds, ['dress', 'shirt', 'ring']);
    assert.equal(selectWardrobe(state, owner.characterKey, 'user').items[0].id, 'dress');
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
    const raw = { ...state, schemaVersion: 2, items: state.items.map(({ audiences, ...item }) => item) };
    const context = { extensionSettings: { vefari: freezeDeep(raw) }, saveSettingsDebounced() {} };
    const upgraded = readSettings(context);
    assert.equal(upgraded.schemaVersion, 3);
    assert.deepEqual(upgraded.items[0].audiences, ['bot', 'user']);
    assert.deepEqual(upgraded.assignments, raw.assignments);
    writeSettings(context, upgraded);
    assert.deepEqual(context.extensionSettings.vefari_v2_backup, raw);
    writeSettings(context, createState());
    assert.deepEqual(context.extensionSettings.vefari_v2_backup, raw);
});

test('schema 3 validates collection membership and does not revive mismatched assignments', () => {
    const state = wear(inventory(garment('coat')), 'coat');
    state.items[0].audiences = ['user'];
    assert.equal(decodeSettings(state).assignments[0].itemIds.length, 0);
    state.items[0].audiences = [];
    assert.throws(() => decodeSettings(state));
});