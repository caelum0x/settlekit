import type { DeliveryHandler } from "../types.js";

export const grantFileAccess: DeliveryHandler = async (action) => {
  if (action.type !== "file_access_grant") throw new Error("invalid action");
  return { fileId: action.fileId };
};
