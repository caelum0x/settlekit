import type { DeliveryAction } from "@settlekit/common";

export function actionRequiresIdentity(action: DeliveryAction): "github" | "discord" | undefined {
  if (action.type === "github_invite" || action.type === "github_team_add") return "github";
  if (action.type === "discord_role_add") return "discord";
  return undefined;
}
