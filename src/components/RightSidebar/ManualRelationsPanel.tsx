import { useEffect, useRef, useState } from "react";
import { api } from "../../api/commands";
import { useAppStore } from "../../store/useAppStore";
import type { NoteRelations, RelationItem, RelationType, SearchResult } from "../../types";

interface Props {
  noteId: string | null;
}

const relationTypeOptions: Array<{ value: RelationType; label: string }> = [
  { value: "related", label: "相关" },
  { value: "prerequisite", label: "前置" },
  { value: "extension", label: "扩展" },
  { value: "opposes", label: "对立" },
  { value: "supports", label: "支持" },
  { value: "similar", label: "相似" },
];

const emptyRelations: NoteRelations = {
  outgoing: [],
  incoming: [],
};

function collectErrorSignals(error: unknown, visited = new Set<object>()): string[] {
  if (error instanceof Error) {
    return [error.name, error.message];
  }

  if (typeof error === "string") {
    return [error];
  }

  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") {
    return [String(error)];
  }

  if (!error || typeof error !== "object") {
    return [];
  }

  if (visited.has(error)) {
    return [];
  }

  visited.add(error);
  return Object.values(error).flatMap((value) => collectErrorSignals(value, visited));
}

function isDuplicateRelationError(error: unknown) {
  const normalized = collectErrorSignals(error).join(" ").toLowerCase();
  return normalized.includes("alreadyexists")
    || normalized.includes("already exists")
    || normalized.includes("already_exists")
    || normalized.includes("duplicate")
    || normalized.includes("已存在");
}

function relationTypeLabel(type: RelationType) {
  return relationTypeOptions.find((option) => option.value === type)?.label ?? type;
}

export function ManualRelationsPanel({ noteId }: Props) {
  const kb = useAppStore((state) => state.kb);
  const mountedRef = useRef(true);
  const activeNoteIdRef = useRef<string | null>(noteId);
  const [relations, setRelations] = useState<NoteRelations>(emptyRelations);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<SearchResult | null>(null);
  const [relationType, setRelationType] = useState<RelationType>("related");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isCurrentNoteActive = (targetNoteId: string) => mountedRef.current && activeNoteIdRef.current === targetNoteId;

  useEffect(() => {
    activeNoteIdRef.current = noteId;
    setShowForm(false);
    setQuery("");
    setSearchResults([]);
    setSelectedTarget(null);
    setRelationType("related");
    setDescription("");
    setSearching(false);
    setSubmitting(false);
    setError(null);
    setDeletingId(null);

    if (!noteId) {
      setRelations(emptyRelations);
      setLoading(false);
      return;
    }

    let isActive = true;

    setLoading(true);
    api.listRelations(noteId)
      .then((nextRelations) => {
        if (isActive) {
          setRelations(nextRelations);
        }
      })
      .catch(() => {
        if (isActive) {
          setRelations(emptyRelations);
        }
      })
      .finally(() => {
        if (isActive) {
          setLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [noteId]);

  useEffect(() => {
    if (!showForm || !noteId || !kb || !query.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    let isActive = true;
    setSearching(true);

    api.searchNotes(query.trim(), kb.id)
      .then((results) => {
        if (isActive) {
          setSearchResults(results.filter((item) => item.note_id !== noteId));
        }
      })
      .catch(() => {
        if (isActive) {
          setSearchResults([]);
        }
      })
      .finally(() => {
        if (isActive) {
          setSearching(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [kb, noteId, query, showForm]);

  const reloadRelations = async (targetNoteId: string) => {
    if (!isCurrentNoteActive(targetNoteId)) {
      return false;
    }

    const nextRelations = await api.listRelations(targetNoteId);
    if (!isCurrentNoteActive(targetNoteId)) {
      return false;
    }

    setRelations(nextRelations);
    return true;
  };

  const resetForm = () => {
    setShowForm(false);
    setQuery("");
    setSearchResults([]);
    setSelectedTarget(null);
    setRelationType("related");
    setDescription("");
    setError(null);
  };

  const handleCreateRelation = async () => {
    if (!noteId || !selectedTarget || submitting) {
      return;
    }

    const sourceNoteId = noteId;
    setSubmitting(true);
    setError(null);

    try {
      await api.createRelation(
        sourceNoteId,
        selectedTarget.note_id,
        relationType,
        description.trim() || undefined,
      );
      const applied = isCurrentNoteActive(sourceNoteId)
        ? await reloadRelations(sourceNoteId)
        : false;
      if (applied) {
        resetForm();
      }
    } catch (createError) {
      if (isCurrentNoteActive(sourceNoteId)) {
        setError(isDuplicateRelationError(createError) ? "该关系已存在" : "创建关系失败");
      }
    } finally {
      if (isCurrentNoteActive(sourceNoteId)) {
        setSubmitting(false);
      }
    }
  };

  const handleDeleteRelation = async (relationId: string) => {
    if (deletingId) {
      return;
    }

    const sourceNoteId = noteId;
    if (!sourceNoteId) {
      return;
    }

    setDeletingId(relationId);
    try {
      await api.deleteRelation(relationId);
      if (isCurrentNoteActive(sourceNoteId)) {
        await reloadRelations(sourceNoteId);
      }
    } finally {
      if (isCurrentNoteActive(sourceNoteId)) {
        setDeletingId(null);
      }
    }
  };

  const sectionStyle: React.CSSProperties = {
    marginBottom: 12,
  };

  const headingStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    color: "#666",
    padding: "4px 8px",
    background: "#f5f5f7",
    borderRadius: 4,
    marginBottom: 4,
  };

  const emptyStyle: React.CSSProperties = {
    padding: "8px",
    fontSize: 12,
    color: "#999",
  };

  const actionButtonStyle: React.CSSProperties = {
    width: "100%",
    padding: "6px 8px",
    fontSize: 12,
    color: "var(--color-accent, #5b6af9)",
    background: "#f7f9ff",
    border: "1px dashed #cdd6f4",
    borderRadius: 4,
    cursor: "pointer",
    marginBottom: 8,
  };

  const itemCardStyle: React.CSSProperties = {
    padding: "8px",
    border: "1px solid #eceef3",
    borderRadius: 4,
    marginBottom: 6,
    background: "#fff",
  };

  const mutedTextStyle: React.CSSProperties = {
    fontSize: 12,
    color: "#8a8f98",
  };

  if (!noteId) {
    return (
      <div style={{ padding: "12px 8px", fontSize: 13, color: "#999" }}>
        选择笔记以管理关系
      </div>
    );
  }

  const hasRelations = relations.outgoing.length > 0 || relations.incoming.length > 0;

  return (
    <div style={{ padding: 8, fontSize: 13 }}>
      <button
        type="button"
        style={actionButtonStyle}
        onClick={() => {
          setShowForm((current) => !current);
          setError(null);
        }}
      >
        添加关系
      </button>

      {showForm && (
        <div style={{ ...itemCardStyle, marginBottom: 8, background: "#fafbfc" }}>
          <div style={{ marginBottom: 8 }}>
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedTarget(null);
                setError(null);
              }}
              placeholder="搜索目标笔记"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "6px 8px",
                fontSize: 13,
                border: "1px solid #d9dce3",
                borderRadius: 4,
              }}
            />
          </div>

          {query.trim() && (
            <div style={{ marginBottom: 8 }}>
              {searching ? (
                <div style={mutedTextStyle}>搜索中...</div>
              ) : searchResults.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {searchResults.map((result) => (
                    <button
                      key={result.note_id}
                      type="button"
                      aria-label={result.title}
                      onClick={() => {
                        setSelectedTarget(result);
                        setError(null);
                      }}
                      style={{
                        textAlign: "left",
                        padding: "6px 8px",
                        fontSize: 12,
                        borderRadius: 4,
                        border: selectedTarget?.note_id === result.note_id ? "1px solid #92a2f8" : "1px solid #e4e7ee",
                        background: selectedTarget?.note_id === result.note_id ? "#eef2ff" : "#fff",
                        cursor: "pointer",
                      }}
                    >
                      <div>{result.title}</div>
                      <div style={mutedTextStyle}>{result.path}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <div style={mutedTextStyle}>未找到匹配笔记</div>
              )}
            </div>
          )}

          <div style={{ marginBottom: 8 }}>
            <label style={{ display: "block", marginBottom: 4, fontSize: 12, color: "#666" }}>
              关系类型
            </label>
            <select
              aria-label="关系类型"
              value={relationType}
              onChange={(event) => setRelationType(event.target.value as RelationType)}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "6px 8px",
                fontSize: 13,
                border: "1px solid #d9dce3",
                borderRadius: 4,
                background: "#fff",
              }}
            >
              {relationTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 8 }}>
            <label style={{ display: "block", marginBottom: 4, fontSize: 12, color: "#666" }}>
              说明
            </label>
            <textarea
              aria-label="说明"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "6px 8px",
                fontSize: 13,
                border: "1px solid #d9dce3",
                borderRadius: 4,
                resize: "vertical",
              }}
            />
          </div>

          {selectedTarget && (
            <div style={{ ...mutedTextStyle, marginBottom: 8 }}>
              已选择：{selectedTarget.title}
            </div>
          )}

          {error && (
            <div style={{ marginBottom: 8, fontSize: 12, color: "#c43d3d" }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={handleCreateRelation}
              disabled={!selectedTarget || submitting}
              style={{
                flex: 1,
                padding: "6px 8px",
                fontSize: 12,
                color: "#fff",
                background: !selectedTarget || submitting ? "#c8ceda" : "var(--color-accent, #5b6af9)",
                border: "none",
                borderRadius: 4,
                cursor: !selectedTarget || submitting ? "default" : "pointer",
              }}
            >
              保存关系
            </button>
            <button
              type="button"
              onClick={resetForm}
              style={{
                padding: "6px 8px",
                fontSize: 12,
                color: "#666",
                background: "#fff",
                border: "1px solid #d9dce3",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: "12px 8px", fontSize: 13, color: "#999" }}>加载中...</div>
      ) : !hasRelations ? (
        <div style={emptyStyle}>暂无手动关系</div>
      ) : (
        <>
          <div style={sectionStyle} data-testid="manual-relations-outgoing">
            <div style={headingStyle}>传出关系</div>
            {relations.outgoing.length > 0 ? (
              relations.outgoing.map((item) => (
                <RelationCard
                  key={item.id}
                  item={item}
                  kind="outgoing"
                  deleting={deletingId === item.id}
                  onDelete={() => handleDeleteRelation(item.id)}
                />
              ))
            ) : (
              <div style={emptyStyle}>暂无传出关系</div>
            )}
          </div>

          <div style={sectionStyle} data-testid="manual-relations-incoming">
            <div style={headingStyle}>传入关系</div>
            {relations.incoming.length > 0 ? (
              relations.incoming.map((item) => (
                <RelationCard
                  key={item.id}
                  item={item}
                  kind="incoming"
                />
              ))
            ) : (
              <div style={emptyStyle}>暂无传入关系</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function RelationCard({
  item,
  kind,
  deleting = false,
  onDelete,
}: {
  item: RelationItem;
  kind: "outgoing" | "incoming";
  deleting?: boolean;
  onDelete?: () => void;
}) {
  return (
    <div
      style={{
        padding: "8px",
        border: "1px solid #eceef3",
        borderRadius: 4,
        marginBottom: 6,
        background: "#fff",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontWeight: 500, color: "#333" }}>{item.note_title}</div>
        <div style={{ fontSize: 11, color: "#7b8190", flexShrink: 0 }}>{relationTypeLabel(item.relation_type)}</div>
      </div>
      <div style={{ marginTop: 4, fontSize: 12, color: "#8a8f98" }}>{item.note_path}</div>
      {item.description && (
        <div style={{ marginTop: 6, fontSize: 12, color: "#555" }}>{item.description}</div>
      )}
      {kind === "outgoing" && onDelete && (
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            aria-label={`删除关系 ${item.note_title}`}
            style={{
              padding: "4px 8px",
              fontSize: 12,
              color: deleting ? "#999" : "#c43d3d",
              background: "#fff",
              border: "1px solid #ead0d0",
              borderRadius: 4,
              cursor: deleting ? "default" : "pointer",
            }}
          >
            删除
          </button>
        </div>
      )}
    </div>
  );
}