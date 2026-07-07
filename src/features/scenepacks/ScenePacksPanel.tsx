import React from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Plus,
  Trash2,
  ArrowRight,
  FolderOpen,
  ChevronLeft,
  Clock,
  Film,
  Hash,
} from "lucide-react";
import type { ScenePack, ScenePackMeta } from "../../types/clip";
import type { ClipExportFormat } from "../../types/clip";
import { logFrontend, safeLogValue } from "../../lib/log";

type FormatOption = {
  value: ClipExportFormat;
  label: string;
};

const EXPORT_FORMATS: FormatOption[] = [
  { value: "prores-lt", label: "ProRes LT MOV" },
  { value: "prores-hq", label: "ProRes HQ MOV" },
  { value: "h264-cpu", label: "H.264 CPU MP4" },
  { value: "hevc-cpu", label: "HEVC CPU MP4" },
  { value: "gpu-intra", label: "GPU Intra MOV" },
  { value: "h264-nvenc", label: "H.264 NVENC MP4" },
  { value: "av1-nvenc", label: "AV1 NVENC MP4" },
  { value: "lossless-cut", label: "Lossless Cut MKV" },
];

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toFixed(1).padStart(4, "0")}`;
}

function generateId(): string {
  return `sp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

export function ScenePacksPanel() {
  const [packs, setPacks] = React.useState<ScenePackMeta[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedPack, setSelectedPack] = React.useState<ScenePack | null>(null);
  const [showCreate, setShowCreate] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newAnime, setNewAnime] = React.useState("");
  const [newChar, setNewChar] = React.useState("");
  const [exporting, setExporting] = React.useState(false);
  const [selectedClipIds, setSelectedClipIds] = React.useState<Set<string>>(new Set());
  const [exportFormat, setExportFormat] = React.useState<ClipExportFormat>("prores-lt");

  const loadPacks = React.useCallback(async () => {
    setLoading(true);
    try {
      const list = await invoke<ScenePackMeta[]>("scene_packs_list");
      setPacks(list);
    } catch (error) {
      logFrontend("error", "scenepacks.list.error", "Failed to load scene packs", {
        error: safeLogValue(error),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadPacks();
  }, [loadPacks]);

  const updatePackInList = (pack: ScenePack) => {
    setPacks((prev) =>
      prev.map((p) =>
        p.id === pack.id
          ? { ...p, clipCount: pack.clips.length, updatedAt: pack.updatedAt }
          : p,
      ),
    );
  };

  React.useEffect(() => {
    window.addEventListener("scenepack-saved", ((e: CustomEvent<ScenePack>) => {
      void loadPacks();
    }) as EventListener);
    return () => {
      window.removeEventListener("scenepack-saved", (() => {}) as EventListener);
    };
  }, [loadPacks]);

  const handleDeletePack = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke("scene_packs_delete", { id });
      setSelectedPack(null);
      void loadPacks();
    } catch (error) {
      logFrontend("error", "scenepacks.delete.error", "Failed to delete scene pack", {
        error: safeLogValue(error),
      });
    }
  };

  const handleCreatePack = async () => {
    if (!newName.trim()) return;
    try {
      const pack: ScenePack = {
        id: generateId(),
        name: newName.trim(),
        animeTitle: newAnime.trim(),
        character: newChar.trim(),
        sourceName: "",
        sourceSrc: "",
        createdAt: nowISO(),
        updatedAt: nowISO(),
        clips: [],
      };
      await invoke("scene_packs_save", { pack });
      setShowCreate(false);
      setNewName("");
      setNewAnime("");
      setNewChar("");
      void loadPacks();
    } catch (error) {
      logFrontend("error", "scenepacks.create.error", "Failed to create scene pack", {
        error: safeLogValue(error),
      });
    }
  };

  const handleOpenPack = async (id: string) => {
    try {
      const pack = await invoke<ScenePack>("scene_packs_load", { id });
      setSelectedPack(pack);
      setSelectedClipIds(new Set());
    } catch (error) {
      logFrontend("error", "scenepacks.load.error", "Failed to load scene pack", {
        error: safeLogValue(error),
      });
    }
  };

  const handleExportClips = async () => {
    if (!selectedPack || selectedClipIds.size === 0) return;

    const folder = await open({
      directory: true,
      title: "Select export folder",
    });
    if (!folder) return;

    const clipsToExport = selectedPack.clips.filter((c) => selectedClipIds.has(c.id));

    setExporting(true);
    try {
      await invoke("clip_export", {
        clips: clipsToExport.map((c) => ({
          source: c.sourceSrc,
          start: c.sourceStart,
          end: c.sourceEnd,
          index: c.index,
          fps: c.fps,
        })),
        outputDir: folder,
        preset: exportFormat,
        qualityValue: null,
      });
    } catch (error) {
      logFrontend("error", "scenepacks.export.error", "Failed to export clips", {
        error: safeLogValue(error),
      });
    } finally {
      setExporting(false);
    }
  };

  const toggleClipSelection = (id: string) => {
    setSelectedClipIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllClips = () => {
    if (!selectedPack) return;
    if (selectedClipIds.size === selectedPack.clips.length) {
      setSelectedClipIds(new Set());
    } else {
      setSelectedClipIds(new Set(selectedPack.clips.map((c) => c.id)));
    }
  };

  if (selectedPack) {
    return (
      <div className="scenepacks-detail">
        <div className="scenepacks-detail-header">
          <button
            type="button"
            className="scenepacks-back-btn"
            onClick={() => { setSelectedPack(null); setSelectedClipIds(new Set()); }}
            title="Back to packs"
          >
            <ChevronLeft size={16} />
            <span>Back</span>
          </button>
          <div className="scenepacks-detail-info">
            <h2>{selectedPack.name}</h2>
            {selectedPack.animeTitle && <span className="scenepacks-meta">{selectedPack.animeTitle}</span>}
            {selectedPack.character && <span className="scenepacks-meta">{selectedPack.character}</span>}
          </div>
          <div className="scenepacks-detail-actions">
            <select
              className="scenepacks-format-select"
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as ClipExportFormat)}
            >
              {EXPORT_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
            <button
              type="button"
              className="scenepacks-action-btn is-primary"
              disabled={selectedClipIds.size === 0 || exporting}
              onClick={handleExportClips}
            >
              <ArrowRight size={14} />
              <span>{exporting ? "Exporting..." : `Export (${selectedClipIds.size})`}</span>
            </button>
            <button
              type="button"
              className="scenepacks-action-btn is-danger"
              onClick={(e) => handleDeletePack(selectedPack.id, e)}
            >
              <Trash2 size={14} />
              <span>Delete</span>
            </button>
          </div>
        </div>
        <div className="scenepacks-detail-stats">
          <span><Film size={12} /> {selectedPack.clips.length} clips</span>
          {selectedPack.sourceName && <span><FolderOpen size={12} /> {selectedPack.sourceName}</span>}
          <span><Clock size={12} /> {new Date(selectedPack.createdAt).toLocaleDateString()}</span>
        </div>
        <div className="scenepacks-select-all">
          <button
            type="button"
            className="scenepacks-select-all-btn"
            onClick={selectAllClips}
          >
            {selectedClipIds.size === selectedPack.clips.length && selectedPack.clips.length > 0
              ? "Deselect all"
              : "Select all"}
          </button>
        </div>
        <div className="scenepacks-clip-list">
          {selectedPack.clips.length === 0 ? (
            <div className="scenepacks-empty">
              <p>No clips in this pack. Add them from the Scene Splitter.</p>
            </div>
          ) : (
            selectedPack.clips.map((clip) => (
              <div
                key={clip.id}
                className={`scenepacks-clip-card ${selectedClipIds.has(clip.id) ? "is-selected" : ""}`}
                onClick={() => toggleClipSelection(clip.id)}
              >
                <div className="scenepacks-clip-check">
                  <input
                    type="checkbox"
                    checked={selectedClipIds.has(clip.id)}
                    onChange={() => toggleClipSelection(clip.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <div className="scenepacks-clip-body">
                  <span className="scenepacks-clip-label">{clip.label}</span>
                  <span className="scenepacks-clip-range">
                    {formatTime(clip.sourceStart)} - {formatTime(clip.sourceEnd)}
                  </span>
                </div>
                <div className="scenepacks-clip-meta">
                  <span>{(clip.sourceEnd - clip.sourceStart).toFixed(1)}s</span>
                  <span>{clip.fps} fps</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  if (showCreate) {
    return (
      <div className="scenepacks-create">
        <div className="scenepacks-create-header">
          <button
            type="button"
            className="scenepacks-back-btn"
            onClick={() => setShowCreate(false)}
          >
            <ChevronLeft size={16} />
            <span>Back</span>
          </button>
          <h2>New ScenePack</h2>
        </div>
        <div className="scenepacks-create-form">
          <div className="scenepacks-field">
            <label htmlFor="sp-name">Pack Name</label>
            <input
              id="sp-name"
              type="text"
              placeholder="My ScenePack"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") void handleCreatePack(); }}
            />
          </div>
          <div className="scenepacks-field">
            <label htmlFor="sp-anime">Anime Title</label>
            <input
              id="sp-anime"
              type="text"
              placeholder="Anime name (optional)"
              value={newAnime}
              onChange={(e) => setNewAnime(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleCreatePack(); }}
            />
          </div>
          <div className="scenepacks-field">
            <label htmlFor="sp-char">Character</label>
            <input
              id="sp-char"
              type="text"
              placeholder="Character name (optional)"
              value={newChar}
              onChange={(e) => setNewChar(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleCreatePack(); }}
            />
          </div>
          <div className="scenepacks-create-actions">
            <button
              type="button"
              className="scenepacks-action-btn is-secondary"
              onClick={() => setShowCreate(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="scenepacks-action-btn is-primary"
              onClick={handleCreatePack}
              disabled={!newName.trim()}
            >
              Create
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="scenepacks-panel">
      <div className="scenepacks-panel-header">
        <div>
          <h2>ScenePacks</h2>
          <p className="scenepacks-subtitle">
            Save and organize your best clips into collections
          </p>
        </div>
        <button
          type="button"
          className="scenepacks-action-btn is-primary"
          onClick={() => setShowCreate(true)}
        >
          <Plus size={14} />
          <span>New Pack</span>
        </button>
      </div>

      {loading ? (
        <div className="scenepacks-loading">
          <div className="is-spinning" style={{ width: 24, height: 24, border: "2px solid var(--input-border)", borderTopColor: "var(--accent-primary)", borderRadius: "50%", display: "inline-block" }} />
          <span>Loading packs...</span>
        </div>
      ) : packs.length === 0 ? (
        <div className="scenepacks-empty-state">
          <FolderOpen size={48} strokeWidth={1.5} />
          <h3>No ScenePacks yet</h3>
          <p>
            Create a ScenePack to start saving clips. Then add clips from
            the Scene Splitter.
          </p>
          <button
            type="button"
            className="scenepacks-action-btn is-primary"
            onClick={() => setShowCreate(true)}
          >
            <Plus size={14} />
            <span>Create First Pack</span>
          </button>
        </div>
      ) : (
        <div className="scenepacks-grid">
          {packs.map((pack) => (
            <div
              key={pack.id}
              className="scenepacks-card"
              onClick={() => void handleOpenPack(pack.id)}
            >
              <div className="scenepacks-card-header">
                <h3>{pack.name}</h3>
                <button
                  type="button"
                  className="scenepacks-card-delete"
                  onClick={(e) => handleDeletePack(pack.id, e)}
                  title="Delete pack"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="scenepacks-card-body">
                {pack.animeTitle && <span className="scenepacks-tag">{pack.animeTitle}</span>}
                {pack.character && <span className="scenepacks-tag">{pack.character}</span>}
              </div>
              <div className="scenepacks-card-footer">
                <span><Film size={12} /> {pack.clipCount} clips</span>
                {pack.sourceName && <span><Hash size={12} /> {pack.sourceName}</span>}
                <span><Clock size={12} /> {new Date(pack.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function showScenePackSaveModal(
  clips: Array<{
    id: string;
    index: number;
    label: string;
    sourceName: string;
    sourceSrc: string;
    sourceStart: number;
    sourceEnd: number;
    fps: number;
  }>,
): void {
  window.dispatchEvent(
    new CustomEvent("scenepack-save-modal", { detail: { clips } }),
  );
}

export function ScenePackSaveModal({
  clips,
  sourceName,
  onClose,
}: {
  clips: Array<{
    id: string;
    index: number;
    label: string;
    sourceName: string;
    sourceSrc: string;
    sourceStart: number;
    sourceEnd: number;
    fps: number;
  }>;
  sourceName: string;
  onClose: () => void;
}) {
  const [packs, setPacks] = React.useState<ScenePackMeta[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedPackId, setSelectedPackId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [showNew, setShowNew] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [newAnime, setNewAnime] = React.useState("");
  const [newChar, setNewChar] = React.useState("");

  React.useEffect(() => {
    invoke<ScenePackMeta[]>("scene_packs_list")
      .then((list) => { setPacks(list); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    if (!selectedPackId && !showNew) return;
    setSaving(true);
    try {
      let packId = selectedPackId;
      if (showNew && newName.trim()) {
        const newPack: ScenePack = {
          id: generateId(),
          name: newName.trim(),
          animeTitle: newAnime.trim(),
          character: newChar.trim(),
          sourceName,
          sourceSrc: clips[0]?.sourceSrc ?? "",
          createdAt: nowISO(),
          updatedAt: nowISO(),
          clips: [],
        };
        await invoke("scene_packs_save", { pack: newPack });
        packId = newPack.id;
      }

      if (packId) {
        const existing = await invoke<ScenePack>("scene_packs_load", { id: packId });
        const existingIds = new Set(existing.clips.map((c) => c.id));
        const newClips = clips.filter((c) => !existingIds.has(c.id));
        if (newClips.length > 0) {
          existing.clips.push(...newClips.map((c) => ({
            id: c.id,
            index: c.index,
            label: c.label,
            sourceName: c.sourceName,
            sourceSrc: c.sourceSrc,
            sourceStart: c.sourceStart,
            sourceEnd: c.sourceEnd,
            fps: c.fps,
          })));
          existing.updatedAt = nowISO();
          existing.sourceName = existing.sourceName || sourceName;
          existing.sourceSrc = existing.sourceSrc || (clips[0]?.sourceSrc ?? "");
          await invoke("scene_packs_save", { pack: existing });
        }
      }
      window.dispatchEvent(new CustomEvent("scenepack-saved"));
      onClose();
    } catch (error) {
      logFrontend("error", "scenepacks.saveClips.error", "Failed to save clips to pack", {
        error: safeLogValue(error),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="scenepacks-save-modal-overlay" onClick={onClose}>
      <div className="scenepacks-save-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Save {clips.length} clip{clips.length !== 1 ? "s" : ""} to ScenePack</h3>
        {showNew ? (
          <>
            <div className="scenepacks-field">
              <label htmlFor="sp-modal-name">Pack Name</label>
              <input
                id="sp-modal-name"
                type="text"
                placeholder="My ScenePack"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) void handleSave(); }}
              />
            </div>
            <div className="scenepacks-field">
              <label htmlFor="sp-modal-anime">Anime Title</label>
              <input
                id="sp-modal-anime"
                type="text"
                placeholder="Anime name (optional)"
                value={newAnime}
                onChange={(e) => setNewAnime(e.target.value)}
              />
            </div>
            <div className="scenepacks-field">
              <label htmlFor="sp-modal-char">Character</label>
              <input
                id="sp-modal-char"
                type="text"
                placeholder="Character name (optional)"
                value={newChar}
                onChange={(e) => setNewChar(e.target.value)}
              />
            </div>
          </>
        ) : loading ? (
          <div className="scenepacks-loading">
            <span>Loading packs...</span>
          </div>
        ) : packs.length === 0 ? (
          <div className="scenepacks-empty-state" style={{ padding: "20px 0" }}>
            <p>No ScenePacks yet. Create one first.</p>
            <button
              type="button"
              className="scenepacks-action-btn is-primary"
              onClick={() => setShowNew(true)}
            >
              <Plus size={14} />
              <span>Create New Pack</span>
            </button>
          </div>
        ) : (
          <div className="scenepacks-save-modal-packs">
            {packs.map((p) => (
              <div
                key={p.id}
                className={`scenepacks-save-modal-pack-option ${selectedPackId === p.id ? "is-active" : ""}`}
                onClick={() => setSelectedPackId(p.id)}
              >
                <span>{p.name}</span>
                <small>{p.clipCount} clips</small>
              </div>
            ))}
            <div
              className="scenepacks-save-modal-pack-option"
              onClick={() => { setShowNew(true); setSelectedPackId(null); }}
            >
              <Plus size={12} />
              <span style={{ color: "var(--accent-primary)" }}>Create new pack</span>
            </div>
          </div>
        )}
        <div className="scenepacks-save-modal-actions">
          <button
            type="button"
            className="scenepacks-action-btn is-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          {(showNew || packs.length === 0) ? (
            <button
              type="button"
              className="scenepacks-action-btn is-primary"
              disabled={!newName.trim() || saving}
              onClick={handleSave}
            >
              {saving ? "Saving..." : "Create & Save"}
            </button>
          ) : (
            <button
              type="button"
              className="scenepacks-action-btn is-primary"
              disabled={!selectedPackId || saving}
              onClick={handleSave}
            >
              {saving ? "Saving..." : `Add to Pack`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
