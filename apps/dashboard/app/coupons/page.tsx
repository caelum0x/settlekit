import { api, type CreateCouponDiscount } from "@/lib/api";
import { formatMoneyDecimal, formatDate, humanize } from "@/lib/format";
import {
  PageHeader,
  Card,
  DataTable,
  StatusBadge,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";
import { SimpleCreateForm } from "@/components/forms/SimpleCreateForm";
import type { Coupon, CouponDiscount } from "@/lib/types";

export const dynamic = "force-dynamic";

function describeDiscount(d: CouponDiscount): string {
  if (d.type === "percent") return `${d.percentOff}% off`;
  if (d.type === "amount") return `${formatMoneyDecimal(d.amountOff)} off`;
  return `${d.days}-day free trial`;
}

async function createCoupon(values: Record<string, string>): Promise<string | null> {
  "use server";
  const kind = values.discountType ?? "percent";
  const raw = (values.discountValue ?? "0").trim();
  let discount: CreateCouponDiscount;
  if (kind === "amount") {
    discount = { type: "amount", amountOff: raw };
  } else if (kind === "free-trial-days") {
    discount = { type: "free-trial-days", days: Number(raw) };
  } else {
    discount = { type: "percent", percentOff: Number(raw) };
  }

  const maxRedemptions = values.maxRedemptions ? Number(values.maxRedemptions) : undefined;
  const perCustomerLimit = values.perCustomerLimit ? Number(values.perCustomerLimit) : undefined;
  const expiresAt = values.expiresAt ? new Date(values.expiresAt).toISOString() : undefined;

  const { error } = await api.coupons.create({
    code: values.code ?? "",
    ...(values.name ? { name: values.name } : {}),
    discount,
    ...(maxRedemptions !== undefined ? { maxRedemptions } : {}),
    ...(perCustomerLimit !== undefined ? { perCustomerLimit } : {}),
    ...(expiresAt ? { expiresAt } : {}),
  });
  return error;
}

export default async function CouponsPage() {
  const coupons = await api.coupons.list();
  return (
    <>
      <PageHeader
        title="Coupons"
        description="Discount codes — percent off, fixed amount off, or free-trial days, with redemption and per-customer limits."
      />
      <ErrorBanner error={coupons.error} />
      <Card title="Your coupons">
        <DataTable<Coupon>
          rows={coupons.data}
          getKey={(c) => c.code}
          empty={
            <EmptyState
              title="No coupons yet"
              message="Create a discount code below — it applies at checkout with full eligibility rules."
            />
          }
          columns={[
            { header: "Code", cell: (c) => <span className="mono">{c.code}</span> },
            { header: "Name", cell: (c) => c.name ?? "—" },
            { header: "Discount", cell: (c) => describeDiscount(c.discount) },
            { header: "Status", cell: (c) => <StatusBadge status={c.status} /> },
            {
              header: "Redeemed",
              cell: (c) =>
                c.maxRedemptions != null
                  ? `${c.redeemedCount} / ${c.maxRedemptions}`
                  : String(c.redeemedCount),
            },
            { header: "Expires", cell: (c) => formatDate(c.expiresAt) },
            { header: "Per customer", align: "right", cell: (c) => (c.perCustomerLimit != null ? String(c.perCustomerLimit) : "∞") },
          ]}
        />
      </Card>
      <Card title="Create coupon">
        <SimpleCreateForm
          submitLabel="Create coupon"
          successMessage="Coupon created."
          action={createCoupon}
          fields={[
            { name: "code", label: "Code", required: true, placeholder: "SAVE10" },
            { name: "name", label: "Name", placeholder: "Launch discount" },
            {
              name: "discountType",
              label: "Discount type",
              required: true,
              options: [
                { value: "percent", label: "Percent off" },
                { value: "amount", label: "Fixed amount off (USDC)" },
                { value: "free-trial-days", label: "Free trial days" },
              ],
            },
            {
              name: "discountValue",
              label: "Discount value",
              required: true,
              placeholder: "10",
              hint: "Percent (1-100), USDC amount (e.g. 25.00), or number of days.",
            },
            { name: "maxRedemptions", label: "Max redemptions", type: "number", placeholder: "100" },
            { name: "perCustomerLimit", label: "Per-customer limit", type: "number", placeholder: "1" },
            { name: "expiresAt", label: "Expires at", placeholder: "2026-12-31", hint: "Optional date." },
          ]}
        />
      </Card>
    </>
  );
}
