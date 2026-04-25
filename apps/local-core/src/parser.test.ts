import { describe, expect, it } from "vitest";
import { parseMarkdownSections } from "./parser.js";

describe("parseMarkdownSections", () => {
  it("extracts heading-based sections", () => {
    const sections = parseMarkdownSections("# A\ntext\n## B\nmore");
    expect(sections.length).toBe(2);
    expect(sections[0]?.heading).toBe("A");
  });
});