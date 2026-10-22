/* ==========================================================================
   VOGUE DISTRICT — SHOP PAGE CONTROLLER (shop.js)
   --------------------------------------------------------------------------
   Grid + filtering + search + sorting + pagination for shop.html.

   DATA STRATEGY
   The whole published catalog is loaded ONCE via VD.api.getProducts() and
   every filter / search / sort / page change below happens CLIENT-SIDE —
   no round-trips while the shopper tunes filters, so the grid feels
   instant. This is sized for boutique catalogs: the data layer caps
   browsing at ~200 products (supabase.js CATALOG_LIMIT). Larger catalogs
   should move filtering into Supabase queries — see README "Scaling notes".

   URL STATE (shareable views)
     q          free-text search (name, description, category, SKU)
     category   comma-separated category slugs
     tag        new-arrivals | best-sellers
     sale       1
     collection collection slug (resolved to a product_slug allowlist)
     size       comma-separated size values
     color      comma-separated colour names
     min / max  price range
     stock      1 (in stock only)
     sort       featured | newest | price-asc | price-desc | name
   Every change is written back with history.replaceState (no history spam).

   FACETS
   Size + colour facet counts derive from the products left after all OTHER
   filters (category, search, price, tag, sale, stock, collection) so the
   sidebar only offers choices that can actually return results. If that
   scoped set is ever empty, the facets fall back to the full catalog.
   ========================================================================== */

(function () {
  'use strict';

  window.VD = window.VD || {};
  window.VD.page = window.VD.page || {};

  /* ======================================================================
     CONSTANTS + STATE
     ====================================================================== */

  var PAGE_SIZE = 12;                              // products revealed per page
  var APPAREL_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
  var SORT_KEYS = ['featured', 'newest', 'price-asc', 'price-desc', 'name'];

  /* Current filter / sort / pagination state (mirrored into the URL). */
  var state = {
    q: '',
    categories: [],        // selected category slugs
    tag: null,             // 'new-arrivals' | 'best-sellers' | null
    sale: false,
    collection: null,      // collection slug (for hero title + chip)
    collectionSlugs: null, // resolved allowlist from VD.api.getCollections()
    sizes: [],             // selected size values
    colors: [],            // selected colour names (compared case-insensitively)
    min: null,             // minimum price (number | null)
    max: null,             // maximum price (number | null)
    stock: false,          // in stock only
    sort: 'featured',
    page: 1                // pages already revealed via "Load more"
  };

  var catalog = [];        // full published catalog (loaded once)
  var categories = [];     // sidebar category list
  var collections = [];    // collections (hero titles + allowlists)
  var facets = { sizes: [], colors: [] };   // [{ value, count }]
  var els = {};

  function esc(value) { return window.VD.utils.esc(value); }
  function fmt(value) { return window.VD.utils.formatPrice(value); }
  function brandName() {
    return (window.VD.settings && window.VD.settings.brand && window.VD.settings.brand.name) || 'Vogue District';
  }

  /* ======================================================================
     PAGE INIT — registered with main.js (called on DOMContentLoaded)
     ====================================================================== */

  window.VD.page.init = function () {
    if (!document.getElementById('shop-grid')) return;   // not the shop page

    collectEls();
    els.grid.innerHTML = window.VD.products.skeletonHTML(PAGE_SIZE);   // loading skeletons
    readStateFromURL();

    Promise.all([
      window.VD.api.getProducts(),
      window.VD.api.getCategories(),
      window.VD.api.getCollections()
    ]).then(function (results) {
      catalog = (results[0] && results[0].items) || [];
      categories = results[1] || [];
      collections = results[2] || [];

      validateState();
      buildCategoryFilter();
      buildSizeAndColorFilters();
      bindEvents();
      syncFilterControls();
      render();
    }).catch(function (err) {
      els.grid.innerHTML = '<p class="empty-note empty-note--error">Could not load products: ' +
        esc(err && err.message ? err.message : 'unknown error') + '</p>';
      els.count.textContent = 'Could not load products';
      els.heroCount.textContent = '—';
    });
  };

  function collectEls() {
    els.grid        = document.getElementById('shop-grid');
    els.count       = document.getElementById('shop-results-count');
    els.heroTitle   = document.getElementById('shop-hero-title');
    els.heroCount   = document.getElementById('shop-hero-count');
    els.sort        = document.getElementById('shop-sort');
    els.categoryList = document.getElementById('category-list');
    els.sizeList    = document.getElementById('size-list');
    els.colorList   = document.getElementById('color-list');
    els.priceMin    = document.getElementById('price-min');
    els.priceMax    = document.getElementById('price-max');
    els.priceApply  = document.getElementById('price-apply');
    els.stock       = document.getElementById('filter-stock');
    els.sale        = document.getElementById('filter-sale');
    els.active      = document.getElementById('active-filters');
    els.loadMore    = document.getElementById('load-more');
    els.loadMoreWrap = document.getElementById('load-more-wrap');
    els.empty       = document.getElementById('shop-empty');
    els.emptyText   = document.getElementById('shop-empty-text');
    els.emptyClear  = document.getElementById('shop-empty-clear');
    els.toggle      = document.getElementById('filter-toggle');
    els.toggleCount = document.getElementById('filter-toggle-count');
    els.filters     = document.getElementById('shop-filters');
    els.backdrop    = document.getElementById('filters-backdrop');
  }

  /* ======================================================================
     URL STATE ↔ FILTER STATE
     ====================================================================== */

  function csvParam(name) {
    var raw = window.VD.utils.getParam(name);
    if (!raw) return [];
    return raw.split(',').map(function (token) { return token.trim(); }).filter(Boolean);
  }

  function numParam(name) {
    var raw = window.VD.utils.getParam(name);
    if (raw == null || raw === '') return null;
    var n = Number(raw);
    return (isFinite(n) && n >= 0) ? Math.round(n * 100) / 100 : null;
  }

  function readStateFromURL() {
    state.q = (window.VD.utils.getParam('q') || '').trim();
    state.categories = csvParam('category');
    var tag = window.VD.utils.getParam('tag');
    state.tag = (tag === 'new-arrivals' || tag === 'best-sellers') ? tag : null;
    state.sale = window.VD.utils.getParam('sale') === '1';
    state.collection = window.VD.utils.getParam('collection') || null;
    state.collectionSlugs = null;            // resolved once collections load
    state.sizes = csvParam('size');
    state.colors = csvParam('color');
    state.min = numParam('min');
    state.max = numParam('max');
    state.stock = window.VD.utils.getParam('stock') === '1';
    var sort = window.VD.utils.getParam('sort');
    state.sort = SORT_KEYS.indexOf(sort) !== -1 ? sort : 'featured';
    state.page = 1;
  }

  /* Keep the address bar in sync so every filtered view is shareable. */
  function writeStateToURL() {
    var params = [];
    if (state.q) params.push('q=' + encodeURIComponent(state.q));
    if (state.categories.length) params.push('category=' + state.categories.map(encodeURIComponent).join(','));
    if (state.tag) params.push('tag=' + state.tag);
    if (state.sale) params.push('sale=1');
    if (state.collection) params.push('collection=' + encodeURIComponent(state.collection));
    if (state.sizes.length) params.push('size=' + state.sizes.map(encodeURIComponent).join(','));
    if (state.colors.length) params.push('color=' + state.colors.map(encodeURIComponent).join(','));
    if (state.min != null) params.push('min=' + state.min);
    if (state.max != null) params.push('max=' + state.max);
    if (state.stock) params.push('stock=1');
    if (state.sort !== 'featured') params.push('sort=' + state.sort);
    var url = window.location.pathname + (params.length ? '?' + params.join('&') : '');
    try { window.history.replaceState(null, '', url); } catch (err) { /* ignore */ }
  }

  /* Drop stale/unknown values from shared or bookmarked URLs. */
  function validateState() {
    var known = {};
    categories.forEach(function (c) { known[c.slug] = true; });
    state.categories = state.categories.filter(function (slug) { return known[slug]; });

    if (state.collection) {
      var col = findCollection(state.collection);
      state.collectionSlugs = col ? (col.product_slugs || []).slice() : [];
    } else {
      state.collectionSlugs = null;
    }
  }

  /* ======================================================================
     FILTERING PIPELINE (all client-side, see header note)
     ====================================================================== */

  function matchesQuery(product, query) {
    var needle = query.toLowerCase();
    return (
      (product.name || '').toLowerCase().indexOf(needle) !== -1 ||
      (product.description || '').toLowerCase().indexOf(needle) !== -1 ||
      (product.category_name || '').toLowerCase().indexOf(needle) !== -1 ||
      (product.sku || '').toLowerCase().indexOf(needle) !== -1
    );
  }

  function hasAnySize(product, wanted) {
    var sizes = product.sizes || [];
    for (var i = 0; i < sizes.length; i++) {
      if (wanted.indexOf(String(sizes[i])) !== -1) return true;
    }
    return false;
  }

  function hasAnyColor(product, wanted) {
    var colors = product.colors || [];
    for (var i = 0; i < colors.length; i++) {
      var name = String(colors[i].name).toLowerCase();
      for (var j = 0; j < wanted.length; j++) {
        if (name === wanted[j].toLowerCase()) return true;
      }
    }
    return false;
  }

  /* The single filtering pipeline.
     opts.skipSizeColor → "facet scope": apply every dimension EXCEPT
     size + colour (used to count facet values meaningfully). */
  /* Category matching with the audience facet: "Women" / "Men" match the
     product's audience field as well as its primary category, so a dress
     filed under "Dresses" still appears when the shopper filters Women. */
  function inCategory(product, slug) {
    if (product.category_slug === slug) return true;
    if ((slug === 'women' || slug === 'men') && (product.audience || 'unisex') === slug) return true;
    return false;
  }

  function applyFilters(list, opts) {
    opts = opts || {};
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (state.collectionSlugs && state.collectionSlugs.indexOf(p.slug) === -1) continue;
      if (state.tag === 'new-arrivals' && !p.is_new_arrival) continue;
      if (state.tag === 'best-sellers' && !p.is_best_seller) continue;
      if (state.sale && !p.is_on_sale) continue;
      if (state.categories.length && !state.categories.some(function (s) { return inCategory(p, s); })) continue;
      if (state.q && !matchesQuery(p, state.q)) continue;
      if (state.stock && p.stock_total <= 0) continue;
      if (state.min != null && p.price < state.min) continue;
      if (state.max != null && p.price > state.max) continue;
      if (!opts.skipSizeColor) {
        if (state.sizes.length && !hasAnySize(p, state.sizes)) continue;
        if (state.colors.length && !hasAnyColor(p, state.colors)) continue;
      }
      out.push(p);
    }
    return out;
  }

  /* ======================================================================
     SORTING
     ====================================================================== */

  function createdAtTs(product) {
    var t = Date.parse(product.created_at || '');
    return isNaN(t) ? 0 : t;
  }

  var SORTS = {
    /* Featured first, then best sellers, then alphabetical. */
    'featured': function (a, b) {
      if (a.is_featured !== b.is_featured) return a.is_featured ? -1 : 1;
      if (a.is_best_seller !== b.is_best_seller) return a.is_best_seller ? -1 : 1;
      return String(a.name).localeCompare(String(b.name));
    },
    'newest':     function (a, b) { return createdAtTs(b) - createdAtTs(a); },
    'price-asc':  function (a, b) { return a.price - b.price; },
    'price-desc': function (a, b) { return b.price - a.price; },
    'name':       function (a, b) { return String(a.name).localeCompare(String(b.name)); }
  };

  /* ======================================================================
     FACETS (size + colour counts, scoped to the current selection)
     ====================================================================== */

  function sizeRank(value) {
    var text = String(value);
    var apparel = APPAREL_ORDER.indexOf(text.toUpperCase());
    if (apparel !== -1) return apparel;                 // XS → XXL
    if (/^\d+$/.test(text)) return 100 + Number(text);  // numeric (28–36, EU shoes)
    if (text.toLowerCase() === 'one size') return 9999; // always last
    return 500;
  }

  function sizeComparator(a, b) {
    var ra = sizeRank(a), rb = sizeRank(b);
    if (ra !== rb) return ra - rb;
    return String(a).localeCompare(String(b));
  }

  function computeFacets() {
    var base = applyFilters(catalog, { skipSizeColor: true });
    if (!base.length) base = catalog.slice();   // fallback: derive from everything

    var sizeCounts = {};
    var sizeOrder = [];
    base.forEach(function (p) {
      (p.sizes || []).forEach(function (s) {
        var key = String(s);
        if (!sizeCounts[key]) { sizeCounts[key] = 0; sizeOrder.push(key); }
        sizeCounts[key]++;
      });
    });
    sizeOrder.sort(sizeComparator);
    facets.sizes = sizeOrder.map(function (s) { return { value: s, count: sizeCounts[s] }; });

    var colorMap = {};
    var colorKeys = [];
    base.forEach(function (p) {
      (p.colors || []).forEach(function (c) {
        var key = String(c.name).toLowerCase();
        if (!colorMap[key]) { colorMap[key] = { value: c.name, hex: c.hex, count: 0 }; colorKeys.push(key); }
        colorMap[key].count++;
      });
    });
    colorKeys.sort(function (a, b) {
      return (colorMap[b].count - colorMap[a].count) || a.localeCompare(b);
    });
    facets.colors = colorKeys.map(function (k) { return colorMap[k]; });
  }

  /* ======================================================================
     FILTER UI (built once, then updated in place on every render)
     ====================================================================== */

  function buildCategoryFilter() {
    // Count via the same audience-aware matcher used for filtering, so the
    // numbers in the sidebar always match what a checkbox will show.
    var counts = {};
    catalog.forEach(function (p) {
      categories.forEach(function (c) {
        if (inCategory(p, c.slug)) counts[c.slug] = (counts[c.slug] || 0) + 1;
      });
    });
    els.categoryList.innerHTML = categories.map(function (c) {
      return '<label class="checkbox-row">' +
        '<input type="checkbox" value="' + esc(c.slug) + '" data-category-checkbox> ' +
        '<span>' + esc(c.name) + '</span>' +
        '<span aria-hidden="true">(' + (counts[c.slug] || 0) + ')</span>' +
        '</label>';
    }).join('');
  }

  function buildSizeAndColorFilters() {
    var sizeOrder = [];
    var seenSizes = {};
    catalog.forEach(function (p) {
      (p.sizes || []).forEach(function (s) {
        var key = String(s);
        if (!seenSizes[key]) { seenSizes[key] = true; sizeOrder.push(key); }
      });
    });
    sizeOrder.sort(sizeComparator);
    els.sizeList.innerHTML = sizeOrder.map(function (s) {
      return '<button type="button" class="size-chip" data-size="' + esc(s) + '" aria-pressed="false" ' +
        'aria-label="Filter by size ' + esc(s) + '">' + esc(s) + '</button>';
    }).join('');

    var colorMap = {};
    var colorKeys = [];
    catalog.forEach(function (p) {
      (p.colors || []).forEach(function (c) {
        var key = String(c.name).toLowerCase();
        if (!colorMap[key]) { colorMap[key] = { value: c.name, hex: c.hex }; colorKeys.push(key); }
      });
    });
    colorKeys.sort(function (a, b) { return a.localeCompare(b); });
    els.colorList.innerHTML = colorKeys.map(function (key) {
      var c = colorMap[key];
      return '<button type="button" class="color-filter" data-color="' + esc(c.value) + '" aria-pressed="false" ' +
        'aria-label="Filter by colour ' + esc(c.value) + '">' +
        '<span class="color-dot" style="background:' + esc(c.hex) + '" aria-hidden="true"></span>' +
        '<span>' + esc(c.value) + '</span>' +
        '<span data-facet-count aria-hidden="true"></span>' +
        '</button>';
    }).join('');
  }

  function updateFacetUI() {
    // Size chips — hide values with nothing to show in the current scope.
    els.sizeList.querySelectorAll('[data-size]').forEach(function (btn) {
      var value = btn.getAttribute('data-size');
      var count = 0;
      facets.sizes.forEach(function (f) { if (f.value === value) count = f.count; });
      var active = state.sizes.indexOf(value) !== -1;
      btn.hidden = count === 0 && !active;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    // Colour rows (dot + name + count).
    els.colorList.querySelectorAll('[data-color]').forEach(function (btn) {
      var value = btn.getAttribute('data-color');
      var count = 0;
      facets.colors.forEach(function (f) {
        if (f.value.toLowerCase() === value.toLowerCase()) count = f.count;
      });
      var active = hasColor(value);
      btn.hidden = count === 0 && !active;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      var countEl = btn.querySelector('[data-facet-count]');
      if (countEl) countEl.textContent = '(' + count + ')';
    });
  }

  function hasColor(name) {
    return state.colors.some(function (c) {
      return c.toLowerCase() === String(name).toLowerCase();
    });
  }

  /* Reflect the state into every static control (checkboxes, inputs…). */
  function syncFilterControls() {
    els.sort.value = state.sort;
    els.priceMin.value = state.min == null ? '' : state.min;
    els.priceMax.value = state.max == null ? '' : state.max;
    els.stock.checked = state.stock;
    els.sale.checked = state.sale;
    els.categoryList.querySelectorAll('[data-category-checkbox]').forEach(function (box) {
      box.checked = state.categories.indexOf(box.value) !== -1;
    });
    updateFacetUI();
    updateFilterToggleCount();
  }

  /* ======================================================================
     RENDER (grid + counts + chips + facets + hero + title)
     ====================================================================== */

  function render() {
    computeFacets();

    var list = applyFilters(catalog, {});
    list.sort(SORTS[state.sort] || SORTS.featured);

    var total = list.length;
    var shown = Math.min(state.page * PAGE_SIZE, total);

    if (!total) {
      els.grid.innerHTML = '';
      els.emptyText.textContent = emptyMessage();
      els.empty.hidden = false;
      els.loadMoreWrap.hidden = true;
    } else {
      els.empty.hidden = true;
      window.VD.products.renderCards(els.grid, list.slice(0, shown));
      els.loadMoreWrap.hidden = shown >= total;
    }

    /* aria-live region — politely announces result changes. */
    els.count.textContent = total ? 'Showing 1–' + shown + ' of ' + total : 'No matching products';
    els.heroCount.textContent = total + (total === 1 ? ' product' : ' products');

    renderActiveChips();
    updateFacetUI();
    els.heroTitle.textContent = heroTitle();
    updateFilterToggleCount();
    document.title = heroTitle() + ' — ' + brandName();
  }

  function emptyMessage() {
    if (!catalog.length) return 'No products are published yet — please check back soon.';
    if (state.q) return 'Nothing matches “' + state.q + '”. Try a different search or clear your filters.';
    return 'No products match your filters. Try removing a filter or two.';
  }

  /* Hero h1 for the special views linked from the header/footer. */
  function heroTitle() {
    if (state.collection) {
      var col = findCollection(state.collection);
      return col ? col.name : 'Collection';
    }
    if (state.tag === 'new-arrivals') return 'New arrivals';
    if (state.tag === 'best-sellers') return 'Best sellers';
    if (state.sale) return 'Sale';
    return 'Shop all';
  }

  function findCollection(slug) {
    for (var i = 0; i < collections.length; i++) {
      if (collections[i].slug === slug) return collections[i];
    }
    return null;
  }

  /* ======================================================================
     ACTIVE FILTER CHIPS (each removable) + CLEAR ALL
     ====================================================================== */

  function chipLabel(key, value) {
    if (key === 'q') return '“' + value + '”';
    if (key === 'category') {
      for (var i = 0; i < categories.length; i++) {
        if (categories[i].slug === value) return categories[i].name;
      }
      return value;
    }
    if (key === 'tag') return value === 'new-arrivals' ? 'New arrivals' : 'Best sellers';
    if (key === 'sale') return 'On sale';
    if (key === 'collection') {
      var col = findCollection(value);
      return col ? col.name : value;
    }
    if (key === 'size') return 'Size: ' + value;
    if (key === 'color') return 'Colour: ' + value;
    if (key === 'min') return 'Min: ' + fmt(Number(value));
    if (key === 'max') return 'Max: ' + fmt(Number(value));
    if (key === 'stock') return 'In stock only';
    return value;
  }

  function renderActiveChips() {
    var chips = [];
    if (state.q) chips.push({ key: 'q', value: state.q });
    state.categories.forEach(function (slug) { chips.push({ key: 'category', value: slug }); });
    if (state.tag) chips.push({ key: 'tag', value: state.tag });
    if (state.sale) chips.push({ key: 'sale', value: '1' });
    if (state.collection) chips.push({ key: 'collection', value: state.collection });
    state.sizes.forEach(function (s) { chips.push({ key: 'size', value: s }); });
    state.colors.forEach(function (c) { chips.push({ key: 'color', value: c }); });
    if (state.min != null) chips.push({ key: 'min', value: String(state.min) });
    if (state.max != null) chips.push({ key: 'max', value: String(state.max) });
    if (state.stock) chips.push({ key: 'stock', value: '1' });

    if (!chips.length) {
      els.active.hidden = true;
      els.active.innerHTML = '';
      return;
    }

    var html = chips.map(function (chip) {
      var label = chipLabel(chip.key, chip.value);
      return '<button type="button" class="chip is-active" data-chip-key="' + esc(chip.key) + '" ' +
        'data-chip-value="' + esc(chip.value) + '" aria-label="Remove filter: ' + esc(label) + '">' +
        esc(label) + ' <span aria-hidden="true">×</span></button>';
    }).join('');
    html += '<button type="button" class="active-filters__clear" id="clear-all-filters">Clear all filters</button>';

    els.active.hidden = false;
    els.active.innerHTML = html;
  }

  function removeFilter(key, value) {
    switch (key) {
      case 'q':          state.q = ''; break;
      case 'category':   state.categories = state.categories.filter(function (s) { return s !== value; }); break;
      case 'tag':        state.tag = null; break;
      case 'sale':       state.sale = false; break;
      case 'collection': state.collection = null; state.collectionSlugs = null; break;
      case 'size':       state.sizes = state.sizes.filter(function (s) { return s !== value; }); break;
      case 'color':      state.colors = state.colors.filter(function (c) { return c.toLowerCase() !== value.toLowerCase(); }); break;
      case 'min':        state.min = null; break;
      case 'max':        state.max = null; break;
      case 'stock':      state.stock = false; break;
    }
    syncFilterControls();
    afterFilterChange();
  }

  /* Sort is a view preference, not a filter — it survives "clear all". */
  function clearAllFilters() {
    state.q = '';
    state.categories = [];
    state.tag = null;
    state.sale = false;
    state.collection = null;
    state.collectionSlugs = null;
    state.sizes = [];
    state.colors = [];
    state.min = null;
    state.max = null;
    state.stock = false;
    syncFilterControls();
    afterFilterChange();
  }

  /* Common tail for every state change: reset paging, share, re-render. */
  function afterFilterChange() {
    state.page = 1;
    writeStateToURL();
    render();
  }

  function activeFilterCount() {
    return (state.q ? 1 : 0) +
      state.categories.length +
      (state.tag ? 1 : 0) +
      (state.sale ? 1 : 0) +
      (state.collection ? 1 : 0) +
      state.sizes.length +
      state.colors.length +
      (state.min != null ? 1 : 0) +
      (state.max != null ? 1 : 0) +
      (state.stock ? 1 : 0);
  }

  function updateFilterToggleCount() {
    var n = activeFilterCount();
    els.toggleCount.textContent = n ? ' (' + n + ')' : '';
  }

  /* ======================================================================
     EVENTS
     ====================================================================== */

  function bindEvents() {
    /* Sort select. */
    els.sort.addEventListener('change', function () {
      state.sort = els.sort.value;
      afterFilterChange();
    });

    /* Category checkboxes. */
    els.categoryList.addEventListener('change', function () {
      var selected = [];
      els.categoryList.querySelectorAll('[data-category-checkbox]').forEach(function (box) {
        if (box.checked) selected.push(box.value);
      });
      state.categories = selected;
      afterFilterChange();
    });

    /* Size chips + colour rows (delegated — the rows are static elements). */
    els.sizeList.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-size]');
      if (!btn) return;
      toggleListValue('sizes', btn.getAttribute('data-size'));
    });
    els.colorList.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-color]');
      if (!btn) return;
      var value = btn.getAttribute('data-color');
      var existing = null;
      state.colors.forEach(function (c) {
        if (c.toLowerCase() === value.toLowerCase()) existing = c;
      });
      if (existing) {
        state.colors = state.colors.filter(function (c) { return c !== existing; });
      } else {
        state.colors.push(value);
      }
      afterFilterChange();
    });

    /* Price — Apply button or Enter inside either input. */
    els.priceApply.addEventListener('click', applyPrice);
    [els.priceMin, els.priceMax].forEach(function (input) {
      input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') { event.preventDefault(); applyPrice(); }
      });
    });

    /* Availability + sale checkboxes. */
    els.stock.addEventListener('change', function () {
      state.stock = els.stock.checked;
      afterFilterChange();
    });
    els.sale.addEventListener('change', function () {
      state.sale = els.sale.checked;
      afterFilterChange();
    });

    /* Active chips + "Clear all filters" (delegated — chips re-render). */
    els.active.addEventListener('click', function (event) {
      if (event.target.closest('#clear-all-filters')) { clearAllFilters(); return; }
      var chip = event.target.closest('[data-chip-key]');
      if (chip) removeFilter(chip.getAttribute('data-chip-key'), chip.getAttribute('data-chip-value') || '');
    });

    /* Pagination. */
    els.loadMore.addEventListener('click', function () {
      state.page++;
      render();
    });

    /* Empty state. */
    els.emptyClear.addEventListener('click', clearAllFilters);

    /* Mobile filters drawer. */
    els.toggle.addEventListener('click', openFilters);
    document.querySelectorAll('[data-filters-close]').forEach(function (el) {
      el.addEventListener('click', closeFilters);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && els.filters.classList.contains('is-open')) closeFilters();
    });
  }

  function toggleListValue(key, value) {
    var list = state[key];
    var index = list.indexOf(value);
    if (index === -1) list.push(value); else list.splice(index, 1);
    afterFilterChange();
  }

  function parsePrice(raw) {
    var text = String(raw == null ? '' : raw).trim();
    if (!text) return null;
    var n = Number(text);
    if (!isFinite(n) || n < 0) return null;
    return Math.round(n * 100) / 100;
  }

  function applyPrice() {
    state.min = parsePrice(els.priceMin.value);
    state.max = parsePrice(els.priceMax.value);
    afterFilterChange();
  }

  /* ======================================================================
     MOBILE FILTERS DRAWER (.is-open on .filters + .filters-backdrop)
     ====================================================================== */

  function openFilters() {
    els.filters.classList.add('is-open');
    els.backdrop.classList.add('is-open');
    els.toggle.setAttribute('aria-expanded', 'true');
    document.body.classList.add('no-scroll');
  }

  function closeFilters() {
    els.filters.classList.remove('is-open');
    els.backdrop.classList.remove('is-open');
    els.toggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('no-scroll');
  }
})();
