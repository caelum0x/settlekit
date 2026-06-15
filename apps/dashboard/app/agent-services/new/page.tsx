import { api } from "@/lib/api";
import { PageHeader, Card } from "@/components/ui";
import { SimpleCreateForm } from "@/components/forms/SimpleCreateForm";

export const dynamic = "force-dynamic";

async function createService(values: Record<string, string>): Promise<string | null> {
  "use server";
  const pricePerCall = Math.round(
    (parseFloat(values.pricePerCall || "0") || 0) * 1_000_000,
  );
  const { error } = await api.agentServices.create(
    values.name ?? "",
    values.description ?? "",
    pricePerCall,
  );
  return error;
}

export default function NewAgentServicePage() {
  return (
    <>
      <div className="breadcrumb">
        <a href="/agent-services">Agent Services</a> / New
      </div>
      <PageHeader
        title="New Agent Service"
        description="Define a per-call service that agents can pay for using x402."
      />
      <Card title="Service details">
        <SimpleCreateForm
          submitLabel="Create service"
          successMessage="Agent service created."
          action={createService}
          fields={[
            { name: "name", label: "Service name", required: true, placeholder: "Research Summarizer" },
            {
              name: "description",
              label: "Description",
              type: "textarea",
              required: true,
              placeholder: "What the service does, inputs, and outputs.",
              hint: "This becomes part of the agent-readable metadata.json.",
            },
            {
              name: "pricePerCall",
              label: "Price per call (USDC)",
              type: "number",
              required: true,
              placeholder: "0.05",
            },
          ]}
        />
      </Card>
    </>
  );
}
