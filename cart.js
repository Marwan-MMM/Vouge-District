/* ==========================================================================
   VOGUE DISTRICT — SHOPPING CART (cart.js)
   --------------------------------------------------------------------------
   Anonymous cart persisted in localStorage (no account required).

   Cart item shape:
     { product_id, variant_id, slug, name, sku, size, color, image,
       unit_price, quantity, max_stock }

   `unit_price` is a display snapshot captured when the item is added — the
   authoritative price/stock check happens inside the Supabase `place_order`
   function when an order is submitted, so stale carts can never produce a
   wrong total.

   NOTE FOR STORE OWNERS: carts are per-browser. When Supabase is connected
   they persist on the same device across visits; they are intentionally NOT
   synced to the database for anonymous visitors (privacy + simplicity).
   ========================================================================== */

(function () {
  'use strict';

  window.VD = window.VD || {};

  var STORAGE_KEY = 'vd_cart_v1';
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
      /* Storage unavailable (private mode) — cart works for this page view only. */
    }
  }

  var cart = {
    items: load(),
    STORAGE_KEY: STORAGE_KEY,

    /* Subscribe to cart changes (badges, cart page re-render). */
    onChange: function (callback) { listeners.push(callback); },

    _notify: function () {
      this.refreshBadges();
      listeners.forEach(function (cb) {
        try { cb(cart.items); } catch (err) { /* keep other listeners alive */ }
      });
    },

    /* Add a variant. Respects the variant's stock level. */
    add: function (item, options) {
      options = options || {};
      var existing = null;
      for (var i = 0; i < this.items.length; i++) {
        if (this.items[i].variant_id === item.variant_id) { existing = this.items[i]; break; }
      }
      var maxStock = item.max_stock == null ? 99 : item.max_stock;

      if (existing) {
        var newQty = Math.min(existing.quantity + (item.quantity || 1), maxStock);
        if (newQty === existing.quantity) {
          window.VD.utils.toast('That is all we have in stock right now.', 'info');
          return false;
        }
        existing.quantity = newQty;
      } else {
        this.items.push({
          product_id: item.product_id,
          variant_id: item.variant_id,
          slug: item.slug,
          name: item.name,
          sku: item.sku,
          size: item.size,
          color: item.color,
          image: item.image,
          unit_price: item.unit_price,
          quantity: Math.min(item.quantity || 1, maxStock),
          max_stock: maxStock
        });
      }
      save(this.items);
      this._notify();
      if (!options.silent) window.VD.utils.toast('Added to your cart — ' + item.name, 'success');
      return true;
    },

    remove: function (variantId) {
      this.items = this.items.filter(function (item) { return item.variant_id !== variantId; });
      save(this.items);
      this._notify();
    },

    setQty: function (variantId, qty) {
      var item = null;
      for (var i = 0; i < this.items.length; i++) {
        if (this.items[i].variant_id === variantId) { item = this.items[i]; break; }
      }
      if (!item) return;
      var clamped = Math.max(1, Math.min(Number(qty) || 1, item.max_stock == null ? 99 : item.max_stock));
      if (clamped !== Number(qty)) {
        window.VD.utils.toast('Only ' + item.max_stock + ' left in stock for that size.', 'info');
      }
      item.quantity = clamped;
      save(this.items);
      this._notify();
    },

    clear: function () {
      this.items = [];
      save(this.items);
      this._notify();
    },

    count: function () {
      return this.items.reduce(function (sum, item) { return sum + item.quantity; }, 0);
    },

    subtotal: function () {
      return this.items.reduce(function (sum, item) { return sum + item.unit_price * item.quantity; }, 0);
    },

    /* Re-check each cart line against the live catalog: refresh stock caps,
       flag lines whose product/variant disappeared or sold out. Cheap enough
       to run on cart/checkout page load. */
    validateAgainstCatalog: function () {
      var items = this.items;
      if (!items.length) return Promise.resolve({ ok: true, removed: 0 });
      var slugs = {};
      items.forEach(function (item) { slugs[item.slug] = true; });
      return window.VD.api.getProductsBySlugs(Object.keys(slugs)).then(function (products) {
        var bySlug = {};
        products.forEach(function (p) { bySlug[p.slug] = p; });
        var removed = 0;
        var next = [];
        items.forEach(function (item) {
          var product = bySlug[item.slug];
          if (!product || !product.is_published) { removed++; return; }          // product gone → drop line
          var variant = null;
          for (var i = 0; i < product.variants.length; i++) {
            if (String(product.variants[i].id) === String(item.variant_id)) { variant = product.variants[i]; break; }
          }
          if (!variant || variant.stock <= 0) { removed++; return; }             // variant gone / sold out
          item.max_stock = variant.stock;
          item.unit_price = product.price;                                        // refresh display price
          if (item.quantity > variant.stock) item.quantity = variant.stock;
          next.push(item);
        });
        cart.items = next;
        save(next);
        cart._notify();
        return { ok: true, removed: removed };
      });
    },

    /* Update the little number bubble on the header cart icon. */
    refreshBadges: function () {
      var count = this.count();
      document.querySelectorAll('[data-cart-count]').forEach(function (el) {
        el.textContent = String(count);
        el.classList.toggle('is-visible', count > 0);
      });
      var sr = document.querySelector('[data-cart-count-sr]');
      if (sr) sr.textContent = count + ' items in cart';
    }
  };

  /* ========================================================================
     PROMO CODES
     Client-side pre-check against the configured codes (config.js or
     store_settings). The Supabase place_order function re-validates the code
     authoritatively when the order is submitted, so manipulated browser
     state can never change the real total.
     ======================================================================== */
  var PROMO_KEY = 'vd_promo_v1';

  cart.promo = {
    get: function () {
      try {
        var raw = window.sessionStorage.getItem(PROMO_KEY);
        var parsed = raw ? JSON.parse(raw) : null;
        return parsed && parsed.code ? parsed : null;
      } catch (err) { return null; }
    },

    /* Validate + remember a code. Returns {ok, message, promo?}. */
    apply: function (code, subtotal) {
      var settings = window.VD.settings || {};
      var codes = settings.promo_codes || [];
      var clean = String(code || '').trim().toLowerCase();
      var match = null;
      for (var i = 0; i < codes.length; i++) {
        if (String(codes[i].code).toLowerCase() === clean) { match = codes[i]; break; }
      }
      if (!match) return { ok: false, message: 'That code is not valid.' };
      var min = Number(match.min_subtotal) || 0;
      if (subtotal < min) {
        return { ok: false, message: 'This code applies from ' + window.VD.utils.formatPrice(min) + '.' };
      }
      var stored = { code: match.code, type: match.type, value: Number(match.value) || 0 };
      try { window.sessionStorage.setItem(PROMO_KEY, JSON.stringify(stored)); } catch (err) { /* ignore */ }
      return { ok: true, promo: stored, message: 'Code ' + stored.code + ' applied.' };
    },

    clear: function () {
      try { window.sessionStorage.removeItem(PROMO_KEY); } catch (err) { /* ignore */ }
    },

    /* Money discount for percent/fixed types (free_shipping handled at checkout). */
    discount: function (promo, subtotal) {
      if (!promo) return 0;
      if (promo.type === 'percent') return Math.round(subtotal * promo.value) / 100;
      if (promo.type === 'fixed') return Math.min(promo.value, subtotal);
      return 0;
    },

    isFreeShipping: function (promo) { return !!promo && promo.type === 'free_shipping'; }
  };

  window.VD.cart = cart;

  /* ========================================================================
     CART PAGE (only runs on cart.html, which contains #cart-page)
     ======================================================================== */
  window.VD.page = window.VD.page || {};

  /* Assign the page controller only when this really is the cart page, so
     the shared script order never matters (see wishlist.js). */
  if (document.getElementById('cart-page')) {
  window.VD.page.init = function () {
    var linesEl = document.getElementById('cart-lines');
    var summaryEl = document.getElementById('cart-summary');
    var emptyEl = document.getElementById('cart-empty');
    var noticeEl = document.getElementById('cart-notice');
    var promoForm = document.getElementById('promo-form');
    var promoInput = document.getElementById('promo-input');
    var promoNote = document.getElementById('promo-note');

    function shippingEstimate(subtotal, promo) {
      var settings = window.VD.settings;
      var standard = settings.shipping.methods[0] || { cost: 0 };
      var threshold = Number(settings.shipping.free_threshold) || 0;
      if ((threshold > 0 && subtotal >= threshold) || cart.promo.isFreeShipping(promo)) return 0;
      return standard.cost;
    }

    function renderSummary() {
      var fmt = window.VD.utils.formatPrice;
      var promo = cart.promo.get();
      var subtotal = cart.subtotal();
      var discount = cart.promo.discount(promo, subtotal);
      var shipping = cart.items.length ? shippingEstimate(subtotal - discount, promo) : 0;
      var total = Math.max(subtotal - discount + shipping, 0);

      var rows = '';
      rows += '<div class="summary-row"><span>Subtotal</span><span>' + fmt(subtotal) + '</span></div>';
      if (discount > 0) {
        rows += '<div class="summary-row summary-discount"><span>Discount (' + window.VD.utils.esc(promo.code) + ')</span><span>−' + fmt(discount) + '</span></div>';
      }
      if (cart.promo.isFreeShipping(promo)) {
        rows += '<div class="summary-row summary-discount"><span>Shipping (' + window.VD.utils.esc(promo.code) + ')</span><span>Free</span></div>';
      } else {
        rows += '<div class="summary-row"><span>Shipping (standard)</span><span>' + (cart.items.length ? fmt(shipping) : '—') + '</span></div>';
      }
      var threshold = Number(window.VD.settings.shipping.free_threshold) || 0;
      var remaining = threshold - (subtotal - discount);
      if (threshold > 0 && remaining > 0 && cart.items.length) {
        rows += '<p class="summary-note">Add ' + fmt(remaining) + ' more for free standard shipping.</p>';
      }
      rows += '<div class="summary-row summary-row--total"><span>Total</span><span>' + fmt(total) + '</span></div>';
      summaryEl.innerHTML = rows;
    }

    function renderLines() {
      var fmt = window.VD.utils.formatPrice;
      var esc = window.VD.utils.esc;
      if (!cart.items.length) {
        linesEl.innerHTML = '';
        summaryEl.innerHTML = '';
        emptyEl.hidden = false;
        document.getElementById('cart-layout').hidden = true;
        return;
      }
      emptyEl.hidden = true;
      document.getElementById('cart-layout').hidden = false;
      linesEl.innerHTML = cart.items.map(function (item) {
        return (
          '<article class="cart-line" data-variant="' + esc(String(item.variant_id)) + '">' +
            '<a class="cart-line__media" href="product.html?slug=' + encodeURIComponent(item.slug) + '">' +
              // normalizeImageUrl: items added before the image-folder move keep working.
              '<img src="' + esc(window.VD.api.normalizeImageUrl(item.image)) + '" alt="' + esc(item.name) + '" loading="lazy" onerror="VD.utils.imgFallback(this)">' +
            '</a>' +
            '<div class="cart-line__info">' +
              '<h3 class="cart-line__name"><a href="product.html?slug=' + encodeURIComponent(item.slug) + '">' + esc(item.name) + '</a></h3>' +
              '<p class="cart-line__meta">Size ' + esc(item.size) + ' · ' + esc(item.color) + '<br>SKU ' + esc(item.sku) + '</p>' +
              '<div class="qty-stepper" aria-label="Quantity for ' + esc(item.name) + '">' +
                '<button type="button" data-cart-decrease aria-label="Decrease quantity">−</button>' +
                '<span data-cart-qty>' + item.quantity + '</span>' +
                '<button type="button" data-cart-increase aria-label="Increase quantity">+</button>' +
              '</div>' +
            '</div>' +
            '<p class="cart-line__total">' + fmt(item.unit_price * item.quantity) + '</p>' +
            '<button type="button" class="cart-line__remove" data-cart-remove aria-label="Remove ' + esc(item.name) + ' from cart">Remove</button>' +
          '</article>'
        );
      }).join('');
      renderSummary();
    }

    /* Line interactions (delegated). */
    linesEl.addEventListener('click', function (event) {
      var line = event.target.closest('.cart-line');
      if (!line) return;
      var variantId = line.getAttribute('data-variant');
      var item = null;
      cart.items.forEach(function (it) { if (String(it.variant_id) === variantId) item = it; });
      if (!item) return;
      if (event.target.closest('[data-cart-remove]')) {
        cart.remove(item.variant_id);
        return;
      }
      if (event.target.closest('[data-cart-increase]')) cart.setQty(item.variant_id, item.quantity + 1);
      if (event.target.closest('[data-cart-decrease]')) cart.setQty(item.variant_id, item.quantity - 1);
    });

    /* Promo code form. */
    if (promoForm) {
      promoForm.addEventListener('submit', function (event) {
        event.preventDefault();
        var result = cart.promo.apply(promoInput.value, cart.subtotal());
        if (result.ok) {
          promoNote.textContent = result.message;
          promoNote.className = 'form-note form-note--success';
          renderSummary();
        } else {
          promoNote.textContent = result.message;
          promoNote.className = 'form-note form-note--error';
        }
      });
      var clearBtn = document.getElementById('promo-clear');
      if (clearBtn) clearBtn.addEventListener('click', function () {
        cart.promo.clear();
        promoInput.value = '';
        promoNote.textContent = 'Promo code removed.';
        promoNote.className = 'form-note form-note--info';
        renderSummary();
      });
      var existing = cart.promo.get();
      if (existing) promoInput.value = existing.code;
    }

    /* Re-render whenever the cart changes. */
    cart.onChange(function () { renderLines(); });

    /* Validate against the live catalog first (stock/price refresh). */
    cart.validateAgainstCatalog().then(function (result) {
      if (result.removed > 0 && cart.items.length) {
        noticeEl.hidden = false;
        noticeEl.textContent = result.removed === 1
          ? 'One item in your cart is no longer available and was removed.'
          : result.removed + ' items in your cart are no longer available and were removed.';
      }
      renderLines();
      window.VD.wishlist.syncButtons();
    });
  };
  }   // end cart-page controller guard
})();
