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

"use client";

import { updateProfileAction } from "@/app/actions";
import { FormMessage, type Message } from "@/components/form-message";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ProfileFormProps {
  fullName: string;
  username: string;
  companyName: string;
  email: string;
  message: Message | null;
}

export function ProfileForm({
  fullName,
  username,
  companyName,
  email,
  message,
}: ProfileFormProps) {
  return (
    <form className="flex flex-col gap-4">
      <div className="space-y-2">
        <Label htmlFor="full_name">Display name</Label>
        <Input
          id="full_name"
          name="full_name"
          placeholder="Your name"
          defaultValue={fullName}
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          name="username"
          placeholder="username"
          defaultValue={username}
        />
        <p className="text-sm text-muted-foreground">
          Your unique handle so anyone can pay you.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="company_name">Company (optional)</Label>
        <Input
          id="company_name"
          name="company_name"
          placeholder="Company name"
          defaultValue={companyName}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          value={email}
          disabled
          readOnly
        />
        <p className="text-sm text-muted-foreground">
          Email is managed by your account and cannot be changed here.
        </p>
      </div>

      <SubmitButton
        formAction={updateProfileAction}
        pendingText="Saving..."
        className="w-full mt-2"
      >
        Save changes
      </SubmitButton>

      {message && <FormMessage message={message} />}
    </form>
  );
}
