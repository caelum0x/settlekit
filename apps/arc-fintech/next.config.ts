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

import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true }, eslint: { ignoreDuringBuilds: true },
  cacheComponents: true,
  webpack: (config) => {
    // @hookform/resolvers@5 imports `zod/v4/core`. In the pnpm monorepo, the
    // hoisted `zod` is v3 (other packages use it), so that subpath isn't
    // exported and the build fails. Pin `zod` (and its subpaths) to this app's
    // own zod@4 install so the v4 path resolves.
    config.resolve.alias = {
      ...config.resolve.alias,
      zod: path.resolve(process.cwd(), "node_modules/zod"),
    };
    return config;
  },
};

export default nextConfig;
