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
    const { productId, quantity, addons } = req.body;

    const product = await Product.findById(productId);
    if (!product || !product.isAvailable) {
      throw new AppError('This product is currently not available.', 400);
    }

    if (product.stock < quantity) {
      throw new AppError(`Only ${product.stock} left in stock for ${product.name}.`, 400);
    }

    // Validate addons
    const validatedAddons = [];
    if (addons && addons.length > 0) {
      for (const addonItem of addons) {
        const addonProd = await Product.findById(addonItem.product);
        if (!addonProd || !addonProd.isAvailable || !addonProd.isAddon) {
          throw new AppError('One of the selected add-ons is not available.', 400);
        }
        const neededQty = addonItem.qty * quantity;
        if (addonProd.stock < neededQty) {
          throw new AppError(`Only ${addonProd.stock} left for add-on "${addonProd.name}".`, 400);
        }
        validatedAddons.push({
          product: addonProd._id,
          qty: addonItem.qty,
        });
      }
    }

    const newAddonKey = serializeAddons(validatedAddons);

    // Look for existing cart item with the same product and identical addons
    const userCartItems = await CartItem.find({
      user: req.user._id,
      product: productId,
    });

    let matchedItem = null;
    for (const item of userCartItems) {
      if (serializeAddons(item.addons) === newAddonKey) {
        matchedItem = item;
        break;
      }
    }

    if (matchedItem) {
      const newQty = matchedItem.quantity + quantity;
      if (product.stock < newQty) {
        throw new AppError(`Cannot add more. Only ${product.stock} items left in stock.`, 400);
      }
      matchedItem.quantity = newQty;
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

    if (quantity !== undefined) {
      if (cartItem.product.stock < quantity) {
        throw new AppError(`Only ${cartItem.product.stock} left in stock.`, 400);
      }
      cartItem.quantity = quantity;
    }

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

      // Check if updating addons causes it to match another cart line with the same product
      const siblingItems = await CartItem.find({
        user: req.user._id,
        product: cartItem.product._id,
        _id: { $ne: cartItem._id },
      });

      const currentKey = serializeAddons(validatedAddons);
      for (const sibling of siblingItems) {
        if (serializeAddons(sibling.addons) === currentKey) {
          // Merge sibling into current and delete sibling
          cartItem.quantity += sibling.quantity;
          await CartItem.findByIdAndDelete(sibling._id);
          break;
        }
      }
    }

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
    });
  })
);

// DELETE /api/cart (clear all)
router.delete(
  '/',
  asyncHandler(async (req, res) => {
    await CartItem.deleteMany({ user: req.user._id });
    res.json({
      success: true,
      message: 'Cart cleared.',
    });
  })
);

module.exports = router;
