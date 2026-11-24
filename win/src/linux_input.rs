//! Reads the active user's input devices to drive the cat in Wayland and X11 sessions.
use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io;
use std::os::fd::AsRawFd;
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::mpsc::Sender;
use std::thread;
use std::time::{Duration, Instant};

use evdev::{Device, EventSummary, KeyCode, RelativeAxisCode};

use super::{Button, Input};
use crate::keymap;

static MOUSE_X: AtomicI32 = AtomicI32::new(0);
static MOUSE_Y: AtomicI32 = AtomicI32::new(0);

pub fn take_motion() -> (i32, i32) {
    (
        MOUSE_X.swap(0, Ordering::Relaxed),
        MOUSE_Y.swap(0, Ordering::Relaxed),
    )
}

struct Source {
    path: PathBuf,
    id: u32,
    device: Device,
    pressed: HashSet<KeyCode>,
}

fn dom_code(key: KeyCode) -> Option<&'static str> {
    // The main keyboard block uses the same physical numbers as set-1 scan codes.
    Some(match key {
        KeyCode::KEY_NUMLOCK => "NumLock",
        KeyCode::KEY_KPENTER => "NumpadEnter",
        KeyCode::KEY_RIGHTCTRL => "ControlRight",
        KeyCode::KEY_KPSLASH => "NumpadDivide",
        KeyCode::KEY_KPEQUAL => "NumpadEqual",
        KeyCode::KEY_SYSRQ | KeyCode::KEY_PRINT => "PrintScreen",
        KeyCode::KEY_RIGHTALT => "AltRight",
        KeyCode::KEY_HOME => "Home",
        KeyCode::KEY_UP => "ArrowUp",
        KeyCode::KEY_PAGEUP => "PageUp",
        KeyCode::KEY_LEFT => "ArrowLeft",
        KeyCode::KEY_RIGHT => "ArrowRight",
        KeyCode::KEY_END => "End",
        KeyCode::KEY_DOWN => "ArrowDown",
        KeyCode::KEY_PAGEDOWN => "PageDown",
        KeyCode::KEY_INSERT => "Insert",
        KeyCode::KEY_DELETE => "Delete",
        KeyCode::KEY_PAUSE => "Pause",
        KeyCode::KEY_LEFTMETA => "MetaLeft",
        KeyCode::KEY_RIGHTMETA => "MetaRight",
        KeyCode::KEY_COMPOSE | KeyCode::KEY_MENU => "ContextMenu",
        KeyCode::KEY_F13 => "F13",
        KeyCode::KEY_F14 => "F14",
        KeyCode::KEY_F15 => "F15",
        KeyCode::KEY_F16 => "F16",
        KeyCode::KEY_F17 => "F17",
        KeyCode::KEY_F18 => "F18",
        KeyCode::KEY_F19 => "F19",
        KeyCode::KEY_F20 => "F20",
        KeyCode::KEY_F21 => "F21",
        KeyCode::KEY_F22 => "F22",
        KeyCode::KEY_F23 => "F23",
        KeyCode::KEY_F24 => "F24",
        KeyCode(code @ (1..=83 | 86..=88)) => return keymap::code(u32::from(code), false, 0),
        _ => return None,
    })
}

fn button_event(device: u32, key: KeyCode, down: bool) -> Option<Input> {
    let button = match key {
        KeyCode::BTN_LEFT => Button::Left,
        KeyCode::BTN_RIGHT => Button::Right,
        KeyCode::BTN_MIDDLE | KeyCode::BTN_SIDE | KeyCode::BTN_EXTRA => Button::Other,
        _ => {
            return Some(Input::Key {
                id: (device << 16) | u32::from(key.0),
                code: Some(dom_code(key)?),
                down,
            })
        }
    };
    Some(Input::Button { button, down })
}

fn discover(sources: &mut Vec<Source>, next_id: &mut u32) {
    let Ok(entries) = fs::read_dir("/dev/input") else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !entry.file_name().to_string_lossy().starts_with("event")
            || sources.iter().any(|source| source.path == path)
        {
            continue;
        }
        let Ok(file) = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NONBLOCK)
            .open(&path)
        else {
            continue;
        };
        let Ok(device) = Device::from_fd(file.into()) else {
            continue;
        };
        let usable = device.supported_keys().is_some_and(|keys| {
            keys.contains(KeyCode::KEY_A)
                || keys.contains(KeyCode::KEY_KP0)
                || keys.contains(KeyCode::BTN_LEFT)
        }) || device.supported_relative_axes().is_some_and(|axes| {
            axes.contains(RelativeAxisCode::REL_X) && axes.contains(RelativeAxisCode::REL_Y)
        });
        if usable {
            sources.push(Source {
                path,
                id: *next_id,
                device,
                pressed: HashSet::new(),
            });
            *next_id = next_id.wrapping_add(1);
        }
    }
}

impl Source {
    fn receive(&mut self, sink: &Sender<Input>) -> io::Result<()> {
        for event in self.device.fetch_events()? {
            match event.destructure() {
                EventSummary::Key(_, key, value @ (0 | 1)) => {
                    let down = value == 1;
                    if let Some(event) = button_event(self.id, key, down) {
                        let changed = if down {
                            self.pressed.insert(key)
                        } else {
                            self.pressed.remove(&key)
                        };
                        if changed {
                            let _ = sink.send(event);
                        }
                    }
                }
                EventSummary::RelativeAxis(_, RelativeAxisCode::REL_X, delta) => {
                    MOUSE_X.fetch_add(delta, Ordering::Relaxed);
                }
                EventSummary::RelativeAxis(_, RelativeAxisCode::REL_Y, delta) => {
                    MOUSE_Y.fetch_add(delta, Ordering::Relaxed);
                }
                EventSummary::RelativeAxis(_, RelativeAxisCode::REL_WHEEL, delta) => {
                    let _ = sink.send(Input::Wheel(f64::from(delta)));
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn release(self, sink: &Sender<Input>) {
        for key in self.pressed {
            if let Some(event) = button_event(self.id, key, false) {
                let _ = sink.send(event);
            }
        }
    }
}

pub fn start(sink: Sender<Input>) -> Result<(), String> {
    let mut sources = Vec::new();
    let mut next_id = 0;
    discover(&mut sources, &mut next_id);
    if sources.is_empty() {
        return Err("could not open any keyboard or pointer devices in /dev/input".into());
    }
    thread::Builder::new()
        .name("evdev-input".into())
        .spawn(move || {
            let refresh = Duration::from_secs(2);
            let mut next_scan = Instant::now() + refresh;
            loop {
                if Instant::now() >= next_scan {
                    discover(&mut sources, &mut next_id);
                    next_scan = Instant::now() + refresh;
                }
                let mut poll_fds: Vec<_> = sources
                    .iter()
                    .map(|source| libc::pollfd {
                        fd: source.device.as_raw_fd(),
                        events: libc::POLLIN,
                        revents: 0,
                    })
                    .collect();
                // Source owns each descriptor throughout the poll.
                let ready = unsafe {
                    libc::poll(poll_fds.as_mut_ptr(), poll_fds.len() as libc::nfds_t, 250)
                };
                if ready > 0 {
                    for (index, poll) in poll_fds.into_iter().enumerate().rev() {
                        let removed =
                            poll.revents & (libc::POLLERR | libc::POLLHUP | libc::POLLNVAL) != 0;
                        let failed = poll.revents & libc::POLLIN != 0
                            && sources[index].receive(&sink).is_err_and(|error| {
                                !matches!(
                                    error.kind(),
                                    io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
                                )
                            });
                        if removed || failed {
                            sources.swap_remove(index).release(&sink);
                        }
                    }
                }
            }
        })
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_physical_keys_without_confusing_arrows_and_numpad() {
        assert_eq!(dom_code(KeyCode::KEY_A), Some("KeyA"));
        assert_eq!(dom_code(KeyCode::KEY_UP), Some("ArrowUp"));
        assert_eq!(dom_code(KeyCode::KEY_KP8), Some("Numpad8"));
        assert_eq!(dom_code(KeyCode::KEY_RIGHTCTRL), Some("ControlRight"));
        assert_eq!(dom_code(KeyCode::BTN_LEFT), None);
    }
}
