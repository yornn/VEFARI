// Lets VEFARI rewrite another extension's outgoing request body at the moment it is sent.
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * transform({ method, url, body }) resolves to a replacement body or null.
 * Only string bodies are offered; everything else goes out untouched and without delay.
 * A failing transform sends the original request: a wardrobe error never blocks generation.
 */
export function installInterceptor(scope, transform, onError = console.error) {
    let active = true;
    const originalFetch = scope.fetch;
    const proto = scope.XMLHttpRequest?.prototype;
    const originalOpen = proto?.open;
    const originalSend = proto?.send;
    const requests = new WeakMap();

    async function rewrite(request) {
        try { return await transform(request); }
        catch (error) {
            onError(error);
            return null;
        }
    }

    function wrappedFetch(input, init) {
        const candidate = active && (typeof input === 'string' || input instanceof URL) && typeof init?.body === 'string';
        if (!candidate) return originalFetch.call(scope, input, init);
        return rewrite({ method: String(init.method || 'GET').toUpperCase(), url: String(input), body: init.body })
            .then(body => originalFetch.call(scope, input, body === null ? init : { ...init, body }));
    }

    // iOS builds of the generator use XMLHttpRequest instead of fetch.
    function wrappedOpen(method, url, ...rest) {
        requests.set(this, { method: String(method).toUpperCase(), url: String(url) });
        return originalOpen.call(this, method, url, ...rest);
    }

    function wrappedSend(body) {
        const request = requests.get(this);
        if (!active || !request || typeof body !== 'string') return originalSend.call(this, body);
        void rewrite({ ...request, body }).then(next => {
            try { originalSend.call(this, next ?? body); }
            catch (error) { onError(error); }
        });
    }

    if (typeof originalFetch === 'function') scope.fetch = wrappedFetch;
    if (proto && typeof originalOpen === 'function' && typeof originalSend === 'function') {
        proto.open = wrappedOpen;
        proto.send = wrappedSend;
    }

    // Another extension may have wrapped ours since; then only switch ours to pass-through.
    return function uninstall() {
        active = false;
        if (scope.fetch === wrappedFetch) scope.fetch = originalFetch;
        if (proto?.open === wrappedOpen) proto.open = originalOpen;
        if (proto?.send === wrappedSend) proto.send = originalSend;
    };
}
