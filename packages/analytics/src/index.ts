import { addMoney, money, type Payment, type Subscription } from "@settlekit/common";

export function totalConfirmedRevenue(payments: Payment[]) {
  return payments.filter((payment) => payment.status === "confirmed").reduce((total, payment) => addMoney(total, payment.amount), money("0"));
}

export function activeSubscriberCount(subscriptions: Subscription[]): number {
  return subscriptions.filter((subscription) => subscription.status === "active" || subscription.status === "in_grace").length;
}

export function conversionRate(completed: number, opened: number): number {
  return opened === 0 ? 0 : completed / opened;
}
