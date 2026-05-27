import React from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Cpu, Film, Sparkles, Upload, Video, Eye, RefreshCw, Sliders, Columns, AlertTriangle, CheckCircle2, Image } from "lucide-react";
import { setDiscordJob } from "../../lib/discord";
import { logFrontend, safeLogValue } from "../../lib/log";
import { fileName, normalizeSelectedPaths } from "../../lib/paths";
import { extensionAccept, useFileDrop } from "../../lib/useFileDrop";
import { parseBridgePayload, readBridgeError } from "../../utils/bridge";
import type { BgRemoveProgress, BgRemoveStatus } from "../../types/bgremove";
import { BgRemoveProgressCard } from "./BgRemoveProgressCard";
import { BgRemoveResultCard } from "./BgRemoveResultCard";
import { ConversionSourceCard } from "../video/ConversionSourceCard";
import { Dropdown } from "../../components/Dropdown";

const VIDEO_INPUT_EXTENSIONS = ["mp4", "mkv", "avi", "webm", "mov"];
const IMAGE_INPUT_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "bmp"];
const BGREMOVE_INPUT_EXTENSIONS = [...VIDEO_INPUT_EXTENSIONS, ...IMAGE_INPUT_EXTENSIONS];
const MODEL_LABELS: Record<string, string> = {
  u2netp: "Lightweight Fast (u2netp)",
  silueta: "Fast Silhouette (silueta)",
  anime: "Anime Character (isnet-anime)",
  general: "General Use (isnet-general-use)",
  u2net: "U²-Net Standard (u2net)",
  "birefnet-lite": "BiRefNet Lite (birefnet-general-lite)",
  birefnet: "BiRefNet Standard (birefnet-general)",
  "birefnet-massive": "BiRefNet Massive (birefnet-massive)",
};

export function BgRemovePanel({ activeTab = "video" }: { activeTab?: "video" | "image" }) {
  const isImageTab = activeTab === "image";
  const acceptedExtensions = isImageTab ? IMAGE_INPUT_EXTENSIONS : VIDEO_INPUT_EXTENSIONS;

  const [status, setStatus] = React.useState<BgRemoveStatus | null>(null);
  const [selectedFile, setSelectedFile] = React.useState<string>("");
  const [imageModel, setImageModel] = React.useState<string>("anime");
  const [videoModel, setVideoModel] = React.useState<string>("anime");
  const model = isImageTab ? imageModel : videoModel;
  const setModel = isImageTab ? setImageModel : setVideoModel;
  const [format, setFormat] = React.useState<string>("webm");
  const [forceCpu, setForceCpu] = React.useState<boolean>(false);
  const [progress, setProgress] = React.useState<BgRemoveProgress | null>(null);
  const [processing, setProcessing] = React.useState(false);
  const [resultMessage, setResultMessage] = React.useState<string | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [outputPath, setOutputPath] = React.useState<string>("");
  
  const [isPreviewing, setIsPreviewing] = React.useState<boolean>(false);
  const [previewData, setPreviewData] = React.useState<{
    original: string;
    isolated: string;
    frame: number;
    elapsedSeconds: number;
  } | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  // Raw filesystem path to the cached isolated PNG from the last preview.
  // Used by the fast-path download to skip re-running the AI pipeline.
  const [cachedIsolatedPath, setCachedIsolatedPath] = React.useState<string>("");
  // Track which settings produced the current cached preview so we can
  // detect when the cache is stale.
  const previewModelRef = React.useRef<string>("");
  const previewCpuRef = React.useRef<boolean>(false);
  
  const cancellingRef = React.useRef(false);

  React.useEffect(() => {
    reset();
  }, [activeTab]);

  React.useEffect(() => {
    if (isImageTab) {
      setFormat("png");
    } else {
      setFormat("webm");
    }
  }, [isImageTab]);

  React.useEffect(() => {
    if (isImageTab && selectedFile) {
      void generatePreview();
    }
  }, [selectedFile, model, forceCpu, isImageTab]);

  React.useEffect(() => {
    void refreshStatus();
  }, []);

  React.useEffect(() => {
    setDiscordJob("Isolating background", processing);
    return () => setDiscordJob("Isolating background", false);
  }, [processing]);

  React.useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<BgRemoveProgress>("bgremove-progress", (event) => {
      setProgress(event.payload);
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  async function refreshStatus() {
    try {
      const raw = await invoke<string>("bgremove_status");
      const nextStatus = parseBridgePayload<BgRemoveStatus>(raw);
      setStatus(nextStatus);
      // Auto-set force CPU if GPU is not available
      if (nextStatus && nextStatus.hardware && !nextStatus.hardware.hasCuda) {
        setForceCpu(true);
      }
    } catch (error) {
      setErrorMessage(readBridgeError(error));
    }
  }

  async function pickInputFile() {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [
        {
          name: isImageTab ? "Image File" : "Video File",
          extensions: acceptedExtensions,
        },
      ],
    });
    
    const paths = normalizeSelectedPaths(selected);
    if (paths && paths.length > 0) {
      setSelectedFile(paths[0]);
      setResultMessage(null);
      setErrorMessage(null);
      setPreviewData(null);
      setPreviewError(null);
    }
  }

  async function runBackgroundRemoval() {
    if (!selectedFile) return;
    
    setProcessing(true);
    setResultMessage(null);
    setErrorMessage(null);
    cancellingRef.current = false;

    // Prompt user for saving location
    const extension = format === "webm" ? "webm" : "";
    const isPngSequence = format === "png";
    
    let destinationPath = "";
    try {
      if (isImage) {
        const proposedName = fileName(selectedFile).replace(/\.[^/.]+$/, "") + "_transparent.png";
        const selectedSave = await save({
          defaultPath: proposedName,
          filters: [
            {
              name: "Transparent PNG",
              extensions: ["png"],
            },
          ],
        });
        if (!selectedSave) {
          setProcessing(false);
          setProgress(null);
          return;
        }
        destinationPath = selectedSave;
      } else if (isPngSequence) {
        // For PNG sequence, let them pick/create a folder
        const selectedDir = await open({
          multiple: false,
          directory: true,
        });
        if (!selectedDir) {
          setProcessing(false);
          setProgress(null);
          return;
        }
        destinationPath = Array.isArray(selectedDir) ? selectedDir[0] : selectedDir;
      } else {
        // For WebM, prompt where to save the file
        const proposedName = fileName(selectedFile).replace(/\.[^/.]+$/, "") + "_transparent.webm";
        const selectedSave = await save({
          defaultPath: proposedName,
          filters: [
            {
              name: "Transparent WebM",
              extensions: ["webm"],
            },
          ],
        });
        if (!selectedSave) {
          setProcessing(false);
          setProgress(null);
          return;
        }
        destinationPath = selectedSave;
      }

      setOutputPath(destinationPath);

      // Fast path: if we're saving an image and have a valid cached preview
      // generated with the same model/hardware settings, just copy the file
      // instead of re-running the entire AI pipeline.
      const canUseCachedPreview =
        isImage &&
        cachedIsolatedPath &&
        previewModelRef.current === model &&
        previewCpuRef.current === forceCpu;

      let raw: string;
      if (canUseCachedPreview) {
        raw = await invoke<string>("bgremove_save_preview", {
          sourcePath: cachedIsolatedPath,
          destinationPath: destinationPath,
        });
      } else {
        // Full pipeline: spawn Python process for video or stale-cache images
        setProgress({
          type: "progress",
          stage: "dependencies",
          percent: -1,
          message: "Verifying background removal tools...",
        });
        raw = await invoke<string>("bgremove_process", {
          inputPath: selectedFile,
          outputPath: destinationPath,
          model: model,
          format: format,
          cpu: forceCpu,
        });
      }

      const payload = parseBridgePayload<{
        type: string;
        output: string;
        frames: number;
        elapsedSeconds: number;
      }>(raw);

      if (cancellingRef.current) {
        setResultMessage("Background removal cancelled.");
      } else {
        const countText = isImage ? "image" : `${payload.frames} frames`;
        setResultMessage(
          `Background removal complete. Processed ${countText} in ${payload.elapsedSeconds}s.`
        );
      }
    } catch (error) {
      if (!cancellingRef.current) {
        setErrorMessage(readBridgeError(error));
      }
    } finally {
      setProcessing(false);
      setProgress(null);
      cancellingRef.current = false;
    }
  }

  async function cancelProcessing() {
    cancellingRef.current = true;
    setProgress({
      type: "progress",
      stage: "cancelling",
      percent: -1,
      message: "Stopping background removal process...",
    });
    try {
      await invoke("cancel_bgremove");
    } catch (error) {
      logFrontend("error", "bgremove.cancel.error", "Could not cancel background removal", {
        error: safeLogValue(error),
      });
    }
  }

  async function generatePreview() {
    if (!selectedFile) return;
    
    setIsPreviewing(true);
    setPreviewError(null);
    setPreviewData(null);
    
    try {
      const raw = await invoke<string>("bgremove_preview", {
        inputPath: selectedFile,
        model: model,
        cpu: forceCpu,
      });
      
      const payload = parseBridgePayload<{
        type: string;
        original: string;
        isolated: string;
        frame: number;
        elapsedSeconds: number;
      }>(raw);
      
      if (payload.type === "preview_done") {
        setPreviewData({
          original: convertFileSrc(payload.original),
          isolated: convertFileSrc(payload.isolated),
          frame: payload.frame,
          elapsedSeconds: payload.elapsedSeconds,
        });
        // Cache the raw filesystem path + settings for fast-path download
        setCachedIsolatedPath(payload.isolated);
        previewModelRef.current = model;
        previewCpuRef.current = forceCpu;
      } else {
        throw new Error("Unexpected response from preview command");
      }
    } catch (error) {
      setPreviewError(readBridgeError(error));
    } finally {
      setIsPreviewing(false);
      setProgress(null);
    }
  }

  function reset() {
    setSelectedFile("");
    setProgress(null);
    setResultMessage(null);
    setErrorMessage(null);
    setOutputPath("");
    setPreviewData(null);
    setPreviewError(null);
    setIsPreviewing(false);
    setCachedIsolatedPath("");
  }

  const dropEnabled = !processing && !isPreviewing;
  const dropZone = useFileDrop({
    accept: isImageTab ? extensionAccept(IMAGE_INPUT_EXTENSIONS) : extensionAccept(VIDEO_INPUT_EXTENSIONS),
    enabled: dropEnabled,
    onDrop: (files) => {
      if (files.length > 0) {
        setSelectedFile(files[0]);
        setResultMessage(null);
        setErrorMessage(null);
        setPreviewData(null);
        setPreviewError(null);
      }
    },
  });

  const selectedName = selectedFile ? fileName(selectedFile) : "";
  const isImage = IMAGE_INPUT_EXTENSIONS.includes(selectedFile.split(".").pop()?.toLowerCase() || "");
  const isWebM = format === "webm";
  const outputDir = outputPath ? (isWebM || isImage ? outputPath.substring(0, outputPath.lastIndexOf("\\")) : outputPath) : "";

  // Progress UI rendering
  if (processing || progress) {
    return (
      <div className="panel-flex-center">
        <BgRemoveProgressCard
          fileName={selectedName}
          progress={progress}
          onCancel={cancelProcessing}
          isImage={isImageTab}
        />
      </div>
    );
  }

  // Result UI rendering
  if (resultMessage || errorMessage) {
    return (
      <div className="panel-flex-center">
        <BgRemoveResultCard
          kind={errorMessage ? "error" : "success"}
          fileName={selectedName}
          message={errorMessage || resultMessage || ""}
          onAgain={reset}
          onRetry={runBackgroundRemoval}
          outputDir={outputDir}
        />
      </div>
    );
  }

  return (
    <section
      ref={dropZone.ref}
      className={`conversion-panel drop-zone${dropZone.hover ? " is-drop-target" : ""}`}
    >
      <div className="drop-zone-overlay">
        <Upload size={32} strokeWidth={1.8} />
        <span>Drop {isImageTab ? "image" : "video"} to remove background</span>
        <small>{isImageTab ? "PNG · JPG · JPEG · WEBP · BMP" : "MP4 · MKV · AVI · WEBM · MOV"}</small>
      </div>

      <div className="conversion-hero">
        <div>
          <span className="conversion-kicker">Character Isolation</span>
          <h2>{isImageTab ? "Image" : "Video"} Background Removal</h2>
          <p>
            {isImageTab
              ? "Isolate foreground characters and subjects from static images, exporting as a transparent PNG."
              : "Isolate foreground characters and subjects from video files, exporting as a transparent WebM or PNG sequence."}
          </p>
        </div>
      </div>

      <div className="conversion-grid">
        {/* Left Side: Source details / preview */}
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <ConversionSourceCard
            icon={isImageTab ? <Image size={22} /> : <Video size={22} />}
            label={isImageTab ? "Input Image" : "Input Video"}
            selectedFiles={selectedFile ? [selectedFile] : []}
            pickLabel={selectedFile ? "Change file" : "Select file"}
            onPick={pickInputFile}
            disabled={processing || isPreviewing}
          />

          {/* Preview loading spinner, error banner, or comparison card */}
          {isPreviewing && (
            <div
              className="glass"
              style={{
                padding: "40px 20px",
                borderRadius: "12px",
                border: "1px solid rgba(255,255,255,0.06)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "16px",
              }}
            >
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  border: "3px solid rgba(255,255,255,0.1)",
                  borderTopColor: "var(--accent-a)",
                  borderRadius: "50%",
                  animation: "spin 1s linear infinite",
                }}
              />
              <div style={{ textAlign: "center" }}>
                <h4 style={{ margin: "0 0 4px 0", fontSize: "14px" }}>
                  {isImageTab ? "Isolating Background..." : "Isolating AI Preview Frame..."}
                </h4>
                <p className="dim-text" style={{ fontSize: "12px", margin: 0 }}>
                  {isImageTab
                    ? `Running ${MODEL_LABELS[model] || model} AI model on the image.`
                    : "Extracting representative frame and running segmentation model."}
                </p>
              </div>
            </div>
          )}

          {previewError && (
            <div
              className="glass"
              style={{
                padding: "16px",
                borderRadius: "12px",
                border: "1px solid rgba(239, 68, 68, 0.2)",
                background: "rgba(239, 68, 68, 0.05)",
                color: "#f87171",
                fontSize: "13px",
              }}
            >
              <h4 style={{ margin: "0 0 4px 0", fontWeight: 600 }}>
                Failed to {isImageTab ? "isolate image" : "generate frame preview"}
              </h4>
              <p style={{ margin: 0 }} className="dim-text">
                {previewError}
              </p>
            </div>
          )}

          {!isPreviewing && previewData && (
            <PreviewComparisonCard
              original={previewData.original}
              isolated={previewData.isolated}
              frame={previewData.frame}
              elapsedSeconds={previewData.elapsedSeconds}
              model={model}
              isPreviewing={isPreviewing}
              onRegenerate={generatePreview}
              isImage={isImageTab}
            />
          )}

          {/* Tips Card */}
          <div
            className="glass"
            style={{
              padding: "20px",
              borderRadius: "12px",
              border: "1px solid rgba(255,255,255,0.06)",
              background: "linear-gradient(135deg, rgba(255,255,255,0.02) 0%, rgba(255,255,255,0.01) 100%)",
            }}
          >
            <h4 style={{ margin: "0 0 10px 0", fontSize: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
              <Sparkles size={16} style={{ color: "var(--accent-a)" }} />
              Workflow Tips
            </h4>
            <ul style={{ paddingLeft: "18px", margin: 0, fontSize: "13px", lineHeight: "1.7" }} className="dim-text">
              {isImageTab ? (
                <>
                  <li>
                    <strong>Instant Cutout Preview:</strong> Selecting an image automatically generates a transparency preview with side-by-side and interactive slider comparison modes.
                  </li>
                  <li>
                    <strong>Fast Saving:</strong> Once a preview is generated, saving copies the cached preview file without repeating the AI segmentation process.
                  </li>
                  <li>
                    <strong>Model Options:</strong> Choose lightweight models for fast processing, or detailed models for precise edge boundaries.
                  </li>
                </>
              ) : (
                <>
                  <li>
                    <strong>WebM VP9 + Alpha:</strong> Transparent video format compatible with most video editing software (Premiere, After Effects, DaVinci Resolve).
                  </li>
                  <li>
                    <strong>Anime Characters:</strong> The Anime Character (isnet-anime) model is optimized specifically for cel-shaded boundary outlines.
                  </li>
                  <li>
                    <strong>Hardware Acceleration:</strong> CUDA (GPU) acceleration is recommended to minimize frame processing times.
                  </li>
                </>
              )}
            </ul>
          </div>
        </div>

        {/* Right Side: Options / Action */}
        <div className="conversion-card run-card">
          <div className="conversion-format-card wide">
            {status && (
              <div className={`conversion-compat ${status.hardware && status.hardware.hasCuda ? "is-ready" : "is-locked"}`}>
                {status.hardware && status.hardware.hasCuda ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                <span>
                  {status.hardware && status.hardware.hasCuda
                    ? "NVIDIA CUDA GPU acceleration enabled"
                    : "NVIDIA CUDA GPU not detected. Running in slow CPU mode."}
                </span>
              </div>
            )}

            {/* Model Select */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label htmlFor="model-select" style={{ fontSize: "11px", fontWeight: 700, color: "rgba(147, 161, 173, 0.82)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                AI Segmentation Model
              </label>
              <Dropdown<string>
                options={[
                  {
                    value: "u2netp",
                    label: "Lightweight Fast (u2netp)",
                    description: "Ultra-lightweight model. Fast processing, lower boundary accuracy.",
                  },
                  {
                    value: "silueta",
                    label: "Fast Silhouette (silueta)",
                    description: "Optimized for fast silhouette extraction.",
                  },
                  {
                    value: "anime",
                    label: "Anime Character (isnet-anime)",
                    description: "Recommended for anime and cel-shaded illustrations.",
                  },
                  {
                    value: "general",
                    label: "General Use (isnet-general-use)",
                    description: "General-purpose subject and mixed-content isolation.",
                  },
                  {
                    value: "u2net",
                    label: "U²-Net Standard (u2net)",
                    description: "Classic general-purpose model with balanced speed and quality.",
                  },
                  {
                    value: "birefnet-lite",
                    label: "BiRefNet Lite (birefnet-general-lite)",
                    description: "Lighter BiRefNet model with good edge boundaries.",
                  },
                  {
                    value: "birefnet",
                    label: "BiRefNet Standard (birefnet-general)",
                    description: "High-precision edge detail. Slower processing.",
                  },
                  {
                    value: "birefnet-massive",
                    label: "BiRefNet Massive (birefnet-massive)",
                    description: "Maximum precision. Slowest processing, best for fine details.",
                  },
                ]}
                value={model}
                onChange={setModel}
              />
            </div>

            {/* Export Format Select */}
            {!isImageTab && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label htmlFor="format-select" style={{ fontSize: "11px", fontWeight: 700, color: "rgba(147, 161, 173, 0.82)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Export Format
                </label>
                <Dropdown<string>
                  options={[
                    {
                      value: "webm",
                      label: "Transparent Video (WebM VP9 + Alpha)",
                      description: "Exports transparent video overlay (VP9 codec with alpha channel).",
                    },
                    {
                      value: "png",
                      label: "Lossless Image Sequence (PNG Sequence)",
                      description: "Exports directory of transparent PNG frames.",
                    },
                  ]}
                  value={format}
                  onChange={setFormat}
                />
              </div>
            )}

            {/* Hardware Selection */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "12px" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "rgba(147, 161, 173, 0.82)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Hardware Accelerator
              </span>
              <div className="conversion-segment">
                <button
                  type="button"
                  className={!forceCpu ? "is-active" : ""}
                  disabled={!!(status && status.hardware && !status.hardware.hasCuda)}
                  onClick={() => setForceCpu(false)}
                >
                  GPU (CUDA)
                </button>
                <button
                  type="button"
                  className={forceCpu ? "is-active" : ""}
                  onClick={() => setForceCpu(true)}
                >
                  CPU Mode
                </button>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="conversion-run-actions" style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "24px", paddingTop: "20px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
            <button
              type="button"
              className="conversion-pick-btn"
              style={{
                width: "100%",
                minHeight: "38px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
              }}
              disabled={!selectedFile || isPreviewing}
              onClick={generatePreview}
            >
              <Eye size={16} />
              <span>{isPreviewing ? "Generating Preview..." : isImageTab ? "Generate Isolated Preview" : "Generate AI Preview"}</span>
            </button>

            <button
              type="button"
              className="conversion-run-btn"
              style={{
                width: "100%",
                minHeight: "38px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
              }}
              disabled={!selectedFile || isPreviewing}
              onClick={runBackgroundRemoval}
            >
              <Sparkles size={16} />
              <span>{isImageTab ? "Download Isolated Image" : "Remove Background"}</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

interface ImageComparisonSliderProps {
  original: string;
  isolated: string;
}

function ImageComparisonSlider({ original, isolated }: ImageComparisonSliderProps) {
  const [sliderPosition, setSliderPosition] = React.useState(50); // percentage (0 to 100)
  const containerRef = React.useRef<HTMLDivElement>(null);

  const handleMove = (clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(percentage);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    handleMove(e.clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length > 0) {
      handleMove(e.touches[0].clientX);
    }
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onTouchMove={handleTouchMove}
      style={{
        position: "relative",
        width: "100%",
        height: "360px",
        borderRadius: "8px",
        overflow: "hidden",
        cursor: "ew-resize",
        userSelect: "none",
        background: "#0c0d0e",
        border: "1px solid rgba(255, 255, 255, 0.08)",
      }}
    >
      {/* Original Image (Background) */}
      <img
        src={original}
        alt="Original frame"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          objectFit: "contain",
          pointerEvents: "none",
        }}
      />

      {/* Checkered Transparent Grid Pattern background for the overlay */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          clipPath: `polygon(${sliderPosition}% 0, 100% 0, 100% 100%, ${sliderPosition}% 100%)`,
          pointerEvents: "none",
          backgroundImage: `
            linear-gradient(45deg, rgba(255,255,255,0.03) 25%, transparent 25%),
            linear-gradient(-45deg, rgba(255,255,255,0.03) 25%, transparent 25%),
            linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.03) 75%),
            linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.03) 75%)
          `,
          backgroundSize: "20px 20px",
          backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px",
          backgroundColor: "#131518",
        }}
      />

      {/* Isolated Image (Foreground with Clip-Path) */}
      <img
        src={isolated}
        alt="Isolated frame"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          objectFit: "contain",
          pointerEvents: "none",
          clipPath: `polygon(${sliderPosition}% 0, 100% 0, 100% 100%, ${sliderPosition}% 100%)`,
        }}
      />

      {/* Horizontal Divider Line */}
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${sliderPosition}%`,
          width: "2px",
          backgroundColor: "var(--accent-a, #3b82f6)",
          boxShadow: "0 0 10px rgba(59, 130, 246, 0.8)",
          zIndex: 10,
          pointerEvents: "none",
        }}
      >
        {/* Drag handle ball */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "30px",
            height: "30px",
            borderRadius: "50%",
            backgroundColor: "#1f2227",
            border: "2px solid var(--accent-a, #3b82f6)",
            boxShadow: "0 4px 10px rgba(0, 0, 0, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: "12px",
            fontWeight: "bold",
          }}
        >
          ↔
        </div>
      </div>

      {/* Labels */}
      <div
        style={{
          position: "absolute",
          top: "12px",
          left: "12px",
          background: "rgba(0,0,0,0.6)",
          padding: "4px 8px",
          borderRadius: "4px",
          fontSize: "11px",
          color: "#fff",
          zIndex: 5,
          pointerEvents: "none",
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        Original
      </div>
      <div
        style={{
          position: "absolute",
          top: "12px",
          right: "12px",
          background: "rgba(0,0,0,0.6)",
          padding: "4px 8px",
          borderRadius: "4px",
          fontSize: "11px",
          color: "#fff",
          zIndex: 5,
          pointerEvents: "none",
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        Isolated
      </div>
    </div>
  );
}

interface PreviewComparisonCardProps {
  original: string;
  isolated: string;
  frame: number;
  elapsedSeconds: number;
  model: string;
  isPreviewing: boolean;
  onRegenerate: () => void;
  isImage?: boolean;
}

function PreviewComparisonCard({
  original,
  isolated,
  frame,
  elapsedSeconds,
  model,
  isPreviewing,
  onRegenerate,
  isImage,
}: PreviewComparisonCardProps) {
  const [layoutMode, setLayoutMode] = React.useState<"slider" | "side-by-side">("slider");

  const modelLabels: Record<string, string> = MODEL_LABELS;

  return (
    <div
      className="glass"
      style={{
        padding: "20px",
        borderRadius: "12px",
        border: "1px solid rgba(255,255,255,0.06)",
        background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h4 style={{ margin: "0 0 4px 0", fontSize: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
            <Eye size={16} style={{ color: "var(--accent-a)" }} />
            AI Isolation Preview
          </h4>
          <p className="dim-text" style={{ fontSize: "12px", margin: 0 }}>
            {isImage ? "Image" : `Frame ${frame}`} isolated with <strong>{modelLabels[model] || model}</strong> in {elapsedSeconds}s
          </p>
        </div>

        {/* View Mode Toggle & Regenerate */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              display: "flex",
              background: "rgba(0,0,0,0.2)",
              padding: "2px",
              borderRadius: "6px",
              border: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <button
              type="button"
              onClick={() => setLayoutMode("slider")}
              style={{
                background: layoutMode === "slider" ? "rgba(255,255,255,0.08)" : "transparent",
                border: "none",
                borderRadius: "4px",
                padding: "6px 10px",
                color: layoutMode === "slider" ? "#fff" : "rgba(255,255,255,0.4)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                fontSize: "11px",
              }}
              title="Interactive Before/After Slider"
            >
              <Sliders size={12} />
              <span>Slider</span>
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode("side-by-side")}
              style={{
                background: layoutMode === "side-by-side" ? "rgba(255,255,255,0.08)" : "transparent",
                border: "none",
                borderRadius: "4px",
                padding: "6px 10px",
                color: layoutMode === "side-by-side" ? "#fff" : "rgba(255,255,255,0.4)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                fontSize: "11px",
              }}
              title="Side-by-Side Comparison"
            >
              <Columns size={12} />
              <span>Side-by-Side</span>
            </button>
          </div>

          <button
            type="button"
            className="install-btn is-secondary"
            style={{ padding: "6px 10px", display: "flex", alignItems: "center", gap: "6px", fontSize: "11px" }}
            disabled={isPreviewing}
            onClick={onRegenerate}
          >
            <RefreshCw size={12} className={isPreviewing ? "spin" : ""} />
            <span>Regen</span>
          </button>
        </div>
      </div>

      {layoutMode === "slider" ? (
        <ImageComparisonSlider original={original} isolated={isolated} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          {/* Original */}
          <div
            style={{
              background: "#0c0d0e",
              borderRadius: "8px",
              overflow: "hidden",
              height: "260px",
              position: "relative",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <img src={original} alt="Original" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            <div
              style={{
                position: "absolute",
                bottom: "8px",
                left: "8px",
                background: "rgba(0,0,0,0.6)",
                padding: "2px 6px",
                borderRadius: "4px",
                fontSize: "10px",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              Original Frame
            </div>
          </div>
          {/* Isolated */}
          <div
            style={{
              background: "#131518",
              borderRadius: "8px",
              overflow: "hidden",
              height: "260px",
              position: "relative",
              border: "1px solid rgba(255,255,255,0.06)",
              backgroundImage: `
                linear-gradient(45deg, rgba(255,255,255,0.03) 25%, transparent 25%),
                linear-gradient(-45deg, rgba(255,255,255,0.03) 25%, transparent 25%),
                linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.03) 75%),
                linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.03) 75%)
              `,
              backgroundSize: "16px 16px",
              backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
            }}
          >
            <img src={isolated} alt="Isolated" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            <div
              style={{
                position: "absolute",
                bottom: "8px",
                left: "8px",
                background: "rgba(0,0,0,0.6)",
                padding: "2px 6px",
                borderRadius: "4px",
                fontSize: "10px",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            >
              Isolated Character
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
