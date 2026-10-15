class SiteHeader extends HTMLElement {
  connectedCallback() {
    if (this.dataset.rendered === 'true') return;

    this.dataset.rendered = 'true';
    this.classList.add('site-header');

    const isProfilePage = document.body.classList.contains('profile-page');
    this.innerHTML = `
      <div class="container header-container">
        ${
          isProfilePage
            ? `<button type="button" id="profile-sidebar-toggle" class="btn btn-secondary btn-sm" aria-label="Collapse account navigation" aria-controls="profile-sidebar" aria-expanded="true" title="Collapse account navigation"><i class="fa-solid fa-bars" aria-hidden="true"></i></button>`
            : ''
        }
        <a href="index.html" class="brand-logo" aria-label="GIGABITE Home">
          <img src="assets/logo.svg" alt="GIGABITE Logo" />
        </a>
        <nav class="customer-store-navigation" data-customer-only aria-label="Main Navigation">
          <ul class="nav-links">
            <li><a href="index.html">Home</a></li>
            <li><a href="menu.html">Menu</a></li>
            <li><a href="index.html#featured">Featured</a></li>
            <li><a href="index.html#about">About</a></li>
            <li><a href="index.html#contact">Contact</a></li>
          </ul>
        </nav>
        <div class="header-actions">
          <a href="cart.html" id="header-cart-btn" class="cart-btn" data-customer-only aria-label="View Shopping Cart">
            <i class="fa-solid fa-cart-shopping fa-fw" aria-hidden="true"></i>
            <span id="header-cart-badge" class="cart-badge hidden">0</span>
          </a>
          <div class="notification-center-wrapper hidden" id="header-notifications-wrapper" data-customer-only>
            <button
              type="button"
              id="header-notification-btn"
              class="notification-btn"
              aria-label="Order Status Notifications"
              title="Notifications"
            >
              <i class="fa-solid fa-bell fa-fw" aria-hidden="true"></i>
              <span id="header-notification-badge" class="notification-badge hidden">0</span>
            </button>
            <div id="header-notification-dropdown" class="notification-dropdown">
              <div class="notification-dropdown-header">
                <div style="display:flex;align-items:center;gap:6px;">
                  <span class="notification-dropdown-title">Order Updates</span>
                  <span class="badge badge-ready" style="font-size:0.65rem;padding:2px 6px;">LIVE</span>
                </div>
                <button type="button" id="header-mark-all-read-btn" class="btn-text-sm">Mark all read</button>
              </div>
              <div id="header-notification-list" class="notification-list">
                <div class="notification-empty">No notifications yet.</div>
              </div>
            </div>
          </div>
          <div id="header-user-slot">
            <a href="login.html" class="btn btn-primary btn-sm">Login</a>
          </div>
          <button id="mobile-nav-btn" class="mobile-nav-toggle" type="button" aria-label="Toggle mobile menu">
            <i class="fa-solid fa-bars" aria-hidden="true"></i>
          </button>
        </div>
      </div>
      <div id="mobile-drawer-menu" class="mobile-drawer">
        <a href="index.html">Home</a>
        <a href="menu.html">Menu</a>
        <a href="index.html#featured">Featured Burgers</a>
        <a href="index.html#about">About Us</a>
        <a href="index.html#contact">Contact &amp; Store Hours</a>
        <a href="cart.html">My Cart</a>
        <a href="login.html" style="color: var(--color-accent); font-weight: 700">Login / Register</a>
      </div>
    `;

    // Initialize active navigation highlight immediately upon mount
    const path = window.location.pathname;
    const hash = window.location.hash;
    const isHome = path === '/' || path.endsWith('index.html') || path === '';
    const isMenu = path.endsWith('menu.html');

    this.querySelectorAll('.nav-links a, .mobile-drawer a').forEach((link) => {
      const linkUrl = new URL(link.href, window.location.href);
      if (isHome) {
        if (hash) {
          link.classList.toggle('active', linkUrl.hash === hash);
        } else {
          link.classList.toggle(
            'active',
            !linkUrl.hash &&
              (link.getAttribute('href') === 'index.html' ||
                link.getAttribute('href') === '/' ||
                linkUrl.pathname.endsWith('index.html'))
          );
        }
      } else if (isMenu && link.getAttribute('href')?.includes('menu.html')) {
        link.classList.add('active');
      }
    });
  }
}

if (!customElements.get('site-header')) {
  customElements.define('site-header', SiteHeader);
}
