// Home Page Controller
import { apiFetch } from './api.js';
import {
  renderHeader,
  renderFooter,
  renderBusinessHours,
  showToast,
  BURGER_PLACEHOLDER,
  escapeHtml,
  openModal,
  closeModal,
  updateCartBadge,
  getProductImageUrl,
} from './ui.js';
import { isLoggedIn } from './auth.js';
import { stockStream } from './stock-stream.js';
import { lucideIcon, renderRatingBadge } from './icons.js';
import {
  isItemFavorited,
  toggleFavorite,
  openReviewModalForProduct,
  loadCustomerFavorites,
  ensureReviewModalDOM,
} from './reviews-favorites.js';

export const DEFAULT_FEATURED_PRODUCTS = [
  {
    _id: 'prod-cdo-burger',
    name: 'CDO Burger',
    price: 27,
    category: { name: 'Burgers' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: true,
    slug: 'cdo-burger',
    description: 'Grilled beef patty.',
  },
  {
    _id: 'prod-burger-bacon',
    name: 'Burger with Bacon',
    price: 42,
    category: { name: 'Burgers' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: true,
    slug: 'burger-with-bacon',
    description: 'Beef patty with crispy bacon.',
  },
  {
    _id: 'prod-cheese-bacon',
    name: 'Cheese Burger with Bacon',
    price: 47,
    category: { name: 'Cheese Burgers' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: true,
    slug: 'cheese-burger-with-bacon',
    description: 'Cheesy patty with bacon.',
  },
  {
    _id: 'prod-complete-bacon',
    name: 'Complete with Bacon',
    price: 72,
    category: { name: 'Complete' },
    stock: 40,
    lowStockThreshold: 10,
    isAvailable: true,
    isFeatured: true,
    slug: 'complete-with-bacon',
    description: 'Patty, ham, egg, cheese & bacon.',
  },
];

let availableAddons = [];
let selectedProduct = null;
let onlineOrderingEnabled = false;

export function setOnlineOrderingEnabled(enabled) {
  onlineOrderingEnabled = Boolean(enabled);
}

export function renderProductCard(
  product,
  isGuest = false,
  canOrder = true,
  isFavoritedParam = null
) {
  const isAvailable = product.isAvailable && product.stock > 0;
  const isOutOfStock = product.stock <= 0;
  const isLowStock =
    product.stock > 0 && product.stock <= (product.lowStockThreshold || 10);

  let badgeClass = 'badge-in-stock';
  let badgeText = `${product.stock} left`;

  if (!product.isAvailable) {
    badgeClass = 'badge-out-stock';
    badgeText = 'Not Available';
  } else if (isOutOfStock) {
    badgeClass = 'badge-out-stock';
    badgeText = 'Out of Stock';
  } else if (isLowStock) {
    badgeClass = 'badge-low-stock';
    badgeText = `Only ${product.stock} left`;
  }

  const categoryName =
    product.category && typeof product.category === 'object'
      ? product.category.name
      : '';
  const imgUrl = getProductImageUrl(product);
  const productId = product._id || product.id;

  // Favorites state
  const isFavorited =
    isFavoritedParam !== null
      ? Boolean(isFavoritedParam)
      : isItemFavorited(productId);

  // Ratings
  const avgRating = Number(product.averageRating || 0);
  const reviewCount = Number(product.reviewCount || 0);

  // Ultra-concise description (under 35 chars) to keep item cards compact and consistent
  const fullDesc = (product.description || 'Freshly grilled specialty.').trim();
  const shortDesc = fullDesc.length > 36 ? fullDesc.slice(0, 34).trim() + '...' : fullDesc;

  let buttonHtml = '';
  const canPlaceOrder = canOrder && onlineOrderingEnabled;
  if (!onlineOrderingEnabled) {
    buttonHtml =
      '<button type="button" class="btn btn-primary btn-sm" disabled>Ordering Paused</button>';
  } else if (!canOrder) {
    buttonHtml =
      '<button type="button" class="btn btn-primary btn-sm" disabled>Unavailable</button>';
  } else if (isGuest) {
    buttonHtml = `
      <button type="button" class="btn btn-primary btn-sm btn-add-to-cart" data-is-guest="true" data-product-id="${productId}" ${!isAvailable ? 'disabled' : ''}>
        Login to order
      </button>
    `;
  } else {
    buttonHtml = `
      <button type="button" class="btn btn-primary btn-sm btn-add-to-cart" data-is-guest="false" data-product-id="${productId}" ${!isAvailable ? 'disabled' : ''}>
        ${!product.isAvailable ? 'Unavailable' : isOutOfStock ? 'Out of Stock' : 'Add to Cart'}
      </button>
    `;
  }

  return `
    <article class="product-card ${!isAvailable ? 'unavailable' : ''}" 
             data-product-id="${productId}" 
             data-stock="${product.stock}" 
             data-threshold="${product.lowStockThreshold || 10}"
             data-available="${product.isAvailable}"
             data-ordering-allowed="${canPlaceOrder}">
      <div class="card-img-wrap">
        <span class="card-badge-pos badge ${badgeClass} stock-badge">${badgeText}</span>
        <button type="button" 
                class="card-fav-btn ${isFavorited ? 'is-favorited' : ''}" 
                data-favorite-btn="true" 
                data-product-id="${productId}" 
                aria-label="${isFavorited ? 'Remove from favorites' : 'Add to favorites'}" 
                title="${isFavorited ? 'Remove from favorites' : 'Add to favorites'}">
          ${lucideIcon('heart', {
            size: 18,
            fill: isFavorited ? '#E53E3E' : 'none',
            stroke: isFavorited ? '#E53E3E' : 'currentColor',
            strokeWidth: 2,
            className: 'fav-icon',
            ariaHidden: true,
          })}
        </button>
        <img src="${escapeHtml(imgUrl)}" 
             alt="${escapeHtml(product.name)}" 
             loading="lazy" 
             onerror="if(window.handleImageError){window.handleImageError(this);}else{this.onerror=null;this.src='${BURGER_PLACEHOLDER}';}">
      </div>
      <div class="card-content">
        <div class="card-meta-row">
          ${categoryName ? `<span class="card-category">${escapeHtml(categoryName)}</span>` : '<span class="card-category">Specialty</span>'}
          <div class="card-rating-clickable" 
               data-open-review-btn="true" 
               data-product-id="${productId}"
               role="button"
               tabindex="0"
               title="Click to write or view review"
               aria-label="Rating: ${avgRating.toFixed(1)} stars out of 5 from ${reviewCount} reviews. Click to review.">
            ${renderRatingBadge(avgRating, reviewCount, { size: 14 })}
          </div>
        </div>
        <h3 class="card-title">${escapeHtml(product.name)}</h3>
        <div class="card-desc-container">
          <p class="card-desc">${escapeHtml(shortDesc)}</p>
        </div>
        <div class="card-footer">
          <span class="card-price">₱${Number(product.price).toFixed(2)}</span>
          ${buttonHtml}
        </div>
      </div>
    </article>
  `;
}

async function loadStoreInfo() {
  try {
    const res = await apiFetch('/settings/public');
    if (res && res.settings) {
      const s = res.settings;
      setOnlineOrderingEnabled(s.acceptingOrders);
      const orderingNotice = document.getElementById('home-ordering-notice');
      if (orderingNotice) {
        orderingNotice.classList.toggle('hidden', onlineOrderingEnabled);
        orderingNotice.textContent = onlineOrderingEnabled
          ? ''
          : 'Online ordering is temporarily paused. You can still browse the menu; please check back later.';
      }
      const contactAddress = document.getElementById('contact-address');
      const contactEmail = document.getElementById('contact-email');
      const contactPhone = document.getElementById('contact-phone');
      const contactHours = document.getElementById('contact-hours');

      if (contactAddress && typeof s.address === 'string')
        contactAddress.textContent = s.address;
      if (contactEmail && typeof s.email === 'string') {
        contactEmail.textContent = s.email;
        contactEmail.href = `mailto:${encodeURI(s.email)}`;
      }
      if (contactPhone && typeof s.phone === 'string' && s.phone.trim()) {
        contactPhone.textContent = s.phone;
        const phoneDigits = s.phone.replace(/\D/g, '');
        const countryPrefix = s.phone.trim().startsWith('+') ? '+' : '';
        contactPhone.href = `tel:${countryPrefix}${phoneDigits}`;
      }
      renderBusinessHours(contactHours, s.businessHours);
      return s;
    }
  } catch (err) {
    // Keep defaults
  }
  setOnlineOrderingEnabled(false);
  const orderingNotice = document.getElementById('home-ordering-notice');
  if (orderingNotice) {
    orderingNotice.classList.remove('hidden');
    orderingNotice.textContent =
      'Online ordering availability could not be confirmed. Please try again later.';
  }
  return null;
}

async function loadFeaturedProducts() {
  const container = document.getElementById('featured-grid');
  if (!container) return;

  const isGuest = !isLoggedIn();

  try {
    const data = await apiFetch('/products?sort=featured');
    availableAddons = Array.isArray(data && data.addons) ? data.addons : [];
    if (data && Array.isArray(data.products)) {
      const featured = data.products.filter((p) => !p.isAddon && p.isFeatured);
      if (featured.length > 0) {
        container.innerHTML = featured
          .slice(0, 4)
          .map((p) => renderProductCard(p, isGuest))
          .join('');
      } else {
        container.innerHTML =
          '<div class="state-box" style="grid-column:1/-1;"><h3 class="state-title">No featured items right now</h3><p class="state-desc">Browse the full menu to see what is available.</p><a href="menu.html" class="btn btn-secondary btn-sm">View Menu</a></div>';
      }
      container.setAttribute('aria-busy', 'false');
      return;
    }
    throw new Error('The featured menu response was invalid.');
  } catch (err) {
    // Seamless fallback to default featured products so menu is NEVER empty
    container.innerHTML = DEFAULT_FEATURED_PRODUCTS.map((p) =>
      renderProductCard(p, isGuest, false)
    ).join('');
    container.setAttribute('aria-busy', 'false');
  }
}

export function setAvailableAddons(addons) {
  availableAddons = Array.isArray(addons) ? addons : [];
}

// Add to Cart Modal Flow
export function setupAddToCartModal() {
  const modal = document.getElementById('add-to-cart-modal');
  if (!modal) return;

  const closeBtn = document.getElementById('modal-close-btn');
  const cancelBtn = document.getElementById('modal-cancel-btn');
  const confirmBtn = document.getElementById('modal-confirm-btn');

  const qtyMinus = document.getElementById('modal-qty-minus');
  const qtyPlus = document.getElementById('modal-qty-plus');
  const qtyInput = document.getElementById('modal-qty-val');

  if (closeBtn)
    closeBtn.addEventListener('click', () => closeModal('add-to-cart-modal'));
  if (cancelBtn)
    cancelBtn.addEventListener('click', () => closeModal('add-to-cart-modal'));

  function updateModalTotal() {
    if (!selectedProduct) return;
    const qty = parseInt(qtyInput.textContent, 10) || 1;

    let addonsSum = 0;
    const addonCheckboxes = document.querySelectorAll(
      '.modal-addon-checkbox:checked'
    );
    addonCheckboxes.forEach((cb) => {
      const price = parseFloat(cb.getAttribute('data-price')) || 0;
      const miniQtyInput = document.getElementById(`addon-qty-${cb.value}`);
      const miniQty = miniQtyInput
        ? parseInt(miniQtyInput.textContent, 10) || 1
        : 1;
      addonsSum += price * miniQty;
    });

    const total = selectedProduct.price * qty + addonsSum;
    const totalElem = document.getElementById('modal-line-total');
    if (totalElem) totalElem.textContent = `₱${total.toFixed(2)}`;
  }

  if (qtyMinus) {
    qtyMinus.addEventListener('click', () => {
      let current = parseInt(qtyInput.textContent, 10) || 1;
      if (current > 1) {
        qtyInput.textContent = String(current - 1);
        updateModalTotal();
      }
    });
  }

  if (qtyPlus) {
    qtyPlus.addEventListener('click', () => {
      let current = parseInt(qtyInput.textContent, 10) || 1;
      if (selectedProduct && current < selectedProduct.stock) {
        qtyInput.textContent = String(current + 1);
        updateModalTotal();
      } else {
        showToast(
          `Maximum available stock reached (${selectedProduct ? selectedProduct.stock : 40})`,
          'warning'
        );
      }
    });
  }

  if (confirmBtn) {
    confirmBtn.addEventListener('click', async () => {
      if (!selectedProduct) return;
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Adding...';

      const qty = parseInt(qtyInput.textContent, 10) || 1;
      const addonsPayload = [];
      const addonCheckboxes = document.querySelectorAll(
        '.modal-addon-checkbox:checked'
      );
      addonCheckboxes.forEach((cb) => {
        const miniQtyInput = document.getElementById(`addon-qty-${cb.value}`);
        const miniQty = miniQtyInput
          ? parseInt(miniQtyInput.textContent, 10) || 1
          : 1;
        addonsPayload.push({
          product: cb.value,
          qty: miniQty,
        });
      });

      try {
        await apiFetch('/cart', {
          method: 'POST',
          body: JSON.stringify({
            productId: selectedProduct._id,
            quantity: qty,
            addons: addonsPayload,
            addonQuantityMode: 'per_order',
          }),
        });

        showToast(`Added ${selectedProduct.name} to your cart!`, 'success');
        closeModal('add-to-cart-modal');
        updateCartBadge();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Confirm & Add to Cart';
      }
    });
  }
}

export async function openAddToCartForProduct(productId, productObj = null) {
  if (!isLoggedIn()) {
    showToast('Please log in to order.', 'info');
    setTimeout(() => {
      window.location.href = `login.html?redirect=${encodeURIComponent(window.location.pathname)}`;
    }, 700);
    return;
  }

  try {
    if (productObj) {
      selectedProduct = productObj;
    } else {
      const res = await apiFetch(`/products/${productId}`);
      selectedProduct = res.product;
    }
  } catch (err) {
    selectedProduct = DEFAULT_FEATURED_PRODUCTS.find(
      (p) => p._id === productId
    ) || {
      _id: productId,
      name: 'Burger Specialty',
      price: 35,
      stock: 40,
      isAvailable: true,
    };
  }

  if (
    !selectedProduct ||
    !selectedProduct.isAvailable ||
    selectedProduct.stock <= 0
  ) {
    showToast('This item is currently unavailable.', 'warning');
    return;
  }

  // Prefill modal details
  document.getElementById('modal-product-name').textContent =
    selectedProduct.name;
  document.getElementById('modal-product-price').textContent =
    `₱${Number(selectedProduct.price).toFixed(2)}`;
  document.getElementById('modal-qty-val').textContent = '1';
  const productImage = document.getElementById('modal-product-image');
  if (productImage) {
    productImage.alt = selectedProduct.name;
    productImage.onerror = () => {
      productImage.onerror = null;
      productImage.src = BURGER_PLACEHOLDER;
    };
    productImage.src = getProductImageUrl(selectedProduct);
  }

  // Populate addons
  const addonsListContainer = document.getElementById('modal-addons-list');
  if (addonsListContainer) {
    const addonsToUse = availableAddons.filter(
      (addon) => addon.isAvailable && addon.stock > 0
    );
    addonsListContainer.innerHTML = addonsToUse.length
      ? addonsToUse
          .map(
            (addon) => `
        <div class="addon-row">
          <label class="addon-choice" for="modal-addon-${addon._id}">
            <input type="checkbox" id="modal-addon-${addon._id}" class="modal-addon-checkbox" value="${addon._id}" data-price="${addon.price}" data-stock="${addon.stock}">
            <span><strong>${escapeHtml(addon.name)}</strong><small>+₱${addon.price.toFixed(2)}</small></span>
          </label>
          <div class="qty-stepper addon-qty-stepper">
            <button type="button" class="stepper-btn mini-addon-minus" data-target="addon-qty-${addon._id}" aria-label="Decrease ${escapeHtml(addon.name)} quantity">−</button>
            <span class="stepper-val" id="addon-qty-${addon._id}">1</span>
            <button type="button" class="stepper-btn mini-addon-plus" data-target="addon-qty-${addon._id}" data-stock="${addon.stock}" aria-label="Increase ${escapeHtml(addon.name)} quantity">+</button>
          </div>
        </div>
      `
          )
          .join('')
      : '<p class="text-muted">No add-ons are currently available.</p>';

    // Wire mini steppers and checkbox changes
    addonsListContainer
      .querySelectorAll('.modal-addon-checkbox')
      .forEach((cb) => {
        cb.addEventListener('change', () => {
          const currentQty =
            parseInt(
              document.getElementById('modal-qty-val').textContent,
              10
            ) || 1;
          let addonsSum = 0;
          document
            .querySelectorAll('.modal-addon-checkbox:checked')
            .forEach((ch) => {
              const price = parseFloat(ch.getAttribute('data-price')) || 0;
              const miniInput = document.getElementById(
                `addon-qty-${ch.value}`
              );
              const miniVal = miniInput
                ? parseInt(miniInput.textContent, 10) || 1
                : 1;
              addonsSum += price * miniVal;
            });
          const lineTotal = selectedProduct.price * currentQty + addonsSum;
          document.getElementById('modal-line-total').textContent =
            `₱${lineTotal.toFixed(2)}`;
        });
      });

    addonsListContainer.querySelectorAll('.mini-addon-minus').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetId = btn.getAttribute('data-target');
        const elem = document.getElementById(targetId);
        if (elem) {
          let val = parseInt(elem.textContent, 10) || 1;
          if (val > 1) {
            elem.textContent = String(val - 1);
            const cb = elem
              .closest('.addon-row')
              .querySelector('.modal-addon-checkbox');
            if (cb.checked) cb.dispatchEvent(new Event('change'));
          }
        }
      });
    });

    addonsListContainer.querySelectorAll('.mini-addon-plus').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetId = btn.getAttribute('data-target');
        const elem = document.getElementById(targetId);
        if (elem) {
          let val = parseInt(elem.textContent, 10) || 1;
          const stock = Number(btn.getAttribute('data-stock')) || 0;
          if (val < stock) {
            elem.textContent = String(val + 1);
            const cb = elem
              .closest('.addon-row')
              .querySelector('.modal-addon-checkbox');
            if (cb.checked) cb.dispatchEvent(new Event('change'));
          } else {
            showToast(`Only ${stock} of this add-on are available.`, 'warning');
          }
        }
      });
    });
  }

  document.getElementById('modal-line-total').textContent =
    `₱${Number(selectedProduct.price).toFixed(2)}`;
  openModal('add-to-cart-modal');
}

// Global Event Delegation for Product Grid cards
export function attachProductGridListeners(
  containerId = 'featured-grid',
  getProductById = null
) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.addEventListener('click', async (e) => {
    // 1. Description Expand / Collapse Toggle
    const descToggleBtn = e.target.closest('.btn-desc-toggle');
    if (descToggleBtn) {
      e.preventDefault();
      e.stopPropagation();
      const descContainer = descToggleBtn.closest('.card-desc-container');
      if (descContainer) {
        const isExpanded = descContainer.getAttribute('data-expanded') === 'true';
        const nextState = !isExpanded;
        descContainer.setAttribute('data-expanded', String(nextState));
        descToggleBtn.setAttribute('aria-expanded', String(nextState));

        const shortP = descContainer.querySelector('.card-desc-short');
        const fullP = descContainer.querySelector('.card-desc-full');

        if (nextState) {
          if (shortP) shortP.classList.add('hidden');
          if (fullP) fullP.classList.remove('hidden');
          descToggleBtn.innerHTML = `
            <span class="desc-toggle-label">See less</span>
            ${lucideIcon('chevron-up', { size: 14, className: 'desc-toggle-icon', ariaHidden: true })}
          `;
        } else {
          if (shortP) shortP.classList.remove('hidden');
          if (fullP) fullP.classList.add('hidden');
          descToggleBtn.innerHTML = `
            <span class="desc-toggle-label">See more</span>
            ${lucideIcon('chevron-down', { size: 14, className: 'desc-toggle-icon', ariaHidden: true })}
          `;
        }
      }
      return;
    }

    // 2. Favorite Heart Button Toggle
    const favBtn = e.target.closest('[data-favorite-btn="true"]');
    if (favBtn) {
      e.preventDefault();
      e.stopPropagation();
      const productId = favBtn.getAttribute('data-product-id');
      await toggleFavorite(productId, favBtn);
      return;
    }

    // 3. Rate & Review Click Trigger
    const reviewTrigger = e.target.closest('[data-open-review-btn="true"]');
    if (reviewTrigger) {
      e.preventDefault();
      e.stopPropagation();
      const productId = reviewTrigger.getAttribute('data-product-id');
      const card = reviewTrigger.closest('.product-card');
      const cardTitle = card ? card.querySelector('.card-title')?.textContent : 'Menu Item';
      const productObj = getProductById ? getProductById(productId) : { _id: productId, name: cardTitle };
      await openReviewModalForProduct(productObj || { _id: productId, name: cardTitle });
      return;
    }

    // 4. Add to Cart Button
    const btn = e.target.closest('.btn-add-to-cart');
    if (btn) {
      e.preventDefault();
      const productId = btn.getAttribute('data-product-id');
      const isGuest = btn.getAttribute('data-is-guest') === 'true';
      if (isGuest) {
        showToast('Please log in to start ordering.', 'info');
        setTimeout(() => {
          window.location.href = `login.html?redirect=${encodeURIComponent(window.location.pathname)}`;
        }, 700);
      } else {
        const productObj = getProductById ? getProductById(productId) : null;
        openAddToCartForProduct(productId, productObj);
      }
    }
  });

  // Keyboard accessibility for Enter / Space
  container.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const target = e.target.closest('[data-favorite-btn="true"], [data-open-review-btn="true"]');
      if (target) {
        e.preventDefault();
        target.click();
      }
    }
  });
}

function initHome() {
  renderHeader('home');
  setupHomeSectionNavigation();
  renderFooter();
  ensureReviewModalDOM();
  loadCustomerFavorites().then(() => {
    loadStoreInfo().then(() => loadFeaturedProducts());
  });
  setupAddToCartModal();
  attachProductGridListeners('featured-grid', (id) =>
    DEFAULT_FEATURED_PRODUCTS.find((p) => p._id === id)
  );
  stockStream.init();
}

function setupHomeSectionNavigation() {
  const header = document.getElementById('site-header');
  const sections = [
    { id: '', element: document.querySelector('.hero-section') },
    { id: 'featured', element: document.getElementById('featured') },
    { id: 'about', element: document.getElementById('about') },
    { id: 'contact', element: document.getElementById('contact') },
  ].filter((section) => section.element);

  let isClickScrolling = false;
  let clickLockTimer = null;
  let currentActiveId = null;

  function setActiveSection(targetId) {
    currentActiveId = targetId;
    const links = document.querySelectorAll(
      '#site-header .nav-links a, #mobile-drawer-menu a'
    );
    links.forEach((link) => {
      const href = link.getAttribute('href') || '';
      const linkUrl = new URL(link.href, window.location.href);
      const isHome =
        !linkUrl.hash &&
        (href === 'index.html' ||
          href === '/' ||
          linkUrl.pathname.endsWith('index.html') ||
          linkUrl.pathname === '/');
      const isActive = targetId
        ? linkUrl.hash === `#${targetId}`
        : isHome && !linkUrl.hash;

      link.classList.toggle('active', isActive);
      if (isActive) {
        link.setAttribute('aria-current', 'location');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  }

  function getSectionInView() {
    const isAtPageBottom =
      window.scrollY + window.innerHeight >=
      document.documentElement.scrollHeight - 35;
    if (isAtPageBottom && document.getElementById('contact')) {
      return 'contact';
    }

    if (window.scrollY < 120) {
      return '';
    }

    const headerElem = document.getElementById('site-header');
    const headerHeight = headerElem ? headerElem.offsetHeight : 72;
    const scrollPos = window.scrollY + headerHeight + 80;

    const orderedSectionIds = ['contact', 'about', 'featured'];
    for (const id of orderedSectionIds) {
      const elem = document.getElementById(id);
      if (elem) {
        const top = elem.getBoundingClientRect().top + window.scrollY;
        if (scrollPos >= top) {
          return id;
        }
      }
    }
    return '';
  }

  function handleScroll() {
    if (isClickScrolling) return;
    const sectionInView = getSectionInView();
    if (sectionInView !== currentActiveId) {
      setActiveSection(sectionInView);
    }
  }

  const releaseLock = () => {
    if (isClickScrolling) {
      isClickScrolling = false;
      if (clickLockTimer) {
        clearTimeout(clickLockTimer);
        clickLockTimer = null;
      }
      handleScroll();
    }
  };

  window.addEventListener('wheel', releaseLock, { passive: true });
  window.addEventListener('touchstart', releaseLock, { passive: true });
  window.addEventListener('scrollend', releaseLock, { passive: true });

  window.addEventListener(
    'scroll',
    () => {
      if (!isClickScrolling) {
        window.requestAnimationFrame(handleScroll);
      }
    },
    { passive: true }
  );

  document.addEventListener('click', (event) => {
    const link = event.target.closest(
      '#site-header .nav-links a, #mobile-drawer-menu a'
    );
    if (!link) return;

    const href = link.getAttribute('href') || '';
    const linkUrl = new URL(link.href, window.location.href);

    const isCurrentPage =
      linkUrl.pathname === window.location.pathname ||
      (linkUrl.pathname.endsWith('index.html') &&
        (window.location.pathname.endsWith('index.html') ||
          window.location.pathname === '/')) ||
      (linkUrl.pathname === '/' &&
        window.location.pathname.endsWith('index.html'));

    if (!isCurrentPage) return;

    const hash = linkUrl.hash ? linkUrl.hash.slice(1) : '';
    const isHome =
      !hash &&
      (href === 'index.html' || href === '/' || href.endsWith('index.html'));

    if (hash || isHome) {
      event.preventDefault();

      const mobileDrawer = document.getElementById('mobile-drawer-menu');
      if (mobileDrawer) mobileDrawer.classList.remove('open');

      setActiveSection(hash);

      isClickScrolling = true;
      if (clickLockTimer) clearTimeout(clickLockTimer);
      clickLockTimer = setTimeout(releaseLock, 850);

      let targetY = 0;
      if (hash) {
        const targetElem = document.getElementById(hash);
        if (targetElem) {
          const headerElem = document.getElementById('site-header');
          const headerHeight = headerElem ? headerElem.offsetHeight : 72;
          const rect = targetElem.getBoundingClientRect();
          targetY = window.scrollY + rect.top - headerHeight + 2;
        }
      }

      window.scrollTo({
        top: Math.max(0, targetY),
        behavior: 'smooth',
      });

      if (window.history && window.history.pushState) {
        window.history.pushState(
          null,
          '',
          hash ? `#${hash}` : window.location.pathname
        );
      }
    }
  });

  window.addEventListener('hashchange', () => {
    const hash = window.location.hash ? window.location.hash.slice(1) : '';
    setActiveSection(hash);
  });

  window.addEventListener('resize', handleScroll);

  const initialHash = window.location.hash
    ? window.location.hash.slice(1)
    : '';
  if (initialHash && ['featured', 'about', 'contact'].includes(initialHash)) {
    setActiveSection(initialHash);
  } else {
    setActiveSection('');
  }
}

if (document.getElementById('featured-grid')) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHome);
  } else {
    initHome();
  }
}
