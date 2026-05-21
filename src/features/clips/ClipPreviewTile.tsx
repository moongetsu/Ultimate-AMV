import React from "react";
import { CheckCircle2, Circle } from "lucide-react";
import type { ClipPreviewItem, ClipVideoRange } from "../../types/clip";

// Currently dead code : see FINDINGS.md. Moved here unchanged during the
// main.tsx split to keep that work move-only.
function sourceClipPlaybackRange(clip: ClipPreviewItem): ClipVideoRange {
  const safeFps = Number.isFinite(clip.fps) && clip.fps > 0 ? clip.fps : 24;
  const offset = clip.index === 0 || clip.sourceStart <= 0 ? 0 : 1.5 / safeFps;
  return {
    id: `${clip.id}-source`,
    src: clip.sourceSrc,
    start: clip.sourceStart + offset,
    end: clip.sourceEnd,
  };
}
void sourceClipPlaybackRange;

function previewClipPlaybackRange(clip: ClipPreviewItem): ClipVideoRange | null {
  const state = clip.previewState;
  if (state?.status !== "ready" || !state.src || !state.duration) return null;
  return {
    id: `${clip.id}-preview`,
    src: state.src,
    start: 0,
    end: state.duration,
  };
}

const THUMBNAIL_CACHE = new Map<string, string>();

function useWebpThumbnail(src: string | undefined) {
  const [thumbnail, setThumbnail] = React.useState<string | null>(() =>
    src ? (THUMBNAIL_CACHE.get(src) ?? null) : null,
  );

  React.useEffect(() => {
    if (!src) {
      setThumbnail(null);
      return;
    }
    const cached = THUMBNAIL_CACHE.get(src);
    if (cached) {
      setThumbnail(cached);
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || 426;
        canvas.height = img.naturalHeight || 240;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.75);
        THUMBNAIL_CACHE.set(src, dataUrl);
        setThumbnail(dataUrl);
      } catch (e) {
        console.error("Failed to generate clip thumbnail:", e);
      }
    };
    img.src = src;

    return () => {
      cancelled = true;
      img.onload = null;
    };
  }, [src]);

  return thumbnail;
}

export function ClipPreviewTile({
  clip,
  selected,
  mergeMode,
  mergePosition,
  paused,
  playable,
  activationEpoch,
  clipHoverPreview,
  onClick,
  onToggleSelect,
}: {
  clip: ClipPreviewItem;
  selected: boolean;
  mergeMode: boolean;
  mergePosition: number | null;
  paused: boolean;
  playable: boolean;
  activationEpoch: number;
  clipHoverPreview: boolean;
  onClick: (modifiers: { ctrl: boolean; shift: boolean }) => void;
  onToggleSelect: () => void;
}) {
  const [isHovered, setIsHovered] = React.useState(false);

  const previewRange = previewClipPlaybackRange(clip);
  const isPlayActive = !clipHoverPreview || isHovered;
  const shouldPlay = Boolean(previewRange) && playable && !paused && isPlayActive;
  const thumbnail = useWebpThumbnail(previewRange?.src);
  const placeholderLoading = playable && clip.previewState?.status !== "error";
  const loopDuration = previewRange
    ? Math.max(0.45, previewRange.end - previewRange.start)
    : 0;
  const [isReady, setIsReady] = React.useState(false);

  // Bumps on every shouldPlay false→true transition inside this mounted
  // tile (hover replay, playable cap flips). Combined with activationEpoch
  // it forces Chromium to re-decode from frame 0 so the animated image
  // and the CSS progress bar restart in lockstep. Init is 0 (NOT
  // Date.now()) so Virtuoso scroll-recycle remounts reuse the browser's
  // disk-decoded WebP cache instead of re-fetching every time a tile
  // re-enters the overscan window — a per-mount-unique URL would
  // re-decode the entire visible grid on every long scroll.
  const [playToken, setPlayToken] = React.useState(0);
  const wasPlayingRef = React.useRef(shouldPlay);
  React.useLayoutEffect(() => {
    if (shouldPlay && !wasPlayingRef.current) {
      setPlayToken((value) => value + 1);
    }
    wasPlayingRef.current = shouldPlay;
  }, [shouldPlay]);

  React.useEffect(() => {
    setIsReady(false);
  }, [previewRange?.src, activationEpoch, playToken]);

  return (
    <div
      className={`clip-preview-tile-wrapper ${selected ? "is-selected" : ""}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <button
        type="button"
        className={`clip-preview-tile spring-motion ${selected ? "is-selected" : ""} ${mergeMode ? "is-selectable" : ""}`}
        onClick={(e) => onClick({ ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })}
      >
        {/* Base layer: the static thumbnail when we have one, placeholder otherwise. */}
        {/* Stays mounted while shouldPlay flips so the animated WebP fades in over */}
        {/* a matching frame instead of an empty/stale slot — fixes hover ghost-morph. */}
        {thumbnail ? (
          <img src={thumbnail} alt="" className="is-ready clip-static-thumbnail" />
        ) : (
          <span
            className={`clip-video-placeholder ${(shouldPlay && !isReady) || placeholderLoading ? "is-loading" : ""}`}
          />
        )}
        {shouldPlay && previewRange && (
          <img
            key={`${previewRange.id}-${activationEpoch}-${playToken}`}
            src={`${previewRange.src}?v=${activationEpoch}-${playToken}`}
            alt=""
            className={`clip-animated-overlay ${isReady ? "is-ready" : "is-loading"}`}
            onLoad={() => setIsReady(true)}
            onError={() => setIsReady(false)}
          />
        )}
        {shouldPlay && previewRange && isReady && (
          <span
            className="clip-loop-progress"
            style={{ "--clip-loop-duration": `${loopDuration}s` } as React.CSSProperties}
            aria-hidden="true"
          >
            <span key={`${previewRange.id}-${activationEpoch}-${playToken}`} />
          </span>
        )}
        <span className="clip-tile-scrim" />
        <span className="clip-source-badge">{clip.isUnified ? "Merged" : clip.sourceName}</span>
        <span className="clip-tile-meta">
          <strong>{clip.label}</strong>
          <small>{clip.range}</small>
        </span>
        {mergeMode && mergePosition != null && (
          <span key={mergePosition} className="clip-merge-badge" aria-hidden="true">
            {mergePosition}
          </span>
        )}
      </button>
      <button
        type="button"
        className={`clip-corner-select spring-motion ${selected ? "is-selected" : ""} ${mergeMode && mergePosition != null ? "is-merge" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect();
        }}
        aria-label={
          mergeMode
            ? mergePosition != null
              ? `Remove from merge (position ${mergePosition})`
              : "Add to merge"
            : selected
              ? "Deselect clip"
              : "Select clip"
        }
      >
        {mergeMode ? (
          mergePosition != null ? (
            <span className="clip-corner-num">{mergePosition}</span>
          ) : (
            <Circle size={20} strokeWidth={2.5} />
          )
        ) : selected ? (
          <CheckCircle2 size={20} strokeWidth={2.5} />
        ) : (
          <Circle size={20} strokeWidth={2.5} />
        )}
      </button>
    </div>
  );
}
