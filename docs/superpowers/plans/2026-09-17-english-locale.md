# English Locale (EN) - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Английская версия сайта на `/en/`, закрытая в `noindex`, без единого видимого изменения в украинской продакшен-версии.

**Architecture:** Английские страницы генерируются на билде в `public/en/` из тех же шаблонов, что уже собирают страницы маршрутов. Строки интерфейса переезжают из литералов `app.js` в словарь `T`; английские страницы подгружают файл-оверрайд `public/i18n/en.js` перед `app.min.js`. Данные из API переводятся на клиенте в момент отрисовки: города - словарём экзонимов, адреса остановок - глоссарием плюс транслитерация КМУ-2010.

**Tech Stack:** Node 22 (CommonJS), Express, ванильный JS на фронте, `node:test`. Без новых npm-зависимостей.

**Spec:** [docs/superpowers/specs/2026-09-17-english-locale-design.md](../specs/2026-09-17-english-locale-design.md)

## Global Constraints

- Во всех видимых текстах короткий дефис «-», НИКОГДА не em-dash «—». Правило действует и для английских строк.
- Коммиты на английском, conventional commits. **Коммитит пользователь вручную** - каждая задача заканчивается готовым текстом сообщения, а не вызовом `git commit`.
- Никаких новых npm-зависимостей.
- Украинская версия не меняется ни на один видимый символ. Допустимы только невидимые служебные атрибуты.
- Не трогать код, разбирающий украинский текст из API: `isGroupPrepay()` (`app.js:29`) и `groupThreshold()` (`app.js:33-37`). Это парсинг данных поставщика, перевод сломает групповые скидки.
- Доступ к storage только через существующие обёртки `LS`/`SS` (`app.js:7-15`). Прямое обращение к `localStorage` бросает исключение у части пользователей.
- Английские страницы: `<html lang="en">`, `<meta name="robots" content="noindex, nofollow">`, отсутствие в `sitemap.xml`, без тега `canonical`.

## Порядок задач и деградация

Задачи упорядочены так, чтобы при нехватке времени результат оставался цельным:

- После задачи 1 - готов English README (независим от всего остального).
- После задачи 13 - работающая английская версия с украинскими названиями городов.
- После задачи 16 - полный перевод данных из API.

---

## File Structure

| Файл | Ответственность |
|---|---|
| `README.md` | Создать. Техническое описание проекта на английском |
| `public/app.js` | Изменить. Литералы → словарь `T`, выбор языка, перевод данных API |
| `public/common.js` | Изменить. Строки cookie-банера и кнопки «нагору» → словарь |
| `public/index.html` | Изменить. Атрибуты `data-i18n`, переключатель языка в шапке |
| `public/faq.html` | Изменить. Атрибуты `data-i18n` |
| `public/booking.html` | Изменить. Атрибуты `data-i18n` |
| `i18n/en.json` | Создать. Строки интерфейса: ключ → английский текст |
| `i18n/cities-en.json` | Создать. Экзонимы: id города → English name |
| `i18n/geo-en.json` | Создать. Глоссарий служебных слов для адресов |
| `i18n/translit.js` | Создать. Транслитерация КМУ-2010, переиспользуется билдом и тестами |
| `build-i18n.js` | Создать. Генерация `public/en/*.html` и `public/i18n/en.js` |
| `build-routes.js` | Изменить. Вызов `build-i18n.js` в конце |
| `server.js` | Изменить. Маршрут `/en/t/:token`, словарь ошибок по `?lang=en` |
| `tools/check-ua-strings.js` | Создать. Сверка набора украинских литералов между ревизиями |
| `tests/i18n.test.js` | Создать. Полнота перевода, паритет ключей, транслитерация |

---

## Task 1: English README

Независимая задача с наибольшей отдачей: ссылка на репозиторий уходит рецензентам, а комментарии в коде украинские.

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: ничего
- Produces: ничего (документация)

- [ ] **Step 1: Собрать фактуру из кода**

Проверить и выписать актуальные значения, не полагаясь на память:

```bash
node -e "const p=require('./package.json');console.log(p.engines.node, Object.keys(p.dependencies).join(', '))"
```

Ожидается: `>=22 compression, cors, express, helmet`

```bash
node -e "const r=require('./routes.json');console.log('routes:',r.length)"
```

Ожидается: `routes: 12`

- [ ] **Step 2: Написать README.md**

Обязательные разделы, каждый с реальным содержанием:

1. **Заголовок и одно предложение.** GoodDayBus - агрегатор бронирования автобусных билетов из Украины в Европу. Не перевозчик: собирает рейсы проверенных перевозчиков.
2. **The problem.** Пассажиры бронируют по телефону через менеджера; сайт даёт поиск, сравнение и бронирование без регистрации и без предоплаты, с оплатой водителю при посадке.
3. **Tech stack.** Node 22, Express, `node:sqlite`, ванильный JS на фронте без сборщика. Четыре рантайм-зависимости: compression, cors, express, helmet. Явно указать, что отсутствие фреймворка на фронте - осознанный выбор ради скорости загрузки на слабых телефонах.
4. **Architecture.** Схема потока: браузер → Express-прокси → API перевозчика «Контрабас»; SQLite для заявок; Telegram-бот для уведомлений менеджера; генерация статики на билде.
5. **Engineering decisions worth noting.** По одному абзацу: генерация 12 SEO-страниц из `routes.json`; полная работоспособность при заблокированном localStorage; защита от ботов через Cloudflare Turnstile с мягкой деградацией в ручную заявку; кеш поиска на 2 минуты; телеметрия неизвестных кодов от поставщика; двуязычный интерфейс с генерацией на билде.
6. **Running locally.** `npm install`, `.env` по образцу `.env.example`, `npm start`, `npm test` против запущенного сервера.
7. **Repository notes.** Честно: комментарии в коде и проектная документация на украинском и русском; интерфейс доступен на украинском и английском.

Стиль - техническое описание для читателя, оценивающего инженерную работу, а не маркетинговый текст. Длинные тире не использовать.

- [ ] **Step 3: Проверить отсутствие длинных тире**

Run: `grep -c '—' README.md`
Expected: `0`

- [ ] **Step 4: Коммит (выполняет пользователь)**

```bash
git add README.md
```

```
docs: add English README - repository link goes to reviewers who do not read Ukrainian
```

---

## Task 2: Словарь T и механизм выбора языка

Фундамент для задач 3-8. Английский ещё не добавляется - только инфраструктура и первый участок строк.

**Files:**
- Modify: `public/app.js:1-199`
- Create: `tools/check-ua-strings.js`

**Interfaces:**
- Produces:
  - `LANG` - строка `'uk'` или `'en'`, определяется как `document.documentElement.lang === 'en' ? 'en' : 'uk'`
  - `T` - объект словаря, доступен во всём IIFE `app.js`
  - `plural(n, forms)` - выбирает форму из массива: для `uk` три формы, для `en` две
  - `window.__I18N__` - точка расширения, которую задаёт `public/i18n/en.js` (создаётся в задаче 9)

- [ ] **Step 1: Создать инструмент сверки украинских литералов**

Он нужен во всех шести задачах рефакторинга: доказывает, что строки переехали, а не изменились.

```javascript
// tools/check-ua-strings.js
// Сверяет НАБОР украинских строковых литералов в public/app.js между двумя git-ревизиями.
// Рефакторинг переносит литералы в словарь T - набор обязан остаться тем же.
// Запуск: node tools/check-ua-strings.js HEAD
const { execSync } = require('child_process');
const fs = require('fs');

const rev = process.argv[2] || 'HEAD';
const cyr = /[А-Яа-яІіЇїЄєҐґ]/;

function literals(src) {
    const out = [];
    for (const line of src.split(/\r?\n/)) {
        const code = line.replace(/\/\/.*$/, '');
        const m = code.match(/'[^']*'|"[^"]*"/g) || [];
        for (const lit of m) {
            const body = lit.slice(1, -1);
            if (cyr.test(body)) out.push(body);
        }
    }
    return out.sort();
}

const before = literals(execSync(`git show ${rev}:public/app.js`, { encoding: 'utf8' }));
const after = literals(fs.readFileSync('public/app.js', 'utf8'));

const missing = before.filter(s => !after.includes(s));
const added = after.filter(s => !before.includes(s));

console.log(`${rev}: ${before.length} литералов, рабочая копия: ${after.length}`);
if (missing.length) console.log('ПРОПАЛИ:\n  ' + missing.join('\n  '));
if (added.length) console.log('ПОЯВИЛИСЬ:\n  ' + added.join('\n  '));
if (!missing.length && !added.length) console.log('OK: набор строк не изменился');
process.exit(missing.length || added.length ? 1 : 0);
```

- [ ] **Step 2: Запустить на нетронутом файле - должно быть чисто**

Run: `node tools/check-ua-strings.js HEAD`
Expected: `OK: набор строк не изменился`

- [ ] **Step 3: Добавить LANG, T и plural в app.js**

Вставить сразу после строки `const LS = safeStore('localStorage'), SS = safeStore('sessionStorage');` (`app.js:15`):

```javascript
    // --- Мова інтерфейсу ---------------------------------------------------
    // Українська - типова: усі рядки лежать тут, у T_UK. Англійські сторінки
    // підвантажують public/i18n/en.js ПЕРЕД цим файлом, він кладе повний
    // англійський словник у window.__I18N__ - жодного часткового злиття,
    // повнота гарантується тестом (немає кирилиці у public/en/*.html).
    const LANG = document.documentElement.lang === 'en' ? 'en' : 'uk';

    // Форми множини: українська має три, англійська дві.
    const PLURAL_RULE = {
        uk: n => (n % 10 === 1 && n % 100 !== 11) ? 0
            : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? 1 : 2,
        en: n => n === 1 ? 0 : 1
    };
    const plural = (n, forms) => forms[PLURAL_RULE[LANG](n)];

    const T_UK = {
        status: {
            loadingCities: 'Завантаження міст...',
            citiesReady: n => `${n} міст у наявності - оберіть напрямок`,
            citiesFailed: 'Не вдалося завантажити міста - перевірте зʼєднання',
            retry: 'Спробувати ще раз'
        },
        date: {
            dow: ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
            monShort: ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'],
            monFull: ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'],
            earlier: 'Раніше',
            later: 'Пізніше'
        },
        ac: {
            recent: 'Нещодавні',
            popular: 'Популярні напрямки'
        }
    };

    const T = (window.__I18N__ && window.__I18N__.app) || T_UK;
```

Значения с подстановкой - функции (`citiesReady`), а не строки со склейкой: в английском порядок слов другой, и шаблон должен принадлежать словарю целиком.

- [ ] **Step 4: Заменить литералы на участке 1-199**

Пройти участок `app.js:1-199` и заменить все 42 украинских литерала на обращения к `T`. Затронутые места:

| Строка | Было | Стало |
|---|---|---|
| ~71 | `` `${cities.length} міст у наявності - оберіть напрямок` `` | `T.status.citiesReady(cities.length)` |
| ~93 | `'Завантаження міст...'` | `T.status.loadingCities` |
| ~104 | `'Не вдалося завантажити міста - перевірте зʼєднання'` | `T.status.citiesFailed` |
| ~109 | `'Спробувати ще раз'` | `T.status.retry` |
| ~119 | `const DOW = [...]` | `const DOW = T.date.dow` |
| ~120 | `const MON_SHORT = [...]` | `const MON_SHORT = T.date.monShort` |
| ~137 | `aria-label="Раніше"` | `aria-label="${T.date.earlier}"` |
| ~139 | `aria-label="Пізніше"` | `aria-label="${T.date.later}"` |

**Не трогать** массив `POPULAR` (`app.js:193-198`): это названия городов-данных с числовыми `id`, они переводятся отдельно в задаче 16.

- [ ] **Step 5: Проверить, что набор строк не изменился**

Run: `node tools/check-ua-strings.js HEAD`
Expected: `OK: набор строк не изменился` (строки переехали внутрь `T_UK`, набор тот же)

Если инструмент показывает ПРОПАЛИ - литерал потерян или изменён, это регрессия. Если ПОЯВИЛИСЬ - добавлен текст, которого не было.

- [ ] **Step 6: Проверить в браузере**

Запустить dev-сервер и открыть главную. Проверить: список городов загружается, статус под формой показывает число городов, полоска дат листается стрелками, автодополнение показывает «Нещодавні» и «Популярні напрямки».

- [ ] **Step 7: Коммит (выполняет пользователь)**

```bash
git add public/app.js tools/check-ua-strings.js
```

```
refactor(i18n): extract app.js strings to T dictionary, part 1 of 6 - init, dates, autocomplete
```

---

## Task 3: Строки app.js, участок 2 (поиск и подсказки)

39 литералов на строках 200-499.

**Files:**
- Modify: `public/app.js:200-499`

**Interfaces:**
- Consumes: `T`, `plural` из задачи 2
- Produces: ветки словаря `T.search`, `T.suggest`, `T.transfers`

- [ ] **Step 1: Дополнить T_UK ветками для этого участка**

```javascript
        search: {
            differentCities: 'Вкажіть різні міста',
            checkCities: 'Перевірте назви міст або оберіть зі списку підказок',
            searching: 'Шукаємо рейси...',
            searchingBtn: 'Шукаємо...',
            findRoute: 'Знайти рейс',
            error: msg => `Помилка: ${msg}`
        },
        suggest: {
            otherDate: d => `На обрану дату рейсів немає, але є на ${d}:`,
            showOtherDate: d => `Показати рейси на ${d}`,
            noDirect: 'Прямих рейсів немає. Натисніть місто поряд, щоб переглянути рейси:',
            none: 'Спробуйте іншу дату чи напрямок або зверніться до менеджера нижче.',
            routeForms: ['рейс', 'рейси', 'рейсів']
        },
        transfers: {
            direct: 'Без пересадок, прямий рейс',
            forms: ['пересадка', 'пересадки', 'пересадок']
        }
```

- [ ] **Step 2: Переписать routeWord через plural**

Было (`app.js:431-435`):

```javascript
    function routeWord(n) {
        if (n % 10 === 1 && n % 100 !== 11) return 'рейс';
        if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'рейси';
        return 'рейсів';
    }
```

Стало:

```javascript
    const routeWord = n => plural(n, T.suggest.routeForms);
```

Правило множественного числа теперь одно на весь файл и живёт в `PLURAL_RULE`, а не дублируется в каждой функции.

- [ ] **Step 3: Переписать fmtTransfers через plural**

В `fmtTransfers` (`app.js:415-428`) заменить строки 426-427:

```javascript
        const word = plural(n, T.transfers.forms);
        return { label: `${n} ${word} · ${cities.join(', ')}`, full: text };
```

- [ ] **Step 4: Заменить остальные литералы участка**

Строки 329, 330, 340, 344, 364, 368, 375, 397, 448, 449, 453, 462 - заменить на соответствующие ветки `T`. Массив `UA_MONTHS` (`app.js:397`) становится `T.date.monFull`.

- [ ] **Step 5: Проверить набор строк**

Run: `node tools/check-ua-strings.js HEAD`
Expected: `OK: набор строк не изменился`

- [ ] **Step 6: Проверить в браузере**

Выполнить поиск по реальному направлению. Проверить: статус «Шукаємо рейси...», кнопка меняет текст, результаты выводятся, подпись про пересадки согласована по числу. Ввести несуществующий город - должна появиться ошибка про названия городов. Выбрать одинаковые города - «Вкажіть різні міста».

- [ ] **Step 7: Коммит (выполняет пользователь)**

```bash
git add public/app.js
```

```
refactor(i18n): extract app.js strings to T dictionary, part 2 of 6 - search and suggestions
```

---

## Task 4: Строки app.js, участок 3 (удобства и выдача)

25 литералов на строках 500-699, включая карту `AMENITIES`.

**Files:**
- Modify: `public/app.js:500-699`

**Interfaces:**
- Consumes: `T` из задачи 2
- Produces: `T.amenities` (карта код → подпись), `T.pay`, `T.results`

- [ ] **Step 1: Перенести AMENITIES в словарь**

Карта `AMENITIES` (`app.js:493`) целиком переезжает в `T_UK.amenities`. Шаблоны `AMEN_PATTERNS` (`app.js:515`) остаются в коде: это регулярные выражения плюс функции-конструкторы, но украинский текст внутри них тоже берётся из `T_UK.amenities`.

Сообщение телеметрии в `reportUnknownAmenity` (`app.js:532`) - **не переводить**: оно уходит разработчику в лог, а не пользователю.

- [ ] **Step 2: Перенести подписи оплаты**

Строки из `paymentHtml` (`app.js:559-571`) и `payTag` (`app.js:573-578`) переносятся в `T_UK.pay`.

- [ ] **Step 3: Заменить литералы выдачи**

Строки из `renderResults` (`app.js:580-671`) - заголовки сортировки, подписи фильтров, «нічого не знайдено» - в `T_UK.results`.

- [ ] **Step 4: Проверить набор строк**

Run: `node tools/check-ua-strings.js HEAD`
Expected: `OK: набор строк не изменился`

- [ ] **Step 5: Проверить в браузере**

Найти рейс, у которого есть удобства. Проверить: иконки и подписи удобств на месте, метка оплаты («без передоплати» / «передоплата»), работают фильтры и сортировка.

- [ ] **Step 6: Коммит (выполняет пользователь)**

```bash
git add public/app.js
```

```
refactor(i18n): extract app.js strings to T dictionary, part 3 of 6 - amenities and results
```

---

## Task 5: Строки app.js, участок 4 (карточки рейсов и скидки)

21 литерал на строках 700-899.

**Files:**
- Modify: `public/app.js:700-899`

**Interfaces:**
- Consumes: `T`, `plural`
- Produces: `T.card`, `T.discounts`

- [ ] **Step 1: Дополнить T_UK**

Ветки `T_UK.card` (подписи карточки рейса, кнопка «Деталі рейсу», «Показати ще», счётчик свободных мест) и `T_UK.discounts` (подписи блока скидок).

Счётчик мест использует множественное число - хранить формы массивом:

```javascript
            seatForms: ['місце', 'місця', 'місць']
```

- [ ] **Step 2: Заменить литералы в ticketCardHtml, wireCards, updateMoreBtn, loadMore, fetchDiscounts**

Функции `ticketCardHtml` (`app.js:723`), `wireCards` (`app.js:785`), `updateMoreBtn` (`app.js:818`), `loadMore` (`app.js:832`), `fetchDiscounts` (`app.js:855`).

**Не трогать** `isGroupPrepay` и `groupThreshold` - они уже вне участка, но при поиске по файлу их легко задеть. Проверить, что строки 29 и 33-37 не изменены.

- [ ] **Step 3: Проверить, что парсер скидок не тронут**

Run: `git diff public/app.js | grep -E "^[-+].*(груп|двох|трьох)"`
Expected: пустой вывод

- [ ] **Step 4: Проверить набор строк**

Run: `node tools/check-ua-strings.js HEAD`
Expected: `OK: набор строк не изменился`

- [ ] **Step 5: Проверить в браузере**

Найти направление с числом рейсов больше 20. Проверить: карточки, кнопка «Показати ще» догружает порцию, счётчик свободных мест согласован по числу, блок скидок открывается.

- [ ] **Step 6: Коммит (выполняет пользователь)**

```bash
git add public/app.js
```

```
refactor(i18n): extract app.js strings to T dictionary, part 4 of 6 - route cards and discounts
```

---

## Task 6: Строки app.js, участок 5 (пассажиры и выбор места)

26 литералов на строках 900-1199.

**Files:**
- Modify: `public/app.js:900-1199`

**Interfaces:**
- Consumes: `T`, `plural`
- Produces: `T.pax`, `T.seats`

- [ ] **Step 1: Дополнить T_UK ветками pax и seats**

`T_UK.pax` - подписи полей пассажира, кнопка добавления, итоговая сумма, подписи скидок по возрасту. `T_UK.seats` - подписи схемы салона, подсказка о выборе мест, состояния загрузки.

Подсказка о числе выбранных мест (`updateSeatHint`, `app.js:1118`) использует множественное число - через `plural` и `T.card.seatForms`.

- [ ] **Step 2: Заменить литералы**

Функции `paxRowHtml` (`app.js:895`), `renderDiscBlock` (`app.js:918`), `updateTotal` (`app.js:961`), `addPax` (`app.js:971`), `seatCellHtml` (`app.js:1053`), `renderSeatLaunch` (`app.js:1067`), `renderSeatSheetBody` (`app.js:1097`), `updateSeatHint` (`app.js:1118`), `seatSyncPax` (`app.js:1130`).

- [ ] **Step 3: Проверить набор строк**

Run: `node tools/check-ua-strings.js HEAD`
Expected: `OK: набор строк не изменился`

- [ ] **Step 4: Проверить в браузере**

Открыть модальное окно заказа. Проверить: добавление и удаление пассажира, перенумерация строк, подсчёт итоговой суммы со скидками. Для рейса с выбором мест - открыть схему салона, выбрать места, убедиться, что подсказка согласована по числу.

- [ ] **Step 5: Коммит (выполняет пользователь)**

```bash
git add public/app.js
```

```
refactor(i18n): extract app.js strings to T dictionary, part 5 of 6 - passengers and seat picker
```

---

## Task 7: Строки app.js, участок 6 (модальное окно и отправка заказа)

21 литерал на строках 1200 и далее. Завершает рефакторинг.

**Files:**
- Modify: `public/app.js:1200-1596`

**Interfaces:**
- Consumes: `T`
- Produces: `T.modal`, `T.order`

- [ ] **Step 1: Дополнить T_UK ветками modal и order**

`T_UK.modal` - сводка рейса, подпись «/ місце», запасное название перевозчика `'Автобус'` (`app.js:1283`). `T_UK.order` - подписи формы, сообщения об успехе и ошибках отправки, текст предохранителя.

- [ ] **Step 2: Заменить литералы**

- [ ] **Step 3: Проверить набор строк**

Run: `node tools/check-ua-strings.js HEAD`
Expected: `OK: набор строк не изменился`

- [ ] **Step 4: Проверить, что в app.js не осталось украинских литералов вне T_UK**

```bash
node -e "
const fs=require('fs');
const src=fs.readFileSync('public/app.js','utf8');
const start=src.indexOf('const T_UK = {');
const end=src.indexOf('const T = (window.__I18N__');
const outside=src.slice(0,start)+src.slice(end);
const cyr=/[А-Яа-яІіЇїЄєҐґ]/;
const bad=[];
outside.split(/\r?\n/).forEach((l,i)=>{
  const code=l.replace(/\/\/.*\$/,'');
  (code.match(/'[^']*'|\"[^\"]*\"/g)||[]).forEach(s=>{ if(cyr.test(s)) bad.push(s); });
});
console.log(bad.length?'ЗАЛИШИЛИСЬ ПОЗА T_UK:\n  '+bad.join('\n  '):'OK: усі рядки у словнику');
"
```

Expected: остаются только литералы парсера - `'груп'`-паттерн и формы `'двох'`, `'трьох'`, `'чотирьох'`, `'пяти'`, `'шести'`. Это данные API, а не интерфейс. Любой другой литерал - недоделка.

- [ ] **Step 5: Полная проверка в браузере**

Пройти путь целиком: поиск, детали рейса, заполнение формы, отправка заявки. Убедиться, что заявка создаётся и появляется страница подтверждения с токеном.

- [ ] **Step 6: Коммит (выполняет пользователь)**

```bash
git add public/app.js
```

```
refactor(i18n): extract app.js strings to T dictionary, part 6 of 6 - order modal

Completes the string extraction. Ukrainian output is unchanged: tools/check-ua-strings.js
verifies the literal set is identical to the pre-refactor revision.
```

---

## Task 8: Строки common.js

`common.js` подключается на всех страницах, включая юридические. Строк немного, но без них английская страница покажет украинский cookie-банер.

**Files:**
- Modify: `public/common.js`

**Interfaces:**
- Consumes: `window.__I18N__` (ветка `common`)
- Produces: ничего для других задач

- [ ] **Step 1: Добавить словарь в common.js**

`common.js` - отдельный IIFE, у него нет доступа к `T` из `app.js`, и он грузится раньше. Собственный маленький словарь:

```javascript
    var LANG = document.documentElement.lang === 'en' ? 'en' : 'uk';
    var C_UK = {
        cookieAria: 'Згода на використання cookie',
        cookieText: 'Ми використовуємо cookie, щоб сайт працював зручно і ми могли робити його кращим для вас. Натисніть «Прийняти» - це допомагає нам покращувати сервіс. Детальніше - у <a href="/cookies">Політиці cookie</a>.',
        cookieAccept: 'Прийняти',
        cookieMinimal: 'Лише необхідні',
        scrollTop: 'Нагору'
    };
    var C = (window.__I18N__ && window.__I18N__.common) || C_UK;
```

- [ ] **Step 2: Заменить литералы**

Строки 61, 65, 68, 69 (`showBanner`) и 89 (`initScrollTop`).

Ссылка в английском тексте ведёт на `/cookies` - украинскую страницу, потому что юридические документы не переводятся. Английский текст должен об этом честно сообщать: `Details in our <a href="/cookies">Cookie Policy</a> (Ukrainian).`

- [ ] **Step 3: Проверить в браузере**

Очистить localStorage, перезагрузить главную. Проверить: банер появляется, «Прийняти» его закрывает и больше не показывает, кнопка «нагору» появляется при прокрутке.

- [ ] **Step 4: Коммит (выполняет пользователь)**

```bash
git add public/common.js
```

```
refactor(i18n): extract common.js strings to dictionary - cookie banner and scroll-top
```

---

## Task 9: Сборка английских страниц

Первая задача, в которой появляется английский. Генерирует `public/en/index.html` и `public/i18n/en.js`.

**Files:**
- Create: `build-i18n.js`
- Create: `i18n/en.json`
- Modify: `public/index.html` (атрибуты `data-i18n`)
- Modify: `build-routes.js:210` (вызов)

**Interfaces:**
- Consumes: `T_UK` из `app.js` (как перечень ключей), `C_UK` из `common.js`
- Produces:
  - `public/en/index.html` - английская главная
  - `public/i18n/en.js` - файл-оверрайд, задаёт `window.__I18N__ = { app: {...}, common: {...} }`

- [ ] **Step 1: Разметить index.html атрибутами**

Каждый переводимый узел получает `data-i18n="ключ"`, атрибуты - `data-i18n-attr="имя:ключ;имя2:ключ2"`.

```html
<h1 class="hero-title" data-i18n-html="hero.title">Ваша <em>подорож</em><br>починається тут</h1>
<p data-i18n-html="hero.sub">Знайдіть зручний рейс за хвилину.<br>Без реєстрації та зайвих кроків.</p>
```

```html
<label class="s-lbl" for="departure" data-i18n="search.fromLabel">Звідки</label>
<input type="text" id="departure" data-i18n-attr="placeholder:search.fromPlaceholder" placeholder="Місто відправлення" autocomplete="off">
```

Три атрибута, каждый со своей ролью:

| Атрибут | Что заменяет |
|---|---|
| `data-i18n` | `textContent` узла |
| `data-i18n-html` | `innerHTML` узла (когда внутри есть разметка: `<em>`, `<br>`) |
| `data-i18n-attr` | перечисленные атрибуты |

Украинская сборка атрибуты не читает - вывод не меняется ни на символ.

- [ ] **Step 2: Написать build-i18n.js**

```javascript
// Генерує англійські сторінки з українських шаблонів + i18n/en.json.
// Викликається з build-routes.js наприкінці; працює і окремо: node build-i18n.js
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, 'public');
const EN = path.join(PUB, 'en');
const dict = JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n', 'en.json'), 'utf8'));

const lookup = key => key.split('.').reduce((o, k) => (o == null ? o : o[k]), dict);

const escAttr = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const escHtml = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const missing = [];

// Заміна вмісту вузла за data-i18n / data-i18n-html.
// Працює регуляркою по розмітці: DOM-парсера в залежностях немає і не буде.
function translateNodes(html) {
    return html.replace(
        /<([a-z0-9]+)([^>]*?\bdata-i18n(-html)?="([^"]+)"[^>]*?)>([\s\S]*?)<\/\1>/gi,
        (full, tag, attrs, isHtml, key, inner) => {
            const val = lookup(key);
            if (val == null) { missing.push(key); return full; }
            return `<${tag}${attrs}>${isHtml ? val : escHtml(val)}</${tag}>`;
        }
    );
}

// Заміна атрибутів за data-i18n-attr="placeholder:key;aria-label:key2"
function translateAttrs(html) {
    return html.replace(/<([a-z0-9]+)([^>]*\bdata-i18n-attr="([^"]+)"[^>]*)>/gi, (full, tag, attrs, spec) => {
        let out = attrs;
        for (const pair of spec.split(';')) {
            const [name, key] = pair.split(':').map(s => s.trim());
            if (!name || !key) continue;
            const val = lookup(key);
            if (val == null) { missing.push(key); continue; }
            const re = new RegExp(`\\b${name}="[^"]*"`);
            out = re.test(out) ? out.replace(re, `${name}="${escAttr(val)}"`) : `${out} ${name}="${escAttr(val)}"`;
        }
        return `<${tag}${out}>`;
    });
}

function enPage(srcFile) {
    let html = fs.readFileSync(path.join(PUB, srcFile), 'utf8');
    html = translateAttrs(translateNodes(html));
    html = html.replace('<html lang="uk">', '<html lang="en">');
    // noindex замість index: англійська версія навмисно не індексується
    html = html.replace(/<meta name="robots" content="[^"]*">/, '<meta name="robots" content="noindex, nofollow">');
    // canonical при noindex зайвий і дав би суперечливий сигнал
    html = html.replace(/\s*<link rel="canonical"[^>]*>/, '');
    html = html.replace(/<meta property="og:locale" content="uk_UA">/, '<meta property="og:locale" content="en">');
    // словник підвантажується ПЕРЕД app.min.js
    html = html.replace('<script src="/common.min.js', '<script src="/i18n/en.js"></script>\n<script src="/common.min.js');
    // відносні посилання всередині англійської версії
    html = html.replace(/href="\/faq"/g, 'href="/en/faq"');
    return html;
}

fs.mkdirSync(EN, { recursive: true });
const pages = ['index.html'];
for (const p of pages) fs.writeFileSync(path.join(EN, p), enPage(p));

// Файл-оверрайд для клієнта
fs.writeFileSync(path.join(PUB, 'i18n', 'en.js'),
    'window.__I18N__=' + JSON.stringify({ app: dict.app, common: dict.common }) + ';');

if (missing.length) {
    console.error('[i18n] Немає перекладу для ключів:\n  ' + [...new Set(missing)].join('\n  '));
    process.exit(1);
}
console.log(`[i18n] Згенеровано англійських сторінок: ${pages.length}`);
```

Отсутствующий ключ **роняет сборку**, а не подставляет украинский текст молча.

- [ ] **Step 3: Создать i18n/en.json**

Структура: ветка `app` повторяет `T_UK` из `app.js`, ветка `common` повторяет `C_UK`, остальные ключи верхнего уровня - для разметки страниц (`hero`, `search`, `how`, `footer` и так далее).

Функции из `T_UK` в JSON не кладутся: вместо `citiesReady: n => ...` в JSON лежит строка с плейсхолдером `"{n} cities available - choose your route"`, а `public/i18n/en.js` собирается билдом с превращением плейсхолдеров в функции. Для этого в `build-i18n.js` добавить:

```javascript
// Рядки з {n} стають функціями: інтерполяція має належати словнику,
// бо порядок слів у мовах різний.
const FN_KEYS = ['app.status.citiesReady', 'app.search.error', 'app.suggest.otherDate', 'app.suggest.showOtherDate'];
const fnSrc = JSON.stringify(FN_KEYS);
```

и в генерируемый `en.js` дописать развёртку:

```javascript
fs.writeFileSync(path.join(PUB, 'i18n', 'en.js'),
    'window.__I18N__=' + JSON.stringify({ app: dict.app, common: dict.common }) + ';'
    + `(function(d){${fnSrc}.forEach(function(p){var ks=p.split('.').slice(1),o=d;`
    + `for(var i=0;i<ks.length-1;i++)o=o[ks[i]];var k=ks[ks.length-1],s=o[k];`
    + `o[k]=function(v){return String(s).replace('{n}',v).replace('{d}',v).replace('{msg}',v);};});})(window.__I18N__.app);`
);
```

Аргумент - именно `window.__I18N__.app`, потому что `FN_KEYS` содержат путь с префиксом `app.`, а `slice(1)` этот префикс отбрасывает. Передать сюда `window.__I18N__` целиком - значит искать `status.citiesReady` на уровень выше, чем надо, и получить `undefined`.
```

- [ ] **Step 4: Подключить к сборке**

В `build-routes.js`, сразу после `require('./build-legal.js');` (строка 210):

```javascript
require('./build-i18n.js');
```

- [ ] **Step 5: Собрать**

Run: `node build-routes.js`
Expected: в выводе появляется `[i18n] Згенеровано англійських сторінок: 1`, файл `public/en/index.html` существует.

- [ ] **Step 6: Проверить, что украинская главная не изменилась**

Run: `git diff --stat public/index.html`
Expected: изменены только строки с добавленными атрибутами `data-i18n*`; ни одна строка с видимым текстом не изменена по содержанию.

- [ ] **Step 7: Проверить в браузере**

Открыть `/en/`. Проверить: интерфейс английский, поиск работает, в исходнике страницы есть `noindex, nofollow` и `<html lang="en">`.

- [ ] **Step 8: Коммит (выполняет пользователь)**

```bash
git add build-i18n.js i18n/ public/index.html public/en/ public/i18n/ build-routes.js
```

```
feat(i18n): build English pages from Ukrainian templates - /en/ home page, noindex
```

---

## Task 10: Переключатель языка и блок популярных направлений

**Files:**
- Modify: `public/index.html` (шапка, блок `pop-routes`)
- Modify: `public/styles.css` (стиль переключателя)
- Modify: `public/app.js` (поведение плиток на EN)
- Modify: `build-i18n.js` (правка ссылок переключателя для EN)

**Interfaces:**
- Consumes: `LANG` из задачи 2
- Produces: ничего для других задач

- [ ] **Step 1: Добавить переключатель в шапку**

В `public/index.html`, внутри `<header>` после блока телефона:

```html
    <div class="lang-switch">
        <a href="/" class="lang-cur" aria-current="true">UA</a>
        <a href="/en/" hreflang="en">EN</a>
    </div>
```

Шапка извлекается `build-routes.js` и переиспользуется страницами маршрутов и юридическими. На них английских двойников нет, поэтому ссылка ведёт на `/en/` - английскую главную. Это осознанно: лучше корректная главная, чем ссылка в никуда.

- [ ] **Step 2: В английской сборке поменять местами текущий и целевой**

В `build-i18n.js`, внутри `enPage`, до общей замены ссылок:

```javascript
    // Перемикач: на англійській сторінці поточна - EN, посилання веде на українську
    html = html.replace(
        /<div class="lang-switch">[\s\S]*?<\/div>/,
        '<div class="lang-switch">\n        <a href="/" hreflang="uk">UA</a>\n        <a href="/en/" class="lang-cur" aria-current="true">EN</a>\n    </div>'
    );
```

- [ ] **Step 3: Стиль переключателя**

В `public/styles.css`:

```css
.lang-switch { display: flex; gap: 2px; align-items: center; margin-left: auto; }
.lang-switch a { padding: 6px 10px; border-radius: 8px; font-size: 14px; font-weight: 600; color: var(--muted); text-decoration: none; }
.lang-switch a:hover { background: rgba(0,0,0,.05); }
.lang-switch .lang-cur { background: var(--accent); color: #fff; }
```

Имена переменных сверить с существующими в `styles.css` - использовать те, что уже есть в файле, а не вводить новые.

- [ ] **Step 4: Плитки популярных направлений на английской версии**

На `/en/` плитки не должны вести на украинские SEO-страницы. В `app.js` добавить обработчик:

```javascript
    // На англійській версії сторінок маршрутів немає: плитка не навігує,
    // а підставляє напрямок у форму й запускає пошук на місці.
    if (LANG === 'en') {
        const pop = document.getElementById('pop-routes');
        if (pop) pop.addEventListener('click', e => {
            const a = e.target.closest('a.seo-tag');
            if (!a) return;
            e.preventDefault();
            const r = POPULAR.find(x => a.getAttribute('href') === `/${x.slug}`);
            if (r) applyRoute(r);
        });
    }
```

Это требует, чтобы у элементов `POPULAR` был `slug`. Дополнить массив (`app.js:193-198`) полем `slug` со значениями из `routes.json`: `kyiv-varshava`, `lviv-krakiv`, `kyiv-krakiv`, `lviv-varshava`, `kyiv-berlin`, `lviv-praha`.

Блок `pop-routes` в `index.html` содержит 12 плиток, а `POPULAR` - 6. Для остальных шести добавить записи в `POPULAR` с обратными направлениями и их слагами, взяв `fi`/`ti` из `routes.json`.

- [ ] **Step 5: Проверить в браузере**

На `/` нажать EN - попасть на `/en/`. На `/en/` нажать UA - вернуться на `/`. На `/en/` нажать плитку популярного направления - направление подставляется в форму и запускается поиск, адрес страницы не меняется.

- [ ] **Step 6: Коммит (выполняет пользователь)**

```bash
git add public/index.html public/styles.css public/app.js build-i18n.js
```

```
feat(i18n): language switcher in header; popular routes search in place on EN
```

---

## Task 11: Английская страница FAQ

**Files:**
- Modify: `public/faq.html` (атрибуты `data-i18n`)
- Modify: `build-i18n.js` (добавить в список страниц)
- Modify: `i18n/en.json` (ветка `faq`)

**Interfaces:**
- Consumes: механизм из задачи 9
- Produces: `public/en/faq.html`

- [ ] **Step 1: Разметить faq.html**

Страница содержит около 3500 украинских слов - это самый объёмный перевод в плане. Каждый `<summary>` и `<div class="faq-a">` получает свой ключ вида `faq.q1`, `faq.a1`.

- [ ] **Step 2: Перевести в i18n/en.json**

Перевод смысловой, не дословный: часть вопросов касается реалий украинского рынка и для англоязычного читателя формулируется иначе.

- [ ] **Step 3: Добавить страницу в сборку**

В `build-i18n.js` заменить:

```javascript
const pages = ['index.html'];
```

на:

```javascript
const pages = ['index.html', 'faq.html'];
```

- [ ] **Step 4: Убрать FAQ-схему из английской версии**

Разметка `application/ld+json` типа `FAQPage` нужна для поисковой выдачи. На `noindex`-странице она бессмысленна и может дать противоречивый сигнал. В `enPage` добавить:

```javascript
    // FAQPage-розмітка на noindex-сторінці не має сенсу
    html = html.replace(/\s*<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
```

- [ ] **Step 5: Собрать и проверить**

Run: `node build-routes.js`
Expected: `[i18n] Згенеровано англійських сторінок: 2`

Открыть `/en/faq` - страница на английском, аккордеоны раскрываются.

- [ ] **Step 6: Коммит (выполняет пользователь)**

```bash
git add public/faq.html build-i18n.js i18n/en.json public/en/
```

```
feat(i18n): English FAQ page - drop FAQPage schema from noindex output
```

---

## Task 12: Английская страница брони по токену

**Files:**
- Modify: `public/booking.html`
- Modify: `build-i18n.js`
- Modify: `server.js` (маршрут `/en/t/:token`)
- Modify: `i18n/en.json` (ветка `booking`)

**Interfaces:**
- Consumes: механизм из задачи 9
- Produces: `public/en/booking.html`, маршрут `/en/t/:token`

- [ ] **Step 1: Разметить booking.html**

139 украинских слов - самая небольшая из страниц.

- [ ] **Step 2: Добавить маршрут в server.js**

Рядом с существующим (`server.js:80`):

```javascript
app.get('/en/t/:token', (req, res) => res.sendFile(require('path').join(__dirname, 'public', 'en', 'booking.html')));
```

Порядок важен: маршрут должен стоять до `express.static`, иначе статика перехватит путь.

- [ ] **Step 3: Добавить страницу в сборку**

```javascript
const pages = ['index.html', 'faq.html', 'booking.html'];
```

- [ ] **Step 4: Проверить**

Создать тестовую заявку через `/en/`, взять токен из ответа, открыть `/en/t/<токен>`. Страница брони на английском, данные подтягиваются.

- [ ] **Step 5: Коммит (выполняет пользователь)**

```bash
git add public/booking.html build-i18n.js server.js i18n/en.json public/en/
```

```
feat(i18n): English booking status page at /en/t/:token
```

---

## Task 13: Английские сообщения об ошибках сервера

**Files:**
- Modify: `server.js`
- Modify: `public/app.js` (добавление `?lang=en` к запросам)

**Interfaces:**
- Consumes: `LANG` из задачи 2
- Produces: ничего для других задач

- [ ] **Step 1: Получить точный список сообщений**

```bash
grep -n -oE "error: '[^']+'" server.js | sort -u
```

Вывод - исчерпывающий перечень строк, уходящих клиенту (ожидается 24 штуки). Работать по нему, а не по памяти.

- [ ] **Step 2: Добавить словарь ошибок в server.js**

Собрать все строки из шага 1 в одну карту рядом с местом объявления констант:

```javascript
// Повідомлення про помилки, що доходять до клієнта. Мова - з ?lang=en,
// будь-яке інше значення або його відсутність означає українську.
const ERR = {
    tooManyRequests: { uk: 'Забагато запитів. Зачекайте хвилину.', en: 'Too many requests. Please wait a minute.' },
    // далі - решта ключів зі списку кроку 1, по одному рядку на повідомлення
};
const errText = (req, key) => ERR[key][req.query.lang === 'en' ? 'en' : 'uk'];
```

Ключ именуется по смыслу сообщения (`tooManyRequests`, `cityNotFound`), а не по номеру. Заменить литералы в обработчиках на `errText(req, 'ключ')`.

Обращение `ERR[key]` намеренно без защиты: ключ приходит из соседней строки того же файла, а не извне. Опечатка должна упасть сразу, а не отдать клиенту `undefined`.

- [ ] **Step 3: Передавать язык с клиента**

В `app.js` в месте формирования базового пути API:

```javascript
    const PROXY_BASE = '/api';
    // Мова впливає ЛИШЕ на текст помилки. Ключі кешу пошуку й міст від неї не залежать:
    // дані API однакові для обох версій.
    const LANG_Q = LANG === 'en' ? '?lang=en' : '';
```

Добавлять `LANG_Q` к запросам, чьи ошибки показываются пользователю. Там, где в URL уже есть параметры, использовать `&lang=en` - проверить каждое место, а не заменять вслепую.

- [ ] **Step 4: Проверить**

На `/en/` отправить форму заказа с пустыми полями - сообщение об ошибке на английском. На `/` то же самое - на украинском.

- [ ] **Step 5: Коммит (выполняет пользователь)**

```bash
git add server.js public/app.js
```

```
feat(i18n): English server error messages via ?lang=en - cache keys unaffected
```

---

## Task 14: Транслитерация КМУ-2010

С этой задачи начинается перевод данных из API.

**Files:**
- Create: `i18n/translit.js`
- Create: `tests/i18n.test.js`

**Interfaces:**
- Produces: `translit(str)` - строка → латиница по стандарту КМУ-2010. Модуль работает и в Node (`module.exports`), и в браузере (присваивание в `window`).

- [ ] **Step 1: Написать тест**

```javascript
// tests/i18n.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { translit } = require('../i18n/translit.js');

test('транслітерація КМУ-2010: міста', () => {
    assert.equal(translit('Київ'), 'Kyiv');
    assert.equal(translit('Львів'), 'Lviv');
    assert.equal(translit('Ужгород'), 'Uzhhorod');
    assert.equal(translit('Запоріжжя'), 'Zaporizhzhia');
    assert.equal(translit('Чернігів'), 'Chernihiv');
});

test('транслітерація: є/ї/й/ю/я на початку слова і в середині', () => {
    // На початку слова: Ye, Yi, Y, Yu, Ya. Усередині: ie, i, i, iu, ia.
    assert.equal(translit('Єнакієве'), 'Yenakiieve');
    assert.equal(translit('Їжакевич'), 'Yizhakevych');
    assert.equal(translit('Йосипівка'), 'Yosypivka');
    assert.equal(translit('Юрій'), 'Yurii');
    assert.equal(translit('Яготин'), 'Yahotyn');
});

test('транслітерація: зг передається як zgh, а не zh', () => {
    assert.equal(translit('Згорани'), 'Zghorany');
});

test('транслітерація зберігає пунктуацію і латиницю', () => {
    assert.equal(translit('вул. Петлюри, 32'), 'vul. Petliury, 32');
    assert.equal(translit('Kyiv Central'), 'Kyiv Central');
});
```

- [ ] **Step 2: Запустить тест - должен упасть**

Run: `node --test tests/i18n.test.js`
Expected: FAIL, `Cannot find module '../i18n/translit.js'`

- [ ] **Step 3: Написать модуль**

```javascript
// Транслітерація українського тексту латиницею за стандартом КМУ №55 (2010) -
// тим самим, за яким оформлюють закордонні паспорти й вуличні таблички.
// Працює і в Node (тести, білд), і в браузері (app.js на англійській версії).
(function (root) {
    'use strict';

    // Літери, що залежать від позиції: на початку слова одне, усередині інше.
    var POS = { 'є': ['Ye', 'ie'], 'ї': ['Yi', 'i'], 'й': ['Y', 'i'], 'ю': ['Yu', 'iu'], 'я': ['Ya', 'ia'] };

    var MAP = {
        'а': 'a', 'б': 'b', 'в': 'v', 'г': 'h', 'ґ': 'g', 'д': 'd', 'е': 'e', 'ж': 'zh',
        'з': 'z', 'и': 'y', 'і': 'i', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
        'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts',
        'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ь': '', 'ʼ': '', "'": '', '’': ''
    };

    function translit(str) {
        var s = String(str == null ? '' : str);
        var out = '';
        for (var i = 0; i < s.length; i++) {
            var ch = s[i];
            var low = ch.toLowerCase();
            var upper = ch !== low;
            // Початок слова - або початок рядка, або попередній символ не літера
            var atStart = i === 0 || !/[А-Яа-яІіЇїЄєҐґA-Za-z’ʼ']/.test(s[i - 1]);

            // Сполука "зг" передається як "zgh", інакше "зг" і "ж" збіглись би в "zh"
            if (low === 'з' && s[i + 1] && s[i + 1].toLowerCase() === 'г') {
                out += upper ? 'Zgh' : 'zgh';
                i++;
                continue;
            }

            var res;
            if (POS[low]) {
                res = POS[low][atStart ? 0 : 1];
            } else if (Object.prototype.hasOwnProperty.call(MAP, low)) {
                res = MAP[low];
                if (upper && res) res = res[0].toUpperCase() + res.slice(1);
            } else {
                out += ch;
                continue;
            }
            if (upper && POS[low]) res = res[0].toUpperCase() + res.slice(1);
            else if (!upper && POS[low]) res = res.toLowerCase();
            out += res;
        }
        return out;
    }

    if (typeof module !== 'undefined' && module.exports) module.exports = { translit: translit };
    else root.translit = translit;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Запустить тест - должен пройти**

Run: `node --test tests/i18n.test.js`
Expected: PASS, все четыре теста

- [ ] **Step 5: Коммит (выполняет пользователь)**

```bash
git add i18n/translit.js tests/i18n.test.js
```

```
feat(i18n): KMU-2010 transliteration module with tests
```

---

## Task 15: Словарь экзонимов и глоссарий остановок

**Files:**
- Create: `i18n/cities-en.json`
- Create: `i18n/geo-en.json`
- Modify: `tests/i18n.test.js`

**Interfaces:**
- Consumes: `translit` из задачи 14
- Produces:
  - `cities-en.json` - объект `{ "<id города>": "English name" }`
  - `geo-en.json` - объект `{ "<украинское служебное слово>": "English" }`

- [ ] **Step 1: Получить список городов, по которым реально ищут**

```bash
node --disable-warning=ExperimentalWarning -e "
const {DatabaseSync}=require('node:sqlite');
const d=new DatabaseSync('./orders.db',{readOnly:true});
const rows=d.prepare('select from_name n, count(*) c from searches group by from_name union select to_name n, count(*) c from searches group by to_name order by c desc').all();
rows.forEach(r=>console.log(r.c, r.n));
"
```

Это даёт приоритет: города с реальным спросом попадают в словарь в первую очередь.

- [ ] **Step 2: Заполнить cities-en.json только экзонимами**

Записи нужны **лишь там, где транслитерация даёт не то слово**. Проверка перед добавлением:

```bash
node -e "const {translit}=require('./i18n/translit.js');['Варшава','Краків','Прага','Відень','Мюнхен','Київ','Львів','Одеса'].forEach(c=>console.log(c,'->',translit(c)))"
```

Ожидается: `Варшава -> Varshava` (нужна запись `Warsaw`), `Київ -> Kyiv` (запись не нужна).

Ключ - числовой `id` города из `/api/cities`, а не название: названия приходят из API и могут меняться, id стабилен.

```json
{
  "97": "Warsaw",
  "287": "Krakow",
  "460": "Prague",
  "49": "Berlin"
}
```

Полный список собрать по городам из `routes.json` и по выборке из шага 1.

- [ ] **Step 3: Заполнить geo-en.json**

```json
{
  "автостанція": "bus station",
  "ас": "bus station",
  "автовокзал": "bus terminal",
  "залізничний вокзал": "railway station",
  "вокзал": "station",
  "метро": "metro",
  "платформа": "platform",
  "вул.": "St.",
  "вулиця": "Street",
  "просп.": "Ave.",
  "проспект": "Avenue",
  "буд.": "bld.",
  "зупинка": "stop"
}
```

Порядок применения - от длинных ключей к коротким, иначе `вокзал` съест `залізничний вокзал`.

- [ ] **Step 4: Добавить тесты**

```javascript
test('словник екзонімів містить лише випадки, де транслітерація хибна', () => {
    const cities = require('../i18n/cities-en.json');
    const { translit } = require('../i18n/translit.js');
    // Київ транслітерується правильно - запису бути не повинно
    const values = Object.values(cities);
    assert.ok(values.includes('Warsaw'), 'Варшава має бути у словнику');
    assert.ok(!values.includes('Kyiv'), 'Київ транслітерується сам, запис зайвий');
});

test('глосарій: складений ключ застосовується раніше за свою частину', () => {
    const geo = require('../i18n/geo-en.json');
    // Порядок, у якому глосарій застосовується в app.js: від довгих ключів до коротких
    const order = Object.keys(geo).sort((a, b) => b.length - a.length);

    // Для КОЖНОЇ пари, де один ключ міститься в іншому, довший мусить іти першим -
    // інакше «вокзал» з'їсть «залізничний вокзал» і переклад вийде неповним.
    for (const long of order) {
        for (const short of order) {
            if (long === short || !long.includes(short)) continue;
            assert.ok(
                order.indexOf(long) < order.indexOf(short),
                `"${short}" застосується раніше за "${long}" і зіпсує його`
            );
        }
    }
});
```

- [ ] **Step 5: Запустить тесты**

Run: `node --test tests/i18n.test.js`
Expected: PASS

- [ ] **Step 6: Коммит (выполняет пользователь)**

```bash
git add i18n/cities-en.json i18n/geo-en.json tests/i18n.test.js
```

```
feat(i18n): city exonyms and station glossary - dictionary only where transliteration is wrong
```

---

## Task 16: Перевод данных API на клиенте

**Files:**
- Modify: `public/app.js`
- Modify: `build-i18n.js` (вкладывать словари в `en.js`)

**Interfaces:**
- Consumes: `translit`, `cities-en.json`, `geo-en.json`
- Produces:
  - `cityName(id, fallback)` - английское название города или транслитерация
  - `stationName(text)` - адрес остановки: глоссарий плюс транслитерация

- [ ] **Step 1: Вложить словари и транслитерацию в en.js**

В `build-i18n.js` дописать к генерации `public/i18n/en.js`:

```javascript
const translitSrc = fs.readFileSync(path.join(__dirname, 'i18n', 'translit.js'), 'utf8');
const cities = JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n', 'cities-en.json'), 'utf8'));
const geo = JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n', 'geo-en.json'), 'utf8'));
```

и включить их в записываемый файл: сначала `translitSrc`, затем присваивание `window.__I18N__` с ветками `cities` и `geo`.

- [ ] **Step 2: Добавить функции перевода в app.js**

```javascript
    // --- Переклад даних API ------------------------------------------------
    // Дані з «Контрабаса» приходять українською. На англійській версії
    // перекладаємо ПІД ЧАС ВІДМАЛЮВАННЯ: кеші пошуку й міст від мови не залежать.
    const I18N_CITIES = (window.__I18N__ && window.__I18N__.cities) || null;
    const I18N_GEO = (window.__I18N__ && window.__I18N__.geo) || null;
    // Ключі глосарію - від довгих до коротких, інакше «вокзал» перехопить «залізничний вокзал»
    const GEO_KEYS = I18N_GEO ? Object.keys(I18N_GEO).sort((a, b) => b.length - a.length) : [];

    function cityName(id, fallback) {
        if (LANG !== 'en') return fallback;
        if (I18N_CITIES && I18N_CITIES[id]) return I18N_CITIES[id];
        const t = typeof window.translit === 'function' ? window.translit(fallback) : fallback;
        if (t === fallback && /[А-Яа-яІіЇїЄєҐґ]/.test(fallback)) reportUnknownCity(id, fallback);
        return t;
    }

    function stationName(text) {
        if (LANG !== 'en' || !text) return text;
        let s = String(text);
        for (const k of GEO_KEYS) {
            s = s.replace(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), I18N_GEO[k]);
        }
        return typeof window.translit === 'function' ? window.translit(s) : s;
    }
```

- [ ] **Step 3: Добавить телеметрию по городам**

По образцу существующей `reportUnknownAmenity` (`app.js:526-535`):

```javascript
    // Пропуск у словнику має бути помітним, а не тихою кирилицею на англійській сторінці
    const _unkCity = new Set();
    function reportUnknownCity(id, name) {
        if (_unkCity.has(id) || _unkCity.size > 5) return;
        _unkCity.add(id);
        try {
            fetch('/api/client-error', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
                body: JSON.stringify({ msg: `Місто без англійської назви: id=${id} "${name}"`, page: location.pathname })
            });
        } catch (e) { }
    }
```

- [ ] **Step 4: Применить в местах отрисовки**

| Место | Что обернуть |
|---|---|
| `ac()` - автодополнение (`app.js:218`) | название города в подсказке через `cityName(c.id, c.name)` |
| `POPULAR` в автодополнении (`app.js:231-237`) | `r.f` и `r.t` через `cityName(r.fi, r.f)` и `cityName(r.ti, r.t)` |
| `renderResults` (`app.js:580`) | заголовок направления |
| `ticketCardHtml` (`app.js:723`) | станции через `stationName()` |
| Сводка модального окна (`app.js:1277-1285`) | `dep`, `arr` через `cityName`, `fromSt`, `toSt` через `stationName` |

**Критический инвариант:** в API уходит числовой `id`, никогда переведённое имя. Проверить, что `depId` и `arrId` формируются из данных, а не из отображаемого текста.

- [ ] **Step 5: Проверить, что поиск не сломан на украинской версии**

Run: `npm test`
Expected: все тесты проходят

На `/` выполнить поиск - названия городов украинские, как раньше.

- [ ] **Step 6: Проверить английскую версию в браузере**

На `/en/` выполнить поиск Киев - Варшава. Проверить: в автодополнении `Kyiv` и `Warsaw`, в выдаче английские названия, адреса остановок латиницей с английскими служебными словами, бронирование доходит до создания заявки.

- [ ] **Step 7: Коммит (выполняет пользователь)**

```bash
git add public/app.js build-i18n.js
```

```
feat(i18n): translate API data on render - city exonyms, station glossary, transliteration fallback
```

---

## Task 17: Тесты полноты перевода

Финальный предохранитель: ловит забытые строки без ручного просмотра.

**Files:**
- Modify: `tests/i18n.test.js`

**Interfaces:**
- Consumes: всё предыдущее

- [ ] **Step 1: Тест на отсутствие кириллицы в английских страницах**

```javascript
test('у згенерованих англійських сторінках немає кирилиці', () => {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '..', 'public', 'en');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));
    assert.ok(files.length >= 3, 'очікували index, faq, booking');
    const problems = [];
    for (const f of files) {
        const src = fs.readFileSync(path.join(dir, f), 'utf8');
        src.split(/\r?\n/).forEach((line, i) => {
            if (/[А-Яа-яІіЇїЄєҐґ]/.test(line)) problems.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
        });
    }
    assert.deepEqual(problems, [], 'знайдено кирилицю:\n' + problems.join('\n'));
});
```

- [ ] **Step 2: Тест паритета ключей**

```javascript
test('кожен ключ data-i18n має переклад, і зайвих ключів немає', () => {
    const fs = require('fs');
    const path = require('path');
    const dict = require('../i18n/en.json');
    const lookup = k => k.split('.').reduce((o, p) => (o == null ? o : o[p]), dict);

    const used = new Set();
    for (const f of ['index.html', 'faq.html', 'booking.html']) {
        const src = fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
        (src.match(/data-i18n(?:-html)?="([^"]+)"/g) || [])
            .forEach(m => used.add(m.replace(/.*="|"$/g, '')));
        (src.match(/data-i18n-attr="([^"]+)"/g) || []).forEach(m => {
            m.replace(/.*="|"$/g, '').split(';').forEach(p => {
                const k = p.split(':')[1];
                if (k) used.add(k.trim());
            });
        });
    }

    const missing = [...used].filter(k => lookup(k) == null);
    assert.deepEqual(missing, [], 'ключі без перекладу: ' + missing.join(', '));
});
```

- [ ] **Step 3: Тест ссылок переключателя**

```javascript
test('перемикач мови веде на існуючі сторінки', () => {
    const fs = require('fs');
    const path = require('path');
    const pub = path.join(__dirname, '..', 'public');
    const en = fs.readFileSync(path.join(pub, 'en', 'index.html'), 'utf8');
    assert.match(en, /<a href="\/" hreflang="uk">UA<\/a>/, 'з англійської має бути посилання на українську');
    const uk = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
    assert.match(uk, /href="\/en\/"/, 'з української має бути посилання на англійську');
    assert.ok(fs.existsSync(path.join(pub, 'en', 'index.html')));
});
```

- [ ] **Step 4: Тест на noindex**

```javascript
test('англійські сторінки закриті від індексації і не в sitemap', () => {
    const fs = require('fs');
    const path = require('path');
    const pub = path.join(__dirname, '..', 'public');
    for (const f of fs.readdirSync(path.join(pub, 'en')).filter(x => x.endsWith('.html'))) {
        const src = fs.readFileSync(path.join(pub, 'en', f), 'utf8');
        assert.match(src, /<meta name="robots" content="noindex, nofollow">/, `${f}: немає noindex`);
        assert.match(src, /<html lang="en">/, `${f}: не виставлено lang`);
        assert.ok(!/<link rel="canonical"/.test(src), `${f}: canonical при noindex зайвий`);
    }
    const sitemap = fs.readFileSync(path.join(pub, 'sitemap.xml'), 'utf8');
    assert.ok(!/\/en\//.test(sitemap), 'англійські сторінки не мають бути в sitemap');
});
```

- [ ] **Step 5: Запустить всё**

Run: `node build-routes.js && node --test tests/i18n.test.js`
Expected: PASS, все тесты

Затем полный прогон со смоук-тестами (нужен запущенный `npm start` в соседнем терминале):

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Коммит (выполняет пользователь)**

```bash
git add tests/i18n.test.js
```

```
test(i18n): completeness guards - no Cyrillic in EN output, key parity, noindex, switcher links
```

---

## Self-Review

**Покрытие спецификации:**

| Требование спека | Задача |
|---|---|
| URL-раскладка `/en/`, `/en/faq`, `/en/t/:token` | 9, 11, 12 |
| `noindex`, `lang="en"`, отсутствие в sitemap, без canonical | 9, 17 |
| Словари `en.json`, `cities-en.json`, `geo-en.json`, `translit.js` | 9, 14, 15 |
| Механизм `data-i18n` в HTML | 9 |
| Словарь `T` в app.js, оверрайд для EN | 2-7, 9 |
| Множественное число и даты | 2, 3 |
| Три уровня перевода данных API | 14, 15, 16 |
| Телеметрия неизвестных городов | 16 |
| Переключатель языка, без авторедиректа | 10 |
| Блок популярных направлений на EN | 10 |
| `/en/t/:token` в server.js | 12 |
| Ошибки сервера по `?lang=en` | 13 |
| Строки common.js | 8 |
| English README | 1 |
| Тесты полноты | 17 |

**Риски, снятые порядком задач:**

Рефакторинг `app.js` (задачи 2-7) идёт до появления английского и проверяется инструментом `tools/check-ua-strings.js`: набор украинских литералов обязан остаться идентичным. Каждая из шести задач - отдельный коммит, откат точечный.
