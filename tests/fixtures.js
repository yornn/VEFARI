import { createState, reduceWardrobe } from '../wardrobe.js';

export const owner = { characterKey: 'character:alice.png', target: 'bot' };
export const garment = (id, category = 'full') => ({ id, category, name: id, description: `${id} description`, imagePath: '', audiences: ['bot', 'user'] });

export function inventory(...items) {
    return items.reduce((state, item) => reduceWardrobe(state, { type: 'add-item', item }), createState());
}

export function wear(state, itemId, who = owner) {
    return reduceWardrobe(state, { type: 'wear', ...who, itemId });
}

export function freezeDeep(value) {
    if (value && typeof value === 'object') {
        for (const child of Object.values(value)) freezeDeep(child);
        Object.freeze(value);
    }
    return value;
}