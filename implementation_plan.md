# Boarding House Expense Manager — Implementation Plan

A collaborative expense tracking website for friends living together. One or more friends pay bills, expenses are split among all members, and at month's end everyone can see who owes whom and settle balances.

---

## Overview

**Core Idea**: Friends in a boarding house can log expenses. The app automatically divides costs across selected members, tracks running balances, and computes the minimum set of transactions needed to settle up at month-end.

**Tech Stack**: Pure HTML + Vanilla CSS + JavaScript (no frameworks), with `localStorage` for data persistence. No backend/login required — runs entirely in the browser, shareable as a static site.

---

## Open Questions

> [!IMPORTANT]
> Please review these design decisions before I start building:

1. **Data sharing between friends**: Should all friends use the **same device/browser** (shared localStorage), or do you want a **link-shareable** approach (e.g., data encoded in URL or exported/imported as a JSON file)? A full backend with real-time sync would require a server (Firebase, etc.).

2. **Currency**: Which currency should be used? (e.g., LKR 🇱🇰, USD 💵, INR ₹)

3. **Who are the members?** Should members be **predefined at setup** (fixed list), or should friends be **added/removed dynamically**?

4. **Expense splitting**: Should expenses always be **split equally** among selected members, or do you want support for **custom/unequal splits** (e.g., someone ate more, so they owe more)?

5. **Monthly reset**: At month-end after settling, should old data be **archived** (kept for history) or **cleared**?

---

## Proposed Features

### Phase 1 — Core MVP
- Member management (add/remove friends)
- Add expense: payer, amount, description, date, split among (select members)
- Expense list view with filters
- Balance dashboard — who owes whom
- Settlement calculator (minimum transactions to settle all debts)
- Month summary & settlement confirmation

### Phase 2 — Polish & UX
- Expense categories (Groceries, Rent, Utilities, etc.)
- Edit/delete expenses
- Export data as JSON (for sharing or backup)
- Import JSON (to sync between devices)
- Monthly history/archive

---

## Proposed Pages / Views

```
┌─────────────────────────────────────────────┐
│  🏠 BoardMates — Expense Manager            │
├─────────┬───────────────────────────────────┤
│ Members │  Dashboard  │  Expenses │  Settle │
└─────────┴───────────────────────────────────┘
```

### 1. Dashboard
- Summary cards: Total spent this month, # of expenses, your balance
- Balance overview (green = owed money, red = owes money)
- Quick-add expense button

### 2. Expenses Tab
- Scrollable list of all expenses with date, payer, amount, split info
- Filter by member, date, category
- Add / Edit / Delete expense

### 3. Members Tab
- Add/remove members
- Each member's total paid vs. total share

### 4. Settle Up Tab
- Shows computed minimum transactions to clear all debts
- "Mark as settled" button to confirm payments
- Month archive after settling

---

## Data Model (localStorage)

```js
// Members
members: [{ id, name, color }]

// Expenses
expenses: [
  {
    id,
    description,
    amount,        // total bill amount
    paidBy,        // member id
    splitAmong,    // [member ids] — equal split
    category,      // "Groceries", "Utilities", etc.
    date,
    month          // "2026-07" — for filtering
  }
]

// Settlements (archived)
settlements: [
  {
    month,
    transactions: [{ from, to, amount }],
    settledAt
  }
]
```

---

## Balance Calculation Logic

For each expense:
- Each person in `splitAmong` owes `amount / splitAmong.length`
- The payer is credited for the full `amount`

Net balance per person = `total paid` - `total owed`

Settlement algorithm: **Greedy min-transactions** — sort by balance, match largest debtor with largest creditor until all zeroed out.

---

## UI Design Direction

- **Dark-themed** glassmorphism card design
- Accent color: **Emerald green** (`#10b981`) — money/finance vibe
- Typography: **Inter** from Google Fonts
- Smooth animated transitions between tabs
- Color-coded member avatars (auto-assigned)
- Responsive for mobile (friends can check on phone)

---

## File Structure

```
e:\Navigation\
└── boardmates\
    ├── index.html        ← Single-page app
    ├── style.css         ← All styles
    └── app.js            ← All logic
```

---

## Verification Plan

### Manual Testing
- Add 3 test members
- Add 5+ expenses with different payers and splits
- Verify balances sum to zero (conservation of money)
- Verify settlement transactions clear all debts
- Test on mobile screen size
- Test data persistence after page refresh

---

> [!NOTE]
> This is a **client-side only** app using localStorage. Data is tied to one browser. If you want **real-time sync** across all friends' phones simultaneously, I can integrate **Firebase Firestore** (free tier) for a live shared database — just let me know!
