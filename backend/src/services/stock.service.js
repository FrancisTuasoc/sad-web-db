const Product = require('../models/Product');
const AppError = require('../utils/AppError');
const { broadcastStock } = require('./events');

/**
 * Deduct stock atomically with compensation rollback pattern
 * itemsToDeduct: array of { productId, name, needed }
 */
async function deductStockWithCompensation(itemsToDeduct) {
  // Aggregate needed quantities by productId
  const aggregated = new Map();
  for (const item of itemsToDeduct) {
    const key = String(item.productId);
    if (!aggregated.has(key)) {
      aggregated.set(key, { productId: item.productId, name: item.name, needed: item.needed });
    } else {
      aggregated.get(key).needed += item.needed;
    }
  }

  const deductionList = Array.from(aggregated.values());
  const successfulDeductions = [];

  for (const item of deductionList) {
    const updated = await Product.findOneAndUpdate(
      {
        _id: item.productId,
        isAvailable: true,
        stock: { $gte: item.needed },
      },
      {
        $inc: { stock: -item.needed },
      },
      { new: true }
    );

    if (!updated) {
      // Roll back all previous successful deductions
      for (const prev of successfulDeductions) {
        await Product.findByIdAndUpdate(prev.productId, {
          $inc: { stock: prev.needed },
        });
      }
      throw new AppError(
        `Sorry, ${item.name} is no longer available in that quantity.`,
        400
      );
    }

    successfulDeductions.push({
      productId: item.productId,
      name: item.name,
      needed: item.needed,
      stock: updated.stock,
      isAvailable: updated.isAvailable,
    });
  }

  // Broadcast updated stock for all modified items
  for (const item of successfulDeductions) {
    broadcastStock(item.productId, item.stock, item.isAvailable);
  }

  return successfulDeductions;
}

/**
 * Restore stock when order is cancelled
 * orderItems: array of order items with addons
 */
async function restoreStockForOrder(orderItems) {
  const aggregated = new Map();

  for (const item of orderItems) {
    if (item.product) {
      const pKey = String(item.product);
      aggregated.set(pKey, (aggregated.get(pKey) || 0) + item.quantity);
    }

    if (item.addons && Array.isArray(item.addons)) {
      for (const addon of item.addons) {
        if (addon.product) {
          const aKey = String(addon.product);
          const totalAddonQty = addon.qty * item.quantity;
          aggregated.set(aKey, (aggregated.get(aKey) || 0) + totalAddonQty);
        }
      }
    }
  }

  for (const [prodId, qty] of aggregated.entries()) {
    const updated = await Product.findByIdAndUpdate(
      prodId,
      { $inc: { stock: qty } },
      { new: true }
    );
    if (updated) {
      broadcastStock(updated._id, updated.stock, updated.isAvailable);
    }
  }
}

module.exports = {
  deductStockWithCompensation,
  restoreStockForOrder,
};
