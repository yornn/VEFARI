// VEFARI domain model. No browser, storage or SillyTavern dependencies.
// SPDX-License-Identifier: AGPL-3.0-or-later

export const VERSION = '0.8.0';
export const SCHEMA_VERSION = 3;
export const CATEGORIES = Object.freeze({
    full: 'Полный наряд',
    top: 'Верх',
    bottom: 'Низ',
    shoes: 'Обувь',
    accessories: 'Аксессуары',
    hair: 'Причёска',
});
export const TARGETS = Object.freeze(['bot', 'user']);
export const MAX_IMAGE_REFS = 10;
const MODES = ['full', 'parts'];
const SEPARATES = new Set(['top', 'bottom', 'shoes']);
export const DESCRIBER_SOURCES = Object.freeze(['profile', 'custom']);
// What a participant's worn outfit sends to the image generator: descriptions only, or pictures too.
export const SEND_MODES = Object.freeze(['image', 'text']);
const MAX_DESCRIBER_TEXT = 300;

export function createDescriber() {
    return { source: 'profile', profileId: '', customUrl: '', customModel: '' };
}

export function createSendModes() {
    return { bot: 'image', user: 'image' };
}

export function createState() {
    return {
        schemaVersion: SCHEMA_VERSION, enabled: true, items: [], assignments: [], sendModes: createSendModes(), maxImageRefs: 4,
        describer: createDescriber(),
    };
}

export function validateImageLimit(limit) {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_IMAGE_REFS) {
        throw new Error(`Лимит картинок нарядов — целое число от 1 до ${MAX_IMAGE_REFS}.`);
    }
    return limit;
}

/** The single switch of 0.7 and earlier; read only to migrate it into per-participant modes. */
export function validateGeneratorImages(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Укажите, отправлять ли картинки нарядов.');
    return enabled;
}

function validateSendMode(mode) {
    if (!SEND_MODES.includes(mode)) throw new Error('Режим генератора — «текст» или «текст и картинка».');
    return mode;
}

/** User and Char choose separately; both are always present. */
export function validateSendModes(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Повреждены режимы отправки в генератор.');
    return Object.fromEntries(TARGETS.map(target => [target, validateSendMode(input[target])]));
}

/** OpenAI-compatible base URL. Credentials and query strings are refused: a key belongs only in the key field. */
export function normalizeEndpoint(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) return '';
    let url;
    try { url = new URL(text); }
    catch { throw new Error('Адрес API — полный URL, например https://api.example.com/v1.'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Адрес API начинается с http:// или https://.');
    if (url.username || url.password || url.search || url.hash) {
        throw new Error('Ключ вводится в поле «Ключ», а не в адресе: уберите из URL логин, пароль и всё после «?» или «#».');
    }
    // SillyTavern appends /chat/completions itself; a pasted full endpoint would double it.
    const path = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '').replace(/\/+$/, '');
    return `${url.origin}${path}`;
}

function describerText(value, label) {
    if (typeof value !== 'string') throw new Error(`Некорректное поле «${label}».`);
    const text = value.trim();
    if (text.length > MAX_DESCRIBER_TEXT) throw new Error(`Поле «${label}» длиннее ${MAX_DESCRIBER_TEXT} символов.`);
    return text;
}

/** Only these four fields are ever stored; anything else, a key included, is dropped. */
export function validateDescriber(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Повреждены настройки описания по картинке.');
    if (!DESCRIBER_SOURCES.includes(input.source)) throw new Error('Неизвестный источник описания по картинке.');
    return {
        source: input.source,
        profileId: describerText(input.profileId ?? '', 'Профиль'),
        customUrl: normalizeEndpoint(describerText(input.customUrl ?? '', 'Адрес API')),
        customModel: describerText(input.customModel ?? '', 'Модель'),
    };
}

function requiredText(value, label) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Заполните поле «${label}».`);
    return value.trim();
}

export function validateOwner(characterKey, target) {
    requiredText(characterKey, 'Персонаж');
    if (!TARGETS.includes(target)) throw new Error('Неизвестный владелец наряда.');
}

export function validateMode(mode) {
    if (!MODES.includes(mode)) throw new Error('Неизвестный режим гардероба.');
}

export function validateItem(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Некорректная запись вещи.');
    const id = requiredText(input.id, 'Идентификатор');
    const name = requiredText(input.name, 'Название');
    const description = requiredText(input.description, 'Описание');
    if (!Object.hasOwn(CATEGORIES, input.category)) throw new Error('Неизвестная категория вещи.');
    if (input.imagePath != null && typeof input.imagePath !== 'string') throw new Error('Некорректный путь картинки.');
    if (!Array.isArray(input.audiences) || !input.audiences.length
        || input.audiences.some(target => !TARGETS.includes(target))) throw new Error('Выберите коллекцию User или Char.');
    const audiences = TARGETS.filter(target => input.audiences.includes(target));
    // The per-item send flag of 0.7 and earlier is gone: the owner's send mode decides.
    return { id, name, description, category: input.category, imagePath: input.imagePath || '', audiences };
}

function assignmentFor(state, characterKey, target) {
    return state.assignments.find(entry => entry.characterKey === characterKey && entry.target === target);
}

function replaceAssignment(state, assignment) {
    return {
        ...state,
        assignments: [
            ...state.assignments.filter(entry => entry.characterKey !== assignment.characterKey || entry.target !== assignment.target),
            assignment,
        ],
    };
}

function forgetItem(state, itemId) {
    return state.assignments.map(entry => ({ ...entry, itemIds: entry.itemIds.filter(id => id !== itemId) }));
}

/** Commands validate before returning a new state; previous revisions are never mutated. */
export function reduceWardrobe(state, command) {
    switch (command.type) {
        case 'set-enabled':
            if (typeof command.enabled !== 'boolean') throw new Error('Укажите состояние гардероба.');
            return { ...state, enabled: command.enabled };
        case 'set-send-mode':
            if (!TARGETS.includes(command.target)) throw new Error('Неизвестный владелец наряда.');
            return { ...state, sendModes: { ...state.sendModes, [command.target]: validateSendMode(command.mode) } };
        case 'set-image-limit':
            return { ...state, maxImageRefs: validateImageLimit(command.limit) };
        case 'set-describer':
            if (!command.describer || typeof command.describer !== 'object') throw new Error('Укажите настройки описания по картинке.');
            return { ...state, describer: validateDescriber({ ...state.describer, ...command.describer }) };
        case 'add-item': {
            const item = validateItem(command.item);
            if (state.items.some(entry => entry.id === item.id)) throw new Error('Идентификатор вещи уже существует.');
            return { ...state, items: [...state.items, item] };
        }
        case 'edit-item': {
            const item = validateItem(command.item);
            const previous = state.items.find(entry => entry.id === item.id);
            if (!previous) throw new Error('Редактируемая вещь уже удалена.');
            return {
                ...state,
                items: state.items.map(entry => entry.id === item.id ? item : entry),
                assignments: previous.category !== item.category ? forgetItem(state, item.id)
                    : state.assignments.map(entry => item.audiences.includes(entry.target) ? entry
                        : { ...entry, itemIds: entry.itemIds.filter(id => id !== item.id) }),
            };
        }
        case 'delete-item':
            return {
                ...state,
                items: state.items.filter(item => item.id !== command.itemId),
                assignments: forgetItem(state, command.itemId),
            };
        case 'wear':
        case 'remove-category':
        case 'clear-owner':
        case 'set-mode':
            return changeSelection(state, command);
        default:
            throw new Error('Неизвестная команда гардероба.');
    }
}

function changeSelection(state, command) {
    const { characterKey, target } = command;
    validateOwner(characterKey, target);
    const previous = assignmentFor(state, characterKey, target);
    const next = previous ? { ...previous, itemIds: [...previous.itemIds] }
        : { characterKey, target, mode: 'full', itemIds: [] };
    switch (command.type) {
        case 'set-mode':
            validateMode(command.mode);
            next.mode = command.mode;
            break;
        case 'clear-owner':
            next.itemIds = [];
            break;
        case 'remove-category':
            if (!Object.hasOwn(CATEGORIES, command.category)) throw new Error('Неизвестная категория вещи.');
            next.itemIds = next.itemIds.filter(id => state.items.find(item => item.id === id)?.category !== command.category);
            break;
        case 'wear': {
            const item = state.items.find(entry => entry.id === command.itemId);
            if (!item) throw new Error('Вещь не найдена.');
            if (!item.audiences.includes(target)) throw new Error('Вещь принадлежит другой коллекции.');
            // Selection references inventory IDs, not another copy of garment data.
            next.itemIds = next.itemIds.filter(id => state.items.find(entry => entry.id === id)?.category !== item.category);
            next.itemIds.push(item.id);
            if (item.category === 'full') next.mode = 'full';
            else if (SEPARATES.has(item.category)) next.mode = 'parts';
            break;
        }
    }
    return replaceAssignment(state, next);
}

// Full outfits hide separates and vice versa; slots and the injection share this rule.
function visibleInMode(category, mode) {
    return mode === 'parts' ? category !== 'full' : !SEPARATES.has(category);
}

export function categoriesForMode(mode) {
    validateMode(mode);
    return Object.keys(CATEGORIES).filter(category => visibleInMode(category, mode));
}

/** Category order is presentation, not the storage layout. */
export function selectWardrobe(state, characterKey, target) {
    if (!TARGETS.includes(target)) throw new Error('Неизвестный владелец наряда.');
    const assignment = assignmentFor(state, characterKey, target);
    const mode = assignment?.mode || 'full';
    const selected = new Set(assignment?.itemIds || []);
    const items = state.items.filter(item => selected.has(item.id) && item.audiences.includes(target)
        && visibleInMode(item.category, mode));
    const order = Object.keys(CATEGORIES);
    items.sort((left, right) => order.indexOf(left.category) - order.indexOf(right.category));
    return { mode, items: items.map(item => ({ ...item, audiences: [...item.audiences] })) };
}

export function selectCollection(state, target) {
    if (!TARGETS.includes(target)) throw new Error('Неизвестная коллекция.');
    return state.items.filter(item => item.audiences.includes(target))
        .map(item => ({ ...item, audiences: [...item.audiences] }));
}

export function describeItems(items) {
    return items.map(item => `${CATEGORIES[item.category]}: ${item.description}`).join('\n');
}