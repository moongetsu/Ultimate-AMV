# Changelog

All notable changes to Ultimate AMV are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] — 2026-05-10

### Added
- **Setup wizard now picks a download folder.** A new "Folder" step sits
  between Engine and Install (Hardware → Engine → **Folder** → Install →
  Done). The choice is persisted via `set_config(download_path)` so future
  downloads land where you told them to instead of the default
  `Videos\Ultimate AMV\anime downloads`. You can change it later from
  Settings.
- **Animated logo banner** at the top of the README (10 fps, palette-
  optimized GIF).

### Removed
- **"Use player" buttons in the YouTube trim editor.** The timecode inputs
  plus seek buttons already cover the same flow, so the extra buttons were
  just noise.

## [0.2.0] — 2026-05-09

### Added
- **Custom background image** with a built-in cropper — drag to position,
  scroll to zoom, dim and blur sliders. The image bleeds through every
  workspace area without hurting text legibility.
- **Custom theme colors.** Two-color accent gradient with five presets
  (cyan, mint, violet, rose, amber) plus full hex pickers for both stops.
- **YouTube trim editor.** Pick a start/end range before downloading
  instead of grabbing the full video; format inspection and source preview
  included.
- **Discord community button** in the README.

### Fixed
- **Engine setup integrity.** `setup_type` is now only persisted after
  `audio_setup` actually succeeds, so a crash mid-install no longer leaves
  config claiming GPU while CPU PyTorch is on disk.
- **Engine status reflects reality.** Settings derives the Active mode and
  READY badge from the installed PyTorch build (`+cu` / `+cpu`) rather
  than config alone, surfacing any mismatch with a one-click Switch to
  reconcile.

## [0.1.0] — 2026-05-09

### Added
- Initial release.
- Built-in browser with automatic episode and series detection on anime
  streaming sites.
- Audio separation (vocals / instrumentals) using ML models, with CPU and
  NVIDIA GPU (CUDA) support.
- Frame-accurate clip extraction and export via ffmpeg, with GPU-
  accelerated decoding where available.
- Download manager backed by a bundled yt-dlp.
- Self-contained first-run setup wizard that installs PyTorch, audio-
  separator, and ONNX Runtime into a bundled Python environment.

[0.3.0]: https://github.com/ElishaPervez/Ultimate-AMV/releases/tag/v0.3.0
[0.2.0]: https://github.com/ElishaPervez/Ultimate-AMV/releases/tag/v0.2.0
[0.1.0]: https://github.com/ElishaPervez/Ultimate-AMV/releases/tag/v0.1.0
