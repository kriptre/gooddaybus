// Розбір шаблонних текстів перевізника (Task 15b): назва перевізника, умови багажу,
// пересадка, умови оплати. Для цих полів транслітерація сама собою марна - українське
// речення латиницею нічого не каже англомовному пасажиру - але текст достатньо
// шаблонний, щоб розібрати його за структурою (числа, стійкі фрази) і скласти
// англійське речення заново, а не просто транслітерувати вихідне.
//
// Контракт кожної функції: { text, translated: true|false }. Коли розпізнати не
// вдалось - повертається ВИХІДНИЙ український текст і translated:false, ніколи
// напівперекладений рядок і ніколи порожній рядок (виклик, що показує це пасажиру,
// сам вирішує, чи ставити позначку "не перекладено").
// Єдина зміна вихідного тексту на цій гілці - обрізані пробіли й переводи рядка
// по краях (частина рядків від API закінчуються \r\n). Тест на ТОЧНУ рівність
// вихідному рядку через це впаде - звіряйте з .trim().
//
// Працює і в Node (тести, білд), і в браузері (сторінки англійської версії) - як
// i18n/translit.js.
(function (root) {
    'use strict';

    var translit = (typeof module !== 'undefined' && module.exports)
        ? require('./translit.js').translit
        : root.translit;

    // ==================== carrierName ====================
    //
    // 59 значень carrier у зрізі: частина суто кирилична, частина виду "ЛАТ/Кир"
    // (де латинська частина - це бренд), частина вже повністю латиницею.
    // Форми власності перекладаються окремим словом, решта імені - транслітерується
    // (для власної назви перевізника транслітерація - це і є коректний, кінцевий
    // результат, а не проміжний "непереклад": як і для імені людини, "англійської
    // версії" назви компанії просто не існує).

    var LEGAL_FORMS = { 'ТОВ': 'LLC', 'ТЗОВ': 'LLC', 'ФОП': 'sole trader', 'ПП': 'sole proprietorship' };
    var DECORATIVE_RE = /[()«»"“”'’]/g;
    var CYRILLIC_RE = /[А-Яа-яІіЇїЄєҐґ]/;

    // Форму власності шукаємо по токенах (розбиття на пробіли), а не через \b:
    // у JS \b визначається через \w, а \w НЕ включає кирилицю, тож /\bТОВ\b/ на
    // кириличному тексті мовчки не спрацює (границя не розпізнається взагалі).
    function extractLegalForm(s) {
        var tokens = s.split(/\s+/);
        for (var i = 0; i < tokens.length; i++) {
            var bare = tokens[i].replace(DECORATIVE_RE, '').toUpperCase();
            if (Object.prototype.hasOwnProperty.call(LEGAL_FORMS, bare)) {
                var rest = tokens.slice(0, i).concat(tokens.slice(i + 1)).join(' ');
                return { form: LEGAL_FORMS[bare], rest: rest };
            }
        }
        return null;
    }

    function carrierName(raw) {
        var s = String(raw == null ? '' : raw).trim();
        if (!s) return { text: s, translated: false };

        // "TRANSTEMPO/ТрансТемпо" - латинська частина до "/" це і є бренд.
        var slashIdx = s.indexOf('/');
        if (slashIdx !== -1) {
            var left = s.slice(0, slashIdx).trim();
            if (left && !CYRILLIC_RE.test(left)) {
                return { text: left, translated: true };
            }
        }

        var extracted = extractLegalForm(s);
        var working = extracted ? extracted.rest : s;
        working = working.replace(DECORATIVE_RE, ' ').replace(/\s+/g, ' ').trim();
        var text = translit(working).replace(/\s+/g, ' ').trim();
        if (extracted) {
            text = text + (extracted.form === 'LLC' ? ' LLC' : ' (' + extracted.form + ')');
        }
        return { text: text, translated: true };
    }

    // ==================== transferText ====================
    //
    // change_info складається з кількох блоків: "Прямий рейс", "Можлива пересадка",
    // "Пересадка у м. X" (та/або "у м. X та у м. Y"), "Рейс з пересадкою",
    // "або перед кордоном", "тривалість ~N хв"/"N год M хв", номер пересадки "№N",
    // застереження про черги на кордоні. Розбір: витягти кожен відомий блок з рядка
    // (одночасно прибираючи його зі "залишку"); якщо після цього в залишку є
    // непорожній текст (розділові знаки й пробіли не рахуються) - значить, у рядку є
    // щось, чого ми не впізнали, і чесніше повернути оригінал, ніж змовчати про це.

    var CITY_EXONYMS = { 'варшава': 'Warsaw' };

    function cityToEnglish(name) {
        var key = name.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(CITY_EXONYMS, key)) return CITY_EXONYMS[key];
        return translit(name);
    }

    var DURATION_RE = /(тривалість\s*)?\(?(~)?\s*(?:(\d+)\s*год\.?\s*)?(\d+)\s*хв\.?\)?/i;
    var BORDER_DELAY_RE = /за\s+умови\s+черг\s+на\s+кордонах\s+тривалість\s+пересадки\s+від\s*(\d+)\s*год\.?/i;
    var BORDER_OR_RE = /або\s+перед\s+кордоном/i;
    var TRANSFER_NO_RE = /№\s*(\d+)/;
    var CITY_RE = /(та\s+|або\s+)?у?\s*м\.\s*([А-ЯІЇЄҐ][а-яіїєґ'’-]*)/gi;
    var MOSTLY_RE = /переважно/i;
    var DIRECT_RE = /прямий\s+рейс/i;
    var ROUTE_TRANSFER_RE = /рейс\s+з\s+пересадкою/i;
    var POSSIBLE_RE = /можлив[аі]/i;
    var TRANSFER_WORD_RE = /пересадк(?:а|и|ою)/i;
    var LEFTOVER_RE = /[\s,.!:;()]+/g;

    function transferText(raw) {
        var s = String(raw == null ? '' : raw).trim();
        if (!s) return { text: s, translated: false };

        var remainder = s.replace(/\.\.+/g, '.');

        var durMatch = remainder.match(DURATION_RE);
        var durationPhrase = null;
        if (durMatch) {
            var approx = !!durMatch[2];
            var hours = durMatch[3] ? parseInt(durMatch[3], 10) : 0;
            var minutes = parseInt(durMatch[4], 10);
            var bits = [];
            if (hours) bits.push(hours + ' h');
            bits.push(minutes + ' min');
            durationPhrase = '(' + (approx ? '~' : '') + bits.join(' ') + ')';
            remainder = remainder.replace(durMatch[0], ' ');
        }

        var borderDelayMatch = remainder.match(BORDER_DELAY_RE);
        var borderDelayPhrase = null;
        if (borderDelayMatch) {
            borderDelayPhrase = 'if there are queues at the border, the transfer may take from ' + borderDelayMatch[1] + ' h';
            remainder = remainder.replace(borderDelayMatch[0], ' ');
        }

        var hasBorderOr = BORDER_OR_RE.test(remainder);
        if (hasBorderOr) remainder = remainder.replace(BORDER_OR_RE, ' ');

        var transferNoMatch = remainder.match(TRANSFER_NO_RE);
        var transferNo = null;
        if (transferNoMatch) {
            transferNo = transferNoMatch[1];
            remainder = remainder.replace(transferNoMatch[0], ' ');
        }

        var cities = [];
        var cm;
        CITY_RE.lastIndex = 0;
        while ((cm = CITY_RE.exec(remainder)) !== null) {
            var connector = cm[1] ? (/або/i.test(cm[1]) ? 'or' : 'and') : null;
            cities.push({ name: cm[2], connector: connector });
        }
        remainder = remainder.replace(CITY_RE, ' ');

        var isMostly = MOSTLY_RE.test(remainder);
        var isDirect = DIRECT_RE.test(remainder);
        var isRouteTransfer = ROUTE_TRANSFER_RE.test(remainder);
        var isPossible = POSSIBLE_RE.test(remainder);
        var isTransferWord = TRANSFER_WORD_RE.test(remainder);

        remainder = remainder
            .replace(MOSTLY_RE, ' ')
            .replace(DIRECT_RE, ' ')
            .replace(ROUTE_TRANSFER_RE, ' ')
            .replace(POSSIBLE_RE, ' ')
            .replace(TRANSFER_WORD_RE, ' ');

        var leftover = remainder.replace(LEFTOVER_RE, '');
        if (leftover) return { text: s, translated: false };
        if (!isMostly && !isDirect && !isRouteTransfer && !isPossible && !isTransferWord) {
            return { text: s, translated: false };
        }

        function cityClause(prep) {
            if (!cities.length) return '';
            var out = ' ' + prep + ' ' + cityToEnglish(cities[0].name);
            for (var i = 1; i < cities.length; i++) {
                var conn = cities[i].connector === 'or' ? 'or' : 'and';
                out += ' ' + conn + ' ' + cityToEnglish(cities[i].name);
            }
            return out;
        }

        var base;
        if (isDirect && isMostly) {
            base = 'Mostly a direct route, transfer possible';
        } else if (isDirect) {
            base = 'Direct route';
        } else if (isRouteTransfer) {
            base = 'Route with a transfer' + cityClause('in');
        } else if (isPossible) {
            base = 'Transfer possible' + cityClause('in');
        } else if (isTransferWord) {
            base = 'Transfer' + (transferNo ? ' #' + transferNo : '') + cityClause('in');
        } else {
            return { text: s, translated: false };
        }

        if (hasBorderOr) base += ' or before the border';
        if (durationPhrase) base += ' ' + durationPhrase;
        if (borderDelayMatch) {
            var sentence = borderDelayPhrase.charAt(0).toUpperCase() + borderDelayPhrase.slice(1);
            base += (/[.!?]$/.test(base) ? ' ' : '. ') + sentence + '.';
        }

        return { text: base, translated: true };
    }

    // ==================== baggageText ====================
    //
    // 53 значення baggage у зрізі, але (як помітно з вибірки) НЕ 53 різних шаблони:
    // майже всі починаються "У вартість квитка входить/входять" і закінчуються майже
    // незмінним хвостом "Додатковий багаж може бути перевезений за окрему плату і
    // тільки при наявності вільного місця в багажному відділенні автобуса.". Різниця -
    // лише в кількості місць, габаритах і вазі. Розбір будується навколо ЦИХ чисел,
    // а не навколо точного формулювання.
    //
    // Щоб не видати напівпереклад, повний контроль: рядок мусить (1) починатися з
    // відомого вступу, (2) містити стандартний хвіст, (3) не мати ПІСЛЯ хвоста
    // жодного залишку тексту (сезонні винятки типу "з 15 грудня по 11 січня..."),
    // і (4) не містити відомих "заборонених" ознак - дитячий/віковий виняток,
    // альтернативу "або одна одиниця...", доплату за перевищення. Кожна з них - це
    // реальна структура в живих даних, яку наш простий шаблон з одним багажним місцем
    // передати чесно не може; краще залишити українською, ніж змовчати про виняток.

    var OPEN_RE = /^у\s+вартість\s+квитка\s+вход(?:ить|ять):?\s*/i;
    var STANDARD_TAIL_RE = /додатковий\s+багаж\s+може\s+бути\s+перевезений\s+за\s+окрему\s+плату\s+і\s+тільки\s+при\s+наявності\s+вільного\s+місця\s+в\s+багажному\s+відділенні\s+автобуса\.?/i;
    var DENYLIST_RE = /дитячого\s+квитка|дитячих\s+квитків|для\s+дітей|половина\s+норми|років\s*-|доплата|понаднормово|або\s+(?:одна|дві|до\s+двох)\s+одиниц/i;
    // \w у JS не включає кирилицю (та сама пастка, що й \b - див. коментар біля
    // extractLegalForm вище), тож "ручн\w*" на кириличному суфіксі ловить нуль
    // символів і весь патерн НЕ спрацьовує - явний перелік кириличних літер замість \w.
    // Необов'язковий префікс кількості ("дві одиниці ручної поклажі") зумисно
    // входить у сам патерн: кількість ручної поклажі стоїть ПЕРЕД "ручн-", і якщо
    // не захопити її тут, вона лишиться в mainPart і буде помилково прочитана як
    // кількість основного багажу.
    var HAND_LUGGAGE_RE = /(?:(?:одна|дві|до\s+двох|\d+)\s*одиниц[а-яіїєґ']*\s+)?ручн[а-яіїєґ']*\s+поклаж[а-яіїєґ']*/i;
    var DIMS_SUM_RE = /(\d+)\s*см\s*\(\s*у\s*сумі\s*вимірів/i;
    var DIMS_CLASSIC_RE = /(\d+)\s*[xхX×]\s*(\d+)\s*[xхX×]\s*(\d+)/;
    var WEIGHT_RE = /(\d+)\s*кг/;

    // "кожна" і "загальною"/"сумарною" кажуть про ОДНЕ І ТЕ САМЕ число протилежне,
    // і сплутати їх - та сама порода помилки, заради якої існує MIN_QUALIFIER_RE вище:
    // мовчазне припущення "на місце" перетворює 40 кг НА ВСІ РАЗОМ у "40 кг на кожне",
    // пасажир пакує 80 кг і його розвертають при посадці. Тож передаємо те, що сказав
    // перевізник; а якщо рядок каже одночасно обидва (суперечність, у живих даних не
    // трапляється) - чесніше відмовитись, ніж вгадувати.
    var TOTAL_RE = /загальн|сумарн/i;

    // Видобувачі чисел не дивляться на слово ПЕРЕД числом, а всі наші англійські
    // формулювання кажуть "up to N". Тому рядок із вказівкою на МІНІМУМ
    // ("вагою не менше 25 кг") перетворився б на "up to 25 kg" - зміст навиворіт,
    // причому впевнено. У сьогоднішніх даних такого формулювання немає, але
    // перевізник може його ввести будь-коли: краще віддати український оригінал.
    // Увага на "не більше": це МАКСИМУМ ("not more than"), і його перекладати треба.
    // Мінімум - тільки "більше"/"понад" БЕЗ заперечення перед ним, звідси lookbehind.
    var MIN_QUALIFIER_RE = /не\s+менше|щонайменше|як\s+мінімум|мінімум\s+\d|(?<!не\s{0,3})(?:понад|більше)\s+\d+\s*(?:кг|см)/i;
    var EACH_RE = /кожна/i;

    var QUANTITY_PATTERNS = [
        { re: /1\s*або\s*2\s*валіз/i, min: 1, max: 2, unit: 'suitcase' },
        { re: /до\s+двох\s+одиниц/i, min: 1, max: 2, unit: 'item' },
        { re: /дві\s*одиниц/i, min: 2, max: 2, unit: 'item' },
        { re: /(?:одна|1)\s*валіз/i, min: 1, max: 1, unit: 'suitcase' },
        { re: /(?:одна|1)\s*одиниц/i, min: 1, max: 1, unit: 'item' }
    ];

    function parseQuantity(text) {
        for (var i = 0; i < QUANTITY_PATTERNS.length; i++) {
            if (QUANTITY_PATTERNS[i].re.test(text)) {
                var p = QUANTITY_PATTERNS[i];
                return { min: p.min, max: p.max, unit: p.unit };
            }
        }
        return null;
    }

    function parseDims(text) {
        var sum = text.match(DIMS_SUM_RE);
        if (sum) return { sum: parseInt(sum[1], 10) };
        var classic = text.match(DIMS_CLASSIC_RE);
        if (classic) return { l: classic[1], w: classic[2], h: classic[3] };
        return null;
    }

    function parseWeight(text) {
        var w = text.match(WEIGHT_RE);
        if (!w) return null;
        return { kg: parseInt(w[1], 10), each: EACH_RE.test(text), total: TOTAL_RE.test(text) };
    }

    function dimsPhrase(dims) {
        if (!dims) return null;
        if (dims.sum) return 'total dimensions (L+W+H) up to ' + dims.sum + ' cm';
        return 'up to ' + dims.l + 'x' + dims.w + 'x' + dims.h + ' cm';
    }

    // qty - розібрана кількість місць для ЦІЄЇ частини (основний багаж або ручна поклажа).
    // Коли місце одне, "кожне" і "разом" означають те саме, тож уточнення не додаємо -
    // "up to 25 kg in total" про одну валізу звучало б безглуздо. Коли місць більше -
    // саме тут і живе різниця, заради якої все це робиться.
    function weightPhrase(weight, qty) {
        if (!weight) return null;
        var singular = !qty || (qty.min === 1 && qty.max === 1);
        var suffix = '';
        if (!singular) {
            if (weight.each) suffix = ' each';
            else if (weight.total) suffix = ' in total';
        }
        return 'up to ' + weight.kg + ' kg' + suffix;
    }

    function itemWord(unit, n) {
        if (unit === 'suitcase') return n === 1 ? 'suitcase' : 'suitcases';
        return n === 1 ? 'item' : 'items';
    }

    function qtyPhrase(qty) {
        if (!qty) return null;
        if (qty.min === qty.max) return qty.min + ' ' + itemWord(qty.unit, qty.min);
        return 'up to ' + qty.max + ' ' + itemWord(qty.unit, qty.max);
    }

    function describe(clauseText, qty) {
        var extras = [];
        var dp = dimsPhrase(parseDims(clauseText));
        var wp = weightPhrase(parseWeight(clauseText), qty);
        if (dp) extras.push(dp);
        if (wp) extras.push(wp);
        return extras;
    }

    function baggageText(raw) {
        var s = String(raw == null ? '' : raw).trim();
        if (!s) return { text: s, translated: false };

        var norm = s.replace(/\r\n|\r/g, ' ').replace(/\.\.+/g, '.').replace(/\s+/g, ' ').trim();

        if (!OPEN_RE.test(norm)) return { text: s, translated: false };
        var body = norm.replace(OPEN_RE, '');

        var tailMatch = body.match(STANDARD_TAIL_RE);
        if (!tailMatch) return { text: s, translated: false };

        var beforeTail = body.slice(0, tailMatch.index);
        var afterTail = body.slice(tailMatch.index + tailMatch[0].length).trim();
        if (afterTail) return { text: s, translated: false };
        if (DENYLIST_RE.test(beforeTail)) return { text: s, translated: false };
        if (MIN_QUALIFIER_RE.test(beforeTail)) return { text: s, translated: false };
        // Рядок, що каже і "кожне", і "разом" - суперечливий: будь-яке трактування ваги
        // буде вигадкою. Віддаємо оригінал, хай пасажир питає менеджера.
        if (EACH_RE.test(beforeTail) && TOTAL_RE.test(beforeTail)) return { text: s, translated: false };

        var handMatch = beforeTail.match(HAND_LUGGAGE_RE);
        var mainPart = handMatch ? beforeTail.slice(0, handMatch.index) : beforeTail;
        var handPart = handMatch ? beforeTail.slice(handMatch.index) : null;

        var mainQty = parseQuantity(mainPart);
        var mainExtras = describe(mainPart, mainQty);

        var mainSentence;
        if (mainQty && mainQty.unit === 'suitcase') {
            mainSentence = 'Ticket price includes ' + qtyPhrase(mainQty) +
                (mainExtras.length ? ', ' + mainExtras.join(' and ') : '') + '.';
        } else {
            var mainLabel = mainQty ? qtyPhrase(mainQty) : 'baggage';
            mainSentence = 'Ticket price includes ' + mainLabel + ' of baggage' +
                (mainExtras.length ? ', ' + mainExtras.join(' and ') : '') + '.';
        }

        var handSentence = '';
        if (handPart) {
            var handQty = parseQuantity(handPart);
            var handExtras = describe(handPart, handQty);
            var handLead;
            if (handQty && handQty.min > 1) {
                handLead = qtyPhrase(handQty) + ' of hand luggage are included';
            } else {
                handLead = 'Hand luggage is included';
            }
            handSentence = ' ' + handLead + (handExtras.length ? ', ' + handExtras.join(' and ') : '') + '.';
        }

        var text = mainSentence + handSentence +
            ' Extra baggage can be carried for a separate fee, subject to space in the bus luggage compartment.';

        return { text: text, translated: true };
    }

    // ==================== priceLabelText ====================
    //
    // Лише 7 різних значень у зрізі - усі про передоплату чи знижку. Умова оплати
    // НІКОЛИ не ховається: якщо жоден шаблон не підійшов, повертається оригінальний
    // український текст (не порожній рядок) - показати українською гірше, ніж
    // англійською, але приховати геть - найгірше з усього.

    var WORD_NUM = { 'двох': 2, 'трьох': 3, 'чотирьох': 4 };
    function wordOrDigitNum(str) {
        if (/^\d+$/.test(str)) return parseInt(str, 10);
        return WORD_NUM[str.toLowerCase()] || str;
    }

    var FULL_ADVANCE_RE = /обов['’]?язков[а-яіїєґ]*\s+повна\s+попередня\s+оплата\s+вартості\s+кожного\s+квитка/i;
    var GROUP_ADVANCE_RE = /обов['’]?язков[а-яіїєґ]*\s+попередня\s+оплата\s+(?:у\s+розмірі\s+)?вартості\s+одного\s+квитка\s+для\s+груп\s+з\s+(двох|трьох|чотирьох|\d+)\s+і\s+більше\s+осіб/i;
    var FULL_PAYMENT_ONLY_RE = /лише\s+повна\s+оплата\s+квитка/i;
    var BOOKING_AFTER_PAYMENT_RE = /бронювати\s+дозволено\s+після\s+отримання\s+оплати/i;
    var BOOKING_WITHOUT_PAYMENT_RE = /бронь\s+без\s+оплати\s+неможлива/i;
    var PROMO_RE = /акція/i;
    var DISCOUNT_RE = /знижка\s*(\d+)\s*%/i;
    var PRICE_LEFTOVER_RE = /[\s!.,]+/g;

    function priceLabelText(raw) {
        var s = String(raw == null ? '' : raw).trim();
        if (!s) return { text: s, translated: false };

        var remainder = s;
        var pieces = [];
        var m;

        if ((m = remainder.match(FULL_ADVANCE_RE))) {
            pieces.push('Full advance payment is required for every ticket');
            remainder = remainder.replace(m[0], '');
        } else if ((m = remainder.match(GROUP_ADVANCE_RE))) {
            pieces.push('Advance payment equal to the price of one ticket is required for groups of ' +
                wordOrDigitNum(m[1]) + ' or more people');
            remainder = remainder.replace(m[0], '');
        } else if ((m = remainder.match(FULL_PAYMENT_ONLY_RE))) {
            pieces.push('Full payment only');
            remainder = remainder.replace(m[0], '');
        }

        if ((m = remainder.match(BOOKING_AFTER_PAYMENT_RE))) {
            pieces.push('Booking is allowed only after payment is received');
            remainder = remainder.replace(m[0], '');
        }
        if ((m = remainder.match(BOOKING_WITHOUT_PAYMENT_RE))) {
            pieces.push('Booking without payment is not possible');
            remainder = remainder.replace(m[0], '');
        }

        var promo = PROMO_RE.test(remainder);
        if (promo) remainder = remainder.replace(PROMO_RE, '');
        if ((m = remainder.match(DISCOUNT_RE))) {
            pieces.push('Promotion! ' + m[1] + '% discount');
            remainder = remainder.replace(m[0], '');
        } else if (promo) {
            pieces.push('Promotion');
        }

        var leftover = remainder.replace(PRICE_LEFTOVER_RE, '');
        if (leftover || !pieces.length) return { text: s, translated: false };

        var text = pieces.join('. ');
        text = text.replace(/[.!]?$/, /!\s*$/.test(s) ? '!' : '.');

        return { text: text, translated: true };
    }

    // --- Назви знижок --------------------------------------------------------------
    // Перевізники описують ту саму знижку десятком способів: "Діти до 10 років (включно)",
    // "За віком: до 10 р.", "Дитячий (діти від 7 до 12 років)", "50% Діти 0-5 лет" (так,
    // з російським "лет" - помилка постачальника). Процент із назви вже зрізає виклик,
    // тут лишається сама категорія. Порядок схем має значення: конкретніші йдуть першими.
    var DISCOUNT_RULES = [
        // Повний / стандартний тариф - це не знижка, а базова ціна
        { re: /^(повний|стандартн)/i, en: function () { return 'Full fare'; } },
        // Діапазон віку: "Діти 5-12 років", "Діти 0-5 лет", "Дитячий (діти від 7 до 12 років)"
        { re: /діт(?:и|ей|ячий)[^\d]*(?:від\s*)?(\d+)\s*(?:-|–|до)\s*(\d+)\s*(?:р|лет)/i, en: function (m) { return 'Children ' + m[1] + '-' + m[2]; } },
        // Верхня межа віку зі шкільним квитком - окремо, бо умова важлива
        { re: /діт(?:и|ей)[^\d]*(\d+)[^)]*учнівськ/i, en: function (m) { return 'Children up to ' + m[1] + ' (with school ID)'; } },
        // Верхня межа віку: "Діти до 10 років (включно)", "Дитячий (діти до 6 років)"
        { re: /діт(?:и|ей|ячий)[^\d]*до\s*(\d+)\s*р/i, en: function (m) { return 'Children up to ' + m[1]; } },
        // "За віком: до 10 р." - той самий зміст іншими словами
        { re: /за\s+віком[^\d]*(\d+)\s*р/i, en: function (m) { return 'Age up to ' + m[1]; } },
        // Студенти: з ISIC, зі студентським квитком, просто "Студентська"
        // ISIC написаний латиницею, але нормалізація двійників (див. нижче) робить із нього
        // "ІSІC" з кириличними І - тому в класі приймаємо обидва накреслення.
        { re: /студент[^\d]*(\d+)\s*р[^)]*[iі][sс][iі][cс]/i, en: function (m) { return 'Students up to ' + m[1] + ' (with ISIC)'; } },
        { re: /студент[^\d]*(\d+)\s*р[^)]*студентськ/i, en: function (m) { return 'Students up to ' + m[1] + ' (with student ID)'; } },
        { re: /студент/i, en: function () { return 'Students'; } },
        // Похилий вік: "Люди похилого віку (від 60 років)", "10% Пенсіонери від 60 років"
        { re: /(?:похилого\s+віку|пенсіонер)[^\d]*(\d+)\s*р/i, en: function (m) { return 'Seniors (' + m[1] + '+)'; } },
        { re: /пенсійн[а-яіїєґ]*\s+вік/i, en: function () { return 'Pension age'; } },
        { re: /пенсіонер/i, en: function () { return 'Pensioners'; } },
        // Інвалідність: група вказується цифрами
        { re: /інвалід[^\d]*(\d+)\s*(?:або|чи|,|\/)\s*(\d+)\s*груп/i, en: function (m) { return 'Disability group ' + m[1] + ' or ' + m[2]; } },
        { re: /інвалід/i, en: function () { return 'Disability'; } },
        // Учасники бойових дій - і повна назва, і абревіатура УБД
        // \b не працює з кирилицею, тож межу слова для УБД пишемо явним класом
        { re: /уч[а-яіїєґ]*\.?\s*бойових\s+дій|(?:^|[^А-Яа-яІіЇїЄєҐґ])убд(?:[^А-Яа-яІіЇїЄєҐґ]|$)/i, en: function () { return 'Combat veteran (ID required)'; } }
    ];

    // Перевізники регулярно друкують латинські літери-двійники всередині українських слів:
    // "ПЕНСІЙНИЙ ВIК" з латинською I, "cтудентського" з латинською c. Око різниці не бачить,
    // регулярка бачить. Тому матчимо ЗАВЖДИ по нормалізованому рядку - інакше загальна схема
    // ("студент") спрацювала б на сирому тексті раніше, ніж конкретніша на виправленому,
    // і знижка втратила б деталі. Єдина справжня латиниця в правилах - ISIC, її схема
    // приймає обидва накреслення.
    var LOOKALIKE = { 'a': 'а', 'c': 'с', 'e': 'е', 'i': 'і', 'o': 'о', 'p': 'р', 'x': 'х', 'y': 'у', 'A': 'А', 'B': 'В', 'C': 'С', 'E': 'Е', 'H': 'Н', 'I': 'І', 'K': 'К', 'M': 'М', 'O': 'О', 'P': 'Р', 'T': 'Т', 'X': 'Х', 'Y': 'У' };
    var LOOKALIKE_RE = /[aceiopxyABCEHIKMOPTXY]/g;
    function deLookalike(s) { return s.replace(LOOKALIKE_RE, function (c) { return LOOKALIKE[c] || c; }); }

    function matchDiscount(s) {
        for (var i = 0; i < DISCOUNT_RULES.length; i++) {
            var m = s.match(DISCOUNT_RULES[i].re);
            if (m) return { text: DISCOUNT_RULES[i].en(m), translated: true };
        }
        return null;
    }

    function discountName(raw) {
        var s = String(raw == null ? '' : raw).trim();
        if (!s) return { text: s, translated: false };
        return matchDiscount(deLookalike(s)) || { text: s, translated: false };
    }

    var api = {
        carrierName: carrierName,
        baggageText: baggageText,
        transferText: transferText,
        priceLabelText: priceLabelText,
        discountName: discountName
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.vendorEn = api;
})(typeof window !== 'undefined' ? window : globalThis);
