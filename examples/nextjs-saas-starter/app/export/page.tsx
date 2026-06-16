import { CustomerIdInput } from "../../components/CustomerIdInput";
import { GatedExport } from "../../components/GatedExport";

export default function ExportPage() {
  return (
    <main className="container">
      <section className="hero">
        <h1>Export</h1>
        <p className="lead">
          The AI Export workspace. Access is gated by the SettleKit{" "}
          <code>ai_export</code> entitlement for the customer below.
        </p>
      </section>

      <CustomerIdInput />
      <GatedExport />
    </main>
  );
}
