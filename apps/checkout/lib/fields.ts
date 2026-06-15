/**
 * Required-field derivation. Maps a product's delivery action to the buyer
 * identity fields the checkout form must collect before payment, so delivery
 * (github invite, discord role, license email, etc.) can succeed.
 */
import type { DeliveryAction } from "@settlekit/common";
import type { CollectedFieldSpec } from "./types";

const GITHUB_USERNAME: CollectedFieldSpec = {
  key: "githubUsername",
  label: "GitHub username",
  help: "We send the private repo invite to this GitHub account.",
  inputType: "text",
  required: true,
  placeholder: "octocat",
};

const DISCORD_USER_ID: CollectedFieldSpec = {
  key: "discordUserId",
  label: "Discord user ID",
  help: "Enable Developer Mode in Discord, right-click your name, Copy User ID.",
  inputType: "text",
  required: true,
  placeholder: "123456789012345678",
};

const EMAIL: CollectedFieldSpec = {
  key: "email",
  label: "Email address",
  help: "Your receipt and access details are sent here.",
  inputType: "email",
  required: true,
  placeholder: "you@example.com",
};

/**
 * Derive required fields from the product's delivery action. Email is always
 * collected for the receipt; access-specific fields are appended.
 */
export function requiredFieldsForDelivery(
  action: DeliveryAction,
): CollectedFieldSpec[] {
  const fields: CollectedFieldSpec[] = [EMAIL];
  switch (action.type) {
    case "github_invite":
    case "github_team_add":
      fields.push(GITHUB_USERNAME);
      break;
    case "discord_role_add":
      fields.push(DISCORD_USER_ID);
      break;
    default:
      break;
  }
  return fields;
}

/**
 * Validate buyer-submitted fields against the required specs. Returns a list of
 * human-readable error messages; empty means valid.
 */
export function validateFields(
  specs: CollectedFieldSpec[],
  values: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  for (const spec of specs) {
    const raw = values[spec.key];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (spec.required && value.length === 0) {
      errors.push(`${spec.label} is required.`);
      continue;
    }
    if (spec.inputType === "email" && value.length > 0 && !isEmail(value)) {
      errors.push(`${spec.label} must be a valid email address.`);
    }
  }
  return errors;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

/** Keep only the keys declared in specs, trimmed. Drops unknown input. */
export function sanitizeFields(
  specs: CollectedFieldSpec[],
  values: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const spec of specs) {
    const raw = values[spec.key];
    if (typeof raw === "string") {
      out[spec.key] = raw.trim();
    }
  }
  return out;
}
