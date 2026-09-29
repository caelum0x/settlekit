import type { ReactNode } from "react";
import { requireOwner } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Every page in this group is owner-only. */
export default function OwnerLayout({ children }: { readonly children: ReactNode }) {
  requireOwner();
  return (
    <>
      <div className="row" style={{ justifyContent: "flex-end", marginBottom: 8 }}>
        <form action="/logout" method="post">
          <button type="submit" className="button-secondary">Sign out</button>
        </form>
      </div>
      {children}
    </>
  );
}
