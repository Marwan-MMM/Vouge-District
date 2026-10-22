/* ==========================================================================
   VOGUE DISTRICT — DEMO CATALOG (demo-data.js)
   --------------------------------------------------------------------------
   The bundled demo catalog that powers LOCAL DEMO MODE: when config.js has
   no real Supabase project yet, the storefront is browsable with the 30
   products below (9 categories, 3 curated collections).

   This file is a classic browser script (no modules) that is ALSO safe to
   evaluate under Bun / Node — tools/generate-seed.mjs reads it to produce
   public/supabase-seed.sql, so the SQL seed and the storefront demo always
   show exactly the same catalog.

   Rules baked into the data (from agent-ctx/product-spec.md):
     • Every product has at least ONE sold-out variant (disabled states).
     • The only fully sold-out product is `arlo-suede-loafers` (a demo of an
       out-of-stock product page).
     • Variant stock is deterministic (0–18) so page loads and seed files
       always agree.
   ========================================================================== */

var VD_DEMO_DATA = (function () {
  'use strict';

  /* ======================================================================
     CONSTANTS
     ====================================================================== */

  var BATCH_ID = 'vd-demo-2025-01';        // must match supabase.js DEMO_BATCH_ID

  // The deliberate "everything is gone" demo product (spec rule).
  var SOLD_OUT_SLUG = 'arlo-suede-loafers';

  // Category slug → display name (canonical taxonomy from the spec).
  var CATEGORY_NAME = {
    'women':            'Women',
    'men':              'Men',
    'dresses':          'Dresses',
    'tops-shirts':      'Tops & Shirts',
    'trousers-jeans':   'Trousers & Jeans',
    'knitwear':         'Knitwear',
    'outerwear':        'Outerwear',
    'shoes':            'Shoes',
    'bags-accessories': 'Bags & Accessories'
  };

  /* ======================================================================
     SMALL HELPERS
     ====================================================================== */

  // 'Ecru Wash' -> 'ecru-wash'  (used for variant ids)
  function slugify(value) {
    return String(value).toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // 'Ecru Wash' -> 'ECR'  (first 3 letters of the color, for variant SKUs)
  function colorCode(name) {
    return String(name).replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
  }

  // 'One Size' -> 'OS', 'XS' -> 'XS', '28' -> '28'  (size part of variant SKUs)
  function sizeCode(size) {
    return size === 'One Size' ? 'OS' : String(size).toUpperCase();
  }

  // Deterministic pseudo stock (3–18). Same numbers on every machine and
  // every run — the seed file and the browser demo stay perfectly in sync.
  function shelfStock(productNumber, colorIndex, sizeIndex) {
    return 3 + ((productNumber * 7 + colorIndex * 13 + sizeIndex * 5) % 16);
  }

  /* Expand one product's colors × sizes into purchasable variants.
     Guarantees:
       • exactly one row per color × size combination,
       • stock between 0 and 18,
       • at least one sold-out variant (the last color's first size),
       • `arlo-suede-loafers` is sold out everywhere (spec demo rule). */
  function makeVariants(def) {
    var rows = [];
    var productNumber = parseInt(def.id.slice(1), 10);   // 'p07' -> 7

    def.colors.forEach(function (color, colorIndex) {
      def.sizes.forEach(function (size, sizeIndex) {
        var stock;

        if (def.slug === SOLD_OUT_SLUG) {
          stock = 0;                       // the intentional empty product
        } else {
          stock = shelfStock(productNumber, colorIndex, sizeIndex);
          // The last color's first size is the guaranteed sold-out shelf.
          if (colorIndex === def.colors.length - 1 && sizeIndex === 0) {
            stock = 0;
          }
        }

        rows.push({
          id:       def.id + '-' + slugify(color.name) + '-' + slugify(size),
          sku:      def.sku + '-' + colorCode(color.name) + '-' + sizeCode(size),
          size:     size,
          color:    color.name,
          color_hex: color.hex,
          stock:    stock
        });
      });
    });

    return rows;
  }

  /* Build one final Product object (exact shape from the spec) out of a
     short, readable definition and push it onto the catalog. */
  var products = [];
  function product(def) {
    var variants = makeVariants(def);

    var stockTotal = 0;
    variants.forEach(function (v) { stockTotal += v.stock; });

    // Safety net: no accidentally empty products (arlo is the only intended
    // one). If arithmetic ever empties a shelf, restock its first variant.
    if (stockTotal === 0 && def.slug !== SOLD_OUT_SLUG && variants.length) {
      variants[0].stock = 5;
      stockTotal = 5;
    }

    var isOnSale = def.sale_price != null && def.sale_price < def.base_price;

    products.push({
      id:              def.id,
      slug:            def.slug,
      sku:             def.sku,
      name:            def.name,
      description:     def.description,
      details:         def.details,
      category_slug:   def.category_slug,
      category_name:   CATEGORY_NAME[def.category_slug],
      audience:        AUDIENCE[def.id] || 'unisex',
      base_price:      def.base_price,
      sale_price:      def.sale_price == null ? null : def.sale_price,
      price:           isOnSale ? def.sale_price : def.base_price,
      is_on_sale:      isOnSale,
      is_published:    true,
      is_featured:     !!def.is_featured,
      is_new_arrival:  !!def.is_new_arrival,
      is_best_seller:  !!def.is_best_seller,
      is_demo:         true,
      demo_batch_id:   BATCH_ID,
      cover_image:     def.images[0].url,
      images:          def.images,
      colors:          def.colors,
      sizes:           def.sizes,
      variants:        variants,
      stock_total:     stockTotal,
      created_at:      def.created_at
    });
  }

  /* ======================================================================
     AUDIENCE FACET — "Women" / "Men" are how shoppers actually browse, but
     a dress is filed under "Dresses". The audience field lets the shop's
     Women/Men category filters match specialised categories too.
     ====================================================================== */
  var AUDIENCE = {
    p01: 'women',   p02: 'women',   p03: 'women',   p04: 'women',   p05: 'women',
    p06: 'women',   p07: 'women',   p08: 'women',   p09: 'women',   p10: 'women',
    p11: 'men',     p12: 'men',     p13: 'men',     p14: 'men',     p15: 'men',
    p16: 'men',     p17: 'women',   p18: 'men',     p19: 'unisex',  p20: 'unisex',
    p21: 'unisex',  p22: 'women',   p23: 'women',   p24: 'women',   p25: 'men',
    p26: 'women',   p27: 'men',     p28: 'women',   p29: 'women',   p30: 'men'
  };

  /* ======================================================================
     CATEGORIES (9) — taxonomy from the spec, each with a demo photo
     ====================================================================== */

  var categories = [
    { id: 'c-women',            slug: 'women',            name: 'Women',              image_url: './p02-aurelia-slip-dress.jpg' },
    { id: 'c-men',              slug: 'men',              name: 'Men',                image_url: './p13-bram-wool-coat.jpg' },
    { id: 'c-dresses',          slug: 'dresses',          name: 'Dresses',            image_url: './p01-sienna-wrap-dress.jpg' },
    { id: 'c-tops-shirts',      slug: 'tops-shirts',      name: 'Tops & Shirts',      image_url: './p07-noor-oversized-shirt.jpg' },
    { id: 'c-trousers-jeans',   slug: 'trousers-jeans',   name: 'Trousers & Jeans',   image_url: './p08-wren-trousers.jpg' },
    { id: 'c-knitwear',         slug: 'knitwear',         name: 'Knitwear',           image_url: './p04-celine-cashmere-cardigan.jpg' },
    { id: 'c-outerwear',        slug: 'outerwear',        name: 'Outerwear',          image_url: './p03-marlowe-linen-blazer.jpg' },
    { id: 'c-shoes',            slug: 'shoes',            name: 'Shoes',              image_url: './p17-juno-ankle-boots.jpg' },
    { id: 'c-bags-accessories', slug: 'bags-accessories', name: 'Bags & Accessories', image_url: './p09-talia-leather-tote.jpg' }
  ];

  /* ======================================================================
     COLLECTIONS (3) — curated edits, referenced by product slug
     ====================================================================== */

  var collections = [
    {
      id: 'col-autumn',
      slug: 'autumn-layers',
      name: 'Autumn Layers',
      description: 'Warm knits, tailored coats and leather — the pieces that carry you from the first cold morning to the last golden afternoon.',
      image_url: 'images/editorial/campaign-1.jpg',
      product_slugs: [
        'bram-tailored-wool-coat',
        'celine-cashmere-cardigan',
        'atlas-merino-crew-sweater',
        'idris-cashmere-scarf',
        'juno-leather-ankle-boots'
      ]
    },
    {
      id: 'col-evening',
      slug: 'evening-edit',
      name: 'Evening Edit',
      description: 'Silk, rib and shine — a short list of pieces that turn an ordinary evening into an occasion.',
      image_url: 'images/editorial/campaign-2.jpg',
      product_slugs: [
        'aurelia-silk-slip-dress',
        'amara-ribbed-midi-dress',
        'nia-silk-scarf',
        'selma-woven-leather-clutch',
        'rhea-ankle-strap-flats'
      ]
    },
    {
      id: 'col-everyday',
      slug: 'everyday-essentials',
      name: 'Everyday Essentials',
      description: 'The hardworking staples behind every good outfit — shirts, knits and trousers made to be lived in.',
      image_url: 'images/editorial/brand-story.jpg',
      product_slugs: [
        'livia-ribbed-knit-top',
        'noor-oversized-cotton-shirt',
        'wren-wide-leg-trousers',
        'rowan-oxford-shirt',
        'hayes-relaxed-chinos'
      ]
    }
  ];

  /* ======================================================================
     PRODUCTS (30) — canonical catalog from agent-ctx/product-spec.md
     Dates: new arrivals sit at the top of Nov 2025, everything else is
     staggered across October so "newest first" sorting is meaningful.
     ====================================================================== */

  /* 1 — Sienna Belted Wrap Dress · dresses · featured + bestseller */
  product({
    id: 'p01', slug: 'sienna-belted-wrap-dress', sku: 'VD-DRS-001',
    name: 'Sienna Belted Wrap Dress',
    description: 'A fluid wrap dress cut to tie neatly at the waist and fall into a soft A-line skirt. The belted silhouette flatters without ever feeling fussy, making it as right for the office as for dinner afterwards.',
    details: '72% viscose, 28% linen. Machine wash cold on a gentle cycle, hang to dry, warm iron if needed. True to size with a defined waist — Maya is 178 cm and wears size S.',
    category_slug: 'dresses',
    base_price: 128.00, sale_price: null,
    is_featured: true, is_best_seller: true,
    images: [
      { url: './p01-sienna-wrap-dress.jpg', alt: 'Sienna Belted Wrap Dress in camel worn by a model' }
    ],
    colors: [
      { name: 'Camel', hex: '#B8814F' },
      { name: 'Black', hex: '#201D1B' }
    ],
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    created_at: '2025-10-01T09:00:00Z'
  });

  /* 2 — Aurelia Silk Slip Dress · dresses · featured + on sale */
  product({
    id: 'p02', slug: 'aurelia-silk-slip-dress', sku: 'VD-DRS-002',
    name: 'Aurelia Silk Slip Dress',
    description: 'Our signature slip dress in washed silk that catches the light with every step. Cut on the bias so it skims rather than clings, with delicate adjustable straps for a personal fit.',
    details: '100% sandwashed silk. Dry clean recommended, or hand wash cold with silk detergent and hang to dry. Bias cut runs true — Ines is 175 cm and wears size XS.',
    category_slug: 'dresses',
    base_price: 148.00, sale_price: 112.00,
    is_featured: true,
    images: [
      { url: './p02-aurelia-slip-dress.jpg', alt: 'Aurelia Silk Slip Dress in ivory worn by a model' }
    ],
    colors: [
      { name: 'Ivory', hex: '#F1EAD8' },
      { name: 'Sage',  hex: '#A8B096' }
    ],
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    created_at: '2025-10-03T10:00:00Z'
  });

  /* 3 — Marlowe Linen Blazer · outerwear · new arrival */
  product({
    id: 'p03', slug: 'marlowe-linen-blazer', sku: 'VD-OTW-003',
    name: 'Marlowe Linen Blazer',
    description: 'An unstructured blazer in breathable linen, softened by a single-button closure and gently padded shoulders. Throw it over anything: it makes a plain white tee look deliberate.',
    details: '55% linen, 45% viscose; body lined in cotton twill. Dry clean only. Relaxed fit — size down for a closer cut; Maya is 178 cm and wears size S.',
    category_slug: 'outerwear',
    base_price: 186.00, sale_price: null,
    is_new_arrival: true,
    images: [
      { url: './p03-marlowe-linen-blazer.jpg', alt: 'Marlowe Linen Blazer in sand worn by a model' }
    ],
    colors: [
      { name: 'Sand',  hex: '#D6C7A9' },
      { name: 'Black', hex: '#201D1B' }
    ],
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    created_at: '2025-11-04T11:30:00Z'
  });

  /* 4 — Celine Cashmere Cardigan · knitwear · featured + bestseller */
  product({
    id: 'p04', slug: 'celine-cashmere-cardigan', sku: 'VD-KNT-004',
    name: 'Celine Cashmere Cardigan',
    description: 'The cardigan we re-order season after season, knitted in grade-A cashmere with mother-of-pearl buttons. Wear it buttoned as a top or open over a slip dress.',
    details: '100% grade-A cashmere. Hand wash cold with cashmere shampoo, dry flat, de-pill gently after wear. Classic fit — Lea is 172 cm and wears size S.',
    category_slug: 'knitwear',
    base_price: 164.00, sale_price: null,
    is_featured: true, is_best_seller: true,
    images: [
      { url: './p04-celine-cashmere-cardigan.jpg', alt: 'Celine Cashmere Cardigan in oat worn by a model' },
      { url: 'images/editorial/campaign-2.jpg', alt: 'Editorial: oat cashmere cardigan styled with an ivory silk slip dress' }
    ],
    colors: [
      { name: 'Oat',      hex: '#D9CDB4' },
      { name: 'Charcoal', hex: '#3B3835' }
    ],
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    created_at: '2025-10-05T09:30:00Z'
  });

  /* 5 — Odette Pleated Midi Skirt · women · on sale */
  product({
    id: 'p05', slug: 'odette-pleated-midi-skirt', sku: 'VD-WMN-005',
    name: 'Odette Pleated Midi Skirt',
    description: 'Knife pleats fall from a smooth waistband into a midi skirt that moves beautifully. The satin finish dresses it up; a knit and sneakers dress it down.',
    details: '100% recycled polyester satin. Machine wash cold, hang to dry — the pleats need no ironing. Elastic-back waistband runs true; Ines is 175 cm and wears size XS.',
    category_slug: 'women',
    base_price: 98.00, sale_price: 79.00,
    images: [
      { url: './p05-odette-pleated-skirt.jpg', alt: 'Odette Pleated Midi Skirt in champagne worn by a model' }
    ],
    colors: [
      { name: 'Champagne', hex: '#E4D3B2' },
      { name: 'Black',     hex: '#201D1B' }
    ],
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    created_at: '2025-10-07T10:15:00Z'
  });

  /* 6 — Livia Ribbed Knit Top · tops & shirts · new arrival */
  product({
    id: 'p06', slug: 'livia-ribbed-knit-top', sku: 'VD-TOP-006',
    name: 'Livia Ribbed Knit Top',
    description: 'A second-skin ribbed top with long sleeves and a quietly elegant scoop neck. It layers under blazers and stands alone with high-rise trousers.',
    details: '95% cotton, 5% elastane rib. Machine wash cold, dry flat to keep its shape. Snug, stretchy fit — Maya is 178 cm and wears size S.',
    category_slug: 'tops-shirts',
    base_price: 64.00, sale_price: null,
    is_new_arrival: true,
    images: [
      { url: './p06-livia-ribbed-top.jpg', alt: 'Livia Ribbed Knit Top in cream worn by a model' }
    ],
    colors: [
      { name: 'Cream',    hex: '#F2ECDD' },
      { name: 'Espresso', hex: '#4B382B' }
    ],
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    created_at: '2025-11-06T09:15:00Z'
  });

  /* 7 — Noor Oversized Cotton Shirt · tops & shirts */
  product({
    id: 'p07', slug: 'noor-oversized-cotton-shirt', sku: 'VD-TOP-007',
    name: 'Noor Oversized Cotton Shirt',
    description: 'Crisp poplin cut generously through the body with a soft, unlined collar. Button it closed for work; wear it open over a tank for the weekend.',
    details: '100% organic cotton poplin, garment-washed for softness. Machine wash warm, iron on medium. Oversized fit — take your usual size; Lea is 172 cm and wears size S.',
    category_slug: 'tops-shirts',
    base_price: 84.00, sale_price: null,
    images: [
      { url: './p07-noor-oversized-shirt.jpg', alt: 'Noor Oversized Cotton Shirt in white worn by a model' }
    ],
    colors: [
      { name: 'White', hex: '#FAFAF7' },
      { name: 'Sand',  hex: '#D6C7A9' }
    ],
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    created_at: '2025-10-09T09:45:00Z'
  });

  /* 8 — Wren High-Rise Wide-Leg Trousers · trousers & jeans · bestseller */
  product({
    id: 'p08', slug: 'wren-wide-leg-trousers', sku: 'VD-TRW-008',
    name: 'Wren High-Rise Wide-Leg Trousers',
    description: 'High-rise trousers tailored with a long, clean wide leg and a hidden hook closure. Pressed creases keep them sharp from morning to evening.',
    details: '64% viscose, 34% polyamide, 2% elastane. Machine wash cold on gentle, hang to dry, press the crease with a warm iron. Sits at the natural waist with a full-length leg — Maya is 178 cm and wears size S.',
    category_slug: 'trousers-jeans',
    base_price: 112.00, sale_price: null,
    is_best_seller: true,
    images: [
      { url: './p08-wren-trousers.jpg', alt: 'Wren High-Rise Wide-Leg Trousers in black worn by a model' }
    ],
    colors: [
      { name: 'Black', hex: '#201D1B' },
      { name: 'Stone', hex: '#CFC5B4' }
    ],
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    created_at: '2025-10-11T10:00:00Z'
  });

  /* 9 — Talia Leather Tote · bags & accessories · featured + on sale */
  product({
    id: 'p09', slug: 'talia-leather-tote', sku: 'VD-BAG-009',
    name: 'Talia Leather Tote',
    description: 'A structured tote in full-grain leather that softens beautifully with use. It fits a 14-inch laptop, a water bottle and everything the day adds.',
    details: 'Full-grain vegetable-tanned leather, cotton twill lining, brass feet. Wipe with a soft dry cloth and condition twice a year. 38 × 28 × 12 cm with a 24 cm handle drop. One size.',
    category_slug: 'bags-accessories',
    base_price: 198.00, sale_price: 159.00,
    is_featured: true,
    images: [
      { url: './p09-talia-leather-tote.jpg', alt: 'Talia Leather Tote in tan standing on a stone plinth' }
    ],
    colors: [
      { name: 'Tan',   hex: '#B07B4F' },
      { name: 'Black', hex: '#201D1B' }
    ],
    sizes: ['One Size'],
    created_at: '2025-10-13T11:20:00Z'
  });

  /* 10 — Elena Knit Midi Dress · dresses · new arrival */
  product({
    id: 'p10', slug: 'elena-knit-midi-dress', sku: 'VD-DRS-010',
    name: 'Elena Knit Midi Dress',
    description: 'A fine-rib knit dress that traces the body to a midi hem with softly draped sleeves. Warm enough for autumn days, elegant enough for evenings.',
    details: '60% viscose, 25% polyamide, 15% wool. Hand wash cold, dry flat. Body-skimming fit with gentle stretch — Ines is 175 cm and wears size XS.',
    category_slug: 'dresses',
    base_price: 136.00, sale_price: null,
    is_new_arrival: true,
    images: [
      { url: './p10-elena-knit-dress.jpg', alt: 'Elena Knit Midi Dress in mocha worn by a model' }
    ],
    colors: [
      { name: 'Mocha', hex: '#8A6A52' },
      { name: 'Ivory', hex: '#F1EAD8' }
    ],
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    created_at: '2025-11-08T10:30:00Z'
  });

  /* 11 — Atlas Merino Crew Sweater · knitwear · featured + bestseller */
  product({
    id: 'p11', slug: 'atlas-merino-crew-sweater', sku: 'VD-KNT-011',
    name: 'Atlas Merino Crew Sweater',
    description: 'Fine-gauge merino in a clean crew neck — the sweater that quietly goes with everything. Lightweight enough to layer, warm enough on its own.',
    details: '100% extra-fine merino wool. Machine wash cold on the wool cycle, dry flat. Regular fit — Jonas is 182 cm and wears size M.',
    category_slug: 'knitwear',
    base_price: 124.00, sale_price: null,
    is_featured: true, is_best_seller: true,
    images: [
      { url: './p11-atlas-merino-sweater.jpg', alt: 'Atlas Merino Crew Sweater in oatmeal worn by a model' }
    ],
    colors: [
      { name: 'Oatmeal', hex: '#E0D6BF' },
      { name: 'Forest',  hex: '#44523F' }
    ],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    created_at: '2025-10-15T09:30:00Z'
  });

  /* 12 — Rowan Oxford Shirt · tops & shirts · bestseller */
  product({
    id: 'p12', slug: 'rowan-oxford-shirt', sku: 'VD-TOP-012',
    name: 'Rowan Oxford Shirt',
    description: 'An oxford shirt woven in a classic basket weave, cut a touch trimmer than our oversized styles. The collar holds its shape without feeling stiff.',
    details: '100% organic cotton oxford. Machine wash warm, tumble dry low, iron while damp for a crisp finish. Tailored fit — Jonas is 182 cm and wears size M.',
    category_slug: 'tops-shirts',
    base_price: 92.00, sale_price: null,
    is_best_seller: true,
    images: [
      { url: './p12-rowan-oxford-shirt.jpg', alt: 'Rowan Oxford Shirt in white worn by a model' }
    ],
    colors: [
      { name: 'White', hex: '#FAFAF7' },
      { name: 'Olive', hex: '#6B6B4A' }
    ],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    created_at: '2025-10-17T10:40:00Z'
  });

  /* 13 — Bram Tailored Wool Coat · outerwear · featured + on sale */
  product({
    id: 'p13', slug: 'bram-tailored-wool-coat', sku: 'VD-OTW-013',
    name: 'Bram Tailored Wool Coat',
    description: 'A single-breasted overcoat in Italian wool with a notch lapel and a knee-grazing length. Fully lined, it slips easily over knitwear without bulk.',
    details: '80% virgin wool, 20% recycled polyamide; lined in viscose. Dry clean only. Straight fit designed to layer — Jonas is 182 cm and wears size M.',
    category_slug: 'outerwear',
    base_price: 286.00, sale_price: 229.00,
    is_featured: true,
    images: [
      { url: './p13-bram-wool-coat.jpg', alt: 'Bram Tailored Wool Coat in charcoal worn by a model' },
      { url: 'images/editorial/campaign-1.jpg', alt: 'Editorial: tailored wool coat worn through a sunlit gallery' }
    ],
    colors: [
      { name: 'Charcoal', hex: '#3B3835' },
      { name: 'Camel',    hex: '#B8814F' }
    ],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    created_at: '2025-10-19T09:10:00Z'
  });

  /* 14 — Hayes Relaxed Chinos · trousers & jeans · new arrival */
  product({
    id: 'p14', slug: 'hayes-relaxed-chinos', sku: 'VD-TRW-014',
    name: 'Hayes Relaxed Chinos',
    description: 'Chinos with an easy, relaxed leg and a garment-dyed finish that gives them a lived-in look from day one. A drawstring waist keeps long flights comfortable.',
    details: '98% cotton twill, 2% elastane; garment-dyed. Machine wash cold inside out, tumble dry low. Relaxed straight fit — Noa is 180 cm and wears size 32.',
    category_slug: 'trousers-jeans',
    base_price: 96.00, sale_price: null,
    is_new_arrival: true,
    images: [
      { url: './p14-hayes-chinos.jpg', alt: 'Hayes Relaxed Chinos in beige worn by a model' }
    ],
    colors: [
      { name: 'Beige', hex: '#D6C7A9' },
      { name: 'Olive', hex: '#6B6B4A' }
    ],
    sizes: ['28', '30', '32', '34', '36'],
    created_at: '2025-11-10T14:20:00Z'
  });

  /* 15 — Miles Heavy Knit Polo · tops & shirts */
  product({
    id: 'p15', slug: 'miles-heavy-knit-polo', sku: 'VD-TOP-015',
    name: 'Miles Heavy Knit Polo',
    description: 'A knitted polo in a substantial gauge, with a soft collar and a three-button placket. It reads smart with trousers and easy with denim.',
    details: '70% cotton, 30% wool blend knit. Hand wash cold, dry flat. Regular fit — Elif is 179 cm and wears size M.',
    category_slug: 'tops-shirts',
    base_price: 108.00, sale_price: null,
    images: [
      { url: './p15-miles-knit-polo.jpg', alt: 'Miles Heavy Knit Polo in ecru worn by a model' }
    ],
    colors: [
      { name: 'Ecru',    hex: '#EDE4D2' },
      { name: 'Tobacco', hex: '#8A5A3B' }
    ],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    created_at: '2025-10-21T10:25:00Z'
  });

  /* 16 — Colton Leather Belt · bags & accessories */
  product({
    id: 'p16', slug: 'colton-leather-belt', sku: 'VD-BAG-016',
    name: 'Colton Leather Belt',
    description: 'A full-grain leather belt with a solid brass buckle that patinas with age. Dressy enough for tailoring, sturdy enough for weekends.',
    details: 'Full-grain vegetable-tanned leather with a solid brass buckle, 3.5 cm wide. Wipe clean and store rolled. Sized to your trouser waist — order your usual size.',
    category_slug: 'bags-accessories',
    base_price: 58.00, sale_price: null,
    images: [
      { url: './p16-colton-leather-belt.jpg', alt: 'Colton Leather Belt in brown coiled on an ivory surface' }
    ],
    colors: [
      { name: 'Brown', hex: '#6E4A2E' },
      { name: 'Black', hex: '#201D1B' }
    ],
    sizes: ['S', 'M', 'L'],
    created_at: '2025-10-23T09:55:00Z'
  });

  /* 17 — Juno Leather Ankle Boots · shoes · featured + bestseller */
  product({
    id: 'p17', slug: 'juno-leather-ankle-boots', sku: 'VD-SHO-017',
    name: 'Juno Leather Ankle Boots',
    description: 'Ankle boots in smooth leather on a low block heel you can walk in all day. Elastic side panels make them effortless to pull on and off.',
    details: 'Full-grain leather upper and lining, leather sole with a rubber heel tap, 4 cm block heel. Protect with leather spray before first wear. True to size — between sizes, take the smaller one.',
    category_slug: 'shoes',
    base_price: 214.00, sale_price: null,
    is_featured: true, is_best_seller: true,
    images: [
      { url: './p17-juno-ankle-boots.jpg', alt: 'Juno Leather Ankle Boots in black on a stone plinth' }
    ],
    colors: [
      { name: 'Black', hex: '#201D1B' },
      { name: 'Tan',   hex: '#B07B4F' }
    ],
    sizes: ['36', '37', '38', '39', '40', '41'],
    created_at: '2025-10-25T10:05:00Z'
  });

  /* 18 — Arlo Suede Loafers · shoes · new arrival · SOLD OUT everywhere
     (intentional demo of an out-of-stock product — see spec rules) */
  product({
    id: 'p18', slug: 'arlo-suede-loafers', sku: 'VD-SHO-018',
    name: 'Arlo Suede Loafers',
    description: 'Penny loafers in buttery suede with a hand-stitched apron toe and a flexible leather sole. The kind of shoe that makes simple outfits look considered.',
    details: 'Suede upper, leather lining and sole, 2 cm heel. Brush the suede regularly and protect with a suede spray. Runs slightly large — size down half a size.',
    category_slug: 'shoes',
    base_price: 178.00, sale_price: null,
    is_new_arrival: true,
    images: [
      { url: './p18-arlo-suede-loafers.jpg', alt: 'Arlo Suede Loafers in chestnut on an ivory surface' }
    ],
    colors: [
      { name: 'Chestnut', hex: '#8A5A3B' },
      { name: 'Sand',     hex: '#D6C7A9' }
    ],
    sizes: ['39', '40', '41', '42', '43', '44', '45'],
    created_at: '2025-11-20T10:15:00Z'
  });

  /* 19 — Vera Knit Beanie · bags & accessories */
  product({
    id: 'p19', slug: 'vera-knit-beanie', sku: 'VD-BAG-019',
    name: 'Vera Knit Beanie',
    description: 'A ribbed merino beanie with a turned cuff that sits softly without squeezing. The colour you will reach for every cold morning.',
    details: '100% merino wool rib knit. Hand wash cold, dry flat. One size, comfortably stretches 54–60 cm.',
    category_slug: 'bags-accessories',
    base_price: 38.00, sale_price: null,
    images: [
      { url: './p19-vera-knit-beanie.jpg', alt: 'Vera Knit Beanie in camel resting on a stone block' }
    ],
    colors: [
      { name: 'Camel', hex: '#B8814F' },
      { name: 'Grey',  hex: '#9A958C' }
    ],
    sizes: ['One Size'],
    created_at: '2025-10-27T09:35:00Z'
  });

  /* 20 — Soren Leather Crossbody · bags & accessories · bestseller */
  product({
    id: 'p20', slug: 'soren-leather-crossbody', sku: 'VD-BAG-020',
    name: 'Soren Leather Crossbody',
    description: 'A compact crossbody in smooth leather with a slim, adjustable strap and a secure magnetic flap. Hands free, essentials close.',
    details: 'Full-grain leather with a suede-lined interior and a card slot under the flap. Wipe with a soft dry cloth. 18 × 13 × 5 cm with an adjustable 55–120 cm strap. One size.',
    category_slug: 'bags-accessories',
    base_price: 142.00, sale_price: null,
    is_best_seller: true,
    images: [
      { url: './p20-soren-crossbody.jpg', alt: 'Soren Leather Crossbody in black against an ivory wall' }
    ],
    colors: [
      { name: 'Black', hex: '#201D1B' },
      { name: 'Taupe', hex: '#A99C8A' }
    ],
    sizes: ['One Size'],
    created_at: '2025-10-29T10:50:00Z'
  });

  /* 21 — Idris Cashmere Scarf · bags & accessories · new arrival */
  product({
    id: 'p21', slug: 'idris-cashmere-scarf', sku: 'VD-BAG-021',
    name: 'Idris Cashmere Scarf',
    description: 'A generously sized cashmere scarf with hand-knotted fringe. Weightless warmth that folds down to nothing in your bag.',
    details: '100% cashmere, 200 × 70 cm with a 6 cm knotted fringe. Dry clean, or hand wash cold with cashmere shampoo and dry flat. One size.',
    category_slug: 'bags-accessories',
    base_price: 88.00, sale_price: null,
    is_new_arrival: true,
    images: [
      { url: './p21-idris-cashmere-scarf.jpg', alt: 'Idris Cashmere Scarf in camel draped over a wooden hanger' }
    ],
    colors: [
      { name: 'Camel',    hex: '#B8814F' },
      { name: 'Charcoal', hex: '#3B3835' }
    ],
    sizes: ['One Size'],
    created_at: '2025-11-14T10:45:00Z'
  });

  /* 22 — Nia Silk Scarf · bags & accessories */
  product({
    id: 'p22', slug: 'nia-silk-scarf', sku: 'VD-BAG-022',
    name: 'Nia Silk Scarf',
    description: 'A silk twill scarf printed with an exclusive terracotta-and-cream pattern. Wear it at the neck, in your hair, or knotted to a bag handle.',
    details: '100% silk twill, 90 × 90 cm with hand-rolled edges. Dry clean recommended; iron on low from the reverse side. One size.',
    category_slug: 'bags-accessories',
    base_price: 54.00, sale_price: null,
    images: [
      { url: './p22-nia-silk-scarf.jpg', alt: 'Nia Silk Scarf in terracotta and cream folded in a soft wave' }
    ],
    colors: [
      { name: 'Terracotta', hex: '#C17B5A' },
      { name: 'Cream',      hex: '#F2ECDD' }
    ],
    sizes: ['One Size'],
    created_at: '2025-10-31T09:20:00Z'
  });

  /* 23 — Delphine Tailored Vest · tops & shirts · new arrival */
  product({
    id: 'p23', slug: 'delphine-tailored-vest', sku: 'VD-TOP-023',
    name: 'Delphine Tailored Vest',
    description: 'A sharply tailored vest with welt pockets and a satin back strap. Button it over a shirt or wear it alone with matching trousers.',
    details: 'Front 64% viscose, 36% linen; satin back. Dry clean only. Fitted through the waist — Lea is 172 cm and wears size S.',
    category_slug: 'tops-shirts',
    base_price: 96.00, sale_price: null,
    is_new_arrival: true,
    images: [
      { url: './p23-delphine-tailored-vest.jpg', alt: 'Delphine Tailored Vest in ivory worn by a model' }
    ],
    colors: [
      { name: 'Ivory', hex: '#F1EAD8' },
      { name: 'Black', hex: '#201D1B' }
    ],
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    created_at: '2025-11-12T09:00:00Z'
  });

  /* 24 — Quinn Cropped Denim Jacket · outerwear */
  product({
    id: 'p24', slug: 'quinn-cropped-denim-jacket', sku: 'VD-OTW-024',
    name: 'Quinn Cropped Denim Jacket',
    description: 'A cropped denim jacket cut boxy with a slightly dropped shoulder and a clean hem. Rigid cotton that breaks in beautifully.',
    details: '100% rigid cotton denim with corozo buttons. Machine wash cold inside out, hang to dry. Cropped boxy fit — Maya is 178 cm and wears size S.',
    category_slug: 'outerwear',
    base_price: 138.00, sale_price: null,
    images: [
      { url: './p24-quinn-denim-jacket.jpg', alt: 'Quinn Cropped Denim Jacket in ecru wash worn by a model' }
    ],
    colors: [
      { name: 'Ecru Wash', hex: '#E3DCCB' },
      { name: 'Mid Wash',  hex: '#7E8CA0' }
    ],
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    created_at: '2025-10-04T14:00:00Z'
  });

  /* 25 — Rubin Straight-Leg Jeans · trousers & jeans · bestseller + on sale */
  product({
    id: 'p25', slug: 'rubin-straight-leg-jeans', sku: 'VD-TRW-025',
    name: 'Rubin Straight-Leg Jeans',
    description: 'Straight-leg jeans in a mid-wash denim with just enough stretch to move. A true waist and a clean leg make them easy to dress up.',
    details: '98% cotton, 2% elastane denim, 12 oz. Machine wash cold inside out and hang to dry to keep the wash true. Regular waist, straight leg — Noa is 180 cm and wears size 32.',
    category_slug: 'trousers-jeans',
    base_price: 118.00, sale_price: 94.00,
    is_best_seller: true,
    images: [
      { url: './p25-rubin-jeans.jpg', alt: 'Rubin Straight-Leg Jeans in mid wash worn by a model' }
    ],
    colors: [
      { name: 'Mid Wash', hex: '#7E8CA0' },
      { name: 'Black',    hex: '#201D1B' }
    ],
    sizes: ['28', '30', '32', '34', '36'],
    created_at: '2025-10-06T14:30:00Z'
  });

  /* 26 — Amara Ribbed Midi Dress · dresses · featured */
  product({
    id: 'p26', slug: 'amara-ribbed-midi-dress', sku: 'VD-DRS-026',
    name: 'Amara Ribbed Midi Dress',
    description: 'A ribbed knit midi with long sleeves and a gracefully open back. Black for evenings, terracotta for everything else.',
    details: '92% viscose, 8% elastane rib knit. Machine wash cold on gentle, dry flat. Close fit with stretch — Ines is 175 cm and wears size XS.',
    category_slug: 'dresses',
    base_price: 118.00, sale_price: null,
    is_featured: true,
    images: [
      { url: './p26-amara-ribbed-dress.jpg', alt: 'Amara Ribbed Midi Dress in black worn by a model' }
    ],
    colors: [
      { name: 'Black',      hex: '#201D1B' },
      { name: 'Terracotta', hex: '#C17B5A' }
    ],
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    created_at: '2025-10-08T15:00:00Z'
  });

  /* 27 — Felix Quilted Overshirt · outerwear · new arrival */
  product({
    id: 'p27', slug: 'felix-quilted-overshirt', sku: 'VD-OTW-027',
    name: 'Felix Quilted Overshirt',
    description: 'A quilted overshirt that works like light outerwear, worn open over tees or buttoned as a jacket. Diamond quilting keeps the fill evenly in place.',
    details: 'Shell 100% cotton, fill 100% recycled polyester, corozo buttons. Machine wash cold on gentle, tumble dry low with two laundry balls to redistribute the fill. Layering fit — Jonas is 182 cm and wears size M.',
    category_slug: 'outerwear',
    base_price: 146.00, sale_price: null,
    is_new_arrival: true,
    images: [
      { url: './p27-felix-quilted-overshirt.jpg', alt: 'Felix Quilted Overshirt in olive worn open by a model' }
    ],
    colors: [
      { name: 'Olive', hex: '#6B6B4A' },
      { name: 'Stone', hex: '#CFC5B4' }
    ],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    created_at: '2025-11-17T11:00:00Z'
  });

  /* 28 — Selma Woven Leather Clutch · bags & accessories */
  product({
    id: 'p28', slug: 'selma-woven-leather-clutch', sku: 'VD-BAG-028',
    name: 'Selma Woven Leather Clutch',
    description: 'A woven leather clutch that folds softly under your arm. Slip the optional chain strap onto your shoulder when dinner turns into dancing.',
    details: 'Hand-woven full-grain leather with a magnetic closure and a detachable chain strap. Wipe with a soft dry cloth. 26 × 15 × 4 cm; fits a large phone, cards and a lipstick. One size.',
    category_slug: 'bags-accessories',
    base_price: 98.00, sale_price: null,
    images: [
      { url: './p28-selma-woven-clutch.jpg', alt: 'Selma Woven Leather Clutch in natural on ivory linen' }
    ],
    colors: [
      { name: 'Natural', hex: '#D6C7A9' },
      { name: 'Black',   hex: '#201D1B' }
    ],
    sizes: ['One Size'],
    created_at: '2025-10-10T15:30:00Z'
  });

  /* 29 — Rhea Ankle Strap Flats · shoes · new arrival */
  product({
    id: 'p29', slug: 'rhea-ankle-strap-flats', sku: 'VD-SHO-029',
    name: 'Rhea Ankle Strap Flats',
    description: 'Ballet-flat lines with a slender ankle strap that keeps them secure from first coffee to last dance. A softly squared toe keeps the look modern.',
    details: 'Nappa leather upper, leather lining and insole, 1 cm sole. Use heel grips between sizes; the strap adjusts with a small gold-tone buckle. Runs true to size.',
    category_slug: 'shoes',
    base_price: 132.00, sale_price: null,
    is_new_arrival: true,
    images: [
      { url: './p29-rhea-strap-flats.jpg', alt: 'Rhea Ankle Strap Flats in black on an ivory surface' }
    ],
    colors: [
      { name: 'Black', hex: '#201D1B' },
      { name: 'Nude',  hex: '#D9BFA5' }
    ],
    sizes: ['36', '37', '38', '39', '40', '41'],
    created_at: '2025-11-19T09:30:00Z'
  });

  /* 30 — Owen Merino Half-Zip · knitwear · bestseller */
  product({
    id: 'p30', slug: 'owen-merino-half-zip', sku: 'VD-KNT-030',
    name: 'Owen Merino Half-Zip',
    description: 'A merino half-zip with a stand collar you can zip up against the wind. Cut a touch relaxed, it layers over a shirt without bunching.',
    details: '100% extra-fine merino wool. Machine wash cold on the wool cycle, dry flat. Relaxed fit — Elif is 179 cm and wears size M.',
    category_slug: 'knitwear',
    base_price: 132.00, sale_price: null,
    is_best_seller: true,
    images: [
      { url: './p30-owen-half-zip.jpg', alt: 'Owen Merino Half-Zip in camel worn by a model' }
    ],
    colors: [
      { name: 'Camel', hex: '#B8814F' },
      { name: 'Grey',  hex: '#9A958C' }
    ],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
    created_at: '2025-10-12T16:00:00Z'
  });

  /* ======================================================================
     EXPORT
     ====================================================================== */

  return {
    batchId: BATCH_ID,
    categories: categories,
    collections: collections,
    products: products
  };
})();

/* Make the catalog available everywhere: as a browser global for the
   storefront scripts, and via globalThis for Bun / Node (seed generator). */
if (typeof window !== 'undefined') { window.VD_DEMO_DATA = VD_DEMO_DATA; }
if (typeof globalThis !== 'undefined') { globalThis.VD_DEMO_DATA = VD_DEMO_DATA; }
