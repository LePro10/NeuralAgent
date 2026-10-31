//! Claude view: actions the phone asks for (`Request::CvAction`), done by typing the CLI's own
//! keys into the session's PTY. Every step that depends on what the CLI shows reads the screen
//! first, so a key is never sent blind into the wrong dialog.

use std::sync::Arc;
use std::time::Duration;

use na_protocol::*;

use crate::claude_view::{EFFORTS, detect_mode, detect_prompt};
use crate::core::{Core, err};
use crate::cv_screen;
use crate::pty::Pty;

const UP: &[u8] = b"\x1b[A";
const DOWN: &[u8] = b"\x1b[B";
const RIGHT: &[u8] = b"\x1b[C";
const SHIFT_TAB: &[u8] = b"\x1b[Z";

fn bad(msg: impl Into<String>) -> ApiError {
    err(ErrorCode::BadRequest, msg.into())
}

fn put(pty: &Pty, data: &[u8]) -> Result<(), ApiError> {
    pty.write(data).map_err(|e| err(ErrorCode::Internal, e.to_string()))
}

async fn pause(ms: u64) {
    tokio::time::sleep(Duration::from_millis(ms)).await;
}

/// Text as one paste (multi-line stays one message), then Enter as a key press.
async fn paste_enter(pty: &Pty, text: &str) -> Result<(), ApiError> {
    put(pty, format!("\x1b[200~{}\x1b[201~", text.replace('\x1b', "")).as_bytes())?;
    pause(80).await;
    put(pty, b"\r")
}

/// A slash command typed key by key (so the CLI's command matching sees it), then Enter.
async fn slash(pty: &Pty, line: &str) -> Result<(), ApiError> {
    put(pty, line.as_bytes())?;
    pause(150).await;
    put(pty, b"\r")
}

/// The menu on the screen now: numbered first, then one without numbers (with its `id`).
pub fn menu_now(screen: &str) -> Option<CvPrompt> {
    let mut p = detect_prompt(screen).or_else(|| cv_screen::detect_menu(screen))?;
    p.id = Some(cv_screen::fingerprint(&p));
    Some(p)
}

/// The answer was meant for prompt `want` (`CvPrompt.id`): refuse it when another one is shown.
fn same_prompt(p: &CvPrompt, want: Option<&str>) -> Result<(), ApiError> {
    match want {
        Some(w) if p.id.as_deref() != Some(w) => Err(bad("The question in the terminal changed. Look again and answer that one")),
        _ => Ok(()),
    }
}

/// The screen shows this AskUserQuestion item: every one of its options is a row of the menu.
fn shows_item(p: &CvPrompt, item: &CvQuestionItem) -> bool {
    item.options.iter().all(|o| p.options.iter().any(|r| row_shows(&r.label, &o.label) || norm(&r.label) == norm(&o.label)))
}

/// Actions that may run while a menu is open. Everything else ends with Enter (or opens its own
/// menu), and Enter would accept whatever the open dialog has highlighted.
fn runs_over_menus(a: &CvAction) -> bool {
    matches!(a, CvAction::Interrupt | CvAction::StopAgents | CvAction::Answer { .. } | CvAction::AnswerQuestion { .. })
}

/// Picks an option: its number, or arrows from the highlighted row and Enter.
async fn pick(pty: &Pty, o: &CvOption) -> Result<(), ApiError> {
    if !o.n.is_empty() {
        return put(pty, o.n.as_bytes());
    }
    let nav = o.nav.unwrap_or(0);
    let key = if nav < 0 { UP } else { DOWN };
    for _ in 0..nav.unsigned_abs().min(60) {
        put(pty, key)?;
        pause(40).await;
    }
    put(pty, b"\r")
}

/// Waits up to `ms` for a menu with an option matching `want`, then picks it.
async fn pick_where(pty: &Pty, ms: u64, want: impl Fn(&str) -> bool) -> Result<CvOption, ApiError> {
    let mut waited = 0;
    loop {
        if let Some(p) = menu_now(&pty.screen_text())
            && let Some(o) = p.options.iter().find(|o| want(&o.label.to_lowercase()))
        {
            pick(pty, o).await?;
            return Ok(o.clone());
        }
        if waited >= ms {
            return Err(bad("The expected menu did not appear in the terminal"));
        }
        pause(150).await;
        waited += 150;
    }
}

fn norm(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// Whether a (possibly cut off) menu row shows this prompt text.
fn row_shows(label: &str, text: &str) -> bool {
    let l = norm(label.trim_end_matches('…'));
    let t = norm(text);
    let n = l.chars().count().min(40);
    n >= 3 && t.starts_with(&l.chars().take(n).collect::<String>())
}

impl Core {
    pub async fn cv_action(self: &Arc<Self>, sid: &Id, action: CvAction) -> Result<(), ApiError> {
        let pty = self.pty(sid)?;
        let lock = self.cv.action_locks.lock().entry(sid.clone()).or_default().clone();
        let _one_at_a_time = lock.lock().await;
        if !runs_over_menus(&action) && menu_now(&pty.screen_text()).is_some() {
            return Err(bad("Answer the open question in the terminal first"));
        }
        match action {
            CvAction::Interrupt => put(&pty, b"\x1b"),
            CvAction::Background => put(&pty, b"\x02"),
            CvAction::StopAgents => {
                for _ in 0..2 {
                    put(&pty, b"\x18")?;
                    pause(60).await;
                    put(&pty, b"\x0b")?;
                    pause(200).await;
                }
                Ok(())
            }
            CvAction::SendQueuedNow => {
                put(&pty, b"\x18")?;
                pause(60).await;
                put(&pty, b"\x13")
            }
            CvAction::SetMode { mode } => {
                for _ in 0..8 {
                    if detect_mode(&pty.screen_text()) == Some(mode.as_str()) {
                        return Ok(());
                    }
                    put(&pty, SHIFT_TAB)?;
                    pause(300).await;
                }
                if detect_mode(&pty.screen_text()) == Some(mode.as_str()) {
                    Ok(())
                } else {
                    Err(bad(format!("The mode \"{mode}\" is not offered in this session (Shift+Tab)")))
                }
            }
            CvAction::Model { model } => {
                let ok = !model.is_empty() && model.len() <= 80 && model.chars().all(|c| c.is_ascii_alphanumeric() || "._-[]:".contains(c));
                if !ok {
                    return Err(bad("Not a model name"));
                }
                slash(&pty, &format!("/model {model}")).await
            }
            CvAction::Effort { level } => {
                if level != "auto" && !EFFORTS.contains(&level.as_str()) {
                    return Err(bad("Unknown effort level"));
                }
                slash(&pty, &format!("/effort {level}")).await
            }
            CvAction::Fast { on } => slash(&pty, if on { "/fast on" } else { "/fast off" }).await,
            CvAction::Shell { command } => {
                if command.trim().is_empty() {
                    return Err(bad("Empty command"));
                }
                put(&pty, b"!")?;
                pause(200).await;
                paste_enter(&pty, command.trim()).await
            }
            CvAction::Answer { n, nav, text, prompt_id } => {
                if n.is_empty() && nav.is_none() {
                    return Err(bad("Pick an answer"));
                }
                let prompt = menu_now(&pty.screen_text()).ok_or_else(|| bad("No question is shown in the terminal"))?;
                same_prompt(&prompt, prompt_id.as_deref())?;
                let o = prompt
                    .options
                    .iter()
                    .find(|o| if n.is_empty() { o.nav == nav } else { o.n == n })
                    .ok_or_else(|| bad("That answer is not offered any more"))?
                    .clone();
                pick(&pty, &o).await?;
                if let Some(t) = text.filter(|t| !t.trim().is_empty()) {
                    pause(400).await;
                    // The text goes into the text field the option opens, or becomes the next prompt; never
                    // into a different dialog that opened meanwhile (its Enter would accept it).
                    if o.text != Some(true) && menu_now(&pty.screen_text()).is_some_and(|now| now.id != prompt.id) {
                        return Err(bad("Answered. The next question is open, so the text was not sent"));
                    }
                    paste_enter(&pty, t.trim()).await?;
                }
                Ok(())
            }
            CvAction::AnswerQuestion { answers, prompt_id } => self.cv_answer_question(sid, &pty, answers, prompt_id.as_deref()).await,
            CvAction::Rewind { message_id, what } => self.cv_rewind(sid, &pty, &message_id, &what).await,
        }
    }

    /// AskUserQuestion: per question, the numbers of the chosen options (multi-select toggles
    /// them and moves on with Right), "Type something" for free text, then Submit.
    async fn cv_answer_question(&self, sid: &Id, pty: &Pty, answers: Vec<CvAnswer>, prompt_id: Option<&str>) -> Result<(), ApiError> {
        let q = self.cv_current_prompt(sid).and_then(|p| p.question).ok_or_else(|| bad("No question is waiting for an answer"))?;
        if answers.len() != q.questions.len() {
            return Err(bad("Answer every question"));
        }
        let first = menu_now(&pty.screen_text()).ok_or_else(|| bad("No question is shown in the terminal"))?;
        same_prompt(&first, prompt_id)?;
        for (item, ans) in q.questions.iter().zip(&answers) {
            // Each step only on the tab it belongs to (the screen is read again every time).
            let mut waited = 0;
            while !menu_now(&pty.screen_text()).is_some_and(|p| shows_item(&p, item)) {
                if waited >= 1500 {
                    return Err(bad("The question in the terminal changed. Answer it there"));
                }
                pause(150).await;
                waited += 150;
            }
            let num = |label: &str| item.options.iter().position(|o| o.label == label).map(|i| (i + 1).to_string());
            let other = item.options.len() + 1;
            let mut picks = vec![];
            for l in &ans.labels {
                picks.push(num(l).ok_or_else(|| bad(format!("\"{l}\" is not an option")))?);
            }
            if !item.multi_select && picks.len() + ans.other.iter().count() != 1 {
                return Err(bad("Pick exactly one answer"));
            }
            for p in &picks {
                put(pty, p.as_bytes())?;
                pause(250).await;
            }
            if let Some(t) = ans.other.as_deref().filter(|t| !t.trim().is_empty()) {
                put(pty, other.to_string().as_bytes())?;
                pause(300).await;
                paste_enter(pty, t.trim()).await?;
                pause(300).await;
            }
            if item.multi_select {
                put(pty, RIGHT)?;
                pause(300).await;
            }
        }
        // With more than one question (or multi-select) the CLI shows a review tab to submit.
        pause(300).await;
        if let Some(p) = menu_now(&pty.screen_text())
            && let Some(o) = p.options.iter().find(|o| o.label.to_lowercase().contains("submit"))
        {
            pick(pty, o).await?;
        }
        Ok(())
    }

    /// `/rewind`: opens the list, moves to the row of that prompt, picks what to restore.
    async fn cv_rewind(&self, sid: &Id, pty: &Pty, message_id: &str, what: &str) -> Result<(), ApiError> {
        let text = self.cv_user_text(sid, message_id).ok_or_else(|| bad("That message is not in this conversation"))?;
        slash(pty, "/rewind").await?;
        let mut waited = 0;
        let row = loop {
            pause(200).await;
            waited += 200;
            if let Some(p) = menu_now(&pty.screen_text())
                && let Some(o) = p.options.iter().rev().find(|o| row_shows(&o.label, &text))
            {
                break o.clone();
            }
            if waited >= 3000 {
                put(pty, b"\x1b")?;
                return Err(bad("Could not find that message in the rewind list"));
            }
        };
        pick(pty, &row).await?;
        let want = |l: &str| match what {
            "code" => l.contains("restore code") && !l.contains("conversation"),
            "conversation" => l.contains("conversation") && !l.contains("code"),
            "summarize" => l.contains("summarize"),
            _ => l.contains("code and conversation") || l.contains("conversation and code"),
        };
        match pick_where(pty, 2500, want).await {
            Ok(_) => Ok(()),
            Err(e) => {
                put(pty, b"\x1b")?;
                Err(e)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answers_only_go_to_the_prompt_they_were_meant_for() {
        let screen = "Bash command\n  rm -rf build\nDo you want to proceed?\n❯ 1. Yes\n  2. Yes, and don't ask again for rm\n  3. No\n";
        let p = menu_now(screen).unwrap();
        assert!(same_prompt(&p, p.id.as_deref()).is_ok());
        assert!(same_prompt(&p, None).is_ok());
        assert!(same_prompt(&p, Some("0000000000000000")).is_err());
        let item = CvQuestionItem {
            question: "Color?".into(),
            options: vec![
                CvQuestionOption { label: "Red".into(), ..Default::default() },
                CvQuestionOption { label: "Blue".into(), ..Default::default() },
            ],
            ..Default::default()
        };
        let opt = |l: &str| CvOption { n: "1".into(), label: l.into(), ..Default::default() };
        let q = CvPrompt { title: "Color?".into(), options: vec![opt("Red"), opt("Blue"), opt("Type something.")], ..Default::default() };
        assert!(shows_item(&q, &item));
        assert!(!shows_item(&p, &item));
        assert!(!runs_over_menus(&CvAction::Model { model: "opus".into() }));
        assert!(runs_over_menus(&CvAction::Interrupt));
    }

    #[test]
    fn rewind_rows_match_cut_off_prompts() {
        assert!(row_shows("fix the bug in the parser so that…", "Fix the bug in the parser so that it handles\nnew lines"));
        assert!(!row_shows("add a test", "fix the bug"));
        assert!(!row_shows("(current)", "fix"));
    }
}
