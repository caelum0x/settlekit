import Link from "next/link";

export default function NotFound() {
  return (
    <section>
      <h1>Not found</h1>
      <p className="subtitle">
        That listing, agent service, or seller does not exist or is no longer
        published.
      </p>
      <Link className="btn" href="/">
        Back to marketplace
      </Link>
    </section>
  );
}
