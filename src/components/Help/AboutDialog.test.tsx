import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import appReleaseMetadata from "../../config/appReleaseMetadata.json";
import { tauriMocks } from "../../test/setup";
import { deferred } from "../../test/testData";
import { checkForManualUpdate } from "../../updater/manualUpdate";
import { AboutDialog } from "./AboutDialog";

describe("AboutDialog", () => {
  it("renders the approved about content with runtime app version", async () => {
    tauriMocks.getVersion.mockResolvedValue("0.2.3");

    render(<AboutDialog open onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "关于 MyNote" })).toBeInTheDocument();
    expect(screen.getByText("MyNote")).toBeInTheDocument();
    expect(await screen.findByText("版本 0.2.3")).toBeInTheDocument();
    expect(screen.getByText("本地优先的个人知识库与笔记应用")).toBeInTheDocument();
    expect(screen.getByText("帮助用户记录、整理并沉淀自己的知识与日常")).toBeInTheDocument();
    expect(screen.getByText("个人开发者 LJ")).toBeInTheDocument();
    expect(screen.getByText("发布时间")).toBeInTheDocument();
    expect(screen.getByText(appReleaseMetadata.releaseDate)).toBeInTheDocument();
    expect(screen.getByText("Copyright © 2026 LJ. All rights reserved.")).toBeInTheDocument();
  });

  it("closes via close button, overlay click, and Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    const { rerender } = render(<AboutDialog open onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "关闭关于弹窗" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    await user.click(screen.getByTestId("about-dialog-overlay"));
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    rerender(<AboutDialog open onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not render when closed", () => {
    render(<AboutDialog open={false} onClose={vi.fn()} />);

    expect(screen.queryByRole("dialog", { name: "关于 MyNote" })).not.toBeInTheDocument();
  });

  it("checks for updates from the about dialog and reports when already up to date", async () => {
    const user = userEvent.setup();
    const pendingResult = deferred<{ status: "up-to-date"; currentVersion: string }>();
    const onCheckForUpdates = vi.fn().mockReturnValue(pendingResult.promise);

    tauriMocks.getVersion.mockResolvedValue("0.2.3");

    render(<AboutDialog open onClose={vi.fn()} onCheckForUpdates={onCheckForUpdates} />);

    await user.click(screen.getByRole("button", { name: "检查更新" }));

    expect(onCheckForUpdates).toHaveBeenCalledOnce();
    expect(screen.getByText("正在检查更新...")).toBeInTheDocument();

    pendingResult.resolve({
      status: "up-to-date",
      currentVersion: "0.2.3",
    });

    expect(await screen.findByText("当前已是最新版本 0.2.3")).toBeInTheDocument();
  });

  it("shows the latest version when an update is available", async () => {
    const user = userEvent.setup();
    const onCheckForUpdates = vi.fn().mockResolvedValue({
      status: "update-available",
      currentVersion: "0.2.3",
      version: "0.2.4",
      date: "2026 年 6 月 20 日",
      body: "修复稳定性问题",
    });

    tauriMocks.getVersion.mockResolvedValue("0.2.3");

    render(<AboutDialog open onClose={vi.fn()} onCheckForUpdates={onCheckForUpdates} />);

    await user.click(screen.getByRole("button", { name: "检查更新" }));

    expect(await screen.findByText("发现新版本 0.2.4")).toBeInTheDocument();
    expect(screen.getByText("发布时间：2026 年 6 月 20 日")).toBeInTheDocument();
    expect(screen.getByText("修复稳定性问题")).toBeInTheDocument();
  });

  it("prompts the user to restart manually after installing an update", async () => {
    const user = userEvent.setup();
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    tauriMocks.getVersion.mockResolvedValue("0.2.5");

    render(
      <AboutDialog
        open
        onClose={vi.fn()}
        onCheckForUpdates={vi.fn().mockResolvedValue({
          status: "update-available",
          currentVersion: "0.2.5",
          version: "0.2.6",
          date: "2026 年 6 月 20 日",
          body: "修复稳定性问题",
          update: { downloadAndInstall },
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "检查更新" }));
    await screen.findByText("发现新版本 0.2.6");
    await user.click(screen.getByRole("button", { name: "立即更新" }));

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(await screen.findByText("版本 0.2.6 已安装，请手动重启应用完成更新。")).toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it("uses the updater plugin when provider is tauri-updater", async () => {
    tauriMocks.updaterCheck.mockResolvedValue({
      currentVersion: "0.2.3",
      version: "0.2.4",
      date: "2026-06-20T00:00:00.000Z",
      body: "修复稳定性问题",
      downloadAndInstall: vi.fn(),
    });

    const result = await checkForManualUpdate({
      provider: "tauri-updater",
      releasePageUrl: "https://example.com/releases",
      updaterManifestUrl: "https://example.com/latest.json",
      updaterPubkey: "mock-pubkey",
    });

    expect(tauriMocks.updaterCheck).toHaveBeenCalledOnce();
    expect(tauriMocks.openUrl).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "update-available",
      currentVersion: "0.2.3",
      version: "0.2.4",
    });
  });

  it("returns the runtime app version when already up to date", async () => {
    tauriMocks.getVersion.mockResolvedValue("0.2.3");
    tauriMocks.updaterCheck.mockResolvedValue(null);

    const result = await checkForManualUpdate({
      provider: "tauri-updater",
      releasePageUrl: "https://example.com/releases",
      updaterManifestUrl: "https://example.com/latest.json",
      updaterPubkey: "mock-pubkey",
    });

    expect(tauriMocks.updaterCheck).toHaveBeenCalledOnce();
    expect(tauriMocks.getVersion).toHaveBeenCalledOnce();
    expect(result).toEqual({
      status: "up-to-date",
      currentVersion: "0.2.3",
    });
  });

  it("keeps using the release page while provider remains release-page", async () => {
    const result = await checkForManualUpdate({
      provider: "release-page",
      releasePageUrl: "https://example.com/releases",
      updaterManifestUrl: "https://example.com/latest.json",
      updaterPubkey: "configured-pubkey",
    });

    expect(tauriMocks.openUrl).toHaveBeenCalledWith("https://example.com/releases");
    expect(tauriMocks.updaterCheck).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "release-page",
      releasePageUrl: "https://example.com/releases",
    });
  });
});