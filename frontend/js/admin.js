// Admin Dashboard & Operations Controller
import { apiFetch, apiFetchBlob } from './api.js';
import {
  showToast,
  escapeHtml,
  openModal,
  closeModal,
  getProductImageUrl,
  setupBackToTop,
} from './ui.js';
import { requireAuth, getUser, resizeImageToDataUrl } from './auth.js';
import {
  initAdminNotifications,
  markAdminNotificationReadByOrderId,
} from './notifications.js';
import { lucideIcon, renderRatingBadge, renderRatingStars } from './icons.js';

let activeSection = 'dashboard';
let dashboardStats = null;
let currentSalesView = 'daily'; // 'daily' | 'weekly' | 'monthly'
let currentChartDays = 14;
let dashboardRefreshPending = false;
let dashboardRecentOrdersPage = 1;
let dashboardRecentOrdersTotalPages = 1;
let dashboardRecentOrdersStatus = 'all';
let dashboardRecentOrdersRequestId = 0;
let dashboardRecentOrdersErrorNotified = false;
let activeGcashProofPreviewUrl = null;
let opsCharts = null;

let adminReviewsSearchQuery = '';
let adminReviewsRatingFilter = 'all';

const ADMIN_CHART_COLORS = {
  completed: '#16a34a',
  cancelled: '#ef4444',
  pending: '#3b82f6',
  grid: '#e5e7eb',
  tick: '#64748b',
};

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

function renderOpsDashboard(stats) {
  const chartError = document.getElementById('ops-chart-error');
  const canvases = [
    document.getElementById('ops-income-chart'),
    document.getElementById('ops-revenue-chart'),
    document.getElementById('ops-traffic-chart'),
  ];
  if (canvases.some((canvas) => !canvas)) return;
  if (!window.Chart) {
    chartError?.classList.remove('hidden');
    if (chartError) chartError.textContent = 'Chart.js could not load. Check your connection and refresh the page.';
    return;
  }

  if (chartError) {
    chartError.classList.add('hidden');
    chartError.textContent =
      'Live dashboard chart data is unavailable. Refresh to try again.';
  }

  if (!Array.isArray(stats.revenueHistory)) {
    if (chartError) {
      chartError.textContent =
        'Live chart history was not included in the dashboard response.';
      chartError.classList.remove('hidden');
    }
    return;
  }

  const historyByDate = new Map(
    stats.revenueHistory.map((entry) => [entry._id, entry])
  );
  const today = new Date(`${getStoreDateKey(new Date())}T00:00:00Z`);
  today.setUTCDate(today.getUTCDate() - 29);
  const history = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    return historyByDate.get(key) || { _id: key, revenue: 0, orders: 0 };
  });
  const labels = history.map((entry) =>
    new Date(`${entry._id}T00:00:00+08:00`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: 'Asia/Manila',
    })
  );
  const dailyRevenue = history.map((entry) => Number(entry.revenue) || 0);
  const dailyOrders = history.map((entry) => Number(entry.orders) || 0);
  const cumulativeRevenue = dailyRevenue.reduce((values, value, index) => {
    values.push(value + (values[index - 1] || 0));
    return values;
  }, []);
  if (!opsCharts) {
    initializeOpsCharts(canvases);
  }
  if (!opsCharts) return;

  const chartTheme = getAdminChartTheme();
  const revenueScale = (maximum) => ({
    beginAtZero: true,
    suggestedMax: maximum || undefined,
    grid: { color: chartTheme.grid },
    border: { display: false },
    ticks: {
      color: chartTheme.tick,
      maxTicksLimit: 5,
      callback: (value) => formatPeso(value),
    },
  });
  const countScale = {
    beginAtZero: true,
    grid: { color: chartTheme.grid },
    border: { display: false },
    ticks: {
      color: chartTheme.tick,
      precision: 0,
      maxTicksLimit: 5,
    },
  };

  const chartSeries = [
    {
      labels,
      data: dailyRevenue,
      label: 'Daily completed revenue',
      y: revenueScale(Math.max(...dailyRevenue)),
    },
    {
      labels,
      data: cumulativeRevenue,
      label: 'Cumulative completed revenue (last 30 days)',
      y: revenueScale(Math.max(...cumulativeRevenue)),
    },
    {
      labels,
      data: dailyOrders,
      label: 'Completed orders per day',
      y: countScale,
    },
  ];
  opsCharts.forEach((chart, index) => {
    chart.data.labels = chartSeries[index].labels;
    chart.data.datasets[0].data = chartSeries[index].data;
    chart.data.datasets[0].label = chartSeries[index].label;
    chart.options.scales.y = chartSeries[index].y;
    chart.options.scales.x.ticks.color = chartTheme.tick;
    chart.data.datasets[0].borderColor = ADMIN_CHART_COLORS.completed;
    chart.data.datasets[0].backgroundColor =
      index === 0
        ? ADMIN_CHART_COLORS.completed
        : index === 1
          ? ADMIN_CHART_COLORS.completed
          : `rgba(22, 163, 74, ${chartTheme.fillOpacity})`;
    chart.update('none');
  });
}

function getAdminChartTheme() {
  const isDark = document.body.classList.contains('theme-dark');
  return {
    grid: isDark ? '#374151' : ADMIN_CHART_COLORS.grid,
    tick: isDark ? '#cbd5e1' : ADMIN_CHART_COLORS.tick,
    tooltip: isDark ? '#1f2937' : '#ffffff',
    fillOpacity: isDark ? 0.2 : 0.12,
  };
}

function updateOpsChartTheme() {
  if (!opsCharts) return;
  const theme = getAdminChartTheme();

  opsCharts.forEach((chart, index) => {
    chart.options.scales.x.ticks.color = theme.tick;
    chart.options.scales.y.grid.color = theme.grid;
    chart.options.scales.y.ticks.color = theme.tick;
    chart.options.plugins.tooltip.backgroundColor = theme.tooltip;
    chart.options.plugins.tooltip.titleColor = theme.tick;
    chart.options.plugins.tooltip.bodyColor = theme.tick;
    chart.data.datasets[0].borderColor = ADMIN_CHART_COLORS.completed;
    chart.data.datasets[0].backgroundColor =
      index === 0
        ? ADMIN_CHART_COLORS.completed
        : index === 1
          ? ADMIN_CHART_COLORS.completed
          : `rgba(22, 163, 74, ${theme.fillOpacity})`;
    if (index === 1) {
      chart.data.datasets[0].pointBorderColor = ADMIN_CHART_COLORS.completed;
      chart.data.datasets[0].pointBackgroundColor = theme.tick;
    }
    chart.update('none');
  });
}

function initializeOpsCharts(canvases) {
  const chartError = document.getElementById('ops-chart-error');
  if (!window.Chart) {
    chartError?.classList.remove('hidden');
    if (chartError) chartError.textContent = 'Chart.js could not load. Check your connection and refresh the page.';
    return;
  }
  const chartTheme = getAdminChartTheme();
  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: chartTheme.tooltip,
        titleColor: chartTheme.tick,
        bodyColor: chartTheme.tick,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: chartTheme.tick,
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 8,
        },
      },
      y: { beginAtZero: true },
    },
  };

  try {
    opsCharts = [
      new window.Chart(canvases[0], {
      type: 'bar',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Daily completed revenue',
            data: [],
            backgroundColor: ADMIN_CHART_COLORS.completed,
            borderRadius: { topLeft: 4, topRight: 4 },
            borderSkipped: 'bottom',
          },
        ],
      },
      options: commonOptions,
      }),

      new window.Chart(canvases[1], {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Cumulative completed revenue (last 30 days)',
            data: [],
            borderColor: ADMIN_CHART_COLORS.completed,
            backgroundColor: ADMIN_CHART_COLORS.completed,
            pointBackgroundColor: chartTheme.tick,
            pointBorderColor: ADMIN_CHART_COLORS.completed,
            pointBorderWidth: 2,
            pointRadius: 3,
            tension: 0.4,
            fill: false,
          },
        ],
      },
      options: commonOptions,
      }),

      new window.Chart(canvases[2], {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Completed orders per day',
            data: [],
            borderColor: ADMIN_CHART_COLORS.completed,
            backgroundColor: `rgba(22, 163, 74, ${chartTheme.fillOpacity})`,
            pointRadius: 0,
            tension: 0.4,
            fill: true,
          },
        ],
      },
      options: commonOptions,
      plugins: [
        {
          id: 'trafficGradientFills',
          beforeDatasetsDraw(chart) {
            const { ctx, chartArea } = chart;
            if (!chartArea) return;
            chart.data.datasets.forEach((dataset, index) => {
              const gradient = ctx.createLinearGradient(
                0,
                chartArea.top,
                0,
                chartArea.bottom
              );
              const color = index === 0 ? '22, 163, 74' : '59, 130, 246';
              gradient.addColorStop(0, `rgba(${color}, 0.24)`);
              gradient.addColorStop(1, `rgba(${color}, 0)`);
              dataset.backgroundColor = gradient;
            });
          },
        },
      ],
      }),
    ];
    updateOpsChartTheme();
  } catch (error) {
    opsCharts?.forEach((chart) => chart.destroy());
    opsCharts = null;
    chartError?.classList.remove('hidden');
    if (chartError) {
      chartError.textContent =
        'Dashboard charts could not be initialized. Refresh to try again.';
    }
    console.error('Dashboard charts failed to initialize:', error);
  }
}

// ---------------- Initialization & Navigation ----------------
function setupAdminNavigation() {
  const navItems = document.querySelectorAll(
    'button.admin-nav-item[data-section]'
  );
  navItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      navItems.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeSection = btn.getAttribute('data-section');

      document
        .querySelectorAll('.admin-section')
        .forEach((sec) => sec.classList.add('hidden'));
      const targetSec = document.getElementById(`section-${activeSection}`);
      if (targetSec) targetSec.classList.remove('hidden');

      // Close mobile sidebar if open
      const sidebar = document.getElementById('admin-sidebar');
      const backdrop = document.getElementById('admin-sidebar-backdrop');
      if (sidebar) sidebar.classList.remove('open-mobile');
      if (backdrop) backdrop.classList.add('hidden');
      updateSidebarToggleState();

      // Refresh target section
      switch (activeSection) {
        case 'dashboard':
          loadDashboardStats();
          break;
        case 'all-reviews':
          loadAdminReviews();
          break;
        case 'top-favorites':
          loadAdminTopFavorites();
          break;
        case 'orders':
          loadAdminOrders();
          break;
        case 'recent-orders':
          loadDashboardRecentOrders();
          break;
        case 'top-items':
          loadDashboardStats();
          break;
        case 'menu':
          loadAdminMenu();
          break;
        case 'categories':
          loadAdminCategories();
          break;
        case 'customers':
          loadAdminCustomers();
          break;
        case 'settings':
          loadAdminSettings();
          break;
        case 'security':
          break;
      }
    });
  });

  const toggleSidebarBtn = document.getElementById('admin-toggle-sidebar-btn');
  const sidebar = document.getElementById('admin-sidebar');
  const backdrop = document.getElementById('admin-sidebar-backdrop');
  if (toggleSidebarBtn && sidebar) {
    toggleSidebarBtn.addEventListener('click', () => {
      const adminLayout = document.querySelector('.admin-layout');
      if (window.matchMedia('(max-width: 900px)').matches) {
        sidebar.classList.toggle('open-mobile');
        if (backdrop) {
          backdrop.classList.toggle(
            'hidden',
            !sidebar.classList.contains('open-mobile')
          );
        }
      } else if (adminLayout) {
        adminLayout.classList.toggle('is-sidebar-collapsed');
      }
      updateSidebarToggleState();
    });
  }

  if (backdrop && sidebar) {
    backdrop.addEventListener('click', () => {
      sidebar.classList.remove('open-mobile');
      backdrop.classList.add('hidden');
      updateSidebarToggleState();
    });
  }

  document.addEventListener('keydown', (event) => {
    if (
      event.key === 'Escape' &&
      sidebar &&
      sidebar.classList.contains('open-mobile')
    ) {
      sidebar.classList.remove('open-mobile');
      if (backdrop) backdrop.classList.add('hidden');
      updateSidebarToggleState();
      toggleSidebarBtn?.focus();
    }
  });

  window.addEventListener('resize', updateSidebarToggleState);
  updateSidebarToggleState();
}

function updateSidebarToggleState() {
  const toggleButton = document.getElementById('admin-toggle-sidebar-btn');
  const sidebar = document.getElementById('admin-sidebar');
  const adminLayout = document.querySelector('.admin-layout');
  const backdrop = document.getElementById('admin-sidebar-backdrop');
  if (!toggleButton || !sidebar || !adminLayout) return;

  const header = document.querySelector('.admin-site-header');
  if (header) {
    document.documentElement.style.setProperty(
      '--admin-header-height',
      `${header.getBoundingClientRect().height}px`
    );
  }

  const isMobile = window.matchMedia('(max-width: 900px)').matches;
  if (!isMobile) {
    sidebar.classList.remove('open-mobile');
    if (backdrop) backdrop.classList.add('hidden');
  } else if (backdrop) {
    backdrop.classList.toggle(
      'hidden',
      !sidebar.classList.contains('open-mobile')
    );
  }

  const isExpanded = isMobile
    ? sidebar.classList.contains('open-mobile')
    : !adminLayout.classList.contains('is-sidebar-collapsed');
  const actionLabel = isExpanded ? 'Collapse navigation' : 'Expand navigation';
  toggleButton.setAttribute('aria-expanded', String(isExpanded));
  toggleButton.setAttribute(
    'aria-label',
    isMobile
      ? `${isExpanded ? 'Close' : 'Open'} navigation drawer`
      : actionLabel
  );
  toggleButton.title = isMobile
    ? `${isExpanded ? 'Close' : 'Open'} navigation drawer`
    : actionLabel;
}

// ---------------- 1. DASHBOARD & CHARTS ----------------
async function loadDashboardStats() {
  if (dashboardRefreshPending) return;
  dashboardRefreshPending = true;
  const recentOrdersList = document.getElementById('recent-orders-list');
  if (recentOrdersList) recentOrdersList.setAttribute('aria-busy', 'true');
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
    document.getElementById('stat-total-revenue').textContent = formatPeso(
      dashboardStats.totalRevenue
    );
    document.getElementById('stat-total-orders').textContent = String(
      dashboardStats.totalOrders
    );
    document.getElementById('stat-pending-orders').textContent = String(
      dashboardStats.pendingOrders
    );
    updatePendingOrderBadge(dashboardStats.pendingOrders);
    document.getElementById('stat-completed-orders').textContent = String(
      dashboardStats.completedOrders
    );
    document.getElementById('stat-cancelled-orders').textContent = String(
      dashboardStats.cancelledOrders
    );
    document.getElementById('stat-total-customers').textContent = String(
      dashboardStats.totalCustomers
    );
    renderOpsDashboard(dashboardStats);

    const updatedAt = document.getElementById('dashboard-last-updated');
    if (updatedAt) {
      updatedAt.textContent = `Updated ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date())}`;
    }
    renderSalesToggleData();
    renderRevenueBarChart();
    renderStatusDonutChart();
    renderTopItems();
  } catch (err) {
    const chartError = document.getElementById('ops-chart-error');
    if (chartError) {
      chartError.textContent =
        'Live dashboard data could not be loaded. Refresh to try again.';
      chartError.classList.remove('hidden');
    }
    if (recentOrdersList) {
      recentOrdersList.setAttribute('aria-busy', 'false');
      recentOrdersList.innerHTML =
        '<p class="text-muted">Dashboard data is unavailable. Refresh to try again.</p>';
    }
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

  const pendingCount = Number.isFinite(Number(count))
    ? Math.max(0, Number(count))
    : 0;
  pendingBadge.textContent = String(pendingCount);
  pendingBadge.classList.toggle('hidden', pendingCount === 0);
  const ordersButton = pendingBadge.closest('.admin-nav-item');
  if (ordersButton) {
    ordersButton.setAttribute(
      'aria-label',
      pendingCount === 1
        ? 'Orders Management, 1 order awaiting acceptance'
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

function formatTableDate(value) {
  return new Intl.DateTimeFormat('en-PH', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(new Date(value));
}

// ---------------- Admin Customer Reviews ----------------
async function loadAdminReviews() {
  const tbody = document.getElementById('admin-reviews-tbody');
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="6" class="text-center text-muted" style="padding:32px;">
        <span style="display:inline-flex;align-items:center;gap:8px;">
          ${lucideIcon('loader-2', { size: 18, className: 'spin' })}
          <span>Loading reviews...</span>
        </span>
      </td>
    </tr>
  `;

  try {
    const params = new URLSearchParams();
    if (adminReviewsSearchQuery) params.set('search', adminReviewsSearchQuery);
    if (adminReviewsRatingFilter && adminReviewsRatingFilter !== 'all') {
      params.set('rating', adminReviewsRatingFilter);
    }

    const queryString = params.toString() ? `?${params.toString()}` : '';
    const res = await apiFetch(`/reviews/admin/all${queryString}`);
    const reviews = res.reviews || [];

    if (!reviews.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center text-muted" style="padding:32px;">
            No reviews found matching your filter.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = reviews
      .map((r) => {
        const dateStr = new Date(r.createdAt).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
        const rating = Number(r.rating || 0);
        const comment = r.comment || '';
        const isLongComment = comment.length > 80;
        const shortComment = isLongComment ? comment.slice(0, 80) + '...' : comment;

        return `
          <tr data-admin-review-id="${r.id}">
            <td style="font-weight:600;">
              <div style="display:flex;align-items:center;gap:8px;">
                ${r.itemImage ? `<img src="${escapeHtml(r.itemImage)}" alt="" style="width:30px;height:30px;border-radius:4px;object-fit:cover;" onerror="this.style.display='none'" />` : ''}
                <span>${escapeHtml(r.itemName || 'Item')}</span>
              </div>
            </td>
            <td>${escapeHtml(r.customerName || 'Customer')}</td>
            <td>
              <div class="admin-review-stars-wrap" style="display:inline-flex;align-items:center;gap:3px;" title="${rating} out of 5 stars">
                ${renderRatingStars(rating, { size: 16 })}
                <span style="font-size:0.8rem;font-weight:600;margin-left:4px;color:var(--color-text-muted);">${rating.toFixed(1)}</span>
              </div>
            </td>
            <td class="admin-review-text-cell">
              ${comment ? `
                <span class="review-text-short">${escapeHtml(shortComment)}</span>
                ${isLongComment ? `
                  <button type="button" class="btn-text-sm btn-expand-admin-review" data-full-text="${escapeHtml(comment)}" style="font-size:0.75rem;margin-left:4px;color:var(--color-primary);text-decoration:underline;">See more</button>
                ` : ''}
              ` : '<span class="text-muted italic" style="font-size:0.8rem;">(No comment)</span>'}
            </td>
            <td style="font-size:0.85rem;color:var(--color-text-muted);">${escapeHtml(dateStr)}</td>
            <td style="text-align:right;">
              <button
                type="button"
                class="btn btn-secondary btn-sm btn-admin-delete-review"
                data-review-id="${r.id}"
                data-item-name="${escapeHtml(r.itemName || '')}"
                title="Delete review"
                aria-label="Delete review"
                style="color:var(--color-danger,#DC2626);"
              >
                ${lucideIcon('trash-2', { size: 15 })}
                <span class="btn-label">Delete</span>
              </button>
            </td>
          </tr>
        `;
      })
      .join('');

    // Attach expandable review text handler
    tbody.querySelectorAll('.btn-expand-admin-review').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cell = btn.closest('.admin-review-text-cell');
        const full = btn.getAttribute('data-full-text');
        if (cell) {
          cell.innerHTML = `<span>${escapeHtml(full)}</span>`;
        }
      });
    });

    // Attach inline delete confirmation
    tbody.querySelectorAll('.btn-admin-delete-review').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const reviewId = btn.getAttribute('data-review-id');
        const isConfirming = btn.getAttribute('data-confirming') === 'true';

        if (!isConfirming) {
          btn.setAttribute('data-confirming', 'true');
          btn.classList.add('btn-danger');
          btn.innerHTML = `
            ${lucideIcon('alert-circle', { size: 14 })}
            <span>Confirm?</span>
          `;
          setTimeout(() => {
            if (btn.getAttribute('data-confirming') === 'true') {
              btn.removeAttribute('data-confirming');
              btn.classList.remove('btn-danger');
              btn.innerHTML = `
                ${lucideIcon('trash-2', { size: 15 })}
                <span class="btn-label">Delete</span>
              `;
            }
          }, 3500);
          return;
        }

        btn.removeAttribute('data-confirming');
        btn.disabled = true;
        btn.innerHTML = `
          ${lucideIcon('loader-2', { size: 14, className: 'spin' })}
          <span>Removing...</span>
        `;

        try {
          await apiFetch(`/reviews/${reviewId}`, { method: 'DELETE' });
          showToast('Review removed.', 'success');
          const row = tbody.querySelector(`tr[data-admin-review-id="${reviewId}"]`);
          if (row) {
            row.style.opacity = '0';
            setTimeout(() => {
              row.remove();
              if (!tbody.querySelectorAll('tr[data-admin-review-id]').length) {
                loadAdminReviews();
              }
            }, 200);
          }
        } catch (err) {
          showToast(err.message || 'Could not remove review.', 'error');
          btn.disabled = false;
          btn.innerHTML = `
            ${lucideIcon('trash-2', { size: 15 })}
            <span class="btn-label">Delete</span>
          `;
          btn.classList.remove('btn-danger');
        }
      });
    });
  } catch (err) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center text-danger" style="padding:24px;">
          Failed to load reviews: ${escapeHtml(err.message)}
        </td>
      </tr>
    `;
  }
}

// ---------------- Admin Top Favorites Rankings ----------------
async function loadAdminTopFavorites() {
  const container = document.getElementById('admin-favorites-rankings-container');
  if (!container) return;

  container.innerHTML = `
    <div style="padding:32px;display:flex;align-items:center;justify-content:center;gap:8px;color:var(--color-text-muted);">
      ${lucideIcon('loader-2', { size: 20, className: 'spin' })}
      <span>Loading top favorited items...</span>
    </div>
  `;

  try {
    const res = await apiFetch('/favorites/rankings');
    const rankings = res.rankings || [];

    if (!rankings.length) {
      container.innerHTML = `
        <div class="state-box">
          <div class="state-icon-wrap" style="color:var(--color-primary);margin-bottom:12px;">
            ${lucideIcon('heart', { size: 48, stroke: '#9CA3AF', fill: 'none' })}
          </div>
          <h4 class="state-title">No favorites data yet.</h4>
          <p class="state-desc">When customers save items to their favorites, they will appear ranked here.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="admin-rankings-grid">
        ${rankings
          .map((item, index) => {
            const rank = index + 1;
            let rankClass = '';
            let rankBadge = '';

            if (rank === 1) {
              rankClass = 'rank-highlight rank-gold';
              rankBadge = '<span class="rank-badge rank-badge-gold">🥇 Rank #1</span>';
            } else if (rank === 2) {
              rankClass = 'rank-highlight rank-silver';
              rankBadge = '<span class="rank-badge rank-badge-silver">🥈 Rank #2</span>';
            } else if (rank === 3) {
              rankClass = 'rank-highlight rank-bronze';
              rankBadge = '<span class="rank-badge rank-badge-bronze">🥉 Rank #3</span>';
            } else {
              rankBadge = `<span class="rank-badge rank-badge-regular">#${rank}</span>`;
            }

            const img = item.image || 'assets/placeholder-burger.png';
            const favCount = Number(item.favoriteCount || 0);
            const avgRating = Number(item.averageRating || 0);
            const revCount = Number(item.reviewCount || 0);
            const price = Number(item.price || 0).toFixed(2);

            return `
              <article class="admin-ranking-card ${rankClass}">
                <div class="ranking-card-left">
                  <div class="ranking-badge-container">
                    ${rankBadge}
                  </div>
                  <img
                    src="${escapeHtml(img)}"
                    alt="${escapeHtml(item.name)}"
                    class="ranking-item-thumb"
                    onerror="this.onerror=null;this.src='assets/placeholder-burger.png';"
                  />
                  <div class="ranking-item-info">
                    <h4 class="ranking-item-name">${escapeHtml(item.name)}</h4>
                    <div class="ranking-item-sub">
                      ${item.categoryName ? `<span class="badge" style="font-size:0.7rem;">${escapeHtml(item.categoryName)}</span>` : ''}
                      <span class="ranking-item-price">₱${price}</span>
                    </div>
                  </div>
                </div>

                <div class="ranking-card-stats">
                  <div class="ranking-stat-box ranking-favorites-box">
                    <span class="ranking-stat-label">Customer Favorites</span>
                    <div class="ranking-stat-value" style="display:inline-flex;align-items:center;gap:6px;color:#E53E3E;">
                      ${lucideIcon('heart', { size: 20, fill: '#E53E3E', stroke: '#E53E3E', ariaHidden: true })}
                      <strong>${favCount}</strong>
                    </div>
                  </div>

                  <div class="ranking-stat-box ranking-rating-box">
                    <span class="ranking-stat-label">Customer Rating</span>
                    <div>
                      ${renderRatingBadge(avgRating, revCount, { size: 16 })}
                    </div>
                  </div>
                </div>
              </article>
            `;
          })
          .join('')}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `
      <div class="state-box">
        <h4 class="state-title text-danger">Error loading rankings</h4>
        <p class="state-desc">${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}

function getStoreDateKey(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function renderSalesToggleData() {
  if (!dashboardStats || !dashboardStats.sales) return;
  const data = dashboardStats.sales[currentSalesView] || {
    count: 0,
    revenue: 0,
  };
  const labelElem = document.getElementById('sales-toggle-label');
  const countElem = document.getElementById('sales-toggle-count');
  const revElem = document.getElementById('sales-toggle-revenue');

  const titles = {
    daily: "Today's Sales",
    weekly: 'Last 7 Days Sales',
    monthly: 'Last 30 Days Sales',
  };
  if (labelElem) labelElem.textContent = titles[currentSalesView];
  if (countElem)
    countElem.textContent = `${data.count} completed ${data.count === 1 ? 'order' : 'orders'}`;
  if (revElem) revElem.textContent = formatPeso(data.revenue);
}

// Inline SVG Revenue Bar Chart
function renderRevenueBarChart() {
  const container = document.getElementById('revenue-chart-container');
  if (!container || !dashboardStats || !dashboardStats.revenueHistory) return;

  const historyByDate = new Map(
    dashboardStats.revenueHistory.map((item) => [item._id, item])
  );
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
      const height =
        item.revenue > 0
          ? Math.max(2, (item.revenue / maxRevenue) * (chartBottom - chartTop))
          : 0;
      const x = 32 + idx * slotWidth + (slotWidth - barWidth) / 2;
      const y = chartBottom - height;
      const dateLabel = item._id.slice(5);
      const labelInterval = currentChartDays === 14 ? 2 : 5;
      const showDateLabel =
        idx % labelInterval === 0 ||
        (idx === history.length - 1 && (idx - 1) % labelInterval !== 0);

      return `
        <g class="chart-bar-group">
          <rect x="${x}" y="${y}" width="${barWidth}" height="${height}" rx="4" fill="url(#revenue-bar-fill)" opacity="${item.revenue ? '0.95' : '0.2'}">
            <title>${item._id}: ${formatPeso(item.revenue)} (${item.orders} completed ${item.orders === 1 ? 'order' : 'orders'})</title>
          </rect>
          ${showDateLabel ? `<text x="${x + barWidth / 2}" y="${chartHeight - 8}" font-size="10" text-anchor="middle" fill="${document.body.classList.contains('theme-dark') ? '#cbd5e1' : '#64748b'}">${dateLabel}</text>` : ''}
        </g>
      `;
    })
    .join('');

  container.innerHTML = `
    <svg class="admin-revenue-chart" viewBox="0 0 ${chartWidth} ${chartHeight}" role="img" aria-label="Completed revenue over the last ${currentChartDays} days">
      <defs><linearGradient id="revenue-bar-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#4ade80"/><stop offset="100%" stop-color="#15803d"/></linearGradient></defs>
      <line x1="24" y1="${chartTop}" x2="${chartWidth - 12}" y2="${chartTop}" stroke="${document.body.classList.contains('theme-dark') ? '#374151' : '#e5e7eb'}" stroke-width="1"/>
      <line x1="24" y1="${(chartTop + chartBottom) / 2}" x2="${chartWidth - 12}" y2="${(chartTop + chartBottom) / 2}" stroke="${document.body.classList.contains('theme-dark') ? '#374151' : '#e5e7eb'}" stroke-width="1"/>
      <line x1="24" y1="${chartBottom}" x2="${chartWidth - 12}" y2="${chartBottom}" stroke="${document.body.classList.contains('theme-dark') ? '#4b5563' : '#d1d5db'}" stroke-width="1"/>
      ${bars}
    </svg>
  `;
}

// Inline SVG Status Donut Chart (Completed vs Cancelled vs Pending)
function renderStatusDonutChart() {
  const container = document.getElementById('status-donut-container');
  if (!container || !dashboardStats || !dashboardStats.statusComparison) return;

  const { completed, cancelled, pending, inProgress } =
    dashboardStats.statusComparison;
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
          <circle cx="18" cy="18" r="15.9155" fill="none" stroke="${document.body.classList.contains('theme-dark') ? '#374151' : '#e5e7eb'}" stroke-width="3.8"/>
          <circle cx="18" cy="18" r="15.9155" fill="none" stroke="${ADMIN_CHART_COLORS.completed}" stroke-width="3.8" stroke-dasharray="${completedPct} ${100 - completedPct}" stroke-dashoffset="${completedOffset}"/>
          <circle cx="18" cy="18" r="15.9155" fill="none" stroke="${ADMIN_CHART_COLORS.cancelled}" stroke-width="3.8" stroke-dasharray="${cancelledPct} ${100 - cancelledPct}" stroke-dashoffset="${cancelledOffset}"/>
          <circle cx="18" cy="18" r="15.9155" fill="none" stroke="${ADMIN_CHART_COLORS.pending}" stroke-width="3.8" stroke-dasharray="${activePct} ${100 - activePct}" stroke-dashoffset="${activeOffset}"/>
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
    container.innerHTML =
      '<p class="text-muted" style="font-size:0.85rem;">No orders yet.</p>';
    return;
  }

  container.innerHTML = topItems
    .map(
      (item, idx) => `
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
    `
    )
    .join('');
}

// Recent Orders section
function renderRecentOrders(orders, pagination) {
  const list = document.getElementById('recent-orders-list');
  if (!list) return;
  if (orders.length === 0) {
    list.innerHTML =
      '<p class="text-muted">No orders match this status.</p>';
  } else {
    list.innerHTML = orders
      .map(
        (order) => `
        <article class="admin-recent-order" role="listitem">
          <strong class="admin-recent-order-number">#${escapeHtml(order.orderNumber || '')}</strong>
          <span class="admin-recent-order-customer">${escapeHtml(order.contact?.fullName || 'Guest')}</span>
          <div class="admin-recent-order-meta">
            <span class="badge badge-${escapeHtml(order.status)}">${escapeHtml(order.status)}</span>
            <span>${escapeHtml(String(order.fulfillment || '').replaceAll('_', ' '))}</span>
          </div>
          <strong class="admin-recent-order-total">${formatPeso(order.total)}</strong>
        </article>
      `
      )
      .join('');
  }

  const paginationInfo = document.getElementById(
    'orders-insights-pagination-info'
  );
  if (paginationInfo) {
    const start = pagination.total
      ? (pagination.page - 1) * pagination.limit + 1
      : 0;
    const end = Math.min(pagination.page * pagination.limit, pagination.total);
    paginationInfo.textContent = `Showing ${start}-${end} of ${pagination.total} orders · Page ${pagination.page} of ${pagination.totalPages}`;
  }
  const previousButton = document.getElementById(
    'orders-insights-prev'
  );
  const nextButton = document.getElementById('orders-insights-next');
  if (previousButton) previousButton.disabled = pagination.page <= 1;
  if (nextButton)
    nextButton.disabled = pagination.page >= pagination.totalPages;
}

async function loadDashboardRecentOrders() {
  const list = document.getElementById('recent-orders-list');
  if (!list) return;

  const requestId = ++dashboardRecentOrdersRequestId;
  list.setAttribute('aria-busy', 'true');
  list.innerHTML = '<p class="text-muted">Loading recent orders…</p>';
  const paginationInfo = document.getElementById(
    'orders-insights-pagination-info'
  );
  if (paginationInfo) paginationInfo.textContent = 'Loading recent orders…';
  const previousButton = document.getElementById(
    'orders-insights-prev'
  );
  const nextButton = document.getElementById('orders-insights-next');
  if (previousButton) previousButton.disabled = true;
  if (nextButton) nextButton.disabled = true;

  const params = new URLSearchParams({
    page: String(dashboardRecentOrdersPage),
    limit: '5',
  });
  if (dashboardRecentOrdersStatus !== 'all') {
    params.set('status', dashboardRecentOrdersStatus);
  }

  try {
    const response = await apiFetch(`/admin/orders?${params.toString()}`);
    if (requestId !== dashboardRecentOrdersRequestId) return;

    if (dashboardRecentOrdersPage > response.pagination.totalPages) {
      dashboardRecentOrdersPage = response.pagination.totalPages;
      await loadDashboardRecentOrders();
      return;
    }
    dashboardRecentOrdersPage = response.pagination.page;
    dashboardRecentOrdersTotalPages = response.pagination.totalPages;
    renderRecentOrders(response.orders, response.pagination);
    dashboardRecentOrdersErrorNotified = false;
  } catch (error) {
    if (requestId !== dashboardRecentOrdersRequestId) return;
    list.innerHTML =
      '<p class="text-muted">Recent orders could not be loaded. Refresh to try again.</p>';
    if (paginationInfo) {
      paginationInfo.textContent = 'Recent orders are unavailable.';
    }
    if (!dashboardRecentOrdersErrorNotified) {
      showToast(`Failed to load recent orders: ${error.message}`, 'error');
      dashboardRecentOrdersErrorNotified = true;
    }
  } finally {
    if (requestId === dashboardRecentOrdersRequestId) {
      list.setAttribute('aria-busy', 'false');
      const previousButton = document.getElementById(
        'orders-insights-prev'
      );
      const nextButton = document.getElementById(
        'orders-insights-next'
      );
      if (previousButton) {
        previousButton.disabled =
          dashboardRecentOrdersPage <= 1;
      }
      if (nextButton) {
        nextButton.disabled =
          dashboardRecentOrdersPage >= dashboardRecentOrdersTotalPages;
      }
    }
  }
}

// ---------------- 2. ORDERS MANAGEMENT ----------------
async function loadAdminOrders() {
  const tbody = document.getElementById('admin-orders-tbody');
  if (!tbody) return;

  tbody.innerHTML =
    '<tr><td colspan="8" class="text-center" style="padding:24px;">Loading orders...</td></tr>';

  try {
    const params = new URLSearchParams();
    if (ordersFilter.search) params.append('search', ordersFilter.search);
    if (ordersFilter.status !== 'all')
      params.append('status', ordersFilter.status);
    if (ordersFilter.paymentStatus !== 'all')
      params.append('paymentStatus', ordersFilter.paymentStatus);
    if (ordersFilter.fulfillment !== 'all')
      params.append('fulfillment', ordersFilter.fulfillment);
    if (ordersFilter.dateRange)
      params.append('dateRange', ordersFilter.dateRange);
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
    if (nextPageBtn)
      nextPageBtn.disabled = pagination.page >= pagination.totalPages;

    if (orders.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="8" class="text-center text-muted" style="padding:32px;">No orders match the selected filters.</td></tr>';
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
              <div style="font-size:0.75rem;color:var(--color-text-muted);">${escapeHtml(o.contact.email || '')}</div>
              <div style="font-size:0.75rem;color:var(--color-text-muted);">${escapeHtml(o.contact.phone)}</div>
            </td>
            <td>${formatTableDate(o.createdAt)}</td>
            <td>${o.fulfillment.toUpperCase()}</td>
            <td><strong>${formatPeso(o.total)}</strong></td>
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
  return (
    {
      pending: 'PENDING ACCEPTANCE',
      preparing: 'PREPARING',
      ready_for_pickup: 'READY FOR PICKUP',
      ready_to_deliver: 'READY TO DELIVER',
      to_pickup: 'READY FOR PICKUP',
      to_ship: 'READY TO DELIVER',
      completed: 'COMPLETED',
      cancelled: 'CANCELLED',
    }[status] || status.toUpperCase()
  );
}

// Order Detail Drawer
async function openOrderDrawer(orderId) {
  try {
    markAdminNotificationReadByOrderId(orderId);
    const res = await apiFetch(`/admin/orders/${orderId}`);
    const order = res.order;
    const body = document.getElementById('order-drawer-content');
    if (!body) return;
    if (activeGcashProofPreviewUrl) {
      URL.revokeObjectURL(activeGcashProofPreviewUrl);
      activeGcashProofPreviewUrl = null;
    }

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
      const nextLabel =
        order.paymentMethod === 'pay_at_shop'
          ? 'Customer Arrived — Start Preparing'
          : 'Accept & Start Preparing';
      actionButtons += `
        <button type="button" class="btn btn-primary btn-sm btn-action-status" data-order-id="${order._id}" data-status="preparing">
          ${nextLabel}
        </button>
        <button type="button" class="btn btn-danger btn-sm btn-action-cancel" data-order-id="${order._id}">
          Cancel Order
        </button>
      `;
    } else if (order.status === 'preparing') {
      const readyStatus =
        order.fulfillment === 'pickup'
          ? 'ready_for_pickup'
          : 'ready_to_deliver';
      const readyLabel =
        order.fulfillment === 'pickup'
          ? 'Mark Ready for Pickup'
          : 'Mark Ready for Delivery';
      actionButtons += `
        <button type="button" class="btn btn-primary btn-sm btn-action-status" data-order-id="${order._id}" data-status="${readyStatus}">
          ${readyLabel}
        </button>
      `;
    } else if (
      order.status === 'ready_for_pickup' ||
      order.status === 'to_pickup'
    ) {
      actionButtons += `
        <button type="button" class="btn btn-primary btn-sm btn-action-status" data-order-id="${order._id}" data-status="completed">
          Mark Pick Up as Completed
        </button>
      `;
    } else if (
      order.status === 'ready_to_deliver' ||
      order.status === 'to_ship'
    ) {
      actionButtons +=
        '<p class="text-muted">Waiting for the customer to confirm delivery.</p>';
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
        ${order.contact.email ? `<div><strong>Email:</strong> ${escapeHtml(order.contact.email)}</div>` : ''}
        <div><strong>Phone:</strong> ${escapeHtml(order.contact.phone)}</div>
        ${order.fulfillment === 'delivery' ? `<div><strong>Address:</strong> ${escapeHtml(order.contact.address)}</div>` : ''}
        <div><strong>Fulfillment:</strong> ${order.fulfillment.toUpperCase()}</div>
        <div><strong>Payment Method:</strong> ${order.paymentMethod.toUpperCase().replace(/_/g, ' ')}</div>
        ${
          order.paymentMethod === 'gcash'
            ? `<div><strong>${order.gcashReference === '0000000000000' ? 'Demo reference' : 'Reference'}:</strong> ${escapeHtml(order.gcashReference || 'Not provided')}</div>
              ${order.gcashReference === '0000000000000' ? '<div class="text-muted">Demo order only. It remains unpaid; the attached image is not proof of payment.</div>' : ''}
              <div style="margin-top:8px;"><button type="button" class="btn btn-secondary btn-sm btn-view-gcash-proof" data-order-id="${order._id}">View attached image</button><div id="gcash-proof-viewer" style="margin-top:8px;"></div></div>`
            : ''
        }
        ${
          order.paymentMethod === 'pay_at_shop' &&
          order.arrivalDeadline &&
          order.status === 'pending'
            ? `<div><strong>Customer arrival deadline:</strong> ${new Date(order.arrivalDeadline).toLocaleString()}</div><div style="color:var(--color-warning);font-weight:600;">Start preparing only after the customer arrives.</div>`
            : ''
        }
      </div>

      <div class="step-card" style="margin-bottom:16px;">
        <h5 style="margin-bottom:6px;font-size:0.9rem;">Ordered Items</h5>
        ${itemsRows}
        <div style="display:flex;justify-content:space-between;padding-top:8px;font-weight:700;">
          <span>Subtotal:</span> <span>₱${order.subtotal.toFixed(2)}</span>
        </div>
        ${
          order.deliveryFee > 0
            ? `
          <div style="display:flex;justify-content:space-between;padding-top:2px;">
            <span>Delivery Fee:</span> <span>₱${order.deliveryFee.toFixed(2)}</span>
          </div>
        `
            : ''
        }
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

  tbody.innerHTML =
    '<tr><td colspan="7" class="text-center" style="padding:24px;">Loading menu items...</td></tr>';

  try {
    const params = new URLSearchParams();
    if (menuCategoryFilter !== 'all')
      params.append('category', menuCategoryFilter);
    if (menuStockFilter !== 'all')
      params.append('stockFilter', menuStockFilter);
    if (menuSearchQuery.trim()) params.append('search', menuSearchQuery.trim());

    const res = await apiFetch(`/admin/products?${params.toString()}`);
    const products = res.products || [];

    if (products.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="7" class="text-center text-muted" style="padding:32px;">No menu items found.</td></tr>';
      return;
    }

    tbody.innerHTML = products
      .map((p) => {
        const isLow = p.stock <= (p.lowStockThreshold || 10) && p.stock > 0;
        const isOut = p.stock <= 0;
        const rowClass = isOut
          ? 'background-color:#FDE8E8;'
          : isLow
            ? 'background-color:#FEF3C7;'
            : '';
        const catName =
          p.category && p.category.name ? p.category.name : 'Unassigned';
        const imgUrl = getProductImageUrl(p);

        return `
          <tr style="${rowClass}">
            <td>
              <div style="display:flex;align-items:center;gap:10px;">
                <img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(p.name)}" style="width:40px;height:40px;border-radius:4px;object-fit:cover;" onerror="window.handleImageError(this)">
                <div>
                  <strong>${escapeHtml(p.name)}</strong>
                  ${p.isAddon ? '<span class="badge" style="background:#E0E7FF;color:#3730A3;margin-left:4px;">Add-on</span>' : ''}
                  ${p.isFeatured ? '<span class="badge" style="background:#FEF3C7;color:#B45309;margin-left:4px;">Featured</span>' : ''}
                </div>
              </div>
            </td>
            <td>${escapeHtml(catName)}</td>
            <td><strong>${formatPeso(p.price)}</strong></td>
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
      document.getElementById('product-description-input').value =
        p.description || '';
      document.getElementById('product-stock-input').value = p.stock;
      document.getElementById('product-threshold-input').value =
        p.lowStockThreshold || 10;
      if (catSelect) catSelect.value = p.category._id || p.category;
      document.getElementById('product-is-addon-input').checked = Boolean(
        p.isAddon
      );
      document.getElementById('product-is-available-input').checked = Boolean(
        p.isAvailable
      );
      document.getElementById('product-is-featured-input').checked = Boolean(
        p.isFeatured
      );
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

  tbody.innerHTML =
    '<tr><td colspan="4" class="text-center" style="padding:20px;">Loading categories...</td></tr>';

  try {
    const res = await apiFetch('/categories');
    categoriesList = res.categories || [];

    if (categoriesList.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="4" class="text-center text-muted" style="padding:20px;">No categories created.</td></tr>';
      return;
    }

    tbody.innerHTML = categoriesList
      .map(
        (c) => `
        <tr>
          <td><strong>${escapeHtml(c.name)}</strong></td>
          <td>${Number(c.sortOrder)}</td>
          <td>${formatTableDate(c.createdAt)}</td>
          <td>
            <button class="btn btn-secondary btn-sm btn-edit-category" data-id="${c._id}" data-name="${escapeHtml(c.name)}" data-order="${c.sortOrder}">Edit</button>
            <button class="btn btn-danger btn-sm btn-delete-category" data-id="${c._id}" data-name="${escapeHtml(c.name)}">Delete</button>
          </td>
        </tr>
      `
      )
      .join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-danger" style="padding:20px;">${escapeHtml(err.message)}</td></tr>`;
  }
}

// ---------------- 5. CUSTOMERS MANAGEMENT ----------------
async function loadAdminCustomers() {
  const tbody = document.getElementById('admin-customers-tbody');
  if (!tbody) return;

  tbody.innerHTML =
    '<tr><td colspan="7" class="text-center" style="padding:24px;">Loading customer accounts...</td></tr>';

  try {
    const searchInput = document.getElementById('customer-search-input');
    const q = searchInput ? searchInput.value.trim() : '';
    const res = await apiFetch(
      `/admin/customers${q ? `?search=${encodeURIComponent(q)}` : ''}`
    );
    const customers = res.customers || [];

    if (customers.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="7" class="text-center text-muted" style="padding:32px;">No customers found.</td></tr>';
      return;
    }

    tbody.innerHTML = customers
      .map((c) => {
        const orderCount = Number(c.orderCount);
        return `
        <tr>
          <td><strong>${escapeHtml(c.username)}</strong></td>
          <td>${escapeHtml(c.fullName || '—')}</td>
          <td>${escapeHtml(c.email)}</td>
          <td>${escapeHtml(c.phone || '—')}</td>
          <td>
            <div class="customer-orders-metric">
              <strong>${orderCount} ${orderCount === 1 ? 'order' : 'orders'}</strong>
              <span>${formatPeso(c.totalSpent)}</span>
            </div>
          </td>
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
      `;
      })
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

    const ordersHtml =
      orders.length === 0
        ? '<p class="text-muted" style="padding:16px 0;">Customer has not placed any orders yet.</p>'
        : orders
            .map(
              (o) => `
            <div class="step-card" style="margin-bottom:10px;">
              <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                <strong>#${escapeHtml(o.orderNumber)}</strong>
                <span class="badge badge-${o.status}">${o.status}</span>
              </div>
              <div style="font-size:0.8rem;color:var(--color-text-muted);">${new Date(o.createdAt).toLocaleString()} &bull; Total: <strong>₱${o.total.toFixed(2)}</strong></div>
            </div>
          `
            )
            .join('');

    body.innerHTML = `
      <div style="margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--color-border);">
        <h4 style="font-size:1.1rem;margin-bottom:2px;">${escapeHtml(customer.fullName || customer.username)}</h4>
        <div style="font-size:0.85rem;color:var(--color-text-muted);">${escapeHtml(customer.contactEmail || customer.email)} &bull; ${escapeHtml(customer.phone || 'No phone')}</div>
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
    document.getElementById('settings-accepting-orders').checked = Boolean(
      s.acceptingOrders
    );
    updateOnlineOrderingSummary(Boolean(s.acceptingOrders), true);
    document.getElementById('settings-delivery-enabled').checked = Boolean(
      s.deliveryEnabled
    );
    document.getElementById('settings-pickup-enabled').checked = Boolean(
      s.pickupEnabled
    );
    document.getElementById('settings-delivery-fee').value = Number.isFinite(
      Number(s.deliveryFee)
    )
      ? Number(s.deliveryFee)
      : 30;
    document.getElementById('settings-min-order').value = s.minimumOrder || 0;

    // Payment methods
    document.getElementById('settings-gcash-enabled').checked = Boolean(
      s.gcashEnabled
    );
    document.getElementById('settings-cod-enabled').checked = Boolean(
      s.codEnabled
    );
    document.getElementById('settings-pay-at-shop-enabled').checked = Boolean(
      s.payAtShopEnabled
    );
    // Business Hours
    const days = [
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ];
    days.forEach((day) => {
      const h = (s.businessHours && s.businessHours[day]) || {
        open: '09:00',
        close: '21:00',
        closed: false,
      };
      const openElem = document.getElementById(`hours-${day}-open`);
      const closeElem = document.getElementById(`hours-${day}-close`);
      const closedElem = document.getElementById(`hours-${day}-closed`);
      if (openElem) openElem.value = h.open || '09:00';
      if (closeElem) closeElem.value = h.close || '21:00';
      if (closedElem) closedElem.checked = Boolean(h.closed);
    });

  } catch (err) {
    showToast('Failed to load store settings: ' + err.message, 'error');
  }
}

// ---------------- GLOBAL EVENT ATTACHMENTS ----------------
function attachAdminEventListeners() {
  const storeSettingsTabs = [
    ...document.querySelectorAll('[data-settings-tab]'),
  ];
  storeSettingsTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const selectedTab = tab.dataset.settingsTab;
      storeSettingsTabs.forEach((item) => {
        const isSelected = item === tab;
        item.classList.toggle('active', isSelected);
        item.setAttribute('aria-selected', String(isSelected));
        item.tabIndex = isSelected ? 0 : -1;
      });

      storeSettingsTabs.forEach((item) => {
        const panel = document.getElementById(
          item.getAttribute('aria-controls')
        );
        const isSelected = item.dataset.settingsTab === selectedTab;
        panel.hidden = !isSelected;
      });
    });

    tab.addEventListener('keydown', (event) => {
      const currentIndex = storeSettingsTabs.indexOf(tab);
      let nextIndex;
      if (event.key === 'ArrowRight') {
        nextIndex = (currentIndex + 1) % storeSettingsTabs.length;
      } else if (event.key === 'ArrowLeft') {
        nextIndex =
          (currentIndex - 1 + storeSettingsTabs.length) %
          storeSettingsTabs.length;
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = storeSettingsTabs.length - 1;
      } else {
        return;
      }

      event.preventDefault();
      storeSettingsTabs[nextIndex].click();
      storeSettingsTabs[nextIndex].focus();
    });
  });

  document.querySelectorAll('[data-dashboard-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const selectedTab = tab.dataset.dashboardTab;
      document.querySelectorAll('[data-dashboard-tab]').forEach((item) => {
        const isSelected = item === tab;
        item.classList.toggle('active', isSelected);
        item.setAttribute('aria-selected', String(isSelected));
        item.tabIndex = isSelected ? 0 : -1;
      });

      document.querySelectorAll('.dashboard-tab-panel').forEach((panel) => {
        const isSelected = panel.id === `dashboard-${selectedTab}-panel`;
        panel.classList.toggle('hidden', !isSelected);
        panel.hidden = !isSelected;
      });

      if (selectedTab === 'performance') {
        opsCharts?.forEach((chart) => chart.resize());
      }
    });

    tab.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const tabs = [...document.querySelectorAll('[data-dashboard-tab]')];
      const currentIndex = tabs.indexOf(tab);
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      tabs[(currentIndex + direction + tabs.length) % tabs.length].click();
      tabs[(currentIndex + direction + tabs.length) % tabs.length].focus();
    });
  });

  const dashboardRefreshButton = document.getElementById(
    'dashboard-refresh-btn'
  );
  if (dashboardRefreshButton)
    dashboardRefreshButton.addEventListener('click', loadDashboardStats);
  const recentOrdersStatus = document.getElementById(
    'orders-insights-status'
  );
  if (recentOrdersStatus) {
    recentOrdersStatus.addEventListener('change', () => {
      dashboardRecentOrdersStatus = recentOrdersStatus.value;
      dashboardRecentOrdersPage = 1;
      loadDashboardRecentOrders();
    });
  }
  const recentOrdersPrevious = document.getElementById(
    'orders-insights-prev'
  );
  if (recentOrdersPrevious) {
    recentOrdersPrevious.addEventListener('click', () => {
      if (dashboardRecentOrdersPage <= 1) return;
      dashboardRecentOrdersPage -= 1;
      loadDashboardRecentOrders();
    });
  }
  const recentOrdersNext = document.getElementById(
    'orders-insights-next'
  );
  if (recentOrdersNext) {
    recentOrdersNext.addEventListener('click', () => {
      if (dashboardRecentOrdersPage >= dashboardRecentOrdersTotalPages) return;
      dashboardRecentOrdersPage += 1;
      loadDashboardRecentOrders();
    });
  }
  const openOrdersSection = () => {
    const ordersNavButton = document.querySelector(
      '.admin-nav-item[data-section="orders"]'
    );
    if (ordersNavButton) ordersNavButton.click();
  };
  ['dashboard-view-orders-btn'].forEach(
    (id) => {
      const button = document.getElementById(id);
      if (button) button.addEventListener('click', openOrdersSection);
    }
  );

  document.addEventListener('click', (event) => {
    const closeButton = event.target.closest('[data-modal-close]');
    if (closeButton) {
      closeModal(closeButton.getAttribute('data-modal-close'));
    }
  });

  const customerHistoryModal = document.getElementById(
    'customer-history-modal'
  );
  const closeCustomerHistory = () => closeModal('customer-history-modal');
  const closeCustomerHistoryButton = document.getElementById(
    'close-customer-history-modal'
  );
  const customerHistoryCloseButton = document.getElementById(
    'customer-history-close-btn'
  );

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
    if (
      event.key === 'Escape' &&
      customerHistoryModal &&
      customerHistoryModal.classList.contains('open')
    ) {
      closeCustomerHistory();
    }
  });

  // Sales view toggles (daily, weekly, monthly)
  document.querySelectorAll('.btn-sales-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      document
        .querySelectorAll('.btn-sales-toggle')
        .forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentSalesView = btn.getAttribute('data-view');
      renderSalesToggleData();
    });
  });

  // Chart range toggle (14 / 30 days)
  document.querySelectorAll('.btn-chart-range').forEach((btn) => {
    btn.addEventListener('click', () => {
      document
        .querySelectorAll('.btn-chart-range')
        .forEach((b) => b.classList.remove('active'));
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

  const menuStockFilterInput = document.getElementById(
    'admin-menu-stock-filter'
  );
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

  // Reviews search & rating filters
  const reviewsSearch = document.getElementById('admin-reviews-search');
  if (reviewsSearch) {
    let t = null;
    reviewsSearch.addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => {
        adminReviewsSearchQuery = e.target.value.trim();
        loadAdminReviews();
      }, 300);
    });
  }

  const reviewsRatingFilter = document.getElementById('admin-reviews-rating-filter');
  if (reviewsRatingFilter) {
    reviewsRatingFilter.addEventListener('change', (e) => {
      adminReviewsRatingFilter = e.target.value;
      loadAdminReviews();
    });
  }

  const reviewsRefreshBtn = document.getElementById('admin-reviews-refresh-btn');
  if (reviewsRefreshBtn) {
    reviewsRefreshBtn.addEventListener('click', () => loadAdminReviews());
  }

  const favoritesRefreshBtn = document.getElementById('admin-favorites-refresh-btn');
  if (favoritesRefreshBtn) {
    favoritesRefreshBtn.addEventListener('click', () => loadAdminTopFavorites());
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
    const proofButton = e.target.closest('.btn-view-gcash-proof');
    if (proofButton) {
      proofButton.disabled = true;
      try {
        const imageBlob = await apiFetchBlob(
          `/orders/${proofButton.getAttribute('data-order-id')}/gcash-proof`
        );
        if (activeGcashProofPreviewUrl) {
          URL.revokeObjectURL(activeGcashProofPreviewUrl);
        }
        activeGcashProofPreviewUrl = URL.createObjectURL(imageBlob);
        const viewer = document.getElementById('gcash-proof-viewer');
        if (viewer) {
          const preview = document.createElement('img');
          preview.src = activeGcashProofPreviewUrl;
          preview.alt =
            'Customer-submitted GCash image attachment; not payment verification';
          preview.style.cssText =
            'display:block;max-width:100%;max-height:360px;object-fit:contain;';
          viewer.replaceChildren(preview);
          const caption = document.createElement('p');
          caption.className = 'text-muted';
          caption.textContent =
            'Customer-submitted image for review only. This does not verify that payment was made.';
          viewer.append(caption);
        }
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        proofButton.disabled = false;
      }
      return;
    }

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
        showToast(
          `Order status updated to ${statusLabel(status).toLowerCase()}`,
          'success'
        );
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

    const cancelActionBtn = e.target.closest('.btn-action-cancel');
    if (cancelActionBtn) {
      const orderId = cancelActionBtn.getAttribute('data-order-id');
      if (
        !confirm(
          'Cancel this pending customer order? Reserved stock will be returned.'
        )
      )
        return;
      cancelActionBtn.disabled = true;
      try {
        await apiFetch(`/admin/orders/${orderId}/cancel`, { method: 'PATCH' });
        showToast('Order successfully cancelled.', 'info');
        closeModal('order-drawer-modal');
        loadAdminOrders();
        loadDashboardStats();
      } catch (err) {
        showToast(err.message, 'error');
        cancelActionBtn.disabled = false;
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
        const res = await apiFetch(`/admin/products/${pid}/availability`, {
          method: 'PATCH',
        });
        await loadAdminMenu();
        showToast(
          `${res.product.name} ${res.product.isAvailable ? 'enabled' : 'disabled'} for ordering`,
          'success'
        );
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
      if (
        confirm(
          `Permanently delete "${name}"? It will also be removed from any active user carts.`
        )
      ) {
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
      document.getElementById('category-modal-title').textContent =
        'Edit Category';
      document.getElementById('category-name-input').value =
        editCatBtn.getAttribute('data-name');
      document.getElementById('category-order-input').value =
        editCatBtn.getAttribute('data-order');
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
        const price = parseFloat(
          document.getElementById('product-price-input').value
        );
        const description = document
          .getElementById('product-description-input')
          .value.trim();
        const stock = parseInt(
          document.getElementById('product-stock-input').value,
          10
        );
        const lowStockThreshold = parseInt(
          document.getElementById('product-threshold-input').value,
          10
        );
        const category = document.getElementById(
          'product-category-input'
        ).value;
        const isAddon = document.getElementById(
          'product-is-addon-input'
        ).checked;
        const isAvailable = document.getElementById(
          'product-is-available-input'
        ).checked;
        const isFeatured = document.getElementById(
          'product-is-featured-input'
        ).checked;

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
      const mode = document.querySelector(
        'input[name="restock_mode"]:checked'
      ).value;
      const amount = parseInt(
        document.getElementById('restock-amount-input').value,
        10
      );

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
      const sortOrder =
        parseInt(document.getElementById('category-order-input').value, 10) ||
        0;

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
    const onlineOrderingToggle = document.getElementById(
      'settings-accepting-orders'
    );
    if (onlineOrderingToggle) {
      onlineOrderingToggle.addEventListener('change', () => {
        updateOnlineOrderingSummary(onlineOrderingToggle.checked);
      });
    }

    settingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const days = [
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
        'sunday',
      ];
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
        acceptingOrders: document.getElementById('settings-accepting-orders')
          .checked,
        deliveryEnabled: document.getElementById('settings-delivery-enabled')
          .checked,
        pickupEnabled: document.getElementById('settings-pickup-enabled')
          .checked,
        deliveryFee:
          parseFloat(document.getElementById('settings-delivery-fee').value) ||
          0,
        minimumOrder:
          parseFloat(document.getElementById('settings-min-order').value) || 0,
        gcashEnabled: document.getElementById('settings-gcash-enabled').checked,
        codEnabled: document.getElementById('settings-cod-enabled').checked,
        payAtShopEnabled: document.getElementById(
          'settings-pay-at-shop-enabled'
        ).checked,
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

  // Admin Password Update
  const adminPasswordForm = document.getElementById('admin-password-form');
  if (adminPasswordForm) {
    adminPasswordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const currentPassword =
        document.getElementById('admin-current-pass').value;
      const newPassword = document.getElementById('admin-new-pass').value;
      const confirmPassword =
        document.getElementById('admin-confirm-pass').value;

      try {
        await apiFetch('/admin/password', {
          method: 'PATCH',
          body: JSON.stringify({
            currentPassword,
            newPassword,
            confirmPassword,
          }),
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
  if (addProductBtn)
    addProductBtn.addEventListener('click', () => openProductModal());

  const addCategoryBtn = document.getElementById('btn-add-category');
  if (addCategoryBtn) {
    addCategoryBtn.addEventListener('click', () => {
      editingCategoryId = null;
      document.getElementById('category-modal-title').textContent =
        'Add Category';
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
    greetingName.textContent =
      adminUser.fullName || adminUser.username || 'Admin';
  }
  setupBackToTop();
  setupAdminNavigation();
  attachAdminEventListeners();
  window.openAdminOrderDrawer = openOrderDrawer;
  loadDashboardStats();
  initAdminNotifications();

  // Instant real-time refresh when customer orders change
  window.addEventListener('gigabite:admin-order-changed', (e) => {
    loadDashboardStats();
    if (activeSection === 'orders') {
      loadAdminOrders();
    } else if (activeSection === 'recent-orders') {
      loadDashboardRecentOrders();
    }
    const drawer = document.getElementById('order-drawer-modal');
    if (
      drawer &&
      drawer.classList.contains('open') &&
      e.detail &&
      e.detail.orderId
    ) {
      openOrderDrawer(e.detail.orderId);
    }
  });

  // Keep the visible dashboard and recent orders data current fallback
  setInterval(() => {
    if (activeSection === 'orders') {
      loadAdminOrders();
    }
    if (activeSection === 'recent-orders') {
      loadDashboardRecentOrders();
    } else if (
      activeSection === 'dashboard' ||
      activeSection === 'top-items'
    ) {
      loadDashboardStats();
    }
  }, 10000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdmin);
} else {
  initAdmin();
}
