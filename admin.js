/* ==========================================================================
   VOGUE DISTRICT — STORE ADMIN (admin.js)
   --------------------------------------------------------------------------
   The entire admin panel in one page script. It manages its own chrome
   (topbar + tabs — there is no #site-header/#site-footer on admin.html,
   so main.js skips the shared storefront chrome on this page).

   Screens, in the order the visitor meets them:
     A) SETUP       — Supabase not configured yet (VD.api.DEMO_MODE).
     B) AUTH GATE   — login card, "not an administrator" card.
     C) ADMIN UI    — Dashboard · Products · Orders · Demo data · Settings.

   ALL data flows through the VD.api / VD.api.admin functions from
   supabase.js — this file never talks to Supabase directly.

   House rules kept throughout:
     • every destructive action opens a confirm modal (Escape / backdrop close);
     • every mutation ends in a toast;
     • every piece of dynamic text goes through VD.utils.esc;
     • money is displayed with VD.utils.formatPrice and parsed with
       Number() rounded to 2 decimals.
   ========================================================================== */

(function () {
  'use strict';

  window.VD = window.VD || {};
  window.VD.page = window.VD.page || {};

  /* ========================================================================
     CONSTANTS + STATE
     ======================================================================== */

  var TABS = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'products',  label: 'Products' },
    { id: 'orders',    label: 'Orders' },
    { id: 'demo',      label: 'Demo data' },
    { id: 'settings',  label: 'Settings' }
  ];

  var ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];

  var MAX_UPLOAD_BYTES = 5 * 1024 * 1024;                              // 5 MB
  var ALLOWED_UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  var STORAGE_MARKER = '/storage/v1/object/public/product-images/';    // must match supabase.js

  var state = {
    tab: 'dashboard',              // active admin tab (kept across re-renders)
    routeKey: null,                // guards against duplicate renders per auth state
    products: [],                  // last loaded admin product list (mapped shape)
    categories: [],                // last loaded category list ({id, slug, name})
    orders: [],                    // last loaded order list
    productQuery: '',              // products toolbar search text
    productStatus: 'all',          // products toolbar status filter
    editor: null,                  // product editor model (null = not editing)
    uploadedThisSession: [],       // storage URLs uploaded but possibly never saved
    settingsDraft: null            // working copy of the settings form values
  };

  /* Tiny local aliases — the shared utils are guaranteed to exist because
     admin.js loads after main.js. */
  function esc(value) { return window.VD.utils.esc(value); }
  function toast(message, type) { window.VD.utils.toast(message, type); }
  function money(amount) { return window.VD.utils.formatPrice(amount); }

  function rootEl() { return document.getElementById('admin-root'); }
  function viewEl() { return document.getElementById('admin-view'); }

  /* ========================================================================
     PAGE CONTROLLER (registered for main.js)
     ======================================================================== */

  window.VD.page.init = function () {
    if (!document.getElementById('admin-root')) return;   // guard: admin page only

    ensureToastRegion();
    bindGlobalKeys();
    watchAuth();

    rootEl().innerHTML = gateShell('<p class="empty-note">Loading admin…</p>');
    route();
  };

  /* main.js only injects the shared toast region when #site-header and
     #site-footer exist — on the admin page we provide our own. */
  function ensureToastRegion() {
    if (document.getElementById('toast-region')) return;
    var region = document.createElement('div');
    region.id = 'toast-region';
    region.className = 'toast-region';
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'false');
    document.body.appendChild(region);
  }

  /* One Escape listener for the whole page: closes any open modal. */
  function bindGlobalKeys() {
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeModal();
    });
  }

  /* Keep screens in sync with sign-in / sign-out events. */
  function watchAuth() {
    if (window.VD.api.DEMO_MODE) return;   // nothing to watch in local demo mode
    window.VD.api.auth.onChange(function () { route(); });
  }

  /* ========================================================================
     ROUTING — decides which top-level screen to show
     ======================================================================== */

  function route() {
    var api = window.VD.api;

    /* A) Supabase not configured → setup guide, no login form at all. */
    if (api.DEMO_MODE) {
      if (state.routeKey === 'setup') return;
      state.routeKey = 'setup';
      renderSetup(rootEl());
      return;
    }

    api.auth.getSession().then(function (session) {
      if (!session) {
        if (state.routeKey === 'anon') return;
        state.routeKey = 'anon';
        renderLogin(rootEl());
        return;
      }
      var email = session.user && session.user.email ? session.user.email : '';
      var userId = session.user ? session.user.id : '';
      api.auth.isAdmin().then(function (isAdmin) {
        var key = (isAdmin ? 'admin:' : 'guest:') + userId;
        if (state.routeKey === key) return;   // same auth state — do not re-render
        state.routeKey = key;
        if (isAdmin) renderAdmin(rootEl(), email);
        else renderNotAdmin(rootEl(), email);
      }).catch(function (err) {
        state.routeKey = 'error';
        renderAuthError(rootEl(), email, err);
      });
    }).catch(function (err) {
      state.routeKey = 'error';
      renderAuthError(rootEl(), '', err);
    });
  }

  /* Shared wrapper for the gate screens (setup / login / not-admin). */
  function gateShell(inner) {
    return (
      '<div class="admin-shell">' +
        '<main id="main" class="admin-gate">' +
          '<p class="admin-gate__brand">Vogue District · Store admin</p>' +
          inner +
        '</main>' +
      '</div>'
    );
  }

  /* ========================================================================
     SCREEN A — SETUP (local demo mode: Supabase not configured)
     ======================================================================== */

  function renderSetup(root) {
    root.innerHTML = gateShell(
      '<section class="admin-setup" aria-labelledby="setup-title">' +
        '<h1 id="setup-title" class="admin-gate__title">Connect Supabase to open your admin</h1>' +
        '<p class="admin-gate__copy">The admin panel needs a live Supabase project. Five steps, roughly five minutes:</p>' +
        '<ol class="admin-setup__steps">' +
          '<li><strong>Create a free project</strong> at <a class="text-link" href="https://supabase.com" target="_blank" rel="noopener noreferrer">supabase.com</a>.</li>' +
          '<li><strong>Run <code>supabase-schema.sql</code></strong> in the project’s SQL editor — it creates every table, policy and the <code>place_order</code> function.</li>' +
          '<li><strong>Optionally run <code>supabase-seed.sql</code></strong> to pre-fill the catalog — or skip it and use the “Load demo data” tool in this admin later.</li>' +
          '<li><strong>Paste your Project URL + publishable anon key into <code>config.js</code></strong> (Project Settings → API).</li>' +
          '<li><strong>Create your admin user:</strong> in the Supabase dashboard go to Authentication → Users → <em>Add user</em>, then run ' +
            '<code>insert into admin_users (user_id) values (\'&lt;user-uuid&gt;\');</code> in the SQL editor with the new user’s UUID.</li>' +
        '</ol>' +
        '<div class="admin-setup__warning">' +
          '<p class="form-note form-note--error"><strong>Never put the service-role key in browser code.</strong> ' +
          'Only the publishable anon key belongs in <code>config.js</code> — the service-role key must stay server-side.</p>' +
        '</div>' +
        '<p class="form-note form-note--info">This page switches to the admin panel automatically once <code>config.js</code> holds a valid URL and key (a reload may be needed).</p>' +
        '<p><a class="button button--outline" href="index.html">Open the storefront instead</a></p>' +
      '</section>'
    );
  }

  /* ========================================================================
     SCREEN B — AUTH GATE (login + not-an-admin)
     ======================================================================== */

  function renderLogin(root) {
    root.innerHTML = gateShell(
      '<section class="admin-login" aria-labelledby="login-title">' +
        '<h1 id="login-title" class="admin-gate__title">Sign in</h1>' +
        '<p class="admin-gate__copy">Use an administrator account to manage products, orders and demo data.</p>' +
        '<form id="login-form" novalidate>' +
          '<div class="field">' +
            '<label class="field__label" for="login-email">Email</label>' +
            '<input class="input" type="email" id="login-email" name="email" autocomplete="email" required>' +
          '</div>' +
          '<div class="field">' +
            '<label class="field__label" for="login-password">Password</label>' +
            '<input class="input" type="password" id="login-password" name="password" autocomplete="current-password" required>' +
          '</div>' +
          '<p id="login-error" class="form-note form-note--error" role="alert" hidden></p>' +
          '<button type="submit" class="button button--dark admin-login__submit">Sign in</button>' +
        '</form>' +
      '</section>'
    );

    var form = document.getElementById('login-form');
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var email = document.getElementById('login-email').value.trim();
      var password = document.getElementById('login-password').value;
      var errorSlot = document.getElementById('login-error');
      var submit = form.querySelector('[type="submit"]');

      errorSlot.hidden = true;
      if (!email || !password) {
        errorSlot.textContent = 'Enter your email and password.';
        errorSlot.hidden = false;
        return;
      }

      submit.disabled = true;
      submit.textContent = 'Signing in…';

      window.VD.api.auth.signIn(email, password).then(function (result) {
        if (result && result.error) {
          // Surface Supabase's own message, e.g. "Invalid login credentials".
          errorSlot.textContent = result.error.message;
          errorSlot.hidden = false;
          submit.disabled = false;
          submit.textContent = 'Sign in';
          return;
        }
        /* Success — auth.onChange fires and route() swaps to the admin UI.
           We also route() ourselves in case the event already passed. */
        submit.textContent = 'Signed in';
        route();
      }).catch(function (err) {
        errorSlot.textContent = err.message || 'Sign-in failed — please try again.';
        errorSlot.hidden = false;
        submit.disabled = false;
        submit.textContent = 'Sign in';
      });
    });
  }

  function renderNotAdmin(root, email) {
    root.innerHTML = gateShell(
      '<section class="admin-login" aria-labelledby="na-title">' +
        '<h1 id="na-title" class="admin-gate__title">Not an administrator</h1>' +
        '<p class="admin-gate__copy">Signed in as <strong>' + esc(email || 'unknown account') + '</strong>.</p>' +
        '<p class="empty-note">This account is not listed as an administrator.</p>' +
        '<p class="form-note form-note--info">Hint — after creating the user (Dashboard → Authentication → Users → Add user), ' +
          'add it to the admin list with <code>insert into admin_users (user_id) values (\'&lt;user-uuid&gt;\');</code> in the SQL editor. See setup step 5.</p>' +
        '<button type="button" id="na-signout" class="button button--outline">Sign out</button>' +
      '</section>'
    );
    document.getElementById('na-signout').addEventListener('click', function () {
      signOut(this);
    });
  }

  /* Unexpected auth errors (network down, project paused…). */
  function renderAuthError(root, email, err) {
    root.innerHTML = gateShell(
      '<section class="admin-login" aria-labelledby="ae-title">' +
        '<h1 id="ae-title" class="admin-gate__title">Admin unavailable</h1>' +
        (email ? '<p class="admin-gate__copy">Signed in as <strong>' + esc(email) + '</strong>.</p>' : '') +
        '<p class="empty-note empty-note--error">Could not verify your account: ' + esc(err && err.message ? err.message : 'unknown error') + '</p>' +
        '<button type="button" id="ae-retry" class="button button--outline">Try again</button>' +
      '</section>'
    );
    document.getElementById('ae-retry').addEventListener('click', function () {
      root.innerHTML = gateShell('<p class="empty-note">Loading admin…</p>');
      route();
    });
  }

  function signOut(button) {
    if (button) { button.disabled = true; button.textContent = 'Signing out…'; }
    window.VD.api.auth.signOut().then(function () {
      // Reset transient state, then re-route (onChange usually gets there first).
      state.tab = 'dashboard';
      state.editor = null;
      state.uploadedThisSession = [];
      route();
    }).catch(function (err) {
      toast(err.message, 'error');
      if (button) { button.disabled = false; button.textContent = 'Sign out'; }
    });
  }

  /* ========================================================================
     SCREEN C — ADMIN CHROME (topbar + tabs)
     ======================================================================== */

  function renderAdmin(root, email) {
    root.innerHTML =
      '<div class="admin-shell">' +
        '<header class="admin-topbar">' +
          '<div class="container admin-topbar__inner">' +
            '<span class="admin-topbar__wordmark">Vogue District · Admin</span>' +
            '<a class="text-link admin-topbar__store-link" href="index.html">View store</a>' +
            '<span class="admin-topbar__user">' + esc(email) + '</span>' +
            '<button type="button" id="admin-signout" class="button button--outline">Sign out</button>' +
          '</div>' +
        '</header>' +
        '<main id="main" class="admin-main">' +
          '<div class="container">' +
            '<nav class="admin-tabs" aria-label="Admin sections">' +
              '<div class="admin-tabs__inner">' + tabsHTML() + '</div>' +
            '</nav>' +
            '<div id="admin-view"></div>' +
          '</div>' +
        '</main>' +
      '</div>';

    document.getElementById('admin-signout').addEventListener('click', function () {
      signOut(this);
    });

    document.querySelectorAll('.admin-tabs__tab').forEach(function (button) {
      button.addEventListener('click', function () { requestTab(button.getAttribute('data-tab')); });
    });

    setTab(state.tab);
  }

  function tabsHTML() {
    return TABS.map(function (tab) {
      var active = tab.id === state.tab;
      return '<button type="button" class="admin-tabs__tab' + (active ? ' is-active' : '') + '" ' +
        'data-tab="' + tab.id + '"' + (active ? ' aria-current="true"' : '') + '>' + tab.label + '</button>';
    }).join('');
  }

  /* Tab clicks go through here so an open product editor can offer to
     clean up its unsaved uploads first. */
  function requestTab(id) {
    if (!id || id === state.tab) return;
    if (state.editor) {
      exitEditor(function () { setTab(id); });
    } else {
      setTab(id);
    }
  }

  function setTab(id) {
    state.tab = id;
    document.querySelectorAll('.admin-tabs__tab').forEach(function (button) {
      var active = button.getAttribute('data-tab') === id;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    });
    switch (id) {
      case 'products':  showProducts();  break;
      case 'orders':    showOrders();    break;
      case 'demo':      showDemoTools(); break;
      case 'settings':  showSettings();  break;
      default:          showDashboard(); break;
    }
  }

  /* ========================================================================
     MODAL + CONFIRM HELPERS
     ======================================================================== */

  var modal = null;   // { root, onClose, prevFocus }

  var ICON_CLOSE =
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function openModal(options) {
    closeModal();
    var root = window.VD.utils.fromHTML(
      '<div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(options.title) + '">' +
        '<div class="modal__panel' + (options.wide ? ' modal__panel--wide' : '') + '">' +
          '<button type="button" class="icon-button modal__close" aria-label="Close dialog">' + ICON_CLOSE + '</button>' +
          '<h2 class="modal__title">' + esc(options.title) + '</h2>' +
          '<div class="modal__body">' + (options.body || '') + '</div>' +
          (options.footer ? '<div class="modal__footer">' + options.footer + '</div>' : '') +
        '</div>' +
      '</div>'
    );

    document.body.appendChild(root);
    document.body.classList.add('no-scroll');
    modal = { root: root, onClose: options.onClose || null, prevFocus: document.activeElement };

    // Backdrop click + close button both dismiss.
    root.addEventListener('mousedown', function (event) {
      if (event.target === root) closeModal();
    });
    var closeBtn = root.querySelector('.modal__close');
    closeBtn.addEventListener('click', function () { closeModal(); });
    closeBtn.focus();   // spec: focus the close button on open
  }

  function closeModal() {
    if (!modal) return;
    var current = modal;
    modal = null;
    current.root.remove();
    document.body.classList.remove('no-scroll');
    if (current.onClose) {
      try { current.onClose(); } catch (err) { /* keep going */ }
    }
    if (current.prevFocus && document.body.contains(current.prevFocus)) {
      try { current.prevFocus.focus(); } catch (err) { /* keep going */ }
    }
  }

  /* Confirm dialog for destructive actions. `message` is HTML — callers
     must escape any dynamic text inside it themselves. */
  function confirmModal(options) {
    var settled = false;
    openModal({
      title: options.title,
      body: '<div class="modal__message">' + options.message + '</div>',
      footer:
        '<button type="button" class="button" data-confirm-cancel>' + esc(options.cancelLabel || 'Cancel') + '</button>' +
        '<button type="button" class="button ' + (options.danger ? 'button--danger' : 'button--dark') + '" data-confirm-ok>' +
          esc(options.confirmLabel || 'Confirm') + '</button>',
      onClose: function () {
        // Any dismissal that is NOT the confirm button counts as cancel.
        if (!settled && options.onCancel) options.onCancel();
      }
    });
    modal.root.querySelector('[data-confirm-ok]').addEventListener('click', function () {
      settled = true;
      closeModal();
      if (options.onConfirm) options.onConfirm();
    });
    modal.root.querySelector('[data-confirm-cancel]').addEventListener('click', function () {
      closeModal();   // onClose runs onCancel
    });
  }

  /* ========================================================================
     VIEW — DASHBOARD
     ======================================================================== */

  function showDashboard() {
    viewEl().innerHTML =
      '<section class="admin-panel" aria-labelledby="dash-title">' +
        '<div class="admin-panel__head">' +
          '<h2 id="dash-title" class="admin-panel__title">Dashboard</h2>' +
          '<button type="button" id="dash-refresh" class="button button--outline">Refresh</button>' +
        '</div>' +
        '<div id="stat-grid" class="stat-grid" aria-busy="true">' + statSkeletonHTML() + '</div>' +
      '</section>';

    document.getElementById('dash-refresh').addEventListener('click', function () {
      loadCounts();
    });
    loadCounts();
  }

  function statSkeletonHTML() {
    var out = '';
    for (var i = 0; i < 6; i++) {
      out += '<div class="stat-card" aria-hidden="true">' +
        '<span class="stat-card__label">…</span>' +
        '<span class="stat-card__value">—</span>' +
      '</div>';
    }
    return out;
  }

  function statCardHTML(label, value) {
    return (
      '<div class="stat-card">' +
        '<span class="stat-card__label">' + esc(label) + '</span>' +
        '<span class="stat-card__value">' + esc(Number(value).toLocaleString()) + '</span>' +
      '</div>'
    );
  }

  function loadCounts() {
    window.VD.api.admin.dashboardCounts().then(function (counts) {
      var grid = document.getElementById('stat-grid');
      if (!grid) return;   // the user switched tabs meanwhile
      grid.removeAttribute('aria-busy');
      grid.innerHTML =
        statCardHTML('Total products', counts.total) +
        statCardHTML('Published', counts.published) +
        statCardHTML('Hidden', counts.hidden) +
        statCardHTML('Out of stock', counts.outOfStock) +
        statCardHTML('Demo products', counts.demo) +
        statCardHTML('Orders', counts.orders);
    }).catch(function (err) {
      var grid = document.getElementById('stat-grid');
      if (!grid) return;
      grid.removeAttribute('aria-busy');
      grid.innerHTML =
        '<p class="empty-note empty-note--error">Could not load the dashboard: ' + esc(err.message) + '. ' +
        '<button type="button" class="button button--outline" id="dash-retry">Retry</button></p>';
      var retry = document.getElementById('dash-retry');
      if (retry) retry.addEventListener('click', function () { loadCounts(); });
    });
  }

  /* ========================================================================
     VIEW — PRODUCTS LIST
     ======================================================================== */

  function showProducts() {
    state.editor = null;
    state.productQuery = '';
    state.productStatus = 'all';

    viewEl().innerHTML =
      '<section class="admin-panel" aria-labelledby="prod-title">' +
        '<div class="admin-panel__head">' +
          '<h2 id="prod-title" class="admin-panel__title">Products</h2>' +
        '</div>' +
        '<div class="admin-toolbar">' +
          '<input type="search" id="prod-search" class="input admin-toolbar__search" ' +
            'placeholder="Search name, SKU or slug…" aria-label="Search products">' +
          '<select id="prod-status" class="select admin-toolbar__select" aria-label="Filter products by status">' +
            '<option value="all">All statuses</option>' +
            '<option value="published">Published</option>' +
            '<option value="hidden">Hidden</option>' +
            '<option value="out">Out of stock</option>' +
            '<option value="demo">Demo</option>' +
          '</select>' +
          '<button type="button" id="prod-add" class="button button--dark">+ Add product</button>' +
        '</div>' +
        '<div id="prod-tablewrap"><p class="empty-note">Loading products…</p></div>' +
      '</section>';

    document.getElementById('prod-add').addEventListener('click', function () {
      openEditor(null);
    });

    var searchInput = document.getElementById('prod-search');
    searchInput.addEventListener('input', window.VD.utils.debounce(function () {
      state.productQuery = searchInput.value;
      renderProductTable();
    }, 150));

    document.getElementById('prod-status').addEventListener('change', function (event) {
      state.productStatus = event.target.value;
      renderProductTable();
    });

    bindProductTableEvents();
    loadProducts();
  }

  function loadProducts() {
    return Promise.all([
      window.VD.api.admin.listProducts(),
      window.VD.api.admin.listCategories()
    ]).then(function (results) {
      state.products = results[0];
      state.categories = results[1];
      renderProductTable();
    }).catch(function (err) {
      var wrap = document.getElementById('prod-tablewrap');
      if (!wrap) return;
      wrap.innerHTML =
        '<p class="empty-note empty-note--error">Could not load products: ' + esc(err.message) + '. ' +
        '<button type="button" class="button button--outline" data-retry-products>Retry</button></p>';
    });
  }

  function bindProductTableEvents() {
    var wrap = document.getElementById('prod-tablewrap');
    if (!wrap) return;

    wrap.addEventListener('click', function (event) {
      if (event.target.closest('[data-retry-products]')) {
        wrap.innerHTML = '<p class="empty-note">Loading products…</p>';
        loadProducts();
        return;
      }
      var shortcut = event.target.closest('[data-empty-action]');
      if (shortcut) {
        if (shortcut.getAttribute('data-empty-action') === 'demo') setTab('demo');
        else openEditor(null);
        return;
      }
      var actionButton = event.target.closest('[data-action]');
      if (actionButton) {
        var row = actionButton.closest('tr[data-product-id]');
        handleProductAction(actionButton.getAttribute('data-action'), row ? row.getAttribute('data-product-id') : null, actionButton);
        return;
      }
      // Row click = Edit (buttons above short-circuit before this).
      var rowEl = event.target.closest('tr[data-product-id]');
      if (rowEl) openEditor(findProduct(rowEl.getAttribute('data-product-id')));
    });

    // Keyboard: Enter/Space on a focused row opens the editor.
    wrap.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (!event.target.matches || !event.target.matches('tr[data-product-id]')) return;
      event.preventDefault();
      openEditor(findProduct(event.target.getAttribute('data-product-id')));
    });
  }

  function findProduct(id) {
    for (var i = 0; i < state.products.length; i++) {
      if (state.products[i].id === id) return state.products[i];
    }
    return null;
  }

  function productsEmptyHTML() {
    return (
      '<div class="empty-note admin-empty">' +
        '<p>No products yet — add your first product or load demo data.</p>' +
        '<div class="admin-empty__actions">' +
          '<button type="button" class="button button--dark" data-empty-action="add">+ Add product</button>' +
          '<button type="button" class="button button--outline" data-empty-action="demo">Go to demo data</button>' +
        '</div>' +
      '</div>'
    );
  }

  function applyProductFilters() {
    var query = state.productQuery.trim().toLowerCase();
    var status = state.productStatus;
    return state.products.filter(function (product) {
      if (query && (product.name + ' ' + product.sku + ' ' + product.slug).toLowerCase().indexOf(query) === -1) return false;
      if (status === 'published') return product.is_published;
      if (status === 'hidden') return !product.is_published;
      if (status === 'out') return product.stock_total === 0;
      if (status === 'demo') return product.is_demo;
      return true;
    });
  }

  function renderProductTable() {
    var wrap = document.getElementById('prod-tablewrap');
    if (!wrap) return;

    if (!state.products.length) {
      wrap.innerHTML = productsEmptyHTML();
      return;
    }
    var filtered = applyProductFilters();
    if (!filtered.length) {
      wrap.innerHTML = '<p class="empty-note">No products match your filters.</p>';
      return;
    }

    wrap.innerHTML =
      '<div class="admin-table">' +
        '<table>' +
          '<thead><tr>' +
            '<th><span class="sr-only">Image</span></th>' +
            '<th>Product</th><th>SKU</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th>' +
            '<th><span class="sr-only">Actions</span></th>' +
          '</tr></thead>' +
          '<tbody>' + filtered.map(productRowHTML).join('') + '</tbody>' +
        '</table>' +
      '</div>';
  }

  function productRowHTML(product) {
    return (
      '<tr data-product-id="' + esc(product.id) + '" tabindex="0" aria-label="Edit ' + esc(product.name) + '">' +
        '<td class="admin-table__thumb"><img src="' + esc(product.cover_image || 'placeholder.svg') + '" alt="" ' +
          'width="44" height="44" loading="lazy" onerror="VD.utils.imgFallback(this)"></td>' +
        '<td><span class="admin-table__primary">' + esc(product.name) + '</span>' +
          '<span class="admin-table__sub">/' + esc(product.slug) + '</span></td>' +
        '<td>' + esc(product.sku) + '</td>' +
        '<td>' + esc(product.category_name || '—') + '</td>' +
        '<td>' + window.VD.products.priceHTML(product) + '</td>' +
        '<td>' + stockCellHTML(product) + '</td>' +
        '<td class="admin-table__badges">' + productBadgesHTML(product) + '</td>' +
        '<td class="admin-table__actions">' +
          '<button type="button" class="table-action" data-action="edit">Edit</button>' +
          '<button type="button" class="table-action" data-action="toggle-published">' + (product.is_published ? 'Hide' : 'Unhide') + '</button>' +
          '<button type="button" class="table-action" data-action="toggle-featured">' + (product.is_featured ? 'Unfeature' : 'Feature') + '</button>' +
          '<button type="button" class="table-action table-action--danger" data-action="delete">Delete</button>' +
        '</td>' +
      '</tr>'
    );
  }

  function stockCellHTML(product) {
    if (product.stock_total === 0) return '<span class="badge badge--sale">Out of stock</span>';
    return esc(String(product.stock_total));
  }

  /* Status badges: Published/Hidden + Demo + flag badges (Featured/New/Sale). */
  function productBadgesHTML(product) {
    var badges = [];
    badges.push(product.is_published
      ? '<span class="badge badge--new">Published</span>'
      : '<span class="badge badge--sale">Hidden</span>');
    if (product.is_demo) badges.push('<span class="badge">Demo</span>');
    if (product.is_featured) badges.push('<span class="badge badge--best">Featured</span>');
    if (product.is_new_arrival) badges.push('<span class="badge badge--new">New</span>');
    if (product.is_on_sale) badges.push('<span class="badge badge--sale">Sale</span>');
    return badges.join(' ');
  }

  function handleProductAction(action, productId, button) {
    var product = findProduct(productId);
    if (!product) return;

    if (action === 'edit') {
      openEditor(product);
      return;
    }

    if (action === 'toggle-published') {
      var publish = !product.is_published;
      if (button) { button.disabled = true; }
      window.VD.api.admin.setPublished(product.id, publish).then(function () {
        product.is_published = publish;
        toast(publish ? '“' + product.name + '” is live in the store.' : '“' + product.name + '” is hidden from the store.', 'success');
        renderProductTable();
      }).catch(function (err) {
        toast(err.message, 'error');
        if (button) button.disabled = false;
      });
      return;
    }

    if (action === 'toggle-featured') {
      var featured = !product.is_featured;
      if (button) { button.disabled = true; }
      window.VD.api.admin.setFlag(product.id, 'is_featured', featured).then(function () {
        product.is_featured = featured;
        toast(featured ? '“' + product.name + '” added to featured.' : '“' + product.name + '” removed from featured.', 'success');
        renderProductTable();
      }).catch(function (err) {
        toast(err.message, 'error');
        if (button) button.disabled = false;
      });
      return;
    }

    if (action === 'delete') {
      confirmModal({
        title: 'Delete product?',
        message:
          '<p><strong>' + esc(product.name) + '</strong> will be permanently deleted, together with its variants and images. ' +
          'Uploaded files are removed from storage. This cannot be undone.</p>',
        confirmLabel: 'Delete product',
        cancelLabel: 'Keep it',
        danger: true,
        onConfirm: function () {
          window.VD.api.admin.deleteProduct(product).then(function () {
            state.products = state.products.filter(function (p) { return p.id !== product.id; });
            toast('Product deleted.', 'success');
            renderProductTable();
          }).catch(function (err) {
            toast(err.message, 'error');
          });
        }
      });
    }
  }

  /* ========================================================================
     VIEW — PRODUCT EDITOR (model)
     ======================================================================== */

  function blankVariant() {
    return { id: null, sku: '', size: '', color: '', color_hex: '#c9c2b6', stock: 0 };
  }

  function modelNewProduct() {
    return {
      id: null,
      name: '',
      slug: '',
      slugTouched: false,     // while false, the slug auto-follows the name
      sku: '',
      categoryId: '',
      audience: 'unisex',
      description: '',
      details: '',
      basePrice: '',
      salePrice: '',
      flags: { published: true, featured: false, newArrival: false, bestSeller: false },
      images: [],
      variants: [blankVariant()]   // start with one row — products need variants to be buyable
    };
  }

  function modelFromProduct(product) {
    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      slugTouched: true,        // never clobber an existing slug while typing the name
      sku: product.sku,
      categoryId: categoryIdFromSlug(product.category_slug),
      audience: product.audience || 'unisex',
      description: product.description || '',
      details: product.details || '',
      basePrice: String(product.base_price),
      salePrice: product.sale_price == null ? '' : String(product.sale_price),
      flags: {
        published: product.is_published,
        featured: product.is_featured,
        newArrival: product.is_new_arrival,
        bestSeller: product.is_best_seller
      },
      images: (product.images || []).map(function (img) {
        return { url: img.url, alt: img.alt || product.name };
      }),
      variants: (product.variants || []).map(function (v) {
        return { id: v.id, sku: v.sku, size: v.size, color: v.color, color_hex: v.color_hex || '#c9c2b6', stock: v.stock };
      })
    };
  }

  function categoryIdFromSlug(categorySlug) {
    for (var i = 0; i < state.categories.length; i++) {
      if (state.categories[i].slug === categorySlug) return state.categories[i].id;
    }
    return '';
  }

  function categoryNameById(categoryId) {
    for (var i = 0; i < state.categories.length; i++) {
      if (state.categories[i].id === categoryId) return state.categories[i].name;
    }
    return '';
  }

  function openEditor(product) {
    state.editor = product ? modelFromProduct(product) : modelNewProduct();
    showEditor();
    if (!state.categories.length) ensureCategories();   // fill the select when it arrives
  }

  function ensureCategories() {
    window.VD.api.admin.listCategories().then(function (categories) {
      state.categories = categories;
      var select = document.getElementById('f-category');
      if (!select || !state.editor) return;
      select.innerHTML = categoryOptionsHTML(state.editor.categoryId);
    }).catch(function () { /* the save validation will complain about a missing category */ });
  }

  function categoryOptionsHTML(selectedId) {
    var options = ['<option value=""' + (selectedId ? '' : ' selected') + ' disabled>Select a category…</option>'];
    state.categories.forEach(function (category) {
      options.push('<option value="' + esc(category.id) + '"' + (category.id === selectedId ? ' selected' : '') + '>' +
        esc(category.name) + '</option>');
    });
    return options.join('');
  }

  // Audience drives the storefront's Women/Men category filters.
  function audienceOptionsHTML(selected) {
    var opts = [
      { value: 'women', label: 'Women' },
      { value: 'men', label: 'Men' },
      { value: 'unisex', label: 'Unisex / not specified' }
    ];
    return opts.map(function (o) {
      return '<option value="' + o.value + '"' + (o.value === selected ? ' selected' : '') + '>' + o.label + '</option>';
    }).join('');
  }

  /* ========================================================================
     VIEW — PRODUCT EDITOR (render)
     ======================================================================== */

  function fieldHTML(id, label, controlHTML, hintHTML) {
    return (
      '<div class="field">' +
        '<label class="field__label" for="' + id + '">' + esc(label) + '</label>' +
        controlHTML +
        (hintHTML ? '<p class="form-note">' + hintHTML + '</p>' : '') +
      '</div>'
    );
  }

  function showEditor() {
    var m = state.editor;
    var isEdit = !!m.id;

    viewEl().innerHTML =
      '<section class="admin-panel admin-editor" aria-labelledby="editor-title">' +
        '<div class="admin-panel__head">' +
          '<button type="button" id="editor-back" class="button button--outline">← Back to products</button>' +
          '<h2 id="editor-title" class="admin-panel__title">' + (isEdit ? 'Edit product' : 'New product') + '</h2>' +
        '</div>' +
        '<p id="editor-error" class="form-note form-note--error" role="alert" hidden></p>' +
        '<div class="editor-grid">' +

          /* ---- left column: the main fields ---- */
          '<div class="editor-grid__main">' +
            fieldHTML('f-name', 'Name',
              '<input class="input" type="text" id="f-name" value="' + esc(m.name) + '">') +
            fieldHTML('f-slug', 'Slug',
              '<input class="input" type="text" id="f-slug" value="' + esc(m.slug) + '">',
              'Used in the product URL (<code>/product.html?slug=…</code>). Left alone it follows the name.') +
            fieldHTML('f-sku', 'SKU',
              '<input class="input" type="text" id="f-sku" value="' + esc(m.sku) + '">',
              'Base SKU — variants automatically append colour and size.') +
            fieldHTML('f-category', 'Category',
              '<select class="select" id="f-category">' + categoryOptionsHTML(m.categoryId) + '</select>') +
            fieldHTML('f-audience', 'Audience',
              '<select class="select" id="f-audience">' + audienceOptionsHTML(m.audience) + '</select>') +
            fieldHTML('f-description', 'Description',
              '<textarea class="textarea" id="f-description" rows="4">' + esc(m.description) + '</textarea>',
              'Short editorial copy shown on the product page.') +
            fieldHTML('f-details', 'Details',
              '<textarea class="textarea" id="f-details" rows="3">' + esc(m.details) + '</textarea>',
              'Fabric, care and fit notes — e.g. “70% merino wool. Machine wash cold. Relaxed fit.”') +
            fieldHTML('f-base-price', 'Base price',
              '<input class="input" type="number" id="f-base-price" min="0" step="0.01" value="' + esc(m.basePrice) + '">') +
            fieldHTML('f-sale-price', 'Sale price',
              '<input class="input" type="number" id="f-sale-price" min="0" step="0.01" value="' + esc(m.salePrice) + '">',
              'Optional — must be lower than the base price.') +
            '<div class="editor-flags">' +
              '<span class="editor-flags__title">Flags</span>' +
              '<label class="checkbox-row"><input type="checkbox" id="f-published"' + (m.flags.published ? ' checked' : '') + '> <span>Published</span></label>' +
              '<label class="checkbox-row"><input type="checkbox" id="f-featured"' + (m.flags.featured ? ' checked' : '') + '> <span>Featured</span></label>' +
              '<label class="checkbox-row"><input type="checkbox" id="f-new-arrival"' + (m.flags.newArrival ? ' checked' : '') + '> <span>New arrival</span></label>' +
              '<label class="checkbox-row"><input type="checkbox" id="f-best-seller"' + (m.flags.bestSeller ? ' checked' : '') + '> <span>Best seller</span></label>' +
            '</div>' +
            '<div class="editor-actions">' +
              '<button type="button" id="editor-save-draft" class="button">Save draft</button>' +
              '<button type="button" id="editor-publish" class="button button--dark">Publish</button>' +
              '<button type="button" id="editor-preview" class="button button--outline">Preview</button>' +
              (isEdit ? '<button type="button" id="editor-delete" class="button button--danger">Delete</button>' : '') +
            '</div>' +
            '<p class="form-note">“Save draft” keeps the product hidden; “Publish” makes it live — these buttons decide the final published state.</p>' +
          '</div>' +

          /* ---- right column: images + variants ---- */
          '<div class="editor-grid__side">' +
            imagesBlockHTML() +
            variantsBlockHTML() +
          '</div>' +

        '</div>' +
      '</section>';

    bindEditor();
  }

  function imagesBlockHTML() {
    return (
      '<section class="editor-block" aria-label="Product images">' +
        '<h3 class="editor-block__title">Images</h3>' +
        '<div id="dropzone" class="dropzone" role="button" tabindex="0" aria-label="Add images — drag and drop or press Enter to browse">' +
          '<p class="dropzone__title">Drag &amp; drop images here or click to browse</p>' +
          '<p class="dropzone__hint">PNG, JPG or WebP · up to 5&nbsp;MB each</p>' +
        '</div>' +
        '<input type="file" id="f-images" class="sr-only" tabindex="-1" multiple accept="image/png,image/jpeg,image/webp">' +
        '<div id="upload-log" class="upload-log" aria-live="polite"></div>' +
        '<div id="thumb-grid" class="editor-images"></div>' +
        '<p class="form-note form-note--info">Uploads go to Storage immediately but are only attached to the product when you save. ' +
        'The first image is the cover — click a thumbnail’s radio to make it the cover, or reorder with ↑ / ↓.</p>' +
      '</section>'
    );
  }

  function variantsBlockHTML() {
    var m = state.editor;
    return (
      '<section class="editor-block" aria-label="Product variants">' +
        '<h3 class="editor-block__title">Variants</h3>' +
        '<p class="form-note form-note--info">Variants are what customers actually buy — one row per size and colour combination, each with its own stock. ' +
        'New rows get the SKU <code>' + esc((m.sku || 'BASE-SKU') + '-COL-SIZE') + '</code> automatically; existing rows keep their SKU so past orders stay accurate.</p>' +
        '<div class="variant-table">' +
          '<table>' +
            '<thead><tr>' +
              '<th>Size</th><th>Colour</th><th>Swatch</th><th>Stock</th><th>SKU (auto)</th><th><span class="sr-only">Actions</span></th>' +
            '</tr></thead>' +
            '<tbody id="variant-body">' + variantRowsHTML() + '</tbody>' +
          '</table>' +
        '</div>' +
        '<button type="button" id="variant-add" class="button button--outline">+ Add variant</button>' +
      '</section>'
    );
  }

  function variantRowsHTML() {
    var m = state.editor;
    return m.variants.map(function (v, index) {
      return (
        '<tr data-variant-index="' + index + '">' +
          '<td><input class="input" type="text" data-vfield="size" value="' + esc(v.size) + '" aria-label="Size"></td>' +
          '<td><input class="input" type="text" data-vfield="color" value="' + esc(v.color) + '" aria-label="Colour name"></td>' +
          '<td class="variant-table__swatch">' +
            '<input type="color" data-vfield="hexPicker" value="' + esc(hexForPicker(v.color_hex)) + '" aria-label="Colour swatch">' +
            '<input class="input" type="text" data-vfield="hexText" value="' + esc(v.color_hex || '') + '" maxlength="7" placeholder="#A1B2C3" aria-label="Colour hex value">' +
          '</td>' +
          '<td><input class="input" type="number" data-vfield="stock" min="0" max="999" step="1" value="' + esc(String(v.stock)) + '" aria-label="Stock quantity"></td>' +
          '<td><input class="input" type="text" readonly data-variant-sku value="' + esc(variantSkuPreview(m, v)) + '" aria-label="Variant SKU (automatic)"></td>' +
          '<td><button type="button" class="table-action table-action--danger" data-variant-remove aria-label="Remove variant">×</button></td>' +
        '</tr>'
      );
    }).join('');
  }

  /* ========================================================================
     VIEW — PRODUCT EDITOR (behaviour)
     ======================================================================== */

  function bindEditor() {
    var m = state.editor;

    document.getElementById('editor-back').addEventListener('click', function () {
      exitEditor(function () { showProducts(); });
    });
    document.getElementById('editor-save-draft').addEventListener('click', function () { saveEditor(false); });
    document.getElementById('editor-publish').addEventListener('click', function () { saveEditor(true); });
    document.getElementById('editor-preview').addEventListener('click', openPreview);
    var deleteButton = document.getElementById('editor-delete');
    if (deleteButton) deleteButton.addEventListener('click', confirmDeleteFromEditor);

    /* Field bindings keep the model in sync without re-rendering (focus is
       preserved); the model is the single source of truth for Save. */
    document.getElementById('f-name').addEventListener('input', function () {
      m.name = this.value;
      if (!m.slugTouched) {
        m.slug = slugify(m.name);
        document.getElementById('f-slug').value = m.slug;
      }
    });
    document.getElementById('f-slug').addEventListener('input', function () {
      m.slug = this.value;
      m.slugTouched = this.value.trim() !== '';   // cleared by hand → auto-follow resumes
    });
    document.getElementById('f-sku').addEventListener('input', function () {
      m.sku = this.value;
      refreshVariantSkuPreviews();
    });
    document.getElementById('f-category').addEventListener('change', function () {
      m.categoryId = this.value;
    });
    document.getElementById('f-audience').addEventListener('change', function () {
      m.audience = this.value;
    });
    document.getElementById('f-description').addEventListener('input', function () { m.description = this.value; });
    document.getElementById('f-details').addEventListener('input', function () { m.details = this.value; });
    document.getElementById('f-base-price').addEventListener('input', function () { m.basePrice = this.value; });
    document.getElementById('f-sale-price').addEventListener('input', function () { m.salePrice = this.value; });

    [['f-published', 'published'], ['f-featured', 'featured'], ['f-new-arrival', 'newArrival'], ['f-best-seller', 'bestSeller']]
      .forEach(function (pair) {
        document.getElementById(pair[0]).addEventListener('change', function () {
          m.flags[pair[1]] = this.checked;
        });
      });

    bindImageUploader();
    bindThumbGrid();
    bindVariantTable();
    renderThumbs();
  }

  /* Leave the editor — if images were uploaded but never saved, offer to
     delete the orphans from Storage first (best effort). */
  function exitEditor(onDone) {
    var orphans = state.uploadedThisSession.slice();
    if (!orphans.length) {
      state.editor = null;
      onDone();
      return;
    }
    confirmModal({
      title: 'Remove unsaved uploads?',
      message:
        '<p>' + orphans.length + ' image' + (orphans.length === 1 ? ' was' : 's were') + ' uploaded in this session but never saved with a product.</p>' +
        '<p>Delete ' + (orphans.length === 1 ? 'it' : 'them') + ' from storage now? Choosing “Keep files” leaves them in your Supabase bucket.</p>',
      confirmLabel: 'Delete uploads',
      cancelLabel: 'Keep files',
      danger: true,
      onConfirm: function () {
        orphans.forEach(function (url) {
          window.VD.api.admin.deleteStorageImage(url).catch(function () { /* best effort */ });
        });
        toast('Unsaved uploads deleted from storage.', 'info');
        state.editor = null;
        state.uploadedThisSession = [];
        onDone();
      },
      onCancel: function () {
        state.editor = null;
        state.uploadedThisSession = [];
        onDone();
      }
    });
  }

  /* ---------- validation + save ---------- */

  function money2(value) {
    if (value === '' || value == null) return null;
    var n = Number(value);
    return isFinite(n) ? Math.round(n * 100) / 100 : null;
  }

  function validateEditor(m) {
    var errors = [];
    if (!m.name.trim()) errors.push('Name is required.');
    if (!m.slug.trim()) {
      errors.push('Slug is required.');
    } else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(m.slug.trim())) {
      errors.push('Slug may only contain lowercase letters, numbers and single dashes.');
    }
    if (!m.sku.trim()) errors.push('SKU is required.');
    if (!m.categoryId) errors.push('Choose a category.');
    var base = money2(m.basePrice);
    if (base == null || base < 0) errors.push('Base price must be a number of 0 or more.');
    if (m.salePrice !== '' && money2(m.salePrice) == null) errors.push('Sale price must be a number.');
    if (base != null && money2(m.salePrice) != null && money2(m.salePrice) >= base) {
      errors.push('Sale price must be lower than the base price.');
    }
    return errors;
  }

  function setEditorBusy(busy, busyLabel) {
    ['editor-save-draft', 'editor-publish', 'editor-preview', 'editor-delete'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.disabled = busy;
    });
    if (busy && busyLabel) {
      // Show progress on the active action button (publish or draft).
      var primary = document.getElementById(busyLabel.publish ? 'editor-publish' : 'editor-save-draft');
      if (primary) primary.textContent = busyLabel.text;
    }
  }

  function saveEditor(publish) {
    var m = state.editor;
    if (!m) return;

    var errors = validateEditor(m);
    var note = document.getElementById('editor-error');
    if (errors.length) {
      note.hidden = false;
      note.textContent = errors.join(' ');
      toast('Please fix the errors before saving.', 'error');
      return;
    }
    note.hidden = true;
    setEditorBusy(true, { publish: publish, text: publish ? 'Publishing…' : 'Saving…' });

    // NOTE: the form is intentionally NOT reset here — on failure the
    // admin keeps everything they typed.
    window.VD.api.admin.saveProduct(buildProductPayload(m, publish)).then(function () {
      state.editor = null;
      state.uploadedThisSession = [];   // uploads are now persisted in the DB
      toast(publish ? 'Product published.' : 'Draft saved.', 'success');
      showProducts();                   // back to the list, reloaded fresh
    }).catch(function (err) {
      setEditorBusy(false, {});
      restoreEditorButtonLabels();
      note.hidden = false;
      note.textContent = err.message;
      toast('Could not save the product: ' + err.message, 'error');
    });
  }

  function restoreEditorButtonLabels() {
    var draft = document.getElementById('editor-save-draft');
    var publishBtn = document.getElementById('editor-publish');
    if (draft) draft.textContent = 'Save draft';
    if (publishBtn) publishBtn.textContent = 'Publish';
  }

  function buildProductPayload(m, publish) {
    var base = money2(m.basePrice);
    var sale = money2(m.salePrice);
    return {
      id: m.id,
      name: m.name.trim(),
      slug: m.slug.trim(),
      sku: m.sku.trim(),
      category_id: m.categoryId,
      audience: m.audience || 'unisex',
      description: m.description,
      details: m.details,
      base_price: base == null ? 0 : base,
      sale_price: m.salePrice === '' ? '' : sale,   // saveProduct maps '' → NULL
      is_published: !!publish,                       // the button decides, not the checkbox
      is_featured: !!m.flags.featured,
      is_new_arrival: !!m.flags.newArrival,
      is_best_seller: !!m.flags.bestSeller,
      images: m.images.map(function (img) {
        return { url: img.url, alt: img.alt || m.name.trim() };
      }),
      variants: m.variants.map(function (v) {
        return {
          id: v.id || null,
          sku: variantFinalSku(m, v),
          size: v.size.trim(),
          color: v.color.trim(),
          color_hex: normalizeHex(v.color_hex),
          stock: clampStock(v.stock)
        };
      })
    };
  }

  function confirmDeleteFromEditor() {
    var m = state.editor;
    if (!m || !m.id) return;
    confirmModal({
      title: 'Delete product?',
      message:
        '<p><strong>' + esc(m.name || 'This product') + '</strong> will be permanently deleted, together with its variants and images. ' +
        'Uploaded files are removed from storage. This cannot be undone.</p>',
      confirmLabel: 'Delete product',
      cancelLabel: 'Keep it',
      danger: true,
      onConfirm: function () {
        window.VD.api.admin.deleteProduct({ id: m.id, images: m.images }).then(function () {
          state.editor = null;
          state.uploadedThisSession = [];
          toast('Product deleted.', 'success');
          showProducts();
        }).catch(function (err) {
          toast(err.message, 'error');
        });
      }
    });
  }

  /* ---------- images: dropzone, upload, thumbs ---------- */

  function bindImageUploader() {
    var dropzone = document.getElementById('dropzone');
    var input = document.getElementById('f-images');

    dropzone.addEventListener('click', function () { input.click(); });
    dropzone.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        input.click();
      }
    });
    ['dragenter', 'dragover'].forEach(function (type) {
      dropzone.addEventListener(type, function (event) {
        event.preventDefault();
        dropzone.classList.add('is-dragover');
      });
    });
    ['dragleave', 'drop'].forEach(function (type) {
      dropzone.addEventListener(type, function (event) {
        event.preventDefault();
        dropzone.classList.remove('is-dragover');
      });
    });
    dropzone.addEventListener('drop', function (event) {
      handleUploadFiles(event.dataTransfer && event.dataTransfer.files);
    });
    input.addEventListener('change', function () {
      handleUploadFiles(input.files);
      input.value = '';   // allow re-selecting the same file
    });
  }

  function handleUploadFiles(fileList) {
    var m = state.editor;
    if (!m) return;
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;

    var accepted = [];
    files.forEach(function (file) {
      if (ALLOWED_UPLOAD_TYPES.indexOf(file.type) === -1 || file.size > MAX_UPLOAD_BYTES) {
        logUploadRow(file.name, 'error', 'unsupported type or larger than 5 MB');
        return;
      }
      accepted.push(file);
    });

    // Upload sequentially so the thumbs keep a stable, predictable order.
    var chain = Promise.resolve();
    accepted.forEach(function (file) {
      chain = chain.then(function () { return uploadOneFile(file); });
    });
  }

  function uploadOneFile(file) {
    var m = state.editor;
    if (!m) return Promise.resolve();
    logUploadRow(file.name, 'progress');
    return window.VD.api.admin.uploadImage(file, m.slug || 'product').then(function (publicUrl) {
      if (!state.editor) return;   // editor was closed mid-upload
      m.images.push({ url: publicUrl, alt: altFromFile(file) });
      state.uploadedThisSession.push(publicUrl);   // tracked until the product is saved
      logUploadRow(file.name, 'done');
      renderThumbs();
    }).catch(function (err) {
      logUploadRow(file.name, 'error', err.message);
    });
  }

  function altFromFile(file) {
    return file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim() || 'Product image';
  }

  function logUploadRow(name, kind, detail) {
    var log = document.getElementById('upload-log');
    if (!log) return;
    var text;
    if (kind === 'progress') text = 'Uploading ' + name + '…';
    else if (kind === 'done') text = 'Uploading ' + name + ' — done.';
    else text = 'Uploading ' + name + ' — error: ' + (detail || 'failed');
    log.insertAdjacentHTML('beforeend',
      '<p class="upload-log__row upload-log__row--' + kind + '">' + esc(text) + '</p>');
    while (log.children.length > 8) log.removeChild(log.firstChild);   // keep the log short
  }

  function renderThumbs() {
    var grid = document.getElementById('thumb-grid');
    var m = state.editor;
    if (!grid || !m) return;
    grid.innerHTML = m.images.length
      ? m.images.map(thumbHTML).join('')
      : '<p class="empty-note">No images yet — the storefront card uses the placeholder until you upload one.</p>';
  }

  function thumbHTML(img, index) {
    var m = state.editor;
    var isCover = index === 0;
    return (
      '<figure class="image-thumb' + (isCover ? ' is-cover' : '') + '" data-thumb-index="' + index + '">' +
        '<img src="' + esc(img.url) + '" alt="' + esc(img.alt || 'Product image') + '" onerror="VD.utils.imgFallback(this)">' +
        (isCover ? '<span class="image-thumb__tag">Cover</span>' : '') +
        '<label class="image-thumb__cover" title="Set as cover image">' +
          '<input type="radio" name="cover-choice" value="' + index + '"' + (isCover ? ' checked' : '') +
            ' aria-label="Set image ' + (index + 1) + ' as cover">' +
        '</label>' +
        '<div class="image-thumb__actions">' +
          '<button type="button" class="table-action" data-thumb-action="up" aria-label="Move image earlier"' +
            (index === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button type="button" class="table-action" data-thumb-action="down" aria-label="Move image later"' +
            (index === m.images.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '<button type="button" class="table-action table-action--danger" data-thumb-action="remove" aria-label="Remove image">×</button>' +
        '</div>' +
      '</figure>'
    );
  }

  function bindThumbGrid() {
    var grid = document.getElementById('thumb-grid');
    if (!grid) return;

    grid.addEventListener('click', function (event) {
      var button = event.target.closest('[data-thumb-action]');
      if (!button) return;
      var figure = button.closest('[data-thumb-index]');
      if (!figure) return;
      var index = Number(figure.getAttribute('data-thumb-index'));
      var action = button.getAttribute('data-thumb-action');
      if (action === 'up') moveImage(index, -1);
      else if (action === 'down') moveImage(index, 1);
      else if (action === 'remove') removeImage(index);
    });

    grid.addEventListener('change', function (event) {
      if (event.target.matches && event.target.matches('input[name="cover-choice"]')) {
        setCoverImage(Number(event.target.value));
      }
    });
  }

  /* The cover is simply images[0] (saveProduct derives cover_image from it),
     so "set as cover" moves the chosen image to the front. */
  function setCoverImage(index) {
    var m = state.editor;
    if (!m || index <= 0 || index >= m.images.length) return;
    var img = m.images.splice(index, 1)[0];
    m.images.unshift(img);
    renderThumbs();
  }

  function moveImage(index, delta) {
    var m = state.editor;
    if (!m) return;
    var target = index + delta;
    if (target < 0 || target >= m.images.length) return;
    var swapped = m.images[index];
    m.images[index] = m.images[target];
    m.images[target] = swapped;
    renderThumbs();
  }

  function removeImage(index) {
    var m = state.editor;
    if (!m || index < 0 || index >= m.images.length) return;
    var img = m.images[index];

    if (!isStorageImage(img.url)) {
      // Relative bundled path (e.g. images/products/…) — nothing in Storage
      // to delete, just drop it from the list.
      m.images.splice(index, 1);
      renderThumbs();
      return;
    }

    confirmModal({
      title: 'Delete this image?',
      message:
        '<p>“' + esc(img.alt || 'This image') + '” is stored in your Supabase bucket. Removing it deletes the file from ' +
        'Storage immediately — even if you do not save the product afterwards.</p>',
      confirmLabel: 'Delete image',
      cancelLabel: 'Keep it',
      danger: true,
      onConfirm: function () {
        window.VD.api.admin.deleteStorageImage(img.url).catch(function () { /* best effort */ });
        // Also drop it from the session tracker so exit doesn't delete twice.
        state.uploadedThisSession = state.uploadedThisSession.filter(function (url) { return url !== img.url; });
        m.images.splice(index, 1);
        renderThumbs();
        toast('Image deleted from storage.', 'info');
      }
    });
  }

  function isStorageImage(url) {
    return String(url || '').indexOf(STORAGE_MARKER) !== -1;
  }

  /* ---------- variants ---------- */

  function bindVariantTable() {
    document.getElementById('variant-add').addEventListener('click', function () {
      state.editor.variants.push(blankVariant());
      renderVariantRows();
    });

    var body = document.getElementById('variant-body');

    body.addEventListener('input', function (event) {
      var field = event.target.getAttribute && event.target.getAttribute('data-vfield');
      if (!field) return;
      var row = event.target.closest('tr[data-variant-index]');
      var variant = state.editor.variants[Number(row.getAttribute('data-variant-index'))];
      if (!variant) return;

      if (field === 'size') variant.size = event.target.value;
      else if (field === 'color') variant.color = event.target.value;
      else if (field === 'stock') variant.stock = event.target.value;
      else if (field === 'hexPicker') {
        variant.color_hex = event.target.value;
        row.querySelector('[data-vfield="hexText"]').value = event.target.value;
      } else if (field === 'hexText') {
        variant.color_hex = event.target.value;
        if (/^#[0-9a-fA-F]{6}$/.test(event.target.value)) {
          row.querySelector('[data-vfield="hexPicker"]').value = event.target.value;
        }
      }
      if (field === 'size' || field === 'color') {
        row.querySelector('[data-variant-sku]').value = variantSkuPreview(state.editor, variant);
      }
    });

    body.addEventListener('click', function (event) {
      var button = event.target.closest('[data-variant-remove]');
      if (!button) return;
      var row = button.closest('tr[data-variant-index]');
      // Removing a row only marks it for deletion — the DB is untouched
      // until Save, so no confirm needed here.
      state.editor.variants.splice(Number(row.getAttribute('data-variant-index')), 1);
      renderVariantRows();
    });
  }

  function renderVariantRows() {
    var body = document.getElementById('variant-body');
    if (body) body.innerHTML = variantRowsHTML();
  }

  function refreshVariantSkuPreviews() {
    var m = state.editor;
    if (!m) return;
    document.querySelectorAll('#variant-body tr[data-variant-index]').forEach(function (row) {
      var variant = m.variants[Number(row.getAttribute('data-variant-index'))];
      var preview = row.querySelector('[data-variant-sku]');
      if (variant && preview) preview.value = variantSkuPreview(m, variant);
    });
  }

  /* 'Camel' → 'CAM', 'One Size' → 'OS' — mirrors demo-data.js rules. */
  function colorCode(name) {
    return String(name || '').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
  }
  function sizeCode(size) {
    return size === 'One Size' ? 'OS' : String(size || '').toUpperCase();
  }

  /* The SKU a variant WILL get: base SKU + colour + size. Existing variants
     keep their stored SKU (visible as the preview) so order history stays valid. */
  function variantSkuPreview(m, v) {
    if (v.id && v.sku) return v.sku;
    return (m.sku.trim() || 'BASE-SKU') + '-' + (colorCode(v.color) || 'COL') + '-' + (sizeCode(v.size) || 'SIZE');
  }

  function variantFinalSku(m, v) {
    if (v.id && v.sku) return v.sku;   // never rewrite SKUs of existing variants
    return (m.sku.trim() || 'BASE-SKU') + '-' + (colorCode(v.color) || 'COL') + '-' + (sizeCode(v.size) || 'SIZE');
  }

  function normalizeHex(value) {
    var hex = String(value || '').trim();
    return /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(hex) ? hex : null;
  }

  function hexForPicker(value) {
    return /^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? value : '#c9c2b6';
  }

  function clampStock(value) {
    var n = Math.round(Number(value) || 0);
    return Math.max(0, Math.min(999, n));
  }

  function slugify(value) {
    return String(value || '').toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /* ---------- storefront preview modal ---------- */

  function openPreview() {
    var m = state.editor;
    if (!m) return;
    var fake = buildPreviewProduct(m);
    openModal({
      title: 'Storefront preview',
      body:
        '<p class="form-note form-note--info">This is the live product card shoppers see — badges, price, colour dots, ' +
        'stock line and wishlist button all behave like the real card.</p>' +
        '<div class="product-grid">' + window.VD.products.cardHTML(fake) + '</div>'
    });
    /* The card's links would navigate away and lose the form — keep the
       preview self-contained. (The wishlist heart still works via the
       card registry.) */
    modal.root.querySelectorAll('.product-card a[href]').forEach(function (link) {
      link.addEventListener('click', function (event) {
        event.preventDefault();
        toast('Preview only — save the product to visit its storefront page.', 'info');
      });
    });
  }

  /* Build a product in the mapped shape from the current form values, so
     the shared card renderer can be reused as-is. Remembered in the card
     registry → the wishlist heart on the preview works safely. */
  function buildPreviewProduct(m) {
    var base = money2(m.basePrice);
    var sale = money2(m.salePrice);
    var onSale = sale != null && base != null && sale < base;

    var colors = [];
    var seenColors = {};
    m.variants.forEach(function (v) {
      if (v.color && !seenColors[v.color]) {
        seenColors[v.color] = true;
        colors.push({ name: v.color, hex: v.color_hex || '#c9c2b6' });
      }
    });
    var sizes = [];
    var seenSizes = {};
    m.variants.forEach(function (v) {
      if (v.size && seenSizes[v.size] == null) {
        seenSizes[v.size] = true;
        sizes.push(v.size);
      }
    });
    var stockTotal = m.variants.reduce(function (sum, v) { return sum + clampStock(v.stock); }, 0);

    return {
      id: m.id || 'preview',
      slug: m.slug || 'preview-product',
      sku: m.sku || '—',
      name: m.name || 'Untitled product',
      description: m.description,
      details: m.details,
      category_slug: '',
      category_name: categoryNameById(m.categoryId),
      base_price: base == null ? 0 : base,
      sale_price: onSale ? sale : null,
      price: onSale ? sale : (base == null ? 0 : base),
      is_on_sale: onSale,
      is_published: true,
      is_featured: !!m.flags.featured,
      is_new_arrival: !!m.flags.newArrival,
      is_best_seller: !!m.flags.bestSeller,
      is_demo: false,
      demo_batch_id: null,
      cover_image: m.images.length ? m.images[0].url : 'placeholder.svg',
      images: m.images,
      colors: colors,
      sizes: sizes,
      variants: [],
      stock_total: stockTotal,
      created_at: new Date().toISOString()
    };
  }

  /* ========================================================================
     VIEW — ORDERS
     ======================================================================== */

  function showOrders() {
    viewEl().innerHTML =
      '<section class="admin-panel" aria-labelledby="orders-title">' +
        '<div class="admin-panel__head">' +
          '<h2 id="orders-title" class="admin-panel__title">Orders</h2>' +
        '</div>' +
        '<div id="orders-wrap"><p class="empty-note">Loading orders…</p></div>' +
      '</section>';

    var wrap = document.getElementById('orders-wrap');
    wrap.addEventListener('click', function (event) {
      if (event.target.closest('[data-retry-orders]')) {
        wrap.innerHTML = '<p class="empty-note">Loading orders…</p>';
        loadOrders();
        return;
      }
      var button = event.target.closest('[data-action="view-order"]');
      if (!button) return;
      var row = button.closest('tr[data-order-row]');
      var order = findOrder(row ? row.getAttribute('data-order-row') : null);
      if (order) openOrderDrawer(order);
    });

    wrap.addEventListener('change', function (event) {
      var select = event.target.closest && event.target.closest('select[data-order-status]');
      if (select) changeOrderStatus(select);
    });

    loadOrders();
  }

  function loadOrders() {
    return window.VD.api.admin.listOrders().then(function (orders) {
      state.orders = orders;
      renderOrdersTable();
    }).catch(function (err) {
      var wrap = document.getElementById('orders-wrap');
      if (!wrap) return;
      wrap.innerHTML =
        '<p class="empty-note empty-note--error">Could not load orders: ' + esc(err.message) + '. ' +
        '<button type="button" class="button button--outline" data-retry-orders>Retry</button></p>';
    });
  }

  function findOrder(id) {
    for (var i = 0; i < state.orders.length; i++) {
      if (state.orders[i].id === id) return state.orders[i];
    }
    return null;
  }

  function orderItemCount(order) {
    return (order.items || []).reduce(function (sum, item) { return sum + (Number(item.quantity) || 0); }, 0);
  }

  function renderOrdersTable() {
    var wrap = document.getElementById('orders-wrap');
    if (!wrap) return;

    if (!state.orders.length) {
      wrap.innerHTML = '<p class="empty-note">No orders yet — orders placed at checkout will appear here.</p>';
      return;
    }

    wrap.innerHTML =
      '<div class="admin-table">' +
        '<table>' +
          '<thead><tr>' +
            '<th>Order</th><th>Placed</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th>' +
            '<th><span class="sr-only">Actions</span></th>' +
          '</tr></thead>' +
          '<tbody>' + state.orders.map(orderRowHTML).join('') + '</tbody>' +
        '</table>' +
      '</div>';
  }

  function orderRowHTML(order) {
    return (
      '<tr data-order-row="' + esc(order.id) + '">' +
        '<td><span class="admin-table__primary">' + esc(order.order_number) + '</span>' +
          (order.is_demo ? ' <span class="badge">Demo</span>' : '') + '</td>' +
        '<td>' + esc(formatDateTime(order.created_at)) + '</td>' +
        '<td><span class="admin-table__primary">' + esc(order.full_name) + '</span>' +
          '<span class="admin-table__sub">' + esc(order.city || '') + '</span></td>' +
        '<td>' + esc(String(orderItemCount(order))) + '</td>' +
        '<td>' + esc(money(order.total)) + '</td>' +
        '<td>' + orderStatusSelectHTML(order) + '</td>' +
        '<td><button type="button" class="table-action" data-action="view-order">View</button></td>' +
      '</tr>'
    );
  }

  function orderStatusSelectHTML(order) {
    return (
      '<select class="select" data-order-status data-order-id="' + esc(order.id) + '" data-prev="' + esc(order.status) + '" ' +
        'aria-label="Status for order ' + esc(order.order_number) + '">' +
        ORDER_STATUSES.map(function (status) {
          return '<option value="' + status + '"' + (order.status === status ? ' selected' : '') + '>' + status + '</option>';
        }).join('') +
      '</select>'
    );
  }

  function changeOrderStatus(select) {
    var orderId = select.getAttribute('data-order-id');
    var previous = select.getAttribute('data-prev') || select.value;
    var next = select.value;
    if (next === previous) return;

    var order = findOrder(orderId);
    select.disabled = true;
    window.VD.api.admin.updateOrderStatus(orderId, next).then(function () {
      select.setAttribute('data-prev', next);
      if (order) order.status = next;
      syncStatusSelects(orderId, next);   // keep list + drawer selects consistent
      toast('Order ' + (order ? order.order_number : '') + ' marked as ' + next + '.', 'success');
    }).catch(function (err) {
      select.value = previous;   // revert on failure
      toast(err.message, 'error');
    }).finally(function () {
      select.disabled = false;
    });
  }

  /* When the status changes in one place (list row or drawer), mirror it in
     every other select for the same order. */
  function syncStatusSelects(orderId, status) {
    document.querySelectorAll('select[data-order-status][data-order-id="' + orderId + '"]').forEach(function (other) {
      if (other.value !== status) {
        other.value = status;
        other.setAttribute('data-prev', status);
      }
    });
  }

  /* ---------- order drawer ---------- */

  function openOrderDrawer(order) {
    openModal({
      title: 'Order ' + order.order_number,
      wide: true,
      body: orderDrawerHTML(order)
    });
    // The drawer repeats the status select — wire it to the same handler.
    var select = modal.root.querySelector('select[data-order-status]');
    if (select) {
      select.addEventListener('change', function () { changeOrderStatus(select); });
    }
  }

  /* Resolve a method id ('standard', 'cash_on_delivery'…) to its human
     label from the store settings; fall back to the raw id. */
  function methodLabel(list, id) {
    if (!id) return '—';
    var found = (list || []).filter(function (entry) { return entry.id === id; })[0];
    return found ? found.label : id;
  }

  function orderDrawerHTML(order) {
    var settings = window.VD.settings || window.VOGUE_CONFIG;
    var shippingMethods = settings && settings.shipping ? settings.shipping.methods : [];
    var paymentMethods = settings ? settings.payment_methods : [];

    var metaRows =
      '<div><dt>Name</dt><dd>' + esc(order.full_name) + '</dd></div>' +
      '<div><dt>Email</dt><dd><a class="text-link" href="mailto:' + esc(order.email) + '">' + esc(order.email) + '</a></dd></div>' +
      (order.phone ? '<div><dt>Phone</dt><dd>' + esc(order.phone) + '</dd></div>' : '') +
      '<div><dt>Address</dt><dd>' + esc(order.address) +
        '<br>' + esc([order.postal_code, order.city].filter(Boolean).join(' ')) +
        '<br>' + esc(order.country) + '</dd></div>' +
      (order.notes ? '<div><dt>Notes</dt><dd>' + esc(order.notes) + '</dd></div>' : '') +
      '<div><dt>Shipping</dt><dd>' + esc(methodLabel(shippingMethods, order.shipping_method)) + '</dd></div>' +
      '<div><dt>Payment</dt><dd>' + esc(methodLabel(paymentMethods, order.payment_method)) + '</dd></div>' +
      (order.promo_code ? '<div><dt>Promo code</dt><dd>' + esc(order.promo_code) + '</dd></div>' : '') +
      '<div><dt>Placed</dt><dd>' + esc(formatDateTime(order.created_at)) + '</dd></div>';

    var itemRows = (order.items || []).map(function (item) {
      return (
        '<tr>' +
          '<td class="order-drawer__item-media">' +
            '<img src="' + esc(item.image_url || 'images/placeholder.svg') + '" alt="" width="48" height="48" loading="lazy" ' +
              'onerror="VD.utils.imgFallback(this)">' +
          '</td>' +
          '<td><span class="admin-table__primary">' + esc(item.product_name) + '</span></td>' +
          '<td>' + esc(item.variant_sku) + '</td>' +
          '<td>' + esc(item.size || '—') + '</td>' +
          '<td>' + esc(item.color || '—') + '</td>' +
          '<td>' + esc(money(item.unit_price)) + '</td>' +
          '<td>' + esc(String(item.quantity)) + '</td>' +
          '<td>' + esc(money(item.line_total)) + '</td>' +
        '</tr>'
      );
    }).join('');

    var shippingCost = Number(order.shipping_cost) || 0;
    var discount = Number(order.discount) || 0;

    return (
      '<div class="order-drawer">' +
        (order.is_demo ? '<p><span class="badge">Demo order</span> — created by the demo data tools.</p>' : '') +
        '<section class="order-drawer__section">' +
          '<h3 class="order-drawer__heading">Customer</h3>' +
          '<dl class="order-drawer__meta">' + metaRows + '</dl>' +
        '</section>' +
        '<section class="order-drawer__section">' +
          '<h3 class="order-drawer__heading">Items</h3>' +
          '<div class="admin-table order-drawer__items">' +
            '<table>' +
              '<thead><tr>' +
                '<th><span class="sr-only">Image</span></th><th>Product</th><th>SKU</th><th>Size</th><th>Colour</th>' +
                '<th>Unit</th><th>Qty</th><th>Total</th>' +
              '</tr></thead>' +
              '<tbody>' + itemRows + '</tbody>' +
            '</table>' +
          '</div>' +
          '<dl class="order-drawer__totals">' +
            '<div><dt>Subtotal</dt><dd>' + esc(money(order.subtotal)) + '</dd></div>' +
            '<div><dt>Shipping</dt><dd>' + (shippingCost === 0 ? 'Free' : esc(money(shippingCost))) + '</dd></div>' +
            (discount > 0 ? '<div class="order-drawer__discount"><dt>Discount</dt><dd>− ' + esc(money(discount)) + '</dd></div>' : '') +
            '<div class="order-drawer__grand"><dt>Total</dt><dd>' + esc(money(order.total)) + '</dd></div>' +
          '</dl>' +
        '</section>' +
        '<section class="order-drawer__section">' +
          '<h3 class="order-drawer__heading">Status</h3>' +
          orderStatusSelectHTML(order) +
        '</section>' +
      '</div>'
    );
  }

  /* ========================================================================
     VIEW — DEMO DATA TOOLS
     ======================================================================== */

  var DEMO_BLOCKS = [
    {
      id: 'load',
      title: 'Load demo data',
      description: 'Adds the 30 bundled demo products from demo-data.js. Idempotent — products whose slug already exists (demo or real) are skipped, never overwritten. Safe to run more than once.',
      button: 'Load demo data',
      confirm: null
    },
    {
      id: 'remove',
      title: 'Remove demo data',
      description: 'Removes ONLY the products flagged as demo and the orders flagged as demo (with their items). Your real products, orders and customers are never touched.',
      button: 'Remove demo data',
      confirm: {
        title: 'Remove demo data?',
        message:
          '<p>This permanently removes:</p>' +
          '<ul><li>all products flagged as demo (batch <code>vd-demo-2025-01</code>), including their variants and images;</li>' +
          '<li>all orders flagged as demo, including their items.</li></ul>' +
          '<p class="form-note form-note--info">Real products, orders and customers are <strong>not</strong> touched.</p>',
        confirmLabel: 'Remove demo data',
        danger: true
      }
    },
    {
      id: 'replace',
      title: 'Replace demo data',
      description: 'Removes the demo products and orders first, then loads the bundled catalog again — useful after editing demo products, when you want the pristine set back.',
      button: 'Replace demo data',
      confirm: {
        title: 'Replace demo data?',
        message:
          '<p>Existing demo products and demo orders are removed first, then the bundled catalog is loaded again.</p>' +
          '<p class="form-note form-note--info">Real products, orders and customers are <strong>not</strong> touched.</p>',
        confirmLabel: 'Replace demo data',
        danger: true
      }
    },
    {
      id: 'reset',
      title: 'Reset demo store',
      description: 'Removes demo data, resets Settings to the config.js defaults and loads the demo catalog again — the full “fresh install” for a client demo.',
      button: 'Reset demo store',
      confirm: {
        title: 'Reset the demo store?',
        message:
          '<p>Demo data is removed, Settings are reset to the <code>config.js</code> defaults, then the demo catalog is loaded again.</p>' +
          '<p class="form-note form-note--info">Real products, orders and customers are <strong>untouched</strong>.</p>',
        confirmLabel: 'Reset demo store',
        danger: true
      }
    }
  ];

  function showDemoTools() {
    var hasBundle = !!(window.VD_DEMO_DATA && window.VD_DEMO_DATA.products && window.VD_DEMO_DATA.products.length);

    viewEl().innerHTML =
      '<section class="admin-panel demo-tools" aria-labelledby="demo-title">' +
        '<div class="admin-panel__head">' +
          '<h2 id="demo-title" class="admin-panel__title">Demo data</h2>' +
          '<button type="button" id="demo-refresh" class="button button--outline">Refresh status</button>' +
        '</div>' +
        '<p id="demo-status" class="demo-tools__status">Checking demo data…</p>' +
        (hasBundle
          ? ''
          : '<p class="form-note form-note--error">Bundled demo data (<code>demo-data.js</code>) is not loaded — the demo tools are unavailable.</p>') +
        '<div class="demo-tools__grid">' +
          DEMO_BLOCKS.map(function (block) {
            return (
              '<div class="demo-tools__block">' +
                '<h3>' + esc(block.title) + '</h3>' +
                '<p>' + esc(block.description) + '</p>' +
                '<button type="button" class="button button--outline" data-demo-op="' + block.id + '"' +
                  (hasBundle ? '' : ' disabled') + '>' + esc(block.button) + '</button>' +
                '<div class="demo-report" id="demo-report-' + block.id + '" aria-live="polite"></div>' +
              '</div>'
            );
          }).join('') +
        '</div>' +
      '</section>';

    document.getElementById('demo-refresh').addEventListener('click', refreshDemoStatus);
    document.querySelectorAll('[data-demo-op]').forEach(function (button) {
      button.addEventListener('click', function () { requestDemoOp(button.getAttribute('data-demo-op')); });
    });

    refreshDemoStatus();
  }

  function refreshDemoStatus() {
    var slot = document.getElementById('demo-status');
    if (!slot) return;
    slot.textContent = 'Checking demo data…';
    window.VD.api.admin.demoStatus().then(function (status) {
      slot.textContent = 'Demo products in database: ' + status.count + ' (batch ' + status.batchId + ')';
    }).catch(function (err) {
      slot.textContent = 'Could not check demo status: ' + err.message;
    });
  }

  function requestDemoOp(opId) {
    var block = DEMO_BLOCKS.filter(function (b) { return b.id === opId; })[0];
    if (!block) return;

    if (block.confirm) {
      confirmModal({
        title: block.confirm.title,
        message: block.confirm.message,
        confirmLabel: block.confirm.confirmLabel,
        cancelLabel: 'Cancel',
        danger: block.confirm.danger,
        onConfirm: function () { runDemoOp(opId); }
      });
    } else {
      runDemoOp(opId);
    }
  }

  function runDemoOp(opId) {
    var api = { load: 'loadDemoData', remove: 'removeDemoData', replace: 'replaceDemoData', reset: 'resetDemoStore' };
    var methodName = api[opId];
    if (!methodName) return;

    var report = document.getElementById('demo-report-' + opId);
    if (report) report.innerHTML = '<p class="demo-report__line">Working…</p>';

    // All four buttons are disabled during ANY run — racing a remove against
    // a load would produce confusing reports.
    setDemoButtonsDisabled(true);

    window.VD.api.admin[methodName]().then(function (result) {
      reportDemoResult(opId, result);
      toast(demoToastMessage(opId, result), 'success');
    }).catch(function (err) {
      if (report) {
        report.innerHTML = '<p class="demo-report__line demo-report__line--error">Failed: ' + esc(err.message) + '</p>';
      }
      toast('Demo data: ' + err.message, 'error');
    }).finally(function () {
      setDemoButtonsDisabled(false);
      refreshDemoStatus();
    });
  }

  function setDemoButtonsDisabled(disabled) {
    document.querySelectorAll('[data-demo-op]').forEach(function (button) {
      button.disabled = disabled;
    });
  }

  function reportDemoResult(opId, result) {
    var report = document.getElementById('demo-report-' + opId);
    if (!report) return;
    var lines = [];

    if (opId === 'remove') {
      lines.push('Removed ' + result.productsRemoved + ' demo products and ' + result.ordersRemoved + ' demo orders.');
    } else {
      // load / replace / reset all resolve with the load report
      if (opId !== 'load') lines.push('Existing demo data removed first.');
      lines.push('Added: ' + result.added + ' · Skipped: ' + result.skipped + ' · Failed: ' + result.failed);
      (result.errors || []).forEach(function (message) {
        lines.push('Error: ' + message);
      });
    }

    report.innerHTML = lines.map(function (line) {
      return '<p class="demo-report__line">' + esc(line) + '</p>';
    }).join('');
  }

  function demoToastMessage(opId, result) {
    if (opId === 'remove') return 'Demo data removed.';
    if (opId === 'replace') return 'Demo data replaced — ' + result.added + ' products loaded.';
    if (opId === 'reset') return 'Demo store reset — ' + result.added + ' products loaded.';
    return 'Demo data loaded — ' + result.added + ' added, ' + result.skipped + ' skipped.';
  }

  /* ========================================================================
     VIEW — SETTINGS
     ======================================================================== */

  function showSettings() {
    viewEl().innerHTML =
      '<section class="admin-panel" aria-labelledby="settings-title">' +
        '<div class="admin-panel__head">' +
          '<h2 id="settings-title" class="admin-panel__title">Settings</h2>' +
        '</div>' +
        '<p class="form-note form-note--info">These settings are stored in your Supabase <code>store_settings</code> row and override ' +
          '<code>config.js</code> defaults. In local demo mode editing is unavailable.</p>' +
        '<form id="settings-form" novalidate>' +
          '<div id="settings-body"><p class="empty-note">Loading settings…</p></div>' +
          '<div class="editor-actions">' +
            '<button type="submit" id="settings-save" class="button button--dark">Save settings</button>' +
          '</div>' +
          '<p class="form-note">Settings apply after a page reload.</p>' +
        '</form>' +
      '</section>';

    document.getElementById('settings-form').addEventListener('submit', function (event) {
      event.preventDefault();
      saveSettings();
    });

    /* Local demo mode can technically reach this view if config flips at
       runtime — editing is disabled there by contract. */
    if (window.VD.api.DEMO_MODE) {
      document.getElementById('settings-save').disabled = true;
    }

    loadSettingsForm();
  }

  function loadSettingsForm() {
    window.VD.api.getSettings().then(function (settings) {
      state.settingsDraft = JSON.parse(JSON.stringify(settings));   // deep copy — the draft is ours to mutate
      renderSettingsBody();
    }).catch(function (err) {
      var body = document.getElementById('settings-body');
      if (body) body.innerHTML = '<p class="empty-note empty-note--error">Could not load settings: ' + esc(err.message) + '</p>';
    });
  }

  function renderSettingsBody() {
    var d = state.settingsDraft;
    var body = document.getElementById('settings-body');
    if (!body || !d) return;

    var disabled = window.VD.api.DEMO_MODE;   // normally unreachable (setup screen shows instead)

    body.innerHTML =
      '<fieldset id="settings-fields" class="settings-form"' + (disabled ? ' disabled' : '') + '>' +
        settingsSectionHTML('Announcement bar',
          '<label class="checkbox-row"><input type="checkbox" id="set-announce-enabled"' + (d.announcement && d.announcement.enabled ? ' checked' : '') + '> <span>Show the announcement bar</span></label>' +
          '<div class="field">' +
            '<label class="field__label" for="set-announce-text">Announcement text</label>' +
            '<input class="input" type="text" id="set-announce-text" value="' + esc(d.announcement ? d.announcement.text : '') + '">' +
          '</div>') +

        settingsSectionHTML('Currency',
          '<div class="field">' +
            '<label class="field__label" for="set-currency-code">Currency code (ISO 4217)</label>' +
            '<input class="input" type="text" id="set-currency-code" maxlength="3" value="' + esc(d.currency ? d.currency.code : 'USD') + '">' +
          '</div>' +
          '<div class="field">' +
            '<label class="field__label" for="set-currency-locale">Number locale (BCP 47)</label>' +
            '<input class="input" type="text" id="set-currency-locale" value="' + esc(d.currency ? d.currency.locale : 'en-US') + '">' +
          '</div>') +

        settingsSectionHTML('Shipping',
          '<div class="field">' +
            '<label class="field__label" for="set-ship-threshold">Free-shipping threshold (0 disables the offer)</label>' +
            '<input class="input" type="number" id="set-ship-threshold" min="0" step="0.01" value="' + esc(String(d.shipping ? d.shipping.free_threshold : '')) + '">' +
          '</div>' +
          '<h4 class="settings-rows__title">Delivery methods</h4>' +
          '<div id="ship-rows">' + shipMethodRowsHTML(d) + '</div>' +
          '<button type="button" class="button button--outline" data-add="ship">+ Add shipping method</button>') +

        settingsSectionHTML('Payment methods',
          '<p class="form-note">No card data is collected — offer offline or redirect-based methods your client actually uses.</p>' +
          '<div id="pay-rows">' + paymentRowsHTML(d) + '</div>' +
          '<button type="button" class="button button--outline" data-add="pay">+ Add payment method</button>') +

        settingsSectionHTML('Promo codes',
          '<div id="promo-rows">' + promoRowsHTML(d) + '</div>' +
          '<button type="button" class="button button--outline" data-add="promo">+ Add promo code</button>') +

        settingsSectionHTML('Contact',
          '<div class="field">' +
            '<label class="field__label" for="set-contact-email">Email</label>' +
            '<input class="input" type="text" id="set-contact-email" value="' + esc(d.contact ? d.contact.email : '') + '">' +
          '</div>' +
          '<div class="field">' +
            '<label class="field__label" for="set-contact-phone">Phone</label>' +
            '<input class="input" type="text" id="set-contact-phone" value="' + esc(d.contact ? d.contact.phone : '') + '">' +
          '</div>' +
          '<div class="field">' +
            '<label class="field__label" for="set-contact-address">Address</label>' +
            '<input class="input" type="text" id="set-contact-address" value="' + esc(d.contact ? d.contact.address : '') + '">' +
          '</div>' +
          '<div class="field">' +
            '<label class="field__label" for="set-contact-whatsapp">WhatsApp number (international format, optional)</label>' +
            '<input class="input" type="text" id="set-contact-whatsapp" value="' + esc(d.contact ? d.contact.whatsapp : '') + '">' +
          '</div>') +

        settingsSectionHTML('Social links',
          ['instagram', 'facebook', 'pinterest', 'tiktok', 'youtube'].map(function (network) {
            return '<div class="field">' +
              '<label class="field__label" for="set-social-' + network + '">' + network.charAt(0).toUpperCase() + network.slice(1) + '</label>' +
              '<input class="input" type="text" id="set-social-' + network + '" value="' + esc(d.social ? d.social[network] : '') + '">' +
            '</div>';
          }).join('')) +
      '</fieldset>';

    bindSettingsRows();
  }

  function settingsSectionHTML(title, innerHTML) {
    return (
      '<section class="settings-section">' +
        '<h3 class="settings-section__title">' + esc(title) + '</h3>' +
        innerHTML +
      '</section>'
    );
  }

  function shipMethodRowsHTML(d) {
    var methods = (d.shipping && d.shipping.methods) || [];
    if (!methods.length) return '<p class="empty-note">No shipping methods yet.</p>';
    return methods.map(function (method, index) {
      return (
        '<div class="settings-row" data-ship-row data-id="' + esc(method.id || '') + '">' +
          '<input type="hidden" class="js-ship-id" value="' + esc(method.id || '') + '">' +
          '<label class="field"><span class="field__label">Label</span>' +
            '<input class="input js-ship-label" type="text" value="' + esc(method.label || '') + '"></label>' +
          '<label class="field"><span class="field__label">Cost</span>' +
            '<input class="input js-ship-cost" type="number" min="0" step="0.01" value="' + esc(String(method.cost != null ? method.cost : '')) + '"></label>' +
          '<label class="field"><span class="field__label">Delivery time</span>' +
            '<input class="input js-ship-eta" type="text" value="' + esc(method.eta || '') + '"></label>' +
          '<button type="button" class="table-action table-action--danger" data-remove="ship" data-index="' + index + '">Remove</button>' +
        '</div>'
      );
    }).join('');
  }

  function paymentRowsHTML(d) {
    var methods = d.payment_methods || [];
    if (!methods.length) return '<p class="empty-note">No payment methods yet.</p>';
    return methods.map(function (method, index) {
      return (
        '<div class="settings-row" data-pay-row data-id="' + esc(method.id || '') + '">' +
          '<input type="hidden" class="js-pay-id" value="' + esc(method.id || '') + '">' +
          '<label class="field"><span class="field__label">Label</span>' +
            '<input class="input js-pay-label" type="text" value="' + esc(method.label || '') + '"></label>' +
          '<label class="field"><span class="field__label">Note shown at checkout</span>' +
            '<input class="input js-pay-note" type="text" value="' + esc(method.note || '') + '"></label>' +
          '<button type="button" class="table-action table-action--danger" data-remove="pay" data-index="' + index + '">Remove</button>' +
        '</div>'
      );
    }).join('');
  }

  function promoRowsHTML(d) {
    var codes = d.promo_codes || [];
    if (!codes.length) return '<p class="empty-note">No promo codes yet.</p>';
    return codes.map(function (promo, index) {
      var type = ['percent', 'fixed', 'free_shipping'].indexOf(promo.type) !== -1 ? promo.type : 'percent';
      return (
        '<div class="settings-row" data-promo-row>' +
          '<label class="field"><span class="field__label">Code</span>' +
            '<input class="input js-promo-code" type="text" value="' + esc(promo.code || '') + '"></label>' +
          '<label class="field"><span class="field__label">Type</span>' +
            '<select class="select js-promo-type">' +
              '<option value="percent"' + (type === 'percent' ? ' selected' : '') + '>percent</option>' +
              '<option value="fixed"' + (type === 'fixed' ? ' selected' : '') + '>fixed</option>' +
              '<option value="free_shipping"' + (type === 'free_shipping' ? ' selected' : '') + '>free_shipping</option>' +
            '</select></label>' +
          '<label class="field"><span class="field__label">Value</span>' +
            '<input class="input js-promo-value" type="number" min="0" step="0.01" value="' + esc(String(promo.value != null ? promo.value : '')) + '"></label>' +
          '<label class="field"><span class="field__label">Min. subtotal</span>' +
            '<input class="input js-promo-min" type="number" min="0" step="0.01" value="' + esc(String(promo.min_subtotal != null ? promo.min_subtotal : '')) + '"></label>' +
          '<button type="button" class="table-action table-action--danger" data-remove="promo" data-index="' + index + '">Remove</button>' +
        '</div>'
      );
    }).join('');
  }

  /* Add / remove row buttons re-render their section. The DOM is folded
     back into the draft first, so nothing the admin typed is lost. */
  function bindSettingsRows() {
    var form = document.getElementById('settings-form');
    if (!form) return;

    form.addEventListener('click', function (event) {
      var add = event.target.closest('[data-add]');
      if (add) {
        collectSettingsFromDOM();
        var kind = add.getAttribute('data-add');
        if (kind === 'ship') state.settingsDraft.shipping.methods.push({ id: '', label: '', cost: '', eta: '' });
        else if (kind === 'pay') state.settingsDraft.payment_methods.push({ id: '', label: '', note: '' });
        else if (kind === 'promo') state.settingsDraft.promo_codes.push({ code: '', type: 'percent', value: '', min_subtotal: 0 });
        renderSettingsBody();
        return;
      }
      var remove = event.target.closest('[data-remove]');
      if (remove) {
        collectSettingsFromDOM();
        var index = Number(remove.getAttribute('data-index'));
        var list = remove.getAttribute('data-remove');
        if (list === 'ship') state.settingsDraft.shipping.methods.splice(index, 1);
        else if (list === 'pay') state.settingsDraft.payment_methods.splice(index, 1);
        else if (list === 'promo') state.settingsDraft.promo_codes.splice(index, 1);
        renderSettingsBody();
      }
    });
  }

  function input_value(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }
  function input_checked(id) {
    var el = document.getElementById(id);
    return el ? el.checked : false;
  }
  function row_value(scope, selector) {
    var el = scope.querySelector(selector);
    return el ? el.value : '';
  }

  /* Fold every form control back into state.settingsDraft. */
  function collectSettingsFromDOM() {
    var d = state.settingsDraft;
    if (!d || !document.getElementById('settings-body')) return;

    d.announcement = { enabled: input_checked('set-announce-enabled'), text: input_value('set-announce-text') };
    d.currency = { code: input_value('set-currency-code'), locale: input_value('set-currency-locale') };
    d.shipping = d.shipping || {};
    d.shipping.free_threshold = input_value('set-ship-threshold');
    d.shipping.methods = Array.prototype.map.call(
      document.querySelectorAll('[data-ship-row]'),
      function (row) {
        return {
          id: row_value(row, '.js-ship-id'),
          label: row_value(row, '.js-ship-label'),
          cost: row_value(row, '.js-ship-cost'),
          eta: row_value(row, '.js-ship-eta')
        };
      }
    );
    d.payment_methods = Array.prototype.map.call(
      document.querySelectorAll('[data-pay-row]'),
      function (row) {
        return {
          id: row_value(row, '.js-pay-id'),
          label: row_value(row, '.js-pay-label'),
          note: row_value(row, '.js-pay-note')
        };
      }
    );
    d.promo_codes = Array.prototype.map.call(
      document.querySelectorAll('[data-promo-row]'),
      function (row) {
        return {
          code: row_value(row, '.js-promo-code'),
          type: row_value(row, '.js-promo-type'),
          value: row_value(row, '.js-promo-value'),
          min_subtotal: row_value(row, '.js-promo-min')
        };
      }
    );
    d.contact = {
      email: input_value('set-contact-email'),
      phone: input_value('set-contact-phone'),
      address: input_value('set-contact-address'),
      whatsapp: input_value('set-contact-whatsapp')
    };
    d.social = {
      instagram: input_value('set-social-instagram'),
      facebook: input_value('set-social-facebook'),
      pinterest: input_value('set-social-pinterest'),
      tiktok: input_value('set-social-tiktok'),
      youtube: input_value('set-social-youtube')
    };
  }

  function nonNegMoney(value) {
    var n = Number(value);
    if (!isFinite(n) || n < 0) return 0;
    return Math.round(n * 100) / 100;
  }

  function textOr(value, fallback) {
    var t = String(value == null ? '' : value).trim();
    return t || fallback;
  }

  /* Build the object sent to saveSettings. brand is passed through untouched
     (the admin form does not manage it) so nothing is lost on save. */
  function cleanSettings(d) {
    var methods = ((d.shipping && d.shipping.methods) || [])
      .filter(function (m) { return String(m.label || '').trim(); })
      .map(function (m, index) {
        return {
          id: String(m.id || '').trim() || slugify(m.label) || ('method-' + (index + 1)),
          label: String(m.label).trim(),
          cost: nonNegMoney(m.cost),
          eta: String(m.eta || '').trim()
        };
      });
    var payments = (d.payment_methods || [])
      .filter(function (p) { return String(p.label || '').trim(); })
      .map(function (p, index) {
        return {
          id: String(p.id || '').trim() || slugify(p.label) || ('payment-' + (index + 1)),
          label: String(p.label).trim(),
          note: String(p.note || '').trim()
        };
      });
    var promos = (d.promo_codes || [])
      .filter(function (p) { return String(p.code || '').trim(); })
      .map(function (p) {
        var type = ['percent', 'fixed', 'free_shipping'].indexOf(p.type) !== -1 ? p.type : 'percent';
        return {
          code: String(p.code).trim().toUpperCase(),
          type: type,
          value: nonNegMoney(p.value),
          min_subtotal: nonNegMoney(p.min_subtotal)
        };
      });

    return {
      brand: d.brand || window.VOGUE_CONFIG.brand,
      announcement: {
        enabled: !!(d.announcement && d.announcement.enabled),
        text: String(d.announcement && d.announcement.text ? d.announcement.text : '').trim()
      },
      currency: {
        code: textOr(d.currency && d.currency.code, 'USD').toUpperCase().slice(0, 3),
        locale: textOr(d.currency && d.currency.locale, 'en-US')
      },
      shipping: {
        free_threshold: nonNegMoney(d.shipping && d.shipping.free_threshold),
        methods: methods
      },
      payment_methods: payments,
      promo_codes: promos,
      contact: {
        email: String(d.contact && d.contact.email ? d.contact.email : '').trim(),
        phone: String(d.contact && d.contact.phone ? d.contact.phone : '').trim(),
        address: String(d.contact && d.contact.address ? d.contact.address : '').trim(),
        whatsapp: String(d.contact && d.contact.whatsapp ? d.contact.whatsapp : '').trim()
      },
      social: {
        instagram: String(d.social && d.social.instagram ? d.social.instagram : '').trim(),
        facebook: String(d.social && d.social.facebook ? d.social.facebook : '').trim(),
        pinterest: String(d.social && d.social.pinterest ? d.social.pinterest : '').trim(),
        tiktok: String(d.social && d.social.tiktok ? d.social.tiktok : '').trim(),
        youtube: String(d.social && d.social.youtube ? d.social.youtube : '').trim()
      }
    };
  }

  function saveSettings() {
    if (!state.settingsDraft) return;
    collectSettingsFromDOM();
    var cleaned = cleanSettings(state.settingsDraft);

    var button = document.getElementById('settings-save');
    button.disabled = true;
    button.textContent = 'Saving…';

    window.VD.api.admin.saveSettings(cleaned).then(function () {
      toast('Settings saved.', 'success');
    }).catch(function (err) {
      toast(err.message, 'error');
    }).finally(function () {
      button.disabled = false;
      button.textContent = 'Save settings';
    });
  }

  /* ========================================================================
     SMALL SHARED HELPERS
     ======================================================================== */

  function formatDate(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function formatDateTime(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return '—';
    return formatDate(iso) + ', ' +
      date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

})();
