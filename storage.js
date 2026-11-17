// VEFARI persistence boundary: validate stored data before it reaches the domain.
// SPDX-License-Identifier: AGPL-3.0-or-later
import {
    DEFAULT_INJECT_DEPTH, SCHEMA_VERSION, TARGETS, createDescriber, createState, validateDescriber, validateGeneratorImages,
    validateImageLimit, validateInjectDepth, validateItem, validateOwner, validateSendModes,
} from './wardrobe.js';

export const SETTINGS_KEY = 'vefari';
// The first save after a migration keeps the data as it was, once per old schema.
const BACKUPS = Object.freeze({ 1: 'vefari_v1_backup', 2: 'vefari_v2_backup', 3: 'vefari_v3_backup' });
const records = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Up to schema 3 an outfit had six categories and was worn whole or in parts.
// Hair stays hair; everything else is clothing now.
const LEGACY_CATEGORIES = Object.freeze(['full', 'top', 'bottom', 'shoes', 'accessories', 'hair']);
const LEGACY_SEPARATES = new Set(['top', 'bottom', 'shoes']);
const LEGACY_MODES = Object.freeze(['full', 'parts']);

function collapseCategory(category) {
    if (category === 'hair') return 'hair';
    return LEGACY_CATEGORIES.includes(category) ? 'clothes' : category;
}

function legacyVisible(category, mode) {
    return mode === 'parts' ? category !== 'full' : !LEGACY_SEPARATES.has(category);
}

function parseItems(raw, { audiences, categories }) {
    if (!Array.isArray(raw)) throw new Error('Повреждена коллекция вещей VEFARI.');
    const items = raw.map(item => {
        if (!records(item)) throw new Error('Некорректная запись вещи.');
        const next = { ...item };
        if (audiences) next.audiences = [...TARGETS];
        if (categories) next.category = collapseCategory(item.category);
        return validateItem(next);
    });
    if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('В коллекции повторяются идентификаторы.');
    return items;
}

function parseAssignments(raw, items) {
    if (!Array.isArray(raw)) throw new Error('Повреждён список выбранных нарядов.');
    const owners = new Set();
    const inventory = new Map(items.map(item => [item.id, item]));
    return raw.map(entry => {
        if (!records(entry)) throw new Error('Повреждена запись выбранного наряда.');
        validateOwner(entry.characterKey, entry.target);
        if (!Array.isArray(entry.itemIds)) throw new Error('Повреждён список надетых вещей.');
        const owner = JSON.stringify([entry.characterKey, entry.target]);
        if (owners.has(owner)) throw new Error('Наряд владельца записан несколько раз.');
        owners.add(owner);
        const categories = new Set();
        const itemIds = entry.itemIds.filter(id => {
            const item = inventory.get(id);
            if (!item || !item.audiences.includes(entry.target)) return false;
            if (categories.has(item.category)) throw new Error('В наряде повторяется категория одежды.');
            categories.add(item.category);
            return true;
        });
        return { characterKey: entry.characterKey, target: entry.target, itemIds };
    });
}

/**
 * An old outfit may wear several pieces that are all clothing now; each owner keeps one.
 * It is the first piece the old mode showed, in the old category order. Hair is kept as it was.
 */
function collapseAssignments(raw, rawItems, items) {
    if (!Array.isArray(raw)) throw new Error('Повреждён список выбранных нарядов.');
    const oldCategory = new Map(rawItems.map(item => [item.id, item.category]));
    const inventory = new Map(items.map(item => [item.id, item]));
    return raw.map(entry => {
        if (!records(entry)) throw new Error('Повреждена запись выбранного наряда.');
        if (!LEGACY_MODES.includes(entry.mode)) throw new Error('Неизвестный режим гардероба.');
        if (!Array.isArray(entry.itemIds)) throw new Error('Повреждён список надетых вещей.');
        const rank = id => {
            const category = oldCategory.get(id);
            return (legacyVisible(category, entry.mode) ? 0 : LEGACY_CATEGORIES.length) + LEGACY_CATEGORIES.indexOf(category);
        };
        const eligible = [...new Set(entry.itemIds)].filter(id => inventory.get(id)?.audiences.includes(entry.target));
        const worn = new Map();
        for (const id of eligible.sort((left, right) => rank(left) - rank(right))) {
            const { category } = inventory.get(id);
            if (!worn.has(category)) worn.set(category, id);
        }
        return { characterKey: entry.characterKey, target: entry.target, itemIds: [...worn.values()] };
    });
}

/** Convert only VEFARI 0.1 data. Never reads another extension's settings. */
function migratePrototype(raw, rawItems, items) {
    const assignments = [];
    if (raw.activeOutfits == null) return assignments;
    if (!records(raw.activeOutfits)) throw new Error('Не удалось прочитать наряды раннего VEFARI.');
    const oldCategory = new Map(rawItems.map(item => [item.id, item.category]));
    for (const [characterKey, selection] of Object.entries(raw.activeOutfits)) {
        if (!records(selection)) throw new Error('Повреждён сохранённый наряд.');
        for (const target of TARGETS) {
            const itemIds = LEGACY_CATEGORIES.flatMap(category => {
                const id = selection[target]?.[category];
                return oldCategory.get(id) === category ? [id] : [];
            });
            const mode = selection[`${target}Mode`] ?? 'full';
            assignments.push({ characterKey, target, mode, itemIds });
        }
    }
    return parseAssignments(collapseAssignments(assignments, rawItems, items), items);
}

// 0.7 and earlier had one switch for both participants; it becomes the same mode for each.
function legacySendModes(generatorImages) {
    const mode = validateGeneratorImages(generatorImages ?? true) ? 'image' : 'text';
    return { bot: mode, user: mode };
}

export function decodeSettings(raw) {
    if (raw == null) return createState();
    if (!records(raw)) throw new Error('Настройки VEFARI повреждены; исходные данные не изменены.');
    const version = raw.schemaVersion;
    if (version !== undefined && ![2, 3, SCHEMA_VERSION].includes(version)) {
        throw new Error(`Версия данных VEFARI ${version} не поддерживается; данные не изменены.`);
    }
    if (version !== undefined && typeof raw.enabled !== 'boolean') {
        throw new Error('Повреждён переключатель гардероба.');
    }
    const legacy = version !== SCHEMA_VERSION;
    const rawItems = version !== undefined ? raw.items : raw.items ?? [];
    const items = parseItems(rawItems, { audiences: version === undefined || version === 2, categories: legacy });
    let assignments;
    if (version === undefined) assignments = migratePrototype(raw, rawItems, items);
    else if (legacy) assignments = parseAssignments(collapseAssignments(raw.assignments, rawItems, items), items);
    else assignments = parseAssignments(raw.assignments, items);
    return {
        schemaVersion: SCHEMA_VERSION,
        enabled: raw.enabled !== false,
        items,
        assignments,
        // Bridge settings arrived without a schema bump: absent means default.
        sendModes: validateSendModes(raw.sendModes ?? legacySendModes(raw.generatorImages)),
        maxImageRefs: validateImageLimit(raw.maxImageRefs ?? 4),
        // 0.8 and earlier always injected at depth 0; they move to the quieter default.
        injectDepth: validateInjectDepth(raw.injectDepth ?? DEFAULT_INJECT_DEPTH),
        // Same for the feather's connection; validation keeps only its four known fields.
        describer: validateDescriber(raw.describer ?? createDescriber()),
    };
}

export function readSettings(context) {
    return decodeSettings(context.extensionSettings[SETTINGS_KEY]);
}

export function writeSettings(context, state) {
    const next = decodeSettings(state);
    const current = context.extensionSettings[SETTINGS_KEY];
    const backup = current ? BACKUPS[current.schemaVersion ?? 1] : undefined;
    if (backup && !Object.hasOwn(context.extensionSettings, backup)) {
        context.extensionSettings[backup] = structuredClone(current);
    }
    context.extensionSettings[SETTINGS_KEY] = next;
    context.saveSettingsDebounced();
}

// Image cleanup retains the migration backups' references, too.
export function retainedImages(context) {
    const current = readSettings(context).items;
    const backups = Object.values(BACKUPS).flatMap(key => {
        const items = context.extensionSettings[key]?.items;
        return Array.isArray(items) ? items : [];
    });
    return [...current, ...backups];
}
