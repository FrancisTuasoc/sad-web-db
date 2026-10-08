const { getClient } = require('../config/db');
const productRepository = require('../repositories/productRepository');
const AppError = require('../utils/AppError');
const { broadcastStock } = require('./events');

/**
 * Deduct stock atomically inside a transaction
 * itemsToDeduct: array of { productId, name, needed }
 */
async function deductStockWithCompensation(
  itemsToDeduct,
  existingClient = null
) {
  const aggregated = new Map();
  for (const item of itemsToDeduct) {
    const key = String(item.productId);
    if (!aggregated.has(key)) {
      aggregated.set(key, {
        productId: item.productId,
        name: item.name,
        needed: item.needed,
      });
    } else {
      aggregated.get(key).needed += item.needed;
    }
  }

  const deductionList = Array.from(aggregated.values());
  const successfulDeductions = [];

  const client = existingClient || (await getClient());
  const ownsClient = !existingClient;

  try {
    if (ownsClient) await client.query('BEGIN');

    for (const item of deductionList) {
      const updated = await productRepository.deductStock(
        item.productId,
        item.needed,
        client
      );
      if (!updated) {
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

    if (ownsClient) await client.query('COMMIT');

    for (const item of successfulDeductions) {
      broadcastStock(item.productId, item.stock, item.isAvailable);
    }

    return successfulDeductions;
  } catch (err) {
    if (ownsClient) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (ownsClient) client.release();
  }
}

/**
 * Restore stock when order is cancelled
 * orderItems: array of order items with addons
 */
async function restoreStockForOrder(orderItems, client = null) {
  const aggregated = new Map();
  const updatedProducts = [];

  for (const item of orderItems) {
    const prodId =
      item.productId ||
      (item.product && item.product._id ? item.product._id : item.product);
    if (prodId) {
      const pKey = String(prodId);
      aggregated.set(pKey, (aggregated.get(pKey) || 0) + item.quantity);
    }

    if (item.addons && Array.isArray(item.addons)) {
      for (const addon of item.addons) {
        const addonProdId =
          addon.productId ||
          (addon.product && addon.product._id
            ? addon.product._id
            : addon.product);
        if (addonProdId) {
          const aKey = String(addonProdId);
          const totalAddonQty =
            item.addonQuantityMode === 'per_order'
              ? addon.qty
              : addon.qty * item.quantity;
          aggregated.set(aKey, (aggregated.get(aKey) || 0) + totalAddonQty);
        }
      }
    }
  }

  for (const [prodId, qty] of aggregated.entries()) {
    const updated = await productRepository.incrementStock(prodId, qty, client);
    if (updated) {
      updatedProducts.push(updated);
    }
  }

  if (!client) {
    for (const product of updatedProducts) {
      broadcastStock(product._id, product.stock, product.isAvailable);
    }
  }
  return updatedProducts;
}

module.exports = {
  deductStockWithCompensation,
  restoreStockForOrder,
};
