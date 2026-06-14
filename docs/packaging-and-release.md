# 打包与发布说明 {#packaging-and-release}

## 修订记录 {#revision-history}

| 版本 | 日期 | 说明 |
| --- | --- | --- |
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
4. [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json) 中 `beforeBuildCommand` 为 `pnpm build`，因此即使原生环境正常，只要前端依赖或 Node 环境不符合要求，桌面打包也会失败。

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
corepack --version
corepack pnpm -v
```

期望结果：

1. `node -v` 输出 `v22.x.x`。
2. `corepack pnpm -v` 输出 `11.x.x`。
3. 三条命令都能在新开的终端里直接执行。

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
corepack pnpm tauri build
```

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

建议：

1. 在原生 Windows 机器或 Windows CI runner 上执行。
2. 不要把 macOS 上的构建结果当作 Windows 最终安装包替代品。
3. 若要做正式发布，优先在干净的 Windows 环境里验证安装、启动和卸载。

补充说明：

1. Windows 机器上最常见的问题不是 `pnpm build`，而是缺少 MSVC Build Tools，导致 Rust 原生编译或 Tauri bundling 失败。
2. 如果 `cl.exe` 不存在，先修 Visual Studio Build Tools，不要继续排查业务代码。
3. 如果要在 CI 中出 Windows 包，建议固定使用包含 Visual Studio 2022 Build Tools 的 runner 镜像。

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