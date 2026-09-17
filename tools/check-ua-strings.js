// tools/check-ua-strings.js
// Сверяет украинские строковые литералы в public/app.js между двумя git-ревизиями.
// Рефакторинг переносит литералы в словарь T - мультимножество (строка -> сколько раз
// она встречается) обязано остаться тем же: относиться (не пропадать, не меняться).
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

const beforeList = extractLiterals(execSync(`git show ${rev}:public/app.js`, { encoding: 'utf8' }));
const afterList = extractLiterals(fs.readFileSync('public/app.js', 'utf8'));

const beforeCounts = countOf(beforeList);
const afterCounts = countOf(afterList);

const allKeys = new Set([...beforeCounts.keys(), ...afterCounts.keys()]);
const reduced = []; // count went down (partially or fully lost)
const increased = []; // count went up (new or duplicated)
for (const key of allKeys) {
    const b = beforeCounts.get(key) || 0;
    const a = afterCounts.get(key) || 0;
    if (a < b) reduced.push({ key, b, a });
    else if (a > b) increased.push({ key, b, a });
}
reduced.sort((x, y) => x.key.localeCompare(y.key));
increased.sort((x, y) => x.key.localeCompare(y.key));

console.log(`${rev}: ${beforeList.length} литералов (${beforeCounts.size} уникальных), рабочая копия: ${afterList.length} (${afterCounts.size} уникальных)`);

if (reduced.length) {
    console.log('ПРОПАЛИ (количество уменьшилось или строка исчезла):');
    for (const { key, b, a } of reduced) {
        console.log(`  "${key}": было ${b}, стало ${a} (${a - b})`);
    }
}
if (increased.length) {
    console.log('ПОЯВИЛИСЬ (количество увеличилось или строка новая):');
    for (const { key, b, a } of increased) {
        console.log(`  "${key}": было ${b}, стало ${a} (+${a - b})`);
    }
}
if (!reduced.length && !increased.length) console.log('OK: мультимножество строк не изменилось');

process.exit(reduced.length || increased.length ? 1 : 0);
