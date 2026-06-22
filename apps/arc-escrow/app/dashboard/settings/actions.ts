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

"use server";

import { revalidatePath } from "next/cache";
import { encodedRedirect } from "@/lib/utils/utils";
import { createClient } from "@/lib/utils/supabase/server";

const SETTINGS_PATH = "/dashboard/settings";

export const updateProfileAction = async (formData: FormData) => {
  const fullName = formData.get("full-name")?.toString().trim() ?? "";
  const companyName = formData.get("company-name")?.toString().trim() ?? "";

  if (fullName && (fullName.length < 3 || fullName.length > 255)) {
    return encodedRedirect(
      "error",
      SETTINGS_PATH,
      "Full name must be between 3 and 255 characters"
    );
  }

  if (companyName && (companyName.length < 3 || companyName.length > 255)) {
    return encodedRedirect(
      "error",
      SETTINGS_PATH,
      "Company name must be between 3 and 255 characters"
    );
  }

  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return encodedRedirect("error", "/sign-in", "You must be signed in");
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: fullName || null,
      company_name: companyName || null,
    })
    .eq("auth_user_id", user.id);

  if (error) {
    console.error("Error updating profile:", error.message);
    return encodedRedirect("error", SETTINGS_PATH, "Could not update profile");
  }

  revalidatePath(SETTINGS_PATH);

  return encodedRedirect("success", SETTINGS_PATH, "Profile updated");
};
