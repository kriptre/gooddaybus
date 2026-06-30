// Генерує юридичні сторінки з legal/*.md у public/*.html (шапка/футер сайта + common.js).
// Викликається з build-routes.js (require наприкінці), також працює окремо: node build-legal.js
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, 'public');
const SITE = 'https://gooddaybus.com';
const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');

const ASSET_V = require('crypto').createHash('md5')
    .update(fs.readFileSync(path.join(PUB, 'app.js')))
    .update(fs.readFileSync(path.join(PUB, 'common.js')))
    .update(fs.readFileSync(path.join(PUB, 'styles.css')))
    .digest('hex').slice(0, 10);

const between = (s, a, b) => {
    const i = s.indexOf(a); const j = s.indexOf(b, i + a.length);
    if (i < 0 || j < 0) throw new Error(`фрагмент не знайдено: ${a} .. ${b}`);
    return s.slice(i, j);
};
const iconsFonts = between(html, '<!-- Іконки бренду', '<link rel="stylesheet" href="/styles.css');
const gtmHead = between(html, '<!-- GTM-HEAD START -->', '<!-- GTM-HEAD END -->') + '<!-- GTM-HEAD END -->';
const gtmBody = between(html, '<!-- GTM-BODY START -->', '<!-- GTM-BODY END -->') + '<!-- GTM-BODY END -->';
const header = between(html, '<header>', '</header>') + '</header>';
const footer = between(html, '<footer>', '</footer>') + '</footer>';

// --- мінімальний Markdown -> HTML (під підмножину, що використовується в legal/*.md) ---
function mdToHtml(md) {
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const inline = s => esc(s)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    const lines = md.replace(/\r\n/g, '\n').split('\n');
    let out = '', i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) { i++; continue; }
        if (/^---+\s*$/.test(line)) { out += '<hr>\n'; i++; continue; }
        const h = line.match(/^(#{1,6})\s+(.*)$/);
        if (h) { out += `<h${h[1].length}>${inline(h[2].trim())}</h${h[1].length}>\n`; i++; continue; }
        if (/^>\s?/.test(line)) {
            const buf = [];
            while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
            out += `<blockquote>${inline(buf.join(' '))}</blockquote>\n`; continue;
        }
        if (/^\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
            const row = r => r.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
            const head = row(line); i += 2;
            const body = [];
            while (i < lines.length && /^\|/.test(lines[i])) { body.push(row(lines[i])); i++; }
            out += '<table><thead><tr>' + head.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>'
                + body.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('')
                + '</tbody></table>\n'; continue;
        }
        if (/^[-*]\s+/.test(line)) {
            const items = [];
            while (i < lines.length && /^[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^[-*]\s+/, '')); i++; }
            out += '<ul>' + items.map(it => `<li>${inline(it)}</li>`).join('') + '</ul>\n'; continue;
        }
        const buf = [line]; i++;
        while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|>|\||[-*]\s|---+\s*$)/.test(lines[i])) { buf.push(lines[i]); i++; }
        out += `<p>${inline(buf.join(' '))}</p>\n`;
    }
    return out;
}

const DOCS = [
    { slug: 'terms', file: 'terms.md', title: 'Умови користування - GoodDayBus', desc: 'Умови користування сервісом GoodDayBus: роль агрегатора, моделі бронювання та розподіл відповідальності.' },
    { slug: 'privacy', file: 'privacy.md', title: 'Політика конфіденційності - GoodDayBus', desc: 'Які дані збирає GoodDayBus, кому передає та ваші права за GDPR. Платіжні дані ми не зберігаємо.' },
    { slug: 'refund', file: 'refund.md', title: 'Скасування та повернення - GoodDayBus', desc: 'Як скасувати бронювання та як відбувається повернення коштів для рейсів без передоплати та з передоплатою.' },
    { slug: 'cookies', file: 'cookies.md', title: 'Політика щодо cookie - GoodDayBus', desc: 'Які файли cookie використовує GoodDayBus та як ними керувати. Аналітика - лише за вашою згодою.' }
];

const escAttr = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let made = [];
for (const d of DOCS) {
    const md = fs.readFileSync(path.join(__dirname, 'legal', d.file), 'utf8');
    const page = `<!DOCTYPE html>
<html lang="uk">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${gtmHead}
    <meta name="robots" content="noindex, follow">
    <title>${escAttr(d.title)}</title>
    <meta name="description" content="${escAttr(d.desc)}">
    <link rel="canonical" href="${SITE}/${d.slug}">
    ${iconsFonts.trim()}
    <link rel="stylesheet" href="/styles.css?v=${ASSET_V}">
</head>
<body>
${gtmBody}

${header}
<main class="legal">
    <div class="legal-wrap">
${mdToHtml(md)}
    </div>
</main>

${footer}

<script src="/common.js?v=${ASSET_V}"></script>
</body>
</html>
`;
    fs.writeFileSync(path.join(PUB, `${d.slug}.html`), page);
    made.push(d.slug);
}
console.log(`Юридичні сторінки: ${made.length} (${made.join(', ')})`);
