// Збирає інлайн-SVG-спрайт із реальних шляхів FontAwesome 6.4.0 (через jsdelivr).
// Запуск разово при зміні набору іконок: node build-icons.js  ->  public/_sprite.svg
const https = require('https');
const fs = require('fs');
const path = require('path');

const FA = '6.4.0';
const REGULAR = ['calendar', 'clock', 'credit-card', 'lightbulb'];
const BRANDS = ['telegram', 'viber', 'whatsapp'];
const SOLID = [
    'location-dot', 'spinner', 'circle-info', 'circle-dot', 'circle-xmark',
    'chevron-down', 'chevron-up', 'chevron-left', 'chevron-right',
    'bus', 'bus-simple', 'arrow-right', 'arrow-right-arrow-left', 'arrow-up', 'arrow-down-short-wide',
    'tag', 'phone', 'paw', 'paper-plane', 'magnifying-glass', 'bolt', 'headset', 'filter',
    'chair', 'users', 'user', 'ticket', 'star', 'snowflake', 'sliders', 'shield-halved',
    'route', 'right-left', 'restroom', 'plus', 'plug', 'money-bill-wave', 'map-pin',
    'location-crosshairs', 'hand-holding-dollar', 'flag-checkered', 'file-pdf', 'envelope',
    'coins', 'child-reaching', 'check', 'ban', 'wifi'
];

const get = url => new Promise((resolve, reject) => {
    https.get(url, res => {
        if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} ${url}`)); }
        let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    }).on('error', reject);
});

(async () => {
    const all = [...REGULAR.map(n => ['regular', n]), ...BRANDS.map(n => ['brands', n]), ...SOLID.map(n => ['solid', n])];
    const symbols = [];
    const failed = [];
    for (const [style, name] of all) {
        try {
            const svg = await get(`https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@${FA}/svgs/${style}/${name}.svg`);
            const vb = (svg.match(/viewBox="([^"]+)"/) || [])[1];
            const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<!--[\s\S]*?-->/g, '').trim();
            if (!vb || !inner) throw new Error('порожній');
            symbols.push(`<symbol id="i-${name}" viewBox="${vb}">${inner}</symbol>`);
        } catch (e) { failed.push(`${style}/${name}: ${e.message}`); }
    }
    const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">${symbols.join('')}</svg>`;
    fs.writeFileSync(path.join(__dirname, 'public', '_sprite.svg'), sprite);
    console.log(`Іконок у спрайті: ${symbols.length}/${all.length}, розмір: ${(sprite.length / 1024).toFixed(1)} KB`);
    if (failed.length) { console.log('НЕ ЗАВАНТАЖЕНО:'); failed.forEach(f => console.log('  ' + f)); }
})();
