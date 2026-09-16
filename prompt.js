// Compact clothing descriptions: one bracketed block per dressed participant.
// SPDX-License-Identifier: AGPL-3.0-or-later
import { TARGETS, describeItems, selectWardrobe } from './wardrobe.js';

export const PROMPT_KEY = 'vefari_outfit';

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

export function composePrompt(snapshot) {
    if (!snapshot?.enabled) return '';
    const blocks = [];
    for (const target of TARGETS) {
        const garments = snapshot[target].items.flatMap(({ category, description }) => {
            const text = blockText(description);
            if (!text) return [];
            const ending = /[.!?…;:]$/u.test(text) ? '' : '.';
            return [`${category.toUpperCase()}: ${text}${ending}`];
        });
        if (!garments.length) continue;
        const name = blockText(target === 'bot' ? snapshot.characterName : snapshot.userName);
        blocks.push(`[OUTFIT: ${name} is currently wearing: ${garments.join(' ')}]`);
    }
    return blocks.join('\n');
}

// Preserve one pair of boundary brackets and one line per participant.
// Only the prompt is normalized; stored names and descriptions are unchanged.
function blockText(value) {
    return String(value ?? '').replace(/\[/g, '(').replace(/\]/g, ')').replace(/\s+/g, ' ').trim();
}