import type { ReactNode } from "react";
import { api } from "@/lib/api";
import { PortalNav } from "@/components/PortalNav";

interface LayoutProps {
  children: ReactNode;
  params: { customerId: string };
}

export default async function CustomerLayout({ children, params }: LayoutProps) {
  const customerId = decodeURIComponent(params.customerId);
  const { data: customer } = await api.customer.get(customerId);

  const displayName = customer?.name ?? customer?.email ?? "Your account";

  return (
    <div>
      <div className="customer-head">
        <div>
          <h1>{displayName}</h1>
          <div className="customer-meta">
            {customer?.email ? <span>{customer.email}</span> : null}
            <span className="mono">{customerId}</span>
          </div>
        </div>
      </div>
      <PortalNav customerId={customerId} />
      {children}
    </div>
  );
}
