import { useEffect, useRef, useState } from "react";
import { api } from "../../api/commands";
import { useOpenNote } from "../../hooks/useOpenNote";
import { useEditorStore } from "../../store/useEditorStore";
import type {
  GraphCandidateRelation,
  GraphConflictItem,
  GraphFactualRelationItem,
  GraphLogicPath,
  GraphNodeRef,
  GraphRelationItem,
  NoteGraphAnalysis,
  RelationOrigin,
  RelationType,
} from "../../types";

type LoadState = "idle" | "loading" | "ready" | "error";

const panelStyle: React.CSSProperties = {
  padding: 12,
  color: "#475467",
  fontSize: 13,
};

const emptyStyle: React.CSSProperties = {
  color: "#98a2b3",
  lineHeight: 1.5,
};

const sectionStyle: React.CSSProperties = {
  marginBottom: 12,
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  background: "#ffffff",
  overflow: "hidden",
};

const sectionHeaderStyle: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 12,
  fontWeight: 600,
  color: "#475467",
  background: "#f8fafc",
  borderBottom: "1px solid #eaecf0",
};

const sectionBodyStyle: React.CSSProperties = {
  padding: 10,
};

const itemListStyle: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const itemCardStyle: React.CSSProperties = {
  border: "1px solid #eaecf0",
  borderRadius: 6,
  padding: 8,
  background: "#fcfcfd",
};

const metaRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  marginBottom: 4,
};

const metaTextStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#667085",
};

const subtleMetaTextStyle: React.CSSProperties = {
  ...metaTextStyle,
  marginTop: 4,
};

const rationaleStyle: React.CSSProperties = {
  marginTop: 4,
  fontSize: 12,
  color: "#475467",
  lineHeight: 1.5,
};

const actionRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  marginTop: 8,
  flexWrap: "wrap",
};

const actionButtonStyle: React.CSSProperties = {
  border: "1px solid #d0d5dd",
  borderRadius: 6,
  background: "#fff",
  color: "#344054",
  fontSize: 12,
  padding: "4px 10px",
  cursor: "pointer",
};

const primaryButtonStyle: React.CSSProperties = {
  ...actionButtonStyle,
  borderColor: "#b2ddff",
  background: "#eff8ff",
  color: "#175cd3",
};

const nodeButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: 0,
  border: "none",
  background: "none",
  color: "#175cd3",
  fontSize: 13,
  cursor: "pointer",
};

const pathStepListStyle: React.CSSProperties = {
  listStyle: "none",
  margin: "8px 0 0",
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const emptySectionTextStyle: React.CSSProperties = {
  ...emptyStyle,
  fontSize: 12,
};

const panelActionButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  width: "100%",
  justifyContent: "center",
  marginBottom: 12,
};

const inlineFieldStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid #d0d5dd",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 12,
  color: "#344054",
  background: "#fff",
};

const relationTypeLabels: Record<RelationType, string> = {
  related: "相关",
  prerequisite: "前置",
  extension: "扩展",
  opposes: "对立",
  supports: "支持",
  similar: "相似",
  premise: "前提",
  conclusion: "结论",
  example: "示例",
  rebuts: "反驳",
};

function relationTypeLabel(type: RelationType) {
  return relationTypeLabels[type] ?? type;
}

function relationDirectionLabel(direction: "incoming" | "outgoing") {
  return direction === "incoming" ? "指向当前" : "当前指向";
}

function relationOriginLabel(origin: RelationOrigin) {
  switch (origin) {
    case "manual":
      return "手工维护";
    case "candidate_accepted":
      return "AI 原样采纳";
    case "candidate_edited":
      return "AI 编辑后采纳";
    default:
      return origin;
  }
}

function isNodeNavigable(node: GraphNodeRef) {
  return node.notePath.trim().length > 0;
}

function buildNodeCaption(node: GraphNodeRef) {
  if (node.headingText?.trim()) {
    return node.headingText.trim();
  }

  return node.noteTitle || node.notePath || node.noteId;
}

function buildCandidateEndpointLabel(candidate: GraphCandidateRelation, currentNoteId: string, currentNoteTitle: string) {
  const sourceLabel = candidate.sourceNoteId === "" ? "未知来源" : candidate.sourceNoteId;
  const targetLabel = candidate.targetNoteId === "" ? "未知目标" : candidate.targetNoteId;
  const resolvedSourceLabel = candidate.sourceNoteId
    ? (candidate.sourceNoteId === currentNoteId ? currentNoteTitle : sourceLabel)
    : "未知来源";
  return `${resolvedSourceLabel} -> ${targetLabel}`;
}

export function GraphAnalysisPanel() {
  const currentNote = useEditorStore((state) => state.currentNote);
  const setSearchNavigationTarget = useEditorStore((state) => state.setSearchNavigationTarget);
  const { beginOpenNote, isOpenNoteRequestCurrent, openNote } = useOpenNote();

  const [analysis, setAnalysis] = useState<NoteGraphAnalysis | null>(null);
  const [candidates, setCandidates] = useState<GraphCandidateRelation[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [generationState, setGenerationState] = useState<"idle" | "loading">("idle");
  const [mutationCandidateId, setMutationCandidateId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const requestTokenRef = useRef(0);
  const activeNoteIdRef = useRef<string | null>(currentNote?.id ?? null);
  const activeNotePathRef = useRef<string | null>(currentNote?.path ?? null);

  activeNoteIdRef.current = currentNote?.id ?? null;
  activeNotePathRef.current = currentNote?.path ?? null;

  const loadData = async (noteId: string) => {
    const requestToken = requestTokenRef.current + 1;
    requestTokenRef.current = requestToken;
    setLoadState("loading");
    setMutationError(null);

    try {
      const [nextAnalysis, nextCandidates] = await Promise.all([
        api.getNoteGraphAnalysis(noteId),
        api.getNoteGraphCandidates(noteId),
      ]);

      if (requestTokenRef.current !== requestToken || activeNoteIdRef.current !== noteId) {
        return;
      }

      setAnalysis(nextAnalysis);
      setCandidates(nextCandidates.filter((item) => item.candidateStatus === "pending"));
      setLoadState("ready");
    } catch {
      if (requestTokenRef.current !== requestToken || activeNoteIdRef.current !== noteId) {
        return;
      }

      setAnalysis(null);
      setCandidates([]);
      setLoadState("error");
    }
  };

  useEffect(() => {
    if (!currentNote) {
      setAnalysis(null);
      setCandidates([]);
      setLoadState("idle");
      setMutationCandidateId(null);
      setMutationError(null);
      return;
    }

    setMutationCandidateId(null);
    setMutationError(null);
    void loadData(currentNote.id);
  }, [currentNote?.id]);

  const navigateToNode = async (node: GraphNodeRef) => {
    const notePath = node.notePath.trim();
    if (!notePath) {
      return;
    }

    const currentPath = activeNotePathRef.current;
    if (currentPath !== notePath) {
      const requestId = beginOpenNote();
      await openNote(notePath, requestId);
      if (!isOpenNoteRequestCurrent(requestId) || useEditorStore.getState().currentNote?.path !== notePath) {
        return;
      }
    }

    if (node.lineStart !== null && node.lineEnd !== null) {
      setSearchNavigationTarget({
        note_id: node.noteId,
        note_path: node.notePath,
        note_title: node.noteTitle,
        line_start: node.lineStart,
        line_end: node.lineEnd,
        occurrence_order: 1,
        match_text: node.headingText?.trim() || node.noteTitle,
        context_snippet: node.headingText?.trim() || node.noteTitle,
        source: "body",
        revision: Date.now(),
      });
    }
  };

  const handleCandidateMutation = async (
    candidateId: string,
    action: "accept" | "ignore",
    relationType?: RelationType,
    description?: string,
  ) => {
    const focusNoteId = activeNoteIdRef.current;
    if (!focusNoteId) {
      return;
    }

    setMutationCandidateId(candidateId);
    setMutationError(null);

    try {
      if (action === "accept") {
        await api.acceptGraphCandidate(candidateId, relationType, description);
      } else {
        await api.ignoreGraphCandidate(candidateId);
      }

      if (activeNoteIdRef.current !== focusNoteId) {
        return;
      }

      await loadData(focusNoteId);
    } catch {
      if (activeNoteIdRef.current === focusNoteId) {
        setMutationError(action === "accept" ? "候选关系采纳失败" : "候选关系忽略失败");
      }
    } finally {
      if (activeNoteIdRef.current === focusNoteId) {
        setMutationCandidateId(null);
      }
    }
  };

  const handleGenerateCandidates = async () => {
    const focusNoteId = activeNoteIdRef.current;
    if (!focusNoteId || generationState === "loading") {
      return;
    }

    setGenerationState("loading");
    setMutationError(null);

    try {
      await api.generateNoteGraphCandidates(focusNoteId);
      if (activeNoteIdRef.current !== focusNoteId) {
        return;
      }

      await loadData(focusNoteId);
    } catch {
      if (activeNoteIdRef.current === focusNoteId) {
        setMutationError("AI 候选生成失败");
      }
    } finally {
      if (activeNoteIdRef.current === focusNoteId) {
        setGenerationState("idle");
      }
    }
  };

  if (!currentNote) {
    return (
      <div style={panelStyle}>
        <div style={emptyStyle}>打开笔记后显示图谱分析</div>
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div style={panelStyle}>
        <div style={emptyStyle}>图谱分析加载失败</div>
      </div>
    );
  }

  if (loadState === "loading") {
    return (
      <div style={panelStyle}>
        <div style={emptyStyle}>图谱分析加载中...</div>
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      {mutationError ? <div style={{ ...emptyStyle, marginBottom: 8, color: "#b42318" }}>{mutationError}</div> : null}

      <button
        type="button"
        onClick={() => void handleGenerateCandidates()}
        disabled={generationState === "loading"}
        style={{
          ...panelActionButtonStyle,
          cursor: generationState === "loading" ? "default" : panelActionButtonStyle.cursor,
          opacity: generationState === "loading" ? 0.6 : 1,
        }}
      >
        {generationState === "loading" ? "AI 候选生成中..." : "AI 生成候选关系"}
      </button>

      <GraphSection title="已确认关系">
        <RelationList items={analysis?.overview.confirmedRelations ?? []} onNavigate={navigateToNode} />
      </GraphSection>

      <GraphSection title="事实关系">
        <FactualRelationList items={analysis?.overview.factualRelations ?? []} onNavigate={navigateToNode} />
      </GraphSection>

      <GraphSection title="逻辑路径">
        <LogicPathList items={analysis?.logicPaths ?? []} onNavigate={navigateToNode} />
      </GraphSection>

      <GraphSection title="冲突">
        <ConflictList items={analysis?.conflicts ?? []} onNavigate={navigateToNode} />
      </GraphSection>

      <GraphSection title="候选关系">
        <CandidateList
          items={candidates}
          currentNoteId={currentNote.id}
          currentNoteTitle={currentNote.title}
          pendingCandidateId={mutationCandidateId}
          onAccept={(candidateId, relationType, description) => handleCandidateMutation(candidateId, "accept", relationType, description)}
          onIgnore={(candidateId) => handleCandidateMutation(candidateId, "ignore")}
        />
      </GraphSection>
    </div>
  );
}

function GraphSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={sectionStyle}>
      <div style={sectionHeaderStyle}>{title}</div>
      <div style={sectionBodyStyle}>{children}</div>
    </section>
  );
}

function RelationList({ items, onNavigate }: { items: GraphRelationItem[]; onNavigate: (node: GraphNodeRef) => void | Promise<void> }) {
  if (items.length === 0) {
    return <div style={emptySectionTextStyle}>暂无已确认关系</div>;
  }

  return (
    <ul style={itemListStyle}>
      {items.map((item) => (
        <li key={item.relationId} style={itemCardStyle}>
          <div style={metaRowStyle}>
            <span style={metaTextStyle}>
              {relationTypeLabel(item.relationType)} | {relationDirectionLabel(item.direction)} | {relationOriginLabel(item.relationOrigin)}
            </span>
          </div>
          {item.acceptedCandidateId ? <div style={subtleMetaTextStyle}>来源候选: {item.acceptedCandidateId}</div> : null}
          <NodeLabel node={item.note} onNavigate={onNavigate} />
          {item.rationale ? <div style={rationaleStyle}>{item.rationale}</div> : null}
        </li>
      ))}
    </ul>
  );
}

function FactualRelationList({ items, onNavigate }: { items: GraphFactualRelationItem[]; onNavigate: (node: GraphNodeRef) => void | Promise<void> }) {
  if (items.length === 0) {
    return <div style={emptySectionTextStyle}>暂无事实关系</div>;
  }

  return (
    <ul style={itemListStyle}>
      {items.map((item) => (
        <li key={item.linkId} style={itemCardStyle}>
          <div style={metaRowStyle}>
            <span style={metaTextStyle}>{relationDirectionLabel(item.direction)} | {item.linkType}</span>
          </div>
          <NodeLabel node={item.note} onNavigate={onNavigate} />
          {item.linkText ? <div style={rationaleStyle}>{item.linkText}</div> : null}
        </li>
      ))}
    </ul>
  );
}

function LogicPathList({ items, onNavigate }: { items: GraphLogicPath[]; onNavigate: (node: GraphNodeRef) => void | Promise<void> }) {
  if (items.length === 0) {
    return <div style={emptySectionTextStyle}>暂无逻辑路径</div>;
  }

  return (
    <ul style={itemListStyle}>
      {items.map((item) => (
        <li key={item.id} style={itemCardStyle}>
          <div style={{ fontWeight: 600, color: "#344054" }}>{item.label}</div>
          <ol style={pathStepListStyle}>
            {item.steps.map((step, index) => (
              <li key={`${item.id}-${index}`} style={{ fontSize: 12, color: "#475467" }}>
                <div style={metaTextStyle}>
                  {step.relationType ? relationTypeLabel(step.relationType) : "起点"}
                </div>
                <NodeLabel node={step.node} onNavigate={onNavigate} />
                {step.rationale ? <div style={rationaleStyle}>{step.rationale}</div> : null}
              </li>
            ))}
          </ol>
        </li>
      ))}
    </ul>
  );
}

function ConflictList({ items, onNavigate }: { items: GraphConflictItem[]; onNavigate: (node: GraphNodeRef) => void | Promise<void> }) {
  if (items.length === 0) {
    return <div style={emptySectionTextStyle}>暂无冲突</div>;
  }

  return (
    <ul style={itemListStyle}>
      {items.map((item) => (
        <li key={item.relationId} style={itemCardStyle}>
          <div style={metaRowStyle}>
            <span style={metaTextStyle}>{relationTypeLabel(item.relationType)} | {relationDirectionLabel(item.direction)}</span>
          </div>
          <NodeLabel node={item.counterparty} onNavigate={onNavigate} />
          {item.rationale ? <div style={rationaleStyle}>{item.rationale}</div> : null}
        </li>
      ))}
    </ul>
  );
}

function CandidateList({
  items,
  currentNoteId,
  currentNoteTitle,
  pendingCandidateId,
  onAccept,
  onIgnore,
}: {
  items: GraphCandidateRelation[];
  currentNoteId: string;
  currentNoteTitle: string;
  pendingCandidateId: string | null;
  onAccept: (candidateId: string, relationType?: RelationType, description?: string) => void;
  onIgnore: (candidateId: string) => void;
}) {
  if (items.length === 0) {
    return <div style={emptySectionTextStyle}>暂无候选关系</div>;
  }

  return (
    <ul style={itemListStyle}>
      {items.map((item) => {
        const isPending = pendingCandidateId === item.id;

        return (
          <CandidateCard
            key={item.id}
            item={item}
            currentNoteId={currentNoteId}
            currentNoteTitle={currentNoteTitle}
            isPending={isPending}
            onAccept={onAccept}
            onIgnore={onIgnore}
          />
        );
      })}
    </ul>
  );
}

function CandidateCard({
  item,
  currentNoteId,
  currentNoteTitle,
  isPending,
  onAccept,
  onIgnore,
}: {
  item: GraphCandidateRelation;
  currentNoteId: string;
  currentNoteTitle: string;
  isPending: boolean;
  onAccept: (candidateId: string, relationType?: RelationType, description?: string) => void;
  onIgnore: (candidateId: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedRelationType, setEditedRelationType] = useState<RelationType>(item.relationType);
  const [editedDescription, setEditedDescription] = useState(item.rationale);

  return (
    <li style={itemCardStyle}>
      <div style={metaRowStyle}>
        <span style={metaTextStyle}>候选 | {relationTypeLabel(item.relationType)}</span>
        {item.providerName ? <span style={metaTextStyle}>{item.providerName}</span> : null}
      </div>
      <div style={{ fontSize: 12, color: "#475467" }}>{buildCandidateEndpointLabel(item, currentNoteId, currentNoteTitle)}</div>
      <div style={rationaleStyle}>{item.rationale}</div>
      {item.evidenceExcerpt ? <div style={{ ...rationaleStyle, color: "#667085" }}>{item.evidenceExcerpt}</div> : null}
      {isEditing ? (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#475467" }}>
            关系类型
            <select
              aria-label={`编辑候选关系类型 ${item.id}`}
              disabled={isPending}
              value={editedRelationType}
              onChange={(event) => setEditedRelationType(event.target.value as RelationType)}
              style={inlineFieldStyle}
            >
              {Object.entries(relationTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#475467" }}>
            说明
            <textarea
              aria-label={`编辑候选说明 ${item.id}`}
              disabled={isPending}
              value={editedDescription}
              onChange={(event) => setEditedDescription(event.target.value)}
              rows={3}
              style={{ ...inlineFieldStyle, resize: "vertical" }}
            />
          </label>
        </div>
      ) : null}
      <div style={actionRowStyle}>
        <button
          type="button"
          aria-label="采纳候选关系"
          disabled={isPending}
          onClick={() => onAccept(item.id)}
          style={{
            ...primaryButtonStyle,
            cursor: isPending ? "default" : primaryButtonStyle.cursor,
            opacity: isPending ? 0.6 : 1,
          }}
        >
          采纳
        </button>
        <button
          type="button"
          aria-label="编辑后采纳候选关系"
          disabled={isPending}
          onClick={() => {
            if (isEditing) {
              onAccept(item.id, editedRelationType, editedDescription.trim());
              return;
            }
            setIsEditing(true);
          }}
          style={{
            ...actionButtonStyle,
            cursor: isPending ? "default" : actionButtonStyle.cursor,
            opacity: isPending ? 0.6 : 1,
          }}
        >
          {isEditing ? "保存后采纳" : "编辑后采纳"}
        </button>
        <button
          type="button"
          aria-label="忽略候选关系"
          disabled={isPending}
          onClick={() => onIgnore(item.id)}
          style={{
            ...actionButtonStyle,
            cursor: isPending ? "default" : actionButtonStyle.cursor,
            opacity: isPending ? 0.6 : 1,
          }}
        >
          忽略
        </button>
      </div>
    </li>
  );
}

function NodeLabel({ node, onNavigate }: { node: GraphNodeRef; onNavigate: (node: GraphNodeRef) => void | Promise<void> }) {
  const label = buildNodeCaption(node);

  if (!isNodeNavigable(node)) {
    return <div style={{ fontWeight: 600, color: "#344054" }}>{label}</div>;
  }

  return (
    <button type="button" onClick={() => void onNavigate(node)} style={nodeButtonStyle}>
      {label}
    </button>
  );
}