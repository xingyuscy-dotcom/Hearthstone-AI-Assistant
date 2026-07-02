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

interface Window {
  hearthstoneOverlay?: {
    onModeChanged(callback: (payload: OverlayModePayload) => void): () => void;
    onPageStateChanged(callback: (payload: PageStatePayload) => void): () => void;
    close(): void;
  };
}
