import assert from 'node:assert/strict';
import test from 'node:test';
import { installInterceptor } from '../interceptor.js';

function fakeScope() {
    const calls = [];
    class FakeXhr {
        open(method, url) { this.method = method; this.url = url; }
        send(body) { this.sent = body; }
    }
    const fetch = (...args) => { calls.push(args); return Promise.resolve('ok'); };
    return { calls, fetch, FakeXhr, send: FakeXhr.prototype.send, open: FakeXhr.prototype.open, scope: { fetch, XMLHttpRequest: FakeXhr } };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('foreign requests pass through untouched', async () => {
    const { scope, calls } = fakeScope();
    const seen = [];
    installInterceptor(scope, async request => { seen.push(request); return null; });
    const init = { method: 'POST', body: '{"a":1}', headers: { x: '1' } };
    assert.equal(await scope.fetch('/api/chat', init), 'ok');
    assert.equal(calls[0][0], '/api/chat');
    assert.equal(calls[0][1], init);
    assert.deepEqual(seen, [{ method: 'POST', url: '/api/chat', body: '{"a":1}' }]);
    const requestLike = { url: '/x' };
    await scope.fetch(requestLike, init);
    await scope.fetch('/y');
    assert.equal(seen.length, 1);
    assert.equal(calls[1][0], requestLike);
    assert.equal(calls[2][1], undefined);
});

test('matching request is sent with the new body', async () => {
    const { scope, calls } = fakeScope();
    const seen = [];
    installInterceptor(scope, async request => { seen.push(request); return 'NEW'; });
    const input = new URL('https://img.example/x');
    const init = { method: 'POST', body: 'OLD', headers: { a: 'b' }, signal: 'signal' };
    await scope.fetch(input, init);
    assert.equal(seen[0].url, 'https://img.example/x');
    assert.equal(calls[0][0], input);
    assert.deepEqual(calls[0][1], { method: 'POST', body: 'NEW', headers: { a: 'b' }, signal: 'signal' });
    assert.equal(init.body, 'OLD');
});

test('transform failure sends the original request', async () => {
    const { scope, calls } = fakeScope();
    const errors = [];
    installInterceptor(scope, async () => { throw new Error('boom'); }, error => errors.push(error));
    const init = { method: 'POST', body: 'OLD' };
    await scope.fetch('/generate', init);
    assert.equal(calls[0][1], init);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].message, 'boom');
});

test('xhr send waits for transform', async () => {
    const { scope } = fakeScope();
    installInterceptor(scope, async ({ method, url, body }) => (method === 'POST' && url === 'https://img.example/x' && body === 'OLD' ? 'NEW' : null));
    const xhr = new scope.XMLHttpRequest();
    xhr.open('POST', 'https://img.example/x');
    xhr.send('OLD');
    assert.equal(xhr.sent, undefined);
    await settle();
    assert.equal(xhr.sent, 'NEW');
    const get = new scope.XMLHttpRequest();
    get.open('GET', '/a');
    get.send(null);
    assert.equal(get.sent, null);
});

test('xhr transform failure sends the original body', async () => {
    const { scope } = fakeScope();
    const errors = [];
    installInterceptor(scope, async () => { throw new Error('boom'); }, error => errors.push(error));
    const xhr = new scope.XMLHttpRequest();
    xhr.open('POST', '/generate');
    xhr.send('OLD');
    await settle();
    assert.equal(xhr.sent, 'OLD');
    assert.equal(errors.length, 1);
});

test('uninstall restores originals and disables wrappers', async () => {
    const first = fakeScope();
    let transforms = 0;
    installInterceptor(first.scope, async () => { transforms++; return 'NEW'; })();
    assert.equal(first.scope.fetch, first.fetch);
    assert.equal(first.FakeXhr.prototype.send, first.send);
    assert.equal(first.FakeXhr.prototype.open, first.open);

    const second = fakeScope();
    const uninstall = installInterceptor(second.scope, async () => { transforms++; return 'NEW'; });
    const ours = second.scope.fetch;
    const theirs = (...args) => ours(...args);
    second.scope.fetch = theirs;
    uninstall();
    assert.equal(second.scope.fetch, theirs);
    await second.scope.fetch('/generate', { method: 'POST', body: 'OLD' });
    assert.equal(second.calls[0][1].body, 'OLD');
    assert.equal(transforms, 0);
});
