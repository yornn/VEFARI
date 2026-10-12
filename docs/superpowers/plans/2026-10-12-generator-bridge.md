# Generator Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** VEFARI добавляет картинки и описания надетых вещей в запрос notsosillynotsoimages к Gemini-compatible API в момент генерации картинки.

**Architecture:** Чистая логика (`bridge.js`) опознаёт запрос генератора, планирует, что слать, и строит новое тело. Адаптер `generator.js` только читает настройки генератора. `interceptor.js` оборачивает `fetch`/`XMLHttpRequest` и вызывает асинхронный `transform`. Контроллер в `integration.js` связывает всё это и хранит отчёт о последней отправке для UI.

**Tech Stack:** Vanilla ES modules, SillyTavern extension API, `node --test` (Node 22+), без npm-зависимостей.

**Spec:** `docs/superpowers/specs/2026-10-12-generator-bridge-design.md`

## Global Constraints

- Без новых зависимостей; браузерного кода в `bridge.js` и `generator.js` нет.
- Ключ настроек генератора: `inline_image_gen`; поддерживается только `apiType === 'gemini'`.
- Чужие настройки и `chatMetadata` только читаются, никогда не записываются.
- Ошибка моста никогда не роняет генерацию: при любой ошибке уходит исходный запрос.
- Схема данных VEFARI остаётся `3`; новые поля: `generatorImages: true`, `maxImageRefs: 4` (целое 1–10).
- Подпись картинки (точно): `Outfit reference for <Имя> — <CATEGORY>: <название>. Dress <Имя> in exactly this item; it overrides clothing visible in any face or character reference.`
- Заголовок текстового блока (точно): `[Outfits: follow exactly, they override clothing from any other reference]`
- Стиль кода: как в репозитории — 4 пробела, `// SPDX-License-Identifier: AGPL-3.0-or-later` в шапке, русские сообщения ошибок, английские промпты.
- Коммиты оканчиваются строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Обычный трафик SillyTavern (POST чата с большим JSON, не-JSON тело) через обёрнутый `fetch` — уходит теми же аргументами, тело не парсится. Тесты: Task 4 (`other URL is rejected before parsing`), Task 5 (`foreign requests pass through untouched`).
2. Файл картинки вещи удалён с сервера — генерация идёт, вещь уходит текстом, отчёт это показывает. Тест: Task 6 (`missing image falls back to text`).
3. Гардероб выключен или открыт групповой чат — тело генератора не меняется. Тест: Task 6 (`disabled wardrobe leaves request untouched`).
4. В настройках генератора endpoint со слешем на конце или вставлен полный URL `/v1beta/models/...:generateContent` — мост всё равно узнаёт запрос. Тест: Task 3 (`endpoint is normalized like the generator does`).
5. Тело Gemini без текстовой части или без `contents` — не трогаем. Тест: Task 4 (`malformed gemini bodies are ignored`).

---

### Task 1: Настройки моста в состоянии

**Files:**
- Modify: `wardrobe.js` (`createState`, `reduceWardrobe`)
- Modify: `storage.js` (`decodeSettings`)
- Test: `tests/wardrobe.test.js`, `tests/storage.test.js`

**Interfaces:**
- Produces: `state.generatorImages: boolean`, `state.maxImageRefs: number`; команды `{ type: 'set-generator-images', enabled: boolean }` и `{ type: 'set-image-limit', limit: number }`; экспорт `MAX_IMAGE_REFS = 10` из `wardrobe.js`.

- [ ] **Step 1: Обновить существующий тест формы `createState` и добавить новые**

В `tests/wardrobe.test.js` строку 11 заменить на
`assert.deepEqual(state, { schemaVersion: 3, enabled: true, items: [], assignments: [], generatorImages: true, maxImageRefs: 4 });`
и добавить:

```js
test('generator settings commands validate and never mutate', () => {
    const state = freezeDeep(createState());
    assert.equal(reduceWardrobe(state, { type: 'set-generator-images', enabled: false }).generatorImages, false);
    assert.equal(reduceWardrobe(state, { type: 'set-image-limit', limit: 7 }).maxImageRefs, 7);
    for (const limit of [0, 11, 2.5, '3', null]) {
        assert.throws(() => reduceWardrobe(state, { type: 'set-image-limit', limit }), /от 1 до 10/);
    }
    assert.throws(() => reduceWardrobe(state, { type: 'set-generator-images', enabled: 'yes' }));
});
```

В `tests/storage.test.js`:

```js
test('generator settings default when absent and are validated when present', () => {
    const legacy = JSON.parse(JSON.stringify(wear(inventory(garment('coat')), 'coat')));
    delete legacy.generatorImages;
    delete legacy.maxImageRefs;
    const state = decodeSettings(legacy);
    assert.equal(state.generatorImages, true);
    assert.equal(state.maxImageRefs, 4);
    assert.equal(decodeSettings({ ...legacy, generatorImages: false, maxImageRefs: 9 }).maxImageRefs, 9);
    assert.throws(() => decodeSettings({ ...legacy, maxImageRefs: 50 }));
    assert.throws(() => decodeSettings({ ...legacy, generatorImages: 'no' }));
});
```

- [ ] **Step 2: Запустить — падают**

Run: `npm test`
Expected: FAIL в двух новых тестах и в обновлённом `deepEqual`.

- [ ] **Step 3: Реализовать**

`wardrobe.js`: `createState()` добавляет `generatorImages: true, maxImageRefs: 4`; экспортировать `MAX_IMAGE_REFS = 10` и `validateImageLimit(limit)` (целое `Number.isInteger`, 1–`MAX_IMAGE_REFS`, иначе `Error('Лимит картинок нарядов — целое число от 1 до 10.')`); в `reduceWardrobe` два `case` по образцу `set-enabled` (ошибка типа: `'Укажите, отправлять ли картинки нарядов.'`).
`storage.js`: `decodeSettings` возвращает `generatorImages: raw.generatorImages ?? true` с проверкой `typeof === 'boolean'` и `maxImageRefs: raw.maxImageRefs ?? 4` через `validateImageLimit`.

- [ ] **Step 4: Запустить — проходят**

Run: `npm test`
Expected: PASS, все тесты (60 + 2).

- [ ] **Step 5: Commit**

```bash
git add wardrobe.js storage.js tests/wardrobe.test.js tests/storage.test.js
git commit -m "feat: generator bridge settings in wardrobe state"
```

---

### Task 2: Общий форматтер блока `[OUTFIT: …]`

**Files:**
- Modify: `prompt.js`
- Test: `tests/prompt.test.js`

**Interfaces:**
- Produces: `outfitBlock(name: string, items: Item[]): string` из `prompt.js` — `''`, если у вещей нет непустых описаний; иначе ровно та строка, которую сейчас строит `composePrompt` для одного участника.

- [ ] **Step 1: Написать тест**

```js
test('outfitBlock formats one participant exactly like the chat injection', () => {
    const items = [{ ...garment('jacket', 'top'), description: 'Black [leather] jacket' }, { ...garment('jeans', 'bottom'), description: 'Blue jeans.' }];
    assert.equal(outfitBlock('Маша', items), '[OUTFIT: Маша is currently wearing: TOP: Black (leather) jacket. BOTTOM: Blue jeans.]');
    assert.equal(outfitBlock('Маша', []), '');
});
```

(импорт `outfitBlock` добавить в строку 3).

- [ ] **Step 2: Запустить — падает**

Run: `node --test tests/prompt.test.js`
Expected: FAIL — `outfitBlock` не экспортирован.

- [ ] **Step 3: Вынести тело цикла `composePrompt` в `export function outfitBlock(name, items)`; `composePrompt` вызывает его для каждой стороны и пропускает пустые строки.**

- [ ] **Step 4: Запустить — проходят все тесты промпта**

Run: `node --test tests/prompt.test.js`
Expected: PASS (существующие тесты `composePrompt` не изменились).

- [ ] **Step 5: Commit**

```bash
git add prompt.js tests/prompt.test.js
git commit -m "refactor: share outfit block formatter"
```

---

### Task 3: Адаптер настроек генератора

**Files:**
- Create: `generator.js`
- Test: `tests/generator.test.js`

**Interfaces:**
- Produces: `readGenerator(context): Generator | null`, где
  `Generator = { apiType: string, endpoint: string, sendRefs: boolean, always: { bot: boolean, user: boolean }, names: { bot: string, user: string } }`.
  Возвращает `null`, если `context.extensionSettings.inline_image_gen` нет. Бросает `Error('Настройки notsosillynotsoimages не распознаны: мост картинок отключён.')`, если объект есть, но `apiType` не строка.

- [ ] **Step 1: Написать тесты**

```js
const base = () => ({
    extensionSettings: { inline_image_gen: { apiType: 'gemini', endpoint: 'https://img.example/proxy', geminiSendRefs: true, charRefAlways: false, userRefAlways: true, refScope: 'global', charRef: { name: 'Маша, Masha' }, userRef: { name: '' } } },
    characters: [{ name: 'Alice', avatar: 'alice.png' }], characterId: 0, name1: 'Player', chatId: 'chat-1', chatMetadata: {},
});

test('absent generator yields null', () => {
    assert.equal(readGenerator({ extensionSettings: {} }), null);
});

test('reads gating fields with slot names and fallbacks', () => {
    assert.deepEqual(readGenerator(base()), {
        apiType: 'gemini', endpoint: 'https://img.example/proxy', sendRefs: true,
        always: { bot: false, user: true }, names: { bot: 'Маша, Masha', user: 'Player' },
    });
});

test('endpoint is normalized like the generator does', () => {
    for (const endpoint of ['https://img.example/proxy/', ' https://img.example/proxy//', 'https://img.example/proxy/v1beta/models/gemini-3-pro-image:generateContent']) {
        const context = base();
        context.extensionSettings.inline_image_gen.endpoint = endpoint;
        assert.equal(readGenerator(context).endpoint, 'https://img.example/proxy');
    }
});

test('per-chat slots win only when per-chat mode has a container', () => {
    const context = base();
    context.extensionSettings.inline_image_gen.refScope = 'per-chat';
    assert.equal(readGenerator(context).names.bot, 'Маша, Masha');
    context.chatMetadata.iig_refs = { charRef: { name: 'Чат-Маша' }, userRef: { name: 'Чат-Петя' } };
    assert.deepEqual(readGenerator(context).names, { bot: 'Чат-Маша', user: 'Чат-Петя' });
});

test('sendRefs follows geminiSendRefs and malformed settings throw', () => {
    const context = base();
    context.extensionSettings.inline_image_gen.geminiSendRefs = false;
    assert.equal(readGenerator(context).sendRefs, false);
    context.extensionSettings.inline_image_gen = { endpoint: 'x' };
    assert.throws(() => readGenerator(context), /не распознаны/);
});

test('generator settings are never written', () => {
    const context = freezeDeep(base());
    assert.doesNotThrow(() => readGenerator(context));
});
```

- [ ] **Step 2: Запустить — падают**

Run: `node --test tests/generator.test.js`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать `generator.js`**

Нормализация endpoint: `trim()`, убрать хвостовые `/`, затем `.replace(/\/v1beta\/models(\/[^?]*)?$/i, '')`. Per-chat: `refScope === 'per-chat'`, `context.chatId ?? context.getCurrentChatId?.()` не пустой и `context.chatMetadata?.iig_refs` — объект. Запасные имена: bot — имя карточки `context.characters?.[context.characterId]?.name || context.name2 || ''`, user — `context.name1 || ''`; имя слота берётся после `trim()`.

- [ ] **Step 4: Запустить — проходят**

Run: `node --test tests/generator.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add generator.js tests/generator.test.js
git commit -m "feat: read notsosillynotsoimages settings for the bridge"
```

---

### Task 4: Логика моста

**Files:**
- Create: `bridge.js`
- Test: `tests/bridge.test.js`

**Interfaces:**
- Consumes: `Generator` (Task 3); `outfitBlock` (Task 2); снимок `wardrobeSnapshot` из `prompt.js` (`{ characterName, userName, enabled, bot: { items }, user: { items } }`).
- Produces:
  - `nameMatches(nameField: string, text: string): boolean`
  - `parseGeneratorRequest({ method, url, body }, generator): { body: object, promptText: string } | null`
  - `planOutfits({ snapshot, promptText, generator, settings }): Plan`, где `settings = { generatorImages, maxImageRefs }`, `Plan = { sides: Array<{ target: 'bot' | 'user', name: string, items: Item[], imageItems: Item[] }> }` (только прошедшие стороны с хотя бы одной вещью; `items` — все надетые, `imageItems` — подмножество для картинок).
  - `augmentGeminiBody(body, plan, images: Map<string, { mimeType, base64 }>): object` — новый объект; вещь из `imageItems` без записи в `images` идёт только текстом.
  - `formatReport(report: { sides: Array<{ name, images: string[], text: string[] }> } | null): string`

- [ ] **Step 1: Написать тесты**

Фикстуры в начале файла:

```js
const generator = { apiType: 'gemini', endpoint: 'https://img.example/proxy', sendRefs: true, always: { bot: false, user: false }, names: { bot: 'Маша, Masha', user: 'Петя' } };
const url = 'https://img.example/proxy/v1beta/models/gemini-3-pro-image:generateContent';
const body = (text = 'Маша идёт по улице') => ({ contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: 'FACE' } }, { text }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } });
const request = (overrides = {}) => ({ method: 'POST', url, body: JSON.stringify(body()), ...overrides });
const item = (id, category, extra = {}) => ({ id, category, name: id, description: `${id} desc`, imagePath: `/user/images/vefari_refs/${id}.png`, audiences: ['bot', 'user'], sendImage: true, ...extra });
const snapshot = (bot = [], user = []) => ({ characterName: 'Маша', userName: 'Петя', enabled: true, bot: { items: bot }, user: { items: user } });
const settings = { generatorImages: true, maxImageRefs: 4 };
```

Тесты (имена и проверки):

- `nameMatches follows the generator rule`: `nameMatches('Маша, Masha', 'masha smiles')` → true; `nameMatches('Ace', 'open space')` → false; `nameMatches('Ace', 'Ace!')` → true; `nameMatches('Mary  Jane', 'mary jane waves')` → true; `nameMatches('Dr. (X)', 'Dr. (X) sits')` → true без исключения; `nameMatches('', 'x')` → false.
- `recognizes only generator image requests`: `parseGeneratorRequest(request(), generator).promptText === 'Маша идёт по улице'`; `null` для `method: 'GET'`, для `{ ...generator, apiType: 'openai' }`, для `generator === null`, для тела без `IMAGE` в `responseModalities`, для URL `https://img.example/other/...`.
- `other URL is rejected before parsing`: `parseGeneratorRequest({ method: 'POST', url: '/api/backends/chat-completions/generate', body: 'not json' }, generator)` → `null` без исключения.
- `malformed gemini bodies are ignored`: `null` для `body: '{}'`, для `parts` без текстовой части, для невалидного JSON на URL генератора.
- `plan gates sides like the generator face refs`: при промпте `'Маша идёт'` и надетом у обоих → `plan.sides.map(s => s.target)` равно `['bot']`; при `always.user = true` → `['bot', 'user']`; при промпте `'пейзаж'` → `[]`.
- `image items respect global switch, item mode, generator refs and missing files`: `generatorImages: false` → `imageItems` пуст, `items` полон; `sendImage: false` и `imagePath: ''` — вещь только в `items`; `generator.sendRefs = false` → `imageItems` пуст.
- `limit is shared with bot first`: bot 3 вещи, user 2, `always.user = true`, `maxImageRefs: 4` → у bot 3 картинки, у user 1, вторая вещь user только текстом.
- `augment inserts labelled images before the prompt and keeps the source intact`: для bot `[item('jacket','top'), item('jeans','bottom', { sendImage: false })]` и `images = new Map([['jacket', { mimeType: 'image/png', base64: 'JACKET' }]])` итоговые `parts` равны:

```js
[
    { inlineData: { mimeType: 'image/png', data: 'FACE' } },
    { text: 'Outfit reference for Маша — TOP: jacket. Dress Маша in exactly this item; it overrides clothing visible in any face or character reference.' },
    { inlineData: { mimeType: 'image/png', data: 'JACKET' } },
    { text: '[Outfits: follow exactly, they override clothing from any other reference]\n[OUTFIT: Маша is currently wearing: TOP: jacket desc. BOTTOM: jeans desc.]\n\nМаша идёт по улице' },
]
```
  исходный объект тела (заморожен `freezeDeep`) не изменился; `generationConfig` сохранён.
- `unloaded image falls back to text`: `imageItems` содержит `jacket`, а `images` пустой → нет `inlineData` кроме `FACE`, описание `jacket` есть в тексте.
- `empty plan returns body unchanged`: `augmentGeminiBody(b, { sides: [] }, new Map())` `deepEqual` `b`.
- `formatReport speaks Russian plurals`: `null` → `'ещё не было'`; `{ sides: [{ name: 'Маша', images: ['top', 'bottom'], text: ['shoes'] }, { name: 'Петя', images: ['full'], text: [] }] }` → `'Маша — 2 картинки, 1 текстом; Петя — 1 картинка'`; 5 картинок → `'5 картинок'`; только текст → `'Петя — 2 текстом'`.

- [ ] **Step 2: Запустить — падают**

Run: `node --test tests/bridge.test.js`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать `bridge.js`**

`nameMatches` — копия правила генератора:

```js
const aliases = String(nameField || '').split(',').map(alias => alias.trim()).filter(Boolean);
// for each alias: words = alias.split(/\s+/).map(escapeRegExp);
// new RegExp(`(?<![\\w])${words.join('\\s+')}(?![\\w])`, 'i').test(text)
```

`parseGeneratorRequest`: сначала дешёвые проверки (`generator?.apiType === 'gemini'`, `endpoint` не пуст, `method` в верхнем регистре `POST`, `url.startsWith(endpoint + '/')`, `typeof body === 'string'`), только потом `JSON.parse` в `try`. `promptText` — текст последней части с `typeof part.text === 'string'` в `contents[0].parts`.
`augmentGeminiBody`: `structuredClone(body)`; вставка перед индексом последней текстовой части; категория в подписи — `item.category.toUpperCase()`; блоки через `outfitBlock(side.name, side.items)`.
`formatReport`: формы `картинка/картинки/картинок` по правилу `n % 10 === 1 && n % 100 !== 11` / `n % 10` в 2–4 и `n % 100` не в 12–14 / иначе.

- [ ] **Step 4: Запустить — проходят**

Run: `node --test tests/bridge.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add bridge.js tests/bridge.test.js
git commit -m "feat: plan and build outfit references for generator requests"
```

---

### Task 5: Перехватчик `fetch` и `XMLHttpRequest`

**Files:**
- Create: `interceptor.js`
- Test: `tests/interceptor.test.js`

**Interfaces:**
- Produces: `installInterceptor(scope, transform, onError = console.error): () => void`.
  `scope` — объект с `fetch` и (необязательно) `XMLHttpRequest`. `transform({ method, url, body }) → Promise<string | null>`. Возвращает функцию снятия.

- [ ] **Step 1: Написать тесты**

Фейки: `scope = { fetch: (...args) => { calls.push(args); return Promise.resolve('ok'); }, XMLHttpRequest: FakeXhr }`, где у `FakeXhr.prototype` `open(method, url)` записывает поля, а `send(body)` пишет `this.sent = body`.

- `foreign requests pass through untouched`: `transform` возвращает `null`; `scope.fetch('/api/chat', init)` вызывает исходный `fetch` с **тем же** `init` (`assert.equal(calls[0][1], init)`); `scope.fetch(new Request(...))`-подобный объект (не строка и не `URL`) и вызов без `init` вообще не попадают в `transform`.
- `matching request is sent with the new body`: `transform` возвращает `'NEW'`; исходный `fetch` получает `init.body === 'NEW'`, остальные поля `init` сохранены.
- `transform failure sends the original request`: `transform` бросает; исходный `fetch` получает исходный `init`, `onError` вызван один раз.
- `xhr send waits for transform`: `xhr.open('POST', url); xhr.send('OLD')` → после `await` микротасков `xhr.sent === 'NEW'`; GET-запрос отправляется синхронно с исходным телом.
- `uninstall restores originals and disables wrappers`: после снятия `scope.fetch` — исходная функция, `FakeXhr.prototype.send` — исходный; если поверх нашей обёртки кто-то поставил свою, снятие её не трогает, а наша обёртка дальше работает как прямой проброс (`transform` не вызывается).

- [ ] **Step 2: Запустить — падают**

Run: `node --test tests/interceptor.test.js`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать `interceptor.js`**

Кандидат для `fetch`: `(typeof input === 'string' || input instanceof URL) && typeof init?.body === 'string'`; иначе `return original.call(scope, input, init)` синхронно. Метод — `(init.method || 'GET').toUpperCase()`. XHR: метаданные в `WeakMap` по экземпляру из `open`; `send` для строкового тела ждёт `transform`, затем исходный `send` в `try/catch` (ошибка → `onError`). Флаг `active` проверяется в каждой обёртке.

- [ ] **Step 4: Запустить — проходят**

Run: `node --test tests/interceptor.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add interceptor.js tests/interceptor.test.js
git commit -m "feat: fetch and XHR interceptor for generator requests"
```

---

### Task 6: Подключение моста в контроллере

**Files:**
- Modify: `integration.js`
- Test: `tests/integration.test.js`

**Interfaces:**
- Consumes: `readGenerator` (Task 3), `parseGeneratorRequest`, `planOutfits`, `augmentGeminiBody` (Task 4), `installInterceptor` (Task 5).
- Produces: опции `createController(getContext, { readImage, reportError, scope = globalThis, readGenerator })`; `view()` дополнительно возвращает `report` (последний отчёт или `null`); `controller.transformRequest(request): Promise<string | null>` (экспортируется ради тестов). `connect()` ставит перехватчик на `scope`, `dispose()` снимает.

- [ ] **Step 1: Написать тесты**

Расширить `host(options)` в `tests/integration.test.js`: в `context.extensionSettings` добавить `inline_image_gen: { apiType: 'gemini', endpoint: 'https://img.example', geminiSendRefs: true, charRefAlways: false, userRefAlways: false, charRef: { name: '' }, userRef: { name: '' } }`; в `createController` передать `scope` (фейк из Task 5) и `readImage: async path => ({ mimeType: 'image/png', base64: path.endsWith('coat.png') ? 'COAT' : missing() })`. Вещь `coat` с `imagePath: '/user/images/vefari_refs/coat.png'` надета на Alice. Запрос: `POST https://img.example/v1beta/models/m:generateContent` с телом из Task 4, текст `'Alice in the rain'`.

- `bridge adds outfit images to generator requests and records a report`: после `connect()` вызов `scope.fetch(url, { method: 'POST', body })` → в отправленном теле есть `{ inlineData: { mimeType: 'image/png', data: 'COAT' } }`; `controller.view().report` равен `{ sides: [{ name: 'Alice', images: ['full'], text: [] }] }`; подписчик вызван.
- `disabled wardrobe leaves request untouched`: после `set-enabled false` тело уходит байт в байт исходным, `report` не меняется.
- `missing image falls back to text`: `readImage` бросает → в теле нет `COAT`, есть `coat description` в тексте, `report.sides[0].text` равен `['full']`.
- `non-generator requests and absent generator are untouched`: `POST /api/backends/chat-completions/generate` и контекст без `inline_image_gen` → исходный `init`.
- `malformed generator settings warn once`: `inline_image_gen = { endpoint: 'x' }`, два запроса → `reportError` вызван один раз, оба запроса ушли исходными.
- `dispose removes the interceptor`: после `dispose()` `scope.fetch` снова исходная функция.

- [ ] **Step 2: Запустить — падают**

Run: `node --test tests/integration.test.js`
Expected: FAIL в новых тестах; старые проходят.

- [ ] **Step 3: Реализовать в `integration.js`**

`transformRequest`: `readGenerator` в `try` (ошибка → `reportError` один раз за жизнь контроллера, `return null`) → `parseGeneratorRequest` → `view()` (`state`, `snapshot`) → `planOutfits` (пустой план → `null`) → `Promise.allSettled` по `imageItems` через `readImage` (отказ → `console.warn('[VEFARI]', …)`) → отчёт `{ sides: [{ name, images, text }] }` по фактически загруженным → уведомить подписчиков (как в `refresh`, но без `inject`) → `JSON.stringify(augmentGeminiBody(...))`. `connect()` вызывает `installInterceptor(scope, transformRequest, reportError)`; `dispose()` вызывает функцию снятия.

- [ ] **Step 4: Запустить — проходят все**

Run: `npm test`
Expected: PASS, все тесты.

- [ ] **Step 5: Commit**

```bash
git add integration.js tests/integration.test.js
git commit -m "feat: connect generator bridge to the wardrobe controller"
```

---

### Task 7: Интерфейс настроек, README, версия

**Files:**
- Modify: `wardrobe.html` (карточка настроек, подсказка редактора, строка 69)
- Modify: `index.js` (`render`, `init`)
- Modify: `README.md`, `manifest.json`, `package.json`, `wardrobe.js` (`VERSION`)

**Interfaces:**
- Consumes: команды Task 1, `view().report` (Task 6), `formatReport` (Task 4).

- [ ] **Step 1: Разметка**

После чекбокса `vefari_enabled`:
- `<label class="vefari_checkbox"><input id="vefari_generator_images" type="checkbox"><span>Картинки нарядов в генератор</span></label>`
- `<label class="vefari_field">Максимум картинок нарядов <input id="vefari_image_limit" type="number" min="1" max="10" step="1" inputmode="numeric"></label>`
- `<p class="vefari_hint">Для notsosillynotsoimages (Gemini-compatible): в момент генерации картинки наряды тех, кого генератор отправляет лицом, добавляются референсами. Выключено или сверх лимита — вещи уходят только описанием.</p>`
- `<p class="vefari_hint">Последняя отправка в генератор: <span id="vefari_bridge_report"></span></p>`

Подсказку редактора (строка 69) заменить на: «Описание всегда попадает в чат. «Картинка и текст» дополнительно отправляет картинку вещи в генератор картинок; «Только текст» — только описание, картинка остаётся сохранённой. Экспорт скачивает PNG со вшитым описанием — так наряд можно передать.»

- [ ] **Step 2: `index.js`**

`render()` выставляет `generator_images.checked`, `image_limit.value`, `bridge_report.textContent = formatReport(report)`. В `init()`: `change` на `generator_images` → `runAction(() => controller.dispatch({ type: 'set-generator-images', enabled }))`; `change` на `image_limit` → `runAction(() => controller.dispatch({ type: 'set-image-limit', limit: Number(field('image_limit').value) }))` (ошибка валидации показывается через `status` и `render` возвращает прежнее значение).

- [ ] **Step 3: README, версия, проверка синтаксиса**

README: раздел «Картинки и генераторы» переписать: мост для notsosillynotsoimages (Gemini-compatible), правило «как лицо», лимит, общий переключатель, отчёт в настройках, проверка через DevTools → Network, ограничения из спецификации; убрать фразу «VEFARI пока не отправляет картинки…». Версия `0.5.0` в `manifest.json`, `package.json`, `wardrobe.js`, строка 4 README. В `package.json` → `check` добавить `node --check bridge.js && node --check generator.js && node --check interceptor.js`.

- [ ] **Step 4: Проверки**

Run: `npm run check && npm test`
Expected: без ошибок синтаксиса; все тесты PASS.
Run: `npm run test:browser` (если установлен Chrome/Edge)
Expected: PASS; если браузера нет — зафиксировать, что не запускалось.

- [ ] **Step 5: Commit**

```bash
git add wardrobe.html index.js README.md manifest.json package.json wardrobe.js
git commit -m "feat: generator bridge settings UI and docs (0.5.0)"
```
