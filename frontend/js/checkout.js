// Checkout Controller & Order Placement Flow
import { apiFetch } from './api.js';
import { showToast, escapeHtml, BURGER_PLACEHOLDER } from './ui.js';
import { getUser, setUser } from './auth.js';
import { getCheckedCartItems, hasStockIssue, fetchCart } from './cart.js';

let publicSettings = null;
let fulfillmentMethod = 'pickup'; // 'pickup' | 'delivery'
let paymentMethod = 'gcash'; // 'gcash' | 'pay_at_shop' | 'cod'
let isChangingContact = false;

export function isCheckoutAllowed() {
  const checked = getCheckedCartItems();
  return checked.length > 0 && !hasStockIssue();
}

export async function loadCheckoutSettings() {
  try {
    const res = await apiFetch('/settings/public');
    publicSettings = res.settings;
    renderFulfillmentOptions();
    renderPaymentOptions();
    updateReceipt();
  } catch (err) {
    showToast('Failed to load store settings.', 'error');
  }
}

export function updateReceipt() {
  const checkedItems = getCheckedCartItems();
  const summaryContainer = document.getElementById('receipt-items-summary');
  const subtotalElem = document.getElementById('receipt-subtotal');
  const deliveryRow = document.getElementById('receipt-delivery-row');
  const deliveryFeeElem = document.getElementById('receipt-delivery-fee');
  const totalElem = document.getElementById('receipt-total');
  const checkoutBtn = document.getElementById('open-checkout-btn');
  const stockWarningAlert = document.getElementById('receipt-stock-warning');

  let subtotal = 0;
  let itemsHtml = '';

  if (checkedItems.length === 0) {
    itemsHtml = '<p class="text-muted" style="font-size:0.85rem;">No items selected.</p>';
  } else {
    itemsHtml = checkedItems
      .map((item) => {
        const prod = item.product || {};
        let addonsSum = 0;
        let addonsText = '';
        if (item.addons && item.addons.length > 0) {
          const names = item.addons.map((a) => {
            const aPrice = (a.product ? a.product.price : 0) * (a.qty || 1);
            addonsSum += aPrice;
            return `${a.product ? a.product.name : 'Add-on'} (x${a.qty || 1})`;
          });
          addonsText = `<div style="font-size:0.75rem;color:var(--color-text-muted);padding-left:8px;">${names.join(', ')}</div>`;
        }

        const lineTotal = ((prod.price || 0) + addonsSum) * item.quantity;
        subtotal += lineTotal;

        return `
          <div class="receipt-summary-line">
            <div>
              <span>${escapeHtml(prod.name)} &times; ${item.quantity}</span>
              ${addonsText}
            </div>
            <span class="font-price">₱${lineTotal.toFixed(2)}</span>
          </div>
        `;
      })
      .join('');
  }

  if (summaryContainer) summaryContainer.innerHTML = itemsHtml;
  if (subtotalElem) subtotalElem.textContent = `₱${subtotal.toFixed(2)}`;

  let deliveryFee = 0;
  if (fulfillmentMethod === 'delivery' && publicSettings) {
    deliveryFee = publicSettings.deliveryFee || 30;
    if (deliveryRow) deliveryRow.classList.remove('hidden');
    if (deliveryFeeElem) deliveryFeeElem.textContent = `₱${deliveryFee.toFixed(2)}`;
  } else {
    if (deliveryRow) deliveryRow.classList.add('hidden');
  }

  const grandTotal = subtotal + deliveryFee;
  if (totalElem) totalElem.textContent = `₱${grandTotal.toFixed(2)}`;

  // Exact amount for GCash
  const gcashAmountElem = document.getElementById('gcash-exact-amount');
  if (gcashAmountElem) gcashAmountElem.textContent = `₱${grandTotal.toFixed(2)}`;

  // Stock warning
  const stockIssue = hasStockIssue();
  if (stockWarningAlert) {
    if (stockIssue) {
      stockWarningAlert.classList.remove('hidden');
    } else {
      stockWarningAlert.classList.add('hidden');
    }
  }

  if (checkoutBtn) {
    checkoutBtn.disabled = checkedItems.length === 0 || stockIssue;
  }

  const placeOrderBtn = document.getElementById('place-order-btn');
  if (placeOrderBtn) {
    placeOrderBtn.disabled = checkedItems.length === 0 || stockIssue;
  }
}

function renderFulfillmentOptions() {
  if (!publicSettings) return;

  const pickupTab = document.getElementById('tab-pickup');
  const deliveryTab = document.getElementById('tab-delivery');
  const addressGroup = document.getElementById('contact-address-group');

  if (pickupTab) {
    pickupTab.classList.toggle('active', fulfillmentMethod === 'pickup');
    pickupTab.style.display = publicSettings.pickupEnabled ? 'block' : 'none';
  }

  if (deliveryTab) {
    deliveryTab.classList.toggle('active', fulfillmentMethod === 'delivery');
    deliveryTab.style.display = publicSettings.deliveryEnabled ? 'block' : 'none';
  }

  if (addressGroup) {
    if (fulfillmentMethod === 'delivery') {
      addressGroup.classList.remove('hidden');
    } else {
      addressGroup.classList.add('hidden');
    }
  }

  renderPaymentOptions();
}

function renderPaymentOptions() {
  if (!publicSettings) return;

  const container = document.getElementById('payment-methods-container');
  if (!container) return;

  let optionsHtml = '';

  // GCash option
  if (publicSettings.gcashEnabled) {
    optionsHtml += `
      <label class="payment-option-label">
        <input type="radio" name="payment_method" value="gcash" ${paymentMethod === 'gcash' ? 'checked' : ''}>
        <div>
          <span style="font-weight:700;">GCash</span>
          <div style="font-size:0.78rem;color:var(--color-text-muted);">Scan QR & enter 13-digit reference number</div>
        </div>
      </label>
    `;
  }

  // Pickup specific option: Pay at shop
  if (fulfillmentMethod === 'pickup' && publicSettings.payAtShopEnabled) {
    optionsHtml += `
      <label class="payment-option-label">
        <input type="radio" name="payment_method" value="pay_at_shop" ${paymentMethod === 'pay_at_shop' ? 'checked' : ''}>
        <div>
          <span style="font-weight:700;">Pay at the Shop</span>
          <div style="font-size:0.78rem;color:var(--color-text-muted);">Pay in cash when you pick up your hot order</div>
        </div>
      </label>
    `;
  }

  // Delivery specific option: Cash on Delivery (COD)
  if (fulfillmentMethod === 'delivery' && publicSettings.codEnabled) {
    optionsHtml += `
      <label class="payment-option-label">
        <input type="radio" name="payment_method" value="cod" ${paymentMethod === 'cod' ? 'checked' : ''}>
        <div>
          <span style="font-weight:700;">Cash on Delivery (COD)</span>
          <div style="font-size:0.78rem;color:var(--color-text-muted);">Pay directly to the delivery rider</div>
        </div>
      </label>
    `;
  }

  container.innerHTML = optionsHtml;

  // Ensure selected payment method is valid for the current fulfillment
  const availableValues = Array.from(container.querySelectorAll('input[name="payment_method"]')).map((el) => el.value);
  if (!availableValues.includes(paymentMethod)) {
    paymentMethod = availableValues[0] || 'gcash';
    const checkedRadio = container.querySelector(`input[value="${paymentMethod}"]`);
    if (checkedRadio) checkedRadio.checked = true;
  }

  // GCash details box visibility
  const gcashBox = document.getElementById('gcash-payment-box');
  if (gcashBox) {
    if (paymentMethod === 'gcash') {
      gcashBox.classList.remove('hidden');
      const gName = document.getElementById('gcash-account-name');
      const gNum = document.getElementById('gcash-account-number');
      if (gName) gName.textContent = publicSettings.gcashName || 'Burger Shop HQ';
      if (gNum) gNum.textContent = publicSettings.gcashNumber || '09171234567';
    } else {
      gcashBox.classList.add('hidden');
    }
  }

  // Bind change events
  container.querySelectorAll('input[name="payment_method"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      paymentMethod = radio.value;
      if (gcashBox) {
        gcashBox.classList.toggle('hidden', paymentMethod !== 'gcash');
      }
    });
  });
}

function initContactDetails() {
  const user = getUser();
  const summaryBox = document.getElementById('saved-contact-summary');
  const formBox = document.getElementById('contact-form-fields');
  const nameInput = document.getElementById('contact-name-input');
  const phoneInput = document.getElementById('contact-phone-input');
  const addressInput = document.getElementById('contact-address-input');

  const hasSaved = user && user.fullName && user.phone;

  if (hasSaved && !isChangingContact) {
    if (summaryBox) {
      summaryBox.classList.remove('hidden');
      summaryBox.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <strong>${escapeHtml(user.fullName)}</strong> &bull; ${escapeHtml(user.phone)}
            ${user.address ? `<div style="font-size:0.82rem;color:var(--color-text-muted);margin-top:2px;">${escapeHtml(user.address)}</div>` : ''}
          </div>
          <button type="button" id="change-contact-btn" class="btn-link-action" style="font-size:0.8rem;">Change</button>
        </div>
      `;
      const changeBtn = document.getElementById('change-contact-btn');
      if (changeBtn) {
        changeBtn.addEventListener('click', () => {
          isChangingContact = true;
          initContactDetails();
        });
      }
    }
    if (formBox) formBox.classList.add('hidden');
    if (nameInput) nameInput.value = user.fullName || '';
    if (phoneInput) phoneInput.value = user.phone || '';
    if (addressInput) addressInput.value = user.address || '';
  } else {
    if (summaryBox) summaryBox.classList.add('hidden');
    if (formBox) formBox.classList.remove('hidden');
    if (user) {
      if (nameInput && !nameInput.value) nameInput.value = user.fullName || '';
      if (phoneInput && !phoneInput.value) phoneInput.value = user.phone || '';
      if (addressInput && !addressInput.value) addressInput.value = user.address || '';
    }
  }
}

async function handlePlaceOrder() {
  const checkedItems = getCheckedCartItems();
  if (checkedItems.length === 0) {
    showToast('Please select at least one item from your cart.', 'warning');
    return;
  }

  if (hasStockIssue()) {
    showToast('Some items in your cart exceed available stock. Please adjust quantities.', 'error');
    return;
  }

  const nameInput = document.getElementById('contact-name-input');
  const phoneInput = document.getElementById('contact-phone-input');
  const addressInput = document.getElementById('contact-address-input');
  const gcashRefInput = document.getElementById('gcash-reference-input');

  const fullName = nameInput ? nameInput.value.trim() : '';
  const phone = phoneInput ? phoneInput.value.trim() : '';
  const address = addressInput ? addressInput.value.trim() : '';
  const gcashReference = gcashRefInput ? gcashRefInput.value.trim() : '';

  if (!fullName || fullName.length < 2) {
    showToast('Please enter your full name.', 'warning');
    if (nameInput) nameInput.focus();
    return;
  }

  if (!phone) {
    showToast('Please enter your phone number.', 'warning');
    if (phoneInput) phoneInput.focus();
    return;
  }

  if (fulfillmentMethod === 'delivery') {
    const phPhoneRegex = /^(09\d{9}|\+639\d{9})$/;
    const cleanPhone = phone.replace(/[\s-]/g, '');
    if (!phPhoneRegex.test(cleanPhone)) {
      showToast('Please enter a valid Philippine mobile number (e.g. 09171234567).', 'warning');
      if (phoneInput) phoneInput.focus();
      return;
    }

    if (!address || address.length < 5) {
      showToast('Please provide your complete delivery address.', 'warning');
      if (addressInput) addressInput.focus();
      return;
    }
  }

  if (paymentMethod === 'gcash') {
    if (!gcashReference || !/^\d{13}$/.test(gcashReference)) {
      showToast('Please enter a valid 13-digit GCash reference number.', 'warning');
      if (gcashRefInput) gcashRefInput.focus();
      return;
    }
  }

  const placeOrderBtn = document.getElementById('place-order-btn');
  if (placeOrderBtn) {
    placeOrderBtn.disabled = true;
    placeOrderBtn.textContent = 'Processing Order...';
  }

  try {
    const payload = {
      cartItemIds: checkedItems.map((c) => c._id),
      fulfillment: fulfillmentMethod,
      paymentMethod,
      gcashReference: paymentMethod === 'gcash' ? gcashReference : '',
      contact: {
        fullName,
        phone,
        address: fulfillmentMethod === 'delivery' ? address : '',
      },
    };

    const res = await apiFetch('/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const order = res.order;

    // Update stored user details locally
    const currentUser = getUser();
    if (currentUser) {
      currentUser.fullName = fullName;
      currentUser.phone = phone;
      if (fulfillmentMethod === 'delivery') currentUser.address = address;
      setUser(currentUser);
    }

    showSuccessReceipt(order);
  } catch (err) {
    showToast(err.message, 'error');
    if (placeOrderBtn) {
      placeOrderBtn.disabled = false;
      placeOrderBtn.textContent = 'Place Order';
    }
  }
}

function showSuccessReceipt(order) {
  const cartLayout = document.getElementById('cart-layout-container');
  const successContainer = document.getElementById('order-success-screen');

  if (cartLayout) cartLayout.classList.add('hidden');
  if (successContainer) {
    successContainer.classList.remove('hidden');

    const itemsSummary = order.items
      .map((item) => {
        let addonsStr = '';
        if (item.addons && item.addons.length > 0) {
          addonsStr = `<div style="font-size:0.78rem;color:var(--color-text-muted);padding-left:10px;">${item.addons.map((a) => `+ ${escapeHtml(a.name)} (x${a.qty} @ ₱${a.price.toFixed(2)})`).join(', ')}</div>`;
        }
        return `
          <div style="display:flex;justify-content:space-between;padding:4px 0;">
            <div>
              <strong>${escapeHtml(item.name)}</strong> &times; ${item.quantity}
              ${addonsStr}
            </div>
            <span>₱${item.lineTotal.toFixed(2)}</span>
          </div>
        `;
      })
      .join('');

    successContainer.innerHTML = `
      <div class="order-success-card">
        <div style="width:56px;height:56px;border-radius:50%;background:#DCFCE7;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#166534" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <h2 style="font-size:1.6rem;color:var(--color-brand);margin-bottom:6px;">Order Placed Successfully!</h2>
        <p class="text-muted" style="margin-bottom:20px;">
          Thank you! Your order has been received and is being prepared.
        </p>

        <div class="printable-receipt" id="printable-order-receipt">
          <div style="text-align:center;padding-bottom:12px;border-bottom:1px dashed var(--color-border);margin-bottom:12px;">
            <h3 style="font-size:1.1rem;margin-bottom:2px;">BURGER SHOP</h3>
            <p style="font-size:0.8rem;color:var(--color-text-muted);margin:0;">Official Order Receipt</p>
            <p style="font-weight:700;color:var(--color-brand-secondary);margin-top:6px;font-size:1rem;">Order #${escapeHtml(order.orderNumber)}</p>
            <p style="font-size:0.78rem;color:var(--color-text-light);">${new Date(order.createdAt).toLocaleString()}</p>
          </div>

          <div style="margin-bottom:12px;">
            <div style="font-weight:600;font-size:0.85rem;margin-bottom:4px;">Customer Details:</div>
            <div><strong>Name:</strong> ${escapeHtml(order.contact.fullName)}</div>
            <div><strong>Phone:</strong> ${escapeHtml(order.contact.phone)}</div>
            ${order.fulfillment === 'delivery' ? `<div><strong>Delivery Address:</strong> ${escapeHtml(order.contact.address)}</div>` : ''}
            <div><strong>Fulfillment:</strong> ${order.fulfillment.toUpperCase()}</div>
            <div><strong>Payment Method:</strong> ${order.paymentMethod.toUpperCase().replace(/_/g, ' ')} (${order.paymentStatus.toUpperCase()})</div>
            ${order.gcashReference ? `<div><strong>GCash Ref:</strong> ${escapeHtml(order.gcashReference)}</div>` : ''}
          </div>

          <div style="border-top:1px dashed var(--color-border);padding-top:8px;margin-bottom:12px;">
            <div style="font-weight:600;font-size:0.85rem;margin-bottom:6px;">Ordered Items:</div>
            ${itemsSummary}
          </div>

          <div style="border-top:1px dashed var(--color-border);padding-top:8px;display:flex;flex-direction:column;gap:4px;">
            <div style="display:flex;justify-content:space-between;">
              <span>Subtotal:</span> <span>₱${order.subtotal.toFixed(2)}</span>
            </div>
            ${order.deliveryFee > 0 ? `
              <div style="display:flex;justify-content:space-between;">
                <span>Delivery Fee:</span> <span>₱${order.deliveryFee.toFixed(2)}</span>
              </div>
            ` : ''}
            <div style="display:flex;justify-content:space-between;font-weight:800;font-size:1.15rem;padding-top:6px;border-top:1px solid var(--color-border);color:var(--color-brand);">
              <span>Total Amount:</span> <span>₱${order.total.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div style="display:flex;gap:12px;justify-content:center;margin-top:24px;flex-wrap:wrap;">
          <button type="button" id="print-receipt-btn" class="btn btn-secondary btn-sm">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            Print Receipt
          </button>
          <a href="profile.html?tab=status" class="btn btn-primary btn-sm">
            Track Order in Status Tab
          </a>
        </div>
      </div>
    `;

    const printBtn = document.getElementById('print-receipt-btn');
    if (printBtn) {
      printBtn.addEventListener('click', () => {
        window.print();
      });
    }
  }
}

export function setupCheckoutListeners() {
  const pickupTab = document.getElementById('tab-pickup');
  const deliveryTab = document.getElementById('tab-delivery');
  const placeOrderBtn = document.getElementById('place-order-btn');

  if (pickupTab) {
    pickupTab.addEventListener('click', () => {
      fulfillmentMethod = 'pickup';
      renderFulfillmentOptions();
      updateReceipt();
    });
  }

  if (deliveryTab) {
    deliveryTab.addEventListener('click', () => {
      fulfillmentMethod = 'delivery';
      renderFulfillmentOptions();
      updateReceipt();
    });
  }

  if (placeOrderBtn) {
    placeOrderBtn.addEventListener('click', handlePlaceOrder);
  }

  loadCheckoutSettings();
  initContactDetails();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupCheckoutListeners);
} else {
  setupCheckoutListeners();
}
