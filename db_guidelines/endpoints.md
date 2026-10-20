# System API Endpoints & Backend URL Guidelines

## 🌐 System Backend & API URLs

| Environment | Base URL | API Base URL |
| :--- | :--- | :--- |
| **Production Backend** | `https://sad-web-db.onrender.com` | `https://sad-web-db.onrender.com/api` |
| **Local Development** | `http://localhost:5000` | `http://localhost:5000/api` |
| **Production Frontend** | `https://sad-web-db-frontend.vercel.app` | — |

---

## 📋 Comprehensive API Endpoints List

### 1. Authentication & Account Recovery (`/api/auth`)
*Base Path: `/api/auth`*

| Method | Endpoint | Auth Required | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/auth/verification-status` | No | Check if email verification service is configured |
| `POST` | `/api/auth/register` | No | Register a new customer account |
| `POST` | `/api/auth/login` | No | Customer / Admin login; returns JWT token and user info |
| `GET` | `/api/auth/me` | Yes (Bearer Token) | Retrieve authenticated user profile |
| `GET` | `/api/auth/verify-email` | No | Verify email address using token from verification link |
| `POST` | `/api/auth/resend-verification` | No | Resend account verification email link |
| `POST` | `/api/auth/password-reset/request` | No | Request password reset email |
| `POST` | `/api/auth/password-reset/validate` | No | Validate password reset token validity |
| `POST` | `/api/auth/password-reset/confirm` | No | Set new password with valid reset token |

---

### 2. Products & Catalog (`/api/products`)
*Base Path: `/api/products`*

| Method | Endpoint | Auth Required | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/products` | No | List products (Query params: `category`, `search`, `sort`, `isAddon`) |
| `GET` | `/api/products/addons` | No | List all active add-on items |
| `GET` | `/api/products/:id` | No | Get single product details by ID |

---

### 3. Categories (`/api/categories`)
*Base Path: `/api/categories`*

| Method | Endpoint | Auth Required | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/categories` | No | Get all menu categories ordered by sort order |

---

### 4. Shopping Cart (`/api/cart`)
*Base Path: `/api/cart` (All endpoints require Bearer Token authentication)*

| Method | Endpoint | Auth Required | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/cart` | Yes | Get current user's cart items with computed prices |
| `POST` | `/api/cart` | Yes | Add item with optional add-ons to cart |
| `PATCH` | `/api/cart/:id` | Yes | Update item quantity, add-ons, or quantity mode |
| `DELETE` | `/api/cart/:id` | Yes | Remove a single item line from cart |
| `DELETE` | `/api/cart` | Yes | Clear all items from user's cart |

---

### 5. Orders & Checkout (`/api/orders`)
*Base Path: `/api/orders` (All endpoints require Bearer Token authentication)*

| Method | Endpoint | Auth Required | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/orders` | Yes | Place a new order with cart items, contact, fulfillment, and payment proof |
| `GET` | `/api/orders/mine` | Yes | Get user's order history (Query params: `status=active|history`, `limit`) |
| `GET` | `/api/orders/:id` | Yes | Get specific order details by ID |
| `GET` | `/api/orders/:id/gcash-proof` | Yes (Owner/Admin) | View uploaded GCash payment proof receipt |
| `PATCH` | `/api/orders/:id/cancel` | Yes | Customer cancels a pending order (restores stock) |
| `PATCH` | `/api/orders/:id/complete` | Yes | Customer confirms pickup/delivery receipt to complete order |

---

### 6. Customer Account & Dashboard (`/api/customer`)
*Base Path: `/api/customer` (All endpoints require Bearer Token authentication)*

| Method | Endpoint | Auth Required | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/customer/me` | Yes | Get customer account profile details |
| `PATCH` | `/api/customer/me/username` | Yes | Update customer username |
| `GET` | `/api/customer/stats` | Yes | Get order counts, total spent, avg order value, favorite item |
| `GET` | `/api/customer/kpis` | Yes | Get customer KPI metrics and 5 recent orders |
| `GET` | `/api/customer/orders` | Yes | Get paginated orders list with status and date filters |

---

### 7. User Profile (`/api/profile`)
*Base Path: `/api/profile` (All endpoints require Bearer Token authentication)*

| Method | Endpoint | Auth Required | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/profile` | Yes | Get user profile info, contact details, and address |
| `PATCH` | `/api/profile` | Yes | Update profile details (name, contact email, phone, address) |
| `PATCH` | `/api/profile/password` | Yes | Change user password |
| `POST` | `/api/profile/avatar` | Yes | Upload user avatar image (multipart/form-data) |
| `GET` | `/api/profile/avatar` | Yes | Get user avatar image file / redirect |
| `GET` | `/api/profile/avatar/storage` | Yes (Admin) | Check avatar storage usage against quota |

---

### 8. Reviews & Ratings (`/api/reviews`)
*Base Path: `/api/reviews`*

| Method | Endpoint | Auth Required | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/reviews/item/:itemId` | No | Get reviews and rating summary for a menu item |
| `GET` | `/api/reviews/website` | No | Get website testimonials / reviews |
| `POST` | `/api/reviews/website` | Yes | Submit website review / feedback |
| `POST` | `/api/reviews/rate` | Optional | Quick star rating (1–5) on a product |
| `GET` | `/api/reviews/my-ratings` | Yes | Get current user's star rating map |
| `GET` | `/api/reviews/my` | Yes | Get all reviews authored by current user |
| `GET` | `/api/reviews/check/:itemId` | Yes | Check if current user reviewed a specific item |
| `POST` | `/api/reviews` | Yes | Create a detailed review for a menu item |
| `PUT` | `/api/reviews/:id` | Yes | Update an existing review |
| `DELETE` | `/api/reviews/:id` | Yes | Delete a review (Customer owner or Admin) |
| `GET` | `/api/reviews/admin/all` | Yes (Admin) | Admin view of all reviews with search and rating filters |

---

### 9. Favorites (`/api/favorites`)
*Base Path: `/api/favorites`*

| Method | Endpoint | Auth Required | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/favorites/my` | Yes | Get customer's full favorite items list |
| `GET` | `/api/favorites/ids` | Yes | Get array of customer's favorited item IDs |
| `POST` | `/api/favorites/toggle` | Yes | Toggle product favorite state (add/remove) |
| `POST` | `/api/favorites/:itemId` | Yes | Explicitly add item to favorites |
| `DELETE` | `/api/favorites/:itemId` | Yes | Explicitly remove item from favorites |
| `GET` | `/api/favorites/rankings` | Yes (Admin) | Get ranking of most favorited items |

---

### 10. Store Settings (`/api/settings`)
*Base Path: `/api/settings`*

| Method | Endpoint | Auth Required | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/settings/public` | No | Get public store info (operating hours, delivery fee, payment options) |

---

### 11. Real-time Events Stream (`/api/stream`)
*Base Path: `/api/stream`*

| Method | Endpoint | Auth Required | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/stream` | No | Server-Sent Events (SSE) stream for live stock & availability updates |

---

### 12. Admin Control Center (`/api/admin`)
*Base Path: `/api/admin` (All endpoints require Bearer Token with Admin role)*

| Method | Endpoint | Auth Required | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/admin/stats` | Yes (Admin) | Dashboard summary metrics (revenue, orders, customer counts) |
| `GET` | `/api/admin/orders` | Yes (Admin) | Paginated order list with search, status, and date filters |
| `GET` | `/api/admin/orders/:id` | Yes (Admin) | Single order details |
| `PATCH` | `/api/admin/orders/:id/status` | Yes (Admin) | Update status (`preparing`, `ready_for_pickup`, `ready_to_deliver`, `completed`) |
| `PATCH` | `/api/admin/orders/:id/cancel` | Yes (Admin) | Cancel order and restore stock |
| `PATCH` | `/api/admin/orders/:id/paid` | Yes (Admin) | Mark order payment as paid |
| `GET` | `/api/admin/products` | Yes (Admin) | Full product inventory list (supports stock filters) |
| `POST` | `/api/admin/products` | Yes (Admin) | Create a new product or add-on |
| `PUT` | `/api/admin/products/:id` | Yes (Admin) | Update product details |
| `PATCH` | `/api/admin/products/:id/stock` | Yes (Admin) | Set or increment/decrement product stock |
| `PATCH` | `/api/admin/products/:id/availability` | Yes (Admin) | Toggle product availability |
| `DELETE` | `/api/admin/products/:id` | Yes (Admin) | Permanently delete product |
| `POST` | `/api/admin/categories` | Yes (Admin) | Create a category |
| `PUT` | `/api/admin/categories/:id` | Yes (Admin) | Update category name and sort order |
| `DELETE` | `/api/admin/categories/:id` | Yes (Admin) | Delete category (only if no products assigned) |
| `GET` | `/api/admin/customers` | Yes (Admin) | List customer accounts with order counts and total spent |
| `GET` | `/api/admin/customers/:id` | Yes (Admin) | View customer account details and order history |
| `PATCH` | `/api/admin/customers/:id/status` | Yes (Admin) | Suspend or reactivate customer account |
| `GET` | `/api/admin/settings` | Yes (Admin) | View all store settings |
| `PATCH` | `/api/admin/settings` | Yes (Admin) | Update store settings |
| `GET` | `/api/admin/profile` | Yes (Admin) | View administrator profile details |
| `PATCH` | `/api/admin/profile` | Yes (Admin) | Update administrator profile |
| `PATCH` | `/api/admin/password` | Yes (Admin) | Change administrator password |

---

### 13. Notifications (`/api/notifications`)
*Base Path: `/api/notifications` (All endpoints require Bearer Token authentication)*

| Method | Endpoint | Auth Required | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/notifications` | Yes | List notifications & unread count (Query param: `scope=admin`) |
| `PATCH` | `/api/notifications/read-all` | Yes | Mark all notifications as read |
| `PATCH` | `/api/notifications/by-order/:orderId/read` | Yes | Mark notifications for a specific order as read |
| `PATCH` | `/api/notifications/:id/read` | Yes | Mark a single notification as read |

---

### 14. Frontend HTML Routes (Static / Direct)

| Method | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/` or `/index.html` | Customer Landing & Featured Menu Page |
| `GET` | `/menu.html` | Full Menu Catalog & Filter Page |
| `GET` | `/cart.html` | Shopping Cart & Checkout Modal |
| `GET` | `/profile.html` | User Profile & Order Tracking Dashboard |
| `GET` | `/login.html` | Customer / Admin Sign In Page |
| `GET` | `/register.html` | Customer Registration Page |
| `GET` | `/verify-email` or `/verify-email.html` | Registration Email Verification Page |
| `GET` | `/admin.html` | Administrator Control Center Dashboard |
