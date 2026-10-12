# Редизайн «Винтерфелл» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Переделать окно гардероба VEFARI в стиле «Винтерфелл»: новая палитра, шрифты, острые углы, фибула и набор иконок, раскладка «Оружейная» (слоты слева, коллекция справа), новый редактор и настройки — без изменений логики и формата данных.

**Architecture:** Ядро (`wardrobe.js`) получает одну чистую функцию `categoriesForMode`, общую для слотов и инжекта. Иконки, фибула и руны — чистые генераторы SVG в `icons.js`. Сборка DOM без состояния (карточка, слот, чип, пустое состояние) выносится в новый `render.js`; состояние экрана и обработчики остаются в `index.js`. Разметка — `wardrobe.html`, стили внутри Shadow DOM — `wardrobe.css` (переписывается), оболочка Popup и шрифты — `style.css`.

**Tech Stack:** Vanilla ES-модули, Shadow DOM, CSS; Node 22 `node:test`; браузерный дымовой тест `scripts/browser-smoke.mjs` + `tests/browser.html` в headless Chrome/Edge. Сторонних зависимостей нет.

**Spec:** `docs/superpowers/specs/2026-10-12-winterfell-redesign-design.md` — палитра, шрифты, форма, геометрия фибулы, таблица контуров иконок, раскладка и тексты берутся оттуда дословно.

## Global Constraints

- Работа в ветке `main`, коммит после каждой задачи.
- Не менять `integration.js`, `storage.js`, `prompt.js`, `bridge.js`, `generator.js`, `interceptor.js`, `images.js`, `transfer.js`, `ids.js` и формат `extensionSettings.vefari`.
- Без сторонних npm-зависимостей и без сборки; шрифты только Google Fonts: Forum, Alegreya Sans (400, 500), Alegreya Sans SC (500).
- Цвета только из токенов спецификации (`--vefari-night` `#0f1214` … `--vefari-blood-text` `#f1c0bb`); красный — только удаление и ошибки.
- `border-radius: 0` у всего внутри окна и у оболочки `#vefari_dialog.vefari_popup`.
- Иконки: сетка 24, `stroke="currentColor"`, `fill="none"`, `stroke-linecap="square"`, `stroke-linejoin="miter"`.
- Пользовательские строки — только через `textContent`/атрибуты, никогда через `innerHTML`.
- Тексты интерфейса — по-русски, как в спецификации.
- Каждая задача завершается зелёными: `npm run check`, `npm test`, `npm run test:browser` и `VEFARI_MOBILE=1 npm run test:browser`.

## Review Focus

1. Очень длинное название вещи без пробелов (200 символов) и длинное имя персонажа: карточка обрезает до двух строк, слот и вкладка — многоточием, у окна нет горизонтальной прокрутки, кнопки действий карточек на одной высоте. — тест в Task 4.
2. Картинка вещи пропала с сервера (404): карточка и слот показывают иконку категории вместо битой картинки, описание продолжает работать. — тест в Task 4.
3. Неудачное сохранение при открытом редакторе (пустое описание): оружейная остаётся неактивной (`inert`), черновик и редактор на месте. — тест в Task 5.
4. Фильтр по категории, из которой удалили последнюю вещь: показывается «В этой категории пусто» с кнопкой, которая открывает редактор с этой категорией. — тест в Task 4.
5. Google Fonts недоступны: раскладка не ломается на запасных шрифтах. — прогон `VEFARI_OFFLINE_FONTS=1` в Task 7.

## File Structure

| Файл | Ответственность |
|---|---|
| `wardrobe.js` | + `categoriesForMode(mode)`; `selectWardrobe` использует тот же предикат; `VERSION` |
| `icons.js` | `ICONS`, `createIcon`, `fibulaOutline`, `createEmblem`, `createRunes` — SVG без состояния |
| `render.js` (новый) | `createSlot`, `createCard`, `createChip`, `createEmpty` — DOM из данных, без контроллера |
| `index.js` | состояние экрана (`target`, `filter`, `settingsOpen`, `editorOpen`, `busy`, `dirty`), обработчики, `render()` |
| `window.js` | пункт меню палочки с малой фибулой |
| `wardrobe.html` | разметка окна |
| `wardrobe.css` | все стили внутри Shadow DOM |
| `style.css` | шрифты, оболочка Popup, пункт меню |
| `tests/icons.test.js` (новый) | юнит-тесты иконок и фибулы |
| `tests/wardrobe.test.js` | + тесты `categoriesForMode` |
| `tests/browser.html`, `scripts/browser-smoke.mjs` | браузерные проверки нового интерфейса |

---

### Task 1: Категории режима в ядре

**Files:**
- Modify: `wardrobe.js` (рядом с `selectWardrobe`)
- Test: `tests/wardrobe.test.js`

**Interfaces:**
- Produces: `categoriesForMode(mode: 'full' | 'parts'): string[]` — ключи `CATEGORIES` в их порядке; бросает ту же ошибку, что `validateMode`, для неизвестного режима.

- [ ] **Step 1: Write the failing test** в `tests/wardrobe.test.js` (добавить `categoriesForMode` в импорт):

```js
test('mode categories match what the injection can show', () => {
    assert.deepEqual(categoriesForMode('full'), ['full', 'accessories', 'hair']);
    assert.deepEqual(categoriesForMode('parts'), ['top', 'bottom', 'shoes', 'accessories', 'hair']);
    assert.throws(() => categoriesForMode('cloak'), /Неизвестный режим/);
    let state = inventory(garment('dress', 'full'), garment('shirt', 'top'), garment('ring', 'accessories'));
    state = wear(wear(wear(state, 'dress'), 'ring'), 'shirt');
    const { mode, items } = selection(state);
    assert.ok(items.every(item => categoriesForMode(mode).includes(item.category)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/wardrobe.test.js`
Expected: FAIL — `categoriesForMode` is not exported.

- [ ] **Step 3: Implement `categoriesForMode(mode)` in `wardrobe.js`** — вынести условие видимости из `selectWardrobe` во внутренний `visibleInMode(category, mode)` (`parts` → `category !== 'full'`, `full` → `!SEPARATES.has(category)`), использовать его и в `selectWardrobe`, и в `categoriesForMode` (`validateMode(mode)`, затем `Object.keys(CATEGORIES).filter(...)`).

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS, все прежние тесты зелёные.

- [ ] **Step 5: Commit**

```bash
git add wardrobe.js tests/wardrobe.test.js
git commit -m "feat: categories visible in each outfit mode"
```

---

### Task 2: Иконки, фибула, руны и пункт меню

**Files:**
- Modify: `icons.js` (полностью), `window.js:47` (иконка пункта меню), `style.css` (правило `#vefari_menu .vefari_icon` → `#vefari_menu .vefari_emblem`)
- Create: `tests/icons.test.js`
- Modify: `tests/browser.html` (проверка пункта меню), `package.json` (`render.js` пока не трогать)

**Interfaces:**
- Produces:
  - `ICONS: Readonly<Record<string, string[]>>` — имена из таблицы спецификации: `settings, close, back, plus, minus, check, chevron, edit, delete, import, export, image, algiz, othala, full, top, bottom, shoes, accessories, hair`. Ключи категорий совпадают с ключами `CATEGORIES`.
  - `createIcon(name: string, className = 'vefari_icon'): SVGSVGElement` — `viewBox="0 0 24 24"`, атрибуты из Global Constraints, `stroke-width="1.5"`, `aria-hidden="true"`, `focusable="false"`; неизвестное имя → `full`.
  - `fibulaOutline(variant: 'large' | 'small'): { ring: string, pin: string, eye: string, eyeWidth: number }` — `d`-строки в неповёрнутой сетке 64; `eye` — эллипс, записанный двумя дугами; `eyeWidth` 1.1 (large) / 1.8 (small).
  - `createEmblem(variant: 'large' | 'small' = 'small', className = 'vefari_emblem'): SVGSVGElement` — `viewBox="10.7 9.4 45.3 45.3"`, группа `rotate(40 32 32)`; кольцо и ушко `currentColor`, игла `fill="#9fc3d6"`.
  - `createRunes(className = 'vefari_runes'): SVGSVGElement` — ᚹᛖᚠᚨᚱᛁ, `viewBox="0 0 63 14"`, ячейки 8×14 с шагом 11, линии как у иконок, толщина 1.2.

- [ ] **Step 1: Write the failing tests** в `tests/icons.test.js`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { CATEGORIES } from '../wardrobe.js';
import { ICONS, fibulaOutline } from '../icons.js';

const numbers = d => d.match(/-?\d+(\.\d+)?/g).map(Number);

test('every category has its own icon', () => {
    for (const category of Object.keys(CATEGORIES)) assert.ok(ICONS[category]?.length, category);
    for (const name of ['settings', 'close', 'back', 'plus', 'minus', 'check', 'chevron', 'edit', 'delete', 'import', 'export', 'image', 'algiz', 'othala']) assert.ok(ICONS[name]?.length, name);
});

test('fibula outlines are closed shapes of finite numbers', () => {
    for (const variant of ['large', 'small']) {
        const { ring, pin, eye, eyeWidth } = fibulaOutline(variant);
        for (const d of [ring, pin]) {
            assert.match(d, /^M[\d.]/);
            assert.match(d, /Z$/);
            assert.ok(numbers(d).every(Number.isFinite));
        }
        assert.match(eye, /^M.*A.*A/);
        assert.ok(eyeWidth > 0);
    }
    assert.ok(numbers(fibulaOutline('large').ring).length > numbers(fibulaOutline('small').ring).length);
    assert.equal(fibulaOutline('large').ring, fibulaOutline('large').ring);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/icons.test.js`
Expected: FAIL — `ICONS` / `fibulaOutline` not exported.

- [ ] **Step 3: Implement `icons.js`**

Контуры `ICONS` — дословно из таблицы спецификации. `settings` строится один раз при загрузке модуля: 8 зубьев, для зуба `i` угол `a = i·π/4`, точки `(r, a + da)` для `[[7.6, −0.27], [10, −0.15], [10, 0.15], [7.6, 0.27]]` вокруг `(12, 12)`, замкнуть `Z`, плюс круг `M15 12A3 3 0 1 1 9 12A3 3 0 1 1 15 12`.

`fibulaOutline` — алгоритм, утверждённый в обсуждении (числа округлять до 2 знаков):

```text
params large: d=0.8, halfTurns=4, spiral centre (26.4, 40), widths wMin=0.45 wSpiral=1.25 wTop=1.35 wSide=2.7, arcSteps=14
params small: d=1.5, halfTurns=2, spiral centre (26.2, 39.6), widths 1.6 / 2.6 / 2.8 / 4.4, arcSteps=10
ring centre (32, 27), R = 15

left spiral (centre → outward, counter-clockwise on screen), k = 1..halfTurns:
  r = k·d; odd k: arc around (sx, sy + d) from −90° to −270°; even k: arc around (sx, sy) from 90° to −90°
  (sample arcSteps+1 points per arc; consecutive segments share their joint point)
left arm: cubic from spiral exit E to (17, 27) with controls (E.x − 4.5, E.y) and (17, 36), 24 steps
top: arc around (32, 27), R, from 180° to 360°, 60 steps
right arm / right spiral: mirror x → 64 − x of the left arm / left spiral, order reversed
centre line = left spiral + left arm + top + right arm + right spiral (drop duplicated joints)

widths:
  spiral point at cumulative length s of spiral length L: wMin + (wSpiral − wMin)·(s/L)^0.8 (right spiral mirrors left)
  ring point at u = s/ringLength (arms + top): g(u, m) = exp(−(u − m)² / (2·σ²))
    w = wTop + (wSpiral − wTop)·(g(u,0; σ=.07) + g(u,1; σ=.07)) + (wSide − wTop)·(g(u,.2; σ=.085) + g(u,.8; σ=.085))
outline: normal at each point from neighbours (prev → next); side A = p + n·w/2, side B = p − n·w/2;
  ring d = "M" + A points + reversed B points joined with "L" + "Z"
pin (cx 32, top 12), half-width h = w/2, collar c = collar/2 (large w 2.1 collar 3.0; small w 3.4 collar 4.2):
  (cx−h, 14.2) (cx−c, 16.2) (cx−.95h, 18.4) (cx−.9c, 20.2) (cx−.85h, 22) (cx−.72h, 46) (cx, 59) and mirror back up; "Z"
eye: ellipse (32, 11.2), rx 2.3, ry 3.4 as "M34.3 11.2A2.3 3.4 0 1 1 29.7 11.2A2.3 3.4 0 1 1 34.3 11.2"
```

Руны (ячейка начинается в `x0 = 11·i`): ᚹ `M1 1V13M1 1l5 3-5 3`; ᛖ `M1 1V13M7 1V13M1 1l3 4 3-4`; ᚠ `M1 1V13M1 5l5-4M1 9l5-4`; ᚨ `M1 1V13M1 1l5 4M1 5l5 4`; ᚱ `M1 1V13M1 1l5 3-5 3 5 6`; ᛁ `M4 1V13` — сдвигать каждый контур на `x0` через `transform="translate(x0 0)"`.

- [ ] **Step 4: Switch the wand menu to the emblem** — в `window.js` `trigger.append(createEmblem('small'), label)`; в `style.css` заменить правило иконки меню на `#vefari_menu .vefari_emblem { width: 24px; height: 24px; flex: 0 0 auto; }`. В `tests/browser.html` заменить проверку меню:

```js
check(field('menu').querySelector('svg.vefari_emblem path') && field('menu').textContent === 'VEFARI', 'Wand menu contains VEFARI and the fibula emblem');
```

`index.js` продолжает вызывать `createIcon('tunic')` для заглушки карточки — после этой задачи она получает иконку `full` (запасной вариант), это нормально до Task 4.

- [ ] **Step 5: Run all checks**

Run: `npm run check && npm test && npm run test:browser && VEFARI_MOBILE=1 npm run test:browser`
Expected: PASS везде.

- [ ] **Step 6: Commit**

```bash
git add icons.js window.js style.css tests/icons.test.js tests/browser.html
git commit -m "feat: Winterfell icon set, fibula emblem and runes"
```

---

### Task 3: Оболочка окна и оружейная

**Files:**
- Create: `render.js`
- Modify: `wardrobe.html`, `wardrobe.css` (переписать целиком), `style.css`, `index.js`, `package.json` (`node --check render.js` в `check`), `tests/browser.html`, `scripts/browser-smoke.mjs:150-154`

**Interfaces:**
- Consumes: `categoriesForMode` (Task 1); `createIcon`, `createEmblem`, `createRunes` (Task 2).
- Produces:
  - `createSlot(category: string, item: Item | null, { active: boolean }): HTMLLIElement` в `render.js` — `<li class="vefari_slot_row">` с `<button class="vefari_slot" type="button" data-filter="{category}" aria-pressed="{active}" aria-label="…">` (миниатюра: `img` из `imageUrl(item.imagePath)` или `createIcon(category)`; подпись `CATEGORIES[category]`; название с `title` или «пусто») и, если `item`, `<button type="button" class="vefari_icon_button" data-action="unequip" data-id="{category}" aria-label="Снять: {item.name}">` с иконкой `close`. `aria-label` слота: «{Категория}: {название|пусто} — показать вещи этой категории». Ошибка загрузки миниатюры заменяет `img` иконкой категории.
  - В `index.js` переменная `let filter = 'all'` и единый обработчик кликов по `[data-filter]` (`filter = el.dataset.filter; refreshView()`), используемый слотами здесь и чипами в Task 4.
  - Разметка (ID обязательны, их используют следующие задачи и тесты):

```text
#vefari_window
  header.vefari_header: .vefari_brand([data-emblem], h2#vefari_title "VEFARI", [data-runes]), #vefari_settings_toggle, #vefari_close
  #vefari_controls[data-view="collection|editor|settings"] (inert при busy)
    aside#vefari_armory
      nav.vefari_tabs[role=tablist]: #vefari_tab_user/#vefari_tab_bot (aria-controls="vefari_owner_panel vefari_collection_panel",
          .vefari_tab_label User|Char, #vefari_tab_user_name/#vefari_tab_bot_name)
      #vefari_owner_panel[role=tabpanel]
        #vefari_disabled_notice[hidden] — текст из спеки + button#vefari_enable «Включить»
        p#vefari_context.vefari_hint[hidden] — текст из спеки
        fieldset#vefari_mode (legend визуально скрыт «Режим»): radio#vefari_mode_full value=full «Целиком», radio#vefari_mode_parts value=parts «По частям», name=vefari_mode
        ul#vefari_slots
        button#vefari_clear «Снять всё»
    div.vefari_scroll
      #vefari_collection_panel[role=tabpanel] (тулбар и сетка — как сейчас до Task 4)
      #vefari_editor_panel[hidden] (как сейчас до Task 5)
      #vefari_settings_panel[hidden] (как сейчас до Task 6, но без поля режима)
  p#vefari_status[role=status]
```

- [ ] **Step 1: Update the browser test for the new shell (failing)** — в `tests/browser.html`:
  - удалить проверки «Wardrobe has its own opaque charcoal background», «Typography separates…», «Tabs and category filter remain compact…», «Equipped section is pinned…»;
  - заменить `field('context').textContent === ''` на `field('context').hidden`;
  - заменить `field('mode').value === 'parts'` на `field('mode_parts').checked`; `field('mode').disabled` оставить (теперь это `fieldset`);
  - добавить сразу после проверки изоляции темы:

```js
const style = element => getComputedStyle(element);
check(style(field('window')).backgroundColor === 'rgb(15, 18, 20)', 'Wardrobe has its own opaque night background');
check(style(field('title')).fontFamily.includes('Forum') && style(field('window')).fontFamily.includes('Alegreya Sans') && style(wardrobe().querySelector('.vefari_tab_label')).fontFamily.includes('Alegreya Sans SC'), 'Typography uses Forum and Alegreya Sans');
check([field('window'), field('add'), field('tab_user'), document.querySelector('.vefari_popup')].every(element => style(element).borderRadius === '0px'), 'Window, buttons and tabs have square corners');
const armoryRect = field('armory').getBoundingClientRect(), collectionRect = field('collection_panel').getBoundingClientRect();
check(innerWidth >= 720 ? armoryRect.right <= collectionRect.left + 1 : armoryRect.bottom <= collectionRect.top + 1, 'Armory sits beside the collection on desktop and above it on narrow screens');
check(wardrobe().querySelector('.vefari_brand svg.vefari_emblem') && wardrobe().querySelector('.vefari_brand svg.vefari_runes'), 'Header shows the fibula and the rune line');
```
  - после первого надевания пальто (после проверки `'User item is injected…'`) добавить:

```js
const slotFor = category => field('slots').querySelector(`.vefari_slot[data-filter="${category}"]`);
check([...field('slots').querySelectorAll('.vefari_slot')].map(slot => slot.dataset.filter).join() === 'full,accessories,hair', 'Full mode shows the full, accessories and hair slots');
check(slotFor('full').textContent.includes(coat.name) && slotFor('accessories').textContent.includes('пусто'), 'Worn item appears in its slot');
await click('unequip', 'full');
check(prompt() === '' && slotFor('full').textContent.includes('пусто'), 'Slot cross takes the item off');
await click('equip', coat.id);
slotFor('accessories').click();
check(!field('items').querySelector('.vefari_card') && slotFor('accessories').getAttribute('aria-pressed') === 'true', 'Clicking a slot filters the collection by its category');
slotFor('full').click();
check(field('items').querySelector('.vefari_card'), 'Another slot switches the filter');
change('filter', 'all');
```
  (`change('filter', 'all')` сбрасывает фильтр через прежний `select`; в Task 4 эта строка заменяется блоком чипов.)
  - в блоке настроек после `'Settings switch clears injection and references'` (гардероб выключен), до повторного включения, добавить проверку плашки и заменить ручное включение кликом:

```js
field('back').click();
check(!field('disabled_notice').hidden, 'Disabled wardrobe shows the notice in the armory');
field('enable').click();
await idle();
check(context.extensionSettings.vefari.enabled === true && field('disabled_notice').hidden, 'The notice button turns the wardrobe back on');
field('settings_toggle').click();
```
  (удалить прежние строки, которые ставили `field('enabled').checked = true` и вызывали `change`).
  - добавить переключение режима из оружейной после `'The same Char collection works for another bot'`:

```js
field('mode_parts').click();
await idle();
check(prompt() === '' && [...field('slots').querySelectorAll('.vefari_slot')].length === 5, 'Mode switch in the armory hides the full outfit and shows five part slots');
field('mode_full').click();
await idle();
```
  - в `scripts/browser-smoke.mjs` заменить ожидание после `Tab` на `activeElement?.id === 'vefari_mode_full'` и текст ошибки на `'Native Tab did not enter the armory.'`.

- [ ] **Step 2: Run the browser test to verify it fails**

Run: `npm run test:browser`
Expected: FAIL на первой изменённой проверке — «Tabs show dynamic participant names without duplicate context text» (у `#vefari_context` ещё нет `hidden`).

- [ ] **Step 3: Implement the shell**
  - `style.css`: `@import` шрифтов `Alegreya+Sans:wght@400;500`, `Alegreya+Sans+SC:wght@500`, `Forum`; Popup — ширина `min(980px, calc(100vw - 32px))`, рамка `1px solid #3d474e`, `border-radius: 0`, фон `#0f1214`, цвет `#e4e9ec`; при ≤540px ширина `calc(100vw - 16px)`, `max-height: calc(100dvh - 16px)`.
  - `wardrobe.css`: токены спецификации на `#vefari_window` (вместе с `all: initial`), высота `min(760px, calc(100dvh - 48px))`, фактура и свет (см. «Фактура и декор»), внутренняя волосяная рамка и четыре уголка-скобы (`::before`/`::after`, `pointer-events: none`), базовые кнопки (вторичная, главная с двойной рамкой, тихая, иконочная 34px), поля ввода, `fieldset`-ячейки (радио визуально скрыты, выбранная ячейка — `--vefari-steel` фон, `--vefari-night` текст), шапка, оружейная (232px, `--vefari-deep`), слоты (строка ~46px, миниатюра 28×34, занятый — рамка `--vefari-frost` 35%, активный фильтр — рамка `--vefari-frost-deep`), строка сообщений с маркером 2px, `:focus-visible` контур 1px `--vefari-frost` с отступом 2px, `[tabindex="-1"]:focus { outline: none; }`, `prefers-reduced-motion`. До Task 4–6 тулбар/карточки/редактор/настройки используют только базовые стили.
  - Узкий экран (`max-width: 720px`): `#vefari_controls` — одна колонка и общий скролл (`overflow-y: auto`), `.vefari_scroll` без собственного скролла; оружейная во всю ширину; `#vefari_slots` — строка с `overflow-x: auto`, плитки ~150px; поля ввода 16px.
  - `render.js`: `createSlot` по Interfaces.
  - `index.js`: подставлять `createEmblem('small')` и `createRunes()` в `[data-emblem]`/`[data-runes]` при инициализации; `render()` — `aria-labelledby` обоих панелей (`owner_panel`, `collection_panel`) на текущую вкладку, имена вкладок с `title`, `field('mode_full'|'mode_parts').checked`, `field('mode').disabled = !character`, `field('context').hidden = Boolean(character)`, `field('slots').hidden = !character`, `field('clear').hidden = !character`, `field('disabled_notice').hidden = settings.enabled`, слоты через `categoriesForMode(selection.mode)` и `createSlot(category, active.find(item => item.category === category) ?? null, { active: filter === category })`; сетка фильтруется по `filter` (до Task 4 — по прежнему `select`: `filter` и `select` синхронизировать через `field('filter').value = filter` и `change` → `filter = value`). Обработчик `change` на `fieldset#vefari_mode` → `runAction(() => ownerCommand('set-mode', { mode }))`. `#vefari_enable` → `runAction(() => controller.dispatch({ type: 'set-enabled', enabled: true }))`. `showSettings`/`showEditor` выставляют `field('controls').dataset.view`. `status()`: обычное сообщение очищается через 6000 мс (`clearTimeout` при каждом вызове), ошибки не очищаются таймером.

- [ ] **Step 4: Run all checks**

Run: `npm run check && npm test && npm run test:browser && VEFARI_MOBILE=1 npm run test:browser`
Expected: PASS, включая «Native Tab, Shift+Tab, Escape, Enter and focus restoration passed.»

- [ ] **Step 5: Look at the window** — `VEFARI_SCREENSHOT=<scratchpad>/t3.png npm run test:browser` и то же с `VEFARI_MOBILE=1`; проверить глазами шапку, оружейную, уголки-скобы, отсутствие рамки фокуса на заголовках.

- [ ] **Step 6: Commit**

```bash
git add render.js wardrobe.html wardrobe.css style.css index.js package.json tests/browser.html scripts/browser-smoke.mjs
git commit -m "feat: Winterfell window shell and armory with outfit slots"
```

---

### Task 4: Коллекция — чипы, карточки, пустые состояния

**Files:**
- Modify: `render.js`, `wardrobe.html` (тулбар коллекции), `wardrobe.css`, `index.js`, `tests/browser.html`

**Interfaces:**
- Consumes: `createIcon`, `ICONS`; `filter` и обработчик `[data-filter]` (Task 3); `imageUrl` из `images.js`.
- Produces (`render.js`):
  - `createChip(value: 'all' | string, label: string, { pressed: boolean }): HTMLButtonElement` — `button.vefari_chip[data-filter][aria-pressed]`.
  - `createCard(item: Item, { worn: boolean }): HTMLElement` — `article.vefari_card[data-action=toggle][data-id][data-worn][role=button][tabindex=0][aria-pressed][aria-label]` (тексты `aria-label` как сейчас) → `div.vefari_card_media` (картинка или `div.vefari_text_only` с `createIcon(item.category)`; при надетой — `span.vefari_worn_mark` с иконкой `check`; `div.vefari_card_actions` с кнопками `edit`/`delete`, `data-action`, `data-id`, `title`/`aria-label` «Изменить: …»/«Удалить: …») → `strong.vefari_card_title[title]`. Ошибка загрузки картинки заменяет `img` на `div.vefari_text_only` с иконкой категории.
  - `createEmpty(filtered: boolean): HTMLElement` — `div.vefari_empty` с иконкой `othala`, текст «Сундук пуст» или «В этой категории пусто», `button[data-action="add"]` «Добавить вещь».
  - Разметка тулбара: `div#vefari_filter[role=group][aria-label="Фильтр по категории"]` (чипы рендерятся при инициализации: «Все» + `CATEGORIES`), справа `#vefari_import`, `#vefari_import_file`, `#vefari_add`.
  - `index.js`: `openNewEditor()` — общий для `#vefari_add` и `data-action="add"` в `handleItemAction`; после `resetEditor()` ставит `field('category').value = filter === 'all' ? 'full' : filter`.

- [ ] **Step 1: Update the browser test (failing)** — в `tests/browser.html`:
  - заменить проверку «Category filter is a bare select…» на `check(field('filter').querySelectorAll('.vefari_chip[data-filter]').length === 7, 'Category filter is a row of chips');`
  - заменить «A single wardrobe card does not stretch…» порогом `<= 220`;
  - проверка заглушки: `check(placeholder.height >= 150 && placeholder.width < placeholder.height && field('items').querySelector('.vefari_text_only svg'), 'Text-only cards show a tall placeholder with the category icon');`
  - заменить строку `change('filter', 'all');` из блока слотов Task 3 этим блоком (вкладка User, пальто надето):

```js
const chip = value => field('filter').querySelector(`.vefari_chip[data-filter="${value}"]`);
chip('all').click();
chip('shoes').click();
check(field('items').querySelector('.vefari_empty')?.textContent.includes('В этой категории пусто'), 'Empty category explains itself');
field('items').querySelector('.vefari_empty [data-action="add"]').click();
await idle();
check(!field('editor_panel').hidden && field('category').value === 'shoes', 'Adding from a filtered category preselects it');
field('cancel').click();
chip('all').click();
check(chip('all').getAttribute('aria-pressed') === 'true' && field('items').querySelector('.vefari_card'), 'The all chip resets the filter');
check(getComputedStyle(chip('all')).borderRadius === '0px' && getComputedStyle(field('items').querySelector('.vefari_card')).borderRadius === '0px', 'Chips and cards have square corners');
```
  - Review Focus 1 и 2 — после сохранения «Плетёный пояс» (в конце сценария), перед проверкой горизонтального переполнения:

```js
const patchItem = (id, patch) => {
    const vefari = context.extensionSettings.vefari;
    context.extensionSettings.vefari = { ...vefari, items: vefari.items.map(item => item.id === id ? { ...item, ...patch } : item) };
    emit('chat');
};
const longName = 'Плащ'.repeat(50);
field('add').click(); input('name', longName); input('description', 'Очень длинное название.'); await save();
const longItem = context.extensionSettings.vefari.items.find(item => item.name === longName);
await click('equip', longItem.id);
const cards = [...field('items').querySelectorAll('.vefari_card')];
const tops = cards.map(card => Math.round(card.querySelector('[data-action="edit"]').getBoundingClientRect().top - card.getBoundingClientRect().top));
check(new Set(tops).size === 1, 'Card actions stay at the same height for long and short names');
const longTitle = field('items').querySelector(`.vefari_card[data-id="${longItem.id}"] .vefari_card_title`);
check(longTitle.getBoundingClientRect().height <= parseFloat(getComputedStyle(longTitle).lineHeight) * 2 + 1, 'Long names are clamped to two lines');
check(field('armory').scrollWidth <= field('armory').clientWidth + 1, 'A long name in a slot does not stretch the armory');
patchItem(longItem.id, { imagePath: 'user/images/vefari_refs/missing.png' });
await wait(() => field('items').querySelector(`.vefari_card[data-id="${longItem.id}"] .vefari_text_only`) && field('slots').querySelector('.vefari_slot[data-filter="full"] svg'));
check(true, 'A missing picture falls back to the category icon in the card and the slot');
patchItem(longItem.id, { imagePath: '' });
await click('delete', longItem.id);
```
  (`CHAT_CHANGED` перечитывает настройки — так же, как в проверке миграции схемы 2.)

- [ ] **Step 2: Run the browser test to verify it fails**

Run: `npm run test:browser`
Expected: FAIL на «Category filter is a row of chips».

- [ ] **Step 3: Implement** — `render.js` по Interfaces; `wardrobe.html` тулбар; `index.js`: инициализация чипов, `render()` выставляет `aria-pressed` чипам, использует `createCard`/`createEmpty`, удаляет прежние `button()`-карточки и `select`-синхронизацию из Task 3; `handleItemAction('add')` → `openNewEditor()`. `wardrobe.css`: тулбар, чипы (прямоугольник, рамка `--vefari-iron`, выбранный — рамка `--vefari-frost` и `box-shadow: inset 0 -2px 0 var(--vefari-frost)`), сетка `repeat(auto-fill, minmax(136px, 1fr))` зазор 12px, карточка (отступ 5px, `max-width: 220px`, медиа 4:5, название Forum 15px с явным `line-height: 1.15`, `-webkit-line-clamp: 2` + `min-height` на две строки), действия поверх медиа (26px, видимы при `:hover`/`:focus-within`, всегда при `@media (hover: none)`; корзина при наведении — `--vefari-blood`/`--vefari-blood-text`), надетая (двойная рамка инея, свечение, градиент сверху, метка 18px), пустое состояние. Узкий экран: минимум 2 колонки до 340px (`minmax(120px, 1fr)`).

- [ ] **Step 4: Run all checks**

Run: `npm run check && npm test && npm run test:browser && VEFARI_MOBILE=1 npm run test:browser`
Expected: PASS.

- [ ] **Step 5: Look at the window** — скриншоты ПК и телефона, проверить карточки, надетую вещь, действия при наведении.

- [ ] **Step 6: Commit**

```bash
git add render.js wardrobe.html wardrobe.css index.js tests/browser.html
git commit -m "feat: collection chips, compact cards and empty states"
```

---

### Task 5: Редактор вещи

**Files:**
- Modify: `wardrobe.html` (`#vefari_editor_panel`), `wardrobe.css`, `index.js`, `tests/browser.html`, `scripts/browser-smoke.mjs` (скриншот редактора: `scrollIntoView` на `.vefari_editor_footer`)

**Interfaces:**
- Consumes: `openNewEditor` (Task 4), `createIcon('image' | 'chevron')`.
- Produces: разметка редактора, используемая тестами:

```text
#vefari_editor_panel
  .vefari_section_heading: h3#vefari_editor_title[tabindex=-1], button#vefari_editor_back «К нарядам» (иконка back)
  form#vefari_form
    .vefari_editor_grid
      .vefari_dropzone#vefari_dropzone[data-removing]: input#vefari_image[type=file] (на всю зону), #vefari_editor_image (превью), подпись с иконкой image
      #vefari_image_actions[hidden]: button#vefari_replace_image «Заменить», label.vefari_button(input#vefari_remove_image[type=checkbox] визуально скрыт, «Убрать»)
      .vefari_editor_fields: #vefari_name; fieldset#vefari_audience (radio #vefari_audience_user|_bot|_both, name=vefari_audience, value=user|bot|both);
                             select#vefari_category; textarea#vefari_description + p.vefari_hint (текст из спеки);
                             fieldset.vefari_send_mode (#vefari_send_image, #vefari_send_text — как сейчас)
    .vefari_editor_footer: button[type=submit] «Сохранить вещь», #vefari_cancel «Отмена», #vefari_export_item[hidden] (иконка export, aria-label «Экспорт PNG со вшитым описанием»)
```

- [ ] **Step 1: Update the browser test (failing)**:
  - добавить хелпер рядом с `change`: `const choose = id => { field(id).checked = true; field(id).dispatchEvent(new Event('change', { bubbles: true })); };`
  - `field('audience').value === 'user'` → `field('audience_user').checked`; `change('audience', 'both')` → `choose('audience_both')`;
  - `!field('export_item').disabled` → `!field('export_item').hidden` (обе проверки);
  - после `field('add').click()` в начале сценария: `check(field('editor_title').textContent === 'Новая вещь' && field('export_item').hidden && field('image_actions').hidden, 'A new item has no export or image actions');`
  - после выбора файла `reference.png`: `check(field('editor_image').querySelector('img'), 'A chosen picture previews inside the drop zone');`
  - после `await click('edit', boots.id)` (первое): `check(!field('image_actions').hidden && field('armory').inert && field('controls').dataset.view === 'editor', 'Editing an item with a picture offers replace/remove and locks the armory');`
  - Review Focus 3 — сразу после этого:

```js
const kept = field('description').value;
input('description', '');
field('form').requestSubmit();
await idle();
check(field('status').dataset.error === 'true' && field('armory').inert && !field('editor_panel').hidden, 'A failed save keeps the editor open and the armory locked');
input('description', kept);
```
  - в шаге удаления картинки (`field('remove_image').checked = true`) добавить перед `save()`: `field('remove_image').dispatchEvent(new Event('change', { bubbles: true })); check(field('dropzone').dataset.removing === 'true', 'Remove marks the picture for deletion');`

- [ ] **Step 2: Run the browser test to verify it fails**

Run: `npm run test:browser`
Expected: FAIL на «A new item has no export or image actions».

- [ ] **Step 3: Implement**
  - `index.js`: `resetEditor()` — заголовок «Новая вещь», `export_item.hidden = true`, `image_actions.hidden = true`, `dropzone.dataset.removing = 'false'`, радио аудитории по `target`; `editItem()` — «Изменить вещь», `image_actions.hidden = !item.imagePath`, `export_item.hidden = !item.imagePath`; `importItem()` — `export_item.hidden = false`; `handleSave()` читает аудиторию из `root.querySelector('input[name="vefari_audience"]:checked').value`; выбор файла показывает превью (`URL.createObjectURL`, `revoke` по `load`) и снимает `remove_image`; `#vefari_replace_image` → `field('image').click()`; `change` на `#vefari_remove_image` → `dropzone.dataset.removing`; `showEditor()` ставит `field('armory').inert = true`, `showSettings()` и закрытие редактора — `false`. Удалить логику `disabled` у `remove_image`/`export_item`.
  - `wardrobe.css`: сетка `180px minmax(0, 1fr)`, зона 4:5 пунктир `--vefari-iron-strong`, `[data-removing="true"]` — затемнение и «Картинка будет удалена» (через `::after` с `content`), поля, `select` с иконкой-шевроном фоном (`appearance: none`), закреплённый футер (`position: sticky; bottom: 0`, фон `--vefari-night`, линия сверху), оружейная в режиме редактора `opacity: .55`. Узкий экран: одна колонка, зона 140px.

- [ ] **Step 4: Run all checks**

Run: `npm run check && npm test && npm run test:browser && VEFARI_MOBILE=1 npm run test:browser`
Expected: PASS.

- [ ] **Step 5: Look at the editor** — `VEFARI_EDITOR_SCREENSHOT=<scratchpad>/t5.png npm run test:browser` (ПК и телефон).

- [ ] **Step 6: Commit**

```bash
git add wardrobe.html wardrobe.css index.js tests/browser.html scripts/browser-smoke.mjs
git commit -m "feat: two-column item editor with drop zone"
```

---

### Task 6: Настройки и руна-переключатель

**Files:**
- Modify: `wardrobe.html` (`#vefari_settings_panel`), `wardrobe.css`, `index.js`, `tests/browser.html`

**Interfaces:**
- Consumes: `MAX_IMAGE_REFS` из `wardrobe.js`, `createIcon('algiz' | 'othala' | 'minus' | 'plus')`.
- Produces: разметка настроек:

```text
#vefari_settings_panel
  .vefari_section_heading: h3#vefari_settings_title[tabindex=-1] «Настройки», button#vefari_back «К нарядам»
  .vefari_settings_grid (repeat(auto-fit, minmax(280px, 1fr)))
    section.vefari_settings_block «Гардероб»: label.vefari_rune_toggle(input#vefari_enabled, span.vefari_rune_box[data-icon=algiz], текст) + подсказка
    section «Генератор картинок»: rune_toggle #vefari_generator_images; .vefari_stepper(button#vefari_limit_down[data-icon=minus], input#vefari_image_limit[type=number min=1 max=10], button#vefari_limit_up[data-icon=plus]); «Последняя отправка: #vefari_bridge_report»; подсказка
    section «Обмен»: #vefari_export_all + подсказка
    section «Текст инжекта»: pre#vefari_prompt
```
  Подписи блоков — `h4` капителью `--vefari-frost`; между заголовком экрана и сеткой — разделитель с руной `othala`. Тексты — из спецификации.

- [ ] **Step 1: Update the browser test (failing)** — в блоке настроек после `field('settings_toggle').click()`:

```js
check(getComputedStyle(field('settings_title')).outlineStyle === 'none', 'Programmatic focus on the settings heading draws no frame');
check(field('armory').getBoundingClientRect().width === 0 && field('prompt').getClientRects().length > 0, 'Settings use the full width and show the injection text without expanding');
check(field('enabled').closest('.vefari_rune_toggle')?.querySelector('svg'), 'Switches are rune seals over real checkboxes');
field('limit_up').click(); await idle();
check(context.extensionSettings.vefari.maxImageRefs === 5 && field('image_limit').value === '5', 'Stepper raises the image limit');
field('limit_down').click(); await idle();
check(context.extensionSettings.vefari.maxImageRefs === 4, 'Stepper lowers the image limit');
```
  Остальные проверки настроек (лимит 11 отклоняется, лимит 2 сохраняется, переключатель генератора, отчёт моста) остаются как есть.

- [ ] **Step 2: Run the browser test to verify it fails**

Run: `npm run test:browser`
Expected: FAIL на «Settings use the full width…» или на отсутствии `#vefari_limit_up`.

- [ ] **Step 3: Implement**
  - `index.js`: `#vefari_limit_up`/`#vefari_limit_down` → `runAction(() => controller.dispatch({ type: 'set-image-limit', limit: clamp(Number(field('image_limit').value) ± 1, 1, MAX_IMAGE_REFS) }))` и `.finally(refreshView)`; на границе диапазона — без действия; удалить `details` из логики, если на него были ссылки.
  - `wardrobe.css`: `[data-view="settings"] #vefari_armory { display: none; }`, сетка блоков, блок (фон `--vefari-slate`, рамка `--vefari-iron`), руна-переключатель (квадрат 22px; выкл. — рамка `--vefari-iron-strong`, руна `--vefari-ash-dim`; вкл. через `:has(input:checked)` или `input:checked + .vefari_rune_box` — двойная рамка инея, руна `--vefari-frost`; фокус `input:focus-visible + .vefari_rune_box`), степпер, `pre` (моноширинный 12px, фон `--vefari-deep`, `max-height: 220px`). Узкий экран — одна колонка (даёт `auto-fit`).

- [ ] **Step 4: Run all checks**

Run: `npm run check && npm test && npm run test:browser && VEFARI_MOBILE=1 npm run test:browser`
Expected: PASS.

- [ ] **Step 5: Look at settings** — `VEFARI_SETTINGS_SCREENSHOT=<scratchpad>/t6.png npm run test:browser` (ПК и телефон).

- [ ] **Step 6: Commit**

```bash
git add wardrobe.html wardrobe.css index.js tests/browser.html
git commit -m "feat: settings blocks with rune switches and limit stepper"
```

---

### Task 7: Заглушка экспорта, версия 0.6.0, README и скриншоты

**Files:**
- Modify: `index.js` (`placeholderImage`), `wardrobe.js` (`VERSION`), `manifest.json`, `package.json`, `README.md`, `artifacts/*.png`

**Interfaces:**
- Consumes: `fibulaOutline('large')` (Task 2).

- [ ] **Step 1: Repaint the export placeholder** — `placeholderImage(name)` 640×640: фон `#0f1214`; рамка `#3d474e` 2px с отступом 24px и волосяная `#2c343a` с отступом 30px; уголки-скобы `#6f8796` 28px; крупная фибула через `Path2D` (`ctx.translate(320, 230)`, `ctx.rotate(40°)`, масштаб ×5, центр сетки `(32, 32)`): кольцо `#c3ced5`, игла `#9fc3d6`, ушко — обводка `#c3ced5`; название — `'Forum', Georgia, serif` 38px `#e4e9ec`, перенос по ширине 520px, до 3 строк, начиная с y = 430; «VEFARI» — 18px `#6f8796` с разрядкой у нижнего края. Существующая проверка ZIP в браузерном тесте покрывает, что экспорт работает.

- [ ] **Step 2: Bump the version** — `VERSION = '0.6.0'` в `wardrobe.js`, `"version": "0.6.0"` в `manifest.json` и `package.json`.

- [ ] **Step 3: Update README** — строка версии (0.6.0, оформление «Винтерфелл», оружейная со слотами); раздел «Оформление» переписать: палитра железа и инея, фибула, руны, прямые углы, шрифты Forum / Alegreya Sans / Alegreya Sans SC с запасными Georgia / Segoe UI; в «Работе с гардеробом» описать оружейную (вкладки, «Целиком / По частям», слоты, клик по слоту = фильтр, крестик = снять), чипы-фильтры, «+» с выбранной категорией, редактор (зона картинки, «Заменить / Убрать», экспорт только при картинке), настройки (руны-переключатели, степпер лимита); убрать упоминания нижней панели «Сейчас надето», режима в настройках, Cinzel / Cormorant / Golos.

- [ ] **Step 4: Full verification**

Run: `npm run check && npm test && npm run test:browser && VEFARI_MOBILE=1 npm run test:browser && VEFARI_OFFLINE_FONTS=1 npm run test:browser`
Expected: PASS во всех пяти прогонах (последний — Review Focus 5).

- [ ] **Step 5: Regenerate screenshots** — перезаписать `artifacts/wardrobe-desktop.png` (`VEFARI_SCREENSHOT`), `artifacts/settings-desktop.png` (`VEFARI_SETTINGS_SCREENSHOT`), `artifacts/editor-desktop.png` (`VEFARI_EDITOR_SCREENSHOT`), `artifacts/wardrobe-mobile.png` и `artifacts/settings-mobile.png` (`VEFARI_MOBILE=1`); абсолютные пути. Просмотреть каждый снимок.

- [ ] **Step 6: Commit**

```bash
git add index.js wardrobe.js manifest.json package.json README.md artifacts
git commit -m "feat: Winterfell redesign 0.6.0 — export placeholder, docs and screenshots"
```
