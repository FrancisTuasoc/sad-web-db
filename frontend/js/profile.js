// Customer Profile Controller
import { apiFetch, apiFetchBlob } from './api.js';
import { renderHeader, renderFooter, showToast, escapeHtml, openModal, closeModal } from './ui.js';
import { requireAuth, getUser, setUser, renderAvatar, logout } from './auth.js';

let activeTab = 'overview';
let statusSubTab = 'pickup';
let historyFilter = 'all';
let historyPage = 1;
const HISTORY_PAGE_SIZE = 5;
let pollingTimer = null;
let currentProfile = null;
let activeAvatarObjectUrl = null;

function getStoreName() {
  const storeName = document.getElementById('footer-store-name');
  return storeName ? storeName.textContent.trim() : 'Burger Shop';
}

function validateAvatarFile(file) {
  const maxSize = 5 * 1024 * 1024;
  const extension = file.name.split('.').pop()?.toLowerCase();
  const allowedTypes = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  };

  if (!allowedTypes[extension] || file.type !== allowedTypes[extension]) {
    throw new Error('Choose a JPG, PNG, or WebP photo.');
  }
  if (file.size > maxSize) {
    throw new Error('Photo must be 5 MiB or smaller.');
  }

  return file;
}

function updateHeaderAvatar(avatarUrl) {
  const avatar = document.querySelector('#header-user-slot .avatar-circle');
  if (!avatar) return;
  if (avatarUrl && !avatarUrl.startsWith('gridfs:')) {
    avatar.style.backgroundImage = `url("${avatarUrl.replace(/"/g, '%22')}")`;
    avatar.textContent = '';
  }
}

async function loadProfileOverview() {
  try {
    const res = await apiFetch('/profile');
    let p = res.profile;
    if (p.avatarUrl && p.avatarUrl.startsWith('gridfs:')) {
      const imageBlob = await apiFetchBlob('/profile/avatar');
      const nextAvatarObjectUrl = URL.createObjectURL(imageBlob);
      if (activeAvatarObjectUrl) URL.revokeObjectURL(activeAvatarObjectUrl);
      activeAvatarObjectUrl = nextAvatarObjectUrl;
      p = { ...p, avatarUrl: nextAvatarObjectUrl };
    } else if (activeAvatarObjectUrl) {
      URL.revokeObjectURL(activeAvatarObjectUrl);
      activeAvatarObjectUrl = null;
    }
    currentProfile = p;
    updateHeaderAvatar(p.avatarUrl);

    const usernameEl = document.getElementById('overview-username');
    const emailEl = document.getElementById('overview-email');
    const memberSinceEl = document.getElementById('overview-member-since');
    const totalOrdersEl = document.getElementById('overview-total-orders');
    const statusBadgeEl = document.getElementById('overview-status-badge');

    if (usernameEl) usernameEl.textContent = p.fullName || p.username || 'Customer';
    if (emailEl) emailEl.textContent = p.email || 'No email available';
    if (memberSinceEl) {
      memberSinceEl.textContent = new Date(p.createdAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }
    if (totalOrdersEl) totalOrdersEl.textContent = String(p.totalOrders || 0);
    if (statusBadgeEl) statusBadgeEl.textContent = p.status === 'suspended' ? 'Suspended' : 'Active';

    const avatarHolder = document.getElementById('overview-avatar-holder');
    if (avatarHolder) {
      avatarHolder.innerHTML = renderAvatar(p, 150);
    }

    const profileButton = document.getElementById('profile-photo-button');
    if (profileButton) {
      profileButton.setAttribute('aria-label', `View profile photo for ${p.fullName || p.username || 'customer'}`);
    }

    // Prefill saved details tab
    const nameInput = document.getElementById('profile-fullname-input');
    const phoneInput = document.getElementById('profile-phone-input');
    const addressInput = document.getElementById('profile-address-input');
    if (nameInput) nameInput.value = p.fullName || '';
    if (phoneInput) phoneInput.value = p.phone || '';
    if (addressInput) addressInput.value = p.address || '';

    const usernameInput = document.getElementById('username-input');
    if (usernameInput) usernameInput.value = p.username || '';
  } catch (err) {
    showToast('Failed to load profile details.', 'error');
  }
}

function openUsernameModal() {
  const modal = document.getElementById('username-modal');
  if (!modal) return;
  const usernameInput = document.getElementById('username-input');
  if (usernameInput) {
    usernameInput.value = (getUser()?.username || '').trim();
    setTimeout(() => usernameInput.focus(), 50);
  }
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeUsernameModal() {
  const modal = document.getElementById('username-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

async function saveUsernameChange(event) {
  event.preventDefault();
  const input = document.getElementById('username-input');
  if (!input) return;

  const username = input.value.trim();
  if (!username) {
    showToast('Please enter a username.', 'warning');
    input.focus();
    return;
  }

  const submitButton = event.target.querySelector('button[type="submit"]');
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'Saving...';
  }

  try {
    const res = await apiFetch('/customer/me/username', {
      method: 'PATCH',
      body: JSON.stringify({ username }),
    });

    if (res.user) {
      const currentUser = getUser();
      const nextUser = currentUser ? { ...currentUser, ...res.user } : res.user;
      setUser(nextUser);
    }

    const target = document.getElementById('overview-username');
    if (target) {
      target.textContent = username;
    }

    showToast('Username updated successfully.', 'success');
    closeUsernameModal();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = 'Save';
    }
  }
}

function getCustomerInitials(nameOrEmail = '') {
  const source = (nameOrEmail || '').trim();
  if (!source) return 'C';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    return parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('').slice(0, 2);
  }
  return source.charAt(0).toUpperCase();
}

function isValidAvatarSource(url) {
  if (!url || typeof url !== 'string') return false;
  const normalized = url.trim();
  return /^https?:\/\//i.test(normalized)
    || /^data:image\//i.test(normalized)
    || /^blob:/i.test(normalized);
}

function setAvatarModalContent(profile) {
  const frame = document.getElementById('avatar-lightbox-frame');
  if (!frame) return;
  const name = profile.fullName || profile.username || 'Customer';
  const caption = document.getElementById('avatar-lightbox-caption');
  if (caption) caption.textContent = name;

  const safeUrl = profile && profile.avatarUrl && String(profile.avatarUrl).trim() ? String(profile.avatarUrl).trim() : '';
  if (isValidAvatarSource(safeUrl)) {
    const img = document.createElement('img');
    img.src = safeUrl;
    img.alt = `${name} profile photo`;
    img.onerror = () => {
      const fallback = document.createElement('div');
      fallback.className = 'avatar-fallback';
      fallback.textContent = getCustomerInitials(profile.fullName || profile.username || profile.email || 'Customer');
      frame.replaceChildren(fallback);
    };
    frame.replaceChildren(img);
    return;
  }

  const fallback = document.createElement('div');
  fallback.className = 'avatar-fallback';
  fallback.textContent = getCustomerInitials(profile.fullName || profile.username || profile.email || 'Customer');
  frame.replaceChildren(fallback);
}

let lastAvatarFocusElement = null;

function openAvatarModal(profile) {
  const modal = document.getElementById('avatar-lightbox');
  if (!modal) return;

  lastAvatarFocusElement = document.activeElement;
  setAvatarModalContent(profile);
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  const closeButton = document.getElementById('close-avatar-modal');
  if (closeButton) closeButton.focus();
}

function closeAvatarModal() {
  const modal = document.getElementById('avatar-lightbox');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  if (lastAvatarFocusElement) {
    lastAvatarFocusElement.focus();
  }
}

function formatOrderStatusLabel(status = '') {
  if (!status) return 'Pending';
  const map = {
    pending: 'Pending',
    processing: 'Processing',
    ready_for_pickup: 'Ready for pickup',
    ready_to_deliver: 'Ready to deliver',
    to_pickup: 'To pick up',
    to_ship: 'To ship',
    shipped: 'Shipped',
    completed: 'Completed',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
  };
  return map[status] || status.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function loadCustomerStats() {
  try {
    const res = await apiFetch('/customer/kpis');
    const stats = res.kpis || {};
    const grid = document.getElementById('customer-kpi-grid');
    if (!grid) return;

    const cards = [
      { label: 'Total orders', value: stats.totalOrders || 0, meta: 'All orders placed', icon: '🧾' },
      { label: 'Pending orders', value: stats.pendingOrders || 0, meta: 'Waiting for action', icon: '⏳' },
      { label: 'Delivered orders', value: stats.deliveredOrders || 0, meta: 'Completed deliveries', icon: '✅' },
      { label: 'Total spent', value: `₱${Number(stats.totalSpent || 0).toFixed(2)}`, meta: 'Completed orders only', icon: '₱' },
    ];

    grid.innerHTML = cards.map((card) => `
      <article class="customer-stat-card">
        <div class="customer-stat-top">
          <span class="customer-stat-label">${escapeHtml(card.label)}</span>
          <span class="customer-stat-icon">${card.icon}</span>
        </div>
        <strong class="customer-stat-value">${escapeHtml(String(card.value))}</strong>
        <span class="customer-stat-meta">${escapeHtml(card.meta)}</span>
      </article>
    `).join('');

    const recentOrders = stats.recentOrders || [];
    const recentList = document.getElementById('customer-recent-orders');
    if (recentList) {
      recentList.innerHTML = recentOrders.length
        ? `
          <div class="recent-orders-panel">
            <div class="recent-orders-header">
              <h4>Recent orders</h4>
              <a href="profile.html?tab=history" class="recent-orders-link">View all</a>
            </div>
            <div class="recent-orders-list">
              ${recentOrders.map((order) => {
                const status = formatOrderStatusLabel(order.status || 'pending');
                const safeStatusClass = (order.status || 'pending').toString().replace(/\s+/g, '_');
                return `
                  <div class="recent-order-item" tabindex="0">
                    <div class="recent-order-main">
                      <span class="recent-order-id">${escapeHtml(order.orderNumber || 'Order')}</span>
                      <span class="recent-order-date">${new Date(order.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    </div>
                    <div class="recent-order-meta">
                      <span class="badge badge-${escapeHtml(safeStatusClass)}">${escapeHtml(status)}</span>
                      <strong class="recent-order-total">₱${Number(order.total || 0).toFixed(2)}</strong>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `
        : '<div class="state-box"><h4 class="state-title">No recent orders</h4><p class="state-desc">You have not placed any orders yet.</p></div>';
    }

    const statusPills = document.getElementById('customer-status-pill-list');
    const statusCounts = stats.statusCounts || {};
    const statusMeta = [
      { key: 'pending', label: 'Pending', color: '#d98508' },
      { key: 'ready_for_pickup', label: 'Ready Pick-up', color: '#155a91' },
      { key: 'ready_to_deliver', label: 'Ready Delivery', color: '#155a91' },
      { key: 'to_pickup', label: 'To Pick Up', color: '#d98508' },
      { key: 'to_ship', label: 'To Ship', color: '#98252a' },
      { key: 'completed', label: 'Completed', color: '#216b36' },
      { key: 'cancelled', label: 'Cancelled', color: '#98252a' },
    ];
    const statusTotal = statusMeta.reduce(
      (total, item) => total + (Number(statusCounts[item.key]) || 0),
      0
    );
    const totalEl = document.getElementById('customer-status-total');
    if (totalEl) totalEl.textContent = String(statusTotal);

    if (statusPills) {
      statusPills.innerHTML = statusMeta.map((item) => {
        const count = statusCounts[item.key] || 0;
        return `
          <button type="button" class="status-pill" data-status-filter="${item.key}" style="color:${item.color};">
            <span class="status-dot" style="background:${item.color};"></span>
            ${escapeHtml(item.label)} <span>${count}</span>
          </button>
        `;
      }).join('');

      statusPills.querySelectorAll('.status-pill').forEach((button) => {
        button.addEventListener('click', async () => {
          const selected = button.getAttribute('data-status-filter');
          const current = selected === 'all' ? 'all' : selected;
          statusSubTab = current === 'pending' ? 'pickup' : 'delivery';
          const targetTab = document.querySelector('.profile-nav-btn[data-tab="status"]');
          if (targetTab) targetTab.click();
          if (current === 'all') {
            await loadStatusOrders();
            return;
          }
          try {
            const res = await apiFetch(`/orders/mine?status=${encodeURIComponent(current)}`);
            const container = document.getElementById('status-orders-container');
            const orders = res.orders || [];
            if (!container) return;
            container.innerHTML = orders.length
              ? orders.map((order) => renderOrderCard(order, true)).join('')
              : '<div class="state-box"><h4 class="state-title">No matching orders</h4><p class="state-desc">There are no orders in this status.</p></div>';
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });
    }

    const tracker = document.getElementById('customer-mini-tracker');
    if (tracker) {
      const ordersRes = await apiFetch('/customer/orders?status=active&limit=1');
      const activeOrders = ordersRes.orders || [];

      if (!activeOrders.length) {
        tracker.innerHTML = `
          <div class="mini-tracker-title">Current active order</div>
          <div class="mini-tracker-card">
            <div class="mini-tracker-icon">✓</div>
            <div class="mini-tracker-meta">
              <strong>No active order</strong>
              <span>Browse the menu to place one.</span>
            </div>
          </div>
        `;
        return;
      }

      const activeOrder = activeOrders[0];
      const statusLabel = {
        pending: 'Pending',
        ready_for_pickup: 'Ready for pickup',
        ready_to_deliver: 'Ready to deliver',
        to_pickup: 'To pick up',
        to_ship: 'To ship',
      }[activeOrder.status] || activeOrder.status;

      tracker.innerHTML = `
        <div class="mini-tracker-title">Current active order</div>
        <div class="mini-tracker-card">
          <div class="mini-tracker-icon">${activeOrder.fulfillment === 'pickup' ? 'P' : 'D'}</div>
          <div class="mini-tracker-meta">
            <strong>#${escapeHtml(activeOrder.orderNumber)}</strong>
            <span>${escapeHtml(statusLabel)} · ₱${Number(activeOrder.total || 0).toFixed(2)}</span>
          </div>
        </div>
      `;
    }
  } catch (err) {
    const grid = document.getElementById('customer-kpi-grid');
    if (grid) {
      grid.innerHTML = '<div class="state-box"><h4 class="state-title">Could not load dashboard</h4><p class="state-desc">Please refresh the page or try again.</p></div>';
    }
  }
}

// ---------------- Status Orders Tab ----------------
async function loadStatusOrders() {
  const container = document.getElementById('status-orders-container');
  if (!container) return;

  try {
    const res = await apiFetch('/orders/mine?status=active');
    const allActive = res.orders || [];

    // Filter by subtab
    const fulfillment = statusSubTab === 'pickup' ? 'pickup' : 'delivery';
    const filtered = allActive.filter((order) => order.fulfillment === fulfillment);

    const pickupBadge = document.getElementById('subtab-pickup-badge');
    const deliveryBadge = document.getElementById('subtab-delivery-badge');
    if (pickupBadge) pickupBadge.textContent = String(allActive.filter((order) => order.fulfillment === 'pickup').length);
    if (deliveryBadge) deliveryBadge.textContent = String(allActive.filter((order) => order.fulfillment === 'delivery').length);

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="state-box">
          <svg class="state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
          </svg>
          <h4 class="state-title">No orders in this status</h4>
          <p class="state-desc">You don't have any active ${fulfillment === 'pickup' ? 'pick-up' : 'delivery'} orders.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map((order) => renderOrderCard(order, true)).join('');
  } catch (err) {
    container.innerHTML = `
      <div class="state-box">
        <h4 class="state-title">Error loading orders</h4>
        <p class="state-desc">${escapeHtml(err.message)}</p>
        <button id="retry-orders-btn" class="btn btn-secondary btn-sm">Try Again</button>
      </div>
    `;
    const btn = document.getElementById('retry-orders-btn');
    if (btn) btn.addEventListener('click', loadStatusOrders);
  }
}

// ---------------- History Orders Tab ----------------
async function loadHistoryOrders() {
  const container = document.getElementById('history-orders-container');
  if (!container) return;

  try {
    const res = await apiFetch('/orders/mine?status=history');
    let orders = res.orders || [];

    if (historyFilter !== 'all') {
      orders = orders.filter((o) => o.status === historyFilter);
    }

    if (orders.length === 0) {
      historyPage = 1;
      container.innerHTML = `
        <div class="state-box">
          <h4 class="state-title">No past orders found</h4>
          <p class="state-desc">You have no completed or cancelled orders under this filter.</p>
        </div>
      `;
      return;
    }

    const pageCount = Math.ceil(orders.length / HISTORY_PAGE_SIZE);
    historyPage = Math.min(Math.max(historyPage, 1), pageCount);
    const startIndex = (historyPage - 1) * HISTORY_PAGE_SIZE;
    const pageOrders = orders.slice(startIndex, startIndex + HISTORY_PAGE_SIZE);
    const pagination = `
      <nav class="history-pagination" aria-label="Order history pages">
        <span class="history-page-summary">Showing ${startIndex + 1}–${Math.min(startIndex + HISTORY_PAGE_SIZE, orders.length)} of ${orders.length} orders</span>
        <div class="history-page-controls">
          <button type="button" class="btn btn-secondary btn-sm" data-history-page="${historyPage - 1}" ${historyPage === 1 ? 'disabled' : ''} aria-label="Previous page">Previous</button>
          <span class="history-page-number" aria-live="polite">Page ${historyPage} of ${pageCount}</span>
          <button type="button" class="btn btn-secondary btn-sm" data-history-page="${historyPage + 1}" ${historyPage === pageCount ? 'disabled' : ''} aria-label="Next page">Next</button>
        </div>
      </nav>
    `;

    container.innerHTML = `${pageOrders.map((order) => renderOrderCard(order, false)).join('')}${pagination}`;
    container.querySelectorAll('[data-history-page]').forEach((button) => {
      button.addEventListener('click', () => {
        const nextPage = Number(button.getAttribute('data-history-page'));
        if (!Number.isInteger(nextPage) || nextPage < 1 || nextPage > pageCount || nextPage === historyPage) return;
        historyPage = nextPage;
        loadHistoryOrders();
      });
    });
  } catch (err) {
    container.innerHTML = `
      <div class="state-box">
        <h4 class="state-title">Error loading order history</h4>
        <p class="state-desc">${escapeHtml(err.message)}</p>
        <button id="retry-history-btn" class="btn btn-secondary btn-sm">Try Again</button>
      </div>
    `;
    const btn = document.getElementById('retry-history-btn');
    if (btn) btn.addEventListener('click', loadHistoryOrders);
  }
}

function renderOrderCard(order, isLive = false) {
  const dateStr = new Date(order.createdAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const itemsSnippet = order.items
    .map((item) => `${escapeHtml(item.name)} (x${item.quantity})`)
    .join(', ');

  const statusLabels = {
    pending: 'Pending Admin Acceptance',
    ready_for_pickup: 'Ready for Pick Up',
    ready_to_deliver: 'Ready to Deliver',
    to_pickup: 'Ready for Pick Up',
    to_ship: 'Ready to Deliver',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };

  const statusBadge = `<span class="badge badge-${order.status}">${statusLabels[order.status] || order.status}</span>`;
  const paymentBadge = `<span class="badge badge-${order.paymentStatus}">${order.paymentStatus.toUpperCase()}</span>`;

  // Progress tracker indicator for active orders
  let progressTracker = '';
  if (isLive && order.status !== 'cancelled') {
    const isStep1 = true;
    const isStep2 = ['ready_for_pickup', 'ready_to_deliver', 'to_pickup', 'to_ship', 'completed'].includes(order.status);
    const isStep3 = order.status === 'completed';

    const step2Label = order.fulfillment === 'pickup' ? 'Ready to Pick Up' : 'Ready to Deliver';

    progressTracker = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin:14px 0 16px;position:relative;">
        <div style="position:absolute;top:50%;left:15%;right:15%;height:2px;background:var(--color-border);z-index:1;"></div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:4px;z-index:2;background:var(--color-surface);padding:0 6px;">
          <div style="width:22px;height:22px;border-radius:50%;background:${isStep1 ? 'var(--color-accent)' : 'var(--color-border)'};color:#2A1E18;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;">1</div>
          <span style="font-size:0.75rem;font-weight:600;">Order Placed</span>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:4px;z-index:2;background:var(--color-surface);padding:0 6px;">
          <div style="width:22px;height:22px;border-radius:50%;background:${isStep2 ? 'var(--color-accent)' : 'var(--color-border)'};color:#2A1E18;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;">2</div>
          <span style="font-size:0.75rem;font-weight:600;">${step2Label}</span>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:4px;z-index:2;background:var(--color-surface);padding:0 6px;">
          <div style="width:22px;height:22px;border-radius:50%;background:${isStep3 ? 'var(--color-success)' : 'var(--color-border)'};color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;">3</div>
          <span style="font-size:0.75rem;font-weight:600;">Completed</span>
        </div>
      </div>
    `;
  }

  let actionsHtml = `
    <button type="button" class="btn btn-secondary btn-sm btn-view-receipt" data-order-id="${order._id}">
      View Receipt
    </button>
  `;

  if (isLive && order.status === 'pending') {
    actionsHtml += `
      <button type="button" class="btn btn-danger btn-sm btn-cancel-order" title="Cancellation is available only until an admin accepts the order." data-order-id="${order._id}">
        Cancel Order
      </button>
    `;
  }

  if (isLive && (order.status === 'ready_for_pickup' || order.status === 'ready_to_deliver' || order.status === 'to_pickup' || order.status === 'to_ship')) {
    const actionLabel = order.fulfillment === 'pickup' ? 'Order Picked Up' : 'Order Received';
    actionsHtml += `
      <button type="button" class="btn btn-primary btn-sm btn-complete-order" data-order-id="${order._id}">
        ${actionLabel}
      </button>
    `;
  }

  if (!isLive) {
    actionsHtml += `
      <button type="button" class="btn btn-primary btn-sm btn-buy-again" data-order-id="${order._id}">
        Buy Again
      </button>
    `;
  }

  return `
    <div class="order-card" data-order-id="${order._id}">
      <div class="order-card-header">
        <div>
          <span style="font-family:var(--font-heading);font-weight:700;font-size:1rem;color:var(--color-brand);">
            #${escapeHtml(order.orderNumber)}
          </span>
          <span style="font-size:0.8rem;color:var(--color-text-light);margin-left:8px;">${dateStr}</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          ${statusBadge}
          ${paymentBadge}
        </div>
      </div>

      ${progressTracker}

      <div class="order-items-snippet">
        <strong>Items:</strong> ${itemsSnippet}
      </div>

      <div class="order-card-footer" style="display:flex;align-items:center;justify-content:space-between;padding-top:10px;border-top:1px dashed var(--color-border);">
        <div>
          <span style="font-size:0.82rem;color:var(--color-text-muted);">
            ${order.fulfillment.toUpperCase()} &bull; ${order.paymentMethod.toUpperCase().replace(/_/g, ' ')}
          </span>
          <div style="font-family:var(--font-heading);font-weight:800;font-size:1.15rem;color:var(--color-brand);">
            ₱${order.total.toFixed(2)}
          </div>
        </div>
        <div style="display:flex;gap:8px;">
          ${actionsHtml}
        </div>
      </div>
    </div>
  `;
}

// Order receipt modal
async function openOrderReceipt(orderId) {
  try {
    const res = await apiFetch(`/orders/${orderId}`);
    const order = res.order;
    const body = document.getElementById('receipt-modal-body');
    if (!body) return;

    const itemsRows = order.items
      .map((item) => {
        let addonsStr = '';
        if (item.addons && item.addons.length > 0) {
          const quantityLabel = item.addonQuantityMode === 'per_order' ? 'for order' : 'per item';
          addonsStr = `<div style="font-size:0.75rem;color:var(--color-text-muted);padding-left:10px;">${item.addons.map((a) => `+ ${escapeHtml(a.name)} (x${a.qty} ${quantityLabel} @ ₱${a.price.toFixed(2)})`).join(', ')}</div>`;
        }
        return `
          <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:0.88rem;">
            <div>
              <strong>${escapeHtml(item.name)}</strong> &times; ${item.quantity}
              ${addonsStr}
            </div>
            <span>₱${item.lineTotal.toFixed(2)}</span>
          </div>
        `;
      })
      .join('');

    body.innerHTML = `
      <div style="text-align:center;padding-bottom:12px;border-bottom:1px dashed var(--color-border);margin-bottom:12px;">
        <h4 style="font-size:1.1rem;margin:0;">${escapeHtml(getStoreName())}</h4>
        <p style="font-size:0.8rem;color:var(--color-text-muted);margin:0;">Customer Receipt</p>
        <div style="font-weight:700;color:var(--color-brand-secondary);margin-top:6px;">Order #${escapeHtml(order.orderNumber)}</div>
        <div style="font-size:0.75rem;color:var(--color-text-light);">${new Date(order.createdAt).toLocaleString()}</div>
      </div>

      <div style="font-size:0.85rem;line-height:1.5;margin-bottom:12px;">
        <div><strong>Name:</strong> ${escapeHtml(order.contact.fullName)}</div>
        <div><strong>Phone:</strong> ${escapeHtml(order.contact.phone)}</div>
        ${order.fulfillment === 'delivery' ? `<div><strong>Address:</strong> ${escapeHtml(order.contact.address)}</div>` : ''}
        <div><strong>Fulfillment:</strong> ${order.fulfillment.toUpperCase()}</div>
        <div><strong>Payment:</strong> ${order.paymentMethod.toUpperCase().replace(/_/g, ' ')} (${order.paymentStatus.toUpperCase()})</div>
        ${order.gcashReference ? `<div><strong>GCash Ref:</strong> ${escapeHtml(order.gcashReference)}</div>` : ''}
      </div>

      <div style="border-top:1px dashed var(--color-border);padding-top:8px;margin-bottom:10px;">
        <div style="font-weight:600;font-size:0.85rem;margin-bottom:6px;">Order Summary:</div>
        ${itemsRows}
      </div>

      <div style="border-top:1px dashed var(--color-border);padding-top:8px;display:flex;flex-direction:column;gap:4px;font-size:0.88rem;">
        <div style="display:flex;justify-content:space-between;">
          <span>Subtotal:</span> <span>₱${order.subtotal.toFixed(2)}</span>
        </div>
        ${order.deliveryFee > 0 ? `
          <div style="display:flex;justify-content:space-between;">
            <span>Delivery Fee:</span> <span>₱${order.deliveryFee.toFixed(2)}</span>
          </div>
        ` : ''}
        <div style="display:flex;justify-content:space-between;font-weight:800;font-size:1.15rem;padding-top:6px;border-top:1px solid var(--color-border);color:var(--color-brand);">
          <span>Total:</span> <span>₱${order.total.toFixed(2)}</span>
        </div>
      </div>
    `;

    openModal('order-receipt-modal');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Cancel order handler
async function handleCancelOrder(orderId, button) {
  if (!confirm('Cancel this order while it is still waiting for admin acceptance? If the admin accepts first, cancellation will be blocked and you will need to contact the shop.')) return;

  button.disabled = true;
  button.textContent = 'Cancelling...';
  try {
    await apiFetch(`/orders/${orderId}/cancel`, { method: 'PATCH' });
    showToast('Order successfully cancelled.', 'info');
    loadStatusOrders();
  } catch (err) {
    showToast(err.message, 'error');
    button.disabled = false;
    button.textContent = 'Cancel Order';
  }

}

async function handleCompleteOrder(orderId, button) {
  const action = button.textContent.trim();
  if (!confirm(`Confirm: ${action}?`)) return;
  button.disabled = true;
  button.textContent = 'Updating...';
  try {
    await apiFetch(`/orders/${orderId}/complete`, { method: 'PATCH' });
    showToast('Order marked as completed. Thank you!', 'success');
    loadStatusOrders();
  } catch (err) {
    showToast(err.message, 'error');
    button.disabled = false;
    button.textContent = action;
  }
}

// Buy again handler: re-adds available items to cart
async function handleBuyAgain(orderId, button) {
  button.disabled = true;
  button.textContent = 'Adding...';
  try {
    const res = await apiFetch(`/orders/${orderId}`);
    const order = res.order;

    let addedCount = 0;
    const failures = [];
    for (const item of order.items) {
      if (!item.product) {
        failures.push(`${item.name}: no longer available`);
        continue;
      }
      const addonsPayload = (item.addons || [])
        .filter((a) => a.product)
        .map((a) => ({ product: a.product, qty: a.qty }));

      try {
        await apiFetch('/cart', {
          method: 'POST',
          body: JSON.stringify({
            productId: item.product,
            quantity: item.quantity,
            addons: addonsPayload,
            addonQuantityMode: item.addonQuantityMode || 'per_item',
          }),
        });
        addedCount++;
      } catch (err) {
        failures.push(`${item.name}: ${err.message}`);
      }
    }

    if (addedCount > 0) {
      showToast(
        failures.length
          ? `Added ${addedCount} item(s); some could not be added: ${failures.join('; ')}`
          : 'Items from previous order re-added to your cart!',
        failures.length ? 'warning' : 'success'
      );
      setTimeout(() => {
        window.location.href = 'cart.html';
      }, failures.length ? 1800 : 700);
    } else {
      showToast(
        failures.length
          ? `Could not add items from this order: ${failures.join('; ')}`
          : 'Items from this order are currently out of stock or unavailable.',
        'warning'
      );
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Buy Again';
  }
}

// Setup Event Listeners
function setupProfileTabs() {
  const tabs = document.querySelectorAll('.profile-nav-btn');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      activeTab = tab.getAttribute('data-tab');

      document.querySelectorAll('.profile-tab-section').forEach((sec) => sec.classList.add('hidden'));
      const activeSec = document.getElementById(`tab-section-${activeTab}`);
      if (activeSec) activeSec.classList.remove('hidden');

      if (activeTab === 'status') loadStatusOrders();
      if (activeTab === 'history') loadHistoryOrders();
    });
  });

  // Status sub-tabs
  const subtabs = document.querySelectorAll('.status-subtab');
  subtabs.forEach((st) => {
    st.addEventListener('click', () => {
      subtabs.forEach((s) => s.classList.remove('active'));
      st.classList.add('active');
      statusSubTab = st.getAttribute('data-subtab');
      loadStatusOrders();
    });
  });

  // History filter
  const historySelect = document.getElementById('history-status-filter');
  if (historySelect) {
    historySelect.addEventListener('change', (e) => {
      historyFilter = e.target.value;
      historyPage = 1;
      loadHistoryOrders();
    });
  }

  // Global order card actions delegation
  document.addEventListener('click', (e) => {
    const viewBtn = e.target.closest('.btn-view-receipt');
    if (viewBtn) {
      const orderId = viewBtn.getAttribute('data-order-id');
      openOrderReceipt(orderId);
      return;
    }

    const cancelBtn = e.target.closest('.btn-cancel-order');
    if (cancelBtn) {
      const orderId = cancelBtn.getAttribute('data-order-id');
      handleCancelOrder(orderId, cancelBtn);
      return;
    }

    const completeBtn = e.target.closest('.btn-complete-order');
    if (completeBtn) {
      handleCompleteOrder(completeBtn.getAttribute('data-order-id'), completeBtn);
      return;
    }

    const buyAgainBtn = e.target.closest('.btn-buy-again');
    if (buyAgainBtn) {
      const orderId = buyAgainBtn.getAttribute('data-order-id');
      handleBuyAgain(orderId, buyAgainBtn);
      return;
    }
  });

  // Saved Details Form
  const savedDetailsForm = document.getElementById('saved-details-form');
  if (savedDetailsForm) {
    savedDetailsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fullName = document.getElementById('profile-fullname-input').value.trim();
      const phone = document.getElementById('profile-phone-input').value.trim();
      const address = document.getElementById('profile-address-input').value.trim();

      if (phone) {
        const phPhoneRegex = /^(09\d{9}|\+639\d{9})$/;
        if (!phPhoneRegex.test(phone.replace(/[\s-]/g, ''))) {
          showToast('Please enter a valid Philippine mobile number (e.g. 09171234567).', 'warning');
          return;
        }
      }

      try {
        await apiFetch('/profile', {
          method: 'PATCH',
          body: JSON.stringify({ fullName, phone, address }),
        });
        showToast('Saved details updated successfully!', 'success');
        const u = getUser();
        if (u) {
          u.fullName = fullName;
          u.phone = phone;
          u.address = address;
          setUser(u);
        }
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Security (Change Password) Form
  const securityForm = document.getElementById('change-password-form');
  if (securityForm) {
    securityForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPassword = document.getElementById('current-password-input').value;
      const newPassword = document.getElementById('new-password-input').value;
      const confirmPassword = document.getElementById('confirm-password-input').value;

      if (newPassword !== confirmPassword) {
        showToast('New passwords do not match.', 'warning');
        return;
      }

      try {
        await apiFetch('/profile/password', {
          method: 'PATCH',
          body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
        });
        showToast('Password changed successfully!', 'success');
        securityForm.reset();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Avatar Upload / Remove
  const avatarUploadInput = document.getElementById('avatar-file-input');
  if (avatarUploadInput) {
    avatarUploadInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const validFile = validateAvatarFile(file);
        const formData = new FormData();
        formData.append('photo', validFile, validFile.name);
        const res = await apiFetch('/profile/avatar', {
          method: 'POST',
          body: formData,
        });

        const u = getUser();
        if (u) {
          u.avatarUrl = res.avatarUrl;
          setUser(u);
        }

        showToast('Profile photo updated!', 'success');
        renderHeader('profile');
        await loadProfileOverview();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        avatarUploadInput.value = '';
      }
    });
  }

  const removeAvatarBtn = document.getElementById('remove-avatar-btn');
  if (removeAvatarBtn) {
    removeAvatarBtn.addEventListener('click', async () => {
      try {
        await apiFetch('/profile', {
          method: 'PATCH',
          body: JSON.stringify({ avatarUrl: '' }),
        });

        const u = getUser();
        if (u) {
          u.avatarUrl = '';
          setUser(u);
        }

        showToast('Profile photo removed. Letter avatar restored.', 'info');
        renderHeader('profile');
        await loadProfileOverview();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Password visibility eye toggles
  document.querySelectorAll('.toggle-password-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
      }
    });
  });

  const profilePhotoButton = document.getElementById('profile-photo-button');
  if (profilePhotoButton) {
    profilePhotoButton.addEventListener('click', async () => {
      try {
        if (!currentProfile) {
          const res = await apiFetch('/profile');
          currentProfile = res.profile;
        }
        openAvatarModal(currentProfile);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  const editUsernameButton = document.getElementById('edit-username-btn');
  if (editUsernameButton) {
    editUsernameButton.addEventListener('click', openUsernameModal);
  }

  const closeUsernameButton = document.getElementById('close-username-modal');
  if (closeUsernameButton) closeUsernameButton.addEventListener('click', closeUsernameModal);

  const cancelUsernameButton = document.getElementById('cancel-username-btn');
  if (cancelUsernameButton) cancelUsernameButton.addEventListener('click', closeUsernameModal);

  const usernameForm = document.getElementById('username-form');
  if (usernameForm) usernameForm.addEventListener('submit', saveUsernameChange);

  const closeAvatarButton = document.getElementById('close-avatar-modal');
  if (closeAvatarButton) closeAvatarButton.addEventListener('click', closeAvatarModal);

  const avatarModal = document.getElementById('avatar-lightbox');
  if (avatarModal) {
    avatarModal.addEventListener('click', (event) => {
      if (event.target === avatarModal) closeAvatarModal();
    });
    document.addEventListener('keydown', (event) => {
      if (!avatarModal.classList.contains('open')) return;
      if (event.key === 'Escape') {
        closeAvatarModal();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = avatarModal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      const items = Array.from(focusable).filter((el) => !el.disabled && el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  const usernameModal = document.getElementById('username-modal');
  if (usernameModal) {
    usernameModal.addEventListener('click', (event) => {
      if (event.target === usernameModal) closeUsernameModal();
    });
    document.addEventListener('keydown', (event) => {
      if (!usernameModal.classList.contains('open')) return;
      if (event.key === 'Escape') {
        closeUsernameModal();
      }
    });
  }

  const logoutButton = document.getElementById('sidebar-logout-btn');
  if (logoutButton) {
    logoutButton.addEventListener('click', () => logout());
  }

  // Modal close buttons
  const closeReceiptModal = document.getElementById('close-receipt-modal');
  if (closeReceiptModal) closeReceiptModal.addEventListener('click', () => closeModal('order-receipt-modal'));
}

function initProfile() {
  if (!requireAuth()) return;
  renderHeader('profile');
  renderFooter();
  setupProfileTabs();
  loadProfileOverview();
  loadCustomerStats();

  // Check URL query for tab selection
  const params = new URLSearchParams(window.location.search);
  const requestedTab = params.get('tab');
  if (requestedTab) {
    const tabBtn = [...document.querySelectorAll('.profile-nav-btn')]
      .find((button) => button.getAttribute('data-tab') === requestedTab);
    if (tabBtn) tabBtn.click();
  } else {
    const defaultTab = document.querySelector('.profile-nav-btn.active') || document.querySelector('.profile-nav-btn[data-tab="overview"]');
    if (defaultTab) defaultTab.click();
    else loadStatusOrders();
  }

  // 10-second polling for active order updates
  pollingTimer = setInterval(() => {
    if (activeTab === 'status') {
      loadStatusOrders();
    }
  }, 10000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initProfile);
} else {
  initProfile();
}
