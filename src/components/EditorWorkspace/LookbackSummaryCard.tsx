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
}

const sectionLabelStyle = {
  fontSize: 11,
  fontWeight: 600,
  color: "#5f6b7a",
  letterSpacing: 0.2,
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
}: LookbackSummaryCardProps) {
  const hasSavedSummary = savedSummary !== null;
  const [isEditing, setIsEditing] = useState(!hasSavedSummary);
  const canSave = !isSaving && (candidate.trim().length > 0 || hasSavedSummary);

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
            {hasSavedSummary && !isEditing ? "已保存摘要默认只读，可按需进入编辑或重新生成" : "可手动录入、生成并保存候选摘要内容"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          {hasSavedSummary && !isEditing ? (
            <>
              <button
                type="button"
                onClick={handleEdit}
                style={{
                  fontSize: 12,
                  padding: "4px 10px",
                  cursor: "pointer",
                  borderRadius: 4,
                  border: "1px solid #c6cfdb",
                  background: "#ffffff",
                  color: "#243041",
                }}
              >
                编辑摘要
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isGenerating}
                style={{
                  fontSize: 12,
                  padding: "4px 10px",
                  cursor: isGenerating ? "default" : "pointer",
                  borderRadius: 4,
                  border: "1px solid #c6cfdb",
                  background: "#ffffff",
                  color: "#243041",
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
                  fontSize: 12,
                  padding: "4px 10px",
                  cursor: isGenerating ? "default" : "pointer",
                  borderRadius: 4,
                  border: "1px solid #c6cfdb",
                  background: "#ffffff",
                  color: "#243041",
                }}
              >
                {isGenerating ? "生成中..." : hasSavedSummary ? "重新生成" : "生成摘要"}
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={!canSave}
                style={{
                  fontSize: 12,
                  padding: "4px 10px",
                  cursor: canSave ? "pointer" : "default",
                  borderRadius: 4,
                  border: "1px solid #b7c3d4",
                  background: canSave ? "#eef3f9" : "#f5f7fa",
                  color: canSave ? "#243041" : "#8a95a3",
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