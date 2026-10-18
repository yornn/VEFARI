import assert from 'node:assert/strict';
import test from 'node:test';
import { CATEGORIES } from '../wardrobe.js';
import { OUTFIT_PROMPTS } from '../outfit-prompts.js';

test('every category has its own prompt with the shared output contract', () => {
    assert.deepEqual(Object.keys(OUTFIT_PROMPTS).sort(), Object.keys(CATEGORIES).sort());
    for (const [category, prompt] of Object.entries(OUTFIT_PROMPTS)) {
        assert.match(prompt, /output exactly: NO_OUTFIT/, category);
        assert.match(prompt, /Output the description and nothing else/, category);
        assert.match(prompt, /EXAMPLES/, category);
        assert.doesNotMatch(prompt, /[А-яЁё]/, `${category} prompt stays English`);
    }
});

test('the full outfit leaves out the person and the hairstyle; hair is its own category', () => {
    assert.match(OUTFIT_PROMPTS.full, /Never describe the person: no hair or hairstyle, face, facial hair/);
    assert.match(OUTFIT_PROMPTS.full, /Weapons and other carried items/);
    assert.match(OUTFIT_PROMPTS.hair, /describe only the hairstyle/);
    assert.match(OUTFIT_PROMPTS.hair, /Leave out clothing, hats, crowns/);
    for (const category of ['top', 'bottom', 'shoes', 'accessories']) assert.match(OUTFIT_PROMPTS[category], /describe only/, category);
});
