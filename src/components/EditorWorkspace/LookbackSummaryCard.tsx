import { useEffect, useState } from "react";

export interface LookbackSummaryCardProps {
  savedSummary: string | null;
  candidate: string;
  isGenerating: boolean;
  isSaving: boolean;
  error: string | null;
  onCandidateChange: (value: string) => void;
  onGenerate: () => void | Promise<void>;
  onSave: () => void | Promise<void>;
  onDeleteSummary: () => void | Promise<void>;
}

const sectionLabelStyle = {
  fontSize: 11,
  fontWeight: 600,
  color: "#5f6b7a",
  letterSpacing: 0.2,
};

const secondaryButtonStyle = {
  fontSize: 12,
  padding: "4px 10px",
  borderRadius: 6,
  border: "1px solid #cbd5e1",
  background: "#ffffff",
  color: "#334155",
};

const primaryButtonStyle = {
  fontSize: 12,
  padding: "4px 10px",
  borderRadius: 6,
  border: "1px solid #2563eb",
  background: "#2563eb",
  color: "#ffffff",
  boxShadow: "0 1px 2px rgba(37, 99, 235, 0.18)",
};

export function LookbackSummaryCard({
  savedSummary,
  candidate,
  isGenerating,
  isSaving,
  error,
  onCandidateChange,
  onGenerate,
  onSave,
  onDeleteSummary,
}: LookbackSummaryCardProps) {
  const hasSavedSummary = savedSummary !== null;
  const [isEditing, setIsEditing] = useState(!hasSavedSummary);
  const canSave = !isSaving && (candidate.trim().length > 0 || hasSavedSummary);
  const canDelete = hasSavedSummary || candidate.trim().length > 0;

  useEffect(() => {
    setIsEditing(!hasSavedSummary);
  }, [hasSavedSummary, savedSummary]);

  async function handleSave() {
    if (!canSave) {
      return;
    }

    await onSave();
  }

  function handleEdit() {
    setIsEditing(true);
  }

  function handleGenerate() {
    setIsEditing(true);
    void onGenerate();
  }

  const helperText = hasSavedSummary && !isEditing
    ? "已保存摘要默认只读，可按需进入编辑或重新生成"
    : "可手动录入、生成并保存候选摘要内容";

  return (
    <section
      aria-label="回看摘要"
      style={{
        borderBottom: "1px solid #e0e2e7",
        background: "#f7f9fc",
        padding: "12px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#243041" }}>回看摘要</div>
          <div style={{ fontSize: 11, color: "#6f7c8b", marginTop: 2 }}>
            {helperText}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => void onDeleteSummary()}
            disabled={!canDelete || isSaving}
            style={{
              ...secondaryButtonStyle,
              cursor: canDelete && !isSaving ? "pointer" : "default",
              border: canDelete ? "1px solid #e7c3c3" : "1px solid #fecaca",
              background: canDelete ? "#fff7f7" : "#fff5f5",
              color: canDelete ? "#8a2c2c" : "#d4a1a1",
              opacity: canDelete ? 1 : 0.72,
            }}
          >
            删除摘要
          </button>
          {hasSavedSummary && !isEditing ? (
            <>
              <button
                type="button"
                onClick={handleEdit}
                style={{
                  ...secondaryButtonStyle,
                  cursor: "pointer",
                }}
              >
                编辑摘要
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isGenerating}
                style={{
                  ...secondaryButtonStyle,
                  cursor: isGenerating ? "default" : "pointer",
                  opacity: isGenerating ? 0.72 : 1,
                }}
              >
                {isGenerating ? "生成中..." : "重新生成"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isGenerating}
                style={{
                  ...secondaryButtonStyle,
                  cursor: isGenerating ? "default" : "pointer",
                  opacity: isGenerating ? 0.72 : 1,
                }}
              >
                {isGenerating ? "生成中..." : hasSavedSummary ? "重新生成" : "生成摘要"}
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={!canSave}
                style={{
                  ...primaryButtonStyle,
                  cursor: canSave ? "pointer" : "default",
                  border: canSave ? primaryButtonStyle.border : "1px solid #bfdbfe",
                  background: canSave ? primaryButtonStyle.background : "#dbeafe",
                  color: canSave ? primaryButtonStyle.color : "#eff6ff",
                  boxShadow: canSave ? primaryButtonStyle.boxShadow : "none",
                  opacity: canSave ? 1 : 0.72,
                }}
              >
                {isSaving ? "保存中..." : "保存摘要"}
              </button>
            </>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: hasSavedSummary && isEditing ? "minmax(0, 1fr) minmax(0, 1fr)" : "minmax(0, 1fr)", gap: 12 }}>
        {hasSavedSummary && (
          <div style={{ minWidth: 0 }}>
            <div style={sectionLabelStyle}>已保存</div>
            <div
              style={{
                marginTop: 6,
                minHeight: 74,
                borderRadius: 6,
                border: "1px solid #dbe2eb",
                background: "#ffffff",
                padding: "10px 12px",
                fontSize: 12,
                lineHeight: 1.6,
                color: "#243041",
                whiteSpace: "pre-wrap",
              }}
            >
              {savedSummary}
            </div>
          </div>
        )}

        {(!hasSavedSummary || isEditing) && (
          <label style={{ minWidth: 0, display: "block" }}>
            <span style={sectionLabelStyle}>{hasSavedSummary ? "候选内容" : "摘要内容"}</span>
            <textarea
              aria-label="回看摘要候选内容"
              value={candidate}
              onChange={(event) => onCandidateChange(event.target.value)}
              spellCheck={false}
              placeholder={hasSavedSummary ? undefined : "可输入或生成当前笔记的回看摘要"}
              style={{
                marginTop: 6,
                width: "100%",
                minHeight: 96,
                resize: "vertical",
                borderRadius: 6,
                border: "1px solid #cfd8e3",
                background: "#ffffff",
                padding: "10px 12px",
                fontSize: 12,
                lineHeight: 1.6,
                color: "#243041",
                boxSizing: "border-box",
              }}
            />
          </label>
        )}
      </div>

      {error && (
        <div role="alert" style={{ fontSize: 12, color: "#b42318" }}>
          {error}
        </div>
      )}
    </section>
  );
}