/* ==========================================================================
   VOGUE DISTRICT — COLLECTIONS PAGE (collections.js)
   --------------------------------------------------------------------------
   Fills #collections-grid with:

     1. The store's curated collections (from VD.api.getCollections —
        demo data while Supabase is not connected, the `collections` table
        once it is). Each becomes a collection-card linking to
        shop.html?collection=<slug>.
     2. Three always-present shortcut cards after them:
        New arrivals · Best sellers · Sale.

   Also handles the loading skeletons (in the HTML), the empty state and
   the error state. On a load error the shortcut cards are still shown —
   they don't depend on the network, so they always work.
   ========================================================================== */

(function () {
  'use strict';

  window.VD = window.VD || {};
  window.VD.page = window.VD.page || {};

  window.VD.page.init = function () {
    var grid = document.getElementById('collections-grid');
    if (!grid) return;                                    // guard: wrong page / removed section

    var esc = window.VD.utils.esc;

    /* --------------------------------------------------------------------
       Shortcut cards — always appended, whatever the data layer returns.
       Images are existing campaign/product shots; alts match the homepage.
       -------------------------------------------------------------------- */
    var SHORTCUT_CARDS = [
      {
        href: 'shop.html?tag=new-arrivals',
        image: 'images/editorial/campaign-2.jpg',
        alt: 'Model seated in a linen armchair wearing an oat cashmere cardigan',
        name: 'New arrivals',
        description: 'The latest pieces to land on the rail — fresh in this week.',
        accent: false
      },
      {
        href: 'shop.html?tag=best-sellers',
        image: 'images/products/p17-juno-ankle-boots.jpg',
        alt: 'Pair of black leather ankle boots',
        name: 'Best sellers',
        description: 'The pieces our customers keep coming back for, season after season.',
        accent: false
      },
      {
        href: 'shop.html?sale=1',
        image: 'images/products/p13-bram-wool-coat.jpg',
        alt: 'Man wearing a charcoal wool overcoat',
        name: 'Sale',
        description: 'Reduced prices on selected styles — while stock lasts.',
        /* The Sale card gets the accent overlay treatment: category-card--accent
           is the accent variant already defined for homepage category cards,
           collection-card--accent is this page's equivalent hook for style.css. */
        accent: true
      }
    ];

    /* --------------------------------------------------------------------
       Markup builders
       -------------------------------------------------------------------- */
    function cardHTML(card) {
      return (
        '<a class="collection-card' + (card.accent ? ' collection-card--accent category-card--accent' : '') +
          '" href="' + card.href + '">' +
          '<img src="' + card.image + '" alt="' + card.alt + '" loading="lazy" ' +
            'onerror="VD.utils.imgFallback(this)">' +
          '<span class="collection-card__body">' +
            '<span class="collection-card__name">' + esc(card.name) + '</span>' +
            '<span class="collection-card__description">' + esc(card.description) + '</span>' +
            '<span class="collection-card__cta">Explore collection <span aria-hidden="true">→</span></span>' +
          '</span>' +
        '</a>'
      );
    }

    /* Curated collection → card linking into the shop filtered by collection. */
    function collectionCardHTML(collection) {
      var name = collection.name || 'Collection';
      var href = 'shop.html?collection=' + encodeURIComponent(collection.slug || '');
      return (
        '<a class="collection-card" href="' + href + '">' +
          '<img src="' + esc(collection.image_url) + '" alt="' + esc(name + ' collection') + '" loading="lazy" ' +
            'onerror="VD.utils.imgFallback(this)">' +
          '<span class="collection-card__body">' +
            '<span class="collection-card__name">' + esc(name) + '</span>' +
            (collection.description
              ? '<span class="collection-card__description">' + esc(collection.description) + '</span>'
              : '') +
            '<span class="collection-card__cta">Explore collection <span aria-hidden="true">→</span></span>' +
          '</span>' +
        '</a>'
      );
    }

    function appendShortcutCards() {
      SHORTCUT_CARDS.forEach(function (card) {
        grid.insertAdjacentHTML('beforeend', cardHTML(card));
      });
    }

    /* --------------------------------------------------------------------
       States
       -------------------------------------------------------------------- */
    function showErrorState() {
      grid.innerHTML =
        '<p class="empty-note empty-note--error" role="alert">' +
          'We couldn’t load the collections right now. ' +
          '<a class="text-link" href="collections.html">Try again</a> or browse the ' +
          '<a class="text-link" href="shop.html">full shop</a>.' +
        '</p>';
      appendShortcutCards();                    // shortcut cards need no API — keep them useful
    }

    function showEmptyState() {
      grid.innerHTML =
        '<p class="empty-note">' +
          'No collections have been published yet — in the meantime, browse the ' +
          '<a class="text-link" href="shop.html">full shop</a>.' +
        '</p>';
      appendShortcutCards();
    }

    /* --------------------------------------------------------------------
       Load + render
       -------------------------------------------------------------------- */
    window.VD.api.getCollections()
      .then(function (collections) {
        if (!collections || !collections.length) {
          showEmptyState();
          return;
        }
        grid.innerHTML = '';                              // clear the loading skeletons
        collections.forEach(function (collection) {
          grid.insertAdjacentHTML('beforeend', collectionCardHTML(collection));
        });
        appendShortcutCards();
      })
      .catch(function (err) {
        console.error('Vogue District: could not load collections.', err);
        showErrorState();
      });
  };
})();
