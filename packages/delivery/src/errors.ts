export class DeliveryError extends Error {
  constructor(message: string, readonly retryable = true) {
    super(message);
    this.name = "DeliveryError";
  }
}
