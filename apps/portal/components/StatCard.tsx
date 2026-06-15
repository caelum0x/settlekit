import type { ReactNode } from "react";
import Link from "next/link";

interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: string;
  href?: string;
}

export function StatCard({ label, value, hint, href }: StatCardProps) {
  const body = (
    <>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint ? <span className="stat-hint">{hint}</span> : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} className="stat-card stat-card-link">
        {body}
      </Link>
    );
  }
  return <div className="stat-card">{body}</div>;
}
