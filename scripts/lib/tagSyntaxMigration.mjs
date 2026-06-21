import fs from "node:fs";
import path from "node:path";

const TAG_NAME_PATTERN = /[\p{L}\p{N}_-]/u;
const CODE_FENCE_PATTERN = /^(```|~~~)/;

function isTagNameChar(char) {
  return Boolean(char) && TAG_NAME_PATTERN.test(char);
}

function normalizeTagName(tagName) {
  return tagName.trim().toLowerCase();
}

function pushUniqueTag(target, seen, tagName) {
  const trimmed = tagName.trim();
  if (!trimmed) {
    return;
  }

  const normalized = normalizeTagName(trimmed);
  if (seen.has(normalized)) {
    return;
  }

  seen.add(normalized);
  target.push(trimmed);
}

export function splitFrontMatter(content) {
  if (!content.startsWith("---")) {
    return { frontMatter: null, body: content };
  }

  const lines = content.split("\n");
  if (lines[0].trim() !== "---") {
    return { frontMatter: null, body: content };
  }

  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() !== "---") {
      continue;
    }

    const frontMatter = lines.slice(1, index).join("\n");
    const body = lines.slice(index + 1).join("\n").replace(/^\n+/, "");
    return { frontMatter, body };
  }

  return { frontMatter: null, body: content };
}

function parseInlineTagNames(body) {
  const tags = [];
  const seen = new Set();
  const explicitTagPattern = /\[\[#([\p{L}\p{N}_-]+)\]\]/gu;

  for (const match of body.matchAll(explicitTagPattern)) {
    pushUniqueTag(tags, seen, match[1]);
  }

  return tags;
}

function transformLegacyInlineTagsInLine(line) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("#")) {
    return { line, convertedCount: 0, discoveredTags: [] };
  }

  let result = "";
  let convertedCount = 0;
  const discoveredTags = [];
  const seenTags = new Set();
  let inInlineCode = false;

  for (let index = 0; index < line.length; index += 1) {
    const current = line[index];

    if (current === "`") {
      inInlineCode = !inInlineCode;
      result += current;
      continue;
    }

    if (inInlineCode || current !== "#") {
      result += current;
      continue;
    }

    const previous = line[index - 1] ?? "";
    const previousPair = line.slice(Math.max(0, index - 2), index);
    const nextStart = index + 1;
    let nextEnd = nextStart;
    while (nextEnd < line.length && isTagNameChar(line[nextEnd])) {
      nextEnd += 1;
    }

    if (nextEnd === nextStart) {
      result += current;
      continue;
    }

    const tagName = line.slice(nextStart, nextEnd);
    const following = line[nextEnd] ?? "";
    const followingPair = line.slice(nextEnd, nextEnd + 2);
    const enclosedByParens = (previous === "(" || previous === "（") && (following === ")" || following === "）");
    const isHeadingAnchor = previous === "{" && following === "}";
    const isEscaped = previous === "\\";
    const isExistingExplicitTag = previousPair === "[[" && followingPair === "]]";
    const isUrlFragment = previous === "/";

    if (isTagNameChar(previous) || enclosedByParens || isHeadingAnchor || isEscaped || isExistingExplicitTag || isUrlFragment) {
      result += current;
      continue;
    }

    result += `[[#${tagName}]]`;
    convertedCount += 1;
    pushUniqueTag(discoveredTags, seenTags, tagName);
    index = nextEnd - 1;
  }

  return { line: result, convertedCount, discoveredTags };
}

export function transformLegacyInlineTagsInBody(body) {
  const lines = body.split("\n");
  const transformedLines = [];
  const discoveredTags = [];
  const seenTags = new Set();
  let convertedCount = 0;
  let inCodeFence = false;

  for (const line of lines) {
    if (CODE_FENCE_PATTERN.test(line.trimStart())) {
      inCodeFence = !inCodeFence;
      transformedLines.push(line);
      continue;
    }

    if (inCodeFence) {
      transformedLines.push(line);
      continue;
    }

    const transformed = transformLegacyInlineTagsInLine(line);
    transformedLines.push(transformed.line);
    convertedCount += transformed.convertedCount;
    for (const tagName of transformed.discoveredTags) {
      pushUniqueTag(discoveredTags, seenTags, tagName);
    }
  }

  return {
    body: transformedLines.join("\n"),
    convertedCount,
    discoveredTags,
  };
}

function stripWrappingQuotes(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseInlineTagList(value) {
  const inner = value.trim().replace(/^\[/, "").replace(/\]$/, "").trim();
  if (!inner) {
    return [];
  }

  return inner
    .split(",")
    .map((item) => stripWrappingQuotes(item))
    .filter(Boolean);
}

function extractExistingFrontMatterTags(frontMatter) {
  if (frontMatter == null) {
    return { tags: [], startLine: -1, endLine: -1 };
  }

  const lines = frontMatter.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^tags:\s*(.*)$/);
    if (!match) {
      continue;
    }

    const rest = match[1].trim();
    if (!rest) {
      const tags = [];
      let endLine = index + 1;
      while (endLine < lines.length) {
        const itemMatch = lines[endLine].match(/^\s+-\s+(.+)$/);
        if (!itemMatch) {
          break;
        }
        tags.push(stripWrappingQuotes(itemMatch[1]));
        endLine += 1;
      }

      return { tags, startLine: index, endLine };
    }

    if (rest === "[]") {
      return { tags: [], startLine: index, endLine: index + 1 };
    }

    if (rest.startsWith("[")) {
      return { tags: parseInlineTagList(rest), startLine: index, endLine: index + 1 };
    }

    return { tags: [stripWrappingQuotes(rest)], startLine: index, endLine: index + 1 };
  }

  return { tags: [], startLine: -1, endLine: -1 };
}

function renderTagsBlock(tags) {
  return ["tags:", ...tags.map((tag) => `  - ${tag}`)];
}

export function mergeFrontMatterTags(frontMatter, tagsToAdd) {
  const { tags: existingTags, startLine, endLine } = extractExistingFrontMatterTags(frontMatter);
  const mergedTags = [];
  const seen = new Set();

  for (const tag of existingTags) {
    pushUniqueTag(mergedTags, seen, tag);
  }
  for (const tag of tagsToAdd) {
    pushUniqueTag(mergedTags, seen, tag);
  }

  const addedCount = mergedTags.length - existingTags.length;
  if (frontMatter == null) {
    if (mergedTags.length === 0) {
      return { frontMatter: null, addedCount: 0, tags: mergedTags };
    }

    return {
      frontMatter: renderTagsBlock(mergedTags).join("\n"),
      addedCount: mergedTags.length,
      tags: mergedTags,
    };
  }

  if (addedCount === 0) {
    return { frontMatter, addedCount: 0, tags: mergedTags };
  }

  const lines = frontMatter.split("\n");
  const replacement = renderTagsBlock(mergedTags);
  if (startLine >= 0) {
    lines.splice(startLine, endLine - startLine, ...replacement);
  } else {
    if (lines.length > 0 && lines[lines.length - 1].trim() !== "") {
      lines.push("");
    }
    lines.push(...replacement);
  }

  return {
    frontMatter: lines.join("\n"),
    addedCount,
    tags: mergedTags,
  };
}

export function renderNote(frontMatter, body) {
  if (frontMatter == null || frontMatter.trim() === "") {
    return body;
  }

  return `---\n${frontMatter}\n---\n\n${body}`;
}

export function migrateNoteContent(content) {
  const { frontMatter, body } = splitFrontMatter(content);
  const transformed = transformLegacyInlineTagsInBody(body);
  const explicitTags = parseInlineTagNames(transformed.body);
  const merged = mergeFrontMatterTags(frontMatter, [...transformed.discoveredTags, ...explicitTags]);
  const nextContent = renderNote(merged.frontMatter, transformed.body);

  return {
    content: nextContent,
    changed: nextContent !== content,
    convertedCount: transformed.convertedCount,
    addedFrontMatterTagCount: merged.addedCount,
    discoveredTags: merged.tags,
  };
}

function walkMarkdownFiles(directory, files) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkMarkdownFiles(absolutePath, files);
      continue;
    }

    if (entry.isFile() && absolutePath.endsWith(".md")) {
      files.push(absolutePath);
    }
  }
}

export function listMarkdownFiles(notesRoot) {
  const files = [];
  walkMarkdownFiles(notesRoot, files);
  return files;
}

export function migrateNotesInDirectory(notesRoot, { apply = false } = {}) {
  const files = listMarkdownFiles(notesRoot);
  const changedFiles = [];
  let convertedReferenceCount = 0;
  let addedFrontMatterTagCount = 0;

  for (const filePath of files) {
    const original = fs.readFileSync(filePath, "utf8");
    const migrated = migrateNoteContent(original);

    if (!migrated.changed) {
      continue;
    }

    if (apply) {
      fs.writeFileSync(filePath, migrated.content, "utf8");
    }

    changedFiles.push({
      path: filePath,
      convertedCount: migrated.convertedCount,
      addedFrontMatterTagCount: migrated.addedFrontMatterTagCount,
      tags: migrated.discoveredTags,
    });
    convertedReferenceCount += migrated.convertedCount;
    addedFrontMatterTagCount += migrated.addedFrontMatterTagCount;
  }

  return {
    scannedFileCount: files.length,
    changedFileCount: changedFiles.length,
    convertedReferenceCount,
    addedFrontMatterTagCount,
    changedFiles,
  };
}