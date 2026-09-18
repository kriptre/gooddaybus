// Генерує англійські сторінки з українських шаблонів + i18n/en.json.
// Викликається з build-routes.js наприкінці (після build-legal.js, щоб читати вже
// версійно-проштампований index.html); також працює окремо: node build-i18n.js
// (у такому разі спершу зберіть основну сторінку: node build-routes.js).
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, 'public');
const EN = path.join(PUB, 'en');
const dict = JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n', 'en.json'), 'utf8'));

const lookup = key => key.split('.').reduce((o, k) => (o == null ? o : o[k]), dict);

const escAttr = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const escHtml = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

const routes = JSON.parse(fs.readFileSync(path.join(__dirname, 'routes.json'), 'utf8'));

const missing = [];

// Замінює блок між двома маркерами-коментарями разом із ними. Маркери - щоб не чіпляти
// розмітку регуляркою по класах: коментар видно в шаблоні й зрозуміло, що його не можна прибрати.
function replaceBetween(html, startMark, endMark, replacement) {
    const i = html.indexOf(startMark);
    const j = i < 0 ? -1 : html.indexOf(endMark, i);
    if (i < 0 || j < 0) {
        missing.push(`маркер не знайдено: ${startMark} .. ${endMark}`);
        return html;
    }
    return html.slice(0, i) + replacement + html.slice(j + endMark.length);
}

// Знаходить кінець вмісту та позицію одразу ПІСЛЯ закриваючого тега з урахуванням вкладеності
// ОДНАКОВОГО тега (наприклад <span data-i18n-html="..."> ... <span class="ck-err-note">...</span> ... </span>).
// Наївний нежадібний regex зупинився б на ПЕРШОМУ </span> і обрізав би контент - тут рахуємо глибину.
function findMatchingClose(html, tag, fromIndex) {
    const re = new RegExp(`<(\\/?)${tag}\\b[^>]*?(\\/?)>`, 'gi');
    re.lastIndex = fromIndex;
    let depth = 1, m;
    while ((m = re.exec(html))) {
        const isClose = m[1] === '/';
        const isSelfClose = !isClose && m[2] === '/';
        if (isSelfClose) continue; // тег типу <span/> у цьому документі не трапляється, але про всяк випадок
        if (isClose) {
            depth--;
            if (depth === 0) return { contentEnd: m.index, afterClose: re.lastIndex };
        } else {
            depth++;
        }
    }
    return null;
}

// Заміна вмісту вузла за data-i18n / data-i18n-html.
// Ручний прохід (не String.replace) - щоб коректно знаходити ЗАКРИВАЮЧИЙ тег при вкладеності
// того самого тега, а не лише "перший </tag>", як зробив би простий regex.
function translateNodes(html) {
    const openRe = /<([a-z0-9]+)([^>]*?\bdata-i18n(-html)?="([^"]+)"[^>]*?)>/gi;
    let out = '';
    let pos = 0;
    openRe.lastIndex = 0;
    let m;
    while ((m = openRe.exec(html))) {
        if (m.index < pos) { openRe.lastIndex = pos; continue; } // всередині вже замінений блок - пропускаємо
        const tag = m[1].toLowerCase();
        const isHtml = !!m[3];
        const key = m[4];
        const openTagFull = m[0];
        const openEnd = m.index + openTagFull.length;

        const closeInfo = findMatchingClose(html, tag, openEnd);
        if (!closeInfo) throw new Error(`[i18n] Не знайдено закриваючий </${tag}> для data-i18n ключа "${key}" (build-i18n.js: index.html пошкоджено або тег не закрито)`);

        out += html.slice(pos, m.index);
        const val = lookup(key);
        if (val == null) {
            missing.push(key);
            out += html.slice(m.index, closeInfo.afterClose); // лишаємо як є, білд однаково впаде нижче
        } else {
            out += `${openTagFull}${isHtml ? val : escHtml(val)}</${tag}>`;
        }
        pos = closeInfo.afterClose;
        openRe.lastIndex = pos;
    }
    out += html.slice(pos);
    return out;
}

// Заміна атрибутів за data-i18n-attr="placeholder:key;aria-label:key2"
function translateAttrs(html) {
    return html.replace(/<([a-z0-9]+)([^>]*\bdata-i18n-attr="([^"]+)"[^>]*)>/gi, (full, tag, attrs, spec) => {
        let out = attrs;
        for (const pair of spec.split(';')) {
            const [name, key] = pair.split(':').map(s => s.trim());
            if (!name || !key) continue;
            const val = lookup(key);
            if (val == null) { missing.push(key); continue; }
            const re = new RegExp(`\\b${name}="[^"]*"`);
            out = re.test(out) ? out.replace(re, `${name}="${escAttr(val)}"`) : `${out} ${name}="${escAttr(val)}"`;
        }
        return `<${tag}${out}>`;
    });
}

// --- Рядки з плейсхолдерами стають функціями на клієнті ---------------------------------
// Інтерполяція має належати словнику (порядок слів у мовах різний), тож у JSON лежать рядки
// з {n}/{msg}/... плейсхолдерами, а не готові англійські речення з підставленими числами.
// FN_SPECS - структурні метадані (які функції T_UK якого args, а не переклад) - тому це код,
// не дані з en.json. Список звірено з усіма function-значеннями T_UK у public/app.js.
const FN_SPECS_SRC = `[
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
]`;

// Розгортає рядки-шаблони у window.__I18N__.app у функції за FN_SPECS_SRC, плюс окремо
// seats.hint - єдиний випадок з УМОВНИМ фрагментом (наявність застереження "потрібно N" залежить
// від need > 1), тож для нього не досить одної підстановки: базовий рядок і фрагмент - окремі
// ключі словника (seats.hint / seats.hintNeedClause), а умова - у коді, як і в оригіналі T_UK.
const EXPAND_FUNCTIONS_SRC = `
(function (d) {
    var specs = ${FN_SPECS_SRC};
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
`;

function enPage(srcFile) {
    let html = fs.readFileSync(path.join(PUB, srcFile), 'utf8');
    html = translateAttrs(translateNodes(html));
    html = html.replace('<html lang="uk">', '<html lang="en">');
    // FAQPage-розмітка на noindex-сторінці не має сенсу
    // Разом зі скриптом прибираємо і коментар-заголовок перед ним, інакше в англійській
    // сторінці лишається український підпис до блоку, якого вже немає.
    html = html.replace(/\s*(?:<!--[^>]*?-->\s*)?<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '');
    // noindex замість index: англійська версія навмисно не індексується (сирий /en/ дубль)
    html = html.replace(/<meta name="robots" content="[^"]*">/, '<meta name="robots" content="noindex, nofollow">');
    // canonical при noindex зайвий і дав би суперечливий сигнал - прибираємо повністю
    html = html.replace(/\s*<link rel="canonical"[^>]*>\n?/, '\n');
    html = html.replace(/<meta property="og:locale" content="uk_UA">/, '<meta property="og:locale" content="en">');
    // словник підвантажується ПЕРЕД common.min.js/app.min.js - інакше T/C у них візьмуть T_UK/C_UK
    html = html.replace('<script src="/common.min.js', '<script src="/i18n/en.js"></script>\n<script src="/common.min.js');
    // booking.html не підключає common.min.js (сторінка повністю автономна, лише один
    // інлайн-скрипт) - тож для неї немає якоря вище. Натомість у розмітці стоїть окремий
    // маркер-коментар <!-- I18N-DICT --> прямо перед інлайн-скриптом; тут його заміняємо на
    // /i18n/en.js, щоб той самий приймач window.__I18N__.booking спрацював до виконання скрипту.
    // Відсутність маркера - помилка складання шаблону, а не штатна ситуація, тож падаємо гучно.
    if (srcFile === 'booking.html') {
        if (!html.includes('<!-- I18N-DICT -->')) {
            throw new Error('[i18n] booking.html: маркер <!-- I18N-DICT --> не знайдено - інлайн-скрипт не отримає словник на англійській сторінці');
        }
        html = html.replace('<!-- I18N-DICT -->', '<script src="/i18n/en.js"></script>');
    }
    // Перемикач мови: на англійській сторінці поточна мова - EN, посилання веде на українську.
    // Поточна мова НЕ посилання, а span: клікати мову, на якій уже перебуваєш, нема сенсу.
    // booking.html - самостійна сторінка без навігації в хедері (лише лого), маркера в ній
    // немає - пропускаємо заміну для таких сторінок замість падати з "маркер не знайдено".
    if (html.includes('<!-- LANG-SWITCH START')) {
        html = replaceBetween(html, '<!-- LANG-SWITCH START', '<!-- LANG-SWITCH END -->',
            '<!-- LANG-SWITCH START -->\n        <div class="lang-switch" aria-label="Site language">\n'
            + '            <a href="/" hreflang="uk">UA</a>\n'
            + '            <span class="lang-cur">EN</span>\n'
            + '        </div>\n        <!-- LANG-SWITCH END -->');
    }

    // Плитки популярних напрямків ведуть на SEO-сторінки маршрутів, яких англійською немає.
    // Замість навігації в український текст - той самий пошук через ?from=&to=, які app.js
    // уже вміє читати (applyQueryParams). Працює без JS-обробника, переживає відкриття
    // посилання в новій вкладці. ID беремо з routes.json, щоб не дублювати їх у розмітці.
    html = html.replace(/(<a class="seo-tag" href=")\/([a-z-]+)(")/g, (full, pre, slug, post) => {
        const r = routes.find(x => x.slug === slug);
        if (!r) { missing.push(`routes.json: немає маршруту "${slug}"`); return full; }
        return `${pre}/en/?from=${r.fromId}&amp;to=${r.toId}${post}`;
    });

    // Примітка: посилання на /faq, /terms, /privacy, /refund, /cookies свідомо НЕ переписуються на
    // /en/* - таких сторінок ця задача не генерує. Чесніше вести на реальну (українську) сторінку,
    // ніж на неіснуючу англійську (гілка footer.faq тощо перекладає лише текст посилання, не href).
    return html;
}

fs.mkdirSync(EN, { recursive: true });
fs.mkdirSync(path.join(PUB, 'i18n'), { recursive: true });

const pages = ['index.html', 'faq.html', 'booking.html'];
for (const p of pages) fs.writeFileSync(path.join(EN, p), enPage(p));

// Файл-оверрайд для клієнта: кладе повний словник у window.__I18N__ до того,
// як common.js/app.js виберуть T/C (див. коментар у самих файлах).
fs.writeFileSync(path.join(PUB, 'i18n', 'en.js'),
    'window.__I18N__=' + JSON.stringify({ app: dict.app, common: dict.common, booking: dict.booking }) + ';' + EXPAND_FUNCTIONS_SRC);

if (missing.length) {
    console.error('[i18n] Немає перекладу для ключів:\n  ' + [...new Set(missing)].join('\n  '));
    process.exit(1);
}
console.log(`[i18n] Згенеровано англійських сторінок: ${pages.length}`);
