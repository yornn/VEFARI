// Lets VEFARI rewrite another extension's outgoing request body at the moment it is sent.
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * accepts({ method, url }) decides synchronously whether a request may be held back;
 * transform({ method, url, body }) then resolves to a replacement body or null.
 * Rejected requests, non-string bodies and synchronous XHR go out untouched and without delay.
 * A failing hook sends the original request: a wardrobe error never blocks generation.
 */
export function installInterceptor(scope, { accepts, transform }, onError = console.error) {
    let active = true;
    const originalFetch = scope.fetch;
    const proto = scope.XMLHttpRequest?.prototype;
    const originalOpen = proto?.open;
    const originalSend = proto?.send;
    const requests = new WeakMap();

    function wanted(request) {
        if (!active) return false;
        try { return accepts(request) === true; }
        catch (error) {
            onError(error);
            return false;
        }
    }

    async function rewrite(request) {
        try { return await transform(request); }
        catch (error) {
            onError(error);
            return null;
        }
    }

    function wrappedFetch(input, init) {
        if (!(typeof input === 'string' || input instanceof URL) || typeof init?.body !== 'string') {
            return originalFetch.call(scope, input, init);
        }
        const request = { method: String(init.method || 'GET').toUpperCase(), url: String(input) };
        if (!wanted(request)) return originalFetch.call(scope, input, init);
        return rewrite({ ...request, body: init.body })
            .then(body => originalFetch.call(scope, input, body === null ? init : { ...init, body }));
    }

    // iOS builds of the generator use XMLHttpRequest instead of fetch.
    // An explicit falsy third argument makes the request synchronous; those must never be deferred.
    function wrappedOpen(method, url) {
        requests.set(this, { method: String(method).toUpperCase(), url: String(url), sync: arguments.length > 2 && !arguments[2] });
        return originalOpen.apply(this, arguments);
    }

    function wrappedSend(body) {
        const request = requests.get(this);
        if (!request || request.sync || typeof body !== 'string' || !wanted(request)) return originalSend.apply(this, arguments);
        void rewrite({ method: request.method, url: request.url, body }).then(next => {
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
