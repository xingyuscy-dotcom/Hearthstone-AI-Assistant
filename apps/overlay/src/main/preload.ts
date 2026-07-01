import { contextBridge, ipcRenderer } from "electron";

type OverlayModePayload = {
  mode: "standalone" | "attached";
  label: string;
};

contextBridge.exposeInMainWorld("hearthstoneOverlay", {
  onModeChanged(callback: (payload: OverlayModePayload) => void) {
    const listener = (_event: Electron.IpcRendererEvent, payload: OverlayModePayload) => {
      callback(payload);
    };
    ipcRenderer.on("overlay-mode-changed", listener);
    return () => ipcRenderer.removeListener("overlay-mode-changed", listener);
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
});
