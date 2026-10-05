const express = require('express');
const { z } = require('zod');
const CartItem = require('../models/CartItem');
const Product = require('../models/Product');
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
      const prodId = a.product && a.product._id ? String(a.product._id) : String(a.product);
      return `${prodId}:${a.qty || 1}`;
    })
    .sort()
    .join('|');
}

function getAddonStockQuantity(addon, quantity, mode) {
  return mode === 'per_order' ? addon.qty : addon.qty * quantity;
}

async function validateCartInventory({ userId, product, quantity, addons, addonQuantityMode, excludeCartItemId }) {
  const filter = { user: userId };
  if (excludeCartItemId) filter._id = { $ne: excludeCartItemId };

  const existingItems = await CartItem.find(filter).populate('product').populate('addons.product');
  const productId = String(product._id);
  const existingProductQuantity = existingItems.reduce((total, item) => {
    return item.product && String(item.product._id) === productId ? total + item.quantity : total;
  }, 0);
  if (existingProductQuantity + quantity > product.stock) {
    throw new AppError(`Only ${product.stock} left in stock for ${product.name}.`, 400);
  }

  const addonUsage = new Map();
  for (const item of existingItems) {
    for (const addon of item.addons || []) {
      const addonId = addon.product && addon.product._id ? String(addon.product._id) : String(addon.product);
      const used = getAddonStockQuantity(addon, item.quantity, item.addonQuantityMode || 'per_item');
      addonUsage.set(addonId, (addonUsage.get(addonId) || 0) + used);
    }
  }
  for (const addon of addons) {
    const addonId = String(addon.product);
    const needed = getAddonStockQuantity(addon, quantity, addonQuantityMode);
    addonUsage.set(addonId, (addonUsage.get(addonId) || 0) + needed);
  }

  const requestedAddonIds = new Set(addons.map((addon) => String(addon.product)));
  if (requestedAddonIds.size === 0) return;
  const addonProducts = await Product.find({ _id: { $in: [...requestedAddonIds] } });
  const productsById = new Map(addonProducts.map((item) => [String(item._id), item]));
  for (const addonId of requestedAddonIds) {
    const needed = addonUsage.get(addonId) || 0;
    const addonProduct = productsById.get(addonId);
    if (!addonProduct || !addonProduct.isAvailable || !addonProduct.isAddon) {
      throw new AppError('One of the selected add-ons is not available.', 400);
    }
    if (needed > addonProduct.stock) {
      throw new AppError(`Only ${addonProduct.stock} left for add-on "${addonProduct.name}".`, 400);
    }
  }
}

// GET /api/cart
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const items = await CartItem.find({ user: req.user._id })
      .populate('product')
      .populate('addons.product')
      .sort({ createdAt: -1 });

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

    const product = await Product.findById(productId);
    if (!product || !product.isAvailable) {
      throw new AppError('This product is currently not available.', 400);
    }

    // Validate addons
    const validatedAddons = [];
    if (addons && addons.length > 0) {
      for (const addonItem of addons) {
        const addonProd = await Product.findById(addonItem.product);
        if (!addonProd || !addonProd.isAvailable || !addonProd.isAddon) {
          throw new AppError('One of the selected add-ons is not available.', 400);
        }
        validatedAddons.push({
          product: addonProd._id,
          qty: addonItem.qty,
        });
      }
    }

    await validateCartInventory({
      userId: req.user._id,
      product,
      quantity,
      addons: validatedAddons,
      addonQuantityMode,
    });

    const newAddonKey = serializeAddons(validatedAddons);

    // Look for existing cart item with the same product and identical addons
    const userCartItems = await CartItem.find({
      user: req.user._id,
      product: productId,
    });

    let matchedItem = null;
    for (const item of userCartItems) {
      if (
        (item.addonQuantityMode || 'per_item') === addonQuantityMode
        && serializeAddons(item.addons) === newAddonKey
      ) {
        matchedItem = item;
        break;
      }
    }

    if (matchedItem) {
      const newQty = matchedItem.quantity + quantity;
      matchedItem.quantity = newQty;
      if (addonQuantityMode === 'per_order') {
        const mergedAddons = new Map(matchedItem.addons.map((addon) => [String(addon.product), addon]));
        for (const addon of validatedAddons) {
          const existing = mergedAddons.get(String(addon.product));
          if (existing) existing.qty += addon.qty;
          else mergedAddons.set(String(addon.product), { ...addon });
        }
        matchedItem.addons = [...mergedAddons.values()];
      }
      await matchedItem.save();
      const populated = await CartItem.findById(matchedItem._id)
        .populate('product')
        .populate('addons.product');
      return res.json({
        success: true,
        message: 'Cart item quantity updated.',
        item: populated,
      });
    }

    const created = await CartItem.create({
      user: req.user._id,
      product: productId,
      addons: validatedAddons,
      addonQuantityMode,
      quantity,
    });

    const populated = await CartItem.findById(created._id)
      .populate('product')
      .populate('addons.product');

    res.status(201).json({
      success: true,
      message: 'Item added to cart.',
      item: populated,
    });
  })
);

// PATCH /api/cart/:id
router.patch(
  '/:id',
  validate(updateCartSchema),
  asyncHandler(async (req, res) => {
    const { quantity, addons } = req.body;
    const cartItem = await CartItem.findOne({
      _id: req.params.id,
      user: req.user._id,
    }).populate('product');

    if (!cartItem) {
      throw new AppError('Cart line not found.', 404);
    }

    if (quantity !== undefined) cartItem.quantity = quantity;

    if (addons !== undefined) {
      const validatedAddons = [];
      for (const addonItem of addons) {
        const addonProd = await Product.findById(addonItem.product);
        if (!addonProd || !addonProd.isAvailable || !addonProd.isAddon) {
          throw new AppError('One of the selected add-ons is not available.', 400);
        }
        validatedAddons.push({
          product: addonProd._id,
          qty: addonItem.qty,
        });
      }
      cartItem.addons = validatedAddons;
      cartItem.addonQuantityMode = req.body.addonQuantityMode || 'per_order';
    }

    await validateCartInventory({
      userId: req.user._id,
      product: cartItem.product,
      quantity: cartItem.quantity,
      addons: cartItem.addons,
      addonQuantityMode: cartItem.addonQuantityMode || 'per_item',
      excludeCartItemId: cartItem._id,
    });

    await cartItem.save();
    const populated = await CartItem.findById(cartItem._id)
      .populate('product')
      .populate('addons.product');

    res.json({
      success: true,
      message: 'Cart updated.',
      item: populated,
    });
  })
);

// DELETE /api/cart/:id
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const deleted = await CartItem.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });

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
    const result = await CartItem.deleteMany({ user: req.user._id });
    res.json({
      success: true,
      message: `${result.deletedCount} cart entr${result.deletedCount === 1 ? 'y' : 'ies'} removed.`,
      deletedCount: result.deletedCount,
    });
  })
);

module.exports = router;
