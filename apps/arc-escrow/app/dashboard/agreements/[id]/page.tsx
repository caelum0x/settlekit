/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText, ExternalLink } from "lucide-react";

import { createSupabaseServerComponentClient } from "@/lib/supabase/server-client";
import { createEscrowService } from "@/app/services/escrow.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getStatusColor, formatAmount } from "@/lib/utils/escrow";
import { getAgreementAmount } from "@/lib/utils/agreement-stats";
import { AgreementStatus, EscrowAgreementWithDetails } from "@/types/escrow";

export const metadata = {
  title: "Agreement details · Escrow Refund Protocol",
};

interface DetailRowProps {
  label: string;
  value: React.ReactNode;
}

function DetailRow({ label, value }: DetailRowProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <span className="text-base break-all">{value}</span>
    </div>
  );
}

export default async function AgreementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createSupabaseServerComponentClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect("/sign-in");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (!profile) {
    return redirect("/dashboard");
  }

  let agreement: EscrowAgreementWithDetails | undefined;

  try {
    const escrowService = createEscrowService(supabase);
    const agreements = await escrowService.getAgreements(profile.id);
    // The service already scopes agreements to the current user's wallets, so
    // a missing match here means the agreement is either absent or not theirs.
    agreement = agreements.find((item) => item.id === id);
  } catch (error) {
    console.error("Error loading agreement detail:", error);
  }

  if (!agreement) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Agreement not found</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-4">
          <p className="text-muted-foreground">
            This agreement does not exist or you do not have access to it.
          </p>
          <Button asChild variant="outline">
            <Link href="/dashboard/agreements">Back to agreements</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const tasks = agreement.terms?.tasks ?? [];
  const documentUrl = agreement.terms?.documentUrl;
  const originalFileName = agreement.terms?.originalFileName;

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h2 className="scroll-m-20 text-3xl font-semibold tracking-tight">
          Agreement details
        </h2>
        <Button asChild variant="outline">
          <Link href="/dashboard/agreements">Back to agreements</Link>
        </Button>
      </div>

      <div className="flex flex-col gap-4">
        <Card className="w-full">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Overview</CardTitle>
            <Badge
              variant="outline"
              className={getStatusColor(agreement.status as AgreementStatus)}
            >
              {agreement.status}
            </Badge>
          </CardHeader>
          <CardContent className="grid gap-6 sm:grid-cols-2">
            <DetailRow label="Agreement ID" value={agreement.id} />
            <DetailRow
              label="Amount"
              value={formatAmount(getAgreementAmount(agreement), "USD")}
            />
            <DetailRow
              label="Sender"
              value={
                agreement.depositor_wallet?.profiles?.name ??
                agreement.depositor_wallet?.profiles?.email ??
                "N/A"
              }
            />
            <DetailRow
              label="Recipient"
              value={
                agreement.beneficiary_wallet?.profiles?.name ??
                agreement.beneficiary_wallet?.profiles?.email ??
                "N/A"
              }
            />
            <DetailRow
              label="Created"
              value={new Date(agreement.created_at).toLocaleString()}
            />
            <DetailRow
              label="Last updated"
              value={
                agreement.updated_at
                  ? new Date(agreement.updated_at).toLocaleString()
                  : "—"
              }
            />
          </CardContent>
        </Card>

        <Card className="w-full">
          <CardHeader>
            <CardTitle>Deliverables</CardTitle>
          </CardHeader>
          <CardContent>
            {tasks.length === 0 ? (
              <p className="text-muted-foreground">
                No deliverables recorded for this agreement.
              </p>
            ) : (
              <ol className="space-y-4">
                {tasks.map((task, index) => (
                  <li key={index}>
                    {index > 0 && <Separator className="mb-4" />}
                    <p className="font-medium">{task.description}</p>
                    <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                      {task.due_date && <span>Due: {task.due_date}</span>}
                      {task.responsible_party && (
                        <span>Owner: {task.responsible_party}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        {documentUrl && (
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Source document</CardTitle>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <a href={documentUrl} target="_blank" rel="noopener noreferrer">
                  <FileText className="mr-2 h-4 w-4" />
                  {originalFileName ?? "View document"}
                  <ExternalLink className="ml-2 h-4 w-4" />
                </a>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
