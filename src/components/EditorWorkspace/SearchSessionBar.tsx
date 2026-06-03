interface SearchSessionBarProps {
  query: string;
  currentIndex: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
  onExit: () => void;
}

export function SearchSessionBar({
  query,
  currentIndex,
  total,
  onPrevious,
  onNext,
  onExit,
}: SearchSessionBarProps) {
  const displayIndex = total > 0 ? currentIndex + 1 : 0;
  const isPreviousDisabled = total === 0 || currentIndex <= 0;
  const isNextDisabled = total === 0 || currentIndex >= total - 1;

  return (
    <div
      aria-label="搜索会话状态条"
      style={{
        minHeight: 34,
        borderTop: "1px solid #e0e2e7",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 12px",
        background: "#fbfcfe",
        fontSize: 12,
        color: "#4a5568",
        flexShrink: 0,
      }}
    >
      <span style={{ fontWeight: 500, color: "#1f2937" }}>搜索会话：{query}</span>
      <span aria-label="当前命中计数">{displayIndex} / {total}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          type="button"
          onClick={onPrevious}
          disabled={isPreviousDisabled}
          aria-label="上一个命中"
          style={buttonStyle(isPreviousDisabled)}
        >
          上一个
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={isNextDisabled}
          aria-label="下一个命中"
          style={buttonStyle(isNextDisabled)}
        >
          下一个
        </button>
      </div>
      <span style={{ color: "#6b7280" }}>快捷键提示：上一项 / 下一项 / 退出</span>
      <div style={{ flex: 1 }} />
      <button
        type="button"
        onClick={onExit}
        aria-label="退出搜索会话"
        style={{
          padding: "3px 8px",
          borderRadius: 4,
          border: "1px solid #d0d7e2",
          background: "#ffffff",
          color: "#374151",
          cursor: "pointer",
        }}
      >
        退出
      </button>
    </div>
  );
}

function buttonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "3px 8px",
    borderRadius: 4,
    border: "1px solid #d0d7e2",
    background: disabled ? "#f3f4f6" : "#ffffff",
    color: disabled ? "#9ca3af" : "#374151",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}