import { describe, expect, it } from "vitest";
import { api } from "./commands";
import { tauriMocks } from "../test/setup";

describe("api graph commands", () => {
  it("maps getNoteGraphAnalysis snake_case payloads into camelCase graph analysis contracts", async () => {
    tauriMocks.invoke.mockResolvedValueOnce({
      note_id: "note-1",
      overview: {
        confirmed_relations: [
          {
            relation_id: "rel-1",
            relation_type: "premise",
            direction: "incoming",
            rationale: "Supports the main claim",
            note: {
              note_id: "note-2",
              note_title: "Evidence",
              note_path: "notes/evidence.md",
              heading_id: "h-1",
              heading_text: "Claim",
              line_start: 3,
              line_end: 5,
            },
          },
        ],
        factual_relations: [
          {
            link_id: "link-1",
            direction: "outgoing",
            link_text: "Further reading",
            link_type: "markdown",
            target_anchor: "details",
            note: {
              note_id: "note-3",
              note_title: "Details",
              note_path: "notes/details.md",
              heading_id: null,
              heading_text: null,
              line_start: null,
              line_end: null,
            },
          },
        ],
      },
      logic_paths: [
        {
          id: "path-1",
          label: "Evidence -> Focus",
          steps: [
            {
              node: {
                note_id: "note-2",
                note_title: "Evidence",
                note_path: "notes/evidence.md",
                heading_id: null,
                heading_text: null,
                line_start: null,
                line_end: null,
              },
              relation_type: "premise",
              rationale: "Supports the main claim",
            },
            {
              node: {
                note_id: "note-1",
                note_title: "Focus",
                note_path: "notes/focus.md",
                heading_id: null,
                heading_text: null,
                line_start: null,
                line_end: null,
              },
              relation_type: null,
              rationale: null,
            },
          ],
        },
      ],
      conflicts: [
        {
          relation_id: "rel-2",
          relation_type: "rebuts",
          direction: "incoming",
          rationale: "Counterexample",
          counterparty: {
            note_id: "note-4",
            note_title: "Counterexample",
            note_path: "notes/counterexample.md",
            heading_id: null,
            heading_text: null,
            line_start: 8,
            line_end: 10,
          },
        },
      ],
      missing_premises: ["Need evidence for premise B"],
    });

    const result = await api.getNoteGraphAnalysis("note-1");

    expect(tauriMocks.invoke).toHaveBeenCalledWith("get_note_graph_analysis", { noteId: "note-1" });
    expect(result).toEqual({
      noteId: "note-1",
      overview: {
        confirmedRelations: [
          {
            relationId: "rel-1",
            relationType: "premise",
            direction: "incoming",
            rationale: "Supports the main claim",
            note: {
              noteId: "note-2",
              noteTitle: "Evidence",
              notePath: "notes/evidence.md",
              headingId: "h-1",
              headingText: "Claim",
              lineStart: 3,
              lineEnd: 5,
            },
          },
        ],
        factualRelations: [
          {
            linkId: "link-1",
            direction: "outgoing",
            linkText: "Further reading",
            linkType: "markdown",
            targetAnchor: "details",
            note: {
              noteId: "note-3",
              noteTitle: "Details",
              notePath: "notes/details.md",
              headingId: null,
              headingText: null,
              lineStart: null,
              lineEnd: null,
            },
          },
        ],
      },
      logicPaths: [
        {
          id: "path-1",
          label: "Evidence -> Focus",
          steps: [
            {
              node: {
                noteId: "note-2",
                noteTitle: "Evidence",
                notePath: "notes/evidence.md",
                headingId: null,
                headingText: null,
                lineStart: null,
                lineEnd: null,
              },
                  relationType: "premise",
                  rationale: "Supports the main claim",
            },
            {
              node: {
                noteId: "note-1",
                noteTitle: "Focus",
                notePath: "notes/focus.md",
                headingId: null,
                headingText: null,
                lineStart: null,
                lineEnd: null,
              },
              relationType: null,
              rationale: null,
            },
          ],
        },
      ],
      conflicts: [
        {
          relationId: "rel-2",
          relationType: "rebuts",
          direction: "incoming",
          rationale: "Counterexample",
          counterparty: {
            noteId: "note-4",
            noteTitle: "Counterexample",
            notePath: "notes/counterexample.md",
            headingId: null,
            headingText: null,
            lineStart: 8,
            lineEnd: 10,
          },
        },
      ],
      missingPremises: ["Need evidence for premise B"],
    });
  });

  it("maps getNoteGraphCandidates snake_case payloads into camelCase candidate contracts", async () => {
    tauriMocks.invoke.mockResolvedValueOnce([
      {
        id: "candidate-1",
        source_note_id: "note-1",
        source_heading_id: "h-source",
        target_note_id: "note-2",
        target_heading_id: null,
        relation_type: "example",
        rationale: "Shows a concrete case",
        evidence_excerpt: "This is an example",
        candidate_status: "pending",
        provider_name: "mock-provider",
        created_at: "2026-06-07T00:00:00Z",
        updated_at: "2026-06-07T00:00:00Z",
        accepted_relation_id: null,
      },
    ]);

    const result = await api.getNoteGraphCandidates("note-1");

    expect(tauriMocks.invoke).toHaveBeenCalledWith("get_note_graph_candidates", { noteId: "note-1" });
    expect(result).toEqual([
      {
        id: "candidate-1",
        sourceNoteId: "note-1",
        sourceHeadingId: "h-source",
        targetNoteId: "note-2",
        targetHeadingId: null,
        relationType: "example",
        rationale: "Shows a concrete case",
        evidenceExcerpt: "This is an example",
        candidateStatus: "pending",
        providerName: "mock-provider",
        createdAt: "2026-06-07T00:00:00Z",
        updatedAt: "2026-06-07T00:00:00Z",
        acceptedRelationId: null,
      },
    ]);
  });

  it("forwards generateNoteGraphCandidates to the graph generation command", async () => {
    tauriMocks.invoke.mockResolvedValueOnce([]);

    const result = await api.generateNoteGraphCandidates("note-1");

    expect(tauriMocks.invoke).toHaveBeenCalledWith("generate_note_graph_candidates", {
      noteId: "note-1",
      profileId: undefined,
    });
    expect(result).toEqual([]);
  });

  it("forwards acceptGraphCandidate params to the graph mutation command", async () => {
    tauriMocks.invoke.mockResolvedValueOnce({
      id: "rel-9",
      source_note_id: "note-1",
      target_note_id: "note-2",
      relation_type: "supports",
      description: "Accepted rationale",
      created_at: "2026-06-07T00:00:00Z",
      updated_at: "2026-06-07T00:00:00Z",
    });

    await api.acceptGraphCandidate("candidate-1", "supports", "Accepted rationale");

    expect(tauriMocks.invoke).toHaveBeenCalledWith("accept_graph_candidate", {
      candidateId: "candidate-1",
      relationType: "supports",
      description: "Accepted rationale",
    });
  });
});