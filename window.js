// SillyTavern owns the modal stack, Escape handling and focus trap.
// SPDX-License-Identifier: AGPL-3.0-or-later
import { createIcon } from './icons.js';

export function mountWardrobeWindow({ root, styleText, getContext, beforeOpen, canClose, afterClose, onError }) {
    let popup = null;
    let trigger = null;
    const host = document.createElement('div');
    host.id = 'vefari_host';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = styleText;
    shadow.append(style, root);

    async function open() {
        if (popup) return;
        const { Popup, POPUP_TYPE } = getContext();
        if (!Popup || !POPUP_TYPE) throw new Error('В этой версии SillyTavern недоступен API окон Popup.');
        beforeOpen();
        const instance = new Popup(host, POPUP_TYPE.TEXT, '', {
            okButton: false, cancelButton: false, wide: true, leftAlign: true,
            allowVerticalScrolling: false,
            onOpen: () => root.querySelector('[role="tab"][aria-selected="true"]')?.focus(),
            onClosing: canClose,
            // Detach natively before ST removes the dialog, preserving input listeners.
            onClose: () => { host.remove(); afterClose(); },
        });
        instance.dlg.id = 'vefari_dialog';
        instance.dlg.classList.add('vefari_popup');
        // ID references cannot cross the shadow boundary.
        instance.dlg.setAttribute('aria-label', 'Гардероб VEFARI');
        popup = instance;
        try { await instance.show(); }
        finally {
            host.remove();
            popup = null;
            const returnTo = trigger?.getClientRects().length ? trigger : document.getElementById('extensionsMenuButton');
            returnTo?.focus();
        }
    }

    function mount() {
        const menu = document.getElementById('extensionsMenu');
        if (!menu || document.getElementById('vefari_menu')) return;
        const entry = document.createElement('div');
        entry.className = 'extension_container';
        trigger = document.createElement('button');
        trigger.id = 'vefari_menu';
        trigger.type = 'button';
        trigger.className = 'list-group-item flex-container flexGap5 interactable';
        trigger.setAttribute('aria-haspopup', 'dialog');
        const label = document.createElement('span');
        label.textContent = 'VEFARI';
        trigger.append(createIcon('tunic'), label);
        trigger.addEventListener('click', () => { void open().catch(onError); });
        entry.append(trigger);
        menu.append(entry);
    }

    mount();
    const { eventSource, eventTypes, event_types } = getContext();
    const ready = (eventTypes || event_types)?.APP_READY;
    if (ready) eventSource.on(ready, mount);
    return {
        open,
        async close() {
            if (popup) await popup.complete(getContext().POPUP_RESULT?.CANCELLED ?? null);
        },
    };
}