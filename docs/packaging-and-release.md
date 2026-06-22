# 打包与发布说明 {#packaging-and-release}

## 修订记录 {#revision-history}

| 版本 | 日期 | 说明 |
| --- | --- | --- |
| 1.2 | 2026-06-22 | 修正双平台发版说明：明确 `release:build` / `release:publish` 当前只面向单宿主机单平台 updater 计划，补充 macOS + Windows 合并 `latest.json` 的发布流程，并修正源码、commit、tag 与 Release 的先后顺序。 |
| 1.1 | 2026-06-19 | 补充 Windows updater 发布说明：修正 Windows target 命名约定，明确 Windows 使用签名后的 `.exe` 或 `.msi` 作为 updater 资产，并补充安装阶段自动退出行为。 |
| 1.0 | 2026-06-19 | 修正新版本发布实操顺序：补充本地创建 Git Tag、发布后校验步骤，以及 `pnpm` 可执行性要求，避免 `release:publish` 与 tag 推送阶段踩坑。 |
| 0.9 | 2026-06-19 | 补充 GitHub + 内网 GitLab 双远端同步与发版顺序，明确源码同步与 Release 资产托管的边界。 |
| 0.8 | 2026-06-19 | 发布链切换到 GitHub Releases：`release:build` 直接生成 GitHub 版 updater 发布计划，`release:publish` 直接创建或覆盖 GitHub Release 资产。 |
| 0.7 | 2026-06-19 | 新增 `release:publish`，可读取 `publish-plan.json` 自动上传 GitLab package 并同步 Release asset links。 |
| 0.6 | 2026-06-19 | `release:build` 现可在存在签名 updater bundle 时自动生成 `latest.json` 与 GitLab 发布计划；缺少签名产物时会明确跳过。 |
| 0.5 | 2026-06-18 | `release:build` 现可在真实构建完成后自动生成 GitLab updater 发布计划文件。 |
| 0.4 | 2026-06-18 | 固定 GitLab latest release 资产托管地址，补充 Tauri updater endpoint 与 latest.json 永久链接约定。 |
| 0.3 | 2026-06-18 | 增加手动更新发布元数据准备：补充 updater key 生成、latest.json manifest 生成与发布页 fallback 说明。 |
| 0.2 | 2026-06-14 | 细化通用准备章节，补充 Node.js、pnpm/Corepack、Rust、Cargo、Tauri CLI、各平台系统依赖的版本要求、安装方式与验收命令。 |
| 0.1 | 2026-06-14 | 首版发布说明，补充 macOS、Windows、Linux 的打包命令、产物路径、清理方式与平台限制。 |

## 目录 {#table-of-contents}

1. [适用范围](#scope)
2. [当前仓库打包基线](#current-baseline)
3. [通用准备](#general-prerequisites)
4. [macOS 打包](#macos-build)
5. [Windows 打包](#windows-build)
6. [Linux 打包](#linux-build)
7. [产物位置](#artifacts)
8. [清理与重打包](#clean-build)
9. [当前已验证结果](#validated-result)
10. [已知限制](#known-limitations)
11. [手动更新准备](#manual-update-prep)
12. [GitHub 托管约定](#github-updater-hosting)
13. [双远端同步顺序](#dual-remote-release-flow)

## 适用范围 {#scope}

本文档用于说明 MyNote 的桌面安装包如何在不同平台构建，以及当前仓库已经验证过的打包路径。

适用对象：

1. 需要在本地为自己打包安装包的开发者。
2. 需要在 CI 中产出三平台安装包的维护者。
3. 需要先清理本机残留数据、再做干净发布验证的测试人员。

## 当前仓库打包基线 {#current-baseline}

MyNote 当前使用 Tauri 2、React、TypeScript 和 Rust。

当前关键配置位于：

1. [package.json](package.json)
2. [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json)
3. [src-tauri/Cargo.toml](src-tauri/Cargo.toml)

当前已知打包特征：

1. 前端构建命令为 `corepack pnpm build`。
2. 桌面打包命令为 `corepack pnpm tauri build`。
3. Tauri bundler 已启用，`bundle.targets` 当前配置为 `all`。
4. 应用标识为 `com.lijun.mynote`。
5. 当前产品名为 `MyNote`。
6. 当前手动更新入口默认已切到 `tauri-updater`，配置见 [src/config/appUpdateConfig.json](src/config/appUpdateConfig.json)。
7. 原生 updater 的目标 manifest 地址已经固定为 GitHub latest release 资产永久链接：`https://github.com/lijun2212/MyNote/releases/latest/download/latest.json`。

## 通用准备 {#general-prerequisites}

这一章的目标不是只告诉你“装什么”，而是明确告诉你“至少装到什么版本、推荐装什么版本、怎么安装、装完后如何验收”。

如果这些版本和前置依赖不符合要求，常见后果包括：

1. `pnpm install` 失败或锁文件不兼容。
2. `pnpm build` 通过，但 `pnpm tauri build` 在原生打包阶段失败。
3. 打包产物能生成，但宿主机运行时缺少系统依赖。
4. Windows、Linux 或 macOS 上的安装包格式与预期不一致。

### 版本基线 {#prerequisite-version-baseline}

当前仓库与本机已验证环境对应的版本基线如下：

| 软件 | 建议版本 | 最低建议 | 当前仓库/本机已验证 |
| --- | --- | --- | --- |
| Node.js | 22 LTS 最新稳定小版本 | 22.x | `v22.20.0` |
| Corepack | 随 Node.js 22 提供 | 与 Node.js 同步 | 已随 Node.js 提供 |
| pnpm | 11.x | 10.x 以上，建议不要低于锁文件生成版本 | `11.5.0` |
| Rust toolchain | stable 最新 | 1.96.0 或更新的 stable | `rustc 1.96.0` |
| Cargo | 与 Rust toolchain 同步 | 1.96.0 或更新 | `cargo 1.96.0` |
| Tauri CLI | 2.x | 2.x | 由 `@tauri-apps/cli` 2.x 驱动 |
| TypeScript | 5.8.x | 5.8.x | `~5.8.3` |
| Vite | 7.x | 7.x | `^7.0.4` |
| React | 19.1.x | 19.x | `^19.1.0` |

版本来源：

1. 前端依赖版本来自 [package.json](package.json)。
2. Tauri/Rust 依赖版本来自 [src-tauri/Cargo.toml](src-tauri/Cargo.toml)。
3. 本机已验证版本来自 2026-06-14 本地命令检查。

如果你要在 CI 或新的打包机上复现环境，建议优先对齐“建议版本”，不要只满足“最低建议”。

### 仓库级依赖约束 {#repository-dependency-constraints}

当前仓库对工具链有以下直接约束：

1. [package.json](package.json) 中使用 `@tauri-apps/cli: ^2`，因此必须使用 Tauri 2 工具链。
2. [src-tauri/Cargo.toml](src-tauri/Cargo.toml) 中使用 `tauri = { version = "2" }`，因此 Rust 侧也必须匹配 Tauri 2。
3. [package.json](package.json) 中使用 `vite: ^7.0.4`、`typescript: ~5.8.3`、`vitest: ^4.1.7`，Node.js 过旧时常会在安装或构建阶段出问题。
4. [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json) 中 `beforeBuildCommand` 为 `corepack pnpm build`，因此即使原生环境正常，只要前端依赖或 Node 环境不符合要求，桌面打包也会失败。

### 安装顺序 {#prerequisite-install-order}

建议严格按下面顺序准备环境：

1. 安装 Node.js 22 LTS。
2. 启用 Corepack，并激活 pnpm 11。
3. 安装 Rust stable 工具链。
4. 安装或确认可调用 Tauri CLI 2。
5. 安装平台原生依赖。
6. 在仓库根目录安装 npm 依赖与 Rust 依赖。
7. 逐项执行版本验收命令。
8. 最后再执行构建和测试验收。

### Node.js、Corepack 与 pnpm {#node-corepack-pnpm}

#### 版本要求

1. Node.js：建议 `22.x`，不要低于 `22.0.0`。
2. Corepack：与 Node.js 同步即可。
3. pnpm：建议 `11.x`，至少保证能正常读取当前 `pnpm-lock.yaml`。

#### macOS 安装方式

推荐方式一，使用 Homebrew：

```bash
brew install node@22
echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
corepack enable
corepack prepare pnpm@11.5.0 --activate
```

推荐方式二，使用 nvm：

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.zshrc
nvm install 22
nvm use 22
corepack enable
corepack prepare pnpm@11.5.0 --activate
```

#### Windows 安装方式

推荐方式一，使用 Winget：

```powershell
winget install OpenJS.NodeJS.LTS
corepack enable
corepack prepare pnpm@11.5.0 --activate
```

推荐方式二，使用官方安装包：

1. 打开 Node.js 官方网站并下载 Node.js 22 LTS Windows x64 安装包。
2. 安装时勾选将 Node.js 加入 `PATH`。
3. 安装完成后打开新的 PowerShell，执行 `corepack enable`。
4. 再执行 `corepack prepare pnpm@11.5.0 --activate`。

#### Linux 安装方式

推荐方式一，使用 nvm：

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22
corepack enable
corepack prepare pnpm@11.5.0 --activate
```

如果你必须用系统包管理器，请确保最终安装的是 Node.js 22，而不是发行版仓库里更旧的默认版本。

#### 安装完成后的验收命令

```bash
node -v
pnpm -v
corepack --version
corepack pnpm -v
```

期望结果：

1. `node -v` 输出 `v22.x.x`。
2. `pnpm -v` 和 `corepack pnpm -v` 都输出 `11.x.x`。
3. 四条命令都能在新开的终端里直接执行。

额外说明：

1. 当前发布链虽然入口统一写成 `corepack pnpm ...`，但 Tauri/依赖检查链路在某些场景下仍可能直接调用裸 `pnpm`。
2. 因此正式发版前，不要只验证 `corepack pnpm -v`，还要确认 `pnpm -v` 本身也能直接执行。
3. 如果 `corepack enable` 因系统目录权限失败，需要先把可执行的 `pnpm` shim 放进当前用户可写且已加入 `PATH` 的目录，再开始正式发版。

### Rust、Cargo 与 Rustup {#rust-cargo-rustup}

#### 版本要求

1. Rust toolchain：建议 `stable 1.96.0` 或更新。
2. Cargo：与 Rust 版本保持一致。
3. Rustup：建议使用最新版，用于统一管理 stable 工具链。

#### macOS / Linux 安装方式

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustup default stable
rustup update
```

#### Windows 安装方式

推荐方式一，使用 `rustup-init.exe`：

1. 打开 Rust 官网并下载 `rustup-init.exe`。
2. 运行后选择默认安装。
3. 安装完成后打开新的 PowerShell。
4. 执行 `rustup default stable` 和 `rustup update`。

推荐方式二，使用 Winget：

```powershell
winget install Rustlang.Rustup
rustup default stable
rustup update
```

#### 安装完成后的验收命令

```bash
rustc -V
cargo -V
rustup show active-toolchain
```

期望结果：

1. `rustc -V` 至少为 `1.96.0`。
2. `cargo -V` 与 `rustc` 主版本一致。
3. 激活工具链显示为 `stable`。

### Tauri CLI 2 {#tauri-cli}

#### 版本要求

1. 必须是 `2.x`。
2. 本仓库优先使用 Node 侧的 `@tauri-apps/cli`，不强制要求全局 `cargo tauri`。

#### 推荐安装方式

仓库已经在 [package.json](package.json) 中声明了 `@tauri-apps/cli: ^2`，因此推荐直接依赖仓库本地版本，不另外装全局版本：

```bash
corepack pnpm install
corepack pnpm tauri --version
```

如果你确实需要全局 Rust 侧 CLI，也应明确安装 `2.x`：

```bash
cargo install tauri-cli --version '^2' --locked
cargo tauri --version
```

#### 安装完成后的验收命令

```bash
corepack pnpm tauri --version
```

如果安装了 Rust 全局 CLI，也可以额外检查：

```bash
cargo tauri --version
```

### 平台原生依赖 {#platform-native-dependencies}

这一部分最容易被忽略，但它决定 `tauri build` 能不能真的生成可安装产物。

#### macOS

版本和要求：

1. macOS 13 或更新版本，建议与目标发布机一致。
2. 已安装 Xcode Command Line Tools。
3. 如果需要正式签名和公证，还需要额外的 Apple Developer 证书和 notarization 配置；当前文档先覆盖无签名本地构建。

安装方式：

```bash
xcode-select --install
```

验收命令：

```bash
xcode-select -p
clang --version
```

期望结果：

1. `xcode-select -p` 能输出有效路径。
2. `clang --version` 能正常输出版本信息。

#### Windows

版本和要求：

1. Windows 10 或 Windows 11 64 位。
2. Visual Studio 2022 Build Tools，必须包含 `Desktop development with C++`。
3. 建议同时安装 Windows 11 SDK。
4. 若要生成 `.msi`，还需要确保 WiX 或 Tauri 所需的 Windows bundling 组件可用；正式发布建议在 CI 中固定镜像。

推荐安装方式：

1. 下载并安装 Visual Studio 2022 Build Tools。
2. 勾选 `Desktop development with C++`。
3. 勾选最新可用的 MSVC v143 工具链。
4. 勾选 Windows 10/11 SDK。

验收命令：

```powershell
rustup show
where.exe cl
```

期望结果：

1. `rustup show` 中默认 host 为 `x86_64-pc-windows-msvc`。
2. `where.exe cl` 能找到 MSVC 编译器。

#### Linux

版本和要求：

1. 建议使用较新的 Ubuntu LTS，例如 22.04 或 24.04。
2. 必需原生依赖通常包括：`build-essential`、`pkg-config`、`libwebkit2gtk`、`libgtk-3-dev`、`libayatana-appindicator3-dev`、`librsvg2-dev`。
3. 如果目标是构建 `.deb` 或 `.AppImage`，还需要对应打包工具在宿主机可用。

Ubuntu / Debian 推荐安装命令：

```bash
sudo apt update
sudo apt install -y \
	build-essential \
	curl \
	wget \
	file \
	libxdo-dev \
	libssl-dev \
	libayatana-appindicator3-dev \
	librsvg2-dev \
	libwebkit2gtk-4.1-dev \
	libgtk-3-dev \
	pkg-config
```

验收命令：

```bash
pkg-config --modversion gtk+-3.0
pkg-config --modversion webkit2gtk-4.1
```

期望结果：

1. 两条命令都能输出版本号。
2. 不应出现 `Package ... was not found`。

### 仓库依赖安装 {#install-repository-dependencies}

完成上面的全局环境准备后，在仓库根目录执行：

```bash
corepack enable
corepack prepare pnpm@11.5.0 --activate
corepack pnpm install
```

如果你是首次在新机器上拉起这个仓库，建议再执行：

```bash
corepack pnpm tauri --version
cd src-tauri && cargo fetch
```

这样可以提前暴露 Node 侧依赖或 Rust crate 下载问题，而不是等到正式打包时才失败。

### 打包前最终验收 {#preflight-checklist}

在开始 `tauri build` 之前，建议按下面顺序做一次完整预检：

#### 1. 版本验收

```bash
node -v
pnpm -v
corepack pnpm -v
rustc -V
cargo -V
corepack pnpm tauri --version
```

#### 2. 仓库依赖安装验收

```bash
corepack pnpm install --frozen-lockfile
```

#### 3. 前端构建验收

```bash
corepack pnpm build
```

#### 4. Rust 测试验收

```bash
cd src-tauri && cargo test
```

#### 5. 最终结论

只有当下面四件事同时成立时，才建议进入正式打包：

1. 版本命令全部输出符合预期。
2. `pnpm install --frozen-lockfile` 成功。
3. `corepack pnpm build` 成功。
4. `cd src-tauri && cargo test` 成功。

如果这四步里任意一步失败，先修复环境或依赖问题，不要直接继续尝试生成安装包。

## macOS 打包 {#macos-build}

在 macOS 主机上，直接在仓库根目录执行：

```bash
corepack pnpm release:build v0.1.0
```

如果当前提交已经打上精确的 Git Tag，也可以直接让脚本从当前 HEAD 自动读取发布版本：

```bash
git tag v0.1.0
corepack pnpm release:build
```

`release:build` 会先执行 `prepare:release`，确认版本号和发布时间已经同步，然后再调用 `corepack pnpm tauri build`。

当真实构建成功且当前平台已经产出带 `.sig` 的 updater bundle 后，`release:build` 还会额外在 `release/updater/` 下生成三份发布辅助文件：

1. `latest.json`：当前这台构建机对应平台的 Tauri updater 静态 manifest，直接读取 `.sig` 文件内容生成。
2. `publish-plan.json`：结构化的 GitHub updater 发布计划，包含当前平台安装包、补充安装包资产、manifest 输出路径、GitHub 仓库和 release tag。
3. `publish-plan.md`：可直接照着执行的文本化发布指引，包含 manifest 生成命令、`gh release upload` 命令模板，以及 `latest` 固定下载地址。

这里要特别注意当前脚本的边界：

1. 一次 `release:build` 只会为当前宿主机平台生成一份 `latest.json` 和一份 `publish-plan.json`。
2. 一次 `release:publish` 也只会上传当前工作区里这份单平台计划引用的资产。
3. 如果你的 updater 需要同时支持 macOS 和 Windows，不能把两台机器各自执行一次 `release:publish` 当作最终流程；否则后执行的平台会覆盖前一个平台的 `latest.json`。

如果你已经拿到了 `publish-plan.json`，后续优先执行：

```bash
corepack pnpm release:publish
```

这个命令会读取 `release/updater/publish-plan.json`，自动完成两类动作：

1. 如果目标 tag 还没有 GitHub Release，则先在当前 `HEAD` 上创建对应 release。
2. 把 updater bundle、补充安装包资产和 `latest.json` 上传到 GitHub Release，并在同名资产已存在时自动覆盖。

如果只是想先看将执行什么动作，可以执行：

```bash
corepack pnpm release:publish --dry-run
```

`release:publish` 依赖本机已经安装并登录 `gh`。如果只想预演上传哪些资产，可直接执行 `--dry-run`，它不会修改远端 release。

### macOS 单平台发版示例 {#macos-release-walkthrough}

下面给出一套可以直接照抄的 macOS 单平台正式发版顺序。假设这次要发布 `v0.2.5`。

#### 0. 发版前最后核对

```bash
git status
pnpm -v
corepack pnpm -v
gh auth status
```

这一轮核对至少要确认四件事：

1. 工作区没有无关改动。
2. 裸 `pnpm` 命令可直接执行。
3. `corepack pnpm` 也可正常执行。
4. `gh` 已经登录到目标 GitHub 账号。

#### 1. 先同步版本元数据并提交

```bash
corepack pnpm prepare:release v0.2.5
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json src/config/appReleaseMetadata.json
git commit -m "Release v0.2.5"
```

这一步的目的，是先把版本号和发布时间对应的源码状态固定成一个明确 commit。后面的 tag、GitHub Release 和安装包，都应该对齐到这个 commit，而不是对齐到一份尚未提交的工作区修改。

#### 2. 同步源码分支

```bash
git push github main
git push origin main
```

先把将要发布的源码同步到 GitHub 和 GitLab，避免后面的安装包、源码主分支和内网镜像互相错位。

#### 3. 在本地创建并推送本次版本 tag

```bash
git rev-parse -q --verify refs/tags/v0.2.5 >/dev/null || git tag v0.2.5
git push github v0.2.5
git push origin v0.2.5
```

这里要确保 tag 指向的就是上一步刚提交并已推送的 release commit。

#### 4. 构建新版本安装包与 updater 产物

```bash
corepack pnpm release:build v0.2.5
```

这一步会自动完成：

1. 同步 [package.json](package.json)、[src-tauri/Cargo.toml](src-tauri/Cargo.toml)、[src-tauri/tauri.conf.json](src-tauri/tauri.conf.json) 和 [src/config/appReleaseMetadata.json](src/config/appReleaseMetadata.json) 的版本号与发布时间。
2. 执行 Tauri 正式构建。
3. 生成 [release/updater/latest.json](release/updater/latest.json)、[release/updater/publish-plan.json](release/updater/publish-plan.json) 和 [release/updater/publish-plan.md](release/updater/publish-plan.md)。

#### 5. 发布 GitHub Release 资产

```bash
corepack pnpm release:publish
```

当前发布脚本会自动读取 [release/updater/publish-plan.json](release/updater/publish-plan.json)，并完成两件事：

1. 如果 GitHub 上还没有 `v0.2.5` release，就自动创建。
2. 把 `latest.json`、`MyNote.app.tar.gz` 和本平台安装包上传到该 release。

这里有一个边界要明确：

1. `release:publish` 只读取本地工作区里的 [release/updater/publish-plan.json](release/updater/publish-plan.json)。
2. 它不会去 GitHub 或 GitLab 读取版本号，也不会根据远端 tag 反推当前应该发布哪个版本。
3. 因此决定 `release:publish` 发哪个版本的关键，是前一步 `release:build` 在本地生成出来的 `publish-plan.json` 是否已经是目标版本。

如果这一步中途失败，在修复问题后通常可以直接再次执行同一条命令；当前上传逻辑使用 `--clobber`，会覆盖同名资产。

#### 6. 发布后校验

```bash
gh release view v0.2.5 --repo lijun2212/MyNote --json url,assets
curl -fsSL https://github.com/lijun2212/MyNote/releases/latest/download/latest.json
```

至少确认下面四件事：

1. GitHub release 页面已经存在 `v0.2.5`。
2. release 资产里至少有 `latest.json`、`MyNote.app.tar.gz` 和当前平台安装包。
3. `latest.json` 中的 `version` 已更新到 `0.2.5`。
4. `latest.json` 中的下载 URL 指向 `v0.2.5` 对应资产，而不是旧版本。

如果你还要验证应用内“检查更新”，建议最后再用上一版本安装包启动应用，手动在“关于”里点一次“检查更新”。

`prepare:release` 会完成两件事：

1. 从显式传入的 Git Tag，或当前 HEAD 的精确 Git Tag 中解析版本号。
2. 同步更新 [package.json](package.json)、[src-tauri/Cargo.toml](src-tauri/Cargo.toml)、[src-tauri/tauri.conf.json](src-tauri/tauri.conf.json) 和 [src/config/appReleaseMetadata.json](src/config/appReleaseMetadata.json) 中的版本与发布时间。

如果只想预演而不落盘，可以执行：

```bash
corepack pnpm prepare:release v0.1.0 --dry-run
corepack pnpm release:build v0.1.0 --dry-run
```

`release:build --dry-run` 当前只会预演版本同步和打包动作，不会生成 updater 文件，因为 dry-run 不会产出新的 bundle。

如果真实打包成功，但当前环境没有生成带签名的 updater bundle，例如没有提供 `TAURI_SIGNING_PRIVATE_KEY`，`release:build` 会明确打印跳过原因，而不是在打包完成后再让整个命令失败。

如果你希望先清掉旧前端产物和旧 bundle，再重新打包，可先执行：

```bash
rm -rf dist src-tauri/target/release/bundle
corepack pnpm tauri build
```

如果你还要模拟“新用户首次安装”的状态，通常还会连同当前用户的本机残留一起清理。

本仓库在 macOS 下已确认存在过的本机残留包括：

1. `~/Library/WebKit/mynote`
2. `~/Library/Preferences/mynote.plist`
3. `~/Library/Caches/mynote`
4. 系统钥匙串服务名 `mynote.ai.profile` 下的 AI secret

如果只是做开发构建，不必每次清理这些数据。

如果是做安装包验收，且希望验证“干净首次启动”，可以在确认不需要保留本机配置后手工删除这些数据，再执行打包。

## Windows 打包 {#windows-build}

在 Windows 主机上，建议使用 PowerShell 进入仓库根目录后执行：

```powershell
corepack pnpm install
corepack pnpm build
corepack pnpm tauri build
```

预期会在 Tauri release bundle 目录中生成 Windows 安装产物，通常是 `.msi`，具体取决于宿主机已安装的打包链路。

如果你的目标不是只做本地安装包，而是要让应用内“检查更新”也能真正工作，Windows 主机上的正式发版建议直接执行：

```powershell
corepack pnpm release:build v0.x.y
corepack pnpm release:publish
```

这套两步命令只适用于下面两类场景：

1. 这次只发布 Windows 单平台 updater。
2. 你只是想先把 Windows 安装包和 `.sig` 产物构建出来，后面还会再和 macOS 产物一起手工合并 `latest.json`。

对 Windows 而言，这里有两个容易混淆但必须分开的概念：

1. `.exe` 或 `.msi` 安装器本身既是用户可手动下载的安装包，也是 Tauri updater 在 Windows 上会复用的更新资产。
2. `release:build` 只有在检测到对应安装器旁边已经生成 `.sig` 文件时，才会把它写进 [release/updater/latest.json](release/updater/latest.json)。
3. 当前发布脚本已经按 Tauri 静态 manifest 约定，把 Windows 平台键规范化为 `windows-x86_64`、`windows-aarch64` 等格式，而不是 Node.js 自己的 `win32-*` 命名。

建议：

1. 在原生 Windows 机器或 Windows CI runner 上执行。
2. 不要把 macOS 上的构建结果当作 Windows 最终安装包替代品。
3. 若要做正式发布，优先在干净的 Windows 环境里验证安装、启动和卸载。

补充说明：

1. Windows 机器上最常见的问题不是 `pnpm build`，而是缺少 MSVC Build Tools，导致 Rust 原生编译或 Tauri bundling 失败。
2. 如果 `cl.exe` 不存在，先修 Visual Studio Build Tools，不要继续排查业务代码。
3. 如果要在 CI 中出 Windows 包，建议固定使用包含 Visual Studio 2022 Build Tools 的 runner 镜像。
4. Windows 上一旦真正执行 updater 安装步骤，应用会先自动退出，再由安装器继续完成更新；这和 macOS、Linux 下“下载后等待重启”的体感不完全一样，发布验收时要按 Windows 的行为预期来检查。

## Linux 打包 {#linux-build}

在 Linux 主机上，进入仓库根目录后执行：

```bash
corepack pnpm install
corepack pnpm build
corepack pnpm tauri build
```

预期会在 Tauri release bundle 目录中生成 Linux 安装产物，常见为 `.deb`、`.AppImage` 或其他由宿主机构建链决定的格式。

建议：

1. 在原生 Linux 机器或 Linux CI runner 上执行。
2. 提前安装 Tauri 在 Linux 所需的系统依赖和打包依赖。
3. 正式发布前，在目标发行版上实际安装验证一次。

补充说明：

1. Linux 上最容易遗漏的是 `webkit2gtk` 和 `gtk3` 开发包。
2. 即使 Node 和 Rust 版本完全正确，只要这两个系统库缺失，`tauri build` 仍会失败。
3. 如果你的发布目标是特定发行版，例如 Ubuntu 22.04，请优先在同版本 runner 上构建和验收。

## 产物位置 {#artifacts}

无论在哪个平台，Tauri 的 release 安装包通常都输出在：

1. [src-tauri/target/release/bundle](src-tauri/target/release/bundle)

当前仓库在 macOS 下已实际生成并验证的产物包括：

1. [src-tauri/target/release/bundle/macos/MyNote.app](src-tauri/target/release/bundle/macos/MyNote.app)
2. [src-tauri/target/release/bundle/dmg/MyNote_0.1.0_aarch64.dmg](src-tauri/target/release/bundle/dmg/MyNote_0.1.0_aarch64.dmg)

## 清理与重打包 {#clean-build}

如果你的目标是“重新生成一套干净安装包”，建议最少清理下面两类内容：

1. 前端构建输出：`dist`
2. Tauri 旧安装包输出：`src-tauri/target/release/bundle`

最小清理命令：

```bash
rm -rf dist src-tauri/target/release/bundle
corepack pnpm tauri build
```

如果你的目标是“像新用户那样重新验证首次安装”，则还要额外清理当前用户的运行时残留，例如缓存、偏好和钥匙串条目。

这一步属于测试环境清理，不建议在不确认后果的情况下对日常开发机长期配置反复执行。

## 当前已验证结果 {#validated-result}

截至 2026-06-14，当前仓库已在本机 macOS 环境完成以下验证：

1. `corepack pnpm build` 通过。
2. 清理了本机 MyNote 相关缓存、偏好、WebKit 数据和已有 AI secret 条目。
3. 删除了旧的 bundle 输出后重新执行了 `corepack pnpm tauri build`。
4. 成功生成 macOS app bundle 与 dmg 安装包。

本次已验证产物：

1. [src-tauri/target/release/bundle/macos/MyNote.app](src-tauri/target/release/bundle/macos/MyNote.app)
2. [src-tauri/target/release/bundle/dmg/MyNote_0.1.0_aarch64.dmg](src-tauri/target/release/bundle/dmg/MyNote_0.1.0_aarch64.dmg)

其中可执行文件已核实为 arm64 架构。

## 已知限制 {#known-limitations}

当前这台机器只能直接产出 macOS 安装包，不能在本机上直接产出经过原生验证的 Windows 和 Linux 最终安装包。

原因是三平台桌面安装包通常都需要对应平台的原生构建环境、系统依赖和打包工具链。

因此，推荐发布策略是：

1. macOS 包在 macOS runner 上构建。
2. Windows 包在 Windows runner 上构建。
3. Linux 包在 Linux runner 上构建。

如果后续要做正式三平台发布，建议把上述命令接入 CI，并在每个平台独立保存 release artifact。

## 手动更新准备 {#manual-update-prep}

当前仓库已经具备“手动更新入口”和“发布元数据生成脚本”，并且默认 provider 已经切到 `tauri-updater`。

如果你要继续推进到真正的 Tauri updater，需要至少准备三样东西：

1. updater 私钥
2. updater 公钥
3. 可公开访问的 `latest.json` manifest 与对应安装包 URL

### 第一步：生成 updater key {#manual-update-keygen}

建议在仓库根目录执行：

```bash
corepack pnpm updater:keygen --dry-run
corepack pnpm updater:keygen
```

默认会把私钥写到 `.local/updater/updater.key`。

注意：

1. 私钥不要提交到 git。
2. Tauri CLI 会在终端输出公钥字符串，后续要把它填到真正的 updater 配置里。
3. 如果你需要换位置，也可以直接传路径，例如：

```bash
corepack pnpm updater:keygen .local/updater/prod.key
```

### 第二步：生成 latest.json manifest {#manual-update-manifest}

当你已经有安装包的下载 URL 和对应 `.sig` 文件后，可以生成静态 manifest：

```bash
corepack pnpm updater:manifest 0.2.3 \
	--pub-date 2026-06-18T00:00:00.000Z \
	--notes "修复稳定性问题" \
	--platform darwin-aarch64=https://example.com/MyNote_0.2.3_aarch64.app.tar.gz::release/signatures/darwin-aarch64.sig \
	--output release/updater/latest.json
```

脚本会读取 `.sig` 文件内容并写出如下结构的静态 manifest：

```json
{
	"version": "0.2.3",
	"notes": "修复稳定性问题",
	"pub_date": "2026-06-18T00:00:00.000Z",
	"platforms": {
		"darwin-aarch64": {
			"url": "https://example.com/MyNote_0.2.3_aarch64.app.tar.gz",
			"signature": "...sig file content..."
		}
	}
}
```

如果只想预演而不落盘：

```bash
corepack pnpm updater:manifest 0.2.3 \
	--platform darwin-aarch64=https://example.com/MyNote_0.2.3_aarch64.app.tar.gz::release/signatures/darwin-aarch64.sig \
	--dry-run
```

### 第三步：何时切换到真正的应用内 updater {#manual-update-provider-switch}

当前 [src/config/appUpdateConfig.json](src/config/appUpdateConfig.json) 中已经预留：

1. `provider`
2. `releasePageUrl`
3. `updaterManifestUrl`
4. `updaterPubkey`

当前仓库已经不是“预留未启用”状态，而是已经默认走 `tauri-updater`。这一节保留的意义，主要是帮助你判断什么时候这条链路仍然会失效。

原因不是前端没接好，而是如果 manifest URL、签名公钥或 release 资产不完整，即使 provider 已经是 `tauri-updater`，“检查更新”仍然会在运行时失败。

建议顺序：

1. 先生成 key。
2. 再为每个发布版本生成 `latest.json`。
3. 把 `latest.json` 和安装包放到稳定可公开访问的 URL。
4. 最后确认 [src/config/appUpdateConfig.json](src/config/appUpdateConfig.json) 与 [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json) 中的 manifest URL、公钥与本次发布资产保持一致。

## GitHub 托管约定 {#github-updater-hosting}

当前仓库的 updater 静态 JSON 与签名产物，统一按 GitHub Releases 资产方案托管。

固定约定如下：

1. `latest.json` 作为 GitHub Release asset 上传到每个版本 release。
2. 对应永久最新发布地址为 `https://github.com/lijun2212/MyNote/releases/latest/download/latest.json`。
3. [src/config/appUpdateConfig.json](src/config/appUpdateConfig.json) 中的 `updaterManifestUrl` 已经指向该地址。
4. [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json) 中的 updater endpoint 也已对齐该地址。

发布时你需要确保对应版本 release 中至少存在三个核心资产：

1. `latest.json`：Tauri updater 查询更新时访问的静态 manifest。
2. 当前平台对应的 updater 资产：macOS 下通常是 `MyNote.app.tar.gz`，Windows 下通常是签名后的 `.exe` 或 `.msi`，Linux 下通常是 `.AppImage`。
3. 当前平台面向手工下载安装的补充安装包，例如 macOS 下的 `.dmg`；Windows 上如果 updater 复用了 `.exe` 或 `.msi`，这个资产本身往往同时承担“手动安装包”和“updater 安装包”两种角色。

### 当前脚本边界 {#github-updater-hosting-script-boundary}

当前仓库里 `release:build` / `release:publish` 的自动化边界要明确：

1. 一台构建机执行一次 `release:build`，只会生成当前平台的一份 `latest.json`。
2. 一台构建机执行一次 `release:publish`，只会上传当前工作区里的这份单平台 `latest.json` 和本地计划文件里的资产。
3. 因此如果你同时支持 macOS 和 Windows updater，不能简单在两台机器上各自执行一遍 `release:publish` 就结束；这样会让最后一次上传的 `latest.json` 覆盖前一平台。

### macOS + Windows 双平台 updater 推荐流程 {#github-updater-hosting-macos-windows-flow}

如果本次版本需要同时支持 macOS 和 Windows 的应用内更新，推荐按下面顺序执行：

#### 1. 先固定源码版本

在一台主控机器上完成：

```bash
corepack pnpm prepare:release v0.x.y
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json src/config/appReleaseMetadata.json
git commit -m "Release v0.x.y"
git push github main
git push origin main
git rev-parse -q --verify refs/tags/v0.x.y >/dev/null || git tag v0.x.y
git push github v0.x.y
git push origin v0.x.y
```

这一步完成后，后续 macOS 和 Windows 打包机都应该基于同一个 release commit 或同一个 `v0.x.y` tag 来构建。

#### 2. 在 macOS 上构建并保留产物

```bash
corepack pnpm release:build v0.x.y
```

至少保留下面四类文件：

1. `src-tauri/target/release/bundle/macos/MyNote.app.tar.gz`
2. `src-tauri/target/release/bundle/macos/MyNote.app.tar.gz.sig`
3. `src-tauri/target/release/bundle/dmg/*.dmg`
4. `release/updater/publish-plan.json`

#### 3. 在 Windows 上构建并保留产物

```powershell
corepack pnpm release:build v0.x.y
```

至少保留下面四类文件：

1. `src-tauri/target/release/bundle/nsis/*.exe`
2. `src-tauri/target/release/bundle/nsis/*.exe.sig`
3. `src-tauri/target/release/bundle/msi/*.msi`
4. `release/updater/publish-plan.json`

#### 4. 先上传平台资产，再最后上传合并后的 `latest.json`

这一阶段不要直接把两台机器各自生成的 `latest.json` 当作最终结果。正确做法是：

1. 先把 macOS 和 Windows 的平台资产都上传到同一个 GitHub Release。
2. 最后生成一份同时包含 `darwin-*` 和 `windows-*` 两组平台键的合并 `latest.json`。
3. 再把这份合并后的 `latest.json` 上传到 GitHub Release，并覆盖同名资产。

可以直接使用仓库里的 `updater:manifest` 来生成合并 manifest，例如：

```bash
corepack pnpm updater:manifest 0.x.y \
	--platform darwin-aarch64=https://github.com/lijun2212/MyNote/releases/download/v0.x.y/MyNote.app.tar.gz::src-tauri/target/release/bundle/macos/MyNote.app.tar.gz.sig \
	--platform windows-x86_64=https://github.com/lijun2212/MyNote/releases/download/v0.x.y/MyNote_0.x.y_x64-setup.exe::src-tauri/target/release/bundle/nsis/MyNote_0.x.y_x64-setup.exe.sig \
	--output release/updater/latest.json
```

如果 Windows 实际上以 `.msi` 作为 updater 资产，就把对应的 URL 和 `.sig` 文件替换成 `.msi` 版本。

#### 5. 最终校验标准

最终上传完成后，`latest.json` 里至少应同时看到：

1. `darwin-aarch64` 或你实际支持的 macOS 平台键。
2. `windows-x86_64` 或你实际支持的 Windows 平台键。

只要缺少其中任意一个，那个平台的应用内更新就不会命中对应资产。

原生 updater 的公钥已经写入配置，默认 provider 也已经切到 `tauri-updater`：

1. [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json) 和 [src/config/appUpdateConfig.json](src/config/appUpdateConfig.json) 已经回填同一份真实 updater 公钥。
2. 当前默认 provider 已切到 `tauri-updater`，因为 GitHub Release 上的 `latest.json` 和对应安装包资产已经完成首次托管。
3. 只要后续版本继续沿用同一把 updater 私钥签名，并保证最终上传到 GitHub Release 的 `latest.json` 同时包含所有受支持平台，这条更新链就能持续工作。
4. Windows 需要额外记住一点：`latest.json` 里的平台键必须是 `windows-*`，不能写成 `win32-*`，否则客户端即使拿到了 manifest 也不会命中对应平台资产。

## 双远端同步顺序 {#dual-remote-release-flow}

当前仓库同时存在两个远端：

1. `github`：公开仓库，负责托管 GitHub Release 资产与 updater 的 `latest.json`。
2. `origin`：内网 GitLab 仓库，当前主要作为源码镜像与内网代码同步目标。

这两个远端承担的职责不同：

1. GitHub 负责“源码 + Release 资产”。
2. GitLab 当前只负责“源码同步”，不再承担 updater 资产托管。

因此，后续每次正式发版建议固定按下面顺序执行。

### 一次完整发版的推荐顺序 {#dual-remote-release-flow-steps}

假设目标版本为 `v0.x.y`：

```bash
git status
corepack pnpm prepare:release v0.x.y
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json src/config/appReleaseMetadata.json
git commit -m "Release v0.x.y"
git push github main
git push origin main
git rev-parse -q --verify refs/tags/v0.x.y >/dev/null || git tag v0.x.y
git push github v0.x.y
git push origin v0.x.y
```

如果这次只做单平台 updater，后续再在对应平台机器上继续执行：

```bash
corepack pnpm release:build v0.x.y
corepack pnpm release:publish
```

如果这次要同时支持 macOS 和 Windows updater，不要在这里直接结束，而应继续执行上文 [macOS + Windows 双平台 updater 推荐流程](#github-updater-hosting-macos-windows-flow) 中的双平台构建、资产上传和合并 `latest.json` 步骤。

上面每一步的含义分别是：

1. `git status`
	确认工作区干净，避免把未提交改动混进发布构建。
2. `corepack pnpm prepare:release v0.x.y`
	先把版本号和发布时间同步到受版本控制的文件里，但这一步本身还不创建 tag，也不上传任何资产。
3. `git add ... && git commit -m "Release v0.x.y"`
	先把 release 元数据固定成一个明确 commit；后面的 tag 和 GitHub Release 都应对齐到这个 commit，而不是对齐到一份未提交工作区修改。
4. `git push github main`
	先把 release commit 推到 GitHub，保证后面 GitHub Release 如果自动创建，`--target HEAD` 指向的是 GitHub 已可见的 commit。
5. `git push origin main`
	再把同一份源码同步到内网 GitLab，保证内网镜像不落后。
6. `git rev-parse -q --verify refs/tags/v0.x.y >/dev/null || git tag v0.x.y`
	在本地创建本次发布 tag；这是后续 `git push github v0.x.y` 和 `git push origin v0.x.y` 能成功的前提，这个命令输出可能正常为空，表示 tag 已存在。
7. `git push github v0.x.y`
	把版本 tag 推到 GitHub，保证源码 tag 与 release tag 对齐。
8. `git push origin v0.x.y`
	把同一版本 tag 也同步到内网 GitLab，方便内网按 tag 检出源码。

后续平台构建和 GitHub Release 资产上传，应根据你是做单平台 updater，还是做 macOS + Windows 双平台 updater，分别进入上面的对应流程。

### 最小日常同步顺序 {#dual-remote-release-flow-daily}

如果这次不是正式发版，只是普通开发提交同步，最小步骤就是：

```bash
git push github main
git push origin main
```

### 什么时候只需要推源码，不需要发 Release {#dual-remote-release-flow-source-only}

下面这些情况通常只需要同步源码，不需要执行 `release:build` / `release:publish`：

1. 普通功能开发提交。
2. 文档、测试、脚本调整，但还不准备生成安装包。
3. 只是想让 GitHub 与 GitLab 代码保持一致。

### 什么时候必须重新发 GitHub Release {#dual-remote-release-flow-release-required}

下面这些情况不能只推源码，必须重新执行发版链路：

1. 更新了 [src/config/appUpdateConfig.json](src/config/appUpdateConfig.json) 或 [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json) 里的 updater 配置。
2. 更新了应用版本号或发布时间。
3. 变更了任何会进入安装包的前端、Rust、Tauri 代码。
4. 重新生成了 updater 签名 key，或重新生成了签名 bundle / `latest.json`。

### 一个重要边界 {#dual-remote-release-flow-boundary}

即使你已经执行了：

```bash
git push origin main
git push origin v0.x.y
```

也只代表 GitLab 上的“源码”和“tag”同步了。

这并不等于：

1. GitLab 拥有 GitHub Release 上的安装包资产。
2. GitLab 可以替代 GitHub 提供 `latest.json`。
3. Tauri updater 会从 GitLab 下载更新。

当前 updater 固定依赖 GitHub Release 资产，所以真正影响用户更新能力的是 GitHub 上的 release 是否完整，而不是 GitLab 是否有同名 tag。