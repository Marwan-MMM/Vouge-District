/* ==========================================================================
   VOGUE DISTRICT — WISHLIST (wishlist.js)
   --------------------------------------------------------------------------
   Anonymous wishlist persisted in localStorage (no account required).

   Stored shape — deliberately minimal so prices stay fresh:
     { product_id, slug, added_at }
   Product details are re-fetched from the data layer whenever the wishlist
   page is viewed, so renames/prices from the admin panel always show up.

   Delegated behaviour: any button with [data-wishlist-slug] toggles that
   product using the card registry from products.js.
   ========================================================================== */

(function () {
  'use strict';

  window.VD = window.VD || {};

  var STORAGE_KEY = 'vd_wishlist_v1';
  var listeners = [];

  function load() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function save(items) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (err) {
      /* Storage unavailable — wishlist works for this page view only. */
    }
  }

  var wishlist = {
    items: load(),
    STORAGE_KEY: STORAGE_KEY,

    onChange: function (callback) { listeners.push(callback); },

    _notify: function () {
      this.refreshBadges();
      this.syncButtons();
      listeners.forEach(function (cb) {
        try { cb(wishlist.items); } catch (err) { /* keep going */ }
      });
    },

    has: function (slug) {
      return this.items.some(function (item) { return item.slug === slug; });
    },

    add: function (product, options) {
      if (this.has(product.slug)) return false;
      this.items.push({
        product_id: product.id,
        slug: product.slug,
        added_at: new Date().toISOString()
      });
      save(this.items);
      this._notify();
      if (!options || !options.silent) {
        window.VD.utils.toast('Saved to your wishlist — ' + product.name, 'success');
      }
      return true;
    },

    remove: function (slug, options) {
      var before = this.items.length;
      this.items = this.items.filter(function (item) { return item.slug !== slug; });
      var removed = before !== this.items.length;
      save(this.items);
      this._notify();
      if (removed && (!options || !options.silent)) {
        window.VD.utils.toast('Removed from your wishlist.', 'info');
      }
      return removed;
    },

    /* Add if missing, remove if present. Returns true when now in wishlist. */
    toggle: function (product) {
      if (this.has(product.slug)) {
        this.remove(product.slug);
        return false;
      }
      this.add(product);
      return true;
    },

    count: function () {
      return this.items.length;
    },

    /* Update header badge + pressed state of every wishlist button. */
    refreshBadges: function () {
      var count = this.count();
      document.querySelectorAll('[data-wishlist-count]').forEach(function (el) {
        el.textContent = String(count);
        el.classList.toggle('is-visible', count > 0);
      });
    },

    syncButtons: function () {
      var items = this.items;
      document.querySelectorAll('[data-wishlist-slug]').forEach(function (btn) {
        var slug = btn.getAttribute('data-wishlist-slug');
        var active = items.some(function (item) { return item.slug === slug; });
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    },

    /* Hydrate full product objects for the stored slugs, keeping the order
       in which items were wishlisted (newest first, like most stores). */
    hydrate: function () {
      var slugs = this.items.map(function (item) { return item.slug; }).reverse();
      return window.VD.api.getProductsBySlugs(slugs).then(function (products) {
        var bySlug = {};
        products.forEach(function (p) { bySlug[p.slug] = p; });
        return slugs.map(function (slug) { return bySlug[slug]; }).filter(Boolean);
      });
    }
  };

  /* Delegated clicks for every wishlist button on any page. */
  document.addEventListener('click', function (event) {
    var button = event.target.closest ? event.target.closest('[data-wishlist-slug]') : null;
    if (!button) return;
    event.preventDefault();
    var slug = button.getAttribute('data-wishlist-slug');
    var product = window.VD.products.registry[slug];
    if (!product) {
      window.VD.utils.toast('Sorry — this item could not be found.', 'error');
      return;
    }
    window.VD.wishlist.toggle(product);
  });

  window.VD.wishlist = wishlist;

  /* ========================================================================
     WISHLIST PAGE (only runs on wishlist.html, which contains #wishlist-page)
     ======================================================================== */
  window.VD.page = window.VD.page || {};

  /* Assign the page controller only when this really is the wishlist page, so
     the shared script order never matters (see cart.js). */
  if (document.getElementById('wishlist-page')) {
  window.VD.page.init = function () {
    var grid = document.getElementById('wishlist-grid');
    var countEl = document.getElementById('wishlist-count-line');
    var clearBtn = document.getElementById('wishlist-clear');
    var emptyEl = document.getElementById('wishlist-empty');
    var layoutEl = document.getElementById('wishlist-content');

    function render(products) {
      if (!products.length) {
        layoutEl.hidden = true;
        emptyEl.hidden = false;
        return;
      }
      emptyEl.hidden = true;
      layoutEl.hidden = false;
      countEl.textContent = products.length === 1
        ? '1 saved item'
        : products.length + ' saved items';
      window.VD.products.renderCards(grid, products);
      window.VD.wishlist.syncButtons();
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        window.VD.wishlist.items.slice().forEach(function (item) {
          window.VD.wishlist.remove(item.slug, { silent: true });
        });
        window.VD.wishlist._notify();
        window.VD.utils.toast('Wishlist cleared.', 'info');
      });
    }

    /* Re-render when items change (e.g. hearts un-toggled inside the grid). */
    wishlist.onChange(function () {
      wishlist.hydrate().then(render).catch(function (err) {
        grid.innerHTML = '<p class="empty-note empty-note--error">Could not load your wishlist: ' +
          window.VD.utils.esc(err.message) + '</p>';
      });
    });

    grid.innerHTML = window.VD.products.skeletonHTML(4);
    wishlist.hydrate().then(render).catch(function (err) {
      grid.innerHTML = '<p class="empty-note empty-note--error">Could not load your wishlist: ' +
        window.VD.utils.esc(err.message) + '</p>';
    });
  };
  }   // end wishlist-page controller guard
})();
