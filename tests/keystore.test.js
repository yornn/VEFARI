import assert from 'node:assert/strict';
import test from 'node:test';
import { createKeyStore, endpointOrigin } from '../keystore.js';

function memoryStorage() {
    const data = new Map();
    return {
        data,
        getItem: key => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => data.set(key, String(value)),
        removeItem: key => data.delete(key),
    };
}

test('a key is handed out only for the origin it was saved for', () => {
    const storage = memoryStorage();
    const keys = createKeyStore(() => storage);
    assert.deepEqual(keys.state('https://api.example.com/v1'), { status: 'none', origin: '' });
    keys.write('https://api.example.com/v1', '  sk-test-123  ');
    assert.equal(keys.read('https://api.example.com/v2'), 'sk-test-123');
    assert.deepEqual(keys.state('https://api.example.com/v1'), { status: 'saved', origin: 'https://api.example.com' });
    for (const other of ['https://evil.example.com/v1', 'http://api.example.com/v1', 'https://api.example.com:8443/v1', '', 'not a url']) {
        assert.equal(keys.read(other), '', other);
    }
    assert.equal(keys.state('https://evil.example.com').status, 'other');
    keys.clear();
    assert.equal(keys.read('https://api.example.com/v1'), '');
    assert.equal(storage.data.size, 0);
});

test('keys that could inject header lines, or need an address first, are refused', () => {
    const keys = createKeyStore(() => memoryStorage());
    assert.throws(() => keys.write('', 'sk-1'), /адрес API/);
    for (const bad of ['sk 1', 'sk-1\r\nX-Evil: 1', '', 'ключ']) {
        assert.throws(() => keys.write('https://api.example.com', bad), /одна строка/, JSON.stringify(bad));
    }
});

test('forbidden or corrupted storage never breaks the wardrobe', () => {
    const forbidden = createKeyStore(() => { throw new Error('SecurityError'); });
    assert.equal(forbidden.read('https://api.example.com'), '');
    assert.equal(forbidden.state('https://api.example.com').status, 'none');
    assert.doesNotThrow(() => forbidden.clear());
    assert.throws(() => forbidden.write('https://api.example.com', 'sk-1'), /не разрешает/);
    const storage = memoryStorage();
    storage.setItem('vefari_describer_key', '{broken');
    assert.equal(createKeyStore(() => storage).read('https://api.example.com'), '');
    assert.equal(endpointOrigin('https://api.example.com/v1/models'), 'https://api.example.com');
    assert.equal(endpointOrigin('nope'), '');
});
