import { app, BrowserWindow, globalShortcut, ipcMain, screen } from "electron";
import {
  appendFileSync,
  closeSync,
  readdirSync,
  existsSync,
  openSync,
  readSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

type OverlayMode = "standalone" | "attached";

type PageState = {
  mode: string | null;
  label: string;
  inGame: boolean;
};

type WindowInfo = {
  title: string;
  bounds: { x: number; y: number; width: number; height: number };
  contentBounds?: { x: number; y: number; width: number; height: number };
  owner: { name: string; processId: number; path: string };
};

type Bounds = WindowInfo["bounds"];
type Size = { width: number; height: number };

type GetWindowsApi = {
  activeWindow: () => Promise<WindowInfo | undefined>;
  openWindows: () => Promise<WindowInfo[]>;
};

const rendererPath = path.join(__dirname, "../renderer/index.html");
const preloadPath = path.join(__dirname, "preload.js");
const runtimeLogPath = path.join(process.cwd(), "floating-runtime.log");
const localAppDataLoadingScreenLogPath = path.join(
  process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
  "Blizzard",
  "Hearthstone",
  "Logs",
  "LoadingScreen.log",
);
const loadGetWindows = new Function("return import('get-windows')") as () => Promise<GetWindowsApi>;
const overlaySizeLimit = {
  minWidth: 320,
  maxWidth: 420,
  minHeight: 560,
  maxHeight: 760,
  margin: 12,
};

let floatingWindow: BrowserWindow | null = null;
let manuallyVisible = true;
let polling = false;
let overlayMode: OverlayMode = "standalone";
let lastGameBounds: Bounds | null = null;
let lastGameWindow: WindowInfo | null = null;
let userOffset: { x: number; y: number } | null = null;
let standaloneBounds: Bounds | null = null;
let dragStart:
  | {
      cursorX: number;
      cursorY: number;
      windowX: number;
      windowY: number;
      width: number;
      height: number;
    }
  | null = null;
let dragTimer: NodeJS.Timeout | null = null;
let sizeContextKey: string | null = null;
let stableOverlaySize: Size | null = null;
let pageState: PageState = {
  mode: null,
  label: "等待页面状态",
  inGame: false,
};

writeFileSync(runtimeLogPath, "", "utf8");

function logRuntime(event: string, details?: unknown) {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  appendFileSync(runtimeLogPath, `[${new Date().toISOString()}] ${event}${suffix}\n`, "utf8");
}

function getPageLabel(mode: string | null) {
  if (!mode) return "等待页面状态";

  const labels: Record<string, string> = {
    GAMEPLAY: "战斗中",
    HUB: "主页面",
    COLLECTIONMANAGER: "收藏",
    PACKOPENING: "开包",
    TOURNAMENT: "对战选择",
    DRAFT: "竞技场",
    TAVERN_BRAWL: "乱斗",
    BACON: "酒馆战棋",
    GAME_MODE: "模式选择",
    ADVENTURE: "冒险",
    FRIENDLY: "好友对战",
  };

  return labels[mode] ?? "未知页面";
}

function sendPageStateToRenderer() {
  floatingWindow?.webContents.send("page-state-changed", pageState);
}

function setPageState(nextState: PageState) {
  if (
    pageState.mode === nextState.mode &&
    pageState.label === nextState.label &&
    pageState.inGame === nextState.inGame
  ) {
    return;
  }

  pageState = nextState;
  logRuntime("page-state", nextState);
  sendPageStateToRenderer();
}

function readFileTail(filePath: string, maxBytes: number) {
  const stats = statSync(filePath);
  const start = Math.max(0, stats.size - maxBytes);
  const length = stats.size - start;
  const buffer = Buffer.alloc(length);
  const fd = openSync(filePath, "r");

  try {
    readSync(fd, buffer, 0, length, start);
  } finally {
    closeSync(fd);
  }

  return buffer.toString("utf8");
}

function getLatestLoadingScreenLogPathFromGame(gameWindow?: WindowInfo) {
  if (!gameWindow?.owner.path) return null;

  const gameDirectory = path.dirname(gameWindow.owner.path);
  const logsDirectory = path.join(gameDirectory, "Logs");
  if (!existsSync(logsDirectory)) return null;

  const sessionDirectories = readdirSync(logsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^Hearthstone_/i.test(entry.name))
    .map((entry) => {
      const directoryPath = path.join(logsDirectory, entry.name);
      const loadingLogPath = path.join(directoryPath, "LoadingScreen.log");
      if (!existsSync(loadingLogPath)) return null;
      const logStats = statSync(loadingLogPath);
      return {
        loadingLogPath,
        logSize: logStats.size,
        lastWriteTime: statSync(directoryPath).mtimeMs,
      };
    })
    .filter((entry): entry is { loadingLogPath: string; logSize: number; lastWriteTime: number } =>
      Boolean(entry),
    )
    .sort((left, right) => right.lastWriteTime - left.lastWriteTime);

  return (
    sessionDirectories.find((entry) => entry.logSize > 0)?.loadingLogPath ??
    sessionDirectories[0]?.loadingLogPath ??
    null
  );
}

function getLoadingScreenLogPath(gameWindow?: WindowInfo) {
  const installLogPath = getLatestLoadingScreenLogPathFromGame(gameWindow);
  if (installLogPath) return installLogPath;
  if (existsSync(localAppDataLoadingScreenLogPath)) return localAppDataLoadingScreenLogPath;
  return null;
}

function parseLatestPageMode(logText: string) {
  const matches = [...logText.matchAll(/\b(?:currMode|nextMode)=([A-Z0-9_]+)/g)];
  const latest = matches.at(-1);
  return latest?.[1] ?? null;
}

function syncPageState(gameWindow?: WindowInfo) {
  try {
    const loadingScreenLogPath = getLoadingScreenLogPath(gameWindow);
    if (!loadingScreenLogPath) {
      setPageState({ mode: null, label: "等待页面状态", inGame: false });
      return;
    }

    const latestMode = parseLatestPageMode(readFileTail(loadingScreenLogPath, 64 * 1024));
    const label = getPageLabel(latestMode);
    setPageState({
      mode: latestMode,
      label,
      inGame: latestMode === "GAMEPLAY",
    });
  } catch (error) {
    logRuntime("page-state-error", String(error));
    setPageState({ mode: null, label: "等待页面状态", inGame: false });
  }
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
  const bounds = floatingWindow?.getBounds();
  floatingWindow?.webContents.send("overlay-mode-changed", {
    mode: overlayMode,
    label: overlayMode === "attached" ? "已附着到炉石" : "等待炉石启动",
    bounds: bounds
      ? { width: bounds.width, height: bounds.height }
      : getAdaptiveOverlaySize(screen.getPrimaryDisplay().workArea),
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
  sizeContextKey = null;
  lastGameBounds = nextMode === "attached" ? lastGameBounds : null;
  floatingWindow.setSkipTaskbar(nextMode === "attached");

  if (nextMode === "attached") {
    floatingWindow.setAlwaysOnTop(true, "floating");
    floatingWindow.setVisibleOnAllWorkspaces(false);
  } else {
    floatingWindow.setAlwaysOnTop(false);
    floatingWindow.setVisibleOnAllWorkspaces(false);
  }

  logRuntime("overlay-mode", { mode: nextMode });
  sendModeToRenderer();
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getAdaptiveOverlaySize(container: { width: number; height: number }) {
  const maxWidth = Math.max(280, container.width - overlaySizeLimit.margin * 2);
  const maxHeight = Math.max(480, container.height - overlaySizeLimit.margin * 2);
  const minWidth = Math.min(overlaySizeLimit.minWidth, maxWidth);
  const minHeight = Math.min(overlaySizeLimit.minHeight, maxHeight);

  return {
    width: Math.round(
      clampNumber(container.width * 0.24, minWidth, Math.min(overlaySizeLimit.maxWidth, maxWidth)),
    ),
    height: Math.round(
      clampNumber(
        container.height * 0.82,
        minHeight,
        Math.min(overlaySizeLimit.maxHeight, maxHeight),
      ),
    ),
  };
}

function getSizeContextKey(mode: OverlayMode, container: { width: number; height: number }) {
  return mode + ":" + Math.round(container.width) + "x" + Math.round(container.height);
}

function getStableOverlaySize(mode: OverlayMode, container: { width: number; height: number }) {
  const nextKey = getSizeContextKey(mode, container);
  if (!stableOverlaySize || sizeContextKey !== nextKey) {
    stableOverlaySize = getAdaptiveOverlaySize(container);
    sizeContextKey = nextKey;
    logRuntime("overlay-size-updated", { mode, container, overlaySize: stableOverlaySize });
    return { size: stableOverlaySize, changed: true };
  }

  return { size: stableOverlaySize, changed: false };
}

function getCenteredStandaloneBounds(size: Size) {
  const { workArea } = screen.getPrimaryDisplay();

  return {
    x: Math.round(workArea.x + (workArea.width - size.width) / 2),
    y: Math.round(workArea.y + (workArea.height - size.height) / 2),
    width: size.width,
    height: size.height,
  };
}

function createFloatingWindow() {
  const initialSize = getStableOverlaySize("standalone", screen.getPrimaryDisplay().workArea).size;
  floatingWindow = new BrowserWindow({
    width: initialSize.width,
    height: initialSize.height,
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
  floatingWindow.webContents.on("did-finish-load", () => {
    sendModeToRenderer();
    sendPageStateToRenderer();
  });
  floatingWindow.on("resize", sendModeToRenderer);
  floatingWindow.on("move", () => {
    if (!floatingWindow || dragStart) return;
    const bounds = floatingWindow.getBounds();

    if (overlayMode === "attached" && lastGameBounds) {
      userOffset = {
        x: bounds.x - lastGameBounds.x,
        y: bounds.y - lastGameBounds.y,
      };
      return;
    }

    standaloneBounds = bounds;
    sendModeToRenderer();
  });
  floatingWindow.on("closed", () => {
    floatingWindow = null;
  });
}

function clampOverlayBounds(bounds: Bounds) {
  if (overlayMode !== "attached" || !lastGameBounds) return bounds;

  const minX = lastGameBounds.x + 12;
  const minY = lastGameBounds.y + 12;
  const maxX = lastGameBounds.x + lastGameBounds.width - bounds.width - 12;
  const maxY = lastGameBounds.y + lastGameBounds.height - bounds.height - 12;

  return {
    ...bounds,
    x: Math.min(maxX, Math.max(minX, bounds.x)),
    y: Math.min(maxY, Math.max(minY, bounds.y)),
  };
}

function updateDragPosition() {
  if (!floatingWindow || !dragStart) return;

  const currentBounds = floatingWindow.getBounds();
  const cursor = screen.getCursorScreenPoint();
  const nextBounds = clampOverlayBounds({
    x: dragStart.windowX + cursor.x - dragStart.cursorX,
    y: dragStart.windowY + cursor.y - dragStart.cursorY,
    width: dragStart.width,
    height: dragStart.height,
  });

  if (
    currentBounds.width !== dragStart.width ||
    currentBounds.height !== dragStart.height
  ) {
    floatingWindow.setBounds(nextBounds, false);
  } else if (currentBounds.x !== nextBounds.x || currentBounds.y !== nextBounds.y) {
    floatingWindow.setPosition(nextBounds.x, nextBounds.y, false);
  }

  if (overlayMode === "attached" && lastGameBounds) {
    userOffset = {
      x: nextBounds.x - lastGameBounds.x,
      y: nextBounds.y - lastGameBounds.y,
    };
  } else {
    standaloneBounds = nextBounds;
  }
}

function stopDragging() {
  if (dragTimer) {
    clearInterval(dragTimer);
    dragTimer = null;
  }
  dragStart = null;
}

function registerDragHandlers() {
  ipcMain.on("overlay-close", () => {
    logRuntime("manual-close");
    floatingWindow?.destroy();
    app.quit();
  });

  ipcMain.on("overlay-drag-start", () => {
    if (!floatingWindow) return;
    stopDragging();

    const cursor = screen.getCursorScreenPoint();
    const bounds = floatingWindow.getBounds();
    dragStart = {
      cursorX: cursor.x,
      cursorY: cursor.y,
      windowX: bounds.x,
      windowY: bounds.y,
      width: bounds.width,
      height: bounds.height,
    };
    dragTimer = setInterval(updateDragPosition, 16);
  });

  ipcMain.on("overlay-drag-end", () => {
    updateDragPosition();
    stopDragging();
  });
}

async function syncWithHearthstone() {
  if (polling || !floatingWindow || dragStart) return;
  polling = true;

  try {
    const { activeWindow, openWindows } = await loadGetWindows();
    const windows = await openWindows();
    const gameWindow = windows.find(isHearthstoneWindow);
    const foregroundWindow = await activeWindow();
    const overlayIsForeground = Boolean(
      foregroundWindow &&
        (foregroundWindow.owner.processId === process.pid ||
          foregroundWindow.title === "炉石决策助手"),
    );

    if (!gameWindow) {
      lastGameWindow = null;
      setOverlayMode("standalone");

      if (!manuallyVisible) {
        floatingWindow.hide();
        return;
      }

      const { workArea } = screen.getPrimaryDisplay();
      const { size, changed } = getStableOverlaySize("standalone", workArea);
      const savedBounds =
        standaloneBounds && !changed ? { ...standaloneBounds, width: size.width, height: size.height } : null;
      const nextBounds = savedBounds ?? getCenteredStandaloneBounds(size);
      const currentBounds = floatingWindow.getBounds();
      if (currentBounds.width !== nextBounds.width || currentBounds.height !== nextBounds.height) {
        floatingWindow.setBounds(nextBounds, false);
        logRuntime("standalone-positioned", { overlayBounds: nextBounds });
        sendModeToRenderer();
      } else if (currentBounds.x !== nextBounds.x || currentBounds.y !== nextBounds.y) {
        floatingWindow.setPosition(nextBounds.x, nextBounds.y, false);
      }

      if (!floatingWindow.isVisible()) {
        floatingWindow.show();
        logRuntime("standalone-shown");
      }
      return;
    }

    lastGameWindow = gameWindow;
    syncPageState(gameWindow);

    if (overlayMode !== "attached") {
      logRuntime("game-detected");
    }

    setOverlayMode("attached");

    const gameIsForeground = Boolean(
      foregroundWindow &&
        (foregroundWindow.owner.processId === gameWindow.owner.processId || overlayIsForeground),
    );

    if (!manuallyVisible || !gameIsForeground) {
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
    const { size, changed } = getStableOverlaySize("attached", gameBounds);
    const { width, height } = size;
    const maxOffsetX = Math.max(12, gameBounds.width - width - 12);
    const maxOffsetY = Math.max(12, gameBounds.height - height - 12);
    const defaultOffset = {
      x: maxOffsetX,
      y: Math.max(12, Math.round((gameBounds.height - height) / 2)),
    };
    const offset = changed ? defaultOffset : userOffset ?? defaultOffset;
    const x = gameBounds.x + Math.min(maxOffsetX, Math.max(12, offset.x));
    const y = gameBounds.y + Math.min(maxOffsetY, Math.max(12, offset.y));
    const nextBounds = { x, y, width, height };
    const currentBounds = floatingWindow.getBounds();

    if (currentBounds.width !== width || currentBounds.height !== height) {
      floatingWindow.setBounds(nextBounds, false);
      logRuntime("overlay-positioned", { scaleFactor, gameBounds, overlayBounds: nextBounds });
      sendModeToRenderer();
    } else if (currentBounds.x !== x || currentBounds.y !== y) {
      floatingWindow.setPosition(x, y, false);
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
  syncPageState(lastGameWindow ?? undefined);
  setInterval(() => void syncWithHearthstone(), 750);
  setInterval(() => syncPageState(lastGameWindow ?? undefined), 1000);
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  app.quit();
});
