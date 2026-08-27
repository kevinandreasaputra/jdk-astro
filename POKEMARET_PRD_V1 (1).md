# POKEMARET BUSINESS OS — PRD V1

**Document Type:** Product Requirements Document
**Version:** 1.0
**Status:** Development-ready functional specification
**Business:** Pokemaret (PM)
**Primary Location:** Jordan Toys, QBig BSD City, Serpong
**Primary POS Device:** iPhone
**Back Office Device:** Laptop/Desktop browser
**Platform:** Responsive Web App / PWA, Offline-first
**Printer:** Not required
**Barcode:** Out of scope for V1
**Market Price API:** Out of scope for V1; optional manual field only

---

## 0. IMPORTANT INSTRUCTIONS FOR CLAUDE CODE

Build this system as a real production-oriented application, not a mockup.

### Non-negotiable engineering principles

1. **Do not invent business rules** that contradict this PRD.
2. **Do not simplify financial or inventory logic** by deleting history, overwriting cost, or mixing transaction types.
3. **Never delete completed financial/inventory transactions.** Use reversal, refund, void, or adjustment flows.
4. **Server-side authorization is mandatory.** Hiding a button in the UI is not security.
5. **Inventory movement and financial movement must be auditable.**
6. **Offline POS must be designed from the beginning**, not bolted on after the online version works.
7. **The primary POS experience must be fast on an iPhone touchscreen.**
8. **Back-office workflows are optimized for laptop/desktop.**
9. **Do not require barcode scanning in V1.**
10. **Do not require market-price APIs in V1.**
11. **Mystery Pack is an internal inventory transformation/production process, not a normal bundle.**
12. **Consignment inventory is not owned inventory.**
13. **Purchase is not the same thing as payment.**
14. **Sale is not the same thing as payment.**
15. **Owner withdrawal is not an operating expense.**
16. **Owner capital is not revenue.**
17. **Internal transfers between money accounts are not revenue or expense.**
18. **When data is unknown, label it Unknown/Estimated instead of inventing precision.**
19. **Do not over-engineer V1 with AI, automatic repricing, marketplace integrations, or complex loyalty systems.**
20. When implementation choices are ambiguous, prefer the simplest architecture that preserves the business rules below and document the choice.

---

# 1. PRODUCT VISION

Pokemaret needs a cloud-based, mobile-first business operating system for a TCG store. The system must allow one owner to run the store from an iPhone while keeping detailed inventory, purchase, cashflow, financial, event, and operational records accessible from a laptop.

The system is **not merely a POS**. It is a single source of truth for:

- Sales
- Inventory
- Acquisitions
- HPP / COGS
- Purchases and supplier payables
- Buyback / singles acquisition
- Bulk acquisition
- Trade and trade-in
- Consignment
- Bundles
- Mystery Pack production
- Refunds
- Giveaway / promotional inventory usage
- Gym events
- Cash / QRIS / bank / other money accounts
- Expenses
- Owner capital and withdrawals
- Audit trail
- Business reporting

The ultimate business purpose is to make Pokemaret capable of measuring and improving profitability toward a long-term owner-income target of Rp50,000,000/month.

---

# 2. BUSINESS CONTEXT

Pokemaret is a TCG store operating inside Jordan Toys at QBig BSD City. Current physical space is small: approximately one bazaar-style table and one display case. The owner currently serves customers personally and is therefore highly sensitive to data-entry friction.

Current operating realities:

- Owner currently uses an iPhone as the cashier/POS device.
- Laptop is available for detailed back-office work.
- No receipt printer is required at checkout.
- Internet may be unavailable or unstable; POS must continue working offline.
- POS must sync automatically when internet returns.
- Singles frequently have dynamic selling prices and negotiated prices.
- Singles may have different acquisition costs for identical cards.
- Singles may have different conditions.
- PM can acquire stock through supplier purchase, customer buyback, bulk purchase, trade, trade-in, and consignment.
- PM sells booster boxes as sealed boxes or opens them and sells packs individually.
- PM creates Mystery Packs from existing PM inventory.
- PM gives away inventory as customer-review rewards and other promotional activities.
- PM operates Pokémon Gym events.
- PM currently has no reliable historical transaction system and will require an opening-balance/initial-inventory migration.

---

# 3. V1 GOALS

## 3.1 Primary goals

### G1 — Fast store checkout
A simple sale should be completed on the iPhone in seconds, without exposing accounting complexity to the cashier.

### G2 — Reliable inventory tracking
Every stock movement must be explainable and auditable.

### G3 — Reliable money tracking
Every business money inflow/outflow must be attributable to a business event or owner movement.

### G4 — Practical TCG costing
Handle singles, bulk purchases, box-to-pack conversion, and Mystery Pack batch costing without requiring impossible administrative effort.

### G5 — Offline resilience
The primary iPhone POS must continue selling when internet is unavailable and sync automatically later.

### G6 — Security
Protect HPP, financial information, customer data, inventory, permissions, and audit records.

### G7 — Foundation for scale
The system must support future staff, additional devices, online sales, more advanced pricing, and additional locations without redesigning the core data model.

---

# 4. NON-GOALS / OUT OF SCOPE FOR V1

The following should NOT be implemented unless explicitly approved later:

- Native iOS application
- Native Android application
- Barcode scanning or barcode printing
- Market price scraping/API integration
- Automatic market-based repricing
- Public online marketplace
- Marketplace integrations
- Advanced customer loyalty points
- Automated WhatsApp marketing
- AI pricing/recommendations
- Dynamic customer-selected bundles
- Automated Mystery Pack randomization engine
- Multi-store management UI beyond preparing the schema for locations
- Full Indonesian tax/accounting software
- Complex tournament pairing / Swiss engine
- Advanced CRM segmentation
- Store credit system (not currently used)

---

# 5. USERS & ROLES

## 5.1 OWNER

Full access.

Can:

- View all sales
- View HPP
- View profit
- Change prices
- Override prices
- Perform refunds
- Perform stock adjustments
- Create purchases
- Perform buyback
- Perform trade/trade-in
- Manage consignment
- Manage Mystery Pack production
- Manage bundles
- Manage Gym
- View finance
- Perform owner capital/withdrawal
- Manage users and permissions
- View audit logs
- Manage configuration

## 5.2 STAFF

Default permissions:

- Create sale
- View selling price
- Search inventory
- Process payment
- Perform limited POS operations

By default, staff CANNOT:

- View HPP
- View supplier cost
- View profit
- Edit HPP
- Delete/rewrite transactions
- Perform unrestricted refund
- Perform unrestricted stock adjustment
- Change accounting configuration
- Perform owner withdrawal
- Change user permissions

Staff discount/price override authority must be configurable.

## 5.3 FUTURE ROLES

Schema should support future roles such as Manager or Inventory Staff without redesigning authentication.

---

# 6. CORE DOMAIN PRINCIPLES

## 6.1 Product is not Inventory

A Product represents what the item is. Inventory Lot represents a particular acquired stock layer/copy/group of stock.

Example:

Product:
> Pikachu ex / SV10 / 123/100 / JP / Regular

Inventory lots:
- Lot A: NM, cost Rp100,000, qty 1
- Lot B: NM, cost Rp150,000, qty 1
- Lot C: LP, cost Rp80,000, qty 1

The product remains one master product.

## 6.2 Sale is not Payment

A Sale represents what was sold. A Payment represents how money was paid.

One sale may have multiple payments (split payment).

## 6.3 Purchase is not Payment

A supplier purchase can be partially paid and leave an outstanding payable.

## 6.4 Stock quantity is derived from movement history

Stock movements are immutable ledger events. Current quantities may be cached for performance, but the ledger remains the source of truth.

## 6.5 Financial movement is a ledger

Cash/bank/QRIS movement must be attributable to a financial event.

## 6.6 Completed transactions are never deleted

Corrections must use:
- Refund
- Reversal
- Void
- Adjustment
- Corrective transaction

---

# 7. PRODUCT MASTER

## 7.1 Product entity

Minimum fields:

- product_id (immutable UUID)
- product_type
- name
- game
- set_name
- card_number
- language
- variant
- default_selling_price
- active
- created_at
- updated_at

## 7.2 Product types

V1:

- SINGLE
- BOOSTER_PACK
- BOOSTER_BOX
- ETB
- UPC
- DECK
- ACCESSORY
- MYSTERY_PACK
- OTHER

## 7.3 Single-card identity

For Pokémon singles, duplicate detection should use a normalized identity based on:

- Game
- Set
- Card number
- Language
- Variant

Card name is part of master data but should not be the immutable identifier.

## 7.4 Duplicate prevention

When creating a Product that matches an existing Product identity:

- show warning
- show the existing product
- default action: reuse existing product
- allow "Create Anyway" only with explicit confirmation and optional reason

---

# 8. INVENTORY MODEL

## 8.1 Inventory Lot

Fields:

- inventory_lot_id
- product_id
- ownership_type
- condition
- acquisition_type
- acquisition_id
- quantity_received
- quantity_remaining
- unit_cost
- cost_type
- location_id
- status
- received_at

## 8.2 Ownership types

- OWNED
- CONSIGNMENT

## 8.3 Conditions for singles

- NM
- LP
- MP
- HP
- DMG
- UNSPECIFIED

Condition belongs to inventory, not to the base Product identity.

## 8.4 Cost types

- ACTUAL
- ALLOCATED
- ESTIMATED
- UNKNOWN

System must never invent an actual cost where the business does not know one.

---

# 9. INVENTORY MOVEMENT LEDGER

All stock changes must create immutable movement entries.

Movement types:

- PURCHASE
- BUYBACK
- TRADE_IN
- CONSIGNMENT_IN
- SALE
- REFUND
- TRADE_OUT
- GIVEAWAY
- GYM_PRIZE
- BOX_BREAK
- ASSEMBLY_INPUT
- ASSEMBLY_OUTPUT
- DISASSEMBLY_INPUT
- DISASSEMBLY_OUTPUT
- BUNDLE_COMPONENT
- ADJUSTMENT
- STOCK_TAKE
- DAMAGE
- LOSS

Do not directly modify stock quantities from UI code.

---

# 10. ACQUISITION

All stock entering PM should have an acquisition context.

Supported acquisition types:

- SUPPLIER_PURCHASE
- BUYBACK
- BULK_PURCHASE
- TRADE
- TRADE_IN
- CONSIGNMENT_RECEIVE
- OTHER

---

# 11. SUPPLIER PURCHASE

Purchase header fields:

- purchase_id
- supplier_id
- invoice/reference number
- purchase_date
- subtotal
- discount
- total
- paid_amount
- outstanding_amount
- status
- created_by

Purchase items:

- product_id
- quantity
- unit_cost
- total_cost
- condition if relevant

Purchase status:

- DRAFT
- RECEIVED
- PARTIALLY_PAID
- PAID
- CANCELLED

A received purchase may remain partially unpaid.

---

# 12. SUPPLIER PAYABLE

Supplier payment is a separate financial event from the purchase.

Example:

Purchase = Rp10,000,000
Paid = Rp4,000,000
Outstanding = Rp6,000,000

Inventory is received at the full purchase quantity/value; cash movement reflects only the payment actually made.

---

# 13. BUYBACK

PM can acquire singles from customers.

A buyback can contain many items.

Example:

- Pikachu NM — buy cost Rp150,000
- Charizard LP — buy cost Rp100,000
- Mew NM — buy cost Rp200,000

Customer profile is optional. Default can be Anonymous/Walk-in.

Each buyback item creates its own inventory lot/cost layer.

---

# 14. BULK PURCHASE

A bulk purchase may contain many cards/items without individual costing at acquisition time.

Example:

100 cards bought for Rp2,000,000.

V1 costing method:

> Total acquisition cost / quantity

Therefore:

> Rp2,000,000 / 100 = Rp20,000 allocated cost per unit.

Cost type:

> ALLOCATED

The allocation method must be stored with the acquisition record as `EQUAL_SPLIT`.

The system must preserve the original total acquisition cost and quantity.

---

# 15. TRADE

Trade is not a normal purchase or sale.

A Trade Transaction can have:

- inventory IN
- inventory OUT
- cash adjustment

Trade item fields should include:

- direction (IN / OUT)
- product
- inventory lot if applicable
- quantity
- trade value
- cost basis where applicable

**Trade value and inventory cost must remain separate.**

---

# 16. TRADE-IN

Trade-in is a two-sided transaction with inventory and possible cash adjustment.

Example:

Customer gives Card A.
PM gives Booster Box + Rp100,000.

System records:

- Card A inventory IN
- Booster Box inventory OUT
- Cash OUT Rp100,000

Acquisition cost for incoming item is explicitly entered by PM as its cost basis. Do not automatically equate trade value to cost basis unless configured.

---

# 17. CONSIGNMENT

Consignment stock is physically held by PM but remains owned by the consignor.

Consignment fields:

- consignor_id
- product
- condition
- quantity
- PM selling price
- consignor payout amount or percentage
- status

V1 supports:

- Fixed payout
- Percentage payout

When sold:

Example:

Selling price = Rp700,000
Consignor payable = Rp600,000
PM gross commission/margin = Rp100,000

Do not treat Rp700,000 as PM net revenue without reflecting the consignor obligation.

---

# 18. SINGLE CARD COSTING

For identified owned singles:

- maintain acquisition lot
- preserve condition
- preserve acquisition cost
- preserve acquisition source

Default V1 cost selection policy:

> FIFO among compatible available owned lots.

Compatibility should consider at minimum:

- same Product
- same selling condition requirement
- owned inventory
- available status

Cashier does not select HPP manually.

The costing service resolves the lot.

---

# 19. QUICK SALE

Quick Sale exists to keep checkout practical when PM cannot identify each low-value single.

Example:

5 mixed singles = Rp100,000.

Quick Sale records:

- category/type
- description
- quantity
- actual transaction value
- cost status
- optional estimated cost

Quick Sale must be visibly flagged as unidentified/non-itemized.

Do not pretend it identified the exact cards that left inventory.

---

# 20. SEALED BOOSTER BOX → LOOSE PACK

PM may purchase a booster box and sell individual packs.

Product relationship:

> 1 Box = N Pack

Example:

1 Box = 30 Pack.

When PM opens one box:

Inventory:
- Box −1
- Loose Pack +30

No revenue.
No new purchase.
No cash movement.

This is a stock transformation.

Cost per loose pack:

> Box acquisition cost / number of packs produced

Use high internal precision; round only for display.

If boxes were acquired at different costs, preserve separate cost layers/batches.

---

# 21. MYSTERY PACK — CRITICAL BUSINESS RULE

Mystery Pack is a **finished product created internally from PM-owned inventory**.

It is NOT a normal bundle.

Process:

> Existing PM Inventory → Assembly/Production → Mystery Pack Finished Goods

## 21.1 Example

PM uses existing stock with total inventory cost:

> Rp1,000,000

Production output:

> 100 Mystery Packs

Therefore:

> Mystery Pack unit HPP = Rp10,000

## 21.2 No cash outflow at production time

Because the inventory was already owned by PM.

Assembly causes:

- component inventory decrease
- finished Mystery Pack inventory increase

It does NOT create a new purchase or cash expense.

## 21.3 Production batch

Each Mystery Pack production batch stores:

- batch_id
- product_id
- quantity_produced
- total_input_cost
- unit_cost
- production_date
- status
- created_by

## 21.4 Component traceability

Although the unit HPP is averaged across the batch, the system must retain which inventory components were consumed.

This is for audit and inventory reconciliation, not for calculating different HPP per individual Mystery Pack.

## 21.5 Batch costing

V1 formula:

> Unit HPP = Total Input Cost / Quantity Produced

If total cost is unknown, the batch must be flagged as cost-uncertain rather than inventing a number.

## 21.6 Mystery Pack sales

If 10 MP are sold at Rp20,000:

Revenue = Rp200,000
COGS = 10 × batch HPP

If HPP = Rp10,000:

COGS = Rp100,000
Gross Profit = Rp100,000

## 21.7 Batch separation

Two Mystery Pack production batches with different costs must remain separate cost layers.

Example:

Batch 001: 100 MP @ Rp10,000
Batch 002: 100 MP @ Rp15,000

Product master remains one product; batch cost layers remain distinct.

Default V1 finished-goods costing method:

> FIFO by production batch.

---

# 22. MYSTERY PACK DISASSEMBLY

V1 may support admin-only disassembly if required.

Example:

Mystery Pack −1
Cards/components + inventory

This must be explicit and manually confirmed by Owner.

Do not automatically reverse a sold Mystery Pack into its original components on refund.

---

# 23. BUNDLING

V1 supports **Fixed Bundles**.

Example:

Beginner Bundle:

- 1 Deck
- 2 Booster Packs
- 1 Sleeve

Bundle selling price:

> Rp250,000

## Bundle behavior

The bundle is a virtual sales construct, not automatically a new physical inventory item.

When sold:

- component inventory decreases
- bundle revenue is recorded as the actual negotiated/discounted sale amount
- bundle COGS = component cost snapshots

## Bundle vs Mystery Pack

Bundle:
> Existing products sold together.

Mystery Pack:
> Existing inventory consumed to create a finished new product beforehand.

---

# 24. SALES / POS

## 24.1 Primary requirement

POS must be **iPhone touchscreen first**.

No keyboard-heavy workflow for normal checkout.

## 24.2 Basic checkout flow

1. Search/select product
2. Add to cart
3. Adjust quantity
4. Optional customer
5. Optional price negotiation/discount
6. Select payment
7. Complete sale

## 24.3 Pricing model

For every sale item, preserve:

- listed price
- actual sale price
- discount/adjustment amount
- adjustment reason
- approving user if required

Actual sale price is immutable after completion except through reversal/refund/correction workflow.

---

# 25. PRICE PERMISSIONS

Owner:
- unlimited price override
- below-minimum-price sale warning/override

Staff:
- configurable discount limit
- configurable minimum price
- owner approval for restricted override

The system must record who approved sensitive price overrides.

---

# 26. SALE BELOW COST

If actual sale price is below the known acquisition cost:

Owner:
> show warning, allow override.

Staff:
> block or require owner authorization according to permission settings.

This is a warning/control, not an absolute owner restriction.

---

# 27. REFUNDS

Refunds must never delete the original sale.

V1 supports:

- full refund
- partial refund

Refund must reference the original sale.

Refund effects:

- revenue reversal
- payment reversal
- inventory return where applicable
- COGS reversal/correction
- audit log

Returned singles must be inspected before determining return condition.

Example:

Sold as NM, returned as LP:

> Sale reversal + inventory return as LP after inspection.

---

# 28. PAYMENTS

Supported methods V1:

- Cash
- QRIS
- Bank Transfer
- Other

Split payment must be supported.

Example:

Cash Rp300,000
QRIS Rp700,000

Sale total = Rp1,000,000.

Payments should be separate records pointing to the same Sale.

---

# 29. MONEY ACCOUNTS

V1 accounts may include:

- PM Cash
- PM QRIS
- PM BCA
- PM Other

The architecture must support additional accounts later.

Payment method and money account are distinct concepts.

---

# 30. FINANCIAL LEDGER

Every money movement must be attributable.

Movement examples:

### Sale

Cash +Rp500,000

### Purchase

Cash −Rp1,000,000

### Expense

Cash −Rp100,000

### Internal Transfer

QRIS −Rp500,000
BCA +Rp500,000

An internal transfer is NOT revenue or expense.

---

# 31. EXPENSES

Examples:

- Marketing
- Packaging
- Transport
- Event
- Utilities
- Equipment
- Other

Expense fields:

- expense_id
- date
- category
- description
- amount
- money_account
- optional attachment
- created_by

---

# 32. OWNER CAPITAL / WITHDRAWAL

Owner Capital:

> money injected into PM business.

Not revenue.

Owner Withdrawal:

> money taken from PM for owner use.

Not operating expense.

Both must be tracked separately from normal P&L.

---

# 33. PROFIT MODEL

V1 management reporting:

Revenue
− COGS
= Gross Profit

Gross Profit
− Operating Expenses
= Operating Profit

Owner Withdrawal is excluded from Operating Profit.

The system should distinguish:

- Actual COGS
- Estimated/Allocated COGS
- Unknown COGS

If cost is unknown, do not falsely report exact profit.

---

# 34. INVENTORY VALUATION

At minimum provide:

### Acquisition Cost Value
Historical/allocated inventory cost.

### PM Selling Value
Current PM listed price × available quantity where meaningful.

Market Reference Price is optional and not required for V1.

Market Price MUST NOT automatically change PM selling price.

---

# 35. MARKET PRICE — V1

Optional fields only:

- market_reference_price
- source
- checked_at

All may be NULL.

No API dependency.

Actual PM transaction price is business fact.
Market reference is informational only.

---

# 36. CUSTOMER

Customer profile is optional for normal retail sales.

Default:
> Walk-in / Anonymous.

Registered customer may be used for:

- Gym participation
- Buyback
- Consignment
- Repeat customer analysis
- future CRM

Do NOT force customer registration for every small purchase.

---

# 37. GIVEAWAY / PROMOTIONAL DISTRIBUTION

Giveaway is NOT a sale.

Example: customer review reward.

Requirements:

- campaign/reason
- product
- quantity
- cost snapshot
- date
- creator
- optional recipient

Recipient may be anonymous.

Inventory decreases.
Revenue remains zero.
Promotional/marketing cost is recognized using available inventory cost.

---

# 38. GYM

V1 Gym management is intentionally lightweight.

Gym Event fields:

- event_id
- name
- event_type
- date
- start_time
- entry_fee
- capacity
- status

Current Pokemaret physical capacity:
> 12 players

Capacity must be configurable but default to 12.

## Gym Participant

- event_id
- customer_id optional
- display name
- payment status
- check-in status

## Gym revenue

Entry fees are normal revenue.

## Gym prizes

Prizes reduce inventory and are tracked as event/community cost.

Do not build a full tournament-pairing engine in V1.

---

# 39. DAILY CLOSING

V1 should support optional/recommended daily cash closing.

System expected cash:
> based on recorded cash transactions.

Owner enters actual physical cash.

System calculates discrepancy:

Actual − Expected.

Difference must have optional/required reason based on configuration.

---

# 40. STOCK TAKE

V1 supports:

- full stock take
- category-level stock take
- selected-product stock take

Flow:

1. Create stock-take session
2. Capture system quantity
3. Enter physical quantity
4. Review differences
5. Confirm adjustments
6. Create inventory movement + audit

Do not automatically change stock at the first input stage.

---

# 41. LOCATIONS

V1 should include a `locations` entity even if PM initially has one location.

Initial location:
> Pokemaret @ Jordan Toys — QBig BSD

This avoids future schema migration when PM opens a pop-up or additional store.

Inventory lots should reference location.

---

# 42. OFFLINE-FIRST POS

This is a **V1 hard requirement**.

## 42.1 Technology expectation

Use a PWA with:

- Service Worker
- IndexedDB/local persistent database
- Offline transaction queue
- Sync engine
- Idempotent transaction processing

Do NOT implement offline transactions using localStorage alone.

## 42.2 Offline-supported operations

At minimum:

- Product search from cached POS data
- Sale
- Quick Sale
- Price override according to locally cached permissions
- Cash payment recording
- Offline transaction persistence

QRIS may be recorded locally, but actual external payment verification is separate from POS transaction capture.

## 42.3 Sync states

- LOCAL_ONLY
- PENDING_SYNC
- SYNCING
- SYNCED
- FAILED
- CONFLICT

## 42.4 Sync behavior

When internet returns:

1. detect connectivity
2. upload pending transactions
3. receive acknowledgement
4. mark synced
5. retry failures
6. expose conflicts to Owner

## 42.5 Idempotency

Every offline transaction must have an idempotency key unique to device + transaction.

Repeated sync of the same transaction must never create duplicate sales or payments.

## 42.6 Multi-device limitation for V1

Primary offline POS is one iPhone.

Future multi-POS offline concurrency may require more advanced conflict resolution.

Do not pretend V1 solves all distributed inventory concurrency cases.

---

# 43. ONLINE / OFFLINE UX

Top POS indicator:

🟢 ONLINE
🟠 OFFLINE — N PENDING
🔴 SYNC ERROR

The user must always be aware of sync health.

The user should not need to manually export/import data.

---

# 44. SECURITY

## 44.1 Authentication

- Secure password hashing (e.g. Argon2id or equivalent)
- Secure session handling
- Session expiry
- Logout
- Password reset flow
- Optional/strongly recommended 2FA for Owner

## 44.2 Authorization

All sensitive authorization must be enforced server-side.

Frontend hiding alone is NOT acceptable.

Examples:

- staff cannot retrieve HPP through manipulated API requests
- staff cannot change owner permissions
- staff cannot create owner withdrawal

## 44.3 Transport security

All production communication over HTTPS/TLS.

## 44.4 Data storage

Use managed/private database access.
Do not expose database credentials to client.
Encrypt backups and sensitive server-side data where appropriate.

## 44.5 Audit

Log at minimum:

- price changes
- refunds
- stock adjustments
- stock-take adjustments
- purchase changes/cancellations
- buyback
- trade/trade-in
- consignment settlement
- owner capital/withdrawal
- permission changes
- cost changes
- login/security-sensitive events

Audit logs are append-only from the application perspective.

---

# 45. BACKUP & RECOVERY

V1 must have:

- automated backups
- encrypted backup storage
- defined retention policy
- restore test procedure
- monitoring for backup failures

The project documentation must specify target RPO and RTO appropriate for a single-store small business. Prefer a practical, affordable target rather than enterprise-level cost.

---

# 46. PERFORMANCE REQUIREMENTS

## iPhone POS

After data is already available locally:

- Search interaction should feel instant.
- Add-to-cart should feel instant.
- Payment/checkout should require minimal taps.
- No routine sale should depend on a network round trip if device is offline.

## Back Office

Normal product/inventory tables should support pagination and server-side filtering.

Do not load the entire historical transaction table into the browser.

---

# 47. MOBILE UX REQUIREMENTS

The POS must be touchscreen-first:

- large tap targets
- minimal modal nesting
- minimal form fields
- clear primary actions
- no keyboard required for normal checkout except search/note fields
- cart always accessible
- payment actions visually prominent

Do not design desktop UI and simply shrink it for iPhone.

---

# 48. BACK-OFFICE UX REQUIREMENTS

Laptop/desktop-first for:

- receiving inventory
- creating products
- purchase entry
- buyback/bulk entry
- trade
- consignment
- Mystery Pack production
- bundle configuration
- stock take
- finance
- reports
- user settings

Keyboard input may be used heavily here.

---

# 49. NO PRINTER REQUIREMENT

The V1 checkout flow does not require a receipt printer.

Optional future feature:
> digital receipt / share receipt.

Do not block checkout on printer availability.

---

# 50. API REQUIREMENTS

The exact framework is flexible, but the backend must expose business-safe server APIs/services for at least:

### Authentication

- login
- logout
- session validation
- password reset

### Products

- search
- get product
- create product
- update product
- price update

### Inventory

- receive
- stock query
- stock movements
- stock take
- adjustment
- box break

### Sales

- create sale
- validate cart
- complete sale
- refund
- get sale

### Purchases

- create purchase
- receive purchase
- record supplier payment
- get payable

### Buyback

- create buyback
- complete buyback

### Trade

- create trade
- validate trade
- complete trade

### Consignment

- receive consignment
- sell consignment
- settle consignor
- return consignment

### Mystery Pack

- create production batch
- validate component stock
- complete production
- get batch
- optional admin disassembly

### Bundle

- create/update bundle
- get bundle

### Gym

- create event
- register participant
- payment/check-in
- prize distribution

### Finance

- money accounts
- money movements
- expenses
- owner transactions
- daily closing

### Sync

- push transaction(s)
- sync status
- conflict retrieval
- retry failed transaction

### Reports

- sales report
- inventory report
- cash report
- payable report
- profit report
- gym report

---

# 51. API SECURITY REQUIREMENTS

- Validate all inputs server-side.
- Validate ownership of requested entities.
- Validate permissions server-side.
- Use transactions for multi-entity writes.
- Never trust client-supplied HPP, profit, or authorization decisions.
- Prevent mass assignment vulnerabilities.
- Apply rate limiting to authentication and sensitive endpoints.
- Use parameterized queries/ORM-safe query methods.
- Do not expose internal stack traces to clients.
- Log security-relevant failures.

---

# 52. DATABASE INTEGRITY REQUIREMENTS

Use foreign keys and uniqueness constraints where appropriate.

Examples:

- product identity uniqueness for the chosen normalized card identity
- idempotency key uniqueness
- inventory movement references must be valid
- refund amount cannot exceed refundable sale amount
- completed payment totals must be valid
- owner withdrawal requires permission
- bundle component quantity > 0
- production output quantity > 0

Do not rely only on frontend validation.

---

# 53. REPORTS V1

## 53.1 Sales report

Filter:

- date range
- cashier
- channel
- category
- payment method
- product

Metrics:

- revenue
- transaction count
- AOV
- discounts/negotiation

## 53.2 Inventory report

- available quantity
- owned quantity
- consignment quantity
- cost value
- current PM selling value
- inventory aging where data permits

## 53.3 Cash report

- opening
- inflow
- outflow
- closing
- account breakdown

## 53.4 Profit report

- revenue
- actual COGS
- estimated/allocated COGS
- unknown COGS
- gross profit
- operating expense
- operating profit

## 53.5 Purchase/payable report

- supplier
- total purchases
- amount paid
- outstanding payable

## 53.6 Gym report

- event
- registered
- attendance
- entry revenue
- prize cost
- associated store sales when attributable

---

# 54. PROFIT DATA QUALITY

Reports must make cost confidence visible.

Example:

> Gross Profit (Actual Cost): Rp12,000,000
> Estimated/Allocated Gross Profit: Rp4,000,000
> Unknown-Cost Sales: Rp1,000,000

Do not combine unknown-cost sales into a falsely precise gross profit without clear labeling.

---

# 55. INITIAL DATA MIGRATION

PM currently has imperfect historical manual records.

Do NOT require full historical reconstruction before launch.

Use a cut-off date.

Example:

> System Go-Live / Opening Balance Date

Create opening data for:

- cash
- bank
- QRIS
- owned inventory
- consignment inventory
- supplier payables if any
- owner capital if appropriate

Historical inventory with uncertain cost may be entered as:

> estimated/unknown opening cost.

After the cut-off date, all movements should use the system.

---

# 56. INITIAL INVENTORY IMPORT

Back Office should support CSV import for initial migration only.

This is NOT the daily operational method.

Import fields should support at minimum:

- product identity
- condition
- quantity
- ownership
- estimated/actual cost
- selling price
- location

Duplicate detection must be applied during import.

---

# 57. DATA COMPLETENESS / CONFIDENCE

Where historical data is incomplete, expose data confidence rather than hiding uncertainty.

Possible status:

- VERIFIED
- ESTIMATED
- UNKNOWN

Optional future dashboard:

> Inventory cost verified: 87%

---

# 58. BUSINESS KPI FOUNDATION

V1 should collect the data needed for future analysis of:

- Revenue
- Gross profit
- Gross margin
- AOV
- Transactions/day
- Product category contribution
- Inventory value
- Inventory aging
- Inventory turnover
- Negotiation/discount impact
- Sales channel performance
- Gym attendance
- Gym revenue
- Gym-related store sales
- Customer repeat activity where customer data exists

Do not build complex analytics unless the underlying data is reliable.

---

# 59. ACCEPTANCE TESTS — CRITICAL

## AT-01 — Offline sale

Disconnect internet.
Create a cash sale.
Expected: sale completes locally.

## AT-02 — Automatic sync

Reconnect internet.
Expected: sale syncs automatically.

## AT-03 — Duplicate sync protection

Send the same offline transaction twice.
Expected: only one server transaction exists.

## AT-04 — Duplicate card prevention

Try to create a product with identical normalized card identity.
Expected: duplicate warning and reuse-existing option.

## AT-05 — Duplicate inventory lot

Acquire same Product twice at different costs.
Expected: same Product, separate cost layers/lots.

## AT-06 — Box break

Receive one 30-pack box.
Break box.
Expected: box −1, pack +30, no cash movement.

## AT-07 — Mystery Pack

Consume PM-owned inventory with total cost Rp1,000,000.
Produce 100 MP.
Expected: MP batch unit HPP Rp10,000; no cash outflow at production.

## AT-08 — Mystery Pack sale

Sell 10 MP at Rp20,000 with HPP Rp10,000.
Expected: revenue Rp200,000; COGS Rp100,000; gross profit Rp100,000.

## AT-09 — Bundle

Create bundle A+B+C.
Sell one bundle.
Expected: A−1, B−1, C−1; revenue equals actual negotiated bundle price.

## AT-10 — Negotiated price

Listed price Rp650,000; actual sale Rp600,000.
Expected: transaction records both prices and Rp50,000 adjustment.

## AT-11 — Staff permission

Staff tries to retrieve HPP through API.
Expected: server denies access.

## AT-12 — Refund

Refund one item from a multi-item sale.
Expected: only that item is reversed; original sale remains.

## AT-13 — Refund condition change

Sell single as NM; return as LP.
Expected: returned inventory condition reflects inspection.

## AT-14 — Supplier payable

Purchase Rp10,000,000; pay Rp4,000,000.
Expected: inventory received; cash −Rp4,000,000; payable Rp6,000,000.

## AT-15 — Consignment

Receive item owned by consignor; sell for Rp700,000 with payout Rp600,000.
Expected: consignor payable Rp600,000; PM margin Rp100,000.

## AT-16 — Trade-in

Customer gives Card A; PM gives Card B + Rp100,000.
Expected: Card A inventory +1; Card B −1; cash −Rp100,000.

## AT-17 — Giveaway

Give away 1 booster.
Expected: inventory −1; revenue 0; promotion cost recorded using available cost basis.

## AT-18 — Gym prize

Distribute 5 booster prizes.
Expected: inventory −5; event prize cost recorded.

## AT-19 — Owner withdrawal

Withdraw Rp2,000,000.
Expected: money account −Rp2,000,000; owner withdrawal recorded; operating expense unchanged.

## AT-20 — Stock take

System stock 10; physical stock 9.
Expected: discrepancy is reviewed and then creates an adjustment with audit trail.

---

# 60. DEFINITION OF DONE — V1

V1 is not production-ready until all of the following are true:

### POS

- [ ] iPhone touchscreen flow implemented
- [ ] search
- [ ] cart
- [ ] Quick Sale
- [ ] negotiated price
- [ ] split payment
- [ ] checkout
- [ ] refund
- [ ] offline checkout

### Inventory

- [ ] Product master
- [ ] Duplicate prevention
- [ ] Inventory lots
- [ ] Condition
- [ ] Ownership
- [ ] Stock movement ledger
- [ ] Stock take
- [ ] Adjustment
- [ ] Box → Pack
- [ ] Mystery Pack production
- [ ] Bundle component deduction

### Acquisition

- [ ] Supplier purchase
- [ ] Supplier payable
- [ ] Buyback
- [ ] Bulk acquisition
- [ ] Trade
- [ ] Trade-in
- [ ] Consignment

### Finance

- [ ] Cash
- [ ] QRIS
- [ ] Bank
- [ ] Payments
- [ ] Money movements
- [ ] Expenses
- [ ] Owner capital
- [ ] Owner withdrawal
- [ ] Daily closing
- [ ] Profit report

### Community

- [ ] Gym event
- [ ] Participants
- [ ] Entry payment
- [ ] Prize distribution
- [ ] Giveaway

### Security

- [ ] Authentication
- [ ] RBAC
- [ ] Server-side authorization
- [ ] Audit log
- [ ] Secure secrets
- [ ] HTTPS
- [ ] Backup
- [ ] Recovery test

### Offline

- [ ] Local persistent database
- [ ] Offline transaction queue
- [ ] Idempotency
- [ ] Automatic sync
- [ ] Retry
- [ ] Conflict detection
- [ ] Sync status UI

### Quality

- [ ] Critical acceptance tests pass
- [ ] No known data corruption path
- [ ] No completed transaction can be silently deleted
- [ ] Inventory and financial ledgers reconcile under test scenarios

---

# 61. RECOMMENDED IMPLEMENTATION ORDER FOR CLAUDE CODE

Implement in this order. Do not skip ahead to advanced features.

## Phase 1 — Foundation

1. Project scaffold
2. Authentication
3. Database schema
4. Roles/permissions
5. Product master
6. Inventory lots
7. Stock movement ledger
8. Audit log
9. Locations

## Phase 2 — POS + Offline

10. iPhone POS UI
11. Search
12. Cart
13. Sale service
14. Payment service
15. Offline IndexedDB layer
16. Sync queue
17. Idempotency
18. Automatic sync

## Phase 3 — Acquisition + Inventory Operations

19. Supplier purchases
20. Supplier payable
21. Buyback
22. Bulk acquisition
23. Trade
24. Trade-in
25. Consignment
26. Stock take
27. Box → Pack

## Phase 4 — Business Production

28. Bundle
29. Mystery Pack production
30. Giveaway
31. Gym

## Phase 5 — Finance + Reports

32. Money accounts
33. Financial ledger
34. Expenses
35. Owner capital/withdrawal
36. Daily closing
37. Sales report
38. Inventory report
39. Cash report
40. Profit report
41. Payables report

## Phase 6 — Hardening

42. Security review
43. Permission tests
44. Offline conflict tests
45. Backup/restore test
46. Performance test
47. Data reconciliation test
48. UAT

---

# 62. IMPLEMENTATION BEHAVIOR FOR CLAUDE CODE

Claude Code should work incrementally and keep the repository deployable at every milestone.

For each feature:

1. Explain intended data model changes before implementation.
2. Implement database migration/schema changes.
3. Implement server-side business logic.
4. Implement tests for the business rule.
5. Implement UI.
6. Implement audit logging.
7. Test online behavior.
8. Test offline behavior where relevant.
9. Run lint/typecheck/test/build.
10. Update documentation.

Do not build large amounts of UI before the underlying business service is tested.

---

# 63. CODING QUALITY REQUIREMENTS

- TypeScript strict mode if TypeScript is used.
- Domain/business logic should not live primarily inside React components.
- Keep database access behind a server/service/repository layer.
- Keep inventory and financial mutations transactional.
- Avoid duplicated business logic between online and offline clients.
- Centralize business rules in backend/domain services.
- Use migrations rather than manual database edits.
- Include automated tests for critical domain rules.
- Use environment variables/secrets correctly.
- Never commit credentials.

---

# 64. ARCHITECTURE RECOMMENDATION

A practical V1 implementation can use:

- Responsive PWA frontend
- TypeScript
- React/Next.js or comparable modern web framework
- PostgreSQL-compatible relational database
- IndexedDB for local POS data
- Service Worker for offline app shell/assets
- Backend API/service layer
- Cloud hosting with managed database and encrypted backups

The exact vendor/framework can be chosen during technical design, but the business and data behavior in this PRD must remain unchanged.

---

# 65. WHAT SHOULD NOT BE OPTIMIZED AWAY

The following are intentionally more important than developer convenience:

1. Inventory traceability
2. HPP traceability
3. Financial integrity
4. Offline transaction safety
5. Server-side authorization
6. Auditability
7. Mystery Pack batch costing
8. Consignment ownership
9. Refund integrity
10. Owner/staff permissions

---

# 66. FINAL PRODUCT PRINCIPLE

The system should make the common path extremely simple:

> **Search → Add → Negotiate if needed → Pay → Done**

while keeping the backend capable of answering:

> What item moved?

> Where did it come from?

> What did it cost?

> What price was it listed at?

> What price was actually paid?

> Where did the money go?

> What happened to inventory?

> What was the impact on profit?

> Who performed the action?

> Was the transaction online or offline?

> Has it synced safely?

That is the core purpose of Pokemaret Business OS V1.
