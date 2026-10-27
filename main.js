/* ==========================================================================
   VOGUE DISTRICT — SHARED SITE CHROME (main.js)
   --------------------------------------------------------------------------
   Runs on every page and injects the shared UI so it is defined in exactly
   ONE place (easy to rebrand — see README "Customization"):

     • announcement bar      • header (wordmark, nav, search/wishlist/cart)
     • mobile navigation     • search overlay
     • footer                • toast notifications
     • demo-mode setup banner (only while Supabase is not configured)

   Each page keeps its own <main> content in plain HTML and registers a
   controller as  VD.page.init = function () { ... }  — main.js calls it on
   DOMContentLoaded after the shared chrome is ready.

   EDIT HERE: navigation links, footer columns, announcement defaults.
   Brand text/colours come from config.js and style.css variables.
   ========================================================================== */

(function () {
  'use strict';

  window.VD = window.VD || {};

  /* ========================================================================
     UTILITIES
     ======================================================================== */
  var utils = {
    /* Escape untrusted text before putting it into HTML. */
    esc: function (value) { return window.VD.api.esc(value); },

    /* Format money using the configured currency (config.js / store settings). */
    formatPrice: function (amount) {
      var cfg = (window.VD.settings && window.VD.settings.currency) || window.VOGUE_CONFIG.currency;
      try {
        return new Intl.NumberFormat(cfg.locale, { style: 'currency', currency: cfg.code }).format(amount);
      } catch (err) {
        return cfg.code + ' ' + (Math.round(amount * 100) / 100).toFixed(2);
      }
    },

    debounce: function (fn, wait) {
      var timer = null;
      return function () {
        var args = arguments;
        clearTimeout(timer);
        timer = setTimeout(function () { fn.apply(this, args); }.bind(this), wait);
      };
    },

    getParam: function (name, url) {
      var src = url || window.location.search;
      var match = new RegExp('[?&]' + name + '=([^&]*)').exec(src);
      return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : null;
    },

    /* Broken image safety net → bundled placeholder (keeps grids tidy while
       images upload / if a file is renamed). */
    imgFallback: function (img) {
      if (img.dataset.fallbackApplied) return;
      img.dataset.fallbackApplied = '1';
      img.src = 'images/placeholder.svg';
    },

    /* Toast notifications (aria-live region injected with the footer). */
    toast: function (message, type) {
      var region = document.getElementById('toast-region');
      if (!region) return;
      var el = document.createElement('div');
      el.className = 'toast toast--' + (type || 'info');
      el.setAttribute('role', 'status');
      el.innerHTML =
        '<span class="toast__dot" aria-hidden="true"></span>' +
        '<span class="toast__message">' + utils.esc(message) + '</span>';
      region.appendChild(el);
      requestAnimationFrame(function () { el.classList.add('is-visible'); });
      setTimeout(function () {
        el.classList.remove('is-visible');
        setTimeout(function () { el.remove(); }, 350);
      }, 3400);
    },

    /* Minimal element creator from an HTML string. */
    fromHTML: function (html) {
      var tpl = document.createElement('template');
      tpl.innerHTML = html.trim();
      return tpl.content.firstElementChild;
    }
  };
  window.VD.utils = utils;

  /* ========================================================================
     SHARED MARKUP TEMPLATES  (edit to rebrand navigation / footer)
     ======================================================================== */

  var ICONS = {
    search: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/></svg>',
    heart: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 21s-6.7-4.6-9.3-8.5C.8 9.6 2.1 5.9 5.4 5.1c1.9-.4 3.9.3 5.1 1.9l1.5 2 1.5-2c1.2-1.6 3.2-2.3 5.1-1.9 3.3.8 4.6 4.5 2.7 7.4C18.7 16.4 12 21 12 21z"/></svg>',
    bag: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 8h12l1 13H5L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
    menu: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };

  var NAV_LINKS = [
    { href: 'index.html', label: 'Home', page: 'home' },
    { href: 'shop.html', label: 'Shop', page: 'shop' },
    { href: 'collections.html', label: 'Collections', page: 'collections' },
    { href: 'shop.html?tag=new-arrivals', label: 'New In', page: 'new' },
    { href: 'shop.html?sale=1', label: 'Sale', page: 'sale' },
    { href: 'about.html', label: 'About', page: 'about' }
  ];

  function navHTML() {
    return NAV_LINKS.map(function (link) {
      return '<li><a href="' + link.href + '" data-nav-page="' + link.page + '">' + link.label + '</a></li>';
    }).join('');
  }

  function announcementHTML(settings) {
    var a = settings.announcement || window.VOGUE_CONFIG.announcement;
    if (!a || !a.enabled || !a.text) return '';
    return (
      '<div class="announcement" id="announcement" role="region" aria-label="Store announcement">' +
        '<div class="container announcement__inner">' +
          '<p class="announcement__text">' + utils.esc(a.text) + '</p>' +
          '<button type="button" class="announcement__close" aria-label="Dismiss announcement">' + ICONS.close + '</button>' +
        '</div>' +
      '</div>'
    );
  }

  function headerHTML(settings) {
    var brand = settings.brand || window.VOGUE_CONFIG.brand;
    var wordmark = brand.logoUrl
      ? '<img src="' + utils.esc(brand.logoUrl) + '" alt="' + utils.esc(brand.name) + ' — home">'
      : utils.esc(brand.name);
    return (
      '<header class="site-header" id="site-header-inner">' +
        '<div class="container site-header__inner">' +
          '<button type="button" class="icon-button site-header__menu-toggle" aria-label="Open menu" aria-expanded="false" data-menu-toggle>' + ICONS.menu + '</button>' +
          '<a class="site-header__wordmark" href="index.html" aria-label="' + utils.esc(brand.name) + ' — home">' + wordmark + '</a>' +
          '<nav class="site-header__nav" aria-label="Primary"><ul>' + navHTML() + '</ul></nav>' +
          '<div class="site-header__actions">' +
            '<button type="button" class="icon-button" aria-label="Search products" data-search-open>' + ICONS.search + '</button>' +
            '<a class="icon-button" href="wishlist.html" aria-label="Wishlist">' + ICONS.heart +
              '<span class="icon-button__badge" data-wishlist-count aria-hidden="true">0</span>' +
              '<span class="sr-only" data-wishlist-count-sr>0 items in wishlist</span></a>' +
            '<a class="icon-button" href="cart.html" aria-label="Shopping cart">' + ICONS.bag +
              '<span class="icon-button__badge" data-cart-count aria-hidden="true">0</span>' +
              '<span class="sr-only" data-cart-count-sr>0 items in cart</span></a>' +
          '</div>' +
        '</div>' +
        '<div class="mobile-nav" id="mobile-nav" hidden>' +
          '<nav aria-label="Mobile"><ul>' + navHTML() +
            '<li><a href="contact.html" data-nav-page="contact">Contact</a></li>' +
            '<li><a href="faq.html" data-nav-page="faq">FAQ</a></li>' +
          '</ul></nav>' +
        '</div>' +
      '</header>'
    );
  }

  function searchOverlayHTML() {
    return (
      '<div class="search-overlay" id="search-overlay" hidden role="dialog" aria-modal="true" aria-label="Search products">' +
        '<div class="search-overlay__panel">' +
          '<button type="button" class="icon-button search-overlay__close" aria-label="Close search" data-search-close>' + ICONS.close + '</button>' +
          '<form action="shop.html" method="get" class="search-overlay__form" role="search">' +
            '<label class="sr-only" for="site-search-input">Search products</label>' +
            '<input type="search" id="site-search-input" name="q" placeholder="Search dresses, coats, accessories…" ' +
              'autocomplete="off" required>' +
            '<button type="submit" class="button button--dark">Search</button>' +
          '</form>' +
          '<p class="search-overlay__hint">Search by name, description, category or SKU — e.g. “cashmere”, “dresses”, “VD-BAG”.</p>' +
        '</div>' +
      '</div>'
    );
  }

  function footerHTML(settings) {
    var brand = settings.brand || window.VOGUE_CONFIG.brand;
    var contact = settings.contact || window.VOGUE_CONFIG.contact;
    var social = settings.social || window.VOGUE_CONFIG.social;

    function socialLink(name, url) {
      if (!url) return '';
      return '<li><a href="' + utils.esc(url) + '" target="_blank" rel="noopener noreferrer" aria-label="' + name + ' (opens in a new tab)">' + name + '</a></li>';
    }

    return (
      '<footer class="site-footer" id="site-footer-inner">' +
        '<div class="container site-footer__grid">' +
          '<div class="site-footer__brand">' +
            '<p class="site-footer__wordmark">' + utils.esc(brand.name) + '</p>' +
            '<p class="site-footer__tagline">' + utils.esc(brand.tagline) + '</p>' +
            '<ul class="site-footer__social" aria-label="Social media">' +
              socialLink('Instagram', social.instagram) + socialLink('Facebook', social.facebook) +
              socialLink('Pinterest', social.pinterest) + socialLink('TikTok', social.tiktok) +
              socialLink('YouTube', social.youtube) +
            '</ul>' +
          '</div>' +
          '<nav class="site-footer__col" aria-label="Shop">' +
            '<h2 class="site-footer__heading">Shop</h2>' +
            '<ul>' +
              '<li><a href="shop.html">All products</a></li>' +
              '<li><a href="shop.html?tag=new-arrivals">New arrivals</a></li>' +
              '<li><a href="shop.html?tag=best-sellers">Best sellers</a></li>' +
              '<li><a href="shop.html?sale=1">Sale</a></li>' +
              '<li><a href="collections.html">Collections</a></li>' +
            '</ul>' +
          '</nav>' +
          '<nav class="site-footer__col" aria-label="Company">' +
            '<h2 class="site-footer__heading">Company</h2>' +
            '<ul>' +
              '<li><a href="about.html">About us</a></li>' +
              '<li><a href="contact.html">Contact</a></li>' +
              '<li><a href="faq.html">FAQ</a></li>' +
            '</ul>' +
          '</nav>' +
          '<nav class="site-footer__col" aria-label="Customer care">' +
            '<h2 class="site-footer__heading">Customer care</h2>' +
            '<ul>' +
              '<li><a href="shipping-returns.html">Shipping &amp; returns</a></li>' +
              '<li><a href="cart.html">Your cart</a></li>' +
              '<li><a href="wishlist.html">Wishlist</a></li>' +
              '<li><a href="admin.html">Store admin</a></li>' +
            '</ul>' +
          '</nav>' +
          '<div class="site-footer__col site-footer__contact">' +
            '<h2 class="site-footer__heading">Get in touch</h2>' +
            '<ul>' +
              '<li><a href="mailto:' + utils.esc(contact.email) + '">' + utils.esc(contact.email) + '</a></li>' +
              '<li><a href="tel:' + utils.esc(String(contact.phone).replace(/[^+\d]/g, '')) + '">' + utils.esc(contact.phone) + '</a></li>' +
              '<li>' + utils.esc(contact.address) + '</li>' +
            '</ul>' +
          '</div>' +
        '</div>' +
        '<div class="site-footer__bottom">' +
          /*'<div class="container site-footer__bottom-inner">' +
            '<p>© <span data-footer-year>2025</span> ' + utils.esc(brand.name) + '. All rights reserved.</p>' +
            '<p class="site-footer__note">Built as a portfolio template — see README.md to make it yours.</p>' +
          '</div>' +*/
        '</div>' + 
      '</footer>'
    );
  }

  function demoBannerHTML() {
    return (
      '<div class="demo-banner" role="status">' +
        /*'<div class="container demo-banner__inner">' +
          '<p><strong>Local demo mode.</strong> Supabase is not connected yet, so you are browsing the bundled demo catalog. ' +
          'Orders, contact messages, the admin panel and cross-device persistence switch on once you add your project URL + key to <code>config.js</code>.</p>' +
          '<a class="demo-banner__link" href="admin.html">Setup guide</a>' +
          '<button type="button" class="demo-banner__close" aria-label="Dismiss demo notice" data-demo-dismiss>' + ICONS.close + '</button>' +
        '</div>' + */
      '</div>'
    );
  }

  /* ========================================================================
     INJECTION + BEHAVIOUR
     ======================================================================== */

  function injectChrome(settings) {
    var head = document.getElementById('site-header');
    var foot = document.getElementById('site-footer');
    if (!head || !foot) return;   // admin page manages its own chrome

    if (window.VD.api.DEMO_MODE) {
      document.body.insertAdjacentHTML('afterbegin', demoBannerHTML());
    }
    head.insertAdjacentHTML('beforeend', announcementHTML(settings) + headerHTML(settings));
    foot.insertAdjacentHTML('beforeend', footerHTML(settings));
    document.body.insertAdjacentHTML('beforeend',
      '<div id="toast-region" class="toast-region" aria-live="polite" aria-atomic="false"></div>');
    document.body.insertAdjacentHTML('beforeend', searchOverlayHTML());

    bindChromeBehaviour();
    markActiveNav();
    applyBrandMeta(settings);
  }

  function bindChromeBehaviour() {
    /* Announcement dismiss (per session). */
    var announcement = document.getElementById('announcement');
    if (announcement) {
      try {
        if (sessionStorage.getItem('vd_announcement_dismissed') === '1') announcement.remove();
      } catch (err) { /* ignore */ }
      var close = announcement.querySelector('.announcement__close');
      if (close) close.addEventListener('click', function () {
        announcement.remove();
        try { sessionStorage.setItem('vd_announcement_dismissed', '1'); } catch (err) { /* ignore */ }
      });
    }

    /* Demo banner dismiss (per session). */
    var demoClose = document.querySelector('[data-demo-dismiss]');
    if (demoClose) demoClose.addEventListener('click', function () {
      var banner = document.querySelector('.demo-banner');
      if (banner) banner.remove();
      try { sessionStorage.setItem('vd_demo_banner_dismissed', '1'); } catch (err) { /* ignore */ }
    });
    try {
      if (window.VD.api.DEMO_MODE && sessionStorage.getItem('vd_demo_banner_dismissed') === '1') {
        var banner = document.querySelector('.demo-banner');
        if (banner) banner.remove();
      }
    } catch (err) { /* ignore */ }

    /* Mobile navigation. */
    var toggle = document.querySelector('[data-menu-toggle]');
    var mobileNav = document.getElementById('mobile-nav');
    if (toggle && mobileNav) {
      toggle.addEventListener('click', function () {
        var open = mobileNav.hidden;
        mobileNav.hidden = !open;
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
        toggle.classList.toggle('is-open', open);
      });
      mobileNav.addEventListener('click', function (event) {
        if (event.target.closest('a')) {
          mobileNav.hidden = true;
          toggle.setAttribute('aria-expanded', 'false');
        }
      });
    }

    /* Search overlay. */
    var overlay = document.getElementById('search-overlay');
    var openButtons = document.querySelectorAll('[data-search-open]');
    var closeButton = overlay ? overlay.querySelector('[data-search-close]') : null;
    var input = overlay ? overlay.querySelector('#site-search-input') : null;

    function openSearch() {
      if (!overlay) return;
      overlay.hidden = false;
      document.body.classList.add('no-scroll');
      if (input) { input.value = ''; setTimeout(function () { input.focus(); }, 40); }
    }
    function closeSearch() {
      if (!overlay) return;
      overlay.hidden = true;
      document.body.classList.remove('no-scroll');
    }
    openButtons.forEach(function (btn) { btn.addEventListener('click', openSearch); });
    if (closeButton) closeButton.addEventListener('click', closeSearch);
    if (overlay) overlay.addEventListener('click', function (event) {
      if (event.target === overlay) closeSearch();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && overlay && !overlay.hidden) closeSearch();
    });

    /* Newsletter forms (homepage + any page that includes one). */
    document.querySelectorAll('form[data-newsletter]').forEach(function (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var emailInput = form.querySelector('input[type="email"]');
        var note = form.querySelector('[data-newsletter-note]');
        var email = (emailInput && emailInput.value || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          if (note) { note.textContent = 'Please enter a valid email address.'; note.className = 'form-note form-note--error'; }
          return;
        }
        var submit = form.querySelector('button[type="submit"]');
        if (submit) submit.disabled = true;
        window.VD.api.subscribeNewsletter(email).then(function (result) {
          if (result.ok) {
            if (note) { note.textContent = result.message; note.className = 'form-note form-note--success'; }
            form.reset();
            utils.toast(result.message, 'success');
            if (result.demo) showDemoNewsletterNote(note);
          } else if (result.demo) {
            if (note) showDemoNewsletterNote(note);
          } else {
            if (note) { note.textContent = result.message || 'Something went wrong.'; note.className = 'form-note form-note--error'; }
          }
        }).catch(function () {
          if (note) { note.textContent = 'Something went wrong — please try again.'; note.className = 'form-note form-note--error'; }
        }).finally(function () {
          if (submit) submit.disabled = false;
        });
      });
    });

    /* Footer year. */
    document.querySelectorAll('[data-footer-year]').forEach(function (el) {
      el.textContent = String(new Date().getFullYear());
    });
  }

  function showDemoNewsletterNote(note) {
    if (!note) return;
    note.innerHTML = 'Local demo mode: subscriber storage needs Supabase. ' +
      'Connect your project in <code>config.js</code> (see README → Supabase setup).';
    note.className = 'form-note form-note--info';
  }

  /* Highlight the current page in the navigation. */
  function markActiveNav() {
    var page = document.body.getAttribute('data-page');
    if (!page) return;
    document.querySelectorAll('[data-nav-page="' + page + '"]').forEach(function (link) {
      link.classList.add('is-active');
      link.setAttribute('aria-current', 'page');
    });
  }

  /* Keep <meta> description/title brand-accurate from config (light touch). */
  function applyBrandMeta(settings) {
    document.title = document.title.replace('Vogue District', settings.brand.name);
  }

  /* ========================================================================
     BOOT
     ======================================================================== */

  document.addEventListener('DOMContentLoaded', function () {
    window.VD.api.getSettings().then(function (settings) {
      window.VD.settings = settings;
      injectChrome(settings);
      window.VD.cart.refreshBadges();
      window.VD.wishlist.refreshBadges();
      window.VD.wishlist.syncButtons();
      if (typeof window.VD.page !== 'undefined' && typeof window.VD.page.init === 'function') {
        window.VD.page.init();
      }
    }).catch(function (err) {
      console.error('Vogue District: failed to initialise.', err);
    });
  });
})();
