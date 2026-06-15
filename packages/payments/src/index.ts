/**
 * @settlekit/payments — core checkout + payment + subscription domain logic.
 *
 * Pure domain functions and storage-agnostic repository interfaces. No DB or
 * network imports. A real Map-backed in-memory store ships for dev/tests.
 */

export {
  DEFAULT_CHECKOUT_TTL_DAYS,
  computeCheckoutTotal,
  createCheckoutSession,
  collectFields,
  expireSession,
  completeSession,
  cancelSession,
  isSessionExpired,
  type PricedLineItem,
  type CreateCheckoutSessionInput,
} from "./checkout.js";

export {
  DEFAULT_MIN_CONFIRMATIONS,
  recordPendingPayment,
  confirmPayment,
  failPayment,
  refundPayment,
  isTerminalPayment,
  type RecordPendingPaymentInput,
} from "./payment-lifecycle.js";

export {
  DEFAULT_GRACE_DAYS,
  createSubscription,
  renewSubscription,
  enterGrace,
  cancelSubscription,
  expireSubscription,
  isGraceExpired,
  type CreateSubscriptionInput,
} from "./subscription-lifecycle.js";

export type {
  Repository,
  CheckoutRepository,
  PaymentRepository,
  SubscriptionRepository,
} from "./repositories.js";

export {
  InMemoryCheckoutRepository,
  InMemoryPaymentRepository,
  InMemorySubscriptionRepository,
  createInMemoryPaymentStores,
  type InMemoryPaymentStores,
} from "./in-memory-repositories.js";
