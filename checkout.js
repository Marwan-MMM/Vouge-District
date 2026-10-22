/* ==========================================================================
   VOGUE DISTRICT — CHECKOUT PAGE (checkout.js)
   --------------------------------------------------------------------------
   Order form + live order summary. Included last on checkout.html, so its
   VD.page.init registration wins over the shared controllers (cart.js and
   wishlist.js both guard on their own #page ids and no-op here).

   Flow:
     1. Validate the cart against the live catalog (stock caps / prices).
     2. Render shipping + payment radio cards from the store settings and
        the order summary (items, subtotal, promo discount, shipping, total).
     3. On submit: client-side validation, then VD.api.submitOrder() — the
        Supabase place_order function re-validates prices, stock, the promo
        code and the shipping method, and returns the AUTHORITATIVE totals.
     4. result.ok   → cart cleared, confirmation panel with server totals.
        result.demo → honest "Supabase not configured" panel, form stays,
                      cart preserved (never fake a success).
        otherwise   → banner with the server message (e.g. INSUFFICIENT_STOCK),
                      toast, cart re-checked against the catalog.

   NOTE: this template never collects card details. The chosen payment method
   is for the customer's confirmation only — place_order does not take it.
   ========================================================================== */

(function () {
  'use strict';

  window.VD = window.VD || {};
  window.VD.page = window.VD.page || {};

  window.VD.page.init = function () {
    if (!document.getElementById('checkout-page')) return;   // not the checkout page

    var utils = window.VD.utils;
    var cart = window.VD.cart;
    var promo = cart.promo;
    var esc = utils.esc;
    var fmt = utils.formatPrice;

    /* ------------------------------------------------------------------
       Page elements (ids defined in checkout.html)
       ------------------------------------------------------------------ */
    var layoutEl    = document.getElementById('checkout-layout');
    var formEl      = document.getElementById('checkout-form');
    var bannerEl    = document.getElementById('form-error-banner');
    var shippingEl  = document.getElementById('shipping-options');
    var paymentEl   = document.getElementById('payment-options');
    var promoInputEl  = document.getElementById('checkout-promo-input');
    var promoApplyBtn = document.getElementById('checkout-promo-apply');
    var promoNoteEl   = document.getElementById('checkout-promo-note');
    var itemsEl       = document.getElementById('summary-items');
    var totalsEl      = document.getElementById('summary-totals');
    var placeBtn      = document.getElementById('place-order');
    var successEl     = document.getElementById('order-success');
    var demoErrorEl   = document.getElementById('checkout-demo-error');

    var fields = {
      full_name:   document.getElementById('checkout-name'),
      email:       document.getElementById('checkout-email'),
      phone:       document.getElementById('checkout-phone'),
      country:     document.getElementById('checkout-country'),
      city:        document.getElementById('checkout-city'),
      postal_code: document.getElementById('checkout-postal'),
      address:     document.getElementById('checkout-address'),
      notes:       document.getElementById('checkout-notes')
    };

    var selectedShippingId = null;   // radio value of the chosen method
    var submitting = false;          // double-submit guard
    var placeBtnLabel = 'Place order';

    /* ==================================================================
       SETTINGS HELPERS
       ================================================================== */
    function shippingMethods() {
      var s = window.VD.settings || {};
      return (s.shipping && s.shipping.methods) || [];
    }

    function freeThreshold() {
      var s = window.VD.settings || {};
      return (s.shipping && Number(s.shipping.free_threshold)) || 0;
    }

    /* The method object for the current radio selection (falls back to the
       first configured method — standard — until the customer changes it). */
    function selectedMethod() {
      var methods = shippingMethods();
      for (var i = 0; i < methods.length; i++) {
        if (String(methods[i].id) === String(selectedShippingId)) return methods[i];
      }
      return methods[0] || null;
    }

    /* Shipping cost for the current selection. Free when the promo code is
       a free_shipping code, or when the discounted subtotal reaches the
       configured free-shipping threshold. */
    function shippingCost(promoState, discountedSubtotal) {
      if (promo.isFreeShipping(promoState)) return 0;
      var threshold = freeThreshold();
      if (threshold > 0 && discountedSubtotal >= threshold) return 0;
      var method = selectedMethod();
      return method ? (Number(method.cost) || 0) : 0;
    }

    /* ==================================================================
       EMPTY CART — nothing to check out
       ================================================================== */
    function showEmptyCart() {
      layoutEl.hidden = false;
      layoutEl.innerHTML =
        '<div class="empty-note checkout-empty">' +
          '<p class="empty-note__copy">Your cart is empty — there is nothing to check out yet.</p>' +
          '<a class="button button--dark" href="shop.html">Discover the collection</a>' +
        '</div>';
    }

    /* ==================================================================
       RENDERING — shipping / payment radio cards + order summary
       ================================================================== */
    function syncRadioCards(container) {
      var cards = container.querySelectorAll('.radio-card');
      for (var i = 0; i < cards.length; i++) {
        var input = cards[i].querySelector('input[type="radio"]');
        cards[i].classList.toggle('is-active', !!(input && input.checked));
      }
    }

    function renderShippingOptions() {
      var methods = shippingMethods();
      if (!methods.length) {
        shippingEl.innerHTML = '<p class="form-note form-note--error">No delivery methods are configured — please add them in config.js.</p>';
        return;
      }
      // Standard delivery is pre-selected when present, otherwise the first.
      var defaultId = String(methods[0].id);
      for (var i = 0; i < methods.length; i++) {
        if (String(methods[i].id) === 'standard') { defaultId = 'standard'; break; }
      }
      selectedShippingId = defaultId;

      shippingEl.innerHTML = methods.map(function (method) {
        var cost = Number(method.cost) || 0;
        var checked = String(method.id) === defaultId;
        return (
          '<label class="radio-card' + (checked ? ' is-active' : '') + '">' +
            '<input type="radio" name="shipping_method" value="' + esc(String(method.id)) + '"' + (checked ? ' checked' : '') + '>' +
            '<span class="radio-card__body">' +
              '<span class="radio-card__label">' + esc(method.label) + '</span>' +
              (method.eta ? '<span class="radio-card__meta">' + esc(method.eta) + '</span>' : '') +
            '</span>' +
            '<span class="radio-card__cost">' + (cost > 0 ? fmt(cost) : 'Free') + '</span>' +
          '</label>'
        );
      }).join('');
    }

    function renderPaymentOptions() {
      var methods = (window.VD.settings || {}).payment_methods || [];
      if (!methods.length) {
        paymentEl.innerHTML = '<p class="form-note">No payment methods are configured — please add them in config.js.</p>';
        return;
      }
      paymentEl.innerHTML = methods.map(function (method, index) {
        var checked = index === 0;   // first method pre-selected
        return (
          '<label class="radio-card' + (checked ? ' is-active' : '') + '">' +
            '<input type="radio" name="payment_method" value="' + esc(String(method.id)) + '"' + (checked ? ' checked' : '') + '>' +
            '<span class="radio-card__body">' +
              '<span class="radio-card__label">' + esc(method.label) + '</span>' +
              (method.note ? '<span class="radio-card__meta">' + esc(method.note) + '</span>' : '') +
            '</span>' +
          '</label>'
        );
      }).join('');
    }

    /* Mini line list: 48px thumb, name, size / colour / qty, line total. */
    function renderItems() {
      itemsEl.innerHTML = cart.items.map(function (item) {
        return (
          '<div class="summary-item">' +
            // normalizeImageUrl: items added before the image-folder move keep working.
            '<img class="summary-item__thumb" src="' + esc(window.VD.api.normalizeImageUrl(item.image)) + '" alt="' + esc(item.name) + '"' +
              ' width="48" height="48" loading="lazy" onerror="VD.utils.imgFallback(this)">' +
            '<div class="summary-item__info">' +
              '<p class="summary-item__name">' + esc(item.name) + '</p>' +
              '<p class="summary-item__meta">Size ' + esc(item.size) + ' · ' + esc(item.color) + ' · Qty ' + Number(item.quantity) + '</p>' +
            '</div>' +
            '<p class="summary-item__total">' + fmt(item.unit_price * item.quantity) + '</p>' +
          '</div>'
        );
      }).join('');
    }

    /* Totals rows — re-rendered on every shipping / promo change. */
    function renderTotals() {
      var promoState = promo.get();
      var subtotal = cart.subtotal();
      var discount = promo.discount(promoState, subtotal);
      var shipping = shippingCost(promoState, subtotal - discount);
      var total = Math.max(subtotal - discount + shipping, 0);
      var method = selectedMethod();

      var rows = '';
      rows += '<div class="summary-row"><span>Subtotal</span><span>' + fmt(subtotal) + '</span></div>';
      if (discount > 0) {
        rows += '<div class="summary-row summary-discount"><span>Discount (' + esc(promoState.code) + ')</span><span>−' + fmt(discount) + '</span></div>';
      }
      if (promo.isFreeShipping(promoState)) {
        rows += '<div class="summary-row summary-discount"><span>Shipping (' + esc(promoState.code) + ')</span><span>Free</span></div>';
      } else {
        rows += '<div class="summary-row"><span>Shipping' + (method && method.label ? ' — ' + esc(method.label) : '') + '</span><span>' + fmt(shipping) + '</span></div>';
      }
      var threshold = freeThreshold();
      var remaining = threshold - (subtotal - discount);
      if (threshold > 0 && remaining > 0 && !promo.isFreeShipping(promoState)) {
        rows += '<p class="summary-note">Add ' + fmt(remaining) + ' more for free standard shipping.</p>';
      }
      rows += '<div class="summary-row summary-row--total"><span>Total</span><span>' + fmt(total) + '</span></div>';
      totalsEl.innerHTML = rows;
    }

    /* ==================================================================
       PROMO CODE (shares session state with the cart via VD.cart.promo)
       ================================================================== */
    function applyPromo() {
      var result = promo.apply(promoInputEl.value, cart.subtotal());
      if (result.ok) {
        promoNoteEl.textContent = result.message;
        promoNoteEl.className = 'form-note form-note--success';
        renderTotals();   // discount + shipping rows change
      } else {
        promoNoteEl.textContent = result.message;
        promoNoteEl.className = 'form-note form-note--error';
      }
    }

    function bindPromo() {
      var stored = promo.get();
      if (stored) {
        promoInputEl.value = stored.code;   // prefill from the cart session
        promoNoteEl.textContent = 'Code ' + stored.code + ' is applied to your order.';
        promoNoteEl.className = 'form-note form-note--info';
      }
      if (promoApplyBtn) promoApplyBtn.addEventListener('click', applyPromo);
      // Enter inside the promo input must not submit the checkout form.
      promoInputEl.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') { event.preventDefault(); applyPromo(); }
      });
    }

    /* ==================================================================
       CLIENT-SIDE VALIDATION
       ================================================================== */
    function setFieldError(input, message) {
      var field = input.closest('.field');
      if (!field) return;
      field.classList.add('field--error');
      var slot = field.querySelector('.field__error');
      if (slot) slot.textContent = message;
    }

    function clearFieldError(input) {
      var field = input.closest('.field');
      if (!field) return;
      field.classList.remove('field--error');
      var slot = field.querySelector('.field__error');
      if (slot) slot.textContent = '';
    }

    /* Checks every required field. Returns the first invalid input so it can
       be focused, or null when everything is fine. Values are never cleared —
       the customer only fixes whatever is highlighted. */
    function validateForm() {
      var firstInvalid = null;

      function check(input, ok, message) {
        if (ok) { clearFieldError(input); return; }
        setFieldError(input, message);
        if (!firstInvalid) firstInvalid = input;
      }

      check(fields.full_name, fields.full_name.value.trim().length > 0, 'Please enter your full name.');

      var email = fields.email.value.trim();
      check(fields.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Please enter a valid email address.');

      var phoneDigits = (fields.phone.value.match(/\d/g) || []).length;
      check(fields.phone, phoneDigits >= 7, 'Please enter a phone number with at least 7 digits.');

      check(fields.country, fields.country.value !== '', 'Please select your country.');
      check(fields.city, fields.city.value.trim().length > 0, 'Please enter your city.');
      check(fields.address, fields.address.value.trim().length >= 5, 'Please enter your street address (at least 5 characters).');
      check(fields.postal_code, fields.postal_code.value.trim().length > 0, 'Please enter your postal code.');

      clearFieldError(fields.notes);   // optional — never flagged

      return firstInvalid;
    }

    /* ==================================================================
       ERROR BANNER + SUBMIT BUTTON STATE
       ================================================================== */
    function showBanner(message) {
      bannerEl.textContent = message;
      bannerEl.hidden = false;
    }

    function hideBanner() {
      bannerEl.hidden = true;
      bannerEl.textContent = '';
    }

    function setSubmitting(state) {
      submitting = state;
      placeBtn.disabled = state;
      placeBtn.textContent = state ? 'Placing order…' : placeBtnLabel;
    }

    /* ==================================================================
       ORDER SUBMISSION
       ================================================================== */
    function buildPayload() {
      var promoState = promo.get();
      var method = selectedMethod();
      return {
        customer: {
          full_name:   fields.full_name.value.trim(),
          email:       fields.email.value.trim(),
          phone:       fields.phone.value.trim(),
          country:     fields.country.value,
          city:        fields.city.value.trim(),
          address:     fields.address.value.trim(),
          postal_code: fields.postal_code.value.trim(),
          notes:       fields.notes.value.trim()
        },
        items: cart.items.map(function (item) {
          return { variant_id: item.variant_id, quantity: item.quantity };
        }),
        shipping_method: method ? String(method.id) : null,
        promo_code: promoState ? promoState.code : null,
        idempotency_key: window.VD.api.newIdempotencyKey()
      };
    }

    /* Map the place_order error codes to customer-friendly sentences. */
    function describeOrderError(rawMessage) {
      var raw = String(rawMessage || '').trim();
      if (!raw) return 'Something went wrong — please try again.';
      if (raw.indexOf('INSUFFICIENT_STOCK') === 0) {
        var sku = raw.split(':')[1] || 'the selected size';
        return 'Sorry — there is not enough stock left for ' + sku + '. Please adjust the quantity in your cart and try again.';
      }
      if (raw.indexOf('UNAVAILABLE_ITEM') === 0) {
        var gone = raw.split(':')[1] || 'an item';
        return 'Sorry — ' + gone + ' is no longer available and has been removed from your cart. Please review your order and try again.';
      }
      if (raw.indexOf('INVALID_PROMO_CODE') !== -1) {
        return 'Your promo code is no longer valid — please remove it and try again.';
      }
      if (raw.indexOf('INVALID_SHIPPING_METHOD') !== -1) {
        return 'The selected delivery method is unavailable — please choose another one.';
      }
      if (raw.indexOf('INVALID_CUSTOMER') !== -1 || raw.indexOf('INVALID_ITEMS') !== -1) {
        return 'Please review your delivery details and try again.';
      }
      return raw;   // show the server message as-is for anything unexpected
    }

    /* Server confirmed the order — clear the cart and show the confirmation. */
    function onOrderSuccess(order, payload) {
      cart.clear();       // the order is placed — empty the cart + promo
      promo.clear();

      layoutEl.hidden = true;
      demoErrorEl.hidden = true;
      hideBanner();

      var safeOrder = order || {};
      document.getElementById('success-order-number').textContent =
        'Order number: ' + (safeOrder.order_number || '—');

      var lines = '';
      lines += '<div class="summary-row"><span>Subtotal</span><span>' + fmt(Number(safeOrder.subtotal) || 0) + '</span></div>';
      if (Number(safeOrder.discount) > 0) {
        lines += '<div class="summary-row summary-discount"><span>Discount</span><span>−' + fmt(Number(safeOrder.discount)) + '</span></div>';
      }
      lines += '<div class="summary-row"><span>Shipping</span><span>' + fmt(Number(safeOrder.shipping) || 0) + '</span></div>';
      lines += '<div class="summary-row summary-row--total"><span>Total</span><span>' + fmt(Number(safeOrder.total) || 0) + '</span></div>';
      document.getElementById('success-summary').innerHTML = lines;

      document.getElementById('success-email').textContent = payload.customer.email;

      successEl.hidden = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      var heading = document.getElementById('order-success-title');
      if (heading) heading.focus();   // announce the confirmation to screen readers
    }

    /* Supabase not configured — the honest setup panel. Form stays, the cart
       is preserved, nothing is faked. */
    function onDemoRefused() {
      setSubmitting(false);
      hideBanner();
      demoErrorEl.hidden = false;
      demoErrorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    /* Server refused the order (e.g. stock ran out) — keep the cart, explain,
       then re-check the lines against the catalog and re-render the summary. */
    function onOrderError(rawMessage) {
      setSubmitting(false);
      var message = describeOrderError(rawMessage);
      showBanner(message);
      utils.toast(message, 'error');
      cart.validateAgainstCatalog().then(function () {
        if (!cart.items.length) { showEmptyCart(); return; }
        renderItems();
        renderTotals();
      });
    }

    /* ------------------------------------------------------------------
       EVENT BINDINGS
       ------------------------------------------------------------------ */
    shippingEl.addEventListener('change', function (event) {
      if (event.target && event.target.name === 'shipping_method') {
        selectedShippingId = event.target.value;
        syncRadioCards(shippingEl);
        renderTotals();   // shipping row + total follow the chosen method
      }
    });

    paymentEl.addEventListener('change', function (event) {
      if (event.target && event.target.name === 'payment_method') {
        syncRadioCards(paymentEl);
      }
    });

    // Clear a field's error state as soon as the customer edits it again.
    formEl.addEventListener('input', function (event) {
      if (event.target && event.target.closest && event.target.closest('.field')) {
        clearFieldError(event.target);
      }
    });
    formEl.addEventListener('change', function (event) {
      if (event.target && event.target.closest && event.target.closest('.field')) {
        clearFieldError(event.target);
      }
    });

    formEl.addEventListener('submit', function (event) {
      event.preventDefault();
      if (submitting) return;   // double-submit guard
      hideBanner();

      var invalid = validateForm();
      if (invalid) {
        showBanner('Please check the highlighted fields.');
        invalid.focus();
        return;
      }

      var payload = buildPayload();
      setSubmitting(true);

      window.VD.api.submitOrder(payload).then(function (result) {
        if (result && result.ok) {
          onOrderSuccess(result.order, payload);
        } else if (result && result.demo) {
          onDemoRefused();                        // Supabase not configured yet
        } else {
          onOrderError(result && result.error);   // server refused the order
        }
      }).catch(function () {
        onOrderError('Something went wrong while contacting the store — please try again.');
      });
    });

    bindPromo();

    /* ------------------------------------------------------------------
       START — refresh stock caps / prices, then render
       ------------------------------------------------------------------ */
    if (!cart.items.length) { showEmptyCart(); return; }
    cart.validateAgainstCatalog().then(function () {
      if (!cart.items.length) { showEmptyCart(); return; }
      renderShippingOptions();
      renderPaymentOptions();
      renderItems();
      renderTotals();
    });
  };
})();
