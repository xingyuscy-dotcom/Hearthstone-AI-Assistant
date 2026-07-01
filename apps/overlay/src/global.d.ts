type OverlayModePayload = {
  mode: "standalone" | "attached";
  label: string;
};

interface Window {
  hearthstoneOverlay?: {
    onModeChanged(callback: (payload: OverlayModePayload) => void): () => void;
    close(): void;
  };
}
