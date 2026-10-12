// Розвідка мережі маршрутів перевізника для SEO-сторінок.
// Запуск: node --env-file=.env tools/discover-routes.js [--rpm 120] [--dates 1..3] [--domestic] [--limit N] [--summary]
//
// Перебирає пари "ключові міста України x ключові міста Європи" в обидва боки,
// для кожної пари шукає рейси на 1-3 дати (до першого знайденого) і зберігає зведення:
// кількість рейсів, прямі, мін. ціна і час у дорозі, перевізники, вокзали, пересадки.
// Сирі результати дописуються в data/discovery/raw.jsonl - скрипт можна перервати
// й перезапустити, вже перевірені пари пропускаються. Підсумок - data/network.json.
//
// Окремий процес зі своїм обмеженням частоти: прод-сервер і його ліміт CB_MAX_PER_MIN
// не зачіпаються, але акаунт агента спільний - тому темп за замовчуванням помірний.
const fs = require('fs');
const path = require('path');

const API = 'https://api.contrabus.ua/v1';
const OUT_DIR = path.join(__dirname, '..', 'data', 'discovery');
const RAW = path.join(OUT_DIR, 'raw.jsonl');
const NETWORK = path.join(__dirname, '..', 'data', 'network.json');

const arg = (name, def) => {
    const i = process.argv.indexOf(`--${name}`);
    if (i < 0) return def;
    const v = process.argv[i + 1];
    return v === undefined || v.startsWith('--') ? true : v;
};
const RPM = +arg('rpm', 120);
const DOMESTIC = !!arg('domestic', false);
const LIMIT = +arg('limit', 0);
const SUMMARY_ONLY = !!arg('summary', false);
const N_DATES = Math.min(3, +arg('dates', 3)); // --dates 1: швидкий перший прохід, решта дат - другим запуском

// Назви - точно як у довіднику contrabus (get_cities)
const UA = ['Київ', 'Львів', 'Одеса', 'Харків', 'Дніпро', 'Запоріжжя', 'Вінниця', 'Житомир', 'Рівне', 'Луцьк',
    'Тернопіль', 'Івано-Франківськ', 'Ужгород', 'Мукачево', 'Чернівці', 'Хмельницький', "Кам'янець-Подільський",
    'Полтава', 'Черкаси', 'Кропивницький', 'Миколаїв', 'Херсон', 'Суми', 'Чернігів', 'Біла Церква', 'Умань',
    'Кривий Ріг', 'Кременчук', 'Ковель', 'Нововолинськ', 'Володимир', 'Дубно', 'Стрий', 'Дрогобич', 'Самбір',
    'Коломия', 'Калуш', 'Шептицький', 'Бердичів', 'Шепетівка', 'Звягель', 'Сарни', 'Бориспіль', 'Ізмаїл',
    'Павлоград', "Кам'янське", 'Нікополь', 'Олександрія', 'Первомайськ'];
const EU = ['Варшава', 'Краків', 'Вроцлав', 'Гданськ', 'Познань', 'Лодзь', 'Катовіце', 'Люблін', 'Жешув', 'Перемишль',
    'Щецин', 'Бидгощ', 'Торунь', 'Ольштин', 'Білосток', 'Кельце', 'Ополе', 'Зелена Гура', 'Ченстохова', 'Холм',
    'Замосць', 'Легніца', 'Гдиня', 'Сопот', 'Радом', 'Плоцьк', 'Бельсько-Бяла', 'Глівіце', 'Тарнув',
    'Берлін', 'Мюнхен', 'Гамбург', 'Франкфурт-на-Майні', 'Кельн', 'Дрезден', 'Лейпциг', 'Нюрнберг', 'Штутгарт',
    'Дюссельдорф', 'Ганновер', 'Дортмунд', 'Бремен', 'Ессен', 'Аугсбург', 'Регенсбург', 'Бонн', 'Карлсруе', 'Фрайбург',
    'Прага', 'Брно', 'Острава', 'Оломоуц', 'Пардубіце', 'Градець Кралове', 'Карлові Вари', 'Ліберець',
    'Відень', 'Грац', 'Лінц', 'Зальцбург', 'Інсбрук', 'Братислава', 'Кошице', 'Пряшів', 'Будапешт', 'Дебрецен',
    'Бухарест', 'Кишинів', 'Рим', 'Мілан', 'Неаполь', 'Болонья', 'Флоренція', 'Венеція', 'Верона', 'Генуя', 'Барі',
    'Пескара', 'Ріміні', 'Анкона', 'Падуя', 'Брешія', 'Бергамо', 'Парма', 'Модена', 'Салерно', 'Палермо',
    'Париж', 'Ліон', 'Ніцца', 'Марсель', 'Страсбург', 'Брюссель', 'Антверпен', 'Амстердам', 'Роттердам', 'Гаага',
    'Ейндговен', 'Утрехт', 'Мадрид', 'Барселона', 'Валенсія', 'Аліканте', 'Малага', 'Севілья', 'Лісабон', 'Порту',
    'Копенгаген', 'Орхус', 'Осло', 'Стокгольм', 'Гетеборг', 'Мальме', 'Гельсінкі', 'Рига', 'Вільнюс', 'Каунас',
    'Таллінн', 'Софія', 'Варна', 'Бургас', 'Афіни', 'Салоніки', 'Цюрих', 'Женева', 'Берн', 'Базель', 'Люксембург',
    'Лондон', 'Стамбул', 'Белград', 'Загреб', 'Любляна', 'Тирана', "Скоп'є", 'Констанца', 'Ясси', 'Сучава',
    'Клуж-Напока', 'Тімішоара', 'Батумі', 'Тбілісі'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt = dt => String(dt.getDate()).padStart(2, '0') + '.' + String(dt.getMonth() + 1).padStart(2, '0') + '.' + dt.getFullYear();
const plusDays = n => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return fmt(d); };
// Дати проби: ~10 днів наперед (розклад уже заведений), далі +2 і +4 для рейсів не щодня
const PROBE_DATES = [plusDays(10), plusDays(12), plusDays(14)];

let token = null;
async function login() {
    const r = await fetch(`${API}/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: process.env.API_LOGIN, password: process.env.API_PASSWORD })
    });
    if (!r.ok) throw new Error(`login ${r.status}: ${await r.text()}`);
    token = (await r.json()).token;
}

// Рівномірний темп: не частіше ніж RPM запитів на хвилину
let nextSlot = 0;
async function paced() {
    const gap = 60000 / RPM;
    const now = Date.now();
    const at = Math.max(now, nextSlot);
    nextSlot = at + gap;
    if (at > now) await sleep(at - now);
}

async function search(fromId, toId, date, attempt = 0) {
    await paced();
    let r;
    try {
        r = await fetch(`${API}/info/search`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from_id: fromId, to_id: toId, date })
        });
    } catch (e) {
        if (attempt >= 4) throw e;
        await sleep(5000 * (attempt + 1));
        return search(fromId, toId, date, attempt + 1);
    }
    if (r.status === 404) return [];
    if (r.status === 401 && attempt < 2) { await login(); return search(fromId, toId, date, attempt + 1); }
    if ((r.status === 429 || r.status >= 500) && attempt < 4) {
        await sleep(15000 * (attempt + 1));
        return search(fromId, toId, date, attempt + 1);
    }
    if (!r.ok) throw new Error(`search ${r.status}`);
    const d = await r.json();
    return Array.isArray(d) ? d : [];
}

// Той самий критерій, що й у фронті (app.js isDirect)
const isDirect = rt => !rt.change_info || !/пересад/i.test(rt.change_info);
const station = s => String(s || '').split(';')[0].trim(); // "Київ, Автовокзал "Центральний", метро ..." без адреси
const uniqTop = (arr, n) => {
    const m = new Map();
    for (const x of arr) if (x) m.set(x, (m.get(x) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]);
};
const minOf = arr => arr.length ? Math.min(...arr) : null;

function summarize(rides) {
    const direct = rides.filter(isDirect);
    const prices = rides.map(r => +r.price).filter(p => p > 0);
    const transfers = rides.filter(r => !isDirect(r))
        .map(r => (String(r.change_info).match(/м\.\s*([А-ЯІЇЄҐ][^,(;.]+)/) || [])[1])
        .map(s => s && s.replace(/\s+(або|та)(\s.*)?$/, '').trim());
    return {
        n: rides.length,
        nDirect: direct.length,
        currency: rides[0] && rides[0].currency,
        minPrice: minOf(prices),
        minPriceDirect: minOf(direct.map(r => +r.price).filter(p => p > 0)),
        minTravel: minOf(rides.map(r => +r.travel_time).filter(Boolean)),
        minTravelDirect: minOf(direct.map(r => +r.travel_time).filter(Boolean)),
        carriers: uniqTop(rides.map(r => r.carrier), 8),
        nCarriers: new Set(rides.map(r => r.carrier)).size,
        departures: [...new Set((direct.length ? direct : rides).map(r => r.departure_time))].sort(),
        fromStations: uniqTop(rides.map(r => station(r.departure_station)), 5),
        toStations: uniqTop(rides.map(r => station(r.arrival_station)), 5),
        transferCities: uniqTop(transfers, 5),
        prepayShare: rides.length ? +(rides.filter(r => r.label_type === 'prepayment').length / rides.length).toFixed(2) : 0
    };
}

function loadRaw() {
    if (!fs.existsSync(RAW)) return [];
    return fs.readFileSync(RAW, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function writeNetwork(raw, cityById) {
    const byPair = new Map();
    for (const x of raw) if (x.s && x.s.n > 0) byPair.set(`${x.from}|${x.to}`, x); // остання проба перемагає
    const pairs = [...byPair.values()].map(x => ({
        fromId: x.from, toId: x.to,
        fromName: cityById.get(x.from).name, toName: cityById.get(x.to).name,
        fromCountry: cityById.get(x.from).country_code, toCountry: cityById.get(x.to).country_code,
        probedDate: x.date, ...x.s
    })).sort((a, b) => b.nDirect - a.nDirect || b.n - a.n);
    fs.mkdirSync(path.dirname(NETWORK), { recursive: true });
    fs.writeFileSync(NETWORK, JSON.stringify({ generated: new Date().toISOString(), probeDates: PROBE_DATES, pairs }, null, 1));
    return pairs;
}

(async () => {
    if (!process.env.API_LOGIN) throw new Error('немає API_LOGIN - запускай з --env-file=.env');
    await login();
    const cr = await fetch(`${API}/info/get_cities`, { headers: { Authorization: `Bearer ${token}` } });
    if (!cr.ok) throw new Error(`get_cities ${cr.status}`);
    const cities = await cr.json();
    const cityById = new Map(cities.map(c => [c.id, c]));
    const resolve = (names, wantUA) => names.map(n => {
        const c = cities.find(x => x.name === n && (x.country_code === 'UA') === wantUA);
        if (!c) console.warn(`[!] місто не знайдено в довіднику: ${n}`);
        return c;
    }).filter(Boolean);
    const ua = resolve(UA, true), eu = resolve(EU, false);

    let raw = loadRaw();
    if (SUMMARY_ONLY) {
        const pairs = writeNetwork(raw, cityById);
        console.log(`Пар з рейсами: ${pairs.length} (прямі є у ${pairs.filter(p => p.nDirect).length})`);
        return;
    }

    const pairs = [];
    for (const a of ua) for (const b of eu) { pairs.push([a.id, b.id]); pairs.push([b.id, a.id]); }
    if (DOMESTIC) for (const a of ua) for (const b of ua) if (a.id !== b.id) pairs.push([a.id, b.id]);

    // Пара закрита, якщо вже має рейси або перевірена на всі дати проби
    const probed = new Map();
    for (const x of raw) {
        const k = `${x.from}|${x.to}`;
        const st = probed.get(k) || { hit: false, dates: new Set() };
        st.dates.add(x.date); if (x.s && x.s.n > 0) st.hit = true;
        probed.set(k, st);
    }
    const todo = pairs.filter(([f, t]) => {
        const st = probed.get(`${f}|${t}`);
        return !st || (!st.hit && PROBE_DATES.slice(0, N_DATES).some(d => !st.dates.has(d)));
    });
    const queue = LIMIT ? todo.slice(0, LIMIT) : todo;
    console.log(`Міст: UA ${ua.length}, Європа ${eu.length}. Пар усього ${pairs.length}, до перевірки ${queue.length}. Темп ${RPM}/хв, дати ${PROBE_DATES.join(', ')}`);

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const out = fs.createWriteStream(RAW, { flags: 'a' });
    let done = 0, hits = 0;
    const t0 = Date.now();

    // 2 паралельні воркери; темп однаково тримає paced()
    let idx = 0;
    async function worker() {
        while (idx < queue.length) {
            const [f, t] = queue[idx++];
            const st = probed.get(`${f}|${t}`);
            for (const date of PROBE_DATES.slice(0, N_DATES)) {
                if (st && st.dates.has(date)) continue;
                let rides;
                try { rides = await search(f, t, date); }
                catch (e) { console.warn(`[!] ${f}->${t} ${date}: ${e.message}`); break; }
                const s = rides.length ? summarize(rides) : null;
                out.write(JSON.stringify({ from: f, to: t, date, s }) + '\n');
                if (s) { hits++; break; }
            }
            done++;
            if (done % 50 === 0) {
                const rate = done / ((Date.now() - t0) / 60000);
                console.log(`${done}/${queue.length} пар, з рейсами ${hits}, ~${Math.round((queue.length - done) / rate)} хв лишилось`);
            }
        }
    }
    await Promise.all([worker(), worker()]);
    await new Promise(r => out.end(r));

    const net = writeNetwork(loadRaw(), cityById);
    console.log(`Готово. Пар з рейсами: ${net.length} (прямі є у ${net.filter(p => p.nDirect).length}). Записано ${path.relative(process.cwd(), NETWORK)}`);
})().catch(e => { console.error('[discover]', e.message); process.exit(1); });
