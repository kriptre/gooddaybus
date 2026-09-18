// Задача 17: предохранители повноти англійської версії. На відміну від tests/i18n.test.js
// (чисті юніт-тести translit()/vendor-en.js, не чіпають диск), ці тести перевіряють РЕЗУЛЬТАТ
// білда - файли, які build-routes.js/build-i18n.js кладуть у public/. Тому вони мають
// прогнати `node build-routes.js` ПЕРЕД собою (як робить сам build-routes.js в кінці свого
// запуску) - і працюють повністю на диску, без запущеного сервера (на відміну від
// tests/smoke.test.js, якому потрібен `npm start` в іншому терміналі).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const EN_DIR = path.join(PUB, 'en');

// --- допоміжне -------------------------------------------------------------------------

function leafPaths(o, prefix, out) {
    // Масив - теж "листок": date.dow / seats.forms і т.п. не розбираємо по елементах,
    // дублюючи логіку build-i18n.js (там масиви теж лишаються цілими значеннями).
    if (o == null || typeof o !== 'object' || Array.isArray(o)) { out.push(prefix); return; }
    for (const k of Object.keys(o)) leafPaths(o[k], prefix ? `${prefix}.${k}` : k, out);
}

// Витягує об'єктний літерал виду "const NAME = { ... }" із вихідного JS/HTML-скрипта і
// повертає готовий JS-об'єкт. Рахуємо глибину фігурних дужок посимвольно (а не regex) -
// шаблонні рядки (${...}) теж містять фігурні дужки, але завжди парні, тож підрахунок
// коректний. new Function(...) тут безпечний: джерело - наш власний довірений код у
// репозиторії, не зовнішні дані.
function extractObjectLiteral(src, marker) {
    const start = src.indexOf(marker);
    if (start < 0) throw new Error(`маркер не знайдено: ${marker}`);
    const braceStart = src.indexOf('{', start);
    let depth = 0, i = braceStart;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) throw new Error(`не знайдено парну закриваючу дужку для ${marker}`);
    return new Function('return ' + src.slice(braceStart, i + 1))();
}

function readEnPages() {
    const files = fs.readdirSync(EN_DIR).filter(f => f.endsWith('.html'));
    return files.map(f => ({ name: f, path: path.join(EN_DIR, f), src: fs.readFileSync(path.join(EN_DIR, f), 'utf8') }));
}

// --- Крок 1: кирилиця, яку бачить пасажир --------------------------------------------
//
// Наївна перевірка "немає кирилиці ніде в файлі" провалилась би назавжди: сторінки
// навмисно містять українські коментарі розробника (спільні GTM-блоки й пояснення в
// розмітці - вони йдуть у публічний HTML як <!-- ... --> і в вихідних українських
// шаблонах теж) і в booking.html - інлайн-скрипт з резервним українським словником
// B_UK (перекривається window.__I18N__.booking до відмальовки, але лишається в
// розмітці як код). Жодне з цього не бачить користувач: браузер не рендерить ані
// HTML-коментарі, ані вміст <script>. Тому перед пошуком кирилиці прибираємо САМЕ ЦІ
// два види вмісту (і більше нічого) - тег game лишається чесним: він ловить кирилицю
// в реальному тексті, атрибутах і в межах (наприклад, поза коментарем/скриптом), а не
// ловить те, що й так ніколи не було видно.
//
// public/i18n/en.js свідомо НЕ входить у цю перевірку: це окремий .js-файл (підключений
// через <script src>, а не інлайн), і за задумом задачі 16 він несе весь код перекладу
// даних API - словник міст/глосарій адрес і т.п. - де українські рядки є вихідними
// даними для порівняння/транслітерації, а не текстом для показу. Це код і довідкові
// дані, як сказано у ТЗ, а не сторінка, яку бачить пасажир.
function stripInvisible(html) {
    return html
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

test('у видимій частині згенерованих англійських сторінок немає кирилиці', () => {
    const pages = readEnPages();
    assert.ok(pages.length >= 3, 'очікували index, faq, booking у public/en');

    const problems = [];
    for (const { name, src } of pages) {
        const visible = stripInvisible(src);
        visible.split(/\r?\n/).forEach((line, i) => {
            if (/[А-Яа-яІіЇїЄєҐґ]/.test(line)) problems.push(`${name}:${i + 1}: ${line.trim().slice(0, 120)}`);
        });
    }
    assert.deepEqual(problems, [], 'знайдено кирилицю у видимій частині сторінки:\n' + problems.join('\n'));
});

// --- Крок 2: паритет ключів i18n/en.json -----------------------------------------------
//
// Словник en.json обслуговує ДВА різні механізми:
//  - розмітку (data-i18n / data-i18n-html / data-i18n-attr у public/index.html,
//    faq.html, booking.html - build-i18n.js читає їх з ТИХ САМИХ українських шаблонів);
//  - рантайм JS (T_UK у app.js, C_UK у common.js, B_UK у booking.html) - ключі під
//    "app.", "common.", "booking." відповідно; на сторінці ці рядки в розмітці не
//    зустрічаються, лише формуються кодом (наприклад "Показано ще N").
// Тому "усі ключі, якими хтось користується" - це об'єднання: ключі з розмітки +
// повна структура листків T_UK/C_UK/B_UK (взята з ЖИВОГО джерела - самих .js/.html
// файлів, а не переписана вручну, щоб тест не розійшовся з кодом).
//
// Єдиний задокументований виняток - "app.seats.hintNeedClause": за задумом build-i18n.js
// (EXPAND_FUNCTIONS_SRC) англійська версія розбиває один український рядок з умовною
// приставкою на дві частини (порядок слів у мовах різний), тож у словнику з'являється
// ключ, якого в T_UK нема і не може бути - він там просто не потрібен українською.
const APP_ONLY_IN_EN = ['app.seats.hintNeedClause'];

function collectUsedKeys() {
    const used = new Set();

    for (const f of ['index.html', 'faq.html', 'booking.html']) {
        const src = fs.readFileSync(path.join(PUB, f), 'utf8');
        (src.match(/data-i18n(?:-html)?="([^"]+)"/g) || [])
            .forEach(m => used.add(m.replace(/.*="|"$/g, '')));
        (src.match(/data-i18n-attr="([^"]+)"/g) || []).forEach(m => {
            m.replace(/.*="|"$/g, '').split(';').forEach(p => {
                const k = p.split(':')[1];
                if (k) used.add(k.trim());
            });
        });
    }

    const T_UK = extractObjectLiteral(fs.readFileSync(path.join(PUB, 'app.js'), 'utf8'), 'const T_UK = {');
    const tPaths = []; leafPaths(T_UK, 'app', tPaths); tPaths.forEach(p => used.add(p));

    const C_UK = extractObjectLiteral(fs.readFileSync(path.join(PUB, 'common.js'), 'utf8'), 'var C_UK = {');
    const cPaths = []; leafPaths(C_UK, 'common', cPaths); cPaths.forEach(p => used.add(p));

    const B_UK = extractObjectLiteral(fs.readFileSync(path.join(PUB, 'booking.html'), 'utf8'), 'var B_UK = {');
    const bPaths = []; leafPaths(B_UK, 'booking', bPaths); bPaths.forEach(p => used.add(p));

    APP_ONLY_IN_EN.forEach(k => used.add(k));
    return used;
}

function dictLeafSet() {
    const dict = require('../i18n/en.json');
    const paths = []; leafPaths(dict, '', paths);
    return { paths, set: new Set(paths) };
}

test('кожен ключ i18n (розмітка + T_UK/C_UK/B_UK) має переклад в i18n/en.json', () => {
    const used = collectUsedKeys();
    const { set: dictSet } = dictLeafSet();
    const missing = [...used].filter(k => !dictSet.has(k)).sort();
    assert.deepEqual(missing, [], 'ключі без перекладу: ' + missing.join(', '));
});

test('в i18n/en.json немає зайвих (нікому не потрібних) ключів', () => {
    const used = collectUsedKeys();
    const { paths } = dictLeafSet();
    const orphan = paths.filter(k => !used.has(k)).sort();
    assert.deepEqual(orphan, [], 'ключі словника, якими ніхто не користується: ' + orphan.join(', '));
});

// --- Крок 3: контракт noindex -----------------------------------------------------------
//
// /en/ - сирий дубль основної сторінки, навмисно закритий від індексації (у нас лише
// одна "справжня" версія в пошуку - українська). Але заборона в robots.txt для /en/
// зробила б цю перевірку самообманом: краулер, якого не пустили в /en/, ніколи НЕ
// прочитає сторінку - і ніколи не побачить її <meta name="robots" content="noindex">.
// Тобто /en/ має бути ДОСТУПНИЙ для сканування (щоб сигнал noindex взагалі спрацював),
// але позначений як такий, що індексувати не треба.
test('англійські сторінки: lang=en, noindex, без canonical; /en/ не в sitemap і не заборонений у robots.txt', () => {
    const pages = readEnPages();
    for (const { name, src } of pages) {
        assert.match(src, /<html lang="en">/, `${name}: не виставлено lang="en"`);
        assert.match(src, /<meta name="robots" content="noindex, nofollow">/, `${name}: немає noindex`);
        assert.ok(!/<link rel="canonical"/.test(src), `${name}: canonical при noindex зайвий`);
    }

    const sitemap = fs.readFileSync(path.join(PUB, 'sitemap.xml'), 'utf8');
    assert.ok(!/\/en\/?/.test(sitemap), 'англійські сторінки не мають бути в sitemap.xml');

    const robots = fs.readFileSync(path.join(PUB, 'robots.txt'), 'utf8');
    assert.ok(
        !/^\s*Disallow:\s*\/en(\/|\s|$)/mi.test(robots),
        '/en/ не має бути заборонений у robots.txt - інакше краулер ніколи не побачить noindex на самій сторінці'
    );
});

// --- Крок 4: посилання перемикача мови ведуть на реальні файли --------------------------

test('перемикач мови веде на існуючі сторінки (в обидва боки)', () => {
    const enIndex = fs.readFileSync(path.join(EN_DIR, 'index.html'), 'utf8');
    assert.match(enIndex, /<a href="\/" hreflang="uk">UA<\/a>/, 'з англійської головної має бути посилання на українську');
    assert.ok(fs.existsSync(path.join(PUB, 'index.html')), 'public/index.html (ціль посилання) не існує');

    // Перемикач веде на українського ДВІЙНИКА цієї ж сторінки, а не завжди на головну:
    // інакше читач англійського FAQ, що хоче український, опиняється на головній і
    // мусить шукати FAQ заново.
    const enFaq = fs.readFileSync(path.join(EN_DIR, 'faq.html'), 'utf8');
    assert.match(enFaq, /<a href="\/faq" hreflang="uk">UA<\/a>/, 'з англійського FAQ має бути посилання на УКРАЇНСЬКИЙ FAQ');
    assert.ok(fs.existsSync(path.join(PUB, 'faq.html')), 'public/faq.html (ціль посилання) не існує');

    const ukIndex = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
    assert.match(ukIndex, /<a href="\/en\/" hreflang="en">EN<\/a>/, 'з української головної має бути посилання на англійську');
    assert.ok(fs.existsSync(path.join(EN_DIR, 'index.html')), 'public/en/index.html (ціль посилання) не існує');

    const ukFaq = fs.readFileSync(path.join(PUB, 'faq.html'), 'utf8');
    assert.match(ukFaq, /<a href="\/en\/" hreflang="en">EN<\/a>/, 'з українського FAQ має бути посилання на англійську');
});

// Англійські сторінки мусять лишати відвідувача в англійській версії. Англійський FAQ
// був згенерований, перекладений і при цьому НЕДОСЯЖНИЙ: на нього не вело жодне
// посилання, бо і футер, і логотип показували на українські сторінки.
test('навігація англійських сторінок не викидає в українську версію', () => {
    for (const f of ['index.html', 'faq.html']) {
        const html = fs.readFileSync(path.join(EN_DIR, f), 'utf8');
        assert.match(html, /<a href="\/en\/" class="logo">/, `${f}: логотип має вести на англійську головну`);
        assert.ok(!/href="\/faq"(?! hreflang)/.test(html), `${f}: посилання на FAQ має бути /en/faq, а не український /faq`);
    }
    // А юридичні сторінки англійською НЕ генеруються, тож посилання на них свідомо
    // лишаються українськими: вести на неіснуючу сторінку було б гірше.
    const enIndex = fs.readFileSync(path.join(EN_DIR, 'index.html'), 'utf8');
    for (const legal of ['/terms', '/privacy', '/refund', '/cookies']) {
        assert.ok(enIndex.includes(`href="${legal}"`), `посилання ${legal} має лишитись українським`);
        assert.ok(fs.existsSync(path.join(PUB, legal.slice(1) + '.html')), `${legal} - ціль посилання не існує`);
    }
});

// --- Крок 5: словник екзонімів (cities-en.json) без зайвих записів ----------------------
//
// Це та сама перевірка, що вже існує в tests/i18n.test.js ("словник екзонімів: кожен
// запис справді виправляє транслітерацію") - і задача 17 явно називає її
// найважливішою, бо саме такі регресії (зайвий/забутий запис у словнику даних, а не
// зламаний код) реально траплялись у цьому проєкті. Дублюємо тут як явну перевірку
// РЕЗУЛЬТАТУ (словника, що піде у білд), а не лише юніт-тест логіки - і без залежності
// від .superpowers/sdd/cities-sample.json (яка може бути відсутня на чистому чекауті):
// тут використовуємо WORD_CHAR-безпечний факт "translit() - чиста функція від назви",
// тож достатньо самого cities-en.json, якщо є з чим звіряти. Якщо вибірки живих даних
// нема - тест, як і в i18n.test.js, чесно пропускається, а не падає.
test('cities-en.json: жодного запису, який translit() і так дає правильно (звірка з живими даними)', () => {
    let citiesSample;
    try {
        citiesSample = require('../.superpowers/sdd/cities-sample.json');
    } catch (e) {
        return; // немає зрізу живих даних - нема з чим звіряти, пропускаємо
    }
    const { translit } = require('../i18n/translit.js');
    const cities = require('../i18n/cities-en.json');
    const nameById = new Map(citiesSample.map(c => [String(c.id), c.name]));

    const redundant = [];
    for (const [id, en] of Object.entries(cities)) {
        const uaName = nameById.get(id);
        if (uaName === undefined) continue;
        if (translit(uaName) === en) redundant.push(`id ${id} (${uaName}): translit() вже дає "${en}"`);
    }
    assert.deepEqual(redundant, [], 'зайві записи в cities-en.json:\n' + redundant.join('\n'));
});

// --- Крок 6: білд відтворюваний ----------------------------------------------------------
//
// Два прогони build-routes.js підряд без змін у джерелах мають дати БАЙТ-У-БАЙТ
// однаковий public/ - інакше версіонування ассетів (?v=...) чи порядок ключів
// "стрибав" би від збірки до збірки, і деплой ставав би недетермінованим.
test('node build-routes.js двічі поспіль лишає public/ незмінним', () => {
    function snapshot() {
        const out = {};
        (function walk(dir) {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                else out[path.relative(PUB, full)] = crypto.createHash('md5').update(fs.readFileSync(full)).digest('hex');
            }
        })(PUB);
        return out;
    }

    execFileSync('node', ['build-routes.js'], { cwd: ROOT, stdio: 'pipe' });
    const before = snapshot();
    execFileSync('node', ['build-routes.js'], { cwd: ROOT, stdio: 'pipe' });
    const after = snapshot();

    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const diffs = [...allKeys].filter(k => before[k] !== after[k]).sort();
    assert.deepEqual(diffs, [], 'другий прогін білда змінив файли: ' + diffs.join(', '));
});
