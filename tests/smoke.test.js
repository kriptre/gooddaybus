// Смоук-тести: ганяються проти ЗАПУЩЕНОГО dev-сервера (npm start в сусідньому терміналі).
// Нічого не пишуть у contrabus. Запуск: npm test
const { test } = require('node:test');
const assert = require('node:assert');

const BASE = process.env.TEST_BASE || 'http://localhost:3000';

async function get(path, opts) {
    const r = await fetch(BASE + path, opts);
    let body = null;
    try { body = await r.clone().json(); } catch { body = await r.text(); }
    return { status: r.status, body, headers: r.headers };
}

test('сервер запущено (інакше: npm start в іншому терміналі)', async () => {
    let ok = false;
    try { await fetch(BASE + '/'); ok = true; } catch { }
    assert.ok(ok, `Сервер не відповідає на ${BASE} - запустіть npm start`);
});

test('GET / віддає html', async () => {
    const r = await get('/');
    assert.equal(r.status, 200);
    assert.match(String(r.body), /GoodDayBus/);
});

test('GET /api/cities - масив міст', async () => {
    const r = await get('/api/cities');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body) && r.body.length > 50, 'очікували великий масив міст');
});

test('POST /api/order без полів - 400', async () => {
    const r = await get('/api/order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    assert.equal(r.status, 400);
});

test('GET /api/orders без пароля - 401', async () => {
    const r = await get('/api/orders');
    assert.equal(r.status, 401);
});
