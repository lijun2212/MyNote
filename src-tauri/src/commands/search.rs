use crate::domain::search::{SearchResult, SearchResultSource};
use crate::error::AppError;
use crate::infrastructure::fs::resolve_kb_path;
use crate::state::AppState;
use rusqlite::Connection;
use std::cmp::Ordering;
use std::fs;
use std::path::Path;
use tauri::State;

const MAX_SEARCH_CANDIDATES: usize = 50;
const MAX_SEARCH_RESULTS: usize = 20;
const TITLE_SCORE_BOOST: f64 = 1000.0;

#[derive(Debug)]
struct CandidateNote {
    note_id: String,
    title: String,
    path: String,
    rank: f64,
}

#[derive(Debug)]
struct MatchOccurrence {
    start: usize,
    end: usize,
    text: String,
}

#[tauri::command]
pub async fn search_notes(
    state: State<'_, AppState>,
    query: String,
    kb_id: String,
) -> Result<Vec<SearchResult>, AppError> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }

    let kb_root = {
        let root_guard = state.kb_root.lock().unwrap();
        root_guard
            .clone()
            .ok_or_else(|| AppError::InvalidInput("No knowledge base open".into()))?
    };

    let db_guard = state.db.lock().unwrap();
    let conn = db_guard
        .as_ref()
        .ok_or_else(|| AppError::InvalidInput("No database open".into()))?;

    let _ = kb_id;

    search_notes_in_conn(conn, kb_root.as_path(), &query)
}

fn search_notes_in_conn(
    conn: &Connection,
    kb_root: &Path,
    query: &str,
) -> Result<Vec<SearchResult>, AppError> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(vec![]);
    }

    let fts_query = format!("\"{}\"*", trimmed.replace('"', "\"\""));
    let like_query = escape_like_query(trimmed);

    let mut stmt = conn.prepare(
        "WITH fts_matches AS (
              SELECT n.id, n.title, n.path, bm25(note_fts) AS rank,
                  0 AS source_order
             FROM note_fts
             JOIN notes n ON note_fts.note_id = n.id AND n.deleted_at IS NULL
             WHERE note_fts MATCH ?1
         ),
         metadata_matches AS (
              SELECT n.id, n.title, n.path, 0.0 AS rank,
                    1 AS source_order
             FROM notes n
             WHERE n.deleted_at IS NULL
                             AND n.title LIKE ?2 ESCAPE '\\'
               AND n.id NOT IN (SELECT id FROM fts_matches)
         )
         SELECT id, title, path, rank
         FROM (
             SELECT * FROM fts_matches
             UNION ALL
             SELECT * FROM metadata_matches
         )
         ORDER BY source_order, rank, title, path, id
         LIMIT ?3",
    )?;

    let candidates = stmt
        .query_map(
            rusqlite::params![fts_query, like_query, MAX_SEARCH_CANDIDATES as i64],
            |row| {
                Ok(CandidateNote {
                note_id: row.get(0)?,
                title: row.get(1)?,
                path: row.get(2)?,
                    rank: row.get(3)?,
                })
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;

    let mut results = Vec::new();
    for candidate in candidates {
        results.extend(expand_candidate_hits(kb_root, &candidate, trimmed)?);
    }

    results.sort_by(compare_search_results);
    results.truncate(MAX_SEARCH_RESULTS);

    Ok(results)
}

fn expand_candidate_hits(
    kb_root: &Path,
    candidate: &CandidateNote,
    query: &str,
) -> Result<Vec<SearchResult>, AppError> {
    let abs_path = resolve_kb_path(kb_root, &candidate.path)?;
    let content = fs::read_to_string(abs_path)?;

    let mut results = Vec::new();
    let mut occurrence_order = 0_i64;
    let title_line = find_title_line_number(&content, &candidate.title).unwrap_or(1);
    let title_has_matches = !collect_match_occurrences(&candidate.title, query).is_empty();

    for occurrence in collect_match_occurrences(&candidate.title, query) {
        occurrence_order += 1;
        results.push(SearchResult {
            note_id: candidate.note_id.clone(),
            title: candidate.title.clone(),
            path: candidate.path.clone(),
            snippet: build_snippet(&candidate.title, occurrence.start, occurrence.end),
            line_start: title_line,
            line_end: title_line,
            occurrence_order,
            match_text: occurrence.text,
            source: SearchResultSource::Title,
            score: candidate.rank - TITLE_SCORE_BOOST + occurrence_order as f64 / 1_000_000.0,
        });
    }

    for (line_index, line) in content.lines().enumerate() {
        if title_has_matches && line_index as i64 + 1 == title_line && line.contains(&candidate.title) {
            continue;
        }

        for occurrence in collect_match_occurrences(line, query) {
            occurrence_order += 1;
            results.push(SearchResult {
                note_id: candidate.note_id.clone(),
                title: candidate.title.clone(),
                path: candidate.path.clone(),
                snippet: build_snippet(line, occurrence.start, occurrence.end),
                line_start: line_index as i64 + 1,
                line_end: line_index as i64 + 1,
                occurrence_order,
                match_text: occurrence.text,
                source: SearchResultSource::Body,
                score: candidate.rank
                    + line_index as f64 / 1_000.0
                    + occurrence_order as f64 / 1_000_000.0,
            });
        }
    }

    Ok(results)
}

fn build_snippet(line: &str, start: usize, end: usize) -> String {
    format!("{}<mark>{}</mark>{}", &line[..start], &line[start..end], &line[end..])
}

fn collect_match_occurrences(haystack: &str, query: &str) -> Vec<MatchOccurrence> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return vec![];
    }

    let lower_query = trimmed.to_lowercase();
    let query_char_count = trimmed.chars().count();
    let mut occurrences = Vec::new();
    let mut search_from = 0;
    let starts: Vec<usize> = haystack.char_indices().map(|(index, _)| index).collect();

    for start in starts {
        if start < search_from {
            continue;
        }

        let mut chars = haystack[start..].char_indices();
        let mut consumed = 0;
        let mut end = start;

        while consumed < query_char_count {
            let Some((offset, ch)) = chars.next() else {
                break;
            };
            consumed += 1;
            end = start + offset + ch.len_utf8();
        }

        if consumed != query_char_count {
            break;
        }

        if haystack[start..end].to_lowercase() == lower_query {
            occurrences.push(MatchOccurrence {
                start,
                end,
                text: haystack[start..end].to_string(),
            });
            search_from = end;
        }
    }

    occurrences
}

fn find_title_line_number(content: &str, title: &str) -> Option<i64> {
    let normalized_title = normalize_heading_text(title);
    let lines: Vec<&str> = content.lines().collect();

    for (index, line) in lines.iter().enumerate() {
        if let Some(heading_text) = parse_atx_heading_text(line) {
            if normalize_heading_text(heading_text) == normalized_title {
                return Some(index as i64 + 1);
            }
        }

        if let Some(heading_text) = parse_setext_heading_text(&lines, index) {
            if normalize_heading_text(heading_text) == normalized_title {
                return Some(index as i64 + 1);
            }
        }
    }

    lines
        .iter()
        .enumerate()
        .find(|(_, line)| normalize_heading_text(line) == normalized_title)
        .map(|(index, _)| index as i64 + 1)
}

fn parse_atx_heading_text(line: &str) -> Option<&str> {
    let trimmed = line.trim_start();
    let marker_count = trimmed.chars().take_while(|ch| *ch == '#').count();
    if marker_count == 0 || marker_count > 6 {
        return None;
    }

    let after_markers = &trimmed[marker_count..];
    if !after_markers.starts_with(char::is_whitespace) {
        return None;
    }

    Some(after_markers.trim().trim_end_matches('#').trim_end())
}

fn parse_setext_heading_text<'a>(lines: &'a [&'a str], index: usize) -> Option<&'a str> {
    let current = lines.get(index)?.trim();
    if current.is_empty() {
        return None;
    }

    let underline = lines.get(index + 1)?.trim();
    let is_heading_underline = !underline.is_empty()
        && (underline.chars().all(|ch| ch == '=') || underline.chars().all(|ch| ch == '-'));

    if is_heading_underline {
        Some(current)
    } else {
        None
    }
}

fn normalize_heading_text(text: &str) -> String {
    text.trim().to_lowercase()
}

fn compare_search_results(left: &SearchResult, right: &SearchResult) -> Ordering {
    source_priority(left.source)
        .cmp(&source_priority(right.source))
        .then_with(|| left.score.partial_cmp(&right.score).unwrap_or(Ordering::Equal))
        .then_with(|| left.note_id.cmp(&right.note_id))
        .then_with(|| left.line_start.cmp(&right.line_start))
        .then_with(|| left.occurrence_order.cmp(&right.occurrence_order))
}

fn source_priority(source: SearchResultSource) -> u8 {
    match source {
        SearchResultSource::Title => 0,
        SearchResultSource::Body => 1,
    }
}

fn escape_like_query(query: &str) -> String {
    let mut escaped = String::with_capacity(query.len() + 2);
    escaped.push('%');
    for ch in query.chars() {
        if matches!(ch, '%' | '_' | '\\') {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    escaped.push('%');
    escaped
}

#[cfg(test)]
mod tests {
    use super::search_notes_in_conn;
    use crate::domain::search::SearchResultSource;
    use rusqlite::Connection;
    use std::fs;
    use tempfile::TempDir;

    fn setup_search_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE notes (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL,
                title TEXT NOT NULL,
                summary TEXT,
                deleted_at TEXT
            );
            CREATE VIRTUAL TABLE note_fts USING fts5(
                note_id UNINDEXED,
                title,
                summary,
                body,
                tokenize = 'unicode61'
            );",
        ).unwrap();
        conn
    }

    fn setup_search_root() -> TempDir {
        let root = TempDir::new().unwrap();
        fs::create_dir_all(root.path().join("notes")).unwrap();
        root
    }

    fn insert_note(
        conn: &Connection,
        root: &TempDir,
        id: &str,
        path: &str,
        title: &str,
        summary: &str,
        body: &str,
        file_content: &str,
    ) {
        let abs_path = root.path().join(path);
        if let Some(parent) = abs_path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&abs_path, file_content).unwrap();
        conn.execute(
            "INSERT INTO notes (id, path, title, summary, deleted_at) VALUES (?1, ?2, ?3, NULL, NULL)",
            rusqlite::params![id, path, title],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO note_fts (note_id, title, summary, body) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![id, title, summary, body],
        )
        .unwrap();
    }

    #[test]
    fn search_notes_matches_imported_filename_substrings() {
        let conn = setup_search_db();
        let root = setup_search_root();
        insert_note(
            &conn,
            &root,
            "n1",
            "notes/项目扫描汇总报告-1.md",
            "项目扫描汇总报告-1",
            "",
            "导入的正文",
            "# 项目扫描汇总报告-1\n\n导入的正文\n",
        );

        let results = search_notes_in_conn(&conn, root.path(), "扫描").unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].path, "notes/项目扫描汇总报告-1.md");
    }

    #[test]
    fn search_notes_treats_like_wildcards_as_literals() {
        let conn = setup_search_db();
        let root = setup_search_root();
        insert_note(
            &conn,
            &root,
            "n1",
            "notes/100-percent.md",
            "100% Plan",
            "",
            "",
            "# 100% Plan\n",
        );
        insert_note(
            &conn,
            &root,
            "n2",
            "notes/plain.md",
            "Plain Plan",
            "",
            "",
            "# Plain Plan\n",
        );

        let results = search_notes_in_conn(&conn, root.path(), "%").unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].note_id, "n1");
    }

    #[test]
    fn search_notes_matches_body_fts_prefix() {
        let conn = setup_search_db();
        let root = setup_search_root();
        insert_note(
            &conn,
            &root,
            "n1",
            "notes/neutral.md",
            "Neutral Note",
            "",
            "sqlite performance tuning",
            "# Neutral Note\n\nsqlite performance tuning\n",
        );

        let results = search_notes_in_conn(&conn, root.path(), "perform").unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].note_id, "n1");
    }

    #[test]
    fn search_notes_does_not_scan_body_substrings_in_fallback() {
        let conn = setup_search_db();
        let root = setup_search_root();
        insert_note(
            &conn,
            &root,
            "n1",
            "notes/neutral.md",
            "Neutral Note",
            "",
            "bodyonlysubstring",
            "# Neutral Note\n\nbodyonlysubstring\n",
        );

        let results = search_notes_in_conn(&conn, root.path(), "onlysub").unwrap();

        assert!(results.is_empty());
    }

    #[test]
    fn search_notes_does_not_scan_summary_substrings_in_fallback() {
        let conn = setup_search_db();
        let root = setup_search_root();
        insert_note(
            &conn,
            &root,
            "n1",
            "notes/neutral.md",
            "Neutral Note",
            "summarycontainsneedle",
            "",
            "# Neutral Note\n",
        );

        let results = search_notes_in_conn(&conn, root.path(), "needle").unwrap();

        assert!(results.is_empty());
    }

    #[test]
    fn search_notes_expands_multiple_body_hits_into_multiple_results() {
        let conn = setup_search_db();
        let root = setup_search_root();
        fs::write(
            root.path().join("notes/demo.md"),
            "alpha first line\nneutral line\nalpha second line\n",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO notes (id, path, title, summary, deleted_at) VALUES (?1, ?2, ?3, NULL, NULL)",
            rusqlite::params!["n1", "notes/demo.md", "Demo Note"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO note_fts (note_id, title, summary, body) VALUES (?1, ?2, '', ?3)",
            rusqlite::params!["n1", "Demo Note", "alpha first line\nneutral line\nalpha second line"],
        )
        .unwrap();

        let results = search_notes_in_conn(&conn, root.path(), "alpha").unwrap();

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].line_start, 1);
        assert_eq!(results[0].occurrence_order, 1);
        assert_eq!(results[1].line_start, 3);
        assert_eq!(results[1].occurrence_order, 2);
    }

    #[test]
    fn search_notes_ranks_title_hits_ahead_of_body_hits() {
        let conn = setup_search_db();
        let root = setup_search_root();
        fs::write(root.path().join("notes/title.md"), "# Alpha Design\n\nneutral body\n").unwrap();
        fs::write(root.path().join("notes/body.md"), "# Neutral\n\nalpha appears in body only\n").unwrap();
        conn.execute(
            "INSERT INTO notes (id, path, title, summary, deleted_at) VALUES (?1, ?2, ?3, NULL, NULL)",
            rusqlite::params!["title-note", "notes/title.md", "Alpha Design"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO notes (id, path, title, summary, deleted_at) VALUES (?1, ?2, ?3, NULL, NULL)",
            rusqlite::params!["body-note", "notes/body.md", "Neutral"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO note_fts (note_id, title, summary, body) VALUES (?1, ?2, '', ?3)",
            rusqlite::params!["title-note", "Alpha Design", "neutral body"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO note_fts (note_id, title, summary, body) VALUES (?1, ?2, '', ?3)",
            rusqlite::params!["body-note", "Neutral", "alpha appears in body only"],
        )
        .unwrap();

        let results = search_notes_in_conn(&conn, root.path(), "alpha").unwrap();

        assert_eq!(results[0].note_id, "title-note");
        assert_eq!(results[0].source, SearchResultSource::Title);
    }

    #[test]
    fn search_notes_does_not_return_path_only_results() {
        let conn = setup_search_db();
        let root = setup_search_root();
        insert_note(
            &conn,
            &root,
            "n1",
            "notes/projects/alpha-folder/note.md",
            "Neutral Note",
            "",
            "",
            "# Neutral Note\n\nno alpha here\n",
        );

        let results = search_notes_in_conn(&conn, root.path(), "folder").unwrap();

        assert!(results.is_empty());
    }

    #[test]
    fn search_notes_title_hits_use_matching_markdown_heading_line() {
        let conn = setup_search_db();
        let root = setup_search_root();
        insert_note(
            &conn,
            &root,
            "n1",
            "notes/alpha-note.md",
            "Alpha Note",
            "",
            "body content",
            "---\ntag: alpha\n---\n# Alpha Note\n\nbody content\n",
        );

        let results = search_notes_in_conn(&conn, root.path(), "alpha").unwrap();
        let title_result = results
            .iter()
            .find(|result| result.source == SearchResultSource::Title)
            .unwrap();

        assert_eq!(title_result.line_start, 4);
    }

    #[test]
    fn search_notes_title_hits_fall_back_to_first_line_when_heading_is_missing() {
        let conn = setup_search_db();
        let root = setup_search_root();
        insert_note(
            &conn,
            &root,
            "n1",
            "notes/alpha-note.md",
            "Alpha Note",
            "",
            "body mentions alpha",
            "plain intro\n\nbody mentions alpha\n",
        );

        let results = search_notes_in_conn(&conn, root.path(), "alpha").unwrap();
        let title_result = results
            .iter()
            .find(|result| result.source == SearchResultSource::Title)
            .unwrap();

        assert_eq!(title_result.line_start, 1);
    }
}
