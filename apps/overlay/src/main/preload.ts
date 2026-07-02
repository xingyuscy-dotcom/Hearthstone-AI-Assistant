import { contextBridge, ipcRenderer } from "electron";

type OverlayModePayload = {
  mode: "standalone" | "attached";
  label: string;
  bounds: {
    width: number;
    height: number;
  };
};

type PageStatePayload = {
  mode: string | null;
  label: string;
  inGame: boolean;
};

contextBridge.exposeInMainWorld("hearthstoneOverlay", {
  onModeChanged(callback: (payload: OverlayModePayload) => void) {
    const listener = (_event: Electron.IpcRendererEvent, payload: OverlayModePayload) => {
      callback(payload);
    };
    ipcRenderer.on("overlay-mode-changed", listener);
    return () => ipcRenderer.removeListener("overlay-mode-changed", listener);
  },
  onPageStateChanged(callback: (payload: PageStatePayload) => void) {
    const listener = (_event: Electron.IpcRendererEvent, payload: PageStatePayload) => {
      callback(payload);
    };
    ipcRenderer.on("page-state-changed", listener);
    return () => ipcRenderer.removeListener("page-state-changed", listener);
  },
  close() {
    ipcRenderer.send("overlay-close");
  },
});

window.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('[data-overlay-action="close"]')) {
      ipcRenderer.send("overlay-close");
    }
  });

  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (
      event.button !== 0 ||
      !(target instanceof HTMLElement) ||
      !target.closest(".panel-header") ||
      target.closest("button, a, input, textarea, select")
    ) {
      return;
    }

    ipcRenderer.send("overlay-drag-start");
    event.preventDefault();
  });

  const endDrag = () => {
    ipcRenderer.send("overlay-drag-end");
  };

  document.addEventListener("pointerup", endDrag);
  document.addEventListener("pointercancel", endDrag);
  window.addEventListener("blur", endDrag);
});
