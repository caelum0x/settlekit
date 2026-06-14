import type { DeliveryAction, DeliveryMode, PriceInterval, ProductType } from "@settlekit/common";

export interface ProductBuilderState {
  productType?: ProductType;
  chargeMode?: PriceInterval | "prepaid_credits" | "pay_per_call" | "custom_quote";
  deliveryModes: DeliveryMode[];
}

export function selectProductType(state: ProductBuilderState, productType: ProductType): ProductBuilderState {
  return { ...state, productType };
}

export function selectChargeMode(state: ProductBuilderState, chargeMode: ProductBuilderState["chargeMode"]): ProductBuilderState {
  return { ...state, chargeMode };
}

export function addDeliveryMode(state: ProductBuilderState, deliveryMode: DeliveryMode): ProductBuilderState {
  return state.deliveryModes.includes(deliveryMode) ? state : { ...state, deliveryModes: [...state.deliveryModes, deliveryMode] };
}

export function defaultActionsForDeliveryModes(modes: DeliveryMode[]): DeliveryAction[] {
  return modes.flatMap((mode): DeliveryAction[] => {
    if (mode === "license_key") return [{ type: "license_key_create", policyId: "default" }];
    if (mode === "api_key") return [{ type: "api_key_create", scopes: ["api:read"] }];
    if (mode === "webhook") return [{ type: "webhook_send", url: "https://example.com/webhooks/settlekit" }];
    return [];
  });
}
