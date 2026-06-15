export interface ApprovalRequest {
  id: string;
  resourceId: string;
  requiredApprovals: number;
  approverIds: string[];
  status: "pending" | "approved" | "rejected";
}

export function addApproval(request: ApprovalRequest, approverId: string): ApprovalRequest {
  if (request.status !== "pending") return request;
  const approverIds = request.approverIds.includes(approverId) ? request.approverIds : [...request.approverIds, approverId];
  return { ...request, approverIds, status: approverIds.length >= request.requiredApprovals ? "approved" : "pending" };
}

export function rejectApproval(request: ApprovalRequest): ApprovalRequest {
  return { ...request, status: "rejected" };
}
