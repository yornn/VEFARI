import assert from 'node:assert/strict';
import test from 'node:test';
import { composePrompt, outfitBlock, resolveParticipants, wardrobeSnapshot } from '../prompt.js';
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

test('prompt is one plain line per participant, Char first, with no brackets or framing', () => {
    const item = { ...garment('coat'), imagePath: '/user/images/vefari_refs/coat.png' };
    let state = wear(inventory(item), 'coat');
    state = wear(state, 'coat', { ...owner, target: 'user' });
    const text = composePrompt(snapshot(state));
    assert.equal(text, 'clothes Alice: coat description\nclothes Player: coat description');
    assert.doesNotMatch(text, /[[\]]|imagePath|vefari|base64|OUTFIT|wearing|JSON|participant/i);
});

test('only the participant who has something on gets a line', () => {
    for (const target of ['bot', 'user']) {
        const state = wear(inventory(garment('coat')), 'coat', { ...owner, target });
        const name = target === 'bot' ? 'Alice' : 'Player';
        assert.equal(composePrompt(snapshot(state)), `clothes ${name}: coat description`);
    }
});

test('clothes and hairstyle share one line, joined by a semicolon', () => {
    const items = [
        { ...garment('tunic'), description: 'long dark purple tunic, mid-thigh length, medieval Norse attire.' },
        { ...garment('bob', 'hair'), description: 'ultra-blunt bowl-shaped micro bob, heavy straight fringe' },
    ];
    let state = inventory(...items);
    for (const item of items) state = wear(state, item.id, { ...owner, target: 'user' });
    const ctx = context();
    ctx.name1 = 'Кристина';
    assert.equal(composePrompt(wardrobeSnapshot(state, resolveParticipants(ctx))),
        'clothes Кристина: long dark purple tunic, mid-thigh length, medieval Norse attire; '
        + 'hairstyle: ultra-blunt bowl-shaped micro bob, heavy straight fringe');
});

test('a hairstyle alone carries the name itself', () => {
    const state = wear(inventory(garment('braid', 'hair')), 'braid');
    assert.equal(composePrompt(snapshot(state)), 'hairstyle Alice: braid description');
});

test('line breaks cannot split a participant line; brackets and stored text are left alone', () => {
    const description = 'Blue "coat"\n[linen]\r\n  with a belt';
    const state = wear(inventory({ ...garment('coat'), description }), 'coat');
    const ctx = context();
    ctx.characters[0].name = 'Alice [Knight]\nof Dawn';
    const text = composePrompt(wardrobeSnapshot(state, resolveParticipants(ctx)));
    assert.equal(text, 'clothes Alice [Knight] of Dawn: Blue "coat" [linen] with a belt');
    assert.equal(state.items[0].description, description);
    assert.equal(ctx.characters[0].name, 'Alice [Knight]\nof Dawn');
});

test('trailing full stops, commas and semicolons are dropped; other endings stay', () => {
    for (const [ending, kept] of [['.', ''], ['. ', ''], [';', ''], [',', ''], ['!', '!'], ['?', '?'], ['…', '…']]) {
        const state = wear(inventory({ ...garment('coat'), description: `Blue coat${ending}` }), 'coat');
        assert.equal(composePrompt(snapshot(state)), `clothes Alice: Blue coat${kept}`);
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

test('outfitBlock formats one participant exactly like the chat injection', () => {
    const items = [{ ...garment('jacket'), description: 'Black leather jacket.' }, { ...garment('bun', 'hair'), description: 'low bun' }];
    assert.equal(outfitBlock('Маша', items), 'clothes Маша: Black leather jacket; hairstyle: low bun');
    assert.equal(outfitBlock('Маша', []), '');
    assert.equal(outfitBlock('Маша', [{ ...garment('blank'), description: ' . ' }]), '');
});
