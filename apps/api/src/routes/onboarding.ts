/**
 * Onboarding routes — the merchant activation funnel.
 *
 *   GET /v1/onboarding
 *
 * Returns the signed-in org's progress through the steps that take a new
 * merchant from sign-up to their first settled payout. Every step's `done` flag
 * is DERIVED from live, tenant-scoped data (never a stored checklist), so the
 * funnel reflects reality and can't drift: create a product, attach a price,
 * publish it, take a first payment, withdraw a first payout.
 *
 * The dashboard renders this as a guided checklist on the home page and hides it
 * once every step is complete.
 */
import { Hono } from "hono";
import type { AppEnv, AppContext } from "../context.js";
import { data } from "../http/respond.js";
import { requireOrg } from "../http/tenant.js";

/** A single activation step, with where to go to complete it. */
export interface OnboardingStep {
  key: string;
  title: string;
  description: string;
  href: string;
  done: boolean;
}

/** The full activation funnel for an organization. */
export interface OnboardingStatus {
  steps: OnboardingStep[];
  completed: number;
  total: number;
  percent: number;
  /** First incomplete step, or null when fully activated. */
  nextStep: OnboardingStep | null;
  complete: boolean;
}

/** Compute the activation funnel from the org's live data. */
async function computeOnboarding(
  ctx: AppContext,
  organizationId: string,
): Promise<OnboardingStatus> {
  const products = await ctx.products.list((p) => p.organizationId === organizationId);
  const productIds = new Set(products.map((p) => p.id));

  const [prices, confirmedPayments, payouts] = await Promise.all([
    ctx.prices.list((pr) => productIds.has(pr.productId)),
    ctx.payments.findConfirmedByOrganization(organizationId),
    ctx.payouts.listByOrganization(organizationId),
  ]);

  const hasProduct = products.length > 0;
  const hasPrice = prices.length > 0;
  const hasPublished = products.some((p) => p.status === "active");
  const hasPayment = confirmedPayments.length > 0;
  const hasPayout = payouts.length > 0;

  const steps: OnboardingStep[] = [
    {
      key: "create_product",
      title: "Create your first product",
      description: "Choose what you sell — a SaaS plan, repo access, an API, a download, and more.",
      href: "/products/new",
      done: hasProduct,
    },
    {
      key: "add_price",
      title: "Set a price",
      description: "Attach a USDC price so buyers know what to pay.",
      href: "/products",
      done: hasPrice,
    },
    {
      key: "publish_product",
      title: "Publish it",
      description: "Make a product live so it can be sold through checkout.",
      href: "/products",
      done: hasPublished,
    },
    {
      key: "first_payment",
      title: "Take your first payment",
      description: "Share a checkout link or accept a direct USDC transfer to record your first sale.",
      href: "/payments",
      done: hasPayment,
    },
    {
      key: "first_payout",
      title: "Withdraw your earnings",
      description: "Send your USDC balance to your wallet with your first payout.",
      href: "/payouts",
      done: hasPayout,
    },
  ];

  const completed = steps.filter((s) => s.done).length;
  const total = steps.length;
  const nextStep = steps.find((s) => !s.done) ?? null;

  return {
    steps,
    completed,
    total,
    percent: total === 0 ? 100 : Math.round((completed / total) * 100),
    nextStep,
    complete: completed === total,
  };
}

export function onboardingRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const status = await computeOnboarding(c.get("ctx"), requireOrg(c));
    return data(c, status);
  });

  return app;
}
