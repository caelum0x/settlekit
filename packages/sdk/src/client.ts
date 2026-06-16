/**
 * The top-level SettleKit client.
 *
 * `SettleKit` composes every resource client over a single {@link HttpClient}.
 * Construct it directly with `new SettleKit(options)` or via the
 * {@link createSettleKitClient} factory.
 */
import { HttpClient, type HttpClientOptions } from "./http-client.js";
import { ProductsResource } from "./resources/products.js";
import { PricesResource } from "./resources/prices.js";
import { CustomersResource } from "./resources/customers.js";
import { CheckoutResource } from "./resources/checkout.js";
import { PaymentsResource } from "./resources/payments.js";
import { SubscriptionsResource } from "./resources/subscriptions.js";
import { EntitlementsResource } from "./resources/entitlements.js";
import { LicenseKeysResource } from "./resources/license-keys.js";
import { ApiKeysResource } from "./resources/api-keys.js";
import { BundlesResource } from "./resources/bundles.js";
import { FilesResource } from "./resources/files.js";
import { WebhooksResource } from "./resources/webhooks.js";
import { DeliveryRunsResource } from "./resources/delivery-runs.js";
import { AgentServicesResource } from "./resources/agent-services.js";
import { EscrowResource } from "./resources/escrow.js";
import { GitHubResource } from "./resources/github.js";
import { DiscordResource } from "./resources/discord.js";
import { SaasResource } from "./resources/saas.js";
import { UsageResource } from "./resources/usage.js";
import { MarketplaceResource } from "./resources/marketplace.js";
import { AnalyticsResource } from "./resources/analytics.js";
import { CouponsResource } from "./resources/coupons.js";
import { InvoicesResource } from "./resources/invoices.js";
import { PayoutsResource } from "./resources/payouts.js";
import { RefundsResource } from "./resources/refunds.js";
import { DisputesResource } from "./resources/disputes.js";
import { DunningResource } from "./resources/dunning.js";
import { SettingsResource } from "./resources/settings.js";

/** Options for constructing a {@link SettleKit} client. */
export type SettleKitOptions = HttpClientOptions;

/** The official SettleKit server-side SDK client. */
export class SettleKit {
  /** The underlying HTTP client (exposed for advanced/custom calls). */
  readonly http: HttpClient;

  readonly products: ProductsResource;
  readonly prices: PricesResource;
  readonly customers: CustomersResource;
  readonly checkout: CheckoutResource;
  readonly payments: PaymentsResource;
  readonly subscriptions: SubscriptionsResource;
  readonly entitlements: EntitlementsResource;
  readonly licenseKeys: LicenseKeysResource;
  readonly apiKeys: ApiKeysResource;
  readonly bundles: BundlesResource;
  readonly files: FilesResource;
  readonly webhooks: WebhooksResource;
  readonly deliveryRuns: DeliveryRunsResource;
  readonly agentServices: AgentServicesResource;
  readonly escrow: EscrowResource;
  readonly github: GitHubResource;
  readonly discord: DiscordResource;
  readonly saas: SaasResource;
  readonly usage: UsageResource;
  readonly marketplace: MarketplaceResource;
  readonly analytics: AnalyticsResource;
  readonly coupons: CouponsResource;
  readonly invoices: InvoicesResource;
  readonly payouts: PayoutsResource;
  readonly refunds: RefundsResource;
  readonly disputes: DisputesResource;
  readonly dunning: DunningResource;
  readonly settings: SettingsResource;

  constructor(options: SettleKitOptions) {
    this.http = new HttpClient(options);
    this.products = new ProductsResource(this.http);
    this.prices = new PricesResource(this.http);
    this.customers = new CustomersResource(this.http);
    this.checkout = new CheckoutResource(this.http);
    this.payments = new PaymentsResource(this.http);
    this.subscriptions = new SubscriptionsResource(this.http);
    this.entitlements = new EntitlementsResource(this.http);
    this.licenseKeys = new LicenseKeysResource(this.http);
    this.apiKeys = new ApiKeysResource(this.http);
    this.bundles = new BundlesResource(this.http);
    this.files = new FilesResource(this.http);
    this.webhooks = new WebhooksResource(this.http);
    this.deliveryRuns = new DeliveryRunsResource(this.http);
    this.agentServices = new AgentServicesResource(this.http);
    this.escrow = new EscrowResource(this.http);
    this.github = new GitHubResource(this.http);
    this.discord = new DiscordResource(this.http);
    this.saas = new SaasResource(this.http);
    this.usage = new UsageResource(this.http);
    this.marketplace = new MarketplaceResource(this.http);
    this.analytics = new AnalyticsResource(this.http);
    this.coupons = new CouponsResource(this.http);
    this.invoices = new InvoicesResource(this.http);
    this.payouts = new PayoutsResource(this.http);
    this.refunds = new RefundsResource(this.http);
    this.disputes = new DisputesResource(this.http);
    this.dunning = new DunningResource(this.http);
    this.settings = new SettingsResource(this.http);
  }
}

/** Create a configured {@link SettleKit} client. */
export function createSettleKitClient(options: SettleKitOptions): SettleKit {
  return new SettleKit(options);
}
