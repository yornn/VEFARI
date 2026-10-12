import assert from 'node:assert/strict';
import test from 'node:test';
import { readGenerator } from '../generator.js';
import { freezeDeep } from './fixtures.js';

const base = () => ({
    extensionSettings: {
        inline_image_gen: {
            apiType: 'gemini', endpoint: 'https://img.example/proxy', geminiSendRefs: true, charRefAlways: false, userRefAlways: true,
            refScope: 'global', charRef: { name: 'Маша, Masha' }, userRef: { name: '' },
        },
    },
    characters: [{ name: 'Alice', avatar: 'alice.png' }], characterId: 0, name1: 'Player', chatId: 'chat-1', chatMetadata: {},
});

test('absent generator yields null', () => {
    assert.equal(readGenerator({ extensionSettings: {} }), null);
});

test('reads gating fields with slot names and fallbacks', () => {
    assert.deepEqual(readGenerator(base()), {
        apiType: 'gemini', endpoint: 'https://img.example/proxy', sendRefs: true,
        always: { bot: false, user: true }, names: { bot: 'Маша, Masha', user: 'Player' },
    });
    const context = base();
    context.extensionSettings.inline_image_gen.charRef = { name: '  ' };
    assert.equal(readGenerator(context).names.bot, 'Alice');
});

test('endpoint is normalized like the generator does', () => {
    for (const endpoint of ['https://img.example/proxy/', ' https://img.example/proxy//', 'https://img.example/proxy/v1beta/models/gemini-3-pro-image:generateContent']) {
        const context = base();
        context.extensionSettings.inline_image_gen.endpoint = endpoint;
        assert.equal(readGenerator(context).endpoint, 'https://img.example/proxy');
    }
});

test('per-chat slots win only when per-chat mode has a container', () => {
    const context = base();
    context.extensionSettings.inline_image_gen.refScope = 'per-chat';
    assert.equal(readGenerator(context).names.bot, 'Маша, Masha');
    context.chatMetadata.iig_refs = { charRef: { name: 'Чат-Маша' }, userRef: { name: 'Чат-Петя' } };
    assert.deepEqual(readGenerator(context).names, { bot: 'Чат-Маша', user: 'Чат-Петя' });
    context.chatId = '';
    assert.equal(readGenerator(context).names.bot, 'Маша, Masha');
});

test('sendRefs follows geminiSendRefs and malformed settings throw', () => {
    const context = base();
    context.extensionSettings.inline_image_gen.geminiSendRefs = false;
    assert.equal(readGenerator(context).sendRefs, false);
    context.extensionSettings.inline_image_gen = { endpoint: 'x' };
    assert.throws(() => readGenerator(context), /не распознаны/);
});

test('generator settings are never written', () => {
    const context = freezeDeep(base());
    assert.doesNotThrow(() => readGenerator(context));
});
