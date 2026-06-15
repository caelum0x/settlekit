import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/ui";

export default function NotFound() {
  return (
    <>
      <PageHeader title="Not found" />
      <EmptyState
        title="404 — Page not found"
        message="The page or record you are looking for does not exist."
        action={
          <Link href="/" className="btn btn-primary">
            Back to dashboard
          </Link>
        }
      />
    </>
  );
}
