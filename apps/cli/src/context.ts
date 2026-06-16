/**
 * Per-command execution context.
 *
 * Commander attaches global options (`--api-url`, `--api-key`, `--json`) to the
 * root command. {@link buildContext} reads those, resolves connection settings,
 * and constructs an {@link ApiClient} together with output helpers so each
 * command implementation stays focused on its endpoint.
 */
import type { Command } from "commander";
import { ApiClient } from "./api.js";
import { requireConfig, resolveConfig, type GlobalOptions } from "./config.js";
import { printJson, printSummary, printTable, type Column } from "./output.js";

/** Everything a command handler needs to talk to the API and print results. */
export interface CommandContext {
  client: ApiClient;
  /** True when `--json` was supplied; commands print raw JSON in that case. */
  json: boolean;
  /** Print a single record (raw JSON or key/value summary). */
  printRecord(record: Record<string, unknown>): void;
  /** Print a list (raw JSON or aligned table). */
  printList<T extends Record<string, unknown>>(
    rows: readonly T[],
    columns: readonly Column<T>[],
  ): void;
}

/** Read global options off the root command, regardless of nesting depth. */
function globalOptions(command: Command): GlobalOptions {
  let root: Command = command;
  while (root.parent) root = root.parent;
  return root.opts<GlobalOptions>();
}

/**
 * Build a {@link CommandContext} for a command. When `requireKey` is true the
 * API key must be present (all networked commands), otherwise it is optional.
 */
export function buildContext(command: Command, requireKey = true): CommandContext {
  const opts = globalOptions(command);
  const config = requireKey ? requireConfig(opts) : resolveConfig(opts);
  const client = new ApiClient(config);
  const json = config.json;

  return {
    client,
    json,
    printRecord(record) {
      if (json) printJson(record);
      else printSummary(record);
    },
    printList(rows, columns) {
      if (json) printJson(rows);
      else printTable(rows, columns);
    },
  };
}
