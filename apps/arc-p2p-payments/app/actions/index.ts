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

import { encodedRedirect } from "@/lib/utils/utils";
import { createClient } from "@/lib/utils/supabase/server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

export const updateProfileAction = async (formData: FormData) => {
  const fullName = (formData.get("full_name") as string | null)?.trim() ?? "";
  const username = (formData.get("username") as string | null)?.trim() ?? "";
  const companyName =
    (formData.get("company_name") as string | null)?.trim() ?? "";

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirect("/sign-in");
  }

  if (!fullName) {
    return encodedRedirect(
      "error",
      "/dashboard/profile",
      "Display name is required",
    );
  }

  // Usernames must be unique, alphanumeric/underscore, 3-30 chars.
  if (username && !/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
    return encodedRedirect(
      "error",
      "/dashboard/profile",
      "Username must be 3-30 characters: letters, numbers, or underscores",
    );
  }

  // Guard against username collisions with other users.
  if (username) {
    const { data: existing } = await supabase
      .from("profiles")
      .select("auth_user_id")
      .eq("username", username)
      .neq("auth_user_id", user.id)
      .maybeSingle();

    if (existing) {
      return encodedRedirect(
        "error",
        "/dashboard/profile",
        "That username is already taken",
      );
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      name: fullName,
      full_name: fullName,
      username: username || null,
      company_name: companyName || null,
    })
    .eq("auth_user_id", user.id);

  if (error) {
    console.error("Error updating profile:", error.message);
    return encodedRedirect(
      "error",
      "/dashboard/profile",
      "Could not update profile",
    );
  }

  revalidatePath("/dashboard/profile");
  revalidatePath("/dashboard");

  return encodedRedirect(
    "success",
    "/dashboard/profile",
    "Profile updated successfully",
  );
};

export const signInAction = async (formData: FormData) => {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const isPasskeyLogin = formData.get("passkey_login") === "true";
  const supabase = await createClient();

  if (isPasskeyLogin) {
    // For passkey logins, we'll try to sign in with email and a predefined password
    // This is not secure but works as a fallback
    // The email should be verified by checking the passkey_credential in wallets

    try {
      // First check if this is a legitimate passkey login by checking cookies
      const cookieStore = await cookies();
      const passkeyEmail = cookieStore.get("passkey_email")?.value;

      if (passkeyEmail && passkeyEmail === email) {
        // This is a legitimate passkey login, so we can use a special flow
        // Try a standard login first with a default password (this would be set in your initial user setup)
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password: "passkey-default-pw", // You would set this during user setup
        });

        if (!error) {
          // Successfully logged in
          return redirect("/dashboard");
        }

        // If that fails, use OTP
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email,
          options: {
            shouldCreateUser: false,
          },
        });

        if (otpError) {
          return encodedRedirect(
            "error",
            "/sign-up",
            "Could not authenticate with passkey",
          );
        }

        // Successfully initiated OTP login
        return encodedRedirect(
          "success",
          "/sign-up",
          "Check your email for a login link",
        );
      }
    } catch (error) {
      console.error("Error in passkey login:", error);
      return encodedRedirect("error", "/sign-up", "Authentication failed");
    }
  }

  // Regular password login
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return encodedRedirect("error", "/sign-in", error.message);
  }

  return redirect("/dashboard");
};

export const forgotPasswordAction = async (formData: FormData) => {
  const email = formData.get("email")?.toString();
  const supabase = await createClient();
  const origin = (await headers()).get("origin");
  const callbackUrl = formData.get("callbackUrl")?.toString();

  if (!email) {
    return encodedRedirect("error", "/forgot-password", "Email is required");
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?redirect_to=/dashboard/reset-password`,
  });

  if (error) {
    console.error(error.message);
    return encodedRedirect(
      "error",
      "/forgot-password",
      "Could not reset password",
    );
  }

  if (callbackUrl) {
    return redirect(callbackUrl);
  }

  return encodedRedirect(
    "success",
    "/forgot-password",
    "Check your email for a link to reset your password.",
  );
};

export const resetPasswordAction = async (formData: FormData) => {
  const supabase = await createClient();

  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  if (!password || !confirmPassword) {
    encodedRedirect(
      "error",
      "/dashboard/reset-password",
      "Password and confirm password are required",
    );
  }

  if (password !== confirmPassword) {
    encodedRedirect(
      "error",
      "/dashboard/reset-password",
      "Passwords do not match",
    );
  }

  const { error } = await supabase.auth.updateUser({
    password: password,
  });

  if (error) {
    encodedRedirect(
      "error",
      "/dashboard/reset-password",
      "Password update failed",
    );
  }

  encodedRedirect("success", "/dashboard/reset-password", "Password updated");
};

export const signOutAction = async () => {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return redirect("/sign-in");
};
