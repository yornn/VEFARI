// VEFARI persistence boundary: validate stored data before it reaches the domain.
// SPDX-License-Identifier: AGPL-3.0-or-later
import { CATEGORIES, SCHEMA_VERSION, TARGETS, createState, validateItem, validateMode, validateOwner } from './wardrobe.js';

export const SETTINGS_KEY = 'vefari';
const records = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function parseItems(raw, legacy = false) {
    if (!Array.isArray(raw)) throw new Error('Повреждена коллекция вещей VEFARI.');
    const items = raw.map(item => {
        if (!records(item)) throw new Error('Некорректная запись вещи.');
        return validateItem(legacy ? { ...item, audiences: [...TARGETS] } : item);
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
        validateMode(entry.mode);
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
        return { characterKey: entry.characterKey, target: entry.target, mode: entry.mode, itemIds };
    });
}

/** Convert only VEFARI 0.1 data. Never reads another extension's settings. */
function migratePrototype(raw, items) {
    const assignments = [];
    if (raw.activeOutfits == null) return assignments;
    if (!records(raw.activeOutfits)) throw new Error('Не удалось прочитать наряды раннего VEFARI.');
    const inventory = new Map(items.map(item => [item.id, item]));
    for (const [characterKey, selection] of Object.entries(raw.activeOutfits)) {
        if (!records(selection)) throw new Error('Повреждён сохранённый наряд.');
        for (const target of TARGETS) {
            const itemIds = Object.keys(CATEGORIES).flatMap(category => {
                const id = selection[target]?.[category];
                return inventory.get(id)?.category === category ? [id] : [];
            });
            const mode = selection[`${target}Mode`] ?? 'full';
            assignments.push({ characterKey, target, mode, itemIds });
        }
    }
    return parseAssignments(assignments, items);
}

export function decodeSettings(raw) {
    if (raw == null) return createState();
    if (!records(raw)) throw new Error('Настройки VEFARI повреждены; исходные данные не изменены.');
    if (raw.schemaVersion !== undefined && ![2, SCHEMA_VERSION].includes(raw.schemaVersion)) {
        throw new Error(`Версия данных VEFARI ${raw.schemaVersion} не поддерживается; данные не изменены.`);
    }
    if (raw.schemaVersion !== undefined && typeof raw.enabled !== 'boolean') {
        throw new Error('Повреждён переключатель гардероба.');
    }
    const items = parseItems(raw.schemaVersion !== undefined ? raw.items : raw.items ?? [], raw.schemaVersion !== SCHEMA_VERSION);
    return {
        schemaVersion: SCHEMA_VERSION,
        enabled: raw.enabled !== false,
        items,
        assignments: raw.schemaVersion !== undefined
            ? parseAssignments(raw.assignments, items) : migratePrototype(raw, items),
    };
}

export function readSettings(context) {
    return decodeSettings(context.extensionSettings[SETTINGS_KEY]);
}

export function writeSettings(context, state) {
    const next = decodeSettings(state);
    const current = context.extensionSettings[SETTINGS_KEY];
    if (current && current.schemaVersion === undefined && !Object.hasOwn(context.extensionSettings, 'vefari_v1_backup')) {
        context.extensionSettings.vefari_v1_backup = structuredClone(current);
    }
    if (current?.schemaVersion === 2 && !Object.hasOwn(context.extensionSettings, 'vefari_v2_backup')) {
        context.extensionSettings.vefari_v2_backup = structuredClone(current);
    }
    context.extensionSettings[SETTINGS_KEY] = next;
    context.saveSettingsDebounced();
}

// Image cleanup retains the migration backup's references, too.
export function retainedImages(context) {
    const current = readSettings(context).items;
    const backups = ['vefari_v1_backup', 'vefari_v2_backup'].flatMap(key => {
        const items = context.extensionSettings[key]?.items;
        return Array.isArray(items) ? items : [];
    });
    return [...current, ...backups];
}