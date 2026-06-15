import { validationError } from "@settlekit/common";
import {
  DISCORD_API_BASE,
  type DiscordApi,
  type DiscordClientOptions,
  type DiscordPartialGuild,
  type DiscordRole,
  type DiscordRoleRef,
} from "./types.js";
import {
  toDiscordError,
  toDiscordTransportError,
  type DiscordErrorBody,
} from "./discord-errors.js";

/** Minimal options needed to issue an authenticated Discord REST request. */
interface RequestContext {
  baseUrl: string;
  botToken: string;
  fetchImpl: typeof fetch;
  auditReason?: string;
}

function buildHeaders(ctx: RequestContext, mutation: boolean): Headers {
  const headers = new Headers({
    Authorization: `Bot ${ctx.botToken}`,
    "Content-Type": "application/json",
    "User-Agent": "SettleKit (https://settlekit.dev, 0.0.0)",
  });
  if (mutation && ctx.auditReason) {
    headers.set("X-Audit-Log-Reason", ctx.auditReason);
  }
  return headers;
}

async function parseErrorBody(response: Response): Promise<DiscordErrorBody | undefined> {
  try {
    const text = await response.text();
    if (!text) return undefined;
    return JSON.parse(text) as DiscordErrorBody;
  } catch {
    return undefined;
  }
}

/** Issue a request expected to return a JSON body. */
async function requestJson<T>(
  ctx: RequestContext,
  path: string,
  context: string,
): Promise<T> {
  let response: Response;
  try {
    response = await ctx.fetchImpl(`${ctx.baseUrl}${path}`, {
      method: "GET",
      headers: buildHeaders(ctx, false),
    });
  } catch (error) {
    throw toDiscordTransportError(error, context);
  }
  if (!response.ok) {
    const body = await parseErrorBody(response);
    throw toDiscordError(response.status, body, context, response.headers.get("retry-after"));
  }
  return (await response.json()) as T;
}

/** Issue a mutating request (PUT/DELETE) that returns no meaningful body. */
async function requestEmpty(
  ctx: RequestContext,
  method: "PUT" | "DELETE",
  path: string,
  context: string,
): Promise<void> {
  let response: Response;
  try {
    response = await ctx.fetchImpl(`${ctx.baseUrl}${path}`, {
      method,
      headers: buildHeaders(ctx, true),
    });
  } catch (error) {
    throw toDiscordTransportError(error, context);
  }
  if (!response.ok) {
    const body = await parseErrorBody(response);
    throw toDiscordError(response.status, body, context, response.headers.get("retry-after"));
  }
}

function encode(segment: string): string {
  return encodeURIComponent(segment);
}

/**
 * Create a real {@link DiscordApi} backed by the Discord REST v10 API. Every
 * method maps directly onto a documented endpoint and uses
 * `Authorization: Bot <token>` for authentication.
 */
export function createDiscordClient(options: DiscordClientOptions): DiscordApi {
  if (!options.botToken || options.botToken.trim().length === 0) {
    throw validationError("createDiscordClient: botToken is required");
  }
  const ctx: RequestContext = {
    baseUrl: options.baseUrl ?? DISCORD_API_BASE,
    botToken: options.botToken,
    fetchImpl: options.fetch ?? globalThis.fetch,
    ...(options.auditReason ? { auditReason: options.auditReason } : {}),
  };

  if (typeof ctx.fetchImpl !== "function") {
    throw validationError("createDiscordClient: no fetch implementation available");
  }

  return {
    async listGuilds(): Promise<DiscordPartialGuild[]> {
      return requestJson<DiscordPartialGuild[]>(
        ctx,
        "/users/@me/guilds",
        "discord.listGuilds",
      );
    },

    async listGuildRoles(guildId: string): Promise<DiscordRole[]> {
      return requestJson<DiscordRole[]>(
        ctx,
        `/guilds/${encode(guildId)}/roles`,
        "discord.listGuildRoles",
      );
    },

    async addRole(ref: DiscordRoleRef): Promise<void> {
      await requestEmpty(
        ctx,
        "PUT",
        `/guilds/${encode(ref.guildId)}/members/${encode(ref.userId)}/roles/${encode(ref.roleId)}`,
        "discord.addRole",
      );
    },

    async removeRole(ref: DiscordRoleRef): Promise<void> {
      await requestEmpty(
        ctx,
        "DELETE",
        `/guilds/${encode(ref.guildId)}/members/${encode(ref.userId)}/roles/${encode(ref.roleId)}`,
        "discord.removeRole",
      );
    },
  };
}
