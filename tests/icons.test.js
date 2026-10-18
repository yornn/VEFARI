import assert from 'node:assert/strict';
import test from 'node:test';
import { CATEGORIES } from '../wardrobe.js';
import { ICONS, fibulaOutline } from '../icons.js';

const numbers = d => d.match(/-?\d+(\.\d+)?/g).map(Number);

test('every category has its own icon', () => {
    for (const category of Object.keys(CATEGORIES)) assert.ok(ICONS[category]?.length, category);
    for (const name of ['settings', 'close', 'back', 'plus', 'minus', 'check', 'chevron', 'edit', 'delete', 'import', 'export', 'image', 'algiz', 'othala', 'feather']) assert.ok(ICONS[name]?.length, name);
});

test('the feather differs from the edit quill and stays inside the 24-unit grid', () => {
    assert.notDeepEqual(ICONS.feather, ICONS.edit);
    for (const d of ICONS.feather) assert.ok(numbers(d).every(value => value >= 0 && value <= 24), d);
});

test('fibula outlines are closed shapes of finite numbers', () => {
    for (const variant of ['large', 'small']) {
        const { ring, pin, eye, eyeWidth } = fibulaOutline(variant);
        for (const d of [ring, pin]) {
            assert.match(d, /^M[\d.]/);
            assert.match(d, /Z$/);
            assert.ok(numbers(d).every(Number.isFinite));
        }
        assert.match(eye, /^M.*A.*A/);
        assert.ok(eyeWidth > 0);
    }
    assert.ok(numbers(fibulaOutline('large').ring).length > numbers(fibulaOutline('small').ring).length);
    assert.equal(fibulaOutline('large').ring, fibulaOutline('large').ring);
});
