import { describe, expect, it } from "vitest";
import { notificationEnabled, setNotificationPreference } from "../src/index.js";

describe("notification preferences", () => {
  it("overrides default notification settings", () => {
    const prefs = setNotificationPreference([], { userId: "user_1", topic: "marketing", channel: "email", enabled: false });
    expect(notificationEnabled(prefs, "user_1", "marketing", "email")).toBe(false);
    expect(notificationEnabled(prefs, "user_1", "payments", "email")).toBe(true);
  });
});
