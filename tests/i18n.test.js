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
