//! Start at login through the per-user Run key. The value name is the product name, which is
//! what the Tauri uninstaller removes, and what the installer hook writes when it carries the
//! setting over from the 1.0.x Electron build.

#[cfg(windows)]
mod imp {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const NAME: &str = "KeyCat";

    pub fn enabled() -> bool {
        RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(RUN)
            .and_then(|key| key.get_value::<String, _>(NAME))
            .is_ok()
    }

    pub fn set(on: bool) -> std::io::Result<()> {
        let (key, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(RUN)?;
        if on {
            let exe = std::env::current_exe()?;
            key.set_value(NAME, &format!("\"{}\"", exe.display()))
        } else {
            match key.delete_value(NAME) {
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error),
                _ => Ok(()),
            }
        }
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn enabled() -> bool {
        false
    }

    pub fn set(_on: bool) -> std::io::Result<()> {
        Err(std::io::Error::new(std::io::ErrorKind::Unsupported, "autostart is Windows-only"))
    }
}

pub use imp::{enabled, set};
