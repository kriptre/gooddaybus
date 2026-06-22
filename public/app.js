    const PROXY_BASE = '/api'; // той самий сервер, що віддає сайт (працює і локально, і на домені)
    let cities = [], depId = null, arrId = null, selRoute = null;
    let _routes = [], _view = [], _dep = '', _arr = '', _date = '', _sortBy = 'departure';
    // Фільтри рейсів: 'noprepay' = без передоплати, 'direct' = без пересадок.
    // Порожній набір = показувати всі.
    let _filters = new Set();
    // "Передоплата лише для груп" (текст на кшталт "для груп з трьох і більше осіб"):
    // для 1-2 пасажирів це фактично без передоплати - рахуємо такі рейси у фільтрі
    // "Без передоплати", а умову показуємо в деталях рейсу.
    const isGroupPrepay = rt => rt.label_type === 'prepayment' && /груп/i.test(rt.price_label || '');
    const payCategory = rt => !rt.label_type ? 'none' : (isGroupPrepay(rt) ? 'group' : (rt.label_type === 'prepayment' ? 'partial' : 'full'));
    // Прямий рейс: change_info порожній АБО не містить слова "пересад"
    // (API часто пише туди текст на кшталт "Прямий рейс")
    const isDirect = rt => !rt.change_info || !/пересад/i.test(rt.change_info);
    // Рейс дозволяє перевезення тварин (код 'pets' в зручностях перевізника)
    const allowsPets = rt => Array.isArray(rt.carrier_amenities) && rt.carrier_amenities.includes('pets');
    const matchesFilters = rt =>
        (!_filters.has('noprepay') || !rt.label_type || isGroupPrepay(rt)) &&
        (!_filters.has('direct') || isDirect(rt)) &&
        (!_filters.has('pets') || allowsPets(rt));

    function setStatus(txt, type = '') {
        document.getElementById('status-row').className = `status-row ${type}`;
        document.getElementById('status-txt').textContent = txt;
    }

    async function loadCities() {
        setStatus('Завантаження міст...', 'loading');
        try {
            const r = await fetch(`${PROXY_BASE}/cities`);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            cities = await r.json();
            setStatus(`${cities.length} міст у наявності - оберіть напрямок`, 'success');
            document.getElementById('search-btn').disabled = false;
            if (window.__ROUTE__) initRoutePage();   // сторінка маршруту: підставити напрямок, стрічка дат, авто-пошук
            else applyQueryParams();                 // головна: deep-link /?from=&to=&date=
        } catch (e) { setStatus(`Помилка: ${e.message}`, 'error'); }
    }

    // === Сторінка маршруту (route page) ===
    const STRIP_LEN = 7, STRIP_MAX = 90;
    const DOW = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const MON_SHORT = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
    const ymdLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let _stripStart = 0; // зсув у днях від сьогодні для лівої видимої дати

    function buildDateStrip(selectedYMD) {
        const box = document.getElementById('date-strip');
        if (!box) return;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        let days = '';
        for (let i = 0; i < STRIP_LEN; i++) {
            const d = new Date(today); d.setDate(d.getDate() + _stripStart + i);
            const ymd = ymdLocal(d);
            days += `<button type="button" class="ds-day${ymd === selectedYMD ? ' sel' : ''}" data-ymd="${ymd}"><span class="ds-dow">${DOW[d.getDay()]}</span><span class="ds-num">${d.getDate()}</span><span class="ds-mon">${MON_SHORT[d.getMonth()]}</span></button>`;
        }
        const canPrev = _stripStart > 0, canNext = _stripStart + STRIP_LEN <= STRIP_MAX;
        box.innerHTML = `<button type="button" class="ds-arr" id="ds-prev"${canPrev ? '' : ' disabled'} aria-label="Раніше"><i class="fa-solid fa-chevron-left"></i></button>`
            + `<div class="ds-days">${days}</div>`
            + `<button type="button" class="ds-arr" id="ds-next"${canNext ? '' : ' disabled'} aria-label="Пізніше"><i class="fa-solid fa-chevron-right"></i></button>`;
        box.querySelector('#ds-prev').addEventListener('click', () => { _stripStart = Math.max(0, _stripStart - STRIP_LEN); buildDateStrip(document.getElementById('date-input').value); });
        box.querySelector('#ds-next').addEventListener('click', () => { _stripStart = Math.min(STRIP_MAX - STRIP_LEN + 1, _stripStart + STRIP_LEN); buildDateStrip(document.getElementById('date-input').value); });
        box.querySelectorAll('.ds-day').forEach(b => b.addEventListener('click', () => {
            document.getElementById('date-input').value = b.dataset.ymd;
            updateDateDisplay();
            buildDateStrip(b.dataset.ymd);
            search(); // той самий маршрут, нова дата → шукаємо тут же
        }));
    }

    function initRoutePage() {
        const R = window.__ROUTE__;
        document.getElementById('departure').value = R.fromName; depId = R.fromId;
        document.getElementById('arrival').value = R.toName; arrId = R.toId;
        buildDateStrip(document.getElementById('date-input').value); // дата = сьогодні (вже виставлена)
        search();
    }

    // Глибоке посилання на пошук: /?from=<id>&to=<id>&date=YYYY-MM-DD → заповнити форму й запустити
    // (використовують сторінки маршрутів при зміні напрямку та шарабельні посилання на пошук).
    function applyQueryParams() {
        const p = new URLSearchParams(location.search);
        const fromId = p.get('from'), toId = p.get('to'), date = p.get('date');
        if (!fromId || !toId) return;
        const cf = cities.find(c => String(c.id) === String(fromId));
        const ct = cities.find(c => String(c.id) === String(toId));
        if (!cf || !ct) return;
        document.getElementById('departure').value = cf.name; depId = cf.id;
        document.getElementById('arrival').value = ct.name; arrId = ct.id;
        if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
            document.getElementById('date-input').value = date;
            updateDateDisplay();
        }
        search();
    }


    // Глибоке посилання на пошук: /?from=<id>&to=<id>&date=YYYY-MM-DD → заповнити форму й запустити
    // (використовують сторінки маршрутів при зміні напрямку та шарабельні посилання на пошук).
    function applyQueryParams() {
        const p = new URLSearchParams(location.search);
        const fromId = p.get('from'), toId = p.get('to'), date = p.get('date');
        if (!fromId || !toId) return;
        const cf = cities.find(c => String(c.id) === String(fromId));
        const ct = cities.find(c => String(c.id) === String(toId));
        if (!cf || !ct) return;
        document.getElementById('departure').value = cf.name; depId = cf.id;
        document.getElementById('arrival').value = ct.name; arrId = ct.id;
        if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
            document.getElementById('date-input').value = date;
            updateDateDisplay();
        }
        search();
    }

    function ac(inputId, listId, isDep) {
        const inp = document.getElementById(inputId);
        const lst = document.getElementById(listId);
        let hl = -1; // індекс підсвіченого пункту (клавіатурна навігація)

        const setHl = i => {
            const items = [...lst.querySelectorAll('.ac-item')];
            if (!items.length) return;
            hl = (i + items.length) % items.length; // циклічно
            items.forEach((el, j) => el.classList.toggle('hl', j === hl));
            items[hl].scrollIntoView({ block: 'nearest' });
        };

        inp.addEventListener('input', function () {
            const q = this.value.trim().toLowerCase();
            lst.innerHTML = ''; hl = -1;
            if (q.length < 2 || !cities.length) { lst.style.display = 'none'; return; }
            const res = cities.filter(c => c.name.toLowerCase().includes(q)).slice(0, 9);
            if (!res.length) { lst.style.display = 'none'; return; }
            res.forEach(city => {
                const el = document.createElement('div');
                el.className = 'ac-item';
                el.innerHTML = `<i class="fa-solid fa-location-dot"></i><span>` + escTxt(city.name).replace(new RegExp(`(${escRe(q)})`, 'gi'), '<strong>$1</strong>') + `</span>`;
                el.addEventListener('click', () => {
                    inp.value = city.name; lst.style.display = 'none'; hl = -1;
                    isDep ? (depId = city.id) : (arrId = city.id);
                });
                lst.appendChild(el);
            });
            lst.style.display = 'block';
        });

        // Стрілки вгору/вниз + Enter для вибору міста (на телефоні просто не спрацьовує - там тапи)
        inp.addEventListener('keydown', e => {
            const open = lst.style.display === 'block';
            if (!open) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); setHl(hl + 1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHl(hl - 1); }
            else if (e.key === 'Enter') {
                const items = lst.querySelectorAll('.ac-item');
                const pick = items[hl >= 0 ? hl : 0]; // Enter без стрілок = перший пункт
                if (pick) {
                    e.preventDefault();
                    e.stopPropagation(); // щоб глобальний Enter не запустив пошук цим же натисканням
                    pick.click();
                }
            } else if (e.key === 'Escape') { lst.style.display = 'none'; hl = -1; }
        });

        document.addEventListener('click', e => { if (e.target !== inp) lst.style.display = 'none'; });
    }

    document.getElementById('swap-btn').addEventListener('click', () => {
        const d = document.getElementById('departure'), a = document.getElementById('arrival');
        [d.value, a.value] = [a.value, d.value];
        [depId, arrId] = [arrId, depId];
        const btn = document.getElementById('swap-btn');
        btn.classList.remove('spin');
        void btn.offsetWidth;
        btn.classList.add('spin');
        btn.addEventListener('animationend', () => btn.classList.remove('spin'), { once: true });
    });

    async function search() {
        if (!depId || !arrId) { setStatus('Оберіть міста зі списку підказок', 'error'); setTimeout(() => setStatus('',''), 3000); return; }
        if (depId === arrId) { setStatus('Вкажіть різні міста', 'error'); return; }
        // На сторінці маршруту: якщо обрали ІНШИЙ напрямок - ведемо на головну з авто-пошуком
        // (URL сторінки завжди = її маршрут). Той самий маршрут (стрічка дат) шукаємо тут же.
        if (window.__ROUTE__ && (String(depId) !== String(window.__ROUTE__.fromId) || String(arrId) !== String(window.__ROUTE__.toId))) {
            location.href = `/?from=${depId}&to=${arrId}&date=${document.getElementById('date-input').value}`;
            return;
        }
        const [y, m, d] = document.getElementById('date-input').value.split('-');
        const date = `${d}.${m}.${y}`;
        setStatus('Шукаємо рейси...', 'loading');
        const searchBtn = document.getElementById('search-btn');
        searchBtn.disabled = true;
        searchBtn.classList.add('searching');
        searchBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Шукаємо...';
        const resultsEl = document.getElementById('results');
        resultsEl.innerHTML = '';
        // Skeleton - лише коли пошук затягується (>450мс). Швидкий/кешований - без мерехтіння.
        // Одразу ховаємо "Як це працює", щоб скелет був на видноті (під формою), а не нижче секції.
        const skelTimer = setTimeout(() => {
            const how = document.getElementById('how-it-works'); if (how) how.style.display = 'none';
            resultsEl.innerHTML = skeletonHtml();
        }, 450);
        try {
            const r = await fetch(`${PROXY_BASE}/search`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ from_id: depId, to_id: arrId, date, notrack: noTrack() })
            });
            clearTimeout(skelTimer);
            if (!r.ok) {
                const err = await r.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${r.status}`);
            }
            renderResults(await r.json(), date);
        } catch (e) { clearTimeout(skelTimer); resultsEl.innerHTML = ''; setStatus(`Помилка: ${e.message}`, 'error'); }
        finally {
            searchBtn.disabled = false;
            searchBtn.classList.remove('searching');
            searchBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Знайти рейс';
        }
    }

    // Пересадки: contrabus дає їх одним рядком ("Пересадка №1...Пересадка №2...").
    // Розбиваємо по "Пересадка №N" у окремі рядки - без круглих плашок, просто з крапкою.
    function transfersHtml(ci) {
        if (!ci) return 'Без пересадок, прямий рейс';
        const parts = String(ci).split(/(?=Пересадка\s*№?\s*\d)/).map(s => s.trim()).filter(Boolean);
        if (parts.length <= 1) return escTxt(ci);
        return `<div class="td-transfers">${parts.map(p => `<div class="tr-item"><i class="fa-solid fa-location-dot"></i> ${escTxt(p)}</div>`).join('')}</div>`;
    }

    // Картки-плейсхолдери на час повільного пошуку
    function skeletonHtml() {
        const card = `<div class="skel-card">
            <div class="skel-left">
                <div class="skel-bar" style="width:88px;height:30px"></div>
                <div class="skel-bar" style="width:120px;height:13px;margin-top:10px"></div>
                <div class="skel-bar" style="width:170px;height:11px;margin-top:8px"></div>
            </div>
            <div class="skel-right">
                <div class="skel-bar" style="width:96px;height:30px"></div>
                <div class="skel-bar" style="width:130px;height:40px;margin-top:14px;border-radius:8px"></div>
            </div>
        </div>`;
        return card.repeat(4);
    }

    const UA_MONTHS = ['січня','лютого','березня','квітня','травня','червня','липня','серпня','вересня','жовтня','листопада','грудня'];
    // "06.06.2026" -> "6 чер"
    function fmtNiceDate(d) {
        if (!d) return '';
        const [day, m] = d.split('.');
        if (!day || !m) return d;
        return `${parseInt(day, 10)} ${UA_MONTHS[parseInt(m, 10) - 1] || ''}`;
    }
    // travel_time (секунди) -> "49 год" або "2 дні 1 год"
    function fmtDuration(sec) {
        if (!sec || isNaN(sec)) return '';
        const h = Math.round(sec / 3600);
        if (h < 24) return `${h} год`;
        const days = Math.floor(h / 24), rh = h % 24;
        return `${days} ${days === 1 ? 'день' : (days < 5 ? 'дні' : 'днів')}${rh ? ' ' + rh + ' год' : ''}`;
    }

    // Стислий опис пересадок: "2 пересадки · Дніпро, Хмельницький" (повний текст - у tooltip)
    function fmtTransfers(text) {
        if (!text || !text.trim()) return null;
        const cities = [];
        const re = /м\.\s*([А-ЯІЇЄҐ][а-яіїєґА-ЯІЇЄҐ'’\- ]*?)(?=,|\.|\s+та\s|$)/g;
        let m;
        while ((m = re.exec(text)) !== null) {
            const c = m[1].trim().replace(/\s+/g, ' ');
            if (c && !cities.includes(c)) cities.push(c);
        }
        const n = cities.length;
        if (!n) { const t = text.trim(); return { label: t.length > 36 ? t.slice(0, 36) + '…' : t, full: text }; }
        const word = n === 1 ? 'пересадка' : (n < 5 ? 'пересадки' : 'пересадок');
        return { label: `${n} ${word} · ${cities.join(', ')}`, full: text };
    }

    // Узгодження слова "рейс" з числом
    function routeWord(n) {
        if (n % 10 === 1 && n % 100 !== 11) return 'рейс';
        if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'рейси';
        return 'рейсів';
    }

    // Підказка, коли рейсів немає: найближча дата або найближчі міста
    async function fetchSuggest(date) {
        try {
            const r = await fetch(`${PROXY_BASE}/suggest`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ from_id: depId, to_id: arrId, date })
            });
            const s = await r.json();
            const box = document.getElementById('suggest-box');
            if (!box) return;
            if (s.type === 'date') {
                box.innerHTML = `<div class="sg-title"><i class="fa-regular fa-lightbulb"></i> На обрану дату рейсів немає, але є на ${s.date}:</div>
                    <button class="sg-btn sg-primary" id="sg-date">Показати рейси на ${s.date} <span class="sg-dist">${s.count} ${routeWord(s.count)}</span> <i class="fa-solid fa-arrow-right"></i></button>`;
                document.getElementById('sg-date').addEventListener('click', () => setDateAndSearch(s.date));
            } else if (s.type === 'cities') {
                window._alts = s.alternatives;
                box.innerHTML = `<div class="sg-title"><i class="fa-regular fa-lightbulb"></i> Прямих рейсів немає. Натисніть місто поряд, щоб переглянути рейси:</div>
                    <div class="sg-cities">${s.alternatives.map((a, i) =>
                        `<button class="sg-btn sg-city" data-ai="${i}"><i class="fa-solid fa-location-dot"></i> ${a.name} <span class="sg-dist">~${a.distance_km} км · ${a.count} ${routeWord(a.count)}</span></button>`
                    ).join('')}</div>`;
                box.querySelectorAll('.sg-city').forEach(b => b.addEventListener('click', () => {
                    const a = window._alts[b.dataset.ai];
                    setCityAndSearch(a.id, a.name);
                }));
            } else {
                box.innerHTML = `<div class="sg-none">Спробуйте іншу дату чи напрямок або зверніться до менеджера нижче.</div>`;
            }
        } catch (e) {
            const box = document.getElementById('suggest-box');
            if (box) box.innerHTML = '';
        }
    }

    function setDateAndSearch(ddmmyyyy) {
        const [d, m, y] = ddmmyyyy.split('.');
        document.getElementById('date-input').value = `${y}-${m}-${d}`;
        updateDateDisplay();
        search();
    }
    function setCityAndSearch(cid, cname) {
        document.getElementById('arrival').value = cname;
        arrId = cid;
        search();
    }

    // Екранування тексту з API для вставки в HTML (включно з лапками -
    // назви перевізників/вокзалів типу ТОВ "Люкс" інакше ламають title="...")
    const escTxt = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    // Екранування для безпечної вставки рядка в RegExp (інакше "(", "[", "\" ламають підказки)
    const escRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Ціна з урахуванням валюти рейсу (UAH/EUR/...). Рейси з Європи приходять у євро!
    const CUR = { UAH: '₴', EUR: '€', USD: '$', PLN: 'zł', GBP: '£', CZK: 'Kč', MDL: 'lei', RON: 'lei' };
    const fmtPrice = rt => (rt && rt.price) ? `${rt.price} ${CUR[rt.currency] || rt.currency || '₴'}` : '';

    // Зручності рейсу: код API → іконка + назва
    const AMENITIES = {
        wifi: { i: 'fa-wifi', t: 'Wi-Fi' },
        power: { i: 'fa-plug', t: 'Розетки' },
        air: { i: 'fa-snowflake', t: 'Кондиціонер' },
        wc: { i: 'fa-restroom', t: 'Туалет' },
        pets: { i: 'fa-paw', t: 'Можна з тваринами' },
        gps: { i: 'fa-location-crosshairs', t: 'GPS-трекінг' },
        seatselect: { i: 'fa-chair', t: 'Вибір місця' },
        addstop: { i: 'fa-map-pin', t: 'Додаткові зупинки' },
        '16_noaccompany': { i: 'fa-child-reaching', t: 'Діти 16+ без супроводу' },
        noprepayment: { i: 'fa-hand-holding-dollar', t: 'Без передоплати' },
        norefund: { i: 'fa-ban', t: 'Без повернення квитка' }
    };
    function amenitiesHtml(codes) {
        if (!Array.isArray(codes) || !codes.length) return '';
        // 'noprepayment' - послуга перевізника загалом і може суперечити умовам
        // конкретного рейсу (label_type) - тип оплати показуємо лише у рядку "Оплата"
        const chips = codes.filter(c => c !== 'noprepayment').map(code => {
            const a = AMENITIES[code] || { i: 'fa-circle-info', t: code };
            return `<span class="amen"><i class="fa-solid ${a.i}"></i> ${escTxt(a.t)}</span>`;
        }).join('');
        return `<div class="td-row"><div class="td-label">Зручності</div><div class="td-amens">${chips}</div></div>`;
    }

    // Прибираємо дублювання міста на початку адреси станції ("Запоріжжя, Автовокзал…" → "Автовокзал…")
    function stripCityTxt(station, city) {
        const s = String(station || '').trim();
        if (city && s.toLowerCase().startsWith(String(city).toLowerCase() + ',')) {
            return s.slice(String(city).length + 1).trim();
        }
        return s;
    }

    // Тип оплати рейсу для блоку деталей
    function paymentHtml(rt) {
        const cat = payCategory(rt);
        const label = cat === 'none'
            ? '<span class="pay-badge pb-none"><i class="fa-regular fa-credit-card"></i> Без передоплати</span>'
            : cat === 'group'
                ? '<span class="pay-badge pb-none"><i class="fa-regular fa-credit-card"></i> Без передоплати</span><span class="pay-badge pb-part"><i class="fa-solid fa-users"></i> Для груп - передоплата</span>'
            : (cat === 'partial'
                ? '<span class="pay-badge pb-part"><i class="fa-solid fa-coins"></i> Часткова передоплата</span>'
                : '<span class="pay-badge pb-full"><i class="fa-solid fa-money-bill-wave"></i> Повна передоплата</span>');
        return `<div class="pay-badges">${label}</div>` + (rt.price_label ? `<div class="pay-note">${escTxt(rt.price_label)}</div>` : '');
    }

    function renderResults(routes, date) {
        const el = document.getElementById('results');
        const dep = document.getElementById('departure').value;
        const arr = document.getElementById('arrival').value;
        const how = document.getElementById('how-it-works'); if (how) how.style.display = 'none';

        if (!Array.isArray(routes) || !routes.length) {
            el.innerHTML = `<div class="no-res">
                <div class="no-res-ico"><i class="fa-solid fa-bus-simple"></i></div>
                <h3>Рейсів не знайдено</h3>
                <p>На ${date} за напрямком ${dep} → ${arr} рейсів немає.</p>
                <div class="suggest-box" id="suggest-box">
                    <div class="sg-loading"><i class="fa-solid fa-spinner fa-spin"></i> Шукаємо найближчі дати та міста...</div>
                    <div class="sg-skel">
                        <div class="skel-bar" style="width:230px;height:44px;border-radius:50px"></div>
                        <div class="skel-bar" style="width:180px;height:44px;border-radius:50px"></div>
                    </div>
                </div>
            </div>`;
            setStatus('Рейсів не знайдено', '');
            fetchSuggest(date);
            return;
        }
        setStatus(`Знайдено рейсів: ${routes.length}`, 'success');
        _routes = routes; _dep = dep; _arr = arr; _date = date;

        el.innerHTML = `
            <div class="res-hdr">
                <div class="res-title">${dep} → ${arr} · ${date}</div>
                <div class="res-badge">${routes.length} рейсів</div>
            </div>
            <div class="sort-bar">
                <span class="sort-lbl"><i class="fa-solid fa-arrow-down-short-wide"></i> Сортувати:</span>
                <button class="sort-btn" data-sort="price">Найдешевші</button>
                <button class="sort-btn" data-sort="duration">Найшвидші</button>
                <button class="sort-btn" data-sort="departure">За часом виїзду</button>
            </div>
            <div class="sort-bar filter-bar">
                <span class="sort-lbl sort-lbl-f"><i class="fa-solid fa-filter"></i> Фільтри:</span>
                <button class="sort-btn filter-btn" data-filter="noprepay"><i class="fa-regular fa-credit-card"></i> Без передоплати</button>
                <button class="sort-btn filter-btn" data-filter="direct"><i class="fa-solid fa-route"></i> Без пересадок</button>
                <button class="sort-btn filter-btn" data-filter="pets"><i class="fa-solid fa-paw"></i> З твариною</button>
            </div>
            <div id="tickets"></div>`;

        el.querySelectorAll('.sort-btn[data-sort]').forEach(b => b.addEventListener('click', () => {
            _sortBy = b.dataset.sort;
            renderTickets();
        }));
        el.querySelectorAll('.filter-btn').forEach(b => b.addEventListener('click', () => {
            const k = b.dataset.filter;
            _filters.has(k) ? _filters.delete(k) : _filters.add(k);
            renderTickets();
        }));
        renderTickets();
    }

    // Час "HH:MM" -> хвилини; повна дата+час рейсу -> timestamp для сортування за виїздом
    function routeDepartTs(rt) {
        const [dd, mm, yy] = (rt.date || _date || '').split('.');
        const [h, mi] = (rt.departure_time || rt.time_from || '0:0').split(':');
        return new Date(+yy || 0, (+mm || 1) - 1, +dd || 1, +h || 0, +mi || 0).getTime();
    }

    function renderTickets() {
        const tickets = document.getElementById('tickets');
        document.querySelectorAll('.sort-btn[data-sort]').forEach(b => b.classList.toggle('active', b.dataset.sort === _sortBy));
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', _filters.has(b.dataset.filter)));

        // Фільтри (порожній набір = усі рейси)
        const pool = _filters.size ? _routes.filter(matchesFilters) : _routes;

        // Оновлюємо лічильник рейсів у шапці результатів під фільтр
        const badge = document.querySelector('.res-badge');
        if (badge) badge.textContent = `${pool.length} ${routeWord(pool.length)}`;

        if (_filters.size && !pool.length) {
            tickets.innerHTML = `<div class="no-res"><div class="no-res-ico"><i class="fa-solid fa-filter"></i></div><h3>Таких рейсів немає</h3><p>На цьому напрямку немає рейсів під обрані фільтри.<br>Вимкніть фільтр, щоб побачити всі варіанти.</p></div>`;
            return;
        }

        _view = pool.slice().sort((a, b) => {
            if (_sortBy === 'price')    return (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0);
            if (_sortBy === 'duration') return (a.travel_time || Infinity) - (b.travel_time || Infinity);
            return routeDepartTs(a) - routeDepartTs(b); // departure
        });

        tickets.innerHTML = _view.map((rt, i) => {
            // Усі рядки з API екрануємо (escTxt) — захист на випадок несподіваного HTML у даних
            const dt    = escTxt(rt.departure_time || rt.time_from || '-:-');
            const at    = escTxt(rt.arrival_time   || rt.time_to   || '-:-');
            const ddate = escTxt(fmtNiceDate(rt.date || _date));
            const adate = escTxt(fmtNiceDate(rt.arrival_date));
            const fromCity = escTxt(rt.from || _dep);
            const toCity   = escTxt(rt.to   || _arr);
            const pr    = escTxt(fmtPrice(rt) || '-');
            const st    = escTxt(rt.free_seats !== undefined ? rt.free_seats : '?');
            const car   = escTxt(rt.carrier || rt.company || 'Автобус');
            const dur   = fmtDuration(rt.travel_time);
            return `<div class="ticket" style="animation-delay:${Math.min(i*0.06,0.3)}s">
                <div class="t-main">
                    <div class="t-ep">
                        <div class="t-time">${dt}</div>
                        ${ddate ? `<div class="t-date">${ddate}</div>` : ''}
                        <div class="t-city">${fromCity}</div>
                        ${rt.departure_station ? `<div class="t-station" title="${escTxt(rt.departure_station)}">${escTxt(stripCityTxt(rt.departure_station, fromCity))}</div>` : ''}
                    </div>
                    <div class="t-route">
                        ${dur ? `<div class="t-dur"><i class="fa-regular fa-clock"></i> ${dur} в дорозі</div>` : ''}
                        <div class="t-line"><div class="t-dot"></div><div class="t-dash"></div><span class="t-line-chip ${isDirect(rt) ? 'tlc-ok' : ''}">${isDirect(rt) ? 'без пересадок' : 'з пересадкою'}</span><div class="t-dash"></div><div class="t-arrow"><i class="fa-solid fa-chevron-right"></i></div></div>
                        <div class="t-carrier" title="${car}"><i class="fa-solid fa-bus"></i><span class="t-car-name">${car}</span></div>
                    </div>
                    <div class="t-ep" style="text-align:right">
                        <div class="t-time">${at}</div>
                        ${adate ? `<div class="t-date">${adate}</div>` : ''}
                        <div class="t-city">${toCity}</div>
                        ${rt.arrival_station ? `<div class="t-station" title="${escTxt(rt.arrival_station)}">${escTxt(stripCityTxt(rt.arrival_station, toCity))}</div>` : ''}
                    </div>
                    <div class="t-divider"></div>
                    <div class="t-action">
                        <div class="t-pricebox">
                            <div class="t-price">${pr}</div>
                            <div class="t-price-sub">за місце</div>
                            <div class="t-seats"><i class="fa-solid fa-chair"></i> ${st} вільних</div>
                        </div>
                    </div>
                </div>
                <div class="t-foot">
                    <button class="t-toggle" type="button" data-i="${i}">Деталі рейсу <i class="fa-solid fa-chevron-down"></i></button>
                    <button class="btn-ticket" data-i="${i}">${rt.bookable ? 'Забронювати' : 'Замовити'}</button>
                </div>
                <div class="t-details">
                    ${amenitiesHtml(rt.carrier_amenities)}
                    <div class="td-row"><div class="td-label">Оплата</div><div class="td-text">${paymentHtml(rt)}</div></div>
                    <div class="td-row"><div class="td-label">Знижки</div><div class="td-text td-disc">-</div></div>
                    <div class="td-row"><div class="td-label">Пересадки</div><div class="td-text">${transfersHtml(rt.change_info)}</div></div>
                    <div class="td-row"><div class="td-label">Перевізник</div><div class="td-text td-carrier">${car}${rt.carrier_rating ? ` <span class="carr-badge cb-star"><i class="fa-solid fa-star"></i> ${escTxt(rt.carrier_rating)}</span>` : ''}${rt.carrier_reliability ? ` <span class="carr-badge cb-rel"><i class="fa-solid fa-shield-halved"></i> надійність ${escTxt(rt.carrier_reliability)}%</span>` : ''}</div></div>
                    ${rt.baggage ? `<div class="td-row"><div class="td-label">Багаж</div><div class="td-text">${escTxt(rt.baggage)}</div></div>` : ''}
                </div>
            </div>`;
        }).join('');

        tickets.querySelectorAll('.btn-ticket').forEach(b => {
            b.addEventListener('click', () => openModal(_view[b.dataset.i], _dep, _arr, _date));
            // Предзавантаження знижок ще до кліку (на наведення курсором / дотик)
            const pf = () => prefetchDiscounts(_view[b.dataset.i]);
            b.addEventListener('pointerenter', pf);
            b.addEventListener('touchstart', pf, { passive: true });
        });
        tickets.querySelectorAll('.t-toggle').forEach(b => {
            const pf = () => prefetchDiscounts(_view[b.dataset.i]);
            b.addEventListener('pointerenter', pf);
            b.addEventListener('touchstart', pf, { passive: true });
            b.addEventListener('click', () => {
            const ticket = b.closest('.ticket');
            const det = ticket.querySelector('.t-details');
            const open = det.classList.toggle('open');
            b.classList.toggle('open', open);
            if (open && det.dataset.discLoaded !== '1') {
                det.dataset.discLoaded = '1';
                loadDiscounts(_view[b.dataset.i], ticket.querySelector('.td-disc'));
            }
            });
        });
    }

    // Підвантаження знижок рейсу при відкритті деталей
    // Кеш знижок за data_bundle: один запит на рейс за сесію (спільний для деталей і модалки)
    const _discByBundle = new Map();
    function fetchDiscounts(bundle) {
        if (!bundle) return Promise.resolve([]);
        if (_discByBundle.has(bundle)) return _discByBundle.get(bundle); // Promise або масив - await обробить обидва
        const p = fetch(`${PROXY_BASE}/discounts`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data_bundle: bundle })
        }).then(r => r.json()).then(d => {
            const arr = Array.isArray(d) ? d : [];
            _discByBundle.set(bundle, arr); // замінюємо Promise готовим масивом
            return arr;
        }).catch(() => { _discByBundle.delete(bundle); return []; });
        _discByBundle.set(bundle, p); // кешуємо Promise одразу, щоб паралельні виклики не дублювали запит
        return p;
    }
    // Предзавантаження на наведення/дотик - щоб на момент кліку знижки вже були готові
    function prefetchDiscounts(rt) { if (rt && rt.data_bundle) fetchDiscounts(rt.data_bundle); }

    async function loadDiscounts(rt, el) {
        if (!el) return;
        if (!rt || !rt.data_bundle) { el.textContent = 'Інформація недоступна'; return; }
        const cached = _discByBundle.get(rt.data_bundle);
        if (!Array.isArray(cached)) el.textContent = 'Завантаження…'; // показуємо лише якщо реально чекаємо мережу
        const d = await fetchDiscounts(rt.data_bundle);
        const real = (Array.isArray(d) ? d : []).filter(x => x.percent > 0);
        el.innerHTML = real.length
            ? `<div class="disc-chips">${real.map(x => `<span class="disc-chip"><i class="fa-solid fa-tag"></i> ${escTxt(x.description)}</span>`).join('')}</div>`
            : 'Спеціальних знижок немає';
    }

    // ---------- Пасажири + знижки ----------
    let _modalDiscounts = [];   // знижки поточного рейсу
    let _paxDiscSel = [];        // обрана знижка (id) для кожного пасажира за індексом
    let _discOpen = false;       // блок знижок розгорнутий?

    function paxRowHtml() {
        return `<div class="pax-row">
            <div class="pax-head">
                <span class="pax-title"></span>
                <button type="button" class="pax-del"><i class="fa-solid fa-circle-xmark"></i> Видалити</button>
            </div>
            <div class="pax-grid">
                <div class="fg"><label class="f-lbl">Ім'я</label><input type="text" class="f-inp pax-name" placeholder="Іван"></div>
                <div class="fg"><label class="f-lbl">Прізвище</label><input type="text" class="f-inp pax-surname" placeholder="Петренко"></div>
                <div class="fg pax-phone-fg"><label class="f-lbl">Телефон</label><input type="tel" class="f-inp pax-phone" placeholder="+380 XX XXX XX XX" inputmode="tel"></div>
            </div>
        </div>`;
    }
    function renumberPax() {
        const rows = document.querySelectorAll('#pax-list .pax-row');
        rows.forEach((row, i) => {
            row.querySelector('.pax-title').textContent = `Пасажир №${i + 1}`;
            row.querySelector('.pax-del').style.display = rows.length > 1 ? '' : 'none';
        });
    }
    const seatWord = n => n === 1 ? 'місце' : (n < 5 ? 'місця' : 'місць');

    // Блок знижок усередині "Додатково" - селекти показуємо одразу, без вкладеного розкриття
    function renderDiscBlock() {
        const block = document.getElementById('disc-block');
        const rows = [...document.querySelectorAll('#pax-list .pax-row')];
        const real = _modalDiscounts.filter(d => d.percent > 0); // ховаємо "Повний" та 0% (напр. промокод)
        if (!real.length || !rows.length) { block.style.display = 'none'; block.innerHTML = ''; document.getElementById('m-disc-note').style.display = 'none'; _discOpen = false; updateTotal(); return; }
        block.style.display = '';
        _discOpen = true; // знижки доступні - selectи активні (за замовчуванням "Повний квиток")
        // опції: "Повний квиток" (за замовчуванням) + реальні знижки
        const opts = [{ id: '', percent: 0, label: 'Повний квиток' }].concat(real.map(d => ({ id: d.id, percent: d.percent, label: d.description })));
        block.innerHTML = `
            <div class="disc-head"><span class="disc-title"><i class="fa-solid fa-tag" style="color:var(--orange);margin-right:6px"></i>Знижка для пасажирів</span></div>
            <div class="disc-body">
                ${rows.map((r, i) => {
                    const cur = _paxDiscSel[i] != null ? String(_paxDiscSel[i]) : '';
                    return `<div class="disc-row">
                        <span class="disc-name">Пасажир №${i + 1}</span>
                        <select class="f-inp disc-sel" data-i="${i}">${opts.map(o => `<option value="${o.id}" data-pct="${o.percent}" ${String(o.id) === cur ? 'selected' : ''}>${escTxt(o.label)}</option>`).join('')}</select>
                        <span class="disc-price" data-i="${i}"></span>
                    </div>`;
                }).join('')}
            </div>`;
        block.querySelectorAll('.disc-sel').forEach(s => s.addEventListener('change', () => { _paxDiscSel[+s.dataset.i] = s.value; refreshDisc(); }));
        refreshDisc();
    }
    function paxPct(i) {
        if (!_discOpen) return 0;
        const s = document.querySelector(`#disc-block .disc-sel[data-i="${i}"]`);
        return (s && s.selectedOptions[0]) ? (+s.selectedOptions[0].dataset.pct || 0) : 0;
    }
    function refreshDisc() {
        const base = parseFloat(selRoute && selRoute.price) || 0;
        const cur = CUR[selRoute && selRoute.currency] || (selRoute && selRoute.currency) || '₴';
        let anyDisc = false;
        document.querySelectorAll('#disc-block .disc-sel').forEach(s => {
            const pct = +s.selectedOptions[0].dataset.pct || 0;
            if (pct > 0) anyDisc = true;
            const price = Math.round(base * (1 - pct / 100) * 100) / 100;
            const pe = document.querySelector(`#disc-block .disc-price[data-i="${s.dataset.i}"]`);
            if (pe) pe.innerHTML = base ? (pct > 0 ? `<span class="pp-old">${base} ${cur}</span> <b class="pp-new">${price} ${cur}</b>` : `<b class="pp-new">${price} ${cur}</b>`) : '';
        });
        document.getElementById('m-disc-note').style.display = (_discOpen && anyDisc) ? '' : 'none';
        updateTotal();
    }
    function updateTotal() {
        const base = parseFloat(selRoute && selRoute.price) || 0;
        const rows = [...document.querySelectorAll('#pax-list .pax-row')];
        const cur = CUR[selRoute && selRoute.currency] || (selRoute && selRoute.currency) || '₴';
        let total = 0;
        rows.forEach((r, i) => { total += base * (1 - paxPct(i) / 100); });
        document.getElementById('m-total').innerHTML = base
            ? `Разом за ${rows.length} ${seatWord(rows.length)}: <b>${Math.round(total * 100) / 100} ${cur}</b>`
            : '';
    }
    function addPax() {
        const list = document.getElementById('pax-list');
        list.insertAdjacentHTML('beforeend', paxRowHtml());
        const row = list.lastElementChild;
        row.querySelector('.pax-del').addEventListener('click', () => {
            const idx = [...list.children].indexOf(row);
            row.remove();
            if (idx >= 0) _paxDiscSel.splice(idx, 1);
            renumberPax(); renderDiscBlock();
        });
        renumberPax();
        renderDiscBlock();
        return row;
    }
    // Нормалізація телефону при виході з поля: 067... → +38067..., 380... → +380...
    // (те саме робить і сервер - тут лише щоб людина одразу бачила результат)
    const normPhone = raw => {
        let s = String(raw || '').trim().replace(/[\s\-().]/g, '');
        if (/^00\d{8,}$/.test(s)) s = '+' + s.slice(2);
        if (s.startsWith('+')) return s;
        if (/^380\d{9}$/.test(s)) return '+' + s;
        if (/^0\d{9}$/.test(s)) return '+38' + s;
        return raw.trim();
    };
    document.getElementById('pax-list').addEventListener('focusout', e => {
        if (e.target.classList && e.target.classList.contains('pax-phone')) e.target.value = normPhone(e.target.value);
    });

    document.getElementById('add-pax').addEventListener('click', () => {
        const row = addPax();
        row.querySelector('.pax-name').focus();
        row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    // Підвантажити знижки рейсу (через спільний кеш - миттєво, якщо вже предзавантажено)
    async function loadModalDiscounts(rt) {
        _modalDiscounts = await fetchDiscounts(rt && rt.data_bundle);
        if (selRoute === rt) renderDiscBlock(); // оновлюємо, лише якщо модалка ще на цьому рейсі
    }

    let _bookMode = false; // true = рейс без передоплати, бронюємо одразу
    const petChosen = () => document.getElementById('pet-select').value === 'yes';
    // Реальна можливість автоброні: рейс bookable І їде БЕЗ тварини (з твариною - лише менеджер)
    const canBookNow = () => _bookMode && !petChosen();
    // Оновлює заголовок/підказку/кнопку відповідно до того, чи буде автобронь
    function applyBookUI() {
        const book = canBookNow();
        document.getElementById('m-title').textContent = book ? 'Бронювання поїздки' : 'Замовити поїздку';
        document.getElementById('m-booknote').style.display = book ? 'flex' : 'none';
        document.getElementById('m-submit').innerHTML = book
            ? '<i class="fa-solid fa-bolt"></i> Забронювати'
            : '<i class="fa-solid fa-paper-plane"></i> Надіслати';
    }
    // Блокування прокрутки фону, поки відкрита модалка (надійно для iOS - через position:fixed)
    let _scrollY = 0;
    function lockScroll() {
        _scrollY = window.scrollY;
        document.body.style.position = 'fixed';
        document.body.style.top = `-${_scrollY}px`;
        document.body.style.left = '0';
        document.body.style.right = '0';
        document.body.style.width = '100%';
    }
    function unlockScroll() {
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.left = '';
        document.body.style.right = '';
        document.body.style.width = '';
        window.scrollTo(0, _scrollY);
    }
    function closeBooking() {
        document.getElementById('modal-bg').classList.remove('open');
        unlockScroll();
    }
    function openModal(rt, dep, arr, date) {
        selRoute = rt;
        _bookMode = !!rt.bookable;
        _modalDiscounts = []; _paxDiscSel = []; _discOpen = false;
        const dt = rt.departure_time || rt.time_from || '';
        document.querySelector('#m-route span').textContent = `${dep} → ${arr}`;
        // Зведення рейсу - щоб клієнт бачив, що саме бронює
        const at = rt.arrival_time || rt.time_to || '';
        const dur = fmtDuration(rt.travel_time);
        const fromSt = rt.departure_station ? stripCityTxt(rt.departure_station, dep) : '';
        const toSt = rt.arrival_station ? stripCityTxt(rt.arrival_station, arr) : '';
        document.getElementById('m-trip').innerHTML =
            `<div class="mt-row"><i class="fa-regular fa-calendar"></i> <b>${escTxt(fmtNiceDate(rt.date || _date))}</b></div>` +
            `<div class="mt-row"><i class="fa-regular fa-clock"></i> ${escTxt(dt || '-')}${at ? ' → ' + escTxt(at) : ''}${dur ? ` <span class="mt-dur">${escTxt(dur)}</span>` : ''}</div>` +
            `<div class="mt-row"><i class="fa-solid fa-tag"></i> <b>${escTxt(fmtPrice(rt) || '-')}</b>&nbsp;/&nbsp;місце</div>` +
            `<div class="mt-row"><i class="fa-solid fa-bus"></i> ${escTxt(rt.carrier || rt.company || 'Автобус')}</div>` +
            ((fromSt || toSt) ? `<div class="mt-stations">${fromSt ? `<span><i class="fa-solid fa-location-dot"></i> ${escTxt(fromSt)}</span>` : ''}${toSt ? `<span><i class="fa-solid fa-flag-checkered"></i> ${escTxt(toSt)}</span>` : ''}</div>` : '');
        document.getElementById('m-form').style.display = 'block';
        document.getElementById('m-ok').style.display = 'none';
        document.getElementById('c-comment').value = '';
        document.getElementById('c-hp').value = '';
        document.getElementById('disc-block').innerHTML = '';
        document.getElementById('m-disc-note').style.display = 'none';
        // "Додатково" згорнуто; поле тварини - лише якщо рейс дозволяє тварин
        document.getElementById('more-body').style.display = 'none';
        document.getElementById('more-chev').className = 'fa-solid fa-chevron-down';
        document.getElementById('pet-select').value = 'no';
        document.getElementById('pet-note').style.display = 'none';
        document.getElementById('pet-field').style.display = allowsPets(rt) ? 'block' : 'none';
        document.getElementById('pax-list').innerHTML = '';
        addPax(); // один порожній пасажир за замовчуванням
        applyBookUI();
        document.getElementById('modal-bg').classList.add('open');
        lockScroll(); // блокуємо фон, щоб не "просвічував" скрол головної
        loadModalDiscounts(rt); // підвантажуємо знижки асинхронно
    }

    // Розгортання розділу "Додатково"
    document.getElementById('more-toggle').addEventListener('click', () => {
        const b = document.getElementById('more-body');
        const open = b.style.display !== 'none';
        b.style.display = open ? 'none' : 'block';
        document.getElementById('more-chev').className = open ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up';
    });
    // Зміна "з твариною" - показуємо примітку й перемикаємо режим кнопки (бронь ↔ заявка)
    document.getElementById('pet-select').addEventListener('change', () => {
        document.getElementById('pet-note').style.display = petChosen() ? 'flex' : 'none';
        applyBookUI();
    });

    document.getElementById('m-cancel').addEventListener('click', closeBooking);
    document.getElementById('modal-bg').addEventListener('click', e => { if (e.target === document.getElementById('modal-bg')) closeBooking(); });
    document.getElementById('m-submit').addEventListener('click', async () => {
        const rows = [...document.querySelectorAll('#pax-list .pax-row')];
        const passengers = [];
        let firstError = null;
        rows.forEach((row, i) => {
            const nameEl = row.querySelector('.pax-name'), surEl = row.querySelector('.pax-surname'), phEl = row.querySelector('.pax-phone');
            const name = nameEl.value.trim(), surname = surEl.value.trim(), phone = phEl.value.trim();
            const digits = (phone.match(/\d/g) || []).length;
            [nameEl, surEl, phEl].forEach(el => el.style.borderColor = '');
            let ok = true;
            if (name.length < 1) { nameEl.style.borderColor = 'var(--red)'; ok = false; }
            if (surname.length < 1) { surEl.style.borderColor = 'var(--red)'; ok = false; }
            if (!phone || digits < 9) { phEl.style.borderColor = 'var(--red)'; ok = false; if (phone && digits < 9 && !firstError) firstError = 'Перевірте номер телефону - здається, він введений неповністю.'; }
            if (!ok && !firstError) firstError = 'Заповніть дані всіх пасажирів.';
            // знижка (якщо обрана) - з блоку під коментарем за індексом пасажира
            const sel = _discOpen ? document.querySelector(`#disc-block .disc-sel[data-i="${i}"]`) : null;
            let ticket_type = '', discount_label = '', discount_percent = 0;
            if (sel && sel.selectedOptions[0] && +sel.selectedOptions[0].dataset.pct > 0) {
                ticket_type = sel.value;
                discount_label = sel.selectedOptions[0].textContent;
                discount_percent = +sel.selectedOptions[0].dataset.pct || 0;
            }
            passengers.push({ name, surname, phone, ticket_type, discount_label, discount_percent });
        });
        if (firstError) { alert(firstError); return; }

        const willBook = canBookNow();
        const btn = document.getElementById('m-submit');
        btn.disabled = true;
        btn.innerHTML = willBook ? '<i class="fa-solid fa-spinner fa-spin"></i> Бронюємо...' : '<i class="fa-solid fa-spinner fa-spin"></i> Надсилаємо...';

        const rt = selRoute || {};
        const payload = {
            passengers,
            comment: document.getElementById('c-comment').value.trim(),
            route_from: document.getElementById('departure').value,
            route_to: document.getElementById('arrival').value,
            route_date: (document.getElementById('date-input').value.split('-').reverse().join('.')),
            route_time: rt.departure_time || rt.time_from || '',
            route_price: fmtPrice(rt),
            route_carrier: rt.carrier || rt.company || '',
            route_from_station: rt.departure_station || '',
            route_to_station: rt.arrival_station || '',
            data_bundle: rt.data_bundle || '', // для перевірки чорного списку/дублів та броні
            book: willBook,                    // прохання про автобронь (з твариною - вимкнено)
            pet: petChosen(),                  // їде з твариною → лише менеджер
            from_id: depId, to_id: arrId,      // для серверної перевірки рейсу перед бронюванням
            hp: document.getElementById('c-hp').value // honeypot
        };

        try {
            const r = await fetch(`${PROXY_BASE}/order`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!r.ok) {
                const err = await r.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${r.status}`);
            }
            const j = await r.json().catch(() => ({}));
            const tks = (j.booked && Array.isArray(j.tickets)) ? j.tickets.filter(t => t.pdf) : [];
            if (j.booked) {
                document.getElementById('m-ok-title').textContent = 'Місця заброньовано!';
                document.getElementById('m-ok-text').innerHTML = tks.length
                    ? 'Оплата - водієві при посадці.<br>Збережіть свої квитки:'
                    : 'Оплата - водієві при посадці.<br>Квитки надішле менеджер найближчим часом.';
                document.getElementById('m-ok-tickets').innerHTML = tks.map((tk, i) =>
                    `<a class="tk-link" href="${escTxt(tk.pdf)}" target="_blank" rel="noopener"><i class="fa-solid fa-file-pdf"></i> Завантажити квиток${tks.length > 1 ? ' ' + (i + 1) : ''}</a>`).join('');
            } else {
                document.getElementById('m-ok-title').textContent = 'Заявку прийнято!';
                document.getElementById('m-ok-text').innerHTML = "Наш менеджер зв'яжеться<br>з вами найближчим часом.";
                document.getElementById('m-ok-tickets').innerHTML = '';
            }
            document.getElementById('m-form').style.display = 'none';
            document.getElementById('m-ok').style.display = 'block';
        } catch (e) {
            alert('Не вдалося надіслати заявку: ' + e.message + '\n\nСпробуйте ще раз або зателефонуйте менеджеру.');
        } finally {
            btn.disabled = false;
            btn.innerHTML = canBookNow()
                ? '<i class="fa-solid fa-bolt"></i> Забронювати'
                : '<i class="fa-solid fa-paper-plane"></i> Надіслати';
        }
    });
    document.getElementById('m-close').addEventListener('click', closeBooking);
    const modalBg = document.getElementById('modal-bg');
    document.addEventListener('keydown', e => {
        // Enter запускає пошук лише коли модалка закрита (інакше заважає заповнювати форму)
        if (e.key === 'Enter' && !modalBg.classList.contains('open')) search();
    });
    // Доступність модалки: Escape закриває, Tab циклить фокус усередині (focus-trap)
    document.addEventListener('keydown', e => {
        if (!modalBg.classList.contains('open')) return;
        if (e.key === 'Escape') { closeBooking(); return; }
        // Мобільний баг: Enter ховає клавіатуру, але поле лишається у фокусі
        // і блокує прокрутку модалки - тому знімаємо фокус самі.
        // У textarea коментаря preventDefault також прибирає зайвий новий рядок.
        if (e.key === 'Enter' && e.target && e.target.matches('#modal-bg input, #modal-bg textarea')) {
            e.preventDefault();
            e.target.blur();
            return;
        }
        if (e.key !== 'Tab') return;
        const els = [...modalBg.querySelectorAll('input, textarea, select, button, a[href]')]
            .filter(el => el.offsetParent !== null && !el.disabled);
        if (!els.length) return;
        const first = els[0], last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    // Європейський формат дати: YYYY-MM-DD -> DD.MM.YYYY
    function updateDateDisplay() {
        const inp = document.getElementById('date-input');
        const span = document.getElementById('date-display');
        if (!inp.value) { span.textContent = 'Оберіть дату'; span.style.color = 'var(--text-3)'; return; }
        const [y, m, d] = inp.value.split('-');
        span.textContent = `${d}.${m}.${y}`;
        span.style.color = 'var(--text)';
    }

    // Дата поїздки за замовчуванням - сьогодні (і не даємо обрати минуле)
    function setTodayDate() {
        const d = new Date();
        const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const inp = document.getElementById('date-input');
        inp.value = today;
        inp.min = today;
        updateDateDisplay();
    }

    // "Не рахувати мене у статистиці": gooddaybus.com/?notrack=1 вмикає, ?notrack=0 вимикає.
    // Прапор зберігається у браузері й додається до запитів пошуку/візиту.
    (() => {
        const p = new URLSearchParams(location.search);
        if (p.has('notrack')) {
            if (p.get('notrack') === '0') { localStorage.removeItem('gdb_notrack'); alert('Облік увімкнено: цей браузер знову рахується у статистиці.'); }
            else { localStorage.setItem('gdb_notrack', '1'); alert('Готово: заходи й пошуки з цього браузера більше не потраплятимуть у статистику сайту.'); }
        }
    })();
    const noTrack = () => localStorage.getItem('gdb_notrack') === '1';

    document.addEventListener('DOMContentLoaded', () => {
        // Лічильник візитів - один раз на сесію (крім позначених notrack)
        if (!sessionStorage.getItem('gdb_visited')) {
            sessionStorage.setItem('gdb_visited', '1');
            fetch(`${PROXY_BASE}/visit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notrack: noTrack() }) }).catch(() => {});
        }
        setTodayDate();
        const dateInput = document.getElementById('date-input');
        dateInput.addEventListener('change', updateDateDisplay);
        // Клік будь-де по полю відкриває календар: на телефоні тап у нативний інпут
        // робить це сам, на ПК додатково викликаємо showPicker (try/catch - якщо
        // нативний пікер уже відкрився, повторний виклик просто ігнорується).
        document.getElementById('date-wrap').addEventListener('click', () => {
            try { if (typeof dateInput.showPicker === 'function') dateInput.showPicker(); else dateInput.focus(); } catch (err) {}
        });
        loadCities();
        ac('departure', 'departure-list', true);
        ac('arrival', 'arrival-list', false);
        document.getElementById('search-btn').addEventListener('click', search);
    });
