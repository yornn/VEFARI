# Мост VEFARI → notsosillynotsoimages (Gemini)

Дата: 2026-10-12. Статус: утверждён в чате, ждёт ревью спецификации.

## Цель

Когда расширение [notsosillynotsoimages](https://github.com/aceeenvw/notsosillynotsoimages)
(далее — генератор, ключ настроек `inline_image_gen`) генерирует картинку,
в его запрос к API картинок должны попадать картинки и описания нарядов,
надетых в VEFARI. Только в момент генерации, только для участников,
которых генератор сам считает присутствующими в кадре.

Сейчас VEFARI картинки никуда не отправляет: `window.vefari.getImageReferences()`
никто не вызывает, а в генераторе нет точки подключения гардероба
(референсы собирает внутренняя `collectReferencesAsBase64`: char, user, NPC,
максимум 4). Поэтому VEFARI встраивается в сам сетевой запрос генератора.

## Решения, принятые в обсуждении

- Подход — мост внутри VEFARI, генератор не меняется.
- Поддерживается только API Type генератора **Gemini-compatible**.
- Сторона (char / user) получает наряд по правилу генератора для лица:
  включено `charRefAlways` / `userRefAlways` **или** имя есть в промпте картинки.
- Каждая вещь — отдельная картинка с подписью; общий лимит картинок нарядов
  на запрос, лишние вещи уходят только текстом.
- Общий переключатель «Картинки нарядов в генератор» плюс существующий
  переключатель у вещи.

## Модули

### `bridge.js` — чистая логика, без браузера и SillyTavern

- `nameMatches(nameField, text)` — копия `nameMatchesPrompt` генератора:
  алиасы через запятую, каждый — целое слово/фраза без учёта регистра,
  пробелы внутри алиаса гибкие, границы `(?<![\w])…(?![\w])`.
- `parseGeneratorRequest({ method, url, body }, generator)` →
  `{ body: разобранноеТело, promptText }` или `null`. Не `null`, только если: генератор найден и `apiType === 'gemini'`; метод `POST`;
  `url` начинается с нормализованного endpoint генератора; `body` — строка
  с JSON, где `contents[0].parts` — массив с хотя бы одной текстовой частью,
  а `generationConfig.responseModalities` содержит `IMAGE`.
- `planOutfits({ snapshot, promptText, generator, settings })` → план:
  для каждой стороны `bot`, затем `user`:
  - сторона проходит, если `generator.always[side]` или
    `nameMatches(generator.names[side], promptText)`;
    иначе для неё ничего не добавляется;
  - все надетые вещи прошедшей стороны идут текстом;
  - вещь идёт ещё и картинкой, если `settings.generatorImages`,
    `generator.sendRefs`, `item.sendImage !== false`, есть `item.imagePath`
    и не исчерпан `settings.maxImageRefs` (счётчик общий для обеих сторон,
    порядок: bot, потом user, внутри — порядок категорий VEFARI).
- `augmentGeminiBody(body, plan, images)` → новый объект тела
  (исходный не мутируется):
  - перед **последней** текстовой частью `contents[0].parts` вставляются пары
    `{ text: подпись }`, `{ inlineData: { mimeType, data } }` для каждой
    загруженной картинки;
  - подпись: `Outfit reference for <Имя> — <CATEGORY>: <название вещи>. Dress <Имя> in exactly this item; it overrides clothing visible in any face or character reference.`
  - в начало последней текстовой части (после абзаца генератора `[CRITICAL: The reference image(s)…]`, если он есть) дописывается блок
    `[Outfits: follow exactly, they override clothing from any other reference]`
    и далее по строке на прошедшую сторону в формате инжекта VEFARI:
    `[OUTFIT: <Имя> is currently wearing: TOP: … BOTTOM: ….]`
    (общий форматтер выносится из `prompt.js`, чтобы не дублировать
    `composePrompt`).
  - если ни одна сторона не прошла — тело возвращается без изменений.
- `formatReport(report)` → строка для настроек: `null` → `ещё не было`,
  иначе стороны через `; `, например `Маша — 2 картинки, 1 текстом`
  (русские формы множественного числа, нулевые части опускаются).

### `generator.js` — адаптер, только чтение чужих настроек

`readGenerator(context)` → `null`, если `extensionSettings.inline_image_gen`
отсутствует, иначе:

```js
{
  apiType,                 // settings.apiType
  endpoint,                // нормализованный: trim, без хвостовых '/', без /v1beta/models(...)$
  sendRefs,                // settings.geminiSendRefs !== false
  always: { bot: !!settings.charRefAlways, user: !!settings.userRefAlways },
  names:  { bot: <имя слота char || имя карточки>, user: <имя слота user || name1> },
}
```

Слоты читаются из `chatMetadata.iig_refs`, если `settings.refScope === 'per-chat'`,
открыт чат и контейнер существует; иначе из самих настроек
(`settings.charRef.name`, `settings.userRef.name`). Ничего не записывается.
Если ожидаемых полей нет (генератор переименовал настройки) — `readGenerator`
бросает ошибку, контроллер один раз сообщает её через `reportError`
(статус в окне VEFARI и консоль), мост молчит.

### `interceptor.js` — обёртки `fetch` и `XMLHttpRequest`

`installInterceptor(scope, transform)` → функция снятия.
`transform({ method, url, body })` возвращает `Promise<string | null>`:
новую строку тела или `null` (не трогать).

- `fetch(input, init)`: обрабатываются только `input` — строка или `URL`
  и `init.body` — строка. Иначе вызов уходит в исходный `fetch` с теми же
  аргументами без ожидания. Для подходящих: `await transform(...)`,
  затем исходный `fetch(input, { ...init, body: новоеТело })`.
- `XMLHttpRequest`: `open` запоминает метод и URL экземпляра (WeakMap);
  `send(body)` для строкового тела ждёт `transform`, затем вызывает
  исходный `send`. Ветка нужна для iOS, где генератор шлёт запросы через XHR.
- Любая ошибка внутри `transform` → `console.error('[VEFARI] …')` и
  отправка **исходного** запроса. Генерация из-за VEFARI не падает.
- Снятие: флаг `active = false` превращает обёртки в прямой проброс;
  оригиналы возвращаются, только если на месте всё ещё наши обёртки.

### Изменения существующих модулей

- `wardrobe.js`: в `createState()` — `generatorImages: true`, `maxImageRefs: 4`.
  Команды `set-generator-images` (`enabled: boolean`) и
  `set-image-limit` (`limit`: целое 1–10). Схема остаётся версии 3.
- `storage.js`: `decodeSettings` принимает новые поля, при отсутствии
  подставляет значения по умолчанию, проверяет типы и диапазон.
- `prompt.js`: экспорт форматтера одного блока `[OUTFIT: …]`,
  `composePrompt` использует его же.
- `integration.js`: `connect()` ставит перехватчик, `dispose()` снимает.
  `transform` собирает `readGenerator` + `view().snapshot` + `planOutfits`,
  грузит картинки через `readImage` (параллельно), строит тело через
  `augmentGeminiBody`. Картинка, которая не загрузилась, уходит текстом
  (`console.warn`). Последний результат хранится в памяти как отчёт
  `{ sides: [{ name, images: [категории], text: [категории] }] }`
  (`images` — ушли картинкой и текстом, `text` — только текстом) и
  уведомляет подписчиков.
- `wardrobe.html` / `index.js`: в настройках — переключатель
  «Картинки нарядов в генератор», числовое поле «Максимум картинок нарядов»
  (1–10) и строка «Последняя отправка в генератор: …»
  (`Маша — 2 картинки, 1 текстом`; до первой генерации — «ещё не было»).
- `README.md`: раздел «Картинки и генераторы» описывает мост и ограничения.

## Ограничения

- Только Gemini-compatible. OpenAI и Naistera — отдельная задача.
- При «пустом ответе» генератор повторяет запрос без своих референсов;
  мост добавит наряды и в повтор.
- Мост зависит от имени ключа настроек и полей генератора; при их смене
  он молча отключается с предупреждением в консоли.
- Групповые чаты не поддерживаются (как и весь VEFARI).

## Тесты

`node --test`, без новых зависимостей.

- `tests/bridge.test.js`: опознание запроса (метод, URL, форма тела,
  `apiType`); правило «как лицо» (always, имя, алиасы, кириллица,
  граница слова); лимит общий и порядок bot→user; текстовая вещь;
  общий выключатель; `sendRefs = false`; порядок и содержимое `parts`;
  неизменность исходного тела; «никто не прошёл» → тело без изменений.
- `tests/generator.test.js`: отсутствие генератора; нормализация endpoint;
  per-chat и глобальные слоты; запасные имена.
- `tests/interceptor.test.js`: чужой запрос уходит теми же аргументами;
  подходящий — с новым телом; ошибка `transform` → исходный запрос;
  XHR-ветка; снятие.
- `tests/storage.test.js` / `tests/wardrobe.test.js`: новые поля,
  значения по умолчанию, валидация команд.
- Ручная проверка в SillyTavern: DevTools → Network → тело
  `generateContent` содержит подписи и `inlineData` нарядов;
  строка «Последняя отправка» в настройках VEFARI.
