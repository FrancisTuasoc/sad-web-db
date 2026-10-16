/**
 * Reviews & Favorites Client Controller
 * Handles customer star reviews, interactive star picker, favorite heart toggles,
 * and live updates across catalog cards, profile tabs, and modal dialogs.
 */

import { apiFetch } from './api.js';
import { isLoggedIn } from './auth.js';
import { showToast, escapeHtml, getProductImageUrl, BURGER_PLACEHOLDER } from './ui.js';
import { lucideIcon, renderRatingBadge, renderRatingStars } from './icons.js';

// Cache of favorited product IDs for active customer
let customerFavoriteIds = new Set();
let favoritesLoaded = false;

export async function loadCustomerFavorites() {
  if (!isLoggedIn()) {
    customerFavoriteIds.clear();
    favoritesLoaded = true;
    return customerFavoriteIds;
  }

  try {
    const res = await apiFetch('/favorites/ids');
    if (res && Array.isArray(res.favoriteItemIds)) {
      customerFavoriteIds = new Set(res.favoriteItemIds.map(String));
    }
    favoritesLoaded = true;
  } catch (err) {
    console.warn('Could not load customer favorites:', err.message);
  }
  return customerFavoriteIds;
}

export function isItemFavorited(itemId) {
  if (!itemId) return false;
  return customerFavoriteIds.has(String(itemId));
}

export async function toggleFavorite(itemId, sourceBtn = null) {
  if (!isLoggedIn()) {
    showToast('Sign in to save favorites.', 'info');
    setTimeout(() => {
      window.location.href = `login.html?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }, 800);
    return false;
  }

  if (sourceBtn) {
    sourceBtn.disabled = true;
  }

  try {
    const res = await apiFetch('/favorites/toggle', {
      method: 'POST',
      body: JSON.stringify({ itemId }),
    });

    const isFav = Boolean(res.isFavorited);
    if (isFav) {
      customerFavoriteIds.add(String(itemId));
      showToast('Added to Favorites ♥', 'success');
    } else {
      customerFavoriteIds.delete(String(itemId));
      showToast('Removed from Favorites', 'info');
    }

    // Synchronize all heart buttons on page matching this product ID
    updateFavoriteButtonsInDOM(itemId, isFav);

    // Notify other components (e.g. Profile Favorites tab)
    window.dispatchEvent(
      new CustomEvent('gigabite:favorites-updated', {
        detail: { itemId, isFavorited: isFav },
      })
    );

    return isFav;
  } catch (err) {
    showToast(err.message || 'Could not update favorites.', 'error');
    return isItemFavorited(itemId);
  } finally {
    if (sourceBtn) {
      sourceBtn.disabled = false;
    }
  }
}

export function updateFavoriteButtonsInDOM(itemId, isFav) {
  const buttons = document.querySelectorAll(
    `[data-favorite-btn="true"][data-product-id="${itemId}"]`
  );

  buttons.forEach((btn) => {
    btn.classList.toggle('is-favorited', isFav);
    btn.setAttribute('aria-label', isFav ? 'Remove from favorites' : 'Add to favorites');
    btn.setAttribute('title', isFav ? 'Remove from favorites' : 'Add to favorites');

    btn.innerHTML = lucideIcon('heart', {
      size: 18,
      fill: isFav ? '#E53E3E' : 'none',
      stroke: isFav ? '#E53E3E' : 'currentColor',
      strokeWidth: 2,
      className: 'fav-icon',
      ariaHidden: true,
    });
  });
}

// ---------------- Review Modal System ----------------
let currentReviewModalProduct = null;
let currentReviewId = null;
let selectedStarRating = 0;
let hoveredStarRating = 0;

export function ensureReviewModalDOM() {
  let modal = document.getElementById('item-review-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'item-review-modal';
  modal.className = 'modal-backdrop item-review-modal-backdrop';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'review-modal-title');
  modal.setAttribute('aria-hidden', 'true');

  modal.innerHTML = `
    <div class="modal-card review-modal-card">
      <div class="modal-header review-modal-header">
        <div class="review-modal-header-info">
          <h3 id="review-modal-title" class="review-modal-title">Rate &amp; Review</h3>
          <p id="review-modal-subtitle" class="review-modal-subtitle">Share your experience with this item</p>
        </div>
        <button type="button" id="review-modal-close-btn" class="modal-close-btn" aria-label="Close review modal">
          ${lucideIcon('x', { size: 20 })}
        </button>
      </div>

      <div class="review-modal-body">
        <!-- Product Thumbnail & Details -->
        <div class="review-product-preview">
          <img id="review-product-img" src="${BURGER_PLACEHOLDER}" alt="Product" class="review-product-thumb">
          <div class="review-product-meta">
            <h4 id="review-product-name" class="review-product-name">Product Name</h4>
            <div id="review-product-current-rating" class="review-product-current-rating"></div>
          </div>
        </div>

        <!-- Existing Review Notice (if editing) -->
        <div id="review-existing-banner" class="review-existing-banner hidden">
          <div class="review-existing-header">
            <strong>Your Existing Review</strong>
            <span id="review-existing-date" class="text-muted text-xs"></span>
          </div>
          <p id="review-existing-text" class="review-existing-text"></p>
        </div>

        <!-- Review Form -->
        <form id="item-review-form" class="review-form" novalidate>
          <div class="form-group review-star-picker-group">
            <label class="form-label review-picker-label">
              Your Rating <span class="text-danger">*</span>
            </label>
            <div id="review-star-picker" class="interactive-star-picker" role="radiogroup" aria-label="Rating from 1 to 5 stars">
              <!-- Rendered dynamically -->
            </div>
            <div id="review-rating-error" class="form-error-msg hidden" role="alert">Please select a star rating.</div>
          </div>

          <div class="form-group">
            <div class="review-comment-label-row">
              <label for="review-comment-input" class="form-label">
                Written Review <small class="text-muted">(Optional)</small>
              </label>
              <span id="review-char-count" class="char-counter">0 / 300</span>
            </div>
            <textarea
              id="review-comment-input"
              class="form-control review-textarea"
              rows="3"
              maxlength="300"
              placeholder="What made this burger great? (e.g. flavor, crispiness, warmth...)"
            ></textarea>
            <div id="review-comment-error" class="form-error-msg hidden" role="alert"></div>
          </div>

          <div class="review-modal-actions">
            <button type="button" id="review-delete-btn" class="btn btn-secondary btn-review-delete hidden" style="color:var(--color-danger,#DC2626);margin-right:auto;">
              ${lucideIcon('trash-2', { size: 16 })}
              <span>Delete Review</span>
            </button>
            <button type="button" id="review-cancel-btn" class="btn btn-secondary">
              Cancel
            </button>
            <button type="submit" id="review-submit-btn" class="btn btn-primary">
              <span class="btn-text">Submit Review</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  attachReviewModalListeners(modal);
  return modal;
}

function renderStarPicker(activeRating = 0) {
  const picker = document.getElementById('review-star-picker');
  if (!picker) return;

  const displayRating = hoveredStarRating > 0 ? hoveredStarRating : activeRating;

  let html = '';
  for (let i = 1; i <= 5; i++) {
    const isFilled = displayRating >= i;
    html += `
      <button type="button" 
              class="star-picker-btn ${isFilled ? 'is-active' : ''}" 
              data-star-val="${i}" 
              role="radio" 
              aria-checked="${activeRating === i}" 
              aria-label="${i} of 5 stars">
        ${lucideIcon('star', {
          size: 26,
          fill: isFilled ? '#F59E0B' : 'none',
          stroke: isFilled ? '#F59E0B' : '#9CA3AF',
          strokeWidth: 2,
          className: 'picker-star-icon',
          ariaHidden: true,
        })}
      </button>
    `;
  }

  picker.innerHTML = html;
}

function attachReviewModalListeners(modal) {
  const closeBtn = document.getElementById('review-modal-close-btn');
  const cancelBtn = document.getElementById('review-cancel-btn');
  const deleteBtn = document.getElementById('review-delete-btn');
  const form = document.getElementById('item-review-form');
  const textarea = document.getElementById('review-comment-input');
  const charCounter = document.getElementById('review-char-count');
  const picker = document.getElementById('review-star-picker');

  function closeThisModal() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    currentReviewModalProduct = null;
    currentReviewId = null;
    selectedStarRating = 0;
    hoveredStarRating = 0;
  }

  if (closeBtn) closeBtn.addEventListener('click', closeThisModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeThisModal);

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeThisModal();
  });

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) {
      closeThisModal();
    }
  });

  // Character counter
  if (textarea && charCounter) {
    textarea.addEventListener('input', () => {
      const len = textarea.value.length;
      charCounter.textContent = `${len} / 300`;
      if (len >= 300) {
        charCounter.classList.add('text-danger');
      } else {
        charCounter.classList.remove('text-danger');
      }
    });
  }

  // Interactive Star Picker delegation
  if (picker) {
    picker.addEventListener('mouseover', (e) => {
      const btn = e.target.closest('.star-picker-btn');
      if (btn) {
        hoveredStarRating = Number(btn.getAttribute('data-star-val')) || 0;
        renderStarPicker(selectedStarRating);
      }
    });

    picker.addEventListener('mouseleave', () => {
      hoveredStarRating = 0;
      renderStarPicker(selectedStarRating);
    });

    picker.addEventListener('click', (e) => {
      const btn = e.target.closest('.star-picker-btn');
      if (btn) {
        selectedStarRating = Number(btn.getAttribute('data-star-val')) || 0;
        hoveredStarRating = 0;
        renderStarPicker(selectedStarRating);

        const errorMsg = document.getElementById('review-rating-error');
        if (errorMsg) errorMsg.classList.add('hidden');
      }
    });
  }

  // Delete review action with inline confirmation
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      if (!currentReviewId) return;

      if (deleteBtn.getAttribute('data-confirming') !== 'true') {
        deleteBtn.setAttribute('data-confirming', 'true');
        deleteBtn.innerHTML = `
          ${lucideIcon('trash-2', { size: 16 })}
          <span>Confirm Delete?</span>
        `;
        deleteBtn.classList.add('btn-danger');
        setTimeout(() => {
          if (deleteBtn.getAttribute('data-confirming') === 'true') {
            deleteBtn.removeAttribute('data-confirming');
            deleteBtn.innerHTML = `
              ${lucideIcon('trash-2', { size: 16 })}
              <span>Delete Review</span>
            `;
            deleteBtn.classList.remove('btn-danger');
          }
        }, 3500);
        return;
      }

      deleteBtn.removeAttribute('data-confirming');
      deleteBtn.disabled = true;
      deleteBtn.innerHTML = `
        ${lucideIcon('loader-2', { size: 16, className: 'spin' })}
        <span>Deleting...</span>
      `;
      try {
        await apiFetch(`/reviews/${currentReviewId}`, { method: 'DELETE' });
        showToast('Review removed.', 'info');
        closeThisModal();

        window.dispatchEvent(
          new CustomEvent('gigabite:review-deleted', {
            detail: { reviewId: currentReviewId, productId: currentReviewModalProduct?._id || currentReviewModalProduct?.id },
          })
        );
      } catch (err) {
        showToast(err.message || 'Could not delete review.', 'error');
      } finally {
        deleteBtn.disabled = false;
        deleteBtn.innerHTML = `
          ${lucideIcon('trash-2', { size: 16 })}
          <span>Delete Review</span>
        `;
        deleteBtn.classList.remove('btn-danger');
      }
    });
  }

  // Form submit
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const ratingError = document.getElementById('review-rating-error');

      if (!selectedStarRating || selectedStarRating < 1 || selectedStarRating > 5) {
        if (ratingError) {
          ratingError.textContent = 'Please select a star rating.';
          ratingError.classList.remove('hidden');
        }
        showToast('Please select a star rating.', 'error');
        return;
      }

      if (ratingError) ratingError.classList.add('hidden');

      const submitBtn = document.getElementById('review-submit-btn');
      const comment = (textarea.value || '').trim();

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `
          ${lucideIcon('loader-2', { size: 16, className: 'spin' })}
          <span>Saving...</span>
        `;
      }

      try {
        const isEdit = Boolean(currentReviewId);
        const url = isEdit ? `/reviews/${currentReviewId}` : '/reviews';
        const method = isEdit ? 'PUT' : 'POST';

        const payload = isEdit
          ? { rating: selectedStarRating, comment }
          : {
              itemId: currentReviewModalProduct._id || currentReviewModalProduct.id,
              rating: selectedStarRating,
              comment,
            };

        const res = await apiFetch(url, {
          method,
          body: JSON.stringify(payload),
        });

        const successMessage = isEdit ? 'Review updated.' : 'Your review has been saved!';
        showToast(successMessage, 'success');

        // Update card rating summary in real-time if returned
        if (res.summary && currentReviewModalProduct) {
          const productId = currentReviewModalProduct._id || currentReviewModalProduct.id;
          updateProductCardRatingInDOM(productId, res.summary.averageRating, res.summary.reviewCount);
        }

        window.dispatchEvent(
          new CustomEvent('gigabite:review-saved', {
            detail: {
              isEdit,
              review: res.review,
              productId: currentReviewModalProduct?._id,
            },
          })
        );

        closeThisModal();
      } catch (err) {
        showToast(err.message || 'Could not submit your review.', 'error');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = `<span class="btn-text">${currentReviewId ? 'Update Review' : 'Submit Review'}</span>`;
        }
      }
    });
  }
}

export function updateProductCardRatingInDOM(productId, avgRating, reviewCount) {
  const cardRatingContainers = document.querySelectorAll(
    `[data-product-id="${productId}"] .product-rating-row`
  );

  cardRatingContainers.forEach((container) => {
    container.outerHTML = renderRatingBadge(avgRating, reviewCount, { size: 16 });
  });
}

export async function openReviewModalForProduct(product) {
  if (!isLoggedIn()) {
    showToast('Please log in to write a review.', 'info');
    setTimeout(() => {
      window.location.href = `login.html?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }, 800);
    return;
  }

  const modal = ensureReviewModalDOM();
  currentReviewModalProduct = product;
  const productId = product._id || product.id;

  // Set modal product preview details
  const nameElem = document.getElementById('review-product-name');
  const imgElem = document.getElementById('review-product-img');
  const currentRatingElem = document.getElementById('review-product-current-rating');
  const submitBtn = document.getElementById('review-submit-btn');
  const deleteBtn = document.getElementById('review-delete-btn');
  const textarea = document.getElementById('review-comment-input');
  const charCounter = document.getElementById('review-char-count');
  const existingBanner = document.getElementById('review-existing-banner');
  const existingText = document.getElementById('review-existing-text');
  const existingDate = document.getElementById('review-existing-date');

  if (nameElem) nameElem.textContent = product.name;
  if (imgElem) {
    imgElem.src = getProductImageUrl(product);
    imgElem.onerror = () => {
      imgElem.onerror = null;
      imgElem.src = BURGER_PLACEHOLDER;
    };
  }
  if (currentRatingElem) {
    currentRatingElem.innerHTML = renderRatingBadge(
      product.averageRating || 0,
      product.reviewCount || 0,
      { size: 14 }
    );
  }

  // Reset form fields
  selectedStarRating = 0;
  hoveredStarRating = 0;
  currentReviewId = null;
  if (textarea) textarea.value = '';
  if (charCounter) charCounter.textContent = '0 / 300';
  if (existingBanner) existingBanner.classList.add('hidden');
  if (deleteBtn) deleteBtn.classList.add('hidden');
  if (submitBtn) {
    submitBtn.innerHTML = '<span class="btn-text">Submit Review</span>';
  }

  renderStarPicker(0);

  // Check if customer already reviewed this item
  try {
    const res = await apiFetch(`/reviews/check/${productId}`);
    if (res && res.hasReviewed && res.review) {
      currentReviewId = res.review.id || res.review._id;
      selectedStarRating = res.review.rating || 0;
      renderStarPicker(selectedStarRating);

      if (textarea) {
        textarea.value = res.review.comment || '';
        if (charCounter) charCounter.textContent = `${textarea.value.length} / 300`;
      }

      if (existingBanner) {
        existingBanner.classList.remove('hidden');
        if (existingText) existingText.textContent = res.review.comment || '(No comment provided)';
        if (existingDate && res.review.createdAt) {
          existingDate.textContent = new Date(res.review.createdAt).toLocaleDateString();
        }
      }

      if (deleteBtn) deleteBtn.classList.remove('hidden');
      if (submitBtn) {
        submitBtn.innerHTML = '<span class="btn-text">Update Review</span>';
      }
    }
  } catch (err) {
    console.warn('Could not check review status:', err.message);
  }

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}
