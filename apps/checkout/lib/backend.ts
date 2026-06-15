/**
 * Checkout data backend selection.
 *
 * When `DATABASE_URL` is set the checkout app reads the REAL catalog and
 * checkout sessions the API/dashboard persisted — products, prices, sessions,
 * merchants — and records/settles payments into the SAME Postgres tables
 * (`@settlekit/persistence`). With no database it falls back to the in-process
 * seed catalog so the app still runs standalone for local dev.
 *
 * Both backends expose one async interface so the route layer is
 * persistence-agnostic. Session→payment and delivered-access are DERIVED (not
 * cached): the confirmed payment is found via `findByCheckoutSessionId`, and
 * delivered artifacts are recomputed deterministically — so they are correct in
 * both single-process and multi-instance (Postgres) deployments.
 */
import {
  InMemoryCheckoutRepository,
  InMemoryPaymentRepository,
  createCheckoutSession,
  type CheckoutRepository,
  type PaymentRepository,
} from "@settlekit/payments";
import { createDb, merchants, eq } from "@settlekit/database";
import {
  PgCheckoutRepository,
  PgPaymentRepository,
  PgProductStore,
  PgPriceStore,
} from "@settlekit/persistence";
import type { DeliveryAction, Price, Product } from "@settlekit/common";
import { deriveDeliveryAction } from "./delivery-action";
import { seedCatalog } from "./seed";

/** The data operations the checkout store depends on. */
export interface CheckoutBackend {
  readonly checkouts: CheckoutRepository;
  readonly payments: PaymentRepository;
  /** Whether this backend is Postgres-backed (real catalog) or seeded. */
  readonly persistent: boolean;
  findProduct(id: string): Promise<Product | undefined>;
  findPrice(id: string): Promise<Price | undefined>;
  merchantName(merchantId: string): Promise<string>;
  /** Delivery action that fulfils a product (for the access summary). */
  deliveryActionForProduct(product: Product): DeliveryAction | undefined;
  /** Demo session ids for the standalone index page ([] in Postgres mode). */
  seededSessionIds(): string[];
}

let singleton: CheckoutBackend | undefined;

/** Build (once) the backend selected by `DATABASE_URL`. */
export function getBackend(): CheckoutBackend {
  if (singleton) return singleton;
  const url = process.env.DATABASE_URL?.trim();
  singleton = url ? createPostgresBackend(url) : createSeedBackend();
  return singleton;
}

/** Postgres-backed catalog + payment persistence over `@settlekit/persistence`. */
function createPostgresBackend(databaseUrl: string): CheckoutBackend {
  const db = createDb(databaseUrl);
  const products = new PgProductStore(db);
  const prices = new PgPriceStore(db);

  return {
    checkouts: new PgCheckoutRepository(db),
    payments: new PgPaymentRepository(db),
    persistent: true,
    async findProduct(id) {
      return (await products.findById(id)) ?? undefined;
    },
    async findPrice(id) {
      return (await prices.findById(id)) ?? undefined;
    },
    async merchantName(merchantId) {
      const rows = await db
        .select({ displayName: merchants.displayName })
        .from(merchants)
        .where(eq(merchants.id, merchantId))
        .limit(1);
      return rows[0]?.displayName ?? "Merchant";
    },
    deliveryActionForProduct: deriveDeliveryAction,
    seededSessionIds() {
      return [];
    },
  };
}

/** In-process seed catalog (standalone dev with no database). */
function createSeedBackend(): CheckoutBackend {
  const checkouts = new InMemoryCheckoutRepository();
  const payments = new InMemoryPaymentRepository();
  const products = new Map<string, Product>();
  const prices = new Map<string, Price>();
  const delivery = new Map<string, DeliveryAction>();
  const merchantNames = new Map<string, string>();
  const seededSessionIds: string[] = [];

  const seeded = seedCatalog();
  for (const item of seeded.products) {
    products.set(item.product.id, item.product);
    prices.set(item.price.id, item.price);
    delivery.set(item.product.id, item.deliveryAction);
  }
  for (const [id, name] of Object.entries(seeded.merchants)) merchantNames.set(id, name);

  // Seed one open session per demo product via the real domain factory.
  for (const item of seeded.products) {
    const session = createCheckoutSession({
      organizationId: item.product.organizationId,
      merchantId: item.product.merchantId,
      items: [{ lineItem: { productId: item.product.id, priceId: item.price.id, quantity: 1 }, price: item.price }],
      payToAddress: item.payToAddress,
      network: item.network,
      ttlDays: 365,
    });
    void checkouts.save(session);
    seededSessionIds.push(session.id);
  }

  return {
    checkouts,
    payments,
    persistent: false,
    async findProduct(id) {
      return products.get(id);
    },
    async findPrice(id) {
      return prices.get(id);
    },
    async merchantName(merchantId) {
      return merchantNames.get(merchantId) ?? "Merchant";
    },
    deliveryActionForProduct(product) {
      return delivery.get(product.id) ?? deriveDeliveryAction(product);
    },
    seededSessionIds() {
      return [...seededSessionIds];
    },
  };
}
