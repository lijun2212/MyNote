// Test to verify offset calculations in extract_links
use crate::infrastructure::markdown::extract_links;

fn main() {
    // Test case 1: Simple markdown link
    let body1 = "Line1\n[link](test.md)";
    let links1 = extract_links(body1);
    if links1.len() > 0 {
        let link = &links1[0];
        println!("Test 1 - Simple markdown link:");
        println!("  Body: {:?}", body1);
        println!("  Link offsets: {}..{}", link.start_offset, link.end_offset);
        println!("  Expected: \"[link](test.md)\"");
        if link.start_offset < body1.len() && link.end_offset <= body1.len() {
            println!("  Actual slice: {:?}", &body1[link.start_offset..link.end_offset]);
        } else {
            println!("  ERROR: Offsets out of bounds!");
        }
    }
    
    // Test case 2: Image link
    let body2 = "Text\n![img](pic.png)\nMore";
    let links2 = extract_links(body2);
    if links2.len() > 0 {
        let link = &links2[0];
        println!("\nTest 2 - Image link:");
        println!("  Body: {:?}", body2);
        println!("  Link offsets: {}..{}", link.start_offset, link.end_offset);
        println!("  Expected: \"![img](pic.png)\"");
        if link.start_offset < body2.len() && link.end_offset <= body2.len() {
            println!("  Actual slice: {:?}", &body2[link.start_offset..link.end_offset]);
        } else {
            println!("  ERROR: Offsets out of bounds!");
        }
    }
    
    // Manual calculation for body2:
    // "Text\n" = 5 chars, offset after is 5
    // "![img](pic.png)\n" starts at offset 5
    // The link "![img](pic.png)" is 16 chars
    // So it should be [5, 21]
    
    println!("\nManual calculation for Test 2:");
    println!("  'Text\\n' = 5 bytes");
    println!("  '![img](pic.png)' = 16 bytes");
    println!("  Expected offsets: [5, 21]");
}
