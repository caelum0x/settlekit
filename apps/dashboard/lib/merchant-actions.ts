"use server";

// Server actions for the merchant workspace. Client components (onboarding,
// product forms, refund) call these; the session cookie is attached on the
// server and the API scopes every write to the merchant's organization.
import { revalidatePath } from "next/cache";
import { merchantApi } from "./merchant-api";
import type {
  ActionResult,
  DeliveryInput,
  MerchantAddresses,
  MerchantProduct,
  Network,
  PaymentDetail,
  ProfileResponse,
} from "./merchant-types";

export interface SaveProfileInput {
  orgName?: string;
  supportEmail?: string;
  acceptedNetworks: Network[];
  addresses: MerchantAddresses;
}

function clean(addresses: MerchantAddresses): MerchantAddresses {
  const out: MerchantAddresses = {};
  for (const [key, value] of Object.entries(addresses) as [keyof MerchantAddresses, string | undefined][]) {
    const v = value?.trim();
    if (v) out[key] = v;
  }
  return out;
}

export async function saveProfileAction(input: SaveProfileInput): Promise<ActionResult<ProfileResponse>> {
  if (input.acceptedNetworks.length === 0) return { data: null, error: "Choose at least one network." };
  const result = await merchantApi.saveProfile({
    ...(input.orgName?.trim() ? { orgName: input.orgName.trim() } : {}),
    ...(input.supportEmail !== undefined ? { supportEmail: input.supportEmail.trim() } : {}),
    acceptedNetworks: input.acceptedNetworks,
    addresses: clean(input.addresses),
  });
  if (!result.error) {
    revalidatePath("/");
    revalidatePath("/settings");
  }
  return result;
}

export interface ProductFormInput {
  name: string;
  description: string;
  priceUsd: string;
  interval: "one_time" | "monthly" | "yearly";
  delivery: DeliveryInput;
  acceptedNetworks: Network[] | null;
  status?: "active" | "archived";
}

export async function createProductAction(input: ProductFormInput): Promise<ActionResult<MerchantProduct>> {
  const result = await merchantApi.createProduct({
    name: input.name,
    description: input.description,
    priceUsd: input.priceUsd,
    interval: input.interval,
    delivery: input.delivery,
    ...(input.acceptedNetworks ? { acceptedNetworks: input.acceptedNetworks } : {}),
  });
  if (!result.error) revalidatePath("/products");
  return result;
}

export async function updateProductAction(id: string, input: ProductFormInput): Promise<ActionResult<MerchantProduct>> {
  const result = await merchantApi.updateProduct(id, {
    name: input.name,
    description: input.description,
    ...(input.priceUsd ? { priceUsd: input.priceUsd } : {}),
    delivery: input.delivery,
    acceptedNetworks: input.acceptedNetworks,
    ...(input.status ? { status: input.status } : {}),
  });
  if (!result.error) {
    revalidatePath("/products");
    revalidatePath(`/products/${id}`);
  }
  return result;
}

export interface RefundInput {
  reason: "duplicate" | "fraudulent" | "customer_request" | "delivery_failed";
  amountUsd?: string;
  txHash?: string;
  revokeAccess: boolean;
}

export async function refundPaymentAction(id: string, input: RefundInput): Promise<ActionResult<{ payment: PaymentDetail }>> {
  const result = await merchantApi.refund(id, {
    reason: input.reason,
    revokeAccess: input.revokeAccess,
    ...(input.amountUsd?.trim() ? { amountUsd: input.amountUsd.trim() } : {}),
    ...(input.txHash?.trim() ? { txHash: input.txHash.trim() } : {}),
  });
  if (!result.error) revalidatePath(`/payments/${id}`);
  return result;
}
