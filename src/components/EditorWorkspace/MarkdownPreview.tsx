import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import DOMPurify from "dompurify";
import "katex/dist/katex.min.css";
import katex from "katex";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import plaintext from "highlight.js/lib/languages/plaintext";
import properties from "highlight.js/lib/languages/properties";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import MarkdownIt from "markdown-it";
import * as markdownItEmoji from "markdown-it-emoji";
import markdownItFootnote from "markdown-it-footnote";
import texmath from "markdown-it-texmath";
import { api } from "../../api/commands";
import { useOpenNote } from "../../hooks/useOpenNote";
import { useAppStore } from "../../store/useAppStore";
import { useEditorStore } from "../../store/useEditorStore";
import { useContextMenu } from "../ContextMenu/useContextMenu";
import { findInlineTagMatches } from "./inlineTags";
import {
  getTopVisibleSourceLine,
  scrollPreviewToSourceLine,
  type SourceLineSyncSignal,
} from "./sourceLineSync";
import type { SearchNavigationTarget, TagNavigationTarget } from "../../types";
import type { PreviewLinkKind } from "../ContextMenu/contextMenuTypes";
import type { BeautifyReviewState } from "../../store/useEditorStore";

const md = new MarkdownIt({ html: true, linkify: true, typographer: true });
const SOURCE_LINE_TAGS = new Set(["blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "li", "ol", "p", "table", "tr", "ul"]);
type MermaidRuntime = Awaited<typeof import("mermaid")>["default"];
type HighlightLanguage = Parameters<typeof hljs.registerLanguage>[1];

let mermaidInitialized = false;
let mermaidRuntimePromise: Promise<MermaidRuntime> | null = null;

md.use(texmath, {
  engine: katex,
  delimiters: "dollars",
  katexOptions: {
    throwOnError: false,
    strict: "ignore",
  },
});
md.use(markdownItEmoji.full);
md.use(markdownItFootnote);

function registerPreviewLanguage(name: string, definition: HighlightLanguage, aliases: string[] = []) {
  if (!hljs.getLanguage(name)) {
    hljs.registerLanguage(name, definition);
  }

  if (aliases.length > 0) {
    hljs.registerAliases(aliases, { languageName: name });
  }
}

registerPreviewLanguage("bash", bash, ["sh", "shell", "zsh"]);
registerPreviewLanguage("css", css);
registerPreviewLanguage("go", go, ["golang"]);
registerPreviewLanguage("ini", ini, ["toml"]);
registerPreviewLanguage("java", java);
registerPreviewLanguage("javascript", javascript, ["js", "jsx", "mjs", "cjs"]);
registerPreviewLanguage("json", json, ["jsonc"]);
registerPreviewLanguage("markdown", markdown, ["md"]);
registerPreviewLanguage("plaintext", plaintext, ["text", "txt", "plain"]);
registerPreviewLanguage("properties", properties, ["conf", "cfg"]);
registerPreviewLanguage("python", python, ["py"]);
registerPreviewLanguage("rust", rust, ["rs"]);
registerPreviewLanguage("sql", sql);
registerPreviewLanguage("typescript", typescript, ["ts", "tsx"]);
registerPreviewLanguage("xml", xml, ["html", "svg"]);
registerPreviewLanguage("yaml", yaml, ["yml"]);

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const defaultFenceRenderer = md.renderer.rules.fence;

md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const info = token.info.trim().split(/\s+/, 1)[0]?.toLowerCase();
  if (info !== "mermaid") {
    if (info && hljs.getLanguage(info)) {
      const attrs = self.renderAttrs(token);
      const highlighted = hljs.highlight(token.content, {
        language: info,
        ignoreIllegals: true,
      }).value;

      return `<pre${attrs}><code class="hljs language-${escapeHtmlAttr(info)}">${highlighted}</code></pre>`;
    }

    return defaultFenceRenderer
      ? defaultFenceRenderer(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options);
  }

  const attrs = self.renderAttrs(token);
  const content = escapeHtmlAttr(token.content);
  return `<pre class="mermaid-diagram"${attrs}><code class="language-mermaid">${content}</code></pre>`;
};

md.core.ruler.push("source_line_attrs", (state) => {
  state.tokens.forEach((token) => {
    if (!token.map) return;
    if ((token.nesting === 1 && SOURCE_LINE_TAGS.has(token.tag)) || token.type === "fence") {
      token.attrSet("data-source-line", String(token.map[0] + 1));
      token.attrSet("data-source-end-line", String(token.map[1]));
    }
  });
});

const ALLOWED_MARKDOWN_TAGS = [
  "a", "abbr", "blockquote", "br", "code", "del", "details", "em", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "img",
  "kbd", "li", "mark", "ol", "p", "pre", "section", "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "th", "thead", "tr", "ul",
  "math", "annotation", "mrow", "mi", "mn", "mo", "msup", "msub", "msubsup", "mfrac", "mspace", "mtext", "semantics",
];

const ALLOWED_RAW_HTML_TAGS = new Set([
  "abbr", "br", "details", "hr", "img", "kbd", "mark", "p", "span", "sub", "summary", "sup",
]);

const VOID_RAW_HTML_TAGS = new Set(["br", "hr", "img"]);
const RAW_HTML_PAIRED_TAG_PATTERN = /<([A-Za-z][A-Za-z0-9:-]*)(\s[^<>]*)?>([\s\S]*?)<\/\1\s*>/gi;
const RAW_HTML_TAG_PATTERN = /<\/?([A-Za-z][A-Za-z0-9:-]*)(?:\s[^<>]*)?\/?>/gi;
const RAW_HTML_ATTR_PATTERN = /([A-Za-z_:][\w:.-]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;

const ALLOWED_RAW_HTML_ATTRS: Record<string, Set<string>> = {
  abbr: new Set(["title"]),
  details: new Set(["open"]),
  img: new Set(["alt", "src", "title"]),
  p: new Set(["title"]),
  span: new Set(["title"]),
};

const ALLOWED_RAW_HTML_IMAGE_SRC = /^(?:(?:https?):|(?:data:image\/(?:gif|png|jpe?g|webp);base64,)|(?:notes\/)|(?:assets\/)|\/)/i;

const ALLOWED_MARKDOWN_ATTR = [
  "alt", "href", "src", "title", "class", "id", "style", "aria-hidden", "xmlns", "display", "encoding",
  "data-title", "data-source-line", "data-source-end-line", "open",
];
const ALLOWED_MARKDOWN_URI = /^(?:(?:https?):|(?:data:image\/(?:gif|png|jpe?g|webp);base64,)|(?:notes\/)|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i;
const MIN_TABLE_COLUMN_PERCENT = 8;

function sanitizePreviewHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ALLOWED_MARKDOWN_TAGS,
    ALLOWED_ATTR: ALLOWED_MARKDOWN_ATTR,
    ALLOWED_URI_REGEXP: ALLOWED_MARKDOWN_URI,
  });
}

function sanitizeRawHtmlAttributeValue(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const unquotedValue = value.replace(/^(["'])([\s\S]*)\1$/, "$2");
  return escapeHtmlAttr(unquotedValue);
}

function sanitizeAllowedRawHtmlTag(rawTag: string, tagName: string): string {
  const normalizedTagName = tagName.toLowerCase();
  const isClosingTag = /^<\s*\//.test(rawTag);
  if (isClosingTag) {
    return VOID_RAW_HTML_TAGS.has(normalizedTagName) ? "" : `</${normalizedTagName}>`;
  }

  const allowedAttrs = ALLOWED_RAW_HTML_ATTRS[normalizedTagName] ?? new Set<string>();
  const attrs = rawTag.match(/^<\s*[A-Za-z][A-Za-z0-9:-]*(.*?)\/?>\s*$/s)?.[1] ?? "";
  const sanitizedAttrs: string[] = [];

  for (const attrMatch of attrs.matchAll(RAW_HTML_ATTR_PATTERN)) {
    const attrName = attrMatch[1]?.toLowerCase();
    if (!attrName || !allowedAttrs.has(attrName)) {
      continue;
    }

    if (attrName === "open" && normalizedTagName === "details") {
      sanitizedAttrs.push("open");
      continue;
    }

    const attrValue = sanitizeRawHtmlAttributeValue(attrMatch[2]);
    if (attrValue !== null) {
      if (normalizedTagName === "img" && attrName === "src" && !ALLOWED_RAW_HTML_IMAGE_SRC.test(attrValue)) {
        continue;
      }
      sanitizedAttrs.push(`${attrName}="${attrValue}"`);
    }
  }

  const suffix = VOID_RAW_HTML_TAGS.has(normalizedTagName) ? "" : rawTag.trimEnd().endsWith("/>") ? " /" : "";
  const attrText = sanitizedAttrs.length > 0 ? ` ${sanitizedAttrs.join(" ")}` : "";
  return `<${normalizedTagName}${attrText}${suffix}>`;
}

function sanitizeRawHtmlSegment(segment: string): string {
  let sanitized = segment;
  let previous = "";

  while (sanitized !== previous) {
    previous = sanitized;
    sanitized = sanitized.replace(RAW_HTML_PAIRED_TAG_PATTERN, (_match, rawTagName: string, rawAttrs: string | undefined, inner: string) => {
      const tagName = rawTagName.toLowerCase();
      if (!ALLOWED_RAW_HTML_TAGS.has(tagName)) {
        return "";
      }

      const openingTag = sanitizeAllowedRawHtmlTag(`<${tagName}${rawAttrs ?? ""}>`, tagName);
      const closingTag = VOID_RAW_HTML_TAGS.has(tagName) ? "" : `</${tagName}>`;
      return `${openingTag}${sanitizeRawHtmlSegment(inner)}${closingTag}`;
    });
  }

  return sanitized.replace(RAW_HTML_TAG_PATTERN, (match, rawTagName: string) => {
    const tagName = rawTagName.toLowerCase();
    return ALLOWED_RAW_HTML_TAGS.has(tagName)
      ? sanitizeAllowedRawHtmlTag(match, tagName)
      : "";
  });
}

function sanitizeRawHtmlInMarkdownSource(content: string): string {
  const lines = content.split("\n");
  const sanitizedLines: string[] = [];
  let openFence: string | null = null;
  let pendingSegment: string[] = [];

  const flushPendingSegment = () => {
    if (pendingSegment.length === 0) {
      return;
    }

    sanitizedLines.push(...sanitizeRawHtmlSegment(pendingSegment.join("\n")).split("\n"));
    pendingSegment = [];
  };

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    const fenceMarker = fenceMatch?.[1]?.[0] ?? null;
    if (fenceMarker && (!openFence || fenceMarker === openFence)) {
      flushPendingSegment();
      openFence = openFence ? null : fenceMarker;
      sanitizedLines.push(line);
      continue;
    }

    if (openFence) {
      sanitizedLines.push(line);
      continue;
    }

    pendingSegment.push(line);
  }

  flushPendingSegment();
  return sanitizedLines.join("\n");
}

function sanitizeMermaidSvg(svg: string): string {
  const template = document.createElement("template");
  template.innerHTML = svg.trim();

  const rootSvg = template.content.querySelector("svg");
  if (!rootSvg) {
    return "";
  }

  for (const node of Array.from(rootSvg.querySelectorAll("script, iframe, object, embed"))) {
    node.remove();
  }

  for (const element of [rootSvg, ...Array.from(rootSvg.querySelectorAll("*"))]) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      const isEventHandler = name.startsWith("on");
      const isScriptUrl = ["href", "xlink:href", "src"].includes(name) && /^javascript:/i.test(value);

      if (isEventHandler || isScriptUrl) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  return rootSvg.outerHTML;
}

function processWikiLinks(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;

  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let currentNode = walker.nextNode();

  while (currentNode) {
    const parent = currentNode.parentElement;
    if (parent && !parent.closest("a, code, pre, .wiki-link")) {
      textNodes.push(currentNode as Text);
    }
    currentNode = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent ?? "";
    const matches = Array.from(text.matchAll(/\[\[([^\]]+)\]\]/g));
    if (matches.length === 0) {
      continue;
    }

    const fragment = document.createDocumentFragment();
    let cursor = 0;

    for (const match of matches) {
      const fullMatch = match[0] ?? "";
      const title = match[1] ?? "";
      const matchIndex = match.index ?? -1;
      if (matchIndex < 0) {
        continue;
      }

      if (matchIndex > cursor) {
        fragment.appendChild(document.createTextNode(text.slice(cursor, matchIndex)));
      }

      const wikiLink = document.createElement("span");
      wikiLink.className = "wiki-link";
      wikiLink.dataset.title = title;
      wikiLink.textContent = title;
      fragment.appendChild(wikiLink);
      cursor = matchIndex + fullMatch.length;
    }

    if (cursor < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(cursor)));
    }

    textNode.parentNode?.replaceChild(fragment, textNode);
  }

  return template.innerHTML;
}

function extractPreviewBody(content: string): { content: string; lineOffset: number } {
  const normalizedFirstLineEnd = content.indexOf("\n");
  const firstLine = normalizedFirstLineEnd === -1 ? content : content.slice(0, normalizedFirstLineEnd);

  if (firstLine.replace(/\r$/, "") !== "---") {
    return { content, lineOffset: 0 };
  }

  let lineStart = normalizedFirstLineEnd + 1;
  if (normalizedFirstLineEnd === -1) {
    return { content, lineOffset: 0 };
  }

  while (lineStart < content.length) {
    const nextLineEnd = content.indexOf("\n", lineStart);
    const lineEnd = nextLineEnd === -1 ? content.length : nextLineEnd;
    const line = content.slice(lineStart, lineEnd).replace(/\r$/, "");

    if (line === "---") {
      let bodyStart = nextLineEnd === -1 ? content.length : nextLineEnd + 1;
      while (bodyStart < content.length) {
        const nextNewline = content.startsWith("\r\n", bodyStart)
          ? 2
          : content[bodyStart] === "\n"
            ? 1
            : 0;
        if (nextNewline === 0) break;
        bodyStart += nextNewline;
      }

      return {
        content: content.slice(bodyStart),
        lineOffset: content.slice(0, bodyStart).split(/\r?\n/).length - 1,
      };
    }

    if (nextLineEnd === -1) {
      break;
    }
    lineStart = nextLineEnd + 1;
  }

  return { content, lineOffset: 0 };
}

function collectInlineTagLineMatches(content: string): Array<{ line: number; tagName: string; occurrenceOrder: number }> {
  let occurrenceOrder = 0;
  return content.split(/\r?\n/).flatMap((lineText, index) =>
    findInlineTagMatches(lineText).map((match) => {
      occurrenceOrder += 1;
      return {
        line: index + 1,
        tagName: match.name,
        occurrenceOrder,
      };
    }),
  );
}

function translateTagNavigationTarget(
  tagNavigationTarget: TagNavigationTarget | null | undefined,
  lineOffset: number,
): TagNavigationTarget | null {
  if (!tagNavigationTarget) return null;

  const translatedLineStart = tagNavigationTarget.line_start - lineOffset;
  const translatedLineEnd = tagNavigationTarget.line_end - lineOffset;
  if (translatedLineEnd < 1) return null;

  return {
    ...tagNavigationTarget,
    line_start: Math.max(1, translatedLineStart),
    line_end: Math.max(1, translatedLineEnd),
  };
}

function translateSearchNavigationTarget(
  searchNavigationTarget: SearchNavigationTarget | null | undefined,
  lineOffset: number,
): SearchNavigationTarget | null {
  if (!searchNavigationTarget) return null;

  const translatedLineEnd = searchNavigationTarget.line_end - lineOffset;
  if (translatedLineEnd < 1) return null;

  return {
    ...searchNavigationTarget,
    line_start: Math.max(1, searchNavigationTarget.line_start - lineOffset),
    line_end: Math.max(1, translatedLineEnd),
  };
}

function findMatchIndexes(text: string, matchText: string): number[] {
  if (!matchText) {
    return [];
  }

  const haystack = text.toLocaleLowerCase();
  const needle = matchText.toLocaleLowerCase();
  const indexes: number[] = [];
  let searchFrom = 0;
  while (searchFrom <= haystack.length - needle.length) {
    const matchIndex = haystack.indexOf(needle, searchFrom);
    if (matchIndex === -1) {
      break;
    }
    indexes.push(matchIndex);
    searchFrom = matchIndex + needle.length;
  }
  return indexes;
}

interface ActiveSearchNavigationTarget extends SearchNavigationTarget {
  occurrenceInRange: number | null;
}

function getOccurrenceIndexWithinTargetRange(content: string, searchNavigationTarget: SearchNavigationTarget): number | null {
  const matchText = searchNavigationTarget.match_text.trim();
  if (!matchText) {
    return null;
  }

  const lines = content.split(/\r?\n/);
  let globalOccurrenceOrder = 0;
  let rangeOccurrenceOrder = 0;

  for (let lineNumber = 1; lineNumber <= lines.length; lineNumber += 1) {
    const matchIndexes = findMatchIndexes(lines[lineNumber - 1] ?? "", matchText);
    for (const _matchIndex of matchIndexes) {
      globalOccurrenceOrder += 1;
      const isInRange = lineNumber >= searchNavigationTarget.line_start && lineNumber <= searchNavigationTarget.line_end;
      if (isInRange) {
        rangeOccurrenceOrder += 1;
      }
      if (globalOccurrenceOrder === searchNavigationTarget.occurrence_order) {
        return isInRange ? rangeOccurrenceOrder : null;
      }
    }
  }

  return null;
}

function formatColumnWidth(value: number): string {
  return `${Number(value.toFixed(2))}%`;
}

function getEventElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Text) return target.parentElement;
  return null;
}

function writeClipboardText(text: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    return Promise.resolve();
  }

  return navigator.clipboard.writeText(text);
}

function getCodeBlockLanguage(pre: HTMLPreElement): string | null {
  const code = pre.querySelector("code");
  if (!code) {
    return null;
  }

  for (const className of Array.from(code.classList)) {
    if (className.startsWith("language-")) {
      return className.slice("language-".length);
    }
  }

  return null;
}

function getCodeBlockLineCount(codeText: string): number {
  const normalizedText = codeText.endsWith("\n") ? codeText.slice(0, -1) : codeText;
  if (!normalizedText) {
    return 1;
  }

  return normalizedText.split("\n").length;
}

function enhanceCodeBlocks(container: HTMLElement, projectionMode: boolean) {
  const codeBlocks = Array.from(container.querySelectorAll<HTMLPreElement>("pre:not(.mermaid-diagram)"));

  codeBlocks.forEach((pre) => {
    const language = getCodeBlockLanguage(pre);
    const code = pre.querySelector(":scope > code");
    if (!language) {
      return;
    }
    if (!code) {
      return;
    }

    pre.classList.add("markdown-code-block");

    const existingToolbar = pre.querySelector(":scope > .markdown-code-block-toolbar");
    if (existingToolbar) {
      return;
    }

    const toolbar = document.createElement("div");
    toolbar.className = "markdown-code-block-toolbar";

    const languageLabel = document.createElement("span");
    languageLabel.className = "markdown-code-block-language";
    languageLabel.textContent = language;
    toolbar.appendChild(languageLabel);

    if (!projectionMode) {
      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.className = "markdown-code-copy-button";
      copyButton.textContent = "复制";
      copyButton.setAttribute("aria-label", "复制代码");
      toolbar.appendChild(copyButton);
    }

    pre.prepend(toolbar);

    const body = document.createElement("div");
    body.className = "markdown-code-block-body";

    const gutter = document.createElement("div");
    gutter.className = "markdown-code-block-gutter";

    const lineCount = getCodeBlockLineCount(code.textContent ?? "");
    for (let index = 1; index <= lineCount; index += 1) {
      const lineNumber = document.createElement("span");
      lineNumber.className = "markdown-code-block-line-number";
      lineNumber.textContent = String(index);
      gutter.appendChild(lineNumber);
    }

    body.appendChild(gutter);
    body.appendChild(code);
    pre.appendChild(body);
  });
}

function enhanceTaskLists(container: HTMLElement) {
  const listItems = Array.from(container.querySelectorAll<HTMLLIElement>("li"));

  listItems.forEach((item) => {
    const contentRoot = item.firstElementChild?.tagName === "P"
      ? item.firstElementChild
      : item;
    const firstChild = contentRoot.firstChild;

    if (!(firstChild instanceof Text)) {
      return;
    }

    const match = firstChild.textContent?.match(/^(\s*)\[( |x|X)\]\s+/);
    if (!match) {
      return;
    }

    const checked = match[2].toLowerCase() === "x";
    firstChild.textContent = firstChild.textContent?.slice(match[0].length) ?? "";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.disabled = true;
    checkbox.checked = checked;
    checkbox.className = "markdown-task-list-checkbox";
    checkbox.setAttribute("aria-label", checked ? "已完成任务" : "未完成任务");

    item.classList.add("markdown-task-list-item");
    item.parentElement?.classList.add("markdown-task-list");
    contentRoot.insertBefore(checkbox, firstChild);
  });
}

function normalizeInternalNotePath(href: string): string | undefined {
  const trimmedHref = href.trim();
  if (!trimmedHref || /^https?:\/\//i.test(trimmedHref)) {
    return undefined;
  }

  const rawPath = trimmedHref.replace(/^\/+/, "").split(/[?#]/, 1)[0] ?? "";
  if (!rawPath) {
    return undefined;
  }

  let normalizedPath = rawPath;
  try {
    normalizedPath = decodeURIComponent(rawPath);
  } catch {
    normalizedPath = rawPath;
  }

  if (!/^notes\/.+\.md$/i.test(normalizedPath)) {
    return undefined;
  }

  return normalizedPath;
}

function normalizeKbRelativePath(path: string): string | null {
  const normalized = path.replace(/\\/g, "/").trim();
  if (!normalized) {
    return null;
  }

  const stack: string[] = [];
  for (const segment of normalized.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (stack.length === 0) {
        return null;
      }
      stack.pop();
      continue;
    }
    stack.push(segment);
  }

  return stack.join("/");
}

function resolveMarkdownImageToKbRelativePath(rawSrc: string, notePath: string | undefined): string | null {
  const src = rawSrc.trim();
  if (!src || /^(?:[a-z][a-z+.-]*:|#)/i.test(src)) {
    return null;
  }

  const bareSrc = src.split(/[?#]/, 1)[0] ?? "";
  if (!bareSrc) {
    return null;
  }

  if (bareSrc.startsWith("/")) {
    return normalizeKbRelativePath(bareSrc.replace(/^\/+/, ""));
  }

  if (bareSrc.startsWith("notes/") || bareSrc.startsWith("assets/")) {
    return normalizeKbRelativePath(bareSrc);
  }

  if (!notePath) {
    return null;
  }

  const noteDir = notePath.split("/").slice(0, -1).join("/");
  const combined = noteDir ? `${noteDir}/${bareSrc}` : bareSrc;
  return normalizeKbRelativePath(combined);
}

function rewriteLocalImageSourcesForTauri(
  container: HTMLElement,
  kbRootPath: string | undefined,
  notePath: string | undefined,
) {
  if (!kbRootPath) {
    return;
  }

  const normalizedRoot = kbRootPath.replace(/\/$/, "");
  const images = Array.from(container.querySelectorAll<HTMLImageElement>("img[src]"));
  for (const image of images) {
    const originalSrc = image.getAttribute("src") ?? "";
    const relativePath = resolveMarkdownImageToKbRelativePath(originalSrc, notePath);
    if (!relativePath) {
      continue;
    }

    const absolutePath = `${normalizedRoot}/${relativePath}`;
    image.setAttribute("src", convertFileSrc(absolutePath));
  }
}

function isRemoteImageSource(src: string): boolean {
  return /^https?:\/\//i.test(src.trim());
}

async function readBlobAsDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  const mediaType = blob.type || "application/octet-stream";
  return `data:${mediaType};base64,${btoa(binary)}`;
}

async function rewriteRemoteImageSourcesForPreview(container: HTMLElement) {
  const images = Array.from(container.querySelectorAll<HTMLImageElement>("img[src]"));
  await Promise.all(images.map(async (image) => {
    const originalSrc = image.getAttribute("src") ?? "";
    if (!isRemoteImageSource(originalSrc)) {
      return;
    }

    try {
      const response = await fetch(originalSrc);
      if (!response.ok) {
        return;
      }

      const blob = await response.blob();
      const dataUrl = await readBlobAsDataUrl(blob);
      image.setAttribute("src", dataUrl);
    } catch {
      // Keep the original remote URL when proxying fails.
    }
  }));
}

function decodeHrefFragment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeHeadingText(text: string): string {
  return text.trim().toLowerCase();
}

function stripLeadingHeadingNumber(text: string): string {
  return text.replace(/^\d+(?:\.\d+)*[.)]?\s+/, "").trim();
}

function parseHeadingText(rawHeadingText: string): { headingText: string; explicitId: string | null } {
  const explicitIdMatch = rawHeadingText.match(/^(.*?)(?:\s*\{#([A-Za-z0-9_-]+)\})\s*$/);
  if (!explicitIdMatch) {
    return {
      headingText: rawHeadingText.trim(),
      explicitId: null,
    };
  }

  return {
    headingText: (explicitIdMatch[1] ?? "").trim(),
    explicitId: explicitIdMatch[2] ?? null,
  };
}

function slugifyHeadingText(text: string): string {
  let slug = "";
  let lastWasDash = false;

  for (const originalChar of text.trim()) {
    const char = originalChar.toLowerCase();
    const isChinese = char >= "\u4e00" && char <= "\u9fff";
    if (/\p{Letter}|\p{Number}/u.test(char) || isChinese) {
      slug += char;
      lastWasDash = false;
      continue;
    }

    if ((/\s/.test(char) || char === "-" || char === "_") && !lastWasDash && slug) {
      slug += "-";
      lastWasDash = true;
    }
  }

  return slug.replace(/^-+|-+$/g, "");
}

function extractHeadingText(line: string): string | null {
  const trimmed = line.trimStart();
  const atxMatch = trimmed.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
  if (atxMatch?.[1]) {
    return atxMatch[1].trim();
  }

  return null;
}

function findHeadingLineNumber(content: string, anchor: string): number | null {
  const trimmedAnchor = decodeHrefFragment(anchor).trim();
  if (!trimmedAnchor) {
    return null;
  }

  const normalizedAnchor = normalizeHeadingText(trimmedAnchor);
  const slugAnchor = slugifyHeadingText(trimmedAnchor);
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const atxHeading = extractHeadingText(lines[index]);
    if (atxHeading) {
      const { headingText, explicitId } = parseHeadingText(atxHeading);
      const headingCandidates = [headingText, stripLeadingHeadingNumber(headingText)].filter(Boolean);

      if (
        explicitId
        && (normalizeHeadingText(explicitId) === normalizedAnchor || (slugAnchor && slugifyHeadingText(explicitId) === slugAnchor))
      ) {
        return index + 1;
      }

      if (headingCandidates.some((candidate) => {
        const normalizedHeading = normalizeHeadingText(candidate);
        const slugHeading = slugifyHeadingText(candidate);
        return normalizedHeading === normalizedAnchor || (slugAnchor && slugHeading === slugAnchor);
      })) {
        return index + 1;
      }
    }

    const currentLine = lines[index]?.trim();
    const nextLine = lines[index + 1]?.trim();
    const isSetext = Boolean(
      currentLine
      && nextLine
      && (/^=+$/.test(nextLine) || /^-+$/.test(nextLine)),
    );
    if (isSetext) {
      const { headingText, explicitId } = parseHeadingText(currentLine);
      const headingCandidates = [headingText, stripLeadingHeadingNumber(headingText)].filter(Boolean);

      if (
        explicitId
        && (normalizeHeadingText(explicitId) === normalizedAnchor || (slugAnchor && slugifyHeadingText(explicitId) === slugAnchor))
      ) {
        return index + 1;
      }

      if (headingCandidates.some((candidate) => {
        const normalizedHeading = normalizeHeadingText(candidate);
        const slugHeading = slugifyHeadingText(candidate);
        return normalizedHeading === normalizedAnchor || (slugAnchor && slugHeading === slugAnchor);
      })) {
        return index + 1;
      }
    }
  }

  return null;
}

function extractHrefAnchor(href: string): string | undefined {
  const hashIndex = href.indexOf("#");
  if (hashIndex === -1) {
    return undefined;
  }

  const anchor = href.slice(hashIndex + 1).trim();
  return anchor ? decodeHrefFragment(anchor) : undefined;
}

function getPreviewLinkTarget(element: Element): {
  linkType: PreviewLinkKind;
  href: string;
  notePath?: string;
  wikiTitle?: string;
} | null {
  const wikiLink = element.closest(".wiki-link") as HTMLElement | null;
  if (wikiLink) {
    const title = wikiLink.dataset.title?.trim();
    if (!title) {
      return null;
    }

    return {
      linkType: "wiki",
      href: `[[${title}]]`,
      wikiTitle: title,
    };
  }

  const anchor = element.closest("a[href]") as HTMLAnchorElement | null;
  if (!anchor) {
    return null;
  }

  const href = anchor.getAttribute("href")?.trim() ?? "";
  if (!href) {
    return null;
  }

  if (/^https?:\/\//i.test(href)) {
    return {
      linkType: "external",
      href,
    };
  }

  return {
    linkType: "internal",
    href,
    notePath: normalizeInternalNotePath(href),
  };
}

async function resolveWikiNotePath(title: string): Promise<string | undefined> {
  try {
    const note = await api.getNoteByTitle(title);
    return note?.path;
  } catch (error) {
    console.error("Failed to resolve wiki link target:", error);
    return undefined;
  }
}

async function resolvePreviewLinkTarget(element: Element): Promise<{
  linkType: PreviewLinkKind;
  href: string;
  notePath?: string;
  wikiTitle?: string;
} | null> {
  const linkTarget = getPreviewLinkTarget(element);
  if (!linkTarget) {
    return null;
  }

  if (linkTarget.linkType !== "wiki" || !linkTarget.wikiTitle) {
    return linkTarget;
  }

  return {
    ...linkTarget,
    notePath: await resolveWikiNotePath(linkTarget.wikiTitle),
  };
}

function shouldSkipInlineTagEnhancement(node: Node | null): boolean {
  if (!(node instanceof HTMLElement)) return false;
  return Boolean(node.closest("a, code, pre, .inline-tag-chip"));
}

function createInlineTagChip(tagName: string) {
  const chip = document.createElement("span");
  chip.className = "inline-tag-chip";
  chip.dataset.tagName = tagName;

  const label = document.createElement("span");
  label.className = "inline-tag-chip-label";
  label.textContent = tagName;

  chip.appendChild(label);
  return chip;
}

function enhanceInlineTags(
  container: HTMLElement,
  inlineTagLineMatches: Array<{ line: number; tagName: string; occurrenceOrder: number }>,
  tagNavigationTarget: TagNavigationTarget | null,
) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let inlineTagMatchIndex = 0;

  let currentNode = walker.nextNode();
  while (currentNode) {
    if (!shouldSkipInlineTagEnhancement(currentNode.parentNode) && currentNode.textContent?.includes("#")) {
      textNodes.push(currentNode as Text);
    }
    currentNode = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent ?? "";
    const matches = findInlineTagMatches(text);
    if (matches.length === 0) continue;

    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of matches) {
      if (match.start > cursor) {
        fragment.appendChild(document.createTextNode(text.slice(cursor, match.start)));
      }
      const chip = createInlineTagChip(match.name);
      const sourceMatch = inlineTagLineMatches[inlineTagMatchIndex] ?? null;
      if (sourceMatch) {
        chip.dataset.sourceLine = String(sourceMatch.line);
        chip.dataset.occurrenceOrder = String(sourceMatch.occurrenceOrder);
        inlineTagMatchIndex += 1;
        if (
          tagNavigationTarget
          && sourceMatch.line === tagNavigationTarget.line_start
          && sourceMatch.tagName === tagNavigationTarget.tag_name
          && sourceMatch.occurrenceOrder === tagNavigationTarget.occurrence_order
        ) {
          chip.classList.add("inline-tag-navigation-target");
        }
      }
      fragment.appendChild(chip);
      cursor = match.end;
    }
    if (cursor < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(cursor)));
    }

    textNode.parentNode?.replaceChild(fragment, textNode);
  }
}

function shouldSkipSearchEnhancement(node: Node | null): boolean {
  if (!(node instanceof HTMLElement)) return false;
  return Boolean(node.closest("a, .inline-tag-chip, .search-navigation-target"));
}

function wrapNthSearchMatchInBlocks(blocks: HTMLElement[], matchText: string, targetOccurrence: number): boolean {
  let occurrenceOrder = 0;

  for (const block of blocks) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let currentNode = walker.nextNode();

    while (currentNode) {
      if (
        !shouldSkipSearchEnhancement(currentNode.parentNode)
        && findMatchIndexes(currentNode.textContent ?? "", matchText).length > 0
      ) {
        textNodes.push(currentNode as Text);
      }
      currentNode = walker.nextNode();
    }

    for (const textNode of textNodes) {
      const text = textNode.textContent ?? "";
      const matchIndexes = findMatchIndexes(text, matchText);
      for (const matchIndex of matchIndexes) {
        occurrenceOrder += 1;
        if (occurrenceOrder !== targetOccurrence) {
          continue;
        }

        const fragment = document.createDocumentFragment();
        if (matchIndex > 0) {
          fragment.appendChild(document.createTextNode(text.slice(0, matchIndex)));
        }

        const highlighted = document.createElement("mark");
        highlighted.className = "search-navigation-target";
        highlighted.textContent = text.slice(matchIndex, matchIndex + matchText.length);
        fragment.appendChild(highlighted);

        if (matchIndex + matchText.length < text.length) {
          fragment.appendChild(document.createTextNode(text.slice(matchIndex + matchText.length)));
        }

        textNode.parentNode?.replaceChild(fragment, textNode);
        return true;
      }
    }
  }

  return false;
}

function enhanceSearchNavigationTarget(
  container: HTMLElement,
  searchNavigationTarget: ActiveSearchNavigationTarget | null,
) {
  if (!searchNavigationTarget) return;

  const targetBlocks = Array.from(container.querySelectorAll<HTMLElement>("[data-source-line]"))
    .filter((node) => {
      const sourceLine = Number(node.dataset.sourceLine);
      const sourceEndLine = Number(node.dataset.sourceEndLine || node.dataset.sourceLine);
      return sourceLine <= searchNavigationTarget.line_end && sourceEndLine >= searchNavigationTarget.line_start;
    });

  if (targetBlocks.length === 0) return;

  const matchText = searchNavigationTarget.match_text.trim();
  let hasHighlightedMatch = false;
  if (matchText) {
    const targetOccurrence = searchNavigationTarget.occurrenceInRange ?? 1;
    if (wrapNthSearchMatchInBlocks(targetBlocks, matchText, targetOccurrence)) {
      hasHighlightedMatch = true;
    }
  }

  if (!hasHighlightedMatch) {
    targetBlocks[0]?.classList.add("search-navigation-target");
  }
}

function enhanceResizableTables(container: HTMLElement) {
  const tables = Array.from(container.querySelectorAll("table"));

  tables.forEach((table) => {
    const firstRow = table.querySelector("tr");
    if (!firstRow) return;

    const cells = Array.from(firstRow.children).filter(
      (cell): cell is HTMLTableCellElement => cell instanceof HTMLTableCellElement,
    );
    if (cells.length < 2) return;

    table.classList.add("markdown-table-resizable");

    const colgroup = document.createElement("colgroup");
    const initialWidth = 100 / cells.length;
    cells.forEach(() => {
      const col = document.createElement("col");
      col.style.width = formatColumnWidth(initialWidth);
      colgroup.appendChild(col);
    });
    table.insertBefore(colgroup, table.firstChild);

    cells.slice(0, -1).forEach((cell, index) => {
      cell.classList.add("markdown-table-resizable-cell");
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "markdown-table-resize-handle";
      handle.dataset.columnIndex = String(index);
      handle.setAttribute("aria-label", `调整第 ${index + 1} 列宽度`);
      cell.appendChild(handle);
    });
  });
}

function ensureMermaidSvgMeasurementSupport() {
  if (typeof SVGElement === "undefined") {
    return;
  }

  const svgPrototype = SVGElement.prototype as SVGElement & {
    getBBox?: () => { x: number; y: number; width: number; height: number };
  };

  if (!svgPrototype.getBBox) {
    svgPrototype.getBBox = function getBBox() {
      const textLength = this.textContent?.trim().length ?? 0;
      return {
        x: 0,
        y: 0,
        width: Math.max(1, textLength * 8),
        height: 16,
      };
    };
  }
}

function loadMermaidRuntime(): Promise<MermaidRuntime> {
  if (!mermaidRuntimePromise) {
    mermaidRuntimePromise = import("mermaid")
      .then((module) => module.default)
      .catch((error) => {
        mermaidRuntimePromise = null;
        throw error;
      });
  }

  return mermaidRuntimePromise;
}

async function enhanceMermaidDiagrams(container: HTMLElement) {
  const diagrams = Array.from(container.querySelectorAll<HTMLElement>("pre.mermaid-diagram"));
  if (diagrams.length === 0) {
    return;
  }

  const mermaid = await loadMermaidRuntime();

  if (!mermaidInitialized) {
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
    mermaidInitialized = true;
  }

  ensureMermaidSvgMeasurementSupport();
  await Promise.all(diagrams.map(async (diagram, index) => {
    const code = diagram.querySelector("code");
    const definition = code?.textContent?.trim();
    if (!definition) {
      return;
    }

    const renderId = `markdown-preview-mermaid-${index}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const { svg } = await mermaid.render(renderId, definition);
      diagram.innerHTML = sanitizeMermaidSvg(svg);
    } catch (error) {
      const errorMessage = document.createElement("div");
      errorMessage.className = "mermaid-diagram-error";
      errorMessage.textContent = "Mermaid 渲染失败";
      diagram.prepend(errorMessage);
      console.error("Failed to render mermaid diagram:", error);
    }
  }));
}

function readColumnWidths(cols: HTMLTableColElement[]): number[] {
  const fallbackWidth = 100 / cols.length;
  return cols.map((col) => {
    const value = Number.parseFloat(col.style.width);
    return Number.isFinite(value) ? value : fallbackWidth;
  });
}

interface Props {
  content: string;
  beautifyReview?: BeautifyReviewState | null;
  projectionMode?: boolean;
  searchNavigationTarget?: SearchNavigationTarget | null;
  tagNavigationTarget?: TagNavigationTarget | null;
  sourceLineSyncSignal?: SourceLineSyncSignal | null;
  onTopVisibleLineChange?: (line: number) => void;
}

function escapeDiffHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type BeautifyDiffOp =
  | { kind: "same"; value: string; beforeLine: number; afterLine: number }
  | { kind: "removed"; value: string; beforeLine: number }
  | { kind: "added"; value: string; afterLine: number };

const BEAUTIFY_DIFF_CONTEXT_LINES = 2;

function computeBeautifyLineDiff(originalLines: string[], beautifiedLines: string[]): BeautifyDiffOp[] {
  const m = originalLines.length;
  const n = beautifiedLines.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (originalLines[i] === beautifiedLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const ops: BeautifyDiffOp[] = [];
  let i = 0;
  let j = 0;

  while (i < m && j < n) {
    if (originalLines[i] === beautifiedLines[j]) {
      ops.push({ kind: "same", value: originalLines[i], beforeLine: i + 1, afterLine: j + 1 });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: "removed", value: originalLines[i], beforeLine: i + 1 });
      i += 1;
    } else {
      ops.push({ kind: "added", value: beautifiedLines[j], afterLine: j + 1 });
      j += 1;
    }
  }

  while (i < m) {
    ops.push({ kind: "removed", value: originalLines[i], beforeLine: i + 1 });
    i += 1;
  }

  while (j < n) {
    ops.push({ kind: "added", value: beautifiedLines[j], afterLine: j + 1 });
    j += 1;
  }

  return ops;
}

function renderBeautifyDiffHtml(review: BeautifyReviewState): string {
  const originalLines = review.originalContent.split(/\r?\n/);
  const beautifiedLines = review.beautifiedContent.split(/\r?\n/);
  const operations = computeBeautifyLineDiff(originalLines, beautifiedLines);
  const rows: string[] = [];
  const omittedRow = (count: number, anchorLine: number) =>
    `<div class="beautify-diff-row beautify-diff-row--omitted"><div class="beautify-diff-gutter">${anchorLine}</div><pre class="beautify-diff-code">@@ 省略前文 ${count} 行未改内容 @@</pre></div>`;

  for (let index = 0; index < operations.length; index += 1) {
    const op = operations[index];

    if (op.kind !== "same") {
      if (op.kind === "removed") {
        rows.push(
          `<div class="beautify-diff-row beautify-diff-row--removed"><div class="beautify-diff-gutter">${op.beforeLine}</div><pre class="beautify-diff-code">- ${escapeDiffHtml(op.value)}</pre></div>`,
        );
      } else {
        rows.push(
          `<div class="beautify-diff-row beautify-diff-row--added"><div class="beautify-diff-gutter">${op.afterLine}</div><pre class="beautify-diff-code">+ ${escapeDiffHtml(op.value)}</pre></div>`,
        );
      }
      continue;
    }

    let runEnd = index;
    while (runEnd + 1 < operations.length && operations[runEnd + 1]?.kind === "same") {
      runEnd += 1;
    }

    const runLength = runEnd - index + 1;
    const previousOp = index > 0 ? operations[index - 1] : null;
    const nextOp = runEnd + 1 < operations.length ? operations[runEnd + 1] : null;
    const hasChangeBefore = previousOp !== null && previousOp.kind !== "same";
    const hasChangeAfter = nextOp !== null && nextOp.kind !== "same";

    if (!hasChangeBefore && !hasChangeAfter) {
      for (let cursor = index; cursor <= runEnd; cursor += 1) {
        const sameOp = operations[cursor] as Extract<BeautifyDiffOp, { kind: "same" }>;
        rows.push(
          `<div class="beautify-diff-row beautify-diff-row--same"><div class="beautify-diff-gutter">${sameOp.afterLine}</div><pre class="beautify-diff-code">${escapeDiffHtml(sameOp.value)}</pre></div>`,
        );
      }
      index = runEnd;
      continue;
    }

    if (runLength <= BEAUTIFY_DIFF_CONTEXT_LINES * 2 + 1) {
      for (let cursor = index; cursor <= runEnd; cursor += 1) {
        const sameOp = operations[cursor] as Extract<BeautifyDiffOp, { kind: "same" }>;
        rows.push(
          `<div class="beautify-diff-row beautify-diff-row--same"><div class="beautify-diff-gutter">${sameOp.afterLine}</div><pre class="beautify-diff-code">${escapeDiffHtml(sameOp.value)}</pre></div>`,
        );
      }
      index = runEnd;
      continue;
    }

    const leadingVisibleCount = hasChangeBefore ? BEAUTIFY_DIFF_CONTEXT_LINES : 0;
    const trailingVisibleCount = hasChangeAfter ? BEAUTIFY_DIFF_CONTEXT_LINES : 0;
    const omittedCount = runLength - leadingVisibleCount - trailingVisibleCount;

    for (let cursor = index; cursor < index + leadingVisibleCount; cursor += 1) {
      const sameOp = operations[cursor] as Extract<BeautifyDiffOp, { kind: "same" }>;
      rows.push(
        `<div class="beautify-diff-row beautify-diff-row--same"><div class="beautify-diff-gutter">${sameOp.afterLine}</div><pre class="beautify-diff-code">${escapeDiffHtml(sameOp.value)}</pre></div>`,
      );
    }

    if (omittedCount > 0) {
      const anchorLine = (operations[index + leadingVisibleCount] as Extract<BeautifyDiffOp, { kind: "same" }>).afterLine;
      rows.push(omittedRow(omittedCount, anchorLine));
    }

    for (let cursor = runEnd - trailingVisibleCount + 1; cursor <= runEnd; cursor += 1) {
      const sameOp = operations[cursor] as Extract<BeautifyDiffOp, { kind: "same" }>;
      rows.push(
        `<div class="beautify-diff-row beautify-diff-row--same"><div class="beautify-diff-gutter">${sameOp.afterLine}</div><pre class="beautify-diff-code">${escapeDiffHtml(sameOp.value)}</pre></div>`,
      );
    }

    index = runEnd;
  }

  return `<section class="beautify-diff" aria-label="Markdown beautify diff">${rows.join("")}</section>`;
}

export function MarkdownPreview({
  content,
  beautifyReview,
  projectionMode = false,
  searchNavigationTarget,
  tagNavigationTarget,
  sourceLineSyncSignal,
  onTopVisibleLineChange,
}: Props) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isProgrammaticScroll = useRef(false);
  const programmaticScrollTimerRef = useRef<number | null>(null);
  const navigationHighlightTimerRef = useRef<number | null>(null);
  const copyNoticeTimerRef = useRef<number | null>(null);
  const previewContextMenuRequestRef = useRef(0);
  const previewLineOffsetRef = useRef(0);
  const [activePreviewNavigationTarget, setActivePreviewNavigationTarget] = useState<TagNavigationTarget | null>(null);
  const [activeSearchNavigationTarget, setActiveSearchNavigationTarget] = useState<ActiveSearchNavigationTarget | null>(null);
  const [isFrontMatterNavigationActive, setIsFrontMatterNavigationActive] = useState(false);
  const openContextMenu = useContextMenu().openContextMenu;
  const { openNote, beginOpenNote, isOpenNoteRequestCurrent } = useOpenNote();
  const setEditorMode = useEditorStore((s) => s.setEditorMode);
  const setSearchNavigationTarget = useEditorStore((s) => s.setSearchNavigationTarget);
  const setStatusNotice = useEditorStore((s) => s.setStatusNotice);
  const currentNote = useEditorStore((s) => s.currentNote);
  const currentEditorContent = useEditorStore((s) => s.content);
  const selectedNodePath = useAppStore((s) => s.selectedNodePath);
  const setRightSidebarVisible = useAppStore((s) => s.setRightSidebarVisible);
  const kbRootPath = useAppStore((s) => s.kb?.root_path);

  const showCopiedNotice = () => {
    setStatusNotice("已拷贝");
    if (copyNoticeTimerRef.current !== null) {
      window.clearTimeout(copyNoticeTimerRef.current);
    }
    copyNoticeTimerRef.current = window.setTimeout(() => {
      setStatusNotice(null);
      copyNoticeTimerRef.current = null;
    }, 1600);
  };

  const openWikiNote = async (title: string, requestId = beginOpenNote()) => {
    try {
      const note = await api.getNoteByTitle(title);
      if (note && isOpenNoteRequestCurrent(requestId)) {
        await openNote(note.path, requestId);
      }
      return note?.path;
    } catch (error) {
      if (!isOpenNoteRequestCurrent(requestId)) {
        return undefined;
      }
      console.error("Failed to open wiki link:", error);
      return undefined;
    }
  };

  const openPreviewLinkTarget = async (linkTarget: {
    linkType: PreviewLinkKind;
    href: string;
    notePath?: string;
    wikiTitle?: string;
  }) => {
    if (linkTarget.linkType === "external") {
      await openUrl(linkTarget.href);
      return;
    }

    const anchor = extractHrefAnchor(linkTarget.href);

    if (linkTarget.notePath) {
      await openNote(linkTarget.notePath, beginOpenNote());
      if (anchor) {
        try {
          const detail = await api.getNoteByPath(linkTarget.notePath);
          const lineNumber = findHeadingLineNumber(detail.content, anchor);
          if (lineNumber) {
            setSearchNavigationTarget({
              note_id: detail.note.id,
              note_path: detail.note.path,
              note_title: detail.note.title,
              line_start: lineNumber,
              line_end: lineNumber,
              occurrence_order: 1,
              match_text: anchor,
              source: "body",
              context_snippet: anchor,
              revision: Date.now(),
            });
          }
        } catch (error) {
          console.error("Failed to resolve preview anchor target:", error);
        }
      }
      return;
    }

    if (linkTarget.linkType === "internal" && anchor) {
      const currentPath = currentNote?.path ?? selectedNodePath ?? undefined;
      const lineNumber = findHeadingLineNumber(currentEditorContent, anchor);
      if (currentPath && lineNumber) {
        setSearchNavigationTarget({
          note_id: currentNote?.id ?? "",
          note_path: currentPath,
          note_title: currentNote?.title ?? "",
          line_start: lineNumber,
          line_end: lineNumber,
          occurrence_order: 1,
          match_text: anchor,
          source: "body",
          context_snippet: anchor,
          revision: Date.now(),
        });
      }
      return;
    }

    if (linkTarget.linkType === "wiki" && linkTarget.wikiTitle) {
      await openWikiNote(linkTarget.wikiTitle);
    }
  };

  const releaseProgrammaticScrollSoon = () => {
    if (programmaticScrollTimerRef.current !== null) {
      window.clearTimeout(programmaticScrollTimerRef.current);
    }
    programmaticScrollTimerRef.current = window.setTimeout(() => {
      isProgrammaticScroll.current = false;
      programmaticScrollTimerRef.current = null;
    }, 120);
  };

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    if (beautifyReview?.diffMode) {
      previewLineOffsetRef.current = 0;
      containerRef.current.innerHTML = renderBeautifyDiffHtml(beautifyReview);
      containerRef.current.classList.remove("markdown-preview-front-matter-navigation-target");
      return () => {
        cancelled = true;
      };
    }

    const previewBody = extractPreviewBody(content);
    previewLineOffsetRef.current = previewBody.lineOffset;
    const rawHtml = md.render(sanitizeRawHtmlInMarkdownSource(previewBody.content));
    const processedHtml = processWikiLinks(rawHtml);
    containerRef.current.innerHTML = sanitizePreviewHtml(processedHtml);
    containerRef.current.classList.toggle(
      "markdown-preview-front-matter-navigation-target",
      isFrontMatterNavigationActive,
    );
    enhanceTaskLists(containerRef.current);
    enhanceInlineTags(
      containerRef.current,
      collectInlineTagLineMatches(previewBody.content),
      activePreviewNavigationTarget,
    );
    enhanceSearchNavigationTarget(containerRef.current, activeSearchNavigationTarget);
    if (!projectionMode) {
      enhanceResizableTables(containerRef.current);
    }
    enhanceCodeBlocks(containerRef.current, projectionMode);

    void enhanceMermaidDiagrams(containerRef.current).catch((error) => {
      if (!cancelled) {
        console.error("Failed to render mermaid preview:", error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [beautifyReview, content, activePreviewNavigationTarget, activeSearchNavigationTarget, isFrontMatterNavigationActive, projectionMode]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    rewriteLocalImageSourcesForTauri(containerRef.current, kbRootPath, currentNote?.path ?? undefined);
  }, [beautifyReview, content, kbRootPath, currentNote?.path]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    void rewriteRemoteImageSourcesForPreview(containerRef.current);
  }, [beautifyReview, content]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    const contentContainer = containerRef.current;
    if (!scrollContainer || !contentContainer) return;

    if (navigationHighlightTimerRef.current !== null) {
      window.clearTimeout(navigationHighlightTimerRef.current);
      navigationHighlightTimerRef.current = null;
    }

    if (!tagNavigationTarget) {
      setActivePreviewNavigationTarget(null);
      setIsFrontMatterNavigationActive(false);
      return;
    }

    const translatedTagNavigationTarget = translateTagNavigationTarget(tagNavigationTarget, previewLineOffsetRef.current);

    setActivePreviewNavigationTarget(translatedTagNavigationTarget);
    setIsFrontMatterNavigationActive(Boolean(tagNavigationTarget.source === "front_matter" && !translatedTagNavigationTarget));
    contentContainer.classList.remove("markdown-preview-front-matter-navigation-target");
    contentContainer
      .querySelectorAll(".inline-tag-navigation-target")
      .forEach((node) => node.classList.remove("inline-tag-navigation-target"));

    if (translatedTagNavigationTarget) {
      const targetChip = Array.from(contentContainer.querySelectorAll<HTMLElement>(".inline-tag-chip")).find(
        (node) => node.dataset.tagName === translatedTagNavigationTarget.tag_name
          && Number(node.dataset.sourceLine) === translatedTagNavigationTarget.line_start
          && Number(node.dataset.occurrenceOrder) === translatedTagNavigationTarget.occurrence_order,
      );
      targetChip?.classList.add("inline-tag-navigation-target");
    } else if (tagNavigationTarget.source === "front_matter") {
      contentContainer.classList.add("markdown-preview-front-matter-navigation-target");
    }

    isProgrammaticScroll.current = true;
    if (translatedTagNavigationTarget) {
      scrollPreviewToSourceLine(scrollContainer, contentContainer, translatedTagNavigationTarget.line_start);
    } else {
      scrollContainer.scrollTop = 0;
    }
    releaseProgrammaticScrollSoon();

    navigationHighlightTimerRef.current = window.setTimeout(() => {
      setActivePreviewNavigationTarget(null);
      setIsFrontMatterNavigationActive(false);
      contentContainer.classList.remove("markdown-preview-front-matter-navigation-target");
      contentContainer
        .querySelectorAll(".inline-tag-navigation-target")
        .forEach((node) => node.classList.remove("inline-tag-navigation-target"));
      navigationHighlightTimerRef.current = null;
    }, 1600);
  }, [tagNavigationTarget]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    const contentContainer = containerRef.current;
    if (!scrollContainer || !contentContainer) return;

    const translatedSearchNavigationTarget = translateSearchNavigationTarget(
      searchNavigationTarget ?? null,
      previewLineOffsetRef.current,
    );
    setActiveSearchNavigationTarget(
      translatedSearchNavigationTarget
        ? {
          ...translatedSearchNavigationTarget,
          occurrenceInRange: searchNavigationTarget
            ? getOccurrenceIndexWithinTargetRange(content, searchNavigationTarget)
            : null,
        }
        : null,
    );
    if (!translatedSearchNavigationTarget) return;

    isProgrammaticScroll.current = true;
    scrollPreviewToSourceLine(scrollContainer, contentContainer, translatedSearchNavigationTarget.line_start);
    releaseProgrammaticScrollSoon();
  }, [content, searchNavigationTarget]);

  useEffect(() => {
    if (!sourceLineSyncSignal || sourceLineSyncSignal.source === "preview") return;

    const scrollContainer = scrollContainerRef.current;
    const contentContainer = containerRef.current;
    if (!scrollContainer || !contentContainer) return;

    isProgrammaticScroll.current = true;
    scrollPreviewToSourceLine(
      scrollContainer,
      contentContainer,
      Math.max(1, sourceLineSyncSignal.line - previewLineOffsetRef.current),
    );
    releaseProgrammaticScrollSoon();
  }, [sourceLineSyncSignal]);

  const handlePreviewScroll = () => {
    if (isProgrammaticScroll.current || !scrollContainerRef.current || !containerRef.current || !onTopVisibleLineChange) return;
    const sourceLine = getTopVisibleSourceLine(scrollContainerRef.current, containerRef.current);
    if (sourceLine !== null) onTopVisibleLineChange(sourceLine + previewLineOffsetRef.current);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let activeResize: {
      table: HTMLTableElement;
      cols: HTMLTableColElement[];
      columnIndex: number;
      startX: number;
      startWidths: number[];
    } | null = null;

    const stopTableResize = () => {
      activeResize = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    const handleTablePointerMove = (e: PointerEvent) => {
      if (!activeResize) return;

      const { table, cols, columnIndex, startX, startWidths } = activeResize;
      const tableWidth = table.getBoundingClientRect().width;
      if (tableWidth <= 0) return;

      const deltaPercent = ((e.clientX - startX) / tableWidth) * 100;
      const leftStart = startWidths[columnIndex];
      const rightStart = startWidths[columnIndex + 1];
      const combinedWidth = leftStart + rightStart;
      const nextLeft = Math.min(
        combinedWidth - MIN_TABLE_COLUMN_PERCENT,
        Math.max(MIN_TABLE_COLUMN_PERCENT, leftStart + deltaPercent),
      );
      const nextRight = combinedWidth - nextLeft;

      cols[columnIndex].style.width = formatColumnWidth(nextLeft);
      cols[columnIndex + 1].style.width = formatColumnWidth(nextRight);
    };

    const handleTablePointerDown = (e: PointerEvent) => {
      if (projectionMode) {
        return;
      }

      const target = e.target as HTMLElement;
      const handle = target.closest(".markdown-table-resize-handle") as HTMLElement | null;
      if (!handle) return;

      const table = handle.closest("table") as HTMLTableElement | null;
      const columnIndex = Number(handle.dataset.columnIndex);
      if (!table || !Number.isInteger(columnIndex)) return;

      const cols = Array.from(table.querySelectorAll("col"));
      if (columnIndex < 0 || columnIndex >= cols.length - 1) return;

      e.preventDefault();
      activeResize = {
        table,
        cols,
        columnIndex,
        startX: e.clientX,
        startWidths: readColumnWidths(cols),
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    };

    const handleClick = async (e: MouseEvent) => {
      const target = getEventElement(e.target);
      if (!target) {
        return;
      }

      const copyButton = target.closest(".markdown-code-copy-button") as HTMLButtonElement | null;
      if (copyButton) {
        e.preventDefault();
        const codeBlock = copyButton.closest("pre")?.querySelector("code");
        await writeClipboardText(codeBlock?.textContent ?? "");
        showCopiedNotice();
        return;
      }

      const linkTarget = getPreviewLinkTarget(target);
      if (!linkTarget) {
        return;
      }

      e.preventDefault();
      if (projectionMode && linkTarget.linkType !== "external") {
        return;
      }

      await openPreviewLinkTarget(linkTarget);
    };

    container.addEventListener("pointerdown", handleTablePointerDown);
    if (!projectionMode) {
      window.addEventListener("pointermove", handleTablePointerMove);
      window.addEventListener("pointerup", stopTableResize);
      window.addEventListener("pointercancel", stopTableResize);
    }
    container.addEventListener("click", handleClick);
    return () => {
      if (navigationHighlightTimerRef.current !== null) {
        window.clearTimeout(navigationHighlightTimerRef.current);
      }
      container.removeEventListener("pointerdown", handleTablePointerDown);
      window.removeEventListener("pointermove", handleTablePointerMove);
      window.removeEventListener("pointerup", stopTableResize);
      window.removeEventListener("pointercancel", stopTableResize);
      container.removeEventListener("click", handleClick);
      if (programmaticScrollTimerRef.current !== null) {
        window.clearTimeout(programmaticScrollTimerRef.current);
      }
      if (copyNoticeTimerRef.current !== null) {
        window.clearTimeout(copyNoticeTimerRef.current);
      }
      stopTableResize();
    };
  }, [openNote, beginOpenNote, isOpenNoteRequestCurrent, projectionMode, setStatusNotice]);

  const handlePreviewContextMenu = async (event: React.MouseEvent<HTMLDivElement>) => {
    if (projectionMode) {
      event.preventDefault();
      return;
    }

    const target = getEventElement(event.target);
    if (!target) {
      return;
    }

    event.preventDefault();
    const requestId = ++previewContextMenuRequestRef.current;

    const linkTarget = await resolvePreviewLinkTarget(target);
    if (requestId !== previewContextMenuRequestRef.current) {
      return;
    }

    if (linkTarget) {
      openContextMenu({
        position: { x: event.clientX, y: event.clientY },
        payload: {
          type: "previewLink",
          linkType: linkTarget.linkType,
          href: linkTarget.href,
          notePath: linkTarget.notePath,
          handlers: {
            open: () => openPreviewLinkTarget(linkTarget),
            copy: () => writeClipboardText(linkTarget.href),
            openTargetNote: linkTarget.notePath
              ? () => openNote(linkTarget.notePath as string, beginOpenNote())
              : undefined,
          },
        },
      });
      return;
    }

    openContextMenu({
      position: { x: event.clientX, y: event.clientY },
      payload: {
        type: "previewBlank",
        handlers: {
          returnToEditor: () => {
            setEditorMode("editor");
          },
          showSidebar: () => {
            setRightSidebarVisible(true);
          },
        },
      },
    });
  };

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handlePreviewScroll}
      onContextMenu={(event) => {
        void handlePreviewContextMenu(event);
      }}
      style={{
        width: "100%",
        height: "100%",
        overflowY: "auto",
        background: "#fff",
      }}
    >
      <style>{`
        .markdown-preview-content {
          overflow-wrap: anywhere;
          word-break: normal;
        }
        .markdown-preview-content .beautify-diff {
          display: flex;
          flex-direction: column;
          gap: 2px;
          font-family: ui-monospace, SFMono-Regular, SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace;
          font-size: 13px;
          line-height: 1.55;
        }
        .markdown-preview-content .beautify-diff-row {
          display: grid;
          grid-template-columns: 52px minmax(0, 1fr);
          align-items: start;
          border-radius: 8px;
        }
        .markdown-preview-content .beautify-diff-row--same {
          background: #f8fafc;
          color: #475467;
        }
        .markdown-preview-content .beautify-diff-row--removed {
          background: #fef3f2;
          color: #b42318;
        }
        .markdown-preview-content .beautify-diff-row--added {
          background: #ecfdf3;
          color: #027a48;
        }
        .markdown-preview-content .beautify-diff-gutter {
          padding: 6px 10px;
          text-align: right;
          border-right: 1px solid rgba(15, 23, 42, 0.08);
          color: #98a2b3;
          user-select: none;
        }
        .markdown-preview-content .beautify-diff-code {
          margin: 0;
          padding: 6px 12px;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          background: transparent;
        }
        .markdown-preview-content h1,
        .markdown-preview-content h2,
        .markdown-preview-content h3,
        .markdown-preview-content h4,
        .markdown-preview-content h5,
        .markdown-preview-content h6 {
          font-weight: 700;
          line-height: 1.28;
        }
        .markdown-preview-content h1 {
          margin-top: 0.35em;
          margin-bottom: 0.85em;
          font-size: 1.9em;
        }
        .markdown-preview-content h2 {
          margin-top: 1.45em;
          margin-bottom: 0.65em;
          font-size: 1.45em;
        }
        .markdown-preview-content h3 {
          margin-top: 1.2em;
          margin-bottom: 0.55em;
          font-size: 1.2em;
        }
        .markdown-preview-content h4,
        .markdown-preview-content h5,
        .markdown-preview-content h6 {
          margin-top: 1em;
          margin-bottom: 0.45em;
        }
        .markdown-preview-content p {
          margin-block: 0.85em;
        }
        .markdown-preview-content .katex-display {
          margin: 0.85em 0;
          text-align: left;
          overflow-x: auto;
          overflow-y: hidden;
        }
        .markdown-preview-content ul,
        .markdown-preview-content ol,
        .markdown-preview-content blockquote,
        .markdown-preview-content table,
        .markdown-preview-content pre {
          margin-block: 0.65em;
        }
        .markdown-preview-content blockquote {
          margin-inline: 0;
          padding: 0.55em 0.9em;
          border-left: 4px solid #f59e0b;
          background: #fffbeb;
          color: #7c2d12;
          border-radius: 0 8px 8px 0;
        }
        .markdown-preview-content blockquote p {
          margin-block: 0.2em;
        }
        .markdown-preview-content ul,
        .markdown-preview-content ol {
          padding-left: 2em;
        }
        .markdown-preview-content li {
          padding-left: 0.15em;
          margin-block: 0.35em;
        }
        .markdown-preview-content .markdown-task-list {
          padding-left: 1.7em;
        }
        .markdown-preview-content .markdown-task-list-item {
          list-style: none;
          padding-left: 0;
        }
        .markdown-preview-content .markdown-task-list-checkbox {
          width: 1em;
          height: 1em;
          margin: 0 0.55em 0 0;
          vertical-align: text-top;
        }
        .markdown-preview-content table {
          width: 100%;
          table-layout: fixed;
          border-collapse: collapse;
        }
        .markdown-preview-content .markdown-table-resizable-cell {
          position: relative;
        }
        .markdown-preview-content .markdown-table-resize-handle {
          position: absolute;
          top: 0;
          right: -4px;
          width: 8px;
          height: 100%;
          padding: 0;
          border: 0;
          background: transparent;
          cursor: col-resize;
          z-index: 1;
        }
        .markdown-preview-content .markdown-table-resize-handle::after {
          content: "";
          position: absolute;
          top: 8px;
          right: 3px;
          bottom: 8px;
          width: 2px;
          border-radius: 2px;
          background: transparent;
        }
        .markdown-preview-content .markdown-table-resize-handle:hover::after,
        .markdown-preview-content .markdown-table-resize-handle:focus-visible::after {
          background: var(--accent);
        }
        .markdown-preview-content th,
        .markdown-preview-content td {
          padding: 6px 8px;
          border: 1px solid #e0e2e7;
          overflow-wrap: anywhere;
          white-space: normal;
          vertical-align: top;
        }
        .markdown-preview-content pre {
          overflow-x: auto;
          max-width: 100%;
          padding: 14px 16px;
          background: #f6f8fa;
          border: 1px solid #e1e4e8;
          border-radius: 6px;
          color: #24292f;
          line-height: 1.55;
        }
        .markdown-preview-content code {
          font-family: var(--font-mono);
          font-size: 0.92em;
          background: #f6f8fa;
          border-radius: 4px;
          padding: 0.12em 0.34em;
        }
        .markdown-preview-content .markdown-code-block-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin: -14px -16px 12px;
          padding: 10px 16px 8px;
          border-bottom: 1px solid #e1e4e8;
        }
        .markdown-preview-content .markdown-code-block-language {
          color: #57606a;
          font-family: var(--font-mono);
          font-size: 0.76rem;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .markdown-preview-content .markdown-code-copy-button {
          border: 1px solid #d0d7de;
          border-radius: 999px;
          padding: 2px 10px;
          background: #ffffff;
          color: #24292f;
          font-size: 0.78rem;
          line-height: 1.6;
          cursor: pointer;
        }
        .markdown-preview-content .markdown-code-copy-button:hover,
        .markdown-preview-content .markdown-code-copy-button:focus-visible {
          background: #f3f4f6;
          border-color: #b6bdc6;
          outline: none;
        }
        .markdown-preview-content .markdown-code-block-body {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          align-items: start;
          column-gap: 12px;
        }
        .markdown-preview-content .markdown-code-block-gutter {
          display: grid;
          align-self: stretch;
          grid-auto-rows: minmax(1.55em, auto);
          padding-top: 1px;
          color: #8c959f;
          font-family: var(--font-mono);
          font-size: 0.8rem;
          line-height: 1.55;
          text-align: right;
          user-select: none;
        }
        .markdown-preview-content .markdown-code-block-line-number {
          display: block;
          min-width: 1.8em;
        }
        .markdown-preview-content pre code {
          display: block;
          min-width: 0;
          padding: 0;
          background: transparent;
          border-radius: 0;
          white-space: pre;
        }
        .markdown-preview-content pre code.hljs {
          color: #24292f;
        }
        .markdown-preview-content pre code.hljs .hljs-comment,
        .markdown-preview-content pre code.hljs .hljs-quote {
          color: #6a737d;
          font-style: italic;
        }
        .markdown-preview-content pre code.hljs .hljs-keyword,
        .markdown-preview-content pre code.hljs .hljs-selector-tag,
        .markdown-preview-content pre code.hljs .hljs-literal {
          color: #cf222e;
        }
        .markdown-preview-content pre code.hljs .hljs-string,
        .markdown-preview-content pre code.hljs .hljs-attr,
        .markdown-preview-content pre code.hljs .hljs-template-tag {
          color: #0a7d3b;
        }
        .markdown-preview-content pre code.hljs .hljs-number,
        .markdown-preview-content pre code.hljs .hljs-symbol,
        .markdown-preview-content pre code.hljs .hljs-bullet {
          color: #0550ae;
        }
        .markdown-preview-content pre code.hljs .hljs-title,
        .markdown-preview-content pre code.hljs .hljs-section,
        .markdown-preview-content pre code.hljs .hljs-built_in,
        .markdown-preview-content pre code.hljs .hljs-type {
          color: #8250df;
        }
        .markdown-preview-content pre code.hljs .hljs-variable,
        .markdown-preview-content pre code.hljs .hljs-property,
        .markdown-preview-content pre code.hljs .hljs-params {
          color: #24292f;
        }
        .markdown-preview-content pre.mermaid-diagram {
          overflow-x: auto;
          padding: 18px 20px;
          background: #ffffff;
          border: 1px solid #e4e7ec;
          border-radius: 8px;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65);
        }
        .markdown-preview-content .mermaid-diagram-error {
          margin-bottom: 10px;
          color: #b42318;
          font-size: 0.9rem;
          font-weight: 600;
        }
        .markdown-preview-content pre.mermaid-diagram svg {
          display: block;
          max-width: 100%;
          height: auto;
          margin: 0 auto;
        }
        .markdown-preview-content img {
          display: block;
          max-width: 100%;
          width: auto;
          height: auto;
          object-fit: contain;
          margin: 0.85em auto;
        }
        .markdown-preview-content .inline-tag-chip {
          display: inline-flex;
          align-items: center;
          gap: 0.32em;
          margin: 0 0.12em;
          padding: 0.08em 0.5em 0.08em 0.42em;
          border-radius: 999px;
          background: #eef3ff;
          color: #3558d6;
          font-size: 0.92em;
          font-style: normal;
          font-weight: 600;
          vertical-align: baseline;
          white-space: nowrap;
        }
        .markdown-preview-content .inline-tag-chip::before {
          content: "🏷";
          font-size: 0.9em;
          line-height: 1;
        }
        .markdown-preview-content .inline-tag-navigation-target {
          background: #dfe8ff;
          color: #2448b8;
          box-shadow: 0 0 0 1px rgba(91, 106, 249, 0.24);
        }
        .markdown-preview-content .search-navigation-target {
          background: rgba(255, 212, 92, 0.55);
          box-shadow: 0 0 0 1px rgba(217, 154, 0, 0.18);
          border-radius: 4px;
        }
        .markdown-preview-content.markdown-preview-front-matter-navigation-target {
          box-shadow: inset 0 0 0 2px rgba(91, 106, 249, 0.22);
          background: linear-gradient(180deg, rgba(91, 106, 249, 0.08), rgba(91, 106, 249, 0));
          transition: box-shadow 160ms ease, background 160ms ease;
        }
        .wiki-link {
          color: var(--color-accent, #5b6af9);
          cursor: pointer;
          text-decoration: underline;
        }
        .wiki-link:hover {
          opacity: 0.8;
        }
      `}</style>
      <div
        ref={containerRef}
        data-testid="markdown-preview-content"
        className="markdown-preview-content"
        style={{
          width: "100%",
          maxWidth: "none",
          minWidth: 0,
          margin: 0,
          padding: "22px 36px",
          fontFamily: "var(--font-reading)",
          fontSize: 15,
          lineHeight: 1.7,
        }}
      />
    </div>
  );
}
