// Транслітерація українського тексту латиницею за стандартом КМУ №55 (2010) -
// тим самим, за яким оформлюють закордонні паспорти й вуличні таблички.
// Працює і в Node (тести, білд), і в браузері (сторінки англійської версії).
(function (root) {
    'use strict';

    // Літери, що залежать від позиції: на початку слова одне, усередині - інше.
    // [форма на початку слова, форма всередині слова]
    var POS = {
        'є': ['Ye', 'ie'],
        'ї': ['Yi', 'i'],
        'й': ['Y', 'i'],
        'ю': ['Yu', 'iu'],
        'я': ['Ya', 'ia']
    };

    // Решта літер - однакові незалежно від позиції в слові.
    // г -> h (фрикативний), ґ -> g (проривний) - різні літери, різний результат.
    // ь (м'який знак) і апостроф узагалі не передаються (порожній рядок).
    var MAP = {
        'а': 'a', 'б': 'b', 'в': 'v', 'г': 'h', 'ґ': 'g', 'д': 'd', 'е': 'e', 'ж': 'zh',
        'з': 'z', 'и': 'y', 'і': 'i', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
        'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts',
        'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
        'ь': '', "'": '', '’': '', 'ʼ': ''
    };

    // "Літера" для визначення межі слова: українська кирилиця (включно з
    // ґ/є/і/ї, які лежать поза суцільним діапазоном А-Я), латиниця і апостроф
    // у будь-якому написанні (він не розриває слово - "Знам'янка" -> "Znamianka",
    // офіційний приклад стандарту: "я" після апострофа лишається серединним "ia").
    // Цифри, дужки, лапки, дефіс, розділові знаки в цей клас НЕ входять -
    // саме тому вони й позначають межу слова.
    var WORD_CHAR = /[А-Яа-яІіЇїЄєҐґA-Za-z’ʼ']/;

    // Слово ЦІЛКОМ великими літерами вимагає іншого регістру відповідника:
    // "ШЕВЧЕНКО" -> "SHEVCHENKO", а не "ShEVChENKO". Тобто регістр не можна вирішувати
    // по одній літері - треба знати, чи є в її слові хоч одна мала. Назви перевізників
    // ("ЛЕКС КЛУБ ТОВ", "МУСТАНГ ТРАНС ТОВ") приходять від API саме так.
    // Слово з однієї літери за все-велике НЕ вважаємо: ініціал "С." і самотнє "Я"
    // природніше виглядають як "S." і "Ya", а не "S." і "YA".
    function allCapsMask(s) {
        var mask = new Array(s.length);
        var i = 0;
        while (i < s.length) {
            if (!WORD_CHAR.test(s[i])) { mask[i] = false; i++; continue; }
            var j = i, hasUpper = false, hasLower = false;
            while (j < s.length && WORD_CHAR.test(s[j])) {
                var c = s[j];
                if (c !== c.toLowerCase()) hasUpper = true;
                else if (c !== c.toUpperCase()) hasLower = true;
                j++;
            }
            var all = hasUpper && !hasLower && (j - i) > 1;
            for (var k = i; k < j; k++) mask[k] = all;
            i = j;
        }
        return mask;
    }

    // Великий відповідник: у все-великому слові - увесь, інакше лише перша літера.
    function upcase(res, allCaps) {
        if (!res) return res;
        return allCaps ? res.toUpperCase() : res[0].toUpperCase() + res.slice(1);
    }

    function translit(str) {
        var s = String(str == null ? '' : str);
        var caps = allCapsMask(s);
        var out = '';
        for (var i = 0; i < s.length; i++) {
            var ch = s[i];
            var low = ch.toLowerCase();
            var upper = ch !== low;
            // Початок слова - або початок рядка, або попередній символ не "літера"
            var atStart = i === 0 || !WORD_CHAR.test(s[i - 1]);

            // Буквосполучення "зг" передається як "zgh", інакше "зг" і "ж" збіглися б в "zh"
            // (напр. "Згорани" -> "Zghorany", а не "Zhorany").
            if (low === 'з' && s[i + 1] && s[i + 1].toLowerCase() === 'г') {
                out += upper ? upcase('zgh', caps[i]) : 'zgh';
                i++;
                continue;
            }

            var res;
            if (Object.prototype.hasOwnProperty.call(POS, low)) {
                res = POS[low][atStart ? 0 : 1];
                // Форма з таблиці POS має "типовий" регістр (перша - з великої, друга -
                // з малої); підганяємо під фактичний регістр вхідної літери.
                res = upper ? upcase(res.toLowerCase(), caps[i]) : res.toLowerCase();
            } else if (Object.prototype.hasOwnProperty.call(MAP, low)) {
                res = MAP[low];
                // Капіталізується лише перша літера багатолітерного відповідника:
                // "Жовтень" -> "Zhovten", ніколи "ZHovten". Виняток - все-велике слово.
                if (upper) res = upcase(res, caps[i]);
            } else {
                out += ch;
                continue;
            }
            out += res;
        }
        return out;
    }

    if (typeof module !== 'undefined' && module.exports) module.exports = { translit: translit };
    else root.translit = translit;
})(typeof window !== 'undefined' ? window : globalThis);

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
        return { kg: parseInt(w[1], 10), each: EACH_RE.test(text) };
    }

    function dimsPhrase(dims) {
        if (!dims) return null;
        if (dims.sum) return 'total dimensions (L+W+H) up to ' + dims.sum + ' cm';
        return 'up to ' + dims.l + 'x' + dims.w + 'x' + dims.h + ' cm';
    }

    function weightPhrase(weight) {
        if (!weight) return null;
        return 'up to ' + weight.kg + ' kg' + (weight.each ? ' each' : '');
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
        var wp = weightPhrase(parseWeight(clauseText));
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

        var handMatch = beforeTail.match(HAND_LUGGAGE_RE);
        var mainPart = handMatch ? beforeTail.slice(0, handMatch.index) : beforeTail;
        var handPart = handMatch ? beforeTail.slice(handMatch.index) : null;

        var mainQty = parseQuantity(mainPart);
        var mainExtras = describe(mainPart);

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
            var handExtras = describe(handPart);
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

window.__I18N__={"app":{"status":{"loadingCities":"Loading cities...","citiesReady":"{n} cities available - choose your route","citiesFailed":"Could not load cities - check your connection","retry":"Try again"},"date":{"dow":["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],"monShort":["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],"monFull":["January","February","March","April","May","June","July","August","September","October","November","December"],"earlier":"Earlier","later":"Later","placeholder":"Choose a date"},"ac":{"recent":"Recent","popular":"Popular routes"},"search":{"differentCities":"Enter different cities","checkCities":"Check the city names or pick one from the suggestions","searching":"Searching for trips...","searchingBtn":"Searching...","findRoute":"Find a bus","error":"Error: {msg}"},"suggest":{"otherDate":"No trips on the selected date, but there are on {d}:","showOtherDate":"Show trips on {d}","noDirect":"No direct trips. Tap a nearby city to see trips:","none":"Try a different date or route, or contact the manager below.","routeForms":["trip","trips"],"km":"km"},"transfers":{"direct":"No transfers, direct trip","forms":["transfer","transfers"]},"duration":{"hour":"h","dayForms":["day","days"]},"amenities":{"wifi":{"i":"wifi","t":"Wi-Fi"},"power":{"i":"plug","t":"Power outlets"},"air":{"i":"snowflake","t":"Air conditioning"},"wc":{"i":"restroom","t":"Restroom"},"pets":{"i":"paw","t":"Pets allowed"},"gps":{"i":"location-crosshairs","t":"GPS tracking"},"seatselect":{"i":"chair","t":"Seat selection"},"addstop":{"i":"map-pin","t":"Extra stops"},"noprepayment":{"i":"hand-holding-dollar","t":"No prepayment"},"norefund":{"i":"ban","t":"Non-refundable ticket"},"pet-only-from-eu":{"i":"paw","t":"Pets - EU-bound trips only"},"starlink":{"i":"wifi","t":"Satellite internet (Starlink)"},"drinks":{"i":"cup","t":"Drinks"},"steward":{"i":"user","t":"Onboard steward"},"noAccompany":"Children {n}+ unaccompanied"},"pay":{"none":"No prepayment","groupNote":"Prepayment required for groups","partial":"Partial prepayment","full":"Full prepayment"},"results":{"amenitiesLabel":"Amenities","noneFoundTitle":"No trips found","noneFoundBody":"No trips on {date} for {dep} → {arr}.","noneFoundStatus":"No trips found","searchingSuggest":"Looking for the nearest dates and cities...","found":"{n} trips found","badge":"{n} trips","sort":"Sort:","sortPrice":"Cheapest","sortDuration":"Fastest","sortDeparture":"By departure time","filters":"Filters:","filterDirect":"No transfers","filterPets":"With a pet","filteredNoneTitle":"No trips like that","filteredNoneBody":"No trips on this route match the selected filters.<br>Turn off the filter to see all options."},"card":{"busFallback":"Bus","enRoute":"en route","direct":"no transfers","withTransfer":"with a transfer","perSeat":"per seat","free":"available","details":"Trip details","book":"Book now","order":"Order","payment":"Payment","discLabel":"Discounts","transfers":"Transfers","carrier":"Carrier","reliability":"{n}% reliability","ratingTitle":"Rating {raw} of {max}","baggage":"Baggage","collapse":"Collapse","moreBtn":"Show {n} more · {total} {word} total"},"discounts":{"unavailable":"Information unavailable","loading":"Loading...","none":"No special discounts"},"pax":{"delete":"Delete","firstName":"First name","firstNamePh":"John","lastName":"Last name","lastNamePh":"Smith","phone":"Phone","phonePh":"+1 234 567 8900","title":"Passenger #{n}","fullTicket":"Full-price ticket","discTitle":"Passenger discount","total":"Total for {n} {word}:"},"seats":{"forms":["seat","seats"],"driver":"Driver","table":"Table","taken":"Taken","auto":"Automatic","launch":"Choose seat","optional":"optional","deck":"Floor {n}","legendFree":"available","legendSel":"yours","legendTaken":"taken","chosen":"Selected: <b>{names}</b> ({n} of {need})","hint":"Tap available seats on the layout{needClause} - or leave as is and seats will be assigned automatically.","hintNeedClause":" (need {n})"},"modal":{"titleBook":"Book the trip","titleOrder":"Order the trip","groupPrepayBadge":"Prepayment for 1 ticket","groupNote":"From {thr} passengers, the carrier requires prepayment for 1 ticket. Up to {thrMinus1} - no prepayment, pay the driver."},"order":{"send":"Send","booking":"Booking...","sending":"Sending...","phoneIncomplete":"Check the phone number - it looks incomplete.","fillAllFields":"Fill in the details for all passengers.","yourSeats":"Your seats","bookedTitle":"Seats booked!","bookedTextWithTickets":"Payment - to the driver at boarding.<br>Save your tickets:","bookedTextNoTickets":"Payment - to the driver at boarding.<br>The manager will send the tickets shortly.","downloadTicket":"Download ticket","acceptedTitle":"Request accepted!","acceptedText":"The manager will contact you, confirm the details<br>and send payment details if needed.","submitError":"Could not send the request: {msg}\n\nTry again or call the manager.","copyLabel":"Copy","copiedLabel":"Copied!"},"track":{"on":"Tracking enabled: this browser is counted in site statistics again.","off":"Done: visits and searches from this browser will no longer be counted in site statistics."}},"common":{"cookieAria":"Consent to use cookies","cookieText":"We use cookies to make the site work well and to keep improving it for you. Click \"Accept\" - this helps us improve the service. More details - in the <a href=\"/cookies\">Cookie Policy</a>.","cookieAccept":"Accept","cookieMinimal":"Necessary only","scrollTop":"To top"},"booking":{"meta":{"title":"Your booking - GoodDayBus"},"pageTitle":"Your booking","loading":"Loading your booking...","notFound":"Booking not found. Check the link or message us.","labels":{"date":"Date","carrier":"Carrier","price":"Price","boarding":"Boarding","dropoff":"Drop-off","seats":"Seats"},"paxHeading":"<svg class=\"ic\" aria-hidden=\"true\"><use href=\"/_sprite.svg#i-users\"></use></svg> Passengers","ticketsHeading":"<svg class=\"ic\" aria-hidden=\"true\"><use href=\"/_sprite.svg#i-ticket\"></use></svg> Tickets","contactHeading":"<svg class=\"ic\" aria-hidden=\"true\"><use href=\"/_sprite.svg#i-headset\"></use></svg> Contact us","months":["January","February","March","April","May","June","July","August","September","October","November","December"],"paxFallback":"Passenger","seatLabel":"Seat ","downloadTicket":"Download ticket ","ticketsNote":"The manager will send the tickets shortly","statusBooked":"Seats booked - pay the driver at boarding","statusPending":"Request accepted - the manager will contact you"},"cities":{"9":"Alicante","23":"Augsburg","35":"Barcelona","38":"Salzburg","40":"Bielsko-Biala","52":"Bydgoszcz","58":"Bialystok","65":"Bologna","66":"Bolzano","72":"Bratislava","73":"Braunschweig","77":"Brescia","84":"Brussels","93":"Valencia","97":"Warsaw","102":"Venice","111":"Vienna","119":"Wloclawek","128":"Amiens","129":"Wroclaw","130":"Wuppertal","132":"Wurzburg","133":"The Hague","139":"Hamburg","140":"Hanover","142":"Gdynia","144":"Genoa","148":"Gliwice","152":"Gdansk","160":"Hradec Kralove","166":"Grudziadz","180":"Dresden","188":"Elblag","197":"Geneva","199":"Rzeszow","205":"Zabrze","208":"Zamosc","226":"Ingolstadt","232":"Kalisz","244":"Karlsruhe","251":"Katowice","257":"Kiel","274":"Copenhagen","276":"Cordoba","284":"Cottbus","285":"Koszalin","286":"Kosice","287":"Krakow","314":"Athens","318":"Legnica","319":"Leipzig","341":"Lubeck","343":"Lublin","344":"Ljubljana","345":"Lucerne","346":"Magdeburg","347":"Madrid","350":"Mainz","352":"Malaga","357":"Mantua","361":"Marijampole","362":"Marseille","372":"Cannes","380":"Murcia","381":"Munster","382":"Munich","384":"Naples","405":"Nuremberg","412":"Olomouc","414":"Olsztyn","429":"Ostrow Wielkopolski","432":"Padua","433":"Panevezys","434":"Pardubice","435":"Paris","450":"Piotrkow Trybunalski","460":"Prague","464":"Dordrecht","474":"Regensburg","475":"Reggio Emilia","477":"Riga","478":"Rome","486":"Nancy","487":"Rostock","491":"Saarbrucken","500":"Zaragoza","509":"Seville","557":"Tarnow","566":"Tychy","574":"Trieste","579":"Toulouse","593":"Utrecht","596":"Florence","598":"Freiburg","608":"Chemnitz","617":"Chorzow","629":"Czestochowa","637":"Ceske Budejovice","656":"Szczecin","671":"Bregenz","674":"Linz","678":"Villach","686":"Innsbruck","688":"Wels","709":"Brasov","720":"Dijon","762":"Antwerp","763":"Bruges","764":"Ghent","765":"Liege","796":"Sofia","812":"Dubrovnik","851":"Zagreb","860":"Cesky Krumlov","862":"Cheb","863":"Chomutov","876":"Karlovy Vary","892":"Antalya","939":"Le Havre","956":"Treviso","990":"Angers","995":"Avignon","1004":"Bordeaux","1006":"Caen","1019":"Grenoble","1024":"Le Mans","1027":"Lyon","1029":"Metz","1033":"Montpellier","1034":"Mulhouse","1035":"Nancy","1036":"Nantes","1038":"Nice","1044":"Perpignan","1057":"Strasbourg","1065":"Aachen","1078":"Bamberg","1085":"Bochum","1088":"Bremerhaven","1100":"Dusseldorf","1101":"Podgorica","1104":"Frankfurt am Main","1110":"Gelsenkirchen","1122":"Heidelberg","1130":"Mechelen","1131":"Genk","1136":"Cologne","1187":"Reggio Calabria","1203":"Stuttgart","1217":"Wiesbaden","1227":"Graz","1229":"Birmingham","1236":"Cardiff","1243":"Edinburgh","1247":"Glasgow","1255":"Leeds","1258":"Liverpool","1266":"Newcastle upon Tyne","1269":"Nottingham","1270":"Oxford","1279":"Sheffield","1281":"Southampton","1306":"Thessaloniki","1310":"Budapest","1314":"Monchengladbach","1316":"Miskolc","1318":"Nyiregyhaza","1322":"Szeged","1536":"Tirana","1543":"Gyor","1701":"Cremona","3320":"Catania","3327":"Como","3398":"Perugia","3402":"Pisa","3437":"Siena","3438":"Syracuse","3633":"Daugavpils","6011":"Luxembourg","6019":"Skopje","6024":"Balti","6043":"Chisinau","6057":"Monaco","6060":"Arnhem","6063":"Enschede","6064":"Groningen","6067":"Maastricht","6124":"Inowroclaw","6135":"Jelenia Gora","6226":"Rybnik","6232":"Siedlce","6240":"Sosnowiec","6272":"Walbrzych","6314":"Braga","6349":"Lisbon","6382":"Porto","6434":"Bucharest","6442":"Cluj-Napoca","6444":"Constanta","6456":"Galati","6461":"Iasi","6472":"Oradea","6510":"Timisoara","7450":"Belgrade","7467":"Banska Bystrica","7504":"Presov","7509":"Ruzomberok","7529":"Trencin","7537":"Zilina","8656":"Girona","8684":"Granada","8854":"A Coruna","9819":"Santiago de Compostela","9851":"Segovia","10117":"Valladolid","10233":"Vigo","10410":"Gothenburg","10425":"Malmo","10432":"Stockholm","10439":"Basel","10445":"Lausanne","10446":"Lugano","10448":"Neuchatel","10450":"St. Gallen","10454":"Zurich","10456":"Istanbul"},"geo":{"залізничний вокзал":"railway station","автостанція":"bus station","автовокзал":"bus terminal","центральний":"central","будинок":"bld.","вулиця":"Street","проспект":"Avenue","платформа":"platform","зупинка":"stop","вокзал":"station","метро":"metro","платф.":"platform","вул.":"St.","просп.":"Ave.","буд.":"bld.","ас":"bus station"}};
(function (d) {
    var specs = [
    { path: 'status.citiesReady', params: ['n'] },
    { path: 'search.error', params: ['msg'] },
    { path: 'suggest.otherDate', params: ['d'] },
    { path: 'suggest.showOtherDate', params: ['d'] },
    { path: 'amenities.noAccompany', params: ['n'] },
    { path: 'results.noneFoundBody', params: ['date', 'dep', 'arr'] },
    { path: 'results.found', params: ['n'] },
    { path: 'results.badge', params: ['n'] },
    { path: 'card.reliability', params: ['n'] },
    { path: 'card.ratingTitle', params: ['raw', 'max'] },
    { path: 'card.moreBtn', params: ['n', 'total', 'word'] },
    { path: 'pax.title', params: ['n'] },
    { path: 'pax.total', params: ['n', 'word'] },
    { path: 'seats.deck', params: ['n'] },
    { path: 'seats.chosen', params: ['names', 'n', 'need'] },
    { path: 'modal.groupNote', params: ['thr'], derived: { thrMinus1: function (a) { return a.thr - 1; } } },
    { path: 'order.submitError', params: ['msg'] }
];
    specs.forEach(function (spec) {
        var ks = spec.path.split('.'), o = d;
        for (var i = 0; i < ks.length - 1; i++) o = o[ks[i]];
        var k = ks[ks.length - 1];
        var tpl = o[k];
        o[k] = function () {
            var args = arguments, ctx = {};
            spec.params.forEach(function (p, i) { ctx[p] = args[i]; });
            if (spec.derived) Object.keys(spec.derived).forEach(function (dk) { ctx[dk] = spec.derived[dk](ctx); });
            var s = tpl;
            Object.keys(ctx).forEach(function (ck) { s = s.split('{' + ck + '}').join(ctx[ck]); });
            return s;
        };
    });
    var hintBase = d.seats.hint, hintNeed = d.seats.hintNeedClause;
    d.seats.hint = function (need) {
        var clause = need > 1 ? hintNeed.split('{n}').join(need) : '';
        return hintBase.split('{needClause}').join(clause);
    };
})(window.__I18N__.app);
