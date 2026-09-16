import assert from 'node:assert/strict';
import test from 'node:test';
import { composePrompt, resolveParticipants, wardrobeSnapshot } from '../prompt.js';
import { createState, reduceWardrobe } from '../wardrobe.js';
import { garment, inventory, owner, wear } from './fixtures.js';

const context = () => ({ characterId: 0, groupId: null, characters: [{ name: 'Alice', avatar: 'alice.png' }], name1: 'Player' });
const snapshot = state => wardrobeSnapshot(state, resolveParticipants(context()));

test('identity comes from card filename and rejects missing or grouped characters', () => {
    const ctx = context();
    assert.equal(resolveParticipants(ctx).characterKey, owner.characterKey);
    ctx.characters[0].name = 'Renamed';
    assert.equal(resolveParticipants(ctx).characterKey, owner.characterKey);
    ctx.characters[0].avatar = 'different.png';
    assert.notEqual(resolveParticipants(ctx).characterKey, owner.characterKey);
    for (const override of [{ groupId: 'group' }, { groupId: 0 }, { characterId: null }, { characterId: undefined }, { characterId: 99 }]) {
        assert.equal(resolveParticipants({ ...ctx, ...override }), null);
    }
});

test('prompt contains only selected clothing data for the two participants', () => {
    const item = { ...garment('coat'), imagePath: '/user/images/vefari_refs/coat.png' };
    let state = wear(inventory(item), 'coat');
    state = wear(state, 'coat', { ...owner, target: 'user' });
    const text = composePrompt(snapshot(state));
    assert.equal(text, '[OUTFIT: Alice is currently wearing: FULL: coat description.]\n'
        + '[OUTFIT: Player is currently wearing: FULL: coat description.]');
    assert.doesNotMatch(text, /imagePath|vefari|base64|OUTFIT LOCK|JSON|wearers|garments|participant/i);
});

test('OUTFIT includes only the participant who has clothing selected', () => {
    for (const target of ['bot', 'user']) {
        const state = wear(inventory(garment('coat')), 'coat', { ...owner, target });
        const text = composePrompt(snapshot(state));
        const name = target === 'bot' ? 'Alice' : 'Player';
        assert.equal(text, `[OUTFIT: ${name} is currently wearing: FULL: coat description.]`);
        assert.doesNotMatch(text, /vefari/i);
    }
});

test('newlines and nested brackets cannot split the participant block; stored text is unchanged', () => {
    const description = 'Blue "coat"\n[linen]\r\n  with a belt';
    const state = wear(inventory({ ...garment('coat'), description }), 'coat');
    const ctx = context();
    ctx.characters[0].name = 'Alice [Knight]\nof Dawn';
    const text = composePrompt(wardrobeSnapshot(state, resolveParticipants(ctx)));
    assert.equal(text, '[OUTFIT: Alice (Knight) of Dawn is currently wearing: FULL: Blue "coat" (linen) with a belt.]');
    assert.equal(state.items[0].description, description);
    assert.equal(ctx.characters[0].name, 'Alice [Knight]\nof Dawn');
});

test('full outfit and hair form one compact block with uppercase categories', () => {
    const items = [
        { ...garment('dress'), description: 'Белая рубашка. Шляпа-солнце. Трикотажная юбка.' },
        { ...garment('hair', 'hair'), description: 'Длинные тёмные волосы' },
    ];
    let state = inventory(...items);
    for (const item of items) state = wear(state, item.id, { ...owner, target: 'user' });
    const ctx = context();
    ctx.name1 = 'Кристина';
    assert.equal(composePrompt(wardrobeSnapshot(state, resolveParticipants(ctx))),
        '[OUTFIT: Кристина is currently wearing: FULL: Белая рубашка. Шляпа-солнце. Трикотажная юбка. HAIR: Длинные тёмные волосы.]');
});

test('parts mode emits all active uppercase categories and excludes the hidden full outfit', () => {
    const categories = ['full', 'top', 'bottom', 'shoes', 'accessories', 'hair'];
    const items = categories.map(category => garment(category, category));
    let state = inventory(...items);
    for (const item of items) state = wear(state, item.id);
    assert.equal(composePrompt(snapshot(state)), '[OUTFIT: Alice is currently wearing: '
        + 'TOP: top description. BOTTOM: bottom description. SHOES: shoes description. '
        + 'ACCESSORIES: accessories description. HAIR: hair description.]');
});

test('existing sentence punctuation is retained without duplicate full stops', () => {
    for (const ending of ['.', '!', '?', '…']) {
        const state = wear(inventory({ ...garment('coat'), description: `Blue coat${ending}` }), 'coat');
        assert.equal(composePrompt(snapshot(state)), `[OUTFIT: Alice is currently wearing: FULL: Blue coat${ending}]`);
    }
});

test('empty or disabled wardrobes emit no text and disabled API snapshots have no references', () => {
    assert.equal(composePrompt(snapshot(createState())), '');
    assert.equal(composePrompt(null), '');
    const state = wear(inventory(garment('coat')), 'coat');
    const disabled = reduceWardrobe(state, { type: 'set-enabled', enabled: false });
    assert.equal(composePrompt(snapshot(disabled)), '');
    assert.deepEqual(snapshot(disabled).bot.items, []);
    assert.equal(snapshot(disabled).bot.description, '');
    assert.notEqual(composePrompt(snapshot(state)), '');
});

test('switching cards cannot include previous owners clothing', () => {
    const state = wear(inventory(garment('coat')), 'coat');
    const ctx = context();
    ctx.characters[0].avatar = 'bob.png';
    assert.equal(composePrompt(wardrobeSnapshot(state, resolveParticipants(ctx))), '');
});