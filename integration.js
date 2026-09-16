// VEFARI host adapter. Uses the documented SillyTavern context and event APIs.
// SPDX-License-Identifier: AGPL-3.0-or-later
import { VERSION, TARGETS, reduceWardrobe, selectWardrobe, selectCollection } from './wardrobe.js';
import { readSettings, writeSettings } from './storage.js';
import { PROMPT_KEY, composePrompt, resolveParticipants, wardrobeSnapshot } from './prompt.js';
import { loadReference } from './images.js';

const IN_CHAT = 1;
const SYSTEM_ROLE = 0;

export function createController(getContext, { readImage = loadReference, reportError = console.error } = {}) {
    const listeners = new Set();
    const bindings = [];
    let connected = false;

    function view(target = 'bot') {
        const context = getContext();
        const state = readSettings(context);
        const participants = resolveParticipants(context);
        const snapshot = wardrobeSnapshot(state, participants);
        return {
            state, participants, snapshot,
            selection: selectWardrobe(state, participants?.characterKey, target),
            collection: selectCollection(state, target),
            prompt: composePrompt(snapshot),
        };
    }

    function inject() {
        const context = getContext();
        let text = '';
        try {
            text = composePrompt(wardrobeSnapshot(readSettings(context), resolveParticipants(context)));
        } catch (error) {
            // Bad settings must not leave another character's old instruction active.
            reportError(error);
        }
        context.setExtensionPrompt(PROMPT_KEY, text, IN_CHAT, 0, false, SYSTEM_ROLE);
        return text;
    }

    function refresh() {
        inject();
        for (const listener of listeners) {
            try { listener(); }
            catch (error) { reportError(error); }
        }
    }

    function dispatch(command) {
        const context = getContext();
        const state = reduceWardrobe(readSettings(context), command);
        writeSettings(context, state);
        refresh();
    }

    function connect() {
        if (connected) return;
        const { eventSource, eventTypes, event_types } = getContext();
        const types = eventTypes || event_types;
        const routes = {
            APP_READY: refresh,
            CHAT_CHANGED: refresh,
            GENERATION_STARTED: inject,
            GENERATION_AFTER_COMMANDS: inject,
        };
        for (const [name, callback] of Object.entries(routes)) {
            const event = types?.[name];
            if (event === undefined) continue;
            eventSource.on(event, callback);
            bindings.push(() => eventSource.removeListener(event, callback));
        }
        connected = true;
        refresh();
    }

    function dispose() {
        for (const unbind of bindings.splice(0)) unbind();
        connected = false;
        listeners.clear();
        getContext().setExtensionPrompt(PROMPT_KEY, '', IN_CHAT, 0, false, SYSTEM_ROLE);
    }

    const api = Object.freeze({
        version: VERSION,
        getActiveOutfits: () => view().snapshot,
        async getImageReferences(target = 'bot') {
            if (!TARGETS.includes(target)) throw new Error('Неизвестный владелец наряда.');
            const snapshot = view().snapshot;
            const images = snapshot?.[target].items.filter(item => item.imagePath) || [];
            return Promise.all(images.map(async item => ({ ...item, ...await readImage(item.imagePath) })));
        },
    });

    return Object.freeze({
        view, dispatch, inject, refresh, connect, dispose, api,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    });
}