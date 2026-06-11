// =============================================
// База даних заявок (SQLite, вбудований node:sqlite)
// Файл orders.db створюється автоматично поруч із сервером.
// =============================================
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// Папка для бази та бекапів. На хостингу вкажи DATA_DIR = шлях до постійного диска
// (напр. /data), щоб база не зникала при деплої. Локально — поруч із кодом.
const DATA_DIR = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'orders.db'));

// --- Резервна копія бази (один файл на день, зберігаємо останні 14) ---
function backupDb() {
    try {
        const dir = path.join(DATA_DIR, 'backups');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        const stamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const dest = path.join(dir, `orders-${stamp}.db`);
        if (fs.existsSync(dest)) fs.unlinkSync(dest); // VACUUM INTO вимагає, щоб файлу не було
        // VACUUM INTO робить узгоджений знімок навіть під час роботи
        db.exec(`VACUUM INTO '${dest.replace(/\\/g, '/').replace(/'/g, "''")}'`);
        // прибираємо старі копії, лишаємо 14 найновіших
        const files = fs.readdirSync(dir).filter(f => /^orders-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
        while (files.length > 14) fs.unlinkSync(path.join(dir, files.shift()));
        console.log(`[Backup] Збережено: ${path.basename(dest)}`);
        return dest;
    } catch (e) {
        console.error('[Backup] Помилка:', e.message);
        return null;
    }
}

// Дозволені статуси заявки
const STATUSES = ['new', 'in_progress', 'done', 'cancelled'];

db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'new',
        client_name   TEXT NOT NULL,
        client_phone  TEXT NOT NULL,
        comment       TEXT,
        route_from    TEXT,
        route_to      TEXT,
        route_date    TEXT,
        route_time    TEXT,
        route_price   TEXT,
        route_carrier TEXT,
        manager_note  TEXT,
        seats         INTEGER DEFAULT 1,
        passengers    TEXT,
        route_from_station TEXT,
        route_to_station   TEXT,
        check_warning TEXT
    );
`);

// Міграції: додаємо нові колонки до вже існуючої бази, якщо їх немає
const _cols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
if (!_cols.includes('seats')) db.exec('ALTER TABLE orders ADD COLUMN seats INTEGER DEFAULT 1');
if (!_cols.includes('passengers')) db.exec('ALTER TABLE orders ADD COLUMN passengers TEXT');
if (!_cols.includes('route_from_station')) db.exec('ALTER TABLE orders ADD COLUMN route_from_station TEXT');
if (!_cols.includes('route_to_station')) db.exec('ALTER TABLE orders ADD COLUMN route_to_station TEXT');
if (!_cols.includes('check_warning')) db.exec('ALTER TABLE orders ADD COLUMN check_warning TEXT');

// Таблиці для аналітики
db.exec(`
    CREATE TABLE IF NOT EXISTS searches (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        from_name  TEXT,
        to_name    TEXT,
        date       TEXT,
        results    INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS visits (
        day   TEXT PRIMARY KEY,
        count INTEGER DEFAULT 0
    );
`);

// --- Створення нової заявки ---
function createOrder(data) {
    const now = new Date().toISOString();
    const stmt = db.prepare(`
        INSERT INTO orders
            (created_at, updated_at, status, client_name, client_phone, comment,
             route_from, route_to, route_date, route_time, route_price, route_carrier, manager_note, seats, passengers,
             route_from_station, route_to_station, check_warning)
        VALUES
            (?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?)
    `);
    const passengers = Array.isArray(data.passengers) ? data.passengers : [];
    const seats = passengers.length || Math.min(99, Math.max(1, parseInt(data.seats, 10) || 1));
    const info = stmt.run(
        now, now,
        data.client_name, data.client_phone, data.comment || '',
        data.route_from || '', data.route_to || '', data.route_date || '',
        data.route_time || '', data.route_price || '', data.route_carrier || '', seats,
        passengers.length ? JSON.stringify(passengers) : null,
        data.route_from_station || '', data.route_to_station || '', data.check_warning || ''
    );
    return getOrder(info.lastInsertRowid);
}

// --- Одна заявка ---
function getOrder(id) {
    return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
}

// --- Список заявок (опційні фільтри: статус та пошук за ім'ям/телефоном) ---
function listOrders(status, q) {
    const where = [], params = [];
    if (status && STATUSES.includes(status)) { where.push('status = ?'); params.push(status); }
    if (q && q.trim()) {
        where.push('(client_name LIKE ? OR client_phone LIKE ? OR passengers LIKE ?)');
        const like = '%' + q.trim() + '%';
        params.push(like, like, like);
    }
    const sql = 'SELECT * FROM orders' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY id DESC';
    return db.prepare(sql).all(...params);
}

// --- Кількість заявок за кожним статусом (для бейджів у панелі) ---
function statusCounts() {
    const rows = db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all();
    const counts = { all: 0, new: 0, in_progress: 0, done: 0, cancelled: 0 };
    rows.forEach(r => { counts[r.status] = r.n; counts.all += r.n; });
    return counts;
}

// --- Унікальні клієнти ---
// КОЖЕН пасажир заявки = окремий клієнт. Групуємо за (телефон + ім'я),
// тож мама й син з одним номером лишаються двома різними клієнтами.
function listClients(q, fromDay, toDay) {
    let sql = 'SELECT created_at, client_name, client_phone, passengers, route_from, route_to, route_date FROM orders';
    const params = [];
    if (fromDay && toDay) { sql += ' WHERE substr(created_at,1,10) BETWEEN ? AND ?'; params.push(fromDay, toDay); }
    sql += ' ORDER BY created_at ASC';
    const orders = db.prepare(sql).all(...params);

    const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const digits = s => String(s || '').replace(/\D/g, '');
    const map = new Map();

    for (const o of orders) {
        let people = [];
        try { const a = JSON.parse(o.passengers); if (Array.isArray(a) && a.length) people = a; } catch {}
        if (!people.length) people = [{ name: o.client_name || '', surname: '', phone: o.client_phone || '' }];

        for (const p of people) {
            const fullName = `${p.name || ''} ${p.surname || ''}`.trim() || (o.client_name || '');
            const key = digits(p.phone) + '|' + norm(fullName);
            let c = map.get(key);
            if (!c) {
                c = { client_name: fullName, client_phone: p.phone || '', trips: 0 };
                map.set(key, c);
            }
            c.trips++;
            // заявки відсортовані за зростанням дати → останнє присвоєння = найсвіжіша поїздка
            c.last_order = o.created_at;
            c.last_from = o.route_from;
            c.last_to = o.route_to;
            c.last_date = o.route_date;
            if (!c.client_phone && p.phone) c.client_phone = p.phone;
        }
    }

    let arr = [...map.values()];
    if (q && q.trim()) {
        const n = q.trim().toLowerCase();
        arr = arr.filter(c => c.client_name.toLowerCase().includes(n) || c.client_phone.toLowerCase().includes(n));
    }
    arr.sort((a, b) => (a.last_order < b.last_order ? 1 : -1)); // найсвіжіші зверху
    return arr;
}

// --- Кількість унікальних клієнтів ---
function clientsCount() {
    return listClients().length;
}

// --- Оновлення статусу / нотатки менеджера ---
function updateOrder(id, fields) {
    const order = getOrder(id);
    if (!order) return null;

    const status = STATUSES.includes(fields.status) ? fields.status : order.status;
    const note = fields.manager_note !== undefined ? fields.manager_note : order.manager_note;

    db.prepare('UPDATE orders SET status = ?, manager_note = ?, updated_at = ? WHERE id = ?')
        .run(status, note, new Date().toISOString(), id);
    return getOrder(id);
}

// --- Видалення однієї заявки ---
function deleteOrder(id) {
    return db.prepare('DELETE FROM orders WHERE id = ?').run(id).changes;
}

// --- Видалення клієнта (конкретної людини за телефоном+ім'ям) ---
// Прибираємо саме цю людину зі списку пасажирів. Якщо вона була єдиним
// пасажиром заявки — видаляємо заявку; інакше лишаємо співпасажирів.
function deleteClient(phone, name) {
    const dig = s => String(s || '').replace(/\D/g, '');
    const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const tPhone = dig(phone), tName = norm(name);
    const rows = db.prepare('SELECT * FROM orders WHERE client_phone = ? OR passengers LIKE ?').all(phone, '%' + phone + '%');
    let changed = 0;
    for (const o of rows) {
        let pax = [];
        try { const a = JSON.parse(o.passengers); if (Array.isArray(a)) pax = a; } catch {}

        if (pax.length) {
            const kept = pax.filter(p => !(dig(p.phone) === tPhone && (!tName || norm(`${p.name} ${p.surname}`) === tName)));
            if (kept.length === pax.length) continue;           // нічого не співпало
            if (kept.length === 0) {
                db.prepare('DELETE FROM orders WHERE id = ?').run(o.id);
            } else {
                const f = kept[0];
                db.prepare('UPDATE orders SET passengers=?, seats=?, client_name=?, client_phone=?, updated_at=? WHERE id=?')
                    .run(JSON.stringify(kept), kept.length, `${f.name} ${f.surname}`.trim(), f.phone, new Date().toISOString(), o.id);
            }
            changed++;
        } else if (dig(o.client_phone) === tPhone && (!tName || norm(o.client_name) === tName)) {
            db.prepare('DELETE FROM orders WHERE id = ?').run(o.id);
            changed++;
        }
    }
    return changed;
}

// ===================== АНАЛІТИКА =====================

// Лог пошуку (назви міст резолвимо на сервері)
function logSearch(from_name, to_name, date, results) {
    db.prepare('INSERT INTO searches (created_at, from_name, to_name, date, results) VALUES (?, ?, ?, ?, ?)')
        .run(new Date().toISOString(), from_name || '', to_name || '', date || '', Number(results) || 0);
}

// Лічильник візитів (одна сесія = +1), агрегуємо по днях
function logVisit() {
    const day = new Date().toISOString().slice(0, 10);
    db.prepare('INSERT INTO visits (day, count) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET count = count + 1').run(day);
}

// Розкладання подобових лічильників у стовпчики (день/тиждень/місяць — залежно від діапазону)
const MONTHS_UA = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
function bucketSeries(perDay, fromDay, toDay) {
    const dStart = new Date(fromDay + 'T00:00:00Z'), dEnd = new Date(toDay + 'T00:00:00Z');
    const span = Math.floor((dEnd - dStart) / 86400000) + 1;
    const gran = span <= 31 ? 'day' : (span <= 92 ? 'week' : 'month');
    const keyLabel = d => {
        if (gran === 'day') { const k = d.toISOString().slice(0, 10); return [k, k.slice(8) + '.' + k.slice(5, 7)]; }
        if (gran === 'week') { const wd = (d.getUTCDay() + 6) % 7; const m = new Date(d); m.setUTCDate(d.getUTCDate() - wd); const k = m.toISOString().slice(0, 10); return [k, k.slice(8) + '.' + k.slice(5, 7)]; }
        const k = d.toISOString().slice(0, 7); return [k, MONTHS_UA[d.getUTCMonth()] + ' ' + String(d.getUTCFullYear()).slice(2)];
    };
    const map = {}, order = [];
    for (let t = new Date(dStart); t <= dEnd; t.setUTCDate(t.getUTCDate() + 1)) {
        const [k, l] = keyLabel(new Date(t));
        if (!map[k]) { map[k] = { label: l, n: 0 }; order.push(k); }
    }
    Object.keys(perDay).forEach(day => {
        const d = new Date(day + 'T00:00:00Z'); if (d < dStart || d > dEnd) return;
        const [k] = keyLabel(d); if (map[k]) map[k].n += perDay[day];
    });
    return order.map(k => ({ label: map[k].label, n: map[k].n }));
}

// Зведена статистика для дашборду за період [from, to] (формат YYYY-MM-DD; обидва опційні = весь час)
function getStats(from, to) {
    const one = (sql, ...p) => db.prepare(sql).get(...p);
    const today = new Date().toISOString().slice(0, 10);

    // визначаємо межі діапазону
    const toDay = to || today;
    let fromDay = from;
    if (!fromDay) {
        const mins = [
            one("SELECT MIN(substr(created_at,1,10)) d FROM orders").d,
            one("SELECT MIN(substr(created_at,1,10)) d FROM searches").d,
            one("SELECT MIN(day) d FROM visits").d
        ].filter(Boolean).sort();
        fromDay = mins[0] || toDay;
    }
    const W = 'substr(created_at,1,10) BETWEEN ? AND ?';     // фільтр для orders/searches
    const R = [fromDay, toDay];

    const perDay = rows => { const m = {}; rows.forEach(r => m[r.day] = r.n); return m; };

    const clients = listClients(null, fromDay, toDay);

    return {
        range: { from: fromDay, to: toDay },
        summary: {
            ordersTotal: one(`SELECT COUNT(*) n FROM orders WHERE ${W}`, ...R).n,
            passengersTotal: one(`SELECT COALESCE(SUM(seats),0) n FROM orders WHERE ${W}`, ...R).n,
            clientsTotal: clients.length,
            searchesTotal: one(`SELECT COUNT(*) n FROM searches WHERE ${W}`, ...R).n,
            visitsTotal: one('SELECT COALESCE(SUM(count),0) n FROM visits WHERE day BETWEEN ? AND ?', ...R).n
        },
        byStatus: db.prepare(`SELECT status, COUNT(*) n FROM orders WHERE ${W} GROUP BY status`).all(...R),
        ordersByDay: bucketSeries(perDay(db.prepare(`SELECT substr(created_at,1,10) day, COUNT(*) n FROM orders WHERE ${W} GROUP BY day`).all(...R)), fromDay, toDay),
        visitsByDay: bucketSeries(perDay(db.prepare('SELECT day, count AS n FROM visits WHERE day BETWEEN ? AND ?').all(...R)), fromDay, toDay),
        searchesByDay: bucketSeries(perDay(db.prepare(`SELECT substr(created_at,1,10) day, COUNT(*) n FROM searches WHERE ${W} GROUP BY day`).all(...R)), fromDay, toDay),
        topRoutes: db.prepare(`SELECT (route_from || ' → ' || route_to) route, COUNT(*) n FROM orders WHERE ${W} AND COALESCE(route_from,'') <> '' GROUP BY route ORDER BY n DESC LIMIT 8`).all(...R),
        topSearches: db.prepare(`SELECT (from_name || ' → ' || to_name) route, COUNT(*) n FROM searches WHERE ${W} AND COALESCE(from_name,'') <> '' GROUP BY route ORDER BY n DESC LIMIT 8`).all(...R),
        // Пошук "на сьогодні" без результатів — не незадоволений попит (рейси на цей день
        // просто вже відійшли), тому виключаємо рядки, де дата поїздки = день пошуку.
        noResults: db.prepare(`SELECT (from_name || ' → ' || to_name) route, COUNT(*) n FROM searches
            WHERE ${W} AND results = 0 AND COALESCE(from_name,'') <> ''
            AND (substr(date,7,4) || '-' || substr(date,4,2) || '-' || substr(date,1,2)) <> substr(created_at,1,10)
            GROUP BY route ORDER BY n DESC LIMIT 8`).all(...R),
        topClients: clients.slice().sort((a, b) => b.trips - a.trips).slice(0, 10).map(c => ({ name: c.client_name, phone: c.client_phone, trips: c.trips }))
    };
}

module.exports = { createOrder, getOrder, listOrders, statusCounts, listClients, clientsCount, updateOrder, deleteOrder, deleteClient, backupDb, logSearch, logVisit, getStats, STATUSES };
