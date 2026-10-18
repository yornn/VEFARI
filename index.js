/**
 * VEFARI — a standalone wardrobe for SillyTavern.
 * UI for the VEFARI command-based wardrobe controller.
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import { CATEGORIES, MAX_IMAGE_REFS, VERSION, categoriesForMode, validateItem } from './wardrobe.js';
import { chatProfiles, listCustomModels, requestDescription } from './describe.js';
import { createKeyStore } from './keystore.js';
import { createController } from './integration.js';
import { createId } from './ids.js';
import { retainedImages } from './storage.js';
import { deleteUnusedImage, imageUrl, loadReference, MAX_IMAGE_BYTES, prepareImage, uploadImage } from './images.js';
import { createZip, embedOutfitText, extractOutfitText, safeFilename } from './transfer.js';
import { createEmblem, createIcon, createRunes, fibulaOutline } from './icons.js';
import { createCard, createChip, createEmpty, createSendMark, createSlot, createTile } from './render.js';
import { mountWardrobeWindow } from './window.js';
import { formatReport } from './bridge.js';

const getContext = () => SillyTavern.getContext();
const controller = createController(getContext, { reportError: error => status(error.message, true) });
let root;
let editingId = null;
let pendingImport = null;
let target = 'user';
let filter = 'all';
let statusTimer = 0;
let busy = false;
let dirty = false;
let settingsOpen = false;
let editorOpen = false;
let wardrobeWindow;
let participantNames = { user: '{{user}}', bot: 'Персонаж' };
let describing = null;
let profileOptions = '';
const keys = createKeyStore();
const field = id => root.querySelector(`#vefari_${id}`);

// Notes fade on their own; errors stay until the next action.
const STATUS_TIMEOUT_MS = 6000;

function status(message = '', error = false) {
    clearTimeout(statusTimer);
    if (root) {
        field('status').textContent = message;
        field('status').dataset.error = String(error);
        if (message && !error) statusTimer = setTimeout(() => status(), STATUS_TIMEOUT_MS);
    }
    if (error) console.error('[VEFARI]', message);
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
    const { state: settings, participants: character, selection, collection, prompt, report } = controller.view(target);
    const active = selection.items;
    const context = getContext();
    participantNames = character
        ? { user: character.userName, bot: character.characterName }
        : {
            user: context.name1 || participantNames.user,
            bot: context.name2 || participantNames.bot,
        };
    for (const owner of ['user', 'bot']) {
        field(`tab_${owner}_name`).textContent = participantNames[owner];
        field(`tab_${owner}_name`).title = participantNames[owner];
    }
    field('enabled').checked = settings.enabled;
    field('image_limit').value = String(settings.maxImageRefs);
    field('bridge_report').textContent = formatReport(report);
    const sendMode = settings.sendModes[target];
    field(`send_${sendMode}`).checked = true;
    field('send_caption').textContent = sendMode === 'image' ? 'текст и картинки' : 'только текст';
    field('send_marks').replaceChildren(
        createSendMark('User', participantNames.user, settings.sendModes.user),
        createSendMark('Char', participantNames.bot, settings.sendModes.bot),
    );
    renderDescriber(settings.describer);
    field('context').hidden = Boolean(character);
    field(`mode_${selection.mode}`).checked = true;
    field('mode').disabled = !character;
    field('slots').hidden = !character;
    field('clear').hidden = !character;
    field('disabled_notice').hidden = settings.enabled;
    for (const tab of root.querySelectorAll('[role="tab"]')) {
        const selected = tab.dataset.target === target;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
    }
    for (const panel of ['owner_panel', 'collection_panel']) field(panel).setAttribute('aria-labelledby', `vefari_tab_${target}`);
    field('slots').replaceChildren(...categoriesForMode(selection.mode).map(category =>
        createSlot(category, active.find(item => item.category === category) ?? null, { active: filter === category })));

    const list = field('items');
    // The first two places in every collection are empty outfits: add a new one, or import a PNG.
    list.replaceChildren(
        createTile('add', 'plus', 'Новая вещь', 'Добавить вещь'),
        createTile('import', 'import', 'Импорт PNG', 'Импорт наряда из PNG со вшитым описанием'),
    );
    for (const chip of field('filter').children) chip.setAttribute('aria-pressed', String(chip.dataset.filter === filter));
    const shown = collection.filter(item => filter === 'all' || item.category === filter);
    for (const item of shown) list.append(createCard(item, { worn: active.some(entry => entry.id === item.id) }));
    if (!shown.length) list.append(createEmpty(filter !== 'all'));
    field('prompt').textContent = prompt || 'Инжект пуст: гардероб выключен, нет активных вещей или не выбран персонаж.';
}

function refreshView() {
    try { render(); }
    catch (error) { status(error.message, true); }
}

// Profiles are listed by name only; their keys stay inside SillyTavern.
function renderDescriber(describer) {
    const { available, profiles } = chatProfiles(getContext());
    const select = field('describer_source');
    const options = JSON.stringify(profiles.map(({ id, name }) => [id, name]));
    if (options !== profileOptions) {
        profileOptions = options;
        const group = document.createElement('optgroup');
        group.label = 'Профили подключения';
        group.append(...profiles.map(profile => new Option(profile.name, `profile:${profile.id}`)));
        const own = document.createElement('optgroup');
        own.label = 'Без профиля';
        own.append(new Option('Свой адрес и ключ', 'custom'));
        select.replaceChildren(new Option('Не выбрано', ''), ...(profiles.length ? [group] : []), own);
    }
    const profile = profiles.find(entry => entry.id === describer.profileId);
    select.value = describer.source === 'custom' ? 'custom' : profile ? `profile:${profile.id}` : '';
    let note = '';
    if (describer.source !== 'custom') {
        if (!available) note = 'Менеджер подключений SillyTavern выключен — доступен только свой адрес и ключ.';
        else if (describer.profileId && !profile) note = 'Сохранённый профиль не найден: выберите другой.';
        else if (!profiles.length) note = 'Профилей Chat Completion нет: создайте его в меню с розеткой SillyTavern.';
        else if (profile) note = `Модель профиля: ${profile.model || 'не указана'}.`;
    }
    field('describer_note').textContent = note;
    field('describer_note').hidden = !note;
    field('describer_custom').hidden = describer.source !== 'custom';
    // A re-render must not overwrite what the user is typing.
    for (const [id, value] of [['describer_url', describer.customUrl], ['describer_model', describer.customModel]]) {
        if (!field(id).matches(':focus')) field(id).value = value;
    }
    const saved = keys.state(describer.customUrl);
    field('describer_key_state').textContent = saved.status === 'saved'
        ? `Ключ сохранён в этом браузере для ${saved.origin}.`
        : saved.status === 'other'
            ? `Сохранённый ключ привязан к ${saved.origin} и сюда не уйдёт.`
            : 'Ключ не сохранён: запрос уйдёт без него, как для локальной модели.';
    field('describer_forget').hidden = saved.status === 'none';
}

// Text settings save on change without the busy lock, which would steal focus from the next field.
function applySetting(change) {
    try { change(); }
    catch (error) { status(error.message, true); }
    refreshView();
}

function setDescriber(patch) {
    controller.dispatch({ type: 'set-describer', describer: patch });
}

function changeEndpoint(value) {
    const before = keys.state(controller.view().state.describer.customUrl);
    setDescriber({ customUrl: value });
    // A key belongs to one host: moving to another drops it instead of keeping it around.
    if (before.status !== 'none' && keys.state(controller.view().state.describer.customUrl).status !== 'saved') {
        keys.clear();
        status('Адрес сменился: ключ от прежнего адреса удалён из браузера. Введите ключ для нового.');
    }
}

async function checkEndpoint() {
    const { describer } = controller.view().state;
    status('Проверяю адрес API…');
    const models = await listCustomModels(getContext(), describer, keys.read(describer.customUrl));
    field('describer_models').replaceChildren(...models.map(id => new Option(id, id)));
    status(models.length
        ? `Адрес отвечает, моделей: ${models.length}. Выберите модель в поле «Модель».`
        : 'Адрес отвечает, но список моделей пуст: впишите модель вручную.');
}

function savedImagePath() {
    return editingId ? controller.view().state.items.find(entry => entry.id === editingId)?.imagePath || '' : '';
}

/** The picture the editor shows right now: a new file, an imported PNG, or the saved one. */
async function editorImage() {
    const file = field('image').files[0] || pendingImport;
    if (file) return { mimeType: 'image/png', base64: await prepareImage(file) };
    return loadReference(savedImagePath());
}

function setDescribing(active) {
    const label = active ? 'Остановить описание' : 'Описать по картинке';
    field('describe').dataset.busy = String(active);
    field('describe').title = label;
    field('describe').setAttribute('aria-label', label);
    field('description').readOnly = active;
    field('description').setAttribute('aria-busy', String(active));
}

function cancelDescribing(reason) {
    if (!describing) return;
    describing.abort(reason);
    describing = null;
    setDescribing(false);
}

/** Runs beside the busy lock: the editor stays usable and the feather itself is the stop button. */
async function describeOutfit() {
    if (describing) {
        cancelDescribing('user');
        status('Описание отменено.');
        return;
    }
    if (busy) return;
    const hasImage = !field('remove_image').checked && Boolean(field('image').files.length || pendingImport || savedImagePath());
    if (!hasImage) {
        status('Сначала добавьте картинку: перо описывает то, что на ней.', true);
        return;
    }
    if (field('description').value.trim() && !window.confirm('Заменить текущее описание новым?')) return;
    const category = field('category').value;
    const { describer } = controller.view().state;
    const abort = new AbortController();
    describing = abort;
    setDescribing(true);
    status(`Перо смотрит на картинку: ${CATEGORIES[category]}…`);
    try {
        const image = await editorImage();
        if (abort.signal.aborted) return;
        const description = await requestDescription(getContext(), describer, {
            category,
            image,
            key: describer.source === 'custom' ? keys.read(describer.customUrl) : '',
            signal: abort.signal,
        });
        // A closed, saved or reset editor gets nothing written into it.
        if (abort.signal.aborted) return;
        if (description === null) {
            status(`На картинке не нашлось ничего для категории «${CATEGORIES[category]}». Проверьте категорию или картинку.`, true);
            return;
        }
        field('description').value = description;
        dirty = true;
        status('Описание готово: проверьте его и сохраните вещь.');
    } catch (error) {
        if (!abort.signal.aborted) status(error.message || String(error), true);
    } finally {
        if (describing === abort) {
            describing = null;
            setDescribing(false);
        }
    }
}

function showSettings(show, focus = true) {
    settingsOpen = show;
    editorOpen = false;
    field('settings_panel').hidden = !show;
    field('editor_panel').hidden = true;
    field('collection_panel').hidden = show;
    field('settings_toggle').setAttribute('aria-expanded', String(show));
    field('controls').dataset.view = show ? 'settings' : 'collection';
    field('armory').inert = false;
    if (focus) field(show ? 'settings_title' : `tab_${target}`).focus({ preventScroll: true });
}

function showEditor(focus = true) {
    settingsOpen = false;
    editorOpen = true;
    field('settings_panel').hidden = true;
    field('editor_panel').hidden = false;
    field('collection_panel').hidden = true;
    field('settings_toggle').setAttribute('aria-expanded', 'false');
    field('controls').dataset.view = 'editor';
    // Owner switches stay visible for context but cannot pull the draft out from under the editor.
    field('armory').inert = true;
    if (focus) field('editor_title').focus({ preventScroll: true });
}

// A filtered collection is a hint about what the new item is.
function openNewEditor() {
    if (!mayDiscardDraft()) return;
    resetEditor();
    if (filter !== 'all') field('category').value = filter;
    showEditor(false);
    field('name').focus();
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
    cancelDescribing('reset');
    editingId = null;
    pendingImport = null;
    field('form').reset();
    field('editor_title').textContent = 'Новая вещь';
    field('editor_image').replaceChildren();
    field('dropzone').dataset.removing = 'false';
    field('image_actions').hidden = true;
    field('export_item').hidden = true;
    field(`audience_${target}`).checked = true;
    dirty = false;
}

function showPicked(file) {
    const preview = document.createElement('img');
    const url = URL.createObjectURL(file);
    preview.src = url;
    preview.alt = '';
    preview.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
    preview.addEventListener('error', () => URL.revokeObjectURL(url), { once: true });
    field('editor_image').replaceChildren(preview);
}

function editItem(item) {
    resetEditor();
    editingId = item.id;
    field('editor_title').textContent = 'Изменить вещь';
    field('name').value = item.name;
    field('description').value = item.description;
    field('category').value = item.category;
    field(`audience_${item.audiences.length === 2 ? 'both' : item.audiences[0]}`).checked = true;
    field('image_actions').hidden = !item.imagePath;
    field('export_item').hidden = !item.imagePath;
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
    drawing.fillStyle = '#0f1214';
    drawing.fillRect(0, 0, 640, 640);
    drawing.strokeStyle = '#3d474e';
    drawing.lineWidth = 2;
    drawing.strokeRect(24, 24, 592, 592);
    drawing.strokeStyle = '#2c343a';
    drawing.lineWidth = 1;
    drawing.strokeRect(30.5, 30.5, 579, 579);
    drawing.strokeStyle = '#6f8796';
    drawing.lineWidth = 2;
    for (const [x, y, dx, dy] of [[38, 38, 1, 1], [602, 38, -1, 1], [38, 602, 1, -1], [602, 602, -1, -1]]) {
        drawing.beginPath();
        drawing.moveTo(x, y + dy * 28);
        drawing.lineTo(x, y);
        drawing.lineTo(x + dx * 28, y);
        drawing.stroke();
    }
    const fibula = fibulaOutline('large');
    drawing.save();
    drawing.translate(320, 230);
    drawing.rotate(40 * Math.PI / 180);
    drawing.scale(5, 5);
    drawing.translate(-32, -32);
    drawing.fillStyle = '#c3ced5';
    drawing.fill(new Path2D(fibula.ring));
    drawing.fillStyle = '#9fc3d6';
    drawing.fill(new Path2D(fibula.pin));
    drawing.strokeStyle = '#c3ced5';
    drawing.lineWidth = fibula.eyeWidth;
    drawing.stroke(new Path2D(fibula.eye));
    drawing.restore();
    drawing.textAlign = 'center';
    drawing.fillStyle = '#e4e9ec';
    drawing.font = "38px Forum, Georgia, serif";
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
    const shown = lines.slice(0, 3);
    if (lines.length > shown.length) shown[2] = `${shown[2]}…`;
    shown.forEach((text, index) => drawing.fillText(text, 320, 430 + index * 46, 540));
    drawing.fillStyle = '#6f8796';
    drawing.font = "18px 'Alegreya Sans SC', 'Segoe UI', sans-serif";
    if ('letterSpacing' in drawing) drawing.letterSpacing = '6px';
    drawing.fillText('VEFARI', 320, 588);
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
    field('export_item').hidden = false;
    showPicked(file);
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
    const audience = root.querySelector('input[name="vefari_audience"]:checked').value;
    const data = {
        id: itemId || createId(),
        name: field('name').value.trim(),
        description: field('description').value.trim(),
        category: field('category').value,
        audiences: audience === 'both' ? ['bot', 'user'] : [audience],
        imagePath: field('remove_image').checked ? '' : previous?.imagePath || '',
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
    root.querySelector('[data-emblem]').append(createEmblem('small'));
    root.querySelector('[data-runes]').append(createRunes());
    field('filter').append(createChip('all', 'Все', { pressed: true }));
    for (const [key, label] of Object.entries(CATEGORIES)) {
        field('filter').append(createChip(key, label, { pressed: false }));
        field('category').add(new Option(label, key));
    }
    field('enabled').addEventListener('change', () => runAction(() => {
        controller.dispatch({ type: 'set-enabled', enabled: field('enabled').checked });
    }));
    // Saved at once without the busy lock, so focus stays on the switch for the keyboard.
    field('send').addEventListener('change', event => applySetting(() => {
        controller.dispatch({ type: 'set-send-mode', target, mode: event.target.value });
    }));
    // A rejected limit leaves the saved value; re-render so the field shows it again.
    field('image_limit').addEventListener('change', () => runAction(() => {
        controller.dispatch({ type: 'set-image-limit', limit: Number(field('image_limit').value) });
    }).finally(refreshView));
    for (const [id, step] of [['limit_down', -1], ['limit_up', 1]]) {
        field(id).addEventListener('click', () => {
            const current = controller.view().state.maxImageRefs;
            const limit = Math.min(MAX_IMAGE_REFS, Math.max(1, current + step));
            if (limit === current) return;
            // The busy lock blurs the button; give focus back so the stepper can be pressed again.
            void runAction(() => controller.dispatch({ type: 'set-image-limit', limit })).finally(() => {
                refreshView();
                if (settingsOpen) field(id).focus({ preventScroll: true });
            });
        });
    }
    for (const tab of root.querySelectorAll('[role="tab"]')) {
        tab.addEventListener('click', () => switchTarget(tab.dataset.target));
        tab.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            switchTarget(event.key === 'Home' ? 'user' : event.key === 'End' ? 'bot' : target === 'user' ? 'bot' : 'user');
        });
    }
    root.addEventListener('click', event => {
        const choice = event.target.closest('[data-filter]');
        if (!choice) return;
        filter = choice.dataset.filter;
        refreshView();
    });
    field('image').addEventListener('change', () => {
        const file = field('image').files[0];
        if (!file) return;
        // A new picture supersedes a pending removal of the saved one.
        field('remove_image').checked = false;
        field('dropzone').dataset.removing = 'false';
        showPicked(file);
        if (!field('name').value.trim()) field('name').value = file.name.replace(/\.[^.]+$/, '');
    });
    field('replace_image').addEventListener('click', () => field('image').click());
    field('remove_image').addEventListener('change', () => {
        field('dropzone').dataset.removing = String(field('remove_image').checked);
    });
    field('import_file').addEventListener('change', () => {
        const file = field('import_file').files[0];
        field('import_file').value = '';
        if (file) void runAction(() => handleImport(file));
    });
    field('describe').addEventListener('click', () => { void describeOutfit(); });
    field('describer_source').addEventListener('change', event => {
        const { value } = event.target;
        applySetting(() => setDescriber(value === 'custom'
            ? { source: 'custom' }
            : { source: 'profile', profileId: value.startsWith('profile:') ? value.slice('profile:'.length) : '' }));
    });
    field('describer_url').addEventListener('change', event => applySetting(() => changeEndpoint(event.target.value)));
    field('describer_model').addEventListener('change', event => applySetting(() => setDescriber({ customModel: event.target.value })));
    for (const id of ['describer_url', 'describer_key', 'describer_model']) {
        field(id).addEventListener('keydown', event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            event.target.blur();
        });
    }
    field('describer_key').addEventListener('change', event => {
        const { value } = event.target;
        // The field never keeps the key: it is saved or discarded right away.
        event.target.value = '';
        if (!value.trim()) return;
        applySetting(() => {
            keys.write(controller.view().state.describer.customUrl, value);
            status('Ключ сохранён только в этом браузере.');
        });
    });
    field('describer_forget').addEventListener('click', () => {
        keys.clear();
        refreshView();
        status('Ключ удалён из этого браузера.');
    });
    field('describer_check').addEventListener('click', () => { void runAction(checkEndpoint); });
    field('export_item').addEventListener('click', () => { void runAction(exportItem); });
    field('export_all').addEventListener('click', () => { void runAction(exportAll); });
    field('mode').addEventListener('change', event => runAction(() => {
        ownerCommand('set-mode', { mode: event.target.value });
    }));
    field('enable').addEventListener('click', () => runAction(() => {
        controller.dispatch({ type: 'set-enabled', enabled: true });
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
    field('close').addEventListener('click', () => { void wardrobeWindow.close().catch(error => status(error.message, true)); });
    field('form').addEventListener('input', () => { dirty = true; });
    field('form').addEventListener('change', () => { dirty = true; });
    field('form').addEventListener('submit', event => {
        event.preventDefault();
        void runAction(handleSave);
    });
    root.addEventListener('click', event => {
        const control = event.target.closest('button[data-action]');
        if (!control) return;
        // Opening the editor or a file picker must not run under the busy lock, which swallows focus.
        if (control.dataset.action === 'add') openNewEditor();
        else if (control.dataset.action === 'import') {
            if (mayDiscardDraft()) field('import_file').click();
        } else void runAction(() => handleItemAction(control.dataset.action, control.dataset.id));
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