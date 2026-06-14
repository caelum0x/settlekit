export interface CircleGatewayPaymentIntent {
  id: string;
  amount: string;
  currency: "USDC";
  network: "arc" | "base";
  status: "created" | "paid" | "expired";
}

export function circleGatewayAmount(amount: string): { amount: string; currency: "USDC" } {
  return { amount, currency: "USDC" };
}
