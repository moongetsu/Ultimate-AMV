import { FolderKanban } from "lucide-react";

export function SelectFileButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="extract-vocals-button glass spring-motion" onClick={onClick}>
      <span className="surface-mark extract-mark accent-glow">
        <FolderKanban size={34} strokeWidth={1.8} />
      </span>
      <span>Select files</span>
      <span className="extract-hint">Audio or video : each file gets vocals and instrumental saved next to the original.</span>
    </button>
  );
}
