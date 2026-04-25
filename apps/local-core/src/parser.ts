import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export interface ParsedSection {
  sectionKey: string;
  heading: string;
  level: number;
  content: string;
  lineStart: number;
  lineEnd: number;
}

export interface ParsedMemoryDocument {
  sourcePath: string;
  sourceType: "memory.md" | "bootstrap.md" | "other";
  parsedAt: string;
  contentHash: string;
  sections: ParsedSection[];
}

export function detectSourceType(filePath: string): ParsedMemoryDocument["sourceType"] {
  const filename = path.basename(filePath).toLowerCase();
  if (filename === "memory.md") return "memory.md";
  if (filename === "bootstrap.md") return "bootstrap.md";
  return "other";
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function parseMarkdownSections(content: string): ParsedSection[] {
  const lines = content.split(/\r?\n/);
  const sections: ParsedSection[] = [];

  let current: ParsedSection | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      if (current) {
        current.lineEnd = index;
        sections.push(current);
      }

      const marker = headingMatch[1];
      const rawHeading = headingMatch[2];
      if (!marker || !rawHeading) {
        continue;
      }

      const level = marker.length;
      const heading = rawHeading.trim();
      const sectionKey = `${level}:${heading.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

      current = {
        sectionKey,
        heading,
        level,
        content: "",
        lineStart: index + 1,
        lineEnd: index + 1
      };

      continue;
    }

    if (current) {
      current.content = [current.content, line].filter(Boolean).join("\n");
    }
  }

  if (current) {
    current.lineEnd = lines.length;
    sections.push(current);
  }

  if (sections.length === 0) {
    sections.push({
      sectionKey: "0:document-root",
      heading: "Document Root",
      level: 0,
      content,
      lineStart: 1,
      lineEnd: lines.length
    });
  }

  return sections;
}

export async function parseMemoryFile(sourcePath: string): Promise<ParsedMemoryDocument> {
  const content = await readFile(sourcePath, "utf8");
  return {
    sourcePath,
    sourceType: detectSourceType(sourcePath),
    parsedAt: new Date().toISOString(),
    contentHash: hashContent(content),
    sections: parseMarkdownSections(content)
  };
}
