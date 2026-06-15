export type ContentProductType = "course" | "guide" | "template_pack" | "research_report";

export interface ContentModule {
  id: string;
  title: string;
  requiredEntitlementId?: string;
  lessonIds: string[];
}

export interface ContentProduct {
  id: string;
  title: string;
  type: ContentProductType;
  requiredEntitlementId: string;
  modules: ContentModule[];
}

export interface ContentAccessContext {
  entitlementIds: string[];
  completedLessonIds: string[];
}

export interface ContentProgress {
  completedLessons: number;
  totalLessons: number;
  percentComplete: number;
}

export function canAccessContent(product: ContentProduct, context: ContentAccessContext): boolean {
  return context.entitlementIds.includes(product.requiredEntitlementId);
}

export function unlockedContentModules(
  product: ContentProduct,
  context: ContentAccessContext,
): ContentModule[] {
  if (!canAccessContent(product, context)) {
    return [];
  }

  return product.modules.filter((module) => {
    return !module.requiredEntitlementId || context.entitlementIds.includes(module.requiredEntitlementId);
  });
}

export function calculateContentProgress(
  product: ContentProduct,
  context: ContentAccessContext,
): ContentProgress {
  const lessonIds = new Set(product.modules.flatMap((module) => module.lessonIds));
  const completedLessons = context.completedLessonIds.filter((lessonId) => lessonIds.has(lessonId)).length;
  const totalLessons = lessonIds.size;

  return {
    completedLessons,
    totalLessons,
    percentComplete: totalLessons === 0 ? 0 : Math.round((completedLessons / totalLessons) * 100),
  };
}
