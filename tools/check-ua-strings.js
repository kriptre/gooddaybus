// tools/check-ua-strings.js
// Сверяет НАБОР украинских строковых литералов в public/app.js между двумя git-ревизиями.
// Рефакторинг переносит литералы в словарь T - набор обязан остаться тем же.
// Запуск: node tools/check-ua-strings.js HEAD
const { execSync } = require('child_process');
const fs = require('fs');

const rev = process.argv[2] || 'HEAD';
const cyr = /[А-Яа-яІіЇїЄєҐґ]/;

function literals(src) {
    const out = [];
    for (const line of src.split(/\r?\n/)) {
        const code = line.replace(/\/\/.*$/, '');
        const m = code.match(/'[^']*'|"[^"]*"/g) || [];
        for (const lit of m) {
            const body = lit.slice(1, -1);
            if (cyr.test(body)) out.push(body);
        }
    }
    return out.sort();
}

const before = literals(execSync(`git show ${rev}:public/app.js`, { encoding: 'utf8' }));
const after = literals(fs.readFileSync('public/app.js', 'utf8'));

const missing = before.filter(s => !after.includes(s));
const added = after.filter(s => !before.includes(s));

console.log(`${rev}: ${before.length} литералов, рабочая копия: ${after.length}`);
if (missing.length) console.log('ПРОПАЛИ:\n  ' + missing.join('\n  '));
if (added.length) console.log('ПОЯВИЛИСЬ:\n  ' + added.join('\n  '));
if (!missing.length && !added.length) console.log('OK: набор строк не изменился');
process.exit(missing.length || added.length ? 1 : 0);
