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
    no_draft(pty)?;
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

/// A row of the `/tasks` list: the name and whether its state says it runs.
#[derive(Debug, PartialEq)]
struct TaskRow {
    name: String,
    running: bool,
}

/// What `/tasks` shows: one task's page (its type and name) or the list (rows, the selected one).
#[derive(Debug, PartialEq)]
enum TasksView {
    Page { kind: String, name: String },
    List { rows: Vec<TaskRow>, at: Option<usize> },
}

/// A full-width rule: the top of a dialog ("▔▔▔", or "───" as 2.1.316 draws it) or the text field's border.
fn is_rule(l: &str) -> bool {
    let t = l.trim();
    t.contains("▔▔▔") || (t.chars().count() >= 20 && t.chars().all(|c| c == '─'))
}

/// The `/tasks` dialog is on the screen (its list or a task's page), even one we cannot read.
/// Only then may Esc close it: on the main screen Esc would interrupt Claude.
fn tasks_shown(screen: &str) -> bool {
    screen
        .lines()
        .rev()
        .take(40)
        .any(|l| (l.contains("to select") && l.contains("Enter to view")) || (l.contains("← to go back") && l.contains("to close")))
}

/// Reads the `/tasks` dialog off the screen (Claude Code 2.1: "↑/↓ to select · … · x to stop" under
/// the list, "← to go back · … · x to stop" under a task's page, whose title is "type › name").
/// While Claude works the dialog sits above the text field, otherwise in its place.
fn tasks_dialog(screen: &str) -> Option<TasksView> {
    let lines: Vec<&str> = screen.lines().collect();
    let foot = lines.iter().rposition(|l| l.contains("x to stop"))?;
    // The dialog starts under its top rule; the conversation above it has "⏺" lines too.
    let top = lines[..foot].iter().rposition(|l| is_rule(l))? + 1;
    let body = &lines[top..foot];
    if lines[foot].contains("to select") {
        let mut rows = Vec::new();
        let mut at = None;
        for l in body {
            let t = l.trim();
            let sel = t.starts_with('❯');
            let rest = t.trim_start_matches('❯').trim_start();
            // A row: a status mark, the name, a gap, its state ("⏺ Wait A   running · Sonnet 5.5").
            let Some(rest) = rest.strip_prefix(['⏺', '●', '◯', '○', '✓', '✔', '✗', '✘', '⎿']) else { continue };
            if sel {
                at = Some(rows.len());
            }
            let mut parts = rest.split("  ").map(str::trim).filter(|p| !p.is_empty());
            let name = parts.next().unwrap_or("").to_string();
            let running = parts.next().is_some_and(|s| s.to_lowercase().starts_with("running"));
            rows.push(TaskRow { name, running });
        }
        return (!rows.is_empty()).then_some(TasksView::List { rows, at });
    }
    let (kind, name) = body.iter().find_map(|l| l.split_once(" › ").map(|(k, n)| (k.trim().to_string(), n.to_string())))?;
    let name = name.split("  ").next().unwrap_or("").trim().to_string();
    Some(TasksView::Page { kind, name })
}

/// The list's or page's name is this task's: the same words, or (cut off with "…") the start of them.
fn same_name(shown: &str, want: &str) -> bool {
    let (s, w) = (norm(shown), norm(want));
    match s.strip_suffix('…') {
        Some(cut) => cut.trim_end().chars().count() >= 8 && w.starts_with(cut.trim_end()),
        None => !s.is_empty() && s == w,
    }
}

/// "general-purpose" and "General purpose" are the same agent type.
fn same_type(a: &str, b: &str) -> bool {
    let n = |s: &str| s.to_lowercase().replace(['-', '_'], " ");
    n(a) == n(b)
}

/// The text typed into Claude's text field: the box between two rules whose first row starts with
/// `❯`. When the cursor the CLI draws (`cursor`: its row and the text before it) is in the box,
/// only what stands before it counts: a suggestion or a placeholder starts at the cursor.
/// `None` when no text field shows (a dialog took its place).
fn typed_text(rows: &[String], cursor: Option<&(usize, String)>) -> Option<String> {
    let rules: Vec<usize> = rows.iter().enumerate().filter(|(_, l)| is_rule(l) && !l.contains('▔')).map(|(i, _)| i).collect();
    for w in rules.windows(2).rev() {
        let (a, b) = (w[0], w[1]);
        if b - a < 2 || b - a > 20 || !rows[a + 1].trim_start().starts_with('❯') {
            continue;
        }
        let at = cursor.filter(|(r, _)| (a + 1..b).contains(r));
        let mut text = String::new();
        for (i, row) in rows.iter().enumerate().take(b).skip(a + 1) {
            let row = match at {
                Some((r, before)) if *r == i => before.as_str(),
                Some((r, _)) if *r < i => break,
                _ => row.as_str(),
            };
            let row = if i == a + 1 { row.trim_start().trim_start_matches('❯') } else { row };
            text.push_str(row.trim());
            text.push(' ');
        }
        return Some(text.trim().to_string());
    }
    None
}

/// Keys that end with Enter must not land on text someone typed into Claude's text field (it
/// would be sent with them).
fn no_draft(pty: &Pty) -> Result<(), ApiError> {
    let (rows, cursor) = pty.rows_and_cursor();
    match typed_text(&rows, cursor.as_ref()) {
        Some(t) if !t.is_empty() => Err(bad("Claude's text field on the computer has unsent text. Send or clear it first")),
        _ => Ok(()),
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
        let screen = pty.screen_text();
        // Stopping a task may use a task list that is open already (it reads as a menu).
        let own_dialog = matches!(action, CvAction::StopTask { .. }) && tasks_shown(&screen);
        if !runs_over_menus(&action) && !own_dialog && menu_now(&screen).is_some() {
            return Err(bad("Answer the open question in the terminal first"));
        }
        match action {
            CvAction::Interrupt => put(&pty, b"\x1b"),
            CvAction::Background => put(&pty, b"\x02"),
            CvAction::StopTask { id } => self.cv_stop_task(sid, &pty, &id).await,
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
                no_draft(&pty)?;
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

    /// `/tasks`, select the task's row, open its page (Enter; one task opens there directly),
    /// check the page is this task's, `x`, close the list. The page belongs to one task, so a
    /// list that changes order under the selection cannot make `x` stop another one. Nothing is
    /// typed over unsent text in the text field. Every key after `/tasks` is checked against
    /// the screen; on doubt the dialog is closed and nothing is stopped (D65).
    async fn cv_stop_task(&self, sid: &Id, pty: &Pty, id: &str) -> Result<(), ApiError> {
        let t = self.cv_task(sid, id).ok_or_else(|| bad("That task is not in this conversation"))?;
        if t.status != "running" {
            return Err(bad("That task is not running any more"));
        }
        if !t.background || t.parent.is_some() {
            return Err(bad("Only background tasks of the conversation stop one by one"));
        }
        // The names Claude's list may show for it: what it was asked to do, else its command.
        let names: Vec<String> =
            [Some(t.description.clone()), t.command.clone()].into_iter().flatten().filter(|n| n.trim().chars().count() >= 3).collect();
        if names.is_empty() {
            return Err(bad("This task has no name to find it by"));
        }
        let is_it = |n: &str| names.iter().any(|w| same_name(n, w));
        let twins =
            self.cv_running_tasks(sid).iter().filter(|o| o.id != t.id && !o.description.is_empty() && is_it(&o.description)).count();
        if twins > 0 {
            return Err(bad("Several running tasks have that name. Stop it in the terminal (/tasks)"));
        }
        let page_ok = |kind: &str, name: &str| {
            is_it(name) && (kind.is_empty() || t.agent_type.as_deref().is_none_or(|a| t.kind != "agent" || same_type(kind, a)))
        };
        let close = |pty: &Pty, e: ApiError| {
            // Esc only while the dialog shows: on the main screen it would interrupt Claude.
            if tasks_shown(&pty.screen_text()) {
                let _ = put(pty, b"\x1b");
            }
            Err(e)
        };
        if !tasks_shown(&pty.screen_text()) {
            slash(pty, "/tasks").await?;
        }
        let mut waited = 0;
        let view = loop {
            if let Some(v) = tasks_dialog(&pty.screen_text()) {
                break v;
            }
            if waited >= 3000 {
                return close(pty, bad("The task list did not open"));
            }
            pause(150).await;
            waited += 150;
        };
        if let TasksView::List { .. } = view {
            let mut steps = 0;
            loop {
                let Some(TasksView::List { rows, at }) = tasks_dialog(&pty.screen_text()) else {
                    return close(pty, bad("The task list closed"));
                };
                let mut hits: Vec<usize> = rows.iter().enumerate().filter(|(_, r)| is_it(&r.name)).map(|(i, _)| i).collect();
                if hits.len() > 1 {
                    hits.retain(|&i| rows[i].running);
                }
                let [hit] = hits[..] else {
                    return close(
                        pty,
                        bad(if hits.is_empty() { "That task is not in Claude's list" } else { "Several tasks have that name" }),
                    );
                };
                if at == Some(hit) {
                    break;
                }
                let Some(at) = at else { return close(pty, bad("No row is selected")) };
                if steps >= 40 {
                    return close(pty, bad("Could not select that task"));
                }
                put(pty, if hit < at { UP } else { DOWN })?;
                steps += 1;
                pause(80).await;
            }
            put(pty, b"\r")?;
        }
        let mut waited = 0;
        loop {
            match tasks_dialog(&pty.screen_text()) {
                Some(TasksView::Page { kind, name }) if page_ok(&kind, &name) => break,
                Some(TasksView::Page { .. }) => return close(pty, bad("Claude shows a different task")),
                _ if waited >= 1500 => return close(pty, bad("The task did not open in Claude's list")),
                _ => {}
            }
            pause(100).await;
            waited += 100;
        }
        put(pty, b"x")?;
        pause(500).await;
        // `x` on a page goes back to the list (Claude Code 2.1.316); close whatever is left, so
        // the task's end reaches the conversation ("update waiting while this panel is open").
        if tasks_shown(&pty.screen_text()) {
            put(pty, b"\x1b")?;
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
    fn tasks_dialog_list_and_page() {
        let row = |n: &str| TaskRow { name: n.into(), running: true };
        let list = "⏺ ok\n✻ Waiting for 2 background agents to finish\n▔▔▔▔\n  Background\n  2 active agents\n  Local agents (2)\n   ❯ ⏺ Wait B   running · Sonnet 5.5\n     ⏺ Wait A   running · Sonnet 5.5\n  ↑/↓ to select · Enter to view · f to foreground · x to stop · ctrl+x ctrl+k to stop all agents · Esc to close\n";
        assert_eq!(tasks_dialog(list), Some(TasksView::List { rows: vec![row("Wait B"), row("Wait A")], at: Some(0) }));
        let page = "  Searched code, read a file › x\n▔▔▔▔\n  general-purpose › Node wait                                    22s · 21.3k tokens · 1 tool\n  Progress\n    › Bash(node -e \"x\")\n  ← to go back · Esc/Enter/Space to close · x to stop · f to foreground\n";
        assert_eq!(tasks_dialog(page), Some(TasksView::Page { kind: "general-purpose".into(), name: "Node wait".into() }));
        assert_eq!(tasks_dialog("❯ \n  ⏵⏵ bypass permissions on"), None);
        assert!(tasks_shown(list) && tasks_shown(page) && !tasks_shown("❯ \n  ⏵⏵ bypass permissions on"));

        // Claude Code 2.1.316 as it really draws: "───" rules; idle, the list replaces the text field.
        let rule = "─".repeat(60);
        let idle = format!(
            "⏺ launched\n✻ Waiting for 2 background agents to finish\n❯ /tasks\n{rule}\n  Background\n  2 active agents\n  Local agents (2)\n  ❯ ⏺ Wait B   running · Haiku 5.5\n    ⏺ Wait A   running · Haiku 5.5\n  ↑/↓ to select · Enter to view · f to foreground · x to stop · ctrl+x ctrl+k to stop all agents · Esc to\n  close\n"
        );
        assert_eq!(tasks_dialog(&idle), Some(TasksView::List { rows: vec![row("Wait B"), row("Wait A")], at: Some(0) }));
        // Busy: the page sits above the text field (which stays empty).
        let busy = format!(
            "· Germinating… (36s · ↓ 385 tokens)\n{rule}\n  general-purpose › Wait B\n  7m 7s · 9.9k tokens · 1 tool · Haiku 5.5\n\n  Progress\n  › Bash(until [ -f /tmp/stop-b ]; do sleep 2; done)\n\n  ← to go back · Esc/Enter/Space to close · x to stop · f to foreground\n\n{rule}\n❯  \n{rule}\n  ⏵⏵ auto mode on (shift+tab to cycle)\n"
        );
        assert_eq!(tasks_dialog(&busy), Some(TasksView::Page { kind: "general-purpose".into(), name: "Wait B".into() }));
        assert!(tasks_shown(&busy));
        // Nothing runs: no "x to stop", nothing to read, but still a dialog to close.
        let done = format!(
            "❯ /tasks\n{rule}\nBackground\nCompleted (2)\n❯ ✔ Wait B   done · Haiku 5.5\n  ✔ Wait A   done · Haiku 5.5\n↑/↓ to select · Enter to view · Esc to close\n"
        );
        assert_eq!(tasks_dialog(&done), None);
        assert!(tasks_shown(&done));
        // Same names: only a running row counts.
        let mixed = format!(
            "{rule}\n  ❯ ⏺ Wait A   running · Haiku 5.5\n    ✔ Wait A   done · Haiku 5.5\n  ↑/↓ to select · Enter to view · x to stop · Esc to close\n"
        );
        let Some(TasksView::List { rows, .. }) = tasks_dialog(&mixed) else { panic!() };
        assert_eq!(rows.iter().map(|r| r.running).collect::<Vec<_>>(), [true, false]);
    }

    #[test]
    fn task_names_match_exactly_or_by_a_long_cut() {
        assert!(same_name("Wait A", "wait  a"));
        assert!(!same_name("Wait", "Wait A"), "a shorter name is another task");
        assert!(!same_name("Wait A", "Wait"));
        assert!(same_name("Review the parser and…", "Review the parser and its tests"));
        assert!(!same_name("Rev…", "Review the parser"), "too short a cut to be sure");
        assert!(same_type("general-purpose", "General purpose") && !same_type("Explore", "general-purpose"));
    }

    #[test]
    fn typed_text_only_counts_what_is_before_the_cursor() {
        let rule = "─".repeat(60);
        let rows = |s: &str| s.lines().map(str::to_string).collect::<Vec<_>>();
        let empty = rows(&format!("⏺ hi\n{rule}\n❯  \n{rule}\n  ⏵⏵ auto mode on"));
        assert_eq!(typed_text(&empty, Some(&(2, "❯ ".into()))).as_deref(), Some(""));
        assert_eq!(typed_text(&empty, None).as_deref(), Some(""));
        let draft = rows(&format!("{rule}\n❯ hello draft\n{rule}\n  ⏵⏵ auto mode on"));
        assert_eq!(typed_text(&draft, Some(&(1, "❯ hello draf".into()))).as_deref(), Some("hello draf"));
        assert_eq!(typed_text(&draft, None).as_deref(), Some("hello draft"));
        // A suggestion (or placeholder) starts at the cursor: nothing typed.
        let ghost = rows(&format!("{rule}\n❯ run the tests\n{rule}\n"));
        assert_eq!(typed_text(&ghost, Some(&(1, "❯ ".into()))).as_deref(), Some(""));
        // Two lines typed, cursor on the second.
        let two = rows(&format!("{rule}\n❯ first line\n  second\n{rule}\n"));
        assert_eq!(typed_text(&two, Some(&(2, "  sec".into()))).as_deref(), Some("first line sec"));
        // A dialog in place of the text field: no text field.
        let dialog = rows(&format!("{rule}\nx\n✻ Waiting\n❯ /tasks\n{rule}\n  Background\n"));
        assert_eq!(typed_text(&dialog, None), None);
        // The cursor elsewhere (a list below) does not hide the draft.
        assert_eq!(typed_text(&draft, Some(&(3, "  ".into()))).as_deref(), Some("hello draft"));
    }

    #[test]
    fn rewind_rows_match_cut_off_prompts() {
        assert!(row_shows("fix the bug in the parser so that…", "Fix the bug in the parser so that it handles\nnew lines"));
        assert!(!row_shows("add a test", "fix the bug"));
        assert!(!row_shows("(current)", "fix"));
    }
}
