// Customer Profile Controller
import { apiFetch } from './api.js';
import { renderHeader, renderFooter, showToast, escapeHtml, openModal, closeModal } from './ui.js';
import { requireAuth, getUser, setUser, resizeImageToDataUrl, renderAvatar } from './auth.js';

let activeTab = 'status';
let statusSubTab = 'pickup';
let historyFilter = 'all';
let pollingTimer = null;

async function loadProfileOverview() {
  try {
    const res = await apiFetch('/profile');
    const p = res.profile;

    document.getElementById('overview-username').textContent = p.username;
    document.getElementById('overview-email').textContent = p.email;
    document.getElementById('overview-member-since').textContent = new Date(p.createdAt).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    document.getElementById('overview-total-orders').textContent = String(p.totalOrders || 0);

    const avatarHolder = document.getElementById('overview-avatar-holder');
    if (avatarHolder) {
      avatarHolder.innerHTML = renderAvatar(p, 80);
    }

    // Prefill saved details tab
    const nameInput = document.getElementById('profile-fullname-input');
    const phoneInput = document.getElementById('profile-phone-input');
    const addressInput = document.getElementById('profile-address-input');
    if (nameInput) nameInput.value = p.fullName || '';
    if (phoneInput) phoneInput.value = p.phone || '';
    if (addressInput) addressInput.value = p.address || '';
  } catch (err) {
    showToast('Failed to load profile details.', 'error');
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
      container.innerHTML = `
        <div class="state-box">
          <h4 class="state-title">No past orders found</h4>
          <p class="state-desc">You have no completed or cancelled orders under this filter.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = orders.map((order) => renderOrderCard(order, false)).join('');
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
        <h4 style="font-size:1.1rem;margin:0;">BURGER SHOP</h4>
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
        const dataUrl = await resizeImageToDataUrl(file, 256, 0.8);
        await apiFetch('/profile', {
          method: 'PATCH',
          body: JSON.stringify({ avatarUrl: dataUrl }),
        });

        const u = getUser();
        if (u) {
          u.avatarUrl = dataUrl;
          setUser(u);
        }

        showToast('Profile photo updated!', 'success');
        loadProfileOverview();
        renderHeader('profile');
      } catch (err) {
        showToast(err.message, 'error');
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
        loadProfileOverview();
        renderHeader('profile');
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

  // Check URL query for tab selection
  const params = new URLSearchParams(window.location.search);
  const requestedTab = params.get('tab');
  if (requestedTab) {
    const tabBtn = [...document.querySelectorAll('.profile-nav-btn')]
      .find((button) => button.getAttribute('data-tab') === requestedTab);
    if (tabBtn) tabBtn.click();
  } else {
    loadStatusOrders();
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
