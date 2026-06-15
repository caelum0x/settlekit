export type EmailTemplateName = "receipt" | "access_granted" | "subscription_renewal" | "payment_failed";

export interface RenderedEmail {
  subject: string;
  text: string;
}

export function renderEmailTemplate(template: EmailTemplateName, variables: Record<string, string>): RenderedEmail {
  if (template === "receipt") {
    return { subject: "Your SettleKit receipt", text: `Payment received for ${variables.productName ?? "your purchase"}.` };
  }
  if (template === "access_granted") {
    return { subject: "Access granted", text: `You now have access to ${variables.productName ?? "your product"}.` };
  }
  if (template === "subscription_renewal") {
    return { subject: "Subscription renewed", text: `Your ${variables.productName ?? "subscription"} renewed successfully.` };
  }
  return { subject: "Payment failed", text: `We could not renew ${variables.productName ?? "your subscription"}.` };
}

export function templateRequiresProductName(template: EmailTemplateName): boolean {
  return template !== "payment_failed";
}
