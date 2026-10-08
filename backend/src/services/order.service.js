const orderRepository = require('../repositories/orderRepository');
const cartRepository = require('../repositories/cartRepository');
const productRepository = require('../repositories/productRepository');
const settingsRepository = require('../repositories/settingsRepository');
const userRepository = require('../repositories/userRepository');
const AppError = require('../utils/AppError');
const { generateOrderNumber } = require('../utils/orderNumber');
const {
  deductStockWithCompensation,
  restoreStockForOrder,
} = require('./stock.service');
const { broadcastStock } = require('./events');

const PAY_AT_SHOP_ARRIVAL_WINDOW_MS = 60 * 60 * 1000;
const EXPIRY_SWEEP_BATCH_SIZE = 100;

async function getOrCreateSettings() {
  return settingsRepository.getSettings();
}

async function placeOrder({
  userId,
  cartItemIds,
  fulfillment,
  paymentMethod,
  gcashReference,
  contact,
}) {
  const settings = await getOrCreateSettings();

  if (!settings.acceptingOrders) {
    throw new AppError(
      'The shop is currently closed and not accepting new orders. Please check back later.',
      400
    );
  }

  if (fulfillment === 'delivery' && !settings.deliveryEnabled) {
    throw new AppError('Delivery service is currently unavailable.', 400);
  }
  if (fulfillment === 'pickup' && !settings.pickupEnabled) {
    throw new AppError('Store pickup is currently unavailable.', 400);
  }

  // Validate payment method per fulfillment
  if (fulfillment === 'pickup') {
    if (paymentMethod === 'cod') {
      throw new AppError(
        'Cash on delivery is not applicable for pickup orders.',
        400
      );
    }
    if (paymentMethod === 'pay_at_shop' && !settings.payAtShopEnabled) {
      throw new AppError('Pay at shop is currently disabled.', 400);
    }
    if (paymentMethod === 'gcash' && !settings.gcashEnabled) {
      throw new AppError('GCash payment is currently disabled.', 400);
    }
  } else if (fulfillment === 'delivery') {
    if (paymentMethod === 'pay_at_shop') {
      throw new AppError(
        'Pay at shop is not applicable for delivery orders.',
        400
      );
    }
    if (paymentMethod === 'cod' && !settings.codEnabled) {
      throw new AppError('Cash on delivery is currently disabled.', 400);
    }
    if (paymentMethod === 'gcash' && !settings.gcashEnabled) {
      throw new AppError('GCash payment is currently disabled.', 400);
    }
  }

  if (paymentMethod === 'gcash') {
    if (!gcashReference || !/^\d{13}$/.test(gcashReference.trim())) {
      throw new AppError(
        'Please provide a valid 13-digit GCash reference number.',
        400
      );
    }
  }

  if (!cartItemIds || !Array.isArray(cartItemIds) || cartItemIds.length === 0) {
    throw new AppError(
      'Please select at least one item from your cart to checkout.',
      400
    );
  }

  // Fetch only the requested cart items belonging to the user
  const cartItems = await cartRepository.findByIds(cartItemIds, userId);

  if (cartItems.length === 0) {
    throw new AppError('Selected cart items could not be found.', 400);
  }

  // Build snapshot items and stock requirements
  const orderItems = [];
  const itemsToDeduct = [];
  let subtotal = 0;

  for (const line of cartItems) {
    const mainProd = line.product;
    if (!mainProd || !mainProd.isAvailable) {
      throw new AppError(
        `Item "${mainProd ? mainProd.name : 'Unknown'}" is currently not available.`,
        400
      );
    }
    if (mainProd.stock < line.quantity) {
      throw new AppError(
        `Insufficient stock for "${mainProd.name}". Only ${mainProd.stock} left in stock.`,
        400
      );
    }

    itemsToDeduct.push({
      productId: mainProd._id || mainProd.id,
      name: mainProd.name,
      needed: line.quantity,
    });

    let addonsLinePrice = 0;
    const snapAddons = [];
    const addonQuantityMode = line.addonQuantityMode || 'per_item';

    if (line.addons && Array.isArray(line.addons)) {
      for (const addonEntry of line.addons) {
        const addonProd = addonEntry.product;
        if (!addonProd || !addonProd.isAvailable) {
          throw new AppError(
            `Add-on "${addonProd ? addonProd.name : 'Unknown'}" is currently not available.`,
            400
          );
        }
        const neededAddonQty =
          addonQuantityMode === 'per_order'
            ? addonEntry.qty
            : addonEntry.qty * line.quantity;
        if (addonProd.stock < neededAddonQty) {
          throw new AppError(
            `Insufficient stock for add-on "${addonProd.name}". Only ${addonProd.stock} left.`,
            400
          );
        }

        itemsToDeduct.push({
          productId: addonProd._id || addonProd.id,
          name: addonProd.name,
          needed: neededAddonQty,
        });

        const singleAddonTotal =
          addonProd.price *
          addonEntry.qty *
          (addonQuantityMode === 'per_order' ? 1 : line.quantity);
        addonsLinePrice += singleAddonTotal;

        snapAddons.push({
          product: addonProd._id || addonProd.id,
          name: addonProd.name,
          price: addonProd.price,
          qty: addonEntry.qty,
        });
      }
    }

    const lineTotal = mainProd.price * line.quantity + addonsLinePrice;
    subtotal += lineTotal;

    orderItems.push({
      product: mainProd._id || mainProd.id,
      name: mainProd.name,
      unitPrice: mainProd.price,
      quantity: line.quantity,
      addons: snapAddons,
      addonQuantityMode,
      lineTotal,
    });
  }

  if (settings.minimumOrder > 0 && subtotal < settings.minimumOrder) {
    throw new AppError(
      `Minimum order amount is ₱${settings.minimumOrder.toFixed(2)}. Your subtotal is ₱${subtotal.toFixed(2)}.`,
      400
    );
  }

  const deliveryFee = fulfillment === 'delivery' ? settings.deliveryFee : 0;
  const total = subtotal + deliveryFee;
  const savedNameParts = String(contact.fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const firstName = contact.firstName || savedNameParts.shift() || '';
  const lastName = contact.lastName || savedNameParts.join(' ');
  const fullName =
    [firstName, lastName].filter(Boolean).join(' ') ||
    String(contact.fullName || '').trim();
  const addressParts = ['street', 'barangay', 'city', 'province', 'postalCode']
    .map((field) => contact[field] && contact[field].trim())
    .filter(Boolean);
  const address = addressParts.length
    ? addressParts.join(', ')
    : contact.address
      ? contact.address.trim()
      : '';

  // Perform atomic stock deduction with transaction
  await deductStockWithCompensation(itemsToDeduct);

  // Generate unique order number
  let orderNumber = generateOrderNumber();
  let existing = await orderRepository.findByOrderNumber(orderNumber);
  while (existing) {
    orderNumber = generateOrderNumber();
    existing = await orderRepository.findByOrderNumber(orderNumber);
  }

  const order = await orderRepository.create({
    orderNumber,
    userId,
    items: orderItems,
    subtotal,
    deliveryFee,
    total,
    fulfillment,
    paymentMethod,
    paymentStatus: 'unpaid',
    arrivalDeadline:
      paymentMethod === 'pay_at_shop'
        ? new Date(Date.now() + PAY_AT_SHOP_ARRIVAL_WINDOW_MS)
        : null,
    gcashReference: paymentMethod === 'gcash' ? gcashReference.trim() : '',
    contact: {
      fullName,
      firstName,
      lastName,
      email: contact.email ? contact.email.trim().toLowerCase() : '',
      phone: contact.phone.trim(),
      street: contact.street ? contact.street.trim() : '',
      barangay: contact.barangay ? contact.barangay.trim() : '',
      city: contact.city ? contact.city.trim() : '',
      province: contact.province ? contact.province.trim() : '',
      postalCode: contact.postalCode ? contact.postalCode.trim() : '',
      address,
    },
    status: 'pending',
  });

  // Remove only the checked and ordered cart items
  await cartRepository.deleteMany(
    cartItems.map((c) => c.id),
    userId
  );

  // Save/update user contact details if changed/new
  const user = await userRepository.findById(userId);
  if (user) {
    const userUpdates = {};
    if (firstName && user.firstName !== firstName)
      userUpdates.firstName = firstName;
    if (lastName && user.lastName !== lastName) userUpdates.lastName = lastName;
    if (fullName && user.fullName !== fullName) userUpdates.fullName = fullName;
    if (
      contact.email &&
      user.contactEmail !== contact.email.trim().toLowerCase()
    ) {
      userUpdates.contactEmail = contact.email.trim().toLowerCase();
    }
    if (contact.phone && user.phone !== contact.phone.trim()) {
      userUpdates.phone = contact.phone.trim();
    }
    if (
      (fulfillment === 'delivery' || addressParts.length > 0) &&
      user.address !== address
    ) {
      userUpdates.address = address;
    }
    for (const field of [
      'street',
      'barangay',
      'city',
      'province',
      'postalCode',
    ]) {
      if (contact[field] && user[field] !== contact[field].trim()) {
        userUpdates[field] = contact[field].trim();
      }
    }
    if (Object.keys(userUpdates).length > 0) {
      await userRepository.update(userId, userUpdates);
    }
  }

  return order;
}

async function cancelOrder(
  orderId,
  currentUser,
  role = 'customer',
  now = new Date()
) {
  const order = await orderRepository.findById(
    orderId,
    role === 'customer' ? currentUser._id || currentUser.id : null
  );
  if (!order) {
    throw new AppError('Order not found.', 404);
  }
  if (order.status !== 'pending') {
    throw new AppError(
      'This order can no longer be cancelled because it has already been accepted or processed. Contact the shop for help.',
      409
    );
  }

  const cancelledAt = now;
  if (
    role === 'system' &&
    (order.paymentMethod !== 'pay_at_shop' ||
      !order.arrivalDeadline ||
      new Date(order.arrivalDeadline) > cancelledAt)
  ) {
    return null;
  }

  const restoredProducts = await restoreStockForOrder(order.items);

  const cancelledOrder = await orderRepository.updateStatus(
    order.id,
    'cancelled',
    { at: cancelledAt },
    {
      cancelledBy:
        role === 'system' ? 'system' : role === 'admin' ? 'admin' : 'customer',
    }
  );

  for (const product of restoredProducts) {
    broadcastStock(
      product._id || product.id,
      product.stock,
      product.isAvailable
    );
  }
  return cancelledOrder;
}

async function expirePayAtShopOrders(now = new Date()) {
  const expiredOrders = await orderRepository.find(
    {
      status: 'pending',
      paymentMethod: 'pay_at_shop',
      arrivalDeadlineLte: now,
    },
    { limit: EXPIRY_SWEEP_BATCH_SIZE }
  );

  let cancelledCount = 0;
  for (const order of expiredOrders) {
    try {
      const cancelled = await cancelOrder(order.id, null, 'system', now);
      if (cancelled) cancelledCount += 1;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 409) continue;
      throw error;
    }
  }
  return cancelledCount;
}

async function updateOrderStatus(orderId, nextStatus) {
  const order = await orderRepository.findById(orderId);
  if (!order) {
    throw new AppError('Order not found.', 404);
  }

  let expectedStatus = null;
  let expectedFulfillment = null;
  if (nextStatus === 'preparing' && order.paymentMethod === 'pay_at_shop') {
    expectedStatus = 'pending';
    expectedFulfillment = 'pickup';
  } else if (nextStatus === 'ready_for_pickup') {
    expectedStatus =
      order.paymentMethod === 'pay_at_shop' ? 'preparing' : 'pending';
    expectedFulfillment = 'pickup';
  } else if (nextStatus === 'ready_to_deliver') {
    expectedStatus = 'pending';
    expectedFulfillment = 'delivery';
  } else if (nextStatus === 'completed' && order.fulfillment === 'pickup') {
    expectedStatus = 'ready_for_pickup';
    expectedFulfillment = 'pickup';
  }
  if (
    !expectedStatus ||
    order.status !== expectedStatus ||
    order.fulfillment !== expectedFulfillment
  ) {
    throw new AppError(
      `Cannot change order status from ${order.status} to ${nextStatus}.`,
      409
    );
  }

  const extraUpdates = {};
  if (
    nextStatus === 'completed' &&
    order.paymentStatus === 'unpaid' &&
    ['cod', 'pay_at_shop'].includes(order.paymentMethod)
  ) {
    extraUpdates.paymentStatus = 'paid';
  }

  const updated = await orderRepository.updateStatus(
    order.id,
    nextStatus,
    { at: new Date() },
    extraUpdates
  );
  return updated;
}

async function completeOrder(orderId, userId) {
  const order = await orderRepository.findById(orderId, userId);
  if (!order) {
    throw new AppError('Order not found.', 404);
  }
  const expectedStatus =
    order.fulfillment === 'pickup' ? 'ready_for_pickup' : 'ready_to_deliver';
  if (order.status !== expectedStatus) {
    throw new AppError('This order is not ready to be completed.', 409);
  }

  const extraUpdates = {};
  if (
    order.paymentStatus === 'unpaid' &&
    ['cod', 'pay_at_shop'].includes(order.paymentMethod)
  ) {
    extraUpdates.paymentStatus = 'paid';
  }
  const completed = await orderRepository.updateStatus(
    order.id,
    'completed',
    { at: new Date() },
    extraUpdates
  );
  return completed;
}

async function markOrderPaid(orderId) {
  const order = await orderRepository.findById(orderId);
  if (!order) {
    throw new AppError('Order not found.', 404);
  }
  return orderRepository.markPaid(orderId);
}

module.exports = {
  getOrCreateSettings,
  placeOrder,
  cancelOrder,
  expirePayAtShopOrders,
  updateOrderStatus,
  completeOrder,
  markOrderPaid,
};
