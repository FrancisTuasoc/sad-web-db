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

function getStatusIcon(type, status) {
  switch (status) {
    case 'pending':
      return `<i class="fa-solid fa-clock" style="color:var(--color-warning, #d97706);" aria-hidden="true"></i>`;
    case 'preparing':
      return `<i class="fa-solid fa-fire-burner" style="color:#d97706;" aria-hidden="true"></i>`;
    case 'ready_for_pickup':
      return `<i class="fa-solid fa-store" style="color:#2563eb;" aria-hidden="true"></i>`;
    case 'ready_to_deliver':
      return `<i class="fa-solid fa-motorcycle" style="color:#2563eb;" aria-hidden="true"></i>`;
    case 'completed':
      return `<i class="fa-solid fa-circle-check" style="color:#16a34a;" aria-hidden="true"></i>`;
    case 'cancelled':
      return `<i class="fa-solid fa-circle-xmark" style="color:#dc2626;" aria-hidden="true"></i>`;
    default:
      if (type === 'new_order') {
        return `<i class="fa-solid fa-receipt" style="color:#d97706;" aria-hidden="true"></i>`;
      }
      return `<i class="fa-solid fa-bell" style="color:var(--color-brand-secondary, #e25822);" aria-hidden="true"></i>`;
  }
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
      try {
        await apiFetch('/notifications/read-all', { method: 'PATCH' });
        badge.textContent = '0';
        badge.classList.add('hidden');
        const unreadItems = list.querySelectorAll('.notification-item.unread');
        unreadItems.forEach((el) => el.classList.remove('unread'));
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
    if (!data || !data.success) return;

    updateCustomerBadge(data.unreadCount || 0);
    renderNotificationList(list, data.notifications || [], false);
  } catch (err) {
    // network or auth error
  }
}

function updateCustomerBadge(count) {
  const badge = document.getElementById('header-notification-badge');
  if (!badge) return;

  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.remove('hidden');
  } else {
    badge.textContent = '0';
    badge.classList.add('hidden');
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
      const icon = getStatusIcon(item.type, item.status);
      const timeAgo = formatRelativeTime(item.createdAt);

      return `
        <div class="notification-item ${isUnread ? 'unread' : ''}" data-id="${item.id}" data-order-id="${item.orderId || ''}">
          <div class="notification-icon-wrap">${icon}</div>
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
      if (row.classList.contains('unread')) {
        row.classList.remove('unread');
        try {
          await apiFetch(`/notifications/${id}/read`, {
            method: 'PATCH',
            body: isAdminScope ? { scope: 'admin' } : {},
          });
          const badgeId = isAdminScope
            ? 'admin-notification-badge'
            : 'header-notification-badge';
          const badge = document.getElementById(badgeId);
          if (badge) {
            const current = parseInt(badge.textContent, 10) || 0;
            const next = Math.max(0, current - 1);
            badge.textContent = next > 0 ? String(next) : '0';
            if (next === 0) badge.classList.add('hidden');
          }
        } catch (e) {
          // ignore
        }
      }

      if (isAdminScope) {
        // In admin view, switch to orders section
        const ordersTabBtn = document.querySelector('.admin-nav-item[data-section="orders"]');
        if (ordersTabBtn) ordersTabBtn.click();
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

    const icon = getStatusIcon(notif.type, notif.status);
    const div = document.createElement('div');
    div.className = 'notification-item unread';
    div.setAttribute('data-id', notif.id);
    div.setAttribute('data-order-id', notif.orderId || '');
    div.innerHTML = `
      <div class="notification-icon-wrap">${icon}</div>
      <div class="notification-content">
        <div class="notification-item-title">${escapeHtml(notif.title)}</div>
        <div class="notification-item-msg">${escapeHtml(notif.message)}</div>
        <div class="notification-item-time">Just now</div>
      </div>
    `;
    div.onclick = () => {
      div.classList.remove('unread');
      apiFetch(`/notifications/${notif.id}/read`, { method: 'PATCH' }).catch(() => {});
      const b = document.getElementById('header-notification-badge');
      if (b) {
        const cur = parseInt(b.textContent, 10) || 0;
        const nxt = Math.max(0, cur - 1);
        b.textContent = nxt > 0 ? String(nxt) : '0';
        if (nxt === 0) b.classList.add('hidden');
      }
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
      try {
        await apiFetch('/notifications/read-all', {
          method: 'PATCH',
          body: { scope: 'admin' },
        });
        badge.textContent = '0';
        badge.classList.add('hidden');
        const unreadItems = list.querySelectorAll('.notification-item.unread');
        unreadItems.forEach((el) => el.classList.remove('unread'));
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
    if (!data || !data.success) return;

    updateAdminBadge(data.unreadCount || 0);
    renderNotificationList(list, data.notifications || [], true);
  } catch (err) {
    // network or auth error
  }
}

function updateAdminBadge(count) {
  const badge = document.getElementById('admin-notification-badge');
  if (!badge) return;

  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.remove('hidden');
  } else {
    badge.textContent = '0';
    badge.classList.add('hidden');
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

    const icon = getStatusIcon(notif.type, notif.status);
    const div = document.createElement('div');
    div.className = 'notification-item unread';
    div.setAttribute('data-id', notif.id);
    div.setAttribute('data-order-id', notif.orderId || '');
    div.innerHTML = `
      <div class="notification-icon-wrap">${icon}</div>
      <div class="notification-content">
        <div class="notification-item-title">${escapeHtml(notif.title)}</div>
        <div class="notification-item-msg">${escapeHtml(notif.message)}</div>
        <div class="notification-item-time">Just now</div>
      </div>
    `;
    div.onclick = () => {
      div.classList.remove('unread');
      apiFetch(`/notifications/${notif.id}/read`, {
        method: 'PATCH',
        body: { scope: 'admin' },
      }).catch(() => {});
      const b = document.getElementById('admin-notification-badge');
      if (b) {
        const cur = parseInt(b.textContent, 10) || 0;
        const nxt = Math.max(0, cur - 1);
        b.textContent = nxt > 0 ? String(nxt) : '0';
        if (nxt === 0) b.classList.add('hidden');
      }
      const ordersTabBtn = document.querySelector('.admin-nav-item[data-section="orders"]');
      if (ordersTabBtn) ordersTabBtn.click();
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

function startAdminPollingFallback() {
  if (adminPollTimer) return;
  adminPollTimer = setInterval(() => {
    loadAdminNotifications();
  }, 10000);
}
