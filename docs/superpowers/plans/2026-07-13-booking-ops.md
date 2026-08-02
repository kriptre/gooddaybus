# Booking Ops (пометка, неподтверждённые, отмена) - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Три улучшения работы с бронями contrabus: (1) помечать брони с сайта в поле comments, чтобы их было видно в диспетчерской; (2) блок «не підтверджені» в админке - список броней со status="undefined", которые не попадают в звіт диспетчерской; (3) отмена брони менеджером из админки через cancel_booking.

**Контекст (установлено экспериментом 13.07.2026):**
- Брони через API создаются под агентом `Goodday`, но приходят со `status: "undefined"` (строка), тогда как ручные диспетчерские - `agent_confirm`. Из-за этого не попадают в звіт диспетчерской. Починить нашим кодом НЕЛЬЗЯ: поля статуса в `create_booking` нет (проверено - три варианта игнорируются), метода подтверждения в API нет (~23 эндпоинта → 404). Это на стороне contrabus.
- **`comments` в passengers_data РАБОТАЕТ** - долетает до брони и виден в отчёте (проверено на тестовой брони).
- **`POST /v1/bookings/cancel_booking {ticket_id}` СУЩЕСТВУЕТ и работает**: `{"success":true,"message":"Booking with ticket_id X was cancelled successfully!"}`; после отмены бронь исчезает из get_booking_report. На несуществующий id: `{"success":false,"message":"Booking with ticket_id X was not found!"}` (HTTP 200 в обоих случаях - проверять по `success`).

**Tech Stack:** Node 22 + Express, node:sqlite, ванильный admin.html.

## Global Constraints

- Видимые тексты: укр., только дефис «-», никогда «—».
- **Коммиты на английском**.
- Без новых npm-зависимостей.
- `npm test` = 11 pass (сервер :3000; после server.js - рестарт: netstat -ano | findstr :3000 → taskkill //PID //F → node server.js фоном).
- **Реальные брони НЕ создавать.** Отмену на живых бронях НЕ выполнять (только код + проверка на несуществующем id).
- Коммит на задачу + Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>.

## Якоря (проверено 13.07.2026)

| Что | Где |
|---|---|
| `createBooking(data_bundle, passengers, skipChecks)`, passengers_data с `comments: ''` | server.js (~строка 745+) |
| `getContrabusBookings()` (для /api/bookings) | server.js, ищи `async function getContrabusBookings` |
| `CANCELLED_BOOKING` (set статусов отмены) | server.js |
| `/api/bookings` (вкладка Продажі) | server.js:1363 |
| `requireAdmin` | server.js:1241 |
| `alertAdmin(tag, text)` | server.js |
| Вкладка Продажі: `loadSales()` / `renderSales(list)` | public/admin.html:408 / 421 |
| Карточка заявки, бейдж «⚡ Автобронь», список билетов | public/admin.html:484, 498 |
| `esc()`, `adminKey`, `API` | public/admin.html:462, 219 |
| PATCH/DELETE /api/orders/:id (образец мутирующего админ-роута) | server.js:1417, 1428 |

---

### Task B1: пометка броней с сайта в comments

**Files:** `server.js` (createBooking)

- [ ] **Step 1.** В `createBooking` в `passengers_data` заменить `comments: ''` на пометку источника:

```js
comments: 'Онлайн-бронь із сайту gooddaybus.com', // видно диспетчеру - відрізнити від ручних
```

Проверить по коду, что `comments` не используется где-то ещё как значимое поле (grep `comments` в server.js) и что мы не затираем пользовательский комментарий - если у пассажира есть свой коммент, объединить: `[p.comments, 'Онлайн-бронь із сайту gooddaybus.com'].filter(Boolean).join(' · ')` (посмотреть, приходит ли `p.comments` вообще; если нет - просто константа).

- [ ] **Step 2.** `node -c server.js`, рестарт, `npm test` (11 pass). Реальную бронь НЕ создавать - достаточно кода.

- [ ] **Step 3. Commit:** `feat(booking): tag site-made bookings in the comments field for the dispatcher`

---

### Task B2: блок «не підтверджені» в админке

**Files:** `server.js` (расширить `/api/bookings`), `public/admin.html` (вкладка Продажі)

**Суть:** менеджер должен видеть, какие брони не попадут в звіт диспетчерской (status="undefined"), чтобы подтвердить их вручную.

- [ ] **Step 1: сервер.** В `/api/bookings` (server.js:1363) вместе с `bookings` вернуть счётчик неподтверждённых:

```js
const list = await getContrabusBookings();
const unconfirmed = list.filter(b => !CANCELLED_BOOKING.has(String(b.status)) && String(b.status) === 'undefined').length;
res.json({ bookings: list, unconfirmed });
```

(Проверить фактическую форму `getContrabusBookings()` - если она уже фильтрует/маппит, встроиться аккуратно.)

- [ ] **Step 2: админка - бейдж на карточке.** В `renderSales` (admin.html:421) для брони со `status === 'undefined'` (и не отменённой) добавить бейдж рядом с ценой:

```js
const unconfirmed = !cancelled && String(b.status) === 'undefined';
```
и в `.o-meta`: `${unconfirmed ? `<div class="badge b-unconf" title="Не підтверджено в диспетчерській - не потрапляє у звіт">⚠ Не підтверджено</div>` : ''}`

CSS рядом с `.b-booked` (admin.html:82): `.b-unconf{background:var(--amber-bg);color:var(--amber)}`

- [ ] **Step 3: админка - сводка сверху.** Если `unconfirmed > 0`, над списком в вкладке Продажі показать плашку:

«⚠ Не підтверджено в диспетчерській: N - ці броні не потраплять у звіт. Підтвердьте їх вручну в диспетчерській contrabus.»

Стиль - амбер-плашка (взять цвета из существующих badge/var(--amber-bg)).

- [ ] **Step 4.** `node -c server.js`, рестарт, `npm test` (11 pass). Проверить админку в браузере: открыть /admin.html, ввести ADMIN_KEY (локальный из .env), вкладка Продажі - бейджи и плашка на месте (данные реальные из contrabus, брони со статусом undefined там есть).

- [ ] **Step 5. Commit:** `feat(admin): flag bookings the dispatcher report will miss (status undefined)`

---

### Task B3: отмена брони менеджером из админки

**Files:** `server.js` (новый роут), `public/admin.html` (кнопка + подтверждение)

**ОСТОРОЖНО:** деструктивное действие в системе перевозчика. Требования: только под `requireAdmin`, двойное подтверждение в UI, лог + `alertAdmin`, идемпотентная обработка ответа contrabus.

- [ ] **Step 1: сервер - роут.** Рядом с другими админ-роутами:

```js
// POST /api/bookings/:ticketId/cancel — скасування броні в contrabus (лише менеджер).
// Дія незворотна: місце звільняється у перевізника.
app.post('/api/bookings/:ticketId/cancel', requireAdmin, async (req, res) => {
    const id = String(req.params.ticketId || '').trim();
    if (!id || id.length > 64) return res.status(400).json({ error: 'Некоректний ticket_id' });
    try {
        const token = await getToken();
        const r = await fetch(`${API_BASE_URL}/bookings/cancel_booking`, {
            method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticket_id: id })
        });
        const j = await r.json().catch(() => ({}));
        if (!j.success) {
            console.log(`[Booking] Скасування ${logStr(id, 64)} відхилено: ${logStr(JSON.stringify(j), 200)}`);
            return res.status(400).json({ error: cap(j.message || 'Не вдалося скасувати', 200) });
        }
        console.log(`[Booking] ❌ Скасовано бронь ${logStr(id, 64)} (менеджер через адмінку)`);
        alertAdmin('Скасування броні', `Квиток ${id} скасовано менеджером через адмінку`);
        res.json({ ok: true });
    } catch (err) { serverError(res, err, 'CancelBooking'); }
});
```

(Сверить имена хелперов `logStr`, `cap`, `serverError`, `alertAdmin`, `API_BASE_URL`, `getToken` по факту в файле.)

- [ ] **Step 2: тест.** Дописать в tests/smoke.test.js: отмена без админ-ключа - 401.

```js
test('POST /api/bookings/<id>/cancel без пароля - 401', async () => {
    const r = await get('/api/bookings/TESTID/cancel', { method: 'POST' });
    assert.equal(r.status, 401);
});
```

- [ ] **Step 3: админка - кнопка.** В `renderSales`, в `.o-actions` для НЕотменённых броней добавить:

```html
<button class="act act-del" data-cancel="TICKET_ID">Скасувати бронь</button>
```

Обработчик (делегированно, рядом с существующими): двойное подтверждение -
`confirm('Скасувати бронь <ticket> у перевізника? Місце звільниться. Дію не можна відмінити.')`, затем второй `confirm('Точно скасувати?')`; при успехе - `loadSales()` (перерисовать), при ошибке - alert с текстом сервера. Кнопку на время запроса блокировать (disabled), чтобы не отправить дважды.

- [ ] **Step 4.** `node -c server.js`, рестарт, `npm test` (12 pass с новым тестом). Проверка: роут отвечает 401 без ключа; с ключом на НЕСУЩЕСТВУЮЩЕМ ticket_id - 400 с сообщением contrabus «was not found». **Реальные брони не отменять.**

- [ ] **Step 5. Commit:** `feat(admin): let managers cancel a contrabus booking from the sales tab`

---

## Финальная проверка
- [ ] `npm test` зелёные; общее ревью трёх дифов; push после одобрения пользователя.
- [ ] Напомнить пользователю: написать в contrabus про status (это их баг, кодом не решается).
