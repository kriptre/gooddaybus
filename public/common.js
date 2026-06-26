// Спільний скрипт для всіх сторінок (головна, маршрути, юридичні):
// 1) згода на cookie + завантаження Google Analytics ЛИШЕ після згоди (GDPR opt-in);
// 2) кнопка «нагору». Не залежить від форми пошуку, тож безпечний на будь-якій сторінці.
(function () {
    'use strict';
    var GA_ID = 'G-97WNW2B4KV';

    // Google Analytics підключаємо динамічно - тільки якщо користувач натиснув «Прийняти».
    function loadGA() {
        if (window.__gaLoaded) return; window.__gaLoaded = true;
        var s = document.createElement('script');
        s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
        document.head.appendChild(s);
        window.dataLayer = window.dataLayer || [];
        function gtag() { dataLayer.push(arguments); }
        window.gtag = gtag;
        gtag('js', new Date());
        gtag('config', GA_ID);
    }

    var getConsent = function () { try { return localStorage.getItem('gdb_cookie'); } catch (e) { return null; } };
    var setConsent = function (v) { try { localStorage.setItem('gdb_cookie', v); } catch (e) { } };

    function showBanner() {
        var bar = document.createElement('div');
        bar.className = 'cookie-bar';
        bar.setAttribute('role', 'dialog');
        bar.setAttribute('aria-label', 'Згода на використання cookie');
        bar.innerHTML =
            '<div class="cookie-txt">Ми використовуємо файли cookie для роботи сайту та знеособленої аналітики, щоб робити сервіс зручнішим. Детальніше - у <a href="/cookies">Політиці cookie</a>.</div>' +
            '<div class="cookie-btns">' +
            '<button type="button" class="ck-btn ck-accept">Прийняти</button>' +
            '<button type="button" class="ck-btn ck-min">Лише необхідні</button>' +
            '<button type="button" class="ck-btn ck-reject">Відхилити</button>' +
            '</div>';
        document.body.appendChild(bar);
        requestAnimationFrame(function () { bar.classList.add('show'); });
        var close = function () { bar.classList.remove('show'); setTimeout(function () { bar.remove(); }, 250); };
        bar.querySelector('.ck-accept').addEventListener('click', function () { setConsent('accepted'); loadGA(); close(); });
        bar.querySelector('.ck-min').addEventListener('click', function () { setConsent('declined'); close(); });
        bar.querySelector('.ck-reject').addEventListener('click', function () { setConsent('declined'); close(); });
    }

    function initConsent() {
        var c = getConsent();
        if (c === 'accepted') { loadGA(); return; }   // повторний візит зі згодою
        if (c === 'declined') { return; }              // відмовився - аналітики немає
        showBanner();                                  // вибору ще немає - показуємо банер (без аналітики)
    }

    // Кнопка «нагору»: зʼявляється після прокрутки ~на екран.
    function initScrollTop() {
        var btn = document.createElement('button');
        btn.className = 'scroll-top'; btn.type = 'button'; btn.setAttribute('aria-label', 'Нагору');
        btn.innerHTML = '<svg class="ic" aria-hidden="true"><use href="/_sprite.svg#i-arrow-up"></use></svg>';
        document.body.appendChild(btn);
        btn.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
        var ticking = false;
        var upd = function () { btn.classList.toggle('show', window.scrollY > window.innerHeight * 0.6); ticking = false; };
        window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(upd); } }, { passive: true });
        upd();
    }

    document.addEventListener('DOMContentLoaded', function () { initConsent(); initScrollTop(); });
})();
