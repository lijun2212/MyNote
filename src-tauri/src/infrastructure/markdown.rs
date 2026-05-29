// src-tauri/src/infrastructure/markdown.rs
use crate::error::{AppError, AppResult};

#[derive(Debug, Default, serde::Serialize, serde::Deserialize, Clone)]
pub struct FrontMatter {
    pub id: Option<String>,
    pub title: Option<String>,
    pub tags: Option<Vec<String>>,
    pub summary: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub aliases: Option<Vec<String>>,
}

#[derive(Debug)]
pub struct ParsedNote {
    pub front_matter: FrontMatter,
    pub body: String,
    pub title: String,
    pub word_count: usize,
}

/// 分离 Front Matter 和正文
pub fn split_front_matter(content: &str) -> (Option<&str>, &str) {
    if !content.starts_with("---") {
        return (None, content);
    }
    let rest = &content[3..];
    if let Some(end_pos) = rest.find("\n---") {
        let fm = &rest[..end_pos];
        let body_start = end_pos + 4; // 跳过 \n---
        let body = rest.get(body_start..).unwrap_or("").trim_start_matches('\n');
        (Some(fm), body)
    } else {
        (None, content)
    }
}

/// 解析 Front Matter YAML
pub fn parse_front_matter(fm_str: &str) -> AppResult<FrontMatter> {
    serde_yaml::from_str(fm_str).map_err(|e| AppError::Parse(e.to_string()))
}

/// 从正文提取第一个一级标题
pub fn extract_h1(body: &str) -> Option<String> {
    for line in body.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("# ") {
            return Some(rest.trim().to_string());
        }
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
    let front_matter = if let Some(fm) = fm_str {
        parse_front_matter(fm)?
    } else {
        FrontMatter::default()
    };

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

/// 将 Front Matter 序列化并与正文重新组合
pub fn render_note(fm: &FrontMatter, body: &str) -> AppResult<String> {
    let fm_str = serde_yaml::to_string(fm).map_err(|e| AppError::Parse(e.to_string()))?;
    Ok(format!("---\n{}---\n\n{}", fm_str, body))
}

/// 从正文提取内联标签（#标签），跳过代码块和 URL 片段
pub fn extract_inline_tags(body: &str) -> Vec<String> {
    let mut tags = Vec::new();
    let mut in_code_block = false;
    let mut in_inline_code = false;

    for line in body.lines() {
        in_inline_code = false;
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") {
            in_code_block = !in_code_block;
            continue;
        }
        if in_code_block {
            continue;
        }

        // Scan character by character
        let chars: Vec<char> = line.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            // Toggle inline code
            if chars[i] == '`' {
                in_inline_code = !in_inline_code;
                i += 1;
                continue;
            }
            if in_inline_code {
                i += 1;
                continue;
            }
            // Check for URL scheme before #
            if chars[i] == '#' {
                // Not a tag if preceded by '/' or part of URL (look back for "://")
                let prefix: String = chars[..i].iter().collect();
                if prefix.ends_with("://") || prefix.ends_with('/') {
                    i += 1;
                    continue;
                }
                // Must be at start of line or preceded by whitespace
                let preceded_by_space = i == 0 || chars[i - 1].is_whitespace();
                if !preceded_by_space {
                    i += 1;
                    continue;
                }
                // Collect tag name
                let start = i + 1;
                let mut end = start;
                while end < chars.len() {
                    let c = chars[end];
                    if c.is_alphanumeric() || c == '-' || c == '_' {
                        end += 1;
                    } else {
                        break;
                    }
                }
                if end > start {
                    let tag: String = chars[start..end].iter().collect();
                    tags.push(tag);
                    i = end;
                    continue;
                }
            }
            i += 1;
        }
    }
    tags.sort();
    tags.dedup();
    tags
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
        if trimmed.starts_with("```") {
            in_code_block = !in_code_block;
            offset += line.len() + 1;
            continue;
        }
        if in_code_block {
            offset += line.len() + 1;
            continue;
        }

        // Extract wiki links: [[target]], [[target|text]], [[target#anchor]]
        let mut search_from = 0;
        while let Some(start) = line[search_from..].find("[[") {
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
            // Only relative .md links or relative asset links
            if href.starts_with("http://") || href.starts_with("https://") {
                search_from = actual_start + bracket_end + paren_end + 3;
                continue;
            }
            let link_type = if is_image { "asset" } else { "markdown" };
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
    fn test_extract_h1() {
        assert_eq!(extract_h1("# Hello World\nsome text"), Some("Hello World".into()));
        assert_eq!(extract_h1("no heading"), None);
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
        assert_eq!(links.len(), 0);
    }
}
