// Спільний скрипт для всіх сторінок (головна, маршрути, юридичні):
// 1) cookie-банер + Google Consent Mode: GTM вантажиться інлайн у <head> (default = denied),
//    а тут оновлюємо згоду до granted після натискання «Прийняти» (GDPR). GA4/інші теги - у GTM;
// 2) кнопка «нагору». Не залежить від форми пошуку, тож безпечний на будь-якій сторінці.
(function () {
    'use strict';

    // GTM і Consent Mode (default denied) вже підключені інлайн у <head>. Тут лише оновлюємо
    // згоду на granted, коли користувач натиснув «Прийняти» - далі рішення приймає GTM.
    function grantConsent() {
        if (typeof window.gtag === 'function') {
            window.gtag('consent', 'update', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted' });
        }
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
        bar.querySelector('.ck-accept').addEventListener('click', function () { setConsent('accepted'); grantConsent(); close(); });
        bar.querySelector('.ck-min').addEventListener('click', function () { setConsent('declined'); close(); });
        bar.querySelector('.ck-reject').addEventListener('click', function () { setConsent('declined'); close(); });
    }

    function initConsent() {
        var c = getConsent();
        // Стан consent для повторних візитів виставляє інлайн-скрипт у <head> (granted, якщо раніше «Прийняти»).
        // Тут лишається тільки показати банер, якщо вибору ще не було.
        if (c === 'accepted' || c === 'declined') return;
        showBanner();
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
