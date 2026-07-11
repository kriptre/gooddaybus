# Passenger UX + Reliability Batch - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Пассажир никогда не теряет билет (страница брони по токену + предохранитель + мессенджеры), а команда узнаёт об ошибках раньше пассажира (TG-алерты, health, смоук-тесты). Плюс автоподстановка пассажира и кнопка обратного рейса.

**Architecture:** Токен (32 hex-символа) генерируется при создании заявки, хранится в `orders.token`. Публичная страница `/t/<токен>` (standalone HTML, как admin.html) читает JSON из `GET /api/booking/:token`; PDF отдаются через наш прокси-эндпоинт (перекачиваем у contrabus, живут вечно). Алерты - через существующий `tg()` хелпер в отдельный чат. Тесты - `node --test` против запущенного dev-сервера.

**Tech Stack:** Node 22 (CommonJS), Express, node:sqlite, node:test, ванильный JS на фронте. Без новых зависимостей.

## Global Constraints

- Во всех видимых текстах короткий дефис «-», НИКОГДА не em-dash «—» (правило проекта).
- Язык интерфейса - украинский. Аудитория включает пожилых: крупные кнопки, простые слова.
- Никаких новых npm-зависимостей, платных сервисов, регистраций для пассажира.
- После правок фронта: `node -c public/app.js && node build-routes.js` (минификация + перегенерация 12 страниц маршрутов).
- Страница брони НЕ показывает телефон пассажира (ссылку могут пересылать).
- Реальные брони в contrabus НЕ создавать; для проверок - `BOOKING_DRY_RUN=1`.
- Коммит после каждой задачи. Push - только после явного одобрения пользователя.
- Пункт «соседние даты при пустом поиске» из тир-листа НЕ делать - уже реализован (`/api/suggest`, server.js:358).

## Известные якоря в коде (проверено 2026-07-11)

| Что | Где |
|---|---|
| `tg(method, body)` хелпер Telegram | server.js:428 |
| `notifyTelegram(order)` заявка менеджерам | server.js:574 |
| `serverError(res, err, tag)` | server.js:131 |
| `makeRateLimiter(windowMs, max)` + лимитеры | server.js:193-199 |
| `getToken()` логин contrabus | server.js (ищи `async function getToken`) |
| `createBooking(...)` возвращает `{ok, tickets:[{id,pdf}]}` | server.js:731 |
| `BOOKING_DRY_RUN` | server.js:126 |
| POST /api/order, ответ 201 | server.js:816, 976 |
| `createOrder(data)` INSERT | db.js:101 |
| Миграции колонок orders | db.js:73-82 |
| Успех-экран `#m-ok` разметка | public/index.html:372-376 |
| Обработка 201 на фронте | public/app.js:~1290-1315 |
| `closeBooking()` / Esc | public/app.js:~1140 |
| `paxRowHtml()` / `addPax()` | public/app.js:824, 900 |
| Clean URLs `extensions:['html']` | server.js:81 |
| Контакты: `t.me/gooddaybus`, `viber://chat?number=%2B380967656732`, `wa.me/380967656732` | public/index.html (футер) |

---

### Task 1: Смоук-тест-харнесс (node --test)

Первым - чтобы задачи 2-10 добавляли в него тесты (TDD).

**Files:**
- Create: `tests/smoke.test.js`
- Modify: `package.json` (scripts)

**Interfaces:**
- Produces: `BASE` (env `TEST_BASE` || `http://localhost:3000`), паттерн «тест против запущенного сервера». Последующие задачи дописывают `test(...)` в этот же файл.

- [ ] **Step 1: Создать tests/smoke.test.js**

```js
// Смоук-тести: ганяються проти ЗАПУЩЕНОГО dev-сервера (npm start в сусідньому терміналі).
// Нічого не пишуть у contrabus. Запуск: npm test
const { test } = require('node:test');
const assert = require('node:assert');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';

async function get(path, opts) {
    const r = await fetch(BASE + path, opts);
    let body = null;
    try { body = await r.clone().json(); } catch { body = await r.text(); }
    return { status: r.status, body, headers: r.headers };
}

test('сервер запущено (інакше: npm start в іншому терміналі)', async () => {
    let ok = false;
    try { await fetch(BASE + '/'); ok = true; } catch { }
    assert.ok(ok, `Сервер не відповідає на ${BASE} - запустіть npm start`);
});

test('GET / віддає html', async () => {
    const r = await get('/');
    assert.equal(r.status, 200);
    assert.match(String(r.body), /GoodDayBus/);
});

test('GET /api/cities - масив міст', async () => {
    const r = await get('/api/cities');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body) && r.body.length > 50, 'очікували великий масив міст');
});

test('POST /api/order без полів - 400', async () => {
    const r = await get('/api/order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    assert.equal(r.status, 400);
});

test('GET /api/orders без пароля - 401', async () => {
    const r = await get('/api/orders');
    assert.equal(r.status, 401);
});
```

- [ ] **Step 2: npm-скрипт**

В `package.json` в `"scripts"` добавить: `"test": "node --test tests/"`.

- [ ] **Step 3: Прогнать (сервер должен быть запущен)**

Run: `npm start` (фон) затем `npm test`
Expected: 5 pass, 0 fail. Если сервер не запущен - падает только первый тест с понятным текстом.

- [ ] **Step 4: Commit**

```bash
git add tests/smoke.test.js package.json
git commit -m "test: smoke-харнесс node --test против dev-сервера"
```

---

### Task 2: Токен брони в БД и ответе 201

**Files:**
- Modify: `db.js` (миграция + createOrder)
- Modify: `server.js` (генерация в POST /api/order, token в 201)
- Test: `tests/smoke.test.js`

**Interfaces:**
- Produces: колонка `orders.token TEXT` (32 hex); ответ 201 `{..., token: '<hex32>'}`. Task 3-6 зависят от этого имени поля.

- [ ] **Step 1: Тест (падающий)**

Дописать в `tests/smoke.test.js`:

```js
test('201 на заявку містить token (32 hex)', async () => {
    const r = await get('/api/order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            route: { from: 'Тест', to: 'Тест', date: '2099-01-01', time: '10:00', price: '1', carrier: 'SMOKE-TEST' },
            passengers: [{ first_name: 'Смоук', last_name: 'Тест' }],
            client_phone: '+380000000000', consent: true
        })
    });
    assert.equal(r.status, 201);
    assert.match(String(r.body.token), /^[a-f0-9]{32}$/);
});
```

ВНИМАНИЕ: этот тест создаёт запись в локальной БД и шлёт TG-уведомление, если настроен токен бота. Для локального прогона это ок (заявка помечена carrier SMOKE-TEST, удаляется из админки). Автобронь не сработает - нет data_bundle.

- [ ] **Step 2: Прогнать - FAIL** (`token` undefined)

- [ ] **Step 3: db.js - миграция и вставка**

После строки 82 (миграции):

```js
if (!_cols.includes('token')) db.exec('ALTER TABLE orders ADD COLUMN token TEXT'); // публічний токен сторінки броні
```

В `createOrder`: добавить `token` в список колонок INSERT, `?` в VALUES и `data.token || null` в параметры (посмотреть точный порядок в db.js:101-118 и вставить в конец списка).

- [ ] **Step 4: server.js - генерация**

В начале файла уже есть `crypto` (используется для md5) - если импорта нет, добавить `const crypto = require('node:crypto');`.
В POST /api/order перед вызовом `createOrder({...})`:

```js
const bookToken = crypto.randomBytes(16).toString('hex'); // 32 hex - не підбирається перебором
```

В объект `createOrder({...})` добавить `token: bookToken`, в ответ 201 (server.js:976) добавить `token: bookToken`.

- [ ] **Step 5: Прогнать тесты - PASS. Commit**

```bash
git add db.js server.js tests/smoke.test.js
git commit -m "feat(booking-page): токен брони в orders + в ответе 201"
```

---

### Task 3: GET /api/booking/:token

**Files:**
- Modify: `server.js`, `db.js`
- Test: `tests/smoke.test.js`

**Interfaces:**
- Consumes: `orders.token` из Task 2.
- Produces: `GET /api/booking/:token` → 200 `{ok:true, order:{id, created_at, booked, route_from, route_to, route_date, route_time, route_carrier, route_price, route_from_station, route_to_station, seats, passengers:[{first_name,last_name,seat_name}], tickets:[{id}]}}` или 404 `{error}`. БЕЗ телефона и без pdf-ссылок. Task 4 использует `tickets[].id`; Task 5 (страница) рендерит этот JSON.

- [ ] **Step 1: Тест (падающий)**

```js
test('GET /api/booking/<фейковий токен> - 404', async () => {
    const r = await get('/api/booking/' + 'a'.repeat(32));
    assert.equal(r.status, 404);
});

test('GET /api/booking/<токен щойно створеної заявки> - 200 без телефону', async () => {
    const created = await get('/api/order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            route: { from: 'Тест', to: 'Тест', date: '2099-01-01', time: '10:00', price: '1', carrier: 'SMOKE-TEST' },
            passengers: [{ first_name: 'Смоук', last_name: 'Тест' }],
            client_phone: '+380000000000', consent: true
        })
    });
    const r = await get('/api/booking/' + created.body.token);
    assert.equal(r.status, 200);
    assert.equal(r.body.order.route_carrier, 'SMOKE-TEST');
    assert.ok(!JSON.stringify(r.body).includes('380000000000'), 'телефон не має витікати');
});
```

- [ ] **Step 2: Прогнать - FAIL (404 на оба)**

- [ ] **Step 3: db.js - выборка по токену**

```js
function getOrderByToken(token) {
    return db.prepare('SELECT * FROM orders WHERE token = ?').get(String(token || ''));
}
```

Добавить в `module.exports`.

- [ ] **Step 4: server.js - эндпоинт**

Рядом с /api/seats (server.js:~1030), с лимитером `const bookingPageLimited = makeRateLimiter(60 * 1000, 30);` (добавить к блоку 193-199):

```js
// Публічна сторінка броні: віддаємо все, що треба пасажиру, БЕЗ телефону та без прямих pdf-лінків
app.get('/api/booking/:token', (req, res) => {
    if (bookingPageLimited(req.ip || 'unknown')) return res.status(429).json({ error: 'Забагато запитів' });
    const t = String(req.params.token || '');
    if (!/^[a-f0-9]{32}$/.test(t)) return res.status(404).json({ error: 'Бронь не знайдено' });
    const o = db.getOrderByToken(t);
    if (!o) return res.status(404).json({ error: 'Бронь не знайдено' });
    let passengers = [];
    try { passengers = (JSON.parse(o.passengers) || []).map(p => ({ first_name: p.first_name, last_name: p.last_name, seat_name: p.seat_name || '' })); } catch { }
    let tickets = [];
    try { tickets = (JSON.parse(o.tickets) || []).map(tk => ({ id: tk.id })); } catch { }
    res.json({
        ok: true, order: {
            id: o.id, created_at: o.created_at, booked: !!o.booked,
            route_from: o.route_from, route_to: o.route_to, route_date: o.route_date, route_time: o.route_time,
            route_carrier: o.route_carrier, route_price: o.route_price,
            route_from_station: o.route_from_station, route_to_station: o.route_to_station,
            seats: o.seats, passengers, tickets
        }
    });
});
```

(`db` здесь - модуль `require('./db')`; проверить, как он импортирован в server.js, и вызвать соответственно.)

- [ ] **Step 5: Тесты PASS. Commit**

```bash
git add server.js db.js tests/smoke.test.js
git commit -m "feat(booking-page): GET /api/booking/:token - JSON брони без телефона"
```

---

### Task 4: PDF-прокси

**Files:**
- Modify: `server.js`
- Test: `tests/smoke.test.js` (только 404-ветка: живой PDF требует реальной брони)

**Interfaces:**
- Consumes: `getOrderByToken`, `getToken()`, `API_BASE_URL`, `ticketPdfLink(id)` (server.js, рядом с createBooking).
- Produces: `GET /api/booking/:token/ticket/:tid` → `application/pdf` (attachment) | 404. Task 5 строит ссылки этого вида.

- [ ] **Step 1: Тест (падающий)**

```js
test('PDF-проксі: чужий/неіснуючий квиток - 404', async () => {
    const r = await get('/api/booking/' + 'a'.repeat(32) + '/ticket/123');
    assert.equal(r.status, 404);
});
```

- [ ] **Step 2: FAIL → Step 3: эндпоинт**

```js
// PDF квитка через наш сервер: посилання живе вічно, навіть якщо лінк contrabus протух -
// перекачуємо заново через get_ticket_info
app.get('/api/booking/:token/ticket/:tid', async (req, res) => {
    if (bookingPageLimited(req.ip || 'unknown')) return res.status(429).json({ error: 'Забагато запитів' });
    try {
        const o = /^[a-f0-9]{32}$/.test(req.params.token) ? db.getOrderByToken(req.params.token) : null;
        let list = []; try { list = JSON.parse(o?.tickets) || []; } catch { }
        const tk = list.find(x => String(x.id) === String(req.params.tid));
        if (!tk) return res.status(404).json({ error: 'Квиток не знайдено' });

        const fetchPdf = async url => {
            const r = await fetch(url);
            if (!r.ok) throw new Error(`PDF HTTP ${r.status}`);
            const buf = Buffer.from(await r.arrayBuffer());
            if (buf.length < 1000 || buf.subarray(0, 4).toString() !== '%PDF') throw new Error('не PDF');
            return buf;
        };
        let buf;
        try { buf = await fetchPdf(tk.pdf); }
        catch {
            // протухло - беремо свіже посилання у contrabus
            const token = await getToken();
            const ti = await (await fetch(`${API_BASE_URL}/bookings/get_ticket_info`, {
                method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticket_id: tk.id })
            })).json();
            const info = Array.isArray(ti) ? ti[0] : ti;
            buf = await fetchPdf(info?.link_to_pdf || ticketPdfLink(tk.id));
        }
        res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="kvytok-${tk.id}.pdf"` });
        res.send(buf);
    } catch (err) { serverError(res, err, 'TicketPdf'); }
});
```

- [ ] **Step 4: PASS. Живой PDF проверить вручную на существующей брони из БД (взять token через sqlite и открыть в браузере). Commit**

```bash
git add server.js tests/smoke.test.js
git commit -m "feat(booking-page): PDF квитка через наш прокси с перевыкачкой"
```

---

### Task 5: Страница /t/<токен>

**Files:**
- Create: `public/booking.html` (standalone, стиль как у admin.html/stats.html - инлайн CSS с теми же CSS-переменными)
- Modify: `server.js` (маршрут)
- Test: `tests/smoke.test.js`

**Interfaces:**
- Consumes: JSON из Task 3, PDF-URL из Task 4.
- Produces: `GET /t/:token` → booking.html (страница сама читает токен из URL). Task 6-8 ссылаются на `gooddaybus.com/t/<токен>`.

- [ ] **Step 1: Тест (падающий)**

```js
test('GET /t/<токен> віддає сторінку броні', async () => {
    const r = await get('/t/' + 'a'.repeat(32));
    assert.equal(r.status, 200);
    assert.match(String(r.body), /Ваша бронь/);
});
```

- [ ] **Step 2: FAIL → Step 3: маршрут в server.js**

Перед `express.static` (server.js:81):

```js
// Сторінка броні: /t/<токен>. Токен читає клієнтський JS сторінки - сервер просто віддає html
app.get('/t/:token', (req, res) => res.sendFile(require('path').join(__dirname, 'public', 'booking.html')));
```

- [ ] **Step 4: public/booking.html**

Standalone-страница (`noindex`), скелет:
- `<head>`: те же шрифты и `:root` переменные, что в stats.html (скопировать блок переменных), `<meta name="robots" content="noindex, nofollow">`, title «Ваша бронь - GoodDayBus».
- Шапка с логотипом (ссылка на `/`).
- Карточка: бейдж статуса (`booked` → зелёный «Місця заброньовано», иначе оранжевый «Заявку прийнято - менеджер зв'яжеться»), маршрут `route_from - route_to`, дата/время, перевозчик, цена, станции, пассажиры (имя + место, если есть `seat_name`).
- Блок «Квитки»: по кнопке на каждый `tickets[].id` → `href="/api/booking/<токен>/ticket/<id>"` («Завантажити квиток N»). Если `booked` но билетов нет - текст «Квитки надішле менеджер».
- Блок «Звʼязатися з нами»: три кнопки-ссылки Telegram (`https://t.me/gooddaybus`), Viber (`viber://chat?number=%2B380967656732`), WhatsApp (`https://wa.me/380967656732`) + телефон.
- Инлайн `<script>`: токен = `location.pathname.split('/').pop()`; `fetch('/api/booking/'+token)`; 404 → экран «Бронь не знайдено. Перевірте посилання або напишіть нам» с теми же кнопками мессенджеров. Все подстановки через `textContent` (не innerHTML) - на странице нет пользовательского HTML, но привычка та же.
- Тексты укр., дефис «-», без em-dash.

- [ ] **Step 5: PASS + открыть в браузере с реальным токеном из БД (десктоп и 375px). Commit**

```bash
git add public/booking.html server.js tests/smoke.test.js
git commit -m "feat(booking-page): страница /t/<токен> - билеты, статус, контакты"
```

---

### Task 6: Экран успеха - ссылка на бронь

**Files:**
- Modify: `public/app.js` (обработка 201, ~1290-1315), `public/index.html` (#m-ok), `public/styles.css`

**Interfaces:**
- Consumes: `token` из 201 (Task 2), страница из Task 5.
- Produces: глобальная переменная модуля `_okToken` (строка | ''), блок `#m-ok-link` с кнопкой `#m-ok-copy`. Task 8 использует клик по `#m-ok-copy` как признак «ссылку сохранили».

- [ ] **Step 1: Разметка в index.html** после `#m-ok-tickets`:

```html
<div id="m-ok-link" style="display:none">
    <div class="ok-link-lbl">Посилання на вашу бронь - тут завжди квитки й деталі:</div>
    <div class="ok-link-row">
        <input id="m-ok-url" type="text" readonly>
        <button type="button" id="m-ok-copy" class="ok-copy">Копіювати</button>
    </div>
</div>
```

- [ ] **Step 2: app.js** - в обработке 201 (после установки m-ok-tickets, в обеих ветках booked/не-booked):

```js
_okToken = j.token || '';
const linkBox = document.getElementById('m-ok-link');
if (_okToken) {
    const url = `${location.origin}/t/${_okToken}`;
    document.getElementById('m-ok-url').value = url;
    linkBox.style.display = 'block';
} else linkBox.style.display = 'none';
```

Объявить `let _okToken = '';` рядом с состоянием модалки; сбрасывать в `openModal`. Кнопка (слушатель вешается один раз при инициализации):

```js
document.getElementById('m-ok-copy').addEventListener('click', async () => {
    const inp = document.getElementById('m-ok-url');
    inp.select();
    try { await navigator.clipboard.writeText(inp.value); } catch { document.execCommand('copy'); }
    const b = document.getElementById('m-ok-copy');
    b.textContent = 'Скопійовано!'; setTimeout(() => { b.textContent = 'Копіювати'; }, 2000);
});
```

- [ ] **Step 3: styles.css** - `.ok-link-lbl` (мелкий text-2), `.ok-link-row` (flex, gap 8px), `#m-ok-url` (flex:1, моноширинный 13px, фон var(--bg), border var(--border), radius var(--r-sm), padding 9px 10px), `.ok-copy` (оранжевая маленькая кнопка). Мобильный: row не ломается (input сжимается, text-overflow не нужен - input скроллится).

- [ ] **Step 4: `node -c public/app.js && node build-routes.js`; браузер: BOOKING_DRY_RUN=1, полная бронь, проверить ссылку и «Копіювати». Commit**

```bash
git add public/app.js public/index.html public/styles.css public/*.min.* public/*.html
git commit -m "feat(booking-page): ссылка на бронь + копирование на экране успеха"
```

---

### Task 7: Кнопки мессенджеров на экране успеха

**Files:**
- Modify: `public/index.html` (#m-ok), `public/styles.css`

**Interfaces:** статичная разметка, без JS (просто ссылки, БЕЗ предзаполнения - решение пользователя).

- [ ] **Step 1: Разметка** после `#m-ok-link`:

```html
<div class="ok-msgrs">
    <div class="ok-msgrs-lbl">Виникли питання? Напишіть нам:</div>
    <div class="ok-msgrs-row">
        <a class="ok-msgr ok-msgr-tg" href="https://t.me/gooddaybus" target="_blank" rel="noopener"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-telegram"></use></svg> Telegram</a>
        <a class="ok-msgr ok-msgr-vb" href="viber://chat?number=%2B380967656732"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-viber"></use></svg> Viber</a>
        <a class="ok-msgr ok-msgr-wa" href="https://wa.me/380967656732" target="_blank" rel="noopener"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-whatsapp"></use></svg> WhatsApp</a>
    </div>
</div>
```

(Иконки: проверить точные id в `public/_sprite.svg` - `grep -o 'id="i-[a-z-]*"' public/_sprite.svg`; в футере уже есть ссылки мессенджеров, взять оттуда готовые use-href.)

- [ ] **Step 2: styles.css** - `.ok-msgrs-row` flex, gap 8px, wrap; `.ok-msgr` - pill-кнопки с брендовыми цветами (tg #2AABEE, viber #7360F2, wa #25D366) на светлом фоне 10%-opacity, ≥44px высоты (палец). Мобильный: три в ряд, при нехватке - wrap.

- [ ] **Step 3: build + браузер (обе ветки: booked и обычная заявка). Commit**

```bash
git add public/index.html public/styles.css public/*.min.* public/*.html
git commit -m "feat(success): кнопки Telegram/Viber/WhatsApp на экране успеха"
```

---

### Task 8: Предохранитель закрытия успех-экрана

**Files:**
- Modify: `public/app.js`, `public/index.html`, `public/styles.css`

**Interfaces:**
- Consumes: `_okToken` (Task 6); `closeBooking()`; Esc-обработчик.
- Produces: `_okGuardArmed` (bool) - взведён, когда показан успех с билетами и ни один не скачан.

- [ ] **Step 1: Разметка** в `#m-ok` (в конец):

```html
<div id="m-ok-guard" style="display:none">
    <p>Переконайтеся, що завантажили квитки або зберегли посилання на бронь - воно знадобиться при посадці.</p>
    <div class="ok-guard-btns">
        <button type="button" id="m-ok-guard-back">Повернутися</button>
        <button type="button" id="m-ok-guard-close">Все одно закрити</button>
    </div>
</div>
```

- [ ] **Step 2: app.js логика**

```js
let _okGuardArmed = false; // успіх з квитками показано, але жодного не завантажено
```

- Взводить в обработке 201: `_okGuardArmed = tks.length > 0;`
- Клик по `.tk-link` (делегированно на `#m-ok-tickets`) и по `#m-ok-copy` → `_okGuardArmed = false;`
- В `closeBooking()` первой строкой:

```js
if (_okGuardArmed) {
    _okGuardArmed = false; // друге натискання закриє
    document.getElementById('m-ok-guard').style.display = 'block';
    return;
}
```

- `#m-ok-guard-back` → прячет guard, `_okGuardArmed = true;` (снова взведён). `#m-ok-guard-close` → `closeBooking()` (уже не взведён - закроет).
- Сброс в `openModal`: `_okGuardArmed = false;` + спрятать `#m-ok-guard`.
- Esc уже зовёт `closeBooking()` - сработает само. Клик по фону модалки - убедиться, что тоже идёт через `closeBooking()`.

- [ ] **Step 3: styles.css** - `#m-ok-guard` жёлтая плашка (var(--amber-bg), бордер amber-тон), `#m-ok-guard-close` серо-нейтральная, `#m-ok-guard-back` оранжевая (безопасный выбор - заметнее).

- [ ] **Step 4: build + браузер: бронь (dry-run) → закрыть НЕ скачав → плашка; «Повернутися» → снова закрыть → снова плашка; скачать билет → закрывается сразу. Commit**

```bash
git add public/app.js public/index.html public/styles.css public/*.min.* public/*.html
git commit -m "feat(success): предохранитель - предупреждение при закрытии без скачанных билетов"
```

---

### Task 9: TG-алерты об ошибках

**Files:**
- Modify: `server.js`
- Test: `tests/smoke.test.js` (косвенно; основная проверка ручная)

**Interfaces:**
- Consumes: `tg()` (server.js:428), `TELEGRAM_BACKUP_CHAT_ID`.
- Produces: `alertAdmin(tag, text)` - зовётся из serverError, провала автоброни, логина contrabus и process-хуков. Env: `TELEGRAM_ALERT_CHAT_ID` (fallback - backup-чат).

- [ ] **Step 1: Хелпер** (рядом с sendBackupToTelegram, server.js:~440):

```js
// Алерти про збої в приватний чат: дізнаємось про проблему раніше за пасажира.
// Анти-спам: не частіше 1 повідомлення на тег за 10 хв.
const TELEGRAM_ALERT_CHAT_ID = process.env.TELEGRAM_ALERT_CHAT_ID || TELEGRAM_BACKUP_CHAT_ID;
const _alertLast = new Map();
function alertAdmin(tag, text) {
    try {
        if (!TG_API || !TELEGRAM_ALERT_CHAT_ID) return;
        if (Date.now() - (_alertLast.get(tag) || 0) < 10 * 60 * 1000) return;
        _alertLast.set(tag, Date.now());
        tg('sendMessage', { chat_id: TELEGRAM_ALERT_CHAT_ID, text: `🚨 <b>${tag}</b>\n<code>${String(text).slice(0, 800)}</code>`, parse_mode: 'HTML' });
    } catch { /* алерт не має валити основний потік */ }
}
```

(Проверить: `tg()` при ошибке кидает или глотает? Если кидает - обернуть вызов `.catch(() => {})`. HTML-режим: экранировать `<>&` в text через существующий хелпер, если есть; иначе слать без parse_mode.)

- [ ] **Step 2: Точки вызова**

1. `serverError()` (server.js:131): `alertAdmin('5xx: ' + tag, err?.message || err);`
2. Провал автоброни (в POST /api/order, где `b.ok === false`): `alertAdmin('Автобронь не вдалася', \`#${order?.id ?? '?'} ${route.carrier}: ${b.reason}\`);` - подобрать реальные имена переменных по месту.
3. `getToken()` catch (логин contrabus): `alertAdmin('Логін contrabus', e.message);`
4. В конце файла:

```js
process.on('unhandledRejection', e => { console.error('[Unhandled]', e); alertAdmin('unhandledRejection', e?.message || e); });
process.on('uncaughtException', e => { console.error('[Uncaught]', e); alertAdmin('uncaughtException', e?.message || e); });
```

- [ ] **Step 3: Проверка**: локально `TELEGRAM_ALERT_CHAT_ID=<свой id>` + временный `app.get('/api/_boom', () => { throw new Error('test'); })` НЕ добавлять; проще: `curl -X POST localhost:3000/api/discounts -H 'Content-Type: application/json' -d '{"data_bundle":"мусор"}'` - если пойдёт по serverError, придёт алерт. Либо кратко подменить условие. Убедиться, что второй раз за 10 мин НЕ приходит. Убрать все временные правки.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(alerts): критические ошибки сервера и автоброни - в Telegram"
```

Railway: добавить env `TELEGRAM_ALERT_CHAT_ID` (сказать пользователю).

---

### Task 10: /api/health + внешний uptime-монитор

**Files:**
- Modify: `server.js`, `db.js`
- Test: `tests/smoke.test.js`

- [ ] **Step 1: Тест (падающий)**

```js
test('GET /api/health - ok:true і db:true', async () => {
    const r = await get('/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.db, true);
});
```

- [ ] **Step 2: db.js**: `function ping() { try { db.prepare('SELECT 1').get(); return true; } catch { return false; } }` + экспорт.

- [ ] **Step 3: server.js** (без лимитера - его дёргает монитор):

```js
// Здоровʼя для зовнішнього монітора (UptimeRobot тощо): дешево, без звернень до contrabus
app.get('/api/health', (req, res) => {
    const dbOk = db.ping();
    res.status(dbOk ? 200 : 500).json({ ok: dbOk, db: dbOk, up: Math.round(process.uptime()) });
});
```

- [ ] **Step 4: PASS. Commit**

```bash
git add server.js db.js tests/smoke.test.js
git commit -m "feat(health): /api/health для внешнего uptime-монитора"
```

- [ ] **Step 5 (ручной, пользователь):** завести бесплатный UptimeRobot-монитор на `https://gooddaybus.com/api/health`, keyword `"ok":true`, интервал 5 мин, алерт на email/TG. Дать пользователю пошаговую инструкцию в чате.

---

### Task 11: Автоподстановка данных пассажира

**Files:**
- Modify: `public/app.js`

**Interfaces:**
- Produces: localStorage `gdb_pax1` = `{"fn":"Іван","ln":"Петренко","ph":"+380..."}`. Только на устройстве, на сервер не уходит.

- [ ] **Step 1: Сохранение** - в обработке 201 (успех), рядом с существующим `gdb_paxn`:

```js
try {
    const p0 = payload.passengers[0] || {};
    localStorage.setItem('gdb_pax1', JSON.stringify({ fn: p0.first_name || '', ln: p0.last_name || '', ph: payload.client_phone || '' }));
} catch (e) { }
```

(Посмотреть реальные имена полей в `payload` по месту - `first_name/last_name/client_phone` сверить.)

- [ ] **Step 2: Подстановка** - в `openModal` после отрисовки первой pax-строки: если поля пустые, подставить из `gdb_pax1`:

```js
try {
    const saved = JSON.parse(localStorage.getItem('gdb_pax1') || 'null');
    if (saved) {
        const row = document.querySelector('#pax-list .pax-row');
        const [fn, ln] = row.querySelectorAll('input');
        if (fn && !fn.value) fn.value = saved.fn || '';
        if (ln && !ln.value) ln.value = saved.ln || '';
        const ph = document.getElementById('c-phone');
        if (ph && !ph.value) ph.value = saved.ph || '';
    }
} catch (e) { }
```

(id телефона сверить в index.html - в форме он один; селекторы input-ов первой строки взять из `paxRowHtml()` app.js:824.)

- [ ] **Step 3: build + браузер: бронь (dry-run) → открыть модалку заново → поля заполнены; изменить имя → бронь → сохранилось новое. Commit**

```bash
git add public/app.js public/*.min.*
git commit -m "feat(form): автоподстановка первого пассажира и телефона из localStorage"
```

---

### Task 12: Кнопка «Знайти зворотний рейс»

**Files:**
- Modify: `public/index.html` (#m-ok), `public/app.js`, `public/styles.css`

- [ ] **Step 1: Разметка** в `#m-ok` (после мессенджеров):

```html
<button type="button" id="m-ok-return" class="ok-return"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-arrow-right-arrow-left"></use></svg> Знайти зворотний рейс</button>
```

- [ ] **Step 2: app.js** (листенер один раз при инициализации):

```js
document.getElementById('m-ok-return').addEventListener('click', () => {
    const dep = document.getElementById('departure'), arr = document.getElementById('arrival');
    [dep.value, arr.value] = [arr.value, dep.value]; // авто-пошук НЕ запускаємо: дату назад пасажир обирає сам
    closeBooking();
    document.querySelector('.search-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.getElementById('date-input').focus();
});
```

(Проверить: не хранит ли автокомплит city-id отдельно от текста - grep `dataset.id|_depId` в app.js; если хранит, поменять и их.)

- [ ] **Step 3: styles.css** - `.ok-return`: вторичная кнопка на всю ширину (бордер оранжевый, фон белый).

- [ ] **Step 4: build + браузер: бронь → кнопка → модалка закрыта, направления поменяны, фокус на дате, поиск работает. Commit**

```bash
git add public/index.html public/app.js public/styles.css public/*.min.* public/*.html
git commit -m "feat(success): кнопка - знайти зворотний рейс"
```

---

## Финальная проверка (после всех задач)

- [ ] `npm test` - все зелёные (сервер запущен).
- [ ] Полный сценарий в браузере с `BOOKING_DRY_RUN=1`: поиск → бронь → успех: билеты (dry-run пустые pdf - проверить ветку «Квитки надішле менеджер»), ссылка `/t/...`, копирование, мессенджеры, guard, «зворотний рейс». Открыть `/t/<токен>` десктоп + 375px.
- [ ] Реальный токен старой брони из БД: `/t/<токен>` показывает билеты, PDF скачивается через прокси.
- [ ] Консоль браузера чистая.
- [ ] Пуш - после одобрения пользователя; Railway env: `TELEGRAM_ALERT_CHAT_ID`.
- [ ] Настроить UptimeRobot (инструкция пользователю).
