/* ==========================================================================
   VOGUE DISTRICT — DATA LAYER (supabase.js)
   --------------------------------------------------------------------------
   Central access point for ALL product / order / settings data.

   Two modes:
     • SUPABASE MODE — when config.js contains a real project URL + key.
       Products, categories, collections, settings, orders, admin actions,
       image uploads and contact/newsletter submissions all talk to Supabase.
     • LOCAL DEMO MODE — when Supabase is not configured yet. The storefront
       is browsable with the bundled demo catalog (demo-data.js). A clear
       banner on every page says that demo mode is active. Writes (orders,
       contact, admin) are refused with an honest setup message — nothing is
       faked.

   The rest of the website ONLY calls functions on `VD.api` below — it never
   talks to Supabase directly, so you can swap the backend in one place.
   ========================================================================== */

(function () {
  'use strict';

  window.VD = window.VD || {};

  var DEMO_BATCH_ID = 'vd-demo-2025-01';          // must match demo-data.js
  var STORAGE_BUCKET = 'product-images';          // Supabase Storage bucket
  var CATALOG_LIMIT = 200;                        // max products fetched for browsing

  /* ----------------------------------------------------------------------
     Detect configuration
     ---------------------------------------------------------------------- */
  function readConfig() {
    var cfg = window.VOGUE_CONFIG || {};
    return {
      url: (cfg.supabase && cfg.supabase.url) || '',
      key: (cfg.supabase && cfg.supabase.publishableKey) || ''
    };
  }

  function isConfigured() {
    var c = readConfig();
    return Boolean(
      c.url && c.key &&
      c.url.indexOf('YOUR_') !== 0 &&
      c.key.indexOf('YOUR_') !== 0 &&
      /^https?:\/\//.test(c.url) &&
      typeof window.supabase !== 'undefined' &&   // supabase-js CDN script
      typeof window.supabase.createClient === 'function'
    );
  }

  var client = null;   // lazily created Supabase client
  function sb() {
    if (!client) {
      var c = readConfig();
      client = window.supabase.createClient(c.url, c.key);
    }
    return client;
  }

  var api = { mode: isConfigured() ? 'supabase' : 'demo', DEMO_BATCH_ID: DEMO_BATCH_ID };
  api.isConfigured = isConfigured;

  var settingsPromise = null;   // cached settings fetch

  /* ========================================================================
     HELPERS
     ======================================================================== */

  function fail(message) {
    throw new Error(message);
  }

  function requireSupabase(what) {
    if (!isConfigured()) {
      var err = new Error(
        'Supabase is not configured yet — ' + what + ' requires a live connection. ' +
        'Add your project URL and publishable key in config.js (see README.md).'
      );
      err.demo = true;
      throw err;
    }
    return sb();
  }

  // Escape text before inserting into HTML templates.
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  api.esc = esc;

  /* Map one database row (+ joined images/variants/category) to the product
     shape used everywhere in the frontend. */
  function mapProduct(row) {
    var images = (row.images || [])
      .slice()
      .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); })
      .map(function (img) { return { url: img.url, alt: img.alt || row.name }; });

    var variants = (row.variants || [])
      .filter(function (v) { return v.is_active !== false; })
      .map(function (v) {
        return {
          id: v.id,
          sku: v.sku,
          size: v.size,
          color: v.color,
          color_hex: v.color_hex || null,
          stock: Number(v.stock_quantity) || 0
        };
      });

    // Distinct colors (in order of appearance) and sizes for the UI.
    var colors = [];
    var seenColors = {};
    variants.forEach(function (v) {
      if (!seenColors[v.color]) {
        seenColors[v.color] = true;
        colors.push({ name: v.color, hex: v.color_hex || '#c9c2b6' });
      }
    });
    var sizes = [];
    var seenSizes = {};
    variants.forEach(function (v) {
      if (!seenSizes[v.size]) { seenSizes[v.size] = true; sizes.push(v.size); }
    });

    var salePrice = row.sale_price == null ? null : Number(row.sale_price);
    var basePrice = Number(row.base_price) || 0;
    var onSale = salePrice != null && salePrice < basePrice;

    var stockTotal = variants.reduce(function (sum, v) { return sum + v.stock; }, 0);

    return {
      id: row.id,
      slug: row.slug,
      sku: row.sku,
      name: row.name,
      description: row.description || '',
      details: row.details || '',
      category_slug: row.category ? row.category.slug : '',
      category_name: row.category ? row.category.name : '',
      audience: row.audience || 'unisex',
      base_price: basePrice,
      sale_price: salePrice,
      price: onSale ? salePrice : basePrice,       // effective price
      is_on_sale: onSale,
      is_published: !!row.is_published,
      is_featured: !!row.is_featured,
      is_new_arrival: !!row.is_new_arrival,
      is_best_seller: !!row.is_best_seller,
      is_demo: !!row.is_demo,
      demo_batch_id: row.demo_batch_id || null,
      cover_image: row.cover_image || (images[0] ? images[0].url : ''),
      images: images,
      colors: colors,
      sizes: sizes,
      variants: variants,
      stock_total: stockTotal,
      created_at: row.created_at
    };
  }

  var PRODUCT_SELECT =
    'id, slug, sku, name, description, details, base_price, sale_price, audience, ' +
    'is_published, is_featured, is_new_arrival, is_best_seller, is_demo, demo_batch_id, ' +
    'cover_image, created_at, category:categories(slug, name), ' +
    'images:product_images(id, url, alt, sort_order), ' +
    'variants:product_variants(id, sku, size, color, color_hex, stock_quantity, is_active)';

  /* ========================================================================
     SETTINGS
     ======================================================================== */

  function configSettings() {
    var cfg = window.VOGUE_CONFIG || {};
    return JSON.parse(JSON.stringify(cfg));   // deep copy — callers may mutate
  }

  api.getSettings = function () {
    if (!isConfigured()) return Promise.resolve(configSettings());
    if (settingsPromise) return settingsPromise;
    settingsPromise = sb()
      .from('store_settings')
      .select('data')
      .eq('id', 1)
      .single()
      .then(function (_a) {
        var data = _a.data;
        var merged = configSettings();
        if (data && typeof data === 'object') {
          Object.keys(data).forEach(function (key) { merged[key] = data[key]; });
        }
        return merged;
      })
      .catch(function () { return configSettings(); });
    return settingsPromise;
  };

  /* ========================================================================
     CATALOG READS (storefront)
     ======================================================================== */

  function demoProducts() {
    var data = window.VD_DEMO_DATA;
    return data && Array.isArray(data.products) ? data.products : [];
  }

  function demoPublished() {
    return demoProducts().filter(function (p) { return p.is_published; });
  }

  function applyDemoLimit(items, opts) {
    opts = opts || {};
    var offset = opts.offset || 0;
    var limit = opts.limit == null ? items.length : opts.limit;
    return { items: items.slice(offset, offset + limit), total: items.length };
  }

  // Full published catalog — the shop page filters, searches and paginates
  // client-side (boutique-scale catalogs; see README "Scaling notes").
  api.getProducts = function (opts) {
    if (!isConfigured()) return Promise.resolve(applyDemoLimit(demoPublished(), opts));
    var query = sb().from('products').select(PRODUCT_SELECT).eq('is_published', true);
    if (opts && opts.limit != null) {
      query = query.range(opts.offset || 0, (opts.offset || 0) + opts.limit - 1);
    } else {
      query = query.limit(CATALOG_LIMIT);
    }
    return query
      .then(function (_a) {
        var data = _a.data, error = _a.error;
        if (error) fail('Could not load products: ' + error.message);
        var items = (data || []).map(mapProduct);
        return { items: items, total: items.length };
      });
  };

  api.getProductBySlug = function (slug) {
    if (!isConfigured()) {
      var found = demoProducts().filter(function (p) { return p.slug === slug; })[0];
      return Promise.resolve(found || null);
    }
    return sb()
      .from('products').select(PRODUCT_SELECT).eq('slug', slug).maybeSingle()
      .then(function (_a) {
        var data = _a.data, error = _a.error;
        if (error) fail('Could not load product: ' + error.message);
        return data ? mapProduct(data) : null;
      });
  };

  api.getProductsBySlugs = function (slugs) {
    if (!slugs || !slugs.length) return Promise.resolve([]);
    if (!isConfigured()) {
      return Promise.resolve(demoPublished().filter(function (p) { return slugs.indexOf(p.slug) !== -1; }));
    }
    return sb()
      .from('products').select(PRODUCT_SELECT).eq('is_published', true).in('slug', slugs).limit(CATALOG_LIMIT)
      .then(function (_a) {
        var data = _a.data, error = _a.error;
        if (error) fail('Could not load products: ' + error.message);
        return (data || []).map(mapProduct);
      });
  };

  api.getCategories = function () {
    if (!isConfigured()) {
      return Promise.resolve((window.VD_DEMO_DATA && window.VD_DEMO_DATA.categories) || []);
    }
    return sb()
      .from('categories').select('id, slug, name, image_url').eq('is_active', true).order('sort_order')
      .then(function (_a) {
        var data = _a.data, error = _a.error;
        if (error) fail('Could not load categories: ' + error.message);
        return data || [];
      });
  };

  api.getCollections = function () {
    if (!isConfigured()) {
      return Promise.resolve((window.VD_DEMO_DATA && window.VD_DEMO_DATA.collections) || []);
    }
    return sb()
      .from('collections')
      .select('id, slug, name, description, image_url, items:collection_products(product:products(slug, name))')
      .eq('is_active', true).order('sort_order')
      .then(function (_a) {
        var data = _a.data, error = _a.error;
        if (error) fail('Could not load collections: ' + error.message);
        return (data || []).map(function (row) {
          return {
            id: row.id, slug: row.slug, name: row.name,
            description: row.description || '', image_url: row.image_url || '',
            product_slugs: (row.items || []).map(function (i) { return i.product && i.product.slug; }).filter(Boolean)
          };
        });
      });
  };

  function byFlag(flag) {
    return function (limit) {
      return api.getProducts().then(function (res) {
        var items = res.items.filter(function (p) { return p[flag]; }).slice(0, limit || 8);
        return items;
      });
    };
  }
  api.getFeatured    = byFlag('is_featured');
  api.getNewArrivals = byFlag('is_new_arrival');
  api.getBestSellers = byFlag('is_best_seller');
  api.getSaleProducts = function (limit) {
    return api.getProducts().then(function (res) {
      return res.items.filter(function (p) { return p.is_on_sale; }).slice(0, limit || 8);
    });
  };

  api.getRelatedProducts = function (product, limit) {
    return api.getProducts().then(function (res) {
      var sameCategory = res.items.filter(function (p) {
        return p.id !== product.id && p.category_slug === product.category_slug;
      });
      if (sameCategory.length >= (limit || 4)) return sameCategory.slice(0, limit || 4);
      var fill = res.items.filter(function (p) {
        return p.id !== product.id && sameCategory.indexOf(p) === -1;
      });
      return sameCategory.concat(fill).slice(0, limit || 4);
    });
  };

  /* ========================================================================
     NEWSLETTER + CONTACT
     ======================================================================== */

  api.subscribeNewsletter = function (email) {
    if (!isConfigured()) {
      return Promise.resolve({
        ok: false,
        demo: true,
        message: 'Local demo mode: newsletter storage needs Supabase. Connect it in config.js to start collecting subscribers.'
      });
    }
    return sb()
      .from('newsletter_subscribers')
      .insert({ email: email })
      .then(function (_a) {
        var error = _a.error;
        if (error) {
          if (error.code === '23505') {
            return { ok: true, message: 'You are already subscribed — thank you!' };
          }
          return { ok: false, message: 'Could not save your subscription: ' + error.message };
        }
        return { ok: true, message: 'Thank you for subscribing!' };
      });
  };

  api.sendContactMessage = function (fields) {
    if (!isConfigured()) {
      return Promise.resolve({ ok: false, demo: true });
    }
    return sb()
      .from('contact_messages')
      .insert({
        name: fields.name,
        email: fields.email,
        subject: fields.subject,
        message: fields.message
      })
      .then(function (_a) {
        var error = _a.error;
        if (error) return { ok: false, message: 'Could not send your message: ' + error.message };
        return { ok: true };
      });
  };

  /* ========================================================================
     ORDER SUBMISSION
     Prices, stock and discounts are validated inside the Supabase
     `place_order` database function (see supabase-schema.sql) — the browser
     never sends totals.
     ======================================================================== */

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  api.submitOrder = function (payload) {
    if (!isConfigured()) {
      return Promise.resolve({
        ok: false,
        demo: true,
        error: 'Local demo mode: order submission requires Supabase. Your cart is safe — connect Supabase in config.js to enable checkout.'
      });
    }
    return sb()
      .rpc('place_order', {
        p_customer: payload.customer,
        p_items: payload.items,                 // [{ variant_id, quantity }]
        p_shipping_method: payload.shipping_method,
        p_promo_code: payload.promo_code || null,
        p_idempotency_key: payload.idempotency_key || uuid()
      })
      .then(function (_a) {
        var data = _a.data, error = _a.error;
        if (error) return { ok: false, error: error.message };
        return { ok: true, order: data };
      });
  };

  api.newIdempotencyKey = uuid;

  /* ========================================================================
     ADMIN — AUTH
     ======================================================================== */

  api.auth = {
    getSession: function () {
      if (!isConfigured()) return Promise.resolve(null);
      return sb().auth.getSession().then(function (_a) {
        var data = _a.data;
        return data && data.session ? data.session : null;
      });
    },
    signIn: function (email, password) {
      requireSupabase('administrator sign-in');
      return sb().auth.signInWithPassword({ email: email, password: password });
    },
    signOut: function () {
      if (!isConfigured()) return Promise.resolve();
      return sb().auth.signOut();
    },
    onChange: function (callback) {
      if (!isConfigured()) return;
      sb().auth.onAuthStateChange(function (_event, session) { callback(session); });
    },
    // True when the signed-in user is listed in the admin_users table.
    // Network/schema errors REJECT (so the admin panel can show a retry),
    // only a clean "not listed" answer resolves false.
    isAdmin: function () {
      if (!isConfigured()) return Promise.resolve(false);
      return sb().rpc('is_admin').then(function (_a) {
        var data = _a.data, error = _a.error;
        if (error) fail('Could not verify administrator status: ' + error.message);
        return data === true;
      });
    }
  };

  /* ========================================================================
     ADMIN — PRODUCTS
     ======================================================================== */

  function adminSb() {
    return requireSupabase('admin actions');
  }

  api.admin = {};

  api.admin.listProducts = function () {
    return adminSb()
      .from('products').select(PRODUCT_SELECT).order('created_at', { ascending: false }).limit(500)
      .then(function (_a) {
        var data = _a.data, error = _a.error;
        if (error) fail('Could not load products: ' + error.message);
        return (data || []).map(mapProduct);
      });
  };

  api.admin.listCategories = function () {
    return adminSb()
      .from('categories').select('id, slug, name').eq('is_active', true).order('sort_order')
      .then(function (_a) { var d = _a.data, e = _a.error; if (e) fail(e.message); return d || []; });
  };

  /* payload = {
       id: null | uuid, name, slug, sku, category_id, description, details,
       base_price, sale_price, is_published, is_featured, is_new_arrival,
       is_best_seller, images: [{url, alt}], variants: [{id?, sku, size, color, color_hex, stock}]
     } */
  api.admin.saveProduct = function (payload) {
    var db = adminSb();
    var row = {
      id: payload.id || undefined,
      name: payload.name,
      slug: payload.slug,
      sku: payload.sku,
      category_id: payload.category_id,
      audience: payload.audience || 'unisex',
      description: payload.description || '',
      details: payload.details || '',
      base_price: payload.base_price,
      sale_price: payload.sale_price === '' || payload.sale_price == null ? null : payload.sale_price,
      is_published: !!payload.is_published,
      is_featured: !!payload.is_featured,
      is_new_arrival: !!payload.is_new_arrival,
      is_best_seller: !!payload.is_best_seller,
      cover_image: (payload.images && payload.images[0] && payload.images[0].url) || ''
    };

    return Promise.resolve(payload.id ? null : db.from('products').upsert(row).select('id').single())
      .then(function (inserted) {
        if (inserted) {
          var _e = inserted.error;
          if (_e) fail('Could not save product: ' + _e.message);
          payload.id = inserted.data.id;
          return null;
        }
        return db.from('products').update(row).eq('id', payload.id)
          .then(function (_a) { var e = _a.error; if (e) fail('Could not save product: ' + e.message); });
      })
      .then(function () {
        // Images: replace the set in one transaction-free but safe sequence —
        // delete rows that disappeared, keep the rest, insert new ones.
        return db.from('product_images').select('id, url').eq('product_id', payload.id)
          .then(function (_a) {
            var existing = (_a.data || []);
            var keepUrls = {};
            (payload.images || []).forEach(function (img) { keepUrls[img.url] = true; });
            var removeIds = existing.filter(function (img) { return !keepUrls[img.url]; }).map(function (img) { return img.id; });
            var chain = removeIds.length
              ? db.from('product_images').delete().in('id', removeIds)
              : Promise.resolve({ error: null });
            return chain.then(function (_b) {
              if (_b.error) fail('Could not update images: ' + _b.error.message);
              var currentUrls = {};
              existing.forEach(function (img) { currentUrls[img.url] = true; });
              var toInsert = (payload.images || [])
                .filter(function (img) { return !currentUrls[img.url]; })
                .map(function (img, index) {
                  return {
                    product_id: payload.id, url: img.url, alt: img.alt || payload.name,
                    sort_order: (payload.images || []).indexOf(img)
                  };
                });
              if (!toInsert.length) return Promise.resolve({ error: null });
              return db.from('product_images').insert(toInsert);
            });
          });
      })
      .then(function (insertResult) {
        if (insertResult && insertResult.error) fail('Could not save images: ' + insertResult.error.message);
        // Variants: rows without an id are new; missing ids are deleted.
        return db.from('product_variants').select('id').eq('product_id', payload.id)
          .then(function (_a) {
            var existingIds = (_a.data || []).map(function (v) { return v.id; });
            var keepIds = (payload.variants || []).filter(function (v) { return v.id; }).map(function (v) { return v.id; });
            var removeIds = existingIds.filter(function (id) { return keepIds.indexOf(id) === -1; });
            var chain = removeIds.length
              ? db.from('product_variants').delete().in('id', removeIds)
              : Promise.resolve({ error: null });
            return chain.then(function (_b) {
              if (_b.error) fail('Could not update variants: ' + _b.error.message);
              var updates = (payload.variants || []).filter(function (v) { return v.id; });
              var inserts = (payload.variants || []).filter(function (v) { return !v.id; }).map(function (v) {
                return {
                  product_id: payload.id, sku: v.sku, size: v.size, color: v.color,
                  color_hex: v.color_hex || null,
                  stock_quantity: Number(v.stock) || 0, is_active: true
                };
              });
              var upserts = Promise.all(updates.map(function (v) {
                return db.from('product_variants').update({
                  sku: v.sku, size: v.size, color: v.color, color_hex: v.color_hex || null,
                  stock_quantity: Number(v.stock) || 0, is_active: true
                }).eq('id', v.id);
              }));
              return Promise.all([
                upserts,
                inserts.length ? db.from('product_variants').insert(inserts) : Promise.resolve({ error: null })
              ]);
            });
          })
          .then(function (results) {
            var insertRes = results[1];
            if (insertRes && insertRes.error) fail('Could not save variants: ' + insertRes.error.message);
            return { id: payload.id };
          });
      });
  };

  api.admin.deleteProduct = function (product) {
    var db = adminSb();
    // Best-effort cleanup of uploaded storage files used by this product.
    var storageUrls = (product.images || [])
      .map(function (i) { return i.url; })
      .filter(function (url) { return url.indexOf('/storage/v1/object/public/' + STORAGE_BUCKET + '/') !== -1; });
    return db.from('products').delete().eq('id', product.id)
      .then(function (_a) {
        var error = _a.error;
        if (error) fail('Could not delete product: ' + error.message);
        return Promise.all(storageUrls.map(function (url) {
          return api.admin.deleteStorageImage(url).catch(function () { /* keep going */ });
        }));
      })
      .then(function () { return { ok: true }; });
  };

  api.admin.setPublished = function (productId, published) {
    return adminSb().from('products').update({ is_published: !!published }).eq('id', productId)
      .then(function (_a) { var e = _a.error; if (e) fail('Could not update product: ' + e.message); return { ok: true }; });
  };

  api.admin.setFlag = function (productId, field, value) {
    var allowed = { is_featured: true, is_new_arrival: true, is_best_seller: true };
    if (!allowed[field]) fail('Unknown flag: ' + field);
    var patch = {}; patch[field] = !!value;
    return adminSb().from('products').update(patch).eq('id', productId)
      .then(function (_a) { var e = _a.error; if (e) fail('Could not update product: ' + e.message); return { ok: true }; });
  };

  /* ========================================================================
     ADMIN — STORAGE (product images)
     ======================================================================== */

  api.admin.uploadImage = function (file, slugPrefix) {
    var db = adminSb();
    var ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    var safeName = (slugPrefix || 'product').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    var pathInBucket = safeName + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    return db.storage.from(STORAGE_BUCKET).upload(pathInBucket, file, {
      cacheControl: '31536000',
      contentType: file.type,
      upsert: false
    }).then(function (_a) {
      var error = _a.error;
      if (error) fail('Upload failed: ' + error.message);
      return db.storage.from(STORAGE_BUCKET).getPublicUrl(pathInBucket).data.publicUrl;
    });
  };

  api.admin.deleteStorageImage = function (publicUrl) {
    var db = adminSb();
    var marker = '/storage/v1/object/public/' + STORAGE_BUCKET + '/';
    var at = publicUrl.indexOf(marker);
    if (at === -1) return Promise.resolve({ ok: true, skipped: true });   // external URL — nothing to delete
    var pathInBucket = publicUrl.slice(at + marker.length).split('?')[0];
    return db.storage.from(STORAGE_BUCKET).remove([pathInBucket]).then(function (_a) {
      var error = _a.error;
      if (error) fail('Could not delete image: ' + error.message);
      return { ok: true };
    });
  };

  /* ========================================================================
     ADMIN — DASHBOARD + ORDERS
     ======================================================================== */

  api.admin.dashboardCounts = function () {
    var db = adminSb();
    return api.admin.listProducts().then(function (products) {
      return db.from('orders').select('id', { count: 'exact', head: true })
        .then(function (_a) {
          var count = _a.count, error = _a.error;
          if (error) fail('Could not count orders: ' + error.message);
          return {
            total: products.length,
            published: products.filter(function (p) { return p.is_published; }).length,
            hidden: products.filter(function (p) { return !p.is_published; }).length,
            outOfStock: products.filter(function (p) { return p.stock_total === 0; }).length,
            demo: products.filter(function (p) { return p.is_demo; }).length,
            orders: count || 0
          };
        });
    });
  };

  api.admin.listOrders = function () {
    return adminSb()
      .from('orders')
      .select('*, items:order_items(id, product_name, variant_sku, size, color, unit_price, quantity, line_total, image_url)')
      .order('created_at', { ascending: false }).limit(200)
      .then(function (_a) {
        var data = _a.data, error = _a.error;
        if (error) fail('Could not load orders: ' + error.message);
        return data || [];
      });
  };

  api.admin.updateOrderStatus = function (orderId, status) {
    return adminSb().from('orders').update({ status: status }).eq('id', orderId)
      .then(function (_a) { var e = _a.error; if (e) fail('Could not update order: ' + e.message); return { ok: true }; });
  };

  api.admin.saveSettings = function (settingsObject) {
    // Upsert so saving works even on a fresh project where the schema was run
    // without the seed (no store_settings row yet).
    return adminSb().from('store_settings')
      .upsert({ id: 1, data: settingsObject, updated_at: new Date().toISOString() })
      .then(function (_a) {
        var e = _a.error;
        if (e) fail('Could not save settings: ' + e.message);
        settingsPromise = null;   // force refetch on next read
        return { ok: true };
      });
  };

  /* ========================================================================
     ADMIN — DEMO DATA TOOLS
     Operate ONLY on rows flagged is_demo + demo_batch_id, so real products,
     orders and customers are never touched.
     ======================================================================== */

  function demoStatus() {
    return adminSb()
      .from('products').select('id', { count: 'exact', head: true })
      .eq('is_demo', true).eq('demo_batch_id', DEMO_BATCH_ID)
      .then(function (_a) {
        var count = _a.count, error = _a.error;
        if (error) fail('Could not check demo status: ' + error.message);
        return { count: count || 0, batchId: DEMO_BATCH_ID };
      });
  }
  api.admin.demoStatus = demoStatus;

  function insertDemoProduct(db, categoryIdBySlug, product) {
    return db.from('products').upsert({
      slug: product.slug, sku: product.sku, name: product.name,
      description: product.description, details: product.details,
      category_id: categoryIdBySlug[product.category_slug] || null,
      audience: product.audience || 'unisex',
      base_price: product.base_price, sale_price: product.sale_price,
      is_published: true,
      is_featured: product.is_featured, is_new_arrival: product.is_new_arrival,
      is_best_seller: product.is_best_seller,
      is_demo: true, demo_batch_id: DEMO_BATCH_ID,
      cover_image: product.cover_image
    }, { onConflict: 'slug' }).select('id').single()
      .then(function (_a) {
        var data = _a.data, error = _a.error;
        if (error) fail('Could not insert "' + product.name + '": ' + error.message);
        var productId = data.id;
        var images = (product.images || []).map(function (img, index) {
          return { product_id: productId, url: img.url, alt: img.alt || product.name, sort_order: index };
        });
        var variants = (product.variants || []).map(function (v) {
          return {
            product_id: productId, sku: v.sku, size: v.size, color: v.color,
            color_hex: v.color_hex || null, stock_quantity: v.stock, is_active: true
          };
        });
        return Promise.all([
          images.length ? db.from('product_images').insert(images) : Promise.resolve({ error: null }),
          variants.length ? db.from('product_variants').insert(variants) : Promise.resolve({ error: null })
        ]).then(function (results) {
          if (results[0].error || results[1].error) {
            // Roll this product back so a retry starts clean.
            return db.from('products').delete().eq('id', productId).then(function () {
              fail('Could not save images/variants for "' + product.name + '"');
            });
          }
          return 1;
        });
      })
      .catch(function (err) {
        // Compensating cleanup: remove a half-inserted demo product, then rethrow.
        return db.from('products').delete().eq('slug', product.slug).eq('is_demo', true)
          .then(function () { throw err; });
      });
  }

  api.admin.loadDemoData = function () {
    var db = adminSb();
    var source = window.VD_DEMO_DATA;
    if (!source || !Array.isArray(source.products) || !source.products.length) {
      return Promise.reject(new Error('Bundled demo data (demo-data.js) could not be found.'));
    }
    var categoryIdBySlug = {};
    return db.from('categories').select('id, slug')
      .then(function (_a) {
        var cats = _a.data || [];
        cats.forEach(function (c) { categoryIdBySlug[c.slug] = c.id; });
        return db.from('products').select('slug, is_demo').in('slug', source.products.map(function (p) { return p.slug; }));
      })
      .then(function (_a) {
        var existing = _a.data || [];
        var existingSlugs = {};
        existing.forEach(function (row) { existingSlugs[row.slug] = row.is_demo; });
        var report = { added: 0, skipped: 0, failed: 0, errors: [] };
        var chain = Promise.resolve();
        source.products.forEach(function (product) {
          if (existingSlugs.hasOwnProperty(product.slug)) {
            report.skipped++;   // slug already used by real or demo data — never overwrite
            return;
          }
          chain = chain.then(function () {
            return insertDemoProduct(db, categoryIdBySlug, product)
              .then(function () { report.added++; })
              .catch(function (err) { report.failed++; report.errors.push(err.message); });
          });
        });
        return chain.then(function () { return report; });
      });
  };

  function removeDemoData(db) {
    // 1) demo orders + their items (FK cascade removes order_items)
    // 2) demo products (+ variants/images via FK cascade)
    return db.from('orders').select('id', { count: 'exact', head: true }).eq('is_demo', true)
      .then(function (_a) {
        var demoOrders = _a.count || 0;
        return db.from('orders').delete().eq('is_demo', true).then(function (_b) {
          if (_b.error) fail('Could not remove demo orders: ' + _b.error.message);
          return db.from('products').delete().eq('is_demo', true).eq('demo_batch_id', DEMO_BATCH_ID)
            .then(function (_c) {
              if (_c.error) fail('Could not remove demo products: ' + _c.error.message);
              return { ordersRemoved: demoOrders };
            });
        });
      });
  }

  api.admin.removeDemoData = function () {
    var db = adminSb();
    return demoStatus().then(function (status) {
      if (!status.count) return { productsRemoved: 0, ordersRemoved: 0 };
      return removeDemoData(db).then(function (res) {
        return { productsRemoved: status.count, ordersRemoved: res.ordersRemoved };
      });
    });
  };

  api.admin.replaceDemoData = function () {
    var db = adminSb();
    return api.admin.removeDemoData().then(function () { return api.admin.loadDemoData(); });
  };

  api.admin.resetDemoStore = function () {
    var db = adminSb();
    return api.admin.removeDemoData()
      .then(function () {
        // Restore template default settings (real products/orders stay untouched).
        var cfg = window.VOGUE_CONFIG || {};
        return db.from('store_settings').upsert({ id: 1, data: cfg, updated_at: new Date().toISOString() });
      })
      .then(function () { return api.admin.loadDemoData(); });
  };

  /* Expose mode info for the setup banner in main.js */
  window.VD.api = api;                 // ← the public data layer
  api.DEMO_MODE = !isConfigured();

})();
