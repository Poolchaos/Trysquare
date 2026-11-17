/**
 * A protocol's markdown, formatted for reading: lists, tables, code and
 * emphasis, with the app's own colours, since no typography plugin is
 * installed. Raw HTML in the document is not rendered (react-markdown's
 * default), so an imported document cannot put markup on the page, and an
 * image is shown as text, so it cannot make the page ask another host.
 *
 * Nothing in it scrolls on its own: a scroll box a keyboard cannot reach is an
 * axe failure (scrollable-region-focusable), so long code and table cells wrap.
 * A document's headings are drawn as bold lines, not headings, so a rule's
 * sections do not enter the page's outline.
 */

import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const heading: Components["h1"] = ({ children }) => (
  <p className="mt-3 mb-1 font-semibold first:mt-0">{children}</p>
);

const COMPONENTS: Components = {
  h1: heading,
  h2: heading,
  h3: heading,
  h4: heading,
  h5: heading,
  h6: heading,
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-[var(--color-border-strong)] pl-3 text-[var(--color-ink-muted)]">
      {children}
    </blockquote>
  ),
  pre: ({ children }) => (
    <pre className="my-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-xs whitespace-pre-wrap wrap-anywhere">
      {children}
    </pre>
  ),
  code: ({ className, children }) => (
    <code className={`font-[family-name:var(--font-mono)] ${className ?? ""}`}>{children}</code>
  ),
  // Never an <img>: the browser would ask whatever host the document names
  // for it, and a ruleset is a document someone else may have written. Its
  // words and address stay, so the reader knows what stood there and can
  // open it on purpose.
  img: ({ alt, src }) => (
    <span data-testid="document-image">
      Image, not loaded{alt ? `: ${alt}` : ""}
      {typeof src === "string" && src !== "" ? (
        <>
          {" "}
          <code className="font-[family-name:var(--font-mono)]">{src}</code>
        </>
      ) : null}
    </span>
  ),
  table: ({ children }) => (
    <table className="my-2 w-full table-fixed border-collapse text-xs">{children}</table>
  ),
  th: ({ children }) => (
    <th className="border border-[var(--color-border)] px-2 py-1 text-left font-medium wrap-anywhere">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-[var(--color-border)] px-2 py-1 align-top wrap-anywhere">
      {children}
    </td>
  ),
};

export function MarkdownText({ text }: { text: string }) {
  return (
    // Inline code only: code inside a block takes the block's look.
    <div className="text-sm leading-relaxed wrap-anywhere [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-[var(--color-surface)] [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:text-[0.85em]">
      <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {text}
      </Markdown>
    </div>
  );
}
