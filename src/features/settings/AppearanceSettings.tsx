import React from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Image as ImageIcon, MessageCircle } from "lucide-react";
import { applyAppTheme } from "../../lib/theme";
import { logFrontend, safeLogValue } from "../../lib/log";
import type { AppConfig } from "../../types/app";

const DISCORD_INVITE_URL = "https://discord.gg/XuJrkeXKh6";

function DiscordGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M20.317 4.369A19.79 19.79 0 0 0 16.558 3.2a.075.075 0 0 0-.079.038c-.34.607-.719 1.4-.984 2.026a18.27 18.27 0 0 0-5.486 0 12.64 12.64 0 0 0-1-2.026.078.078 0 0 0-.079-.038A19.74 19.74 0 0 0 5.171 4.37a.07.07 0 0 0-.032.027C1.533 9.79.554 15.062 1.036 20.268a.083.083 0 0 0 .031.057 19.91 19.91 0 0 0 5.99 3.03.078.078 0 0 0 .085-.027 14.21 14.21 0 0 0 1.226-1.994.076.076 0 0 0-.041-.105 13.13 13.13 0 0 1-1.873-.892.077.077 0 0 1-.008-.128c.126-.094.252-.193.372-.292a.075.075 0 0 1 .078-.01c3.927 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .079.009c.12.099.246.198.373.293a.077.077 0 0 1-.006.127 12.32 12.32 0 0 1-1.874.892.076.076 0 0 0-.04.106 16 16 0 0 0 1.225 1.993.077.077 0 0 0 .084.028 19.85 19.85 0 0 0 6-3.03.077.077 0 0 0 .032-.056c.576-6.018-.966-11.246-4.087-15.872a.06.06 0 0 0-.031-.028zM8.02 17.097c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.334-.956 2.42-2.157 2.42zm7.974 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.175 1.094 2.157 2.418 0 1.334-.946 2.42-2.157 2.42z" />
    </svg>
  );
}

interface AppearanceSettingsProps {
  backendConfig: AppConfig | null;
  persistConfigField: (key: string, value: string) => Promise<void>;
  themeColors: { primary: string; secondary: string };
  discordEnabled: boolean;
  toggleDiscordPresence: () => void;
}

export function AppearanceSettings({
  backendConfig,
  persistConfigField,
  themeColors,
  discordEnabled,
  toggleDiscordPresence,
}: AppearanceSettingsProps) {
  const [draftColors, setDraftColors] = React.useState(themeColors);
  const draftRef = React.useRef(draftColors);
  const pendingKeysRef = React.useRef<Set<"theme_color_a" | "theme_color_b">>(new Set());
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    setDraftColors(themeColors);
    draftRef.current = themeColors;
  }, [themeColors]);

  React.useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const flushPending = React.useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const keys = pendingKeysRef.current;
    if (keys.size === 0) return;
    const colors = draftRef.current;
    window.dispatchEvent(new CustomEvent("theme-changed", { detail: colors }));
    if (keys.has("theme_color_a")) {
      void persistConfigField("theme_color_a", colors.primary);
    }
    if (keys.has("theme_color_b")) {
      void persistConfigField("theme_color_b", colors.secondary);
    }
    keys.clear();
  }, [persistConfigField]);

  const scheduleFlush = React.useCallback(
    (key: "theme_color_a" | "theme_color_b") => {
      pendingKeysRef.current.add(key);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flushPending, 200);
    },
    [flushPending],
  );

  return (
    <div className="settings-category-wrapper">
      <div className="settings-group glass">
        <div className="settings-group-header">Appearance</div>

        <div className="setting-row theme-setting-row">
          <div className="setting-info">
            <span className="setting-label">Gradient theme</span>
            <span className="setting-desc">
              Choose one or two custom colors for buttons, active tabs, highlights, progress, and action states.
            </span>
          </div>
          <div className="theme-customizer" aria-label="Gradient theme colors">
            <label className="theme-color-field">
              <span>Color 1</span>
              <input
                type="color"
                value={draftColors.primary}
                onChange={(event) => {
                  const next = { ...draftRef.current, primary: event.currentTarget.value };
                  draftRef.current = next;
                  setDraftColors(next);
                  applyAppTheme(next);
                  scheduleFlush("theme_color_a");
                }}
                onBlur={flushPending}
                aria-label="Gradient theme color 1"
              />
            </label>
            <label className="theme-color-field">
              <span>Color 2</span>
              <input
                type="color"
                value={draftColors.secondary}
                onChange={(event) => {
                  const next = { ...draftRef.current, secondary: event.currentTarget.value };
                  draftRef.current = next;
                  setDraftColors(next);
                  applyAppTheme(next);
                  scheduleFlush("theme_color_b");
                }}
                onBlur={flushPending}
                aria-label="Gradient theme color 2"
              />
            </label>
            <div
              className="theme-gradient-preview"
              style={{
                background: `linear-gradient(120deg, ${draftColors.primary}, ${draftColors.secondary})`,
              }}
              aria-hidden="true"
            />
          </div>
        </div>

        <div className="setting-row">
          <div className="setting-info">
            <span className="setting-label">Background image</span>
            <span className="setting-desc">
              {backendConfig?.background_image
                ? "An image is currently set. Open the customizer to reposition, dim, blur, or remove it."
                : "Replace the empty black areas of the workspace with a custom image. Opens a cropper for positioning, zoom, dim, and blur."}
            </span>
          </div>
          <button
            type="button"
            className="settings-action-pill spring-motion"
            onClick={() => window.dispatchEvent(new CustomEvent("bg-customize-open"))}
            title={backendConfig?.background_image ? "Open the background customizer" : "Choose a background image"}
          >
            {backendConfig?.background_image ? (
              <span
                className="settings-action-pill-thumb"
                aria-hidden="true"
                style={{ backgroundImage: `url("${convertFileSrc(backendConfig.background_image)}")` }}
              />
            ) : (
              <span className="settings-action-pill-icon" aria-hidden="true">
                <ImageIcon size={16} strokeWidth={2.2} />
              </span>
            )}
            <span className="settings-action-pill-label">
              {backendConfig?.background_image ? "Customize background" : "Choose background"}
            </span>
          </button>
        </div>
      </div>

      <div className="settings-group glass">
        <div className="settings-group-header">Community</div>
        <div className="setting-row">
          <div className="setting-info">
            <span className="setting-label">Join the Discord</span>
            <span className="setting-desc">
              Chat with other creators, share AMVs, request features, and get help when something breaks.
            </span>
          </div>
          <button
            type="button"
            className="settings-action-pill is-discord spring-motion"
            onClick={() => {
              void openUrl(DISCORD_INVITE_URL).catch((error) => {
                logFrontend("warn", "frontend.discord.invite.open.error", "Could not open Discord invite", {
                  error: safeLogValue(error),
                });
              });
            }}
            title="Open the Ultimate AMV Discord invite in your browser"
          >
            <span className="settings-action-pill-icon" aria-hidden="true">
              <DiscordGlyph size={16} />
            </span>
            <span className="settings-action-pill-label">Discord</span>
          </button>
        </div>
      </div>

      <div className="settings-group glass">
        <div className="settings-group-header">Discord Rich Presence</div>
        <div className="setting-row">
          <div className="setting-info">
            <span className="setting-label">Show activity on Discord</span>
            <span className="setting-desc">
              Displays &ldquo;Playing Ultimate AMV&rdquo; with the current panel or running job on your Discord profile. Requires the Discord desktop app to be running.
            </span>
          </div>
          <div className="settings-toggle-wrap">
            <span className="settings-toggle-icon" aria-hidden="true">
              <MessageCircle size={16} strokeWidth={2.3} />
            </span>
            <span className={`settings-toggle-label ${discordEnabled ? "is-on" : "is-off"}`}>
              {discordEnabled ? "Enabled" : "Disabled"}
            </span>
            <button
              type="button"
              className="settings-toggle-switch spring-motion"
              role="switch"
              aria-checked={discordEnabled}
              aria-label="Show activity on Discord"
              data-on={discordEnabled ? "true" : "false"}
              onClick={toggleDiscordPresence}
              title={discordEnabled ? "Click to hide presence on Discord" : "Click to show presence on Discord"}
            >
              <span className="settings-toggle-track" aria-hidden="true">
                <span className="settings-toggle-track-on">ON</span>
                <span className="settings-toggle-track-off">OFF</span>
                <span className="settings-toggle-knob" />
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
