# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Express.js backend with PostgreSQL persistence, plus a static HTML/CSS/JavaScript frontend served from the same app. This project is a web application, not a native mobile app.

## Users

Primary users are customers placing burger orders and shop staff/admins managing menu, stock, orders, and billing. The product supports both customer self-service and backend operations for staff.

## Product Purpose

This application lets a burger shop take online orders, manage inventory and pricing, process checkout, and track order fulfillment from placement through completion. Success means customers can browse the menu, place orders with saved details, and receive status updates while admins can process orders and maintain the catalog with minimal friction.

## Positioning

The product is a complete ordering and billing workflow focused on burger retail operations, with a particular emphasis on fulfillment states, cancellation/reservation handling, stock integrity, admin monitoring, and customer order tracking. It is a full operational system rather than a marketing landing page or a generic storefront template.

## Operating Context

The system runs as a web app served from a Node/Express backend on localhost during development, with PostgreSQL as the durable data layer. Customer-facing workflow includes browsing items, adding extras, checkout, and order status tracking. Admin workflow includes catalog management, order management, fulfillment updates, and metrics dashboards.

## Capabilities and Constraints

Confirmed capabilities include:

- curated burger menu with categories and add-ons;
- authenticated customer accounts and admin role access;
- cart and checkout flow with contact details and payment method selection;
- order lifecycle states for pending, accepted, ready, and completed orders;
- order cancellation rules with atomic stock restoration;
- customer profile for saved details and order history;
- admin dashboard metrics, product management, and order management;
- registration email verification flow with a one-time migration path for existing users;
- stock reservation and release logic managed in PostgreSQL transactions.

Confirmed technical constraints and product facts:

- frontend is static HTML/CSS/JS served by the backend;
- backend uses PostgreSQL with an `app` schema and seed/migration scripts;
- CORS, JWT auth, and environment-based configuration are required;
- the system expects a local PostgreSQL instance and a configured `.env` file before running the seed step;
- existing app logic and README are the source of truth for required flows and operational rules.

## Brand Commitments

The product name is "Burger Ordering & Billing System" and the app presents itself as a burger shop ordering experience. The codebase and documentation commit to a practical, retail-focused brand rather than a luxury, gaming, or enterprise aesthetic. No additional brand system, visual identity, or copy guidelines were explicitly provided beyond the functional product naming in the project documentation.

## Evidence on Hand

- README: `README.md` documents the system purpose, startup steps, order lifecycle, and admin/customer workflows.
- Backend package and scripts: `backend/package.json` confirms the Express + PostgreSQL + Node stack and available scripts.
- Backend configuration template: `backend/.env.example` confirms required environment variables for database, auth, email, and frontend integration.
- Frontend app structure: `frontend/` contains the static customer/admin web surfaces and JavaScript modules.

## Product Principles

1. Reliable retail operations matter more than novelty; the system must protect stock, orders, and customer trust.
2. Customer self-service should be straightforward, fast, and transparent, especially during ordering and fulfillment tracking.
3. Admin workflows should be operationally clear, with scripts and metrics that support real shop decision-making.
4. Evidence-backed workflows should remain durable across seed, migration, and runtime behavior.
5. The product should prioritize a complete ordering cycle over a generic storefront shell.

## Accessibility & Inclusion

No product-specific accessibility requirements were explicitly stated beyond the app being a full operational web experience. Future work should keep standard accessible web behavior in mind, especially for forms, dialogs, focus states, and status messaging.
