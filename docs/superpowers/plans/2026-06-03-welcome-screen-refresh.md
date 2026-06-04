# Welcome Screen Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the MyNote welcome screen so it reads like a warm, familiar personal notebook while preserving the existing create/open knowledge-base flows.

**Architecture:** Keep the current `WelcomeScreen` behavior and Tauri dialog flow intact, but replace the scaffold-like centered stack with a two-column welcome layout. Implement the richer presentation with a dedicated component stylesheet and lock the copy, scene structure, and CTA behavior with focused RTL tests.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, React Testing Library, Tauri dialog plugin mocks

---

# 修订记录

| 日期 | 版本 | 说明 |
| --- | --- | --- |
| 2026-06-03 | v1.0 | 基于已确认 welcome screen spec，拆分欢迎页文案、场景和交互保真改造计划。 |

# 目录

1. 文件结构
2. Task 1: 欢迎页文案骨架
3. Task 2: 场景表达与交互保真
4. 验证命令

# 文件结构

- Modify: `/Users/lijun/mynote/src/components/WelcomeScreen.tsx`
  - 负责欢迎页 JSX 结构、按钮事件、文案常量和场景数据。
- Create: `/Users/lijun/mynote/src/components/WelcomeScreen.css`
  - 负责欢迎页局部布局、暖米白背景、纸页卡片、响应式和轻量动效。
- Create: `/Users/lijun/mynote/src/components/WelcomeScreen.test.tsx`
  - 负责欢迎页文案、结构、场景元素与 create/open CTA 回归测试。

### Task 1: 欢迎页文案骨架

**Files:**
- Modify: `/Users/lijun/mynote/src/components/WelcomeScreen.tsx`
- Create: `/Users/lijun/mynote/src/components/WelcomeScreen.test.tsx`
- Test: `/Users/lijun/mynote/src/components/WelcomeScreen.test.tsx`

- [ ] **Step 1: Write the failing render test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WelcomeScreen } from "./WelcomeScreen";

describe("WelcomeScreen", () => {
  it("renders the warm notebook-oriented welcome copy", () => {
    render(<WelcomeScreen />);

    expect(screen.getByText("写给自己的笔记本")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "把日子、想法和成长，慢慢记下来" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("就像学生时代整理课本和笔记那样，熟悉、自然，不需要重新学习怎么开始。"),
    ).toBeInTheDocument();
    expect(screen.getByText("随手写下此刻的生活与念头")).toBeInTheDocument();
    expect(screen.getByText("随时找回那些重要的片段")).toBeInTheDocument();
    expect(screen.getByText("让零散记录慢慢沉淀成自己的脉络")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建知识库" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开知识库" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && corepack pnpm vitest run src/components/WelcomeScreen.test.tsx`

Expected: FAIL because the current welcome screen only renders `MyNote` and `个人 Markdown 知识库`, and none of the new copy exists yet.

- [ ] **Step 3: Replace the scaffold welcome markup with the approved copy skeleton**

```tsx
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api/commands";
import { useAppStore } from "../store/useAppStore";

const valuePoints = [
  "随手写下此刻的生活与念头",
  "随时找回那些重要的片段",
  "让零散记录慢慢沉淀成自己的脉络",
];

export function WelcomeScreen() {
  const { setKb, refreshTree, setError } = useAppStore();

  async function handleCreate() {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) return;
    const name = selected.split("/").pop() || "我的知识库";
    try {
      const kb = await api.createKnowledgeBase(selected, name);
      setKb(kb);
      await refreshTree();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleOpen() {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) return;
    try {
      const kb = await api.openKnowledgeBase(selected);
      setKb(kb);
      await refreshTree();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <main className="welcome-screen" data-testid="welcome-screen">
      <section className="welcome-screen__content">
        <p className="welcome-screen__eyebrow">写给自己的笔记本</p>
        <h1 className="welcome-screen__title">把日子、想法和成长，慢慢记下来</h1>
        <div className="welcome-screen__body">
          <p>就像学生时代整理课本和笔记那样，熟悉、自然，不需要重新学习怎么开始。</p>
          <p>想到什么，就先写下来；过些时候再回来看，它们会一点点连成你的日常、你的知识，也连成你自己。</p>
        </div>
        <ul className="welcome-screen__values">
          {valuePoints.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <div className="welcome-screen__supporting-copy">
          <p>MyNote 不只是帮你保存内容。</p>
          <p>它也陪你把每天的记录、一路的学习和长久的积累，慢慢整理成更清楚的理解，内化成真正属于你的能力。</p>
        </div>
        <div className="welcome-screen__actions">
          <button className="welcome-screen__button welcome-screen__button--primary" onClick={handleCreate}>
            新建知识库
          </button>
          <button className="welcome-screen__button welcome-screen__button--secondary" onClick={handleOpen}>
            打开知识库
          </button>
        </div>
      </section>

      <aside className="welcome-screen__scene" aria-label="欢迎页场景区" />
    </main>
  );
}
```

- [ ] **Step 4: Run the test to verify the copy passes**

Run: `cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && corepack pnpm vitest run src/components/WelcomeScreen.test.tsx`

Expected: PASS with 1 test passing.

- [ ] **Step 5: Commit**

```bash
cd /Users/lijun/mynote
git add src/components/WelcomeScreen.tsx src/components/WelcomeScreen.test.tsx
git commit -m "feat: add warm welcome screen copy"
```

### Task 2: 场景表达与交互保真

**Files:**
- Modify: `/Users/lijun/mynote/src/components/WelcomeScreen.tsx`
- Create: `/Users/lijun/mynote/src/components/WelcomeScreen.css`
- Modify: `/Users/lijun/mynote/src/components/WelcomeScreen.test.tsx`
- Test: `/Users/lijun/mynote/src/components/WelcomeScreen.test.tsx`

- [ ] **Step 1: Expand the test to cover scene structure and CTA behavior**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tauriMocks } from "../test/setup";
import { useAppStore } from "../store/useAppStore";
import { WelcomeScreen } from "./WelcomeScreen";

describe("WelcomeScreen", () => {
  beforeEach(() => {
    tauriMocks.invoke.mockReset();
    tauriMocks.openDialog.mockReset();
    useAppStore.setState(useAppStore.getInitialState(), true);
  });

  it("renders the warm notebook-oriented welcome copy", () => {
    render(<WelcomeScreen />);

    expect(screen.getByText("写给自己的笔记本")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "把日子、想法和成长，慢慢记下来" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("就像学生时代整理课本和笔记那样，熟悉、自然，不需要重新学习怎么开始。"),
    ).toBeInTheDocument();
    expect(screen.getByText("随手写下此刻的生活与念头")).toBeInTheDocument();
    expect(screen.getByText("随时找回那些重要的片段")).toBeInTheDocument();
    expect(screen.getByText("让零散记录慢慢沉淀成自己的脉络")).toBeInTheDocument();
  });

  it("renders the notebook scene and value path", () => {
    render(<WelcomeScreen />);

    expect(screen.getByLabelText("欢迎页场景区")).toBeInTheDocument();
    expect(screen.getByTestId("welcome-note-sheet")).toBeInTheDocument();
    expect(screen.getByText("日常片段")).toBeInTheDocument();
    expect(screen.getByText("知识摘记")).toBeInTheDocument();
    expect(screen.getByText("记下")).toBeInTheDocument();
    expect(screen.getByText("整理")).toBeInTheDocument();
    expect(screen.getByText("脉络")).toBeInTheDocument();
  });

  it("keeps the create and open knowledge-base flows working", async () => {
    const user = userEvent.setup();
    const refreshTree = vi.fn().mockResolvedValue(undefined);
    const createKnowledgeBase = {
      id: "kb-1",
      name: "我的知识库",
      root_path: "/Users/lijun/Documents/我的知识库",
      created_at: "2026-06-03T00:00:00Z",
      updated_at: "2026-06-03T00:00:00Z",
    };
    const openKnowledgeBase = {
      id: "kb-2",
      name: "已有知识库",
      root_path: "/Users/lijun/Documents/已有知识库",
      created_at: "2026-06-03T00:00:00Z",
      updated_at: "2026-06-03T00:00:00Z",
    };

    useAppStore.setState({ refreshTree, setError: vi.fn() });
    tauriMocks.openDialog.mockResolvedValue("/Users/lijun/Documents/我的知识库");
    tauriMocks.invoke.mockResolvedValueOnce(createKnowledgeBase);
    tauriMocks.invoke.mockResolvedValueOnce(openKnowledgeBase);

    render(<WelcomeScreen />);

    await user.click(screen.getByRole("button", { name: "新建知识库" }));

    expect(tauriMocks.openDialog).toHaveBeenCalledWith({ directory: true, multiple: false });
    expect(tauriMocks.invoke).toHaveBeenCalledWith("create_knowledge_base", {
      rootPath: "/Users/lijun/Documents/我的知识库",
      name: "我的知识库",
    });

    await waitFor(() => {
      expect(useAppStore.getState().kb).toEqual(createKnowledgeBase);
      expect(refreshTree).toHaveBeenCalled();
    });

    tauriMocks.openDialog.mockResolvedValueOnce("/Users/lijun/Documents/已有知识库");

    await user.click(screen.getByRole("button", { name: "打开知识库" }));

    expect(tauriMocks.invoke).toHaveBeenCalledWith("open_knowledge_base", {
      rootPath: "/Users/lijun/Documents/已有知识库",
    });

    await waitFor(() => {
      expect(useAppStore.getState().kb).toEqual(openKnowledgeBase);
      expect(refreshTree).toHaveBeenCalledTimes(2);
    });
  });
});
```

- [ ] **Step 2: Run the expanded test to verify it fails**

Run: `cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && corepack pnpm vitest run src/components/WelcomeScreen.test.tsx`

Expected: FAIL because the scene container is still empty, `welcome-note-sheet` is missing, and the scene labels do not exist.

- [ ] **Step 3: Add the paper-like scene markup and component stylesheet**

```tsx
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api/commands";
import { useAppStore } from "../store/useAppStore";
import "./WelcomeScreen.css";

const valuePoints = [
  "随手写下此刻的生活与念头",
  "随时找回那些重要的片段",
  "让零散记录慢慢沉淀成自己的脉络",
];

const sceneSteps = ["记下", "整理", "脉络"];

export function WelcomeScreen() {
  const { setKb, refreshTree, setError } = useAppStore();

  async function handleCreate() {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) return;
    const name = selected.split("/").pop() || "我的知识库";
    try {
      const kb = await api.createKnowledgeBase(selected, name);
      setKb(kb);
      await refreshTree();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleOpen() {
    const selected = await open({ directory: true, multiple: false });
    if (!selected || Array.isArray(selected)) return;
    try {
      const kb = await api.openKnowledgeBase(selected);
      setKb(kb);
      await refreshTree();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <main className="welcome-screen" data-testid="welcome-screen">
      <section className="welcome-screen__content">
        <p className="welcome-screen__eyebrow">写给自己的笔记本</p>
        <h1 className="welcome-screen__title">把日子、想法和成长，慢慢记下来</h1>
        <div className="welcome-screen__body">
          <p>就像学生时代整理课本和笔记那样，熟悉、自然，不需要重新学习怎么开始。</p>
          <p>想到什么，就先写下来；过些时候再回来看，它们会一点点连成你的日常、你的知识，也连成你自己。</p>
        </div>
        <ul className="welcome-screen__values">
          {valuePoints.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <div className="welcome-screen__supporting-copy">
          <p>MyNote 不只是帮你保存内容。</p>
          <p>它也陪你把每天的记录、一路的学习和长久的积累，慢慢整理成更清楚的理解，内化成真正属于你的能力。</p>
        </div>
        <div className="welcome-screen__actions">
          <button className="welcome-screen__button welcome-screen__button--primary" onClick={handleCreate}>
            新建知识库
          </button>
          <button className="welcome-screen__button welcome-screen__button--secondary" onClick={handleOpen}>
            打开知识库
          </button>
        </div>
      </section>

      <aside className="welcome-screen__scene" aria-label="欢迎页场景区">
        <div className="welcome-screen__paper" data-testid="welcome-note-sheet">
          <span className="welcome-screen__paper-label">今日笔记</span>
          <h2>把想到的先记下来</h2>
          <p>今天的心情、刚读到的一句好话、一个还没成熟的念头，都值得先留在纸页上。</p>
        </div>

        <div className="welcome-screen__mini-card welcome-screen__mini-card--daily">
          <span>日常片段</span>
          <p>把日子里的小事，安静地留下来。</p>
        </div>

        <div className="welcome-screen__mini-card welcome-screen__mini-card--knowledge">
          <span>知识摘记</span>
          <p>把读过、想过、学过的内容慢慢整理清楚。</p>
        </div>

        <div className="welcome-screen__path" aria-hidden="true">
          {sceneSteps.map((step) => (
            <div key={step} className="welcome-screen__path-step">
              <span className="welcome-screen__path-dot" />
              <span>{step}</span>
            </div>
          ))}
        </div>
      </aside>
    </main>
  );
}
```

```css
.welcome-screen {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(0, 6fr) minmax(320px, 5fr);
  gap: 48px;
  align-items: center;
  padding: 56px 72px;
  background:
    radial-gradient(circle at top left, rgba(201, 220, 186, 0.35), transparent 32%),
    radial-gradient(circle at bottom right, rgba(232, 214, 176, 0.28), transparent 30%),
    linear-gradient(180deg, #f7f2e8 0%, #f4efe6 100%);
}

.welcome-screen__content {
  max-width: 640px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  color: #293224;
}

.welcome-screen__eyebrow {
  font-size: 13px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #6a7a5d;
}

.welcome-screen__title {
  font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
  font-size: clamp(40px, 5vw, 58px);
  line-height: 1.08;
  color: #24311e;
}

.welcome-screen__body,
.welcome-screen__supporting-copy {
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 17px;
  line-height: 1.8;
  color: #4c5844;
}

.welcome-screen__values {
  list-style: none;
  display: grid;
  gap: 10px;
  margin-top: 8px;
}

.welcome-screen__values li::before {
  content: "•";
  color: #66915b;
  margin-right: 10px;
}

.welcome-screen__actions {
  display: flex;
  gap: 14px;
  padding-top: 10px;
}

.welcome-screen__button {
  min-width: 148px;
  padding: 12px 22px;
  border-radius: 999px;
  font-size: 15px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: transform 160ms ease, box-shadow 160ms ease, background 160ms ease;
}

.welcome-screen__button:hover {
  transform: translateY(-1px);
}

.welcome-screen__button--primary {
  background: #567a49;
  color: #fffdf8;
  box-shadow: 0 14px 30px rgba(86, 122, 73, 0.2);
}

.welcome-screen__button--secondary {
  background: rgba(255, 251, 244, 0.92);
  color: #394235;
  border-color: rgba(115, 130, 103, 0.28);
}

.welcome-screen__scene {
  position: relative;
  min-height: 520px;
}

.welcome-screen__paper,
.welcome-screen__mini-card {
  position: absolute;
  border-radius: 28px;
  background: rgba(255, 252, 246, 0.92);
  border: 1px solid rgba(190, 180, 158, 0.45);
  box-shadow: 0 20px 55px rgba(111, 106, 91, 0.14);
}

.welcome-screen__paper {
  top: 28px;
  left: 18px;
  width: min(100%, 420px);
  padding: 28px 28px 30px;
}

.welcome-screen__paper-label,
.welcome-screen__mini-card span {
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #78906d;
}

.welcome-screen__mini-card {
  width: 230px;
  padding: 18px 18px 20px;
}

.welcome-screen__mini-card--daily {
  right: 18px;
  top: 110px;
}

.welcome-screen__mini-card--knowledge {
  right: 58px;
  top: 262px;
}

.welcome-screen__path {
  position: absolute;
  left: 56px;
  right: 74px;
  bottom: 26px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-radius: 999px;
  background: rgba(243, 236, 221, 0.76);
}

.welcome-screen__path-step {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #596652;
  font-size: 14px;
}

.welcome-screen__path-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #6d935f;
}

@media (max-width: 980px) {
  .welcome-screen {
    grid-template-columns: 1fr;
    padding: 40px 24px 56px;
    gap: 28px;
  }

  .welcome-screen__scene {
    min-height: auto;
    display: grid;
    gap: 16px;
  }

  .welcome-screen__paper,
  .welcome-screen__mini-card,
  .welcome-screen__path {
    position: static;
    width: 100%;
  }

  .welcome-screen__actions {
    flex-direction: column;
  }
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && corepack pnpm vitest run src/components/WelcomeScreen.test.tsx`

Expected: PASS with 3 tests passing.

- [ ] **Step 5: Run the build to verify the welcome screen compiles cleanly**

Run: `cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && corepack pnpm build`

Expected: PASS with the existing chunk-size warning only.

- [ ] **Step 6: Commit**

```bash
cd /Users/lijun/mynote
git add src/components/WelcomeScreen.tsx src/components/WelcomeScreen.css src/components/WelcomeScreen.test.tsx
git commit -m "feat: redesign welcome screen"
```

# 验证命令

- Focused test: `cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && corepack pnpm vitest run src/components/WelcomeScreen.test.tsx`
- App build: `cd /Users/lijun/mynote && export PATH="$HOME/.npm-global/bin:$PATH" && corepack pnpm build`