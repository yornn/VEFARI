// Stateless DOM builders for the wardrobe window. User data goes in as text, never as HTML.
// SPDX-License-Identifier: AGPL-3.0-or-later
import { CATEGORIES } from './wardrobe.js';
import { createIcon } from './icons.js';
import { imageUrl } from './images.js';

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** A picture, or the category icon when there is none or it fails to load. */
function thumbnail(item, category, className) {
    const holder = element('span', className);
    const url = imageUrl(item?.imagePath);
    if (!url) {
        holder.append(createIcon(category));
        return holder;
    }
    const image = element('img');
    image.src = url;
    image.alt = '';
    image.loading = 'lazy';
    image.addEventListener('error', () => image.replaceWith(createIcon(category)), { once: true });
    holder.append(image);
    return holder;
}

export function createSlot(category, item, { active }) {
    const row = element('li', 'vefari_slot_row');
    const slot = element('button', 'vefari_slot');
    slot.type = 'button';
    slot.dataset.filter = category;
    slot.dataset.filled = String(Boolean(item));
    slot.setAttribute('aria-pressed', String(active));
    slot.setAttribute('aria-label', `${CATEGORIES[category]}: ${item ? item.name : 'пусто'} — показать вещи этой категории`);
    const text = element('span', 'vefari_slot_text');
    const name = item ? element('span', 'vefari_slot_name', item.name) : element('span', 'vefari_slot_empty', 'пусто');
    if (item) name.title = item.name;
    text.append(element('span', 'vefari_slot_label', CATEGORIES[category]), name);
    slot.append(thumbnail(item, category, 'vefari_slot_thumb'), text);
    row.append(slot);
    if (item) {
        const remove = element('button', 'vefari_icon_button');
        remove.type = 'button';
        remove.dataset.action = 'unequip';
        remove.dataset.id = category;
        remove.title = `Снять: ${item.name}`;
        remove.setAttribute('aria-label', remove.title);
        remove.append(createIcon('close'));
        row.append(remove);
    }
    return row;
}
