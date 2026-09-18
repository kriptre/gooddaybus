    const PROXY_BASE = '/api'; // той самий сервер, що віддає сайт (працює і локально, і на домені)
    // Доступ до storage може бути ЗАБОРОНЕНИЙ (жорсткі налаштування приватності, блокування
    // cookie, вбудовані браузери) - тоді навіть звернення до window.localStorage кидає
    // SecurityError. Раніше це валило ініціалізацію: не вантажились міста й не працювала
    // кнопка пошуку. Тому працюємо ЛИШЕ через ці обгортки - без storage сайт просто не
    // запамʼятовує вибір, але лишається повністю робочим.
    const safeStore = kind => {
        const box = () => { try { return window[kind]; } catch (e) { return null; } };
        return {
            get(k) { try { const s = box(); return s ? s.getItem(k) : null; } catch (e) { return null; } },
            set(k, v) { try { const s = box(); if (s) s.setItem(k, v); } catch (e) { } },
            del(k) { try { const s = box(); if (s) s.removeItem(k); } catch (e) { } }
        };
    };
    const LS = safeStore('localStorage'), SS = safeStore('sessionStorage');

    // --- Мова інтерфейсу ---------------------------------------------------
    // Українська - типова: усі рядки лежать тут, у T_UK. Англійські сторінки
    // підвантажують public/i18n/en.js ПЕРЕД цим файлом, він кладе повний
    // англійський словник у window.__I18N__ - жодного часткового злиття,
    // повнота гарантується тестом (немає кирилиці у public/en/*.html).
    const LANG = document.documentElement.lang === 'en' ? 'en' : 'uk';
    // Мова впливає ЛИШЕ на текст серверної помилки. Ключі кешу пошуку й міст від неї не
    // залежать: дані API однакові для обох версій сайту. Додаємо до кожного серверного
    // виклику, чия помилка показується користувачу (/search, /order - у їхніх URL немає
    // інших параметрів, тож підходить '?lang=en'; якби були - знадобився б '&lang=en').
    const LANG_Q = LANG === 'en' ? '?lang=en' : '';

    // --- Переклад даних API (Task 16) ---------------------------------------
    // Дані з «Контрабаса» (назви міст, адреси станцій, перевізник, багаж, пересадка,
    // умови оплати) приходять українською незалежно від мови сторінки - на англійській
    // версії перекладаємо ПІД ЧАС ВІДМАЛЮВАННЯ: кеші пошуку й міст від мови НЕ залежать.
    // На українській сторінці всі функції нижче - прозорі no-op (LANG !== 'en'), тож
    // жоден видимий символ на / не міняється.
    const I18N_CITIES = (window.__I18N__ && window.__I18N__.cities) || null; // id (числовий) -> англ. назва
    const I18N_GEO = (window.__I18N__ && window.__I18N__.geo) || null;       // службове слово адреси -> англ.
    // Ключі глосарію - від довгих до коротких: інакше короткий "вокзал" перехопив би
    // частину довшого "залізничний вокзал" ще до того, як дійде черга до повної фрази.
    const GEO_KEYS = I18N_GEO ? Object.keys(I18N_GEO).sort((a, b) => b.length - a.length) : [];
    // Клас "літери" для межі слова при заміні за глосарієм. У JS \w і \b НЕ бачать
    // кирилицю (\w == [A-Za-z0-9_]) - тому /\bвокзал\b/ на кириличному тексті мовчки
    // не спрацьовує взагалі, а наївна заміна без меж перетворює "Автовокзал" на
    // "Avtostation" (вокзал знайдено ВСЕРЕДИНІ слова) і "Вокзальна" (станція метро
    // Києва) - на зіпсоване слово. Явний кириличний+латинський клас символів замінює
    // тут \w, границя перевіряється вручну по сусідніх символах.
    const GEO_WORD_CHAR = "А-Яа-яІіЇїЄєҐґA-Za-z0-9";

    // Невідоме серверу місто (немає ні в словнику, ні внутрішньо-помітної транслітерації)
    // на англійській сторінці мовчки лишилось би кирилицею - тому один раз за сесію
    // повідомляємо про пропуск у логи, як і reportUnknownAmenity нижче.
    const _unkCity = new Set();
    function reportUnknownCity(id, name) {
        if (_unkCity.has(id) || _unkCity.size > 5) return;
        _unkCity.add(id);
        try {
            fetch(`${PROXY_BASE}/client-error`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
                body: JSON.stringify({ msg: `Місто без англійської назви: id=${id} "${name}"`, page: location.pathname })
            });
        } catch (e) { }
    }

    // Англійська назва міста: словник-виняток -> транслітерація. Береться ID, а НЕ
    // відображуване ім'я - бо словник key - це числовий id з cities-en.json, і сам
    // fallback (translit) працює з довільним текстом незалежно від id.
    function cityName(id, fallback) {
        if (LANG !== 'en') return fallback;
        if (I18N_CITIES && Object.prototype.hasOwnProperty.call(I18N_CITIES, id)) return I18N_CITIES[id];
        const t = typeof window.translit === 'function' ? window.translit(fallback) : fallback;
        // translit() не змінив рядок, а кирилиця в ньому лишилась - отже, переклад
        // не спрацював (не просто "транслітерація і є переклад", як для звичайного
        // міста): і словника, і транслітерації бракує - вартий репорту пропуск.
        if (t === fallback && /[А-Яа-яІіЇїЄєҐґ]/.test(String(fallback))) reportUnknownCity(id, fallback);
        return t;
    }

    // Заміна ОДНОГО службового слова глосарію в тексті з дотриманням межі слова
    // (див. коментар біля GEO_WORD_CHAR вище) - case-insensitive.
    function replaceGeoWord(s, key, val) {
        const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`(^|[^${GEO_WORD_CHAR}])(${esc})(?![${GEO_WORD_CHAR}])`, 'gi');
        return s.replace(re, (m, pre) => pre + val);
    }

    // Адреса станції: спершу глосарій службових слів (вул./просп./вокзал/...),
    // потім транслітерація решти (власні назви - Кам'янець-Подільський тощо).
    function stationName(text) {
        if (LANG !== 'en' || !text) return text;
        let s = String(text);
        for (const k of GEO_KEYS) s = replaceGeoWord(s, k, I18N_GEO[k]);
        return typeof window.translit === 'function' ? window.translit(s) : s;
    }

    // Розбір шаблонних текстів «Контрабаса» (Task 15b, i18n/vendor-en.js): перевізник,
    // багаж, пересадка, умови оплати. Контракт кожної функції - { text, translated }.
    // Коли розпізнати не вдалось - text це ОРИГІНАЛЬНИЙ український рядок (ніколи не
    // порожній, ніколи напівпереклад), тож показ САМОГО тексту завжди безпечний;
    // translated:false лише вирішує, чи додавати позначку "не перекладено".
    const VENDOR_EN = (typeof window.vendorEn === 'object' && window.vendorEn) || null;

    // Позначка для нерозпізнаного (непереведеного) тексту - показуємо оригінал
    // українською ЧЕСНО, а не мовчки: особливо важливо для умов оплати (price_label) -
    // прихована умова передоплати виглядає як "бронь безкоштовна", а зʼясовується це
    // вже на автобусі.
    function untranslatedNote(subject) {
        return ` <span class="i18n-uk-note">(${subject} - Ukrainian, not translated)</span>`;
    }

    // Переклад для контексту, де можна вставляти HTML (span з позначкою) - вміст
    // td-текстового рядка, а не значення HTML-атрибута.
    function vendorHtml(fnName, raw, noteLabel) {
        const s = String(raw == null ? '' : raw).trim();
        if (!s) return '';
        if (LANG !== 'en' || !VENDOR_EN || typeof VENDOR_EN[fnName] !== 'function') return escTxt(raw);
        const v = VENDOR_EN[fnName](s);
        return escTxt(v.text) + (v.translated ? '' : untranslatedNote(noteLabel));
    }

    // Переклад для контексту, де HTML вставляти НЕ можна (значення атрибута title,
    // або текст, що йде і в атрибут, і в контент) - лише текст, без позначки-span.
    // Ніколи не повертає порожній рядок для непорожнього raw - гірше показати
    // український оригінал, ніж нічого не показати.
    function vendorPlainText(fnName, raw) {
        const s = String(raw == null ? '' : raw).trim();
        if (!s) return '';
        if (LANG !== 'en' || !VENDOR_EN || typeof VENDOR_EN[fnName] !== 'function') return raw;
        const v = VENDOR_EN[fnName](s);
        return v.text || raw;
    }

    // Форми множини: українська має три, англійська дві.
    const PLURAL_RULE = {
        uk: n => (n % 10 === 1 && n % 100 !== 11) ? 0
            : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? 1 : 2,
        en: n => n === 1 ? 0 : 1
    };
    const plural = (n, forms) => forms[PLURAL_RULE[LANG](n)];

    const T_UK = {
        status: {
            loadingCities: 'Завантаження міст...',
            citiesReady: n => `${n} міст у наявності - оберіть напрямок`,
            citiesFailed: 'Не вдалося завантажити міста - перевірте зʼєднання',
            retry: 'Спробувати ще раз'
        },
        date: {
            dow: ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
            monShort: ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'],
            monFull: ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'],
            earlier: 'Раніше',
            later: 'Пізніше',
            placeholder: 'Оберіть дату'
        },
        ac: {
            recent: 'Нещодавні',
            popular: 'Популярні напрямки'
        },
        search: {
            differentCities: 'Вкажіть різні міста',
            checkCities: 'Перевірте назви міст або оберіть зі списку підказок',
            searching: 'Шукаємо рейси...',
            searchingBtn: 'Шукаємо...',
            findRoute: 'Знайти рейс',
            error: msg => `Помилка: ${msg}`
        },
        suggest: {
            otherDate: d => `На обрану дату рейсів немає, але є на ${d}:`,
            showOtherDate: d => `Показати рейси на ${d}`,
            noDirect: 'Прямих рейсів немає. Натисніть місто поряд, щоб переглянути рейси:',
            none: 'Спробуйте іншу дату чи напрямок або зверніться до менеджера нижче.',
            routeForms: ['рейс', 'рейси', 'рейсів'],
            km: 'км'
        },
        transfers: {
            direct: 'Без пересадок, прямий рейс',
            forms: ['пересадка', 'пересадки', 'пересадок']
        },
        duration: {
            hour: 'год',
            dayForms: ['день', 'дні', 'днів']
        },
        // Зручності рейсу: код API → іконка + назва
        amenities: {
            wifi: { i: 'wifi', t: 'Wi-Fi' },
            power: { i: 'plug', t: 'Розетки' },
            air: { i: 'snowflake', t: 'Кондиціонер' },
            wc: { i: 'restroom', t: 'Туалет' },
            pets: { i: 'paw', t: 'Можна з тваринами' },
            gps: { i: 'location-crosshairs', t: 'GPS-трекінг' },
            seatselect: { i: 'chair', t: 'Вибір місця' },
            addstop: { i: 'map-pin', t: 'Додаткові зупинки' },
            // Вікові пороги для дітей без супроводу - шаблоном нижче (16_noaccompany, 18_noaccompany...)
            noprepayment: { i: 'hand-holding-dollar', t: 'Без передоплати' },
            norefund: { i: 'ban', t: 'Без повернення квитка' },
            'pet-only-from-eu': { i: 'paw', t: 'Тварини - лише на рейсах з ЄС' },
            starlink: { i: 'wifi', t: 'Супутниковий інтернет (Starlink)' },
            drinks: { i: 'cup', t: 'Напої' },
            steward: { i: 'user', t: 'Стюард у салоні' },
            // Текст для шаблонних кодів AMEN_PATTERNS (не сам код - лише переклад)
            noAccompany: n => `Діти ${n}+ без супроводу`
        },
        pay: {
            none: 'Без передоплати',
            groupNote: 'Для груп - передоплата',
            partial: 'Часткова передоплата',
            full: 'Повна передоплата'
        },
        results: {
            amenitiesLabel: 'Зручності',
            noneFoundTitle: 'Рейсів не знайдено',
            noneFoundBody: (date, dep, arr) => `На ${date} за напрямком ${dep} → ${arr} рейсів немає.`,
            noneFoundStatus: 'Рейсів не знайдено',
            searchingSuggest: 'Шукаємо найближчі дати та міста...',
            found: n => `Знайдено рейсів: ${n}`,
            badge: n => `${n} рейсів`,
            sort: 'Сортувати:',
            sortPrice: 'Найдешевші',
            sortDuration: 'Найшвидші',
            sortDeparture: 'За часом виїзду',
            filters: 'Фільтри:',
            filterDirect: 'Без пересадок',
            filterPets: 'З твариною',
            filteredNoneTitle: 'Таких рейсів немає',
            filteredNoneBody: 'На цьому напрямку немає рейсів під обрані фільтри.<br>Вимкніть фільтр, щоб побачити всі варіанти.'
        },
        card: {
            busFallback: 'Автобус',
            enRoute: 'в дорозі',
            direct: 'без пересадок',
            withTransfer: 'з пересадкою',
            perSeat: 'за місце',
            free: 'вільних',
            details: 'Деталі рейсу',
            book: 'Забронювати',
            order: 'Замовити',
            payment: 'Оплата',
            discLabel: 'Знижки',
            transfers: 'Пересадки',
            carrier: 'Перевізник',
            reliability: n => `надійність ${n}%`,
            ratingTitle: (raw, max) => `Рейтинг ${raw} з ${max}`,
            baggage: 'Багаж',
            collapse: 'Згорнути',
            moreBtn: (n, total, word) => `Показати ще ${n} · всього ${total} ${word}`
        },
        discounts: {
            unavailable: 'Інформація недоступна',
            loading: 'Завантаження…',
            none: 'Спеціальних знижок немає'
        },
        pax: {
            delete: 'Видалити',
            firstName: "Ім'я",
            firstNamePh: 'Іван',
            lastName: 'Прізвище',
            lastNamePh: 'Петренко',
            phone: 'Телефон',
            phonePh: '+380 XX XXX XX XX',
            title: n => `Пасажир №${n}`,
            fullTicket: 'Повний квиток',
            discTitle: 'Знижка для пасажирів',
            total: (n, word) => `Разом за ${n} ${word}:`
        },
        seats: {
            forms: ['місце', 'місця', 'місць'],
            driver: 'Водій',
            table: 'Столик',
            taken: 'Зайнято',
            auto: 'Автоматично',
            launch: 'Вибір місця',
            optional: 'необовʼязково',
            deck: n => `Поверх ${n}`,
            legendFree: 'вільне',
            legendSel: 'ваше',
            legendTaken: 'зайняте',
            chosen: (names, n, need) => `Обрано: <b>${names}</b> (${n} з ${need})`,
            hint: need => `Торкніться вільних місць на схемі${need > 1 ? ` (потрібно ${need})` : ''} - або залиште як є, і місця призначаться автоматично.`
        },
        modal: {
            titleBook: 'Бронювання поїздки',
            titleOrder: 'Замовити поїздку',
            groupPrepayBadge: 'Попередня оплата 1 квитка',
            groupNote: thr => `Від ${thr} пасажирів перевізник бере передоплату за 1 квиток. До ${thr - 1} включно - без передоплати, оплата водієві.`
        },
        order: {
            send: 'Надіслати',
            booking: 'Бронюємо...',
            sending: 'Надсилаємо...',
            phoneIncomplete: 'Перевірте номер телефону - здається, він введений неповністю.',
            fillAllFields: 'Заповніть дані всіх пасажирів.',
            yourSeats: 'Ваші місця',
            bookedTitle: 'Місця заброньовано!',
            bookedTextWithTickets: 'Оплата - водієві при посадці.<br>Збережіть свої квитки:',
            bookedTextNoTickets: 'Оплата - водієві при посадці.<br>Квитки надішле менеджер найближчим часом.',
            downloadTicket: 'Завантажити квиток',
            acceptedTitle: 'Заявку прийнято!',
            acceptedText: "Менеджер зв'яжеться з вами, узгодить деталі<br>та за потреби надасть реквізити для оплати.",
            submitError: msg => `Не вдалося надіслати заявку: ${msg}\n\nСпробуйте ще раз або зателефонуйте менеджеру.`,
            copyLabel: 'Копіювати',
            copiedLabel: 'Скопійовано!'
        },
        track: {
            on: 'Облік увімкнено: цей браузер знову рахується у статистиці.',
            off: 'Готово: заходи й пошуки з цього браузера більше не потраплятимуть у статистику сайту.'
        }
    };

    const T = (window.__I18N__ && window.__I18N__.app) || T_UK;

    let cities = [], depId = null, arrId = null, selRoute = null;
    let _routes = [], _view = [], _dep = '', _arr = '', _depId = null, _arrId = null, _date = '', _sortBy = 'departure';
    let _sortDir = 1;    // 1 = за зростанням; повторний клік по активному сортуванню - реверс
    let _shown = 20;     // скільки карток показано ("Показати ще" довантажує порціями)
    const SHOW_STEP = 20;
    // Фільтри рейсів: 'noprepay' = без передоплати, 'direct' = без пересадок.
    // Порожній набір = показувати всі. Памʼятаємо вибір між пошуками й візитами (localStorage).
    const FILTERS_KEY = 'gdb_filters';
    let _filters = new Set((() => { try { return JSON.parse(LS.get(FILTERS_KEY) || '[]'); } catch (e) { return []; } })());
    const saveFilters = () => { try { LS.set(FILTERS_KEY, JSON.stringify([..._filters])); } catch (e) { } };
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
    // "pet-only-from-eu" - перевізник бере тварин лише на рейсах ІЗ ЄС: враховуємо
    // напрямок (from_eu проставляє сервер, бо country_code міст фронту не віддається)
    // hasAmen - пошук коду без залежності від регістру (contrabus присилає різний)
    const hasAmen = (rt, code) => Array.isArray(rt && rt.carrier_amenities)
        && rt.carrier_amenities.some(c => String(c || '').trim().toLowerCase() === code);
    const allowsPets = rt => hasAmen(rt, 'pets') || (hasAmen(rt, 'pet-only-from-eu') && !!rt.from_eu);
    const matchesFilters = rt =>
        (!_filters.has('noprepay') || !rt.label_type || isGroupPrepay(rt)) &&
        (!_filters.has('direct') || isDirect(rt)) &&
        (!_filters.has('pets') || allowsPets(rt));

    // Обробка назв знижок від API: "Назва укр / Nazva deutsch | 108 eur (-10%)"
    // stripPct: видаляємо процент з кінця (напр. "Діти - 25%" → "Діти")
    // cleanDiscName: беремо тільки українську частину (до ' / ') і видаляємо процент
    const stripPct = s => String(s || '').replace(/\(?\s*[-−]?\s*\d+\s*%\s*\)?\s*$/, '').replace(/[-–|·,\s]+$/, '').trim();
    const cleanDiscName = s => stripPct(String(s || '').split('|')[0]).split(' / ')[0].trim();

    function setStatus(txt, type = '') {
        document.getElementById('status-row').className = `status-row ${type}`;
        document.getElementById('status-txt').textContent = txt;
        const old = document.getElementById('cities-retry-btn'); // прибираємо кнопку ретраю з попередньої спроби, якщо була
        if (old) old.remove();
    }

    // Кеш списку міст у localStorage (доба): повторні заходи стартують миттєво без запиту.
    // Список майже не змінюється, тож доба відставання неощутима; протух - тягнемо свіжий.
    const CITIES_LS = 'gdb_cities', CITIES_TTL = 24 * 60 * 60 * 1000;
    function citiesReady() {
        setStatus(T.status.citiesReady(cities.length), 'success');
        document.getElementById('search-btn').disabled = false;
        if (window.__ROUTE__) { initRoutePage(); return; }  // сторінка маршруту: підставити напрямок, стрічка дат, авто-пошук
        applyQueryParams();                                 // головна: deep-link /?from=&to=&date=
        // Автофокус на «Звідки»: курсор одразу в полі, але панель «Нещодавні/Популярні»
        // НЕ розкриваємо (skipSuggest) - вона зʼявиться, щойно користувач клікне/почне вводити.
        // Лише десктоп (на мобільному висувалась би клавіатура) і лише коли поле порожнє.
        const dep = document.getElementById('departure');
        if (dep && !dep.value && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
            dep.dataset.skipSuggest = '1';
            dep.focus({ preventScroll: true });
        }
    }
    async function loadCities() {
        try {
            const c = JSON.parse(LS.get(CITIES_LS));
            if (c && Array.isArray(c.data) && c.data.length && Date.now() - c.t < CITIES_TTL) {
                cities = c.data;
                citiesReady();
                return;
            }
        } catch (e) { /* кеш пошкоджено - тягнемо з сервера */ }
        setStatus(T.status.loadingCities, 'loading');
        try {
            const r = await fetch(`${PROXY_BASE}/cities`);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            cities = await r.json();
            try { LS.set(CITIES_LS, JSON.stringify({ t: Date.now(), data: cities })); } catch (e) { }
            citiesReady();
        } catch (e) {
            // Кешу немає (інакше вище був би ранній return) - без міст пошук неможливий,
            // тож даємо кнопку ретраю замість того, щоб лишати користувача з мертвим станом.
            // Кнопку пошуку НЕ розблоковуємо - лишається disabled до успішного citiesReady().
            setStatus(T.status.citiesFailed, 'error');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.id = 'cities-retry-btn';
            btn.className = 'ck-link';
            btn.textContent = T.status.retry;
            btn.addEventListener('click', () => { btn.disabled = true; loadCities(); });
            document.getElementById('status-row').appendChild(btn);
        }
    }

    // === Сторінка маршруту (route page) ===
    const STRIP_MAX = 90;
    // Кількість дат у ряд за шириною екрана: 7 дат у 375px сплющуються, тож на телефоні менше.
    const stripLen = () => { const w = window.innerWidth; return w <= 480 ? 4 : (w <= 700 ? 5 : 7); };
    const DOW = T.date.dow;
    const MON_SHORT = T.date.monShort;
    const ymdLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    let _stripStart = 0; // зсув у днях від сьогодні для лівої видимої дати

    function buildDateStrip(selectedYMD, dir) {
        const box = document.getElementById('date-strip');
        if (!box) return;
        const STRIP_LEN = stripLen();
        if (_stripStart > STRIP_MAX - STRIP_LEN + 1) _stripStart = Math.max(0, STRIP_MAX - STRIP_LEN + 1);
        const today = new Date(); today.setHours(0, 0, 0, 0);
        let days = '';
        for (let i = 0; i < STRIP_LEN; i++) {
            const d = new Date(today); d.setDate(d.getDate() + _stripStart + i);
            const ymd = ymdLocal(d);
            days += `<button type="button" class="ds-day${ymd === selectedYMD ? ' sel' : ''}" data-ymd="${ymd}"><span class="ds-dow">${DOW[d.getDay()]}</span><span class="ds-num">${d.getDate()}</span><span class="ds-mon">${MON_SHORT[d.getMonth()]}</span></button>`;
        }
        const canPrev = _stripStart > 0, canNext = _stripStart + STRIP_LEN <= STRIP_MAX;
        box.innerHTML = `<button type="button" class="ds-arr" id="ds-prev"${canPrev ? '' : ' disabled'} aria-label="${T.date.earlier}"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-chevron-left"></use></svg></button>`
            + `<div class="ds-days" style="grid-template-columns:repeat(${STRIP_LEN},1fr)">${days}</div>`
            + `<button type="button" class="ds-arr" id="ds-next"${canNext ? '' : ' disabled'} aria-label="${T.date.later}"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-chevron-right"></use></svg></button>`;
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

    // Поворот екрана / зміна ширини змінює к-сть днів (5⇄7) - перебудовуємо стрічку лише коли це справді сталося
    let _lastStripN = stripLen();
    window.addEventListener('resize', () => {
        const n = stripLen();
        if (n !== _lastStripN) {
            _lastStripN = n;
            const inp = document.getElementById('date-input');
            if (inp) buildDateStrip(inp.value);
        }
    });

    function initRoutePage() {
        const R = window.__ROUTE__;
        document.getElementById('departure').value = cityName(R.fromId, R.fromName); depId = R.fromId;
        document.getElementById('arrival').value = cityName(R.toId, R.toName); arrId = R.toId;
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
        document.getElementById('departure').value = cityName(cf.id, cf.name); depId = cf.id;
        document.getElementById('arrival').value = cityName(ct.id, ct.name); arrId = ct.id;
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
    const getRecent = () => { try { return JSON.parse(LS.get('gdb_recent') || '[]'); } catch (e) { return []; } };
    function saveRecent(f, t, fi, ti) {
        if (!f || !t || fi == null || ti == null) return;
        try {
            const l = getRecent().filter(r => !(String(r.fi) === String(fi) && String(r.ti) === String(ti)));
            l.unshift({ f, t, fi, ti });
            LS.set('gdb_recent', JSON.stringify(l.slice(0, 4)));
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

        // cityName() тут перекладає ВІДОБРАЖЕННЯ (і те, що піде назад у поле після кліку -
        // applyRoute бере f/t із цього ж data-f/data-t); fi/ti - числові id, як були,
        // без жодного дотику - саме вони підуть у depId/arrId і в тіло /search.
        const routeItemHtml = (r, icon) => {
            const f = cityName(r.fi, r.f), t = cityName(r.ti, r.t);
            return `<div class="ac-item ac-route" data-f="${escTxt(f)}" data-t="${escTxt(t)}" data-fi="${r.fi}" data-ti="${r.ti}"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#${icon}"></use></svg><span class="ac-route-txt">${escTxt(f)} → ${escTxt(t)}</span></div>`;
        };
        // Підказки при фокусі порожнього поля: нещодавні пошуки + популярні напрямки
        function showSuggest() {
            const recent = getRecent();
            let h = '';
            if (recent.length) h += `<div class="ac-head">${T.ac.recent}</div>` + recent.map(r => routeItemHtml(r, 'i-clock')).join('');
            h += `<div class="ac-head">${T.ac.popular}</div>` + POPULAR.map(r => routeItemHtml(r, 'i-bolt')).join('');
            lst.innerHTML = h; hl = -1; lst.style.display = 'block'; lst.classList.add('sg-wide');
            lst.querySelectorAll('.ac-route').forEach(el => el.addEventListener('click', () => applyRoute(el.dataset)));
        }
        inp.addEventListener('focus', function () {
            if (this.dataset.skipSuggest) { delete this.dataset.skipSuggest; return; } // автофокус на вході - без панелі (панель за кліком)
            // Панель «Нещодавні/Популярні» показуємо лише у полі «Звідки» - у «Куди» вона заважає
            if (isDep && this.value.trim().length < 2) showSuggest();
        });
        // Клік по полю відкриває панель навіть коли воно ВЖЕ у фокусі (після автофокуса на вході),
        // адже повторний клік у сфокусоване поле focus-подію не породжує.
        inp.addEventListener('click', function () {
            if (isDep && this.value.trim().length < 2 && lst.style.display !== 'block') showSuggest();
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
                // Пошук фільтрує за УКРАЇНСЬКОЮ назвою (q набраний в полі) незалежно від
                // мови сторінки - це не змінюємо (поза межами задачі). Показ - інша річ:
                // на англійській показуємо переклад без підсвітки збігу (вона рахована
                // проти українського тексту й для перекладеного рядка сенсу не має).
                const dispName = cityName(city.id, city.name);
                const nameHtml = LANG === 'en'
                    ? escTxt(dispName)
                    : escTxt(city.name).replace(new RegExp(`(${escRe(q)})`, 'gi'), '<strong>$1</strong>');
                el.innerHTML = `<svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-location-dot"></use></svg><span>` + nameHtml + `</span>`;
                el.addEventListener('click', () => {
                    inp.value = dispName; lst.style.display = 'none'; hl = -1;
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
    // На англійській сторінці поле показує cityName(c.id, c.name) (переклад/транслітерація),
    // а НЕ c.name - тому звіряти текст треба з тим самим відображуваним іменем, інакше
    // (КРИТИЧНО) syncTypedIds() нижче ніколи не визнає жоден вибір «своїм» і щоразу
    // скидатиме depId/arrId у null - англійський пошук був би непрацездатний повністю.
    const cityDisplayName = c => (LANG === 'en' ? cityName(c.id, c.name) : c.name);
    function matchCityByText(text) {
        const q = (text || '').trim().toLowerCase();
        if (q.length < 2 || !cities.length) return null;
        const exact = cities.find(c => cityDisplayName(c).trim().toLowerCase() === q);
        if (exact) return exact.id;
        const pre = cities.filter(c => cityDisplayName(c).trim().toLowerCase().startsWith(q));
        if (pre.length === 1) return pre[0].id;
        const inc = cities.filter(c => cityDisplayName(c).trim().toLowerCase().includes(q));
        if (inc.length === 1) return inc[0].id;
        return null;
    }
    // Якщо користувач ввів місто вручну (не клікнув підказку) або змінив текст після вибору -
    // підставляємо id за текстом. Так пошук працює навіть без кліку по підказці.
    function syncTypedIds() {
        const dEl = document.getElementById('departure'), aEl = document.getElementById('arrival');
        const byId = id => cities.find(c => String(c.id) === String(id));
        const ok = (id, el) => { const c = byId(id); return c && cityDisplayName(c).trim().toLowerCase() === el.value.trim().toLowerCase(); };
        if (!ok(depId, dEl)) { const id = matchCityByText(dEl.value); depId = id; if (id != null) dEl.value = cityDisplayName(byId(id)); }
        if (!ok(arrId, aEl)) { const id = matchCityByText(aEl.value); arrId = id; if (id != null) aEl.value = cityDisplayName(byId(id)); }
    }

    async function search() {
        syncTypedIds();
        if (!depId || !arrId) { setStatus(T.search.checkCities, 'error'); setTimeout(() => setStatus('',''), 3500); return; }
        if (depId === arrId) { setStatus(T.search.differentCities, 'error'); return; }
        saveRecent(document.getElementById('departure').value, document.getElementById('arrival').value, depId, arrId);
        // На сторінці маршруту: якщо обрали ІНШИЙ напрямок - ведемо на головну з авто-пошуком
        // (URL сторінки завжди = її маршрут). Той самий маршрут (стрічка дат) шукаємо тут же.
        if (window.__ROUTE__ && (String(depId) !== String(window.__ROUTE__.fromId) || String(arrId) !== String(window.__ROUTE__.toId))) {
            location.href = `/?from=${depId}&to=${arrId}&date=${document.getElementById('date-input').value}`;
            return;
        }
        const [y, m, d] = document.getElementById('date-input').value.split('-');
        const date = `${d}.${m}.${y}`;
        setStatus(T.search.searching, 'loading');
        const searchBtn = document.getElementById('search-btn');
        searchBtn.disabled = true;
        searchBtn.classList.add('searching');
        searchBtn.innerHTML = `<svg class="ic ic-spin" aria-hidden="true"><use href="/_sprite.svg#i-spinner"></use></svg> ${T.search.searchingBtn}`;
        const resultsEl = document.getElementById('results');
        resultsEl.innerHTML = '';
        // Skeleton - лише коли пошук затягується (>450мс). Швидкий/кешований - без мерехтіння.
        // Одразу ховаємо "Як це працює", щоб скелет був на видноті (під формою), а не нижче секції.
        const skelTimer = setTimeout(() => {
            const how = document.getElementById('how-it-works'); if (how) how.style.display = 'none'; const pr = document.getElementById('pop-routes'); if (pr) pr.style.display = 'none';
            resultsEl.innerHTML = skeletonHtml();
        }, 450);
        try {
            const r = await fetch(`${PROXY_BASE}/search${LANG_Q}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ from_id: depId, to_id: arrId, date, notrack: noTrack() })
            });
            clearTimeout(skelTimer);
            if (!r.ok) {
                const err = await r.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${r.status}`);
            }
            renderResults(await r.json(), date);
        } catch (e) { clearTimeout(skelTimer); resultsEl.innerHTML = ''; setStatus(T.search.error(e.message), 'error'); }
        finally {
            searchBtn.disabled = false;
            searchBtn.classList.remove('searching');
            searchBtn.innerHTML = `<svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-magnifying-glass"></use></svg> ${T.search.findRoute}`;
        }
    }

    // Пересадки: contrabus дає їх одним рядком ("Пересадка №1...Пересадка №2...").
    // Розбиваємо по "Пересадка №N" у окремі рядки - без круглих плашок, просто з крапкою.
    function transfersHtml(ci) {
        if (!ci) return T.transfers.direct;
        // Task 15b: на англійській - розпізнаний зв'язний опис пересадки замість
        // порізаного на "Пересадка №N" рядків; не розпізнано - оригінал українською
        // з чесною позначкою (vendorHtml ніколи не ховає непереклад).
        if (LANG === 'en') return vendorHtml('transferText', ci, 'Transfer details');
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

    // "06.06.2026" -> "6 чер"
    function fmtNiceDate(d) {
        if (!d) return '';
        const [day, m] = d.split('.');
        if (!day || !m) return d;
        return `${parseInt(day, 10)} ${T.date.monFull[parseInt(m, 10) - 1] || ''}`;
    }
    // travel_time (секунди) -> "49 год" або "2 дні 1 год"
    function fmtDuration(sec) {
        if (!sec || isNaN(sec)) return '';
        const h = Math.round(sec / 3600);
        if (h < 24) return `${h} ${T.duration.hour}`;
        const days = Math.floor(h / 24), rh = h % 24;
        return `${days} ${plural(days, T.duration.dayForms)}${rh ? ` ${rh} ${T.duration.hour}` : ''}`;
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
        const word = plural(n, T.transfers.forms);
        return { label: `${n} ${word} · ${cities.join(', ')}`, full: text };
    }

    // Узгодження слова "рейс" з числом
    const routeWord = n => plural(n, T.suggest.routeForms);

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
                box.innerHTML = `<div class="sg-title"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-lightbulb"></use></svg> ${T.suggest.otherDate(escTxt(s.date))}</div>
                    <button class="sg-btn sg-primary" id="sg-date">${T.suggest.showOtherDate(escTxt(s.date))} <span class="sg-dist">${escTxt(s.count)} ${routeWord(s.count)}</span> <svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-arrow-right"></use></svg></button>`;
                document.getElementById('sg-date').addEventListener('click', () => setDateAndSearch(s.date));
            } else if (s.type === 'cities') {
                window._alts = s.alternatives;
                box.innerHTML = `<div class="sg-title"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-lightbulb"></use></svg> ${T.suggest.noDirect}</div>
                    <div class="sg-cities">${s.alternatives.map((a, i) =>
                        `<button class="sg-btn sg-city" data-ai="${i}"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-location-dot"></use></svg> ${escTxt(cityName(a.id, a.name))} <span class="sg-dist">~${escTxt(a.distance_km)} ${T.suggest.km} · ${escTxt(a.count)} ${routeWord(a.count)}</span></button>`
                    ).join('')}</div>`;
                box.querySelectorAll('.sg-city').forEach(b => b.addEventListener('click', () => {
                    const a = window._alts[b.dataset.ai];
                    setCityAndSearch(a.id, a.name);
                }));
            } else {
                box.innerHTML = `<div class="sg-none">${T.suggest.none}</div>`;
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
        document.getElementById('arrival').value = cityName(cid, cname);
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

    // Зручності рейсу: код API → іконка + назва. Сама карта - у T.amenities (задача 2/4);
    // тут лишається тільки логіка пошуку/нормалізації коду.
    // Ключі словника - у нижньому регістрі; код від API нормалізуємо перед пошуком
    // (той самий код приходить і як "Drinks", і як "drinks").
    const amenKey = c => String(c || '').trim().toLowerCase();
    // Шаблонні коди: той самий сенс приходить із різним числом ("16_noaccompany",
    // "18_noaccompany"). Обробляємо правилом, щоб не додавати кожен варіант окремо.
    const AMEN_PATTERNS = [
        { re: /^(\d{1,2})_noaccompany$/, make: m => ({ i: 'child-reaching', t: T.amenities.noAccompany(m[1]) }) }
    ];
    function amenInfo(code) {
        if (T.amenities[code]) return T.amenities[code];
        for (const p of AMEN_PATTERNS) { const m = p.re.exec(code); if (m) return p.make(m); }
        return null;
    }
    // Невідомі коди від API НЕ показуємо клієнту (сирий англійський код лише плутає),
    // але один раз за сесію репортимо в лог сервера - щоб ми дізнались і додали переклад.
    const _unkAmen = new Set();
    function reportUnknownAmenity(code) {
        if (_unkAmen.has(code) || _unkAmen.size > 5) return;
        _unkAmen.add(code);
        try {
            fetch(`${PROXY_BASE}/client-error`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ msg: `Невідомий amenity-код від contrabus: "${code}" - додайте переклад у T_UK.amenities`, page: location.pathname })
            });
        } catch (e) { }
    }
    function amenitiesHtml(codes) {
        if (!Array.isArray(codes) || !codes.length) return '';
        // 'noprepayment' - послуга перевізника загалом і може суперечити умовам
        // конкретного рейсу (label_type) - тип оплати показуємо лише у рядку "Оплата"
        const chips = codes.filter(c => amenKey(c) && amenKey(c) !== 'noprepayment').map(raw => {
            const code = amenKey(raw);
            const a = amenInfo(code);
            if (!a) { reportUnknownAmenity(code); return ''; }
            return `<span class="amen"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-${a.i}"></use></svg> ${escTxt(a.t)}</span>`;
        }).join('');
        return `<div class="td-row"><div class="td-label">${T.results.amenitiesLabel}</div><div class="td-amens">${chips}</div></div>`;
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
            ? `<span class="pay-badge pb-none"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-credit-card"></use></svg> ${T.pay.none}</span>`
            : cat === 'group'
                ? `<span class="pay-badge pb-none"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-credit-card"></use></svg> ${T.pay.none}</span><span class="pay-badge pb-part"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-users"></use></svg> ${T.pay.groupNote}</span>`
            : (cat === 'partial'
                ? `<span class="pay-badge pb-part"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-coins"></use></svg> ${T.pay.partial}</span>`
                : `<span class="pay-badge pb-full"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-money-bill-wave"></use></svg> ${T.pay.full}</span>`);
        // price_label несе умови оплати (передоплата для груп тощо) - НІКОЛИ не ховається,
        // навіть коли LANG==='en' і priceLabelText() не розпізнала шаблон: показ
        // оригіналу українською (через vendorHtml) кращий за мовчання, яке виглядає
        // як "бронь безкоштовна".
        const priceNote = LANG === 'en' ? vendorHtml('priceLabelText', rt.price_label, 'Payment terms') : escTxt(rt.price_label);
        return `<div class="pay-badges">${label}</div>` + (rt.price_label ? `<div class="pay-note">${priceNote}</div>` : '');
    }

    // Головний бейдж типу оплати - завжди видимий на картці й у шапці модалки (щоб не ховався в деталях).
    // none + group: для 1-2 пасажирів передоплати немає (нюанс про групи лишається в деталях).
    function payTag(rt) {
        const cat = payCategory(rt);
        if (cat === 'partial') return { cls: 'pay-part', txt: T.pay.partial };
        if (cat === 'full') return { cls: 'pay-full', txt: T.pay.full };
        return { cls: 'pay-none', txt: T.pay.none };
    }

    function renderResults(routes, date) {
        const el = document.getElementById('results');
        const dep = document.getElementById('departure').value;
        const arr = document.getElementById('arrival').value;
        const how = document.getElementById('how-it-works'); if (how) how.style.display = 'none'; const pr = document.getElementById('pop-routes'); if (pr) pr.style.display = 'none';

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
                <h3>${T.results.noneFoundTitle}</h3>
                <p>${T.results.noneFoundBody(escTxt(date), escTxt(cityName(depId, dep)), escTxt(cityName(arrId, arr)))}</p>
                <div class="suggest-box" id="suggest-box">
                    <div class="sg-loading"><svg class="ic ic-spin" aria-hidden="true"><use href="/_sprite.svg#i-spinner"></use></svg> ${T.results.searchingSuggest}</div>
                    <div class="sg-skel">
                        <div class="skel-bar" style="width:230px;height:44px;border-radius:50px"></div>
                        <div class="skel-bar" style="width:180px;height:44px;border-radius:50px"></div>
                    </div>
                </div>
            </div>`;
            setStatus(T.results.noneFoundStatus, '');
            fetchSuggest(date);
            return;
        }
        setStatus(T.results.found(routes.length), 'success');
        // contrabus присилає коди зручностей у різному регістрі ("Drinks" і "drinks") та
        // з порожніми елементами. Нормалізуємо ОДИН раз тут, щоб усі перевірки нижче
        // (фільтр тварин, вибір місця, чипи) не залежали від регістру - інакше рейс із
        // кодом "Pets" тихо зникав би з фільтра «З твариною».
        routes.forEach(rt => {
            if (Array.isArray(rt.carrier_amenities)) {
                rt.carrier_amenities = rt.carrier_amenities
                    .filter(c => c && String(c).trim())
                    .map(c => String(c).trim().toLowerCase());
            }
        });
        _routes = routes; _dep = dep; _arr = arr; _depId = depId; _arrId = arrId; _date = date;
        _shown = SHOW_STEP; // новий пошук - знову з першої порції

        // Подвійний шеврон ↕ на кожній кнопці сортування: одразу видно, що напрямок
        // можна перемкнути (текуче підсвічене, друге приглушене). Без цього реверс був прихований.
        const sortArrows = '<span class="sort-dir" aria-hidden="true"><svg viewBox="0 0 10 14"><path class="sd-up" d="M5 0.5 L9 4.5 L1 4.5 Z"/><path class="sd-dn" d="M5 13.5 L9 9.5 L1 9.5 Z"/></svg></span>';

        el.innerHTML = `
            <div class="res-hdr">
                <div class="res-title">${escTxt(cityName(depId, dep))} → ${escTxt(cityName(arrId, arr))} · ${escTxt(date)}</div>
                <div class="res-badge">${T.results.badge(routes.length)}</div>
            </div>
            <div class="sort-bar">
                <span class="sort-lbl"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-arrow-down-short-wide"></use></svg> ${T.results.sort}</span>
                <button class="sort-btn" data-sort="price">${T.results.sortPrice}${sortArrows}</button>
                <button class="sort-btn" data-sort="duration">${T.results.sortDuration}${sortArrows}</button>
                <button class="sort-btn" data-sort="departure">${T.results.sortDeparture}${sortArrows}</button>
            </div>
            <div class="sort-bar filter-bar">
                <span class="sort-lbl sort-lbl-f"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-filter"></use></svg> ${T.results.filters}</span>
                <button class="sort-btn filter-btn" data-filter="noprepay"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-credit-card"></use></svg> ${T.pay.none}</button>
                <button class="sort-btn filter-btn" data-filter="direct"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-route"></use></svg> ${T.results.filterDirect}</button>
                <button class="sort-btn filter-btn" data-filter="pets"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-paw"></use></svg> ${T.results.filterPets}</button>
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
        return ` <span class="carr-stars" title="${T.card.ratingTitle(escTxt(raw), scale10 ? 10 : 5)}">${s}<span class="st-num">${escTxt(raw)}</span></span>`;
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
            tickets.innerHTML = `<div class="no-res"><div class="no-res-ico"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-filter"></use></svg></div><h3>${T.results.filteredNoneTitle}</h3><p>${T.results.filteredNoneBody}</p></div>`;
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
            // Сирі (неперекладені) назви - для stripCityTxt нижче: він порівнює з префіксом
            // адреси станції, яка приходить від API УКРАЇНСЬКОЮ; переклад застосовуємо
            // лише до того, що йде В ЕКРАН, а не до значення, яким звіряємо збіг.
            const fromCityRaw = rt.from || _dep;
            const toCityRaw   = rt.to   || _arr;
            const fromCity = escTxt(cityName(_depId, fromCityRaw));
            const toCity   = escTxt(cityName(_arrId, toCityRaw));
            const pr    = escTxt(fmtPrice(rt) || '-');
            const st    = escTxt(rt.free_seats !== undefined ? rt.free_seats : '?');
            const carRaw = rt.carrier || rt.company;
            const car   = carRaw ? escTxt(vendorPlainText('carrierName', carRaw)) : escTxt(T.card.busFallback);
            const dur   = fmtDuration(rt.travel_time);
            const pay   = payTag(rt);
            return `<div class="ticket ${pay.cls}" style="animation-delay:${Math.min((i % SHOW_STEP) * 0.05, 0.28)}s">
                <div class="t-main">
                    <div class="t-ep">
                        <div class="t-time">${dt}</div>
                        ${ddate ? `<div class="t-date">${ddate}</div>` : ''}
                        <div class="t-city">${fromCity}</div>
                        ${rt.departure_station ? `<div class="t-station" title="${escTxt(stationName(rt.departure_station))}">${escTxt(stationName(stripCityTxt(rt.departure_station, fromCityRaw)))}</div>` : ''}
                    </div>
                    <div class="t-route">
                        ${dur ? `<div class="t-dur"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-clock"></use></svg> ${dur} ${T.card.enRoute}</div>` : ''}
                        <div class="t-line"><div class="t-dot"></div><div class="t-dash"></div><span class="t-line-chip ${isDirect(rt) ? 'tlc-ok' : ''}">${isDirect(rt) ? T.card.direct : T.card.withTransfer}</span><div class="t-dash"></div><div class="t-arrow"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-chevron-right"></use></svg></div></div>
                        <div class="t-carrier" title="${car}"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-bus"></use></svg><span class="t-car-name">${car}</span></div>
                    </div>
                    <div class="t-ep" style="text-align:right">
                        <div class="t-time">${at}</div>
                        ${adate ? `<div class="t-date">${adate}</div>` : ''}
                        <div class="t-city">${toCity}</div>
                        ${rt.arrival_station ? `<div class="t-station" title="${escTxt(stationName(rt.arrival_station))}">${escTxt(stationName(stripCityTxt(rt.arrival_station, toCityRaw)))}</div>` : ''}
                    </div>
                    <div class="t-divider"></div>
                    <div class="t-action">
                        <div class="t-pricebox">
                            <div class="t-price">${pr}</div>
                            <div class="t-price-sub">${T.card.perSeat}</div>
                            <div class="t-seats"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-chair"></use></svg> ${st} ${T.card.free}</div>
                        </div>
                        <span class="t-pay ${pay.cls}">${pay.txt}</span>
                    </div>
                </div>
                <div class="t-foot">
                    <button class="t-toggle" type="button" data-i="${i}">${T.card.details} <svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-chevron-down"></use></svg></button>
                    <button class="btn-ticket" data-i="${i}">${rt.bookable ? T.card.book : T.card.order}</button>
                </div>
                <div class="t-details">
                    ${amenitiesHtml(rt.carrier_amenities)}
                    <div class="td-row"><div class="td-label">${T.card.payment}</div><div class="td-text">${paymentHtml(rt)}</div></div>
                    <div class="td-row"><div class="td-label">${T.card.discLabel}</div><div class="td-text td-disc">-</div></div>
                    <div class="td-row"><div class="td-label">${T.card.transfers}</div><div class="td-text">${transfersHtml(rt.change_info)}</div></div>
                    <div class="td-row"><div class="td-label">${T.card.carrier}</div><div class="td-text td-carrier">${car}${starsHtml(rt.carrier_rating)}${rt.carrier_reliability ? ` <span class="carr-badge cb-rel"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-shield-halved"></use></svg> ${T.card.reliability(escTxt(rt.carrier_reliability))}</span>` : ''}</div></div>
                    ${rt.baggage ? `<div class="td-row"><div class="td-label">${T.card.baggage}</div><div class="td-text">${LANG === 'en' ? vendorHtml('baggageText', rt.baggage, 'Baggage details') : escTxt(rt.baggage)}</div></div>` : ''}
                    <div class="td-foot">
                        <button class="td-close" type="button"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-chevron-up"></use></svg> ${T.card.collapse}</button>
                        <button class="btn-ticket" data-i="${i}">${rt.bookable ? T.card.book : T.card.order}</button>
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
                const pf = () => { prefetchDiscounts(_view[b.dataset.i]); prefetchSeats(_view[b.dataset.i]); }; // предзавантаження знижок ще до кліку
                b.addEventListener('pointerenter', pf);
                b.addEventListener('touchstart', pf, { passive: true });
            });
            const tg = ticket.querySelector('.t-toggle');
            if (tg) {
                const pf = () => { prefetchDiscounts(_view[tg.dataset.i]); prefetchSeats(_view[tg.dataset.i]); };
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
        btn.textContent = T.card.moreBtn(Math.min(SHOW_STEP, _view.length - _shown), _view.length, routeWord(_view.length));
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
        if (!rt || !rt.data_bundle) { el.textContent = T.discounts.unavailable; return; }
        const cached = _discByBundle.get(rt.data_bundle);
        if (!Array.isArray(cached)) el.textContent = T.discounts.loading; // показуємо лише якщо реально чекаємо мережу
        const d = await fetchDiscounts(rt.data_bundle);
        const real = (Array.isArray(d) ? d : []).filter(x => x.percent > 0);
        // Чіп ґаючиз на API опис знижки: показуємо тільки українську частину + процент
        const chip = x => {
            // Чіп вузький, тож позначку "(не перекладено)" сюди не вставляємо - вона
            // розірвала б верстку. Нерозпізнана назва просто лишається українською:
            // сама вона описова, а головне (відсоток) мовно-нейтральне й поруч.
            const name = escTxt(vendorPlainText('discountName', cleanDiscName(x.description)));
            const pct = `<b class="dc-pct">-${escTxt(x.percent)}%</b>`;
            return `<span class="disc-chip"><span class="dc-name">${name}</span>${pct}</span>`;
        };
        el.innerHTML = real.length
            ? `<div class="disc-chips">${real.map(chip).join('')}</div>`
            : T.discounts.none;
    }

    // ---------- Пасажири + знижки ----------
    let _modalDiscounts = [];   // знижки поточного рейсу
    let _paxDiscSel = [];        // обрана знижка (id) для кожного пасажира за індексом
    let _discOpen = false;       // блок знижок розгорнутий?

    function paxRowHtml() {
        return `<div class="pax-row">
            <div class="pax-head">
                <span class="pax-title"></span>
                <button type="button" class="pax-del"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-circle-xmark"></use></svg> ${T.pax.delete}</button>
            </div>
            <div class="pax-grid">
                <div class="fg"><label class="f-lbl">${T.pax.firstName}</label><input type="text" class="f-inp pax-name" placeholder="${T.pax.firstNamePh}" autocomplete="given-name"></div>
                <div class="fg"><label class="f-lbl">${T.pax.lastName}</label><input type="text" class="f-inp pax-surname" placeholder="${T.pax.lastNamePh}" autocomplete="family-name"></div>
                <div class="fg pax-phone-fg"><label class="f-lbl">${T.pax.phone}</label><input type="tel" class="f-inp pax-phone" placeholder="${T.pax.phonePh}" inputmode="tel" autocomplete="tel"></div>
            </div>
        </div>`;
    }
    function renumberPax() {
        const rows = document.querySelectorAll('#pax-list .pax-row');
        rows.forEach((row, i) => {
            row.querySelector('.pax-title').textContent = T.pax.title(i + 1);
            row.querySelector('.pax-del').style.display = rows.length > 1 ? '' : 'none';
        });
    }
    const seatWord = n => plural(n, T.seats.forms);

    // Блок знижок усередині "Додатково" - селекти показуємо одразу, без вкладеного розкриття
    function renderDiscBlock() {
        const block = document.getElementById('disc-block');
        const rows = [...document.querySelectorAll('#pax-list .pax-row')];
        const real = _modalDiscounts.filter(d => d.percent > 0); // ховаємо "Повний" та 0% (напр. промокод)
        if (!real.length || !rows.length) { block.style.display = 'none'; block.innerHTML = ''; document.getElementById('m-disc-note').style.display = 'none'; _discOpen = false; updateTotal(); return; }
        block.style.display = '';
        _discOpen = true; // знижки доступні - selectи активні (за замовчуванням "Повний квиток")
        // опції: "Повний квиток" (за замовчуванням) + реальні знижки.
        // label іде в <option>, тобто в контекст без HTML - беремо текстовий варіант
        // перекладу, без позначки-span; нерозпізнана назва лишається українською.
        const opts = [{ id: '', percent: 0, label: T.pax.fullTicket }].concat(real.map(d => ({ id: d.id, percent: d.percent, label: vendorPlainText('discountName', cleanDiscName(d.description)) })));
        block.innerHTML = `
            <div class="disc-head"><span class="disc-title"><svg class="ic" style="color:var(--orange);margin-right:6px" aria-hidden="true"><use href="/_sprite.svg#i-tag"></use></svg>${T.pax.discTitle}</span></div>
            <div class="disc-body">
                ${rows.map((r, i) => {
                    const cur = _paxDiscSel[i] != null ? String(_paxDiscSel[i]) : '';
                    return `<div class="disc-row">
                        <span class="disc-name">${T.pax.title(i + 1)}</span>
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
            ? `${T.pax.total(rows.length, seatWord(rows.length))} <b>${Math.round(total * 100) / 100} ${cur}</b>`
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
            renumberPax(); renderDiscBlock(); applyBookUI(); seatSyncPax();
        });
        renumberPax();
        renderDiscBlock();
        applyBookUI();
        seatSyncPax(); // кількість пасажирів = кількість доступних до вибору місць
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

    // ---------- Вибір місця (схема салону з get_free_seats) ----------
    let _seatScheme = null;  // масив поверхів; кожен - рядки клітинок seat/driver/table/empty
    let _seatSel = [];       // обрані місця [{id, name}] у порядку вибору → пасажир 1, 2, ...
    let _seatDeck = 0;       // активний поверх (для двоповерхових)

    // Кеш схем за bundle (TTL 60 с - місця займаються в реальному часі, довше тримати шкідливо).
    // Дає префетч на наведення і миттєву появу рядка в модалці.
    const _seatsByBundle = new Map();
    function fetchSeats(bundle) {
        if (!bundle) return Promise.resolve(null);
        const hit = _seatsByBundle.get(bundle);
        if (hit && (hit.p || Date.now() - hit.t < 60 * 1000)) return hit.p || Promise.resolve(hit.d);
        const p = fetch(`${PROXY_BASE}/seats`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data_bundle: bundle })
        }).then(r => r.json()).then(d => {
            _seatsByBundle.set(bundle, { d, t: Date.now() });
            return d;
        }).catch(() => { _seatsByBundle.delete(bundle); return null; });
        _seatsByBundle.set(bundle, { p });
        return p;
    }
    const hasSeatSelect = rt => hasAmen(rt, 'seatselect');
    function prefetchSeats(rt) { if (hasSeatSelect(rt) && rt.data_bundle) fetchSeats(rt.data_bundle); }

    async function loadModalSeats(rt) {
        if (!hasSeatSelect(rt) || !rt.data_bundle) return;
        renderSeatLaunch(true); // рядок зʼявляється ОДРАЗУ (стан завантаження), без стрибка форми
        const d = await fetchSeats(rt.data_bundle);
        if (selRoute !== rt) return; // модалку вже відкрили іншим рейсом
        if (d && d.select_possible && Array.isArray(d.scheme) && d.scheme.length) {
            _seatScheme = d.scheme; _seatDeck = 0;
            renderSeatLaunch(); // активний стан
        } else {
            // перевізник насправді не дає обирати місце на цьому рейсі - прибираємо рядок
            const box = document.getElementById('seat-block');
            if (box) { box.style.display = 'none'; box.innerHTML = ''; }
        }
    }

    function seatCellHtml(c) {
        if (!c || c.type === 'empty') return '<span class="st st-gap"></span>';
        if (c.type === 'driver') return `<span class="st st-driver" title="${T.seats.driver}"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-user"></use></svg></span>`;
        if (c.type === 'table') return `<span class="st st-table" title="${T.seats.table}"></span>`;
        if (c.type === 'seat') {
            const sel = _seatSel.some(s => String(s.id) === String(c.id));
            if (!c.available && !sel) return `<span class="st st-taken" title="${T.seats.taken}">${escTxt(c.number)}</span>`;
            return `<button type="button" class="st st-free${sel ? ' st-sel' : ''}" data-id="${escTxt(c.id)}" data-name="${escTxt(c.number)}">${escTxt(c.number)}</button>`;
        }
        return '<span class="st st-gap"></span>';
    }

    // Компактний рядок у формі: назва + поточний вибір ("Автоматично" / "60, 63"), клік відкриває аркуш.
    // Значення і підпис "необовʼязково" - колонкою, щоб не обрізались на вузьких екранах.
    function renderSeatLaunch(loading) {
        const box = document.getElementById('seat-block');
        if (!box) return;
        const val = loading ? '…' : (_seatSel.length ? _seatSel.map(s => s.name).join(', ') : T.seats.auto);
        box.innerHTML =
            `<button type="button" class="seat-launch" id="seat-launch"${loading ? ' disabled' : ''}>
                <span class="sl-l"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-chair"></use></svg> ${T.seats.launch}</span>
                <span class="sl-r"><span class="sl-col"><b title="${escTxt(val)}">${escTxt(val)}</b><span class="sl-opt">${T.seats.optional}</span></span> <svg class="ic sl-chev" aria-hidden="true"><use href="/_sprite.svg#i-chevron-right"></use></svg></span>
            </button>`;
        box.style.display = 'block';
        if (!loading) box.querySelector('#seat-launch').addEventListener('click', openSeatSheet);
    }

    function seatSheetOpen() {
        const bg = document.getElementById('seat-sheet-bg');
        return !!bg && bg.classList.contains('open');
    }

    function openSeatSheet() {
        if (!_seatScheme) return;
        renderSeatSheetBody();
        document.getElementById('seat-sheet-bg').classList.add('open');
    }

    function closeSeatSheet() {
        const bg = document.getElementById('seat-sheet-bg');
        if (bg) bg.classList.remove('open');
        renderSeatLaunch(); // оновлюємо значення в рядку форми
    }

    function renderSeatSheetBody() {
        const body = document.getElementById('ss-body');
        if (!body || !_seatScheme) return;
        const decks = _seatScheme;
        const tabs = decks.length > 1
            ? `<div class="sb-decks">${decks.map((_, i) => `<button type="button" class="sb-deck${i === _seatDeck ? ' active' : ''}" data-d="${i}">${T.seats.deck(i + 1)}</button>`).join('')}</div>`
            : '';
        // Повністю порожні ряди схеми (без сидінь/водія/столиків): хвостові відрізаємо зовсім,
        // а всередині схлопуємо в маленький зазор - інакше салон розтягується "дірками"
        const isEmptyRow = row => row.every(c => !c || c.type === 'empty');
        const deckRows = (decks[_seatDeck] || []).slice();
        while (deckRows.length && isEmptyRow(deckRows[deckRows.length - 1])) deckRows.pop();
        const rows = deckRows.map(row => isEmptyRow(row)
            ? '<div class="sb-row sb-row-gap"></div>'
            : `<div class="sb-row">${row.map(seatCellHtml).join('')}</div>`).join('');
        body.innerHTML = tabs +
            `<div class="sb-bus">${rows}</div>` +
            `<div class="sb-legend"><span><i class="lg lg-free"></i> ${T.seats.legendFree}</span><span><i class="lg lg-sel"></i> ${T.seats.legendSel}</span><span><i class="lg lg-taken"></i> ${T.seats.legendTaken}</span></div>`;
        updateSeatHint();
    }

    function updateSeatHint() {
        const h = document.getElementById('sb-hint');
        if (!h) return;
        const need = paxCount();
        h.innerHTML = _seatSel.length
            ? T.seats.chosen(escTxt(_seatSel.map(s => s.name).join(', ')), _seatSel.length, need)
            : T.seats.hint(need);
        const clr = document.getElementById('sb-clear');
        if (clr) clr.style.visibility = _seatSel.length ? 'visible' : 'hidden';
    }

    // Пасажирів стало менше, ніж обраних місць - зайві вибори прибираємо
    function seatSyncPax() {
        const need = paxCount();
        if (_seatSel.length > need) _seatSel = _seatSel.slice(0, need);
        if (seatSheetOpen()) renderSeatSheetBody();
        if (_seatScheme) renderSeatLaunch();
    }

    // Аркуш статичний у розмітці модалки - обробники навішуємо один раз
    const _ssBg = document.getElementById('seat-sheet-bg');
    if (_ssBg) {
        _ssBg.addEventListener('pointerdown', e => { _ssBgPointerDown = (e.target === _ssBg); });
        _ssBg.addEventListener('click', e => {
            if (e.target === _ssBg) { if (_ssBgPointerDown) closeSeatSheet(); _ssBgPointerDown = false; return; }           // клік по затемненню
            if (e.target.closest('#ss-x') || e.target.closest('#ss-done')) { closeSeatSheet(); return; }
            if (e.target.closest('#sb-clear')) { _seatSel = []; renderSeatSheetBody(); return; }
            const deck = e.target.closest('.sb-deck');
            if (deck) { _seatDeck = +deck.dataset.d || 0; renderSeatSheetBody(); return; }
            const st = e.target.closest('.st-free');
            if (!st) return;
            const id = st.dataset.id, name = st.dataset.name;
            const i = _seatSel.findIndex(s => String(s.id) === String(id));
            if (i >= 0) _seatSel.splice(i, 1);                        // повторний клік - зняти вибір
            else {
                if (_seatSel.length >= paxCount()) _seatSel.shift();  // ліміт досягнуто - звільняємо найперше
                _seatSel.push({ id, name });
            }
            renderSeatSheetBody();
        });
    }

    // Cloudflare Turnstile (антибот): плейсхолдер до появи реального site key у Cloudflare -
    // поки значення не змінено, рендер віджета пропускається (все "спить", як і раніше).
    const TURNSTILE_SITE_KEY = '0x4AAAAAAD1TSUyza-Kud8la';
    let _tsWidgetId = null; // id відрендереного (explicit-режим) віджета Turnstile - для remove()/reset()/getResponse()
    let _tsTries = 0;       // спроби рендеру, поки api.js ще вантажиться (не проґавити віджет)
    let _bookMode = false; // true = рейс без передоплати, бронюємо одразу
    let _isGroup = false, _groupThr = 0; // груповий рейс і поріг передоплати (з умови перевізника)
    let _okToken = ''; // токен броні з відповіді /order - для посилання на сторінку броні на екрані успіху
    let _okGuardArmed = false; // успіх з квитками показано, але жодного не завантажено - запобіжник закриття
    let _modalBgPointerDown = false; // pointerdown трапив на #modal-bg - закривати тільки якщо click теж на фоні
    let _ssBgPointerDown = false; // pointerdown трапив на #seat-sheet-bg - закривати тільки якщо click теж на фоні
    const petChosen = () => document.getElementById('pet-select').value === 'yes';
    const paxCount = () => document.querySelectorAll('#pax-list .pax-row').length;
    // Група досягла порогу передоплати перевізника (від _groupThr осіб - потрібна передоплата)
    const groupOver = () => _isGroup && _groupThr > 0 && paxCount() >= _groupThr;
    // Реальна можливість автоброні: рейс bookable, БЕЗ тварини і група не перевищила поріг
    const canBookNow = () => _bookMode && !petChosen() && !groupOver();
    // Оновлює заголовок/підказку/кнопку/бейдж оплати відповідно до стану (з урахуванням групи)
    function applyBookUI() {
        const book = canBookNow();
        document.getElementById('m-title').textContent = book ? T.modal.titleBook : T.modal.titleOrder;
        document.getElementById('m-booknote').style.display = book ? 'flex' : 'none';
        document.getElementById('m-submit').innerHTML = book
            ? `<svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-bolt"></use></svg> ${T.card.book}`
            : `<svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-paper-plane"></use></svg> ${T.order.send}`;
        // Бейдж оплати в шапці: для групового рейсу залежить від кількості пасажирів
        const badge = document.querySelector('#m-trip .mt-pay .t-pay');
        if (badge && _isGroup) {
            const over = groupOver();
            badge.className = 't-pay ' + (over ? 'pay-part' : 'pay-none');
            badge.textContent = over ? T.modal.groupPrepayBadge : T.pay.none;
        }
        // Примітка про умову групової передоплати (показуємо лише для групових рейсів)
        const gn = document.getElementById('m-groupnote');
        if (gn) {
            const show = _isGroup && _groupThr > 0;
            gn.style.display = show ? 'flex' : 'none';
            if (show) gn.innerHTML = `<svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-circle-info"></use></svg> ${T.modal.groupNote(_groupThr)}`;
        }
        updateTurnstile(book);
    }
    // Показує/ховає віджет Turnstile залежно від того, чи це зараз реальна автобронь (canBookNow()):
    // звичайну заявку менеджеру Turnstile не потребує і не повинен турбувати відвідувача.
    // Рендер - лише коли є справжній site key (не плейсхолдер) і скрипт api.js вже завантажився.
    function updateTurnstile(book) {
        const holder = document.getElementById('ts-holder');
        if (!holder) return;
        if (book && TURNSTILE_SITE_KEY !== 'TURNSTILE_SITE_KEY_PLACEHOLDER') {
            if (!window.turnstile) {
                // api.js ще не завантажився - повторимо за мить (до ~4с), поки модалка відкрита
                if (_tsTries < 20) { _tsTries++; setTimeout(() => { if (document.getElementById('modal-bg').classList.contains('open')) updateTurnstile(canBookNow()); }, 200); }
                return;
            }
            _tsTries = 0;
            if (_tsWidgetId === null) {
                // size:'flexible' - віджет тягнеться по ширині модалки, не вилазить на мобільному
                _tsWidgetId = window.turnstile.render(holder, { sitekey: TURNSTILE_SITE_KEY, size: 'flexible' });
            }
        } else if (_tsWidgetId !== null) {
            if (window.turnstile) { try { window.turnstile.remove(_tsWidgetId); } catch (e) { } }
            _tsWidgetId = null;
            holder.innerHTML = '';
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
        // Повертаємо позицію МИТТЄВО: глобальний html{scroll-behavior:smooth} інакше
        // анімує scrollTo зверху вниз - виглядало як "проїзд якорем" при закритті модалки
        const html = document.documentElement;
        const prev = html.style.scrollBehavior;
        html.style.scrollBehavior = 'auto';
        window.scrollTo(0, _scrollY);
        html.style.scrollBehavior = prev;
    }
    function closeBooking() {
        if (_okGuardArmed) {
            _okGuardArmed = false; // друге натискання закриє
            const g = document.getElementById('m-ok-guard');
            g.style.display = 'block';
            g.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            return;
        }
        document.getElementById('modal-bg').classList.remove('open');
        unlockScroll();
        // Модалка закрилась - прибираємо віджет, щоб не лишався зі старим (вже неактуальним) токеном
        // і щоб наступне відкриття рендерило його заново для нового рейсу.
        if (_tsWidgetId !== null) {
            if (window.turnstile) { try { window.turnstile.remove(_tsWidgetId); } catch (e) { } }
            _tsWidgetId = null;
            const holder = document.getElementById('ts-holder');
            if (holder) holder.innerHTML = '';
        }
    }
    function openModal(rt, dep, arr, date) {
        selRoute = rt;
        _bookMode = !!rt.bookable;
        _isGroup = isGroupPrepay(rt); _groupThr = groupThreshold(rt);
        _modalDiscounts = []; _paxDiscSel = []; _discOpen = false;
        const dt = rt.departure_time || rt.time_from || '';
        // dep/arr - показуване ім'я (на англійській - уже перекладене, бо саме таке
        // лежить у _dep/_arr після renderResults). Для stripCityTxt нижче потрібне СИРЕ
        // українське ім'я - адреса станції від API завжди українська незалежно від
        // мови сторінки; беремо його з master-списку cities за id, а не з dep/arr.
        const depCity = cities.find(c => String(c.id) === String(_depId));
        const arrCity = cities.find(c => String(c.id) === String(_arrId));
        const depRaw = (depCity && depCity.name) || dep;
        const arrRaw = (arrCity && arrCity.name) || arr;
        document.querySelector('#m-route span').textContent = `${cityName(_depId, depRaw)} → ${cityName(_arrId, arrRaw)}`;
        // Зведення рейсу - щоб клієнт бачив, що саме бронює
        const at = rt.arrival_time || rt.time_to || '';
        const dur = fmtDuration(rt.travel_time);
        const fromSt = rt.departure_station ? stationName(stripCityTxt(rt.departure_station, depRaw)) : '';
        const toSt = rt.arrival_station ? stationName(stripCityTxt(rt.arrival_station, arrRaw)) : '';
        const carRaw = rt.carrier || rt.company;
        const carHtml = carRaw ? escTxt(vendorPlainText('carrierName', carRaw)) : escTxt(T.card.busFallback);
        document.getElementById('m-trip').innerHTML =
            `<div class="mt-row"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-calendar"></use></svg> <b>${escTxt(fmtNiceDate(rt.date || _date))}</b></div>` +
            `<div class="mt-row"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-clock"></use></svg> ${escTxt(dt || '-')}${at ? ' → ' + escTxt(at) : ''}${dur ? ` <span class="mt-dur">${escTxt(dur)}</span>` : ''}</div>` +
            `<div class="mt-row"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-tag"></use></svg> <b>${escTxt(fmtPrice(rt) || '-')}</b>&nbsp;/&nbsp;${T.seats.forms[0]}</div>` +
            `<div class="mt-row"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-bus"></use></svg> ${carHtml}</div>` +
            `<div class="mt-row mt-pay"><span class="t-pay ${payTag(rt).cls}">${payTag(rt).txt}</span></div>` +
            ((fromSt || toSt) ? `<div class="mt-stations">${fromSt ? `<span><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-location-dot"></use></svg> ${escTxt(fromSt)}</span>` : ''}${toSt ? `<span><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-flag-checkered"></use></svg> ${escTxt(toSt)}</span>` : ''}</div>` : '');
        document.getElementById('m-form').style.display = 'block';
        document.getElementById('m-ok').style.display = 'none';
        _okToken = '';
        _okGuardArmed = false;
        document.getElementById('m-ok-guard').style.display = 'none';
        document.getElementById('m-ok-link').style.display = 'none';
        document.getElementById('c-comment').value = '';
        document.getElementById('c-hp').value = '';
        document.getElementById('disc-block').innerHTML = '';
        document.getElementById('m-disc-note').style.display = 'none';
        // Вибір місця: скидаємо стан, ховаємо рядок і закриваємо аркуш (зʼявиться для нового рейсу)
        _seatScheme = null; _seatSel = []; _seatDeck = 0;
        const sb = document.getElementById('seat-block');
        if (sb) { sb.style.display = 'none'; sb.innerHTML = ''; }
        const sbg = document.getElementById('seat-sheet-bg');
        if (sbg) sbg.classList.remove('open');
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
        try { paxN = Math.min(5, Math.max(1, parseInt(LS.get('gdb_paxn'), 10) || 1)); } catch (e) { }
        for (let i = 0; i < paxN; i++) addPax();
        // Автопідстановка збережених даних першого пасажира (лише цей пристрій, на сервер не йде)
        try {
            const saved = JSON.parse(LS.get('gdb_pax1') || 'null');
            if (saved) {
                const row = document.querySelector('#pax-list .pax-row');
                if (row) {
                    const nameEl = row.querySelector('.pax-name'), surEl = row.querySelector('.pax-surname'), phEl = row.querySelector('.pax-phone');
                    if (nameEl && !nameEl.value) nameEl.value = saved.fn || '';
                    if (surEl && !surEl.value) surEl.value = saved.ln || '';
                    if (phEl && !phEl.value) phEl.value = saved.ph || '';
                }
            }
        } catch (e) { }
        applyBookUI();
        document.getElementById('modal-bg').classList.add('open');
        lockScroll(); // блокуємо фон, щоб не "просвічував" скрол головної
        loadModalDiscounts(rt); // підвантажуємо знижки асинхронно
        loadModalSeats(rt);     // схема салону, якщо рейс підтримує вибір місця
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
    document.getElementById('modal-bg').addEventListener('pointerdown', e => { _modalBgPointerDown = (e.target === document.getElementById('modal-bg')); });
    document.getElementById('modal-bg').addEventListener('click', e => { if (e.target === document.getElementById('modal-bg') && _modalBgPointerDown) closeBooking(); _modalBgPointerDown = false; });
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
            if (!phone || digits < 9) { phEl.style.borderColor = 'var(--red)'; ok = false; if (phone && digits < 9 && !firstError) firstError = T.order.phoneIncomplete; }
            if (!ok && !firstError) firstError = T.order.fillAllFields;
            // знижка (якщо обрана) - з блоку під коментарем за індексом пасажира
            const sel = _discOpen ? document.querySelector(`#disc-block .disc-sel[data-i="${i}"]`) : null;
            let ticket_type = '', discount_label = '', discount_percent = 0;
            if (sel && sel.selectedOptions[0] && +sel.selectedOptions[0].dataset.pct > 0) {
                ticket_type = sel.value;
                discount_label = sel.selectedOptions[0].textContent;
                discount_percent = +sel.selectedOptions[0].dataset.pct || 0;
            }
            // Обране місце: i-те обране → i-й пасажир (0 = автоматично)
            passengers.push({
                name, surname, phone, ticket_type, discount_label, discount_percent,
                seat: (_seatSel[i] && _seatSel[i].id) || 0,
                seat_name: (_seatSel[i] && _seatSel[i].name) || ''
            });
        });
        if (firstError) { alert(firstError); return; }

        const willBook = canBookNow();
        const btn = document.getElementById('m-submit');
        btn.disabled = true;
        btn.innerHTML = willBook ? `<svg class="ic ic-spin" aria-hidden="true"><use href="/_sprite.svg#i-spinner"></use></svg> ${T.order.booking}` : `<svg class="ic ic-spin" aria-hidden="true"><use href="/_sprite.svg#i-spinner"></use></svg> ${T.order.sending}`;

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
            page: (location.pathname + location.search).slice(0, 300),                 // сторінка, з якої лишили заявку
            landing: (() => { try { return SS.get('gdb_landing') || ''; } catch (e) { return ''; } })(), // вхід на сайт (з utm реклами)
            hp: document.getElementById('c-hp').value, // honeypot
            // Cloudflare Turnstile токен (антибот) - лише при реальній автоброні (willBook);
            // звичайна заявка менеджеру Turnstile не потребує і токен не шле.
            ts: (willBook && _tsWidgetId !== null && window.turnstile) ? (window.turnstile.getResponse(_tsWidgetId) || '') : ''
        };

        try {
            const r = await fetch(`${PROXY_BASE}/order${LANG_Q}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!r.ok) {
                const err = await r.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${r.status}`);
            }
            const j = await r.json().catch(() => ({}));
            try { LS.set('gdb_paxn', String(payload.passengers.length)); } catch (e) { }
            // Памʼять даних першого пасажира для наступної броні (лише пристрій, на сервер не йде)
            try {
                const p0 = payload.passengers[0] || {};
                LS.set('gdb_pax1', JSON.stringify({ fn: p0.name || '', ln: p0.surname || '', ph: p0.phone || '' }));
            } catch (e) { }
            const tks = (j.booked && Array.isArray(j.tickets)) ? j.tickets.filter(t => t.pdf) : [];
            if (j.booked) {
                // Місця: якщо обирали і все пройшло - підтверджуємо; якщо не вийшло - чесно кажемо
                const seatLine = j.seat_note
                    ? `<br><span class="ok-seatnote">${escTxt(j.seat_note)}</span>`
                    : (_seatSel.length ? `<br>${T.order.yourSeats}: <b>${escTxt(_seatSel.map(s => s.name).join(', '))}</b>` : '');
                document.getElementById('m-ok-title').textContent = T.order.bookedTitle;
                document.getElementById('m-ok-text').innerHTML = (tks.length
                    ? T.order.bookedTextWithTickets
                    : T.order.bookedTextNoTickets) + seatLine;
                document.getElementById('m-ok-tickets').innerHTML = tks.map((tk, i) =>
                    `<a class="tk-link" href="${escTxt(tk.pdf)}" target="_blank" rel="noopener"><svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-file-pdf"></use></svg> ${T.order.downloadTicket}${tks.length > 1 ? ' ' + (i + 1) : ''}</a>`).join('');
                _okGuardArmed = tks.length > 0;
            } else {
                document.getElementById('m-ok-title').textContent = T.order.acceptedTitle;
                document.getElementById('m-ok-text').innerHTML = T.order.acceptedText;
                document.getElementById('m-ok-tickets').innerHTML = '';
                _okGuardArmed = false;
            }
            _okToken = j.token || '';
            const linkBox = document.getElementById('m-ok-link');
            if (_okToken) {
                const url = `${location.origin}/t/${_okToken}`;
                document.getElementById('m-ok-url').value = url;
                linkBox.style.display = 'block';
            } else linkBox.style.display = 'none';
            document.getElementById('m-form').style.display = 'none';
            document.getElementById('m-ok').style.display = 'block';
        } catch (e) {
            alert(T.order.submitError(e.message));
            // Токен Turnstile одноразовий - без reset() повторна спроба відправки завжди провалиться.
            if (window.turnstile && _tsWidgetId !== null) { try { window.turnstile.reset(_tsWidgetId); } catch (e2) { } }
        } finally {
            btn.disabled = false;
            btn.innerHTML = canBookNow()
                ? `<svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-bolt"></use></svg> ${T.card.book}`
                : `<svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-paper-plane"></use></svg> ${T.order.send}`;
        }
    });
    document.getElementById('m-close').addEventListener('click', closeBooking);
    // Копіювання посилання на сторінку броні (екран успіху) - знімає запобіжник закриття
    document.getElementById('m-ok-copy').addEventListener('click', async () => {
        const inp = document.getElementById('m-ok-url');
        inp.select();
        try { await navigator.clipboard.writeText(inp.value); } catch { document.execCommand('copy'); }
        const b = document.getElementById('m-ok-copy');
        b.textContent = T.order.copiedLabel; setTimeout(() => { b.textContent = T.order.copyLabel; }, 2000);
        _okGuardArmed = false;
    });
    document.getElementById('m-ok-return').addEventListener('click', () => {
        const dep = document.getElementById('departure'), arr = document.getElementById('arrival');
        [dep.value, arr.value] = [arr.value, dep.value];
        closeBooking();
        if (!document.getElementById('modal-bg').classList.contains('open')) {
            document.querySelector('.search-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
            document.getElementById('date-input').focus();
        }
    });
    // Клік по посиланню на квиток (делеговано - лінки перестворюються через innerHTML) - знімає запобіжник
    document.getElementById('m-ok-tickets').addEventListener('click', e => {
        if (e.target.closest('.tk-link')) _okGuardArmed = false;
    });
    // Запобіжник закриття успіх-екрана без завантажених квитків
    document.getElementById('m-ok-guard-back').addEventListener('click', () => {
        document.getElementById('m-ok-guard').style.display = 'none';
        _okGuardArmed = true; // повертаємось на екран успіху - запобіжник знову взведено
    });
    document.getElementById('m-ok-guard-close').addEventListener('click', closeBooking);
    const modalBg = document.getElementById('modal-bg');
    document.addEventListener('keydown', e => {
        // Enter запускає пошук лише коли модалка закрита (інакше заважає заповнювати форму)
        if (e.key === 'Enter' && !modalBg.classList.contains('open')) search();
    });
    // Доступність модалки: Escape закриває, Tab циклить фокус усередині (focus-trap)
    document.addEventListener('keydown', e => {
        if (!modalBg.classList.contains('open')) return;
        // Escape: спершу закриваємо аркуш вибору місця (якщо відкритий), потім - усю модалку
        if (e.key === 'Escape') { if (seatSheetOpen()) closeSeatSheet(); else closeBooking(); return; }
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
        if (!inp.value) { span.textContent = T.date.placeholder; span.style.color = 'var(--text-3)'; return; }
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
            if (p.get('notrack') === '0') { LS.del('gdb_notrack'); alert(T.track.on); }
            else { LS.set('gdb_notrack', '1'); alert(T.track.off); }
        }
    })();
    const noTrack = () => LS.get('gdb_notrack') === '1';

    document.addEventListener('DOMContentLoaded', () => {
        // Кроки ініціалізації ізольовані: збій одного (напр. заблокований storage чи
        // відсутній елемент) не має лишати відвідувача з непрацюючою кнопкою пошуку.
        const step = fn => { try { fn(); } catch (e) { console.error('[init]', e); } };

        // Лічильник візитів - один раз на сесію (крім позначених notrack)
        step(() => {
            if (!SS.get('gdb_visited')) {
                SS.set('gdb_visited', '1');
                fetch(`${PROXY_BASE}/visit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notrack: noTrack() }) }).catch(() => {});
            }
        });
        step(setTodayDate);
        step(() => {
            const dateInput = document.getElementById('date-input');
            dateInput.addEventListener('change', updateDateDisplay);
            // Клік будь-де по полю відкриває календар: на телефоні тап у нативний інпут
            // робить це сам, на ПК додатково викликаємо showPicker (try/catch - якщо
            // нативний пікер уже відкрився, повторний виклик просто ігнорується).
            document.getElementById('date-wrap').addEventListener('click', () => {
                try { if (typeof dateInput.showPicker === 'function') dateInput.showPicker(); else dateInput.focus(); } catch (err) {}
            });
        });
        // Автокомпліт навішуємо ДО loadCities: при кеш-хіті loadCities синхронно робить
        // автофокус на «Звідки», і focus-обробник має вже існувати, щоб показати панель.
        step(() => { ac('departure', 'departure-list', true); ac('arrival', 'arrival-list', false); });
        step(loadCities);
        step(() => document.getElementById('search-btn').addEventListener('click', search));
    });
