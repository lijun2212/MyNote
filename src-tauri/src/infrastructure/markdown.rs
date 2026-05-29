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
}
