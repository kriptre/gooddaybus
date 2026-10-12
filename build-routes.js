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
// Запис із повтором: на Windows антивірус на мить блокує щойно створений .html, і запис
// падає з UNKNOWN/EBUSY/EPERM - на ~200 сторінках це трапляється майже кожну збірку.
const writeRetry = (file, data) => {
    for (let i = 0; ; i++) {
        try { return fs.writeFileSync(file, data); }
        catch (e) {
            if (i >= 5 || !['UNKNOWN', 'EBUSY', 'EPERM'].includes(e.code)) throw e;
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100 * (i + 1));
        }
    }
};
const wr = (f, s) => writeRetry(path.join(PUB, f), s);
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
const { translit } = require('./i18n/translit.js');

// Сторінки маршрутів: data/route-pages.json - список хвилі разом із фактами про рейси
// (tools/select-routes.js відбирає, tools/discover-routes.js --refresh оновлює). routes.json - ручні
// записи перших 12 сторінок: звідти беремо slug (URL уже в індексі) і запасний текст, якщо даних немає.
const readJson = f => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));
const manualRoutes = readJson('routes.json');
const wave = fs.existsSync(path.join(__dirname, 'data', 'route-pages.json'))
    ? readJson('data/route-pages.json')
    : manualRoutes.map(r => ({ fromId: r.fromId, toId: r.toId }));
const pairKey = (a, b) => `${a}|${b}`;
const manualByKey = new Map(manualRoutes.map(r => [pairKey(r.fromId, r.toId), r]));
const slugify = name => translit(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const routes = wave.map(w => {
    const k = pairKey(w.fromId, w.toId);
    const m = manualByKey.get(k), d = w.n > 0 ? w : null;
    if (!m && !d) throw new Error(`маршрут ${k} без даних: ні в routes.json, ні в data/route-pages.json`);
    const fromName = m ? m.fromName : d.fromName, toName = m ? m.toName : d.toName;
    return { fromId: w.fromId, toId: w.toId, fromName, toName,
        slug: m ? m.slug : `${slugify(fromName)}-${slugify(toName)}`, manual: m, data: d };
});
const dupSlug = routes.map(r => r.slug).find((x, i, a) => a.indexOf(x) !== i);
if (dupSlug) throw new Error(`дубль slug: ${dupSlug}`);

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

// --- форматування фактів для тексту сторінки ---
const nbsp = ' ';
const CUR = { UAH: 'грн', PLN: 'zł', EUR: '€', CZK: 'Kč', HUF: 'Ft', RON: 'lei', MDL: 'лей', BGN: 'лв', CHF: 'CHF', GBP: '£', DKK: 'kr', SEK: 'kr', NOK: 'kr' };
const money = (v, cur) => `${String(Math.ceil(v)).replace(/\B(?=(\d{3})+(?!\d))/g, nbsp)}${nbsp}${CUR[cur] || cur}`;
const hours = sec => {
    const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return m ? `${h}${nbsp}год ${m}${nbsp}хв` : `${h}${nbsp}год`;
};
// 1 рейс, 2-4 рейси, 5+ рейсів (11-14 - завжди "рейсів")
const plural = (n, one, few, many) => {
    const t = n % 100, u = n % 10;
    return `${n}${nbsp}${t >= 11 && t <= 14 ? many : u === 1 ? one : u >= 2 && u <= 4 ? few : many}`;
};
// Родовий відмінок після "від": від 1/21 перевізника, від 2/5/11 перевізників
const genCount = (n, one, many) => `${n}${nbsp}${n % 10 === 1 && n % 100 !== 11 ? one : many}`;
const listUa = arr => arr.length < 2 ? arr.join('') : `${arr.slice(0, -1).join(', ')} та ${arr[arr.length - 1]}`;
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// "Варшава, Автовокзал "Варшава-Заходня", ..." -> без назви міста на початку; дублі (різне написання) прибираємо
function cleanStations(list, city) {
    const seen = new Set(), out = [];
    for (const raw of list || []) {
        const s = raw.replace(new RegExp(`^${reEsc(city)},\\s*`), '').replace(/\s+/g, ' ').trim();
        const key = (s.match(/"([^"]+)"/) || [, s])[1].toLowerCase().slice(0, 18);
        if (!s || seen.has(key)) continue;
        seen.add(key); out.push(s);
        if (out.length === 3) break;
    }
    return out;
}
// Країна призначення в родовому відмінку - для відповіді про документи
const COUNTRY_GEN = { PL: 'Польщі', DE: 'Німеччини', CZ: 'Чехії', AT: 'Австрії', SK: 'Словаччини', HU: 'Угорщини',
    IT: 'Італії', FR: 'Франції', BE: 'Бельгії', NL: 'Нідерландів', ES: 'Іспанії', PT: 'Португалії', DK: 'Данії',
    SE: 'Швеції', NO: 'Норвегії', FI: 'Фінляндії', LT: 'Литви', LV: 'Латвії', EE: 'Естонії', RO: 'Румунії',
    MD: 'Молдови', BG: 'Болгарії', GR: 'Греції', CH: 'Швейцарії', LU: 'Люксембургу', GB: 'Великої Британії',
    TR: 'Туреччини', RS: 'Сербії', HR: 'Хорватії', SI: 'Словенії', GE: 'Грузії', UA: 'України' };
const ddmm = iso => { const d = new Date(iso); return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`; };

// Усі тексти сторінки - з даних розвідки; без даних - запасний ручний текст із routes.json
function routeContent(r) {
    const d = r.data, A = r.fromName, B = r.toName;
    if (!d) {
        const m = r.manual;
        return { title: m.title, desc: m.desc, subtitle: m.subtitle, introHeading: m.intro.heading, introText: m.intro.text, facts: [], factsNote: '', faq: m.faq };
    }
    const price = money(d.minPrice, d.currency);
    const fastest = hours(d.minTravel);
    const directFaster = d.nDirect && d.minTravelDirect && d.minTravelDirect !== d.minTravel;
    const rides = plural(d.n, 'рейс', 'рейси', 'рейсів');
    const carriersFrom = genCount(d.nCarriers, 'перевізника', 'перевізників');
    const fromSt = cleanStations(d.fromStations, A), toSt = cleanStations(d.toStations, B);
    const carriers = d.carriers.slice(0, 5);
    const moreCarriers = d.nCarriers - carriers.length;
    const transfers = d.transferCities.filter(c => c && c.length < 30 && !/[«"]/.test(c) && c !== A && c !== B).slice(0, 3);
    const noPrepayMost = d.prepayShare < 0.5;
    const intl = d.fromCountry !== d.toCountry;
    const dest = COUNTRY_GEN[d.toCountry];

    const directLine = d.nDirect
        ? (d.nDirect === d.n ? 'усі прямі' : `з них прямих - ${d.nDirect}`)
        : 'лише з пересадкою';
    const title = `Автобус ${A} - ${B}: квитки від ${price}, без передоплати | GoodDayBus`;
    const desc = `Квитки на автобус ${A} - ${B}: ${rides} на день від ${carriersFrom}, ціна від ${price}, у дорозі від ${fastest}. Бронювання за хвилину без реєстрації${noPrepayMost ? ', на більшості рейсів без передоплати' : ''}.`;

    const facts = [
        ['Ціна квитка', `від ${price}`],
        ['Час у дорозі', directFaster ? `від ${fastest} (прямим рейсом від ${hours(d.minTravelDirect)})` : `від ${fastest}`],
        ['Рейсів на день', `${d.n} (${directLine})`],
        ['Перевізники', moreCarriers > 0 ? `${carriers.join(', ')} та ще ${moreCarriers}` : listUa(carriers)],
        [d.nDirect ? 'Відправлення прямих рейсів' : 'Відправлення', d.departures.slice(0, 14).join(', ') + (d.departures.length > 14 ? '…' : '')],
        fromSt.length && [`Звідки (${A})`, fromSt.join('; ')],
        toSt.length && [`Куди (${B})`, toSt.join('; ')],
        transfers.length && d.nDirect < d.n && ['Пересадки', transfers.join(', ')],
        ['Передоплата', noPrepayMost ? 'на більшості рейсів не потрібна - оплата водієві' : 'на частині рейсів потрібна - позначено в деталях рейсу'],
    ].filter(Boolean);
    const factsNote = `Дані з розкладу перевізників на ${d.probedDate} (оновлено ${ddmm(d.updated)}). Ціни й рейси на вашу дату - у пошуку вище.`;

    const introText = [
        `На день між містами ${A} і ${B} доступно ${rides} від ${carriersFrom}${d.nDirect ? (d.nDirect === d.n ? ', усі прямі' : `, з них прямих - ${d.nDirect}`) : ', усі з пересадкою'}.`,
        `Найшвидший рейс долає дорогу за ${fastest}, найдешевший квиток коштує від ${price}.`,
        transfers.length && d.nDirect < d.n ? `Рейси з пересадкою зазвичай ідуть через ${listUa(transfers)}.` : '',
        `На GoodDayBus можна порівняти всі рейси за часом, ціною та зупинками і забронювати місце за хвилину без реєстрації${noPrepayMost ? ' - на більшості рейсів оплата водієві при посадці' : ''}.`,
        intl ? 'Перетин кордону може додати кілька годин - закладайте запас часу.' : ''
    ].filter(Boolean).join(' ');

    const faq = [
        { q: `Скільки коштує квиток на автобус ${A} - ${B}?`,
          a: `Квиток коштує від ${price}. Ціна залежить від дати, перевізника та типу рейсу; на багатьох рейсах діють знижки для дітей, пенсіонерів, студентів і військових - їх видно в деталях рейсу при бронюванні.` },
        { q: `Скільки їхати автобусом ${A} - ${B}?`,
          a: `Найшвидший рейс - ${fastest}${directFaster ? `, прямий - від ${hours(d.minTravelDirect)}` : ''}. Точний час відправлення й прибуття вказаний у кожному рейсі${intl ? '; час на кордоні може відрізнятися від розкладу' : ''}.` },
        { q: `Чи є прямі рейси ${A} - ${B}?`,
          a: d.nDirect
            ? `Так, ${d.nDirect === d.n ? 'усі рейси прямі' : `${plural(d.nDirect, 'прямий рейс', 'прямі рейси', 'прямих рейсів')} з ${d.n} на день`}. У пошуку можна увімкнути фільтр «Без пересадок».`
            : `Прямих рейсів зараз немає - усі рейси з пересадкою${transfers.length ? ` (зазвичай через ${listUa(transfers)})` : ''}. Місце й тривалість пересадки вказані в деталях рейсу.` },
        { q: `Які перевізники їздять за маршрутом ${A} - ${B}?`,
          a: `Кількість перевізників на маршруті - ${d.nCarriers}, серед них ${listUa(carriers.slice(0, 4))}. Рейтинг і зручності кожного перевізника видно в деталях рейсу.` },
        { q: 'Звідки відправляється автобус?',
          a: fromSt.length
            ? `У місті ${A} автобуси відправляються з таких зупинок: ${fromSt.join('; ')}. Прибуття в місто ${B}: ${toSt.join('; ') || 'зупинка вказана в деталях рейсу'}. Точна адреса - у деталях обраного рейсу.`
            : `Точна зупинка відправлення в місті ${A} і прибуття в місто ${B} вказана в деталях обраного рейсу.` },
        { q: 'Чи потрібна передоплата?',
          a: noPrepayMost
            ? 'На більшості рейсів передоплата не потрібна - оплата водієві при посадці. Якщо перевізник вимагає передоплату, це позначено в деталях рейсу.'
            : 'На частині рейсів цього маршруту перевізник вимагає передоплату - це позначено в деталях рейсу. Рейси без передоплати теж є, їх видно в пошуку.' },
        intl && { q: 'Які документи потрібні для поїздки?',
          a: `Для поїздки ${dest ? `до ${dest}` : 'за кордон'} потрібен закордонний біометричний паспорт; вимоги залежать від громадянства та мети поїздки. Для дітей і окремих категорій пасажирів можуть знадобитися додаткові документи - уточнюйте у менеджера.` },
        { q: 'Чи можна їхати з твариною?',
          a: 'На рейсах, де перевізник це дозволяє (позначено в деталях). Бронювання з твариною оформлює менеджер - вартість залежить від розміру тварини.' }
    ].filter(Boolean);

    return { title, desc, subtitle: `Розклад, ціни та бронювання онлайн - від ${price}`,
        introHeading: `Автобус ${A} - ${B}: що варто знати`, introText, facts, factsNote, faq };
}

// Перелінковка: інші сторінки хвилі з тим самим містом відправлення / прибуття
function relatedLinks(r) {
    const tag = x => `<a class="seo-tag" href="/${x.slug}">${escHtml(x.fromName)} - ${escHtml(x.toName)}</a>`;
    const fromSame = routes.filter(x => x !== r && String(x.fromId) === String(r.fromId) && String(x.toId) !== String(r.fromId)).slice(0, 12);
    const toSame = routes.filter(x => x !== r && String(x.toId) === String(r.toId) && String(x.fromId) !== String(r.toId)).slice(0, 12);
    const block = (h, arr) => arr.length ? `    <h3>${h}</h3>\n    <div class="seo-tags">${arr.map(tag).join('')}</div>\n` : '';
    const hubLinks = [r.fromId, r.toId].map(id => hubByCity.get(String(id))).filter(Boolean);
    const hubTags = hubLinks.map(h => `<a class="seo-tag" href="/${h.slug}">Автобуси ${escHtml(h.label)}</a>`).join('')
        + '<a class="seo-tag" href="/marshruty">Усі маршрути</a>';
    const inner = `    <h3>${hubLinks.length ? 'Усі рейси міста' : 'Більше маршрутів'}</h3>\n    <div class="seo-tags">${hubTags}</div>\n` + block(`Інші рейси: відправлення ${escHtml(r.fromName)}`, fromSame) + block(`Інші рейси: прибуття ${escHtml(r.toName)}`, toSame);
    return inner ? `\n<section class="route-related">\n${inner}</section>\n` : '';
}

function pageHtml(r) {
    const c = routeContent(r);
    const url = `${SITE}/${r.slug}`;
    const faqSchema = {
        '@context': 'https://schema.org', '@type': 'FAQPage',
        mainEntity: c.faq.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } }))
    };
    const faqHtml = c.faq.map(f => `        <details class="faq-item"><summary>${escHtml(f.q)}</summary><div class="faq-a">${escHtml(f.a)}</div></details>`).join('\n');
    const factsHtml = c.facts.length ? `
<section class="route-facts">
    <h2>Рейси <em>${escHtml(r.fromName)} - ${escHtml(r.toName)}</em> коротко</h2>
    <dl class="rf-grid">
${c.facts.map(([k, v]) => `        <div class="rf-item"><dt>${escHtml(k)}</dt><dd>${escHtml(v)}</dd></div>`).join('\n')}
    </dl>
    <p class="rf-note">${escHtml(c.factsNote)}</p>
</section>
` : '';
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
    <title>${escAttr(c.title)}</title>
    <meta name="description" content="${escAttr(c.desc)}">
    <link rel="canonical" href="${url}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="GoodDayBus">
    <meta property="og:title" content="${escAttr(c.title)}">
    <meta property="og:description" content="${escAttr(c.desc)}">
    <meta property="og:url" content="${url}">
    <meta property="og:image" content="${SITE}/og-image.jpg">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:locale" content="uk_UA">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escAttr(c.title)}">
    <meta name="twitter:description" content="${escAttr(c.desc)}">
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
    <p>${escHtml(c.subtitle)}</p>${reverseLink}
</section>

${searchWrap}
<div id="date-strip" class="date-strip"></div>

${quickContact}
<div class="content">
    <div id="results"></div>
</div>
${factsHtml}
<section class="route-intro">
    <h2>${escHtml(c.introHeading)}</h2>
    <p>${escHtml(c.introText)}</p>
</section>

<section class="seo-section faq-wrap" style="padding-bottom:0">
    <h2>Часті <em>запитання</em></h2>
</section>
<section class="faq-section">
${faqHtml}
</section>
${relatedLinks(r)}
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

// --- хаб-сторінки міст: "Автобуси Київ - Європа", "Автобуси Варшава - Україна" ---
// Місто отримує хаб, якщо в хвилі в нього щонайменше HUB_MIN сторінок маршрутів.
// Назва міста лишається в називному відмінку - так і шукають ("автобус Київ Європа").
const HUB_MIN = 3;
const hubByCity = new Map();
{
    const count = new Map();
    // Хаб "X - Європа/Україна" - за міжнародними маршрутами; маршрути по Україні лише показуються в ньому
    const isIntl = r => r.data ? r.data.fromCountry !== r.data.toCountry : true;
    for (const r of routes.filter(isIntl)) for (const [id, name, country] of [[r.fromId, r.fromName, r.data && r.data.fromCountry], [r.toId, r.toName, r.data && r.data.toCountry]]) {
        const c = count.get(String(id)) || { id, name, country, n: 0 };
        c.n++; if (!c.country && country) c.country = country;
        count.set(String(id), c);
    }
    for (const c of count.values()) if (c.n >= HUB_MIN && c.country) {
        const ua = c.country === 'UA';
        hubByCity.set(String(c.id), { ...c, ua, slug: `avtobusy-${slugify(c.name)}`,
            label: `${c.name} - ${ua ? 'Європа' : 'Україна'}` });
    }
}
const hubs = [...hubByCity.values()].sort((a, b) => b.n - a.n);

// Рядок маршруту в списку хаба: назва-посилання + коротко факти
function hubRow(r) {
    const d = r.data;
    const meta = d ? [`від ${money(d.minPrice, d.currency)}`, `у дорозі від ${hours(d.minTravel)}`,
        plural(d.n, 'рейс', 'рейси', 'рейсів') + ' на день', d.nDirect ? 'є прямі' : 'з пересадкою'] : [];
    return `        <li><a href="/${r.slug}">${escHtml(r.fromName)} - ${escHtml(r.toName)}</a>${meta.length ? `<span>${escHtml(meta.join(' · '))}</span>` : ''}</li>`;
}

// Спільний каркас для хабів і сторінки "Усі маршрути" (без віджета пошуку - кнопка веде на головну)
function shellHtml({ slug, title, desc, h1, lead, body }) {
    const url = `${SITE}/${slug}`;
    return `<!DOCTYPE html>
<html lang="uk">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${gtmHead}
    <meta name="robots" content="index, follow, max-image-preview:none">
    <title>${escAttr(title)}</title>
    <meta name="description" content="${escAttr(desc)}">
    <link rel="canonical" href="${url}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="GoodDayBus">
    <meta property="og:title" content="${escAttr(title)}">
    <meta property="og:description" content="${escAttr(desc)}">
    <meta property="og:url" content="${url}">
    <meta property="og:image" content="${SITE}/og-image.jpg">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:locale" content="uk_UA">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escAttr(title)}">
    <meta name="twitter:description" content="${escAttr(desc)}">
    <meta name="twitter:image" content="${SITE}/og-image.jpg">
    ${iconsFonts.trim()}
    <link rel="stylesheet" href="/styles.min.css?v=${ASSET_V}">
</head>
<body>
${gtmBody}

${header}
<main>

<section class="hero route-hero">
    <h1>${h1}</h1>
    <p>${escHtml(lead)}</p>
    <a class="route-reverse-link" href="/"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-arrow-right-arrow-left"></use></svg> Знайти рейс на свою дату</a>
</section>
${body}
${contactSection}
</main>

${footer}

<script src="/common.min.js?v=${ASSET_V}"></script>
</body>
</html>
`;
}

function hubHtml(h) {
    const id = String(h.id);
    const dom = r => r.data && r.data.fromCountry === 'UA' && r.data.toCountry === 'UA';
    const out = routes.filter(r => String(r.fromId) === id && !dom(r)), inb = routes.filter(r => String(r.toId) === id && !dom(r));
    const local = routes.filter(r => String(r.fromId) === id && dom(r));
    const prices = [...out, ...inb].filter(r => r.data && r.data.currency === 'UAH').map(r => r.data.minPrice);
    const minUah = prices.length ? money(Math.min(...prices), 'UAH') : '';
    const list = (head, arr) => arr.length ? `
<section class="hub-block">
    <h2>${head}</h2>
    <ul class="hub-list">
${arr.map(r => hubRow(r)).join('\n')}
    </ul>
</section>` : '';
    const body = list(`Відправлення: <em>${escHtml(h.name)}</em>`, out) + list(`Прибуття: <em>${escHtml(h.name)}</em>`, inb) + list(`По Україні: <em>${escHtml(h.name)}</em>`, local) + `
<section class="route-intro">
    <h2>Автобуси ${escHtml(h.label)} на GoodDayBus</h2>
    <p>${escHtml(`Тут зібрані всі напрямки ${h.label}, на які є рейси перевірених перевізників: ${plural(out.length + inb.length, 'маршрут', 'маршрути', 'маршрутів')} із цінами, часом у дорозі та кількістю рейсів на день. Оберіть маршрут, щоб побачити розклад, вокзали й перевізників, або знайдіть рейс на свою дату в пошуку. Бронювання займає хвилину і не потребує реєстрації; на більшості рейсів оплата водієві при посадці.`)}</p>
</section>`;
    return shellHtml({
        slug: h.slug,
        title: `Автобуси ${h.label}: розклад, ціни, квитки без передоплати | GoodDayBus`,
        desc: `Автобуси ${h.label}: ${plural(out.length + inb.length, 'маршрут', 'маршрути', 'маршрутів')}${minUah ? `, квитки від ${minUah}` : ''}. Розклад, ціни, прямі рейси й пересадки. Бронювання без реєстрації, на більшості рейсів без передоплати.`,
        h1: `Автобуси <span class="accent">${escHtml(h.label)}</span>`,
        lead: `Усі напрямки ${h.label}: ціни, час у дорозі, прямі рейси`,
        body
    });
}

// "Усі маршрути" - HTML-карта сайту: хаби міст і всі сторінки маршрутів
function allRoutesHtml() {
    const tags = arr => `<div class="seo-tags">${arr.map(x => `<a class="seo-tag" href="/${x.slug}">${escHtml(x.label || `${x.fromName} - ${x.toName}`)}</a>`).join('')}</div>`;
    const body = `
<section class="route-related">
    <h3>Міста України</h3>
    ${tags(hubs.filter(h => h.ua))}
    <h3>Міста Європи</h3>
    ${tags(hubs.filter(h => !h.ua))}
    <h3>Усі маршрути</h3>
    ${tags(routes)}
</section>`;
    return shellHtml({
        slug: 'marshruty',
        title: 'Автобусні маршрути Україна - Європа: усі напрямки | GoodDayBus',
        desc: `Усі автобусні маршрути GoodDayBus: ${plural(routes.length, 'напрямок', 'напрямки', 'напрямків')} між Україною та Європою з цінами, розкладом і бронюванням без передоплати.`,
        h1: 'Автобусні маршрути <span class="accent">Україна - Європа</span>',
        lead: 'Оберіть місто або маршрут',
        body
    });
}

let made = [];
for (const r of routes) {
    wr(`${r.slug}.html`, pageHtml(r));
    made.push(r.slug);
}
for (const h of hubs) wr(`${h.slug}.html`, hubHtml(h));
wr('marshruty.html', allRoutesHtml());

// Маніфест згенерованих сторінок: маршрут, що випав із хвилі (або хаб, у якого стало замало
// маршрутів), інакше лишився б у public/ сиротою - без посилань і поза sitemap.
const MANIFEST = path.join(__dirname, 'data', 'generated-pages.json');
const generatedNow = [...routes.map(r => r.slug), ...hubs.map(h => h.slug), 'marshruty'].sort();
const generatedBefore = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : [];
const keep = new Set(generatedNow);
for (const slug of generatedBefore) {
    const f = path.join(PUB, `${slug}.html`);
    if (!keep.has(slug) && fs.existsSync(f)) { fs.unlinkSync(f); console.log(`Видалено сторінку поза хвилею: ${slug}`); }
}
writeRetry(MANIFEST, JSON.stringify(generatedNow, null, 1) + '\n');

// --- sitemap: головна + FAQ + карта маршрутів + хаби + усі сторінки маршрутів ---
// lastmod - дата останнього оновлення даних рейсів: після щотижневого --refresh Google бачить,
// що сторінки змінились, і переобходить їх. Для хабів і карти - найсвіжіша дата серед їхніх маршрутів.
const day = iso => iso ? iso.slice(0, 10) : '';
const newest = arr => arr.map(r => day(r.data && r.data.updated)).filter(Boolean).sort().pop() || '';
const urls = [
    { u: '' }, { u: 'faq' }, { u: 'marshruty', mod: newest(routes) },
    ...hubs.map(h => ({ u: h.slug, mod: newest(routes.filter(r => String(r.fromId) === String(h.id) || String(r.toId) === String(h.id))) })),
    ...routes.map(r => ({ u: r.slug, mod: day(r.data && r.data.updated) }))
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(({ u, mod }) => `  <url>
    <loc>${SITE}/${u}</loc>${mod ? `
    <lastmod>${mod}</lastmod>` : ''}
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
- [Усі маршрути](${SITE}/marshruty)
- [Умови користування](${SITE}/terms)
- [Політика конфіденційності](${SITE}/privacy)
- [Скасування та повернення](${SITE}/refund)

## Міста
${hubs.map(h => `- [Автобуси ${h.label}](${SITE}/${h.slug})`).join('\n')}

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

console.log(`Згенеровано сторінок маршрутів: ${made.length}, хабів міст: ${hubs.length} (з даними розвідки: ${routes.filter(r => r.data).length})`);
console.log(`Sitemap оновлено: ${urls.length} URL`);
console.log(`Версія ассетів (?v=): ${ASSET_V}`);

// Юридичні сторінки (terms/privacy/refund/cookies) з legal/*.md
require('./build-legal.js');

// Англійські сторінки (public/en/*.html) + словник-оверрайд (public/i18n/en.js).
// Викликається останньою - читає index.html вже версійно-проштампованим (як build-legal.js).
require('./build-i18n.js');

})().catch(e => { console.error('[Build] Помилка:', e.message); process.exit(1); });
