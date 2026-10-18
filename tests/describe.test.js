import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_TOKENS, chatProfiles, customRequest, describeMessages, listCustomModels, parseDescription, requestDescription } from '../describe.js';
import { OUTFIT_PROMPTS } from '../outfit-prompts.js';

const image = { mimeType: 'image/png', base64: 'iVBORw0KGgo=' };
const profiles = [
    { id: 'vision', name: 'Vision', api: 'openrouter', model: 'google/gemini-2.5-flash', 'secret-id': 'sid-1' },
    { id: 'kobold', name: 'Kobold', api: 'koboldcpp', model: 'local' },
];
const CONNECT_API_MAP = { openrouter: { selected: 'openai', source: 'openrouter' }, koboldcpp: { selected: 'textgenerationwebui', type: 'koboldcpp' } };

function hostContext({ reply = { content: 'oxblood leather ankle boots.' }, fail = null } = {}) {
    const calls = { profile: [], custom: [] };
    const answer = async () => {
        if (fail) throw fail;
        return reply;
    };
    return {
        calls,
        CONNECT_API_MAP,
        getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 't' }),
        ConnectionManagerRequestService: {
            getSupportedProfiles: () => profiles,
            sendRequest: (...args) => { calls.profile.push(args); return answer(); },
        },
        ChatCompletionService: {
            processRequest: (...args) => { calls.custom.push(args); return answer(); },
        },
    };
}

test('only Chat Completion profiles are offered, by name and model, without their secrets', () => {
    const { available, profiles: listed } = chatProfiles(hostContext());
    assert.equal(available, true);
    assert.deepEqual(listed, [{ id: 'vision', name: 'Vision', model: 'google/gemini-2.5-flash' }]);
    assert.ok(!JSON.stringify(listed).includes('sid-1'));
    assert.deepEqual(chatProfiles({}), { available: false, profiles: [] });
    const disabled = { ConnectionManagerRequestService: { getSupportedProfiles() { throw new Error('Connection Manager is not available'); } } };
    assert.deepEqual(chatProfiles(disabled), { available: false, profiles: [] });
});

test('the picture goes first, then the category prompt, in one user turn', () => {
    const [message, ...rest] = describeMessages('shoes', image);
    assert.equal(rest.length, 0);
    assert.equal(message.role, 'user');
    assert.deepEqual(message.content[0], { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } });
    assert.deepEqual(message.content[1], { type: 'text', text: OUTFIT_PROMPTS.shoes });
    assert.throws(() => describeMessages('cloak', image), /категория/);
    assert.throws(() => describeMessages('full', { mimeType: 'image/png' }), /Нет картинки/);
});

test('replies are cleaned to one line; NO_OUTFIT means nothing was found', () => {
    assert.equal(parseDescription('"black wool cloak with a bronze brooch."'), 'black wool cloak with a bronze brooch');
    assert.equal(parseDescription('Here is the description:\n\nblack wool cloak, and leather boots\n'), 'black wool cloak, and leather boots');
    assert.equal(parseDescription('<think>a cloak? yes</think>\n```\ngrey linen smock\n```'), 'grey linen smock');
    assert.equal(parseDescription('Description: ivory silk undergown'), 'ivory silk undergown');
    assert.equal(parseDescription('NO_OUTFIT'), null);
    assert.equal(parseDescription('no_outfit.'), null);
    assert.equal(parseDescription('  '), '');
    assert.equal(parseDescription(undefined), '');
});

test('the custom route reads no stored SillyTavern key and sends only the given one', () => {
    const describer = { source: 'custom', profileId: '', customUrl: 'https://api.example.com/v1', customModel: 'vision' };
    const messages = describeMessages('full', image);
    const withKey = customRequest(describer, 'sk-test-123', messages);
    assert.equal(withKey.chat_completion_source, 'custom');
    assert.equal(withKey.custom_url, 'https://api.example.com/v1');
    assert.equal(withKey.model, 'vision');
    assert.equal(withKey.max_tokens, MAX_TOKENS);
    assert.equal(withKey.stream, false);
    assert.ok(withKey.secret_id, 'a never-existing secret id keeps the active custom key on the server');
    assert.deepEqual(JSON.parse(withKey.custom_include_headers), { Authorization: 'Bearer sk-test-123' });
    const keyless = customRequest(describer, '', messages);
    assert.equal(keyless.custom_include_headers, '');
    assert.equal(keyless.secret_id, withKey.secret_id);
});

test('a profile request goes through Connection Manager with the profile preset', async () => {
    const context = hostContext();
    const describer = { source: 'profile', profileId: 'vision', customUrl: '', customModel: '' };
    const signal = new AbortController().signal;
    assert.equal(await requestDescription(context, describer, { category: 'shoes', image, key: 'sk-ignored', signal }), 'oxblood leather ankle boots');
    const [[profileId, messages, maxTokens, options]] = context.calls.profile;
    assert.equal(profileId, 'vision');
    assert.equal(messages[0].content[1].text, OUTFIT_PROMPTS.shoes);
    assert.equal(maxTokens, MAX_TOKENS);
    assert.equal(options.signal, signal);
    assert.equal(options.includePreset, true);
    assert.equal(options.stream, false);
    assert.equal(context.calls.custom.length, 0);
    assert.ok(!JSON.stringify(context.calls.profile).includes('sk-ignored'), 'profile requests never carry the custom key');
});

test('a custom request carries the key only in its own header', async () => {
    const context = hostContext({ reply: { content: 'NO_OUTFIT' } });
    const describer = { source: 'custom', profileId: '', customUrl: 'https://api.example.com/v1', customModel: 'vision' };
    assert.equal(await requestDescription(context, describer, { category: 'hair', image, key: 'sk-test-123' }), null);
    const [[payload, options, extract]] = context.calls.custom;
    assert.deepEqual(options, {});
    assert.equal(extract, true);
    assert.equal(payload.custom_url, 'https://api.example.com/v1');
    assert.match(payload.custom_include_headers, /sk-test-123/);
});

test('missing settings, wrong profiles and failures explain themselves', async () => {
    const run = (describer, context = hostContext()) => requestDescription(context, { source: 'profile', profileId: '', customUrl: '', customModel: '', ...describer }, { category: 'full', image });
    await assert.rejects(run({}), /Выберите подключение/);
    await assert.rejects(run({ profileId: 'kobold' }), /не Chat Completion/);
    await assert.rejects(run({ profileId: 'gone' }), /не найден/);
    await assert.rejects(run({ profileId: 'vision' }, {}), /выключен/);
    await assert.rejects(run({ source: 'custom' }), /адрес API/);
    await assert.rejects(run({ source: 'custom', customUrl: 'https://api.example.com/v1' }), /модель/);
    const wrapped = new Error('API request failed', { cause: new Error('model does not support images') });
    await assert.rejects(run({ profileId: 'vision' }, hostContext({ fail: wrapped })), /Модель не ответила: model does not support images/);
    await assert.rejects(run({ profileId: 'vision' }, hostContext({ reply: { content: '' } })), /пустой ответ/);
    const abort = new AbortController();
    abort.abort();
    const cancelled = requestDescription(hostContext({ fail: new Error('aborted') }), { source: 'profile', profileId: 'vision' }, { category: 'full', image, signal: abort.signal });
    await assert.rejects(cancelled, error => error.name === 'AbortError');
});

test('the model list comes from the SillyTavern status route with the same header rule', async () => {
    const requests = [];
    const fetchImpl = async (url, init) => {
        requests.push({ url, init });
        return { ok: true, json: async () => ({ data: [{ id: 'b-vision' }, { id: 'a-vision' }, { id: 'a-vision' }, 'c-text', { name: 'no-id' }] }) };
    };
    const describer = { source: 'custom', customUrl: 'https://api.example.com/v1', customModel: '' };
    assert.deepEqual(await listCustomModels(hostContext(), describer, 'sk-test-123', { fetchImpl }), ['a-vision', 'b-vision', 'c-text']);
    assert.equal(requests[0].url, '/api/backends/chat-completions/status');
    const body = JSON.parse(requests[0].init.body);
    assert.equal(body.chat_completion_source, 'custom');
    assert.ok(body.secret_id);
    assert.deepEqual(JSON.parse(body.custom_include_headers), { Authorization: 'Bearer sk-test-123' });
    await assert.rejects(listCustomModels(hostContext(), { customUrl: '' }, '', { fetchImpl }), /адрес API/);
    await assert.rejects(listCustomModels(hostContext(), describer, '', { fetchImpl: async () => ({ ok: false, status: 401 }) }), /HTTP 401/);
    await assert.rejects(listCustomModels(hostContext(), describer, '', { fetchImpl: async () => ({ ok: true, json: async () => ({ error: true }) }) }), /список моделей/);
    await assert.rejects(listCustomModels(hostContext(), describer, '', { fetchImpl: async () => { throw new Error('offline'); } }), /offline/);
});
