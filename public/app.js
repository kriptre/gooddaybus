    const PROXY_BASE = '/api'; // той самий сервер, що віддає сайт (працює і локально, і на домені)
    let cities = [], depId = null, arrId = null, selRoute = null;
    let _routes = [], _view = [], _dep = '', _arr = '', _date = '', _sortBy = 'departure';
    let _sortDir = 1;    // 1 = за зростанням; повторний клік по активному сортуванню - реверс
    let _shown = 20;     // скільки карток показано ("Показати ще" довантажує порціями)
    const SHOW_STEP = 20;
    // Фільтри рейсів: 'noprepay' = без передоплати, 'direct' = без пересадок.
    // Порожній набір = показувати всі. Памʼятаємо вибір між пошуками й візитами (localStorage).
    const FILTERS_KEY = 'gdb_filters';
    let _filters = new Set((() => { try { return JSON.parse(localStorage.getItem(FILTERS_KEY) || '[]'); } catch (e) { return []; } })());
    const saveFilters = () => { try { localStorage.setItem(FILTERS_KEY, JSON.stringify([..._filters])); } catch (e) { } };
    // "Передоплата лише для груп" (текст на кшталт "для груп з трьох і більше осіб"):
    // для 1-2 пасажирів це фактично без передоплати - рахуємо такі рейси у фільтрі
    // "Без передоплати", а умову показуємо в деталях рейсу.
    const isGroupPrepay = rt => rt.label_type === 'prepayment' && /груп/i.test(rt.price_label || '');
    const payCategory = rt => !rt.label_type ? 'none' : (isGroupPrepay(rt) ? 'group' : (rt.label_type === 'prepayment' ? 'partial' : 'full'));
    // Поріг групи з тексту умови ("...для груп з трьох і більше осіб" → 3). Дзеркало серверної логіки.
    const groupThreshold = rt => {
        const s = String(rt.price_label || '').toLowerCase().replace(/['’ʼ]/g, '');
        const m = s.match(/з\s+(двох|трьох|чотирьох|пяти|шести|(\d+))/);
        if (!m) return 0;
        if (m[2]) return parseInt(m[2], 10) || 0;
        return { 'двох': 2, 'трьох': 3, 'чотирьох': 4, 'пяти': 5, 'шести': 6 }[m[1]] || 0;
    };
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

    // Кеш списку міст у localStorage (доба): повторні заходи стартують миттєво без запиту.
    // Список майже не змінюється, тож доба відставання неощутима; протух - тягнемо свіжий.
    const CITIES_LS = 'gdb_cities', CITIES_TTL = 24 * 60 * 60 * 1000;
    function citiesReady() {
        setStatus(`${cities.length} міст у наявності - оберіть напрямок`, 'success');
        document.getElementById('search-btn').disabled = false;
        if (window.__ROUTE__) { initRoutePage(); return; }  // сторінка маршруту: підставити напрямок, стрічка дат, авто-пошук
        applyQueryParams();                                 // головна: deep-link /?from=&to=&date=
        // Автофокус на «Звідки»: можна одразу друкувати місто. Лише десктоп (на мобільному
        // висувалась би клавіатура) і лише коли поле порожнє (diplink уже все заповнив).
        // skipSuggest - щоб панель популярних напрямків не розкривалась сама.
        const dep = document.getElementById('departure');
        if (dep && !dep.value && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
            dep.dataset.skipSuggest = '1';
            dep.focus({ preventScroll: true });
        }
    }
    async function loadCities() {
        try {
            const c = JSON.parse(localStorage.getItem(CITIES_LS));
            if (c && Array.isArray(c.data) && c.data.length && Date.now() - c.t < CITIES_TTL) {
                cities = c.data;
                citiesReady();
                return;
            }
        } catch (e) { /* кеш пошкоджено - тягнемо з сервера */ }
        setStatus('Завантаження міст...', 'loading');
        try {
            const r = await fetch(`${PROXY_BASE}/cities`);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            cities = await r.json();
            try { localStorage.setItem(CITIES_LS, JSON.stringify({ t: Date.now(), data: cities })); } catch (e) { }
            citiesReady();
        } catch (e) { setStatus(`Помилка: ${e.message}`, 'error'); }
    }

    // === Сторінка маршруту (route page) ===
    const STRIP_LEN = 7, STRIP_MAX = 90;
    const DOW = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const MON_SHORT = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];
    const ymdLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let _stripStart = 0; // зсув у днях від сьогодні для лівої видимої дати

    function buildDateStrip(selectedYMD, dir) {
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
        box.innerHTML = `<button type="button" class="ds-arr" id="ds-prev"${canPrev ? '' : ' disabled'} aria-label="Раніше"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-chevron-left"></use></svg></button>`
            + `<div class="ds-days">${days}</div>`
            + `<button type="button" class="ds-arr" id="ds-next"${canNext ? '' : ' disabled'} aria-label="Пізніше"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-chevron-right"></use></svg></button>`;
        if (dir) box.querySelector('.ds-days').classList.add('slide-' + dir); // анімація гортання
        box.querySelector('#ds-prev').addEventListener('click', () => { _stripStart = Math.max(0, _stripStart - STRIP_LEN); buildDateStrip(document.getElementById('date-input').value, 'prev'); });
        box.querySelector('#ds-next').addEventListener('click', () => { _stripStart = Math.min(STRIP_MAX - STRIP_LEN + 1, _stripStart + STRIP_LEN); buildDateStrip(document.getElementById('date-input').value, 'next'); });
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
        // Стрічку дат переносимо всередину білої картки пошуку - щоб не висіла окремо
        const strip = document.getElementById('date-strip'), card = document.querySelector('.search-card');
        if (strip && card) card.appendChild(strip);
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

    // Нещодавні пошуки (localStorage) + популярні напрямки - показуємо при фокусі порожнього поля.
    const POPULAR = [
        { f: 'Київ', t: 'Варшава', fi: 4, ti: 97 },
        { f: 'Львів', t: 'Краків', fi: 33, ti: 287 },
        { f: 'Київ', t: 'Краків', fi: 4, ti: 287 },
        { f: 'Львів', t: 'Варшава', fi: 33, ti: 97 },
        { f: 'Київ', t: 'Берлін', fi: 4, ti: 49 },
        { f: 'Львів', t: 'Прага', fi: 33, ti: 460 }
    ];
    const getRecent = () => { try { return JSON.parse(localStorage.getItem('gdb_recent') || '[]'); } catch (e) { return []; } };
    function saveRecent(f, t, fi, ti) {
        if (!f || !t || fi == null || ti == null) return;
        try {
            const l = getRecent().filter(r => !(String(r.fi) === String(fi) && String(r.ti) === String(ti)));
            l.unshift({ f, t, fi, ti });
            localStorage.setItem('gdb_recent', JSON.stringify(l.slice(0, 4)));
        } catch (e) { }
    }
    // Підставити маршрут (обидва поля) і запустити пошук - для підказок «нещодавні/популярні»
    function applyRoute(r) {
        document.getElementById('departure').value = r.f; depId = +r.fi;
        document.getElementById('arrival').value = r.t; arrId = +r.ti;
        document.getElementById('departure-list').style.display = 'none';
        document.getElementById('arrival-list').style.display = 'none';
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

        const routeItemHtml = (r, icon) => `<div class="ac-item ac-route" data-f="${escTxt(r.f)}" data-t="${escTxt(r.t)}" data-fi="${r.fi}" data-ti="${r.ti}"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#${icon}"></use></svg><span class="ac-route-txt">${escTxt(r.f)} → ${escTxt(r.t)}</span></div>`;
        // Підказки при фокусі порожнього поля: нещодавні пошуки + популярні напрямки
        function showSuggest() {
            const recent = getRecent();
            let h = '';
            if (recent.length) h += '<div class="ac-head">Нещодавні</div>' + recent.map(r => routeItemHtml(r, 'i-clock')).join('');
            h += '<div class="ac-head">Популярні напрямки</div>' + POPULAR.map(r => routeItemHtml(r, 'i-bolt')).join('');
            lst.innerHTML = h; hl = -1; lst.style.display = 'block'; lst.classList.add('sg-wide');
            lst.querySelectorAll('.ac-route').forEach(el => el.addEventListener('click', () => applyRoute(el.dataset)));
        }
        inp.addEventListener('focus', function () {
            if (this.dataset.skipSuggest) { delete this.dataset.skipSuggest; return; } // автофокус після вибору «Звідки» - без панелі
            // Панель «Нещодавні/Популярні» показуємо лише у полі «Звідки» - у «Куди» вона заважає
            if (isDep && this.value.trim().length < 2) showSuggest();
        });

        inp.addEventListener('input', function () {
            const q = this.value.trim().toLowerCase();
            lst.innerHTML = ''; hl = -1;
            if (q.length < 2 || !cities.length) { if (!q && cities.length && isDep) showSuggest(); else lst.style.display = 'none'; return; }
            lst.classList.remove('sg-wide');
            const res = cities.filter(c => c.name.toLowerCase().includes(q)).slice(0, 9);
            if (!res.length) { lst.style.display = 'none'; return; }
            res.forEach(city => {
                const el = document.createElement('div');
                el.className = 'ac-item';
                el.innerHTML = `<svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-location-dot"></use></svg><span>` + escTxt(city.name).replace(new RegExp(`(${escRe(q)})`, 'gi'), '<strong>$1</strong>') + `</span>`;
                el.addEventListener('click', () => {
                    inp.value = city.name; lst.style.display = 'none'; hl = -1;
                    isDep ? (depId = city.id) : (arrId = city.id);
                    // Після вибору міста відправлення - автофокус у «Куди» (якщо порожнє), щоб не тягтись мишею
                    if (isDep) { const a = document.getElementById('arrival'); if (a && !a.value.trim()) { a.dataset.skipSuggest = '1'; a.focus(); } }
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

    // Зіставлення введеного вручну тексту з містом зі списку (точна назва -> унікальний префікс -> унікальний збіг).
    function matchCityByText(text) {
        const q = (text || '').trim().toLowerCase();
        if (q.length < 2 || !cities.length) return null;
        const exact = cities.find(c => c.name.trim().toLowerCase() === q);
        if (exact) return exact.id;
        const pre = cities.filter(c => c.name.trim().toLowerCase().startsWith(q));
        if (pre.length === 1) return pre[0].id;
        const inc = cities.filter(c => c.name.trim().toLowerCase().includes(q));
        if (inc.length === 1) return inc[0].id;
        return null;
    }
    // Якщо користувач ввів місто вручну (не клікнув підказку) або змінив текст після вибору -
    // підставляємо id за текстом. Так пошук працює навіть без кліку по підказці.
    function syncTypedIds() {
        const dEl = document.getElementById('departure'), aEl = document.getElementById('arrival');
        const byId = id => cities.find(c => String(c.id) === String(id));
        const ok = (id, el) => { const c = byId(id); return c && c.name.trim().toLowerCase() === el.value.trim().toLowerCase(); };
        if (!ok(depId, dEl)) { const id = matchCityByText(dEl.value); depId = id; if (id != null) dEl.value = byId(id).name; }
        if (!ok(arrId, aEl)) { const id = matchCityByText(aEl.value); arrId = id; if (id != null) aEl.value = byId(id).name; }
    }

    async function search() {
        syncTypedIds();
        if (!depId || !arrId) { setStatus('Перевірте назви міст або оберіть зі списку підказок', 'error'); setTimeout(() => setStatus('',''), 3500); return; }
        if (depId === arrId) { setStatus('Вкажіть різні міста', 'error'); return; }
        saveRecent(document.getElementById('departure').value, document.getElementById('arrival').value, depId, arrId);
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
        searchBtn.innerHTML = '<svg class="ic ic-spin" aria-hidden="true"><use href="/_sprite.svg#i-spinner"></use></svg> Шукаємо...';
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
            searchBtn.innerHTML = '<svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-magnifying-glass"></use></svg> Знайти рейс';
        }
    }

    // Пересадки: contrabus дає їх одним рядком ("Пересадка №1...Пересадка №2...").
    // Розбиваємо по "Пересадка №N" у окремі рядки - без круглих плашок, просто з крапкою.
    function transfersHtml(ci) {
        if (!ci) return 'Без пересадок, прямий рейс';
        const parts = String(ci).split(/(?=Пересадка\s*№?\s*\d)/).map(s => s.trim()).filter(Boolean);
        if (parts.length <= 1) return escTxt(ci);
        return `<div class="td-transfers">${parts.map(p => `<div class="tr-item"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-location-dot"></use></svg> ${escTxt(p)}</div>`).join('')}</div>`;
    }

    // Картки-плейсхолдери на час повільного пошуку
    function skelCardHtml() {
        return `<div class="skel-card">
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
    }
    function skeletonHtml() { return skelCardHtml().repeat(4); }

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
                box.innerHTML = `<div class="sg-title"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-lightbulb"></use></svg> На обрану дату рейсів немає, але є на ${s.date}:</div>
                    <button class="sg-btn sg-primary" id="sg-date">Показати рейси на ${s.date} <span class="sg-dist">${s.count} ${routeWord(s.count)}</span> <svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-arrow-right"></use></svg></button>`;
                document.getElementById('sg-date').addEventListener('click', () => setDateAndSearch(s.date));
            } else if (s.type === 'cities') {
                window._alts = s.alternatives;
                box.innerHTML = `<div class="sg-title"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-lightbulb"></use></svg> Прямих рейсів немає. Натисніть місто поряд, щоб переглянути рейси:</div>
                    <div class="sg-cities">${s.alternatives.map((a, i) =>
                        `<button class="sg-btn sg-city" data-ai="${i}"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-location-dot"></use></svg> ${a.name} <span class="sg-dist">~${a.distance_km} км · ${a.count} ${routeWord(a.count)}</span></button>`
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
        wifi: { i: 'wifi', t: 'Wi-Fi' },
        power: { i: 'plug', t: 'Розетки' },
        air: { i: 'snowflake', t: 'Кондиціонер' },
        wc: { i: 'restroom', t: 'Туалет' },
        pets: { i: 'paw', t: 'Можна з тваринами' },
        gps: { i: 'location-crosshairs', t: 'GPS-трекінг' },
        seatselect: { i: 'chair', t: 'Вибір місця' },
        addstop: { i: 'map-pin', t: 'Додаткові зупинки' },
        '16_noaccompany': { i: 'child-reaching', t: 'Діти 16+ без супроводу' },
        noprepayment: { i: 'hand-holding-dollar', t: 'Без передоплати' },
        norefund: { i: 'ban', t: 'Без повернення квитка' }
    };
    function amenitiesHtml(codes) {
        if (!Array.isArray(codes) || !codes.length) return '';
        // 'noprepayment' - послуга перевізника загалом і може суперечити умовам
        // конкретного рейсу (label_type) - тип оплати показуємо лише у рядку "Оплата"
        const chips = codes.filter(c => c !== 'noprepayment').map(code => {
            const a = AMENITIES[code] || { i: 'circle-info', t: code };
            return `<span class="amen"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-${a.i}"></use></svg> ${escTxt(a.t)}</span>`;
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
            ? '<span class="pay-badge pb-none"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-credit-card"></use></svg> Без передоплати</span>'
            : cat === 'group'
                ? '<span class="pay-badge pb-none"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-credit-card"></use></svg> Без передоплати</span><span class="pay-badge pb-part"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-users"></use></svg> Для груп - передоплата</span>'
            : (cat === 'partial'
                ? '<span class="pay-badge pb-part"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-coins"></use></svg> Часткова передоплата</span>'
                : '<span class="pay-badge pb-full"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-money-bill-wave"></use></svg> Повна передоплата</span>');
        return `<div class="pay-badges">${label}</div>` + (rt.price_label ? `<div class="pay-note">${escTxt(rt.price_label)}</div>` : '');
    }

    // Головний бейдж типу оплати - завжди видимий на картці й у шапці модалки (щоб не ховався в деталях).
    // none + group: для 1-2 пасажирів передоплати немає (нюанс про групи лишається в деталях).
    function payTag(rt) {
        const cat = payCategory(rt);
        if (cat === 'partial') return { cls: 'pay-part', txt: 'Часткова передоплата' };
        if (cat === 'full') return { cls: 'pay-full', txt: 'Повна передоплата' };
        return { cls: 'pay-none', txt: 'Без передоплати' };
    }

    function renderResults(routes, date) {
        const el = document.getElementById('results');
        const dep = document.getElementById('departure').value;
        const arr = document.getElementById('arrival').value;
        const how = document.getElementById('how-it-works'); if (how) how.style.display = 'none';

        if (!Array.isArray(routes) || !routes.length) {
            el.innerHTML = `<div class="no-res">
                <svg class="no-res-art" viewBox="0 0 220 120" aria-hidden="true">
                    <line x1="14" y1="103" x2="206" y2="103" stroke="#D5DEE8" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 14"/>
                    <rect x="34" y="30" width="118" height="58" rx="12" fill="#FFF5EE" stroke="#F06422" stroke-width="3"/>
                    <path d="M152 42h16c6 0 11 4 12 10l3 18c1 6-3 11-9 11h-22z" fill="#FFF5EE" stroke="#F06422" stroke-width="3" stroke-linejoin="round"/>
                    <rect x="46" y="42" width="22" height="18" rx="4" fill="#fff" stroke="#F3C7AC" stroke-width="2"/>
                    <rect x="76" y="42" width="22" height="18" rx="4" fill="#fff" stroke="#F3C7AC" stroke-width="2"/>
                    <rect x="106" y="42" width="22" height="18" rx="4" fill="#fff" stroke="#F3C7AC" stroke-width="2"/>
                    <circle cx="64" cy="90" r="11" fill="#fff" stroke="#5E6E80" stroke-width="3"/>
                    <circle cx="136" cy="90" r="11" fill="#fff" stroke="#5E6E80" stroke-width="3"/>
                    <circle cx="187" cy="42" r="17" fill="none" stroke="#5E6E80" stroke-width="3.5"/>
                    <line x1="199" y1="55" x2="209" y2="66" stroke="#5E6E80" stroke-width="4" stroke-linecap="round"/>
                    <text x="187" y="48" text-anchor="middle" font-family="Nunito, sans-serif" font-size="17" font-weight="800" fill="#F06422">?</text>
                </svg>
                <h3>Рейсів не знайдено</h3>
                <p>На ${date} за напрямком ${dep} → ${arr} рейсів немає.</p>
                <div class="suggest-box" id="suggest-box">
                    <div class="sg-loading"><svg class="ic ic-spin" aria-hidden="true"><use href="/_sprite.svg#i-spinner"></use></svg> Шукаємо найближчі дати та міста...</div>
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
        _shown = SHOW_STEP; // новий пошук - знову з першої порції

        el.innerHTML = `
            <div class="res-hdr">
                <div class="res-title">${dep} → ${arr} · ${date}</div>
                <div class="res-badge">${routes.length} рейсів</div>
            </div>
            <div class="sort-bar">
                <span class="sort-lbl"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-arrow-down-short-wide"></use></svg> Сортувати:</span>
                <button class="sort-btn" data-sort="price">Найдешевші</button>
                <button class="sort-btn" data-sort="duration">Найшвидші</button>
                <button class="sort-btn" data-sort="departure">За часом виїзду</button>
            </div>
            <div class="sort-bar filter-bar">
                <span class="sort-lbl sort-lbl-f"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-filter"></use></svg> Фільтри:</span>
                <button class="sort-btn filter-btn" data-filter="noprepay"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-credit-card"></use></svg> Без передоплати</button>
                <button class="sort-btn filter-btn" data-filter="direct"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-route"></use></svg> Без пересадок</button>
                <button class="sort-btn filter-btn" data-filter="pets"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-paw"></use></svg> З твариною</button>
            </div>
            <div id="tickets"></div>`;

        el.querySelectorAll('.sort-btn[data-sort]').forEach(b => b.addEventListener('click', () => {
            // Повторний клік по активному сортуванню - зміна напрямку (ранні ⇄ пізні, дешеві ⇄ дорогі)
            if (_sortBy === b.dataset.sort) _sortDir = -_sortDir;
            else { _sortBy = b.dataset.sort; _sortDir = 1; }
            _shown = SHOW_STEP;
            renderTickets();
        }));
        el.querySelectorAll('.filter-btn').forEach(b => b.addEventListener('click', () => {
            const k = b.dataset.filter;
            _filters.has(k) ? _filters.delete(k) : _filters.add(k);
            saveFilters();
            _shown = SHOW_STEP;
            renderTickets();
        }));
        renderTickets();
    }

    // Візуальні зірки рейтингу перевізника (заповнені/порожні). Рейтинг буває за
    // 5-бальною або 10-бальною шкалою - приводимо до 5. Немає даних - нічого не малюємо.
    function starsHtml(raw) {
        const v = parseFloat(String(raw == null ? '' : raw).replace(',', '.'));
        if (!v || v <= 0) return '';
        const scale10 = v > 5;
        const filled = Math.max(1, Math.min(5, Math.round(scale10 ? v / 2 : v)));
        let s = '';
        for (let i = 1; i <= 5; i++) s += `<svg class="ic ${i <= filled ? 'st-on' : 'st-off'}" aria-hidden="true"><use href="/_sprite.svg#i-star"></use></svg>`;
        return ` <span class="carr-stars" title="Рейтинг ${escTxt(raw)} з ${scale10 ? 10 : 5}">${s}<span class="st-num">${escTxt(raw)}</span></span>`;
    }

    // Час "HH:MM" -> хвилини; повна дата+час рейсу -> timestamp для сортування за виїздом
    function routeDepartTs(rt) {
        const [dd, mm, yy] = (rt.date || _date || '').split('.');
        const [h, mi] = (rt.departure_time || rt.time_from || '0:0').split(':');
        return new Date(+yy || 0, (+mm || 1) - 1, +dd || 1, +h || 0, +mi || 0).getTime();
    }

    function renderTickets() {
        const tickets = document.getElementById('tickets');
        document.querySelectorAll('.sort-btn[data-sort]').forEach(b => {
            const act = b.dataset.sort === _sortBy;
            b.classList.toggle('active', act);
            b.classList.toggle('desc', act && _sortDir === -1); // стрілка напрямку через CSS ::after
        });
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', _filters.has(b.dataset.filter)));

        // Фільтри (порожній набір = усі рейси)
        const pool = _filters.size ? _routes.filter(matchesFilters) : _routes;

        // Оновлюємо лічильник рейсів у шапці результатів під фільтр
        const badge = document.querySelector('.res-badge');
        if (badge) badge.textContent = `${pool.length} ${routeWord(pool.length)}`;

        if (_filters.size && !pool.length) {
            tickets.innerHTML = `<div class="no-res"><div class="no-res-ico"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-filter"></use></svg></div><h3>Таких рейсів немає</h3><p>На цьому напрямку немає рейсів під обрані фільтри.<br>Вимкніть фільтр, щоб побачити всі варіанти.</p></div>`;
            return;
        }

        _view = pool.slice().sort((a, b) => _sortDir * (() => {
            if (_sortBy === 'price')    return (parseFloat(a.price) || 0) - (parseFloat(b.price) || 0);
            if (_sortBy === 'duration') return (a.travel_time || Infinity) - (b.travel_time || Infinity);
            return routeDepartTs(a) - routeDepartTs(b); // departure
        })());

        // Порційний рендер: перша порція одразу, решта - по кнопці «Показати ще»
        tickets.innerHTML = _view.slice(0, _shown).map((rt, i) => ticketCardHtml(rt, i)).join('');
        wireCards(tickets.querySelectorAll('.ticket'));
        updateMoreBtn();
    }

    // Розмітка однієї картки рейсу (i - абсолютний індекс у _view, для data-i)
    function ticketCardHtml(rt, i) {
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
            const pay   = payTag(rt);
            return `<div class="ticket ${pay.cls}" style="animation-delay:${Math.min((i % SHOW_STEP) * 0.05, 0.28)}s">
                <div class="t-main">
                    <div class="t-ep">
                        <div class="t-time">${dt}</div>
                        ${ddate ? `<div class="t-date">${ddate}</div>` : ''}
                        <div class="t-city">${fromCity}</div>
                        ${rt.departure_station ? `<div class="t-station" title="${escTxt(rt.departure_station)}">${escTxt(stripCityTxt(rt.departure_station, fromCity))}</div>` : ''}
                    </div>
                    <div class="t-route">
                        ${dur ? `<div class="t-dur"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-clock"></use></svg> ${dur} в дорозі</div>` : ''}
                        <div class="t-line"><div class="t-dot"></div><div class="t-dash"></div><span class="t-line-chip ${isDirect(rt) ? 'tlc-ok' : ''}">${isDirect(rt) ? 'без пересадок' : 'з пересадкою'}</span><div class="t-dash"></div><div class="t-arrow"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-chevron-right"></use></svg></div></div>
                        <div class="t-carrier" title="${car}"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-bus"></use></svg><span class="t-car-name">${car}</span></div>
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
                            <div class="t-seats"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-chair"></use></svg> ${st} вільних</div>
                        </div>
                        <span class="t-pay ${pay.cls}">${pay.txt}</span>
                    </div>
                </div>
                <div class="t-foot">
                    <button class="t-toggle" type="button" data-i="${i}">Деталі рейсу <svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-chevron-down"></use></svg></button>
                    <button class="btn-ticket" data-i="${i}">${rt.bookable ? 'Забронювати' : 'Замовити'}</button>
                </div>
                <div class="t-details">
                    ${amenitiesHtml(rt.carrier_amenities)}
                    <div class="td-row"><div class="td-label">Оплата</div><div class="td-text">${paymentHtml(rt)}</div></div>
                    <div class="td-row"><div class="td-label">Знижки</div><div class="td-text td-disc">-</div></div>
                    <div class="td-row"><div class="td-label">Пересадки</div><div class="td-text">${transfersHtml(rt.change_info)}</div></div>
                    <div class="td-row"><div class="td-label">Перевізник</div><div class="td-text td-carrier">${car}${starsHtml(rt.carrier_rating)}${rt.carrier_reliability ? ` <span class="carr-badge cb-rel"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-shield-halved"></use></svg> надійність ${escTxt(rt.carrier_reliability)}%</span>` : ''}</div></div>
                    ${rt.baggage ? `<div class="td-row"><div class="td-label">Багаж</div><div class="td-text">${escTxt(rt.baggage)}</div></div>` : ''}
                    <div class="td-foot">
                        <button class="td-close" type="button"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-chevron-up"></use></svg> Згорнути</button>
                        <button class="btn-ticket" data-i="${i}">${rt.bookable ? 'Забронювати' : 'Замовити'}</button>
                    </div>
                </div>
            </div>`;
    }

    // Навішування обробників на набір карток (нові додаємо окремо, наявні не чіпаємо)
    function wireCards(nodes) {
        nodes.forEach(ticket => {
            const cd = ticket.querySelector('.td-close');
            if (cd) cd.addEventListener('click', () => {
                ticket.querySelector('.t-details').classList.remove('open');
                ticket.querySelector('.t-toggle').classList.remove('open');
                ticket.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            });
            ticket.querySelectorAll('.btn-ticket').forEach(b => {
                b.addEventListener('click', () => openModal(_view[b.dataset.i], _dep, _arr, _date));
                const pf = () => prefetchDiscounts(_view[b.dataset.i]); // предзавантаження знижок ще до кліку
                b.addEventListener('pointerenter', pf);
                b.addEventListener('touchstart', pf, { passive: true });
            });
            const tg = ticket.querySelector('.t-toggle');
            if (tg) {
                const pf = () => prefetchDiscounts(_view[tg.dataset.i]);
                tg.addEventListener('pointerenter', pf);
                tg.addEventListener('touchstart', pf, { passive: true });
                tg.addEventListener('click', () => {
                    const det = ticket.querySelector('.t-details');
                    const open = det.classList.toggle('open');
                    tg.classList.toggle('open', open);
                    if (open && det.dataset.discLoaded !== '1') {
                        det.dataset.discLoaded = '1';
                        loadDiscounts(_view[tg.dataset.i], ticket.querySelector('.td-disc'));
                    }
                });
            }
        });
    }

    // Кнопка «Показати ще»: додає наступну порцію (наявні картки не перерендерюються)
    function updateMoreBtn() {
        const tickets = document.getElementById('tickets');
        const old = tickets.querySelector('.show-more'); if (old) old.remove();
        if (_view.length <= _shown) return;
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'show-more';
        btn.textContent = `Показати ще ${Math.min(SHOW_STEP, _view.length - _shown)} · всього ${_view.length} ${routeWord(_view.length)}`;
        btn.addEventListener('click', () => loadMore(btn));
        tickets.appendChild(btn);
    }

    // Довантаження порції зі скелетоном: на місці кнопки коротко показуємо скелетон-картки,
    // потім дорисовуємо реальні (наявні картки не чіпаємо - без миготіння й стрибка скролу).
    let _loadingMore = false;
    function loadMore(btn) {
        if (_loadingMore) return; _loadingMore = true;
        const start = _shown, end = Math.min(_shown + SHOW_STEP, _view.length), count = end - start;
        const skel = document.createElement('div');
        skel.className = 'more-skel';
        skel.innerHTML = skelCardHtml().repeat(Math.min(count, 6));
        btn.replaceWith(skel);
        setTimeout(() => {
            _shown = end;
            const frag = document.createElement('div');
            frag.innerHTML = _view.slice(start, end).map((rt, j) => ticketCardHtml(rt, start + j)).join('');
            const newCards = [...frag.children];
            newCards.forEach(c => skel.parentNode.insertBefore(c, skel));
            wireCards(newCards);
            skel.remove();
            _loadingMore = false;
            updateMoreBtn();
        }, 400);
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
        // Опис із API: "Назва | ціна (-N%)". Розбираємо, щоб ВІДСОТОК був помітним акцентом,
        // а решта - нейтральною (раніше все зливалось у суцільне зелене).
        // Відсоток у назві дублюється ("Діти - 25%") - зрізаємо хвіст, бо відсоток уже в бейджі
        const stripPct = s => String(s || '').replace(/\(?\s*[-−]?\s*\d+\s*%\s*\)?\s*$/, '').replace(/[-–|·,\s]+$/, '').trim();
        const chip = x => {
            const parts = String(x.description || '').split('|');
            const name = escTxt(stripPct(parts[0]));
            const price = escTxt((parts[1] || '').replace(/\(.*?\)/, '').trim());
            const pct = `<b class="dc-pct">-${escTxt(x.percent)}%</b>`;
            return `<span class="disc-chip"><span class="dc-name">${name}</span>${price ? `<span class="dc-price">${price}</span>` : ''}${pct}</span>`;
        };
        el.innerHTML = real.length
            ? `<div class="disc-chips">${real.map(chip).join('')}</div>`
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
                <button type="button" class="pax-del"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-circle-xmark"></use></svg> Видалити</button>
            </div>
            <div class="pax-grid">
                <div class="fg"><label class="f-lbl">Ім'я</label><input type="text" class="f-inp pax-name" placeholder="Іван" autocomplete="given-name"></div>
                <div class="fg"><label class="f-lbl">Прізвище</label><input type="text" class="f-inp pax-surname" placeholder="Петренко" autocomplete="family-name"></div>
                <div class="fg pax-phone-fg"><label class="f-lbl">Телефон</label><input type="tel" class="f-inp pax-phone" placeholder="+380 XX XXX XX XX" inputmode="tel" autocomplete="tel"></div>
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
            <div class="disc-head"><span class="disc-title"><svg class="ic" style="color:var(--orange);margin-right:6px" aria-hidden="true"><use href="/_sprite.svg#i-tag"></use></svg>Знижка для пасажирів</span></div>
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
            renumberPax(); renderDiscBlock(); applyBookUI();
        });
        renumberPax();
        renderDiscBlock();
        applyBookUI();
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
    let _isGroup = false, _groupThr = 0; // груповий рейс і поріг передоплати (з умови перевізника)
    const petChosen = () => document.getElementById('pet-select').value === 'yes';
    const paxCount = () => document.querySelectorAll('#pax-list .pax-row').length;
    // Група досягла порогу передоплати перевізника (від _groupThr осіб - потрібна передоплата)
    const groupOver = () => _isGroup && _groupThr > 0 && paxCount() >= _groupThr;
    // Реальна можливість автоброні: рейс bookable, БЕЗ тварини і група не перевищила поріг
    const canBookNow = () => _bookMode && !petChosen() && !groupOver();
    // Оновлює заголовок/підказку/кнопку/бейдж оплати відповідно до стану (з урахуванням групи)
    function applyBookUI() {
        const book = canBookNow();
        document.getElementById('m-title').textContent = book ? 'Бронювання поїздки' : 'Замовити поїздку';
        document.getElementById('m-booknote').style.display = book ? 'flex' : 'none';
        document.getElementById('m-submit').innerHTML = book
            ? '<svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-bolt"></use></svg> Забронювати'
            : '<svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-paper-plane"></use></svg> Надіслати';
        // Бейдж оплати в шапці: для групового рейсу залежить від кількості пасажирів
        const badge = document.querySelector('#m-trip .mt-pay .t-pay');
        if (badge && _isGroup) {
            const over = groupOver();
            badge.className = 't-pay ' + (over ? 'pay-part' : 'pay-none');
            badge.textContent = over ? 'Попередня оплата 1 квитка' : 'Без передоплати';
        }
        // Примітка про умову групової передоплати (показуємо лише для групових рейсів)
        const gn = document.getElementById('m-groupnote');
        if (gn) {
            const show = _isGroup && _groupThr > 0;
            gn.style.display = show ? 'flex' : 'none';
            if (show) gn.innerHTML = `<svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-circle-info"></use></svg> Від ${_groupThr} пасажирів перевізник бере передоплату за 1 квиток. До ${_groupThr - 1} включно - без передоплати, оплата водієві.`;
        }
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
        _isGroup = isGroupPrepay(rt); _groupThr = groupThreshold(rt);
        _modalDiscounts = []; _paxDiscSel = []; _discOpen = false;
        const dt = rt.departure_time || rt.time_from || '';
        document.querySelector('#m-route span').textContent = `${dep} → ${arr}`;
        // Зведення рейсу - щоб клієнт бачив, що саме бронює
        const at = rt.arrival_time || rt.time_to || '';
        const dur = fmtDuration(rt.travel_time);
        const fromSt = rt.departure_station ? stripCityTxt(rt.departure_station, dep) : '';
        const toSt = rt.arrival_station ? stripCityTxt(rt.arrival_station, arr) : '';
        document.getElementById('m-trip').innerHTML =
            `<div class="mt-row"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-calendar"></use></svg> <b>${escTxt(fmtNiceDate(rt.date || _date))}</b></div>` +
            `<div class="mt-row"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-clock"></use></svg> ${escTxt(dt || '-')}${at ? ' → ' + escTxt(at) : ''}${dur ? ` <span class="mt-dur">${escTxt(dur)}</span>` : ''}</div>` +
            `<div class="mt-row"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-tag"></use></svg> <b>${escTxt(fmtPrice(rt) || '-')}</b>&nbsp;/&nbsp;місце</div>` +
            `<div class="mt-row"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-bus"></use></svg> ${escTxt(rt.carrier || rt.company || 'Автобус')}</div>` +
            `<div class="mt-row mt-pay"><span class="t-pay ${payTag(rt).cls}">${payTag(rt).txt}</span></div>` +
            ((fromSt || toSt) ? `<div class="mt-stations">${fromSt ? `<span><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-location-dot"></use></svg> ${escTxt(fromSt)}</span>` : ''}${toSt ? `<span><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-flag-checkered"></use></svg> ${escTxt(toSt)}</span>` : ''}</div>` : '');
        document.getElementById('m-form').style.display = 'block';
        document.getElementById('m-ok').style.display = 'none';
        document.getElementById('c-comment').value = '';
        document.getElementById('c-hp').value = '';
        document.getElementById('disc-block').innerHTML = '';
        document.getElementById('m-disc-note').style.display = 'none';
        // "Додатково" згорнуто; поле тварини - лише якщо рейс дозволяє тварин
        document.getElementById('more-body').style.display = 'none';
        document.getElementById('more-chev').classList.remove('rot');
        document.getElementById('pet-select').value = 'no';
        document.getElementById('pet-note').style.display = 'none';
        document.getElementById('m-consent').checked = false;
        document.getElementById('m-consent-wrap').classList.remove('err', 'checked');
        document.getElementById('pet-field').style.display = allowsPets(rt) ? 'block' : 'none';
        document.getElementById('pax-list').innerHTML = '';
        // Памʼять кількості пасажирів: скільки їхало минулого разу - стільки рядків і відкриваємо
        // (зайві легко прибрати хрестиком). Ліміт 5 - як у автоброні.
        let paxN = 1;
        try { paxN = Math.min(5, Math.max(1, parseInt(localStorage.getItem('gdb_paxn'), 10) || 1)); } catch (e) { }
        for (let i = 0; i < paxN; i++) addPax();
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
        document.getElementById('more-chev').classList.toggle('rot', !open);
    });
    // Зміна "з твариною" - показуємо примітку й перемикаємо режим кнопки (бронь ↔ заявка)
    document.getElementById('pet-select').addEventListener('change', () => {
        document.getElementById('pet-note').style.display = petChosen() ? 'flex' : 'none';
        applyBookUI();
    });

    document.getElementById('m-cancel').addEventListener('click', closeBooking);
    document.getElementById('modal-bg').addEventListener('click', e => { if (e.target === document.getElementById('modal-bg')) closeBooking(); });
    document.getElementById('m-consent').addEventListener('change', e => {
        const wrap = document.getElementById('m-consent-wrap');
        wrap.classList.toggle('checked', e.target.checked);
        if (e.target.checked) wrap.classList.remove('err');
    });
    document.getElementById('m-submit').addEventListener('click', async () => {
        // Згода з умовами обовʼязкова (активний opt-in, не передзаповнений)
        const consent = document.getElementById('m-consent');
        if (consent && !consent.checked) {
            // Червона рамка + короткий підпис під галочкою (не браузерний alert):
            // без слів людина не розуміє, чому кнопка "не працює" (реальний випадок).
            document.getElementById('m-consent-wrap').classList.add('err');
            document.getElementById('m-consent-wrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
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
        btn.innerHTML = willBook ? '<svg class="ic ic-spin" aria-hidden="true"><use href="/_sprite.svg#i-spinner"></use></svg> Бронюємо...' : '<svg class="ic ic-spin" aria-hidden="true"><use href="/_sprite.svg#i-spinner"></use></svg> Надсилаємо...';

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
            try { localStorage.setItem('gdb_paxn', String(payload.passengers.length)); } catch (e) { }
            const tks = (j.booked && Array.isArray(j.tickets)) ? j.tickets.filter(t => t.pdf) : [];
            if (j.booked) {
                document.getElementById('m-ok-title').textContent = 'Місця заброньовано!';
                document.getElementById('m-ok-text').innerHTML = tks.length
                    ? 'Оплата - водієві при посадці.<br>Збережіть свої квитки:'
                    : 'Оплата - водієві при посадці.<br>Квитки надішле менеджер найближчим часом.';
                document.getElementById('m-ok-tickets').innerHTML = tks.map((tk, i) =>
                    `<a class="tk-link" href="${escTxt(tk.pdf)}" target="_blank" rel="noopener"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-file-pdf"></use></svg> Завантажити квиток${tks.length > 1 ? ' ' + (i + 1) : ''}</a>`).join('');
            } else {
                document.getElementById('m-ok-title').textContent = 'Заявку прийнято!';
                document.getElementById('m-ok-text').innerHTML = "Менеджер зв'яжеться з вами, узгодить деталі<br>та за потреби надасть реквізити для оплати.";
                document.getElementById('m-ok-tickets').innerHTML = '';
            }
            document.getElementById('m-form').style.display = 'none';
            document.getElementById('m-ok').style.display = 'block';
        } catch (e) {
            alert('Не вдалося надіслати заявку: ' + e.message + '\n\nСпробуйте ще раз або зателефонуйте менеджеру.');
        } finally {
            btn.disabled = false;
            btn.innerHTML = canBookNow()
                ? '<svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-bolt"></use></svg> Забронювати'
                : '<svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-paper-plane"></use></svg> Надіслати';
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
