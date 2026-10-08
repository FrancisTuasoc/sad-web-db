const express = require('express');
const { z } = require('zod');
const cartRepository = require('../repositories/cartRepository');
const productRepository = require('../repositories/productRepository');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const validate = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const addCartSchema = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  quantity: z.number().int().min(1, 'Quantity must be at least 1').default(1),
  addonQuantityMode: z.enum(['per_item', 'per_order']).default('per_item'),
  addons: z
    .array(
      z.object({
        product: z.string().min(1),
        qty: z.number().int().min(1).default(1),
      })
    )
    .optional()
    .default([]),
});

const updateCartSchema = z.object({
  quantity: z.number().int().min(1, 'Quantity must be at least 1').optional(),
  addonQuantityMode: z.enum(['per_item', 'per_order']).optional(),
  addons: z
    .array(
      z.object({
        product: z.string().min(1),
        qty: z.number().int().min(1).default(1),
      })
    )
    .optional(),
});

function serializeAddons(addons) {
  if (!addons || !Array.isArray(addons)) return '';
  return addons
    .map((a) => {
      const prodId =
        a.product && a.product._id ? String(a.product._id) : String(a.product);
      return `${prodId}:${a.qty || 1}`;
    })
    .sort()
    .join('|');
}

function getAddonStockQuantity(addon, quantity, mode) {
  return mode === 'per_order' ? addon.qty : addon.qty * quantity;
}

async function validateCartInventory({
  userId,
  product,
  quantity,
  addons,
  addonQuantityMode,
  excludeCartItemId,
}) {
  const existingItems = await cartRepository.findByUser(userId);
  const filteredItems = excludeCartItemId
    ? existingItems.filter((i) => i.id !== excludeCartItemId)
    : existingItems;

  const productId = String(product._id || product.id);
  const existingProductQuantity = filteredItems.reduce((total, item) => {
    const itemProdId = item.product
      ? String(item.product._id || item.product.id)
      : '';
    return itemProdId === productId ? total + item.quantity : total;
  }, 0);

  if (existingProductQuantity + quantity > product.stock) {
    throw new AppError(
      `Only ${product.stock} left in stock for ${product.name}.`,
      400
    );
  }

  const addonUsage = new Map();
  for (const item of filteredItems) {
    for (const addon of item.addons || []) {
      const addonId =
        addon.product && (addon.product._id || addon.product.id)
          ? String(addon.product._id || addon.product.id)
          : String(addon.product);
      const used = getAddonStockQuantity(
        addon,
        item.quantity,
        item.addonQuantityMode || 'per_item'
      );
      addonUsage.set(addonId, (addonUsage.get(addonId) || 0) + used);
    }
  }

  for (const addon of addons) {
    const addonId = String(addon.product);
    const needed = getAddonStockQuantity(addon, quantity, addonQuantityMode);
    addonUsage.set(addonId, (addonUsage.get(addonId) || 0) + needed);
  }

  const requestedAddonIds = new Set(
    addons.map((addon) => String(addon.product))
  );
  if (requestedAddonIds.size === 0) return;

  const addonProducts = await productRepository.findByIds([
    ...requestedAddonIds,
  ]);
  const productsById = new Map(
    addonProducts.map((item) => [String(item._id || item.id), item])
  );

  for (const addonId of requestedAddonIds) {
    const needed = addonUsage.get(addonId) || 0;
    const addonProduct = productsById.get(addonId);
    if (!addonProduct || !addonProduct.isAvailable || !addonProduct.isAddon) {
      throw new AppError('One of the selected add-ons is not available.', 400);
    }
    if (needed > addonProduct.stock) {
      throw new AppError(
        `Only ${addonProduct.stock} left for add-on "${addonProduct.name}".`,
        400
      );
    }
  }
}

// GET /api/cart
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const items = await cartRepository.findByUser(req.user.id);
    res.json({
      success: true,
      items,
    });
  })
);

// POST /api/cart
router.post(
  '/',
  validate(addCartSchema),
  asyncHandler(async (req, res) => {
    const { productId, quantity, addons, addonQuantityMode } = req.body;

    const product = await productRepository.findById(productId);
    if (!product || !product.isAvailable) {
      throw new AppError('This product is currently not available.', 400);
    }

    // Validate addons
    const validatedAddons = [];
    if (addons && addons.length > 0) {
      for (const addonItem of addons) {
        const addonProd = await productRepository.findById(addonItem.product);
        if (!addonProd || !addonProd.isAvailable || !addonProd.isAddon) {
          throw new AppError(
            'One of the selected add-ons is not available.',
            400
          );
        }
        validatedAddons.push({
          product: addonProd.id,
          qty: addonItem.qty,
        });
      }
    }

    await validateCartInventory({
      userId: req.user.id,
      product,
      quantity,
      addons: validatedAddons,
      addonQuantityMode,
    });

    const newAddonKey = serializeAddons(validatedAddons);

    // Look for existing cart item with the same product and identical addons
    const userCartItems = await cartRepository.findByUser(req.user.id);
    let matchedItem = null;
    for (const item of userCartItems) {
      const itemProdId = item.product
        ? String(item.product._id || item.product.id)
        : '';
      if (
        itemProdId === productId &&
        (item.addonQuantityMode || 'per_item') === addonQuantityMode &&
        serializeAddons(item.addons) === newAddonKey
      ) {
        matchedItem = item;
        break;
      }
    }

    if (matchedItem) {
      const newQty = matchedItem.quantity + quantity;
      let finalAddons = matchedItem.addons;
      if (addonQuantityMode === 'per_order') {
        const mergedAddons = new Map(
          matchedItem.addons.map((a) => [
            String(
              a.product && (a.product._id || a.product.id)
                ? a.product._id || a.product.id
                : a.product
            ),
            a,
          ])
        );
        for (const addon of validatedAddons) {
          const key = String(addon.product);
          const existing = mergedAddons.get(key);
          if (existing) existing.qty += addon.qty;
          else mergedAddons.set(key, { ...addon });
        }
        finalAddons = [...mergedAddons.values()];
      }

      const updated = await cartRepository.update(matchedItem.id, req.user.id, {
        quantity: newQty,
        addons: finalAddons,
      });

      return res.json({
        success: true,
        message: 'Cart item quantity updated.',
        item: updated,
      });
    }

    const created = await cartRepository.create({
      userId: req.user.id,
      productId,
      addons: validatedAddons,
      addonQuantityMode,
      quantity,
    });

    res.status(201).json({
      success: true,
      message: 'Item added to cart.',
      item: created,
    });
  })
);

// PATCH /api/cart/:id
router.patch(
  '/:id',
  validate(updateCartSchema),
  asyncHandler(async (req, res) => {
    const { quantity, addons } = req.body;
    const cartItem = await cartRepository.findById(req.params.id, req.user.id);

    if (!cartItem) {
      throw new AppError('Cart line not found.', 404);
    }

    let validatedAddons = cartItem.addons;
    if (addons !== undefined) {
      validatedAddons = [];
      for (const addonItem of addons) {
        const addonProd = await productRepository.findById(addonItem.product);
        if (!addonProd || !addonProd.isAvailable || !addonProd.isAddon) {
          throw new AppError(
            'One of the selected add-ons is not available.',
            400
          );
        }
        validatedAddons.push({
          product: addonProd.id,
          qty: addonItem.qty,
        });
      }
    }

    const targetQuantity =
      quantity !== undefined ? quantity : cartItem.quantity;
    const targetMode =
      req.body.addonQuantityMode || cartItem.addonQuantityMode || 'per_item';

    await validateCartInventory({
      userId: req.user.id,
      product: cartItem.product,
      quantity: targetQuantity,
      addons: validatedAddons,
      addonQuantityMode: targetMode,
      excludeCartItemId: cartItem.id,
    });

    const updated = await cartRepository.update(cartItem.id, req.user.id, {
      quantity: targetQuantity,
      addonQuantityMode: targetMode,
      addons: validatedAddons,
    });

    res.json({
      success: true,
      message: 'Cart updated.',
      item: updated,
    });
  })
);

// DELETE /api/cart/:id
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const deleted = await cartRepository.delete(req.params.id, req.user.id);

    if (!deleted) {
      throw new AppError('Cart line not found.', 404);
    }

    res.json({
      success: true,
      message: 'Item removed from cart.',
      deletedCount: 1,
    });
  })
);

// DELETE /api/cart (clear all)
router.delete(
  '/',
  asyncHandler(async (req, res) => {
    const result = await cartRepository.deleteMany(null, req.user.id);
    res.json({
      success: true,
      message: `${result.deletedCount} cart entr${result.deletedCount === 1 ? 'y' : 'ies'} removed.`,
      deletedCount: result.deletedCount,
    });
  })
);

module.exports = router;
