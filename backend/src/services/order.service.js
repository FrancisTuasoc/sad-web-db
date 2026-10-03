const Order = require('../models/Order');
const CartItem = require('../models/CartItem');
const Product = require('../models/Product');
const Settings = require('../models/Settings');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const { generateOrderNumber } = require('../utils/orderNumber');
const { deductStockWithCompensation, restoreStockForOrder } = require('./stock.service');

async function getOrCreateSettings() {
  let settings = await Settings.findOne();
  if (!settings) {
    settings = await Settings.create({});
  }
  return settings;
}

async function placeOrder({ userId, cartItemIds, fulfillment, paymentMethod, gcashReference, contact }) {
  const settings = await getOrCreateSettings();

  if (!settings.acceptingOrders) {
    throw new AppError('The shop is currently closed and not accepting new orders. Please check back later.', 400);
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
      throw new AppError('Cash on delivery is not applicable for pickup orders.', 400);
    }
    if (paymentMethod === 'pay_at_shop' && !settings.payAtShopEnabled) {
      throw new AppError('Pay at shop is currently disabled.', 400);
    }
    if (paymentMethod === 'gcash' && !settings.gcashEnabled) {
      throw new AppError('GCash payment is currently disabled.', 400);
    }
  } else if (fulfillment === 'delivery') {
    if (paymentMethod === 'pay_at_shop') {
      throw new AppError('Pay at shop is not applicable for delivery orders.', 400);
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
      throw new AppError('Please provide a valid 13-digit GCash reference number.', 400);
    }
  }

  if (!cartItemIds || !Array.isArray(cartItemIds) || cartItemIds.length === 0) {
    throw new AppError('Please select at least one item from your cart to checkout.', 400);
  }

  // Fetch only the requested cart items belonging to the user
  const cartItems = await CartItem.find({
    _id: { $in: cartItemIds },
    user: userId,
  }).populate('product').populate('addons.product');

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
      throw new AppError(`Item "${mainProd ? mainProd.name : 'Unknown'}" is currently not available.`, 400);
    }
    if (mainProd.stock < line.quantity) {
      throw new AppError(`Insufficient stock for "${mainProd.name}". Only ${mainProd.stock} left in stock.`, 400);
    }

    itemsToDeduct.push({
      productId: mainProd._id,
      name: mainProd.name,
      needed: line.quantity,
    });

    let addonsLinePrice = 0;
    const snapAddons = [];

    if (line.addons && Array.isArray(line.addons)) {
      for (const addonEntry of line.addons) {
        const addonProd = addonEntry.product;
        if (!addonProd || !addonProd.isAvailable) {
          throw new AppError(`Add-on "${addonProd ? addonProd.name : 'Unknown'}" is currently not available.`, 400);
        }
        const neededAddonQty = addonEntry.qty * line.quantity;
        if (addonProd.stock < neededAddonQty) {
          throw new AppError(`Insufficient stock for add-on "${addonProd.name}". Only ${addonProd.stock} left.`, 400);
        }

        itemsToDeduct.push({
          productId: addonProd._id,
          name: addonProd.name,
          needed: neededAddonQty,
        });

        const singleAddonTotal = addonProd.price * addonEntry.qty;
        addonsLinePrice += singleAddonTotal;

        snapAddons.push({
          product: addonProd._id,
          name: addonProd.name,
          price: addonProd.price,
          qty: addonEntry.qty,
        });
      }
    }

    const lineTotal = (mainProd.price + addonsLinePrice) * line.quantity;
    subtotal += lineTotal;

    orderItems.push({
      product: mainProd._id,
      name: mainProd.name,
      unitPrice: mainProd.price,
      quantity: line.quantity,
      addons: snapAddons,
      lineTotal,
    });
  }

  if (settings.minimumOrder > 0 && subtotal < settings.minimumOrder) {
    throw new AppError(`Minimum order amount is ₱${settings.minimumOrder.toFixed(2)}. Your subtotal is ₱${subtotal.toFixed(2)}.`, 400);
  }

  const deliveryFee = fulfillment === 'delivery' ? settings.deliveryFee : 0;
  const total = subtotal + deliveryFee;

  // Perform atomic stock deduction with compensation rollback
  await deductStockWithCompensation(itemsToDeduct);

  // Generate unique order number
  let orderNumber = generateOrderNumber();
  let existing = await Order.findOne({ orderNumber });
  while (existing) {
    orderNumber = generateOrderNumber();
    existing = await Order.findOne({ orderNumber });
  }

  const order = await Order.create({
    orderNumber,
    user: userId,
    items: orderItems,
    subtotal,
    deliveryFee,
    total,
    fulfillment,
    paymentMethod,
    paymentStatus: 'unpaid',
    gcashReference: paymentMethod === 'gcash' ? gcashReference.trim() : '',
    contact: {
      fullName: contact.fullName.trim(),
      phone: contact.phone.trim(),
      address: contact.address ? contact.address.trim() : '',
    },
    status: 'pending',
    statusHistory: [{ status: 'pending', at: new Date() }],
  });

  // Remove only the checked and ordered cart items
  await CartItem.deleteMany({
    _id: { $in: cartItems.map((c) => c._id) },
    user: userId,
  });

  // Save/update user contact details if changed/new
  const user = await User.findById(userId);
  if (user) {
    let userChanged = false;
    if (contact.fullName && user.fullName !== contact.fullName.trim()) {
      user.fullName = contact.fullName.trim();
      userChanged = true;
    }
    if (contact.phone && user.phone !== contact.phone.trim()) {
      user.phone = contact.phone.trim();
      userChanged = true;
    }
    if (fulfillment === 'delivery' && contact.address && user.address !== contact.address.trim()) {
      user.address = contact.address.trim();
      userChanged = true;
    }
    if (userChanged) {
      await user.save();
    }
  }

  return order;
}

async function cancelOrder(orderId, currentUser, role = 'customer') {
  const query = { _id: orderId };
  if (role !== 'admin') {
    query.user = currentUser._id;
  }

  const order = await Order.findOne(query);
  if (!order) {
    throw new AppError('Order not found.', 404);
  }

  if (order.status === 'cancelled') {
    throw new AppError('This order is already cancelled.', 400);
  }
  if (order.status === 'completed') {
    throw new AppError('Completed orders cannot be cancelled.', 400);
  }

  if (role !== 'admin' && order.status !== 'pending') {
    throw new AppError('Customers can only cancel orders that are still pending.', 400);
  }

  // Restore inventory
  await restoreStockForOrder(order.items);

  order.status = 'cancelled';
  order.cancelledBy = role === 'admin' ? 'admin' : 'customer';
  order.statusHistory.push({ status: 'cancelled', at: new Date() });
  await order.save();

  return order;
}

async function updateOrderStatus(orderId, nextStatus) {
  const order = await Order.findById(orderId);
  if (!order) {
    throw new AppError('Order not found.', 404);
  }

  if (order.status === 'cancelled' || order.status === 'completed') {
    throw new AppError('A completed or cancelled order can no longer change status.', 400);
  }

  if (nextStatus === 'cancelled') {
    return cancelOrder(orderId, null, 'admin');
  }

  // Allowed transitions
  const validTransitions = {
    pending: order.fulfillment === 'pickup' ? ['to_pickup'] : ['to_ship'],
    to_pickup: ['completed'],
    to_ship: ['completed'],
  };

  const allowed = validTransitions[order.status] || [];
  if (!allowed.includes(nextStatus)) {
    throw new AppError(`Cannot change order status from ${order.status} to ${nextStatus}.`, 400);
  }

  order.status = nextStatus;
  order.statusHistory.push({ status: nextStatus, at: new Date() });

  // Completing a COD or pay_at_shop order auto-sets paymentStatus: 'paid'
  if (nextStatus === 'completed') {
    if (order.paymentMethod === 'cod' || order.paymentMethod === 'pay_at_shop') {
      order.paymentStatus = 'paid';
    }
  }

  await order.save();
  return order;
}

async function markOrderPaid(orderId) {
  const order = await Order.findById(orderId);
  if (!order) {
    throw new AppError('Order not found.', 404);
  }
  order.paymentStatus = 'paid';
  await order.save();
  return order;
}

module.exports = {
  getOrCreateSettings,
  placeOrder,
  cancelOrder,
  updateOrderStatus,
  markOrderPaid,
};
