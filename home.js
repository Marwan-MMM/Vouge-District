/* ==========================================================================
   VOGUE DISTRICT — HOMEPAGE (home.js)
   --------------------------------------------------------------------------
   Fills the featured and new-arrival grids from the data layer, then lets
   the shared wishlist/cart buttons do their thing.
   ========================================================================== */

(function () {
  'use strict';

  window.VD = window.VD || {};
  window.VD.page = {};

  window.VD.page.init = function () {
    var featuredGrid = document.getElementById('featured-grid');
    var newGrid = document.getElementById('new-grid');

    /* Loading skeletons keep the layout stable while products load. */
    if (featuredGrid) featuredGrid.innerHTML = window.VD.products.skeletonHTML(8);
    if (newGrid) newGrid.innerHTML = window.VD.products.skeletonHTML(8);

    var featured = window.VD.api.getFeatured(8)
      .then(function (items) {
        if (featuredGrid) {
          if (items.length) {
            window.VD.products.renderCards(featuredGrid, items);
          } else {
            featuredGrid.innerHTML = emptyNote('Featured pieces are being curated — check back soon.');
          }
        }
      })
      .catch(function (err) {
        if (featuredGrid) featuredGrid.innerHTML = errorNote(err.message);
      });

    var fresh = window.VD.api.getNewArrivals(8)
      .then(function (items) {
        if (newGrid) {
          if (items.length) {
            window.VD.products.renderCards(newGrid, items);
          } else {
            newGrid.innerHTML = emptyNote('New arrivals are on their way — check back soon.');
          }
        }
      })
      .catch(function (err) {
        if (newGrid) newGrid.innerHTML = errorNote(err.message);
      });

    /* Once both grids are painted, make sure wishlist hearts reflect state. */
    Promise.all([featured, fresh]).then(function () {
      window.VD.wishlist.syncButtons();
    });
  };

  function emptyNote(message) {
    return '<p class="empty-note">' + window.VD.utils.esc(message) + '</p>';
  }

  function errorNote(message) {
    return '<p class="empty-note empty-note--error">Could not load products: ' +
      window.VD.utils.esc(message) + '</p>';
  }
})();
