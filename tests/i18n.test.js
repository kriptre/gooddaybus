// Тести транслітерації латиницею за стандартом КМУ №55 (2010) - паспортний стандарт.
// Кожен тест у коментарі каже, яке саме правило стандарту він перевіряє.
const { test } = require('node:test');
const assert = require('node:assert');
const { translit } = require('../i18n/translit.js');

test('транслітерація КМУ-2010: міста (базова таблиця + подвоєння приголосних)', () => {
    // Базові відповідники: и->y, і->i, ж->zh, г->h, х->kh; подвоєння приголосних (жж) зберігається як є
    assert.equal(translit('Київ'), 'Kyiv');
    assert.equal(translit('Львів'), 'Lviv');
    assert.equal(translit('Ужгород'), 'Uzhhorod');
    assert.equal(translit('Запоріжжя'), 'Zaporizhzhia');
    assert.equal(translit('Чернігів'), 'Chernihiv');
});

test('транслітерація: є/ї/й/ю/я на початку слова і в середині', () => {
    // Правило: на початку слова - Ye/Yi/Y/Yu/Ya, усередині - ie/i/i/iu/ia
    assert.equal(translit('Єнакієве'), 'Yenakiieve');
    assert.equal(translit('Їжакевич'), 'Yizhakevych');
    assert.equal(translit('Йосипівка'), 'Yosypivka');
    assert.equal(translit('Юрій'), 'Yurii');
    assert.equal(translit('Яготин'), 'Yahotyn');
});

test('транслітерація: зг передається як zgh, а не zh', () => {
    // Правило: буквосполучення "зг" -> "zgh" (щоб не збігалося з "ж" -> "zh")
    assert.equal(translit('Згорани'), 'Zghorany');
});

test('транслітерація зберігає пунктуацію і латиницю', () => {
    assert.equal(translit('вул. Петлюри, 32'), 'vul. Petliury, 32');
    assert.equal(translit('Kyiv Central'), 'Kyiv Central');
});

test('г -> h, ґ -> g (різні літери, різний результат)', () => {
    // Правило: українське "г" (фрикативний) -> h, "ґ" (проривний) -> g
    assert.equal(translit('гора'), 'hora');
    assert.equal(translit('ґанок'), 'ganok');
    assert.equal(translit('Ґалаґан'), 'Galagan');
});

test('м\'який знак і апостроф не передаються взагалі', () => {
    // Правило: ь і апостроф (у будь-якому написанні) не транслітеруються, випадають
    assert.equal(translit('Львів\'янин'), 'Lvivianyn'); // ' ASCII
    assert.equal(translit('Знам’янка'), 'Znamianka'); // ’ U+2019, офіційний приклад стандарту
    assert.equal(translit('Ільїч'), 'Ilich'); // ь у середині слова зникає
    assert.equal(translit('Русь'), 'Rus');
});

test('апостроф/м\'який знак не є межею слова: наступна є/ї/й/ю/я лишається "серединною"', () => {
    // Знам'янка з офіційних методрекомендацій: я після апострофа - "ia", не "Ya",
    // бо апостроф не розриває слово
    assert.equal(translit('Знам\'янка'), 'Znamianka');
    assert.equal(translit('Кам\'янець-Подільський'), 'Kamianets-Podilskyi');
});

test('подвоєння приголосних НЕ спрощується (кожна літера транслітерується окремо)', () => {
    assert.equal(translit('Ганна'), 'Hanna');
    assert.equal(translit('Одеса'), 'Odesa');
});

test('капіталізація багатолітерного відповідника: лише перша літера, решта - мала', () => {
    // Правило: Жовтень -> Zhovten, НІКОЛИ ZHovten
    assert.equal(translit('Жовтень'), 'Zhovten');
    assert.equal(translit('Харків'), 'Kharkiv');
    assert.equal(translit('Щорс'), 'Shchors');
    assert.equal(translit('Цюрупинськ'), 'Tsiurupynsk');
});

test('весь текст ВЕЛИКИМИ ЛІТЕРАМИ лишається читабельним (кожна літера капіталізується окремо)', () => {
    assert.equal(translit('ЛЬВІВ'), 'LVIV');
    assert.equal(translit('КИЇВ'), 'KYIV');
});

test('межа слова: розпізнається після крапки, коми, дужки, лапок, дефіса, цифри - не лише пробілу', () => {
    // Правило: "початок слова" має працювати не тільки після пробілу
    assert.equal(translit('(Єнакієве)'), '(Yenakiieve)'); // дужка
    assert.equal(translit('"Якір"'), '"Yakir"'); // лапка
    assert.equal(translit('7-Яготин'), '7-Yahotyn'); // цифра+дефіс
    assert.equal(translit('m.Яготин'), 'm.Yahotyn'); // крапка без пробілу
    assert.equal(translit('Іллі;Юрія'), 'Illi;Yuriia'); // крапка з комою - після неї нове слово, тож Ю -> "Yu", не "iu"
});

test('змішаний текст: кирилиця + вже наявна латиниця + цифри проходять без змін там, де немає кирилиці', () => {
    assert.equal(translit('АС, вул. Стрийська, 109, платф. 7-9'), 'AS, vul. Stryiska, 109, platf. 7-9');
});

test('порожній рядок, null, undefined, числа - не падають', () => {
    assert.equal(translit(''), '');
    assert.equal(translit(null), '');
    assert.equal(translit(undefined), '');
    assert.equal(translit(42), '42');
});

test('реальні дані з API: адреса автостанції (дужки, кома, скорочення)', () => {
    assert.equal(
        translit('Автостанція Київ (центральний залізничний вокзал), метро Вокзальна, вул. Симона Петлюри, буд. 32'),
        'Avtostantsiia Kyiv (tsentralnyi zaliznychnyi vokzal), metro Vokzalna, vul. Symona Petliury, bud. 32'
    );
});

test('реальні дані з API: назва перевізника з лапками і абревіатурою', () => {
    assert.equal(translit('ТОВ МКТ Зесен Транс'), 'TOV MKT Zesen Trans');
    assert.equal(translit('ПП "ЛисАвтоТранс"'), 'PP "LysAvtoTrans"');
});

// Слово цілком великими літерами: перевізники приходять від API саме так
// ("ЛЕКС КЛУБ ТОВ", "МУСТАНГ ТРАНС ТОВ"). Багатолітерний відповідник мусить стати
// великим ЦІЛКОМ - інакше виходить "ShEVChENKO". Попередній набір тестів цього не
// ловив, бо в його прикладах ("ЛЬВІВ", "КИЇВ") жодного диграфа немає.
test('все-велике слово: диграфи теж великі цілком', () => {
    assert.equal(translit('ШЕВЧЕНКО'), 'SHEVCHENKO');
    assert.equal(translit('ЖОВТЕНЬ'), 'ZHOVTEN');
    assert.equal(translit('ЩОРС'), 'SHCHORS');
    assert.equal(translit('ХАРКІВ'), 'KHARKIV');
    assert.equal(translit('ЦЮРУПИНСЬК'), 'TSIURUPYNSK');
    assert.equal(translit('ЗГОРАНИ'), 'ZGHORANY');
});

test('все-велике не ламає звичайний регістр у тому ж рядку', () => {
    assert.equal(translit('ТОВ Жовтень'), 'TOV Zhovten');
    assert.equal(translit('ЛЕКС КЛУБ ТОВ'), 'LEKS KLUB TOV');
});

test('слово з однієї літери все-великим не вважається', () => {
    // Ініціал має лишитись "S.", а не "S." зі спробою зробити все велике;
    // самотнє "Я" природніше як "Ya", ніж "YA".
    assert.equal(translit('вул. С. Петлюри, 32'), 'vul. S. Petliury, 32');
    assert.equal(translit('Я'), 'Ya');
});

// Задача 15: словник екзонімів міст (cities-en.json) і глосарій службових слів
// адрес зупинок (geo-en.json). Обидва - виключення поверх translit(), не заміна йому.

test('словник екзонімів містить лише випадки, де транслітерація хибна', () => {
    const cities = require('../i18n/cities-en.json');
    const { translit } = require('../i18n/translit.js');
    // Варшава транслітерується як "Varshava" - без запису вийде неправильно
    const values = Object.values(cities);
    assert.ok(values.includes('Warsaw'), 'Варшава має бути у словнику');
    // Київ транслітерується сам ("Kyiv") - запис зайвий
    assert.ok(!values.includes('Kyiv'), 'Київ транслітерується сам, запис зайвий');
});

test('словник екзонімів: кожен запис справді виправляє транслітерацію (жодного зайвого)', () => {
    // Захист від регресії: якщо колись хтось додасть запис, що збігається з translit(),
    // цей тест впаде і вкаже, який саме запис зайвий.
    // cities-sample.json - вибірка живих даних API для розробки (.superpowers/sdd/.gitignore),
    // її може не бути на чистому чекауті чи в CI - тоді ця перевірка просто пропускається,
    // а не падає: без "живих" українських назв міст перевірити translit() нема з чого.
    let citiesSample;
    try {
        citiesSample = require('../.superpowers/sdd/cities-sample.json');
    } catch (e) {
        return; // немає вибірки - пропускаємо перевірку, а не падаємо
    }
    const cities = require('../i18n/cities-en.json');
    const { translit } = require('../i18n/translit.js');
    const nameById = new Map(citiesSample.map((c) => [String(c.id), c.name]));

    for (const [id, en] of Object.entries(cities)) {
        const uaName = nameById.get(id);
        if (uaName === undefined) continue; // вибірка може не містити геть усі id - не привід падати
        assert.notEqual(
            translit(uaName),
            en,
            `id ${id} (${uaName}): translit() вже дає "${en}", запис у cities-en.json зайвий`
        );
    }
});

test('словник екзонімів: ключ - це рядок з числовим id, а не назва міста', () => {
    const cities = require('../i18n/cities-en.json');
    for (const id of Object.keys(cities)) {
        assert.ok(/^\d+$/.test(id), `ключ "${id}" має бути числовим id міста, не назвою`);
    }
});

test('глосарій станцій: покриває службові слова з реальних прикладів адрес API', () => {
    const geo = require('../i18n/geo-en.json');
    assert.equal(geo['автостанція'], 'bus station');
    assert.equal(geo['ас'], 'bus station');
    assert.equal(geo['автовокзал'], 'bus terminal');
    assert.equal(geo['залізничний вокзал'], 'railway station');
    assert.equal(geo['вокзал'], 'station');
    assert.equal(geo['метро'], 'metro');
    assert.equal(geo['вул.'], 'St.');
    assert.equal(geo['буд.'], 'bld.');
});

test('глосарій: складений ключ застосовується раніше за свою частину', () => {
    const geo = require('../i18n/geo-en.json');
    // Порядок, у якому глосарій застосовується в app.js: від довгих ключів до коротких
    const order = Object.keys(geo).sort((a, b) => b.length - a.length);

    // Перевірка, що тест не проходить лише "тому що пар для порівняння немає":
    // у словнику мусить бути хоча б одна пара, де довший ключ дійсно містить коротший
    // ("вокзал" всередині "залізничний вокзал" і "автовокзал") - інакше цикл нижче
    // нічого не перевіряє і тест минає впорожні.
    const genuinePairs = [];
    for (const long of order) {
        for (const short of order) {
            if (long !== short && long.includes(short)) genuinePairs.push([long, short]);
        }
    }
    assert.ok(
        genuinePairs.length > 0,
        'у глосарії немає жодної пари "довгий ключ містить короткий" - перевірка порядку нижче була б порожньою'
    );

    // Для КОЖНОЇ пари, де один ключ міститься в іншому, довший мусить іти першим -
    // інакше «вокзал» з'їсть «залізничний вокзал» і переклад вийде неповним.
    for (const [long, short] of genuinePairs) {
        assert.ok(
            order.indexOf(long) < order.indexOf(short),
            `"${short}" застосується раніше за "${long}" і зіпсує його`
        );
    }
});
