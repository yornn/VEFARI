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

function iconButton(action, item, label, icon) {
    const control = element('button', 'vefari_icon_button');
    control.type = 'button';
    control.dataset.action = action;
    control.dataset.id = item.id;
    control.title = `${label}: ${item.name}`;
    control.setAttribute('aria-label', control.title);
    control.append(createIcon(icon));
    return control;
}

function placeholder(category) {
    const empty = element('div', 'vefari_text_only');
    empty.title = 'Текстовый наряд';
    empty.append(createIcon(category));
    return empty;
}

export function createChip(value, label, { pressed }) {
    const chip = element('button', 'vefari_chip', label);
    chip.type = 'button';
    chip.dataset.filter = value;
    chip.setAttribute('aria-pressed', String(pressed));
    return chip;
}

export function createCard(item, { worn }) {
    const card = element('article', 'vefari_card');
    card.dataset.action = 'toggle';
    card.dataset.id = item.id;
    card.dataset.worn = String(worn);
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-pressed', String(worn));
    card.setAttribute('aria-label', worn ? `${item.name} — сейчас надето. Снять` : `Надеть: ${item.name}`);
    const media = element('div', 'vefari_card_media');
    const url = imageUrl(item.imagePath);
    if (url) {
        const image = element('img');
        image.src = url;
        image.alt = item.name;
        image.loading = 'lazy';
        image.addEventListener('error', () => image.replaceWith(placeholder(item.category)), { once: true });
        media.append(image);
    } else {
        media.append(placeholder(item.category));
    }
    if (worn) {
        const mark = element('span', 'vefari_worn_mark');
        mark.append(createIcon('check'));
        media.append(mark);
    }
    const actions = element('div', 'vefari_card_actions');
    actions.append(iconButton('edit', item, 'Изменить', 'edit'), iconButton('delete', item, 'Удалить', 'delete'));
    media.append(actions);
    const title = element('strong', 'vefari_card_title', item.name);
    title.title = item.name;
    card.append(media, title);
    return card;
}

export function createEmpty(filtered) {
    const empty = element('div', 'vefari_empty');
    const add = element('button', 'vefari_button', 'Добавить вещь');
    add.type = 'button';
    add.dataset.action = 'add';
    empty.append(createIcon('othala'), element('p', '', filtered ? 'В этой категории пусто' : 'Сундук пуст'), add);
    return empty;
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
