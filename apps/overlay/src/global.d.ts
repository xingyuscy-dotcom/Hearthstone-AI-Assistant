type OverlayModePayload = {
  mode: "standalone" | "attached";
  label: string;
  bounds: {
    width: number;
    height: number;
  };
};

interface Window {
  hearthstoneOverlay?: {
    onModeChanged(callback: (payload: OverlayModePayload) => void): () => void;
    close(): void;
  };
}
