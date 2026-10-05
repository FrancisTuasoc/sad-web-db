// UI Components, Toast, Modal, Header & Footer Renderer
import { isLoggedIn, isAdmin, getUser, logout, renderAvatar } from './auth.js';
import { apiFetch } from './api.js';

// SVG Inline Placeholder (Burger icon on warm cream background)
export const BURGER_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 160' width='200' height='160'%3E%3Crect width='200' height='160' fill='%23F4EFEA'/%3E%3Cg transform='translate(50, 30)' fill='none' stroke='%23C4B3A3' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M10 45 A 40 35 0 0 1 90 45 Z' fill='%23E9DEC3' stroke='%239B8B82'/%3E%3Cpath d='M8 50 Q 25 45 50 50 Q 75 55 92 50' stroke='%2348BB78' stroke-width='6'/%3E%3Crect x='12' y='58' width='76' height='14' rx='6' fill='%23542B1A' stroke='%23381B10'/%3E%3Cpolygon points='14,60 86,60 76,70 50,65 24,70' fill='%23ECC94B' stroke='%23D69E2E' stroke-width='2'/%3E%3Crect x='14' y='76' width='72' height='16' rx='8' fill='%23E9DEC3' stroke='%239B8B82'/%3E%3C/g%3E%3Ctext x='100' y='142' font-family='sans-serif' font-size='11' font-weight='600' fill='%239B8B82' text-anchor='middle'%3ECASESTUDY SYSTEM%3C/text%3E%3C/svg%3E";

// Canonical mapping of item names to asset files
export const ITEM_NAME_IMAGE_MAP = {
  'cdo burger': 'cdo-burger.png',
  'burger with ham': 'burger-with-ham.png',
  'burger with egg': 'burger-with-egg.png',
  'burger with bacon': 'burger-with-bacon.png',
  'burger bacon ham': 'burger-bacon-ham.png',
  'cheese burger': 'cheeseburger.png',
  'cheeseburger': 'cheeseburger.png',
  'cheese burger with ham': 'cheeseburger-with-ham.png',
  'cheeseburger with ham': 'cheeseburger-with-ham.png',
  'cheese burger with egg': 'cheeseburger-with-egg.png',
  'cheeseburger with egg': 'cheeseburger-with-egg.png',
  'cheese burger with bacon': 'cheeseburger-with-bacon.png',
  'cheeseburger with bacon': 'cheeseburger-with-bacon.png',
  'ham': 'ham.png',
  'ham with cheese': 'ham-with-cheese.png',
  'ham with egg': 'ham-with-egg.png',
  'ham cheese with egg': 'ham-cheese-with-egg.png',
  'egg cheese': 'egg-cheese.png',
  'egg sandwich': 'egg-sandwich.png',
  'bacon sandwich': 'bacon-sandwich.png',
  'bacon with ham': 'bacon-with-ham.png',
  'bacon with egg': 'bacon-with-egg.png',
  'bacon with cheese': 'bacon-with-cheese.png',
  'bacon cheese with ham': 'bacon-cheese-with-ham.png',
  'bacon cheese with egg': 'bacon-cheese-with-egg.png',
  'complete': 'complete.png',
  'complete change bacon': 'complete-change-bacon.png',
  'complete with bacon': 'complete-with-bacon.png',
  'footlong': 'footlong.png',
  'footlong ham': 'footlong-ham.png',
  'footlong egg': 'footlong-egg.png',
  'footlong cheese': 'footlong-cheese.png',
  'footlong bacon': 'footlong-bacon.png',
  'footlong cheese with bacon': 'footlong-cheese-bacon.png',
  'footlong cheese bacon': 'footlong-cheese-bacon.png',
  'footlong ham with bacon': 'footlong-ham-bacon.png',
  'footlong ham bacon': 'footlong-ham-bacon.png',
  '4pcs grace siomai': 'grace-siomai-4pcs.png',
  'grace siomai 4pcs': 'grace-siomai-4pcs.png',
  'siomai': 'grace-siomai-4pcs.png',
  'add patty': 'add-patty.png',
  'add ham': 'add-ham.png',
  'add coleslaw': 'add-coleslaw.png'
};

export function getProductImageUrl(product) {
  if (!product) return BURGER_PLACEHOLDER;
  
  // 1. Check explicit name match first
  const normName = (product.name || '').toLowerCase().trim();
  if (ITEM_NAME_IMAGE_MAP[normName]) {
    return `assets/items/${ITEM_NAME_IMAGE_MAP[normName]}`;
  }

  // 2. Check if product.image is provided
  if (product.image && typeof product.image === 'string' && product.image.trim()) {
    return product.image.trim();
  }

  // 3. Fallback to slug
  const slug = (product.slug || normName.replace(/\s+/g, '-').replace(/[^\w\-]+/g, '')).toLowerCase();
  if (slug) {
    return `assets/items/${slug}.png`;
  }

  return BURGER_PLACEHOLDER;
}

export function handleImageError(img) {
  if (!img) return;
  const currentSrc = img.src || '';
  if (!img.getAttribute('data-tried-png') && currentSrc.endsWith('.jpg')) {
    img.setAttribute('data-tried-png', 'true');
    img.src = currentSrc.slice(0, -4) + '.png';
    return;
  }
  if (!img.getAttribute('data-tried-jpg') && currentSrc.endsWith('.png')) {
    img.setAttribute('data-tried-jpg', 'true');
    img.src = currentSrc.slice(0, -4) + '.jpg';
    return;
  }
  if (img.getAttribute('data-error-handled')) return;
  img.setAttribute('data-error-handled', 'true');
  img.src = BURGER_PLACEHOLDER;
}

if (typeof window !== 'undefined') {
  window.handleImageError = handleImageError;
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------- Toast System ----------------
export function showToast(message, type = 'info', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconSvg = {
    success: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#287D3C" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    error: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#A4262C" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    warning: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D97A07" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    info: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1D6FB8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  }[type] || '';

  toast.innerHTML = `
    <div style="flex-shrink:0;">${iconSvg}</div>
    <div class="toast-message">${escapeHtml(message)}</div>
    <button class="toast-close" aria-label="Close message" style="background:none;border:none;cursor:pointer;padding:0;font-size:1.2rem;line-height:1;">&times;</button>
  `;

  const closeBtn = toast.querySelector('.toast-close');
  closeBtn.addEventListener('click', () => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 250);
  });

  container.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => {
      if (toast.parentElement) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 250);
      }
    }, duration);
  }
}

// ---------------- Modal Controls ----------------
export function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
}

export function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }
}

// ---------------- Cart Badge Update ----------------
export async function updateCartBadge() {
  const badge = document.getElementById('header-cart-badge');
  if (!badge) return;

  if (!isLoggedIn()) {
    // Check local storage cart items if offline
    try {
      const localCart = JSON.parse(localStorage.getItem('cart') || '[]');
      const count = localCart.reduce((sum, item) => sum + (item.quantity || 1), 0);
      badge.textContent = String(count);
      if (count > 0) badge.classList.remove('hidden');
      else badge.classList.add('hidden');
    } catch (e) {
      badge.classList.add('hidden');
    }
    return;
  }

  try {
    const data = await apiFetch('/cart');
    const count = data.items ? data.items.reduce((sum, item) => sum + (item.quantity || 1), 0) : 0;
    badge.textContent = String(count);
    if (count > 0) {
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch (err) {
    badge.textContent = '0';
    badge.classList.add('hidden');
  }
}

// ---------------- Header & Footer Renderer ----------------
export function setupBackToTop() {
  let button = document.getElementById('back-to-top');
  if (!button) {
    button = document.createElement('button');
    button.id = 'back-to-top';
    button.className = 'back-to-top';
    button.type = 'button';
    button.setAttribute('aria-label', 'Back to top');
    button.title = 'Back to top';
    button.tabIndex = -1;
    button.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"></path></svg>';
    document.body.appendChild(button);
  }

  if (button.dataset.initialized === 'true') return;
  button.dataset.initialized = 'true';

  function updateVisibility() {
    const isVisible = window.scrollY > 400;
    button.classList.toggle('is-visible', isVisible);
    button.tabIndex = isVisible ? 0 : -1;
  }

  window.addEventListener('scroll', updateVisibility, { passive: true });
  document.addEventListener('scroll', updateVisibility, { passive: true });
  button.addEventListener('click', () => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({
      top: 0,
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  });

  updateVisibility();
}

export function renderHeader(activeNav = '') {
  const headerElem = document.getElementById('site-header');
  if (!headerElem) return;

  setupBackToTop();

  const user = getUser();
  const userLoggedIn = isLoggedIn();

  // Active navigation highlight
  const navLinks = headerElem.querySelectorAll('.nav-links a');
  navLinks.forEach((link) => {
    link.classList.remove('active');
    const href = link.getAttribute('href') || '';
    if (activeNav === 'home' && (href === 'index.html' || href === '/')) link.classList.add('active');
    if (activeNav === 'menu' && href.includes('menu.html')) link.classList.add('active');
    if (activeNav === 'cart' && href.includes('cart.html')) link.classList.add('active');
    if (activeNav === 'profile' && href.includes('profile.html')) link.classList.add('active');
  });

  // User slot dynamic update
  const userSlot = document.getElementById('header-user-slot');
  if (userSlot) {
    if (userLoggedIn && user) {
      userSlot.innerHTML = `
        <div class="user-menu-wrapper">
          <button id="user-menu-btn" class="avatar-btn" aria-label="User Account Menu">
            ${renderAvatar(user, 30)}
            <span style="max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(user.username)}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div id="user-dropdown-menu" class="user-dropdown">
            <a href="profile.html">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              My Profile &amp; Orders
            </a>
            ${
              isAdmin()
                ? `
              <a href="admin.html" style="color:var(--color-brand-secondary);font-weight:700;">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                Admin Dashboard
              </a>`
                : ''
            }
            <div class="user-dropdown-divider"></div>
            <button id="logout-btn" style="background:none;border:none;cursor:pointer;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              Log Out
            </button>
          </div>
        </div>
      `;
    } else {
      userSlot.innerHTML = `<a href="login.html" class="btn btn-primary btn-sm">Login</a>`;
    }
  }

  // Mobile drawer links
  const mobileDrawer = document.getElementById('mobile-drawer-menu');
  if (mobileDrawer) {
    if (userLoggedIn && user) {
      mobileDrawer.innerHTML = `
        <a href="index.html">Home</a>
        <a href="menu.html">Menu</a>
        <a href="index.html#featured">Featured Burgers</a>
        <a href="index.html#about">About Us</a>
        <a href="index.html#contact">Contact &amp; Store Hours</a>
        <a href="cart.html">My Cart</a>
        <a href="profile.html">My Account &amp; Status</a>
        ${isAdmin() ? `<a href="admin.html" style="color:var(--color-accent);font-weight:700;">Admin Dashboard</a>` : ''}
        <a href="#" id="mobile-logout-btn">Log Out</a>
      `;
    } else {
      mobileDrawer.innerHTML = `
        <a href="index.html">Home</a>
        <a href="menu.html">Menu</a>
        <a href="index.html#featured">Featured Burgers</a>
        <a href="index.html#about">About Us</a>
        <a href="index.html#contact">Contact &amp; Store Hours</a>
        <a href="cart.html">My Cart</a>
        <a href="login.html" style="color:var(--color-accent);font-weight:700;">Login / Register</a>
      `;
    }
  }

  // Event handlers
  const userMenuBtn = document.getElementById('user-menu-btn');
  const userDropdown = document.getElementById('user-dropdown-menu');
  if (userMenuBtn && userDropdown) {
    userMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      userDropdown.classList.toggle('open');
    });
    document.addEventListener('click', () => {
      userDropdown.classList.remove('open');
    });
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      logout();
    });
  }

  const mobileLogoutBtn = document.getElementById('mobile-logout-btn');
  if (mobileLogoutBtn) {
    mobileLogoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      logout();
    });
  }

  const mobileNavBtn = document.getElementById('mobile-nav-btn');
  if (mobileNavBtn && mobileDrawer) {
    mobileNavBtn.addEventListener('click', () => {
      mobileDrawer.classList.toggle('open');
    });
  }

  // Intercept cart icon if guest
  const headerCartBtn = document.getElementById('header-cart-btn');
  if (headerCartBtn && !userLoggedIn) {
    headerCartBtn.addEventListener('click', (e) => {
      e.preventDefault();
      showToast('Please log in to view your shopping cart.', 'info');
      setTimeout(() => {
        window.location.href = 'login.html?redirect=cart.html';
      }, 700);
    });
  }

  updateCartBadge();
}

export async function renderFooter() {
  const footerElem = document.getElementById('site-footer');
  if (!footerElem) return;

  try {
    const res = await apiFetch('/settings/public');
    if (res && res.settings) {
      const s = res.settings;
      const storeNameElem = footerElem.querySelector('h4');
      if (storeNameElem && s.storeName) storeNameElem.textContent = s.storeName;
    }
  } catch (e) {
    // Keep existing static footer markup
  }
}
