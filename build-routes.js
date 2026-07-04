// Генератор статичних сторінок маршрутів. Запуск: node build-routes.js
// 1) Мінімізує ассети: app.js/common.js/styles.css → app.min.js/common.min.js/styles.min.css
//    (сторінки посилаються на .min-версії; вихідні файли лишаються для розробки).
// 2) Бере спільні фрагменти з public/index.html (щоб не дублювати й не розходитись),
//    дані - з routes.json. Пише public/<slug>.html і оновлює public/sitemap.xml.
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, 'public');
const SITE = 'https://gooddaybus.com';

(async () => {

// --- мінімізація ассетів (terser + csso, лише devDependencies - на сервері не потрібні) ---
const rd = f => fs.readFileSync(path.join(PUB, f), 'utf8');
const wr = (f, s) => fs.writeFileSync(path.join(PUB, f), s);
const tj = async src => {
    const r = await require('terser').minify(src, { compress: true, mangle: true });
    if (r.error) throw r.error;
    return r.code;
};
const kb = s => (Buffer.byteLength(s) / 1024).toFixed(0);
const srcApp = rd('app.js'), srcCommon = rd('common.js'), srcCss = rd('styles.css');
const minApp = await tj(srcApp);
const minCommon = await tj(srcCommon);
const minCss = require('csso').minify(srcCss).css;
wr('app.min.js', minApp);
wr('common.min.js', minCommon);
wr('styles.min.css', minCss);
console.log(`Мінімізовано: app.js ${kb(srcApp)}→${kb(minApp)}КБ · common.js ${kb(srcCommon)}→${kb(minCommon)}КБ · styles.css ${kb(srcCss)}→${kb(minCss)}КБ`);

const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const routes = JSON.parse(fs.readFileSync(path.join(__dirname, 'routes.json'), 'utf8'));

// Версія ассетів = короткий хеш МІНІМІЗОВАНОГО вмісту (саме його вантажить браузер).
// Підставляємо у ?v= для скидання кешу браузера на деплої.
const ASSET_V = require('crypto').createHash('md5')
    .update(minApp).update(minCommon).update(minCss)
    .digest('hex').slice(0, 10);

const between = (s, a, b) => {
    const i = s.indexOf(a); const j = s.indexOf(b, i + a.length);
    if (i < 0 || j < 0) throw new Error(`фрагмент не знайдено: ${a} .. ${b}`);
    return s.slice(i, j);
};
const escHtml = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const escAttr = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// --- спільні фрагменти з index.html ---
const iconsFonts = between(html, '<!-- Іконки бренду', '<link rel="stylesheet" href="/styles.min.css');
const gtmHead = between(html, '<!-- GTM-HEAD START -->', '<!-- GTM-HEAD END -->') + '<!-- GTM-HEAD END -->';
const gtmBody = between(html, '<!-- GTM-BODY START -->', '<!-- GTM-BODY END -->') + '<!-- GTM-BODY END -->';
const header = between(html, '<header>', '</header>') + '</header>';
const searchWrap = between(html, '<div class="search-wrap">', '<!-- Швидкий контакт');
const quickContact = between(html, '<div class="quick-contact">', '<!-- CONTENT -->');
const footer = between(html, '<footer>', '</footer>') + '</footer>';
const modal = between(html, '<!-- MODAL -->', '<script src="/common.min.js');
const contactSection = between(html, '<section class="contact-section">', '</main>'); // блок менеджера з головної

function pageHtml(r) {
    const url = `${SITE}/${r.slug}`;
    const faqSchema = {
        '@context': 'https://schema.org', '@type': 'FAQPage',
        mainEntity: r.faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } }))
    };
    const faqHtml = r.faq.map(f => `        <details class="faq-item"><summary>${escHtml(f.q)}</summary><div class="faq-a">${escHtml(f.a)}</div></details>`).join('\n');
    const cfg = JSON.stringify({ fromId: r.fromId, toId: r.toId, fromName: r.fromName, toName: r.toName, slug: r.slug });
    const rev = routes.find(x => String(x.fromId) === String(r.toId) && String(x.toId) === String(r.fromId));
    const reverseLink = rev
        ? `\n    <a class="route-reverse-link" href="/${rev.slug}"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-arrow-right-arrow-left"></use></svg> Потрібен зворотний маршрут? ${escHtml(rev.fromName)} - ${escHtml(rev.toName)}</a>`
        : '';

    return `<!DOCTYPE html>
<html lang="uk">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${gtmHead}
    <meta name="robots" content="index, follow, max-image-preview:none">
    <title>${escAttr(r.title)}</title>
    <meta name="description" content="${escAttr(r.desc)}">
    <link rel="canonical" href="${url}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="GoodDayBus">
    <meta property="og:title" content="${escAttr(r.title)}">
    <meta property="og:description" content="${escAttr(r.desc)}">
    <meta property="og:url" content="${url}">
    <meta property="og:image" content="${SITE}/og-image.jpg">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:locale" content="uk_UA">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escAttr(r.title)}">
    <meta name="twitter:description" content="${escAttr(r.desc)}">
    <meta name="twitter:image" content="${SITE}/og-image.jpg">
    <script type="application/ld+json">
${JSON.stringify(faqSchema, null, 2)}
    </script>
    ${iconsFonts.trim()}
    <link rel="stylesheet" href="/styles.min.css?v=${ASSET_V}">
</head>
<body>
${gtmBody}

${header}
<main>

<section class="hero route-hero">
    <h1>Автобус <span class="accent">${escHtml(r.fromName)} - ${escHtml(r.toName)}</span></h1>
    <p>${escHtml(r.subtitle)}</p>${reverseLink}
</section>

${searchWrap}
<div id="date-strip" class="date-strip"></div>

${quickContact}
<div class="content">
    <div id="results"></div>
</div>

<section class="route-intro">
    <h2>${escHtml(r.intro.heading)}</h2>
    <p>${escHtml(r.intro.text)}</p>
</section>

<section class="seo-section faq-wrap" style="padding-bottom:0">
    <h2>Часті <em>запитання</em></h2>
</section>
<section class="faq-section">
${faqHtml}
</section>

${contactSection}
</main>

${footer}

${modal}
<script>window.__ROUTE__ = ${cfg};</script>
<script src="/common.min.js?v=${ASSET_V}"></script>
<script src="/app.min.js?v=${ASSET_V}"></script>
</body>
</html>
`;
}

let made = [];
for (const r of routes) {
    fs.writeFileSync(path.join(PUB, `${r.slug}.html`), pageHtml(r));
    made.push(r.slug);
}

// --- sitemap: головна + FAQ + усі сторінки маршрутів ---
const urls = ['', 'faq', ...routes.map(r => r.slug)];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${SITE}/${u}</loc>
    <changefreq>weekly</changefreq>
    <priority>${u === '' ? '1.0' : '0.8'}</priority>
  </url>`).join('\n')}
</urlset>
`;
fs.writeFileSync(path.join(PUB, 'sitemap.xml'), sitemap);

// --- llms.txt: короткий опис сайту для AI/LLM (маршрути синхронні з routes.json) ---
const llms = `# GoodDayBus

> GoodDayBus - інформаційний онлайн-агрегатор для бронювання квитків на автобуси з України до Європи. Це не перевізник: сервіс збирає рейси перевірених перевізників, щоб порівняти ціни, час і зупинки та забронювати місце за хвилину без реєстрації. На більшості рейсів передоплата не потрібна - оплата водієві при посадці.

## Основне
- Що це: агрегатор бронювання автобусних квитків Україна - Європа (не перевізник, не власний автопарк)
- Оплата: на більшості рейсів без передоплати, водієві при посадці; на окремих рейсах - передоплата за реквізитами менеджера
- Бронювання: без реєстрації, близько хвилини
- Підтримка: щодня 7:00-23:00 - Telegram https://t.me/gooddaybus, Viber, WhatsApp, телефон +38 (096) 765-67-32

## Сторінки
- [Головна - пошук і бронювання рейсів](${SITE}/)
- [Питання й відповіді (FAQ)](${SITE}/faq)
- [Умови користування](${SITE}/terms)
- [Політика конфіденційності](${SITE}/privacy)
- [Скасування та повернення](${SITE}/refund)

## Маршрути
${routes.map(r => `- [${r.fromName} - ${r.toName}](${SITE}/${r.slug})`).join('\n')}
`;
fs.writeFileSync(path.join(PUB, 'llms.txt'), llms);

// --- версіонуємо посилання на ассети в index.html (head-стилі + скрипт у кінці) ---
const idxPath = path.join(PUB, 'index.html');
const idxStamped = fs.readFileSync(idxPath, 'utf8')
    .replace(/\/styles\.min\.css(\?v=[a-z0-9]+)?/g, `/styles.min.css?v=${ASSET_V}`)
    .replace(/\/common\.min\.js(\?v=[a-z0-9]+)?/g, `/common.min.js?v=${ASSET_V}`)
    .replace(/\/app\.min\.js(\?v=[a-z0-9]+)?/g, `/app.min.js?v=${ASSET_V}`);
fs.writeFileSync(idxPath, idxStamped);

// --- faq.html - ручна сторінка, лише версіонуємо посилання на ассети ---
const faqPath = path.join(PUB, 'faq.html');
if (fs.existsSync(faqPath)) {
    fs.writeFileSync(faqPath, fs.readFileSync(faqPath, 'utf8')
        .replace(/\/styles\.min\.css(\?v=[a-z0-9]+)?/g, `/styles.min.css?v=${ASSET_V}`)
        .replace(/\/common\.min\.js(\?v=[a-z0-9]+)?/g, `/common.min.js?v=${ASSET_V}`));
}

console.log(`Згенеровано сторінок: ${made.length} (${made.join(', ')})`);
console.log(`Sitemap оновлено: ${urls.length} URL`);
console.log(`Версія ассетів (?v=): ${ASSET_V}`);

// Юридичні сторінки (terms/privacy/refund/cookies) з legal/*.md
require('./build-legal.js');

})().catch(e => { console.error('[Build] Помилка:', e.message); process.exit(1); });
