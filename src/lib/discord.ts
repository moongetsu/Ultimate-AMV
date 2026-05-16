import { invoke } from "@tauri-apps/api/core";

const STORAGE_KEY = "discord_presence_enabled";

let currentPanel = "Idle";
const activeJobs: string[] = [];
let lastPushed: string | null = null;
let enabled = readEnabledFromStorage();

function readEnabledFromStorage(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? true : raw !== "false";
  } catch {
    return true;
  }
}

function writeEnabledToStorage(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, value ? "true" : "false");
  } catch {
    // localStorage may be unavailable; toggle still works for this session
  }
}

export function isDiscordEnabled(): boolean {
  return enabled;
}

export function setDiscordEnabled(next: boolean): void {
  if (enabled === next) return;
  enabled = next;
  writeEnabledToStorage(next);
  if (next) {
    lastPushed = null;
    push();
  } else {
    lastPushed = null;
    invoke("discord_clear").catch(() => {
      // best-effort
    });
  }
}

export function setDiscordPanel(panel: string): void {
  currentPanel = panel.trim() || "Idle";
  push();
}

export function setDiscordJob(job: string, active: boolean): void {
  const label = job.trim();
  if (!label) return;
  const idx = activeJobs.indexOf(label);
  if (active) {
    if (idx === -1) activeJobs.push(label);
  } else if (idx !== -1) {
    activeJobs.splice(idx, 1);
  }
  push();
}

function push(): void {
  if (!enabled) return;
  const state =
    activeJobs.length > 0 ? activeJobs[activeJobs.length - 1] : currentPanel;
  if (state === lastPushed) return;
  lastPushed = state;
  invoke("discord_set_state", { state }).catch(() => {
    // best-effort: Discord may not be running
  });
}
