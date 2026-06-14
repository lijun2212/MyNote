import { describe, expect, it } from "vitest";
import { clearLastKnowledgeBaseRootPath, getLastKnowledgeBaseRootPath, saveLastKnowledgeBaseRootPath } from "./lastKnowledgeBase";

describe("lastKnowledgeBase persistence", () => {
  it("stores, reads, and clears the last knowledge base root path", () => {
    saveLastKnowledgeBaseRootPath("/Users/lijun/Archive");

    expect(getLastKnowledgeBaseRootPath()).toBe("/Users/lijun/Archive");

    clearLastKnowledgeBaseRootPath();

    expect(getLastKnowledgeBaseRootPath()).toBeNull();
  });
});