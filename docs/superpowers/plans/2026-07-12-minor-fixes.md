# Minor Fixes (техдолг финального ревью) - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Закрыть техдолг из финального ревью ветки passenger-ux-reliability: таймауты внешних fetch в PDF-прокси, единый crypto-импорт, устойчивость к битым элементам массивов, CSS-фолбэк для color-mix.

**Architecture:** Точечные правки server.js (3 фикса) и styles.css (1 фикс). Без новых файлов и зависимостей. Проверка - существующие 11 смоук-тестов + сборка.

**Tech Stack:** Node 22 (AbortSignal.timeout), CSS-каскад для фолбэка.

## Global Constraints

- Видимые тексты: только дефис «-», никогда «—»; украинский.
- Без новых npm-зависимостей.
- После правок styles.css: `node build-routes.js`; коммитить исходники + сгенерированное.
- `npm test` = 11 pass до и после (сервер :3000; после правок server.js - рестарт).
- Коммит на задачу, подпись Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>.

## Решение по пункту «автотест TG-глушилки SMOKE-TEST»: НЕ ДЕЛАЕМ

Осмысленный assert «сообщение не ушло в Telegram» требует рефакторинга server.js в тестируемые модули (изоляция app.listen, экспорт notifyTelegram/guard) - несоразмерно однострочной проверке, которая уже дважды проверена вручную по логам и покрыта ревью. YAGNI. Если server.js когда-нибудь будет разбит на модули (план B-тира), тест добавить тогда.

---

### Task A: server.js - таймауты, crypto, устойчивые map

**Files:**
- Modify: `server.js:1130-1147` (PDF-прокси), `server.js:1052,1078,1159` (crypto), `server.js:~1108-1118` (/api/booking/:token map)

**Interfaces:** внешних изменений нет - все контракты эндпоинтов прежние.

- [ ] **Step 1: Таймауты в PDF-прокси.** В `fetchPdf` (server.js:1130) добавить `AbortSignal.timeout`:

```js
const fetchPdf = async url => {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) }); // зависший PDF-хост не держит соединение вечно
    ...
```

И в запрос get_ticket_info внутри catch (server.js:1142) добавить в options: `signal: AbortSignal.timeout(15000)`.

- [ ] **Step 2: Единый crypto.** Заменить три `require('crypto').X` на верхнеуровневый `crypto.X` (импорт `node:crypto` уже есть, server.js:6):
  - 1052: `crypto.createHash('md5')...`
  - 1078: `crypto.createHash('md5')...`
  - 1159: `crypto.timingSafeEqual(ba, bb)`

- [ ] **Step 3: Устойчивые map в /api/booking/:token.** Битый элемент не должен обнулять весь список:

```js
try { passengers = (JSON.parse(o.passengers) || []).filter(p => p && typeof p === 'object').map(p => ({ first_name: p.name || '', last_name: p.surname || '', seat_name: p.seat_name || '' })); } catch { }
...
try { tickets = (JSON.parse(o.tickets) || []).filter(tk => tk && typeof tk === 'object' && tk.id != null).map(tk => ({ id: tk.id })); } catch { }
```

- [ ] **Step 4: Проверка.** `node -c server.js`; рестарт сервера (netstat → taskkill → node server.js фоном); `npm test` → 11 pass.

- [ ] **Step 5: Commit.**

```bash
git add server.js
git commit -m "chore(server): таймауты fetch в PDF-прокси, единый node:crypto, устойчивые map брони"
```

---

### Task B: styles.css - фолбэк для color-mix

**Files:**
- Modify: `public/styles.css:532-537` (+ сгенерированные build-routes)

- [ ] **Step 1: Фолбэк-строки.** Перед каждым `background: color-mix(...)` добавить обычную rgba-декларацию (каскад: старый Safari возьмёт rgba, новый - color-mix):

```css
.ok-msgr-tg { background: rgba(42,171,238,.1); background: color-mix(in srgb, #2AABEE 10%, transparent); color: #1a7eba; }
.ok-msgr-tg:hover { background: rgba(42,171,238,.18); background: color-mix(in srgb, #2AABEE 18%, transparent); }
.ok-msgr-vb { background: rgba(115,96,242,.1); background: color-mix(in srgb, #7360F2 10%, transparent); color: #5745c5; }
.ok-msgr-vb:hover { background: rgba(115,96,242,.18); background: color-mix(in srgb, #7360F2 18%, transparent); }
.ok-msgr-wa { background: rgba(37,211,102,.1); background: color-mix(in srgb, #25D366 10%, transparent); color: #1fa952; }
.ok-msgr-wa:hover { background: rgba(37,211,102,.18); background: color-mix(in srgb, #25D366 18%, transparent); }
```

(rgba проверить: #2AABEE=42,171,238; #7360F2=115,96,242; #25D366=37,211,102.)

- [ ] **Step 2: Сборка.** `node build-routes.js`; проверить, что фолбэк попал в styles.min.css (csso не должен схлопнуть двойной background - проверить grep-ом `rgba(42,171,238` в min-файле; если csso удалил фолбэк - остановиться и доложить, НЕ коммитить).

- [ ] **Step 3: `npm test`** → 11 pass (статика, рестарт не нужен).

- [ ] **Step 4: Commit** (styles.css + все сгенерированные).

```bash
git commit -m "fix(css): rgba-фолбэк для color-mix - кнопки мессенджеров в старых Safari"
```

---

## Финальная проверка

- [ ] `npm test` - 11 pass.
- [ ] Диф обеих задач - одно ревью (маленькие правки).
- [ ] Push - после одобрения пользователя.
