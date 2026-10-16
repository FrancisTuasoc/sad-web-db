/**
 * Lucide Icons Suite (MIT Licensed, Free & Open Source)
 * Native ES module providing exact Lucide SVG strings and rendering helpers.
 */

export function lucideIcon(name, options = {}) {
  const {
    size = 20,
    stroke = 'currentColor',
    strokeWidth = 2,
    fill = 'none',
    className = '',
    ariaLabel = '',
    ariaHidden = true,
  } = options;

  const ariaAttrs = ariaLabel
    ? `aria-label="${ariaLabel}" role="img"`
    : ariaHidden
      ? 'aria-hidden="true"'
      : '';

  const cls = `lucide lucide-${name} ${className}`.trim();

  switch (name) {
    case 'star':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="${cls}" ${ariaAttrs}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;

    case 'star-half': {
      // Precise half star using SVG linearGradient
      const gradId = `lucide-star-half-${Math.random().toString(36).slice(2, 8)}`;
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="${cls}" ${ariaAttrs}>
        <defs>
          <linearGradient id="${gradId}">
            <stop offset="50%" stop-color="${fill !== 'none' ? fill : '#F59E0B'}" />
            <stop offset="50%" stop-color="transparent" />
          </linearGradient>
        </defs>
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="url(#${gradId})" />
      </svg>`;
    }

    case 'heart':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="${cls}" ${ariaAttrs}><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`;

    case 'chevron-down':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="${cls}" ${ariaAttrs}><path d="m6 9 6 6 6-6"/></svg>`;

    case 'chevron-up':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="${cls}" ${ariaAttrs}><path d="m18 15-6-6-6 6"/></svg>`;

    case 'user':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="${cls}" ${ariaAttrs}><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

    case 'shopping-bag':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="${cls}" ${ariaAttrs}><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`;

    case 'layout-dashboard':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="${cls}" ${ariaAttrs}><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>`;

    case 'message-square':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="${cls}" ${ariaAttrs}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;

    case 'trending-up':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="${cls}" ${ariaAttrs}><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>`;

    case 'trash-2':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="${cls}" ${ariaAttrs}><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`;

    case 'edit':
    case 'edit-3':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="${cls}" ${ariaAttrs}><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`;

    case 'loader-2':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="lucide-spinner ${cls}" ${ariaAttrs}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;

    case 'x':
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="${cls}" ${ariaAttrs}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;

    default:
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" class="${cls}" ${ariaAttrs}><circle cx="12" cy="12" r="10"/></svg>`;
  }
}

/**
 * Render standard Lucide star rating display (1-5 filled/half/empty stars)
 * size: default 18
 */
export function renderRatingStars(rating = 0, options = {}) {
  const {
    size = 18,
    activeColor = '#F59E0B',
    inactiveColor = '#D1D5DB',
    className = 'rating-stars-group',
  } = options;

  const num = Math.max(0, Math.min(5, Number(rating) || 0));
  let starsHtml = '';

  for (let i = 1; i <= 5; i++) {
    if (num >= i) {
      // Full star
      starsHtml += lucideIcon('star', {
        size,
        fill: activeColor,
        stroke: activeColor,
        className: 'star-icon star-filled',
        ariaHidden: true,
      });
    } else if (num >= i - 0.5) {
      // Half star
      starsHtml += lucideIcon('star-half', {
        size,
        fill: activeColor,
        stroke: activeColor,
        className: 'star-icon star-half',
        ariaHidden: true,
      });
    } else {
      // Empty star
      starsHtml += lucideIcon('star', {
        size,
        fill: 'none',
        stroke: inactiveColor,
        className: 'star-icon star-empty',
        ariaHidden: true,
      });
    }
  }

  return `<span class="${className}" aria-label="${num.toFixed(1)} out of 5 stars">${starsHtml}</span>`;
}

/**
 * Render star rating with review count label
 */
export function renderRatingBadge(averageRating = 0, reviewCount = 0, options = {}) {
  const { size = 16, showScore = true } = options;
  const count = Number(reviewCount) || 0;
  const score = Number(averageRating) || 0;
  const stars = renderRatingStars(score, { size });

  return `
    <div class="product-rating-row" data-rating="${score.toFixed(1)}" data-reviews="${count}">
      ${stars}
      ${showScore && score > 0 ? `<span class="rating-score">${score.toFixed(1)}</span>` : ''}
      <span class="rating-count">(${count} ${count === 1 ? 'review' : 'reviews'})</span>
    </div>
  `;
}
