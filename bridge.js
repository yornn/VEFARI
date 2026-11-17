// Outfit notes for image generator requests. No browser, storage or SillyTavern dependencies.
// The image prompt is written by a language model that already knows the outfit (from the chat line
// or the {{outfits}} macro), so a request gets nothing from VEFARI unless the outfit changed since.
// SPDX-License-Identifier: AGPL-3.0-or-later
import { TARGETS } from './wardrobe.js';
import { outfitBlock } from './prompt.js';

// The generator's own preamble, present only while it attaches references; not part of the scene.
const GENERATOR_INSTRUCTION = /^\[CRITICAL: The reference image\(s\)[^\]]*\]\n\n/;
// Last in the prompt and worded as an update: the scene's framing must survive it.
const UPDATE_NOTE = '[Outfit update: the clothes or hairstyle described above have changed. '
    + 'Keep the framing, crop, pose and composition exactly as described and show only what is in frame, but dress them like this:';
const PROMPT_MEMORY_LIMIT = 200;

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

const sideName = (snapshot, target) => target === 'bot' ? snapshot.characterName : snapshot.userName;

/** The scene as the prompt writer wrote it: the same for a first try, a regeneration and a retry without references. */
export function sceneText(promptText) {
    const text = String(promptText ?? '');
    return text.slice(text.match(GENERATOR_INSTRUCTION)?.[0].length ?? 0);
}

/** What each participant wears, as the line the prompt writer reads; empty when nothing is worn. */
export function outfitSignatures(snapshot) {
    return Object.fromEntries(TARGETS.map(target => [
        target, snapshot ? outfitBlock(sideName(snapshot, target), snapshot[target]?.items || []) : '',
    ]));
}

/** Participants dressed differently from when the prompt was written. Taking everything off has nothing to say. */
export function changedTargets(current, baseline) {
    return TARGETS.filter(target => current[target] && current[target] !== baseline[target]);
}

/**
 * Remembers, for every scene prompt, what each participant wore when it was written.
 * A prompt seen for the first time was written from what the writer last saw: the chat line
 * before a reply, or the {{outfits}} macro. Without either, it is taken to match the current outfit.
 */
export function createOutfitMemory(limit = PROMPT_MEMORY_LIMIT) {
    const prompts = new Map();
    let writer = null;
    return {
        sawWriter(signatures) { writer = signatures; },
        baseline(scene, current) {
            if (!prompts.has(scene)) {
                prompts.set(scene, writer ?? current);
                if (prompts.size > limit) prompts.delete(prompts.keys().next().value);
            }
            return prompts.get(scene);
        },
    };
}

/** Sides follow the generator's face gating; each side's send mode allows pictures; the image budget is shared, Char first. */
export function planOutfits({ snapshot, promptText, generator, settings, targets = TARGETS }) {
    const sides = [];
    if (!snapshot) return { sides };
    let budget = generator.sendRefs ? settings.maxImageRefs : 0;
    for (const target of TARGETS.filter(entry => targets.includes(entry))) {
        const items = snapshot[target]?.items || [];
        if (!items.length) continue;
        if (!generator.always[target] && !nameMatches(generator.names[target], promptText)) continue;
        const imageItems = [];
        const withImages = settings.sendModes?.[target] === 'image';
        for (const item of items) {
            if (!withImages || budget <= 0 || !item.imagePath) continue;
            imageItems.push(item);
            budget--;
        }
        sides.push({ target, name: sideName(snapshot, target), items, imageItems });
    }
    return { sides };
}

// Outfit pictures are often full-length shots: the model may take only the garment from them.
function label(name, item) {
    return item.category === 'hair'
        ? `Hairstyle reference for ${name}: ${item.name}. Use it only for ${name}'s hairstyle; `
            + 'ignore the face, pose, framing, crop and background of this picture.'
        : `Outfit reference for ${name}: ${item.name}. Use it only for the design, colors and materials of ${name}'s clothes; `
            + 'ignore the person, pose, framing, crop and background of this picture.';
}

/** Labelled outfit pictures go right before the prompt; the new outfit lines close it as an update note. */
export function augmentGeminiBody(body, plan, images) {
    const lines = plan.sides.map(side => outfitBlock(side.name, side.items)).filter(Boolean);
    if (!lines.length) return body;
    const result = structuredClone(body);
    const parts = result.contents[0].parts;
    const index = lastTextIndex(parts);
    const references = plan.sides.flatMap(side => side.imageItems.flatMap(item => {
        const image = images.get(item.id);
        return image ? [{ text: label(side.name, item) }, { inlineData: { mimeType: image.mimeType, data: image.base64 } }] : [];
    }));
    parts[index] = { ...parts[index], text: `${parts[index].text}\n\n${UPDATE_NOTE}\n${lines.join('\n')}]` };
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
    if (!report.sides.length) {
        return report.changed ? 'ничего: тех, кто переоделся, нет в кадре' : 'ничего: наряды не менялись, промпт уже с ними';
    }
    return report.sides.map(side => {
        const counts = [];
        if (side.images.length) counts.push(`${side.images.length} ${plural(side.images.length, 'картинка', 'картинки', 'картинок')}`);
        if (side.text.length) counts.push(`${side.text.length} текстом`);
        return `${side.name} — ${counts.join(', ')}`;
    }).join('; ');
}
