const express = require('express');
const favoriteRepository = require('../repositories/favoriteRepository');
const productRepository = require('../repositories/productRepository');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

const router = express.Router();

// 1. Get customer's favorites list (Authenticated)
router.get(
  '/my',
  requireAuth,
  asyncHandler(async (req, res) => {
    const favorites = await favoriteRepository.getCustomerFavorites(req.user.id);
    const favoriteItemIds = favorites.map((f) => f.itemId);

    res.json({
      success: true,
      favorites,
      favoriteItemIds,
    });
  })
);

// 2. Get customer's favorite item IDs only (Fast for catalog buttons)
router.get(
  '/ids',
  requireAuth,
  asyncHandler(async (req, res) => {
    const favoriteItemIds = await favoriteRepository.getCustomerFavoriteItemIds(
      req.user.id
    );
    res.json({
      success: true,
      favoriteItemIds,
    });
  })
);

// 3. Toggle favorite (Add if not present, remove if present)
router.post(
  '/toggle',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { itemId } = req.body;
    if (!itemId) {
      throw new AppError('Item ID is required.', 400);
    }

    const product = await productRepository.findById(itemId);
    if (!product) {
      throw new AppError('Menu item not found.', 404);
    }

    const isFav = await favoriteRepository.isFavorite(req.user.id, itemId);

    if (isFav) {
      await favoriteRepository.removeFavorite(req.user.id, itemId);
      return res.json({
        success: true,
        isFavorited: false,
        itemId,
        message: 'Removed from Favorites',
      });
    } else {
      await favoriteRepository.addFavorite(req.user.id, itemId);
      return res.json({
        success: true,
        isFavorited: true,
        itemId,
        message: 'Added to Favorites',
      });
    }
  })
);

// 4. Explicit add favorite
router.post(
  '/:itemId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { itemId } = req.params;
    const product = await productRepository.findById(itemId);
    if (!product) {
      throw new AppError('Menu item not found.', 404);
    }

    await favoriteRepository.addFavorite(req.user.id, itemId);
    res.json({
      success: true,
      isFavorited: true,
      itemId,
      message: 'Added to Favorites',
    });
  })
);

// 5. Explicit remove favorite
router.delete(
  '/:itemId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { itemId } = req.params;
    await favoriteRepository.removeFavorite(req.user.id, itemId);
    res.json({
      success: true,
      isFavorited: false,
      itemId,
      message: 'Removed from Favorites',
    });
  })
);

// 6. Admin: Get top favorited items ranking
router.get(
  '/rankings',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const rankings = await favoriteRepository.getTopFavorites(limit);

    res.json({
      success: true,
      count: rankings.length,
      rankings,
    });
  })
);

module.exports = router;
