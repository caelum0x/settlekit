/**
 * Demo catalog seed.
 *
 * Builds real @settlekit/common Product + Price records and the DeliveryAction
 * that fulfills each, plus the merchant directory. These are genuine domain
 * objects (not mocks) used to render live checkout sessions. In production this
 * data would come from @settlekit/database; here it is constructed in-process
 * so the hosted checkout app runs standalone.
 *
 * Demo sessions accept every network. They stay fail closed: the picker only
 * offers a network this checkout can verify (see ./network-options), and the
 * placeholder EVM address is only ever offered on test networks. Solana and
 * Zcash are accepted only when a real receiving address is configured:
 *
 *   CHECKOUT_DEMO_EVM_PAY_TO      EVM receiving address (default: placeholder, testnets only)
 *   CHECKOUT_DEMO_SOLANA_PAY_TO   Solana wallet address (devnet or mainnet)
 *   CHECKOUT_DEMO_ZCASH_PAY_TO    Zcash transparent t1/t3 address (mainnet)
 */
import {
  generateId,
  toIso,
  money,
  type DeliveryAction,
  type PaymentNetwork,
  type Price,
  type Product,
} from "@settlekit/common";

export interface SeededProduct {
  product: Product;
  price: Price;
  deliveryAction: DeliveryAction;
  payToAddress: string;
  network: PaymentNetwork;
  acceptedNetworks: PaymentNetwork[];
  payToByNetwork: Partial<Record<PaymentNetwork, string>>;
}

export interface SeededCatalog {
  products: SeededProduct[];
  merchants: Record<string, string>;
}

const NOW = new Date("2026-01-01T00:00:00.000Z");
const ORG = "org_settlekit_demo";
const MERCHANT = "mch_acme_dev_tools";
/** Placeholder EVM receiver (EIP-55 checksummed). Only offered on testnets. */
export const DEMO_EVM_PAY_TO = "0x9f2A4B6C8D0E2f4A6b8C0D2E4f6A8B0c2D4e6F80";
const NETWORK: PaymentNetwork = "base";
const EVM_NETWORKS: readonly PaymentNetwork[] = ["base", "ethereum", "arbitrum", "robinhood", "hyperevm", "tempo", "arc"];

type Env = Readonly<Record<string, string | undefined>>;

function read(env: Env, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

/** Demo receiving addresses: the primary payTo, accepted networks and overrides. */
export function demoPaymentRouting(env: Env = process.env): {
  payToAddress: string;
  acceptedNetworks: PaymentNetwork[];
  payToByNetwork: Partial<Record<PaymentNetwork, string>>;
} {
  const evm = read(env, "CHECKOUT_DEMO_EVM_PAY_TO") ?? DEMO_EVM_PAY_TO;
  const solana = read(env, "CHECKOUT_DEMO_SOLANA_PAY_TO");
  const zcash = read(env, "CHECKOUT_DEMO_ZCASH_PAY_TO");
  const payToByNetwork: Partial<Record<PaymentNetwork, string>> = {
    ...(solana ? { solana } : {}),
    ...(zcash ? { zcash } : {}),
  };
  const acceptedNetworks: PaymentNetwork[] = [
    ...EVM_NETWORKS,
    ...(solana ? (["solana"] as const) : []),
    ...(zcash ? (["zcash"] as const) : []),
  ];
  return { payToAddress: evm, acceptedNetworks, payToByNetwork };
}

function product(
  id: string,
  name: string,
  description: string,
  type: Product["type"],
  deliveryMode: Product["deliveryMode"],
  metadata: Record<string, unknown>,
): Product {
  return {
    id,
    merchantId: MERCHANT,
    organizationId: ORG,
    name,
    description,
    type,
    status: "active",
    deliveryMode,
    metadata,
    createdAt: toIso(NOW),
    updatedAt: toIso(NOW),
  };
}

function price(productId: string, amount: string): Price {
  return {
    id: generateId("price"),
    productId,
    amount,
    currency: "USDC",
    interval: "one_time",
    usageBased: false,
    active: true,
    createdAt: toIso(NOW),
  };
}

/** Build the seeded catalog. */
export function seedCatalog(env: Env = process.env): SeededCatalog {
  const routing = demoPaymentRouting(env);
  const pay = {
    payToAddress: routing.payToAddress,
    network: NETWORK,
    acceptedNetworks: routing.acceptedNetworks,
    payToByNetwork: routing.payToByNetwork,
  };
  const repoProd = product(
    "prod_private_repo_starter",
    "Atlas Starter Kit (Private Repo)",
    "Lifetime access to the Atlas production Next.js starter — a private GitHub repository with CI, auth, billing, and deploy pipelines wired up.",
    "github_repo_access",
    "github_invite",
    { repoOwner: "acme-dev", repoName: "atlas-starter" },
  );
  const licenseProd = product(
    "prod_desktop_license",
    "Atlas Desktop — Pro License",
    "A perpetual license key for Atlas Desktop Pro. Activates on up to 3 machines, includes 1 year of updates.",
    "license_key",
    "license_key",
    { machineLimit: 3 },
  );
  const apiProd = product(
    "prod_inference_api",
    "Atlas Inference API — Launch Plan",
    "A live API key for the Atlas Inference API with read + invoke scopes, rate-limited to the Launch tier.",
    "api_access",
    "api_key",
    { scopes: ["inference:read", "inference:invoke"], env: "live" },
  );
  const fileProd = product(
    "prod_dataset_download",
    "Atlas Embeddings Dataset (12GB)",
    "A signed, time-limited download of the Atlas embeddings dataset — 12GB of curated vectors with documentation.",
    "digital_download",
    "file_download",
    { fileId: "file_atlas_embeddings_v3" },
  );
  const discordProd = product(
    "prod_discord_founders",
    "Atlas Founders Discord",
    "Paid role granting access to the private Atlas Founders Discord — office hours, roadmap channels, and direct support.",
    "discord_access",
    "discord_role",
    { guildId: "884213000000000000", roleId: "884213999999999999" },
  );

  const products: SeededProduct[] = [
    {
      product: repoProd,
      price: price(repoProd.id, "49"),
      deliveryAction: {
        type: "github_invite",
        repoId: "acme-dev/atlas-starter",
        permission: "pull",
      },
      ...pay,
    },
    {
      product: licenseProd,
      price: price(licenseProd.id, "79"),
      deliveryAction: { type: "license_key_create", policyId: "pol_pro_3m" },
      ...pay,
    },
    {
      product: apiProd,
      price: price(apiProd.id, "25"),
      deliveryAction: {
        type: "api_key_create",
        scopes: ["inference:read", "inference:invoke"],
      },
      ...pay,
    },
    {
      product: fileProd,
      price: price(fileProd.id, "15"),
      deliveryAction: {
        type: "file_access_grant",
        fileId: "file_atlas_embeddings_v3",
      },
      ...pay,
    },
    {
      product: discordProd,
      price: price(discordProd.id, "10"),
      deliveryAction: {
        type: "discord_role_add",
        guildId: "884213000000000000",
        roleId: "884213999999999999",
      },
      ...pay,
    },
  ];

  return {
    products,
    merchants: { [MERCHANT]: "Acme Dev Tools" },
  };
}

/** Demo signing secret for HMAC-signed download URLs (server-side only). */
export const DEMO_SECRET =
  process.env.CHECKOUT_DELIVERY_SECRET ?? "settlekit-demo-delivery-secret";

/** Base URL for signed downloads. */
export const DEMO_DOWNLOAD_BASE =
  process.env.CHECKOUT_DOWNLOAD_BASE ?? "https://dl.settlekit.dev/download";

export const DEMO_ORG = ORG;
