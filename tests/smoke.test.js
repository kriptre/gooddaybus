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

// Мемоізація: наступні задачі (3-6) переюзають ту саму тестову заявку, щоб не витрачати
// orderLimited (5 заявок / 10 хв з IP) на кожен прогін тестів.
// ПРИМІТКА: тіло запиту приведене до реальної схеми POST /api/order (server.js: passengers
// з полями name/surname/phone, route_from/route_to тощо пласкими полями) - не до вкладеного
// { route: {...} } з ТЗ, бо з таким тілом сервер валідатором відкидає заявку (400, порожній
// список пасажирів) і 201 з токеном ніколи не настане.
let _orderP = null;
function createSmokeOrder() {
    _orderP = _orderP || get('/api/order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            passengers: [{ name: 'Смоук', surname: 'Тест', phone: '+380000000000' }],
            route_from: 'Тест', route_to: 'Тест', route_date: '01.01.2099', route_time: '10:00',
            route_price: '1', route_carrier: 'SMOKE-TEST'
        })
    });
    return _orderP;
}

test('201 на заявку містить token (32 hex)', async () => {
    const r = await createSmokeOrder();
    assert.equal(r.status, 201);
    assert.match(String(r.body.token), /^[a-f0-9]{32}$/);
});

test('GET /api/booking/<фейковий токен> - 404', async () => {
    const r = await get('/api/booking/' + 'a'.repeat(32));
    assert.equal(r.status, 404);
});

test('GET /api/booking/<токен щойно створеної заявки> - 200 без телефону', async () => {
    const created = await createSmokeOrder();
    const r = await get('/api/booking/' + created.body.token);
    assert.equal(r.status, 200);
    assert.equal(r.body.order.route_carrier, 'SMOKE-TEST');
    assert.ok(!JSON.stringify(r.body).includes('380000000000'), 'телефон не має витікати');
});

test('PDF-проксі: чужий/неіснуючий квиток - 404', async () => {
    const r = await get('/api/booking/' + 'a'.repeat(32) + '/ticket/123');
    assert.equal(r.status, 404);
});

test('GET /t/<токен> віддає сторінку броні', async () => {
    const r = await get('/t/' + 'a'.repeat(32));
    assert.equal(r.status, 200);
    assert.match(String(r.body), /Ваша бронь/);
});

test('GET /api/health - ok:true і db:true', async () => {
    const r = await get('/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.db, true);
});
