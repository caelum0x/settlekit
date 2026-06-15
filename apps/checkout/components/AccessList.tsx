import { CopyButton } from "./CopyButton";
import type { DeliveredAccess } from "@/lib/types";

interface AccessListProps {
  access: DeliveredAccess[];
}

/** Short human label per access kind, shown as a chip. */
const KIND_LABEL: Record<DeliveredAccess["kind"], string> = {
  github_invite: "GitHub",
  license_key: "License",
  api_key: "API key",
  file_download: "Download",
  discord_role: "Discord",
  saas_entitlement: "SaaS",
};

/**
 * Renders each delivered entitlement. Links open in a new tab; secret values
 * (license keys, api keys) get a copy button.
 */
export function AccessList({ access }: AccessListProps) {
  if (access.length === 0) {
    return (
      <p className="muted">
        Access is being provisioned. Refresh in a moment if it is not shown yet.
      </p>
    );
  }

  return (
    <div>
      {access.map((item, index) => (
        <div className="access-item" key={`${item.kind}-${index}`}>
          <div className="access-title">
            <span className="badge badge-network">{KIND_LABEL[item.kind]}</span>
            <span>{item.title}</span>
          </div>

          {item.isLink ? (
            <a
              className="link"
              href={item.value}
              target="_blank"
              rel="noreferrer"
            >
              {item.value}
            </a>
          ) : (
            <>
              <div className="access-value">{item.value}</div>
              <CopyButton value={item.value} label="Copy" />
            </>
          )}

          {item.detail ? (
            <div className="access-detail" style={{ marginTop: 8 }}>
              {item.detail}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
