import { addMoney, money, type Money } from "@settlekit/common";

export interface ReportMetric {
  key: string;
  label: string;
  value: number | Money;
}

export interface RevenueReport {
  periodStart: string;
  periodEnd: string;
  grossRevenue: Money;
  transactionCount: number;
  refundCount: number;
}

export function createRevenueReport(input: RevenueReport): RevenueReport {
  if (new Date(input.periodStart).getTime() > new Date(input.periodEnd).getTime()) {
    throw new Error("periodStart must be before periodEnd");
  }
  return input;
}

export function sumRevenueReports(reports: RevenueReport[]): Money {
  return reports.reduce((total, report) => addMoney(total, report.grossRevenue), money("0"));
}
