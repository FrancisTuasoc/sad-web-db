// Checkout Controller & Order Placement Flow
import { apiFetch } from './api.js';
import { showToast, escapeHtml, BURGER_PLACEHOLDER, openModal, closeModal } from './ui.js';
import { getUser, setUser } from './auth.js';
import { getCheckedCartItems, hasStockIssue, fetchCart, flushPendingCartUpdates } from './cart.js';

let publicSettings = null;
let checkoutSettingsLoaded = false;
let fulfillmentMethod = null; // 'pickup' | 'delivery'
let paymentMethod = null; // 'gcash' | 'pay_at_shop' | 'cod'
let isChangingContact = false;
let selectedCartSubtotal = 0;
let checkoutModalReturnFocus = null;

const CONTACT_ADDRESS_FIELDS = ['street', 'barangay', 'city', 'province', 'postalCode'];

function splitSavedName(user) {
  const savedParts = String(user.fullName || '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: user.firstName || savedParts.shift() || '',
    lastName: user.lastName || savedParts.join(' '),
  };
}

function formatContactAddress(contact) {
  const parts = CONTACT_ADDRESS_FIELDS.map((field) => contact[field]).filter(Boolean);
  return parts.length ? parts.join(', ') : (contact.address || '');
}

function getAddressFields(prefix) {
  return Object.fromEntries(CONTACT_ADDRESS_FIELDS.map((field) => [
    field,
    document.getElementById(`${prefix}-${field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}-input`)?.value.trim() || '',
  ]));
}

function setAddressRequired(required) {
  CONTACT_ADDRESS_FIELDS.forEach((field) => {
    const inputId = `contact-${field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}-input`;
    const input = document.getElementById(inputId);
    if (input) input.required = required;
  });
}

export function isCheckoutAllowed() {
  const checked = getCheckedCartItems();
  return checkoutSettingsLoaded
    && Boolean(publicSettings && publicSettings.acceptingOrders)
    && checked.length > 0
    && !hasStockIssue()
    && (!publicSettings.minimumOrder || selectedCartSubtotal >= publicSettings.minimumOrder);
}

export async function loadCheckoutSettings() {
  try {
    const res = await apiFetch('/settings/public');
    publicSettings = res.settings;
    checkoutSettingsLoaded = true;
    if (
      (fulfillmentMethod === 'pickup' && !publicSettings.pickupEnabled)
      || (fulfillmentMethod === 'delivery' && !publicSettings.deliveryEnabled)
    ) {
      fulfillmentMethod = null;
      paymentMethod = null;
    }
    renderFulfillmentOptions();
    renderPaymentOptions();
    updateReceipt();
  } catch (err) {
    checkoutSettingsLoaded = false;
    publicSettings = null;
    showToast(`Failed to load store settings: ${err.message}`, 'error');
    updateReceipt();
  }
}

function showCheckoutStep(step) {
  document.getElementById('checkout-step-fulfillment')?.classList.toggle('hidden', step !== 1);
  document.getElementById('checkout-step-contact')?.classList.toggle('hidden', step < 2);
  document.getElementById('contact-step-actions')?.classList.toggle('hidden', step < 2);
  document.getElementById('checkout-step-payment')?.classList.toggle('hidden', step < 3);
  document.getElementById('payment-step-actions')?.classList.toggle('hidden', step < 3);
  document.getElementById('continue-contact-btn')?.classList.toggle('hidden', step !== 1);
  document.getElementById('place-order-btn')?.classList.toggle('hidden', step !== 3);
  document.querySelectorAll('[data-checkout-progress]').forEach((indicator) => {
    const indicatorStep = Number(indicator.getAttribute('data-checkout-progress'));
    indicator.classList.toggle('active', indicatorStep === step);
    indicator.classList.toggle('completed', indicatorStep < step);
    indicator.setAttribute('aria-label', `Step ${indicatorStep} of 3`);
    if (indicatorStep === step) indicator.setAttribute('aria-current', 'step');
    else indicator.removeAttribute('aria-current');
  });
  updateReceipt();
}

function closeCheckoutModal(restoreFocus = true) {
  const modal = document.getElementById('checkout-modal');
  if (!modal) return;
  closeModal('checkout-modal');
  modal.setAttribute('aria-hidden', 'true');
  if (restoreFocus && checkoutModalReturnFocus instanceof HTMLElement) {
    checkoutModalReturnFocus.focus();
  }
}

async function openCheckoutModal() {
  if (!isCheckoutAllowed()) {
    updateReceipt();
    return;
  }

  const currentUser = getUser();
  if (currentUser) {
    try {
      const res = await apiFetch('/profile');
      const latestUser = getUser() || currentUser;
      setUser({
        ...latestUser,
        contactEmail: res.profile.contactEmail || res.profile.email,
        firstName: res.profile.firstName,
        lastName: res.profile.lastName,
        fullName: res.profile.fullName,
        phone: res.profile.phone,
        street: res.profile.street,
        barangay: res.profile.barangay,
        city: res.profile.city,
        province: res.profile.province,
        postalCode: res.profile.postalCode,
        address: res.profile.address,
      });
    } catch (err) {
      showToast(`Failed to load your saved contact details: ${err.message}`, 'error');
      return;
    }
  }

  initContactDetails();
  const modal = document.getElementById('checkout-modal');
  if (!modal) return;
  checkoutModalReturnFocus = document.getElementById('open-checkout-btn');
  modal.setAttribute('aria-hidden', 'false');
  openModal('checkout-modal');
  showCheckoutStep(1);
  document.getElementById('close-checkout-modal')?.focus();
}

function validateContactDetails() {
  const firstNameInput = document.getElementById('contact-first-name-input');
  const lastNameInput = document.getElementById('contact-last-name-input');
  const emailInput = document.getElementById('contact-email-input');
  const phoneInput = document.getElementById('contact-phone-input');
  const firstName = firstNameInput?.value.trim() || '';
  const lastName = lastNameInput?.value.trim() || '';
  const email = emailInput?.value.trim().toLowerCase() || '';
  const phone = phoneInput?.value.trim() || '';

  if (!firstName) {
    showToast('Please enter your first name.', 'warning');
    firstNameInput?.focus();
    return false;
  }
  if (!lastName) {
    showToast('Please enter your last name.', 'warning');
    lastNameInput?.focus();
    return false;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showToast('Please enter a valid email address.', 'warning');
    emailInput?.focus();
    return false;
  }
  if (!/^(09\d{9}|\+639\d{9})$/.test(phone.replace(/[\s-]/g, ''))) {
    showToast('Please enter a valid Philippine mobile number (e.g. 09171234567).', 'warning');
    phoneInput?.focus();
    return false;
  }
  if (fulfillmentMethod === 'delivery') {
    const address = getAddressFields('contact');
    for (const field of CONTACT_ADDRESS_FIELDS) {
      if (!address[field]) {
        const inputId = `contact-${field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}-input`;
        showToast(`Please enter your ${field === 'postalCode' ? '4-digit postal code' : field}.`, 'warning');
        document.getElementById(inputId)?.focus();
        return false;
      }
    }
    if (!/^\d{4}$/.test(address.postalCode)) {
      showToast('Your postal code must contain exactly 4 digits.', 'warning');
      document.getElementById('contact-postal-code-input')?.focus();
      return false;
    }
  }
  return true;
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
            const quantityLabel = item.addonQuantityMode === 'per_order' ? 'for order' : 'per item';
            return `${a.product ? a.product.name : 'Add-on'} (x${a.qty || 1} ${quantityLabel})`;
          });
          addonsText = `<div style="font-size:0.75rem;color:var(--color-text-muted);padding-left:8px;">${names.join(', ')}</div>`;
        }

        const addonTotal = item.addonQuantityMode === 'per_order'
          ? addonsSum
          : addonsSum * item.quantity;
        const lineTotal = (prod.price || 0) * item.quantity + addonTotal;
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
    deliveryFee = Number.isFinite(Number(publicSettings.deliveryFee))
      ? Number(publicSettings.deliveryFee)
      : 30;
    if (deliveryRow) deliveryRow.classList.remove('hidden');
    if (deliveryFeeElem) deliveryFeeElem.textContent = `₱${deliveryFee.toFixed(2)}`;
  } else {
    if (deliveryRow) deliveryRow.classList.add('hidden');
  }

  const grandTotal = subtotal + deliveryFee;
  selectedCartSubtotal = subtotal;
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

  const storeAcceptingOrders = checkoutSettingsLoaded
    && Boolean(publicSettings && publicSettings.acceptingOrders);
  const hasFulfillmentOption = Boolean(
    publicSettings && (publicSettings.pickupEnabled || publicSettings.deliveryEnabled)
  );
  const orderingAvailable = storeAcceptingOrders && hasFulfillmentOption;
  if (checkoutBtn) {
    checkoutBtn.disabled = checkedItems.length === 0
      || stockIssue
      || !isCheckoutAllowed()
      || !orderingAvailable;
  }

  const storeNotice = document.getElementById('checkout-store-notice');
  if (storeNotice) {
    storeNotice.classList.toggle('hidden', orderingAvailable);
    storeNotice.textContent = !checkoutSettingsLoaded
      ? 'Online ordering availability could not be confirmed. Please try again later.'
      : !storeAcceptingOrders
        ? 'Online ordering is temporarily paused. You can keep your cart and check back later; existing orders are not affected.'
        : 'Online ordering is temporarily unavailable because pickup and delivery are both disabled.';
  }

  const minimumOrder = Number(publicSettings && publicSettings.minimumOrder) || 0;
  const minimumNotice = document.getElementById('checkout-minimum-notice');
  const belowMinimum = orderingAvailable
    && checkedItems.length > 0
    && minimumOrder > 0
    && subtotal < minimumOrder;
  if (minimumNotice) {
    minimumNotice.classList.toggle('hidden', !belowMinimum);
    minimumNotice.textContent = belowMinimum
      ? `Your selected items total ₱${subtotal.toFixed(2)}. Add ₱${(minimumOrder - subtotal).toFixed(2)} more to meet the ₱${minimumOrder.toFixed(2)} minimum order.`
      : '';
  }

  const pickupTab = document.getElementById('tab-pickup');
  const deliveryTab = document.getElementById('tab-delivery');
  const continueContactBtn = document.getElementById('continue-contact-btn');
  const continuePaymentBtn = document.getElementById('continue-payment-btn');
  if (pickupTab) pickupTab.disabled = !orderingAvailable || !publicSettings || !publicSettings.pickupEnabled;
  if (deliveryTab) deliveryTab.disabled = !orderingAvailable || !publicSettings || !publicSettings.deliveryEnabled;
  if (continueContactBtn) continueContactBtn.disabled = !orderingAvailable;
  if (continuePaymentBtn) continuePaymentBtn.disabled = !orderingAvailable;

  const placeOrderBtn = document.getElementById('place-order-btn');
  if (placeOrderBtn) {
    placeOrderBtn.disabled = checkedItems.length === 0
      || stockIssue
      || !paymentMethod
      || !orderingAvailable
      || belowMinimum;
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
    pickupTab.disabled = !publicSettings.acceptingOrders || !publicSettings.pickupEnabled;
  }

  if (deliveryTab) {
    deliveryTab.classList.toggle('active', fulfillmentMethod === 'delivery');
    deliveryTab.style.display = publicSettings.deliveryEnabled ? 'block' : 'none';
    deliveryTab.disabled = !publicSettings.acceptingOrders || !publicSettings.deliveryEnabled;
  }

  if (addressGroup) {
    if (fulfillmentMethod === 'delivery') {
      addressGroup.classList.remove('hidden');
    } else {
      addressGroup.classList.add('hidden');
    }
  }
  setAddressRequired(fulfillmentMethod === 'delivery');

  renderPaymentOptions();
}

function renderPaymentOptions() {
  if (!publicSettings) return;

  const container = document.getElementById('payment-methods-container');
  if (!container) return;

  if (!fulfillmentMethod) {
    container.innerHTML = '<p class="text-muted">Choose pickup or delivery first.</p>';
    document.getElementById('gcash-payment-box')?.classList.add('hidden');
    document.getElementById('pay-at-shop-arrival-note')?.classList.add('hidden');
    paymentMethod = null;
    return;
  }

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
    paymentMethod = null;
  }

  // GCash details box visibility
  const gcashBox = document.getElementById('gcash-payment-box');
  if (gcashBox) {
    if (paymentMethod === 'gcash') {
      gcashBox.classList.remove('hidden');
      const gName = document.getElementById('gcash-account-name');
      const gNum = document.getElementById('gcash-account-number');
      if (gName) gName.textContent = publicSettings.gcashName || 'Not provided';
      if (gNum) gNum.textContent = publicSettings.gcashNumber || 'Not provided';
    } else {
      gcashBox.classList.add('hidden');
    }
  }
  document.getElementById('pay-at-shop-arrival-note')
    ?.classList.toggle('hidden', paymentMethod !== 'pay_at_shop');
  if (availableValues.length === 0) {
    container.innerHTML = '<p class="text-muted">No payment methods are currently available for this order type. Please contact the shop.</p>';
  }

  // Bind change events
  container.querySelectorAll('input[name="payment_method"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      paymentMethod = radio.value;
      if (gcashBox) {
        gcashBox.classList.toggle('hidden', paymentMethod !== 'gcash');
      }
      document.getElementById('pay-at-shop-arrival-note')
        ?.classList.toggle('hidden', paymentMethod !== 'pay_at_shop');
      updateReceipt();
    });
  });
}

function initContactDetails() {
  const user = getUser();
  const summaryBox = document.getElementById('saved-contact-summary');
  const formBox = document.getElementById('contact-form-fields');
  const firstNameInput = document.getElementById('contact-first-name-input');
  const lastNameInput = document.getElementById('contact-last-name-input');
  const emailInput = document.getElementById('contact-email-input');
  const phoneInput = document.getElementById('contact-phone-input');
  const addressFields = user ? Object.fromEntries(CONTACT_ADDRESS_FIELDS.map((field) => [field, user[field] || ''])) : {};
  const { firstName, lastName } = user ? splitSavedName(user) : { firstName: '', lastName: '' };

  const hasSaved = user
    && firstName
    && lastName
    && (user.contactEmail || user.email)
    && user.phone
    && (fulfillmentMethod !== 'delivery'
      || CONTACT_ADDRESS_FIELDS.every((field) => addressFields[field])
        && /^\d{4}$/.test(addressFields.postalCode));

  if (hasSaved && !isChangingContact) {
    if (summaryBox) {
      summaryBox.classList.remove('hidden');
      summaryBox.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <div style="font-size:0.78rem;color:var(--color-text-muted);margin-bottom:3px;">Saved account details</div>
            <strong>${escapeHtml([firstName, lastName].join(' '))}</strong>
            <div style="font-size:0.82rem;color:var(--color-text-muted);">${escapeHtml(user.contactEmail || user.email)} &bull; ${escapeHtml(user.phone)}</div>
            ${formatContactAddress({ ...addressFields, address: user.address }) ? `<div style="font-size:0.82rem;color:var(--color-text-muted);margin-top:2px;">${escapeHtml(formatContactAddress({ ...addressFields, address: user.address }))}</div>` : ''}
          </div>
          <button type="button" id="change-contact-btn" class="btn-link-action" style="font-size:0.8rem;">Change for this order</button>
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
    if (firstNameInput) firstNameInput.value = firstName;
    if (lastNameInput) lastNameInput.value = lastName;
    if (emailInput) emailInput.value = user.contactEmail || user.email || '';
    if (phoneInput) phoneInput.value = user.phone || '';
    CONTACT_ADDRESS_FIELDS.forEach((field) => {
      const inputId = `contact-${field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}-input`;
      const input = document.getElementById(inputId);
      if (input) input.value = addressFields[field]
        || (field === 'street' && fulfillmentMethod === 'delivery' ? user.address || '' : '');
    });
  } else {
    if (summaryBox) summaryBox.classList.add('hidden');
    if (formBox) formBox.classList.remove('hidden');
    if (user) {
      if (firstNameInput && !firstNameInput.value) firstNameInput.value = firstName;
      if (lastNameInput && !lastNameInput.value) lastNameInput.value = lastName;
      if (emailInput && !emailInput.value) emailInput.value = user.contactEmail || user.email || '';
      if (phoneInput && !phoneInput.value) phoneInput.value = user.phone || '';
      CONTACT_ADDRESS_FIELDS.forEach((field) => {
        const inputId = `contact-${field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}-input`;
        const input = document.getElementById(inputId);
        if (input && !input.value) {
          input.value = addressFields[field]
            || (field === 'street' && fulfillmentMethod === 'delivery' ? user.address || '' : '');
        }
      });
    }
  }
}

async function handlePlaceOrder() {
  if (!isCheckoutAllowed()) {
    const minimumOrder = Number(publicSettings && publicSettings.minimumOrder) || 0;
    if (minimumOrder > selectedCartSubtotal) {
      showToast(`Your selected items must total at least ₱${minimumOrder.toFixed(2)}.`, 'warning');
    } else {
      showToast('Online ordering is currently unavailable. Please check the store status and try again later.', 'warning');
    }
    return;
  }
  if (!fulfillmentMethod) {
    showToast('Please choose pickup or delivery first.', 'warning');
    showCheckoutStep(1);
    return;
  }
  if (!paymentMethod) {
    showToast('Please choose a payment method.', 'warning');
    showCheckoutStep(3);
    return;
  }

  const checkedItems = getCheckedCartItems();
  if (checkedItems.length === 0) {
    showToast('Please select at least one item from your cart.', 'warning');
    return;
  }

  if (hasStockIssue()) {
    showToast('Some items in your cart exceed available stock. Please adjust quantities.', 'error');
    return;
  }

  const firstNameInput = document.getElementById('contact-first-name-input');
  const lastNameInput = document.getElementById('contact-last-name-input');
  const emailInput = document.getElementById('contact-email-input');
  const phoneInput = document.getElementById('contact-phone-input');
  const gcashRefInput = document.getElementById('gcash-reference-input');

  const firstName = firstNameInput ? firstNameInput.value.trim() : '';
  const lastName = lastNameInput ? lastNameInput.value.trim() : '';
  const email = emailInput ? emailInput.value.trim().toLowerCase() : '';
  const phone = phoneInput ? phoneInput.value.trim() : '';
  const addressFields = getAddressFields('contact');
  const fullName = [firstName, lastName].filter(Boolean).join(' ');
  const address = formatContactAddress(addressFields);
  const gcashReference = gcashRefInput ? gcashRefInput.value.trim() : '';

  if (!validateContactDetails()) {
    showCheckoutStep(2);
    return;
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
    placeOrderBtn.textContent = 'Syncing Cart...';
  }

  try {
    const cartSynced = await flushPendingCartUpdates();
    if (!cartSynced) {
      if (placeOrderBtn) {
        placeOrderBtn.disabled = false;
        placeOrderBtn.textContent = 'Place Order';
      }
      return;
    }
  } catch (err) {
    showToast(err.message, 'error');
    if (placeOrderBtn) {
      placeOrderBtn.disabled = false;
      placeOrderBtn.textContent = 'Place Order';
    }
    return;
  }

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
        firstName,
        lastName,
        fullName,
        email,
        phone,
        ...addressFields,
        address,
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
      currentUser.firstName = firstName;
      currentUser.lastName = lastName;
      currentUser.fullName = fullName;
      currentUser.contactEmail = email;
      currentUser.phone = phone;
      CONTACT_ADDRESS_FIELDS.forEach((field) => {
        if (addressFields[field]) currentUser[field] = addressFields[field];
      });
      if (address) currentUser.address = address;
      setUser(currentUser);
    }
    isChangingContact = false;
    initContactDetails();

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
  closeCheckoutModal(false);
  document.getElementById('cart-page-intro')?.classList.add('hidden');
  const cartLayout = document.getElementById('cart-layout-container');
  const successContainer = document.getElementById('order-success-screen');

  if (cartLayout) cartLayout.classList.add('hidden');
  if (successContainer) {
    successContainer.classList.remove('hidden');

    const itemsSummary = order.items
      .map((item) => {
        const addons = item.addons && item.addons.length > 0
          ? `<ul class="receipt-item-addons">${item.addons.map((addon) => {
            const quantityLabel = item.addonQuantityMode === 'per_order' ? 'for order' : 'per item';
            return `<li>+ ${escapeHtml(addon.name)} · x${addon.qty} ${quantityLabel} · ₱${addon.price.toFixed(2)}</li>`;
          }).join('')}</ul>`
          : '';
        return `
          <div class="receipt-item">
            <div class="receipt-item-description">
              <strong>${escapeHtml(item.name)}</strong>
              <span>Quantity ${item.quantity}</span>
              ${addons}
            </div>
            <strong class="receipt-item-price">₱${item.lineTotal.toFixed(2)}</strong>
          </div>
        `;
      })
      .join('');
    const createdAt = new Date(order.createdAt);
    const totalLabel = order.paymentStatus === 'unpaid' && order.paymentMethod === 'pay_at_shop'
      ? 'Total due at pickup'
      : order.paymentStatus === 'unpaid' && order.paymentMethod === 'cod'
        ? 'Total due on delivery'
        : 'Total amount';

    successContainer.innerHTML = `
      <div class="order-success-card">
        <div class="order-success-heading">
          <div class="order-success-icon" aria-hidden="true">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <p class="order-success-eyebrow">Order confirmed</p>
          <h2>Thanks for your order!</h2>
          <p class="order-success-message">
            ${order.paymentMethod === 'pay_at_shop'
    ? 'We will start preparing your order when you arrive at the shop. Please arrive within 1 hour of placing your order; otherwise, it will be cancelled automatically.'
    : 'Your order is pending admin acceptance. You can cancel it from your account while it is still pending.'}
          </p>
          <div class="order-success-reference">
            <span>Order number</span>
            <strong>#${escapeHtml(order.orderNumber)}</strong>
            <time datetime="${escapeHtml(order.createdAt)}">${createdAt.toLocaleString()}</time>
          </div>
        </div>

        <div class="printable-receipt" id="printable-order-receipt">
          <div class="receipt-document-header">
            <div class="receipt-store-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h16l-1.2 10H5.2L4 10Z"/><path d="M3 10 5 4h14l2 6M9 20v-6h6v6M8 7v2M12 7v2M16 7v2"/></svg>
            </div>
            <div class="receipt-store-name">
              <span class="receipt-document-eyebrow">Official order receipt</span>
              <h3>${escapeHtml(publicSettings && typeof publicSettings.storeName === 'string' ? publicSettings.storeName : 'Burger Shop')}</h3>
            </div>
            <div class="receipt-document-number">
              <span>Order</span>
              <strong>#${escapeHtml(order.orderNumber)}</strong>
            </div>
          </div>

          <div class="receipt-meta">
            <span><small>Placed</small><strong>${createdAt.toLocaleString()}</strong></span>
            <span><small>Fulfillment</small><strong>${escapeHtml(order.fulfillment.toUpperCase())}</strong></span>
            <span><small>Payment</small><strong>${escapeHtml(order.paymentMethod.toUpperCase().replace(/_/g, ' '))} · ${escapeHtml(order.paymentStatus.toUpperCase())}</strong></span>
          </div>

          <section class="receipt-customer">
            <h4>Customer details</h4>
            <div class="receipt-customer-grid">
              <div><span>Name</span><strong>${escapeHtml(order.contact.fullName)}</strong></div>
              <div><span>Phone</span><strong>${escapeHtml(order.contact.phone)}</strong></div>
              ${order.contact.email ? `<div><span>Email</span><strong>${escapeHtml(order.contact.email)}</strong></div>` : ''}
              ${order.fulfillment === 'delivery' ? `<div class="receipt-address"><span>Delivery address</span><strong>${escapeHtml(order.contact.address)}</strong></div>` : ''}
              ${order.gcashReference ? `<div><span>GCash reference</span><strong>${escapeHtml(order.gcashReference)}</strong></div>` : ''}
            </div>
          </section>

          <section class="receipt-items">
            <h4>Order summary</h4>
            ${itemsSummary}
          </section>

          <div class="receipt-totals">
            <div><span>Subtotal</span><strong>₱${order.subtotal.toFixed(2)}</strong></div>
            ${order.deliveryFee > 0 ? `
              <div><span>Delivery fee</span><strong>₱${order.deliveryFee.toFixed(2)}</strong></div>
            ` : ''}
            <div class="receipt-grand-total">
              <span>${totalLabel}</span>
              <strong>₱${order.total.toFixed(2)}</strong>
            </div>
          </div>
          <p class="receipt-thank-you">Thank you for choosing us. We hope you enjoy every bite!</p>
          <span class="receipt-print-date">Printed ${new Date().toLocaleString()}</span>
        </div>

        <div class="receipt-actions">
          <button type="button" id="print-receipt-btn" class="btn btn-secondary">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            Print receipt
          </button>
          <a href="profile.html?tab=status" class="btn btn-primary">Track your order</a>
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
  const checkoutBtn = document.getElementById('open-checkout-btn');
  const checkoutModal = document.getElementById('checkout-modal');
  const closeCheckoutBtn = document.getElementById('close-checkout-modal');
  const pickupTab = document.getElementById('tab-pickup');
  const deliveryTab = document.getElementById('tab-delivery');
  const placeOrderBtn = document.getElementById('place-order-btn');
  const continueContactBtn = document.getElementById('continue-contact-btn');
  const continuePaymentBtn = document.getElementById('continue-payment-btn');
  const backFulfillmentBtn = document.getElementById('back-fulfillment-btn');
  const backContactBtn = document.getElementById('back-contact-btn');

  if (checkoutBtn) checkoutBtn.addEventListener('click', openCheckoutModal);
  if (closeCheckoutBtn) closeCheckoutBtn.addEventListener('click', () => closeCheckoutModal());
  if (checkoutModal) {
    checkoutModal.addEventListener('click', (event) => {
      if (event.target === checkoutModal) closeCheckoutModal();
    });
  }
  document.addEventListener('keydown', (event) => {
    if (!checkoutModal || !checkoutModal.classList.contains('open')) return;
    if (event.key === 'Escape') {
      closeCheckoutModal();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = Array.from(checkoutModal.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.getClientRects().length > 0);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!checkoutModal.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  if (pickupTab) {
    pickupTab.addEventListener('click', () => {
      fulfillmentMethod = 'pickup';
      renderFulfillmentOptions();
      initContactDetails();
      updateReceipt();
    });
  }

  if (deliveryTab) {
    deliveryTab.addEventListener('click', () => {
      fulfillmentMethod = 'delivery';
      renderFulfillmentOptions();
      initContactDetails();
      updateReceipt();
    });
  }

  if (continueContactBtn) {
    continueContactBtn.addEventListener('click', () => {
      if (!fulfillmentMethod) {
        showToast('Choose pickup or delivery to continue.', 'warning');
        return;
      }
      showCheckoutStep(2);
    });
  }
  if (continuePaymentBtn) {
    continuePaymentBtn.addEventListener('click', () => {
      if (!validateContactDetails()) return;
      renderPaymentOptions();
      showCheckoutStep(3);
    });
  }
  if (backFulfillmentBtn) backFulfillmentBtn.addEventListener('click', () => showCheckoutStep(1));
  if (backContactBtn) backContactBtn.addEventListener('click', () => showCheckoutStep(2));

  [
    'contact-first-name-input',
    'contact-last-name-input',
    'contact-email-input',
    'contact-phone-input',
    ...CONTACT_ADDRESS_FIELDS.map((field) => `contact-${field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}-input`),
  ].forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.addEventListener('input', updateReceipt);
  });

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
