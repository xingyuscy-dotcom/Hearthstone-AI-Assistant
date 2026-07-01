import { app, BrowserWindow, globalShortcut, ipcMain, screen } from "electron";
import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type OverlayMode = "standalone" | "attached";

type WindowInfo = {
  title: string;
  bounds: { x: number; y: number; width: number; height: number };
  contentBounds?: { x: number; y: number; width: number; height: number };
  owner: { name: string; processId: number; path: string };
};

type GetWindowsApi = {
  activeWindow: () => Promise<WindowInfo | undefined>;
  openWindows: () => Promise<WindowInfo[]>;
};

const rendererPath = path.join(__dirname, "../renderer/index.html");
const preloadPath = path.join(__dirname, "preload.js");
const runtimeLogPath = path.join(process.cwd(), "floating-runtime.log");
const loadGetWindows = new Function("return import('get-windows')") as () => Promise<GetWindowsApi>;

let floatingWindow: BrowserWindow | null = null;
let manuallyVisible = true;
let polling = false;
let overlayMode: OverlayMode = "standalone";
let lastGameBounds: WindowInfo["bounds"] | null = null;
let userOffset: { x: number; y: number } | null = null;
let standaloneBounds: WindowInfo["bounds"] | null = null;
let dragStart: { cursorX: number; cursorY: number; windowX: number; windowY: number } | null = null;

writeFileSync(runtimeLogPath, "", "utf8");

function logRuntime(event: string, details?: unknown) {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  appendFileSync(runtimeLogPath, `[${new Date().toISOString()}] ${event}${suffix}\n`, "utf8");
}

function isHearthstoneWindow(windowInfo: WindowInfo | undefined) {
  if (!windowInfo) return false;
  const executableName = path.basename(windowInfo.owner.path);
  return (
    /^Hearthstone(?:\.exe)?$/i.test(windowInfo.owner.name) ||
    /^Hearthstone\.exe$/i.test(executableName) ||
    /^(Hearthstone|炉石传说)$/i.test(windowInfo.title.trim())
  );
}

function sendModeToRenderer() {
  floatingWindow?.webContents.send("overlay-mode-changed", {
    mode: overlayMode,
    label: overlayMode === "attached" ? "已附着到炉石" : "等待炉石启动",
  });
}

function setOverlayMode(nextMode: OverlayMode) {
  if (!floatingWindow || overlayMode === nextMode) {
    sendModeToRenderer();
    return;
  }

  if (overlayMode === "standalone") {
    standaloneBounds = floatingWindow.getBounds();
  }

  overlayMode = nextMode;
  lastGameBounds = nextMode === "attached" ? lastGameBounds : null;
  floatingWindow.setSkipTaskbar(nextMode === "attached");

  if (nextMode === "attached") {
    floatingWindow.setAlwaysOnTop(true, "screen-saver");
    floatingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } else {
    floatingWindow.setAlwaysOnTop(false);
    floatingWindow.setVisibleOnAllWorkspaces(false);
  }

  logRuntime("overlay-mode", { mode: nextMode });
  sendModeToRenderer();
}

function getDefaultStandaloneBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 404;
  const height = Math.min(742, Math.max(620, workArea.height - 48));

  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
  };
}

function createFloatingWindow() {
  floatingWindow = new BrowserWindow({
    width: 404,
    height: 742,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    focusable: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  void floatingWindow.loadURL(pathToFileURL(rendererPath).toString());
  floatingWindow.webContents.on("did-finish-load", sendModeToRenderer);
  floatingWindow.on("move", () => {
    if (!floatingWindow) return;
    const currentBounds = floatingWindow.getBounds();

    if (overlayMode === "standalone") {
      standaloneBounds = currentBounds;
      return;
    }

    if (!lastGameBounds) return;
    const maxX = Math.max(12, lastGameBounds.width - currentBounds.width - 12);
    const maxY = Math.max(12, lastGameBounds.height - currentBounds.height - 12);
    userOffset = {
      x: Math.min(maxX, Math.max(12, currentBounds.x - lastGameBounds.x)),
      y: Math.min(maxY, Math.max(12, currentBounds.y - lastGameBounds.y)),
    };
  });
  floatingWindow.on("moved", () => {
    if (!floatingWindow || !lastGameBounds || !userOffset) return;
    const currentBounds = floatingWindow.getBounds();
    const clampedBounds = {
      ...currentBounds,
      x: lastGameBounds.x + userOffset.x,
      y: lastGameBounds.y + userOffset.y,
    };
    if (currentBounds.x !== clampedBounds.x || currentBounds.y !== clampedBounds.y) {
      floatingWindow.setBounds(clampedBounds, false);
    }
    logRuntime("overlay-moved", { overlayBounds: clampedBounds });
  });
  floatingWindow.on("closed", () => {
    floatingWindow = null;
  });
}

function clampOverlayPosition(x: number, y: number) {
  if (!floatingWindow || overlayMode !== "attached" || !lastGameBounds) return { x, y };
  const bounds = floatingWindow.getBounds();
  return {
    x: Math.min(
      lastGameBounds.x + lastGameBounds.width - bounds.width - 12,
      Math.max(lastGameBounds.x + 12, x),
    ),
    y: Math.min(
      lastGameBounds.y + lastGameBounds.height - bounds.height - 12,
      Math.max(lastGameBounds.y + 12, y),
    ),
  };
}

function registerDragHandlers() {
  ipcMain.on("overlay-close", () => {
    logRuntime("manual-close");
    app.quit();
  });

  ipcMain.on("overlay-drag-start", (_event, point: { x: number; y: number }) => {
    if (!floatingWindow) return;
    const bounds = floatingWindow.getBounds();
    dragStart = {
      cursorX: point.x,
      cursorY: point.y,
      windowX: bounds.x,
      windowY: bounds.y,
    };
  });

  ipcMain.on("overlay-drag-move", (_event, point: { x: number; y: number }) => {
    if (!floatingWindow || !dragStart) return;
    const next = clampOverlayPosition(
      dragStart.windowX + point.x - dragStart.cursorX,
      dragStart.windowY + point.y - dragStart.cursorY,
    );
    floatingWindow.setPosition(Math.round(next.x), Math.round(next.y), false);
  });

  ipcMain.on("overlay-drag-end", () => {
    if (floatingWindow && dragStart) {
      logRuntime("overlay-dragged", { overlayBounds: floatingWindow.getBounds() });
    }
    dragStart = null;
  });
}

async function syncWithHearthstone() {
  if (polling || !floatingWindow) return;
  polling = true;

  try {
    const { openWindows } = await loadGetWindows();
    const windows = await openWindows();
    const gameWindow = windows.find(isHearthstoneWindow);

    if (!gameWindow) {
      setOverlayMode("standalone");

      if (!manuallyVisible) {
        floatingWindow.hide();
        return;
      }

      const nextBounds = standaloneBounds ?? getDefaultStandaloneBounds();
      const currentBounds = floatingWindow.getBounds();
      if (
        currentBounds.x !== nextBounds.x ||
        currentBounds.y !== nextBounds.y ||
        currentBounds.width !== nextBounds.width ||
        currentBounds.height !== nextBounds.height
      ) {
        floatingWindow.setBounds(nextBounds, false);
        logRuntime("standalone-positioned", { overlayBounds: nextBounds });
      }

      if (!floatingWindow.isVisible()) {
        floatingWindow.show();
        logRuntime("standalone-shown");
      }
      return;
    }

    if (overlayMode !== "attached") {
      logRuntime("game-detected");
    }

    setOverlayMode("attached");

    if (!manuallyVisible) {
      floatingWindow.hide();
      return;
    }

    const physicalBounds = gameWindow.contentBounds ?? gameWindow.bounds;
    const scaleFactor = screen.getPrimaryDisplay().scaleFactor;
    const gameBounds = {
      x: Math.round(physicalBounds.x / scaleFactor),
      y: Math.round(physicalBounds.y / scaleFactor),
      width: Math.round(physicalBounds.width / scaleFactor),
      height: Math.round(physicalBounds.height / scaleFactor),
    };
    lastGameBounds = gameBounds;
    const width = Math.min(404, Math.max(320, gameBounds.width - 24));
    const height = Math.min(742, Math.max(620, gameBounds.height - 24));
    const maxOffsetX = Math.max(12, gameBounds.width - width - 12);
    const maxOffsetY = Math.max(12, gameBounds.height - height - 12);
    const defaultOffset = {
      x: maxOffsetX,
      y: Math.max(12, Math.round((gameBounds.height - height) / 2)),
    };
    const offset = userOffset ?? defaultOffset;
    const x = gameBounds.x + Math.min(maxOffsetX, Math.max(12, offset.x));
    const y = gameBounds.y + Math.min(maxOffsetY, Math.max(12, offset.y));
    const nextBounds = { x, y, width, height };
    const currentBounds = floatingWindow.getBounds();

    if (
      currentBounds.x !== x ||
      currentBounds.y !== y ||
      currentBounds.width !== width ||
      currentBounds.height !== height
    ) {
      floatingWindow.setBounds(nextBounds, false);
      logRuntime("overlay-positioned", { scaleFactor, gameBounds, overlayBounds: nextBounds });
    }

    if (!floatingWindow.isVisible()) {
      floatingWindow.showInactive();
      logRuntime("overlay-shown");
    }
  } catch (error) {
    floatingWindow.hide();
    logRuntime("sync-error", String(error));
  } finally {
    polling = false;
  }
}

app.whenReady().then(() => {
  registerDragHandlers();
  createFloatingWindow();

  globalShortcut.register("CommandOrControl+Shift+H", () => {
    manuallyVisible = !manuallyVisible;
    logRuntime("manual-visibility", { visible: manuallyVisible });
    void syncWithHearthstone();
  });

  void syncWithHearthstone();
  setInterval(() => void syncWithHearthstone(), 750);
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  app.quit();
});
