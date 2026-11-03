/**
 * A protocol's markdown as the ruleset page shows it: formatted, never raw,
 * and never carrying markup the document wrote as HTML.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownText } from "@/components/markdown";

const render = (text: string) => renderToStaticMarkup(createElement(MarkdownText, { text }));

describe("a protocol's markdown on the page", () => {
  it("formats emphasis, code blocks and inline code, and shows none of the markers", () => {
    const html = render(
      [
        "**Rule:** Flag a call that is not awaited.",
        "",
        "```ts",
        "persist(order);",
        "```",
        "",
        "Use `await` before it.",
      ].join("\n"),
    );

    expect(html).toContain("<strong>Rule:</strong>");
    expect(html).toMatch(/<pre[^>]*><code[^>]*class="[^"]*language-ts[^"]*">persist\(order\);/);
    expect(html).toMatch(/<code[^>]*>await<\/code>/);
    expect(html).not.toContain("**");
    expect(html).not.toContain("```");
  });

  it("draws a table, and lists as lists", () => {
    const html = render(
      ["| Pattern | Rule |", "| --- | --- |", "| as any | 3 |", "", "- one", "- two"].join("\n"),
    );

    expect(html).toMatch(/<table[^>]*>.*<th[^>]*>Pattern<\/th>.*<td[^>]*>as any<\/td>/s);
    expect(html).toMatch(/<ul[^>]*>\s*<li>one<\/li>\s*<li>two<\/li>\s*<\/ul>/);
  });

  it("puts a document's headings on bold lines, not into the page's outline", () => {
    const html = render("#### Exceptions\n\nNone.");

    expect(html).not.toMatch(/<h[1-6]/);
    expect(html).toMatch(/<p[^>]*font-semibold[^>]*>Exceptions<\/p>/);
  });

  it("shows HTML the document wrote as text, never as markup", () => {
    const html = render('Before <img src="x" onerror="alert(1)"> after <script>alert(2)</script>');

    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;");
  });
});
