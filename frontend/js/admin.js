// Admin Dashboard & Operations Controller
import { apiFetch } from './api.js';
import { showToast, escapeHtml, openModal, closeModal, getProductImageUrl, setupBackToTop } from './ui.js';
import { requireAuth, getUser, resizeImageToDataUrl } from './auth.js';

let activeSection = 'dashboard';
let dashboardStats = null;
let currentSalesView = 'daily'; // 'daily' | 'weekly' | 'monthly'
let currentChartDays = 14;
let dashboardRefreshPending = false;

// Pagination and filters state for Orders
let ordersFilter = {
  search: '',
  status: 'all',
  paymentStatus: 'all',
  fulfillment: 'all',
  dateRange: '',
  page: 1,
  limit: 15,
};

// Menu state
let menuCategoryFilter = 'all';
let menuStockFilter = 'all';
let menuSearchQuery = '';
let editingProductId = null;
let editingCategoryId = null;
let categoriesList = [];

// ---------------- Initialization & Navigation ----------------
function setupAdminNavigation() {
  const navItems = document.querySelectorAll('.admin-nav-item');
  navItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      navItems.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeSection = btn.getAttribute('data-section');

      document.querySelectorAll('.admin-section').forEach((sec) => sec.classList.add('hidden'));
      const targetSec = document.getElementById(`section-${activeSection}`);
      if (targetSec) targetSec.classList.remove('hidden');

      // Close mobile sidebar if open
      const sidebar = document.getElementById('admin-sidebar');
      if (sidebar) sidebar.classList.remove('open-mobile');
      updateSidebarToggleState();

      // Refresh target section
      switch (activeSection) {
        case 'dashboard': loadDashboardStats(); break;
        case 'orders': loadAdminOrders(); break;
        case 'menu': loadAdminMenu(); break;
        case 'categories': loadAdminCategories(); break;
        case 'customers': loadAdminCustomers(); break;
        case 'settings': loadAdminSettings(); break;
      }
    });
  });

  const toggleSidebarBtn = document.getElementById('admin-toggle-sidebar-btn');
  const sidebar = document.getElementById('admin-sidebar');
  if (toggleSidebarBtn && sidebar) {
    toggleSidebarBtn.addEventListener('click', () => {
      const adminLayout = document.querySelector('.admin-layout');
      if (window.matchMedia('(max-width: 900px)').matches) {
        sidebar.classList.toggle('open-mobile');
      } else if (adminLayout) {
        adminLayout.classList.toggle('is-sidebar-collapsed');
      }
      updateSidebarToggleState();
    });
  }

  window.addEventListener('resize', updateSidebarToggleState);
}

function updateSidebarToggleState() {
  const toggleButton = document.getElementById('admin-toggle-sidebar-btn');
  const sidebar = document.getElementById('admin-sidebar');
  const adminLayout = document.querySelector('.admin-layout');
  if (!toggleButton || !sidebar || !adminLayout) return;

  const isMobile = window.matchMedia('(max-width: 900px)').matches;
  const isExpanded = isMobile
    ? sidebar.classList.contains('open-mobile')
    : !adminLayout.classList.contains('is-sidebar-collapsed');
  const actionLabel = isExpanded ? 'Collapse navigation' : 'Expand navigation';
  toggleButton.setAttribute('aria-expanded', String(isExpanded));
  toggleButton.setAttribute('aria-label', isMobile
    ? `${isExpanded ? 'Close' : 'Open'} navigation drawer`
    : actionLabel);
  toggleButton.title = isMobile
    ? `${isExpanded ? 'Close' : 'Open'} navigation drawer`
    : actionLabel;
}

// ---------------- 1. DASHBOARD & CHARTS ----------------
async function loadDashboardStats() {
  if (dashboardRefreshPending) return;
  dashboardRefreshPending = true;
  const refreshButton = document.getElementById('dashboard-refresh-btn');
  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.setAttribute('aria-busy', 'true');
    refreshButton.classList.add('is-refreshing');
  }

  try {
    const res = await apiFetch('/admin/stats');
    dashboardStats = res.stats;

    // Stat cards
    document.getElementById('stat-total-revenue').textContent = formatPeso(dashboardStats.totalRevenue);
    document.getElementById('stat-total-orders').textContent = String(dashboardStats.totalOrders);
    document.getElementById('stat-pending-orders').textContent = String(dashboardStats.pendingOrders);
    updatePendingOrderBadge(dashboardStats.pendingOrders);
    document.getElementById('stat-completed-orders').textContent = String(dashboardStats.completedOrders);
    document.getElementById('stat-cancelled-orders').textContent = String(dashboardStats.cancelledOrders);
    document.getElementById('stat-total-customers').textContent = String(dashboardStats.totalCustomers);

    const updatedAt = document.getElementById('dashboard-last-updated');
    if (updatedAt) {
      updatedAt.textContent = `Updated ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date())}`;
    }
    renderSalesToggleData();
    renderRevenueBarChart();
    renderStatusDonutChart();
    renderTopItems();
    renderRecentOrders();
  } catch (err) {
    showToast('Failed to load dashboard metrics: ' + err.message, 'error');
  } finally {
    dashboardRefreshPending = false;
    if (refreshButton) {
      refreshButton.disabled = false;
      refreshButton.setAttribute('aria-busy', 'false');
      refreshButton.classList.remove('is-refreshing');
    }
  }
}

function updatePendingOrderBadge(count) {
  const pendingBadge = document.getElementById('admin-pending-count');
  if (!pendingBadge) return;

  const pendingCount = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0;
  pendingBadge.textContent = String(pendingCount);
  pendingBadge.classList.toggle('hidden', pendingCount === 0);
  const ordersButton = pendingBadge.closest('.admin-nav-item');
  if (ordersButton) {
    ordersButton.setAttribute(
      'aria-label',
      pendingCount === 1 ? 'Orders Management, 1 order awaiting acceptance'
        : `Orders Management, ${pendingCount} orders awaiting acceptance`
    );
  }
}

function updateOnlineOrderingSummary(isAccepting, saved = false) {
  const summary = document.getElementById('settings-accepting-orders-help');
  if (!summary) return;

  if (isAccepting) {
    summary.textContent = saved
      ? 'Online ordering is on. Customers can place new orders.'
      : 'Online ordering will be on after you save. Customers can then place new orders.';
    summary.classList.toggle('is-unsaved', !saved);
  } else {
    summary.textContent = saved
      ? 'Online ordering is off. New customer orders are blocked; existing orders are not affected.'
      : 'Online ordering will be off after you save. New customer orders will be blocked; existing orders will not be affected.';
    summary.classList.toggle('is-unsaved', !saved);
  }
}

function formatPeso(value) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 2,
  }).format(Number(value));
}

function getStoreDateKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function renderSalesToggleData() {
  if (!dashboardStats || !dashboardStats.sales) return;
  const data = dashboardStats.sales[currentSalesView] || { count: 0, revenue: 0 };
  const labelElem = document.getElementById('sales-toggle-label');
  const countElem = document.getElementById('sales-toggle-count');
  const revElem = document.getElementById('sales-toggle-revenue');

  const titles = { daily: "Today's Sales", weekly: 'Last 7 Days Sales', monthly: 'Last 30 Days Sales' };
  if (labelElem) labelElem.textContent = titles[currentSalesView];
  if (countElem) countElem.textContent = `${data.count} completed ${data.count === 1 ? 'order' : 'orders'}`;
  if (revElem) revElem.textContent = formatPeso(data.revenue);
}

// Inline SVG Revenue Bar Chart
function renderRevenueBarChart() {
  const container = document.getElementById('revenue-chart-container');
  if (!container || !dashboardStats || !dashboardStats.revenueHistory) return;

  const historyByDate = new Map(dashboardStats.revenueHistory.map((item) => [item._id, item]));
  const today = new Date(`${getStoreDateKey(new Date())}T00:00:00Z`);
  today.setUTCDate(today.getUTCDate() - currentChartDays + 1);
  const history = Array.from({ length: currentChartDays }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    return historyByDate.get(key) || { _id: key, revenue: 0, orders: 0 };
  });
  const chartHeight = 190;
  const chartWidth = 600;
  const chartTop = 18;
  const chartBottom = 158;
  const slotWidth = (chartWidth - 48) / history.length;
  const barWidth = Math.max(2, Math.min(22, slotWidth - 4));
  const maxRevenue = Math.max(...history.map((item) => item.revenue), 1);

  const bars = history
    .map((item, idx) => {
      const height = item.revenue > 0 ? Math.max(2, (item.revenue / maxRevenue) * (chartBottom - chartTop)) : 0;
      const x = 32 + idx * slotWidth + (slotWidth - barWidth) / 2;
      const y = chartBottom - height;
      const dateLabel = item._id.slice(5);
      const labelInterval = currentChartDays === 14 ? 2 : 5;

      return `
        <g class="chart-bar-group">
          <rect x="${x}" y="${y}" width="${barWidth}" height="${height}" rx="4" fill="url(#revenue-bar-fill)" opacity="${item.revenue ? '0.95' : '0.2'}">
            <title>${item._id}: ${formatPeso(item.revenue)} (${item.orders} completed ${item.orders === 1 ? 'order' : 'orders'})</title>
          </rect>
          ${idx % labelInterval === 0 || idx === history.length - 1 ? `<text x="${x + barWidth / 2}" y="${chartHeight - 8}" font-size="10" text-anchor="middle" fill="#706259">${dateLabel}</text>` : ''}
        </g>
      `;
    })
    .join('');

  container.innerHTML = `
    <svg class="admin-revenue-chart" viewBox="0 0 ${chartWidth} ${chartHeight}" role="img" aria-label="Completed revenue over the last ${currentChartDays} days">
      <defs><linearGradient id="revenue-bar-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#38bdf8"/><stop offset="100%" stop-color="#4f46e5"/></linearGradient></defs>
      <line x1="24" y1="${chartTop}" x2="${chartWidth - 12}" y2="${chartTop}" stroke="#f0e8df" stroke-width="1"/>
      <line x1="24" y1="${(chartTop + chartBottom) / 2}" x2="${chartWidth - 12}" y2="${(chartTop + chartBottom) / 2}" stroke="#f0e8df" stroke-width="1"/>
      <line x1="24" y1="${chartBottom}" x2="${chartWidth - 12}" y2="${chartBottom}" stroke="#e8dccd" stroke-width="1"/>
      ${bars}
    </svg>
  `;
}

// Inline SVG Status Donut Chart (Completed vs Cancelled vs Pending)
function renderStatusDonutChart() {
  const container = document.getElementById('status-donut-container');
  if (!container || !dashboardStats || !dashboardStats.statusComparison) return;

  const { completed, cancelled, pending, inProgress } = dashboardStats.statusComparison;
  const active = pending + inProgress;
  const total = completed + cancelled + active;
  const completedPct = total ? (completed / total) * 100 : 0;
  const cancelledPct = total ? (cancelled / total) * 100 : 0;
  const activePct = total ? (active / total) * 100 : 0;
  const completedOffset = 0;
  const cancelledOffset = -completedPct;
  const activeOffset = -(completedPct + cancelledPct);

  container.innerHTML = `
    <div class="admin-fulfillment-chart">
      <div class="admin-donut-wrap">
        <svg class="admin-donut" viewBox="0 0 36 36" role="img" aria-label="${total} total orders: ${completed} completed, ${cancelled} cancelled, ${active} active or pending">
          <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#eee7df" stroke-width="3.8"/>
          <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#10b981" stroke-width="3.8" stroke-dasharray="${completedPct} ${100 - completedPct}" stroke-dashoffset="${completedOffset}"/>
          <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#fb7185" stroke-width="3.8" stroke-dasharray="${cancelledPct} ${100 - cancelledPct}" stroke-dashoffset="${cancelledOffset}"/>
          <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#818cf8" stroke-width="3.8" stroke-dasharray="${activePct} ${100 - activePct}" stroke-dashoffset="${activeOffset}"/>
        </svg>
        <span class="admin-donut-total">${total}<small>orders</small></span>
      </div>
      <div class="admin-donut-legend">
        <div><span class="admin-legend-dot is-completed"></span><span>Completed</span><strong>${completed}</strong><small>${completedPct.toFixed(1)}%</small></div>
        <div><span class="admin-legend-dot is-cancelled"></span><span>Cancelled</span><strong>${cancelled}</strong><small>${cancelledPct.toFixed(1)}%</small></div>
        <div><span class="admin-legend-dot is-active"></span><span>Active / pending</span><strong>${active}</strong><small>${activePct.toFixed(1)}%</small></div>
      </div>
    </div>
  `;
}

// Top Items List
function renderTopItems() {
  const container = document.getElementById('top-items-list');
  if (!container || !dashboardStats || !dashboardStats.topItems) return;

  const topItems = dashboardStats.topItems;
  if (topItems.length === 0) {
    container.innerHTML = '<p class="text-muted" style="font-size:0.85rem;">No orders yet.</p>';
    return;
  }

  container.innerHTML = topItems
    .map((item, idx) => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--color-border);font-size:0.88rem;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="width:20px;height:20px;border-radius:50%;background:var(--color-surface-alt);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.75rem;">${idx + 1}</span>
          <span style="font-weight:600;">${escapeHtml(item._id)}</span>
        </div>
        <div class="admin-top-item-metrics">
          <strong>${item.totalQty} sold</strong>
          <div>${formatPeso(item.totalSales)}</div>
        </div>
      </div>
    `)
    .join('');
}

// Recent Orders Table in Dashboard
function renderRecentOrders() {
  const tbody = document.getElementById('recent-orders-tbody');
  if (!tbody || !dashboardStats || !dashboardStats.recentOrders) return;

  const orders = dashboardStats.recentOrders;
  if (orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted" style="padding:20px;">No recent orders.</td></tr>';
    return;
  }

  tbody.innerHTML = orders
    .map((o) => `
      <tr>
        <td><strong>#${escapeHtml(o.orderNumber)}</strong></td>
        <td>${escapeHtml(o.contact.fullName)}</td>
        <td>₱${o.total.toFixed(2)}</td>
        <td>${o.fulfillment.toUpperCase()}</td>
        <td><span class="badge badge-${o.status}">${o.status}</span></td>
        <td><span class="badge badge-${o.paymentStatus}">${o.paymentStatus}</span></td>
      </tr>
    `)
    .join('');
}

// ---------------- 2. ORDERS MANAGEMENT ----------------
async function loadAdminOrders() {
  const tbody = document.getElementById('admin-orders-tbody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding:24px;">Loading orders...</td></tr>';

  try {
    const params = new URLSearchParams();
    if (ordersFilter.search) params.append('search', ordersFilter.search);
    if (ordersFilter.status !== 'all') params.append('status', ordersFilter.status);
    if (ordersFilter.paymentStatus !== 'all') params.append('paymentStatus', ordersFilter.paymentStatus);
    if (ordersFilter.fulfillment !== 'all') params.append('fulfillment', ordersFilter.fulfillment);
    if (ordersFilter.dateRange) params.append('dateRange', ordersFilter.dateRange);
    params.append('page', ordersFilter.page);
    params.append('limit', ordersFilter.limit);

    const [res, pendingRes] = await Promise.all([
      apiFetch(`/admin/orders?${params.toString()}`),
      apiFetch('/admin/orders?status=pending&page=1&limit=1'),
    ]);
    const { orders, pagination } = res;
    const pendingBadge = document.getElementById('admin-pending-count');
    if (pendingBadge) {
      updatePendingOrderBadge(pendingRes.pagination.total);
    }

    const pageIndicator = document.getElementById('orders-pagination-info');
    if (pageIndicator) {
      pageIndicator.textContent = `Page ${pagination.page} of ${pagination.totalPages} (${pagination.total} orders)`;
    }
    const prevPageBtn = document.getElementById('orders-prev-page');
    const nextPageBtn = document.getElementById('orders-next-page');
    if (prevPageBtn) prevPageBtn.disabled = pagination.page <= 1;
    if (nextPageBtn) nextPageBtn.disabled = pagination.page >= pagination.totalPages;

    if (orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted" style="padding:32px;">No orders match the selected filters.</td></tr>';
      return;
    }

    tbody.innerHTML = orders
      .map((o) => {
        const isPending = o.status === 'pending';
        return `
          <tr style="${isPending ? 'background-color:#FFFBEB;' : ''}">
            <td>
              <strong>#${escapeHtml(o.orderNumber)}</strong>
              ${isPending ? '<span class="badge badge-pending" style="margin-left:4px;">NEW</span>' : ''}
            </td>
            <td>
              <div>${escapeHtml(o.contact.fullName)}</div>
              <div style="font-size:0.75rem;color:var(--color-text-muted);">${escapeHtml(o.contact.phone)}</div>
            </td>
            <td>${new Date(o.createdAt).toLocaleDateString()}</td>
            <td>${o.fulfillment.toUpperCase()}</td>
            <td><strong>₱${o.total.toFixed(2)}</strong></td>
            <td><span class="badge badge-${o.paymentStatus}">${o.paymentStatus.toUpperCase()}</span></td>
            <td><span class="badge badge-${o.status}">${statusLabel(o.status)}</span></td>
            <td>
              <button class="btn btn-secondary btn-sm btn-open-order-drawer" data-order-id="${o._id}">
                Manage
              </button>
            </td>
          </tr>
        `;
      })
      .join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger" style="padding:24px;">Failed to load orders: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function statusLabel(status) {
  return ({
    pending: 'PENDING ACCEPTANCE',
    ready_for_pickup: 'READY FOR PICKUP',
    ready_to_deliver: 'READY TO DELIVER',
    to_pickup: 'READY FOR PICKUP',
    to_ship: 'READY TO DELIVER',
    completed: 'COMPLETED',
    cancelled: 'CANCELLED',
  })[status] || status.toUpperCase();
}

// Order Detail Drawer
async function openOrderDrawer(orderId) {
  try {
    const res = await apiFetch(`/admin/orders/${orderId}`);
    const order = res.order;
    const body = document.getElementById('order-drawer-content');
    if (!body) return;

    const itemsRows = order.items
      .map((item) => {
        let addonsStr = '';
        if (item.addons && item.addons.length > 0) {
          addonsStr = `<div style="font-size:0.75rem;color:var(--color-text-muted);padding-left:10px;">${item.addons.map((a) => `+ ${escapeHtml(a.name)} (x${a.qty} @ ₱${a.price.toFixed(2)})`).join(', ')}</div>`;
        }
        return `
          <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--color-border);font-size:0.85rem;">
            <div>
              <strong>${escapeHtml(item.name)}</strong> &times; ${item.quantity}
              ${addonsStr}
            </div>
            <span>₱${item.lineTotal.toFixed(2)}</span>
          </div>
        `;
      })
      .join('');

    // Action buttons based on status
    let actionButtons = '';
    if (order.status === 'pending') {
      const nextStatus = order.fulfillment === 'pickup' ? 'ready_for_pickup' : 'ready_to_deliver';
      const nextLabel = order.fulfillment === 'pickup' ? 'Accept & Mark Ready for Pickup' : 'Accept & Mark Ready for Delivery';
      actionButtons += `
        <button type="button" class="btn btn-primary btn-sm btn-action-status" data-order-id="${order._id}" data-status="${nextStatus}">
          ${nextLabel}
        </button>
      `;
    } else if (order.status === 'ready_for_pickup' || order.status === 'to_pickup') {
      actionButtons += `
        <button type="button" class="btn btn-primary btn-sm btn-action-status" data-order-id="${order._id}" data-status="completed">
          Mark Pick Up as Completed
        </button>
      `;
    } else if (order.status === 'ready_to_deliver' || order.status === 'to_ship') {
      actionButtons += '<p class="text-muted">Waiting for the customer to confirm delivery.</p>';
    }

    if (order.paymentStatus === 'unpaid' && order.status !== 'cancelled') {
      actionButtons += `
        <button type="button" class="btn btn-secondary btn-sm btn-action-paid" data-order-id="${order._id}">
          Mark as Paid
        </button>
      `;
    }

    body.innerHTML = `
      <div style="margin-bottom:16px;">
        <h4 style="font-size:1.15rem;margin-bottom:4px;">Order #${escapeHtml(order.orderNumber)}</h4>
        <div style="font-size:0.8rem;color:var(--color-text-light);">${new Date(order.createdAt).toLocaleString()}</div>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:16px;">
        <span class="badge badge-${order.status}">${statusLabel(order.status)}</span>
        <span class="badge badge-${order.paymentStatus}">${order.paymentStatus.toUpperCase()}</span>
      </div>

      <div class="step-card" style="margin-bottom:16px;">
        <h5 style="margin-bottom:6px;font-size:0.9rem;">Customer Information</h5>
        <div><strong>Name:</strong> ${escapeHtml(order.contact.fullName)}</div>
        <div><strong>Phone:</strong> ${escapeHtml(order.contact.phone)}</div>
        ${order.fulfillment === 'delivery' ? `<div><strong>Address:</strong> ${escapeHtml(order.contact.address)}</div>` : ''}
        <div><strong>Fulfillment:</strong> ${order.fulfillment.toUpperCase()}</div>
        <div><strong>Payment Method:</strong> ${order.paymentMethod.toUpperCase().replace(/_/g, ' ')}</div>
        ${order.gcashReference ? `<div style="background:#E1EFFE;padding:6px;border-radius:4px;margin-top:6px;"><strong>GCash Reference No:</strong> ${escapeHtml(order.gcashReference)}</div>` : ''}
      </div>

      <div class="step-card" style="margin-bottom:16px;">
        <h5 style="margin-bottom:6px;font-size:0.9rem;">Ordered Items</h5>
        ${itemsRows}
        <div style="display:flex;justify-content:space-between;padding-top:8px;font-weight:700;">
          <span>Subtotal:</span> <span>₱${order.subtotal.toFixed(2)}</span>
        </div>
        ${order.deliveryFee > 0 ? `
          <div style="display:flex;justify-content:space-between;padding-top:2px;">
            <span>Delivery Fee:</span> <span>₱${order.deliveryFee.toFixed(2)}</span>
          </div>
        ` : ''}
        <div style="display:flex;justify-content:space-between;padding-top:6px;font-size:1.1rem;font-weight:800;border-top:1px solid var(--color-border);margin-top:6px;">
          <span>Total:</span> <span>₱${order.total.toFixed(2)}</span>
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;">
        ${actionButtons}
      </div>
    `;

    openModal('order-drawer-modal');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ---------------- 3. MENU MANAGEMENT ----------------
async function loadAdminMenu() {
  const tbody = document.getElementById('admin-menu-tbody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding:24px;">Loading menu items...</td></tr>';

  try {
    const params = new URLSearchParams();
    if (menuCategoryFilter !== 'all') params.append('category', menuCategoryFilter);
    if (menuStockFilter !== 'all') params.append('stockFilter', menuStockFilter);
    if (menuSearchQuery.trim()) params.append('search', menuSearchQuery.trim());

    const res = await apiFetch(`/admin/products?${params.toString()}`);
    const products = res.products || [];

    if (products.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted" style="padding:32px;">No menu items found.</td></tr>';
      return;
    }

    tbody.innerHTML = products
      .map((p) => {
        const isLow = p.stock <= (p.lowStockThreshold || 10) && p.stock > 0;
        const isOut = p.stock <= 0;
        const rowClass = isOut ? 'background-color:#FDE8E8;' : isLow ? 'background-color:#FEF3C7;' : '';
        const catName = p.category && p.category.name ? p.category.name : 'Unassigned';
        const imgUrl = getProductImageUrl(p);

        return `
          <tr style="${rowClass}">
            <td>
              <div style="display:flex;align-items:center;gap:10px;">
                <img src="${escapeHtml(imgUrl)}" style="width:40px;height:40px;border-radius:4px;object-fit:cover;" onerror="window.handleImageError(this)">
                <div>
                  <strong>${escapeHtml(p.name)}</strong>
                  ${p.isAddon ? '<span class="badge" style="background:#E0E7FF;color:#3730A3;margin-left:4px;">Add-on</span>' : ''}
                  ${p.isFeatured ? '<span class="badge" style="background:#FEF3C7;color:#B45309;margin-left:4px;">Featured</span>' : ''}
                </div>
              </div>
            </td>
            <td>${escapeHtml(catName)}</td>
            <td><strong>₱${p.price.toFixed(2)}</strong></td>
            <td>
              <span style="font-weight:700;${isOut ? 'color:var(--color-danger);' : isLow ? 'color:var(--color-warning);' : ''}">
                ${p.stock}
              </span>
              <div style="font-size:0.75rem;color:var(--color-text-muted);">Threshold: ${p.lowStockThreshold}</div>
            </td>
            <td>
              <span class="badge ${p.isAvailable ? 'badge-in-stock' : 'badge-out-stock'}">
                ${p.isAvailable ? 'Available' : 'Unavailable'}
              </span>
            </td>
            <td>
              <div style="display:flex;gap:4px;flex-wrap:wrap;">
                <button class="btn btn-secondary btn-sm btn-edit-product" data-product-id="${p._id}">Edit</button>
                <button class="btn btn-secondary btn-sm btn-restock-product" data-product-id="${p._id}" data-current-stock="${p.stock}">Restock</button>
                <button class="btn btn-secondary btn-sm btn-toggle-availability" data-product-id="${p._id}">
                  ${p.isAvailable ? 'Disable' : 'Enable'}
                </button>
                <button class="btn btn-danger btn-sm btn-delete-product" data-product-id="${p._id}" data-name="${escapeHtml(p.name)}">Delete</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger" style="padding:24px;">Failed to load items: ${escapeHtml(err.message)}</td></tr>`;
  }
}

// Open Product Modal (Add or Edit)
async function openProductModal(productId = null) {
  editingProductId = productId;
  const modal = document.getElementById('product-modal');
  const title = document.getElementById('product-modal-title');
  const form = document.getElementById('product-form');

  if (!modal || !form) return;

  // Populate category select
  const catSelect = document.getElementById('product-category-input');
  if (catSelect) {
    if (categoriesList.length === 0) {
      const res = await apiFetch('/categories');
      categoriesList = res.categories || [];
    }
    catSelect.innerHTML = categoriesList
      .map((c) => `<option value="${c._id}">${escapeHtml(c.name)}</option>`)
      .join('');
  }

  if (productId) {
    title.textContent = 'Edit Menu Item';
    try {
      const res = await apiFetch(`/products/${productId}`);
      const p = res.product;
      document.getElementById('product-name-input').value = p.name;
      document.getElementById('product-price-input').value = p.price;
      document.getElementById('product-description-input').value = p.description || '';
      document.getElementById('product-stock-input').value = p.stock;
      document.getElementById('product-threshold-input').value = p.lowStockThreshold || 10;
      if (catSelect) catSelect.value = p.category._id || p.category;
      document.getElementById('product-is-addon-input').checked = Boolean(p.isAddon);
      document.getElementById('product-is-available-input').checked = Boolean(p.isAvailable);
      document.getElementById('product-is-featured-input').checked = Boolean(p.isFeatured);
    } catch (e) {
      showToast('Error loading item details', 'error');
      return;
    }
  } else {
    title.textContent = 'Add New Menu Item';
    form.reset();
    document.getElementById('product-stock-input').value = '40';
    document.getElementById('product-threshold-input').value = '10';
    document.getElementById('product-is-available-input').checked = true;
  }

  openModal('product-modal');
}

// ---------------- 4. CATEGORIES MANAGEMENT ----------------
async function loadAdminCategories() {
  const tbody = document.getElementById('admin-categories-tbody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="4" class="text-center" style="padding:20px;">Loading categories...</td></tr>';

  try {
    const res = await apiFetch('/categories');
    categoriesList = res.categories || [];

    if (categoriesList.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted" style="padding:20px;">No categories created.</td></tr>';
      return;
    }

    tbody.innerHTML = categoriesList
      .map((c) => `
        <tr>
          <td><strong>${escapeHtml(c.name)}</strong></td>
          <td>${c.sortOrder}</td>
          <td>${new Date(c.createdAt).toLocaleDateString()}</td>
          <td>
            <button class="btn btn-secondary btn-sm btn-edit-category" data-id="${c._id}" data-name="${escapeHtml(c.name)}" data-order="${c.sortOrder}">Edit</button>
            <button class="btn btn-danger btn-sm btn-delete-category" data-id="${c._id}" data-name="${escapeHtml(c.name)}">Delete</button>
          </td>
        </tr>
      `)
      .join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-danger" style="padding:20px;">${escapeHtml(err.message)}</td></tr>`;
  }
}

// ---------------- 5. CUSTOMERS MANAGEMENT ----------------
async function loadAdminCustomers() {
  const tbody = document.getElementById('admin-customers-tbody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding:24px;">Loading customer accounts...</td></tr>';

  try {
    const searchInput = document.getElementById('customer-search-input');
    const q = searchInput ? searchInput.value.trim() : '';
    const res = await apiFetch(`/admin/customers${q ? `?search=${encodeURIComponent(q)}` : ''}`);
    const customers = res.customers || [];

    if (customers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted" style="padding:32px;">No customers found.</td></tr>';
      return;
    }

    tbody.innerHTML = customers
      .map((c) => `
        <tr>
          <td><strong>${escapeHtml(c.username)}</strong></td>
          <td>${escapeHtml(c.fullName || '—')}</td>
          <td>${escapeHtml(c.email)}</td>
          <td>${escapeHtml(c.phone || '—')}</td>
          <td><strong>${c.orderCount}</strong> (₱${Number(c.totalSpent).toFixed(2)})</td>
          <td>
            <span class="badge ${c.status === 'active' ? 'badge-in-stock' : 'badge-out-stock'}">
              ${c.status.toUpperCase()}
            </span>
          </td>
          <td>
            <div style="display:flex;gap:6px;">
              <button class="btn btn-secondary btn-sm btn-view-customer-orders" data-customer-id="${c._id}">View History</button>
              <button class="btn ${c.status === 'active' ? 'btn-danger' : 'btn-secondary'} btn-sm btn-toggle-customer-status" data-customer-id="${c._id}" data-status="${c.status}">
                ${c.status === 'active' ? 'Suspend' : 'Reactivate'}
              </button>
            </div>
          </td>
        </tr>
      `)
      .join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger" style="padding:24px;">${escapeHtml(err.message)}</td></tr>`;
  }
}

// View customer purchase history drawer
async function openCustomerHistoryModal(customerId) {
  try {
    const res = await apiFetch(`/admin/customers/${customerId}`);
    const { customer, orders } = res;
    const body = document.getElementById('customer-history-body');
    if (!body) return;

    const ordersHtml = orders.length === 0
      ? '<p class="text-muted" style="padding:16px 0;">Customer has not placed any orders yet.</p>'
      : orders
          .map((o) => `
            <div class="step-card" style="margin-bottom:10px;">
              <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                <strong>#${escapeHtml(o.orderNumber)}</strong>
                <span class="badge badge-${o.status}">${o.status}</span>
              </div>
              <div style="font-size:0.8rem;color:var(--color-text-muted);">${new Date(o.createdAt).toLocaleString()} &bull; Total: <strong>₱${o.total.toFixed(2)}</strong></div>
            </div>
          `)
          .join('');

    body.innerHTML = `
      <div style="margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--color-border);">
        <h4 style="font-size:1.1rem;margin-bottom:2px;">${escapeHtml(customer.fullName || customer.username)}</h4>
        <div style="font-size:0.85rem;color:var(--color-text-muted);">${escapeHtml(customer.email)} &bull; ${escapeHtml(customer.phone || 'No phone')}</div>
        <div style="font-size:0.8rem;color:var(--color-text-light);margin-top:2px;">Member since: ${new Date(customer.createdAt).toLocaleDateString()}</div>
      </div>
      <div>
        <h5 style="margin-bottom:10px;">All Orders (${orders.length})</h5>
        ${ordersHtml}
      </div>
    `;

    openModal('customer-history-modal');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ---------------- 6. STORE SETTINGS ----------------
async function loadAdminSettings() {
  try {
    const res = await apiFetch('/admin/settings');
    const s = res.settings;

    // Store Info
    document.getElementById('settings-store-name').value = s.storeName || '';
    document.getElementById('settings-tagline').value = s.tagline || '';
    document.getElementById('settings-address').value = s.address || '';
    document.getElementById('settings-phone').value = s.phone || '';
    document.getElementById('settings-email').value = s.email || '';

    // Switches
    document.getElementById('settings-accepting-orders').checked = Boolean(s.acceptingOrders);
    updateOnlineOrderingSummary(Boolean(s.acceptingOrders), true);
    document.getElementById('settings-delivery-enabled').checked = Boolean(s.deliveryEnabled);
    document.getElementById('settings-pickup-enabled').checked = Boolean(s.pickupEnabled);
    document.getElementById('settings-delivery-fee').value = Number.isFinite(Number(s.deliveryFee))
      ? Number(s.deliveryFee)
      : 30;
    document.getElementById('settings-min-order').value = s.minimumOrder || 0;

    // Payment methods
    document.getElementById('settings-gcash-enabled').checked = Boolean(s.gcashEnabled);
    document.getElementById('settings-cod-enabled').checked = Boolean(s.codEnabled);
    document.getElementById('settings-pay-at-shop-enabled').checked = Boolean(s.payAtShopEnabled);
    document.getElementById('settings-gcash-name').value = s.gcashName || '';
    document.getElementById('settings-gcash-number').value = s.gcashNumber || '';

    // Business Hours
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    days.forEach((day) => {
      const h = (s.businessHours && s.businessHours[day]) || { open: '09:00', close: '21:00', closed: false };
      const openElem = document.getElementById(`hours-${day}-open`);
      const closeElem = document.getElementById(`hours-${day}-close`);
      const closedElem = document.getElementById(`hours-${day}-closed`);
      if (openElem) openElem.value = h.open || '09:00';
      if (closeElem) closeElem.value = h.close || '21:00';
      if (closedElem) closedElem.checked = Boolean(h.closed);
    });

    // Admin Profile Tab
    const profRes = await apiFetch('/admin/profile');
    if (profRes.admin) {
      document.getElementById('admin-profile-username').value = profRes.admin.username;
      document.getElementById('admin-profile-email').value = profRes.admin.email;
      document.getElementById('admin-profile-fullname').value = profRes.admin.fullName || '';
      document.getElementById('admin-profile-phone').value = profRes.admin.phone || '';
    }
  } catch (err) {
    showToast('Failed to load store settings: ' + err.message, 'error');
  }
}

// ---------------- GLOBAL EVENT ATTACHMENTS ----------------
function attachAdminEventListeners() {
  const dashboardRefreshButton = document.getElementById('dashboard-refresh-btn');
  if (dashboardRefreshButton) dashboardRefreshButton.addEventListener('click', loadDashboardStats);

  const openOrdersSection = () => {
    const ordersNavButton = document.querySelector('.admin-nav-item[data-section="orders"]');
    if (ordersNavButton) ordersNavButton.click();
  };
  ['dashboard-view-orders-btn', 'dashboard-view-all-orders-btn'].forEach((id) => {
    const button = document.getElementById(id);
    if (button) button.addEventListener('click', openOrdersSection);
  });

  document.addEventListener('click', (event) => {
    const closeButton = event.target.closest('[data-modal-close]');
    if (closeButton) {
      closeModal(closeButton.getAttribute('data-modal-close'));
    }
  });

  const customerHistoryModal = document.getElementById('customer-history-modal');
  const closeCustomerHistory = () => closeModal('customer-history-modal');
  const closeCustomerHistoryButton = document.getElementById('close-customer-history-modal');
  const customerHistoryCloseButton = document.getElementById('customer-history-close-btn');

  if (closeCustomerHistoryButton) {
    closeCustomerHistoryButton.addEventListener('click', closeCustomerHistory);
  }
  if (customerHistoryCloseButton) {
    customerHistoryCloseButton.addEventListener('click', closeCustomerHistory);
  }
  if (customerHistoryModal) {
    customerHistoryModal.addEventListener('click', (event) => {
      if (event.target === customerHistoryModal) {
        closeCustomerHistory();
      }
    });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && customerHistoryModal && customerHistoryModal.classList.contains('open')) {
      closeCustomerHistory();
    }
  });

  // Sales view toggles (daily, weekly, monthly)
  document.querySelectorAll('.btn-sales-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-sales-toggle').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentSalesView = btn.getAttribute('data-view');
      renderSalesToggleData();
    });
  });

  // Chart range toggle (14 / 30 days)
  document.querySelectorAll('.btn-chart-range').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-chart-range').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentChartDays = parseInt(btn.getAttribute('data-days'), 10);
      renderRevenueBarChart();
    });
  });

  // Orders filters
  const ordersSearch = document.getElementById('orders-search-input');
  if (ordersSearch) {
    let t = null;
    ordersSearch.addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => {
        ordersFilter.search = e.target.value;
        ordersFilter.page = 1;
        loadAdminOrders();
      }, 300);
    });
  }

  const orderStatusFilter = document.getElementById('orders-status-filter');
  if (orderStatusFilter) {
    orderStatusFilter.addEventListener('change', (e) => {
      ordersFilter.status = e.target.value;
      ordersFilter.page = 1;
      loadAdminOrders();
    });
  }

  const orderPaymentFilter = document.getElementById('orders-payment-filter');
  if (orderPaymentFilter) {
    orderPaymentFilter.addEventListener('change', (e) => {
      ordersFilter.paymentStatus = e.target.value;
      ordersFilter.page = 1;
      loadAdminOrders();
    });
  }

  const orderDateFilter = document.getElementById('orders-date-filter');
  if (orderDateFilter) {
    orderDateFilter.addEventListener('change', (e) => {
      ordersFilter.dateRange = e.target.value;
      ordersFilter.page = 1;
      loadAdminOrders();
    });
  }

  const menuSearch = document.getElementById('admin-menu-search');
  if (menuSearch) {
    let t = null;
    menuSearch.addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => {
        menuSearchQuery = e.target.value;
        loadAdminMenu();
      }, 300);
    });
  }

  const menuStockFilterInput = document.getElementById('admin-menu-stock-filter');
  if (menuStockFilterInput) {
    menuStockFilterInput.addEventListener('change', (e) => {
      menuStockFilter = e.target.value;
      loadAdminMenu();
    });
  }

  const customerSearch = document.getElementById('customer-search-input');
  if (customerSearch) {
    let t = null;
    customerSearch.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => loadAdminCustomers(), 300);
    });
  }

  // Orders pagination
  const prevPageBtn = document.getElementById('orders-prev-page');
  const nextPageBtn = document.getElementById('orders-next-page');
  if (prevPageBtn) {
    prevPageBtn.addEventListener('click', () => {
      if (ordersFilter.page > 1) {
        ordersFilter.page--;
        loadAdminOrders();
      }
    });
  }
  if (nextPageBtn) {
    nextPageBtn.addEventListener('click', () => {
      ordersFilter.page++;
      loadAdminOrders();
    });
  }

  // Open Drawer delegation
  document.addEventListener('click', async (e) => {
    const openDrawerBtn = e.target.closest('.btn-open-order-drawer');
    if (openDrawerBtn) {
      const orderId = openDrawerBtn.getAttribute('data-order-id');
      openOrderDrawer(orderId);
      return;
    }

    // Action: update order status from drawer
    const statusActionBtn = e.target.closest('.btn-action-status');
    if (statusActionBtn) {
      const orderId = statusActionBtn.getAttribute('data-order-id');
      const status = statusActionBtn.getAttribute('data-status');
      statusActionBtn.disabled = true;
      try {
        await apiFetch(`/admin/orders/${orderId}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status }),
        });
        showToast(`Order status updated to ${statusLabel(status).toLowerCase()}`, 'success');
        closeModal('order-drawer-modal');
        loadAdminOrders();
        loadDashboardStats();
      } catch (err) {
        showToast(err.message, 'error');
        statusActionBtn.disabled = false;
        loadAdminOrders();
      }
      return;
    }

    // Action: mark order as paid from drawer
    const paidActionBtn = e.target.closest('.btn-action-paid');
    if (paidActionBtn) {
      const orderId = paidActionBtn.getAttribute('data-order-id');
      try {
        await apiFetch(`/admin/orders/${orderId}/paid`, { method: 'PATCH' });
        showToast('Order marked as paid', 'success');
        closeModal('order-drawer-modal');
        loadAdminOrders();
      } catch (err) {
        showToast(err.message, 'error');
      }
      return;
    }

    // Menu Actions delegation
    const editProdBtn = e.target.closest('.btn-edit-product');
    if (editProdBtn) {
      openProductModal(editProdBtn.getAttribute('data-product-id'));
      return;
    }

    const restockBtn = e.target.closest('.btn-restock-product');
    if (restockBtn) {
      const pid = restockBtn.getAttribute('data-product-id');
      const curStock = restockBtn.getAttribute('data-current-stock');
      openRestockModal(pid, curStock);
      return;
    }

    const toggleAvailBtn = e.target.closest('.btn-toggle-availability');
    if (toggleAvailBtn) {
      const pid = toggleAvailBtn.getAttribute('data-product-id');
      toggleAvailBtn.disabled = true;
      try {
        const res = await apiFetch(`/admin/products/${pid}/availability`, { method: 'PATCH' });
        await loadAdminMenu();
        showToast(`${res.product.name} ${res.product.isAvailable ? 'enabled' : 'disabled'} for ordering`, 'success');
      } catch (err) {
        showToast(err.message, 'error');
        toggleAvailBtn.disabled = false;
      }
      return;
    }

    const deleteProdBtn = e.target.closest('.btn-delete-product');
    if (deleteProdBtn) {
      const pid = deleteProdBtn.getAttribute('data-product-id');
      const name = deleteProdBtn.getAttribute('data-name');
      if (confirm(`Permanently delete "${name}"? It will also be removed from any active user carts.`)) {
        try {
          await apiFetch(`/admin/products/${pid}`, { method: 'DELETE' });
          showToast(`"${name}" was deleted permanently.`, 'info');
          loadAdminMenu();
        } catch (err) {
          showToast(err.message, 'error');
        }
      }
      return;
    }

    // Customer actions delegation
    const viewCustBtn = e.target.closest('.btn-view-customer-orders');
    if (viewCustBtn) {
      openCustomerHistoryModal(viewCustBtn.getAttribute('data-customer-id'));
      return;
    }

    const toggleCustStatusBtn = e.target.closest('.btn-toggle-customer-status');
    if (toggleCustStatusBtn) {
      const cid = toggleCustStatusBtn.getAttribute('data-customer-id');
      const cur = toggleCustStatusBtn.getAttribute('data-status');
      const nextStatus = cur === 'active' ? 'suspended' : 'active';
      try {
        await apiFetch(`/admin/customers/${cid}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: nextStatus }),
        });
        showToast(`Customer account is now ${nextStatus}`, 'info');
        loadAdminCustomers();
      } catch (err) {
        showToast(err.message, 'error');
      }
      return;
    }

    // Category actions delegation
    const editCatBtn = e.target.closest('.btn-edit-category');
    if (editCatBtn) {
      editingCategoryId = editCatBtn.getAttribute('data-id');
      document.getElementById('category-modal-title').textContent = 'Edit Category';
      document.getElementById('category-name-input').value = editCatBtn.getAttribute('data-name');
      document.getElementById('category-order-input').value = editCatBtn.getAttribute('data-order');
      openModal('category-modal');
      return;
    }

    const deleteCatBtn = e.target.closest('.btn-delete-category');
    if (deleteCatBtn) {
      const cid = deleteCatBtn.getAttribute('data-id');
      const cname = deleteCatBtn.getAttribute('data-name');
      if (confirm(`Delete category "${cname}"?`)) {
        try {
          await apiFetch(`/admin/categories/${cid}`, { method: 'DELETE' });
          showToast('Category deleted', 'info');
          loadAdminCategories();
        } catch (err) {
          showToast(err.message, 'error');
        }
      }
      return;
    }
  });

  // Product Form Submission
  const productForm = document.getElementById('product-form');
  if (productForm) {
    productForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('save-product-btn');
      submitBtn.disabled = true;

      try {
        const name = document.getElementById('product-name-input').value.trim();
        const price = parseFloat(document.getElementById('product-price-input').value);
        const description = document.getElementById('product-description-input').value.trim();
        const stock = parseInt(document.getElementById('product-stock-input').value, 10);
        const lowStockThreshold = parseInt(document.getElementById('product-threshold-input').value, 10);
        const category = document.getElementById('product-category-input').value;
        const isAddon = document.getElementById('product-is-addon-input').checked;
        const isAvailable = document.getElementById('product-is-available-input').checked;
        const isFeatured = document.getElementById('product-is-featured-input').checked;

        // Image file upload
        let image = '';
        const imgFileInput = document.getElementById('product-image-file');
        if (imgFileInput && imgFileInput.files[0]) {
          image = await resizeImageToDataUrl(imgFileInput.files[0], 600, 0.8);
        }

        const payload = {
          name,
          price,
          description,
          stock,
          lowStockThreshold,
          category,
          isAddon,
          isAvailable,
          isFeatured,
        };
        if (image) payload.image = image;

        if (editingProductId) {
          await apiFetch(`/admin/products/${editingProductId}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          });
          showToast('Product updated successfully', 'success');
        } else {
          await apiFetch('/admin/products', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          showToast('Product created successfully', 'success');
        }

        closeModal('product-modal');
        loadAdminMenu();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  // Restock modal handling
  let restockProductId = null;
  function openRestockModal(pid, currentStock) {
    restockProductId = pid;
    document.getElementById('restock-current-stock').textContent = currentStock;
    document.getElementById('restock-amount-input').value = '10';
    openModal('restock-modal');
  }

  document.querySelectorAll('.btn-quick-add-stock').forEach((btn) => {
    btn.addEventListener('click', () => {
      const amt = btn.getAttribute('data-amount');
      document.getElementById('restock-amount-input').value = amt;
    });
  });

  const confirmRestockBtn = document.getElementById('confirm-restock-btn');
  if (confirmRestockBtn) {
    confirmRestockBtn.addEventListener('click', async () => {
      const mode = document.querySelector('input[name="restock_mode"]:checked').value;
      const amount = parseInt(document.getElementById('restock-amount-input').value, 10);

      try {
        await apiFetch(`/admin/products/${restockProductId}/stock`, {
          method: 'PATCH',
          body: JSON.stringify({ mode, amount }),
        });
        showToast('Stock updated successfully', 'success');
        closeModal('restock-modal');
        loadAdminMenu();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Category Form Submission
  const categoryForm = document.getElementById('category-form');
  if (categoryForm) {
    categoryForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('category-name-input').value.trim();
      const sortOrder = parseInt(document.getElementById('category-order-input').value, 10) || 0;

      try {
        if (editingCategoryId) {
          await apiFetch(`/admin/categories/${editingCategoryId}`, {
            method: 'PUT',
            body: JSON.stringify({ name, sortOrder }),
          });
          showToast('Category updated', 'success');
        } else {
          await apiFetch('/admin/categories', {
            method: 'POST',
            body: JSON.stringify({ name, sortOrder }),
          });
          showToast('Category created', 'success');
        }
        closeModal('category-modal');
        loadAdminCategories();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Store Settings Form Submission
  const settingsForm = document.getElementById('store-settings-form');
  if (settingsForm) {
    const onlineOrderingToggle = document.getElementById('settings-accepting-orders');
    if (onlineOrderingToggle) {
      onlineOrderingToggle.addEventListener('change', () => {
        updateOnlineOrderingSummary(onlineOrderingToggle.checked);
      });
    }

    settingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      const businessHours = {};
      days.forEach((day) => {
        businessHours[day] = {
          open: document.getElementById(`hours-${day}-open`).value,
          close: document.getElementById(`hours-${day}-close`).value,
          closed: document.getElementById(`hours-${day}-closed`).checked,
        };
      });

      const payload = {
        storeName: document.getElementById('settings-store-name').value.trim(),
        tagline: document.getElementById('settings-tagline').value.trim(),
        address: document.getElementById('settings-address').value.trim(),
        phone: document.getElementById('settings-phone').value.trim(),
        email: document.getElementById('settings-email').value.trim(),
        acceptingOrders: document.getElementById('settings-accepting-orders').checked,
        deliveryEnabled: document.getElementById('settings-delivery-enabled').checked,
        pickupEnabled: document.getElementById('settings-pickup-enabled').checked,
        deliveryFee: parseFloat(document.getElementById('settings-delivery-fee').value) || 0,
        minimumOrder: parseFloat(document.getElementById('settings-min-order').value) || 0,
        gcashEnabled: document.getElementById('settings-gcash-enabled').checked,
        codEnabled: document.getElementById('settings-cod-enabled').checked,
        payAtShopEnabled: document.getElementById('settings-pay-at-shop-enabled').checked,
        gcashName: document.getElementById('settings-gcash-name').value.trim(),
        gcashNumber: document.getElementById('settings-gcash-number').value.trim(),
        businessHours,
      };

      try {
        await apiFetch('/admin/settings', {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        updateOnlineOrderingSummary(payload.acceptingOrders, true);
        showToast('Store settings saved successfully!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Admin Profile Update
  const adminProfileForm = document.getElementById('admin-profile-form');
  if (adminProfileForm) {
    adminProfileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('admin-profile-username').value.trim();
      const email = document.getElementById('admin-profile-email').value.trim();
      const fullName = document.getElementById('admin-profile-fullname').value.trim();
      const phone = document.getElementById('admin-profile-phone').value.trim();

      try {
        await apiFetch('/admin/profile', {
          method: 'PATCH',
          body: JSON.stringify({ username, email, fullName, phone }),
        });
        showToast('Admin profile updated', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Admin Password Update
  const adminPasswordForm = document.getElementById('admin-password-form');
  if (adminPasswordForm) {
    adminPasswordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPassword = document.getElementById('admin-current-pass').value;
      const newPassword = document.getElementById('admin-new-pass').value;
      const confirmPassword = document.getElementById('admin-confirm-pass').value;

      try {
        await apiFetch('/admin/password', {
          method: 'PATCH',
          body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
        });
        showToast('Admin password changed successfully!', 'success');
        adminPasswordForm.reset();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Add Item / Add Category modal buttons
  const addProductBtn = document.getElementById('btn-add-product');
  if (addProductBtn) addProductBtn.addEventListener('click', () => openProductModal());

  const addCategoryBtn = document.getElementById('btn-add-category');
  if (addCategoryBtn) {
    addCategoryBtn.addEventListener('click', () => {
      editingCategoryId = null;
      document.getElementById('category-modal-title').textContent = 'Add Category';
      document.getElementById('category-form').reset();
      openModal('category-modal');
    });
  }
}

// ---------------- INITIALIZE ADMIN ----------------
function initAdmin() {
  if (!requireAuth('admin')) return;
  const adminUser = getUser();
  const greetingName = document.getElementById('admin-greeting-name');
  if (greetingName && adminUser) {
    greetingName.textContent = adminUser.fullName || adminUser.username || 'Admin';
  }
  setupBackToTop();
  setupAdminNavigation();
  attachAdminEventListeners();
  loadDashboardStats();

  // 10-second polling for orders when on orders tab or dashboard
  setInterval(() => {
    if (activeSection === 'orders') {
      loadAdminOrders();
    } else if (activeSection === 'dashboard') {
      loadDashboardStats();
    }
  }, 10000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdmin);
} else {
  initAdmin();
}
