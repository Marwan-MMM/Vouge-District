/* ==========================================================================
   VOGUE DISTRICT — CONFIGURATION FILE
   --------------------------------------------------------------------------
   This is the ONLY file you normally need to edit to configure the store.
   Every page loads it first, so the whole website picks up your changes.

   TABLE OF CONTENTS
     1. SUPABASE CONNECTION  — required for real database, orders, admin
     2. BRAND                — name, tagline
     3. CURRENCY             — display currency and number locale
     4. SHIPPING             — delivery methods, costs, free-shipping threshold
     5. PAYMENT METHODS      — which options appear at checkout (no card data!)
     6. PROMO CODES          — simple discount codes
     7. CONTACT & SOCIAL     — placeholder details you MUST replace
     8. ANNOUNCEMENT BAR     — the strip above the navigation

   NOTE ON SUPABASE SETTINGS
   Once Supabase is connected, the `store_settings` row in your database can
   override most values below (edit it from admin.html → Settings). These
   values act as the defaults / fallback when the database is unreachable.
   ========================================================================== */

window.VOGUE_CONFIG = {

  /* ------------------------------------------------------------------------
     1. SUPABASE CONNECTION
     ------------------------------------------------------------------------
     Create a free project at https://supabase.com then:
       a) Open Project Settings → API.
       b) Copy the "Project URL" into `url` below.
       c) Copy the "anon / publishable" key into `publishableKey` below.
          (NEVER paste the service-role secret key here — it must stay server-side.)
     d) Run supabase-schema.sql (and optionally supabase-seed.sql) in the
        Supabase SQL Editor — see README.md for a full walkthrough.

     While the placeholders below are unchanged, the website runs in clearly
     labelled LOCAL DEMO MODE: the storefront is browsable using the bundled
     demo catalog (js demo data), but orders, contact messages, the admin
     panel and cross-device persistence stay disabled. */

  supabase: {
    url:            'https://gpymmjfsyjietrzzltgk.supabase.co',            // e.g. https://abcdefgh.supabase.co
    publishableKey: 'sb_publishable_4P-rXe_PWrkPvMRRaanqag_he5255pr',   // e.g. eyJhbGciOi...
  },

  /* ------------------------------------------------------------------------
     2. BRAND
     ------------------------------------------------------------------------ */
  brand: {
    name:     'Vogue District',
    tagline:  'Modern fashion, thoughtfully curated.',
    logoUrl:  ''   // optional — leave '' to show the wordmark text instead
  },

  /* ------------------------------------------------------------------------
     3. CURRENCY
     `code`   — ISO 4217 code (USD, EUR, GBP, AED, EGP…)
     `locale` — BCP 47 locale used by Intl.NumberFormat for formatting
     ------------------------------------------------------------------------ */
  currency: {
    code:   'USD',
    locale: 'en-US'
  },

  /* ------------------------------------------------------------------------
     4. SHIPPING
     `free_threshold` — standard delivery becomes free from this subtotal.
                        Set to 0 to disable the free-shipping offer.
     `methods`        — both methods are offered at checkout; costs are in
                        the currency above and are validated again on the
                        server (Supabase place_order function) at submit time.
     ------------------------------------------------------------------------ */
  shipping: {
    free_threshold: 150,
    methods: [
      { id: 'standard', label: 'Standard delivery', cost: 8,  eta: '3–6 business days' },
      { id: 'express',  label: 'Express delivery',  cost: 18, eta: '1–2 business days' }
    ]
  },

  /* ------------------------------------------------------------------------
     5. PAYMENT METHODS
     This template deliberately does NOT collect card details. Offer offline
     / redirect-based methods your client actually uses (cash on delivery,
     bank transfer, WhatsApp order, or a hosted checkout link).
     ------------------------------------------------------------------------ */
  payment_methods: [
    { id: 'cash_on_delivery', label: 'Cash on delivery', note: 'Pay in cash when your order arrives.' },
    { id: 'bank_transfer',    label: 'Bank transfer',    note: 'We email you payment instructions after the order is placed.' }
  ],

  /* ------------------------------------------------------------------------
     6. PROMO CODES
     type: 'percent' (value = % off) | 'fixed' (value = amount off) |
           'free_shipping' (value ignored)
     min_subtotal — code only applies from this subtotal (0 = always).
     Codes are re-validated server-side when an order is submitted.
     ------------------------------------------------------------------------ */
  promo_codes: [
    { code: 'WELCOME10', type: 'percent', value: 10, min_subtotal: 0 }
  ],

  /* ------------------------------------------------------------------------
     7. CONTACT & SOCIAL  — SAMPLE PLACEHOLDERS, replace with your client's
     real details before going live (they appear in the footer & contact page).
     ------------------------------------------------------------------------ */
  contact: {
    email:    'hello@voguedistrict.example',
    phone:    '+00 000 000 0000',
    address:  '12 Sample Street, Design District, Your City',
    whatsapp: ''    // optional international format, e.g. '15551234567'
  },

  social: {
    instagram: '#',
    facebook:  '#',
    pinterest: '#',
    tiktok:    '#',
    youtube:   '#'
  },

  /* ------------------------------------------------------------------------
     8. ANNOUNCEMENT BAR (the strip above the navigation)
     ------------------------------------------------------------------------ */
  announcement: {
    enabled: true,
    text:    'Complimentary standard delivery on orders over $150 · 30-day easy returns'
  }
};
