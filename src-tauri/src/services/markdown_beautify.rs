use crate::domain::ai::AiTextRequest;
use crate::domain::note::{
    MarkdownBeautifyAiStatus,
    MarkdownBeautifySeverity,
    MarkdownBeautifyIssue, MarkdownBeautifyOptions, MarkdownBeautifyResult,
    MarkdownBeautifySummary,
};
use crate::error::AppError;
use crate::error::AppResult;
use crate::infrastructure::hash::sha256_str;
use crate::infrastructure::markdown::split_front_matter;
use regex::Regex;

const MARKDOWN_BEAUTIFY_AI_MAX_TOKENS: u32 = 20_000;

fn ai_rejection_detail_message(error: AppError) -> String {
    match error {
        AppError::InvalidInput(message) => message,
        other => other.to_string(),
    }
}

pub fn beautify_markdown_text(
    _note_path: &str,
    content: &str,
    options: MarkdownBeautifyOptions,
    _ai_result: Option<&str>,
) -> AppResult<MarkdownBeautifyResult> {
    beautify_markdown_text_with_ai_attempt(_note_path, content, options, _ai_result, None)
}

pub fn beautify_markdown_text_with_ai_attempt(
    _note_path: &str,
    content: &str,
    options: MarkdownBeautifyOptions,
    _ai_result: Option<&str>,
    unavailable_detail: Option<String>,
) -> AppResult<MarkdownBeautifyResult> {
    let original_diagnostics = diagnose_markdown(content, &options);
    let rule_based_content = apply_rule_based_beautify(content, &options);
    let (beautified_content, applied_ai, ai_status, ai_status_detail) = match (options.use_ai_assist, _ai_result) {
        (true, Some(candidate)) => match validate_ai_candidate(content, candidate) {
            Ok(()) => {
                let cleaned_candidate = apply_rule_based_beautify(&candidate.replace("\r\n", "\n"), &options);
                (
                    cleaned_candidate,
                    true,
                    MarkdownBeautifyAiStatus::Applied,
                    None,
                )
            }
            Err(error) => (
                rule_based_content,
                false,
                MarkdownBeautifyAiStatus::CandidateRejected,
                Some(ai_rejection_detail_message(error)),
            ),
        },
        (true, None) => (
            rule_based_content,
            false,
            MarkdownBeautifyAiStatus::Unavailable,
            unavailable_detail,
        ),
        (false, _) => (
            rule_based_content,
            false,
            MarkdownBeautifyAiStatus::NotRequested,
            None,
        ),
    };

    let diagnostics = if applied_ai {
        diagnose_markdown(&beautified_content, &options)
    } else {
        original_diagnostics
    };
    let summary = summarize_diagnostics(&diagnostics);

    Ok(MarkdownBeautifyResult {
        original_hash: sha256_str(content),
        beautified_content,
        applied_ai,
        ai_status,
        ai_status_detail,
        diagnostics,
        summary,
    })
}

fn apply_rule_based_beautify(content: &str, options: &MarkdownBeautifyOptions) -> String {
    let normalized = content.replace("\r\n", "\n");
    let (front_matter, body) = split_front_matter(&normalized);
    let mut beautified_body = body.to_string();

    if options.normalize_headings {
        beautified_body = normalize_heading_spacing(&beautified_body);
    }

    if options.normalize_code_blocks {
        beautified_body = normalize_fenced_code_blocks(&beautified_body);
    }

    if options.fix_syntax {
        beautified_body = normalize_markdown_syntax(&beautified_body);
    }

    if options.refresh_toc {
        beautified_body = refresh_or_insert_toc(&beautified_body);
    }

    if options.normalize_spacing {
        beautified_body = normalize_blank_lines(&beautified_body);
    }

    join_front_matter_and_body(front_matter, &beautified_body)
}

pub fn build_markdown_beautify_ai_request(note_path: &str, content: &str) -> AiTextRequest {
    AiTextRequest {
        prompt: format!(
            concat!(
                "你是 MyNote 的 Markdown 格式整理助手。",
                "只能做格式与语法层整理，禁止改写正文含义、禁止增删事实、禁止重排段落（但是可以将未分段的内容进行分段处理）。",
                "请直接返回整理后的完整 Markdown，不要解释，不要包裹代码块。\n\n",
                "要求：\n",
                "1. 保留原始 Front Matter 语义与正文含义。\n",
                "2. 仅修复标题、空行、目录、列表、引用、围栏代码块等 Markdown 格式问题。\n",
                "3. 修改不当的转义，比如将 \\`code\\` 修正为 `code`，将 \\$variable 修正为 `$variable`。\n",
                "4. 对于明显的行内代码或公式片段，修正为适当的 Markdown 代码格式。\n",
                "5. 若无法确定安全修复方式，尽量保持原样。\n",
                "6. 返回结果必须仍是单个完整 Markdown 文档。\n\n",
                "笔记路径：{}\n\n",
                "原始 Markdown：\n{}"
            ),
            note_path,
            content,
        ),
        max_tokens: Some(MARKDOWN_BEAUTIFY_AI_MAX_TOKENS),
        temperature: Some(0.0),
        expected_text: None,
    }
}

fn diagnose_markdown(
    content: &str,
    options: &MarkdownBeautifyOptions,
) -> Vec<MarkdownBeautifyIssue> {
    let normalized = content.replace("\r\n", "\n");
    let (_, body) = split_front_matter(&normalized);
    let body_line_offset = normalized.lines().count().saturating_sub(body.lines().count()) as i64;
    let mut diagnostics = Vec::new();
    let mut previous_heading_level = None;
    let mut in_fence = false;

    if options.refresh_toc && !has_toc_heading(body) && !has_unclosed_fence(body) {
        diagnostics.push(MarkdownBeautifyIssue {
            id: "toc-missing".to_string(),
            severity: MarkdownBeautifySeverity::Warning,
            kind: "toc_missing".to_string(),
            message: "缺少目录".to_string(),
            line_start: Some(body_line_offset + 1),
            line_end: Some(body_line_offset + 1),
            auto_fixable: true,
            ai_eligible: false,
        });
    }

    if options.normalize_headings {
        for (index, line) in body.lines().enumerate() {
            if is_fence_delimiter_line(line) {
                in_fence = !in_fence;
                continue;
            }

            if in_fence {
                continue;
            }

            let Some(level) = parse_heading_level(line) else {
                continue;
            };

            if let Some(previous_level) = previous_heading_level {
                if level > previous_level + 1 {
                    diagnostics.push(MarkdownBeautifyIssue {
                        id: format!("heading-level-jump-{}", index + 1),
                        severity: MarkdownBeautifySeverity::Warning,
                        kind: "heading_level_jump".to_string(),
                        message: "标题层级跳跃".to_string(),
                        line_start: Some(body_line_offset + (index + 1) as i64),
                        line_end: Some(body_line_offset + (index + 1) as i64),
                        auto_fixable: false,
                        ai_eligible: false,
                    });
                    break;
                }
            }

            previous_heading_level = Some(level);
        }
    }

    diagnostics
}

fn summarize_diagnostics(diagnostics: &[MarkdownBeautifyIssue]) -> MarkdownBeautifySummary {
    let error_count = diagnostics
        .iter()
        .filter(|item| matches!(item.severity, MarkdownBeautifySeverity::Error))
        .count() as i64;
    let warning_count = diagnostics
        .iter()
        .filter(|item| matches!(item.severity, MarkdownBeautifySeverity::Warning))
        .count() as i64;
    let auto_fixable_count = diagnostics
        .iter()
        .filter(|item| item.auto_fixable)
        .count() as i64;

    MarkdownBeautifySummary {
        error_count,
        warning_count,
        auto_fixable_count,
    }
}

fn has_toc_heading(content: &str) -> bool {
    let mut open_fence = None;

    for line in content.lines() {
        if let Some(next_fence) = update_open_fence(open_fence, line) {
            open_fence = next_fence;
            continue;
        }

        if open_fence.is_some() {
            continue;
        }

        if line.trim() == "## 目录" {
            return true;
        }
    }

    false
}

fn parse_heading_level(line: &str) -> Option<usize> {
    let trimmed = line.trim_start();
    let hashes = trimmed.chars().take_while(|ch| *ch == '#').count();
    if hashes == 0 || hashes > 6 {
        return None;
    }

    match trimmed.chars().nth(hashes) {
        Some(' ') => Some(hashes),
        _ => None,
    }
}

fn refresh_or_insert_toc(content: &str) -> String {
    if has_unclosed_fence(content) {
        return content.to_string();
    }

    let mut lines = content
        .split('\n')
        .map(|line| line.to_string())
        .collect::<Vec<_>>();
    if let Some(existing_toc_index) = find_non_fenced_line_index(&lines, |line| line.trim() == "## 目录") {
        lines[existing_toc_index] = "## 目录".to_string();
        return lines.join("\n");
    }

    let title_index = find_non_fenced_line_index(&lines, |line| parse_heading_level(line) == Some(1));

    match title_index {
        Some(index) => {
            lines.splice(
                (index + 1)..(index + 1),
                [String::new(), "## 目录".to_string(), String::new()],
            );
        }
        None => {
            lines.splice(0..0, ["## 目录".to_string(), String::new()]);
        }
    }

    lines.join("\n")
}

fn normalize_blank_lines(content: &str) -> String {
    let mut normalized_lines = Vec::new();
    let mut blank_run = 0usize;

    for line in content.split('\n') {
        if line.trim().is_empty() {
            blank_run += 1;
            if blank_run > 1 {
                continue;
            }
            normalized_lines.push(String::new());
            continue;
        }

        blank_run = 0;
        normalized_lines.push(line.to_string());
    }

    normalized_lines.join("\n")
}

fn normalize_heading_spacing(content: &str) -> String {
    let mut open_fence = None;

    content
        .split('\n')
        .map(|line| {
            if let Some(next_fence) = update_open_fence(open_fence, line) {
                open_fence = next_fence;
                return line.to_string();
            }

            if open_fence.is_some() {
                return line.to_string();
            }

            let trimmed_start = line.trim_start();
            let Some(level) = parse_heading_level_candidate(trimmed_start) else {
                return line.to_string();
            };

            let leading_whitespace = &line[..line.len() - trimmed_start.len()];
            let body = trimmed_start[level..].trim_start();
            format!("{}{} {}", leading_whitespace, "#".repeat(level), body)
                .trim_end()
                .to_string()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn normalize_fenced_code_blocks(content: &str) -> String {
    content
        .split('\n')
        .map(|line| {
            let trimmed_start = line.trim_start();
            let indent = &line[..line.len() - trimmed_start.len()];
            if let Some(language) = trimmed_start.strip_prefix("```") {
                if trimmed_start.starts_with("```") {
                    return format!("{}```{}", indent, language.trim());
                }
            }

            line.to_string()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn normalize_markdown_syntax(content: &str) -> String {
    let content = normalize_formula_sections(&content);
    let content = normalize_escaped_inline_code(&content);
    let content = normalize_escaped_dollar_identifiers(&content);
    normalize_series_reference_paragraph_breaks(&content)
}

fn normalize_formula_sections(content: &str) -> String {
    let mut normalized_lines = Vec::new();
    let lines = content.split('\n').collect::<Vec<_>>();
    let mut open_fence = None;
    let mut index = 0usize;

    while index < lines.len() {
        let line = lines[index];

        if let Some(next_fence) = update_open_fence(open_fence, line) {
            open_fence = next_fence;
            normalized_lines.push(line.to_string());
            index += 1;
            continue;
        }

        if open_fence.is_some() {
            normalized_lines.push(line.to_string());
            index += 1;
            continue;
        }

        let trimmed = line.trim();

        if matches!(trimmed, "解析：" | "解析:") {
            if normalized_lines.last().is_some_and(|previous| !previous.trim().is_empty()) {
                normalized_lines.push(String::new());
            }
            normalized_lines.push("## 解析".to_string());
            if lines
                .get(index + 1)
                .is_some_and(|next_line| !next_line.trim().is_empty())
            {
                normalized_lines.push(String::new());
            }
            index += 1;
            continue;
        }

        if is_formula_display_line(trimmed) {
            if normalized_lines.last().is_some_and(|previous| !previous.trim().is_empty()) {
                normalized_lines.push(String::new());
            }
            normalized_lines.push("```text".to_string());

            while index < lines.len() {
                let candidate = lines[index].trim();
                if !is_formula_display_line(candidate) {
                    break;
                }

                normalized_lines.push(unescape_markdown_code_text(candidate));
                index += 1;
            }

            normalized_lines.push("```".to_string());
            if lines
                .get(index)
                .is_some_and(|next_line| !next_line.trim().is_empty())
            {
                normalized_lines.push(String::new());
            }
            continue;
        }

        normalized_lines.push(line.to_string());
        index += 1;
    }

    normalized_lines.join("\n")
}

fn normalize_escaped_inline_code(content: &str) -> String {
    let escaped_inline_code_pattern = Regex::new(r#"\\`([^`\n]+)\\`"#).expect("valid escaped inline code regex");
    let mut open_fence = None;

    content
        .split('\n')
        .map(|line| {
            if let Some(next_fence) = update_open_fence(open_fence, line) {
                open_fence = next_fence;
                return line.to_string();
            }

            if open_fence.is_some() {
                return line.to_string();
            }

            escaped_inline_code_pattern
                .replace_all(line, "`$1`")
                .into_owned()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn normalize_escaped_dollar_identifiers(content: &str) -> String {
    let escaped_dollar_pattern =
        Regex::new(r#"\\\$([A-Za-z_][A-Za-z0-9_]*)"#).expect("valid escaped dollar regex");
    let mut open_fence = None;

    content
        .split('\n')
        .map(|line| {
            if let Some(next_fence) = update_open_fence(open_fence, line) {
                open_fence = next_fence;
                return line.to_string();
            }

            if open_fence.is_some() {
                return line.to_string();
            }

            escaped_dollar_pattern
                .replace_all(line, |captures: &regex::Captures<'_>| {
                    format!("`{}`", &captures[0].replace('\\', ""))
                })
                .into_owned()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn normalize_series_reference_paragraph_breaks(content: &str) -> String {
    let series_reference_pattern =
        Regex::new(r"([。！？.!?])\s*(系列文章[0-9０-９]+[：:])").expect("valid series reference regex");
    let mut open_fence = None;

    content
        .split('\n')
        .map(|line| {
            if let Some(next_fence) = update_open_fence(open_fence, line) {
                open_fence = next_fence;
                return line.to_string();
            }

            if open_fence.is_some() {
                return line.to_string();
            }

            series_reference_pattern
                .replace_all(line, "$1\n\n$2")
                .into_owned()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn is_formula_display_line(line: &str) -> bool {
    if line.is_empty() || parse_heading_level(line).is_some() {
        return false;
    }

    if line
        .chars()
        .next()
        .is_some_and(|first| first.is_ascii_digit())
        && line.contains('.')
    {
        return false;
    }

    line.contains("\\$")
        && line.matches('(').count() >= 2
        && ["sum(", "rank(", "delta(", "correlation(", "stddev(", "mean(", "delay(", "ts_", "?", "||"]
            .iter()
            .any(|marker| line.contains(marker))
}

fn unescape_markdown_code_text(line: &str) -> String {
    let markdown_escape_pattern = Regex::new(r#"\\([\\`*_{}\[\]()#+\-.!<>|$])"#)
        .expect("valid markdown escape regex");

    markdown_escape_pattern.replace_all(line, "$1").into_owned()
}

fn is_fence_delimiter_line(line: &str) -> bool {
    fence_marker(line).is_some()
}

fn find_non_fenced_line_index(
    lines: &[String],
    predicate: impl Fn(&str) -> bool,
) -> Option<usize> {
    let mut open_fence = None;

    for (index, line) in lines.iter().enumerate() {
        if let Some(next_fence) = update_open_fence(open_fence, line) {
            open_fence = next_fence;
            continue;
        }

        if open_fence.is_some() {
            continue;
        }

        if predicate(line) {
            return Some(index);
        }
    }

    None
}

fn fence_marker(line: &str) -> Option<char> {
    let trimmed = line.trim_start();
    if trimmed.starts_with("```") {
        return Some('`');
    }
    if trimmed.starts_with("~~~") {
        return Some('~');
    }

    None
}

fn update_open_fence(current: Option<char>, line: &str) -> Option<Option<char>> {
    let marker = fence_marker(line)?;

    match current {
        Some(open_marker) if open_marker == marker => Some(None),
        Some(open_marker) => Some(Some(open_marker)),
        None => Some(Some(marker)),
    }
}

fn has_unclosed_fence(content: &str) -> bool {
    let mut open_fence = None;

    for line in content.lines() {
        if let Some(next_fence) = update_open_fence(open_fence, line) {
            open_fence = next_fence;
        }
    }

    open_fence.is_some()
}

fn join_front_matter_and_body(front_matter: Option<&str>, body: &str) -> String {
    match front_matter {
        Some(front_matter) => {
            if body.is_empty() {
                format!("---\n{}---\n", front_matter)
            } else {
                format!("---\n{}---\n\n{}", front_matter, body)
            }
        }
        None => body.to_string(),
    }
}

fn parse_heading_level_candidate(line: &str) -> Option<usize> {
    let hashes = line.chars().take_while(|ch| *ch == '#').count();
    if hashes == 0 || hashes > 6 {
        return None;
    }

    match line.chars().nth(hashes) {
        Some(' ') => Some(hashes),
        Some(ch) if should_normalize_heading_without_space(&line[hashes..], ch) => Some(hashes),
        None => Some(hashes),
        _ => None,
    }
}

fn should_normalize_heading_without_space(rest: &str, first_char: char) -> bool {
    rest.contains(char::is_whitespace) || first_char.is_uppercase() || !first_char.is_ascii()
}

fn validate_ai_candidate(original_content: &str, candidate: &str) -> Result<(), AppError> {
    if candidate.trim().is_empty() {
        return Err(AppError::InvalidInput("AI beautify candidate is empty".into()));
    }

    if has_unclosed_fence(candidate) {
        return Err(AppError::InvalidInput(
            "AI beautify candidate contains unclosed fenced code blocks".into(),
        ));
    }

    if candidate_truncates_original_structure(original_content, candidate) {
        return Err(AppError::InvalidInput(
            "AI beautify candidate appears to be missing trailing document content".into(),
        ));
    }

    Ok(())
}

fn candidate_truncates_original_structure(original_content: &str, candidate: &str) -> bool {
    let original_anchors = collect_structure_anchors(original_content);
    let candidate_anchors = collect_structure_anchors(candidate);
    let original_numbered_markers = collect_numbered_item_markers(original_content);
    let candidate_numbered_markers = collect_numbered_item_markers(candidate);

    if original_numbered_markers.len() >= 3
        && candidate_numbered_markers.len() < original_numbered_markers.len()
        && candidate_numbered_markers
            .iter()
            .zip(original_numbered_markers.iter())
            .all(|(candidate_marker, original_marker)| candidate_marker == original_marker)
    {
        return true;
    }

    if original_anchors.len() < 2 {
        return false;
    }

    if candidate_anchors.len() >= original_anchors.len() {
        return false;
    }

    candidate_anchors
        .iter()
        .zip(original_anchors.iter())
        .all(|(candidate_anchor, original_anchor)| candidate_anchor == original_anchor)
}

fn collect_structure_anchors(content: &str) -> Vec<String> {
    let normalized = content.replace("\r\n", "\n");
    let (_, body) = split_front_matter(&normalized);
    let mut anchors = Vec::new();
    let mut open_fence = None;

    for line in body.lines() {
        if let Some(next_fence) = update_open_fence(open_fence, line) {
            open_fence = next_fence;
            continue;
        }

        if open_fence.is_some() {
            continue;
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if parse_heading_level(line).is_some() {
            if trimmed == "## 目录" {
                continue;
            }
            anchors.push(trimmed.to_string());
            continue;
        }

        if anchors.last().is_none_or(|last| last != trimmed) {
            anchors.push(trimmed.to_string());
        }
    }

    anchors
}

fn collect_numbered_item_markers(content: &str) -> Vec<String> {
    let normalized = content.replace("\r\n", "\n");
    let (_, body) = split_front_matter(&normalized);
    let mut markers = Vec::new();
    let mut open_fence = None;

    for line in body.lines() {
        if let Some(next_fence) = update_open_fence(open_fence, line) {
            open_fence = next_fence;
            continue;
        }

        if open_fence.is_some() {
            continue;
        }

        let trimmed = line.trim();
        let Some((marker, _)) = trimmed.split_once('.') else {
            continue;
        };

        if !marker.chars().all(|ch| ch.is_ascii_digit()) {
            continue;
        }

        markers.push(format!("{}.", marker));
    }

    markers
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_options() -> MarkdownBeautifyOptions {
        MarkdownBeautifyOptions {
            fix_syntax: true,
            refresh_toc: true,
            normalize_headings: true,
            normalize_code_blocks: true,
            normalize_spacing: true,
            use_ai_assist: false,
        }
    }

    #[test]
    fn diagnose_reports_missing_toc_and_heading_level_jump() {
        let diagnostics = diagnose_markdown("# Title\n### Skipped Level\nText", &default_options());

        assert!(diagnostics.iter().any(|item| item.kind == "toc_missing"));
        assert!(diagnostics.iter().any(|item| item.kind == "heading_level_jump"));
    }

    #[test]
    fn beautify_inserts_toc_and_normalizes_blank_lines() {
        let result = beautify_markdown_text(
            "notes/demo.md",
            "# Title\n\n\n\n## Section\nBody",
            default_options(),
            None,
        )
        .unwrap();

        assert!(result.beautified_content.contains("## 目录"));
        assert!(!result.beautified_content.contains("\n\n\n"));
    }

    #[test]
    fn beautify_normalizes_heading_spacing_and_code_fences() {
        let result = beautify_markdown_text(
            "notes/demo.md",
            "#Title\n\n``` ts\nconst value = 1;\n```",
            default_options(),
            None,
        )
        .unwrap();

        assert!(result.beautified_content.contains("# Title"));
        assert!(result.beautified_content.contains("```ts"));
    }

    #[test]
    fn beautify_preserves_front_matter_at_file_start() {
        let result = beautify_markdown_text(
            "notes/demo.md",
            "---\ntitle: Demo\n---\n# Title",
            default_options(),
            None,
        )
        .unwrap();

        assert!(result.beautified_content.starts_with("---\ntitle: Demo\n---\n\n# Title\n\n## 目录"));
    }

    #[test]
    fn beautify_does_not_rewrite_headings_inside_fenced_code_blocks() {
        let result = beautify_markdown_text(
            "notes/demo.md",
            "# Title\n\n```md\n#Code Sample\n```",
            default_options(),
            None,
        )
        .unwrap();

        assert!(result.beautified_content.contains("```md\n#Code Sample\n```"));
    }

    #[test]
    fn beautify_preserves_indented_code_fence_prefix() {
        let result = beautify_markdown_text(
            "notes/demo.md",
            "# Title\n\n  ``` ts\n  code\n  ```",
            default_options(),
            None,
        )
        .unwrap();

        assert!(result.beautified_content.contains("  ```ts\n  code\n  ```"));
    }

    #[test]
    fn beautify_does_not_promote_plain_hash_text_into_headings() {
        let result = beautify_markdown_text(
            "notes/demo.md",
            "#tag\n##todo",
            default_options(),
            None,
        )
        .unwrap();

        assert!(result.beautified_content.contains("#tag\n##todo"));
        assert!(!result.beautified_content.contains("# tag"));
        assert!(!result.beautified_content.contains("## todo"));
    }

    #[test]
    fn beautify_normalizes_escaped_inline_code_markers() {
        let result = beautify_markdown_text(
            "notes/demo.md",
            "# Title\n\n解析\n1. \\`$close\\`：当天收盘价。",
            default_options(),
            None,
        )
        .unwrap();

        assert!(result.beautified_content.contains("1. `$close`：当天收盘价。"));
        assert!(!result.beautified_content.contains("\\`$close\\`"));
    }

    #[test]
    fn beautify_inserts_paragraph_break_before_series_references() {
        let result = beautify_markdown_text(
            "notes/demo.md",
            "# Title\n\n今天，我们来继续学习量化选股因子。 系列文章1：[入门篇](https://example.com/a)",
            default_options(),
            None,
        )
        .unwrap();

        assert!(result.beautified_content.contains("今天，我们来继续学习量化选股因子。\n\n系列文章1："));
    }

    #[test]
    fn beautify_formats_quant_formula_sections_from_clipped_markdown() {
        let result = beautify_markdown_text(
            "notes/demo.md",
            concat!(
                "# <span style='color:#1E4E79'>Alpha#21</span>\n",
                "((((sum(\\$close, 8) / 8) + stddev(\\$close, 8)) < (sum(\\$close, 2) / 2)) ? (-1 * 1) : 0)  \n\n",
                "解析：\n",
                "1.  \\$close: 当天的收盘价。\n",
                "2.  sum(\\$close, 8): 计算过去8个交易日内收盘价之和。\n"
            ),
            default_options(),
            None,
        )
        .unwrap();

        assert!(result.beautified_content.contains("```text\n((((sum($close, 8) / 8) + stddev($close, 8)) < (sum($close, 2) / 2)) ? (-1 * 1) : 0)\n```"));
        assert!(result.beautified_content.contains("## 解析"));
        assert!(result.beautified_content.contains("1.  `$close`: 当天的收盘价。"));
        assert!(result.beautified_content.contains("2.  sum(`$close`, 8): 计算过去8个交易日内收盘价之和。"));
        assert!(!result.beautified_content.contains("\\$close"));
    }

    #[test]
    fn beautify_real_note_patterns_change_beyond_toc_only() {
        let result = beautify_markdown_text(
            "notes/demo.md",
            concat!(
                "今天，我们来继续学习量化选股因子alpha101。\n",
                "系列文章1：[解锁大厂量化交易秘诀：选股因子分析（一）](http://example.com/a)  \n\n",
                "系列文章2：[解锁大厂量化交易秘诀：选股因子分析（二）](http://example.com/b)\n",
                "# <span style='color:#1E4E79'>Alpha#21</span>\n",
                "((((sum(\\$close, 8) / 8) + stddev(\\$close, 8)) < (sum(\\$close, 2) / 2)) ? (-1 * 1) : 0)  \n\n",
                "解析：\n",
                "1.  \\$close: 当天的收盘价。\n"
            ),
            default_options(),
            None,
        )
        .unwrap();

        assert!(result.beautified_content.contains("## 目录"));
        assert!(result.beautified_content.contains("```text"));
        assert!(result.beautified_content.contains("## 解析"));
        assert!(result.beautified_content.contains("`$close`"));
    }

    #[test]
    fn diagnose_ignores_toc_heading_inside_fenced_code_blocks() {
        let diagnostics = diagnose_markdown("# Title\n\n```md\n## 目录\n```", &default_options());

        assert!(diagnostics.iter().any(|item| item.kind == "toc_missing"));
    }

    #[test]
    fn beautify_uses_valid_ai_candidate_when_enabled() {
        let mut options = default_options();
        options.use_ai_assist = true;

        let result = beautify_markdown_text(
            "notes/demo.md",
            "# Title",
            options,
            Some("# AI Result\n\n## 目录"),
        )
        .unwrap();

        assert_eq!(result.beautified_content, "# AI Result\n\n## 目录");
        assert!(result.applied_ai);
    }

    #[test]
    fn beautify_cleans_valid_ai_candidate_with_rule_based_rewrite() {
        let mut options = default_options();
        options.use_ai_assist = true;

        let ai_candidate = concat!(
            "# AI Result\n\n",
            "今天，我们来继续学习量化选股因子。 系列文章1：[入门篇](https://example.com/a)\n\n",
            "解析：\n",
            "1.  \\$close: 当天的收盘价。\n"
        );

        let result = beautify_markdown_text(
            "notes/demo.md",
            "# Original\n\nBody",
            options,
            Some(ai_candidate),
        )
        .unwrap();

        assert!(result.applied_ai);
        assert!(result.beautified_content.contains("今天，我们来继续学习量化选股因子。\n\n系列文章1："));
        assert!(result.beautified_content.contains("## 解析"));
        assert!(result.beautified_content.contains("1.  `$close`: 当天的收盘价。"));
        assert!(!result.beautified_content.contains("\\$close"));
    }

    #[test]
    fn beautify_accepts_valid_ai_candidate_with_additional_rule_rewrite() {
        let mut options = default_options();
        options.use_ai_assist = true;

        let result = beautify_markdown_text(
            "notes/demo.md",
            "# Title\n\n1. \\`$close\\`：当天收盘价。",
            options,
            Some("# AI Result\n\n今天，我们来继续学习量化选股因子。 系列文章1：[入门篇](https://example.com/a)\n\n1. \\`$close\\`：当天收盘价。"),
        )
        .unwrap();

        assert!(result.applied_ai);
        assert!(result.beautified_content.contains("今天，我们来继续学习量化选股因子。\n\n系列文章1："));
        assert!(result.beautified_content.contains("1. `$close`：当天收盘价。"));
    }

    #[test]
    fn beautify_ignores_ai_candidate_when_option_is_disabled() {
        let result = beautify_markdown_text(
            "notes/demo.md",
            "# Title",
            default_options(),
            Some("# Changed by AI\n\n## 目录"),
        )
        .unwrap();

        assert!(!result.applied_ai);
        assert_ne!(result.beautified_content, "# Changed by AI\n\n## 目录");
        assert!(result.beautified_content.contains("# Title"));
    }

    #[test]
    fn beautify_falls_back_to_rule_result_when_ai_output_is_invalid() {
        let mut options = default_options();
        options.use_ai_assist = true;

        let result = beautify_markdown_text("notes/demo.md", "# Title", options, Some("   "))
            .unwrap();

        assert!(!result.applied_ai);
        assert!(result.beautified_content.contains("# Title"));
        assert!(result.beautified_content.contains("## 目录"));
    }

    #[test]
    fn beautify_falls_back_when_ai_output_only_contains_a_partial_document() {
        let mut options = default_options();
        options.use_ai_assist = true;

        let original = "# Title\n\n## First\nAlpha\n\n## Second\nBeta\n\n## Third\nGamma";
        let ai_candidate = "# Title\n\n## 目录\n\n## First\nAlpha";

        let result = beautify_markdown_text("notes/demo.md", original, options, Some(ai_candidate))
            .unwrap();

        assert!(!result.applied_ai);
        assert!(result.beautified_content.contains("## Second\nBeta"));
        assert!(result.beautified_content.contains("## Third\nGamma"));
    }

    #[test]
    fn beautify_falls_back_when_ai_output_drops_later_numbered_items() {
        let mut options = default_options();
        options.use_ai_assist = true;

        let original = concat!(
            "Alpha#21\n\n",
            "解析\n\n",
            "1. 第一条。\n",
            "2. 第二条。\n",
            "3. 第三条。\n",
            "4. 第四条。\n",
            "5. 第五条。\n",
            "6. 第六条。\n",
            "7. 第七条。\n",
            "8. 第八条。\n",
            "9. 第九条。\n",
            "10. 第十条。\n",
            "11. 第十一条。\n",
            "12. 第十二条。\n"
        );
        let ai_candidate = concat!(
            "Alpha#21\n\n",
            "解析\n\n",
            "1. 第一条。\n",
            "2. 第二条。\n",
            "3. 第三条。\n",
            "4. 第四条。\n",
            "5. 第五条。\n",
            "6. 第六条。\n",
            "7. 第七条。\n",
            "8. 第八条。\n",
            "9. 第九条。\n",
            "10. 第十条。\n",
            "11. 1\n\n",
            "因此，这是该因子的解释。"
        );

        let result = beautify_markdown_text("notes/demo.md", original, options, Some(ai_candidate))
            .unwrap();

        assert!(!result.applied_ai);
        assert!(result.beautified_content.contains("11. 第十一条。"));
        assert!(result.beautified_content.contains("12. 第十二条。"));
    }

    #[test]
    fn beautify_accepts_ai_candidate_when_numbered_structure_is_still_complete() {
        let mut options = default_options();
        options.use_ai_assist = true;

        let original = concat!(
            "Alpha#21\n\n",
            "解析\n\n",
            "1. 第一条。\n",
            "2. 第二条。\n",
            "3. 第三条。\n",
            "4. 第四条。\n"
        );
        let ai_candidate = concat!(
            "## Alpha#21\n\n",
            "### 解析\n\n",
            "1. 第一条（格式归一）。\n",
            "2. 第二条（格式归一）。\n",
            "3. 第三条（格式归一）。\n",
            "4. 第四条（格式归一）。\n"
        );

        let result = beautify_markdown_text("notes/demo.md", original, options, Some(ai_candidate))
            .unwrap();

        assert!(result.applied_ai);
        assert!(result.beautified_content.contains("## Alpha#21"));
        assert!(result.beautified_content.contains("### 解析"));
        assert!(result.beautified_content.contains("1. 第一条（格式归一）。"));
        assert!(result.beautified_content.contains("4. 第四条（格式归一）。"));
    }

    #[test]
    fn beautify_inserts_toc_after_real_heading_not_inside_code_fence() {
        let result = beautify_markdown_text(
            "notes/demo.md",
            "```md\n# Example\n```\n\n# Title\nBody",
            default_options(),
            None,
        )
        .unwrap();

        assert!(result.beautified_content.contains("```md\n# Example\n```\n\n# Title\n\n## 目录\n\nBody"));
    }

    #[test]
    fn diagnose_reports_absolute_line_numbers_with_front_matter() {
        let diagnostics = diagnose_markdown(
            "---\ntitle: Demo\n---\n# Title\n### Skipped Level\nText",
            &default_options(),
        );

        let heading_jump = diagnostics
            .iter()
            .find(|item| item.kind == "heading_level_jump")
            .expect("expected heading level jump diagnostic");

        assert_eq!(heading_jump.line_start, Some(5));
        assert_eq!(heading_jump.line_end, Some(5));
    }

    #[test]
    fn beautify_does_not_close_backtick_fence_with_tilde_fence() {
        let result = beautify_markdown_text(
            "notes/demo.md",
            "```md\n# Example\n~~~\n\n# Title\nBody",
            default_options(),
            None,
        )
        .unwrap();

        assert!(!result.beautified_content.contains("## 目录"));
        assert!(!result.diagnostics.iter().any(|item| item.kind == "toc_missing"));
    }

    #[test]
    fn beautify_recomputes_diagnostics_for_ai_candidate() {
        let mut options = default_options();
        options.use_ai_assist = true;

        let result = beautify_markdown_text(
            "notes/demo.md",
            "# Title\n### Skipped Level\nText",
            options,
            Some("# AI Result\n\n## 目录\n\n## Section"),
        )
        .unwrap();

        assert!(result.applied_ai);
        assert_eq!(result.summary.warning_count, 0);
        assert!(!result.diagnostics.iter().any(|item| item.kind == "toc_missing"));
        assert!(!result.diagnostics.iter().any(|item| item.kind == "heading_level_jump"));
    }

    #[test]
    fn beautify_preserves_original_toc_missing_diagnostic_after_rule_based_insertion() {
        let result = beautify_markdown_text(
            "notes/demo.md",
            "# Title\n\n## Section\nBody",
            default_options(),
            None,
        )
        .unwrap();

        assert!(result.beautified_content.contains("## 目录"));
        assert!(result.diagnostics.iter().any(|item| item.kind == "toc_missing"));
    }

    #[test]
    fn build_markdown_beautify_ai_request_sets_large_output_token_budget() {
        let request = build_markdown_beautify_ai_request("notes/demo.md", "# Title\n\nBody");

        assert_eq!(request.max_tokens, Some(20_000));
        assert_eq!(request.temperature, Some(0.0));
    }
}