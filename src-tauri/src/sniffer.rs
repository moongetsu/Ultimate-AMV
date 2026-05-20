use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Mutex, OnceLock,
    },
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{Emitter, Manager};

use crate::{log_error, log_info, log_warn};

#[derive(Clone, Serialize)]
pub(crate) struct MediaCandidate {
    pub url: String,
    pub kind: String,
}

#[derive(Clone, Serialize)]
pub(crate) struct MediaRequestDebug {
    pub url: String,
    pub count: usize,
    pub interesting: bool,
}

#[derive(Clone, Serialize)]
pub(crate) struct ProviderNavigation {
    pub url: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderPageIdentity {
    pub anime_title: Option<String>,
    pub episode_number: Option<String>,
    pub episode_label: Option<String>,
    pub source_page: Option<String>,
}

#[derive(Deserialize)]
struct AnikaiSyncData {
    name: Option<String>,
    series_url: Option<String>,
}

pub(crate) static SEEN_MEDIA_URLS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
pub(crate) static MEDIA_REQUEST_COUNT: AtomicUsize = AtomicUsize::new(0);
pub(crate) static IDENTITY_GENERATION: AtomicU64 = AtomicU64::new(0);
pub(crate) static IDENTITY_RESOLVED_GEN: AtomicU64 = AtomicU64::new(0);
pub(crate) const IDENTITY_WATCHDOG_SECS: u64 = 12;

pub(crate) fn clear_media_sniffer_state() {
    if let Some(seen) = SEEN_MEDIA_URLS.get() {
        if let Ok(mut urls) = seen.lock() {
            urls.clear();
        }
    }
    MEDIA_REQUEST_COUNT.store(0, Ordering::Relaxed);
}

fn media_kind(url: &str) -> Option<&'static str> {
    let lower = url.to_ascii_lowercase();
    if lower.contains(".m3u8") {
        Some("hls")
    } else if lower.contains(".mpd") {
        Some("dash")
    } else if lower.contains(".mp4") || lower.contains(".mkv") || lower.contains(".webm") {
        Some("video")
    } else if lower.contains(".m4s")
        || lower.contains(".ts?")
        || lower.ends_with(".ts")
        || lower.contains("/seg-")
        || lower.contains("/segment")
        || lower.contains("/fragment")
    {
        Some("segment")
    } else {
        None
    }
}

fn is_interesting_request(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    media_kind(url).is_some()
        || lower.contains("playlist")
        || lower.contains("manifest")
        || lower.contains("master")
        || lower.contains("source")
        || lower.contains("stream")
        || lower.contains("embed")
        || lower.contains("player")
        || lower.contains("episode")
}

fn emit_media_request_debug(app: &tauri::AppHandle, url: &str) {
    let count = MEDIA_REQUEST_COUNT.fetch_add(1, Ordering::Relaxed) + 1;
    let interesting = is_interesting_request(url);
    if interesting || count % 25 == 0 {
        if interesting {
            log_info(
                "browser.media.request",
                "Observed interesting provider media request",
                json!({ "url": url, "count": count }),
            );
        }
        let _ = app.emit(
            "media-request-debug",
            MediaRequestDebug {
                url: url.to_string(),
                count,
                interesting,
            },
        );
    }
}

fn emit_media_candidate(app: &tauri::AppHandle, url: String) {
    let Some(kind) = media_kind(&url) else { return };
    if kind == "segment" {
        return;
    }

    let seen = SEEN_MEDIA_URLS.get_or_init(|| Mutex::new(HashSet::new()));
    if let Ok(mut urls) = seen.lock() {
        if !urls.insert(url.clone()) {
            return;
        }
    }

    log_info(
        "browser.media.candidate",
        "Captured playable media candidate",
        json!({ "kind": kind, "url": url }),
    );
    let _ = app.emit(
        "media-candidate",
        MediaCandidate {
            url,
            kind: kind.to_string(),
        },
    );
}

fn emit_provider_page_identity(app: &tauri::AppHandle, identity: ProviderPageIdentity) {
    if identity.anime_title.is_none() && identity.episode_number.is_none() {
        return;
    }
    if identity.episode_number.is_some() {
        let current = IDENTITY_GENERATION.load(Ordering::Relaxed);
        IDENTITY_RESOLVED_GEN.store(current, Ordering::Relaxed);
    }
    log_info(
        "browser.provider.identity",
        "Detected provider page identity",
        json!({
            "animeTitle": &identity.anime_title,
            "episodeNumber": &identity.episode_number,
            "episodeLabel": &identity.episode_label,
            "sourcePage": &identity.source_page,
        }),
    );
    let _ = app.emit("provider-page-identity", identity);
}

fn start_identity_watchdog(watch_url: String) {
    let generation = IDENTITY_GENERATION.fetch_add(1, Ordering::Relaxed) + 1;
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(IDENTITY_WATCHDOG_SECS));
        if IDENTITY_GENERATION.load(Ordering::Relaxed) != generation {
            return;
        }
        if IDENTITY_RESOLVED_GEN.load(Ordering::Relaxed) >= generation {
            return;
        }
        log_warn(
            "browser.provider.identity.timeout",
            "Provider identity not detected within watchdog window",
            json!({
                "watchUrl": watch_url,
                "windowSecs": IDENTITY_WATCHDOG_SECS,
            }),
        );
    });
}

pub(crate) fn clean_detected_episode(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    let lower = trimmed.to_ascii_lowercase();
    for marker in ["episode", "ep"] {
        if let Some(index) = lower.find(marker) {
            let after = trimmed[index + marker.len()..].trim_start_matches([' ', ':', '#', '-', '_']);
            let number = after
                .chars()
                .take_while(|character| character.is_ascii_digit() || *character == '.')
                .collect::<String>();
            if number.chars().any(|character| character.is_ascii_digit()) {
                return Some(number);
            }
        }
    }

    if trimmed.chars().all(|character| character.is_ascii_digit() || character == '.')
        && trimmed.chars().any(|character| character.is_ascii_digit())
    {
        return Some(trimmed.to_string());
    }

    None
}

fn query_value(url: &str, key: &str) -> Option<String> {
    let query = url.split_once('?')?.1.split('#').next().unwrap_or_default();
    for pair in query.split('&') {
        let (raw_key, raw_value) = pair.split_once('=').unwrap_or((pair, ""));
        if raw_key.eq_ignore_ascii_case(key) {
            return Some(raw_value.replace('+', " "));
        }
    }
    None
}

fn extract_episode_from_provider_url(url: &str) -> Option<String> {
    for key in ["ep", "episode", "episode_number", "episodeNumber"] {
        if let Some(value) = query_value(url, key).and_then(|value| clean_detected_episode(&value)) {
            return Some(value);
        }
    }

    let lower = url.to_ascii_lowercase();
    for marker in ["/episode/", "/episodes/", "/ep/", "episode-", "episode_", "ep-", "ep_"] {
        if let Some(index) = lower.find(marker) {
            let after = &url[index + marker.len()..];
            let number = after
                .chars()
                .take_while(|character| character.is_ascii_digit() || *character == '.')
                .collect::<String>();
            if number.chars().any(|character| character.is_ascii_digit()) {
                return Some(number);
            }
        }
    }

    None
}

pub(crate) fn is_anikai_identity_request(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    if !(lower.contains("anikai.to") || lower.contains("aniwaves.ru") || lower.contains("aniwave.ru")) {
        return false;
    }
    if media_kind(url).is_some() {
        return false;
    }
    lower.contains("ajax")
        || lower.contains("api")
        || lower.contains("episode")
        || lower.contains("server")
        || lower.contains("source")
        || lower.contains("player")
        || lower.contains("embed")
}

fn provider_identity_from_request_url(url: &str) -> Option<ProviderPageIdentity> {
    let episode_number = extract_episode_from_provider_url(url)?;
    Some(ProviderPageIdentity {
        anime_title: None,
        episode_label: Some(format!("Episode {episode_number}")),
        episode_number: Some(episode_number),
        source_page: None,
    })
}

fn find_episode_in_json(value: &Value) -> Option<String> {
    match value {
        Value::Object(map) => {
            for key in ["episode", "episode_number", "episodeNumber", "ep", "number"] {
                if let Some(found) = map.get(key).and_then(value_to_episode_number) {
                    return Some(found);
                }
            }
            for nested in map.values() {
                if let Some(found) = find_episode_in_json(nested) {
                    return Some(found);
                }
            }
            None
        }
        Value::Array(items) => items.iter().find_map(find_episode_in_json),
        Value::String(text) => clean_detected_episode(text),
        _ => None,
    }
}

fn value_to_episode_number(value: &Value) -> Option<String> {
    match value {
        Value::Number(number) => Some(number.to_string()),
        Value::String(text) => clean_detected_episode(text),
        _ => None,
    }
}

fn find_title_in_json(value: &Value) -> Option<String> {
    match value {
        Value::Object(map) => {
            for key in ["anime_title", "animeTitle", "anime", "title", "name"] {
                if let Some(text) = map
                    .get(key)
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|text| !text.is_empty() && clean_detected_episode(text).is_none())
                {
                    return Some(text.to_string());
                }
            }
            for nested in map.values() {
                if let Some(found) = find_title_in_json(nested) {
                    return Some(found);
                }
            }
            None
        }
        Value::Array(items) => items.iter().find_map(find_title_in_json),
        _ => None,
    }
}

pub(crate) fn parse_anikai_identity_payload(source: &str, fallback_url: &str) -> Option<ProviderPageIdentity> {
    let payload: Value = serde_json::from_str(source.trim()).ok()?;
    let episode_number = find_episode_in_json(&payload)
        .or_else(|| extract_episode_from_provider_url(fallback_url))?;
    Some(ProviderPageIdentity {
        anime_title: find_title_in_json(&payload),
        episode_label: Some(format!("Episode {episode_number}")),
        episode_number: Some(episode_number),
        source_page: None,
    })
}

pub(crate) fn is_anikai_watch_document_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    (lower.contains("aniwaves.ru/watch/") || lower.contains("aniwave.ru/watch/") || lower.contains("anikai.to/watch/"))
        && !lower.contains(".m3u8")
        && !lower.contains(".mp4")
}

fn is_navigation_allowed(url: &str, allowed_hosts: &[String]) -> bool {
    let trimmed = url.trim();
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("about:") || lower.starts_with("data:") || lower.starts_with("blob:") {
        return true;
    }

    let without_scheme = lower
        .strip_prefix("https://")
        .or_else(|| lower.strip_prefix("http://"))
        .unwrap_or(&lower);
    let host = without_scheme
        .split(['/', '?', '#', ':'])
        .next()
        .unwrap_or_default();
    allowed_hosts.iter().any(|allowed| {
        let allowed = allowed.trim().to_ascii_lowercase();
        if allowed.is_empty() {
            return false;
        }
        host == allowed || host.ends_with(&format!(".{}", allowed))
    })
}

pub(crate) fn parse_anikai_sync_data(source: &str, fallback_url: &str) -> Option<ProviderPageIdentity> {
    let marker_index = source
        .find("id=\"syncData\"")
        .or_else(|| source.find("id='syncData'"))?;
    let after_marker = &source[marker_index..];
    let content_start = after_marker.find('>')? + 1;
    let after_open = &after_marker[content_start..];
    let content_end = after_open.find("</script>")?;
    let json = after_open[..content_end].trim();
    let payload: AnikaiSyncData = serde_json::from_str(json).ok()?;
    // AniKai currently ships stale `syncData.episode` values on some watch
    // pages. The live WebView poller below is allowed to provide an episode
    // number, but the static document payload is only safe for the anime title.
    let episode_number = None;
    Some(ProviderPageIdentity {
        anime_title: payload
            .name
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string),
        episode_label: episode_number
            .as_ref()
            .map(|value| format!("Episode {value}")),
        episode_number,
        source_page: payload
            .series_url
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .or_else(|| Some(fallback_url.to_string())),
    })
}

fn extract_aniwave_identity(source: &str, fallback_url: &str) -> Option<ProviderPageIdentity> {
    let ep_marker = "You're watching <b>Episode ";
    let episode_number = if let Some(idx) = source.find(ep_marker) {
        let after = &source[idx + ep_marker.len()..];
        if let Some(end_idx) = after.find("</b>") {
            Some(after[..end_idx].trim().to_string())
        } else {
            None
        }
    } else {
        None
    };

    let title_marker = "<title>";
    let anime_title = if let Some(idx) = source.find(title_marker) {
        let after = &source[idx + title_marker.len()..];
        if let Some(end_idx) = after.find("</title>") {
            let mut t = after[..end_idx].trim();
            if t.starts_with("Watch ") { t = &t["Watch ".len()..]; }
            if let Some(ep_idx) = t.rfind(" Episode ") {
                t = &t[..ep_idx];
            } else if let Some(dash_idx) = t.rfind(" - ") {
                t = &t[..dash_idx];
            }
            Some(t.to_string())
        } else {
            None
        }
    } else {
        None
    };

    if episode_number.is_some() {
        Some(ProviderPageIdentity {
            anime_title,
            episode_label: episode_number.as_ref().map(|v| format!("Episode {v}")),
            episode_number,
            source_page: Some(fallback_url.to_string()),
        })
    } else {
        None
    }
}

#[cfg(windows)]
fn read_stream_to_string(content: &windows::Win32::System::Com::IStream) -> Option<String> {
    let mut body = Vec::new();
    let mut buffer = [0u8; 8192];
    loop {
        let mut bytes_read = 0u32;
        unsafe {
            content
                .Read(
                    buffer.as_mut_ptr().cast(),
                    buffer.len() as u32,
                    Some(&mut bytes_read),
                )
                .ok()
                .ok()?;
        }
        if bytes_read == 0 {
            break;
        }
        body.extend_from_slice(&buffer[..bytes_read as usize]);
        if body.len() > 2 * 1024 * 1024 {
            break;
        }
    }
    String::from_utf8(body).ok()
}

#[cfg(windows)]
fn install_webview2_media_sniffer(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    allowed_hosts: Vec<String>,
) -> Result<(), String> {
    webview
        .with_webview(move |platform| unsafe {
            use webview2_com::{
                Microsoft::Web::WebView2::Win32::*, NavigationStartingEventHandler,
                WebResourceRequestedEventHandler, WebResourceResponseReceivedEventHandler,
                WebResourceResponseViewGetContentCompletedHandler,
            };
            use windows::core::{Interface, HSTRING, PWSTR};
            use windows::Win32::System::Com::IStream;

            let controller = platform.controller();
            let core = match controller.CoreWebView2() {
                Ok(core) => core,
                Err(error) => {
                    let _ = app.emit(
                        "media-sniffer-error",
                        format!("Could not access WebView2 core: {error}"),
                    );
                    return;
                }
            };

            if let Ok(core_22) = core.cast::<ICoreWebView2_22>() {
                let _ = core_22.AddWebResourceRequestedFilterWithRequestSourceKinds(
                    &HSTRING::from("*"),
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                    COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
                );
            } else {
                let _ = core.AddWebResourceRequestedFilter(
                    &HSTRING::from("*"),
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                );
            }

            let script = r#"
                if (!window.__amv_identity_poller) {
                    window.__amv_last_identity = "";
                    window.__amv_identity_poller = setInterval(() => {
                        try {
                            function cleanEpisode(value) {
                                if (!value) return null;
                                let text = String(value).replace(/\s+/g, " ").trim();
                                let match = text.match(/\b(?:Episode|EP)\s*([0-9]+(?:\.[0-9]+)?)/i);
                                if (match) return match[1];
                                if (/^[0-9]+(?:\.[0-9]+)?$/.test(text)) return text;
                                return null;
                            }
                            let ep = null;
                            let selectors = [
                                '.tip b',
                                '.ep-num',
                                '[data-episode].active',
                                '[data-number].active',
                                '[data-ep].active',
                                '.episode-section .active',
                                '[class*="episode"] .active',
                                '[class*="episode"][class*="active"]'
                            ];
                            for (let selector of selectors) {
                                let epEl = document.querySelector(selector);
                                if (!epEl) continue;
                                ep = cleanEpisode(epEl.getAttribute('data-episode'))
                                    || cleanEpisode(epEl.getAttribute('data-number'))
                                    || cleanEpisode(epEl.getAttribute('data-ep'))
                                    || cleanEpisode(epEl.textContent);
                                if (ep) break;
                            }
                            if (!ep) {
                                let params = new URLSearchParams(window.location.search);
                                ep = cleanEpisode(params.get('ep') || params.get('episode') || params.get('e'));
                            }
                            let title = null;
                            let titleEl = document.querySelector('h1.title');
                            if (titleEl) {
                                title = titleEl.innerText.trim();
                            }
                            if ((ep || title) && window.__TAURI__ && window.__TAURI__.event) {
                                let current = ep + "|" + title;
                                if (current !== window.__amv_last_identity) {
                                    window.__amv_last_identity = current;
                                    window.__TAURI__.event.emit('provider-page-identity', {
                                        animeTitle: title,
                                        episodeNumber: ep,
                                        episodeLabel: ep ? "Episode " + ep : null,
                                        sourcePage: window.location.href
                                    });
                                }
                            }
                        } catch (e) {}
                    }, 1500);
                }
            "#;
            let _ = core.AddScriptToExecuteOnDocumentCreated(&HSTRING::from(script), None);

            let app_for_handler = app.clone();
            let handler = WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let request = args.Request()?;
                let mut raw_uri = PWSTR::null();
                request.Uri(&mut raw_uri)?;
                if let Ok(url) = raw_uri.to_string() {
                    emit_media_request_debug(&app_for_handler, &url);
                    if is_anikai_identity_request(&url) {
                        if let Some(identity) = provider_identity_from_request_url(&url) {
                            emit_provider_page_identity(&app_for_handler, identity);
                        }
                    }
                    emit_media_candidate(&app_for_handler, url);
                }
                Ok(())
            }));

            let mut token = 0;
            if let Err(error) = core.add_WebResourceRequested(&handler, &mut token) {
                log_error(
                    "browser.sniffer.error",
                    "WebView2 media sniffer failed",
                    json!({ "error": error.to_string() }),
                );
                let _ = app.emit("media-sniffer-error", format!("{error}"));
            } else {
                log_info("browser.sniffer.ready", "WebView2 media sniffer ready", Value::Null);
                let _ = app.emit("media-sniffer-ready", ());
            }

            if let Ok(core_2) = core.cast::<ICoreWebView2_2>() {
                let app_for_response = app.clone();
                let response_handler =
                    WebResourceResponseReceivedEventHandler::create(Box::new(move |_, args| {
                        let Some(args) = args else { return Ok(()) };
                        let request = args.Request()?;
                        let mut raw_uri = PWSTR::null();
                        request.Uri(&mut raw_uri)?;
                        let Ok(request_url) = raw_uri.to_string() else {
                            return Ok(());
                        };
                        let should_read_watch_document = is_anikai_watch_document_url(&request_url);
                        let should_read_identity_api = is_anikai_identity_request(&request_url);
                        if !should_read_watch_document && !should_read_identity_api {
                            return Ok(());
                        }

                        let response = args.Response()?;
                        let mut status_code = 0;
                        if response.StatusCode(&mut status_code).is_err()
                            || !(200..400).contains(&status_code)
                        {
                            return Ok(());
                        }

                        let app_for_content = app_for_response.clone();
                        let response_url = request_url.clone();
                        let content_handler =
                            WebResourceResponseViewGetContentCompletedHandler::create(Box::new(
                                move |result, content: Option<IStream>| {
                                    if result.is_err() {
                                        return Ok(());
                                    }
                                    let Some(content) = content else {
                                        return Ok(());
                                    };
                                    if let Some(source) = read_stream_to_string(&content) {
                                        let identity = if should_read_watch_document {
                                            parse_anikai_sync_data(&source, &response_url)
                                                .or_else(|| extract_aniwave_identity(&source, &response_url))
                                        } else {
                                            parse_anikai_identity_payload(&source, &response_url)
                                        };
                                        if let Some(identity) = identity {
                                            emit_provider_page_identity(&app_for_content, identity);
                                        }
                                    }
                                    Ok(())
                                },
                            ));
                        let _ = response.GetContent(&content_handler);
                        Ok(())
                    }));
                let mut response_token = 0;
                let _ =
                    core_2.add_WebResourceResponseReceived(&response_handler, &mut response_token);
            }

            let app_for_navigation = app.clone();
            let allowed_hosts_for_navigation = allowed_hosts.clone();
            let navigation_handler =
                NavigationStartingEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else { return Ok(()) };
                    clear_media_sniffer_state();
                    let mut raw_uri = PWSTR::null();
                    args.Uri(&mut raw_uri)?;
                    if let Ok(url) = raw_uri.to_string() {
                        if !allowed_hosts_for_navigation.is_empty()
                            && !is_navigation_allowed(&url, &allowed_hosts_for_navigation)
                        {
                            let _ = args.SetCancel(true);
                            log_warn(
                                "browser.navigation.blocked",
                                "Blocked provider navigation outside allowlist",
                                json!({ "url": url }),
                            );
                            let _ = app_for_navigation.emit(
                                "media-sniffer-error",
                                format!("Blocked navigation outside allowed hosts: {url}"),
                            );
                            return Ok(());
                        }
                        log_info(
                            "browser.navigation",
                            "Provider WebView navigation started",
                            json!({ "url": url }),
                        );
                        if is_anikai_watch_document_url(&url) {
                            start_identity_watchdog(url.clone());
                        }
                        let _ = app_for_navigation
                            .emit("provider-navigation", ProviderNavigation { url });
                    }
                    Ok(())
                }));
            let mut navigation_token = 0;
            let _ = core.add_NavigationStarting(&navigation_handler, &mut navigation_token);
        })
        .map_err(|error| error.to_string())
}

#[cfg(not(windows))]
fn install_webview2_media_sniffer(
    _app: tauri::AppHandle,
    _webview: tauri::Webview,
    _allowed_hosts: Vec<String>,
) -> Result<(), String> {
    Err("Media sniffing is currently Windows/WebView2-only.".to_string())
}

#[tauri::command]
pub(crate) async fn install_media_sniffer(
    app: tauri::AppHandle,
    label: String,
    allowed_hosts: Option<Vec<String>>,
) -> Result<(), String> {
    let allowed_hosts = allowed_hosts.unwrap_or_default();
    log_info(
        "browser.sniffer.install.start",
        "Installing media sniffer",
        json!({ "label": label, "allowed_hosts": allowed_hosts }),
    );
    clear_media_sniffer_state();
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Could not find provider WebView '{label}'"))?;
    let result = install_webview2_media_sniffer(app, webview, allowed_hosts);
    match &result {
        Ok(_) => log_info(
            "browser.sniffer.install.complete",
            "Media sniffer installed",
            json!({ "label": label }),
        ),
        Err(error) => log_error(
            "browser.sniffer.install.error",
            "Media sniffer install failed",
            json!({ "label": label, "error": error }),
        ),
    }
    result
}
