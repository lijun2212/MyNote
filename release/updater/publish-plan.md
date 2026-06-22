# Updater Publish Plan

## Files
- Release asset: D:\apps\mynote\src-tauri\target\release\bundle\nsis\MyNote_0.2.8_x64-setup.exe
- Release asset: D:\apps\mynote\src-tauri\target\release\bundle\msi\MyNote_0.2.8_x64_en-US.msi
- Manifest output: D:\apps\mynote\release\updater\latest.json

## Preferred Command
corepack pnpm release:publish

## GitHub Release
- Repository: lijun2212/MyNote
- Tag: v0.2.8
- Release page: https://github.com/lijun2212/MyNote/releases

## Upload Command
gh release upload v0.2.8 D:\apps\mynote\src-tauri\target\release\bundle\nsis\MyNote_0.2.8_x64-setup.exe D:\apps\mynote\src-tauri\target\release\bundle\msi\MyNote_0.2.8_x64_en-US.msi D:\apps\mynote\release\updater\latest.json --repo lijun2212/MyNote --clobber

## Manifest Command
corepack pnpm updater:manifest <version> --platform windows-x86_64=https://github.com/lijun2212/MyNote/releases/download/v0.2.8/MyNote_0.2.8_x64-setup.exe::D:\apps\mynote\src-tauri\target\release\bundle\nsis\MyNote_0.2.8_x64-setup.exe.sig --output D:\apps\mynote\release\updater\latest.json

## Latest Release URL
- https://github.com/lijun2212/MyNote/releases/latest/download/latest.json

