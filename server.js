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
            scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://www.googletagmanager.com'],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://cdnjs.cloudflare.com', 'https://fonts.gstatic.com', 'data:'],
            imgSrc: ["'self'", 'data:', 'https://www.googletagmanager.com', 'https://*.google-analytics.com'],
            connectSrc: ["'self'", 'https://www.google-analytics.com', 'https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://www.googletagmanager.com'],
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

// Виключення з аналітики: власні (тестові) заходи не повинні псувати статистику.
// 1) за IP - список у EXCLUDED_IPS (через кому);
// 2) за прапором notrack у запиті - браузер, де відкрито gooddaybus.com/?notrack=1.
const EXCLUDED_IPS = new Set((process.env.EXCLUDED_IPS || '').split(',').map(s => s.trim()).filter(Boolean));
const skipStats = req => EXCLUDED_IPS.has(req.ip) || req.body?.notrack === true;

// SEO: один канонічний домен - www.gooddaybus.com перенаправляємо на голий домен (301)
app.use((req, res, next) => {
    const host = req.headers.host || '';
    if (host.startsWith('www.')) return res.redirect(301, `https://${host.slice(4)}${req.originalUrl}`);
    next();
});

// Роздаємо ЛИШЕ публічну папку (index.html, admin.html, stats.html).
// Завдяки цьому .env, orders.db, server.js та інші файли НЕ доступні через URL.
// no-cache для HTML: браузер щоразу звіряє версію з сервером (ETag → дешеве 304),
// тому після деплою користувачі одразу бачать нову версію, а не стару з кешу.
app.use(express.static(require('path').join(__dirname, 'public'), {
    extensions: ['html'], // чисті URL без .html: /kyiv-varshava → kyiv-varshava.html
    setHeaders(res, filePath) {
        const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
        if (ext === '.html') {
            res.setHeader('Cache-Control', 'no-cache'); // звіряємо версію щоразу (дешеве 304)
        } else if (ext === '.js' || ext === '.css') {
            // версіонуються через ?v=хеш у HTML, тож кешуємо надовго - менше запитів при переходах
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (ext === '.xml' || ext === '.txt' || ext === '.webmanifest') {
            res.setHeader('Cache-Control', 'public, max-age=3600'); // sitemap/robots/manifest оновлюються
        } else {
            res.setHeader('Cache-Control', 'public, max-age=86400'); // картинки/іконки (не версіонуються)
        }
    }
}));

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

// --- Автобронювання (Фаза 2а) ---
// Вимкнено за замовчуванням: без BOOKING_ENABLED=1 сайт працює як раніше (лише заявки менеджеру).
const BOOKING_ENABLED = process.env.BOOKING_ENABLED === '1';
// Більше пасажирів за раз — лише через менеджера (захист від помилкових масових броней)
const BOOKING_MAX_PAX = Math.max(1, parseInt(process.env.BOOKING_MAX_PAX, 10) || 5);
// Тестовий режим: уся логіка працює, але create_booking НЕ викликається (фейкові квитки)
const BOOKING_DRY_RUN = process.env.BOOKING_DRY_RUN === '1';

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

// Спільний пошук рейсів з кешем: для /api/search та для перевірки перед автобронюванням
async function searchRoutes(from_id, to_id, date) {
    const cacheKey = `${from_id}|${to_id}|${date}`;
    const hit = searchCache.get(cacheKey);
    if (hit && Date.now() - hit.t < SEARCH_TTL) {
        console.log(`[Search] ${from_id} → ${to_id} на ${date} — з кешу (${hit.data.length})`);
        return hit.data;
    }
    const token = await getToken();
    console.log(`[Search] ${from_id} → ${to_id} на ${date}`);
    const response = await fetch(`${API_BASE_URL}/info/search`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_id, to_id, date })
    });
    let routes;
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
    return routes;
}

// "Передоплата лише для груп" (label_type='prepayment', у тексті умови є "груп"):
// для пасажирів МЕНШЕ порогу це фактично рейс без передоплати - дозволяємо автобронь.
const isGroupPrepay = rt => rt.label_type === 'prepayment' && /груп/i.test(rt.price_label || '');
// Поріг групи з тексту умови ("...для груп з трьох і більше осіб" → 3).
// Не розпарсили - повертаємо 0 (= автобронь заборонена, діємо консервативно).
function groupThreshold(rt) {
    const s = String(rt.price_label || '').toLowerCase().replace(/['’ʼ]/g, '');
    const m = s.match(/з\s+(двох|трьох|чотирьох|пяти|шести|(\d+))/);
    if (!m) return 0;
    if (m[2]) return parseInt(m[2], 10) || 0;
    return { 'двох': 2, 'трьох': 3, 'чотирьох': 4, 'пяти': 5, 'шести': 6 }[m[1]] || 0;
}

// Рейс доступний для миттєвого бронювання: УВІМКНЕНА автобронь + без передоплати
// (або передоплата лише для груп - тоді кількість пасажирів перевіряється при броні)
const isBookableRoute = rt => BOOKING_ENABLED
    && (!rt.label_type || (isGroupPrepay(rt) && groupThreshold(rt) > 1))
    && (rt.free_seats === undefined || +rt.free_seats > 0);

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

        const routes = await searchRoutes(from_id, to_id, date);
        // Позначка bookable — лише підказка для кнопки на фронті;
        // сервер ПЕРЕД бронюванням сам перевіряє рейс ще раз за свіжими даними contrabus
        res.json(routes.map(r => ({ ...r, bookable: isBookableRoute(r) })));

        // Лог пошуку для аналітики — ПІСЛЯ відповіді, щоб не затримувати клієнта (рахуємо й кеш-хіти).
        // Власні/тестові заходи не рахуємо (за IP або прапором notrack).
        if (!skipStats(req)) try {
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
        fd.append('caption', `💾 GoodDayBus - бекап бази ${today} · ${Math.max(1, Math.round(buf.length / 1024))} КБ`);
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

function orderTickets(order) {
    try { const a = JSON.parse(order.tickets); return Array.isArray(a) ? a : []; } catch { return []; }
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
    if (order.booked) {
        const tks = orderTickets(order);
        t += `\n\n✅ <b>ЗАБРОНЬОВАНО автоматично</b> - оплата водієві при посадці`;
        if (tks.length) t += '\n' + tks.map((tk, i) => tk.pdf
            ? `🎟 <a href="${tk.pdf}">Квиток ${escHtml(tk.id)}</a>`
            : `🎟 Квиток ${escHtml(tk.id)}`).join('\n');
    }
    if (order.route_from_station) t += `\n\n🚏 <b>Посадка:</b> ${escHtml(stripCity(order.route_from_station, order.route_from))}`;
    if (order.route_to_station) t += `\n🏁 <b>Висадка:</b> ${escHtml(stripCity(order.route_to_station, order.route_to))}`;

    if (pax.length) {
        t += `\n\n👥 <b>Пасажири:</b>\n` +
            pax.map((p, i) => `${i + 1}. ${escHtml(p.name)} ${escHtml(p.surname)} - ${escHtml(p.phone)}` +
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
        t += `\n\n👤 ${escHtml(order.client_name)} - ${escHtml(order.client_phone)}`;
    }
    if (order.pet) t += `\n\n🐾 <b>Їде з твариною</b> - уточнити розмір і вартість перевезення`;
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
    // Якщо заявка заброньована автоматично — прикріплюємо PDF квитків документами
    // (Telegram сам завантажує файл за URL; збій не критичний — посилання вже є в тексті)
    if (order.booked) {
        for (const tk of orderTickets(order)) {
            if (!tk.pdf) continue;
            try {
                await tg('sendDocument', { chat_id: TELEGRAM_CHAT_ID, document: tk.pdf, caption: `🎟 Квиток ${tk.id} · заявка #${order.id}` });
            } catch (e) { console.error('[Telegram] sendDocument:', e.message); }
        }
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

// Нормалізація телефону: люди в Україні часто вводять без коду країни (067...) або без
// плюса (380...). Прибираємо роздільники та приводимо явно українські формати до
// +380XXXXXXXXX. Іноземні номери з "+" чи "00" не вгадуємо - лишаємо як ввели.
function normalizePhone(raw) {
    let s = String(raw || '').trim().replace(/[\s\-().]/g, '');
    if (/^00\d{8,}$/.test(s)) s = '+' + s.slice(2); // 0038067... → +38067...
    if (s.startsWith('+')) return s;
    if (/^380\d{9}$/.test(s)) return '+' + s;       // 380671234567 → +380671234567
    if (/^0\d{9}$/.test(s)) return '+38' + s;       // 0671234567  → +380671234567
    return s;
}
const MAX_PASSENGERS = 30;

// ==========================================
// АВТОБРОНЮВАННЯ (Фаза 2а): рейси без передоплати бронюються одразу, оплата — водієві.
// Багатошаровий захист від бронювання платних рейсів:
//   1. Клієнт лише ПРОСИТЬ бронь. Сервер шукає рейс у СВІЖІЙ відповіді contrabus за точним
//      збігом data_bundle (підписаний JWT — підробити неможливо) і бронює лише якщо
//      label_type порожній (= без передоплати) та місць достатньо.
//   2. skip_checks:false — contrabus сам ще раз перевіряє дублі та чорний список (406 = відмова).
//   3. Будь-який сумнів чи збій → заявка йде звичайним шляхом до менеджера, клієнт не страждає.
// ==========================================

const ticketPdfLink = id => `https://contrabus.ua/partner_download?ticket2=${encodeURIComponent(id)}`;

// Корисне навантаження data_bundle (JWT contrabus) - лише для ІДЕНТИФІКАЦІЇ рейсу.
// contrabus видає новий JWT на кожен пошук, тому точний збіг рядків працює лише поки
// живий наш 2-хвилинний кеш. Якщо клієнт заповнював форму довше - знаходимо той самий
// рейс у свіжій видачі за trip_id/зупинками/датою і бронюємо вже СВІЖИМ бандлом.
// Усі рішення (передоплата, вільні місця) приймаються за свіжими даними contrabus.
function bundlePayload(b) {
    try { return JSON.parse(Buffer.from(String(b).split('.')[1], 'base64url').toString()).data || null; }
    catch { return null; }
}
const sameTrip = (a, b) => !!a && !!b &&
    String(a.trip_id) === String(b.trip_id) &&
    String(a.connection_trip_id) === String(b.connection_trip_id) &&
    String(a.from_stop_id) === String(b.from_stop_id) &&
    String(a.to_stop_id) === String(b.to_stop_id) &&
    String(a.date) === String(b.date);

// Чи можна бронювати цей рейс - за свіжими даними contrabus, а не зі слів клієнта
async function verifyBookable(body, paxCount) {
    if (!body.data_bundle) return { ok: false, reason: 'немає data_bundle' };
    if (paxCount > BOOKING_MAX_PAX) return { ok: false, reason: `пасажирів більше ліміту (${BOOKING_MAX_PAX})` };
    if (!body.from_id || !body.to_id || !body.route_date) return { ok: false, reason: 'немає from_id/to_id/дати' };
    let routes;
    try {
        routes = await searchRoutes(body.from_id, body.to_id, body.route_date);
    } catch (e) {
        return { ok: false, reason: 'пошук рейсу недоступний' };
    }
    let rt = routes.find(r => r.data_bundle === body.data_bundle);
    if (!rt) {
        const want = bundlePayload(body.data_bundle);
        rt = want ? routes.find(r => sameTrip(bundlePayload(r.data_bundle), want)) : null;
    }
    if (!rt) return { ok: false, reason: 'рейс не знайдено у свіжій видачі' };
    // Захист від підміни рейсу: якщо точний data_bundle не знайшовся і ми взяли рейс за запасним
    // збігом (trip_id/зупинки), він МУСИТЬ збігатися з обраним клієнтом за ціною/перевізником/часом.
    // Інакше (кілька рейсів на цей напрямок + прострочений бандл) автобронь могла б створити квиток
    // ІНШОГО рейсу - тоді НЕ бронюємо автоматично, віддаємо менеджеру.
    const num = s => parseFloat(String(s == null ? '' : s).replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
    const norm = s => String(s || '').trim().toLowerCase();
    const okPrice = !body.route_price || !rt.price || Math.abs(num(rt.price) - num(body.route_price)) < 1;
    const okCarrier = !body.route_carrier || norm(rt.carrier || rt.company) === norm(body.route_carrier);
    const tShown = norm(body.route_time), tFresh = norm(rt.departure_time || rt.time_from);
    const okTime = !tShown || !tFresh || tShown === tFresh;
    if (!okPrice || !okCarrier || !okTime) {
        console.log(`[Booking] ⚠️ свіжий рейс ≠ обраному: ціна ${rt.price}/${body.route_price}, перевізник "${rt.carrier || rt.company}"/"${body.route_carrier}", час ${rt.departure_time || rt.time_from}/${body.route_time}`);
        return { ok: false, reason: 'свіжі дані рейсу не збігаються з обраним (ціна/перевізник/час) - оформіть вручну' };
    }
    if (rt.label_type) {
        // Передоплата лише для груп: бронюємо, поки пасажирів МЕНШЕ порогу перевізника
        if (!isGroupPrepay(rt)) return { ok: false, reason: `рейс потребує передоплати (${rt.label_type})` };
        const thr = groupThreshold(rt);
        if (!thr || paxCount >= thr) {
            return { ok: false, reason: `передоплата для груп від ${thr || '?'} осіб, у заявці ${paxCount}` };
        }
    }
    if (rt.free_seats !== undefined && +rt.free_seats < paxCount) return { ok: false, reason: `вільних місць ${rt.free_seats}, потрібно ${paxCount}` };
    return { ok: true, route: rt };
}

// Створення брони в contrabus → { ok, tickets:[{id,pdf}] } або { ok:false, reason }
// skipChecks=true - для легітимних "дублів" (зворотний рейс, мама+дитина на 1 номер),
// які ми вже самі визнали безпечними; інакше contrabus відбив би їх повторною перевіркою.
async function createBooking(data_bundle, passengers, skipChecks = false) {
    // Діагностика (для звірки з логами contrabus): який саме рейс ідентифікує бандл, що шлемо на бронь
    console.log(`[Booking] → create_booking, data_bundle рейс: ${JSON.stringify(bundlePayload(data_bundle))}`);
    if (BOOKING_DRY_RUN) {
        console.log(`[Booking] DRY RUN — бронь НЕ створюється, фейкові квитки${skipChecks ? ' (skip_checks)' : ''}`);
        return { ok: true, tickets: passengers.map((p, i) => ({ id: `DRYRUN-${i + 1}`, pdf: '' })) };
    }
    const token = await getToken();
    const r = await fetch(`${API_BASE_URL}/bookings/create_booking`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            data_bundle,
            skip_checks: skipChecks, // false - contrabus перевіряє дублі/чорний список; true - для вже схвалених дублів
            // Повний набір полів зі схеми create_booking - як у реальних бронях диспетчера
            // (відсутність будь-якого ключа дає 400 "missing some required fields")
            passengers_data: passengers.map(p => ({
                name: p.name, surname: p.surname, phone: p.phone,
                viber: p.phone,                     // у бронях диспетчера viber завжди = телефон
                email: '',
                comments: '',
                ticket_type: +p.ticket_type || 0,   // id знижки з get_route_discounts (0 = повний квиток)
                discount: 0,
                prepayment: 0,
                seat: 0,                            // 0 = місце призначається автоматично
                booking_type: 'free'                // резерв без оплати - як бронює диспетчер (оплата водієві)
            }))
        })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.success) {
        return { ok: false, reason: `contrabus ${r.status}: ${cap(j.message || j.error || 'невідома помилка', 200)}` };
    }
    const ids = Array.isArray(j.ticket_ids) ? j.ticket_ids : [];
    if (!ids.length) return { ok: false, reason: 'create_booking не повернув ticket_ids' };
    console.log(`[Booking] ✅ Створено бронь: квитки ${ids.join(', ')}`);
    // PDF-посилання: пробуємо точне з get_ticket_info, інакше будуємо за відомим шаблоном
    const tickets = [];
    for (const id of ids) {
        let pdf = ticketPdfLink(id), price = null;
        try {
            const ti = await (await fetch(`${API_BASE_URL}/bookings/get_ticket_info`, {
                method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ticket_id: id })
            })).json();
            const info = Array.isArray(ti) ? ti[0] : ti;
            if (info && info.link_to_pdf) pdf = info.link_to_pdf;
            // Реальна ціна виписаного квитка. Точну назву поля звіримо за логом нижче.
            if (info) {
                const p = info.price ?? info.ticket_price ?? info.cost ?? info.sum ?? info.amount ?? info.total ?? info.fare ?? null;
                if (p != null && p !== '') { const n = parseFloat(String(p).replace(',', '.')); if (!isNaN(n)) price = n; }
            }
            // Лог повної відповіді - щоб підтвердити поле ціни/часу (прибрати після звірки)
            console.log(`[Booking] ticket_info ${id}: ${JSON.stringify(info).slice(0, 700)}`);
        } catch (e) { /* лишаємо шаблонне посилання */ }
        tickets.push({ id, pdf, price });
    }
    return { ok: true, tickets };
}

// --- Розумна обробка "дублів" ---
// contrabus попереджає "already have a booking +-7 days" і для законних випадків
// (зворотний рейс, мама+дитина на 1 номер). Розрізняємо це від чорного списку.
const DUP_RE = /already have a booking|вже.*бронюванн/i;
const digitsOf = s => (String(s || '').match(/\d/g) || []).join('');
const cityNorm = s => String(s || '').trim().toLowerCase();

// Чи має хтось із цих телефонів УЖЕ бронь на ТОЙ САМИЙ напрямок (from→to) найближчим часом.
// Так → це справжній повтор того ж маршруту (не бронюємо авто, менеджеру).
// Ні → дубль через інший рейс/зворотний - бронювати можна. Помилка запиту → вважаємо, що має (безпечно).
async function hasSameRouteBooking(phones, from, to) {
    try {
        const token = await getToken();
        const now = new Date();
        const fmt = dt => `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.${dt.getFullYear()}`;
        const back = new Date(now); back.setDate(back.getDate() - 12); // вікно дубля contrabus ~±7 днів за датою броні
        const fwd = new Date(now); fwd.setDate(fwd.getDate() + 1);
        const r = await fetch(`${API_BASE_URL}/bookings/get_booking_report`, {
            method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ start_date: fmt(back), final_date: fmt(fwd), report_type: 'general', date_type: 'booking' })
        });
        if (!r.ok) return true; // не змогли перевірити - діємо консервативно (менеджеру)
        const j = await r.json();
        const all = Array.isArray(j.bookings) ? j.bookings : [];
        const pset = new Set(phones.map(digitsOf));
        const f = cityNorm(from), t = cityNorm(to);
        return all.some(b => !CANCELLED_BOOKING.has(String(b.status)) && pset.has(digitsOf(b.phone)) && cityNorm(b.from) === f && cityNorm(b.to) === t);
    } catch (e) { return true; } // консервативно
}

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
                name: cap(String(p.name || '').trim(), 80), surname: cap(String(p.surname || '').trim(), 80),
                phone: normalizePhone(cap(String(p.phone || '').trim(), 32)),
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

        // 5) Якщо просять автобронь - СПОЧАТКУ звіряємо рейс зі свіжою видачею contrabus:
        //    це дає і дозвіл на бронь, і свіжий data_bundle (клієнтський живе ~6 годин
        //    і перестає збігатися після перевипуску кешу пошуку).
        // З твариною автобронь неможлива (ціна за тварину залежить від перевізника) - лише менеджер
        const wantBook = !!(req.body.book && BOOKING_ENABLED) && !req.body.pet;
        let verdict = null;
        if (wantBook) verdict = await verifyBookable(req.body, list.length);

        // 6) Перевірка телефонів на чорний список / дублі (ДО створення - щоб зберегти позначку).
        //    Заявку НЕ блокуємо: вона приходить, але з позначкою. Для автоброні беремо свіжий бандл.
        let check_warning = '';
        const checkBundle = (verdict && verdict.ok) ? verdict.route.data_bundle : req.body.data_bundle;
        if (checkBundle) {
            try {
                const token = await getToken();
                const r = await fetch(`${API_BASE_URL}/bookings/booking_allow_check`, {
                    method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data_bundle: checkBundle, phones: list.map(p => p.phone) })
                });
                const j = await r.json();
                if (j && j.message && !/no possible|not found|немає/i.test(j.message)) {
                    check_warning = j.message;
                    console.log(`[Order] ⚠️ allow_check: ${j.message}`);
                }
            } catch (e) { /* перевірка не критична */ }
        }

        // 7) Автобронювання (Фаза 2а). Будь-яка відмова - НЕ помилка: заявка просто
        //    зберігається звичайною, менеджер бачить причину в check_warning,
        //    а клієнт отримує стандартне "менеджер зв'яжеться" (причину не розкриваємо).
        let booked = false, tickets = [];
        if (wantBook) {
            // Кілька пасажирів з одним номером (мама+дитина) - законно; contrabus може
            // вважати дублем, тож бронюємо з skip_checks, щоб і він не відбив.
            const repeatedPhone = new Set(list.map(p => digitsOf(p.phone))).size < list.length;
            const doBook = async (skip) => {
                const b = await createBooking(verdict.route.data_bundle, list, skip).catch(e => ({ ok: false, reason: cap(e.message, 200) }));
                if (b.ok) { booked = true; tickets = b.tickets; check_warning = ''; }
                else { check_warning = `Автобронь не вдалася: ${b.reason}. Обробіть вручну.`; console.log(`[Booking] Збій автоброні: ${b.reason}`); }
            };
            if (!verdict.ok) {
                check_warning = (check_warning ? check_warning + ' · ' : '') + `Автобронь недоступна: ${verdict.reason}. Обробіть вручну.`;
                console.log(`[Booking] Відмова у автоброні: ${verdict.reason}`);
            } else if (check_warning && !DUP_RE.test(check_warning)) {
                // Чорний список / незнайоме попередження - лише менеджер
                check_warning += ' · Автобронь пропущено через це попередження';
                console.log('[Booking] Попередження не схоже на дубль - менеджеру');
            } else if (check_warning && DUP_RE.test(check_warning)) {
                // Дубль: дозволяємо лише якщо НЕ той самий маршрут уже заброньовано
                if (await hasSameRouteBooking(list.map(p => p.phone), req.body.route_from, req.body.route_to)) {
                    check_warning = 'Дубль того самого напрямку - можливо, повторне бронювання. Обробіть вручну.';
                    console.log('[Booking] Дубль того самого маршруту - менеджеру');
                } else {
                    console.log('[Booking] Дубль іншого маршруту/зворотний - бронюємо (skip_checks)');
                    await doBook(true);
                }
            } else {
                // Без попереджень: якщо в заявці однаковий номер у кількох - skip_checks
                await doBook(repeatedPhone);
            }
        }

        // Розбіжність ціни: фактична у виписаному квитку vs показана клієнту - сигнал менеджеру.
        // (Буває, що у видачі contrabus результат показує одну ціну/перевізника, а його data_bundle
        //  виписує квиток іншого рейсу - клієнт не має дізнатися про доплату аж при посадці.)
        if (booked && tickets.length) {
            const real = Math.max(0, ...tickets.map(t => (typeof t.price === 'number' ? t.price : 0)));
            const shown = parseFloat(String(req.body.route_price || '').replace(/[^\d.,]/g, '').replace(',', '.')) || 0;
            if (real > 0 && shown > 0 && Math.abs(real - shown) >= 1) {
                const note = `Ціна у квитку ${real} ≠ показаної клієнту ${shown}. Звʼязатися з клієнтом щодо різниці!`;
                check_warning = check_warning ? check_warning + ' · ' + note : note;
                console.log(`[Order] ⚠️ price mismatch: показано ${shown}, у квитку ${real}`);
            }
        }

        const order = db.createOrder({
            ...req.body,
            comment: cap(req.body.comment, 1000),
            route_from: cap(req.body.route_from, 200), route_to: cap(req.body.route_to, 200),
            route_from_station: cap(req.body.route_from_station, 200), route_to_station: cap(req.body.route_to_station, 200),
            route_date: cap(req.body.route_date, 40), route_time: cap(req.body.route_time, 40),
            route_price: cap(req.body.route_price, 40), route_carrier: cap(req.body.route_carrier, 120),
            passengers: list, client_name, client_phone, check_warning, booked, tickets,
            pet: !!req.body.pet
        });
        console.log(`[Order] Нова заявка #${order.id} — ${client_name}, ${client_phone}, пасажирів: ${list.length}${booked ? ' · ЗАБРОНЬОВАНО' : ''}`);

        notifyTelegram(order); // не чекаємо — відправляється у фоні
        res.status(201).json({ ok: true, id: order.id, booked, tickets: booked ? tickets : undefined });
    } catch (err) {
        serverError(res, err, 'Order');
    }
});

// POST /api/visit — лічильник відвідувань (публічний, без даних користувача)
app.post('/api/visit', (req, res) => {
    if (!skipStats(req)) { try { db.logVisit(); } catch (e) {} }
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

// POST /api/analytics/reset — обнулити пошуки/візити (заявки не чіпаємо). Лише для менеджера.
app.post('/api/analytics/reset', requireAdmin, (req, res) => {
    try {
        const r = db.resetAnalytics();
        console.log(`[Analytics] Скинуто: пошуків ${r.searches}, візитів ${r.visits}`);
        res.json({ ok: true, ...r });
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

const server = app.listen(PORT, () => {
    console.log(`✅ GoodDayBus запущено (порт ${PORT})`);
    console.log(`   Сайт:   ${PUBLIC_BASE_URL}/`);
    console.log(`   Панель: ${PUBLIC_BASE_URL}/admin.html`);
    // Локальний запуск (без PUBLIC_BASE_URL у .env) - підказуємо адресу й для цього ПК
    if (!process.env.PUBLIC_BASE_URL) console.log(`   Цей ПК: http://localhost:${PORT}/ (адреса вище - для телефону в тій же Wi-Fi)`);
    if (!API_LOGIN || !API_PASSWORD) console.log('   ⚠️  Не задано API_LOGIN/API_PASSWORD у .env — пошук рейсів не працюватиме!');
    if (!TELEGRAM_BOT_TOKEN) console.log('   ℹ️  Telegram вимкнено (не задано TELEGRAM_BOT_TOKEN у .env)');
    if (!process.env.ADMIN_KEY || ADMIN_KEY === 'change-me' || ADMIN_KEY.length < 12) {
        console.log('   ⚠️  ADMIN_KEY відсутній або заслабкий — задай довгий випадковий ключ (≥16 символів)!');
    }
    console.log(BOOKING_ENABLED
        ? `   🎫 Автобронювання УВІМКНЕНО: рейси без передоплати, до ${BOOKING_MAX_PAX} пас.${BOOKING_DRY_RUN ? ' · ⚠️ DRY RUN (брони не створюються)' : ''}`
        : '   ℹ️  Автобронювання вимкнено (BOOKING_ENABLED=1 щоб увімкнути)');

    // Резервна копія бази: одразу при старті та далі раз на добу (+ копія в Telegram, якщо налаштовано)
    sendBackupToTelegram(db.backupDb());
    setInterval(() => sendBackupToTelegram(db.backupDb()), 24 * 60 * 60 * 1000);

    // Слухаємо натискання Telegram-кнопок
    initTelegram();
});

// Граціозне завершення: Railway шле SIGTERM старому контейнеру при кожному деплої.
// Виходимо чисто (код 0), щоб npm не сипав у логи червоне "command failed signal SIGTERM".
for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
        console.log(`⏻ Отримано ${sig} - завершуємо роботу`);
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 5000).unref(); // не чекаємо вічно на відкриті з'єднання
    });
}
