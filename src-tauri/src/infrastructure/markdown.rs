// src-tauri/src/infrastructure/markdown.rs
use crate::error::{AppError, AppResult};

#[derive(Debug, Default, serde::Serialize, serde::Deserialize, Clone)]
pub struct FrontMatter {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aliases: Option<Vec<String>>,
}

#[derive(Debug)]
pub struct ParsedNote {
    pub front_matter: FrontMatter,
    pub body: String,
    pub title: String,
    pub word_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoteOutlineBlock {
    pub text: String,
    pub level: u8,
    pub line_start: i64,
    pub line_end: i64,
    pub anchor: String,
}

const LOOKBACK_SUMMARY_LEGACY_TITLE_LINE: &str = "> **回看摘要**";
const LOOKBACK_SUMMARY_PREFIX: &str = "> 摘要：";

/// 分离 Front Matter 和正文
pub fn split_front_matter(content: &str) -> (Option<&str>, &str) {
    if !content.starts_with("---") {
        return (None, content);
    }

    let Some((fm_start, fm_end, body_start)) = front_matter_boundaries(content) else {
        return (None, content);
    };

    let fm = &content[fm_start..fm_end];
    let body = content.get(body_start..).unwrap_or("").trim_start_matches('\n');
    (Some(fm), body)
}

/// 解析 Front Matter YAML
pub fn parse_front_matter(fm_str: &str) -> AppResult<FrontMatter> {
    let mut value: serde_yaml::Value =
        serde_yaml::from_str(fm_str).map_err(|e| AppError::Parse(e.to_string()))?;

    if let serde_yaml::Value::Mapping(map) = &mut value {
        let tags_key = serde_yaml::Value::String("tags".to_string());
        if let Some(tags) = map.get_mut(&tags_key) {
            if let serde_yaml::Value::String(tag) = tags {
                *tags = serde_yaml::Value::Sequence(vec![serde_yaml::Value::String(tag.clone())]);
            }
        }
    }

    serde_yaml::from_value(value).map_err(|e| AppError::Parse(e.to_string()))
}

/// 从正文提取第一个一级标题
pub fn extract_h1(body: &str) -> Option<String> {
    let lines: Vec<&str> = body.lines().collect();
    let mut index = 0usize;
    let mut in_code_fence = false;

    while index < lines.len() {
        if is_indented_code_block_line(lines[index]) {
            index += 1;
            continue;
        }

        let trimmed = lines[index].trim_start();
        if is_fence_delimiter_line(trimmed) {
            in_code_fence = !in_code_fence;
            index += 1;
            continue;
        }
        if in_code_fence {
            index += 1;
            continue;
        }

        if let Some((level, text, consumed_lines)) = parse_heading_at(&lines, index) {
            if level == 1 {
                return Some(text);
            }

            index += consumed_lines;
            continue;
        }

        index += 1;
    }

    None
}

/// 统计字数（按空白分词）
pub fn count_words(text: &str) -> usize {
    let stripped = strip_markdown(text);
    stripped.split_whitespace().count()
}

/// 去除 Markdown 标记，返回纯文本（用于索引）
pub fn strip_markdown(text: &str) -> String {
    let mut in_code_block = false;
    let mut result = String::new();
    for line in text.lines() {
        if line.trim_start().starts_with("```") {
            in_code_block = !in_code_block;
            continue;
        }
        if in_code_block {
            result.push_str(line);
            result.push('\n');
            continue;
        }
        let clean = line
            .trim_start_matches('#')
            .trim_start_matches('>')
            .trim_start_matches('-')
            .trim_start_matches('*')
            .trim();
        result.push_str(clean);
        result.push('\n');
    }
    result
}

/// 完整解析一篇笔记内容
pub fn parse_note(content: &str, filename_stem: &str) -> AppResult<ParsedNote> {
    let (fm_str, body) = split_front_matter(content);
    let mut front_matter = if let Some(fm) = fm_str {
        parse_front_matter(fm)?
    } else {
        FrontMatter::default()
    };

    let summary_in_body = extract_lookback_summary(body);
    if summary_in_body.is_some() {
        front_matter.summary = summary_in_body;
    }

    let title = front_matter
        .title
        .clone()
        .or_else(|| extract_h1(body))
        .unwrap_or_else(|| filename_stem.to_string());

    let word_count = count_words(body);

    Ok(ParsedNote {
        front_matter,
        body: body.to_string(),
        title,
        word_count,
    })
}

fn find_lookback_summary_block_lines(body: &str) -> Option<(usize, usize, String)> {
    let lines: Vec<&str> = body.lines().collect();

    for i in 0..lines.len() {
        let current = lines[i].trim();
        let (mut j, mut content_lines): (usize, Vec<String>) = if current == LOOKBACK_SUMMARY_LEGACY_TITLE_LINE {
            (i + 1, Vec::new())
        } else if current.starts_with(LOOKBACK_SUMMARY_PREFIX) || current.starts_with(">摘要：") {
            let inline_summary = if let Some(rest) = current.strip_prefix(LOOKBACK_SUMMARY_PREFIX) {
                rest.to_string()
            } else {
                current
                    .trim_start_matches('>')
                    .trim_start()
                    .trim_start_matches("摘要：")
                    .to_string()
            };
            (i + 1, vec![inline_summary])
        } else {
            continue;
        };

        while j < lines.len() {
            let trimmed = lines[j].trim_start();
            if let Some(content) = trimmed.strip_prefix('>') {
                content_lines.push(content.trim_start().to_string());
                j += 1;
                continue;
            }

            break;
        }

        let mut block_end = j;
        if block_end < lines.len() && lines[block_end].trim().is_empty() {
            block_end += 1;
        }

        let summary = content_lines
            .join("\n")
            .trim()
            .to_string();

        return Some((i, block_end, summary));
    }

    None
}

pub fn extract_lookback_summary(body: &str) -> Option<String> {
    let (_, _, summary) = find_lookback_summary_block_lines(body)?;
    if summary.is_empty() {
        None
    } else {
        Some(summary)
    }
}

pub fn remove_lookback_summary_block(body: &str) -> String {
    let lines: Vec<&str> = body.lines().collect();
    let Some((start, end, _)) = find_lookback_summary_block_lines(body) else {
        return body.to_string();
    };

    let kept = lines
        .iter()
        .enumerate()
        .filter_map(|(index, line)| {
            if index >= start && index < end {
                None
            } else {
                Some((*line).to_string())
            }
        })
        .collect::<Vec<_>>()
        .join("\n");

    kept.trim().to_string()
}

pub fn upsert_lookback_summary_block(body: &str, summary: &str) -> String {
    let cleaned_body = remove_lookback_summary_block(body);
    let trimmed_summary = summary.trim();
    if trimmed_summary.is_empty() {
        return cleaned_body;
    }

    let summary_lines = trimmed_summary.lines().collect::<Vec<_>>();
    let mut summary_block_lines = Vec::new();
    if let Some(first_line) = summary_lines.first() {
        summary_block_lines.push(format!("> 摘要：{}", first_line.trim_end()));
        summary_block_lines.extend(
            summary_lines
                .iter()
                .skip(1)
                .map(|line| format!("> {}", line.trim_end())),
        );
    }
    let summary_block = summary_block_lines.join("\n");

    let lines: Vec<&str> = cleaned_body.lines().collect();
    let h1_index = lines
        .iter()
        .position(|line| line.trim_start().starts_with("# "));

    if let Some(index) = h1_index {
        let mut before = lines[..=index].join("\n");
        let after = lines[index + 1..].join("\n").trim().to_string();

        if !before.ends_with("\n\n") {
            before.push_str("\n\n");
        }

        if after.is_empty() {
            return format!("{}{}", before, summary_block);
        }

        return format!("{}{}\n\n{}", before, summary_block, after);
    }

    if cleaned_body.trim().is_empty() {
        summary_block
    } else {
        format!("{}\n\n{}", summary_block, cleaned_body.trim())
    }
}

/// 将 Front Matter 序列化并与正文重新组合
pub fn render_note(fm: &FrontMatter, body: &str) -> AppResult<String> {
    let fm_str = serde_yaml::to_string(fm).map_err(|e| AppError::Parse(e.to_string()))?;
    if fm_str.trim() == "{}" {
        return Ok(body.to_string());
    }

    Ok(format!("---\n{}---\n\n{}", fm_str, body))
}

/// 从正文提取内联标签（#标签），跳过代码块和 URL 片段
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InlineTagOccurrence {
    pub tag_name: String,
    pub line_start: i64,
    pub line_end: i64,
    pub heading_context: Option<String>,
    pub context_snippet: String,
}

fn is_tag_name_char(ch: char) -> bool {
    ch.is_alphanumeric() || ch == '-' || ch == '_'
}

fn is_tag_boundary(previous: Option<char>) -> bool {
    previous.map(|ch| !is_tag_name_char(ch)).unwrap_or(true)
}

fn is_inside_markdown_link_destination(chars: &[char], index: usize) -> bool {
    let mut paren_depth = 0usize;

    for cursor in (0..index).rev() {
        match chars[cursor] {
            ')' => paren_depth += 1,
            '(' => {
                if paren_depth == 0 {
                    return cursor > 0 && chars[cursor - 1] == ']';
                }
                paren_depth -= 1;
            }
            _ => {}
        }
    }

    false
}

fn extract_inline_tags_from_line(line: &str) -> Vec<String> {
    let mut tags = Vec::new();
    let mut in_inline_code = false;
    let chars: Vec<char> = line.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        if chars[i] == '`' {
            in_inline_code = !in_inline_code;
            i += 1;
            continue;
        }

        if in_inline_code {
            i += 1;
            continue;
        }

        if chars[i] == '#' {
            let prefix: String = chars[..i].iter().collect();
            if prefix.ends_with("://") || prefix.ends_with('/') {
                i += 1;
                continue;
            }

            if is_inside_markdown_link_destination(&chars, i) {
                i += 1;
                continue;
            }

            let previous = if i == 0 { None } else { Some(chars[i - 1]) };
            if !is_tag_boundary(previous) {
                i += 1;
                continue;
            }

            let start = i + 1;
            let mut end = start;
            while end < chars.len() {
                let current = chars[end];
                if is_tag_name_char(current) {
                    end += 1;
                } else {
                    break;
                }
            }

            if end > start {
                tags.push(chars[start..end].iter().collect());
                i = end;
                continue;
            }
        }

        i += 1;
    }

    tags
}

fn is_fence_delimiter_line(trimmed: &str) -> bool {
    trimmed.starts_with("```") || trimmed.starts_with("~~~")
}

fn is_indented_code_block_line(line: &str) -> bool {
    line.starts_with("    ") || line.starts_with('\t')
}

fn front_matter_boundaries(content: &str) -> Option<(usize, usize, usize)> {
    let mut cursor = 0usize;
    let mut lines = content.split_inclusive('\n');
    let first_line = lines.next()?;
    if first_line.trim_end_matches(['\r', '\n']) != "---" {
        return None;
    }

    cursor += first_line.len();
    let fm_start = cursor;

    for line in lines {
        let line_text = line.trim_end_matches(['\r', '\n']);
        if line_text == "---" {
            let fm_end = cursor;
            let body_start = cursor + line.len();
            return Some((fm_start, fm_end, body_start));
        }
        cursor += line.len();
    }

    None
}

fn parse_atx_heading(line: &str) -> Option<(u8, String)> {
    let trimmed = line.trim_start();
    let level = trimmed.chars().take_while(|ch| *ch == '#').count();
    if level == 0 || level > 6 {
        return None;
    }

    let rest = &trimmed[level..];
    if !rest.starts_with(char::is_whitespace) {
        return None;
    }

    let heading = strip_atx_closing_sequence(rest.trim());
    if heading.is_empty() {
        None
    } else {
        Some((level as u8, clean_heading_text(heading)))
    }
}

fn strip_atx_closing_sequence(text: &str) -> &str {
    let trimmed = text.trim_end();
    let bytes = trimmed.as_bytes();
    let mut hash_start = bytes.len();

    while hash_start > 0 && bytes[hash_start - 1] == b'#' {
        hash_start -= 1;
    }

    if hash_start == bytes.len() || hash_start == 0 {
        return trimmed;
    }

    if bytes[hash_start - 1].is_ascii_whitespace() {
        trimmed[..hash_start].trim_end()
    } else {
        trimmed
    }
}

fn parse_setext_heading(lines: &[&str], index: usize) -> Option<(u8, String, usize)> {
    let current = lines.get(index)?.trim();
    if current.is_empty() {
        return None;
    }

    if is_indented_code_block_line(lines.get(index)?) {
        return None;
    }

    let underline = lines.get(index + 1)?.trim();
    if underline.is_empty() {
        return None;
    }

    if is_indented_code_block_line(lines.get(index + 1)?) {
        return None;
    }

    if underline.chars().all(|ch| ch == '=') {
        return Some((1, clean_heading_text(current), 2));
    }

    if underline.chars().all(|ch| ch == '-') {
        return Some((2, clean_heading_text(current), 2));
    }

    None
}

fn clean_heading_text(text: &str) -> String {
    let chars: Vec<char> = text.trim().chars().collect();
    let mut result = String::new();
    let mut index = 0usize;

    while index < chars.len() {
        let current = chars[index];

        if current == '[' {
            if index + 1 < chars.len() && chars[index + 1] == '[' {
                let mut end = index + 2;
                while end + 1 < chars.len() {
                    if chars[end] == ']' && chars[end + 1] == ']' {
                        if end >= index + 2 {
                            let inner: String = chars[index + 2..end].iter().collect();
                            let visible = if let Some((_, display)) = inner.split_once('|') {
                                display
                            } else {
                                inner.split('#').next().unwrap_or("")
                            };
                            result.push_str(visible);
                            index = end + 2;
                            continue;
                        }
                    }
                    end += 1;
                }

                index += 1;
                continue;
            } else {
                let mut text_end = index + 1;
                while text_end < chars.len() && chars[text_end] != ']' {
                    text_end += 1;
                }

                if text_end < chars.len() {
                    let visible: String = chars[index + 1..text_end].iter().collect();
                    result.push_str(&visible);
                    index = text_end + 1;

                    if index < chars.len() && chars[index] == '(' {
                        let mut depth = 1usize;
                        index += 1;
                        while index < chars.len() && depth > 0 {
                            match chars[index] {
                                '(' => depth += 1,
                                ')' => depth -= 1,
                                _ => {}
                            }
                            index += 1;
                        }
                    }

                    continue;
                }

                index += 1;
                continue;
            }
        }

        if current == '*' || current == '`' || current == ']' {
            let mut span = 1usize;
            while index + span < chars.len() && chars[index + span] == current && span < 2 {
                span += 1;
            }
            index += span;
            continue;
        }

        result.push(current);
        index += 1;
    }

    result.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse_heading_at(lines: &[&str], index: usize) -> Option<(u8, String, usize)> {
    if let Some((level, text)) = parse_atx_heading(lines.get(index)?) {
        return Some((level, text, 1));
    }

    parse_setext_heading(lines, index)
}

pub fn normalize_heading_text(text: &str) -> String {
    text.trim().to_lowercase()
}

pub fn slugify_heading_text(text: &str) -> String {
    let mut slug = String::new();
    let mut last_was_dash = false;

    for ch in text.trim().chars().flat_map(|ch| ch.to_lowercase()) {
        if ch.is_alphanumeric() || ('\u{4e00}'..='\u{9fff}').contains(&ch) {
            slug.push(ch);
            last_was_dash = false;
            continue;
        }

        if (ch.is_whitespace() || ch == '-' || ch == '_') && !last_was_dash && !slug.is_empty() {
            slug.push('-');
            last_was_dash = true;
        }
    }

    slug.trim_matches('-').to_string()
}

pub fn extract_note_outline_blocks(body: &str, max_level: u8) -> Vec<NoteOutlineBlock> {
    let lines: Vec<&str> = body.lines().collect();
    let mut blocks = Vec::new();
    let mut index = 0usize;
    let mut in_code_fence = false;

    while index < lines.len() {
        if is_indented_code_block_line(lines[index]) {
            index += 1;
            continue;
        }

        let trimmed = lines[index].trim_start();
        if is_fence_delimiter_line(trimmed) {
            in_code_fence = !in_code_fence;
            index += 1;
            continue;
        }
        if in_code_fence {
            index += 1;
            continue;
        }

        if let Some((level, text, consumed_lines)) = parse_heading_at(&lines, index) {
            if level <= max_level {
                blocks.push(NoteOutlineBlock {
                    text: text.clone(),
                    level,
                    line_start: index as i64 + 1,
                    line_end: lines.len() as i64,
                    anchor: slugify_heading_text(&text),
                });
            }

            index += consumed_lines;
            continue;
        }

        index += 1;
    }

    for current in 0..blocks.len() {
        let current_level = blocks[current].level;
        let line_end = blocks
            .iter()
            .skip(current + 1)
            .find(|candidate| candidate.level <= current_level)
            .map(|candidate| candidate.line_start - 1)
            .unwrap_or(lines.len() as i64);
        blocks[current].line_end = line_end;
    }

    blocks
}

pub fn extract_note_outline_blocks_from_content(content: &str, max_level: u8) -> Vec<NoteOutlineBlock> {
    let (_, body) = split_front_matter(content);
    let line_offset = body_line_offset(content);

    extract_note_outline_blocks(body, max_level)
        .into_iter()
        .map(|mut block| {
            block.line_start += line_offset;
            block.line_end += line_offset;
            block
        })
        .collect()
}

pub fn extract_inline_tags(body: &str) -> Vec<String> {
    let mut tags = Vec::new();
    let mut in_code_block = false;

    for line in body.lines() {
        let trimmed = line.trim_start();
        if is_fence_delimiter_line(trimmed) {
            in_code_block = !in_code_block;
            continue;
        }
        if in_code_block {
            continue;
        }

        tags.extend(extract_inline_tags_from_line(line));
    }
    tags.sort();
    tags.dedup();
    tags
}

pub fn body_line_offset(content: &str) -> i64 {
    let Some((_, _, body_start)) = front_matter_boundaries(content) else {
        return 0;
    };

    let suffix = content.get(body_start..).unwrap_or("");
    let trimmed_newlines = suffix.len() - suffix.trim_start_matches('\n').len();
    let absolute_body_start = body_start + trimmed_newlines;

    content[..absolute_body_start]
        .chars()
        .filter(|ch| *ch == '\n')
        .count() as i64
}

pub fn extract_inline_tag_occurrences(body: &str) -> Vec<InlineTagOccurrence> {
    extract_inline_tag_occurrences_with_offset(body, 0)
}

pub fn extract_inline_tag_occurrences_with_offset(
    body: &str,
    line_offset: i64,
) -> Vec<InlineTagOccurrence> {
    let mut occurrences = Vec::new();
    let mut in_code_block = false;
    let mut current_heading: Option<String> = None;
    let lines: Vec<&str> = body.lines().collect();

    for (index, line) in lines.iter().enumerate() {
        let trimmed = line.trim_start();
        if is_fence_delimiter_line(trimmed) {
            in_code_block = !in_code_block;
            continue;
        }
        if in_code_block {
            continue;
        }

        if let Some((_, heading, _)) = parse_heading_at(&lines, index) {
            current_heading = Some(heading);
        }

        let line_number = line_offset + (index + 1) as i64;
        for tag_name in extract_inline_tags_from_line(line) {
            occurrences.push(InlineTagOccurrence {
                tag_name,
                line_start: line_number,
                line_end: line_number,
                heading_context: current_heading.clone(),
                context_snippet: line.trim().to_string(),
            });
        }
    }

    occurrences
}

fn remove_inline_tag_mentions(body: &str, tag_name: &str) -> String {
    let mut lines = Vec::new();
    let mut in_code_block = false;

    for line in body.lines() {
        let trimmed = line.trim_start();
        if is_fence_delimiter_line(trimmed) {
            in_code_block = !in_code_block;
            lines.push(line.to_string());
            continue;
        }

        if in_code_block {
            lines.push(line.to_string());
            continue;
        }

        let chars: Vec<char> = line.chars().collect();
        let mut result = String::new();
        let mut in_inline_code = false;
        let mut i = 0;

        while i < chars.len() {
            if chars[i] == '`' {
                in_inline_code = !in_inline_code;
                result.push(chars[i]);
                i += 1;
                continue;
            }

            if in_inline_code {
                result.push(chars[i]);
                i += 1;
                continue;
            }

            if chars[i] == '#' {
                let prefix: String = chars[..i].iter().collect();
                let previous = if i == 0 { None } else { Some(chars[i - 1]) };
                if is_tag_boundary(previous) && !prefix.ends_with("://") && !prefix.ends_with('/') {
                    let start = i + 1;
                    let mut end = start;
                    while end < chars.len() {
                        let c = chars[end];
                        if is_tag_name_char(c) {
                            end += 1;
                        } else {
                            break;
                        }
                    }

                    if end > start {
                        let current_tag: String = chars[start..end].iter().collect();
                        if current_tag == tag_name {
                            let next_char = chars.get(end).copied();
                            let previous_is_whitespace = result.chars().last().map(|c| c.is_whitespace()).unwrap_or(false);
                            if (previous_is_whitespace || i == 0) && next_char.map(|c| c.is_whitespace()).unwrap_or(false) {
                                i = end + 1;
                            } else {
                                i = end;
                            }
                            continue;
                        }
                    }
                }
            }

            result.push(chars[i]);
            i += 1;
        }

        lines.push(result);
    }

    lines.join("\n")
}

pub fn remove_tag_from_note_content(content: &str, tag_name: &str) -> AppResult<String> {
    let target_tag = tag_name.trim();
    if target_tag.is_empty() {
        return Ok(content.to_string());
    }

    let (fm_str, body) = split_front_matter(content);
    let updated_body = remove_inline_tag_mentions(body, target_tag);

    if let Some(front_matter_str) = fm_str {
        let mut front_matter = parse_front_matter(front_matter_str)?;
        front_matter.tags = front_matter.tags.map(|tags| {
            tags
                .into_iter()
                .filter(|tag| tag.trim() != target_tag)
                .collect::<Vec<_>>()
        }).and_then(|tags| if tags.is_empty() { None } else { Some(tags) });
        return render_note(&front_matter, &updated_body);
    }

    Ok(updated_body)
}

#[derive(Debug, Clone)]
pub struct RawLink {
    pub target_raw: String,
    pub display_text: Option<String>,
    pub link_type: String, // "wiki" | "markdown" | "asset"
    pub anchor: Option<String>,
    pub start_offset: usize,
    pub end_offset: usize,
}

/// 从正文提取所有链接（wiki 链接和 markdown 链接）
pub fn extract_links(body: &str) -> Vec<RawLink> {
    let mut links = Vec::new();
    let mut in_code_block = false;

    let mut offset = 0usize;
    for line in body.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_code_block = !in_code_block;
            offset += line.len() + 1;
            continue;
        }
        if in_code_block || line.starts_with("    ") || line.starts_with('\t') {
            offset += line.len() + 1;
            continue;
        }

        // Extract wiki links: [[target]], [[target|text]], [[target#anchor]]
        let mut search_from = 0;
        while let Some(start) = line[search_from..].find("[[") {
            let candidate_start = search_from + start;
            if is_inside_inline_code_span(line, candidate_start) {
                search_from = candidate_start + 2;
                continue;
            }
            let abs_start = offset + search_from + start;
            let rest = &line[search_from + start + 2..];
            if let Some(end) = rest.find("]]") {
                let inner = &rest[..end];
                let abs_end = abs_start + 2 + end + 2;
                let (target_part, display) = if let Some(pipe) = inner.find('|') {
                    (&inner[..pipe], Some(inner[pipe + 1..].to_string()))
                } else {
                    (inner, None)
                };
                let (target_raw, anchor) = if let Some(hash) = target_part.find('#') {
                    (target_part[..hash].to_string(), Some(target_part[hash + 1..].to_string()))
                } else {
                    (target_part.to_string(), None)
                };
                links.push(RawLink {
                    target_raw,
                    display_text: display,
                    link_type: "wiki".to_string(),
                    anchor,
                    start_offset: abs_start,
                    end_offset: abs_end,
                });
                search_from = search_from + start + 2 + end + 2;
            } else {
                break;
            }
        }

        // Extract markdown links: [text](path) and ![alt](path)
        search_from = 0;
        while search_from < line.len() {
            // Find [ or ![
            let is_image = line[search_from..].starts_with("![");
            let bracket_offset = if is_image {
                line[search_from..].find("![").map(|p| p)
            } else {
                line[search_from..].find('[').map(|p| p)
            };
            let Some(b_start) = bracket_offset else { break };
            let candidate_start = search_from + b_start;
            if is_inside_inline_code_span(line, candidate_start) {
                search_from = candidate_start + 1;
                continue;
            }
            let actual_start = search_from + b_start + if is_image { 2 } else { 1 };
            let rest = &line[actual_start..];
            let Some(bracket_end) = rest.find(']') else {
                search_from = search_from + b_start + 1;
                continue;
            };
            let text = &rest[..bracket_end];
            let after_bracket = &rest[bracket_end + 1..];
            if !after_bracket.starts_with('(') {
                search_from = actual_start + bracket_end + 1;
                continue;
            }
            let paren_rest = &after_bracket[1..];
            let Some(paren_end) = paren_rest.find(')') else {
                search_from = actual_start + bracket_end + 1;
                continue;
            };
            let href = &paren_rest[..paren_end];
            let link_type = if href.starts_with("http://") || href.starts_with("https://") {
                "external"
            } else if is_image {
                "asset"
            } else {
                "markdown"
            };
            let (target_raw, anchor) = if let Some(hash) = href.rfind('#') {
                (href[..hash].to_string(), Some(href[hash + 1..].to_string()))
            } else {
                (href.to_string(), None)
            };
            let abs_start = offset + search_from + b_start;
            let abs_end = actual_start + bracket_end + 1 + paren_end + 2;
            links.push(RawLink {
                target_raw,
                display_text: Some(text.to_string()),
                link_type: link_type.to_string(),
                anchor,
                start_offset: abs_start,
                end_offset: offset + abs_end,
            });
            search_from = actual_start + bracket_end + 1 + paren_end + 2;
        }

        offset += line.len() + 1;
    }
    links
}

fn is_inside_inline_code_span(line: &str, byte_index: usize) -> bool {
    let mut in_inline_code = false;
    let mut cursor = 0usize;

    while cursor < byte_index && cursor < line.len() {
        let mut chars = line[cursor..].chars();
        let Some(ch) = chars.next() else { break };
        if ch == '`' {
            in_inline_code = !in_inline_code;
        }
        cursor += ch.len_utf8();
    }

    in_inline_code
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_split_front_matter_with_fm() {
        let content = "---\ntitle: Test\n---\n\nHello";
        let (fm, body) = split_front_matter(content);
        assert!(fm.is_some());
        assert_eq!(body.trim(), "Hello");
    }

    #[test]
    fn test_split_front_matter_without_fm() {
        let content = "# Hello\nWorld";
        let (fm, body) = split_front_matter(content);
        assert!(fm.is_none());
        assert_eq!(body, content);
    }

    #[test]
    fn test_parse_front_matter_fields() {
        let fm_str = "title: My Note\ntags:\n  - rust\n  - tauri\n";
        let fm = parse_front_matter(fm_str).unwrap();
        assert_eq!(fm.title.unwrap(), "My Note");
        assert_eq!(fm.tags.unwrap(), vec!["rust", "tauri"]);
    }

    #[test]
    fn test_parse_front_matter_accepts_single_tag_string() {
        let fm_str = "title: My Note\ntags: test\n";
        let fm = parse_front_matter(fm_str).unwrap();
        assert_eq!(fm.tags.unwrap(), vec!["test"]);
    }

    #[test]
    fn test_extract_h1() {
        assert_eq!(extract_h1("# Hello World\nsome text"), Some("Hello World".into()));
        assert_eq!(extract_h1("no heading"), None);
    }

    #[test]
    fn extracts_outline_blocks_up_to_level_three() {
        let body = "# Alpha\ntext\n\n## Beta\nbody\n\n### Gamma\nmore\n\n#### Ignore Me\n";

        let outline = extract_note_outline_blocks(body, 3);

        assert_eq!(outline.len(), 3);
        assert_eq!(outline[0].text, "Alpha");
        assert_eq!(outline[0].level, 1);
        assert_eq!(outline[0].line_start, 1);
        assert_eq!(outline[0].line_end, 10);
        assert_eq!(outline[0].anchor, "alpha");

        assert_eq!(outline[1].text, "Beta");
        assert_eq!(outline[1].level, 2);
        assert_eq!(outline[1].line_start, 4);
        assert_eq!(outline[1].line_end, 10);
        assert_eq!(outline[1].anchor, "beta");

        assert_eq!(outline[2].text, "Gamma");
        assert_eq!(outline[2].level, 3);
        assert_eq!(outline[2].line_start, 7);
        assert_eq!(outline[2].line_end, 10);
        assert_eq!(outline[2].anchor, "gamma");
    }

    #[test]
    fn ignores_code_fences_and_supports_setext_headings() {
        let body = "Title One\n========\n\n```md\n## fake\n```\n\nSection Two\n-----------\ncontent\n";

        let outline = extract_note_outline_blocks(body, 3);

        assert_eq!(outline.len(), 2);
        assert_eq!(outline[0].text, "Title One");
        assert_eq!(outline[0].level, 1);
        assert_eq!(outline[0].line_start, 1);
        assert_eq!(outline[0].line_end, 10);
        assert_eq!(outline[0].anchor, "title-one");

        assert_eq!(outline[1].text, "Section Two");
        assert_eq!(outline[1].level, 2);
        assert_eq!(outline[1].line_start, 8);
        assert_eq!(outline[1].line_end, 10);
        assert_eq!(outline[1].anchor, "section-two");
    }

    #[test]
    fn preserves_trailing_hash_characters_that_are_part_of_heading_text() {
        let body = "# C#\n\n## F#\n";

        let outline = extract_note_outline_blocks(body, 3);

        assert_eq!(outline.len(), 2);
        assert_eq!(outline[0].text, "C#");
        assert_eq!(outline[0].anchor, "c");
        assert_eq!(outline[1].text, "F#");
        assert_eq!(outline[1].anchor, "f");
    }

    #[test]
    fn heading_text_is_plain_text_without_markdown_decorators() {
        let body = "# **Bold** *Italic* `Code` [Label](https://example.com) [[Wiki]]\n";

        let outline = extract_note_outline_blocks(body, 3);

        assert_eq!(outline.len(), 1);
        assert_eq!(outline[0].text, "Bold Italic Code Label Wiki");
        assert_eq!(outline[0].anchor, "bold-italic-code-label-wiki");
    }

    #[test]
    fn heading_text_preserves_real_characters_in_wiki_display_and_identifiers() {
        let body = "# snake_case [[lang|C# 指南]]\n";

        let outline = extract_note_outline_blocks(body, 3);

        assert_eq!(outline.len(), 1);
        assert_eq!(outline[0].text, "snake_case C# 指南");
        assert_eq!(outline[0].anchor, "snake-case-c-指南");
    }

    #[test]
    fn outline_line_end_stops_before_next_same_or_higher_heading() {
        let body = "# Alpha\nalpha body\n\n## Beta\nbeta body\n\n### Gamma\ngamma body\n\n## Delta\ndelta body\n\n# Epsilon\nepsilon body\n";

        let outline = extract_note_outline_blocks(body, 3);

        assert_eq!(outline.len(), 5);
        assert_eq!(outline[0].text, "Alpha");
        assert_eq!(outline[0].line_start, 1);
        assert_eq!(outline[0].line_end, 12);

        assert_eq!(outline[1].text, "Beta");
        assert_eq!(outline[1].line_start, 4);
        assert_eq!(outline[1].line_end, 9);

        assert_eq!(outline[2].text, "Gamma");
        assert_eq!(outline[2].line_start, 7);
        assert_eq!(outline[2].line_end, 9);

        assert_eq!(outline[3].text, "Delta");
        assert_eq!(outline[3].line_start, 10);
        assert_eq!(outline[3].line_end, 12);

        assert_eq!(outline[4].text, "Epsilon");
        assert_eq!(outline[4].line_start, 13);
        assert_eq!(outline[4].line_end, 14);
    }

    #[test]
    fn outline_blocks_from_content_include_front_matter_line_offset() {
        let content = "---\ntitle: Demo\ntags:\n  - rust\n---\n\n# Alpha\nalpha body\n\n## Beta\nbeta body\n";

        let outline = extract_note_outline_blocks_from_content(content, 3);

        assert_eq!(outline.len(), 2);
        assert_eq!(outline[0].line_start, 7);
        assert_eq!(outline[0].line_end, 11);
        assert_eq!(outline[1].line_start, 10);
        assert_eq!(outline[1].line_end, 11);
    }

    #[test]
    fn ignores_indented_code_blocks_when_extracting_outline() {
        let body = "    # not a heading\n\t## also not a heading\n\n# Real Heading\nbody\n";

        let outline = extract_note_outline_blocks(body, 3);

        assert_eq!(outline.len(), 1);
        assert_eq!(outline[0].text, "Real Heading");
        assert_eq!(outline[0].line_start, 4);
    }

    #[test]
    fn split_front_matter_requires_a_real_closing_delimiter_line() {
        let content = "---\ntitle: Demo\nsummary: |\n  first line\n  --- not a delimiter\n  second line\n---\n\n# Heading\n";

        let (fm, body) = split_front_matter(content);

        assert!(fm.is_some());
        assert!(fm.unwrap().contains("--- not a delimiter"));
        assert_eq!(body.trim(), "# Heading");
        assert_eq!(body_line_offset(content), 8);
    }

    #[test]
    fn test_parse_note_title_from_h1() {
        let content = "# My Title\n\nSome content.";
        let note = parse_note(content, "filename").unwrap();
        assert_eq!(note.title, "My Title");
    }

    #[test]
    fn test_parse_note_title_from_filename() {
        let content = "Just some text without heading.";
        let note = parse_note(content, "my-file").unwrap();
        assert_eq!(note.title, "my-file");
    }

    #[test]
    fn test_render_and_parse_roundtrip() {
        let fm = FrontMatter {
            title: Some("Test".into()),
            tags: Some(vec!["tag1".into()]),
            ..Default::default()
        };
        let body = "Hello world";
        let rendered = render_note(&fm, body).unwrap();
        let parsed = parse_note(&rendered, "test").unwrap();
        assert_eq!(parsed.title, "Test");
        assert_eq!(parsed.front_matter.tags.unwrap(), vec!["tag1"]);
    }

    #[test]
    fn test_extract_inline_tags_basic() {
        let body = "Hello #rust and #tauri are great.\nNo tag in `#code` block.";
        let tags = extract_inline_tags(body);
        assert!(tags.contains(&"rust".to_string()));
        assert!(tags.contains(&"tauri".to_string()));
    }

    #[test]
    fn test_extract_inline_tags_skips_code_block() {
        let body = "```\n#notag\n```\n#realtag";
        let tags = extract_inline_tags(body);
        assert!(!tags.contains(&"notag".to_string()));
        assert!(tags.contains(&"realtag".to_string()));
    }

    #[test]
    fn test_extract_inline_tags_accepts_punctuation_boundaries() {
        let body = "Alpha(#项目报告)，还有 [#阶段一]。";
        let tags = extract_inline_tags(body);

        assert!(tags.contains(&"项目报告".to_string()));
        assert!(tags.contains(&"阶段一".to_string()));
    }

    #[test]
    fn test_extract_inline_tags_skips_markdown_fragment_links() {
        let body = [
            "[项目概览](#项目概览)",
            "[相对路径](docs/plan.md#执行计划)",
            "真实标签 #项目报告",
        ]
        .join("\n");

        let tags = extract_inline_tags(&body);

        assert_eq!(tags, vec!["项目报告".to_string()]);
    }

    #[test]
    fn test_extract_inline_tag_occurrences_returns_lines_and_context() {
        let body = [
            "# Title",
            "",
            "Alpha #项目报告 here.",
            "```md",
            "#项目报告",
            "```",
            "## Section",
            "Beta #项目报告 again.",
        ]
        .join("\n");

        let occurrences = extract_inline_tag_occurrences(&body);

        assert_eq!(occurrences.len(), 2);
        assert_eq!(occurrences[0].tag_name, "项目报告");
        assert_eq!(occurrences[0].line_start, 3);
        assert_eq!(occurrences[0].line_end, 3);
        assert_eq!(occurrences[0].heading_context.as_deref(), Some("Title"));
        assert_eq!(occurrences[0].context_snippet, "Alpha #项目报告 here.");
        assert_eq!(occurrences[1].heading_context.as_deref(), Some("Section"));
    }

    #[test]
    fn test_body_line_offset_counts_front_matter_lines() {
        let content = [
            "---",
            "title: Demo",
            "tags:",
            "  - 项目报告",
            "---",
            "",
            "# Title",
        ]
        .join("\n");

        assert_eq!(body_line_offset(&content), 6);
    }

    #[test]
    fn test_remove_tag_from_note_content_removes_front_matter_and_inline_tags() {
        let content = [
            "---",
            "title: Demo",
            "tags:",
            "  - 项目报告",
            "  - 阶段一",
            "---",
            "",
            "# 标题",
            "",
            "这里有 #项目报告 和 #阶段一 两个标签。",
        ]
        .join("\n");

        let updated = remove_tag_from_note_content(&content, "项目报告").unwrap();

        assert!(updated.contains("- 阶段一"));
        assert!(!updated.contains("- 项目报告"));
        assert!(!updated.contains("#项目报告"));
        assert!(updated.contains("#阶段一"));
    }

    #[test]
    fn test_remove_tag_from_note_content_skips_headings_urls_and_code() {
        let content = [
            "# 项目报告",
            "",
            "访问 http://example.com/#项目报告",
            "",
            "`#项目报告` 应该保留",
            "",
            "真实标签 #项目报告 需要删除",
            "",
            "```md",
            "#项目报告",
            "```",
        ]
        .join("\n");

        let updated = remove_tag_from_note_content(&content, "项目报告").unwrap();

        assert!(updated.contains("# 项目报告"));
        assert!(updated.contains("http://example.com/#项目报告"));
        assert!(updated.contains("`#项目报告` 应该保留"));
        assert!(!updated.contains("真实标签 #项目报告 需要删除"));
        assert!(updated.contains("```md\n#项目报告\n```"));
    }

    #[test]
    fn test_extract_links_wiki() {
        let body = "See [[另一篇笔记]] and [[笔记标题|显示文本]] and [[标题#章节]].";
        let links = extract_links(body);
        assert_eq!(links.len(), 3);
        assert_eq!(links[0].target_raw, "另一篇笔记");
        assert_eq!(links[0].link_type, "wiki");
        assert_eq!(links[1].display_text, Some("显示文本".to_string()));
        assert_eq!(links[2].anchor, Some("章节".to_string()));
    }

    #[test]
    fn test_extract_links_markdown() {
        let body = "See [relative](../notes/foo.md) and [section](bar.md#heading).";
        let links = extract_links(body);
        assert_eq!(links.iter().filter(|l| l.link_type == "markdown").count(), 2);
        assert_eq!(links[1].anchor, Some("heading".to_string()));
    }

    #[test]
    fn test_extract_links_skips_http() {
        let body = "Visit [google](https://google.com) for more.";
        let links = extract_links(body);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target_raw, "https://google.com");
        assert_eq!(links[0].display_text, Some("google".to_string()));
        assert_eq!(links[0].link_type, "external");
    }

    #[test]
    fn test_extract_links_skips_inline_code_spans() {
        let body = "Inline code `[[假链接]]` and ` [假的](code.md) ` should be ignored, but [[真实笔记]] stays.";
        let links = extract_links(body);

        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target_raw, "真实笔记");
        assert_eq!(links[0].link_type, "wiki");
    }

    #[test]
    fn test_extract_links_skips_indented_code_blocks() {
        let body = "    [[代码块假链接]]\n    [假的](snippet.md)\nOutside [[真实链接]]";
        let links = extract_links(body);

        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target_raw, "真实链接");
        assert_eq!(links[0].link_type, "wiki");
    }

    #[test]
    fn test_extract_lookback_summary_from_body_block() {
        let body = [
            "# 标题",
            "",
            "> 摘要：第一行摘要",
            "> 第二行摘要",
            "",
            "正文内容",
        ]
        .join("\n");

        let summary = extract_lookback_summary(&body);
        assert_eq!(summary.as_deref(), Some("第一行摘要\n第二行摘要"));
    }

    #[test]
    fn test_upsert_lookback_summary_block_places_block_below_h1() {
        let body = ["# 标题", "", "正文第一段"].join("\n");

        let updated = upsert_lookback_summary_block(&body, "新的摘要");

        let expected = [
            "# 标题",
            "",
            "> 摘要：新的摘要",
            "",
            "正文第一段",
        ]
        .join("\n");
        assert_eq!(updated, expected);
    }

    #[test]
    fn test_remove_lookback_summary_block_removes_visible_summary_section() {
        let body = [
            "# 标题",
            "",
            "> 摘要：将被清除",
            "",
            "正文内容",
        ]
        .join("\n");

        let updated = remove_lookback_summary_block(&body);
        assert_eq!(updated, "# 标题\n\n正文内容");
    }

    #[test]
    fn test_extract_lookback_summary_from_legacy_block() {
        let body = [
            "# 标题",
            "",
            "> **回看摘要**",
            "> 兼容旧摘要",
            "",
            "正文内容",
        ]
        .join("\n");

        let summary = extract_lookback_summary(&body);
        assert_eq!(summary.as_deref(), Some("兼容旧摘要"));
    }
}
