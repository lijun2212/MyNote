use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

/// 原子写入：先写临时文件，再 rename 替换
pub fn atomic_write(path: &Path, content: &str) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::InvalidInput(format!("No parent dir for {:?}", path)))?;
    std::fs::create_dir_all(parent)?;
    let file_name = path
        .file_name()
        .ok_or_else(|| AppError::InvalidInput(format!("No file name in {:?}", path)))?
        .to_string_lossy();
    let tmp_path = parent.join(format!(".{}.tmp", file_name));
    std::fs::write(&tmp_path, content)?;
    std::fs::rename(&tmp_path, path)?;
    Ok(())
}

/// 归一化路径：分隔符统一为 /，返回相对根目录的路径字符串
pub fn normalize_relative(root: &Path, abs_path: &Path) -> AppResult<String> {
    let rel = abs_path
        .strip_prefix(root)
        .map_err(|_| AppError::InvalidInput(format!("{:?} not under root {:?}", abs_path, root)))?;
    Ok(rel.to_string_lossy().replace('\\', "/"))
}

/// 安全文件名：移除路径中非法字符
pub fn safe_filename(name: &str) -> String {
    let result = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c => c,
        })
        .collect::<String>()
        .trim()
        .to_string();
    if result.is_empty() {
        "unnamed".to_string()
    } else {
        result
    }
}

/// 从根目录和相对路径构造绝对路径
pub fn abs_path(root: &Path, relative: &str) -> PathBuf {
    root.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_safe_filename() {
        assert_eq!(safe_filename("hello/world"), "hello-world");
        assert_eq!(safe_filename("my note"), "my note");
        assert_eq!(safe_filename("标题"), "标题");
    }

    #[test]
    fn test_atomic_write_creates_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("test.md");
        atomic_write(&path, "hello").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "hello");
    }

    #[test]
    fn test_safe_filename_empty_returns_unnamed() {
        assert_eq!(safe_filename(""), "unnamed");
        assert_eq!(safe_filename("   "), "unnamed");
    }

    #[test]
    fn test_abs_path() {
        let root = Path::new("/home/user/kb");
        let result = abs_path(root, "notes/a.md");
        assert!(result.ends_with("a.md"));
    }

    #[test]
    fn test_normalize_relative() {
        let root = Path::new("/home/user/kb");
        let abs = Path::new("/home/user/kb/notes/a.md");
        assert_eq!(normalize_relative(root, abs).unwrap(), "notes/a.md");
    }
}
