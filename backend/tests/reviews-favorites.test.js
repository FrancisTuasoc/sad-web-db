const assert = require('node:assert/strict');
const { test } = require('node:test');
const reviewRepository = require('../src/repositories/reviewRepository');
const favoriteRepository = require('../src/repositories/favoriteRepository');

test('reviewRepository.mapReview correctly maps database columns to review object', () => {
  const row = {
    id: 'rev-1',
    item_id: 'prod-cdo-burger',
    customer_id: 'cust-123',
    customer_name: 'John Doe',
    rating: '5',
    comment: 'Best burger in town!',
    created_at: new Date('2026-10-16T10:00:00Z'),
    updated_at: new Date('2026-10-16T10:00:00Z'),
    item_name: 'CDO Burger',
    item_image: 'assets/burgers/cdo.png',
    item_price: '27.00',
    item_slug: 'cdo-burger',
    category_name: 'Burgers',
  };

  const review = reviewRepository.mapReview(row);

  assert.equal(review.id, 'rev-1');
  assert.equal(review._id, 'rev-1');
  assert.equal(review.itemId, 'prod-cdo-burger');
  assert.equal(review.customerId, 'cust-123');
  assert.equal(review.customerName, 'John Doe');
  assert.equal(review.rating, 5);
  assert.equal(review.comment, 'Best burger in town!');
  assert.equal(review.itemName, 'CDO Burger');
  assert.equal(review.itemPrice, 27);
  assert.equal(review.categoryName, 'Burgers');
});

test('reviewRepository.mapReview handles empty or missing optional fields', () => {
  assert.equal(reviewRepository.mapReview(null), null);

  const row = {
    id: 'rev-2',
    item_id: 'prod-2',
    customer_id: 'cust-456',
    customer_name: 'Jane',
    rating: 4,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const review = reviewRepository.mapReview(row);
  assert.equal(review.id, 'rev-2');
  assert.equal(review.comment, '');
  assert.equal(review.itemName, '');
  assert.equal(review.itemPrice, undefined);
});

test('favoriteRepository.mapFavorite correctly maps row and nested product info', () => {
  const row = {
    id: 'fav-1',
    customer_id: 'cust-123',
    item_id: 'prod-cheese-burger',
    added_at: new Date('2026-10-16T10:00:00Z'),
    item_name: 'Cheese Burger',
    item_slug: 'cheese-burger',
    item_price: '35.00',
    item_stock: '40',
    item_is_available: true,
    item_image: 'assets/cheese.png',
    item_description: 'Melted cheddar burger',
    category_name: 'Cheese Burgers',
    average_rating: '4.5',
    review_count: '10',
  };

  const fav = favoriteRepository.mapFavorite(row);

  assert.equal(fav.id, 'fav-1');
  assert.equal(fav.customerId, 'cust-123');
  assert.equal(fav.itemId, 'prod-cheese-burger');
  assert.ok(fav.product);
  assert.equal(fav.product.id, 'prod-cheese-burger');
  assert.equal(fav.product.name, 'Cheese Burger');
  assert.equal(fav.product.price, 35);
  assert.equal(fav.product.averageRating, 4.5);
  assert.equal(fav.product.reviewCount, 10);
  assert.equal(fav.product.isAvailable, true);
});
