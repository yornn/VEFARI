// Outfit references for image generator requests. No browser, storage or SillyTavern dependencies.
// SPDX-License-Identifier: AGPL-3.0-or-later
import { TARGETS } from './wardrobe.js';
import { outfitBlock } from './prompt.js';

const HEADER = '[Outfits: follow exactly, they override clothing from any other reference]';

const escapeRegExp = text => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The generator's own face-reference rule: comma-separated aliases, each a whole word or phrase. */
export function nameMatches(nameField, text) {
    if (!nameField || !text) return false;
    return String(nameField).split(',').map(alias => alias.trim()).filter(Boolean).some(alias => {
        const words = alias.split(/\s+/).filter(Boolean).map(escapeRegExp);
        try {
            return new RegExp(`(?<![\\w])${words.join('\\s+')}(?![\\w])`, 'i').test(text);
        } catch {
            // Older Safari has no lookbehind; the generator falls back the same way.
            return String(text).toLowerCase().includes(alias.toLowerCase());
        }
    });
}

function lastTextIndex(parts) {
    return parts.findLastIndex(part => typeof part?.text === 'string');
}

/** Synchronous pre-filter: only the generator's own POSTs may be held back or parsed. */
export function isGeneratorTarget({ method, url }, generator) {
    return generator?.apiType === 'gemini' && Boolean(generator.endpoint)
        && String(method || '').toUpperCase() === 'POST'
        && typeof url === 'string' && url.startsWith(`${generator.endpoint}/`);
}

export function parseGeneratorRequest({ method, url, body }, generator) {
    if (!isGeneratorTarget({ method, url }, generator) || typeof body !== 'string') return null;
    let parsed;
    try { parsed = JSON.parse(body); }
    catch { return null; }
    const parts = parsed?.contents?.[0]?.parts;
    const modalities = parsed?.generationConfig?.responseModalities;
    if (!Array.isArray(parts) || !Array.isArray(modalities) || !modalities.includes('IMAGE')) return null;
    const index = lastTextIndex(parts);
    return index < 0 ? null : { body: parsed, promptText: parts[index].text };
}

/** Sides follow the generator's face gating; the image budget is shared, Char first. */
export function planOutfits({ snapshot, promptText, generator, settings }) {
    const sides = [];
    if (!snapshot) return { sides };
    let budget = settings.generatorImages && generator.sendRefs ? settings.maxImageRefs : 0;
    for (const target of TARGETS) {
        const items = snapshot[target]?.items || [];
        if (!items.length) continue;
        if (!generator.always[target] && !nameMatches(generator.names[target], promptText)) continue;
        const imageItems = [];
        for (const item of items) {
            if (budget <= 0 || item.sendImage === false || !item.imagePath) continue;
            imageItems.push(item);
            budget--;
        }
        sides.push({ target, name: target === 'bot' ? snapshot.characterName : snapshot.userName, items, imageItems });
    }
    return { sides };
}

function label(name, item) {
    return `Outfit reference for ${name} — ${item.category.toUpperCase()}: ${item.name}. `
        + `Dress ${name} in exactly this item; it overrides clothing visible in any face or character reference.`;
}

/** Labelled outfit images go right before the prompt; every worn item is also described in it. */
export function augmentGeminiBody(body, plan, images) {
    if (!plan.sides.length) return body;
    const result = structuredClone(body);
    const parts = result.contents[0].parts;
    const index = lastTextIndex(parts);
    const references = plan.sides.flatMap(side => side.imageItems.flatMap(item => {
        const image = images.get(item.id);
        return image ? [{ text: label(side.name, item) }, { inlineData: { mimeType: image.mimeType, data: image.base64 } }] : [];
    }));
    const blocks = plan.sides.map(side => outfitBlock(side.name, side.items)).filter(Boolean);
    parts[index] = { ...parts[index], text: `${[HEADER, ...blocks].join('\n')}\n\n${parts[index].text}` };
    parts.splice(index, 0, ...references);
    return result;
}

function plural(count, one, few, many) {
    const units = count % 10;
    const tens = count % 100;
    if (units === 1 && tens !== 11) return one;
    if (units >= 2 && units <= 4 && (tens < 12 || tens > 14)) return few;
    return many;
}

export function formatReport(report) {
    if (!report) return 'ещё не было';
    return report.sides.map(side => {
        const counts = [];
        if (side.images.length) counts.push(`${side.images.length} ${plural(side.images.length, 'картинка', 'картинки', 'картинок')}`);
        if (side.text.length) counts.push(`${side.text.length} текстом`);
        return `${side.name} — ${counts.join(', ')}`;
    }).join('; ');
}
