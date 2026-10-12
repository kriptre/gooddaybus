// Відбір маршрутів, для яких генеруються SEO-сторінки (хвиля публікації).
// Запуск: node tools/select-routes.js [--pages 150]
//
// Бере data/network.json (результат tools/discover-routes.js, лише локально - файл великий) і пише
// data/route-pages.json - список напрямків разом із фактами про рейси, з якого build-routes.js
// генерує сторінки. Цей файл комітиться; щотижня його оновлює discover-routes.js --refresh. Список - окремий файл,
// щоб хвилі розширювались свідомо (після перевірки індексації в Search Console),
// а не автоматично з кожним новим прогоном розвідки.
//
// Пріоритет пари = вага міста в Україні x вага міста в Європі (порядок у списках нижче -
// наша оцінка попиту: великі міста й основні напрямки діаспори вище). Пара береться
// в обидва боки, якщо в кожен бік є рейси, - щоб у кожної сторінки був зворотний маршрут.
// 12 маршрутів із routes.json потрапляють завжди: їхні URL уже в індексі.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? def : process.argv[i + 1]; };
const PAGES = +arg('pages', 150);
const MIN_RIDES = 3; // менше рейсів на день - сторінка буде порожньою для більшості дат

const UA_ORDER = ['Київ', 'Львів', 'Одеса', 'Харків', 'Дніпро', 'Вінниця', 'Рівне', 'Луцьк', 'Тернопіль',
    'Івано-Франківськ', 'Запоріжжя', 'Житомир', 'Хмельницький', 'Чернівці', 'Ужгород', 'Мукачево', 'Полтава',
    'Черкаси', 'Миколаїв', 'Біла Церква', 'Кривий Ріг', 'Ковель', 'Дубно', 'Стрий', 'Дрогобич', 'Коломия',
    "Кам'янець-Подільський", 'Кропивницький', 'Суми', 'Чернігів', 'Умань', 'Кременчук', 'Херсон'];
const EU_ORDER = ['Варшава', 'Краків', 'Прага', 'Берлін', 'Вроцлав', 'Мюнхен', 'Гданськ', 'Познань', 'Люблін',
    'Відень', 'Лодзь', 'Катовіце', 'Жешув', 'Перемишль', 'Будапешт', 'Брно', 'Рим', 'Мілан', 'Гамбург',
    'Франкфурт-на-Майні', 'Дрезден', 'Лейпциг', 'Кишинів', 'Братислава', 'Неаполь', 'Амстердам', 'Брюссель',
    'Париж', 'Нюрнберг', 'Штутгарт', 'Кельн', 'Дюссельдорф', 'Острава', 'Щецин', 'Білосток', 'Ольштин',
    'Бидгощ', 'Торунь', 'Ганновер', 'Бремен', 'Дортмунд', 'Болонья', 'Венеція', 'Верона', 'Флоренція',
    'Барселона', 'Мадрид', 'Лісабон', 'Копенгаген', 'Вільнюс', 'Рига', 'Таллінн', 'Бухарест', 'Софія'];

const weight = (list, name) => { const i = list.indexOf(name); return i < 0 ? 0 : 1 / (1 + i * 0.25); };

const net = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'network.json'), 'utf8'));
const manual = JSON.parse(fs.readFileSync(path.join(ROOT, 'routes.json'), 'utf8'));
const byKey = new Map(net.pairs.map(p => [`${p.fromId}|${p.toId}`, p]));
const ok = p => p && p.n >= MIN_RIDES;

const picked = new Map(); // key -> {fromId,toId}
// Запис хвилі = дані розвідки пари (або лише id, якщо розвідка пару не знайшла) + час оновлення
const add = p => { const d = byKey.get(`${p.fromId}|${p.toId}`); picked.set(`${p.fromId}|${p.toId}`, d ? { ...d, updated: net.generated } : { fromId: p.fromId, toId: p.toId }); };

for (const r of manual) add({ fromId: r.fromId, toId: r.toId });

// Невпорядковані пари UA<->Європа з рейсами в обидва боки, за спаданням пріоритету
const seen = new Set(), cand = [];
for (const p of net.pairs) {
    const ua = p.fromCountry === 'UA' ? p.fromName : p.toName;
    const eu = p.fromCountry === 'UA' ? p.toName : p.fromName;
    const uaId = p.fromCountry === 'UA' ? p.fromId : p.toId, euId = p.fromCountry === 'UA' ? p.toId : p.fromId;
    const k = `${uaId}|${euId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const there = byKey.get(`${uaId}|${euId}`), back = byKey.get(`${euId}|${uaId}`);
    if (!ok(there) || !ok(back)) continue;
    const score = weight(UA_ORDER, ua) * weight(EU_ORDER, eu);
    if (score > 0) cand.push({ score, there, back });
}
cand.sort((a, b) => b.score - a.score || (b.there.n + b.back.n) - (a.there.n + a.back.n));
for (const c of cand) {
    if (picked.size >= PAGES) break;
    add(c.there); add(c.back);
}

const list = [...picked.values()];
fs.writeFileSync(path.join(ROOT, 'data', 'route-pages.json'), JSON.stringify(list, null, 1) + '\n');
const missing = list.filter(x => !byKey.has(`${x.fromId}|${x.toId}`)).length;
console.log(`Відібрано сторінок: ${list.length} (кандидатів-пар: ${cand.length}; без даних розвідки: ${missing})`);
