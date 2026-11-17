// Compact clothing hints: one plain line per dressed participant.
// SPDX-License-Identifier: AGPL-3.0-or-later
import { TARGETS, describeItems, selectWardrobe } from './wardrobe.js';

export const PROMPT_KEY = 'vefari_outfit';
// What each category is called in the line the model reads.
const LABELS = Object.freeze({ clothes: 'clothes', hair: 'hairstyle' });

export function resolveParticipants(context) {
    if (context.groupId !== undefined && context.groupId !== null && context.groupId !== '') return null;
    const id = context.characterId;
    if (id === undefined || id === null) return null;
    const card = context.characters?.[id];
    if (!card?.avatar) return null;
    return { characterKey: `character:${card.avatar}`, characterName: card.name || context.name2 || 'Персонаж', userName: context.name1 || '{{user}}' };
}

export function wardrobeSnapshot(state, participants) {
    if (!participants) return null;
    const result = { ...participants, enabled: state.enabled };
    for (const target of TARGETS) {
        const { items } = selectWardrobe(state, participants.characterKey, target);
        result[target] = state.enabled ? { items, description: describeItems(items) } : { items: [], description: '' };
    }
    return result;
}

/**
 * One participant's line, `clothes Name: …; hairstyle: …`; shared by the chat injection
 * and the image generator bridge. The name goes with whichever part comes first.
 */
export function outfitBlock(name, items) {
    const parts = items.flatMap(({ category, description }) => {
        const text = lineText(description).replace(/[\s.,;]+$/u, '');
        return text ? [[LABELS[category] ?? category, text]] : [];
    });
    return parts.map(([label, text], index) => index ? `${label}: ${text}` : `${label} ${lineText(name)}: ${text}`).join('; ');
}

export function composePrompt(snapshot) {
    if (!snapshot?.enabled) return '';
    return TARGETS
        .map(target => outfitBlock(target === 'bot' ? snapshot.characterName : snapshot.userName, snapshot[target].items))
        .filter(Boolean)
        .join('\n');
}

// One line per participant: line breaks in names and descriptions become spaces.
// Only the prompt is normalized; stored names and descriptions are unchanged.
function lineText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}
