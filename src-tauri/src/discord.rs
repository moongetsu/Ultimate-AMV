use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;

use discord_rich_presence::{
    activity::{Activity, Assets},
    DiscordIpc, DiscordIpcClient,
};
use serde_json::{json, Value};

use crate::{log_info, log_warn};

const APP_ID: &str = "1505241290084974833";
const RETRY_SECS: u64 = 30;
const DETAILS: &str = "The amv editors toolkit";
const ASSET_KEY: &str = "icon";
const ASSET_TEXT: &str = "Ultimate AMV";
const DEFAULT_STATE: &str = "Idle";

static CLIENT: OnceLock<Mutex<Option<DiscordIpcClient>>> = OnceLock::new();

pub fn start() {
    let _ = CLIENT.set(Mutex::new(None));

    thread::spawn(|| {
        let mut client = match DiscordIpcClient::new(APP_ID) {
            Ok(c) => c,
            Err(err) => {
                log_warn(
                    "discord.presence.init_failed",
                    "Could not create Discord IPC client",
                    json!({ "error": err.to_string() }),
                );
                return;
            }
        };

        loop {
            match client.connect() {
                Ok(()) => break,
                Err(err) => {
                    log_warn(
                        "discord.presence.retry",
                        "Discord IPC not available; retrying",
                        json!({ "error": err.to_string(), "retry_secs": RETRY_SECS }),
                    );
                    thread::sleep(Duration::from_secs(RETRY_SECS));
                }
            }
        }

        log_info(
            "discord.presence.connected",
            "Discord IPC connected",
            Value::Null,
        );

        if let Some(slot) = CLIENT.get() {
            if let Ok(mut guard) = slot.lock() {
                *guard = Some(client);
            }
        }
    });
}

pub fn clear() {
    let Some(slot) = CLIENT.get() else {
        return;
    };
    let Ok(mut guard) = slot.lock() else {
        return;
    };
    let Some(client) = guard.as_mut() else {
        return;
    };
    if let Err(err) = client.clear_activity() {
        log_warn(
            "discord.presence.clear_failed",
            "Could not clear Discord activity",
            json!({ "error": err.to_string() }),
        );
    }
}

pub fn set_state(new_state: &str) {
    let state = if new_state.trim().is_empty() {
        DEFAULT_STATE.to_string()
    } else {
        new_state.to_string()
    };

    let Some(slot) = CLIENT.get() else {
        return;
    };
    let Ok(mut guard) = slot.lock() else {
        return;
    };
    let Some(client) = guard.as_mut() else {
        return;
    };

    if let Err(err) = push_activity(client, &state) {
        log_warn(
            "discord.presence.update_failed",
            "Could not update Discord activity",
            json!({ "error": err.to_string(), "state": state }),
        );
    }
}

fn push_activity(
    client: &mut DiscordIpcClient,
    state: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let activity = Activity::new()
        .details(DETAILS)
        .state(state)
        .assets(
            Assets::new()
                .large_image(ASSET_KEY)
                .large_text(ASSET_TEXT),
        );
    client.set_activity(activity)?;
    Ok(())
}
