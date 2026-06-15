/**
 * CodeBlock — renders a labelled, monospace code sample.
 *
 * Server component (no client interactivity needed). The optional `language`
 * label sits in the header so readers can tell `ts`, `tsx`, `bash`, and `http`
 * samples apart at a glance. Whitespace in `children` is preserved verbatim.
 */
import type { ReactNode } from "react";

export interface CodeBlockProps {
  /** The raw source to render. Indentation is preserved as written. */
  children: ReactNode;
  /** Short language tag shown in the header, e.g. "ts", "tsx", "bash". */
  language?: string;
  /** Optional filename / caption shown alongside the language tag. */
  title?: string;
}

export function CodeBlock({ children, language = "ts", title }: CodeBlockProps) {
  return (
    <figure className="code-block">
      <figcaption className="code-block__head">
        {title ? <span className="code-block__title">{title}</span> : null}
        <span className="code-block__lang">{language}</span>
      </figcaption>
      <pre className="code-block__pre">
        <code>{children}</code>
      </pre>
    </figure>
  );
}

export default CodeBlock;
