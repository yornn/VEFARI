/**
 * VEFARI — a standalone wardrobe for SillyTavern.
 * UI for the VEFARI command-based wardrobe controller.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { CATEGORIES, VERSION, validateItem } from './wardrobe.js';
import { createController } from './integration.js';
import { createId } from './ids.js';
import { retainedImages } from './storage.js';
import { deleteUnusedImage, imageUrl, loadReference, MAX_IMAGE_BYTES, prepareImage, uploadImage } from './images.js';
import { createZip, embedOutfitText, extractOutfitText, safeFilename } from './transfer.js';
import { createIcon } from './icons.js';
import { mountWardrobeWindow } from './window.js';

const getContext = () => SillyTavern.getContext();
const controller = createController(getContext, { reportError: error => status(error.message, true) });
let root;
let editingId = null;
let pendingImport = null;
let target = 'user';
let busy = false;
let dirty = false;
let settingsOpen = false;
let editorOpen = false;
let wardrobeWindow;
let participantNames = { user: '{{user}}', bot: 'Персонаж' };
const field = id => root.querySelector(`#vefari_${id}`);

function status(message = '', error = false) {
    if (root) {
        field('status').textContent = message;
        field('status').dataset.error = String(error);
    }
    if (error) console.error('[VEFARI]', message);
}

function button(label, action, id, disabled = false) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'vefari_button';
    element.textContent = label;
    element.dataset.action = action;
    element.dataset.id = id;
    element.disabled = disabled;
    return element;
}

function appendImage(parent, item) {
    const url = imageUrl(item?.imagePath);
    if (!url) return;
    const image = document.createElement('img');
    image.src = url;
    image.alt = item.name;
    image.loading = 'lazy';
    image.addEventListener('error', () => {
        const missing = document.createElement('p');
        missing.className = 'vefari_hint';
        missing.textContent = 'Картинка недоступна. Описание продолжает работать.';
        image.replaceWith(missing);
    }, { once: true });
    parent.append(image);
}

function render() {
    const { state: settings, participants: character, selection, collection, prompt } = controller.view(target);
    const active = selection.items;
    const context = getContext();
    participantNames = character
        ? { user: character.userName, bot: character.characterName }
        : {
            user: context.name1 || participantNames.user,
            bot: context.name2 || participantNames.bot,
        };
    field('tab_user_name').textContent = participantNames.user;
    field('tab_bot_name').textContent = participantNames.bot;
    field('enabled').checked = settings.enabled;
    field('context').textContent = character
        ? ''
        : 'Откройте одиночный чат, чтобы надеть вещи. Коллекцию можно редактировать и без чата. Группы пока не поддерживаются.';
    field('mode').value = selection.mode;
    field('mode').disabled = !character;
    field('clear').disabled = !character;
    field('disabled_notice').hidden = settings.enabled;
    for (const tab of root.querySelectorAll('[role="tab"]')) {
        const selected = tab.dataset.target === target;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
    }
    field('collection_panel').setAttribute('aria-labelledby', `vefari_tab_${target}`);
    field('current').replaceChildren();
    for (const item of active) {
        const row = document.createElement('div');
        row.className = 'vefari_row';
        const label = document.createElement('span');
        label.textContent = `${CATEGORIES[item.category]}: ${item.name}`;
        row.append(label, button('Снять', 'unequip', item.category));
        field('current').append(row);
    }
    if (!active.length) field('current').textContent = 'Ничего не выбрано.';

    const list = field('items');
    list.replaceChildren();
    const filter = field('filter').value;
    for (const item of collection) {
        if (filter !== 'all' && item.category !== filter) continue;
        const card = document.createElement('article');
        card.className = 'vefari_card';
        const worn = active.some(entry => entry.id === item.id);
        card.dataset.worn = String(worn);
        card.dataset.action = 'toggle';
        card.dataset.id = item.id;
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
        card.setAttribute('aria-pressed', String(worn));
        card.setAttribute('aria-label', worn ? `${item.name} — сейчас надето. Снять` : `Надеть: ${item.name}`);
        appendImage(card, item);
        if (!imageUrl(item.imagePath)) {
            const placeholder = document.createElement('div');
            placeholder.className = 'vefari_text_only';
            placeholder.title = 'Текстовый наряд';
            placeholder.append(createIcon('tunic'));
            card.append(placeholder);
        }
        const heading = document.createElement('strong');
        heading.className = 'vefari_card_title';
        heading.textContent = item.name;
        const actions = document.createElement('div');
        actions.className = 'vefari_card_actions';
        for (const [action, label] of [['edit', 'Изменить'], ['delete', 'Удалить']]) {
            const control = button('', action, item.id);
            control.classList.add('vefari_icon_button');
            control.title = `${label}: ${item.name}`;
            control.setAttribute('aria-label', control.title);
            control.append(createIcon(action));
            actions.append(control);
        }
        card.append(heading, actions);
        list.append(card);
    }
    if (!list.childElementCount) {
        const empty = document.createElement('p');
        empty.className = 'vefari_empty vefari_hint';
        empty.textContent = filter === 'all'
            ? 'Коллекция пока пуста. Добавьте первую вещь — с неё начнётся ваш гардероб.'
            : 'В этой категории пока нет вещей. Выберите другую категорию или добавьте новую вещь.';
        list.append(empty);
    }
    field('prompt').textContent = prompt || 'Инжект пуст: гардероб выключен, нет активных вещей или не выбран персонаж.';
}

function refreshView() {
    try { render(); }
    catch (error) { status(error.message, true); }
}

function showSettings(show, focus = true) {
    settingsOpen = show;
    editorOpen = false;
    field('settings_panel').hidden = !show;
    field('editor_panel').hidden = true;
    field('collection_panel').hidden = show;
    field('settings_toggle').setAttribute('aria-expanded', String(show));
    if (focus) field(show ? 'settings_title' : `tab_${target}`).focus({ preventScroll: true });
}

function showEditor(focus = true) {
    settingsOpen = false;
    editorOpen = true;
    field('settings_panel').hidden = true;
    field('editor_panel').hidden = false;
    field('collection_panel').hidden = true;
    field('settings_toggle').setAttribute('aria-expanded', 'false');
    if (focus) field('editor_title').focus({ preventScroll: true });
}

function mayDiscardDraft() {
    return !dirty || window.confirm('Отменить несохранённые изменения вещи?');
}

function switchTarget(next) {
    if (busy || next === target || !mayDiscardDraft()) return;
    target = next;
    resetEditor();
    showSettings(false, false);
    status();
    refreshView();
    field(`tab_${target}`).focus();
}

function ownerCommand(type, extra = {}) {
    const { participants } = controller.view(target);
    if (!participants) throw new Error('Сначала откройте одиночный чат.');
    controller.dispatch({ type, characterKey: participants.characterKey, target, ...extra });
}

function resetEditor() {
    editingId = null;
    pendingImport = null;
    field('form').reset();
    field('editor_title').textContent = 'Добавить вещь';
    field('editor_image').replaceChildren();
    field('remove_image').disabled = true;
    field('export_item').disabled = true;
    field('audience').value = target;
    dirty = false;
}

function editItem(item) {
    resetEditor();
    editingId = item.id;
    field('editor_title').textContent = 'Изменить вещь';
    field('name').value = item.name;
    field('description').value = item.description;
    field('category').value = item.category;
    field('audience').value = item.audiences.length === 2 ? 'both' : item.audiences[0];
    field('remove_image').disabled = !item.imagePath;
    field('export_item').disabled = !item.imagePath;
    field('send_image').checked = item.sendImage !== false;
    field('send_text').checked = item.sendImage === false;
    appendImage(field('editor_image'), item);
    showEditor(false);
    field('name').focus();
}

// A failed cleanup must not discard an already saved description or outfit.
async function cleanupImage(path) {
    if (!path) return;
    try {
        await deleteUnusedImage(path, retainedImages(getContext()), getContext());
    } catch (error) {
        status(`Изменения сохранены, но старый файл остался на сервере: ${error.message}`, true);
    }
}

function base64Bytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    root.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Text-only items still export as images: a drawn card carries the embedded description. */
async function placeholderImage(name) {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 640;
    const drawing = canvas.getContext('2d');
    if (!drawing) throw new Error('Обработка картинки недоступна в этом браузере.');
    drawing.fillStyle = '#1b1e1d';
    drawing.fillRect(0, 0, 640, 640);
    drawing.strokeStyle = '#c5a572';
    drawing.lineWidth = 4;
    drawing.strokeRect(24, 24, 592, 592);
    drawing.textAlign = 'center';
    drawing.fillStyle = '#c5a572';
    drawing.font = '24px Georgia, serif';
    drawing.fillText('VEFARI', 320, 92);
    drawing.fillStyle = '#dedbd3';
    drawing.font = '34px Georgia, serif';
    const lines = [];
    let line = '';
    for (const word of String(name).split(/\s+/).filter(Boolean)) {
        const attempt = line ? `${line} ${word}` : word;
        if (line && drawing.measureText(attempt).width > 520) {
            lines.push(line);
            line = word;
        } else line = attempt;
    }
    if (line) lines.push(line);
    const shown = lines.slice(0, 6);
    shown.forEach((text, index) => drawing.fillText(text, 320, 320 - (shown.length - 1) * 22 + index * 44));
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Не удалось подготовить PNG.');
    return new Uint8Array(await blob.arrayBuffer());
}

function importItem(file, description) {
    resetEditor();
    pendingImport = file;
    const baseName = file.name.replace(/\.[^.]+$/, '');
    field('editor_title').textContent = 'Импорт вещи';
    field('name').value = baseName;
    field('description').value = description;
    field('export_item').disabled = false;
    const preview = document.createElement('img');
    const url = URL.createObjectURL(file);
    preview.src = url;
    preview.alt = baseName;
    preview.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
    field('editor_image').replaceChildren(preview);
    dirty = true;
    showEditor(false);
    field('name').focus();
    status('Описание вшито в картинку. Выберите категорию и сохраните вещь.');
}

async function handleImport(file) {
    if (file.type !== 'image/png') throw new Error('Импортируются только PNG со вшитым описанием.');
    if (!file.size) throw new Error('Изображение пустое.');
    if (file.size > MAX_IMAGE_BYTES) throw new Error('Изображение должно быть не больше 10 МБ.');
    const description = extractOutfitText(new Uint8Array(await file.arrayBuffer()));
    if (!description) throw new Error('В этой картинке нет вшитого описания наряда.');
    importItem(file, description);
}

async function exportItem() {
    const name = field('name').value.trim();
    const description = field('description').value.trim();
    if (!description) throw new Error('Заполните поле «Описание».');
    let bytes;
    if (pendingImport) {
        bytes = new Uint8Array(await pendingImport.arrayBuffer());
    } else {
        const item = controller.view().state.items.find(entry => entry.id === editingId);
        if (!item?.imagePath) throw new Error('Экспорт доступен для вещи с сохранённой картинкой.');
        bytes = base64Bytes((await loadReference(item.imagePath)).base64);
    }
    const png = embedOutfitText(bytes, description);
    downloadBlob(new Blob([png], { type: 'image/png' }), `${safeFilename(name)}.png`);
    status(`Наряд «${name || 'без названия'}» экспортирован: описание вшито в PNG.`);
}

async function exportAll() {
    const items = controller.view().state.items;
    if (!items.length) throw new Error('Коллекция пуста — экспортировать нечего.');
    const entries = [];
    const usedNames = new Set();
    for (const [index, item] of items.entries()) {
        status(`Готовлю архив: ${index + 1} из ${items.length}…`);
        const bytes = item.imagePath
            ? base64Bytes((await loadReference(item.imagePath)).base64)
            : await placeholderImage(item.name);
        const base = safeFilename(item.name);
        let filename = `${base}.png`;
        for (let copy = 2; usedNames.has(filename); copy++) filename = `${base} (${copy}).png`;
        usedNames.add(filename);
        entries.push({ name: filename, data: embedOutfitText(bytes, item.description) });
    }
    const archive = createZip(entries);
    downloadBlob(new Blob([archive], { type: 'application/zip' }), `vefari-wardrobe-${new Date().toISOString().slice(0, 10)}.zip`);
    status(`Экспортировано нарядов: ${entries.length}. Описание каждого вшито в свой PNG.`);
}

async function runAction(action) {
    if (busy) return;
    busy = true;
    field('controls').inert = true;
    field('controls').setAttribute('aria-busy', 'true');
    field('settings_toggle').disabled = true;
    field('close').disabled = true;
    status();
    try {
        await action();
    } catch (error) {
        status(error.message || String(error), true);
    } finally {
        busy = false;
        field('controls').inert = false;
        field('controls').setAttribute('aria-busy', 'false');
        field('settings_toggle').disabled = false;
        field('close').disabled = false;
        if (!settingsOpen && !editorOpen) field(`tab_${target}`).focus({ preventScroll: true });
    }
}

async function handleSave() {
    const settings = controller.view().state;
    const itemId = editingId;
    const previous = settings.items.find(item => item.id === editingId);
    const data = {
        id: itemId || createId(),
        name: field('name').value.trim(),
        description: field('description').value.trim(),
        category: field('category').value,
        audiences: field('audience').value === 'both' ? ['bot', 'user'] : [field('audience').value],
        imagePath: field('remove_image').checked ? '' : previous?.imagePath || '',
        sendImage: field('send_image').checked,
    };
    validateItem(data);
    if (itemId && !previous) throw new Error('Редактируемая вещь уже удалена.');
    const picked = field('image').files[0];
    if (picked && pendingImport) throw new Error('Выберите одно: новую картинку или импортированную.');
    if (picked && field('remove_image').checked) throw new Error('Выберите одно: новую картинку или удаление сохранённой.');
    const file = picked || pendingImport;
    const oldPath = previous?.imagePath;
    let uploadedPath = '';
    if (file) {
        status('Сохраняю картинку…');
        uploadedPath = await uploadImage(await prepareImage(file), getContext());
        data.imagePath = uploadedPath;
    }
    try {
        controller.dispatch({ type: itemId ? 'edit-item' : 'add-item', item: data });
    } catch (error) {
        await cleanupImage(uploadedPath);
        throw error;
    }
    resetEditor();
    showSettings(false);
    status();
    if (oldPath !== data.imagePath) await cleanupImage(oldPath);
}

async function handleItemAction(action, id) {
    const settings = controller.view().state;
    const item = settings.items.find(entry => entry.id === id);
    if (action === 'edit' && item) {
        if (!mayDiscardDraft()) return;
        editItem(item);
        return;
    }
    if (action === 'delete' && item) {
        if (!window.confirm(`Удалить «${item.name}» из коллекции и всех активных нарядов?`)) return;
        controller.dispatch({ type: 'delete-item', itemId: id });
        if (editingId === id) resetEditor();
        status();
        await cleanupImage(item.imagePath);
        return;
    }
    if (action === 'equip') ownerCommand('wear', { itemId: id });
    if (action === 'unequip') ownerCommand('remove-category', { category: id });
    if (action === 'toggle' && item) {
        const worn = controller.view(target).selection.items.some(entry => entry.id === id);
        ownerCommand(worn ? 'remove-category' : 'wear', worn ? { category: item.category } : { itemId: id });
    }
}

async function init() {
    if (document.getElementById('vefari_menu')) return;
    const responses = await Promise.all(['./wardrobe.html', './wardrobe.css'].map(path => fetch(new URL(path, import.meta.url))));
    for (const response of responses) {
        if (!response.ok) throw new Error(`Не удалось загрузить интерфейс (HTTP ${response.status}).`);
    }
    const [markup, styleText] = await Promise.all(responses.map(response => response.text()));
    const template = document.createElement('template');
    // Only the bundled static template is parsed as HTML; user data uses textContent.
    template.innerHTML = markup;
    root = template.content.querySelector('#vefari_window');
    if (!root) throw new Error('Повреждён шаблон настроек.');
    for (const placeholder of root.querySelectorAll('[data-icon]')) {
        placeholder.append(createIcon(placeholder.dataset.icon));
    }
    for (const [key, label] of Object.entries(CATEGORIES)) {
        field('filter').add(new Option(label, key));
        field('category').add(new Option(label, key));
    }
    field('enabled').addEventListener('change', () => runAction(() => {
        controller.dispatch({ type: 'set-enabled', enabled: field('enabled').checked });
    }));
    for (const tab of root.querySelectorAll('[role="tab"]')) {
        tab.addEventListener('click', () => switchTarget(tab.dataset.target));
        tab.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            switchTarget(event.key === 'Home' ? 'user' : event.key === 'End' ? 'bot' : target === 'user' ? 'bot' : 'user');
        });
    }
    field('filter').addEventListener('change', refreshView);
    field('image').addEventListener('change', () => {
        const file = field('image').files[0];
        if (!file || field('name').value.trim()) return;
        field('name').value = file.name.replace(/\.[^.]+$/, '');
    });
    field('import').addEventListener('click', () => {
        if (!mayDiscardDraft()) return;
        field('import_file').click();
    });
    field('import_file').addEventListener('change', () => {
        const file = field('import_file').files[0];
        field('import_file').value = '';
        if (file) void runAction(() => handleImport(file));
    });
    field('export_item').addEventListener('click', () => { void runAction(exportItem); });
    field('export_all').addEventListener('click', () => { void runAction(exportAll); });
    field('mode').addEventListener('change', () => runAction(() => {
        ownerCommand('set-mode', { mode: field('mode').value });
    }));
    field('clear').addEventListener('click', () => runAction(() => {
        ownerCommand('clear-owner');
    }));
    field('cancel').addEventListener('click', () => {
        if (!mayDiscardDraft()) return;
        resetEditor();
        showSettings(false);
    });
    field('settings_toggle').addEventListener('click', () => {
        if (settingsOpen) {
            showSettings(false);
            return;
        }
        if (editorOpen) {
            if (!mayDiscardDraft()) return;
            resetEditor();
        }
        showSettings(true);
    });
    field('back').addEventListener('click', () => showSettings(false));
    field('editor_back').addEventListener('click', () => {
        if (!mayDiscardDraft()) return;
        resetEditor();
        showSettings(false);
    });
    field('add').addEventListener('click', () => {
        if (!mayDiscardDraft()) return;
        resetEditor();
        showEditor(false);
        field('name').focus();
    });
    field('close').addEventListener('click', () => { void wardrobeWindow.close().catch(error => status(error.message, true)); });
    field('form').addEventListener('input', () => { dirty = true; });
    field('form').addEventListener('change', () => { dirty = true; });
    field('form').addEventListener('submit', event => {
        event.preventDefault();
        void runAction(handleSave);
    });
    root.addEventListener('click', event => {
        const control = event.target.closest('button[data-action]');
        if (control) void runAction(() => handleItemAction(control.dataset.action, control.dataset.id));
    });
    root.addEventListener('click', event => {
        const card = event.target.closest('.vefari_card[data-action]');
        if (!card || event.target.closest('button')) return;
        void runAction(() => handleItemAction(card.dataset.action, card.dataset.id));
    });
    root.addEventListener('keydown', event => {
        const card = event.target.closest('.vefari_card[data-action]');
        if (!card || event.target !== card || !['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        void runAction(() => handleItemAction(card.dataset.action, card.dataset.id));
    });
    resetEditor();
    wardrobeWindow = mountWardrobeWindow({
        root, styleText, getContext,
        beforeOpen: () => { showSettings(false, false); refreshView(); },
        canClose: () => !busy && mayDiscardDraft(),
        afterClose: () => { resetEditor(); status(); },
        onError: error => { status(error.message, true); globalThis.toastr?.error(error.message, 'VEFARI'); },
    });
    controller.subscribe(refreshView);
    window.vefari = controller.api;
    controller.connect();
    console.info(`[VEFARI] Гардероб ${VERSION} загружен.`);
}

// SillyTavern already supplies jQuery; no additional runtime dependencies.
jQuery(() => {
    init().catch(error => {
        console.error('[VEFARI] Initialization failed:', error);
        globalThis.toastr?.error(error.message, 'VEFARI');
    });
});