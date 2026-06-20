/**
 * Per-command execution context.
 *
 * Commander attaches the single global option (`--json`) to the root command.
 * {@link buildContext} reads it and constructs output helpers so each command
 * implementation stays focused on its domain logic. Unlike apps/cli there is no
 * ApiClient — the Lepton CLI is local/on-chain, not HTTP.
 */
import type { Command } from "commander";
import { printJson, printSummary, printTable, type Column } from "./output.js";

/** Global options carried on the root command. */
export interface GlobalOptions {
  /** True when `--json` was supplied. */
  json?: boolean;
}

/** Everything a command handler needs to render results. */
export interface CommandContext {
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
export function globalOptions(command: Command): GlobalOptions {
  let root: Command = command;
  while (root.parent) root = root.parent;
  return root.opts<GlobalOptions>();
}

/** Build a {@link CommandContext} for a command. */
export function buildContext(command: Command): CommandContext {
  const json = globalOptions(command).json === true;

  return {
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
