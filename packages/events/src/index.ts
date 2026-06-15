export interface DomainEvent<T = Record<string, unknown>> {
  id: string;
  type: string;
  aggregateId: string;
  data: T;
  occurredAt: string;
}

export function createDomainEvent<T>(input: Omit<DomainEvent<T>, "occurredAt">, now = new Date()): DomainEvent<T> {
  return { ...input, occurredAt: now.toISOString() };
}

export function eventsForAggregate<T>(events: Array<DomainEvent<T>>, aggregateId: string): Array<DomainEvent<T>> {
  return events.filter((event) => event.aggregateId === aggregateId);
}

export function eventTypes(events: Array<DomainEvent<unknown>>): string[] {
  return [...new Set(events.map((event) => event.type))];
}
