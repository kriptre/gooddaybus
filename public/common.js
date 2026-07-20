// Спільний скрипт для всіх сторінок (головна, маршрути, юридичні):
// 1) cookie-банер + Google Consent Mode: GTM вантажиться інлайн у <head> (default = denied),
//    а тут оновлюємо згоду до granted після натискання «Прийняти» (GDPR). GA4/інші теги - у GTM;
// 2) кнопка «нагору». Не залежить від форми пошуку, тож безпечний на будь-якій сторінці.
(function () {
    'use strict';

    // Сторінка ВХОДУ на сайт (перша за сесію, з utm-мітками реклами) - потрапляє
    // в заявку менеджеру, щоб бачити, з якої реклами/сторінки прийшов клієнт.
    try {
        if (!sessionStorage.getItem('gdb_landing')) {
            sessionStorage.setItem('gdb_landing', (location.pathname + location.search).slice(0, 300));
        }
    } catch (e) { }

    // Звіт про JS-збої на сервер: інакше помилка в браузері клієнта - невидима зона
    // ("не можу забронювати", а в логах порожньо). Максимум 3 звіти за візит.
    var errSent = 0;
    function reportError(msg, src, line) {
        if (errSent >= 3) return; errSent++;
        try {
            fetch('/api/client-error', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
                body: JSON.stringify({
                    msg: String(msg || '').slice(0, 300), src: String(src || '').slice(0, 200), line: line || 0,
                    page: location.pathname, ua: navigator.userAgent.slice(0, 140)
                })
            });
        } catch (e) { }
    }
    window.addEventListener('error', function (e) {
        var src = String(e.filename || '');
        var msg = String(e.message || '');
        // Шум від ЧУЖОГО коду не репортимо: вбудовані браузери додатків (Facebook/Telegram
        // WebView) інжектять свої скрипти зі схемами на кшталт iabjs:// і падають самі по собі
        // ("Java object is gone"), розширення - зі своїми схемами, а крос-доменні скрипти дають
        // безлике "Script error.". Це не збої сайту - шлемо лише помилки з наших файлів.
        if (src && src.indexOf(location.origin) !== 0) return;
        if (msg === 'Script error.') return;
        reportError(msg, src, e.lineno);
    });
    window.addEventListener('unhandledrejection', function (e) {
        reportError('unhandledrejection: ' + (e.reason && e.reason.message ? e.reason.message : String(e.reason || '')), '', 0);
    });

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
            '<div class="cookie-top">' +
            '<span class="cookie-ico" aria-hidden="true"><svg viewBox="0 0 32 32" width="22" height="22"><circle cx="16" cy="16" r="13" fill="#F06422"/><circle cx="12" cy="11" r="2" fill="#fff"/><circle cx="20.5" cy="13" r="1.6" fill="#fff"/><circle cx="14" cy="20" r="1.8" fill="#fff"/><circle cx="21" cy="20.5" r="1.4" fill="#fff"/></svg></span>' +
            '<div class="cookie-txt">Ми використовуємо cookie, щоб сайт працював зручно і ми могли робити його кращим для вас. Натисніть «Прийняти» - це допомагає нам покращувати сервіс. Детальніше - у <a href="/cookies">Політиці cookie</a>.</div>' +
            '</div>' +
            '<div class="cookie-btns">' +
            '<button type="button" class="ck-btn ck-accept">Прийняти</button>' +
            '<button type="button" class="ck-link ck-min">Лише необхідні</button>' +
            '</div>';
        document.body.appendChild(bar);
        requestAnimationFrame(function () { bar.classList.add('show'); });
        var close = function () { bar.classList.remove('show'); setTimeout(function () { bar.remove(); }, 250); };
        bar.querySelector('.ck-accept').addEventListener('click', function () { setConsent('accepted'); grantConsent(); close(); });
        bar.querySelector('.ck-min').addEventListener('click', function () { setConsent('declined'); close(); });
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
