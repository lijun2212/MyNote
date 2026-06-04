import "./WelcomeScreen.css";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api/commands";
import { useAppStore } from "../store/useAppStore";

const valuePoints = [
  "随手写下此刻的生活与念头",
  "随时找回那些重要的片段",
  "让零散记录慢慢沉淀成自己的脉络",
];

function getDefaultKnowledgeBaseName(path: string) {
  const segments = path
    .split(/[\\/]/)
    .filter(Boolean);
  const lastSegment = segments[segments.length - 1];

  return lastSegment || "我的知识库";
}

export function WelcomeScreen() {
  const { setKb, refreshTree, setError } = useAppStore();

  async function handleCreate() {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected || Array.isArray(selected)) return;

      setError(null);
      const name = getDefaultKnowledgeBaseName(selected);
      const kb = await api.createKnowledgeBase(selected, name);
      setKb(kb);
      await refreshTree();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleOpen() {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected || Array.isArray(selected)) return;

      setError(null);
      const kb = await api.openKnowledgeBase(selected);
      setKb(kb);
      await refreshTree();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <main data-testid="welcome-screen" className="welcome-screen">
      <section className="welcome-screen__content">
        <div>
          <p className="welcome-screen__eyebrow">
            写给自己的笔记本
          </p>
          <h1 className="welcome-screen__title">把日子、想法和成长，慢慢记下来</h1>
        </div>
        <div className="welcome-screen__body">
          <p>
            就像学生时代整理课本和笔记那样，熟悉、自然，不需要重新学习怎么开始。
          </p>
          <p>
            想到什么，就先写下来；过些时候再回来看，它们会一点点连成你的日常、你的知识，也连成你自己。
          </p>
        </div>
        <ul className="welcome-screen__values">
          {valuePoints.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <div className="welcome-screen__supporting-copy">
          <p>MyNote 不只是帮你保存内容。</p>
          <p>
            它也陪你把每天的记录、一路的学习和长久的积累，慢慢整理成更清楚的理解，内化成真正属于你的能力。
          </p>
        </div>
        <div className="welcome-screen__actions">
          <button
            type="button"
            onClick={handleCreate}
            className="welcome-screen__button welcome-screen__button--primary"
          >
            新建知识库
          </button>
          <button
            type="button"
            onClick={handleOpen}
            className="welcome-screen__button welcome-screen__button--secondary"
          >
            打开知识库
          </button>
        </div>
      </section>
      <aside className="welcome-screen__scene" aria-label="欢迎页场景区">
        <div className="welcome-screen__scene-board">
          <article
            className="welcome-note-sheet"
            data-testid="welcome-note-sheet"
          >
            <span className="welcome-note-sheet__pin" aria-hidden="true" />
            <h2 className="welcome-note-sheet__heading">把零散的记录，慢慢放回自己的页边</h2>
            <p className="welcome-note-sheet__lede">
              从一个念头、一段日常，到一次整理、一条连接，都会在这里留下温和而清楚的痕迹。
            </p>
            <ol className="welcome-note-sheet__path" aria-label="记录整理路径">
              <li className="welcome-note-sheet__path-step">记下</li>
              <li className="welcome-note-sheet__path-arrow" aria-hidden="true">→</li>
              <li className="welcome-note-sheet__path-step">整理</li>
              <li className="welcome-note-sheet__path-arrow" aria-hidden="true">→</li>
              <li className="welcome-note-sheet__path-step">脉络</li>
            </ol>
          </article>

          <section className="welcome-note-card welcome-note-card--daily" aria-label="日常片段卡片">
            <span className="welcome-note-card__label">日常片段</span>
            <span className="welcome-note-card__line" aria-hidden="true" />
            <span className="welcome-note-card__line welcome-note-card__line--short" aria-hidden="true" />
            <span className="welcome-note-card__line" aria-hidden="true" />
          </section>

          <section className="welcome-note-card welcome-note-card--knowledge" aria-label="知识摘记卡片">
            <span className="welcome-note-card__label">知识摘记</span>
            <span className="welcome-note-card__line" aria-hidden="true" />
            <span className="welcome-note-card__line" aria-hidden="true" />
            <span className="welcome-note-card__line welcome-note-card__line--short" aria-hidden="true" />
          </section>
        </div>
      </aside>
    </main>
  );
}
