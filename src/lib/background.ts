import { DEFAULT_BG_STATE } from "./constants";
import type { AppConfig, BackgroundState } from "../types/app";

export function clampBgValue(value: unknown, min: number, max: number, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

// Sample a wallpaper image's average luminance and map it to a recommended
// dim percentage (0..55). Bright wallpapers get a higher recommendation
// so labels/headings stay readable; dark wallpapers get 0 so we don't
// double-darken an already-dark scene. Returns null if the image can't
// be read (CORS taint, decode error, missing 2d context) — caller should
// leave the existing dim value alone in that case.
export async function computeRecommendedDimFromImage(imageUrl: string): Promise<number | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, 32, 32);
        const { data } = ctx.getImageData(0, 0, 32, 32);
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) {
          sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        }
        const lum = sum / (32 * 32 * 255);
        const dim = Math.min(70, Math.max(0, (lum - 0.30) * 190));
        resolve(Math.round(dim));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}

export function readBackgroundState(config: Partial<AppConfig> | null | undefined): BackgroundState {
  return {
    imagePath: typeof config?.background_image === "string" ? config.background_image : "",
    scale: clampBgValue(config?.background_scale, 1, 5, DEFAULT_BG_STATE.scale),
    offsetX: clampBgValue(config?.background_offset_x, 0, 100, DEFAULT_BG_STATE.offsetX),
    offsetY: clampBgValue(config?.background_offset_y, 0, 100, DEFAULT_BG_STATE.offsetY),
    dim: clampBgValue(config?.background_dim, 0, 100, DEFAULT_BG_STATE.dim),
    blur: clampBgValue(config?.background_blur, 0, 40, DEFAULT_BG_STATE.blur),
    videoPath: typeof config?.background_video === "string" ? config.background_video : "",
    videoSource: typeof config?.background_video_source === "string" ? config.background_video_source : "",
    videoFps: clampBgValue(config?.background_video_fps, 15, 60, DEFAULT_BG_STATE.videoFps),
  };
}
