import { createElement } from "react";
import type { Key, ReactNode } from "react";

export type ColumnAlign = "left" | "right" | "center";

export interface Column<Row> {
  /** Stable identifier for the column. */
  key: string;
  /** Header label. */
  header: ReactNode;
  /** Cell renderer for a given row. */
  render: (row: Row, index: number) => ReactNode;
  align?: ColumnAlign;
  /** Render header/cells in monospace (hashes, ids, amounts). */
  mono?: boolean;
  /** Explicit column width (CSS value). */
  width?: string;
}

export interface TableProps<Row> {
  columns: ReadonlyArray<Column<Row>>;
  rows: ReadonlyArray<Row>;
  /** Derive a stable React key for each row. */
  rowKey: (row: Row, index: number) => Key;
  /** Message shown when there are no rows. */
  emptyMessage?: ReactNode;
  /** Optional row click handler. */
  onRowClick?: (row: Row, index: number) => void;
  className?: string;
}

const ALIGN_CLASS: Record<ColumnAlign, string> = {
  left: "",
  right: "sk-table-align-right",
  center: "sk-table-align-center",
};

function cellClass<Row>(col: Column<Row>): string | undefined {
  const align = col.align ? ALIGN_CLASS[col.align] : "";
  const mono = col.mono ? "sk-mono" : "";
  const joined = [align, mono].filter((c) => c.length > 0).join(" ");
  return joined.length > 0 ? joined : undefined;
}

export function Table<Row>(props: TableProps<Row>) {
  const { columns, rows, rowKey, emptyMessage = "No data", onRowClick, className } = props;

  const headerCells = columns.map((col) =>
    createElement(
      "th",
      { key: col.key, className: cellClass(col), style: col.width ? { width: col.width } : undefined },
      col.header,
    ),
  );

  const bodyContent =
    rows.length === 0
      ? createElement(
          "tr",
          { key: "__empty" },
          createElement(
            "td",
            { colSpan: columns.length, className: "sk-table-empty" },
            emptyMessage,
          ),
        )
      : rows.map((row, rowIndex) =>
          createElement(
            "tr",
            {
              key: rowKey(row, rowIndex),
              onClick: onRowClick ? () => onRowClick(row, rowIndex) : undefined,
              style: onRowClick ? { cursor: "pointer" } : undefined,
            },
            columns.map((col) =>
              createElement(
                "td",
                { key: col.key, className: cellClass(col) },
                col.render(row, rowIndex),
              ),
            ),
          ),
        );

  const wrapClass = ["sk-table-wrap", className]
    .filter((c): c is string => Boolean(c))
    .join(" ");

  return createElement(
    "div",
    { className: wrapClass },
    createElement(
      "table",
      { className: "sk-table" },
      createElement("thead", null, createElement("tr", null, headerCells)),
      createElement("tbody", null, bodyContent),
    ),
  );
}
