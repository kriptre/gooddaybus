const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const os = require('os');
const db = require('./db');

// Завантажуємо секрети з файлу .env (якщо є). Node 22+ має вбудований loadEnvFile.
try { process.loadEnvFile(); } catch { /* .env необов'язковий */ }

const app = express();
// Хостинг (Railway тощо) сам видає порт через змінну PORT. Локально — 3000.
const PORT = process.env.PORT || 3000;
// За реверс-проксі (Railway/Nginx) — щоб req.ip був реальним IP клієнта (для rate-limit)
app.set('trust proxy', 1);

// Глобальні запобіжники: одна необроблена помилка в проміс-ланцюжку не повинна ронити сервіс.
process.on('unhandledRejection', err => console.error('[unhandledRejection]', err?.message || err));
process.on('uncaughtException', err => console.error('[uncaughtException]', err?.message || err));

// Локальна IP-адреса машини (Telegram не робить клікабельним "localhost",
// а ось http://192.168.x.x:PORT — робить, і відкривається з телефону в тій же Wi-Fi).
function getLanIp() {
    for (const iface of Object.values(os.networkInterfaces())) {
        for (const i of iface) {
            if (i.family === 'IPv4' && !i.internal) return i.address;
        }
    }
    return 'localhost';
}

// Безпекові заголовки. CSP налаштований під наш інлайн-стиль/скрипти та FontAwesome CDN.
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://cdnjs.cloudflare.com', 'https://fonts.gstatic.com', 'data:'],
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"]
        }
    },
    crossOriginEmbedderPolicy: false
}));
app.use(compression()); // gzip відповідей (HTML/JSON/CSS) — менше трафіку, швидше завантаження

// CORS: у проді дозволяємо лише наш домен; локально — будь-який (зручно для розробки).
// Сам сайт працює same-origin (фронт віддається цим же сервером), тож на нього це не впливає.
const CORS_ALLOW = (process.env.CORS_ORIGINS ||
    'https://gooddaybus.com,https://www.gooddaybus.com').split(',').map(s => s.trim());
app.use(cors({
    origin(origin, cb) {
        // origin відсутній у same-origin/мобільних/curl запитах — дозволяємо
        if (!origin || process.env.NODE_ENV !== 'production' || CORS_ALLOW.includes(origin)) return cb(null, true);
        cb(null, false);
    }
}));
app.use(express.json({ limit: '64kb' })); // захист від велетенських тіл запитів

// Роздаємо ЛИШЕ публічну папку (index.html, admin.html, stats.html).
// Завдяки цьому .env, orders.db, server.js та інші файли НЕ доступні через URL.
app.use(express.static(require('path').join(__dirname, 'public')));

// ==========================================
// КОНФІГ — усі секрети беруться з .env (див. .env.example)
const API_BASE_URL = 'https://api.contrabus.ua/v1';
const API_LOGIN = process.env.API_LOGIN || '';
const API_PASSWORD = process.env.API_PASSWORD || '';

// Ключ доступу до панелі менеджера
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me';

// Telegram-сповіщення та кнопки керування заявками
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

// Публічна адреса сайту (для посилання на панель у Telegram).
// Локально — IP машини; після викладки на домен задай PUBLIC_BASE_URL у .env.
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://${getLanIp()}:${PORT}`;

// Статуси українською (для Telegram, CSV тощо)
const STATUS_UA = { new: 'Новий', in_progress: 'В роботі', done: 'Опрацьовано', cancelled: 'Відмова' };
// Статуси скасованих бронювань Contrabus — не рахуємо у статистиці продажів
const CANCELLED_BOOKING = new Set(['agent_cancel', 'carrier_cancel']);

const IS_PROD = process.env.NODE_ENV === 'production';
// Єдина обробка 500: деталі — лише в лог сервера; клієнту в проді — загальний текст
// (щоб не світити стек/внутрішні повідомлення). Локально віддаємо реальну помилку — зручніше дебажити.
function serverError(res, err, tag = 'API') {
    console.error(`[${tag}]`, err?.message || err);
    return res.status(500).json({ error: IS_PROD ? 'Внутрішня помилка сервера' : (err?.message || 'error') });
}
// ==========================================

let authToken = null;
let tokenExpiry = null;

// Функція отримання/оновлення токену (кешується на 50 хвилин)
async function getToken() {
    if (authToken && tokenExpiry && Date.now() < tokenExpiry) {
        return authToken;
    }

    console.log('[Auth] Отримуємо новий токен...');
    const res = await fetch(`${API_BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: API_LOGIN, password: API_PASSWORD })
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Авторизація не вдалась (${res.status}): ${text}`);
    }

    const data = await res.json();
    authToken = data.token;
    tokenExpiry = Date.now() + 50 * 60 * 1000; // 50 хвилин
    console.log('[Auth] Токен отримано успішно');
    return authToken;
}

// ==========================================
// Ліміти частоти запитів за IP — захист агентського акаунта contrabus
// від вичерпання квоти та сервера від зловживань
// ==========================================
function makeRateLimiter(windowMs, max) {
    const hits = new Map(); // ip -> [мітки часу]
    return ip => {
        const now = Date.now();
        if (hits.size > 10000) hits.clear(); // запобіжник від розростання пам'яті
        const arr = (hits.get(ip) || []).filter(t => now - t < windowMs);
        if (arr.length >= max) { hits.set(ip, arr); return true; }
        arr.push(now);
        hits.set(ip, arr);
        return false;
    };
}
const searchLimited    = makeRateLimiter(60 * 1000, 30);     // пошук: 30/хв
const suggestLimited   = makeRateLimiter(60 * 1000, 6);      // підказки (важкі): 6/хв
const discountsLimited = makeRateLimiter(60 * 1000, 30);     // знижки: 30/хв
const orderLimited     = makeRateLimiter(10 * 60 * 1000, 5); // заявки: 5 за 10 хв

// GET /api/cities — список міст (через 30-хв кеш getCities, щоб не бити
// contrabus на кожне відкриття сайту)
app.get('/api/cities', async (req, res) => {
    try {
        res.json(await getCities());
    } catch (err) {
        serverError(res, err, 'Cities');
    }
});

// Кеш результатів пошуку (той самий маршрут+дата) на 2 хвилини — згладжує затримки
// повільного API та навантаження від D2C-трафіку (багато людей шукають той самий рейс).
const searchCache = new Map();
const SEARCH_TTL = 2 * 60 * 1000;

// POST /api/search — пошук рейсів
app.post('/api/search', async (req, res) => {
    try {
        const { from_id, to_id, date } = req.body;
        if (!from_id || !to_id || !date) {
            return res.status(400).json({ error: 'Потрібні from_id, to_id та date' });
        }
        if (searchLimited(req.ip || 'unknown')) {
            return res.status(429).json({ error: 'Забагато запитів. Зачекайте хвилину.' });
        }

        const cacheKey = `${from_id}|${to_id}|${date}`;
        const hit = searchCache.get(cacheKey);
        let routes;

        if (hit && Date.now() - hit.t < SEARCH_TTL) {
            routes = hit.data;                       // миттєва відповідь з кешу
            console.log(`[Search] ${from_id} → ${to_id} на ${date} — з кешу (${routes.length})`);
        } else {
            const token = await getToken();
            console.log(`[Search] ${from_id} → ${to_id} на ${date}`);
            const response = await fetch(`${API_BASE_URL}/info/search`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ from_id, to_id, date })
            });
            // 404 = немає рейсів на цей напрямок/дату (не помилка)
            if (response.status === 404) {
                routes = [];
            } else if (!response.ok) {
                throw new Error(`API помилка: ${response.status}`);
            } else {
                const data = await response.json();
                routes = Array.isArray(data) ? data : [];
            }
            console.log(`[Search] Знайдено рейсів: ${routes.length}`);
            if (searchCache.size > 500) searchCache.clear();
            searchCache.set(cacheKey, { data: routes, t: Date.now() });
        }

        res.json(routes);

        // Лог пошуку для аналітики — ПІСЛЯ відповіді, щоб не затримувати клієнта (рахуємо й кеш-хіти)
        try {
            const cs = await getCities();
            const nm = id => { const c = cs.find(x => String(x.id) === String(id)); return c ? c.name : ''; };
            db.logSearch(nm(from_id), nm(to_id), date, routes.length);
        } catch (e) { /* аналітика не критична */ }
    } catch (err) {
        serverError(res, err, 'Search');
    }
});

// ==========================================
// ПІДКАЗКИ, коли на дату/напрямок рейсів немає
// ==========================================

// Кеш списку міст (з координатами) — оновлюється раз на 30 хв
let citiesCache = null, citiesCacheTime = 0;
async function getCities() {
    if (citiesCache && Date.now() - citiesCacheTime < 30 * 60 * 1000) return citiesCache;
    const token = await getToken();
    const r = await fetch(`${API_BASE_URL}/info/get_cities`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    if (!r.ok) throw new Error(`get_cities ${r.status}`);
    citiesCache = await r.json();
    citiesCacheTime = Date.now();
    return citiesCache;
}

// Кеш результатів searchCount (щоб не довбати API повторно). TTL 30 хв.
const scCache = new Map();
async function searchCount(token, from, to, date) {
    const key = `${from}|${to}|${date}`;
    const hit = scCache.get(key);
    if (hit && Date.now() - hit.t < 30 * 60 * 1000) return hit.n;
    const r = await fetch(`${API_BASE_URL}/info/search`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_id: from, to_id: to, date })
    });
    let n = 0;
    if (r.status === 200) { const d = await r.json(); n = Array.isArray(d) ? d.length : 0; }
    if (scCache.size > 5000) scCache.clear(); // простий запобіжник від розростання
    scCache.set(key, { n, t: Date.now() });
    return n;
}

function addDays(ddmmyyyy, n) {
    const [d, m, y] = ddmmyyyy.split('.').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + n);
    return String(dt.getDate()).padStart(2, '0') + '.' + String(dt.getMonth() + 1).padStart(2, '0') + '.' + dt.getFullYear();
}

function haversineKm(a, b) {
    const R = 6371, toR = x => x * Math.PI / 180;
    const dLat = toR(b[0] - a[0]), dLon = toR(b[1] - a[1]);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[0])) * Math.cos(toR(b[0])) * Math.sin(dLon / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

// POST /api/suggest — коли рейсів немає: найближча дата або найближчі міста.
// Найважчий ендпоінт (десятки запитів до contrabus) — тому жорсткий ліміт + кеш результату.
const suggestCache = new Map();
app.post('/api/suggest', async (req, res) => {
    try {
        const { from_id, to_id, date } = req.body;
        if (!from_id || !to_id || !date) return res.status(400).json({ error: 'Потрібні from_id, to_id, date' });

        const sKey = `${from_id}|${to_id}|${date}`;
        const sHit = suggestCache.get(sKey);
        if (sHit && Date.now() - sHit.t < 10 * 60 * 1000) return res.json(sHit.d);

        if (suggestLimited(req.ip || 'unknown')) {
            return res.status(429).json({ error: 'Забагато запитів. Зачекайте хвилину.' });
        }
        const sendAndCache = obj => {
            if (suggestCache.size > 500) suggestCache.clear();
            suggestCache.set(sKey, { d: obj, t: Date.now() });
            return res.json(obj);
        };

        const token = await getToken();
        const tStart = Date.now();

        // 1) Найближча дата з рейсами на тому самому напрямку (наступні 14 днів,
        //    чанками по 7 — щойно в чанку є рейс, повертаємо найранішу дату).
        for (let start = 1; start <= 14; start += 7) {
            const batch = [];
            for (let i = start; i < start + 7 && i <= 14; i++) batch.push(addDays(date, i));
            const counts = await Promise.all(batch.map(d => searchCount(token, from_id, to_id, d)));
            const j = counts.findIndex(c => c > 0);
            if (j !== -1) return sendAndCache({ type: 'date', date: batch[j], count: counts[j] });
        }

        // 2) Найближчі міста до пункту призначення, куди є рейси на цю дату.
        //    Перебір з обмеженням за часом (CITY_BUDGET) — щоб не зависнути на повільному API.
        const CITY_BUDGET = 9000, CHUNK = 12;
        const cities = await getCities();
        const target = cities.find(c => String(c.id) === String(to_id));
        if (target && target.lat_lon) {
            const [tlat, tlon] = target.lat_lon.split(',').map(Number);
            const pool = cities
                .filter(c => c.lat_lon && String(c.id) !== String(to_id) && String(c.id) !== String(from_id))
                .map(c => { const [la, lo] = c.lat_lon.split(',').map(Number); return { id: c.id, name: c.name, country_code: c.country_code, distance_km: haversineKm([tlat, tlon], [la, lo]) }; })
                .sort((a, b) => a.distance_km - b.distance_km)
                .slice(0, 200);

            const found = [];
            for (let i = 0; i < pool.length && found.length < 3 && (Date.now() - tStart) < CITY_BUDGET; i += CHUNK) {
                const slice = pool.slice(i, i + CHUNK);
                const counts = await Promise.all(slice.map(c => searchCount(token, from_id, c.id, date)));
                slice.forEach((c, j) => { if (counts[j] > 0) found.push({ ...c, count: counts[j] }); });
            }
            if (found.length) {
                found.sort((a, b) => a.distance_km - b.distance_km);
                return sendAndCache({ type: 'cities', alternatives: found.slice(0, 3) });
            }
        }
        return sendAndCache({ type: 'none' });
    } catch (err) {
        console.error('[Suggest]', err.message);
        res.json({ type: 'none' }); // підказка необов'язкова — не ламаємо UX (помилки не кешуємо)
    }
});

// ==========================================
// ЗАЯВКИ КЛІЄНТІВ (CRM)
// ==========================================

// --- Telegram: сповіщення + кнопки керування заявкою ---
const TG_API = TELEGRAM_BOT_TOKEN ? `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}` : '';
const STATUS_EMOJI = { new: '🔴', in_progress: '🟡', done: '🟢', cancelled: '⚪' };

async function tg(method, body) {
    if (!TG_API) return null;
    const r = await fetch(`${TG_API}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const j = await r.json();
    if (!j.ok) console.error(`[Telegram] ${method} помилка:`, j.description);
    return j;
}

// Офсайт-бекап: щодня шлемо свіжу копію бази в окремий приватний чат/групу Telegram
// (TELEGRAM_BACKUP_CHAT_ID у .env; без нього — нічого не відбувається).
// Маркер-файл .last-sent на томі захищає від дублів при кожному рестарті/деплої.
const TELEGRAM_BACKUP_CHAT_ID = process.env.TELEGRAM_BACKUP_CHAT_ID || '';
async function sendBackupToTelegram(file) {
    if (!TG_API || !TELEGRAM_BACKUP_CHAT_ID || !file) return;
    const fs = require('fs'), path = require('path');
    const marker = path.join(path.dirname(file), '.last-sent');
    const today = new Date().toISOString().slice(0, 10);
    try {
        if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === today) return; // сьогодні вже надіслано
        const buf = fs.readFileSync(file);
        const fd = new FormData();
        fd.append('chat_id', TELEGRAM_BACKUP_CHAT_ID);
        fd.append('caption', `💾 GoodDayBus — бекап бази ${today} · ${Math.max(1, Math.round(buf.length / 1024))} КБ`);
        fd.append('document', new Blob([buf]), path.basename(file));
        const r = await fetch(`${TG_API}/sendDocument`, { method: 'POST', body: fd });
        const j = await r.json();
        if (!j.ok) throw new Error(j.description || `HTTP ${r.status}`);
        fs.writeFileSync(marker, today);
        console.log('[Backup] Копію надіслано в Telegram');
    } catch (e) {
        console.error('[Backup] Telegram:', e.message); // не критично — локальна копія вже збережена
    }
}

// Екранування для parse_mode=HTML (надійніше за Markdown, бо у даних бувають _ * тощо)
function escHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Прибираємо дублювання назви міста на початку адреси станції ("Запоріжжя, Автовокзал…" → "Автовокзал…")
function stripCity(station, city) {
    const s = String(station || '').trim();
    if (city && s.toLowerCase().startsWith(String(city).toLowerCase() + ',')) {
        return s.slice(String(city).length + 1).trim();
    }
    return s;
}

function parsePassengers(order) {
    try { const a = JSON.parse(order.passengers); return Array.isArray(a) ? a : []; } catch { return []; }
}

function seatsWord(n) {
    n = Number(n) || 1;
    if (n % 10 === 1 && n % 100 !== 11) return 'місце';
    if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'місця';
    return 'місць';
}

function orderMessageText(order, footer) {
    const pax = parsePassengers(order);
    const seats = order.seats || pax.length || 1;
    // Базова ціна за місце ("4200 ₴" / "107.53 €") → число + символ валюти
    const basePrice = parseFloat(String(order.route_price || '').replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
    const curSym = String(order.route_price || '').replace(/[\d.,\s]/g, '');
    const r2 = v => Math.round(v * 100) / 100;
    const paxPrice = p => r2(basePrice * (1 - (+p.discount_percent || 0) / 100));
    const hasDisc = basePrice > 0 && pax.some(p => +p.discount_percent > 0);

    const info = [
        order.route_carrier ? `🚍 ${escHtml(order.route_carrier)}` : '',
        `🎫 ${seats} ${seatsWord(seats)}`,
        order.route_price ? `💵 ${escHtml(order.route_price)}` : ''
    ].filter(Boolean).join('  ·  ');

    let t =
        `🚌 <b>Заявка #${order.id}</b>  ·  ${STATUS_EMOJI[order.status] || ''} ${STATUS_UA[order.status] || order.status}\n\n` +
        `📍 <b>${escHtml(order.route_from)} → ${escHtml(order.route_to)}</b>\n` +
        `🗓 ${escHtml(order.route_date)}${order.route_time ? ', ' + escHtml(order.route_time) : ''}\n` +
        info;
    if (order.route_from_station) t += `\n\n🚏 <b>Посадка:</b> ${escHtml(stripCity(order.route_from_station, order.route_from))}`;
    if (order.route_to_station) t += `\n🏁 <b>Висадка:</b> ${escHtml(stripCity(order.route_to_station, order.route_to))}`;

    if (pax.length) {
        t += `\n\n👥 <b>Пасажири:</b>\n` +
            pax.map((p, i) => `${i + 1}. ${escHtml(p.name)} ${escHtml(p.surname)} — ${escHtml(p.phone)}` +
                (p.discount_percent > 0
                    ? ` 🏷 <i>${escHtml(p.discount_label || 'знижка')}</i>${basePrice ? ` → <b>${paxPrice(p)} ${escHtml(curSym)}</b>` : ''}`
                    : '')).join('\n');
        // Підсумок зі знижками: разом до/після
        if (hasDisc) {
            const full = r2(basePrice * pax.length);
            const total = r2(pax.reduce((s, p) => s + paxPrice(p), 0));
            t += `\n\n💰 <b>Разом зі знижками: ${total} ${escHtml(curSym)}</b> <s>${full} ${escHtml(curSym)}</s>`;
        }
    } else {
        t += `\n\n👤 ${escHtml(order.client_name)} — ${escHtml(order.client_phone)}`;
    }
    if (order.comment) t += `\n\n💬 ${escHtml(order.comment)}`;
    if (order.check_warning) t += `\n\n⚠️ <b>Увага:</b> ${escHtml(order.check_warning)}`;
    if (footer) t += `\n<i>${escHtml(footer)}</i>`;
    t += `\n\n<a href="${PUBLIC_BASE_URL}/admin.html">🔧 Панель менеджера</a>`;
    return t;
}

function orderKeyboard(order) {
    const b = [];
    if (order.status !== 'in_progress' && order.status !== 'done') b.push({ text: '🟡 В роботу', callback_data: `st:in_progress:${order.id}` });
    if (order.status !== 'done') b.push({ text: '🟢 Опрацьовано', callback_data: `st:done:${order.id}` });
    if (order.status !== 'cancelled') b.push({ text: '⚪ Відмова', callback_data: `st:cancelled:${order.id}` });
    const rows = b.length ? [b] : [];
    // Агентський сайт бронювання (менеджер уже залогінений у браузері під своїм акаунтом)
    rows.push([{ text: 'Contrabus', url: 'https://disp.contrabus.ua/?page=booking' }]);
    return { inline_keyboard: rows };
}

// Сповіщення про нову заявку (тихо ігнорується, якщо Telegram не налаштовано)
async function notifyTelegram(order) {
    if (!TG_API || !TELEGRAM_CHAT_ID) return;
    try {
        await tg('sendMessage', {
            chat_id: TELEGRAM_CHAT_ID, text: orderMessageText(order),
            parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: orderKeyboard(order)
        });
    } catch (err) {
        console.error('[Telegram] Не вдалося надіслати сповіщення:', err.message);
    }
}

// Обробка натискання кнопок (callback_query)
async function handleCallback(cq) {
    const [action, status, idStr] = (cq.data || '').split(':');
    let toast = '';
    if (action === 'st' && idStr && STATUS_UA[status]) {
        const order = db.updateOrder(Number(idStr), { status });
        if (order) {
            const who = cq.from.first_name + (cq.from.username ? ` (@${cq.from.username})` : '');
            toast = `Статус: ${STATUS_UA[status]}`;
            try {
                await tg('editMessageText', {
                    chat_id: cq.message.chat.id, message_id: cq.message.message_id,
                    text: orderMessageText(order, `${who} → ${STATUS_UA[order.status]}`),
                    parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: orderKeyboard(order)
                });
            } catch (e) { console.error('[Telegram] edit:', e.message); }
        } else toast = 'Заявку не знайдено';
    }
    try { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: toast }); } catch (e) {}
}

// Long-polling: слухаємо натискання кнопок (без вебхука/публічного URL)
let tgOffset = 0;
async function pollTelegram() {
    if (!TG_API) return;
    try {
        const r = await fetch(`${TG_API}/getUpdates?timeout=30&offset=${tgOffset}&allowed_updates=%5B%22callback_query%22%5D`);
        const j = await r.json();
        if (j.ok) for (const u of j.result) { tgOffset = u.update_id + 1; if (u.callback_query) await handleCallback(u.callback_query); }
    } catch (e) { /* мережеві збої ігноруємо, продовжуємо опитування */ }
    setTimeout(pollTelegram, 500);
}
async function initTelegram() {
    if (!TG_API) return;
    try {
        const j = await (await fetch(`${TG_API}/getUpdates?timeout=0&offset=-1`)).json();
        if (j.ok && j.result.length) tgOffset = j.result[j.result.length - 1].update_id + 1; // пропускаємо старі апдейти
    } catch (e) {}
    pollTelegram();
    console.log('   🔘 Telegram-кнопки керування заявками активні');
}

const phoneDigits = s => (String(s || '').match(/\d/g) || []).length;
const cap = (v, n) => String(v == null ? '' : v).slice(0, n); // обрізаємо надто довгі рядки
const MAX_PASSENGERS = 30;

// POST /api/order — клієнт залишає заявку зі списком пасажирів (публічний)
app.post('/api/order', async (req, res) => {
    try {
        const { passengers, hp } = req.body;

        // 1) Honeypot: приховане поле, яке заповнюють лише боти → тихо ігноруємо
        if (hp) {
            console.log('[Order] Заблоковано бота (honeypot)');
            return res.status(201).json({ ok: true }); // вдаємо успіх, щоб бот не повторював
        }

        // 2) Готуємо й перевіряємо список пасажирів (з обмеженням довжин і кількості — захист від сміття/DoS)
        if (Array.isArray(passengers) && passengers.length > MAX_PASSENGERS) {
            return res.status(400).json({ error: `Забагато пасажирів (максимум ${MAX_PASSENGERS})` });
        }
        const list = (Array.isArray(passengers) ? passengers : [])
            .slice(0, MAX_PASSENGERS)
            .map(p => ({
                name: cap(String(p.name || '').trim(), 80), surname: cap(String(p.surname || '').trim(), 80), phone: cap(String(p.phone || '').trim(), 32),
                ticket_type: cap(p.ticket_type || '', 40), discount_label: cap(String(p.discount_label || '').trim(), 80), discount_percent: +p.discount_percent || 0
            }))
            .filter(p => p.name || p.surname || p.phone);

        if (!list.length) {
            return res.status(400).json({ error: 'Додайте хоча б одного пасажира' });
        }
        for (let i = 0; i < list.length; i++) {
            const p = list[i];
            if (p.name.length < 1 || p.surname.length < 1) {
                return res.status(400).json({ error: `Вкажіть ім'я та прізвище пасажира №${i + 1}` });
            }
            const d = phoneDigits(p.phone);
            if (d < 9 || d > 15) {
                return res.status(400).json({ error: `Перевірте телефон пасажира №${i + 1}` });
            }
        }

        // 3) Обмеження частоти за IP
        const ip = req.ip || req.connection?.remoteAddress || 'unknown';
        if (orderLimited(ip)) {
            console.log(`[Order] Перевищено ліміт заявок з IP ${ip}`);
            return res.status(429).json({ error: 'Забагато заявок. Спробуйте трохи пізніше або зателефонуйте нам.' });
        }

        // 4) Перший пасажир — основний контакт заявки
        const client_name = `${list[0].name} ${list[0].surname}`.trim();
        const client_phone = list[0].phone;

        // 5) Перевірка телефонів на чорний список / дублі (ДО створення — щоб зберегти пометку).
        //    Заявку НЕ блокуємо: вона приходить, але з позначкою.
        let check_warning = '';
        if (req.body.data_bundle) {
            try {
                const token = await getToken();
                const r = await fetch(`${API_BASE_URL}/bookings/booking_allow_check`, {
                    method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data_bundle: req.body.data_bundle, phones: list.map(p => p.phone) })
                });
                const j = await r.json();
                if (j && j.message && !/no possible|not found|немає/i.test(j.message)) {
                    check_warning = j.message;
                    console.log(`[Order] ⚠️ allow_check: ${j.message}`);
                }
            } catch (e) { /* перевірка не критична */ }
        }

        const order = db.createOrder({
            ...req.body,
            comment: cap(req.body.comment, 1000),
            route_from: cap(req.body.route_from, 200), route_to: cap(req.body.route_to, 200),
            route_from_station: cap(req.body.route_from_station, 200), route_to_station: cap(req.body.route_to_station, 200),
            route_date: cap(req.body.route_date, 40), route_time: cap(req.body.route_time, 40),
            route_price: cap(req.body.route_price, 40), route_carrier: cap(req.body.route_carrier, 120),
            passengers: list, client_name, client_phone, check_warning
        });
        console.log(`[Order] Нова заявка #${order.id} — ${client_name}, ${client_phone}, пасажирів: ${list.length}`);

        notifyTelegram(order); // не чекаємо — відправляється у фоні
        res.status(201).json({ ok: true, id: order.id });
    } catch (err) {
        serverError(res, err, 'Order');
    }
});

// POST /api/visit — лічильник відвідувань (публічний, без даних користувача)
app.post('/api/visit', (req, res) => {
    try { db.logVisit(); } catch (e) {}
    res.status(204).end();
});

// POST /api/discounts — знижки конкретного рейсу (за data_bundle з пошуку). Кеш 6 год.
const discCache = new Map();
app.post('/api/discounts', async (req, res) => {
    try {
        const { data_bundle } = req.body;
        if (!data_bundle) return res.json([]);
        const key = String(data_bundle).slice(0, 60);
        const hit = discCache.get(key);
        if (hit && Date.now() - hit.t < 6 * 60 * 60 * 1000) return res.json(hit.d);
        if (discountsLimited(req.ip || 'unknown')) return res.json([]); // ліміт — тихо без знижок
        const token = await getToken();
        const r = await fetch(`${API_BASE_URL}/info/get_route_discounts`, {
            method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ data_bundle })
        });
        const j = await r.json();
        const d = Array.isArray(j) ? j : [];
        if (discCache.size > 500) discCache.clear();
        discCache.set(key, { d, t: Date.now() });
        res.json(d);
    } catch (e) { res.json([]); }
});

// --- Захист панелі менеджера простим ключем ---
// Анти-брутфорс: після 20 невдалих спроб з одного IP за 10 хв — блокування на час вікна.
const adminFails = new Map(); // ip -> [мітки часу невдалих спроб]
function requireAdmin(req, res, next) {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    if (adminFails.size > 10000) adminFails.clear(); // запобіжник пам'яті
    const fails = (adminFails.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
    if (fails.length >= 20) {
        adminFails.set(ip, fails);
        return res.status(429).json({ error: 'Забагато невдалих спроб. Спробуйте за 10 хвилин.' });
    }
    const key = req.get('x-admin-key'); // лише заголовок — ключ не потрапляє в URL/логи/історію
    if (key !== ADMIN_KEY) {
        fails.push(now);
        adminFails.set(ip, fails);
        return res.status(401).json({ error: 'Невірний ключ доступу' });
    }
    next();
}

// Лічильники для бейджів панелі (статуси + кількість клієнтів)
function countsPayload() {
    return Object.assign(db.statusCounts(), { clients: db.clientsCount() });
}

// GET /api/orders — список заявок (?status=... &q=пошук за ім'ям/телефоном)
app.get('/api/orders', requireAdmin, (req, res) => {
    try {
        res.json({
            orders: db.listOrders(req.query.status, req.query.q),
            counts: countsPayload()
        });
    } catch (err) {
        serverError(res, err);
    }
});

// GET /api/stats — зведена аналітика для дашборду
app.get('/api/stats', requireAdmin, (req, res) => {
    try {
        res.json(db.getStats(req.query.from, req.query.to));
    } catch (err) {
        serverError(res, err);
    }
});

// GET /api/sales-report — реальні продажі/комісія з Contrabus за період (read-only)
const repCache = new Map();
let commissionCache = null;
app.get('/api/sales-report', requireAdmin, async (req, res) => {
    try {
        const from = req.query.from || '2020-01-01';
        const to = req.query.to || new Date().toISOString().slice(0, 10);
        const key = from + '|' + to;
        const hit = repCache.get(key);
        if (hit && Date.now() - hit.t < 60 * 1000) return res.json(hit.d);

        const token = await getToken();
        const conv = d => d.split('-').reverse().join('.'); // YYYY-MM-DD -> DD.MM.YYYY
        const r = await fetch(`${API_BASE_URL}/bookings/get_booking_report`, {
            method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ start_date: conv(from), final_date: conv(to), report_type: 'general', date_type: 'booking' })
        });
        if (!r.ok) throw new Error(`report ${r.status}`);
        const j = await r.json();
        // Виключаємо скасовані брони (agent_cancel/carrier_cancel) — рахуємо лише реальні продажі.
        const all = Array.isArray(j.bookings) ? j.bookings : [];
        const bookings = all.filter(b => !CANCELLED_BOOKING.has(String(b.status)));
        const routeMap = {};
        bookings.forEach(b => { const k = `${b.from} → ${b.to}`; routeMap[k] = (routeMap[k] || 0) + 1; });
        const topRoutes = Object.entries(routeMap).map(([route, n]) => ({ route, n })).sort((a, b) => b.n - a.n).slice(0, 8);
        // Суми рахуємо самі з не-скасованих (sum_* від API може містити скасовані).
        // Ціна у звіті приходить з комою ("210,00") — нормалізуємо перед parseFloat.
        const num = v => parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.')) || 0;
        const sums = {};
        bookings.forEach(b => { const c = b.currency || 'UAH'; sums[c] = Math.round(((sums[c] || 0) + num(b.price)) * 100) / 100; });

        // Відсоток комісії з акаунту (кеш 1 год)
        if (!commissionCache || Date.now() - commissionCache.t > 3600 * 1000) {
            try {
                const ar = await fetch(`${API_BASE_URL}/info/get_account_details`, {
                    method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}'
                });
                const aj = await ar.json();
                commissionCache = { v: +aj.comission_percent || 0, t: Date.now() };
            } catch { commissionCache = { v: 0, t: Date.now() }; }
        }

        const data = { count: bookings.length, sums, topRoutes, commission_percent: commissionCache.v };
        if (repCache.size > 200) repCache.clear();
        repCache.set(key, { d: data, t: Date.now() });
        res.json(data);
    } catch (err) {
        serverError(res, err);
    }
});

// Реальні бронювання з Contrabus (агентський акаунт). Кеш 60 с.
let cbCache = null, cbCacheT = 0;
async function getContrabusBookings() {
    if (cbCache && Date.now() - cbCacheT < 60 * 1000) return cbCache;
    const token = await getToken();
    const r = await fetch(`${API_BASE_URL}/bookings/get_bookings_list`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({})
    });
    if (!r.ok) throw new Error(`bookings ${r.status}`);
    const j = await r.json();
    cbCache = Array.isArray(j.list) ? j.list : [];
    cbCacheT = Date.now();
    return cbCache;
}

// GET /api/bookings — реальні бронювання з Contrabus (тільки читання)
app.get('/api/bookings', requireAdmin, async (req, res) => {
    try {
        res.json({ bookings: await getContrabusBookings() });
    } catch (err) {
        serverError(res, err);
    }
});

// GET /api/clients — унікальні клієнти з історією (?q=пошук)
app.get('/api/clients', requireAdmin, (req, res) => {
    try {
        res.json({
            clients: db.listClients(req.query.q),
            counts: countsPayload()
        });
    } catch (err) {
        serverError(res, err);
    }
});

// GET /api/orders/export.csv — вивантаження всіх заявок у CSV (відкривається в Excel)
app.get('/api/orders/export.csv', requireAdmin, (req, res) => {
    try {
        const rows = db.listOrders(req.query.status, req.query.q);
        const headers = ['ID', 'Створено', 'Статус', "Ім'я", 'Телефон', 'Звідки', 'Куди',
                         'Станція звідки', 'Станція куди', 'Дата рейсу', 'Час', 'Місць', 'Пасажири', 'Ціна', 'Перевізник', 'Коментар', 'Нотатка менеджера'];
        // Захист від CSV-інʼєкції: значення, що починається з = + - @ (або tab/CR),
        // Excel може виконати як формулу. Префіксуємо апострофом — клітинка лишається текстом.
        const esc = v => {
            let s = String(v == null ? '' : v);
            if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
            return `"${s.replace(/"/g, '""')}"`;
        };
        const fmtDt = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('uk-UA'); };
        const paxStr = o => { try { const a = JSON.parse(o.passengers); return Array.isArray(a) ? a.map(p => `${p.name} ${p.surname} (${p.phone})`).join('; ') : ''; } catch { return ''; } };
        const lines = [headers.map(esc).join(',')];
        rows.forEach(o => lines.push([
            o.id, fmtDt(o.created_at), STATUS_UA[o.status] || o.status,
            o.client_name, o.client_phone, o.route_from, o.route_to,
            o.route_from_station, o.route_to_station,
            o.route_date, o.route_time, o.seats || 1, paxStr(o), o.route_price, o.route_carrier, o.comment, o.manager_note
        ].map(esc).join(',')));
        // BOM (﻿) — щоб Excel коректно показав кирилицю
        const csv = '﻿' + lines.join('\r\n');
        const fname = `gooddaybus-zayavky-${new Date().toISOString().slice(0, 10)}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
        res.send(csv);
    } catch (err) {
        serverError(res, err);
    }
});

// PATCH /api/orders/:id — зміна статусу / нотатки менеджера
app.patch('/api/orders/:id', requireAdmin, (req, res) => {
    try {
        const order = db.updateOrder(Number(req.params.id), req.body);
        if (!order) return res.status(404).json({ error: 'Заявку не знайдено' });
        res.json(order);
    } catch (err) {
        serverError(res, err);
    }
});

// DELETE /api/orders/:id — видалити одну заявку
app.delete('/api/orders/:id', requireAdmin, (req, res) => {
    try {
        const n = db.deleteOrder(Number(req.params.id));
        if (!n) return res.status(404).json({ error: 'Заявку не знайдено' });
        res.json({ ok: true, deleted: n });
    } catch (err) {
        serverError(res, err);
    }
});

// DELETE /api/clients?phone=... — видалити клієнта разом з усіма заявками
app.delete('/api/clients', requireAdmin, (req, res) => {
    try {
        const phone = req.query.phone;
        if (!phone) return res.status(400).json({ error: 'Потрібен phone' });
        const n = db.deleteClient(phone, req.query.name);
        console.log(`[Delete] Клієнт ${req.query.name || ''} ${phone} — змінено заявок: ${n}`);
        res.json({ ok: true, deleted: n });
    } catch (err) {
        serverError(res, err);
    }
});

app.listen(PORT, () => {
    console.log(`✅ Сервер запущено: http://localhost:${PORT}`);
    console.log(`   Сайт:             http://localhost:${PORT}/`);
    console.log(`   Панель (локально): http://localhost:${PORT}/admin.html`);
    console.log(`   Панель (з телефону в тій же Wi-Fi): ${PUBLIC_BASE_URL}/admin.html`);
    if (!API_LOGIN || !API_PASSWORD) console.log('   ⚠️  Не задано API_LOGIN/API_PASSWORD у .env — пошук рейсів не працюватиме!');
    if (!TELEGRAM_BOT_TOKEN) console.log('   ℹ️  Telegram вимкнено (не задано TELEGRAM_BOT_TOKEN у .env)');
    if (!process.env.ADMIN_KEY || ADMIN_KEY === 'change-me' || ADMIN_KEY.length < 12) {
        console.log('   ⚠️  ADMIN_KEY відсутній або заслабкий — задай довгий випадковий ключ (≥16 символів)!');
    }

    // Резервна копія бази: одразу при старті та далі раз на добу (+ копія в Telegram, якщо налаштовано)
    sendBackupToTelegram(db.backupDb());
    setInterval(() => sendBackupToTelegram(db.backupDb()), 24 * 60 * 60 * 1000);

    // Слухаємо натискання Telegram-кнопок
    initTelegram();
});
