import Stripe from 'stripe'

let stripeClient: Stripe | null = null

export function getStripe(secretKey: string): Stripe {
  if (!stripeClient) {
    stripeClient = new Stripe(secretKey, {
      apiVersion: '2025-02-24.acacia' as any,
      httpClient: Stripe.createFetchHttpClient(),
    })
  }
  return stripeClient
}

export function isStripeConfigured(secretKey: string | undefined): boolean {
  return !!secretKey && secretKey.startsWith('sk_') && secretKey.length > 10
}

/**
 * Pricing tiers map to actual amounts in cents.
 *
 * Two cohort generations live here side-by-side:
 *
 * - SPRING 2026 (cohort-1) used `standard` / `discounted` / `sponsor`.
 *   Those entries stay so prior applications still resolve to the right
 *   amounts ($500 / $250 / $0).
 *
 * - SUMMER 2026 (cohort-2) uses a sliding-scale model: applicants
 *   self-select `sliding_low` ($250) / `sliding_mid` ($500) /
 *   `sliding_high` ($750), with `alumni` ($125) auto-applied to Spring
 *   2026 grads who retake, and `scholarship` ($0) for vetted applicants
 *   who submitted the scholarship form.
 *
 * Which tiers are valid for which cohort is enforced by
 * getTiersForCohort() below; the flat map here just stores prices/labels.
 */
export const PRICING_TIERS: Record<string, { label: string; amountCents: number }> = {
  // Spring 2026 (cohort-1) — legacy, preserved for record resolution
  standard: { label: 'Full Price', amountCents: 50000 },
  discounted: { label: 'Discounted', amountCents: 25000 },
  sponsor: { label: 'Sponsored', amountCents: 0 },
  // Summer 2026 (cohort-2) — sliding scale + alumni + scholarship
  sliding_low: { label: 'Sliding scale — $250', amountCents: 25000 },
  sliding_mid: { label: 'Sliding scale — $500', amountCents: 50000 },
  sliding_high: { label: 'Sliding scale — $750', amountCents: 75000 },
  alumni: { label: 'Alumni rate — $125', amountCents: 12500 },
  scholarship: { label: 'Scholarship', amountCents: 0 },
}

/**
 * Tiers available per cohort for admin selection + apply-form display.
 * Keys not listed here fall back to all tiers (safest default for cohorts
 * we don't have explicit config for yet).
 */
export const TIERS_BY_COHORT: Record<string, ReadonlyArray<string>> = {
  'cohort-1': ['standard', 'discounted', 'sponsor'],
  'cohort-2': ['sliding_low', 'sliding_mid', 'sliding_high', 'alumni', 'scholarship'],
}

export function getTiersForCohort(cohortSlug: string): Array<{ tier: string; label: string; amountCents: number }> {
  const allowed = TIERS_BY_COHORT[cohortSlug] ?? Object.keys(PRICING_TIERS)
  return allowed.map(t => ({ tier: t, ...PRICING_TIERS[t] }))
}

export function getAmountForTier(tier: string): number {
  return PRICING_TIERS[tier]?.amountCents ?? 50000
}

/**
 * Compute the actual amount to charge for an application.
 * If the admin set a custom `approvedAmountCents`, that wins.
 * Otherwise fall back to the tier's default amount.
 */
export function getApplicationAmount(app: { pricingTier: string; approvedAmountCents?: number | null }): number {
  if (app.approvedAmountCents != null) return app.approvedAmountCents
  return getAmountForTier(app.pricingTier)
}

/**
 * Human-readable label for an application's approved price. Returns the
 * tier label (e.g. "Full Price", "Sponsored"). Callers display the actual
 * dollar amount alongside via formatCents(approvedAmountCents) so a custom
 * approval amount surfaces naturally in the UI without a separate label.
 */
export function getApplicationLabel(app: { pricingTier: string }): string {
  return getTierLabel(app.pricingTier)
}

export function getTierLabel(tier: string): string {
  return PRICING_TIERS[tier]?.label ?? 'Standard'
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`
}

