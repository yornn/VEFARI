// Read-only view of notsosillynotsoimages settings the bridge needs to follow its reference rules.
// SPDX-License-Identifier: AGPL-3.0-or-later

const SETTINGS_KEY = 'inline_image_gen';
const records = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Same normalization the generator applies before building its Gemini URL.
function normalizeEndpoint(endpoint) {
    return String(endpoint || '').trim().replace(/\/+$/, '').replace(/\/v1beta\/models(\/[^?]*)?$/i, '');
}

// Slots live in chat metadata only in per-chat mode, and only once that chat has its own copy.
function activeSlots(settings, context) {
    if (settings.refScope === 'per-chat') {
        const chatId = context.chatId ?? context.getCurrentChatId?.();
        const chatSlots = context.chatMetadata?.iig_refs;
        if (chatId !== undefined && chatId !== null && chatId !== '' && records(chatSlots)) return chatSlots;
    }
    return settings;
}

const slotName = slot => (typeof slot?.name === 'string' ? slot.name.trim() : '');

export function readGenerator(context) {
    const settings = context.extensionSettings?.[SETTINGS_KEY];
    if (settings === undefined || settings === null) return null;
    if (!records(settings) || typeof settings.apiType !== 'string') {
        throw new Error('Настройки notsosillynotsoimages не распознаны: мост картинок отключён.');
    }
    const slots = activeSlots(settings, context);
    return {
        apiType: settings.apiType,
        endpoint: normalizeEndpoint(settings.endpoint),
        sendRefs: settings.geminiSendRefs !== false,
        always: { bot: Boolean(settings.charRefAlways), user: Boolean(settings.userRefAlways) },
        names: {
            bot: slotName(slots.charRef) || context.characters?.[context.characterId]?.name || context.name2 || '',
            user: slotName(slots.userRef) || context.name1 || '',
        },
    };
}
