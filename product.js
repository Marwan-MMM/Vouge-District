/* ==========================================================================
   VOGUE DISTRICT — PRODUCT PAGE CONTROLLER (product.js)
   --------------------------------------------------------------------------
   Renders one product (product.html?slug=…, with ?id=… as a fallback) and
   drives the variant selection UX.

   VARIANT RULES implemented below:
     • A size button is disabled (+ .is-oos) when, for the currently
       selected colour, no variant exists or its stock is 0.
     • With no colour chosen yet, a size stays enabled while ANY variant of
       that size has stock.
     • Selecting a colour auto-selects its first available size (keeping a
       still-valid size choice if there is one).
     • Selecting a size auto-selects a colour when none is chosen.
     • The stock note always reflects the current selection.

   ADD TO CART requires both a colour and a size whenever the product offers
   more than one of either — otherwise the matching group shakes, gets an
   inline error and focus, and nothing is written to the cart.

   The cart item shape matches the shared contract in cart.js exactly:
     { product_id, variant_id, slug, name, sku, size, color, image,
       unit_price, quantity, max_stock }
   ========================================================================== */

(function () {
  'use strict';

  window.VD = window.VD || {};
  window.VD.page = window.VD.page || {};

  var product = null;
  var selection = { color: null, size: null, qty: 1 };
  var addedFeedback = false;   // "Added ✓" is currently showing on the button
  var lastFocused = null;      // focus restored after the size guide closes
  var els = {};

  function esc(value) { return window.VD.utils.esc(value); }
  function brandName() {
    return (window.VD.settings && window.VD.settings.brand && window.VD.settings.brand.name) || 'Vogue District';
  }

  /* ======================================================================
     PAGE INIT — registered with main.js (called on DOMContentLoaded)
     ====================================================================== */

  window.VD.page.init = function () {
    if (!document.getElementById('product-detail')) return;   // not the product page
    collectEls();
    bindChrome();
    loadProduct();
  };

  function collectEls() {
    els.detail        = document.getElementById('product-detail');
    els.error         = document.getElementById('product-error');
    els.breadcrumbs   = document.getElementById('breadcrumbs');
    els.galleryMain   = document.getElementById('product-gallery-main');
    els.galleryThumbs = document.getElementById('product-gallery-thumbs');
    els.cat           = document.getElementById('product-cat');
    els.title         = document.getElementById('product-title');
    els.price         = document.getElementById('product-price');
    els.sku           = document.getElementById('product-sku');
    els.stock         = document.getElementById('product-stock');
    els.colorsGroup   = document.getElementById('option-colors');
    els.colorsList    = document.getElementById('color-swatches');
    els.sizesGroup    = document.getElementById('option-sizes');
    els.sizesList     = document.getElementById('size-buttons');
    els.qtyGroup      = document.getElementById('qty-input');
    els.qtyValue      = document.getElementById('qty-value');
    els.qtyMinus      = document.getElementById('qty-minus');
    els.qtyPlus       = document.getElementById('qty-plus');
    els.addBtn        = document.getElementById('add-to-cart');
    els.wishBtn       = document.getElementById('wishlist-toggle');
    els.wishLabel     = document.getElementById('wishlist-label');
    els.note          = document.getElementById('selection-note');
    els.relatedSection = document.getElementById('related-section');
    els.relatedGrid   = document.getElementById('related-grid');
    els.modal         = document.getElementById('size-guide-modal');
    els.sizeGuideOpen = document.getElementById('size-guide-open');
  }

  /* Static behaviours that don't depend on the loaded product. */
  function bindChrome() {
    els.qtyMinus.addEventListener('click', function () { stepQty(-1); });
    els.qtyPlus.addEventListener('click', function () { stepQty(1); });
    els.addBtn.addEventListener('click', handleAddToCart);

    /* The toggle itself is handled by the shared delegated
       [data-wishlist-slug] handler in wishlist.js — we only keep the
       visible label in sync here. */
    window.VD.wishlist.onChange(function () { updateWishlistLabel(); });

    /* Size guide modal. */
    if (els.sizeGuideOpen) {
      els.sizeGuideOpen.addEventListener('click', openSizeGuide);
    }
    if (els.modal) {
      var closeBtn = els.modal.querySelector('[data-modal-close]');
      if (closeBtn) closeBtn.addEventListener('click', closeSizeGuide);
      els.modal.addEventListener('click', function (event) {
        if (event.target === els.modal) closeSizeGuide();   // backdrop click
      });
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && !els.modal.hidden) closeSizeGuide();
      });
    }
  }

  /* ======================================================================
     LOAD (?slug=…, falling back to ?id=…)
     ====================================================================== */

  function loadProduct() {
    var slug = window.VD.utils.getParam('slug');
    var id = window.VD.utils.getParam('id');

    /* Loading shimmer keeps the gallery box stable while we resolve. */
    els.galleryMain.innerHTML =
      '<div class="product-card--skeleton" style="aspect-ratio:4/5" aria-hidden="true"></div>';

    var request;
    if (slug) {
      request = window.VD.api.getProductBySlug(slug);
    } else if (id) {
      /* ?id= fallback — resolve the product id from the full catalog. */
      request = window.VD.api.getProducts().then(function (res) {
        var found = null;
        (res.items || []).forEach(function (p) {
          if (String(p.id) === String(id)) found = p;
        });
        return found;
      });
    } else {
      request = Promise.resolve(null);
    }

    request.then(function (p) {
      /* Unknown product — or an unpublished one reached via a direct link
         in Supabase mode — is treated as "not found". */
      if (!p || p.is_published === false) { showProductError(); return; }
      product = p;
      renderProduct();
    }).catch(function () {
      showProductError();
    });
  }

  function showProductError() {
    els.detail.hidden = true;
    els.relatedSection.hidden = true;
    els.breadcrumbs.hidden = true;
    els.error.hidden = false;
    document.title = 'Product not found — ' + brandName();
    var meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', 'This product could not be found — browse the full ' + brandName() + ' edit instead.');
  }

  /* ======================================================================
     RENDER
     ====================================================================== */

  function renderProduct() {
    /* Register with products.js so the shared wishlist buttons can resolve
       this product from their in-memory registry. */
    window.VD.products.remember(product);

    document.title = product.name + ' — ' + brandName();
    var meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', product.description || (product.name + ' — ' + brandName() + '.'));

    renderBreadcrumbs();
    renderGallery();
    renderInfo();
    renderOptions();
    renderAccordions();

    /* Wishlist button joins the shared delegation system only now that we
       have a real slug (prevents empty-slug clicks before load). */
    els.wishBtn.setAttribute('data-wishlist-slug', product.slug);
    updateWishlistLabel();

    els.detail.removeAttribute('aria-busy');
    loadRelated();
  }

  function renderBreadcrumbs() {
    var crumbs = [
      { href: 'index.html', label: 'Home' },
      { href: 'shop.html', label: 'Shop' }
    ];
    if (product.category_name) {
      crumbs.push({
        href: 'shop.html?category=' + encodeURIComponent(product.category_slug),
        label: product.category_name
      });
    }
    var html = crumbs.map(function (c) {
      return '<a href="' + esc(c.href) + '">' + esc(c.label) + '</a>';
    }).join('');
    html += '<span aria-current="page">' + esc(product.name) + '</span>';
    els.breadcrumbs.innerHTML = html;
  }

  function renderGallery() {
    var images = (product.images && product.images.length)
      ? product.images
      : [{ url: product.cover_image, alt: product.name }];
    var main = images[0];

    /* Main image + the standard Sale/New/Best Seller badge markup. */
    els.galleryMain.innerHTML =
      '<img src="' + esc(main.url) + '" alt="' + esc(main.alt || product.name) + '" ' +
        'id="product-gallery-image" onerror="VD.utils.imgFallback(this)">' +
      window.VD.products.badgesHTML(product);

    /* Thumbnails only when there is more than one image. */
    if (images.length > 1) {
      els.galleryThumbs.innerHTML = images.map(function (img, index) {
        return '<button type="button" class="product-gallery__thumb' + (index === 0 ? ' is-active' : '') + '" ' +
          'data-image-index="' + index + '" aria-label="Show image ' + (index + 1) + ' of ' + images.length + '">' +
          '<img src="' + esc(img.url) + '" alt="" loading="lazy" onerror="VD.utils.imgFallback(this)">' +
          '</button>';
      }).join('');

      els.galleryThumbs.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-image-index]');
        if (!btn) return;
        var img = images[Number(btn.getAttribute('data-image-index'))];
        if (!img) return;
        var mainImg = document.getElementById('product-gallery-image');
        if (mainImg) {
          mainImg.src = img.url;
          mainImg.alt = img.alt || product.name;
        }
        els.galleryThumbs.querySelectorAll('[data-image-index]').forEach(function (b) {
          b.classList.toggle('is-active', b === btn);
        });
      });
    } else {
      els.galleryThumbs.innerHTML = '';
    }
  }

  function renderInfo() {
    els.cat.textContent = product.category_name || '';
    els.title.textContent = product.name;
    els.price.innerHTML = window.VD.products.priceHTML(product);
    els.sku.textContent = 'SKU: ' + product.sku;

    els.qtyGroup.hidden = false;
    refreshSelectionUI();
  }

  function renderOptions() {
    if (product.colors && product.colors.length) {
      els.colorsGroup.hidden = false;
      els.colorsList.innerHTML = product.colors.map(function (c) {
        return '<button type="button" class="color-swatch" data-color="' + esc(c.name) + '" ' +
          'style="background:' + esc(c.hex) + '" title="' + esc(c.name) + '" ' +
          'aria-label="Colour: ' + esc(c.name) + '" aria-pressed="false"></button>';
      }).join('');
    }

    if (product.sizes && product.sizes.length) {
      els.sizesGroup.hidden = false;
      els.sizesList.innerHTML = product.sizes.map(function (s) {
        return '<button type="button" class="size-button" data-size="' + esc(s) + '">' + esc(s) + '</button>';
      }).join('');
    }

    els.colorsList.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-color]');
      if (!btn || btn.disabled) return;
      selectColor(btn.getAttribute('data-color'));
    });
    els.sizesList.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-size]');
      if (!btn || btn.disabled) return;
      selectSize(btn.getAttribute('data-size'));
    });

    refreshSelectionUI();
  }

  function renderAccordions() {
    document.getElementById('accordion-description-body').textContent = product.description || '';
    document.getElementById('accordion-details-body').textContent = product.details || '';
    /* Shipping & returns is static, owner-editable HTML in product.html. */
  }

  function loadRelated() {
    window.VD.api.getRelatedProducts(product, 4).then(function (items) {
      if (!items || !items.length || !els.relatedGrid) return;
      window.VD.products.renderCards(els.relatedGrid, items);
      els.relatedSection.hidden = false;
      window.VD.wishlist.syncButtons();
    }).catch(function () { /* related products are optional decoration */ });
  }

  /* ======================================================================
     VARIANT SELECTION (rules in the file header)
     ====================================================================== */

  function findVariant(color, size) {
    var list = product.variants || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].color === color && String(list[i].size) === String(size)) return list[i];
    }
    return null;
  }

  function variantInStock(color, size) {
    var v = findVariant(color, size);
    return !!v && v.stock > 0;
  }

  /* The variant implied by the current selection. Products with a single
     colour and/or a single size resolve that dimension automatically. */
  function currentVariant() {
    if (!product) return null;
    var color = selection.color || (product.colors.length === 1 ? product.colors[0].name : null);
    var size = selection.size || (product.sizes.length === 1 ? product.sizes[0] : null);
    if (!color || !size) return null;
    return findVariant(color, size);
  }

  function firstAvailableSize(color) {
    var sizes = product.sizes || [];
    for (var i = 0; i < sizes.length; i++) {
      if (variantInStock(color, sizes[i])) return sizes[i];
    }
    return null;
  }

  function selectColor(color) {
    selection.color = color;
    clearSelectionNote();
    /* Auto-pick the first available size for this colour, unless the
       shopper already chose a size that is still in stock for it. */
    if (!selection.size || !variantInStock(color, selection.size)) {
      selection.size = firstAvailableSize(color);
    }
    refreshSelectionUI();
  }

  function selectSize(size) {
    selection.size = size;
    clearSelectionNote();
    if (!selection.color) {
      /* Auto-pick the first colour that has this size in stock. */
      var colors = product.colors || [];
      for (var i = 0; i < colors.length; i++) {
        if (variantInStock(colors[i].name, size)) { selection.color = colors[i].name; break; }
      }
      /* Safety net (missing/oos rows in hand-edited catalogs): any colour
         that offers the size at all. */
      if (!selection.color) {
        for (var j = 0; j < colors.length; j++) {
          if (findVariant(colors[j].name, size)) { selection.color = colors[j].name; break; }
        }
      }
    }
    refreshSelectionUI();
  }

  /* Re-paint swatch/size states, stock note, quantity cap and buy button. */
  function refreshSelectionUI() {
    els.colorsList.querySelectorAll('[data-color]').forEach(function (btn) {
      var active = btn.getAttribute('data-color') === selection.color;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    els.sizesList.querySelectorAll('[data-size]').forEach(function (btn) {
      var size = btn.getAttribute('data-size');
      var available = selection.color
        ? variantInStock(selection.color, size)
        : (product.variants || []).some(function (v) {
            return String(v.size) === String(size) && v.stock > 0;
          });
      btn.disabled = !available;
      btn.classList.toggle('is-oos', !available);
      var active = btn.getAttribute('data-size') === selection.size;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    updateStockNote();
    refreshQty();
    updateAddButton();
    if (selection.color && selection.size) clearSelectionNote();
  }

  /* ======================================================================
     STOCK NOTE ("In stock" / "Only X left" --low / "Out of stock" --out)
     ====================================================================== */

  function updateStockNote() {
    var variant = currentVariant();
    var stock;
    if (variant) {
      stock = variant.stock;
    } else if (selection.color) {
      stock = 0;
      (product.variants || []).forEach(function (v) {
        if (v.color === selection.color) stock += v.stock;
      });
    } else {
      stock = product.stock_total;
    }

    var suffix = variant ? ' in ' + variant.color + ', size ' + variant.size : '';
    if (stock <= 0) {
      els.stock.className = 'stock-note stock-note--out';
      els.stock.textContent = 'Out of stock';
    } else if (stock <= 5) {
      els.stock.className = 'stock-note stock-note--low';
      els.stock.textContent = 'Only ' + stock + ' left' + suffix;
    } else {
      els.stock.className = 'stock-note';
      els.stock.textContent = 'In stock';
    }
  }

  /* ======================================================================
     QUANTITY STEPPER (clamped to the selected variant's stock)
     ====================================================================== */

  function maxQty() {
    var variant = currentVariant();
    if (variant) return Math.max(variant.stock, 0);
    return Math.max(product.stock_total, 1);
  }

  function refreshQty() {
    var max = maxQty();
    if (selection.qty > max) selection.qty = Math.max(max, 1);
    if (selection.qty < 1) selection.qty = 1;
    els.qtyValue.textContent = String(selection.qty);
    var disabled = product.stock_total <= 0 || max <= 0;
    els.qtyMinus.disabled = disabled;
    els.qtyPlus.disabled = disabled;
  }

  function stepQty(delta) {
    if (!product) return;   // clicks before the product resolves are ignored
    var next = selection.qty + delta;
    var max = maxQty();
    if (next < 1) {
      selection.qty = 1;
      window.VD.utils.toast('Minimum quantity is 1.', 'info');
    } else if (next > max) {
      selection.qty = max;
      window.VD.utils.toast(
        currentVariant()
          ? 'Only ' + max + ' left in stock for this size.'
          : 'Only ' + max + ' available.',
        'info');
    } else {
      selection.qty = next;
    }
    els.qtyValue.textContent = String(selection.qty);
  }

  /* ======================================================================
     ADD TO CART
     ====================================================================== */

  function updateAddButton() {
    if (addedFeedback) return;   // keep "Added ✓" visible during feedback
    if (product.stock_total <= 0) {
      els.addBtn.disabled = true;
      els.addBtn.textContent = 'Out of stock';
      return;
    }
    var variant = currentVariant();
    els.addBtn.disabled = !!variant && variant.stock <= 0;   // chosen combo sold out
    els.addBtn.textContent = 'Add to cart';
  }

  function handleAddToCart() {
    if (!product || addedFeedback || product.stock_total <= 0) return;

    /* Selection requirement: with more than one colour or size, both must
       be chosen before anything is written to the cart. */
    var missing = [];
    if (product.colors.length > 1 && !selection.color) missing.push('colour');
    if (product.sizes.length > 1 && !selection.size) missing.push('size');
    if (missing.length) {
      showSelectionNote('Please select a ' + missing.join(' and ') + '.', missing);
      return;
    }

    var variant = currentVariant();
    if (!variant || variant.stock <= 0) {
      showSelectionNote('That combination is sold out — please choose another.', []);
      return;
    }

    /* Cart item shape — shared contract (see cart.js header). */
    var item = {
      product_id: product.id,
      variant_id: variant.id,
      slug: product.slug,
      name: product.name,
      sku: variant.sku,
      size: variant.size,
      color: variant.color,
      image: product.cover_image,
      unit_price: product.price,
      quantity: selection.qty,
      max_stock: variant.stock
    };

    els.addBtn.disabled = true;
    var ok = window.VD.cart.add(item);
    if (ok) {
      addedFeedback = true;
      els.addBtn.textContent = 'Added ✓';
      setTimeout(function () {
        addedFeedback = false;
        updateAddButton();
      }, 1400);
    } else {
      /* cart.add already toasted the reason (variant stock cap reached). */
      els.addBtn.disabled = false;
    }
  }

  function showSelectionNote(message, missing) {
    els.note.textContent = message;
    els.note.className = 'form-note form-note--error';
    els.note.hidden = false;

    /* Shake + focus the first group that needs attention. */
    var group = (missing.indexOf('colour') !== -1) ? els.colorsGroup : els.sizesGroup;
    if (group) {
      group.classList.remove('is-shaking');
      void group.offsetWidth;   // restart the CSS animation
      group.classList.add('is-shaking');
      group.focus();
      setTimeout(function () { group.classList.remove('is-shaking'); }, 500);
    }
  }

  function clearSelectionNote() {
    if (!els.note.hidden) {
      els.note.hidden = true;
      els.note.textContent = '';
      els.note.className = 'form-note';
    }
  }

  /* ======================================================================
     WISHLIST (toggle handled by wishlist.js delegation — label only here)
     ====================================================================== */

  function updateWishlistLabel() {
    if (!product) return;
    var saved = window.VD.wishlist.has(product.slug);
    els.wishLabel.textContent = saved ? 'Saved to wishlist' : 'Add to wishlist';
    /* .is-active + aria-pressed on the button are kept in sync by
       wishlist.js syncButtons() (runs on every wishlist change). */
  }

  /* ======================================================================
     SIZE GUIDE MODAL
     ====================================================================== */

  function openSizeGuide() {
    if (!els.modal) return;
    lastFocused = document.activeElement;
    els.modal.hidden = false;
    document.body.classList.add('no-scroll');
    var closeBtn = els.modal.querySelector('[data-modal-close]');
    if (closeBtn) closeBtn.focus();   // focus the close button on open
  }

  function closeSizeGuide() {
    if (!els.modal || els.modal.hidden) return;
    els.modal.hidden = true;
    document.body.classList.remove('no-scroll');
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }
})();
