import type { Storefront } from "@/lib/storefront";
import { accent, priceLabel } from "@/lib/storefront";

/** A merchant's branded product grid; each product opens its payment link. */
export function StorefrontView({ store }: { store: Storefront }) {
  const color = accent(store);
  return (
    <div>
      <div className="card" style={{ borderTop: `4px solid ${color}` }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          {store.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={store.logoUrl} alt="" width={48} height={48} style={{ borderRadius: 10, objectFit: "cover" }} />
          ) : null}
          <div>
            <h2 style={{ margin: 0 }}>{store.title}</h2>
            {store.tagline ? <p className="muted" style={{ margin: "4px 0 0" }}>{store.tagline}</p> : null}
          </div>
        </div>
      </div>
      {!store.acceptingPayments ? (
        <div className="alert alert-error" role="status">
          This store is not taking payments right now.
        </div>
      ) : null}
      {store.products.length === 0 ? (
        <div className="card">
          <p className="muted">No products yet.</p>
        </div>
      ) : (
        store.products.map((p) => (
          <div className="card" key={p.slug}>
            <h3 style={{ marginTop: 0 }}>{p.name}</h3>
            {p.description ? <p className="line-desc">{p.description}</p> : null}
            <div className="total">
              <span>{priceLabel(p)}</span>
              {store.acceptingPayments ? (
                <a className="btn btn-primary" style={{ background: color, borderColor: color }} href={`/l/${encodeURIComponent(p.slug)}`}>
                  Buy
                </a>
              ) : null}
            </div>
          </div>
        ))
      )}
      <p className="muted" style={{ textAlign: "center" }}>
        Sold by {store.merchantName}. Pay in USDC on {store.networks.length} network{store.networks.length === 1 ? "" : "s"}.
      </p>
    </div>
  );
}
