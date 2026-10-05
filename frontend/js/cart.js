// Cart Management and Dynamic Rendering
import { apiFetch } from './api.js';
import { renderHeader, renderFooter, showToast, BURGER_PLACEHOLDER, escapeHtml, openModal, closeModal, updateCartBadge, getProductImageUrl } from './ui.js';
import { requireAuth } from './auth.js';
import { updateReceipt } from './checkout.js';

let cartItems = [];
let checkedItemIds = new Set();
const debounceSyncTimers = new Map();
const pendingQuantities = new Map();
const quantitySyncPromises = new Map();
let editingCartItem = null;
let allAddons = [];
let pendingCartDeletion = null;

export function getCheckedCartItems() {
  return cartItems.filter((item) => checkedItemIds.has(item._id));
}

export function hasStockIssue() {
  const checkedItems = getCheckedCartItems();
  const addonUsage = new Map();
  for (const item of checkedItems) {
    if (!item.product || !item.product.isAvailable || item.product.stock < item.quantity) {
      return true;
    }
    if (item.addons && Array.isArray(item.addons)) {
      for (const a of item.addons) {
        const addonQuantity = item.addonQuantityMode === 'per_order'
          ? a.qty
          : a.qty * item.quantity;
        if (!a.product || !a.product.isAvailable) {
          return true;
        }
        const addonId = String(a.product._id || a.product);
        const current = addonUsage.get(addonId) || { quantity: 0, stock: a.product.stock };
        current.quantity += addonQuantity;
        addonUsage.set(addonId, current);
      }
    }
  }
  return [...addonUsage.values()].some((addon) => addon.quantity > addon.stock);
}

export async function fetchCart() {
  const container = document.getElementById('cart-items-container');
  if (!container) return;

  try {
    const data = await apiFetch('/cart');
    cartItems = data.items || [];

    // Pre-check all items by default on initial load
    if (checkedItemIds.size === 0 && cartItems.length > 0) {
      cartItems.forEach((item) => checkedItemIds.add(item._id));
    } else {
      // Remove stale checked IDs
      const currentIds = new Set(cartItems.map((c) => c._id));
      for (const id of checkedItemIds) {
        if (!currentIds.has(id)) checkedItemIds.delete(id);
      }
    }

    renderCartLines();
    updateReceipt();
    updateCartBadge();
  } catch (err) {
    container.innerHTML = `
      <div class="state-box">
        <h4 class="state-title">Unable to load your cart</h4>
        <p class="state-desc">${escapeHtml(err.message)}</p>
        <button id="retry-cart-btn" class="btn btn-secondary btn-sm">Try Again</button>
      </div>
    `;
    const retryBtn = document.getElementById('retry-cart-btn');
    if (retryBtn) retryBtn.addEventListener('click', fetchCart);
  }
}

export function renderCartLines() {
  const container = document.getElementById('cart-items-container');
  const selectAllCb = document.getElementById('select-all-checkbox');
  const emptyState = document.getElementById('cart-empty-state');
  const cartContent = document.getElementById('cart-content-wrapper');

  if (!container) return;

  if (cartItems.length === 0) {
    if (emptyState) emptyState.classList.remove('hidden');
    if (cartContent) cartContent.classList.add('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');
  if (cartContent) cartContent.classList.remove('hidden');

  const allChecked = cartItems.length > 0 && cartItems.every((item) => checkedItemIds.has(item._id));
  if (selectAllCb) selectAllCb.checked = allChecked;
  const addonUsage = new Map();
  for (const item of cartItems) {
    for (const addon of item.addons || []) {
      const addonId = String(addon.product && addon.product._id ? addon.product._id : addon.product);
      const quantity = item.addonQuantityMode === 'per_order'
        ? addon.qty
        : addon.qty * item.quantity;
      const current = addonUsage.get(addonId) || {
        quantity: 0,
        stock: addon.product && addon.product.stock,
        name: addon.product && addon.product.name,
      };
      current.quantity += quantity;
      addonUsage.set(addonId, current);
    }
  }

  container.innerHTML = cartItems
    .map((item) => {
      const isChecked = checkedItemIds.has(item._id);
      const prod = item.product || {};
      const imgUrl = getProductImageUrl(prod);

      // Check stock warnings
      let stockWarning = '';
      let isBlocked = false;

      if (!prod.isAvailable) {
        stockWarning = '<div class="text-danger" style="font-size:0.75rem;font-weight:700;">Item is no longer available!</div>';
        isBlocked = true;
      } else if (prod.stock < item.quantity) {
        stockWarning = `<div class="text-danger" style="font-size:0.75rem;font-weight:700;">Only ${prod.stock} left in stock (you have ${item.quantity}). Please decrease quantity.</div>`;
        isBlocked = true;
      }

      // Addons calculation
      let addonsPriceTotal = 0;
      let addonsDisplay = '';
      if (item.addons && item.addons.length > 0) {
        const addonStrs = item.addons.map((a) => {
          const aProd = a.product || {};
          const singleTotal = (aProd.price || 0) * (a.qty || 1);
          addonsPriceTotal += singleTotal;

          const addonQuantity = item.addonQuantityMode === 'per_order'
            ? (a.qty || 1)
            : (a.qty || 1) * item.quantity;
          const totalAddonUsage = addonUsage.get(String(aProd._id || a.product));
          if (totalAddonUsage && totalAddonUsage.quantity > aProd.stock) {
            stockWarning += `<div class="text-danger" style="font-size:0.75rem;font-weight:700;">Your cart has ${totalAddonUsage.quantity} of "${escapeHtml(aProd.name)}", but only ${aProd.stock} are in stock.</div>`;
            isBlocked = true;
          }

          const quantityLabel = item.addonQuantityMode === 'per_order'
            ? `x${a.qty || 1} for order`
            : `x${a.qty || 1} per item`;
          return `+ ${escapeHtml(aProd.name || 'Add-on')} (${quantityLabel} • ₱${singleTotal.toFixed(2)})`;
        });
        addonsDisplay = `<div class="cart-item-addons-list">${addonStrs.join('<br>')}</div>`;
      }

      const addonTotal = item.addonQuantityMode === 'per_order'
        ? addonsPriceTotal
        : addonsPriceTotal * item.quantity;
      const lineTotal = (prod.price || 0) * item.quantity + addonTotal;

      return `
        <div class="cart-line-item ${isBlocked ? 'stock-warning-line' : ''}" data-line-id="${item._id}">
          <input type="checkbox" class="line-checkbox" data-line-id="${item._id}" ${isChecked ? 'checked' : ''} aria-label="Select ${escapeHtml(prod.name)}">
          <div class="cart-item-img">
            <img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(prod.name)}" onerror="if(window.handleImageError){window.handleImageError(this);}else{this.onerror=null;this.src='${BURGER_PLACEHOLDER}';}">
          </div>
          <div class="cart-item-details">
            <span class="cart-item-name">${escapeHtml(prod.name)}</span>
            <div style="font-size:0.82rem;color:var(--color-text-muted);">Base: ₱${(prod.price || 0).toFixed(2)}</div>
            ${addonsDisplay}
            ${stockWarning}
            <div class="cart-item-actions">
              <button type="button" class="btn-link-action btn-edit-addons" data-line-id="${item._id}">Edit add-ons</button>
              <button type="button" class="btn-link-action btn-remove-line" data-line-id="${item._id}" style="color:var(--color-danger);">Remove</button>
            </div>
          </div>
          <div class="cart-item-right">
            <span class="cart-item-price">₱${lineTotal.toFixed(2)}</span>
            <div class="qty-stepper">
              <button type="button" class="stepper-btn stepper-cart-minus" data-line-id="${item._id}">-</button>
              <span class="stepper-val line-qty-val">${item.quantity}</span>
              <button type="button" class="stepper-btn stepper-cart-plus" data-line-id="${item._id}">+</button>
            </div>
          </div>
        </div>
      `;
    })
    .join('');
}

// Debounced Server Synchronization for Quantity Changes
async function syncQuantityToServer(cartItemId) {
  const timer = debounceSyncTimers.get(cartItemId);
  if (timer) clearTimeout(timer);
  debounceSyncTimers.delete(cartItemId);

  const inFlightSync = quantitySyncPromises.get(cartItemId);
  if (inFlightSync) return inFlightSync;
  if (!pendingQuantities.has(cartItemId)) return true;

  const syncPromise = (async () => {
    while (pendingQuantities.has(cartItemId)) {
      const quantity = pendingQuantities.get(cartItemId);
      pendingQuantities.delete(cartItemId);

      try {
        await apiFetch(`/cart/${cartItemId}`, {
          method: 'PATCH',
          body: JSON.stringify({ quantity }),
        });
        updateCartBadge();
      } catch (err) {
        const pendingTimer = debounceSyncTimers.get(cartItemId);
        if (pendingTimer) clearTimeout(pendingTimer);
        debounceSyncTimers.delete(cartItemId);
        pendingQuantities.delete(cartItemId);
        showToast(err.message, 'error');
        await fetchCart();
        return false;
      }
    }

    return true;
  })();

  quantitySyncPromises.set(cartItemId, syncPromise);
  try {
    return await syncPromise;
  } finally {
    if (quantitySyncPromises.get(cartItemId) === syncPromise) {
      quantitySyncPromises.delete(cartItemId);
    }
  }
}

function scheduleQuantitySync(cartItemId, quantity) {
  const timer = debounceSyncTimers.get(cartItemId);
  if (timer) clearTimeout(timer);
  pendingQuantities.set(cartItemId, quantity);
  debounceSyncTimers.set(cartItemId, setTimeout(() => {
    syncQuantityToServer(cartItemId);
  }, 400));
}

export async function flushPendingCartUpdates() {
  const cartItemIds = new Set([
    ...pendingQuantities.keys(),
    ...quantitySyncPromises.keys(),
  ]);
  const results = await Promise.all(
    [...cartItemIds].map((cartItemId) => syncQuantityToServer(cartItemId))
  );
  return results.every(Boolean);
}

function openCartDeleteConfirmation(deletion) {
  pendingCartDeletion = deletion;
  const message = document.getElementById('cart-delete-confirm-message');
  const title = document.getElementById('cart-delete-confirm-title');
  const confirmButton = document.getElementById('cart-delete-confirm');

  if (deletion.type === 'all') {
    title.textContent = 'Clear your entire cart?';
    message.textContent = `This will permanently remove all ${deletion.count} cart entr${deletion.count === 1 ? 'y' : 'ies'}.`;
    confirmButton.textContent = 'Clear Cart';
  } else {
    title.textContent = 'Remove this item?';
    message.textContent = `Remove ${deletion.name} (quantity ${deletion.quantity}) from your cart?`;
    confirmButton.textContent = 'Remove Item';
  }

  openModal('cart-delete-confirm-modal');
  document.getElementById('cart-delete-cancel').focus();
}

function closeCartDeleteConfirmation() {
  pendingCartDeletion = null;
  closeModal('cart-delete-confirm-modal');
}

async function confirmCartDeletion() {
  if (!pendingCartDeletion) return;

  const deletion = pendingCartDeletion;
  const confirmButton = document.getElementById('cart-delete-confirm');
  const cancelButton = document.getElementById('cart-delete-cancel');
  const closeButton = document.getElementById('cart-delete-confirm-close');
  confirmButton.disabled = true;
  cancelButton.disabled = true;
  closeButton.disabled = true;
  confirmButton.textContent = 'Removing...';

  try {
    const itemIds = deletion.type === 'all'
      ? [...pendingQuantities.keys()]
      : [deletion.id];
    for (const itemId of itemIds) {
      const timer = debounceSyncTimers.get(itemId);
      if (timer) clearTimeout(timer);
      debounceSyncTimers.delete(itemId);
      pendingQuantities.delete(itemId);
    }

    const endpoint = deletion.type === 'all' ? '/cart' : `/cart/${deletion.id}`;
    const result = await apiFetch(endpoint, { method: 'DELETE' });
    if (!result.success) {
      throw new Error('The server did not confirm the cart deletion.');
    }

    const currentCart = await apiFetch('/cart');
    const remainingItems = currentCart.items || [];
    const isDeleted = deletion.type === 'all'
      ? remainingItems.length === 0
      : !remainingItems.some((item) => item._id === deletion.id);

    if (!isDeleted) {
      throw new Error('The item is still present in your cart after deletion. Please try again.');
    }

    cartItems = remainingItems;
    checkedItemIds = new Set([...checkedItemIds].filter((id) => cartItems.some((item) => item._id === id)));
    renderCartLines();
    updateReceipt();
    await updateCartBadge();
    closeCartDeleteConfirmation();
    showToast(
      deletion.type === 'all'
        ? 'Cart cleared.'
        : 'Item removed from cart.',
      'success'
    );
  } catch (err) {
    showToast(err.message, 'error');
    closeCartDeleteConfirmation();
    await fetchCart();
  } finally {
    confirmButton.disabled = false;
    cancelButton.disabled = false;
    closeButton.disabled = false;
    confirmButton.textContent = 'Remove items';
  }
}

// Edit Add-ons Modal Flow
async function openEditAddonsModal(cartItemId) {
  editingCartItem = cartItems.find((c) => c._id === cartItemId);
  if (!editingCartItem) return;

  const modal = document.getElementById('edit-addons-modal');
  if (!modal) return;

  document.getElementById('edit-modal-item-name').textContent = editingCartItem.product.name;

  if (allAddons.length === 0) {
    try {
      const res = await apiFetch('/products/addons');
      allAddons = res.addons || [];
    } catch (e) {
      allAddons = [];
    }
  }

  const container = document.getElementById('edit-modal-addons-list');
  const existingAddonMap = new Map();
  if (editingCartItem.addons) {
    editingCartItem.addons.forEach((a) => {
      const pid = a.product && a.product._id ? a.product._id : a.product;
      existingAddonMap.set(String(pid), a.qty || 1);
    });
  }

  container.innerHTML = allAddons
    .filter((a) => a.isAvailable && a.stock > 0)
    .map((addon) => {
      const isSelected = existingAddonMap.has(String(addon._id));
      const savedQty = existingAddonMap.get(String(addon._id)) || 1;
      const currentQty = editingCartItem.addonQuantityMode === 'per_order'
        ? savedQty
        : savedQty * editingCartItem.quantity;

      return `
        <div class="addon-row" style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--color-border);font-size:0.88rem;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" class="edit-addon-checkbox" value="${addon._id}" data-price="${addon.price}" data-stock="${addon.stock}" ${isSelected ? 'checked' : ''}>
            <span><strong>${escapeHtml(addon.name)}</strong> (+₱${addon.price.toFixed(2)})</span>
          </label>
          <div class="qty-stepper" style="transform:scale(0.85);transform-origin:right center;">
            <button type="button" class="stepper-btn edit-addon-minus" data-target="edit-addon-qty-${addon._id}">-</button>
            <span class="stepper-val" id="edit-addon-qty-${addon._id}">${currentQty}</span>
            <button type="button" class="stepper-btn edit-addon-plus" data-target="edit-addon-qty-${addon._id}" data-stock="${addon.stock}">+</button>
          </div>
        </div>
      `;
    })
    .join('');

  // Wire mini steppers
  container.querySelectorAll('.edit-addon-minus').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const elem = document.getElementById(btn.getAttribute('data-target'));
      if (elem) {
        let val = parseInt(elem.textContent, 10) || 1;
        if (val > 1) elem.textContent = String(val - 1);
      }
    });
  });

  container.querySelectorAll('.edit-addon-plus').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const elem = document.getElementById(btn.getAttribute('data-target'));
      if (elem) {
        let val = parseInt(elem.textContent, 10) || 1;
        const stock = Number(btn.getAttribute('data-stock')) || 0;
        if (val < stock) elem.textContent = String(val + 1);
        else showToast(`Only ${stock} of this add-on are available.`, 'warning');
      }
    });
  });

  openModal('edit-addons-modal');
}

// Save edited addons
async function saveEditedAddons() {
  if (!editingCartItem) return;
  const saveBtn = document.getElementById('save-edit-addons-btn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }

  const updatedAddons = [];
  document.querySelectorAll('.edit-addon-checkbox:checked').forEach((cb) => {
    const miniQtyInput = document.getElementById(`edit-addon-qty-${cb.value}`);
    const miniQty = miniQtyInput ? parseInt(miniQtyInput.textContent, 10) || 1 : 1;
    updatedAddons.push({
      product: cb.value,
      qty: miniQty,
    });
  });

  try {
    await apiFetch(`/cart/${editingCartItem._id}`, {
      method: 'PATCH',
      body: JSON.stringify({ addons: updatedAddons, addonQuantityMode: 'per_order' }),
    });

    showToast('Add-ons updated!', 'success');
    closeModal('edit-addons-modal');
    await fetchCart();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  }
}

// Setup Event Delegation for Cart Container
function setupCartListeners() {
  const container = document.getElementById('cart-items-container');
  if (!container) return;

  container.addEventListener('change', (e) => {
    if (e.target.classList.contains('line-checkbox')) {
      const lineId = e.target.getAttribute('data-line-id');
      if (e.target.checked) {
        checkedItemIds.add(lineId);
      } else {
        checkedItemIds.delete(lineId);
      }
      const selectAllCb = document.getElementById('select-all-checkbox');
      if (selectAllCb) {
        selectAllCb.checked = cartItems.length > 0 && cartItems.every((item) => checkedItemIds.has(item._id));
      }
      updateReceipt();
    }
  });

  container.addEventListener('click', async (e) => {
    // Stepper minus
    const minusBtn = e.target.closest('.stepper-cart-minus');
    if (minusBtn) {
      const lineId = minusBtn.getAttribute('data-line-id');
      const item = cartItems.find((c) => c._id === lineId);
      if (item && item.quantity > 1) {
        item.quantity -= 1;
        renderCartLines();
        updateReceipt();
        scheduleQuantitySync(lineId, item.quantity);
      }
      return;
    }

    // Stepper plus
    const plusBtn = e.target.closest('.stepper-cart-plus');
    if (plusBtn) {
      const lineId = plusBtn.getAttribute('data-line-id');
      const item = cartItems.find((c) => c._id === lineId);
      if (item) {
        if (item.product && item.quantity < item.product.stock) {
          item.quantity += 1;
          renderCartLines();
          updateReceipt();
          scheduleQuantitySync(lineId, item.quantity);
        } else {
          showToast(`Cannot add more. Only ${item.product.stock} items left in stock.`, 'warning');
        }
      }
      return;
    }

    // Remove line
    const removeBtn = e.target.closest('.btn-remove-line');
    if (removeBtn) {
      const lineId = removeBtn.getAttribute('data-line-id');
      const item = cartItems.find((cartItem) => cartItem._id === lineId);
      if (item) {
        openCartDeleteConfirmation({
          type: 'item',
          id: lineId,
          name: item.product ? item.product.name : 'this item',
          quantity: item.quantity,
        });
      }
      return;
    }

    // Edit add-ons
    const editBtn = e.target.closest('.btn-edit-addons');
    if (editBtn) {
      const lineId = editBtn.getAttribute('data-line-id');
      openEditAddonsModal(lineId);
      return;
    }
  });

  // Select all checkbox
  const selectAllCb = document.getElementById('select-all-checkbox');
  if (selectAllCb) {
    selectAllCb.addEventListener('change', () => {
      if (selectAllCb.checked) {
        cartItems.forEach((c) => checkedItemIds.add(c._id));
      } else {
        checkedItemIds.clear();
      }
      renderCartLines();
      updateReceipt();
    });
  }

  // Clear all cart button
  const clearCartBtn = document.getElementById('clear-cart-btn');
  if (clearCartBtn) {
    clearCartBtn.addEventListener('click', () => {
      if (cartItems.length === 0) return;
      openCartDeleteConfirmation({ type: 'all', count: cartItems.length });
    });
  }

  const confirmDeleteBtn = document.getElementById('cart-delete-confirm');
  const cancelDeleteBtn = document.getElementById('cart-delete-cancel');
  const closeDeleteBtn = document.getElementById('cart-delete-confirm-close');
  const deleteModal = document.getElementById('cart-delete-confirm-modal');

  if (confirmDeleteBtn) confirmDeleteBtn.addEventListener('click', confirmCartDeletion);
  if (cancelDeleteBtn) cancelDeleteBtn.addEventListener('click', closeCartDeleteConfirmation);
  if (closeDeleteBtn) closeDeleteBtn.addEventListener('click', closeCartDeleteConfirmation);
  if (deleteModal) {
    deleteModal.addEventListener('click', (event) => {
      if (event.target === deleteModal && !confirmDeleteBtn.disabled) {
        closeCartDeleteConfirmation();
      }
    });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && pendingCartDeletion && !confirmDeleteBtn.disabled) {
      closeCartDeleteConfirmation();
    }
  });

  // Edit Addons Modal buttons
  const closeEditBtn = document.getElementById('close-edit-addons-modal');
  const cancelEditBtn = document.getElementById('cancel-edit-addons-btn');
  const saveEditBtn = document.getElementById('save-edit-addons-btn');

  if (closeEditBtn) closeEditBtn.addEventListener('click', () => closeModal('edit-addons-modal'));
  if (cancelEditBtn) cancelEditBtn.addEventListener('click', () => closeModal('edit-addons-modal'));
  if (saveEditBtn) saveEditBtn.addEventListener('click', saveEditedAddons);
}

function initCart() {
  if (!requireAuth()) return;
  renderHeader('cart');
  renderFooter();
  setupCartListeners();
  fetchCart();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCart);
} else {
  initCart();
}
