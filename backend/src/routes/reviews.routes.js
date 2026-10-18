const express = require('express');
const reviewRepository = require('../repositories/reviewRepository');
const productRepository = require('../repositories/productRepository');
const { requireAuth, optionalAuth, requireAdmin } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');

const router = express.Router();

function getDisplayName(user) {
  if (!user) return 'Anonymous';
  const full = (user.full_name || '').trim();
  if (full) return full;
  const first = (user.first_name || '').trim();
  const last = (user.last_name || '').trim();
  if (first || last) return `${first} ${last}`.trim();
  return user.username || user.email || 'Customer';
}

// 1. Get reviews and summary for a single menu item (Public)
router.get(
  '/item/:itemId',
  asyncHandler(async (req, res) => {
    const { itemId } = req.params;
    const [reviews, summary] = await Promise.all([
      reviewRepository.findByItem(itemId),
      reviewRepository.getItemSummary(itemId),
    ]);

    res.json({
      success: true,
      reviews,
      summary,
    });
  })
);

const { query } = require('../config/db');

// 1b. Get all customer reviews feed (Website reviews + Item reviews with comments)
router.get(
  '/feed',
  asyncHandler(async (req, res) => {
    const { limit } = req.query;
    const safeLimit = Math.min(Number(limit) || 100, 200);
    const websiteReviews = await reviewRepository.getWebsiteReviews(safeLimit);

    let itemReviews = [];
    try {
      const itemSql = `
        SELECT r.id, r.customer_id, r.customer_name,
               COALESCE(NULLIF(u.avatar_url, ''), '') AS customer_avatar,
               r.rating, r.comment, r.created_at,
               p.name AS item_name, p.image AS item_image
        FROM reviews r
        JOIN products p ON r.item_id = p.id
        LEFT JOIN users u ON u.id = r.customer_id
        WHERE r.comment IS NOT NULL AND TRIM(r.comment) != ''
        ORDER BY r.created_at DESC
        LIMIT $1
      `;
      const itemRes = await query(itemSql, [safeLimit]);
      itemReviews = itemRes.rows.map((r) => ({
        id: r.id,
        _id: r.id,
        customerId: r.customer_id,
        customerName: r.customer_name,
        customerAvatar: r.customer_avatar || '',
        rating: Number(r.rating),
        comment: r.comment || '',
        createdAt: r.created_at,
        source: r.item_name ? `Review for ${r.item_name}` : 'Menu Item',
        media: r.item_image ? [r.item_image] : [],
        verified: true,
      }));
    } catch (err) {
      console.warn('Could not query item reviews for feed:', err.message);
    }

    const all = [
      ...websiteReviews.map((w) => ({
        ...w,
        source: 'Website Review',
        media: [],
        verified: true,
      })),
      ...itemReviews,
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
      success: true,
      reviews: all,
    });
  })
);

// 1b-2. Get website reviews / testimonials (Public)
router.get(
  '/website',
  asyncHandler(async (req, res) => {
    const { limit } = req.query;
    const reviews = await reviewRepository.getWebsiteReviews(limit ? Number(limit) : 30);
    res.json({
      success: true,
      reviews,
    });
  })
);

// 1c. Submit website review / feedback (Authenticated Customer or Guest)
router.post(
  '/website',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { rating, comment, customerName: customName } = req.body;
    const ratingNum = Number(rating);
    if (!rating || isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      throw new AppError('Please select a star rating between 1 and 5.', 400);
    }

    const trimmedComment = (comment || '').trim();
    if (!trimmedComment) {
      throw new AppError('Please write a short review or feedback about the website.', 400);
    }

    const customerName = req.user
      ? getDisplayName(req.user)
      : ((customName || '').trim() || 'Happy Customer');
    const customerAvatar = req.user
      ? req.user.avatarUrl || req.user.avatar || req.user.profile_image || ''
      : '';

    const review = await reviewRepository.createWebsiteReview({
      customerId: req.user ? req.user.id : null,
      customerName,
      customerAvatar,
      rating: ratingNum,
      comment: trimmedComment.slice(0, 500),
    });

    res.status(201).json({
      success: true,
      review: {
        ...review,
        source: 'Website Review',
        media: [],
        verified: true,
      },
      message: 'Thank you for your feedback!',
    });
  })
);

// 1d. Quick-rate a product directly (1-5 stars without dialog modal)
router.post(
  '/rate',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { itemId, rating } = req.body;
    if (!itemId) {
      throw new AppError('Item ID is required.', 400);
    }
    const ratingNum = Number(rating);
    if (!rating || isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      throw new AppError('Please select a valid star rating (1 to 5).', 400);
    }

    const product = await productRepository.findById(itemId);
    if (!product) {
      throw new AppError('Menu item not found.', 404);
    }

    const customerId = req.user ? req.user.id : null;
    const customerName = req.user ? getDisplayName(req.user) : 'Guest Customer';
    const review = await reviewRepository.quickRate({
      itemId,
      customerId,
      customerName,
      rating: ratingNum,
    });

    const summary = await reviewRepository.getItemSummary(itemId);

    res.json({
      success: true,
      review,
      summary,
      message: `Rated ${ratingNum} stars!`,
    });
  })
);

// 1e. Get current customer's star ratings map (Authenticated)
router.get(
  '/my-ratings',
  requireAuth,
  asyncHandler(async (req, res) => {
    const reviews = await reviewRepository.findByCustomer(req.user.id);
    const ratingsMap = {};
    for (const r of reviews) {
      if (r.itemId) ratingsMap[r.itemId] = r.rating;
    }
    res.json({
      success: true,
      ratings: ratingsMap,
    });
  })
);

// 2. Get customer's reviews (Authenticated)
router.get(
  '/my',
  requireAuth,
  asyncHandler(async (req, res) => {
    const reviews = await reviewRepository.findByCustomer(req.user.id);
    res.json({
      success: true,
      reviews,
    });
  })
);

// 3. Check if current customer reviewed an item
router.get(
  '/check/:itemId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { itemId } = req.params;
    const review = await reviewRepository.findCustomerReviewForItem(
      req.user.id,
      itemId
    );
    res.json({
      success: true,
      hasReviewed: Boolean(review),
      review,
    });
  })
);

// 4. Create a new review (Authenticated Customer)
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { itemId, rating, comment } = req.body;

    if (!itemId) {
      throw new AppError('Item ID is required.', 400);
    }

    const ratingNum = Number(rating);
    if (!rating || isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      throw new AppError('Please select a star rating.', 400);
    }

    const product = await productRepository.findById(itemId);
    if (!product) {
      throw new AppError('Menu item not found.', 404);
    }

    // Check if customer already reviewed this item
    const existing = await reviewRepository.findCustomerReviewForItem(
      req.user.id,
      itemId
    );
    if (existing) {
      throw new AppError(
        'You have already reviewed this item. You can edit your existing review.',
        400
      );
    }

    const customerName = getDisplayName(req.user);
    const review = await reviewRepository.create({
      itemId,
      customerId: req.user.id,
      customerName,
      rating: ratingNum,
      comment: (comment || '').trim().slice(0, 300),
    });

    const summary = await reviewRepository.getItemSummary(itemId);

    res.status(201).json({
      success: true,
      review,
      summary,
      message: 'Review saved!',
    });
  })
);

// 5. Update an existing review (Authenticated Customer)
router.put(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { rating, comment } = req.body;

    const ratingNum = Number(rating);
    if (!rating || isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      throw new AppError('Please select a star rating.', 400);
    }

    const existing = await reviewRepository.findById(id);
    if (!existing) {
      throw new AppError('Review not found.', 404);
    }

    if (existing.customerId !== req.user.id && req.user.role !== 'admin') {
      throw new AppError('You can only edit your own reviews.', 403);
    }

    const updated = await reviewRepository.update(id, existing.customerId, {
      rating: ratingNum,
      comment: (comment || '').trim().slice(0, 300),
    });

    const summary = await reviewRepository.getItemSummary(existing.itemId);

    res.json({
      success: true,
      review: updated,
      summary,
      message: 'Review updated.',
    });
  })
);

// 6. Delete a review (Customer can delete own, Admin can delete any)
router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const existing = await reviewRepository.findById(id);
    if (!existing) {
      throw new AppError('Review not found.', 404);
    }

    const isAdminUser = req.user.role === 'admin';
    if (!isAdminUser && existing.customerId !== req.user.id) {
      throw new AppError('You do not have permission to delete this review.', 403);
    }

    const customerIdToDelete = isAdminUser ? null : req.user.id;
    await reviewRepository.delete(id, customerIdToDelete);

    res.json({
      success: true,
      message: 'Review removed.',
    });
  })
);

// 7. Admin: Get all reviews with search and rating filters
router.get(
  '/admin/all',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { search, rating, limit, offset } = req.query;
    const reviews = await reviewRepository.findAll({
      search,
      rating,
      limit: limit ? Number(limit) : 200,
      offset: offset ? Number(offset) : 0,
    });

    res.json({
      success: true,
      count: reviews.length,
      reviews,
    });
  })
);

module.exports = router;
