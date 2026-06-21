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

import { createRequire } from "node:module";
import path from "node:path";
import type { NextConfig } from "next";

const require = createRequire(import.meta.url);

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true }, eslint: { ignoreDuringBuilds: true },
  cacheComponents: true,
  webpack: (config) => {
    // Two parts of this app need different zod majors:
    //   - @hookform/resolvers@5 imports `zod/v4/core` (needs zod 4)
    //   - @circle-fin/bridge-kit pins zod@3 and uses zod-3 APIs (`.returns()`)
    // In the pnpm monorepo @hookform's `zod/v4/core` resolves up to a hoisted
    // zod@3 that lacks that subpath. Alias ONLY the v4 entry to this app's
    // zod@4 — leaving bare `zod` alone so bridge-kit keeps its nested zod@3.
    config.resolve.alias = {
      ...config.resolve.alias,
      "zod/v4/core$": path.dirname(require.resolve("zod/v4/core")),
    };
    return config;
  },
};

export default nextConfig;
