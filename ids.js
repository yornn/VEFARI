// SPDX-License-Identifier: AGPL-3.0-or-later
export function createId(random = globalThis.crypto) {
    // getRandomValues is available on HTTP LAN origins as well as HTTPS.
    const words = random.getRandomValues(new Uint32Array(4));
    return Array.from(words, word => word.toString(16).padStart(8, '0')).join('-');
}