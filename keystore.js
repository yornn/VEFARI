// The key for the feather's own endpoint. It lives only in this browser's storage, never in
// SillyTavern settings or exports, and is handed out only for the origin it was entered for.
// SPDX-License-Identifier: AGPL-3.0-or-later

const STORAGE_KEY = 'vefari_describer_key';
// Printable ASCII without spaces: the key becomes an HTTP header and must not smuggle extra lines.
const KEY_PATTERN = /^[\x21-\x7E]{1,1000}$/;

export function endpointOrigin(url) {
    try { return url ? new URL(url).origin : ''; }
    catch { return ''; }
}

/** `storage` is resolved lazily: private modes may forbid it, and that must not break the wardrobe. */
export function createKeyStore(storage = () => globalThis.localStorage) {
    function load() {
        try {
            const saved = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? 'null');
            return typeof saved?.origin === 'string' && typeof saved?.key === 'string' ? saved : null;
        } catch {
            return null;
        }
    }

    return Object.freeze({
        /** The key saved for this endpoint's origin, or '' — a key never travels to another host. */
        read(url) {
            const saved = load();
            const origin = endpointOrigin(url);
            return saved && origin && saved.origin === origin ? saved.key : '';
        },
        /** 'none', 'saved' for this endpoint, or 'other' when the saved key belongs to another origin. */
        state(url) {
            const saved = load();
            if (!saved) return { status: 'none', origin: '' };
            return { status: saved.origin === endpointOrigin(url) ? 'saved' : 'other', origin: saved.origin };
        },
        write(url, key) {
            const origin = endpointOrigin(url);
            if (!origin) throw new Error('Сначала укажите адрес API: ключ привязывается к нему.');
            const value = typeof key === 'string' ? key.trim() : '';
            if (!KEY_PATTERN.test(value)) throw new Error('Ключ — одна строка без пробелов и переводов строк.');
            try { storage().setItem(STORAGE_KEY, JSON.stringify({ origin, key: value })); }
            catch { throw new Error('Браузер не разрешает сохранить ключ (приватный режим или запрет хранилища).'); }
        },
        clear() {
            try { storage()?.removeItem(STORAGE_KEY); }
            catch { /* Nothing was stored where storage is forbidden. */ }
        },
    });
}
