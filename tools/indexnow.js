// Повідомлення пошуковикам (Bing, Seznam, Naver, Yep...) про сторінки сайту через IndexNow.
// Запуск: node tools/indexnow.js [--wait]
//
// Бере всі URL із public/sitemap.xml і надсилає одним запитом на api.indexnow.org - той
// пересилає їх усім учасникам протоколу. Bing після цього обходить сторінки за хвилини, а не тижні;
// на його індексі працюють ChatGPT Search і DuckDuckGo. Google IndexNow не підтримує.
//
// Пошуковик перевіряє, що ключ справді наш: файл public/<KEY>.txt має віддаватися з сайту.
// --wait: спершу чекаємо, поки деплой викладе ключ і sitemap (для запуску одразу після push).
const fs = require('fs');
const path = require('path');

const SITE = 'https://gooddaybus.com';
const KEY = '2576cf230b2040fda5f232a65acceede';
const KEY_URL = `${SITE}/${KEY}.txt`;
const WAIT = process.argv.includes('--wait');

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const sitemap = fs.readFileSync(path.join(__dirname, '..', 'public', 'sitemap.xml'), 'utf8');
    const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    if (!urls.length) throw new Error('у sitemap.xml немає URL');

    // Чекаємо до ~10 хв: ключ доступний і живий sitemap уже містить останній URL нашого списку
    if (WAIT) {
        const last = urls[urls.length - 1];
        for (let i = 0; ; i++) {
            const [k, s] = await Promise.all([
                fetch(KEY_URL).then(r => r.ok ? r.text() : '').catch(() => ''),
                fetch(`${SITE}/sitemap.xml`, { cache: 'no-store' }).then(r => r.ok ? r.text() : '').catch(() => '')
            ]);
            if (k.trim() === KEY && s.includes(last)) break;
            if (i >= 40) throw new Error('деплой не виклав ключ або свіжий sitemap за 10 хв');
            await sleep(15000);
        }
    }

    const r = await fetch('https://api.indexnow.org/indexnow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host: new URL(SITE).host, key: KEY, keyLocation: KEY_URL, urlList: urls })
    });
    // 200 - прийнято, 202 - прийнято, ключ ще перевіряється; решта - помилка
    if (r.status !== 200 && r.status !== 202) throw new Error(`IndexNow ${r.status}: ${await r.text()}`);
    console.log(`IndexNow: надіслано ${urls.length} URL (відповідь ${r.status})`);
})().catch(e => { console.error('[indexnow]', e.message); process.exit(1); });
