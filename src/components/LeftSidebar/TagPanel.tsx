import { useEffect, useState } from "react";
import { api } from "../../api/commands";
import type { Tag } from "../../types";
import { useAppStore } from "../../store/useAppStore";

export function TagPanel() {
  const [tags, setTags] = useState<Tag[]>([]);
  const selectedTagIds = useAppStore((s) => s.selectedTagIds);
  const setSelectedTagIds = useAppStore((s) => s.setSelectedTagIds);
  const kb = useAppStore((s) => s.kb);

  useEffect(() => {
    if (!kb) return;
    api.listTags().then(setTags).catch(console.error);
  }, [kb]);

  const toggleTag = (id: string, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      // Multi-select
      setSelectedTagIds(
        selectedTagIds.includes(id)
          ? selectedTagIds.filter((t) => t !== id)
          : [...selectedTagIds, id]
      );
    } else {
      // Single select / deselect
      setSelectedTagIds(selectedTagIds.includes(id) && selectedTagIds.length === 1 ? [] : [id]);
    }
  };

  if (tags.length === 0) {
    return (
      <div style={{ padding: "16px 12px", fontSize: 13, color: "#999" }}>
        暂无标签。在笔记 Front Matter 中添加 <code>tags: [标签名]</code> 或在正文中使用 #标签 语法。
      </div>
    );
  }

  return (
    <div style={{ padding: "8px 0" }}>
      {tags.map((tag) => (
        <div
          key={tag.id}
          onClick={(e) => toggleTag(tag.id, e)}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "4px 12px",
            cursor: "pointer",
            background: selectedTagIds.includes(tag.id) ? "#e8f0fe" : "transparent",
            borderRadius: 4,
            margin: "1px 4px",
          }}
        >
          <span style={{ fontSize: 13, color: selectedTagIds.includes(tag.id) ? "#1a73e8" : "#333" }}>
            # {tag.name}
          </span>
          <span style={{ fontSize: 11, color: "#999" }}>{tag.note_count ?? 0}</span>
        </div>
      ))}
      {selectedTagIds.length > 0 && (
        <div
          style={{ padding: "6px 12px", fontSize: 12, color: "#888", cursor: "pointer" }}
          onClick={() => setSelectedTagIds([])}
        >
          ✕ 清除过滤
        </div>
      )}
    </div>
  );
}
