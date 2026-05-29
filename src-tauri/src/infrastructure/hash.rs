use sha2::{Digest, Sha256};

pub fn sha256_str(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_content_produces_same_hash() {
        let a = sha256_str("hello world");
        let b = sha256_str("hello world");
        assert_eq!(a, b);
    }

    #[test]
    fn different_content_produces_different_hash() {
        let a = sha256_str("hello");
        let b = sha256_str("world");
        assert_ne!(a, b);
    }
}
