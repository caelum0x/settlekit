import { describe, expect, it } from "vitest";
import {
  calculateContentProgress,
  canAccessContent,
  unlockedContentModules,
  type ContentProduct,
} from "../src/index.js";

describe("content access", () => {
  const product: ContentProduct = {
    id: "course_1",
    title: "Ship a paid API",
    type: "course",
    requiredEntitlementId: "ent_course",
    modules: [
      { id: "mod_1", title: "Checkout", lessonIds: ["lesson_1", "lesson_2"] },
      {
        id: "mod_2",
        title: "Advanced delivery",
        requiredEntitlementId: "ent_course_pro",
        lessonIds: ["lesson_3"],
      },
    ],
  };

  it("requires the product entitlement", () => {
    expect(canAccessContent(product, { entitlementIds: [], completedLessonIds: [] })).toBe(false);
    expect(
      canAccessContent(product, { entitlementIds: ["ent_course"], completedLessonIds: [] }),
    ).toBe(true);
  });

  it("filters modules by entitlement", () => {
    expect(
      unlockedContentModules(product, {
        entitlementIds: ["ent_course"],
        completedLessonIds: [],
      }).map((module) => module.id),
    ).toEqual(["mod_1"]);
  });

  it("calculates lesson completion", () => {
    expect(
      calculateContentProgress(product, {
        entitlementIds: ["ent_course"],
        completedLessonIds: ["lesson_1", "lesson_3", "external_lesson"],
      }),
    ).toEqual({ completedLessons: 2, totalLessons: 3, percentComplete: 67 });
  });
});
