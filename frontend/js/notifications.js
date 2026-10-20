// Real-time Notification System (SSE + Audio chime + Dropdown Center)
// Strictly 100% Free Resources: Native Web Audio API, Standard EventSource, FontAwesome Free

import { apiFetch, apiUrl } from './api.js';
import { isLoggedIn, isAdmin } from './auth.js';
import { showToast, escapeHtml } from './ui.js';

let customerStream = null;
let adminStream = null;
let customerPollTimer = null;
let adminPollTimer = null;

// Free Web Audio API synthesized notification sound (two-tone chime: E5 -> B5)
export function playNotificationSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(659.25, now); // E5
    osc.frequency.setValueAtTime(987.77, now + 0.12); // B5

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.45);
  } catch (e) {
    // Graceful fallback if autoplay restrictions apply
  }
}

function formatRelativeTime(dateInput) {
  const date = new Date(dateInput);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function getStatusMeta(type, status) {
  const normStatus = (status || '').toLowerCase();
  const normType = (type || '').toLowerCase();

  if (normStatus === 'cancelled' || normType === 'order_cancelled') {
    return {
      cssClass: 'status-cancelled',
      svg: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    };
  }

  if (normStatus === 'completed' || normType === 'order_completed') {
    return {
      cssClass: 'status-completed',
      svg: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>`,
    };
  }

  if (normStatus === 'ready_for_pickup' || normStatus === 'to_pickup') {
    return {
      cssClass: 'status-ready',
      svg: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`,
    };
  }

  if (normStatus === 'ready_to_deliver' || normStatus === 'to_ship') {
    return {
      cssClass: 'status-delivery',
      svg: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`,
    };
  }

  if (normStatus === 'preparing') {
    return {
      cssClass: 'status-preparing',
      svg: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`,
    };
  }

  if (normType === 'new_order') {
    return {
      cssClass: 'status-new-order',
      svg: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
    };
  }

  return {
    cssClass: 'status-pending',
    svg: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  };
}

// ---------------- CUSTOMER NOTIFICATIONS ----------------
export function initCustomerNotifications() {
  if (!isLoggedIn()) return;

  const wrapper = document.getElementById('header-notifications-wrapper');
  if (wrapper) wrapper.classList.remove('hidden');

  const btn = document.getElementById('header-notification-btn');
  const dropdown = document.getElementById('header-notification-dropdown');
  const badge = document.getElementById('header-notification-badge');
  const list = document.getElementById('header-notification-list');
  const markAllBtn = document.getElementById('header-mark-all-read-btn');

  if (!btn || !dropdown) return;

  // Toggle dropdown
  btn.onclick = (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  };

  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
      dropdown.classList.remove('open');
    }
  });

  if (markAllBtn) {
    markAllBtn.onclick = async (e) => {
      e.stopPropagation();
      updateCustomerBadge(0);
      const unreadItems = list.querySelectorAll('.notification-item.unread');
      unreadItems.forEach((el) => el.classList.remove('unread'));
      try {
        await apiFetch('/notifications/read-all', {
          method: 'PATCH',
          body: { scope: 'customer' },
        });
      } catch (err) {
        // ignore
      }
    };
  }

  // Load initial notifications
  loadCustomerNotifications();

  // Connect customer SSE stream with token
  connectCustomerSSE();
}

async function loadCustomerNotifications() {
  const badge = document.getElementById('header-notification-badge');
  const list = document.getElementById('header-notification-list');
  if (!badge || !list) return;

  try {
    const data = await apiFetch('/notifications?limit=20');
    if (!data || !data.success) {
      updateCustomerBadge(0);
      return;
    }

    const unread = Number.isFinite(Number(data.unreadCount))
      ? Number(data.unreadCount)
      : (Array.isArray(data.notifications)
          ? data.notifications.filter((n) => !n.isRead).length
          : 0);
    updateCustomerBadge(unread);
    renderNotificationList(list, data.notifications || [], false);
  } catch (err) {
    updateCustomerBadge(0);
  }
}

function updateCustomerBadge(count) {
  const badge = document.getElementById('header-notification-badge');
  if (!badge) return;

  const validCount = Math.max(0, parseInt(count, 10) || 0);
  if (validCount > 0) {
    badge.textContent = validCount > 99 ? '99+' : String(validCount);
    badge.classList.remove('hidden');
    badge.style.display = 'inline-flex';
  } else {
    badge.textContent = '';
    badge.classList.add('hidden');
    badge.style.display = 'none';
  }
}

function renderNotificationList(listElement, notifications, isAdminScope) {
  if (!listElement) return;

  if (!notifications || notifications.length === 0) {
    listElement.innerHTML = `<div class="notification-empty">No notifications yet.</div>`;
    return;
  }

  listElement.innerHTML = notifications
    .map((item) => {
      const isUnread = !item.isRead;
      const { cssClass, svg } = getStatusMeta(item.type, item.status);
      const timeAgo = formatRelativeTime(item.createdAt);

      return `
        <div class="notification-item ${isUnread ? 'unread' : ''}" data-id="${item.id}" data-order-id="${item.orderId || ''}">
          <div class="notification-icon-wrap ${cssClass}">${svg}</div>
          <div class="notification-content">
            <div class="notification-item-title">${escapeHtml(item.title)}</div>
            <div class="notification-item-msg">${escapeHtml(item.message)}</div>
            <div class="notification-item-time">${timeAgo}</div>
          </div>
        </div>
      `;
    })
    .join('');

  // Click on single notification item
  listElement.querySelectorAll('.notification-item').forEach((row) => {
    row.onclick = async () => {
      const id = row.getAttribute('data-id');
      const orderId = row.getAttribute('data-order-id');

      if (row.classList.contains('unread')) {
        row.classList.remove('unread');
        const badgeId = isAdminScope
          ? 'admin-notification-badge'
          : 'header-notification-badge';
        const badge = document.getElementById(badgeId);
        if (badge) {
          const current = parseInt(badge.textContent, 10) || 0;
          const next = Math.max(0, current - 1);
          if (isAdminScope) {
            updateAdminBadge(next);
          } else {
            updateCustomerBadge(next);
          }
        }
        try {
          const query = isAdminScope ? '?scope=admin' : '';
          await apiFetch(`/notifications/${id}/read${query}`, {
            method: 'PATCH',
            body: isAdminScope ? { scope: 'admin' } : { scope: 'customer' },
          });
        } catch (e) {
          // ignore
        }
      }

      const dropdownId = isAdminScope
        ? 'admin-notification-dropdown'
        : 'header-notification-dropdown';
      const dropdown = document.getElementById(dropdownId);
      if (dropdown) dropdown.classList.remove('open');

      if (isAdminScope) {
        // In admin view, switch to orders section
        const ordersTabBtn = document.querySelector('.admin-nav-item[data-section="orders"]');
        if (ordersTabBtn) ordersTabBtn.click();
        if (orderId && typeof window.openAdminOrderDrawer === 'function') {
          window.openAdminOrderDrawer(orderId);
        }
      } else {
        // In customer view, navigate or switch to orders in profile
        if (window.location.pathname.includes('profile.html')) {
          const statusTabBtn = document.querySelector('.profile-tab[data-tab="status"]');
          if (statusTabBtn) statusTabBtn.click();
        } else {
          window.location.href = 'profile.html?tab=status';
        }
      }
    };
  });
}

function connectCustomerSSE() {
  if (customerStream) return;
  const token = localStorage.getItem('token');
  if (!token) return;

  try {
    const streamUrl = apiUrl(`/stream?token=${encodeURIComponent(token)}`);
    customerStream = new EventSource(streamUrl);

    customerStream.addEventListener('notification', (e) => {
      try {
        const notif = JSON.parse(e.data);
        handleCustomerIncomingNotification(notif);
      } catch (err) {}
    });

    customerStream.addEventListener('order_status', (e) => {
      try {
        const data = JSON.parse(e.data);
        // Dispatch live event to immediately refresh active orders on profile page
        window.dispatchEvent(
          new CustomEvent('gigabite:order-status-changed', { detail: data })
        );
      } catch (err) {}
    });

    customerStream.onerror = () => {
      if (customerStream) {
        customerStream.close();
        customerStream = null;
      }
      startCustomerPollingFallback();
      setTimeout(connectCustomerSSE, 12000);
    };
  } catch (err) {
    startCustomerPollingFallback();
  }
}

function handleCustomerIncomingNotification(notif) {
  playNotificationSound();
  showToast(`🔔 ${notif.title}: ${notif.message}`, 'info', 5000);

  // Increment badge
  const badge = document.getElementById('header-notification-badge');
  if (badge) {
    const current = badge.classList.contains('hidden')
      ? 0
      : parseInt(badge.textContent, 10) || 0;
    updateCustomerBadge(current + 1);
  }

  // Prepend to list
  const list = document.getElementById('header-notification-list');
  if (list) {
    const emptyNotice = list.querySelector('.notification-empty');
    if (emptyNotice) emptyNotice.remove();

    const { cssClass, svg } = getStatusMeta(notif.type, notif.status);
    const div = document.createElement('div');
    div.className = 'notification-item unread';
    div.setAttribute('data-id', notif.id);
    div.setAttribute('data-order-id', notif.orderId || '');
    div.innerHTML = `
      <div class="notification-icon-wrap ${cssClass}">${svg}</div>
      <div class="notification-content">
        <div class="notification-item-title">${escapeHtml(notif.title)}</div>
        <div class="notification-item-msg">${escapeHtml(notif.message)}</div>
        <div class="notification-item-time">Just now</div>
      </div>
    `;
    div.onclick = async () => {
      if (div.classList.contains('unread')) {
        div.classList.remove('unread');
        const b = document.getElementById('header-notification-badge');
        if (b) {
          const cur = parseInt(b.textContent, 10) || 0;
          const nxt = Math.max(0, cur - 1);
          updateCustomerBadge(nxt);
        }
        try {
          await apiFetch(`/notifications/${notif.id}/read`, {
            method: 'PATCH',
            body: { scope: 'customer' },
          });
        } catch (e) {
          // ignore
        }
      }
      const dropdown = document.getElementById('header-notification-dropdown');
      if (dropdown) dropdown.classList.remove('open');

      if (window.location.pathname.includes('profile.html')) {
        const statusTabBtn = document.querySelector('.profile-tab[data-tab="status"]');
        if (statusTabBtn) statusTabBtn.click();
      } else {
        window.location.href = 'profile.html?tab=status';
      }
    };
    list.prepend(div);
  }

  // Refresh orders view
  window.dispatchEvent(
    new CustomEvent('gigabite:order-status-changed', {
      detail: { orderId: notif.orderId, status: notif.status },
    })
  );
}

function startCustomerPollingFallback() {
  if (customerPollTimer) return;
  customerPollTimer = setInterval(() => {
    loadCustomerNotifications();
  }, 15000);
}

// ---------------- ADMIN NOTIFICATIONS ----------------
export function initAdminNotifications() {
  if (!isLoggedIn() || !isAdmin()) return;

  const btn = document.getElementById('admin-notification-btn');
  const dropdown = document.getElementById('admin-notification-dropdown');
  const badge = document.getElementById('admin-notification-badge');
  const list = document.getElementById('admin-notification-list');
  const markAllBtn = document.getElementById('admin-mark-all-read-btn');

  if (!btn || !dropdown) return;

  btn.onclick = (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  };

  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
      dropdown.classList.remove('open');
    }
  });

  if (markAllBtn) {
    markAllBtn.onclick = async (e) => {
      e.stopPropagation();
      updateAdminBadge(0);
      const unreadItems = list.querySelectorAll('.notification-item.unread');
      unreadItems.forEach((el) => el.classList.remove('unread'));
      try {
        await apiFetch('/notifications/read-all?scope=admin', {
          method: 'PATCH',
          body: { scope: 'admin' },
        });
      } catch (err) {
        // ignore
      }
    };
  }

  loadAdminNotifications();
  connectAdminSSE();
}

async function loadAdminNotifications() {
  const badge = document.getElementById('admin-notification-badge');
  const list = document.getElementById('admin-notification-list');
  if (!badge || !list) return;

  try {
    const data = await apiFetch('/notifications?scope=admin&limit=25');
    if (!data || !data.success) {
      updateAdminBadge(0);
      return;
    }

    const unread = Number.isFinite(Number(data.unreadCount))
      ? Number(data.unreadCount)
      : (Array.isArray(data.notifications)
          ? data.notifications.filter((n) => !n.isRead).length
          : 0);
    updateAdminBadge(unread);
    renderNotificationList(list, data.notifications || [], true);
  } catch (err) {
    updateAdminBadge(0);
  }
}

function updateAdminBadge(count) {
  const badge = document.getElementById('admin-notification-badge');
  if (!badge) return;

  const validCount = Math.max(0, parseInt(count, 10) || 0);
  if (validCount > 0) {
    badge.textContent = validCount > 99 ? '99+' : String(validCount);
    badge.classList.remove('hidden');
    badge.style.display = 'inline-flex';
  } else {
    badge.textContent = '';
    badge.classList.add('hidden');
    badge.style.display = 'none';
  }
}

function connectAdminSSE() {
  if (adminStream) return;
  const token = localStorage.getItem('token');
  if (!token) return;

  try {
    const streamUrl = apiUrl(`/stream?token=${encodeURIComponent(token)}`);
    adminStream = new EventSource(streamUrl);

    adminStream.addEventListener('notification', (e) => {
      try {
        const notif = JSON.parse(e.data);
        handleAdminIncomingNotification(notif);
      } catch (err) {}
    });

    adminStream.addEventListener('admin_order', (e) => {
      try {
        const data = JSON.parse(e.data);
        // Immediately notify admin orders list and dashboard to refresh live!
        window.dispatchEvent(
          new CustomEvent('gigabite:admin-order-changed', { detail: data })
        );
      } catch (err) {}
    });

    adminStream.onerror = () => {
      if (adminStream) {
        adminStream.close();
        adminStream = null;
      }
      startAdminPollingFallback();
      setTimeout(connectAdminSSE, 10000);
    };
  } catch (err) {
    startAdminPollingFallback();
  }
}

function handleAdminIncomingNotification(notif) {
  playNotificationSound();
  showToast(`🔔 ${notif.title}: ${notif.message}`, 'info', 5000);

  // Increment badge
  const badge = document.getElementById('admin-notification-badge');
  if (badge) {
    const current = badge.classList.contains('hidden')
      ? 0
      : parseInt(badge.textContent, 10) || 0;
    updateAdminBadge(current + 1);
  }

  // Prepend to admin list
  const list = document.getElementById('admin-notification-list');
  if (list) {
    const emptyNotice = list.querySelector('.notification-empty');
    if (emptyNotice) emptyNotice.remove();

    const { cssClass, svg } = getStatusMeta(notif.type, notif.status);
    const div = document.createElement('div');
    div.className = 'notification-item unread';
    div.setAttribute('data-id', notif.id);
    div.setAttribute('data-order-id', notif.orderId || '');
    div.innerHTML = `
      <div class="notification-icon-wrap ${cssClass}">${svg}</div>
      <div class="notification-content">
        <div class="notification-item-title">${escapeHtml(notif.title)}</div>
        <div class="notification-item-msg">${escapeHtml(notif.message)}</div>
        <div class="notification-item-time">Just now</div>
      </div>
    `;
    div.onclick = async () => {
      if (div.classList.contains('unread')) {
        div.classList.remove('unread');
        const b = document.getElementById('admin-notification-badge');
        if (b) {
          const cur = parseInt(b.textContent, 10) || 0;
          const nxt = Math.max(0, cur - 1);
          b.textContent = nxt > 0 ? (nxt > 99 ? '99+' : String(nxt)) : '0';
          if (nxt === 0) b.classList.add('hidden');
        }
        try {
          await apiFetch(`/notifications/${notif.id}/read?scope=admin`, {
            method: 'PATCH',
            body: { scope: 'admin' },
          });
        } catch (e) {
          // ignore
        }
      }

      const dropdown = document.getElementById('admin-notification-dropdown');
      if (dropdown) dropdown.classList.remove('open');

      const ordersTabBtn = document.querySelector('.admin-nav-item[data-section="orders"]');
      if (ordersTabBtn) ordersTabBtn.click();
      if (notif.orderId && typeof window.openAdminOrderDrawer === 'function') {
        window.openAdminOrderDrawer(notif.orderId);
      }
    };
    list.prepend(div);
  }

  // Dispatch event to refresh admin view
  window.dispatchEvent(
    new CustomEvent('gigabite:admin-order-changed', {
      detail: { type: notif.type, orderId: notif.orderId, status: notif.status },
    })
  );
}

export async function markAdminNotificationReadByOrderId(orderId) {
  if (!orderId) return;
  const list = document.getElementById('admin-notification-list');
  const badge = document.getElementById('admin-notification-badge');

  let markedCount = 0;
  if (list) {
    const matchingItems = list.querySelectorAll(`.notification-item.unread[data-order-id="${orderId}"]`);
    matchingItems.forEach((item) => {
      item.classList.remove('unread');
      markedCount++;
    });
  }

  if (markedCount > 0 && badge) {
    const cur = parseInt(badge.textContent, 10) || 0;
    const nxt = Math.max(0, cur - markedCount);
    badge.textContent = nxt > 0 ? (nxt > 99 ? '99+' : String(nxt)) : '0';
    if (nxt === 0) badge.classList.add('hidden');
  }

  try {
    await apiFetch(`/notifications/by-order/${orderId}/read?scope=admin`, {
      method: 'PATCH',
      body: { scope: 'admin' },
    });
  } catch (err) {
    // ignore
  }
}

function startAdminPollingFallback() {
  if (adminPollTimer) return;
  adminPollTimer = setInterval(() => {
    loadAdminNotifications();
  }, 10000);
}
