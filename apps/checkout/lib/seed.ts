/**
 * Demo catalog seed.
 *
 * Builds real @settlekit/common Product + Price records and the DeliveryAction
 * that fulfills each, plus the merchant directory. These are genuine domain
 * objects (not mocks) used to render live checkout sessions. In production this
 * data would come from @settlekit/database; here it is constructed in-process
 * so the hosted checkout app runs standalone.
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
}

export interface SeededCatalog {
  products: SeededProduct[];
  merchants: Record<string, string>;
}

const NOW = new Date("2026-01-01T00:00:00.000Z");
const ORG = "org_settlekit_demo";
const MERCHANT = "mch_acme_dev_tools";
const PAY_TO = "0x9f2A4b6C8d0E2f4A6b8C0d2E4f6A8b0C2d4E6f80";
const NETWORK: PaymentNetwork = "base";

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
export function seedCatalog(): SeededCatalog {
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
      payToAddress: PAY_TO,
      network: NETWORK,
    },
    {
      product: licenseProd,
      price: price(licenseProd.id, "79"),
      deliveryAction: { type: "license_key_create", policyId: "pol_pro_3m" },
      payToAddress: PAY_TO,
      network: NETWORK,
    },
    {
      product: apiProd,
      price: price(apiProd.id, "25"),
      deliveryAction: {
        type: "api_key_create",
        scopes: ["inference:read", "inference:invoke"],
      },
      payToAddress: PAY_TO,
      network: NETWORK,
    },
    {
      product: fileProd,
      price: price(fileProd.id, "15"),
      deliveryAction: {
        type: "file_access_grant",
        fileId: "file_atlas_embeddings_v3",
      },
      payToAddress: PAY_TO,
      network: NETWORK,
    },
    {
      product: discordProd,
      price: price(discordProd.id, "10"),
      deliveryAction: {
        type: "discord_role_add",
        guildId: "884213000000000000",
        roleId: "884213999999999999",
      },
      payToAddress: PAY_TO,
      network: NETWORK,
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
