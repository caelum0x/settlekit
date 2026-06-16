"use server";

// Server action for the Product Builder. The builder runs in the browser where
// the httpOnly `sk_session` cookie is neither readable nor sent cross-origin to
// the API, so the create call is delegated here — on the server `lib/api`
// attaches the merchant's session and the API scopes the product to their org.

import { api } from "@/lib/api";
import type { CreateProductInput, Product } from "@/lib/types";

export interface CreateProductResult {
  data: Product | null;
  error: string | null;
}

export async function createProduct(
  input: CreateProductInput,
): Promise<CreateProductResult> {
  return api.products.create(input);
}
