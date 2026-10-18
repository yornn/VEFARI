// The feather: an outfit description from a picture, through a SillyTavern connection profile
// or the user's own OpenAI-compatible endpoint. Both routes go through the SillyTavern server,
// so there is no CORS trouble and no request leaves the browser for a third-party host directly.
// SPDX-License-Identifier: AGPL-3.0-or-later
import { OUTFIT_PROMPTS } from './outfit-prompts.js';

export const NO_OUTFIT = 'NO_OUTFIT';
// A description is about a hundred tokens; the rest is room for reasoning models to think first.
export const MAX_TOKENS = 2048;
const CHAT_API = 'openai';
const STATUS_URL = '/api/backends/chat-completions/status';
// A secret ID that never exists. Without one SillyTavern would read its *active* custom key
// and send it to our endpoint; with it the server reads nothing and only our header is sent.
const NO_SECRET = 'vefari-no-stored-secret';

/** Chat Completion profiles from SillyTavern's Connection Manager (the plug icon). Never their secrets. */
export function chatProfiles(context) {
    const service = context.ConnectionManagerRequestService;
    if (!service) return { available: false, profiles: [] };
    let supported;
    try { supported = service.getSupportedProfiles(); }
    catch { return { available: false, profiles: [] }; }
    const profiles = (Array.isArray(supported) ? supported : [])
        .filter(profile => context.CONNECT_API_MAP?.[profile?.api]?.selected === CHAT_API)
        .map(profile => ({ id: String(profile.id), name: String(profile.name || profile.id), model: String(profile.model || '') }));
    return { available: true, profiles };
}

/** One user turn, picture first: the most portable shape across vision APIs and SillyTavern's converters. */
export function describeMessages(category, image) {
    const prompt = OUTFIT_PROMPTS[category];
    if (!prompt) throw new Error('Неизвестная категория вещи.');
    if (!image?.base64 || !image?.mimeType) throw new Error('Нет картинки для описания.');
    return [{
        role: 'user',
        content: [
            { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64}` } },
            { type: 'text', text: prompt },
        ],
    }];
}

/** One clean line of description, or null when the model found nothing of the category. */
export function parseDescription(text) {
    const lines = String(text ?? '')
        .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '\n')
        .replace(/```[\w-]*/g, '\n')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    // A preamble such as "Here is the description:" is not the description.
    const line = lines.find(entry => !entry.endsWith(':')) ?? '';
    const clean = line
        .replace(/^(?:description|outfit)\s*:\s*/i, '')
        .replace(/^["'«“”*`]+|["'»“”*`]+$/g, '')
        .replace(/\s+/g, ' ')
        .replace(/[\s.]+$/, '')
        .trim();
    if (/^NO_OUTFIT\b/i.test(clean)) return null;
    return clean;
}

function keyHeaders(key) {
    return key ? JSON.stringify({ Authorization: `Bearer ${key}` }) : '';
}

/** SillyTavern's custom source; the key rides in a header that overrides the server's own one. */
export function customRequest(describer, key, messages) {
    return {
        stream: false,
        messages,
        model: describer.customModel,
        chat_completion_source: 'custom',
        custom_url: describer.customUrl,
        max_tokens: MAX_TOKENS,
        secret_id: NO_SECRET,
        custom_include_headers: keyHeaders(key),
    };
}

async function send(request, signal) {
    try {
        return await request();
    } catch (error) {
        if (signal?.aborted) throw new DOMException('Описание отменено.', 'AbortError');
        // Connection Manager wraps the real reason as `cause`.
        const reason = error?.cause?.message || error?.message || String(error);
        throw new Error(`Модель не ответила: ${reason}`);
    }
}

/**
 * Resolves to the description, or null when the picture shows nothing of the category.
 * `key` is used only for the custom source and only as the caller read it for this endpoint.
 */
export async function requestDescription(context, describer, { category, image, key = '', signal = null }) {
    const messages = describeMessages(category, image);
    let result;
    if (describer.source === 'custom') {
        if (!describer.customUrl) throw new Error('Укажите адрес API в настройках, блок «Описание по картинке».');
        if (!describer.customModel) throw new Error('Укажите модель в настройках, блок «Описание по картинке».');
        if (!context.ChatCompletionService) throw new Error('Эта версия SillyTavern не умеет отправлять запросы расширений.');
        result = await send(() => context.ChatCompletionService.processRequest(customRequest(describer, key, messages), {}, true, signal), signal);
    } else {
        if (!describer.profileId) throw new Error('Выберите подключение в настройках, блок «Описание по картинке».');
        const { available, profiles } = chatProfiles(context);
        if (!available) throw new Error('Менеджер подключений SillyTavern выключен: включите его или укажите свой адрес API.');
        if (!profiles.some(profile => profile.id === describer.profileId)) {
            throw new Error('Профиль подключения не найден или это не Chat Completion. Выберите другой в настройках.');
        }
        result = await send(() => context.ConnectionManagerRequestService.sendRequest(describer.profileId, messages, MAX_TOKENS, {
            stream: false, signal, extractData: true, includePreset: true, includeInstruct: false,
        }), signal);
    }
    if (signal?.aborted) throw new DOMException('Описание отменено.', 'AbortError');
    const description = parseDescription(typeof result === 'string' ? result : result?.content);
    if (description === '') throw new Error('Модель вернула пустой ответ. Проверьте, что она умеет смотреть картинки.');
    return description;
}

/** Model IDs of the custom endpoint; doubles as a connection check. */
export async function listCustomModels(context, describer, key, { signal = null, fetchImpl = globalThis.fetch } = {}) {
    if (!describer.customUrl) throw new Error('Сначала укажите адрес API.');
    let response;
    try {
        response = await fetchImpl(STATUS_URL, {
            method: 'POST',
            headers: context.getRequestHeaders(),
            body: JSON.stringify({
                chat_completion_source: 'custom', custom_url: describer.customUrl, secret_id: NO_SECRET,
                custom_include_headers: keyHeaders(key),
            }),
            signal,
        });
    } catch (error) {
        throw new Error(`Сервер SillyTavern недоступен: ${error.message}`);
    }
    if (!response.ok) throw new Error(`Адрес API не ответил (HTTP ${response.status}). Проверьте адрес и ключ.`);
    const data = await response.json().catch(() => null);
    if (!data || data.error) throw new Error('Адрес API не отдал список моделей. Проверьте адрес и ключ.');
    const entries = Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
    const ids = entries.map(entry => (typeof entry === 'string' ? entry : entry?.id)).filter(id => typeof id === 'string' && id);
    return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}
