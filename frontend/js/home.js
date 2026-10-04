// Home Page Controller
import { apiFetch } from './api.js';
import { renderHeader, renderFooter, showToast, BURGER_PLACEHOLDER, escapeHtml, openModal, closeModal, updateCartBadge, getProductImageUrl } from './ui.js';
import { isLoggedIn } from './auth.js';
import { stockStream } from './stock-stream.js';

export const DEFAULT_FEATURED_PRODUCTS = [
  { _id: 'prod-cdo-burger', name: 'CDO Burger', price: 27, category: { name: 'Burgers' }, stock: 40, lowStockThreshold: 10, isAvailable: true, isFeatured: true, slug: 'cdo-burger', description: 'Classic grilled beef patty in a toasted sesame bun with our special dressing.' },
  { _id: 'prod-burger-bacon', name: 'Burger with Bacon', price: 42, category: { name: 'Burgers' }, stock: 40, lowStockThreshold: 10, isAvailable: true, isFeatured: true, slug: 'burger-with-bacon', description: 'Savory burger patty crowned with crispy smoked bacon strips.' },
  { _id: 'prod-cheese-bacon', name: 'Cheese Burger with Bacon', price: 47, category: { name: 'Cheese Burgers' }, stock: 40, lowStockThreshold: 10, isAvailable: true, isFeatured: true, slug: 'cheese-burger-with-bacon', description: 'Smokey crispy bacon layered over golden melted cheese and beef patty.' },
  { _id: 'prod-complete-bacon', name: 'Complete with Bacon', price: 72, category: { name: 'Complete' }, stock: 40, lowStockThreshold: 10, isAvailable: true, isFeatured: true, slug: 'complete-with-bacon', description: 'The ultimate monster burger: beef patty, ham, egg, cheese, slaw, and crispy bacon.' },
];

export const DEFAULT_ADDONS = [
  { _id: 'addon-patty', name: 'Add Patty', price: 15, stock: 100, isAvailable: true, isAddon: true },
  { _id: 'addon-ham', name: 'Add Ham', price: 12, stock: 100, isAvailable: true, isAddon: true },
  { _id: 'addon-slaw', name: 'Add Coleslaw', price: 3, stock: 100, isAvailable: true, isAddon: true },
];

let availableAddons = [...DEFAULT_ADDONS];
let selectedProduct = null;

export function renderProductCard(product, isGuest = false) {
  const isAvailable = product.isAvailable && product.stock > 0;
  const isOutOfStock = product.stock <= 0;
  const isLowStock = product.stock > 0 && product.stock <= (product.lowStockThreshold || 10);

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

  const categoryName = product.category && typeof product.category === 'object' ? product.category.name : '';
  const imgUrl = getProductImageUrl(product);

  let buttonHtml = '';
  if (isGuest) {
    buttonHtml = `
      <button type="button" class="btn btn-primary btn-sm btn-add-to-cart" data-is-guest="true" data-product-id="${product._id}" ${!isAvailable ? 'disabled' : ''}>
        Login to order
      </button>
    `;
  } else {
    buttonHtml = `
      <button type="button" class="btn btn-primary btn-sm btn-add-to-cart" data-is-guest="false" data-product-id="${product._id}" ${!isAvailable ? 'disabled' : ''}>
        ${!product.isAvailable ? 'Unavailable' : isOutOfStock ? 'Out of Stock' : 'Add to Cart'}
      </button>
    `;
  }

  return `
    <article class="product-card ${!isAvailable ? 'unavailable' : ''}" 
             data-product-id="${product._id}" 
             data-stock="${product.stock}" 
             data-threshold="${product.lowStockThreshold || 10}"
             data-available="${product.isAvailable}">
      <div class="card-img-wrap">
        <span class="card-badge-pos badge ${badgeClass} stock-badge">${badgeText}</span>
        <img src="${escapeHtml(imgUrl)}" 
             alt="${escapeHtml(product.name)}" 
             loading="lazy" 
             onerror="if(window.handleImageError){window.handleImageError(this);}else{this.onerror=null;this.src='${BURGER_PLACEHOLDER}';}">
      </div>
      <div class="card-content">
        ${categoryName ? `<span class="card-category">${escapeHtml(categoryName)}</span>` : ''}
        <h3 class="card-title">${escapeHtml(product.name)}</h3>
        <p class="card-desc">${escapeHtml(product.description || 'Delicious freshly grilled burger specialty.')}</p>
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
      const heroTitleElem = document.getElementById('hero-store-name');
      const heroTaglineElem = document.getElementById('hero-tagline');
      const aboutStoreName = document.getElementById('about-store-name');
      const contactAddress = document.getElementById('contact-address');
      const contactPhone = document.getElementById('contact-phone');
      const contactEmail = document.getElementById('contact-email');

      if (heroTitleElem && s.storeName) heroTitleElem.textContent = s.storeName;
      if (heroTaglineElem && s.tagline) heroTaglineElem.textContent = s.tagline;
      if (aboutStoreName && s.storeName) aboutStoreName.textContent = s.storeName;
      if (contactAddress && s.address) contactAddress.textContent = s.address;
      if (contactPhone && s.phone) contactPhone.textContent = s.phone;
      if (contactEmail && s.email) contactEmail.textContent = s.email;
    }
  } catch (err) {
    // Keep defaults
  }
}

async function loadFeaturedProducts() {
  const container = document.getElementById('featured-grid');
  if (!container) return;

  const isGuest = !isLoggedIn();

  try {
    const data = await apiFetch('/products?sort=featured');
    if (data && data.products && data.products.length > 0) {
      availableAddons = data.addons || DEFAULT_ADDONS;
      const featured = data.products.filter((p) => !p.isAddon && p.isFeatured).slice(0, 4);
      if (featured.length > 0) {
        container.innerHTML = featured.map((p) => renderProductCard(p, isGuest)).join('');
        return;
      }
    }
    // Fallback if empty array from server
    container.innerHTML = DEFAULT_FEATURED_PRODUCTS.map((p) => renderProductCard(p, isGuest)).join('');
  } catch (err) {
    // Seamless fallback to default featured products so menu is NEVER empty
    container.innerHTML = DEFAULT_FEATURED_PRODUCTS.map((p) => renderProductCard(p, isGuest)).join('');
  }
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

  if (closeBtn) closeBtn.addEventListener('click', () => closeModal('add-to-cart-modal'));
  if (cancelBtn) cancelBtn.addEventListener('click', () => closeModal('add-to-cart-modal'));

  function updateModalTotal() {
    if (!selectedProduct) return;
    const qty = parseInt(qtyInput.textContent, 10) || 1;

    let addonsSum = 0;
    const addonCheckboxes = document.querySelectorAll('.modal-addon-checkbox:checked');
    addonCheckboxes.forEach((cb) => {
      const price = parseFloat(cb.getAttribute('data-price')) || 0;
      const miniQtyInput = document.getElementById(`addon-qty-${cb.value}`);
      const miniQty = miniQtyInput ? parseInt(miniQtyInput.textContent, 10) || 1 : 1;
      addonsSum += price * miniQty;
    });

    const total = (selectedProduct.price + addonsSum) * qty;
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
        showToast(`Maximum available stock reached (${selectedProduct ? selectedProduct.stock : 40})`, 'warning');
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
      const addonCheckboxes = document.querySelectorAll('.modal-addon-checkbox:checked');
      addonCheckboxes.forEach((cb) => {
        const miniQtyInput = document.getElementById(`addon-qty-${cb.value}`);
        const miniQty = miniQtyInput ? parseInt(miniQtyInput.textContent, 10) || 1 : 1;
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
          }),
        });

        showToast(`Added ${selectedProduct.name} to your cart!`, 'success');
        closeModal('add-to-cart-modal');
        updateCartBadge();
      } catch (err) {
        // Fallback for offline / demo mode
        try {
          const localCart = JSON.parse(localStorage.getItem('cart') || '[]');
          localCart.push({
            _id: 'cart-' + Date.now(),
            product: selectedProduct,
            quantity: qty,
            addons: addonsPayload.map((a) => {
              const matched = availableAddons.find((ad) => ad._id === a.product) || { name: 'Add-on', price: 10 };
              return { product: matched, qty: a.qty };
            }),
          });
          localStorage.setItem('cart', JSON.stringify(localCart));
          showToast(`Added ${selectedProduct.name} to your cart!`, 'success');
          closeModal('add-to-cart-modal');
          updateCartBadge();
        } catch (localErr) {
          showToast(err.message, 'error');
        }
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
    selectedProduct = DEFAULT_FEATURED_PRODUCTS.find((p) => p._id === productId) || {
      _id: productId,
      name: 'Burger Specialty',
      price: 35,
      stock: 40,
      isAvailable: true,
    };
  }

  if (!selectedProduct || !selectedProduct.isAvailable || selectedProduct.stock <= 0) {
    showToast('This item is currently unavailable.', 'warning');
    return;
  }

  // Prefill modal details
  document.getElementById('modal-product-name').textContent = selectedProduct.name;
  document.getElementById('modal-product-price').textContent = `₱${Number(selectedProduct.price).toFixed(2)}`;
  document.getElementById('modal-qty-val').textContent = '1';

  // Populate addons
  const addonsListContainer = document.getElementById('modal-addons-list');
  if (addonsListContainer) {
    const addonsToUse = availableAddons && availableAddons.length > 0 ? availableAddons : DEFAULT_ADDONS;
    addonsListContainer.innerHTML = addonsToUse
      .map((addon) => `
        <div class="addon-row" style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--color-border);font-size:0.88rem;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" class="modal-addon-checkbox" value="${addon._id}" data-price="${addon.price}">
            <span><strong>${escapeHtml(addon.name)}</strong> (+₱${addon.price.toFixed(2)})</span>
          </label>
          <div class="qty-stepper" style="transform:scale(0.85);transform-origin:right center;">
            <button type="button" class="stepper-btn mini-addon-minus" data-target="addon-qty-${addon._id}">-</button>
            <span class="stepper-val" id="addon-qty-${addon._id}">1</span>
            <button type="button" class="stepper-btn mini-addon-plus" data-target="addon-qty-${addon._id}">+</button>
          </div>
        </div>
      `)
      .join('');

    // Wire mini steppers and checkbox changes
    addonsListContainer.querySelectorAll('.modal-addon-checkbox').forEach((cb) => {
      cb.addEventListener('change', () => {
        const currentQty = parseInt(document.getElementById('modal-qty-val').textContent, 10) || 1;
        let addonsSum = 0;
        document.querySelectorAll('.modal-addon-checkbox:checked').forEach((ch) => {
          const price = parseFloat(ch.getAttribute('data-price')) || 0;
          const miniInput = document.getElementById(`addon-qty-${ch.value}`);
          const miniVal = miniInput ? parseInt(miniInput.textContent, 10) || 1 : 1;
          addonsSum += price * miniVal;
        });
        const lineTotal = (selectedProduct.price + addonsSum) * currentQty;
        document.getElementById('modal-line-total').textContent = `₱${lineTotal.toFixed(2)}`;
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
            const cb = elem.closest('.addon-row').querySelector('.modal-addon-checkbox');
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
          if (val < 10) {
            elem.textContent = String(val + 1);
            const cb = elem.closest('.addon-row').querySelector('.modal-addon-checkbox');
            if (cb.checked) cb.dispatchEvent(new Event('change'));
          }
        }
      });
    });
  }

  document.getElementById('modal-line-total').textContent = `₱${Number(selectedProduct.price).toFixed(2)}`;
  openModal('add-to-cart-modal');
}

// Global Event Delegation for Product Grid cards
export function attachProductGridListeners(containerId = 'featured-grid', getProductById = null) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.addEventListener('click', (e) => {
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
}

function initHome() {
  renderHeader('home');
  setupHomeSectionNavigation();
  renderFooter();
  loadStoreInfo();
  loadFeaturedProducts();
  setupAddToCartModal();
  attachProductGridListeners('featured-grid', (id) => DEFAULT_FEATURED_PRODUCTS.find((p) => p._id === id));
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
  let updateScheduled = false;

  function updateActiveSection() {
    const headerBottom = header.getBoundingClientRect().bottom;
    const isAtPageBottom = window.scrollY + window.innerHeight
      >= document.documentElement.scrollHeight - 1;
    const activeSection = isAtPageBottom
      ? sections[sections.length - 1]
      : sections.reduce((current, section) => {
        return section.element.getBoundingClientRect().top <= headerBottom + 1
          ? section
          : current;
      }, sections[0]);

    header.querySelectorAll('.nav-links a').forEach((link) => {
      const linkUrl = new URL(link.href, window.location.href);
      const isHomeLink = linkUrl.pathname === window.location.pathname
        && !linkUrl.hash
        && link.getAttribute('href').endsWith('index.html');
      const isActive = activeSection.id
        ? linkUrl.pathname === window.location.pathname && linkUrl.hash === `#${activeSection.id}`
        : isHomeLink;

      link.classList.toggle('active', isActive);
      if (isActive) {
        link.setAttribute('aria-current', 'location');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  }

  function scheduleActiveSectionUpdate() {
    if (updateScheduled) return;
    updateScheduled = true;
    window.requestAnimationFrame(() => {
      updateScheduled = false;
      updateActiveSection();
    });
  }

  document.addEventListener('click', (event) => {
    const link = event.target.closest('#site-header .nav-links a');
    if (!link) return;

    const linkUrl = new URL(link.href, window.location.href);
    const sectionId = linkUrl.hash.slice(1);
    if (
      linkUrl.pathname === window.location.pathname &&
      (sectionId ? document.getElementById(sectionId) : isHomeLink(link))
    ) {
      scheduleActiveSectionUpdate();
    }
  });

  function isHomeLink(link) {
    return !link.hash && link.getAttribute('href').endsWith('index.html');
  }

  window.addEventListener('scroll', scheduleActiveSectionUpdate, { passive: true });
  document.addEventListener('scroll', scheduleActiveSectionUpdate, { passive: true });
  window.addEventListener('resize', scheduleActiveSectionUpdate);
  window.addEventListener('hashchange', scheduleActiveSectionUpdate);
  updateActiveSection();
}

if (document.getElementById('featured-grid')) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHome);
  } else {
    initHome();
  }
}
