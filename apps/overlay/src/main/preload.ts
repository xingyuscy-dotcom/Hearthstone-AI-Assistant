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
});

let dragging = false;
let activePointerId: number | null = null;

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
      !target.closest(".assistant-panel") ||
      target.closest("button, a, input, textarea, select, [data-no-drag]")
    ) {
      return;
    }

    dragging = true;
    activePointerId = event.pointerId;
    target.setPointerCapture(event.pointerId);
    ipcRenderer.send("overlay-drag-start", { x: event.screenX, y: event.screenY });
    event.preventDefault();
  });

  document.addEventListener("pointermove", (event) => {
    if (!dragging || event.pointerId !== activePointerId) return;
    ipcRenderer.send("overlay-drag-move", { x: event.screenX, y: event.screenY });
  });

  const endDrag = (event: PointerEvent) => {
    if (!dragging || event.pointerId !== activePointerId) return;
    dragging = false;
    activePointerId = null;
    ipcRenderer.send("overlay-drag-end");
  };

  document.addEventListener("pointerup", endDrag);
  document.addEventListener("pointercancel", endDrag);
});
