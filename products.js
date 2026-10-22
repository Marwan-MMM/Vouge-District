/* ==========================================================================
   VOGUE DISTRICT — PRODUCT DISPLAY HELPERS (products.js)
   --------------------------------------------------------------------------
   Shared rendering used by the homepage, shop, wishlist, product page and
   admin previews: price formatting, badges and the standard product card.

   It also keeps a small in-memory registry of the products currently on the
   page (VD.products.registry) so wishlist buttons can find their product
   without extra network calls.
   ========================================================================== */

(function () {
  'use strict';

  window.VD = window.VD || {};

  var registry = {};          // slug -> product object (populated as cards render)

  window.VD.products = {
    registry: registry,

    /* Keep a reference so delegated wishlist buttons can resolve products. */
    remember: function (product) {
      if (product && product.slug) registry[product.slug] = product;
    },

    /* --------------------------------------------------------------------
       Price block — shows the effective price and a struck-through
       original price when the product is on sale.
       -------------------------------------------------------------------- */
    priceHTML: function (product) {
      var esc = window.VD.utils.esc;
      var fmt = window.VD.utils.formatPrice;
      if (product.is_on_sale) {
        return (
          '<span class="price price--sale">' + fmt(product.price) + '</span>' +
          '<s class="price__compare" aria-label="Original price">' + fmt(product.base_price) + '</s>'
        );
      }
      return '<span class="price">' + fmt(product.price) + '</span>';
    },

    /* --------------------------------------------------------------------
       Badges — Sale always first, then New, then Best Seller (max 2).
       -------------------------------------------------------------------- */
    badgesHTML: function (product) {
      var badges = [];
      if (product.is_on_sale) badges.push({ cls: 'badge--sale', label: 'Sale' });
      if (product.is_new_arrival) badges.push({ cls: 'badge--new', label: 'New' });
      if (product.is_best_seller && badges.length < 2) badges.push({ cls: 'badge--best', label: 'Best Seller' });
      if (!badges.length) return '';
      return '<div class="product-card__badges">' + badges.map(function (b) {
        return '<span class="badge ' + b.cls + '">' + b.label + '</span>';
      }).join('') + '</div>';
    },

    /* --------------------------------------------------------------------
       Colour dots (purely informational on cards).
       -------------------------------------------------------------------- */
    colorDotsHTML: function (product) {
      if (!product.colors || !product.colors.length) return '';
      var dots = product.colors.slice(0, 4).map(function (c) {
        return '<span class="color-dot" style="background:' + window.VD.utils.esc(c.hex) + '" title="' +
          window.VD.utils.esc(c.name) + '"></span>';
      }).join('');
      var extra = product.colors.length > 4
        ? '<span class="color-dot color-dot--more">+' + (product.colors.length - 4) + '</span>'
        : '';
      return '<div class="product-card__colors" aria-label="Available colours">' + dots + extra + '</div>';
    },

    /* --------------------------------------------------------------------
       Stock line for cards: "Out of stock" tag on sold-out products.
       -------------------------------------------------------------------- */
    stockHTML: function (product) {
      if (product.stock_total === 0) {
        return '<span class="product-card__stock product-card__stock--out">Out of stock</span>';
      }
      return '';
    },

    /* --------------------------------------------------------------------
       The standard product card used across the storefront.
       -------------------------------------------------------------------- */
    cardHTML: function (product) {
      var esc = window.VD.utils.esc;
      var wish = window.VD.wishlist;
      var isActive = wish && wish.has(product.slug);
      var hoverImg = product.images && product.images.length > 1 ? product.images[1].url : null;

      this.remember(product);

      return (
        '<article class="product-card' + (product.stock_total === 0 ? ' product-card--soldout' : '') + '" data-slug="' + esc(product.slug) + '">' +
          '<div class="product-card__media-wrap">' +
            '<a class="product-card__media" href="product.html?slug=' + encodeURIComponent(product.slug) + '" aria-label="View ' + esc(product.name) + '">' +
              '<img src="' + esc(product.cover_image) + '" alt="' + esc(product.name) + '" loading="lazy" ' +
                'onerror="VD.utils.imgFallback(this)">' +
              (hoverImg
                ? '<img class="product-card__img-hover" src="' + esc(hoverImg) + '" alt="" loading="lazy" onerror="VD.utils.imgFallback(this)">'
                : '') +
            '</a>' +
            this.badgesHTML(product) +
            '<button type="button" class="product-card__wishlist' + (isActive ? ' is-active' : '') + '" ' +
              'data-wishlist-slug="' + esc(product.slug) + '" ' +
              'aria-pressed="' + (isActive ? 'true' : 'false') + '" ' +
              'aria-label="' + (isActive ? 'Remove ' + esc(product.name) + ' from wishlist' : 'Add ' + esc(product.name) + ' to wishlist') + '">' +
              '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 21s-6.7-4.6-9.3-8.5C.8 9.6 2.1 5.9 5.4 5.1c1.9-.4 3.9.3 5.1 1.9l1.5 2 1.5-2c1.2-1.6 3.2-2.3 5.1-1.9 3.3.8 4.6 4.5 2.7 7.4C18.7 16.4 12 21 12 21z"/></svg>' +
            '</button>' +
          '</div>' +
          '<div class="product-card__info">' +
            '<h3 class="product-card__name"><a href="product.html?slug=' + encodeURIComponent(product.slug) + '">' + esc(product.name) + '</a></h3>' +
            '<p class="product-card__price">' + this.priceHTML(product) + '</p>' +
            this.colorDotsHTML(product) +
            this.stockHTML(product) +
          '</div>' +
        '</article>'
      );
    },

    /* Render an array of products into a container. */
    renderCards: function (container, products) {
      if (!container) return;
      container.innerHTML = products.length
        ? products.map(function (p) { return window.VD.products.cardHTML(p); }).join('')
        : '';
    },

    /* Simple loading skeleton grid (n cards). */
    skeletonHTML: function (n) {
      var out = '';
      for (var i = 0; i < n; i++) out += '<div class="product-card product-card--skeleton" aria-hidden="true"></div>';
      return out;
    }
  };
})();
