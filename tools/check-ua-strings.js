// tools/check-ua-strings.js
// Сверяет украинский ТЕКСТ в public/app.js между двумя git-ревизиями.
// Рефакторинг переносит строковые литералы в словарь T, и HTML-кусок вида
// ' aria-label="Пізніше">...' на глазах превращается в отдельный литерал "Пізніше" -
// литерал целиком меняется, а слово остаётся ровно тем же и там же. Поэтому
// вердикт считается на уровне украинских СЛОВ (мультимножество слов, извлечённых
// из всех литералов), а не на уровне целых литералов: слово, просто переехавшее
// из HTML-обвязки в словарь, не должно шуметь, а слово, которое исчезло,
// изменилось или задублировалось - обязано.
// Сравнение целых литералов (как раньше) остаётся - выводится как доп. детали,
// когда есть реальная словесная проблема, чтобы было видно, откуда она взялась.
// На вердикт и exit code детали по литералам не влияют.
// Строки внутри backtick-шаблонов тоже считаются - статические куски текста извлекаются,
// а ${...}-интерполяции игнорируются (переименование переменной внутри ${} - не изменение текста).
// Запуск: node tools/check-ua-strings.js HEAD
const { execSync } = require('child_process');
const fs = require('fs');

const rev = process.argv[2] || 'HEAD';
const cyr = /[А-Яа-яІіЇїЄєҐґ]/;

// Мини-лексер (не полноценный JS-парсер): один проход по символам, который умеет отличать
// строки/шаблоны/комментарии/regex друг от друга, чтобы:
//  - "//" и "/* */" внутри строкового литерала (например URL) не резали его текст (Finding 3);
//  - backtick-шаблоны разбирались посегментно, а ${...} пропускались как код (Finding 1);
//  - regex-литералы (например /['’ʼ]/g) не путались со строками из-за кавычек внутри них.
function extractLiterals(src) {
    src = src.replace(/\r\n/g, '\n');
    const n = src.length;
    const out = [];
    let i = 0;
    // lastSig: последний значимый символ кода - нужен только для того, чтобы отличить
    // regex-литерал от деления ("/"). После значения (идентификатор, число, ")", "]",
    // либо конец строки/шаблона/regex) следующий "/" - деление; иначе - начало regex.
    let lastSig = '';
    const isValueEnd = ch => /[A-Za-z0-9_$)\]]/.test(ch);

    function push(body) {
        if (cyr.test(body)) out.push(body);
    }

    function skipLineComment() {
        while (i < n && src[i] !== '\n') i++;
    }

    function skipBlockComment() {
        i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
        i += 2;
    }

    function scanQuoted(quote) {
        let body = '';
        i++;
        while (i < n) {
            const c = src[i];
            if (c === '\\') { body += c + (src[i + 1] || ''); i += 2; continue; }
            if (c === quote) { i++; break; }
            if (c === '\n') break; // непарная кавычка - не настоящий JS, дальше не тянем
            body += c; i++;
        }
        push(body);
        lastSig = ')'; // строка - это значение
    }

    function scanRegex() {
        i++;
        let inClass = false;
        while (i < n) {
            const c = src[i];
            if (c === '\\') { i += 2; continue; }
            if (c === '[') { inClass = true; i++; continue; }
            if (c === ']') { inClass = false; i++; continue; }
            if (c === '/' && !inClass) { i++; break; }
            if (c === '\n') break;
            i++;
        }
        while (i < n && /[a-z]/i.test(src[i])) i++; // флаги regex
        lastSig = ')';
    }

    function scanTemplate() {
        i++;
        let seg = '';
        while (i < n) {
            const c = src[i];
            if (c === '\\') { seg += c + (src[i + 1] || ''); i += 2; continue; }
            if (c === '`') { i++; break; }
            if (c === '$' && src[i + 1] === '{') {
                push(seg); seg = '';
                i += 2;
                scanInterpolation();
                continue;
            }
            seg += c; i++;
        }
        push(seg);
        lastSig = ')';
    }

    // Разбирает код внутри ${...} до соответствующей закрывающей "}", учитывая вложенные
    // фигурные скобки (объектные литералы), строки, шаблоны, комментарии и regex - но не
    // строит AST, просто пропускает всё это как код и не извлекает из него текст.
    function scanInterpolation() {
        let depth = 1;
        while (i < n && depth > 0) {
            const c = src[i];
            if (c === '/' && src[i + 1] === '/') { skipLineComment(); continue; }
            if (c === '/' && src[i + 1] === '*') { skipBlockComment(); continue; }
            if (c === "'" || c === '"') { scanQuoted(c); continue; }
            if (c === '`') { scanTemplate(); continue; }
            if (c === '/' && !isValueEnd(lastSig)) { scanRegex(); continue; }
            if (c === '{') { depth++; lastSig = c; i++; continue; }
            if (c === '}') { depth--; lastSig = c; i++; continue; }
            if (!/\s/.test(c)) lastSig = c;
            i++;
        }
    }

    while (i < n) {
        const c = src[i];
        if (c === '/' && src[i + 1] === '/') { skipLineComment(); continue; }
        if (c === '/' && src[i + 1] === '*') { skipBlockComment(); continue; }
        if (c === "'" || c === '"') { scanQuoted(c); continue; }
        if (c === '`') { scanTemplate(); continue; }
        if (c === '/' && !isValueEnd(lastSig)) { scanRegex(); continue; }
        if (!/\s/.test(c)) lastSig = c;
        i++;
    }

    return out;
}

function countOf(list) {
    const m = new Map();
    for (const s of list) m.set(s, (m.get(s) || 0) + 1);
    return m;
}

// Извлекает украинские слова из тела литерала, отбрасывая HTML/атрибуты/пунктуацию.
// Апостроф (в трёх начертаниях) и дефис держат слово вместе ("п'ять", "давай-но"),
// но не цепляют соседние латинские/цифровые куски (aria-label, id и т.п.).
const wordRe = /[А-Яа-яІіЇїЄєҐґ]+(?:['’ʼ-][А-Яа-яІіЇїЄєҐґ]+)*/g;
function extractWords(literals) {
    const words = [];
    for (const body of literals) {
        const matches = body.match(wordRe);
        if (matches) words.push(...matches);
    }
    return words;
}

// Общая мультимножественная разница: что уменьшилось/пропало и что увеличилось/появилось.
function diffCounts(beforeCounts, afterCounts) {
    const allKeys = new Set([...beforeCounts.keys(), ...afterCounts.keys()]);
    const reduced = [];
    const increased = [];
    for (const key of allKeys) {
        const b = beforeCounts.get(key) || 0;
        const a = afterCounts.get(key) || 0;
        if (a < b) reduced.push({ key, b, a });
        else if (a > b) increased.push({ key, b, a });
    }
    reduced.sort((x, y) => x.key.localeCompare(y.key));
    increased.sort((x, y) => x.key.localeCompare(y.key));
    return { reduced, increased };
}

function printDiff({ reduced, increased }, lostLabel, gainedLabel) {
    if (reduced.length) {
        console.log(lostLabel);
        for (const { key, b, a } of reduced) console.log(`  "${key}": было ${b}, стало ${a} (${a - b})`);
    }
    if (increased.length) {
        console.log(gainedLabel);
        for (const { key, b, a } of increased) console.log(`  "${key}": было ${b}, стало ${a} (+${a - b})`);
    }
}

const beforeList = extractLiterals(execSync(`git show ${rev}:public/app.js`, { encoding: 'utf8' }));
const afterList = extractLiterals(fs.readFileSync('public/app.js', 'utf8'));

// Главная (вердиктная) мера - украинские слова, а не целые литералы.
const beforeWords = extractWords(beforeList);
const afterWords = extractWords(afterList);
const wordDiff = diffCounts(countOf(beforeWords), countOf(afterWords));
const wordsClean = !wordDiff.reduced.length && !wordDiff.increased.length;

console.log(`${rev}: слов ${beforeWords.length} -> ${afterWords.length}, литералов ${beforeList.length} -> ${afterList.length}`);
console.log(wordsClean
    ? 'ВЕРДИКТ: OK - безопасно продолжать (украинские слова не пропали, не изменились, не задублировались)'
    : 'ВЕРДИКТ: ПРОБЛЕМА - есть реальные расхождения по украинским словам, смотри ниже');

if (!wordsClean) {
    printDiff(wordDiff,
        'СЛОВА ПРОПАЛИ (количество уменьшилось или слово исчезло):',
        'СЛОВА ПОЯВИЛИСЬ (количество увеличилось или слово новое/задублировалось):');

    // Доп. детали по целым литералам - только чтобы объяснить словесную проблему выше.
    // На вердикт и exit code не влияет. Показываем только литералы, которые содержат
    // хотя бы одно из проблемных слов - иначе сюда попадёт весь шум от чисто
    // косметических переносов текста между литералами (см. Finding 1 в отчёте задачи 1).
    const flagged = [...wordDiff.reduced, ...wordDiff.increased].map(e => e.key);
    const literalDiff = diffCounts(countOf(beforeList), countOf(afterList));
    const relevant = entries => entries.filter(({ key }) => flagged.some(w => key.includes(w)));
    const literalDetail = { reduced: relevant(literalDiff.reduced), increased: relevant(literalDiff.increased) };
    if (literalDetail.reduced.length || literalDetail.increased.length) {
        console.log('--- детали по литералам (только для объяснения, на вердикт не влияет) ---');
        printDiff(literalDetail, 'ЛИТЕРАЛЫ ПРОПАЛИ:', 'ЛИТЕРАЛЫ ПОЯВИЛИСЬ:');
    }
}

process.exit(wordsClean ? 0 : 1);
