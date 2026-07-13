# Pre-Launch Hardening (аудит перед рекламой) - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Закрыть оранжевый блок аудита (защита от ботов/абьюза под рекламным трафиком) + мелкое усиление старта. Автобронь ВКЛЮЧЕНА в проде - защита от бот-броней критична.

**Tech Stack:** Node 22 + Express, ваниль на фронте, Cloudflare Turnstile (антибот).

## Global Constraints

- Видимые тексты: укр., только дефис «-», никогда «—».
- **Коммиты на английском** (правило проекта), тело коммита тоже.
- Без новых npm-зависимостей (Turnstile - через fetch к их API, без пакетов).
- После правок фронта: `node -c public/app.js && node build-routes.js`; коммитить исходники + сгенерированное.
- `npm test` = 11 pass до и после (сервер :3000; после server.js-правок - рестарт: netstat -ano | findstr :3000 → taskkill //PID //F → node server.js фоном).
- НЕ ломать существующий поток: заявки менеджеру и автобронь должны работать как раньше при штатном трафике.
- Реальные брони в contrabus не создавать (BOOKING_DRY_RUN=1 для проверок фронта, но осторожно - в проде включено; локально .env).
- Коммит на задачу + Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>.

## Известные якоря (проверено 2026-07-13)

| Что | Где |
|---|---|
| Все contrabus-вызовы | `fetch(\`${API_BASE_URL}/...\`)`: login 157, search 245, get_cities 326, searchCount 341, create_booking 769, get_ticket_info 805, booking_report 834, allow_check 923, get_route_discounts 1057 |
| `/api/suggest` (амплификация) | server.js:370-430, зовёт searchCount в цикле |
| helmet CSP | server.js:35-52 (scriptSrc, frameSrc) |
| `alertAdmin(tag,text)` | server.js (анти-спам 10мин/тег) |
| POST /api/order, wantBook | server.js:912; honeypot hp; консент | 
| createOrder / notifyTelegram | server.js |
| Форма: сборка payload | app.js:~1300-1315 (hp, consent, data_bundle) |
| escTxt | app.js:441 |
| suggest/renderResults XSS | app.js:405,406,411,543,566 |
| loadCities / citiesReady | app.js:56,68-85 |

---

### Task S1: глобальный предохранитель на исходящие к contrabus

**Files:** `server.js`

**Interfaces:** Produces `cbFetch(path, opts)` - обёртка над fetch к contrabus с глобальным счётчиком и circuit-breaker. Хот-пути переключить на неё.

- [ ] **Step 1:** Добавить модульный счётчик и брейкер (рядом с rate-лимитерами, ~server.js:204):

```js
// Глобальний стеля на вихідні запити до contrabus: боти не мають вибити квоту.
// Ковзне вікно 1 хв; при перевищенні - circuit open на 60с (деградуємо, не б'ємо API).
const CB_MAX_PER_MIN = +process.env.CB_MAX_PER_MIN || 600;
let _cbWin = { t: 0, n: 0 }, _cbOpenUntil = 0;
function cbAllowed() {
    const now = Date.now();
    if (now < _cbOpenUntil) return false;
    if (now - _cbWin.t > 60000) _cbWin = { t: now, n: 0 };
    if (_cbWin.n >= CB_MAX_PER_MIN) {
        _cbOpenUntil = now + 60000;
        alertAdmin('contrabus rate cap', `>${CB_MAX_PER_MIN} вих. запитів/хв - circuit open на 60с (можлива бот-атака)`);
        return false;
    }
    _cbWin.n++; return true;
}
class CbBusy extends Error { constructor() { super('contrabus busy'); this.code = 'CB_BUSY'; } }
async function cbFetch(url, opts) {
    if (!cbAllowed()) throw new CbBusy();
    return fetch(url, opts);
}
```

- [ ] **Step 2:** Перевести хот-пути (search 245, searchCount 341, get_cities 326, get_route_discounts 1057, get_free_seats) на `cbFetch(...)` вместо `fetch(...)`. НЕ трогать login (157) и booking-вызовы (create_booking/allow_check/report/ticket_info) - они низкочастотны и критичны, пусть идут напрямую.

- [ ] **Step 3:** Обработать CbBusy в вызывающих: `/api/search` → 503 `{error:'Сервіс тимчасово перевантажений, спробуйте за хвилину'}`; `/api/suggest` → вернуть `{type:'none'}` (тихо); `/api/discounts` и `/api/seats` → пустой ответ (у них уже catch с пустым - убедиться, что CbBusy туда попадает). searchCount внутри suggest: обернуть так, чтобы при CbBusy прерывать перебор (не сыпать ошибками).

- [ ] **Step 4:** `/api/suggest` удешевить: снизить `pool.slice(0, 200)` → `100` и `CITY_BUDGET` c 9000 → 5000 (меньше веер на один запрос).

- [ ] **Step 5:** `node -c server.js`, рестарт, `npm test` (11 pass), самопроверка. Commit: `feat(server): global contrabus circuit-breaker to survive bot traffic`

---

### Task S2: серверная защита автоброни (дневной лимит + алерт)

**Files:** `server.js`

**Interfaces:** Работает сразу, без внешних сервисов. Дополняется Turnstile (S3).

- [ ] **Step 1:** Дневной счётчик автоброней (сброс по дате, in-memory):

```js
// Стеля автоброней на добу: навіть якщо бот пройде інші бар'єри, масового booking-bombing не буде.
const AUTOBOOK_MAX_PER_DAY = +process.env.AUTOBOOK_MAX_PER_DAY || 50;
let _abDay = '', _abCount = 0;
function autobookAllowed() {
    const d = new Date().toISOString().slice(0, 10);
    if (d !== _abDay) { _abDay = d; _abCount = 0; }
    if (_abCount >= AUTOBOOK_MAX_PER_DAY) { alertAdmin('autobook denně limit', `Досягнуто ${AUTOBOOK_MAX_PER_DAY} автоброней/добу - подальші йдуть як заявки менеджеру`); return false; }
    _abCount++; return true;
}
```

- [ ] **Step 2:** В /api/order (где `wantBook`, server.js:912): если `wantBook && !autobookAllowed()` → НЕ звать автобронь, а падать в обычную заявку менеджеру (как при выключенной автоброни). Найти ветку doBook и обойти её при исчерпании лимита, `check_warning` установить в понятный текст.

- [ ] **Step 3:** рестарт, `npm test` (11 pass). Commit: `feat(server): daily auto-booking cap as booking-bombing safety net`

---

### Task S3: Cloudflare Turnstile на форму брони

**Files:** `server.js` (CSP + верификация в /api/order), `public/index.html` (виджет + скрипт), `public/app.js` (получение токена в payload)

**Interfaces:** Env `TURNSTILE_SECRET` (server), site key - в разметке. Пока `TURNSTILE_SECRET` не задан → верификация пропускается (сайт работает), в лог - warning раз при старте.

- [ ] **Step 1: CSP** (server.js:39,45): в `scriptSrc` и `frameSrc` добавить `'https://challenges.cloudflare.com'`.

- [ ] **Step 2: index.html** - в модалке брони, перед кнопками действий, вставить контейнер:
```html
<div class="cf-turnstile" data-sitekey="TURNSTILE_SITE_KEY_PLACEHOLDER" data-size="flexible"></div>
```
и подключить скрипт Turnstile (async, в конце body или в head): `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`. Site key задать реальный, когда пользователь пришлёт (пока плейсхолдер + коммент). Turnstile сам кладёт токен в скрытое поле `cf-turnstile-response` внутри формы/контейнера.

- [ ] **Step 3: app.js** - в payload /order добавить `ts: (document.querySelector('[name="cf-turnstile-response"]')||{}).value || ''`. После неуспешной отправки - `turnstile.reset()` если `window.turnstile` есть (токен одноразовый).

- [ ] **Step 4: server.js** - в начале /api/order (после honeypot), если `TURNSTILE_SECRET` задан: POST на `https://challenges.cloudflare.com/turnstile/v0/siteverify` с `secret` + `response=req.body.ts` + `remoteip`. Если `!success` → 400 `{error:'Підтвердіть, що ви не робот, і спробуйте ще раз'}`. Если secret не задан - пропустить (warning при старте один раз). Использовать cbFetch НЕ надо (это не contrabus).

- [ ] **Step 5:** `node -c`, build-routes, рестарт, `npm test` (11 pass). Браузер: без ключей форма работает как раньше (верификация off). Commit: `feat(booking): Cloudflare Turnstile anti-bot on order submit (inert until keys set)`

ПРИМЕЧАНИЕ для координатора: после мержа пользователь создаёт Turnstile-виджет в Cloudflare, вставляет site key в разметку (заменить плейсхолдер + пересобрать) и `TURNSTILE_SECRET` в Railway.

---

### Task S4: XSS-экранирование 4 мест

**Files:** `public/app.js`

- [ ] **Step 1:** Обернуть в `escTxt(...)`: `s.date` (app.js:405,406), `a.name` (411), `dep`/`arr`/`date` (543, 566). Числовые (`s.count`, `a.distance_km`, `a.count`) можно тоже для единообразия, но приоритет - строки.

- [ ] **Step 2:** `node -c`, build-routes, `npm test`. Commit: `fix(xss): escape city names and typed input in suggest/no-results blocks`

---

### Task S5: ретрай загрузки городов + усиление старта

**Files:** `public/app.js` (ретрай), `server.js` (startup guards)

- [ ] **Step 1: app.js loadCities catch** - при ошибке и отсутствии кэша показать в статусе кнопку «Спробувати ще раз», по клику - повторный `loadCities()`. Кнопку поиска не разблокировать до успеха.

- [ ] **Step 2: server.js startup** - после определения ADMIN_KEY и при `app.listen`: если `NODE_ENV==='production'` и (`ADMIN_KEY` дефолтный/короче 16 симв ИЛИ отсутствует) → громкий `console.error` (не падать, но заметно). Плюс логировать при старте фактический путь БД (`DATA_DIR`) - чтобы пользователь видел, персистентный ли том. Turnstile secret отсутствует - warning.

- [ ] **Step 3:** `node -c`, build-routes, рестарт, `npm test`. Commit: `feat: retry cities load; warn on weak admin key and log db path at startup`

---

## Финальная проверка
- [ ] `npm test` 11 pass; общее ревью всех дифов (Opus); push после одобрения.
- [ ] Пользователю: создать Turnstile-ключи; проверить на Railway DATA_DIR/volume, NODE_ENV=production, сильный ADMIN_KEY, наличие Cloudflare (trust proxy).
