# Updater Publish Plan

## Files
- Release asset: /Users/lijun/mynote/src-tauri/target/release/bundle/macos/MyNote.app.tar.gz
- Release asset: /Users/lijun/mynote/src-tauri/target/release/bundle/dmg/MyNote_0.2.7_aarch64.dmg
- Manifest output: /Users/lijun/mynote/release/updater/latest.json

## Preferred Command
corepack pnpm release:publish

## GitHub Release
- Repository: lijun2212/MyNote
- Tag: v0.2.7
- Release page: https://github.com/lijun2212/MyNote/releases

## Upload Command
gh release upload v0.2.7 /Users/lijun/mynote/src-tauri/target/release/bundle/macos/MyNote.app.tar.gz /Users/lijun/mynote/src-tauri/target/release/bundle/dmg/MyNote_0.2.7_aarch64.dmg /Users/lijun/mynote/release/updater/latest.json --repo lijun2212/MyNote --clobber

## Manifest Command
corepack pnpm updater:manifest <version> --platform darwin-aarch64=https://github.com/lijun2212/MyNote/releases/download/v0.2.7/MyNote.app.tar.gz::/Users/lijun/mynote/src-tauri/target/release/bundle/macos/MyNote.app.tar.gz.sig --output /Users/lijun/mynote/release/updater/latest.json

## Latest Release URL
- https://github.com/lijun2212/MyNote/releases/latest/download/latest.json

