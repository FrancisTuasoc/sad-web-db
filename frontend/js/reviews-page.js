/**
 * Reviews Page Controller - GIGABITE
 * Redesigned to match the reference layout:
 * - Rating summary with interactive distribution bars
 * - Filters for star rating, media-only, and sorting
 * - Verified review cards with customer avatars and quotes
 * - Responsive pagination and mobile/tablet optimization
 * - Connected to live user reviews and website review submission
 */

import { apiFetch } from './api.js';
import { escapeHtml, showToast } from './ui.js';
import { openWebsiteReviewModal, ensureWebsiteReviewModalDOM } from './reviews-favorites.js';

let allReviews = [];
const reviewsPerPage = 6;
let currentPage = 1;

/**
 * Generates star glyphs with filled and empty stars
 */
export const starMarkup = (rating, className = '') => {
  const safeRating = Math.max(0, Math.min(5, Math.round(rating) || 0));
  const fullStars = '★'.repeat(safeRating);
  const emptyStars = '★'.repeat(5 - safeRating);
  return `<span class="${className}" aria-label="${rating} out of 5 stars">${fullStars}${
    emptyStars ? `<span class="empty-star">${emptyStars}</span>` : ''
  }</span>`;
};

/**
 * Format a review date string into human friendly label
 */
function formatReviewDate(dateString) {
  if (!dateString) {
    return { iso: '', label: 'Recent' };
  }
  const dateObj = new Date(dateString);
  if (isNaN(dateObj.getTime())) {
    return { iso: dateString, label: dateString };
  }
  const iso = dateObj.toISOString().split('T')[0];
  const label = dateObj.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return { iso, label };
}

/**
 * Calculate and render the overall rating summary and breakdown bars
 */
export function renderSummary() {
  const count = allReviews.length;
  const average = count
    ? allReviews.reduce((sum, review) => sum + (Number(review.rating) || 0), 0) / count
    : 0;

  const averageRatingEl = document.getElementById('average-rating');
  const averageStarsEl = document.getElementById('average-stars');
  const reviewTotalEl = document.getElementById('review-total');
  const breakdownEl = document.getElementById('rating-breakdown');

  if (averageRatingEl) {
    averageRatingEl.textContent = count ? average.toFixed(1) : '—';
  }

  if (averageStarsEl) {
    averageStarsEl.innerHTML = count
      ? starMarkup(Math.round(average), 'stars')
      : '<span class="empty-star">★★★★★</span>';
    averageStarsEl.setAttribute(
      'aria-label',
      count ? `${average.toFixed(1)} out of 5 stars` : 'No ratings yet'
    );
  }

  if (reviewTotalEl) {
    reviewTotalEl.textContent = `${count} ${count === 1 ? 'review' : 'reviews'}`;
  }

  if (breakdownEl) {
    breakdownEl.innerHTML = '';
    for (let rating = 5; rating >= 1; rating--) {
      const ratingCount = allReviews.filter((r) => Number(r.rating) === rating).length;
      const percent = count ? Math.round((ratingCount / count) * 100) : 0;

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'rating-row';
      row.setAttribute(
        'title',
        `Click to show only ${rating}-star reviews (${ratingCount})`
      );
      row.setAttribute('aria-label', `Filter by ${rating} stars, ${ratingCount} reviews`);
      row.innerHTML = `
        <span class="rating-row-label">${rating}★</span>
        <div class="rating-track" role="img" aria-label="${percent}% ${rating}-star reviews">
          <div class="rating-fill" style="width: ${percent}%;"></div>
        </div>
        <span class="rating-count">${ratingCount}</span>
      `;

      row.addEventListener('click', () => {
        const ratingFilter = document.getElementById('rating-filter');
        if (ratingFilter) {
          ratingFilter.value = String(rating);
          currentPage = 1;
          renderReviews();
          scrollToReviews();
        }
      });

      breakdownEl.appendChild(row);
    }
  }
}

/**
 * Filter, sort, and render reviews into the responsive grid
 */
export function renderReviews() {
  const ratingFilterEl = document.getElementById('rating-filter');
  const mediaFilterEl = document.getElementById('media-filter');
  const sortFilterEl = document.getElementById('sort-filter');
  const resultsCountEl = document.getElementById('results-count');
  const gridEl = document.getElementById('reviews-grid');
  const paginationEl = document.getElementById('review-pagination');
  const pageIndicatorEl = document.getElementById('page-indicator');
  const prevBtn = document.getElementById('previous-page');
  const nextBtn = document.getElementById('next-page');

  if (!gridEl) return;

  const ratingFilter = ratingFilterEl ? ratingFilterEl.value : 'all';
  const mediaOnly = mediaFilterEl ? mediaFilterEl.getAttribute('aria-pressed') === 'true' : false;
  const sortOrder = sortFilterEl ? sortFilterEl.value : 'newest';

  const filteredReviews = allReviews
    .filter((review) => ratingFilter === 'all' || Number(review.rating) === Number(ratingFilter))
    .filter((review) => !mediaOnly || (Array.isArray(review.media) && review.media.length > 0))
    .sort((a, b) => {
      if (sortOrder === 'oldest') {
        return new Date(a.createdAt || a.date) - new Date(b.createdAt || b.date);
      }
      if (sortOrder === 'highest') {
        return (Number(b.rating) || 0) - (Number(a.rating) || 0);
      }
      if (sortOrder === 'lowest') {
        return (Number(a.rating) || 0) - (Number(b.rating) || 0);
      }
      // default: newest
      return new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date);
    });

  const totalPages = Math.max(1, Math.ceil(filteredReviews.length / reviewsPerPage));
  currentPage = Math.min(Math.max(1, currentPage), totalPages);

  const startIndex = (currentPage - 1) * reviewsPerPage;
  const pageReviews = filteredReviews.slice(startIndex, startIndex + reviewsPerPage);

  // Results count text
  if (resultsCountEl) {
    let resultsText = '';
    if (filteredReviews.length === 0) {
      resultsText = 'Showing 0 reviews';
    } else if (filteredReviews.length === 1) {
      resultsText = 'Showing 1 review';
    } else {
      const end = Math.min(startIndex + reviewsPerPage, filteredReviews.length);
      resultsText = `Showing ${startIndex + 1}–${end} of ${filteredReviews.length} reviews`;
    }
    resultsCountEl.textContent = resultsText;
  }

  // Pagination updates
  if (paginationEl) {
    paginationEl.hidden = filteredReviews.length <= reviewsPerPage;
  }
  if (pageIndicatorEl) {
    pageIndicatorEl.textContent = `Page ${currentPage} of ${totalPages}`;
  }
  if (prevBtn) {
    prevBtn.disabled = currentPage <= 1;
  }
  if (nextBtn) {
    nextBtn.disabled = currentPage >= totalPages;
  }

  // Clear grid
  gridEl.innerHTML = '';

  if (!filteredReviews.length) {
    gridEl.innerHTML = `
      <div class="empty-state" role="status">
        <strong>No reviews match these filters.</strong>
        Try another rating or turn off “With media”.
      </div>
    `;
    return;
  }

  pageReviews.forEach((review, idx) => {
    const card = document.createElement('article');
    card.className = 'review-card';

    const name = review.customerName || review.name || 'Customer';
    const initial = (name.trim().charAt(0) || 'C').toUpperCase();
    const { iso, label } = formatReviewDate(review.createdAt || review.date);
    const rating = Number(review.rating) || 5;
    const comment = review.comment || '';
    const reviewNumber = filteredReviews.length - (startIndex + idx);

    let avatarHtml = '';
    const avatarUrl = review.customerAvatar || review.avatarUrl || review.avatar;
    const hasValidDirectImage =
      avatarUrl &&
      !avatarUrl.startsWith('pgavatar:') &&
      !avatarUrl.startsWith('gridfs:') &&
      (avatarUrl.startsWith('http://') ||
        avatarUrl.startsWith('https://') ||
        avatarUrl.startsWith('data:') ||
        avatarUrl.startsWith('/'));

    if (hasValidDirectImage) {
      avatarHtml = `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(name)}" onerror="this.onerror=null;this.parentElement.textContent='${escapeHtml(initial)}';">`;
    } else {
      avatarHtml = escapeHtml(initial);
    }

    let mediaHtml = '';
    if (Array.isArray(review.media) && review.media.length > 0) {
      const mediaItems = review.media
        .map(
          (m) =>
            `<img src="${escapeHtml(m)}" alt="Review attachment" class="review-media-thumb" loading="lazy" />`
        )
        .join('');
      mediaHtml = `<div class="review-media-gallery">${mediaItems}</div>`;
    }

    const sourceLabel = review.source || 'Website Review';

    card.innerHTML = `
      <header class="review-header">
        <span class="review-avatar" aria-hidden="true">${avatarHtml}</span>
        <div class="review-identity">
          <div class="review-name">${escapeHtml(name)}</div>
          <time class="review-date" datetime="${escapeHtml(iso)}">${escapeHtml(label)}</time>
        </div>
        <span class="verified-badge">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/>
            <path d="m5 8 2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Verified
        </span>
      </header>
      <div class="review-rating">${starMarkup(rating, 'review-stars')}</div>
      <blockquote class="review-quote">“${escapeHtml(comment)}”</blockquote>
      ${mediaHtml}
      <footer class="review-footer">
        <span class="review-source">
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.2"/>
            <path d="M2 8h12M8 2a9.5 9.5 0 0 1 0 12M8 2a9.5 9.5 0 0 0 0 12" stroke="currentColor" stroke-width="1.2"/>
          </svg>
          ${escapeHtml(sourceLabel)}
        </span>
        <span class="review-number">#${reviewNumber}</span>
      </footer>
    `;

    gridEl.appendChild(card);
  });
}

function scrollToReviews() {
  const reviewsEl = document.getElementById('reviews');
  if (reviewsEl) {
    const yOffset = -80;
    const y = reviewsEl.getBoundingClientRect().top + window.pageYOffset + yOffset;
    window.scrollTo({ top: y, behavior: 'smooth' });
  }
}

/**
 * Load reviews from the backend feed
 */
export async function loadReviews() {
  const gridEl = document.getElementById('reviews-grid');
  if (gridEl) {
    gridEl.innerHTML = `
      <div class="state-box" style="grid-column: 1 / -1; padding: 36px; text-align: center; color: #8d98a3;">
        Loading customer reviews...
      </div>
    `;
  }

  try {
    let reviewsData = [];
    try {
      const res = await apiFetch('/reviews/feed');
      if (res && Array.isArray(res.reviews)) {
        reviewsData = res.reviews;
      }
    } catch {
      // Fallback to website reviews endpoint if /feed is unavailable
      const resFallback = await apiFetch('/reviews/website');
      if (resFallback && Array.isArray(resFallback.reviews)) {
        reviewsData = resFallback.reviews;
      }
    }

    allReviews = reviewsData.map((r) => ({
      id: r.id || r._id,
      name: r.customerName || r.customer_name || 'Customer',
      customerName: r.customerName || r.customer_name || 'Customer',
      customerAvatar: r.customerAvatar || r.customer_avatar || '',
      rating: Number(r.rating) || 5,
      comment: r.comment || '',
      createdAt: r.createdAt || r.created_at,
      date: r.createdAt || r.created_at,
      source: r.source || 'Website Review',
      media: Array.isArray(r.media) ? r.media : [],
      verified: r.verified !== undefined ? r.verified : true,
    }));

    renderSummary();
    renderReviews();
  } catch (err) {
    console.error('Failed to load reviews:', err);
    if (gridEl) {
      gridEl.innerHTML = `
        <div class="empty-state">
          <strong>Could not load reviews right now.</strong>
          Please check back shortly or try refreshing the page.
        </div>
      `;
    }
  }
}

/**
 * Initialize event listeners
 */
export function initReviewsPage() {
  ensureWebsiteReviewModalDOM();

  const ratingFilter = document.getElementById('rating-filter');
  const sortFilter = document.getElementById('sort-filter');
  const mediaFilter = document.getElementById('media-filter');
  const prevBtn = document.getElementById('previous-page');
  const nextBtn = document.getElementById('next-page');
  const writeReviewBtn = document.getElementById('btn-open-review-modal');

  const onFilterChange = () => {
    currentPage = 1;
    renderReviews();
  };

  if (ratingFilter) {
    ratingFilter.addEventListener('change', onFilterChange);
  }

  if (sortFilter) {
    sortFilter.addEventListener('change', onFilterChange);
  }

  if (mediaFilter) {
    mediaFilter.addEventListener('click', (event) => {
      const btn = event.currentTarget;
      const isPressed = btn.getAttribute('aria-pressed') === 'true';
      btn.setAttribute('aria-pressed', String(!isPressed));
      onFilterChange();
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage -= 1;
        renderReviews();
        scrollToReviews();
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      currentPage += 1;
      renderReviews();
      scrollToReviews();
    });
  }

  if (writeReviewBtn) {
    writeReviewBtn.addEventListener('click', () => {
      openWebsiteReviewModal();
    });
  }

  // React immediately when a user publishes a review from the modal
  window.addEventListener('gigabite:website-review-added', (event) => {
    const newReview = event.detail && event.detail.review;
    if (newReview) {
      allReviews.unshift({
        id: newReview.id || newReview._id,
        name: newReview.customerName || 'Customer',
        customerName: newReview.customerName || 'Customer',
        customerAvatar: newReview.customerAvatar || '',
        rating: Number(newReview.rating) || 5,
        comment: newReview.comment || '',
        createdAt: newReview.createdAt || new Date().toISOString(),
        date: newReview.createdAt || new Date().toISOString(),
        source: newReview.source || 'Website Review',
        media: Array.isArray(newReview.media) ? newReview.media : [],
        verified: true,
      });
      currentPage = 1;
      renderSummary();
      renderReviews();
      scrollToReviews();
    }
  });

  loadReviews();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initReviewsPage);
} else {
  initReviewsPage();
}
