import assert from 'node:assert/strict';
import test from 'node:test';
import { createState, reduceWardrobe, selectWardrobe, selectCollection } from '../wardrobe.js';
import { createId } from '../ids.js';
import { freezeDeep, garment, inventory, owner, wear } from './fixtures.js';

const selection = state => selectWardrobe(state, owner.characterKey, owner.target);

test('domain state is JSON-serializable and starts with no assignments', () => {
    const state = createState();
    assert.deepEqual(state, { schemaVersion: 3, enabled: true, items: [], assignments: [] });
    assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
    assert.deepEqual(selection(state), { mode: 'full', items: [] });
    assert.equal(state.assignments.length, 0);
});

test('identifier generation does not require secure-context randomUUID', () => {
    assert.equal(createId({ getRandomValues: values => values.fill(15) }), '0000000f-0000000f-0000000f-0000000f');
    assert.notEqual(createId(), createId());
});

test('text-only items are trimmed and created without mutating the input', () => {
    const state = freezeDeep(createState());
    const command = freezeDeep({ type: 'add-item', item: { ...garment('coat'), name: ' Coat ', description: ' Blue coat ' } });
    const next = reduceWardrobe(state, command);
    assert.equal(next.items[0].name, 'Coat');
    assert.equal(next.items[0].description, 'Blue coat');
    assert.equal(next.items[0].imagePath, '');
    assert.equal(next.items[0].sendImage, true);
    assert.equal(state.items.length, 0);
});

test('text-only send mode survives add and edit without resetting to the default', () => {
    let state = inventory({ ...garment('coat'), sendImage: false });
    assert.equal(state.items[0].sendImage, false);
    state = reduceWardrobe(freezeDeep(state), { type: 'edit-item', item: { ...garment('coat'), description: 'Still text only', sendImage: false } });
    assert.equal(state.items[0].sendImage, false);
    state = reduceWardrobe(freezeDeep(state), { type: 'edit-item', item: { ...garment('coat'), sendImage: true } });
    assert.equal(state.items[0].sendImage, true);
});

test('bad commands fail atomically', () => {
    const state = freezeDeep(inventory(garment('coat')));
    const before = JSON.stringify(state);
    const invalid = [
        { type: 'add-item', item: garment('coat') },
        { type: 'add-item', item: { ...garment('new'), description: ' ' } },
        { type: 'add-item', item: { ...garment('new'), category: '__proto__' } },
        { type: 'add-item', item: { ...garment('new'), name: 42 } },
        { type: 'add-item', item: { ...garment('new'), audiences: [] } },
        { type: 'add-item', item: { ...garment('new'), audiences: ['npc'] } },
        { type: 'add-item', item: { ...garment('new'), sendImage: 'yes' } },
        { type: 'edit-item', item: garment('missing') },
        { type: 'wear', ...owner, itemId: 'missing' },
        { type: 'wear', ...owner, target: 'npc', itemId: 'coat' },
        { type: 'wear', ...owner, characterKey: null, itemId: 'coat' },
        { type: 'set-mode', ...owner, mode: 'invalid' },
        { type: 'set-enabled', enabled: 'false' },
        { type: 'remove-category', ...owner, category: 'constructor' },
        { type: 'unknown' },
    ];
    for (const command of invalid) assert.throws(() => reduceWardrobe(state, command));
    assert.equal(JSON.stringify(state), before);
});

test('full and parts selections share accessories but never mix body clothing', () => {
    let state = inventory(garment('dress'), garment('shirt', 'top'), garment('pants', 'bottom'), garment('boots', 'shoes'), garment('ring', 'accessories'), garment('braid', 'hair'));
    for (const item of state.items) state = wear(freezeDeep(state), item.id);
    assert.deepEqual(selection(state).items.map(item => item.id), ['shirt', 'pants', 'boots', 'ring', 'braid']);
    state = reduceWardrobe(freezeDeep(state), { type: 'set-mode', ...owner, mode: 'full' });
    assert.deepEqual(selection(state).items.map(item => item.id), ['dress', 'ring', 'braid']);
    state = reduceWardrobe(state, { type: 'set-mode', ...owner, mode: 'parts' });
    assert.equal(selection(state).items.length, 5);
});

test('wearing another item of the same category replaces rather than stacks it', () => {
    let state = inventory(garment('coat'), garment('dress'));
    state = wear(wear(state, 'coat'), 'dress');
    state = wear(state, 'dress');
    assert.deepEqual(state.assignments[0].itemIds, ['dress']);
    assert.equal(state.assignments.length, 1);
});

test('owners and cards have separate selections even with special keys', () => {
    let state = inventory(garment('coat'), garment('boots', 'shoes'));
    state = wear(state, 'coat');
    state = wear(state, 'boots', { ...owner, target: 'user' });
    state = wear(state, 'coat', { ...owner, characterKey: '__proto__' });
    assert.equal(selection(state).mode, 'full');
    assert.equal(selectWardrobe(state, owner.characterKey, 'user').mode, 'parts');
    assert.deepEqual(selectWardrobe(state, 'character:bob.png', 'bot').items, []);
    assert.equal(selectWardrobe(state, '__proto__', 'bot').items.length, 1);
});

test('remove-category and clear-owner also remove hidden clothing', () => {
    let state = inventory(garment('coat'), garment('shirt', 'top'), garment('braid', 'hair'));
    for (const item of state.items) state = wear(state, item.id);
    state = wear(state, 'coat', { ...owner, target: 'user' });
    state = reduceWardrobe(freezeDeep(state), { type: 'remove-category', ...owner, category: 'hair' });
    assert.deepEqual(selection(state).items.map(item => item.id), ['shirt']);
    state = reduceWardrobe(freezeDeep(state), { type: 'clear-owner', ...owner });
    assert.deepEqual(selection(state).items, []);
    state = reduceWardrobe(state, { type: 'set-mode', ...owner, mode: 'full' });
    assert.deepEqual(selection(state).items, []);
    assert.equal(selectWardrobe(state, owner.characterKey, 'user').items.length, 1);
});

test('editing description updates the selected projection without changing older revisions', () => {
    const original = freezeDeep(wear(inventory(garment('coat')), 'coat'));
    const next = reduceWardrobe(original, { type: 'edit-item', item: { ...garment('coat'), description: 'Green coat' } });
    assert.equal(selection(next).items[0].description, 'Green coat');
    assert.equal(selection(original).items[0].description, 'coat description');
});

test('category edits and deletion remove all references, including other owners and cards', () => {
    let state = inventory(garment('coat'));
    for (const characterKey of [owner.characterKey, 'character:bob.png']) {
        for (const target of ['bot', 'user']) state = wear(state, 'coat', { characterKey, target });
    }
    const changed = reduceWardrobe(freezeDeep(state), { type: 'edit-item', item: garment('coat', 'top') });
    assert.ok(changed.assignments.every(entry => !entry.itemIds.length));
    const removed = reduceWardrobe(state, { type: 'delete-item', itemId: 'coat' });
    assert.ok(removed.assignments.every(entry => !entry.itemIds.length));
    assert.equal(removed.items.length, 0);
});

test('projections cannot mutate stored items', () => {
    const state = freezeDeep(wear(inventory(garment('coat')), 'coat'));
    selection(state).items[0].description = 'Changed';
    selection(state).items[0].audiences.length = 0;
    assert.equal(state.items[0].description, 'coat description');
    assert.equal(state.items[0].audiences.length, 2);
});

test('User and Char collections are global lists independent of selected card', () => {
    const state = inventory(
        { ...garment('dress'), audiences: ['user'] },
        { ...garment('coat'), audiences: ['bot'] },
        garment('ring', 'accessories'),
    );
    assert.deepEqual(selectCollection(state, 'user').map(item => item.id), ['dress', 'ring']);
    assert.deepEqual(selectCollection(state, 'bot').map(item => item.id), ['coat', 'ring']);
    assert.throws(() => wear(state, 'dress'));
    assert.throws(() => wear(state, 'coat', { ...owner, target: 'user' }));
    const first = wear(state, 'coat');
    const second = wear(first, 'coat', { ...owner, characterKey: 'character:bob.png' });
    assert.deepEqual(selectCollection(second, 'bot'), selectCollection(state, 'bot'));
    assert.equal(selection(second).items[0].id, 'coat');
    assert.equal(selectWardrobe(second, 'character:bob.png', 'bot').items[0].id, 'coat');
});

test('changing item audience removes only now-ineligible owner assignments', () => {
    let state = wear(inventory(garment('coat')), 'coat');
    state = wear(state, 'coat', { ...owner, target: 'user' });
    const next = reduceWardrobe(freezeDeep(state), { type: 'edit-item', item: { ...garment('coat'), audiences: ['user'] } });
    assert.equal(selection(next).items.length, 0);
    assert.equal(selectWardrobe(next, owner.characterKey, 'user').items.length, 1);
});