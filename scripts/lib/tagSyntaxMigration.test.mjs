// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  mergeFrontMatterTags,
  migrateNoteContent,
  migrateNotesInDirectory,
  splitFrontMatter,
  transformLegacyInlineTagsInBody,
} from "./tagSyntaxMigration.mjs";

const tempDirs = [];

function makeTempDir() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mynote-tag-migration-"));
  tempDirs.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("transformLegacyInlineTagsInBody", () => {
  it("converts legacy inline tags while skipping headings, fragments, code, and musical sharps", () => {
    const body = [
      "# 标题 #不应转换",
      "正文里有 #项目报告 和 #阶段一。",
      "链接 [帮助](#faq) 和 heading anchor {#keep-anchor} 不应转换。",
      "音阶（#G）和链接 https://example.com/#fragment 也不应转换。",
      "`代码里的 #skip` 也要跳过。",
      "```md",
      "代码块里的 #skip",
      "```",
      "已有新语法 [[#已存在]] 保持不变。",
    ].join("\n");

    const result = transformLegacyInlineTagsInBody(body);

    expect(result.body).toContain("正文里有 [[#项目报告]] 和 [[#阶段一]]。");
    expect(result.body).toContain("[帮助](#faq)");
    expect(result.body).toContain("{#keep-anchor}");
    expect(result.body).toContain("（#G）");
    expect(result.body).toContain("https://example.com/#fragment");
    expect(result.body).toContain("`代码里的 #skip`");
    expect(result.body).toContain("代码块里的 #skip");
    expect(result.convertedCount).toBe(2);
    expect(result.discoveredTags).toEqual(["项目报告", "阶段一"]);
  });
});

describe("mergeFrontMatterTags", () => {
  it("appends tags to an existing scalar tags field", () => {
    const result = mergeFrontMatterTags("title: 示例\ntags: 阅读", ["项目报告", "阅读"]);

    expect(result.frontMatter).toBe(["title: 示例", "tags:", "  - 阅读", "  - 项目报告"].join("\n"));
    expect(result.addedCount).toBe(1);
  });
});

describe("migrateNoteContent", () => {
  it("converts legacy inline tags and ensures front matter owns the tag association", () => {
    const content = [
      "---",
      "title: 当前笔记",
      "---",
      "",
      "# 当前笔记",
      "",
      "这里有 #项目报告，还有已有引用 [[#阶段一]]。",
    ].join("\n");

    const migrated = migrateNoteContent(content);
    const { frontMatter, body } = splitFrontMatter(migrated.content);

    expect(migrated.changed).toBe(true);
    expect(migrated.convertedCount).toBe(1);
    expect(migrated.addedFrontMatterTagCount).toBe(2);
    expect(frontMatter).toContain("tags:");
    expect(frontMatter).toContain("项目报告");
    expect(frontMatter).toContain("阶段一");
    expect(body).toContain("这里有 [[#项目报告]]，还有已有引用 [[#阶段一]]。");
  });
});

describe("migrateNotesInDirectory", () => {
  it("scans notes recursively and only writes files in apply mode", () => {
    const root = makeTempDir();
    const notesRoot = path.join(root, "notes");
    fs.mkdirSync(path.join(notesRoot, "项目"), { recursive: true });
    const notePath = path.join(notesRoot, "项目", "计划.md");
    fs.writeFileSync(notePath, "# 计划\n\n处理 #迁移标签", "utf8");

    const dryRun = migrateNotesInDirectory(notesRoot, { apply: false });
    expect(dryRun.scannedFileCount).toBe(1);
    expect(dryRun.changedFileCount).toBe(1);
    expect(fs.readFileSync(notePath, "utf8")).toBe("# 计划\n\n处理 #迁移标签");

    const applied = migrateNotesInDirectory(notesRoot, { apply: true });
    expect(applied.changedFileCount).toBe(1);
    expect(fs.readFileSync(notePath, "utf8")).toContain("[[#迁移标签]]");
    expect(fs.readFileSync(notePath, "utf8")).toContain("tags:");
  });
});