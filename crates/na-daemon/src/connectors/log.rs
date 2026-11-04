//! The last log lines of a connector (its stderr), with every known secret value masked.

use std::collections::VecDeque;

use parking_lot::Mutex;

pub const LINES: usize = 500;

#[derive(Default)]
pub struct Log {
    lines: Mutex<VecDeque<String>>,
    secrets: Mutex<Vec<String>>,
}

impl Log {
    /// Secret values to hide from now on (and in lines already kept).
    pub fn set_secrets(&self, values: Vec<String>) {
        let values: Vec<String> = values.into_iter().filter(|v| v.len() >= 4).collect();
        *self.secrets.lock() = values;
        let mut lines = self.lines.lock();
        for l in lines.iter_mut() {
            *l = self.mask(l);
        }
    }

    pub fn mask(&self, line: &str) -> String {
        let mut out = line.to_string();
        for s in self.secrets.lock().iter() {
            if out.contains(s.as_str()) {
                out = out.replace(s.as_str(), "***");
            }
        }
        out
    }

    pub fn push(&self, line: &str) {
        let line = self.mask(line.trim_end());
        if line.is_empty() {
            return;
        }
        let mut l = self.lines.lock();
        if l.len() >= LINES {
            l.pop_front();
        }
        l.push_back(line);
    }

    pub fn lines(&self) -> Vec<String> {
        self.lines.lock().iter().cloned().collect()
    }

    pub fn last(&self) -> Option<String> {
        self.lines.lock().back().cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_secrets_and_keeps_a_ring() {
        let l = Log::default();
        l.set_secrets(vec!["hunter2-secret".into(), "ab".into()]);
        l.push("login with hunter2-secret failed");
        assert_eq!(l.last().unwrap(), "login with *** failed");
        // A secret set later also hides what was logged before.
        l.push("token=late-token-value");
        l.set_secrets(vec!["late-token-value".into()]);
        assert_eq!(l.lines()[1], "token=***");
        for i in 0..LINES + 20 {
            l.push(&format!("line {i}"));
        }
        assert_eq!(l.lines().len(), LINES);
        assert!(l.lines().last().unwrap().ends_with(&format!("{}", LINES + 19)));
    }
}
