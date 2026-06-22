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
import { FileText, ArrowUpRight } from "lucide-react";

import { createSupabaseServerComponentClient } from "@/lib/supabase/server-client";
import { createEscrowService } from "@/app/services/escrow.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getStatusColor, formatAmount } from "@/lib/utils/escrow";
import {
  summarizeAgreements,
  getAgreementAmount,
} from "@/lib/utils/agreement-stats";
import { AgreementStatus, EscrowAgreementWithDetails } from "@/types/escrow";

export const metadata = {
  title: "Agreements · Escrow Refund Protocol",
  description:
    "Full history of your escrow agreements — value locked, in-progress deals, and completed settlements.",
};

interface StatCardProps {
  label: string;
  value: string;
}

function StatCard({ label, value }: StatCardProps) {
  return (
    <Card className="flex-1 min-w-[160px]">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold tracking-tight">{value}</p>
      </CardContent>
    </Card>
  );
}

export default async function AgreementsPage() {
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

  let agreements: EscrowAgreementWithDetails[] = [];
  let loadError: string | null = null;

  try {
    const escrowService = createEscrowService(supabase);
    agreements = await escrowService.getAgreements(profile.id);
  } catch (error) {
    console.error("Error loading agreements history:", error);
    loadError =
      error instanceof Error ? error.message : "Failed to load agreements";
  }

  const summary = summarizeAgreements(agreements);

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h2 className="scroll-m-20 text-3xl font-semibold tracking-tight">
          Agreements
        </h2>
        <Button asChild variant="outline">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>

      <div className="flex flex-wrap gap-4 mb-6">
        <StatCard label="Total agreements" value={String(summary.total)} />
        <StatCard label="In progress" value={String(summary.inProgress)} />
        <StatCard label="Completed" value={String(summary.closed)} />
        <StatCard
          label="Total value"
          value={formatAmount(summary.totalValue, "USD")}
        />
      </div>

      <Card className="w-full">
        <CardHeader>
          <CardTitle>All agreements</CardTitle>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <div className="text-center text-destructive py-8">
              <p>{loadError}</p>
            </div>
          ) : agreements.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center text-muted-foreground">
              <FileText className="h-10 w-10 opacity-50" />
              <p>You have no escrow agreements yet.</p>
              <Button asChild variant="default">
                <Link href="/dashboard">Create your first agreement</Link>
              </Button>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sender</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Date created</TableHead>
                    <TableHead className="text-right">Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agreements.map((agreement) => (
                    <TableRow key={agreement.id}>
                      <TableCell>
                        {agreement.depositor_wallet?.profiles?.name ??
                          agreement.depositor_wallet?.profiles?.email ??
                          "N/A"}
                      </TableCell>
                      <TableCell>
                        {agreement.beneficiary_wallet?.profiles?.name ??
                          agreement.beneficiary_wallet?.profiles?.email ??
                          "N/A"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={getStatusColor(
                            agreement.status as AgreementStatus
                          )}
                        >
                          {agreement.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {formatAmount(getAgreementAmount(agreement), "USD")}
                      </TableCell>
                      <TableCell>
                        {new Date(agreement.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/dashboard/agreements/${agreement.id}`}>
                            View
                            <ArrowUpRight className="ml-1 h-4 w-4" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
