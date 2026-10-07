# casestudy-system — Burger Ordering & Billing System

A complete, full-featured Burger Ordering and Billing Web Application built with an Express.js backend and a clean, responsive vanilla JavaScript/CSS frontend.

Add-on quantities selected for new cart entries represent the total extras for that cart line, not extras per burger. Older saved cart lines retain their per-burger quantity and pricing.

---

## 📁 Project Directory Structure

```text
casestudy-system/
├── README.md                   # System documentation and startup guide
├── backend/                    # Node.js / Express backend
│   ├── .env                    # Environment variables (MONGODB_URI, JWT_SECRET, etc.)
│   ├── .env.example            # Environment template
│   ├── package.json            # Node.js dependencies & scripts
│   ├── server.js               # Express application entrypoint & static host
│   └── src/
│       ├── config/             # DB connection & environment configuration
│       ├── controllers/        # Auth, product, order, and settings controllers
│       ├── middleware/         # Auth, validation, and error middleware
│       ├── models/             # Mongoose schemas (User, Product, Order, Settings)
│       ├── routes/             # REST API routes
│       ├── seed/               # Database seeder with all 35 menu items & addons
│       └── utils/              # Stock streams and helpers
└── frontend/                   # Client-side static application
    ├── assets/
    │   ├── items/              # 35 food and addon item assets (.png / .jpg)
    │   └── logo.svg            # Responsive brand vector logo
    ├── css/
    │   ├── base.css            # Color variables, typography, and reset
    │   ├── components.css      # Cards, buttons, badges, modals, toast
    │   └── pages.css           # Page layouts and responsive rules
    ├── js/                     # Modular client-side ES modules
    │   ├── api.js              # Fetch wrapper & token management
    │   ├── auth.js             # Authentication state, login, register, logout
    │   ├── cart.js             # Server-backed cart management
    │   ├── checkout.js         # Multi-step checkout & payment processing
    │   ├── home.js             # Home page featured products & cart modal
    │   ├── menu.js             # Full menu catalog, live search & category filters
    │   ├── profile.js          # Customer profile & live order history
    │   ├── admin.js            # Admin dashboard: metrics, products, orders, settings
    │   ├── stock-stream.js     # Real-time stock event listener
    │   └── ui.js               # Dynamic navbar, footer, toast & modals
    ├── index.html              # Landing page
    ├── menu.html               # Menu catalog page
    ├── cart.html               # Cart & checkout page
    ├── profile.html            # User account & order tracking page
    ├── login.html              # Sign in page
    ├── register.html           # Sign up page
    └── admin.html              # Administrative control center
```

---

## 🚀 Quick Start Guide

### 1. Backend Setup & Dependencies
The `package.json` resides cleanly inside `backend/` without any duplicate root clutter:

```bash
cd backend
npm install
```

### 2. Configure Environment Variables
Copy `backend/.env.example` to `backend/.env`, then fill in the database URI, a long random JWT secret, and your administrator email and password. Keep `backend/.env` private; it is excluded from Git. Never put real credentials in this README or commit them. The administrator credentials in this file are used when the account is first created; changing them later does not change an existing account's password.

### 3. Seed Database
Populate the database with all 35 products, categories, add-ons, and an administrator created using the credentials in `backend/.env`:
```bash
cd backend
npm run seed
```

### 4. Start Server
Run the production server:
```bash
cd backend
npm start
```
Or run with live reload during development:
```bash
npm run dev
```

The Express server serves the backend API at `http://localhost:5000/api` and statically serves the responsive `frontend/` at `http://localhost:5000/`.

## Checkout and order status

Checkout opens in a responsive dialog from the compact cart summary. It requires a fulfillment choice first, then contact details, and then a payment method supported for that fulfillment. The dialog can be dismissed with Escape or its close button, and restores focus to the checkout button when closed. Placing an order creates it as `pending`; admins see newest pending orders under **Orders Management** and can accept one to move pickup orders to `ready_for_pickup` or delivery orders to `ready_to_deliver`. Customers track pickup and delivery orders in separate tabs in their profile and confirm collection or receipt to complete them. Admin order lists refresh every 10 seconds.

Customers can cancel only while an order is still `pending`. Cancellation and admin acceptance compete through an atomic status transition: whichever succeeds first wins. If acceptance wins, the customer is told that online cancellation is no longer available and must contact the shop immediately; staff should coordinate any cancellation, refund, or stock adjustment manually. Cancellation also restores reserved stock in the same MongoDB transaction, so the configured MongoDB deployment must support transactions (a replica set, including MongoDB Atlas).

## Admin dashboard metrics

Lifetime revenue includes completed orders only; cancelled and still-active orders are excluded. The all-orders, pending, completed, and cancelled cards count their correspondingly labelled statuses, while customers counts registered customer accounts. Daily sales use the Asia/Manila calendar day; weekly and monthly sales cover the previous 7 and 30 rolling days. Sales and chart buckets use the order's recorded completion time, not its creation time. For older completed orders without a completion entry in their status history, the dashboard uses the order creation time.

---

## 🍔 Food Asset Images
All 35 authentic item images are located directly in `frontend/assets/items/`:
- **Burgers**: `cdo-burger.png`, `burger-with-ham.png`, `burger-with-egg.png`, `burger-with-bacon.png`, `burger-bacon-ham.png`
- **Cheese Burgers**: `cheeseburger.png`, `cheeseburger-with-ham.png`, `cheeseburger-with-egg.png`, `cheeseburger-with-bacon.png`
- **Sandwiches**: `ham.png`, `ham-with-cheese.png`, `ham-with-egg.png`, `ham-cheese-with-egg.png`, `egg-cheese.png`, `egg-sandwich.png`, `bacon-sandwich.png`, `bacon-with-ham.png`, `bacon-with-egg.png`, `bacon-with-cheese.png`, `bacon-cheese-with-ham.png`, `bacon-cheese-with-egg.png`
- **Complete**: `complete.png`, `complete-change-bacon.png`, `complete-with-bacon.png`
- **Footlong**: `footlong.png`, `footlong-ham.png`, `footlong-egg.png`, `footlong-cheese.png`, `footlong-bacon.png`, `footlong-cheese-bacon.png`, `footlong-ham-bacon.png`
- **Grace Siomai**: `grace-siomai-4pcs.png`
- **Addons**: `add-patty.png`, `add-ham.png`, `add-coleslaw.png`

Aliases and symlinks are also maintained so both kebab-case slugs and `.jpg`/`.png` extensions resolve seamlessly with automatic SVG fallback if any image fails to load.
