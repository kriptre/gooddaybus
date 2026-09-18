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

// Задача 15b: i18n/vendor-en.js - розбір шаблонних текстів перевізника (назва,
// багаж, пересадка, умови оплати). Рядки нижче - реальні значення зі зрізу живих
// даних .superpowers/sdd/vendor-sample.json (751 рейс, 8 напрямків); цей файл сам по
// собі в .gitignore (dev-зріз), тож рядки для тестів вписані буквально, а не
// прочитані з нього - щоб тести працювали на чистому чекауті й у CI.

const {
    carrierName,
    baggageText,
    transferText,
    priceLabelText
} = require('../i18n/vendor-en.js');

test('carrierName: "ЛАТ/Кир" - латинська частина до "/" це бренд', () => {
    assert.deepEqual(carrierName('TRANSTEMPO/ТрансТемпо'), { text: 'TRANSTEMPO', translated: true });
    assert.deepEqual(carrierName('ATLASTRAVELBUS/AVTOEKSPRES'), { text: 'ATLASTRAVELBUS', translated: true });
    assert.deepEqual(
        carrierName('EAST WEST EUROLINES/ТзОВ "Гал-Всесвіт"'),
        { text: 'EAST WEST EUROLINES', translated: true }
    );
});

test('carrierName: форма власності перекладається окремим словом (приклад з брифу)', () => {
    assert.deepEqual(carrierName('ТОВ МКТ Зесен Транс'), { text: 'MKT Zesen Trans LLC', translated: true });
});

test('carrierName: ТОВ-суфікс, ПП-префікс, ФОП-суфікс з реальних даних', () => {
    // Форма власності завжди йде ПІСЛЯ вже транслітерованої назви - англійська
    // конвенція ("Acme LLC"), незалежно від того, де вона стояла в українському рядку.
    assert.deepEqual(carrierName('КАНТОЛ БУСТРЕВЕЛ ТОВ'), { text: 'KANTOL BUSTREVEL LLC', translated: true });
    assert.deepEqual(
        carrierName('ПОТАПЧУК В.В. ФОП'),
        { text: translit('ПОТАПЧУК В.В.') + ' (sole trader)', translated: true }
    );
    assert.deepEqual(
        carrierName('ПП "ЛисАвтоТранс"'),
        { text: translit('ЛисАвтоТранс') + ' (sole proprietorship)', translated: true }
    );
});

test('carrierName: назва без кирилиці лишається як є (нема що перекладати - вже латиниця)', () => {
    assert.deepEqual(carrierName('I TRAVEL BUS'), { text: 'I TRAVEL BUS', translated: true });
});

test('carrierName: порожній вхід - translated:false, рядок не зникає', () => {
    assert.deepEqual(carrierName(''), { text: '', translated: false });
    assert.deepEqual(carrierName(null), { text: '', translated: false });
});

test('baggageText: одна одиниця + ручна поклажа, обидві з вагою (реальний рядок)', () => {
    const raw = 'У вартість квитка входить одна одиниця багажу вагою до 25кг та ручна поклажа вагою до 5 кг. ' +
        'Додатковий багаж може бути перевезений за окрему плату і тільки при наявності вільного місця в багажному відділенні автобуса.';
    assert.deepEqual(baggageText(raw), {
        text: 'Ticket price includes 1 item of baggage, up to 25 kg. Hand luggage is included, up to 5 kg. ' +
            'Extra baggage can be carried for a separate fee, subject to space in the bus luggage compartment.',
        translated: true
    });
});

test('baggageText: "до двох одиниць" + габарити + вага (реальний рядок)', () => {
    const raw = 'У вартість квитка входить до двох одиниць багажу загальною вагою до 40кг. ' +
        'Додатковий багаж може бути перевезений за окрему плату і тільки при наявності вільного місця в багажному відділенні автобуса.';
    assert.deepEqual(baggageText(raw), {
        text: 'Ticket price includes up to 2 items of baggage, up to 40 kg. ' +
            'Extra baggage can be carried for a separate fee, subject to space in the bus luggage compartment.',
        translated: true
    });
});

test('baggageText: "сума вимірів" (довжина+ширина+висота) - одне число замість трьох (реальний рядок)', () => {
    const raw = 'У вартість квитка входить одна одиниця багажу розміром не більше 160см (у сумі вимірів довжина+ширина+висота) ' +
        'і вагою до 23кг, та ручна поклажа розміром не більше 100см (у сумі вимірів довжина+ширина+висота) і вагою до 5кг. ' +
        'Додатковий багаж може бути перевезений за окрему плату і тільки при наявності вільного місця в багажному відділенні автобуса.';
    assert.deepEqual(baggageText(raw), {
        text: 'Ticket price includes 1 item of baggage, total dimensions (L+W+H) up to 160 cm and up to 23 kg. ' +
            'Hand luggage is included, total dimensions (L+W+H) up to 100 cm and up to 5 kg. ' +
            'Extra baggage can be carried for a separate fee, subject to space in the bus luggage compartment.',
        translated: true
    });
});

test('baggageText: кількість ручної поклажі стоїть ПЕРЕД "ручної" і не має протікати в основну кількість', () => {
    // Пастка: "та дві одиниці ручної поклажі" - "дві одиниці" стосується поклажі,
    // а не основного багажу ("одна одиниця" раніше в тому ж реченні).
    const raw = 'У вартість квитка входить одна одиниця багажу розміром до 30х60х80см і вагою до 25 кг., ' +
        'та дві одиниці ручної поклажі розміром не більше 20х30х40 см. і вагою до 5кг. ' +
        'Додатковий багаж може бути перевезений за окрему плату і тільки при наявності вільного місця в багажному відділенні автобуса.';
    const result = baggageText(raw);
    assert.equal(result.translated, true);
    assert.match(result.text, /^Ticket price includes 1 item of baggage/);
    assert.match(result.text, /2 items of hand luggage are included/);
});

test('baggageText: дитячий/віковий виняток після хвоста - переклад не спотворюється мовчки (translated:false)', () => {
    // Реальний рядок: після стандартного хвоста йде сезонний виняток
    // ("з 15 грудня по 11 січня..."), який наш шаблон з одним багажним місцем
    // чесно передати не може - краще не перекладати, ніж загубити умову.
    const raw = 'У вартість квитка входить одна одиниця багажу розміром до 40х40х80см і вагою до 25кг та ручна ' +
        'поклажа вагою до 5кг. Додатковий багаж може бути перевезений за окрему плату і тільки при наявності ' +
        'вільного місця в багажному відділенні автобуса.\r\nВ період з 15 грудня по 11 січня та з 1 червня по ' +
        '30 серпня у вартість квитка  входить одна одиниця багажу до 25 кг і ручна поклажа до 5 кг';
    assert.deepEqual(baggageText(raw), { text: raw, translated: false });
});

test('baggageText: рядок без стандартного вступу - translated:false, оригінал незмінний', () => {
    const raw = 'Правила перевезення багажу уточнюйте у диспетчера.';
    assert.deepEqual(baggageText(raw), { text: raw, translated: false });
});

test('transferText: "Пересадка у м. X" (приклад з брифу)', () => {
    assert.deepEqual(transferText('Пересадка у м. Львів'), { text: 'Transfer in Lviv', translated: true });
});

test('transferText: дві пересадки через "та" (реальний рядок)', () => {
    assert.deepEqual(
        transferText('Пересадка у м. Київ та у м. Львів'),
        { text: 'Transfer in Kyiv and Lviv', translated: true }
    );
});

test('transferText: місто-екзонім зі словника (Варшава - "Warsaw", не "Varshava")', () => {
    assert.deepEqual(transferText('Пересадка у м. Варшава'), { text: 'Transfer in Warsaw', translated: true });
});

test('transferText: "Прямий рейс" і "Можлива пересадка" - будівельні блоки без міста', () => {
    assert.deepEqual(transferText('Прямий рейс'), { text: 'Direct route', translated: true });
    assert.deepEqual(transferText('Можлива пересадка'), { text: 'Transfer possible', translated: true });
    assert.deepEqual(transferText('Рейс з пересадкою'), { text: 'Route with a transfer', translated: true });
});

test('transferText: тривалість пересадки і застереження про чергу на кордоні (реальні рядки)', () => {
    assert.deepEqual(
        transferText('Пересадка у м. Київ, тривалість ~40 хв.'),
        { text: 'Transfer in Kyiv (~40 min)', translated: true }
    );
    assert.deepEqual(
        transferText('Пересадка у м. Львів. За умови черг на кордонах тривалість пересадки від 1 год.'),
        {
            text: 'Transfer in Lviv. If there are queues at the border, the transfer may take from 1 h.',
            translated: true
        }
    );
});

test('transferText: пересадка на конкретній станції (не "у м. X") - розбір не впізнає, translated:false', () => {
    // Реальний рядок: "на автовокзалі Lviv-Express" не вкладається в жоден з відомих
    // блоків ("у м. X", "на АС ...", "тривалість ..."), тож чесніше не перекладати.
    const raw = 'Пересадка на автовокзалі Lviv-Express';
    assert.deepEqual(transferText(raw), { text: raw, translated: false });
});

test('priceLabelText: обов\'язкова передоплата для груп (приклад з реальних даних)', () => {
    assert.deepEqual(
        priceLabelText("Обов'язкова попередня оплата у розмірі вартості одного квитка для груп з трьох і більше осіб!"),
        {
            text: 'Advance payment equal to the price of one ticket is required for groups of 3 or more people!',
            translated: true
        }
    );
});

test('priceLabelText: повна передоплата за кожен квиток + заборона бронювання без оплати (реальний рядок)', () => {
    assert.deepEqual(
        priceLabelText("Обов'язкова повна попередня оплата вартості кожного квитка! Бронь без оплати неможлива!"),
        {
            text: 'Full advance payment is required for every ticket. Booking without payment is not possible!',
            translated: true
        }
    );
});

test('priceLabelText: акція зі знижкою у відсотках (реальний рядок)', () => {
    assert.deepEqual(
        priceLabelText('Акція! Знижка 25%!'),
        { text: 'Promotion! 25% discount!', translated: true }
    );
});

test('priceLabelText: умова оплати НІКОЛИ не ховається - незнайомий шаблон повертає оригінал, не порожній рядок', () => {
    const raw = 'Щось геть нове про оплату, чого ми ще не бачили.';
    assert.deepEqual(priceLabelText(raw), { text: raw, translated: false });
});

// Видобувачі чисел не дивляться на слово ПЕРЕД числом, а всі англійські формулювання
// кажуть "up to N". Тому вказівка на МІНІМУМ мусить відхилятися цілком: краще
// український оригінал, ніж упевнено перевернутий зміст ("не менше 25 кг" -> "up to 25 kg").
// Пастка: "не більше" - це МАКСИМУМ, його перекладати треба.
test('багаж: мінімальна вага відхиляється, максимальна перекладається', () => {
    const tail = ' Додатковий багаж може бути перевезений за окрему плату і тільки при наявності вільного місця в багажному відділенні автобуса.';
    const min = 'У вартість квитка входить одна одиниця багажу вагою не менше 25кг та ручна поклажа вагою до 5 кг.' + tail;
    const max = 'У вартість квитка входить одна одиниця багажу вагою до 25кг та ручна поклажа вагою до 5 кг.' + tail;

    const rMin = baggageText(min);
    assert.equal(rMin.translated, false, '"не менше" - це мінімум, перекладати не можна');
    assert.equal(rMin.text, min.trim(), 'відхилений рядок повертається як є');

    const rMax = baggageText(max);
    assert.equal(rMax.translated, true, '"до 25кг" - звичайний максимум');
    assert.match(rMax.text, /up to 25 kg/);
});

test('багаж: "не більше" - це максимум, а не мінімум', () => {
    const s = 'У вартість квитка входить до двох одиниць багажу розміром не більше 40х60х100 см і загальною вагою не більше 30кг. Додатковий багаж може бути перевезений за окрему плату і тільки при наявності вільного місця в багажному відділенні автобуса.';
    const r = baggageText(s);
    assert.equal(r.translated, true, '"не більше" не має спрацьовувати як мінімум');
    assert.match(r.text, /up to 30 kg/);
});
