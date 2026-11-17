// VEFARI host adapter. Uses the documented SillyTavern context and event APIs.
// SPDX-License-Identifier: AGPL-3.0-or-later
import { DEFAULT_INJECT_DEPTH, VERSION, TARGETS, reduceWardrobe, selectWardrobe, selectCollection } from './wardrobe.js';
import { readSettings, writeSettings } from './storage.js';
import { PROMPT_KEY, composePrompt, resolveParticipants, wardrobeSnapshot } from './prompt.js';
import { loadReference } from './images.js';
import { readGenerator as readGeneratorSettings } from './generator.js';
import {
    augmentGeminiBody, changedTargets, createOutfitMemory, isGeneratorTarget, outfitSignatures, parseGeneratorRequest, planOutfits, sceneText,
} from './bridge.js';
import { installInterceptor } from './interceptor.js';

const IN_CHAT = 1;
const SYSTEM_ROLE = 0;
export const OUTFITS_MACRO = 'outfits';
const MACRO_DESCRIPTION = 'VEFARI: what Char and User wear now, one line each (clothes Name: …; hairstyle: …). Empty when nothing is worn.';

/**
 * Registers a {{name}} macro and returns its removal. SillyTavern has two macro engines:
 * the newer registry unless the user switched it off, the older parser otherwise.
 */
export function registerMacro(context, name, handler, description = '') {
    const registry = context.macros?.registry;
    if (typeof registry?.registerMacro === 'function' && context.powerUserSettings?.experimental_macro_engine !== false) {
        registry.registerMacro(name, { handler: () => handler(), description, category: context.macros.category?.MISC ?? 'misc' });
        return () => registry.unregisterMacro?.(name);
    }
    if (typeof context.registerMacro === 'function') {
        context.registerMacro(name, () => handler(), description);
        return () => context.unregisterMacro?.(name);
    }
    return () => {};
}

export function createController(getContext, {
    readImage = loadReference, reportError = console.error, scope = globalThis, readGenerator = readGeneratorSettings,
} = {}) {
    const listeners = new Set();
    const bindings = [];
    let connected = false;
    let uninstall = null;
    let report = null;
    let generatorWarned = false;
    let memory = createOutfitMemory();

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
            report,
        };
    }

    /** Puts the outfit lines into the chat and returns the snapshot they came from (null when unreadable). */
    function inject() {
        const context = getContext();
        let snapshot = null;
        let depth = DEFAULT_INJECT_DEPTH;
        try {
            const state = readSettings(context);
            snapshot = wardrobeSnapshot(state, resolveParticipants(context));
            depth = state.injectDepth;
        } catch (error) {
            // Bad settings must not leave another character's old instruction active.
            reportError(error);
        }
        context.setExtensionPrompt(PROMPT_KEY, composePrompt(snapshot), IN_CHAT, depth, false, SYSTEM_ROLE);
        return snapshot;
    }

    // A reply is generated with the outfit lines in the chat: image prompts written from it already know them.
    // Dry runs and other extensions' quiet requests write no reply.
    function generationStarted(type, _params, dryRun) {
        const snapshot = inject();
        if (!dryRun && type !== 'quiet') memory.sawWriter(outfitSignatures(snapshot));
    }

    function chatChanged() {
        memory.sawWriter(null);
        refresh();
    }

    // {{outfits}}: the same lines on demand, for the generator's prompt model (its OOC field or instruction).
    function outfitsMacro() {
        try {
            const { snapshot } = view();
            memory.sawWriter(outfitSignatures(snapshot));
            return composePrompt(snapshot);
        } catch (error) {
            reportError(error);
            return '';
        }
    }

    function notify() {
        for (const listener of listeners) {
            try { listener(); }
            catch (error) { reportError(error); }
        }
    }

    function refresh() {
        inject();
        notify();
    }

    function currentGenerator() {
        try {
            return readGenerator(getContext());
        } catch (error) {
            if (!generatorWarned) reportError(error);
            generatorWarned = true;
            return null;
        }
    }

    // Runs for every outgoing request, so it stays synchronous and cheap.
    const acceptsRequest = request => isGeneratorTarget(request, currentGenerator());

    /** Called by the interceptor at the moment the generator sends an image request. */
    async function transformRequest(request) {
        const generator = currentGenerator();
        const parsed = parseGeneratorRequest(request, generator);
        if (!parsed) return null;
        const { state, snapshot } = view();
        if (!snapshot) return null;
        const current = outfitSignatures(snapshot);
        const targets = changedTargets(current, memory.baseline(sceneText(parsed.promptText), current));
        const plan = planOutfits({ snapshot, promptText: parsed.promptText, generator, settings: state, targets });
        if (!plan.sides.length) {
            // The prompt already describes what they wear, or those who changed are not in the picture.
            if (snapshot.enabled) {
                report = { sides: [], changed: targets.length > 0 };
                notify();
            }
            return null;
        }
        // The same garment may be worn by both participants; load its file once.
        const wanted = [...new Map(plan.sides.flatMap(side => side.imageItems).map(item => [item.id, item])).values()];
        const loaded = await Promise.allSettled(wanted.map(item => readImage(item.imagePath)));
        const images = new Map();
        loaded.forEach((result, index) => {
            if (result.status === 'fulfilled') images.set(wanted[index].id, result.value);
            else console.warn(`[VEFARI] Картинка «${wanted[index].name}» недоступна, отправлено только описание.`, result.reason);
        });
        report = {
            sides: plan.sides.map(side => {
                const sent = side.imageItems.filter(item => images.has(item.id));
                return {
                    name: side.name,
                    images: sent.map(item => item.category),
                    text: side.items.filter(item => !sent.includes(item)).map(item => item.category),
                };
            }),
        };
        notify();
        return JSON.stringify(augmentGeminiBody(parsed.body, plan, images));
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
            CHAT_CHANGED: chatChanged,
            GENERATION_STARTED: generationStarted,
            GENERATION_AFTER_COMMANDS: generationStarted,
        };
        for (const [name, callback] of Object.entries(routes)) {
            const event = types?.[name];
            if (event === undefined) continue;
            eventSource.on(event, callback);
            bindings.push(() => eventSource.removeListener(event, callback));
        }
        try {
            bindings.push(registerMacro(getContext(), OUTFITS_MACRO, outfitsMacro, MACRO_DESCRIPTION));
        } catch (error) {
            // Without the macro the chat line and the change notes still work.
            reportError(error);
        }
        uninstall = installInterceptor(scope, { accepts: acceptsRequest, transform: transformRequest }, reportError);
        connected = true;
        refresh();
    }

    function dispose() {
        for (const unbind of bindings.splice(0)) unbind();
        uninstall?.();
        uninstall = null;
        connected = false;
        listeners.clear();
        memory = createOutfitMemory();
        getContext().setExtensionPrompt(PROMPT_KEY, '', IN_CHAT, DEFAULT_INJECT_DEPTH, false, SYSTEM_ROLE);
    }

    const api = Object.freeze({
        version: VERSION,
        getActiveOutfits: () => view().snapshot,
        async getImageReferences(target = 'bot') {
            if (!TARGETS.includes(target)) throw new Error('Неизвестный владелец наряда.');
            const { state, snapshot } = view();
            // A participant in text mode sends descriptions only.
            if (state.sendModes[target] !== 'image') return [];
            const images = snapshot?.[target].items.filter(item => item.imagePath) || [];
            return Promise.all(images.map(async item => ({ ...item, ...await readImage(item.imagePath) })));
        },
    });

    return Object.freeze({
        view, dispatch, inject, refresh, connect, dispose, api, transformRequest,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    });
}