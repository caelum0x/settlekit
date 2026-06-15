export interface DataRoomDocument {
  id: string;
  title: string;
  classification: "public" | "confidential" | "restricted";
  allowedCustomerIds: string[];
}

export function canAccessDataRoomDocument(document: DataRoomDocument, customerId: string): boolean {
  return document.classification === "public" || document.allowedCustomerIds.includes(customerId);
}

export function grantDataRoomAccess(document: DataRoomDocument, customerId: string): DataRoomDocument {
  return document.allowedCustomerIds.includes(customerId)
    ? document
    : { ...document, allowedCustomerIds: [...document.allowedCustomerIds, customerId] };
}
