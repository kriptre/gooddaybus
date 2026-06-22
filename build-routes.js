// Генератор статичних сторінок маршрутів. Запуск: node build-routes.js
// Бере спільні фрагменти з public/index.html (щоб не дублювати й не розходитись),
// дані - з routes.json. Пише public/<slug>.html і оновлює public/sitemap.xml.
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, 'public');
const SITE = 'https://gooddaybus.com';
const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const routes = JSON.parse(fs.readFileSync(path.join(__dirname, 'routes.json'), 'utf8'));

const between = (s, a, b) => {
    const i = s.indexOf(a); const j = s.indexOf(b, i + a.length);
    if (i < 0 || j < 0) throw new Error(`фрагмент не знайдено: ${a} .. ${b}`);
    return s.slice(i, j);
};
const escHtml = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const escAttr = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// --- спільні фрагменти з index.html ---
const gtag = between(html, '<!-- Google tag (gtag.js) - Google Analytics -->', '<meta name="google-site-verification"');
const iconsFonts = between(html, '<!-- Іконки бренду', '<link rel="stylesheet" href="/styles.css">');
const header = between(html, '<header>', '</header>') + '</header>';
const searchWrap = between(html, '<div class="search-wrap">', '<!-- Швидкий контакт');
const quickContact = between(html, '<div class="quick-contact">', '<!-- CONTENT -->');
const footer = between(html, '<footer>', '</footer>') + '</footer>';
const modal = between(html, '<!-- MODAL -->', '<script src="/app.js"></script>');
const contactSection = between(html, '<section class="contact-section">', '</main>'); // блок менеджера з головної

function pageHtml(r) {
    const url = `${SITE}/${r.slug}`;
    const faqSchema = {
        '@context': 'https://schema.org', '@type': 'FAQPage',
        mainEntity: r.faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } }))
    };
    const faqHtml = r.faq.map(f => `        <details class="faq-item"><summary>${escHtml(f.q)}</summary><div class="faq-a">${escHtml(f.a)}</div></details>`).join('\n');
    const cfg = JSON.stringify({ fromId: r.fromId, toId: r.toId, fromName: r.fromName, toName: r.toName, slug: r.slug });

    return `<!DOCTYPE html>
<html lang="uk">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${gtag.trim()}
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
    <link rel="stylesheet" href="/styles.css">
</head>
<body>

${header}
<main>

<section class="hero route-hero">
    <h1>Автобус <span class="accent">${escHtml(r.fromName)} - ${escHtml(r.toName)}</span></h1>
    <p>${escHtml(r.subtitle)}</p>
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
    <div class="seo-eyebrow">Поширені запитання</div>
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
<script src="/app.js"></script>
</body>
</html>
`;
}

let made = [];
for (const r of routes) {
    fs.writeFileSync(path.join(PUB, `${r.slug}.html`), pageHtml(r));
    made.push(r.slug);
}

// --- sitemap: головна + усі сторінки маршрутів ---
const urls = ['', ...routes.map(r => r.slug)];
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

console.log(`Згенеровано сторінок: ${made.length} (${made.join(', ')})`);
console.log(`Sitemap оновлено: ${urls.length} URL`);
