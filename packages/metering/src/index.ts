export interface MeterEvent {
  meterId: string;
  customerId: string;
  quantity: number;
  occurredAt: string;
  idempotencyKey: string;
}

export function createMeterEvent(input: Omit<MeterEvent, "occurredAt">, now = new Date()): MeterEvent {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new RangeError("quantity must be a positive integer");
  return { ...input, occurredAt: now.toISOString() };
}

export function aggregateMeterEvents(events: MeterEvent[]): number {
  return events.reduce((sum, event) => sum + event.quantity, 0);
}

export function dedupeMeterEvents(events: MeterEvent[]): MeterEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.idempotencyKey)) return false;
    seen.add(event.idempotencyKey);
    return true;
  });
}
