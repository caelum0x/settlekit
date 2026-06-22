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

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server-client";
import { createEscrowService } from "@/app/services/escrow.service";
import {
  summarizeAgreements,
  type AgreementSummary,
} from "@/lib/utils/agreement-stats";

interface SummaryResponse {
  summary?: AgreementSummary;
  error?: string;
}

export async function GET(): Promise<NextResponse<SummaryResponse>> {
  try {
    const supabase = createSupabaseServerClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("auth_user_id", user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: "Profile not found" },
        { status: 404 }
      );
    }

    const escrowService = createEscrowService(supabase);
    const agreements = await escrowService.getAgreements(profile.id);

    return NextResponse.json({ summary: summarizeAgreements(agreements) });
  } catch (error) {
    console.error("Error computing agreement summary:", error);
    return NextResponse.json(
      { error: "Failed to compute agreement summary" },
      { status: 500 }
    );
  }
}
