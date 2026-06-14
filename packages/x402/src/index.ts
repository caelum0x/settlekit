export interface X402PaymentConfig {
  price: string;
  currency: "USDC";
  productId: string;
  network?: "arc" | "base";
}

export type FetchLikeHandler = (request: Request) => Response | Promise<Response>;

export function paymentRequiredResponse(config: X402PaymentConfig): Response {
  return Response.json(
    {
      error: "payment_required",
      payment: {
        protocol: "x402",
        price: config.price,
        currency: config.currency,
        productId: config.productId,
        network: config.network ?? "arc",
      },
    },
    { status: 402 },
  );
}

export function withSettleKitPayment(config: X402PaymentConfig) {
  return function wrap(handler: FetchLikeHandler): FetchLikeHandler {
    return async function paidHandler(request: Request): Promise<Response> {
      if (!request.headers.get("x-settlekit-payment")) return paymentRequiredResponse(config);
      return handler(request);
    };
  };
}
