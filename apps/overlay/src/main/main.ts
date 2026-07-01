import { app as electronApp, BrowserWindow } from "electron";
import { overwolf } from "@overwolf/ow-electron";
import type {
  IOverwolfOverlayApi,
  OverlayBrowserWindow,
  OverlayWindowOptions,
} from "@overwolf/ow-electron-packages-types";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { appendFileSync, writeFileSync } from "node:fs";

const HEARTHSTONE_GAME_ID = 9898;
const app = electronApp as overwolf.OverwolfApp;
const rendererPath = path.join(__dirname, "../renderer/index.html");
const runtimeLogPath = path.join(process.cwd(), "overlay-runtime.log");

type OverlayApi = IOverwolfOverlayApi & {
  requestGameInjection?: (classId: number) => Promise<void>;
};

writeFileSync(runtimeLogPath, "", "utf8");

function logRuntime(event: string, details?: unknown) {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  const line = `[${new Date().toISOString()}] ${event}${suffix}`;
  console.log(line);
  appendFileSync(runtimeLogPath, `${line}\n`, "utf8");
}

let overlayApi: OverlayApi | null = null;
let overlayWindow: OverlayBrowserWindow | null = null;
let previewWindow: BrowserWindow | null = null;

function showDesktopPreview() {
  previewWindow = new BrowserWindow({
    width: 430,
    height: 760,
    resizable: true,
    backgroundColor: "#080b10",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  void previewWindow.loadURL(`${pathToFileURL(rendererPath).toString()}?preview=1`);
  previewWindow.on("closed", () => {
    previewWindow = null;
  });
}

async function createGameOverlay() {
  if (!overlayApi || overlayWindow) {
    return;
  }

  const activeGameInfo = overlayApi.getActiveGameInfo();
  const gameWindow = activeGameInfo?.gameWindowInfo;
  logRuntime("create-overlay", activeGameInfo);
  const width = 404;
  const height = 742;
  const options: OverlayWindowOptions = {
    name: "hearthstone-ai-advice",
    width,
    height,
    x: Math.max(12, (gameWindow?.size.width ?? 1920) - width - 24),
    y: Math.max(12, Math.floor(((gameWindow?.size.height ?? 1080) - height) / 2)),
    show: true,
    frame: false,
    transparent: true,
    resizable: false,
    passthrough: "passThrough",
    ignoreKeyboardInput: true,
    zOrder: "topMost",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true,
    },
  };

  overlayWindow = await overlayApi.createWindow(options);
  await overlayWindow.window.loadURL(pathToFileURL(rendererPath).toString());
  overlayWindow.window.show();
  logRuntime("overlay-created", { windows: overlayApi.getAllWindows().length });
  overlayWindow.window.on("closed", () => {
    overlayWindow = null;
  });
}

function registerOverlayEvents(api: IOverwolfOverlayApi) {
  api.on("game-launched", (event, gameInfo) => {
    logRuntime("game-launched", gameInfo);
    if (!gameInfo.supported) {
      logRuntime("game-not-supported", gameInfo);
      return;
    }
    if (gameInfo.processInfo?.isElevated) {
      logRuntime("game-is-elevated", gameInfo);
      return;
    }
    event.inject();
    logRuntime("inject-requested", { classId: gameInfo.classId });
  });

  api.on("game-injected", (gameInfo) => {
    logRuntime("game-injected", gameInfo);
    void createGameOverlay();
  });

  api.on("game-focus-changed", (_window, _game, focused) => {
    if (!overlayWindow) return;
    if (focused) overlayWindow.window.show();
    else overlayWindow.window.hide();
  });

  api.on("game-injection-error", (gameInfo, error) => {
    logRuntime("game-injection-error", { gameInfo, error });
  });

  api.on("error", (...args) => {
    logRuntime("overlay-error", args);
  });

  api.hotkeys.register(
    {
      name: "toggle-hearthstone-ai-overlay",
      keyCode: 72,
      modifiers: { ctrl: true, shift: true },
      passthrough: true,
    },
    (_hotkey, state) => {
      if (state !== "pressed" || !overlayWindow) return;
      if (overlayWindow.window.isVisible()) overlayWindow.window.hide();
      else overlayWindow.window.show();
    },
  );
}

app.overwolf.packages.on("ready", async (_event, packageName, version) => {
  if (packageName !== "overlay") return;

  overlayApi = (app.overwolf.packages as unknown as { overlay: OverlayApi }).overlay;
  logRuntime("overlay-package-ready", { version, appUid: process.env.OVERWOLF_APP_UID });
  logRuntime("overlay-api-shape", {
    keys: Object.keys(overlayApi ?? {}),
    registerGames: typeof overlayApi?.registerGames,
    requestGameInjection: typeof overlayApi?.requestGameInjection,
    createWindow: typeof overlayApi?.createWindow,
  });

  if (!overlayApi || typeof overlayApi.registerGames !== "function") {
    logRuntime("overlay-api-unavailable");
    return;
  }
  registerOverlayEvents(overlayApi);

  try {
    overlayApi.registerGames({ gamesIds: [HEARTHSTONE_GAME_ID] });
    logRuntime("game-registered", { gameId: HEARTHSTONE_GAME_ID });
  } catch (error) {
    logRuntime("game-registration-error", String(error));
    return;
  }

  if (overlayApi.requestGameInjection) {
    try {
      await overlayApi.requestGameInjection(HEARTHSTONE_GAME_ID);
    } catch (error) {
      logRuntime("late-injection-error", String(error));
    }
  } else {
    logRuntime("late-injection-unavailable");
  }
});

electronApp.whenReady().then(() => {
  logRuntime("electron-ready", { argv: process.argv });
  if (process.argv.includes("--preview")) {
    showDesktopPreview();
  }
});

electronApp.on("window-all-closed", () => {
  electronApp.quit();
});
