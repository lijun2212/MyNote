# Knowledge Graph Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a current-note knowledge graph analysis flow that shows relation overview, logic paths, conflict analysis, and AI-generated candidate relations that require explicit user confirmation before they become formal graph edges.

**Architecture:** Reuse the existing note, outline, relation, and navigation pipelines instead of creating a separate graph product. Add a new backend graph-analysis slice that aggregates factual edges and confirmed semantic edges, exposes local analysis plus AI-generated candidate results, and render the results from a dedicated right-sidebar panel with a strict candidate-review boundary.

**Tech Stack:** Tauri 2, Rust, SQLite, React, TypeScript, Zustand, Vitest, Cargo tests

---

## File Structure

- Modify: `src-tauri/src/domain/relation.rs`
  Responsibility: extend the current relation model with the new semantic relation types and candidate status enums without breaking the existing manual relations flow.
- Create: `src-tauri/src/domain/graph.rs`
  Responsibility: define serializable DTOs for graph nodes, factual edges, candidate edges, analysis summaries, logic paths, conflict items, and AI generation requests/results.
- Modify: `src-tauri/src/infrastructure/db.rs`
  Responsibility: create and migrate SQLite tables for graph candidate relations and any supporting indexes.
- Create: `src-tauri/src/services/graph.rs`
  Responsibility: aggregate current-note factual edges, load confirmed semantic relations, compute local graph analysis, manage candidate lifecycle, and call the AI layer for structured suggestions.
- Create: `src-tauri/src/commands/graph.rs`
  Responsibility: expose Tauri commands for local graph analysis, AI candidate generation, and candidate acceptance/ignore actions.
- Modify: `src-tauri/src/commands/mod.rs`
  Responsibility: register the new graph command module.
- Modify: `src-tauri/src/lib.rs`
  Responsibility: wire new graph commands into `tauri::generate_handler!`.
- Modify: `src-tauri/src/services/relation.rs`
  Responsibility: reuse existing confirmed semantic relations as part of graph analysis and widen supported relation types.
- Modify: `src/api/commands.ts`
  Responsibility: add graph-analysis invoke wrappers and runtime mappers for new DTOs.
- Modify: `src/types/index.ts`
  Responsibility: define frontend graph-analysis types and candidate state enums.
- Create: `src/components/RightSidebar/GraphAnalysisPanel.tsx`
  Responsibility: fetch and render local graph analysis, trigger AI candidate generation, and manage candidate acceptance/ignore flows.
- Create: `src/components/RightSidebar/GraphAnalysisPanel.test.tsx`
  Responsibility: cover empty states, success states, AI candidate review flow, and navigation behavior.
- Modify: `src/components/RightSidebar/RightSidebar.tsx`
  Responsibility: add the new graph-analysis tab alongside outline and associations.
- Modify: `src/components/RightSidebar/RightSidebar.test.tsx`
  Responsibility: verify the new tab renders and switches correctly.

## Task 1: Extend relation domain and SQLite storage for graph candidates

**Files:**
- Modify: `src-tauri/src/domain/relation.rs`
- Modify: `src-tauri/src/infrastructure/db.rs`
- Test: `src-tauri/src/domain/relation.rs`
- Test: `src-tauri/src/infrastructure/db.rs`

- [ ] **Step 1: Write the failing Rust tests for widened relation types and candidate table creation**

```rust
#[test]
fn relation_type_parse_supports_graph_semantics() {
    assert_eq!(RelationType::parse("premise"), Some(RelationType::Premise));
    assert_eq!(RelationType::parse("conclusion"), Some(RelationType::Conclusion));
    assert_eq!(RelationType::parse("example"), Some(RelationType::Example));
    assert_eq!(RelationType::parse("rebuts"), Some(RelationType::Rebuts));
}

#[test]
fn init_db_creates_graph_candidate_relations_table() {
    let temp_dir = tempfile::tempdir().unwrap();
    let db_path = temp_dir.path().join("graph.sqlite");
    let conn = init_db(&db_path).unwrap();

    let table_name: String = conn.query_row(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'graph_candidate_relations'",
        [],
        |row| row.get(0),
    ).unwrap();

    assert_eq!(table_name, "graph_candidate_relations");
}
```

- [ ] **Step 2: Run the Rust tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml relation_type_parse_supports_graph_semantics init_db_creates_graph_candidate_relations_table`

Expected: FAIL because the new relation variants and candidate table do not exist yet.

- [ ] **Step 3: Extend `RelationType` and add candidate status types**

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RelationType {
    Related,
    Prerequisite,
    Extension,
    Opposes,
    Supports,
    Similar,
    Premise,
    Conclusion,
    Example,
    Rebuts,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GraphCandidateStatus {
    Pending,
    Accepted,
    Ignored,
}
```

- [ ] **Step 4: Create the SQLite table and indexes for candidate graph relations**

```rust
conn.execute_batch(
    r#"
    CREATE TABLE IF NOT EXISTS graph_candidate_relations (
        id TEXT PRIMARY KEY,
        source_note_id TEXT NOT NULL,
        source_heading_id TEXT,
        target_note_id TEXT NOT NULL,
        target_heading_id TEXT,
        relation_type TEXT NOT NULL,
        rationale TEXT NOT NULL,
        evidence_excerpt TEXT,
        candidate_status TEXT NOT NULL DEFAULT 'pending',
        provider_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        accepted_relation_id TEXT,
        FOREIGN KEY(source_note_id) REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY(target_note_id) REFERENCES notes(id) ON DELETE CASCADE,
        FOREIGN KEY(accepted_relation_id) REFERENCES relations(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_graph_candidate_relations_source_status
    ON graph_candidate_relations(source_note_id, candidate_status);

    CREATE INDEX IF NOT EXISTS idx_graph_candidate_relations_target_status
    ON graph_candidate_relations(target_note_id, candidate_status);
    "#,
)?;
```

- [ ] **Step 5: Run the Rust tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml relation_type_parse_supports_graph_semantics init_db_creates_graph_candidate_relations_table`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/domain/relation.rs src-tauri/src/infrastructure/db.rs
git commit -m "feat: add graph candidate relation storage"
```

## Task 2: Define graph-analysis DTOs and local analysis service

**Files:**
- Create: `src-tauri/src/domain/graph.rs`
- Create: `src-tauri/src/services/graph.rs`
- Modify: `src-tauri/src/services/relation.rs`
- Test: `src-tauri/src/services/graph.rs`

- [ ] **Step 1: Write the failing graph-analysis service test**

```rust
#[test]
fn analyze_note_graph_in_conn_returns_overview_paths_and_conflicts() {
    let conn = setup_graph_test_conn();
    seed_graph_note(&conn, "n1", "Alpha", "notes/alpha.md");
    seed_graph_note(&conn, "n2", "Beta", "notes/beta.md");
    seed_graph_note(&conn, "n3", "Gamma", "notes/gamma.md");
    create_relation_in_conn(&conn, "n2", "n1", "supports", Some("beta supports alpha".into())).unwrap();
    create_relation_in_conn(&conn, "n3", "n1", "opposes", Some("gamma conflicts with alpha".into())).unwrap();

    let analysis = analyze_note_graph_in_conn(&conn, "n1").unwrap();

    assert_eq!(analysis.note_id, "n1");
    assert_eq!(analysis.overview.confirmed_relations.len(), 2);
    assert_eq!(analysis.logic_paths.len(), 1);
    assert_eq!(analysis.logic_paths[0].steps.len(), 2);
    assert_eq!(analysis.conflicts.len(), 1);
    assert_eq!(analysis.conflicts[0].counterparty.note_id, "n3");
}
```

- [ ] **Step 2: Run the graph-analysis service test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml analyze_note_graph_in_conn_returns_overview_paths_and_conflicts`

Expected: FAIL because `domain::graph` and `analyze_note_graph_in_conn` do not exist yet.

- [ ] **Step 3: Define graph DTOs in a dedicated domain file**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNodeRef {
    pub note_id: String,
    pub note_title: String,
    pub note_path: String,
    pub heading_id: Option<String>,
    pub heading_text: Option<String>,
    pub line_start: Option<i64>,
    pub line_end: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphLogicPathStep {
    pub node: GraphNodeRef,
    pub relation_type: Option<RelationType>,
    pub rationale: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphConflictItem {
    pub relation_id: String,
    pub counterparty: GraphNodeRef,
    pub relation_type: RelationType,
    pub rationale: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteGraphAnalysis {
    pub note_id: String,
    pub overview: GraphOverview,
    pub logic_paths: Vec<GraphLogicPath>,
    pub conflicts: Vec<GraphConflictItem>,
    pub missing_premises: Vec<String>,
}
```

- [ ] **Step 4: Implement local graph aggregation and analysis**

```rust
pub fn analyze_note_graph_in_conn(conn: &Connection, note_id: &str) -> AppResult<NoteGraphAnalysis> {
    let focus = load_graph_node_ref(conn, note_id)?;
    let confirmed_relations = load_confirmed_graph_relations(conn, note_id)?;
    let factual_relations = load_factual_graph_relations(conn, note_id)?;

    let logic_paths = confirmed_relations
        .iter()
        .filter(|item| matches!(item.relation_type, RelationType::Supports | RelationType::Prerequisite | RelationType::Premise | RelationType::Example))
        .map(|item| GraphLogicPath {
            id: format!("path:{}:{}", note_id, item.id),
            label: format!("{} -> {}", item.note_title, focus.note_title),
            steps: vec![
                GraphLogicPathStep {
                    node: GraphNodeRef {
                        note_id: item.note_id.clone(),
                        note_title: item.note_title.clone(),
                        note_path: item.note_path.clone(),
                        heading_id: None,
                        heading_text: None,
                        line_start: None,
                        line_end: None,
                    },
                    relation_type: Some(item.relation_type),
                    rationale: item.description.clone(),
                },
                GraphLogicPathStep {
                    node: focus.clone(),
                    relation_type: None,
                    rationale: None,
                },
            ],
        })
        .collect::<Vec<_>>();

    let conflicts = confirmed_relations
        .iter()
        .filter(|item| matches!(item.relation_type, RelationType::Opposes | RelationType::Rebuts))
        .map(|item| GraphConflictItem {
            relation_id: item.id.clone(),
            counterparty: GraphNodeRef {
                note_id: item.note_id.clone(),
                note_title: item.note_title.clone(),
                note_path: item.note_path.clone(),
                heading_id: None,
                heading_text: None,
                line_start: None,
                line_end: None,
            },
            relation_type: item.relation_type,
            rationale: item.description.clone(),
        })
        .collect::<Vec<_>>();

    Ok(NoteGraphAnalysis {
        note_id: note_id.to_string(),
        overview: GraphOverview { confirmed_relations, factual_relations },
        logic_paths,
        conflicts,
        missing_premises: Vec::new(),
    })
}
```

- [ ] **Step 5: Run the graph-analysis service test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml analyze_note_graph_in_conn_returns_overview_paths_and_conflicts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/domain/graph.rs src-tauri/src/services/graph.rs src-tauri/src/services/relation.rs
git commit -m "feat: add local graph analysis service"
```

## Task 3: Expose graph analysis and candidate-review commands through Tauri

**Files:**
- Create: `src-tauri/src/commands/graph.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/services/graph.rs`
- Test: `src-tauri/src/services/graph.rs`

- [ ] **Step 1: Write the failing service test for candidate acceptance**

```rust
#[test]
fn accept_graph_candidate_creates_formal_relation_and_marks_candidate_accepted() {
    let conn = setup_graph_test_conn();
    seed_graph_note(&conn, "n1", "Alpha", "notes/alpha.md");
    seed_graph_note(&conn, "n2", "Beta", "notes/beta.md");
    let candidate_id = insert_graph_candidate_relation(
        &conn,
        NewGraphCandidateRelation {
            source_note_id: "n2".into(),
            source_heading_id: None,
            target_note_id: "n1".into(),
            target_heading_id: None,
            relation_type: RelationType::Supports,
            rationale: "beta supports alpha".into(),
            evidence_excerpt: Some("supporting excerpt".into()),
            provider_name: Some("anthropic".into()),
        },
    ).unwrap();

    let relation = accept_graph_candidate_in_conn(&conn, &candidate_id, None, None).unwrap();
    let status: String = conn.query_row(
        "SELECT candidate_status FROM graph_candidate_relations WHERE id = ?1",
        [&candidate_id],
        |row| row.get(0),
    ).unwrap();

    assert_eq!(relation.source_note_id, "n2");
    assert_eq!(relation.target_note_id, "n1");
    assert_eq!(status, "accepted");
}
```

- [ ] **Step 2: Run the service test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml accept_graph_candidate_creates_formal_relation_and_marks_candidate_accepted`

Expected: FAIL because candidate insert/accept helpers and graph commands do not exist yet.

- [ ] **Step 3: Implement candidate insert, list, accept, and ignore helpers in `services/graph.rs`**

```rust
pub fn accept_graph_candidate_in_conn(
    conn: &Connection,
    candidate_id: &str,
    relation_type_override: Option<RelationType>,
    rationale_override: Option<String>,
) -> AppResult<Relation> {
    let candidate = load_graph_candidate_relation(conn, candidate_id)?;
    let relation_type = relation_type_override.unwrap_or(candidate.relation_type);
    let description = rationale_override.or(Some(candidate.rationale.clone()));

    let relation = create_relation_in_conn(
        conn,
        &candidate.source_note_id,
        &candidate.target_note_id,
        relation_type.as_str(),
        description,
    )?;

    conn.execute(
        "UPDATE graph_candidate_relations SET candidate_status = 'accepted', accepted_relation_id = ?2, updated_at = ?3 WHERE id = ?1",
        rusqlite::params![candidate_id, relation.id, now_rfc3339()],
    )?;

    Ok(relation)
}

pub fn ignore_graph_candidate_in_conn(conn: &Connection, candidate_id: &str) -> AppResult<()> {
    let affected = conn.execute(
        "UPDATE graph_candidate_relations SET candidate_status = 'ignored', updated_at = ?2 WHERE id = ?1 AND candidate_status = 'pending'",
        rusqlite::params![candidate_id, now_rfc3339()],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("graph candidate not found: {candidate_id}")));
    }
    Ok(())
}
```

- [ ] **Step 4: Add Tauri graph commands and register them**

```rust
#[tauri::command]
pub async fn get_note_graph_analysis(
    state: State<'_, AppState>,
    note_id: String,
) -> Result<NoteGraphAnalysis, AppError> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No database open".into()))?;
    analyze_note_graph_in_conn(conn, &note_id)
}

#[tauri::command]
pub async fn accept_graph_candidate(
    state: State<'_, AppState>,
    candidate_id: String,
    relation_type: Option<String>,
    rationale: Option<String>,
) -> Result<Relation, AppError> {
    let db_guard = state.db.lock().unwrap();
    let conn = db_guard.as_ref().ok_or_else(|| AppError::InvalidInput("No database open".into()))?;
    let relation_type = relation_type.as_deref().and_then(RelationType::parse);
    accept_graph_candidate_in_conn(conn, &candidate_id, relation_type, rationale)
}
```

- [ ] **Step 5: Run the service test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml accept_graph_candidate_creates_formal_relation_and_marks_candidate_accepted`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/graph.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src-tauri/src/services/graph.rs
git commit -m "feat: expose graph analysis and candidate commands"
```

## Task 4: Add AI candidate generation on top of the existing LLM service

**Files:**
- Modify: `src-tauri/src/services/graph.rs`
- Test: `src-tauri/src/services/graph.rs`

- [ ] **Step 1: Write the failing service test for structured AI candidate generation parsing**

```rust
#[test]
fn generate_graph_candidates_parses_structured_llm_response() {
    let payload = r#"
    {
      "candidates": [
        {
          "source_note_id": "n2",
          "target_note_id": "n1",
          "relation_type": "supports",
          "rationale": "Beta provides supporting evidence for Alpha",
          "evidence_excerpt": "supporting excerpt"
        }
      ]
    }
    "#;

    let result = parse_graph_candidate_generation(payload).unwrap();

    assert_eq!(result.candidates.len(), 1);
    assert_eq!(result.candidates[0].relation_type, RelationType::Supports);
    assert_eq!(result.candidates[0].target_note_id, "n1");
}
```

- [ ] **Step 2: Run the service test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml generate_graph_candidates_parses_structured_llm_response`

Expected: FAIL because the parser and generation flow do not exist yet.

- [ ] **Step 3: Implement structured parsing and AI generation helpers**

```rust
#[derive(Debug, Deserialize)]
struct GraphCandidateGenerationPayload {
    candidates: Vec<GraphCandidateGenerationItem>,
}

pub fn parse_graph_candidate_generation(raw: &str) -> AppResult<GraphCandidateGenerationPayload> {
    serde_json::from_str(raw)
        .map_err(|error| AppError::InvalidInput(format!("invalid graph candidate payload: {error}")))
}

pub async fn generate_graph_candidates(
    state: &AppState,
    note_id: &str,
) -> AppResult<Vec<GraphCandidateRelation>> {
    let prompt = build_graph_candidate_prompt(state, note_id)?;
    let response = crate::services::ai::generate_structured_text(state, prompt).await?;
    let payload = parse_graph_candidate_generation(&response.text)?;
    persist_graph_candidates(state, payload.candidates)
}
```

- [ ] **Step 4: Add a focused AI prompt template with strict JSON output**

```rust
fn build_graph_candidate_prompt(state: &AppState, note_id: &str) -> AppResult<String> {
    let analysis = load_graph_generation_context(state, note_id)?;
    Ok(format!(
        "You are generating candidate semantic relations for a personal knowledge graph.\n\
Return strict JSON with shape {{\"candidates\": [...]}}.\n\
Only use relation types: supports, opposes, premise, conclusion, example, extension, similar, rebuts.\n\
Do not invent missing note ids.\n\
Context:\n{}",
        analysis,
    ))
}
```

- [ ] **Step 5: Run the service test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml generate_graph_candidates_parses_structured_llm_response`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/services/graph.rs
git commit -m "feat: add AI graph candidate generation"
```

## Task 5: Add frontend graph-analysis contracts and invoke wrappers

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/api/commands.ts`
- Test: `src/api/commands.ts` via existing frontend tests

- [ ] **Step 1: Write the failing frontend type-driven test for graph-analysis mapping**

```ts
it("maps raw graph analysis payloads into typed frontend contracts", async () => {
  invokeMock.mockResolvedValueOnce({
    note_id: "note-1",
    overview: {
      confirmed_relations: [],
      factual_relations: [{ id: "f1", source: { note_id: "note-2" }, target: { note_id: "note-1" }, relation_type: "supports", source_kind: "backlink" }],
      candidate_relations: [],
    },
    logic_paths: [],
    conflicts: [],
    missing_premises: [],
  });

  const result = await api.getNoteGraphAnalysis("note-1");

  expect(result.noteId).toBe("note-1");
  expect(result.overview.factualRelations[0].sourceKind).toBe("backlink");
});
```

- [ ] **Step 2: Run the frontend test to verify it fails**

Run: `corepack pnpm vitest run src/api/commands.test.ts`

Expected: FAIL because graph-analysis types and API wrappers do not exist yet.

- [ ] **Step 3: Add frontend graph-analysis types**

```ts
export type GraphCandidateStatus = "pending" | "accepted" | "ignored";

export interface GraphNodeRef {
  noteId: string;
  noteTitle: string;
  notePath: string;
  headingId: string | null;
  headingText: string | null;
  lineStart: number | null;
  lineEnd: number | null;
}

export interface NoteGraphAnalysis {
  noteId: string;
  overview: GraphOverview;
  logicPaths: GraphLogicPath[];
  conflicts: GraphConflictItem[];
  missingPremises: string[];
}
```

- [ ] **Step 4: Add invoke wrappers and raw-to-camel mappers**

```ts
async function getNoteGraphAnalysis(noteId: string): Promise<NoteGraphAnalysis> {
  const raw = await invoke<RawNoteGraphAnalysis>("get_note_graph_analysis", { noteId });
  return mapNoteGraphAnalysis(raw);
}

async function acceptGraphCandidate(candidateId: string, relationType?: RelationType, rationale?: string) {
  const raw = await invoke<RawRelation>("accept_graph_candidate", { candidateId, relationType, rationale });
  return mapRelation(raw);
}
```

- [ ] **Step 5: Run the frontend test to verify it passes**

Run: `corepack pnpm vitest run src/api/commands.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/api/commands.ts src/api/commands.test.ts
git commit -m "feat: add frontend graph analysis API contracts"
```

## Task 6: Build the right-sidebar graph analysis panel

**Files:**
- Create: `src/components/RightSidebar/GraphAnalysisPanel.tsx`
- Create: `src/components/RightSidebar/GraphAnalysisPanel.test.tsx`
- Modify: `src/components/RightSidebar/RightSidebar.tsx`
- Modify: `src/components/RightSidebar/RightSidebar.test.tsx`

- [ ] **Step 1: Write the failing component tests for empty, success, and candidate actions**

```tsx
it("shows empty state when there is no current note", () => {
  useEditorStore.setState({ currentNote: null });
  render(<GraphAnalysisPanel />);
  expect(screen.getByText("打开笔记后显示图谱分析")).toBeInTheDocument();
});

it("loads relation overview and logic paths for the current note", async () => {
  apiMocks.getNoteGraphAnalysis.mockResolvedValue(makeGraphAnalysis());
  useEditorStore.setState({ currentNote: makeNote() });
  render(<GraphAnalysisPanel />);
  expect(await screen.findByText("逻辑路径")).toBeInTheDocument();
  expect(screen.getByText("Beta -> Alpha")).toBeInTheDocument();
});

it("accepts a candidate relation and refreshes the analysis", async () => {
  apiMocks.getNoteGraphAnalysis
    .mockResolvedValueOnce(makeGraphAnalysis({ overview: { candidateRelations: [makeCandidate()] } }))
    .mockResolvedValueOnce(makeGraphAnalysis({ overview: { candidateRelations: [] } }));
  apiMocks.acceptGraphCandidate.mockResolvedValue(makeRelation());
  useEditorStore.setState({ currentNote: makeNote() });
  render(<GraphAnalysisPanel />);
  await user.click(await screen.findByRole("button", { name: "接受候选关系" }));
  expect(apiMocks.acceptGraphCandidate).toHaveBeenCalledWith("candidate-1", undefined, undefined);
});
```

- [ ] **Step 2: Run the component test file to verify it fails**

Run: `corepack pnpm vitest run src/components/RightSidebar/GraphAnalysisPanel.test.tsx`

Expected: FAIL because the panel does not exist yet.

- [ ] **Step 3: Implement the graph analysis panel with strict candidate separation**

```tsx
export function GraphAnalysisPanel() {
  const currentNote = useEditorStore((state) => state.currentNote);
  const setSearchNavigationTarget = useEditorStore((state) => state.setSearchNavigationTarget);
  const [analysis, setAnalysis] = useState<NoteGraphAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentNote) {
      setAnalysis(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    void api.getNoteGraphAnalysis(currentNote.id)
      .then(setAnalysis)
      .catch(() => setError("图谱分析加载失败"))
      .finally(() => setLoading(false));
  }, [currentNote]);

  if (!currentNote) return <div style={panelStyle}>打开笔记后显示图谱分析</div>;
  if (loading) return <div style={panelStyle}>图谱分析加载中...</div>;
  if (error) return <div style={panelStyle}>{error}</div>;
  if (!analysis) return <div style={panelStyle}>当前笔记暂无图谱分析结果</div>;

  return (
    <div style={panelStyle}>
      <GraphOverviewSection overview={analysis.overview} onNavigate={setSearchNavigationTarget} />
      <LogicPathSection paths={analysis.logicPaths} onNavigate={setSearchNavigationTarget} />
      <ConflictSection conflicts={analysis.conflicts} onNavigate={setSearchNavigationTarget} />
      <CandidateSection
        candidates={analysis.overview.candidateRelations}
        onAccept={async (candidateId) => {
          await api.acceptGraphCandidate(candidateId);
          setAnalysis(await api.getNoteGraphAnalysis(currentNote.id));
        }}
        onIgnore={async (candidateId) => {
          await api.ignoreGraphCandidate(candidateId);
          setAnalysis(await api.getNoteGraphAnalysis(currentNote.id));
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Integrate the panel into the right sidebar tab bar**

```tsx
type Tab = "outline" | "graph" | "associations";

<button style={tabStyle(activeTab === "graph")} onClick={() => setActiveTab("graph")}>
  图谱分析
</button>

{activeTab === "graph" && <GraphAnalysisPanel />}
```

- [ ] **Step 5: Run the component tests to verify they pass**

Run: `corepack pnpm vitest run src/components/RightSidebar/GraphAnalysisPanel.test.tsx src/components/RightSidebar/RightSidebar.test.tsx`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/RightSidebar/GraphAnalysisPanel.tsx src/components/RightSidebar/GraphAnalysisPanel.test.tsx src/components/RightSidebar/RightSidebar.tsx src/components/RightSidebar/RightSidebar.test.tsx
git commit -m "feat: add graph analysis sidebar panel"
```

## Task 7: End-to-end verification sweep for the current-note graph feature

**Files:**
- Modify: `docs/superpowers/plans/2026-06-07-knowledge-graph-analysis.md`

- [ ] **Step 1: Run focused Rust graph and relation tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml services::graph::tests services::relation::tests`

Expected: PASS with graph candidate, local analysis, and widened relation semantics covered.

- [ ] **Step 2: Run focused frontend sidebar tests**

Run: `corepack pnpm vitest run src/components/RightSidebar/GraphAnalysisPanel.test.tsx src/components/RightSidebar/RightSidebar.test.tsx src/components/RightSidebar/ManualRelationsPanel.test.tsx`

Expected: PASS with no regressions in the existing manual relations flow.

- [ ] **Step 3: Run the full build**

Run: `corepack pnpm build`

Expected: PASS with no TypeScript or Vite build errors.

- [ ] **Step 4: Run the existing Tauri verification command**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS or, if unrelated legacy failures exist, only pre-existing failures outside the graph-analysis slice.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-06-07-knowledge-graph-analysis.md
git commit -m "docs: record graph analysis verification completion"
```

## Self-Review

- Spec coverage: the plan covers the approved scope only: current-note entry, local graph analysis, logic paths, conflict analysis, formal-vs-candidate relation split, AI candidate generation, user confirmation flow, and right-sidebar integration. It intentionally does not add a full graph workspace, global graph queries, or persistent proposition cards.
- Placeholder scan: no `TODO`, `TBD`, or implicit “handle this somehow” instructions remain; each task includes exact files, commands, and code anchors.
- Type consistency: the same `RelationType`, `GraphCandidateStatus`, `NoteGraphAnalysis`, `GraphNodeRef`, and `GraphAnalysisPanel` names are used consistently across Rust domain, API mapping, and frontend rendering tasks.
