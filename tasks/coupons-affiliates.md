# Coupons, discounts & affiliate-light — contract (ACCEPTED 2026-07-26)

> Owner decision 2026-07-26 upgrading backlog B13: coupons/discounts are a
> wanted feature, to be built soon, WITH usage statistics and per-coupon
> revenue attribution — a coupon doubles as a lightweight affiliate mechanism
> ("give a partner a code, settle attributed sales with them" — szczegóły
> biznesowe w prywatnych materiałach właściciela) without a
> full partnerships panel. Omnibus compliance ships in the same slice (the
> original r3 pairing rule: no promotional pricing without lowest-30-day
> price display).
>
> Status: ACCEPTED. Owner approved the whole overnight queue 2026-07-26 and
> delegated the remaining calls; decisions recorded at the bottom.
> Implementation queued AFTER the P5 observability package and the M-2 patch.

## Model

- `coupons`: { id, tenantId, code (tenant-scoped unique, case-insensitive),
  kind: 'percent' | 'amount', value (percent int or amountCents),
  scope: all products | productIds[], appliesTo: one_time | recurring | both,
  recurringDuration: 'first_invoice' | 'forever' (owner decision 2026-07-26:
  per-coupon choice, maps to Stripe coupon duration once/forever; default
  first_invoice), startsAt/endsAt, maxRedemptions, maxRedemptionsPerMember,
  status: active | archived, partnerLabel (free-text attribution tag, e.g.
  the affiliate's name), createdAt }. Forever-discounted renewals append an
  order row with the discounted amount and couponId each cycle, so affiliate
  attribution keeps accruing across renewals in the stats.
- `coupon_redemptions` (projection) + events per the lifecycle convention:
  { id, tenantId, couponId, orderId, memberId, email, discountCents,
  createdAt }. One redemption row per PAID order that used the code.
- `orders` gains nullable `couponId` + `discountCents` (migration; existing
  rows untouched). The order remains the money source of truth — attribution
  is a query over orders joined on couponId, never a separate counter.
- Price history for Omnibus: `product_price_history` append-only rows written
  on every price create/change (productId, priceId, amountCents, effective
  from) — the "lowest price in the last 30 days" is derived, never stored.

## Checkout & payments

- Checkout page: "Mam kod rabatowy" reveal-input; valid code shows the
  discounted price breakdown (original, discount, final) before payment.
- Stripe: create a Stripe Coupon + Promotion Code per our coupon lazily at
  first use (ids cached on the coupon row); hosted checkout gets the
  promotion code applied server-side (no reliance on Stripe's own code
  entry UI, so simulated payments behave identically).
- Simulated provider: applies the discount locally — full lifecycle testable
  offline, same code path shape as subscriptions.
- Validation server-side at session creation AND at webhook fulfillment
  (expiry/limits re-checked; a code that expired between checkout start and
  payment still honors the started session).
- Free-100% coupons: allowed; order of 0 amount is recorded, grant issued,
  no provider session needed (mirrors how M2M enroll grants without payment).

## Omnibus (must ship in the same PR)

- Wherever a REDUCED price is presented to a consumer (checkout with an
  applied coupon; any future struck-through promo price), show "Najniższa
  cena z ostatnich 30 dni: X" derived from product_price_history + active
  coupon-free price. PL/EN copy; hidden for B2B-only contexts if ever added.
- Tripwire test: rendering a discounted checkout without the lowest-30-day
  line fails.

## Stats & affiliate-light attribution

- Panel /panel/sales/coupons: per coupon — redemptions count, gross revenue
  attributed, total discount given, conversion (redemptions vs checkout
  sessions with code applied), time series; filter by partnerLabel; CSV/JSON
  export (the affiliate settlement artifact: "code X: N orders, Y PLN gross,
  Z PLN discount" — the owner settles with the partner off this export).
- Existing /panel/sales orders list gains a coupon column + filter.
- NO automatic payout math in v1 (the split stays a human agreement,
  szczegóły biznesowe w prywatnych materiałach właściciela);
  partnerLabel + export is the v1 affiliate feature. Full partner accounts,
  self-serve dashboards, payout automation = out of scope.

## Out of scope (v1)

- Stackable coupons (one code per order), member-specific codes, auto-apply
  links (?code=... prefill is IN scope as a should), recurring-forever
  discounts, gift cards, tiered promotions, partner self-service views.

## Decisions (resolved 2026-07-26)

- CP1 (owner): per-coupon choice `first_invoice` OR `forever` for recurring
  prices (Stripe duration once/forever); default first_invoice.
- CP2 (delegated): `?code=XYZ` prefill link ships in v1 — it is the actual
  affiliate link.
- CP3 (delegated): attribution counts only orders with the code entered;
  no cookie-based attribution (no new tracking surface, no GDPR questions).
