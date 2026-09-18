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
