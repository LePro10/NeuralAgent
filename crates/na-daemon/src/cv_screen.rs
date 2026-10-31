//! Claude view: more that is read off the CLI's screen. The busy spinner (Claude Code drops
//! "esc to interrupt" when a statusline is configured, so the spinner glyph is what is left),
//! menus without numbers (folder trust, some pickers), checkbox rows and what kind of question
//! a menu is.

use na_protocol::*;

/// The glyphs Claude Code's spinner cycles through.
const SPINNER: &[char] = &['·', '✢', '✳', '✶', '✻', '✽', '*', '∗'];

fn row(l: &str) -> &str {
    l.trim().trim_matches('│').trim()
}

/// "✶ Roosting… (12s · ↓ 300 tokens)" → that text while Claude works. A finished turn's line
/// ("✻ Baked for 14s · done") has no "…" and does not count.
pub fn spinner(screen: &str) -> Option<String> {
    screen.lines().rev().take(24).map(row).find(|t| is_spinner(t)).map(str::to_string)
}

pub fn is_spinner(t: &str) -> bool {
    if t.contains("esc to interrupt") {
        return true;
    }
    let mut it = t.chars();
    let Some(g) = it.next() else { return false };
    if !SPINNER.contains(&g) || it.next() != Some(' ') {
        return false;
    }
    let rest: String = it.collect();
    // The verb: a capitalised word (sometimes two) right before the ellipsis.
    let Some(dots) = rest.find('…') else { return false };
    let verb = &rest[..dots];
    !verb.is_empty()
        && verb.chars().count() <= 40
        && verb.chars().next().is_some_and(|c| c.is_uppercase())
        && verb.chars().all(|c| c.is_alphabetic() || c == ' ' || c == '-' || c == '\'')
}

/// "[ ] Option", "[✓] Option", "☒ Option" → (checked, label without the box).
pub fn checkbox(label: &str) -> (Option<bool>, String) {
    for (p, on) in [
        ("[ ]", false),
        ("[✓]", true),
        ("[✔]", true),
        ("[x]", true),
        ("[X]", true),
        ("☐", false),
        ("☒", true),
        ("☑", true),
        ("◯", false),
        ("◉", true),
    ] {
        if let Some(rest) = label.strip_prefix(p) {
            return (Some(on), rest.trim().to_string());
        }
    }
    (None, label.to_string())
}

/// Choosing this option makes the CLI ask for typed text.
pub fn wants_text(label: &str) -> bool {
    let l = label.to_lowercase();
    l.contains("tell claude what to do")
        || l.starts_with("type something")
        || l.starts_with("type here")
        || l == "other"
        || l.contains("tell claude what to change")
}

fn pointer(t: &str) -> Option<&str> {
    t.strip_prefix('❯').or_else(|| t.strip_prefix('›')).map(str::trim_start)
}

/// A menu without numbers: a `❯` row and its siblings at the same indent, with a key hint below
/// ("Enter to confirm · Esc to cancel"). Options answer with arrow keys: `nav` is the number of
/// Down presses from the highlighted row (negative: Up).
pub fn detect_menu(screen: &str) -> Option<CvPrompt> {
    let lines: Vec<&str> = screen.lines().collect();
    let last = lines.iter().rposition(|l| !row(l).is_empty())?;
    let from = last.saturating_sub(30);
    let hint = (from..=last).rev().find(|&i| {
        let t = row(lines[i]).to_lowercase();
        t.contains("enter to confirm") || t.contains("enter to select") || t.contains("↑/↓") || t.contains("↑↓")
    })?;
    // The highlighted row above the hint.
    let sel = (from..hint).rev().take(20).find(|&i| pointer(row(lines[i])).is_some_and(|r| !r.is_empty()))?;
    let text_col = {
        let l = lines[sel];
        let p = l.find(['❯', '›'])?;
        l[..p].chars().count() + 2
    };
    let lead = |l: &str| l.chars().take_while(|c| *c == ' ' || *c == '│').count();
    let is_sib = |l: &str| !row(l).is_empty() && pointer(row(l)).is_none() && lead(l) == text_col;
    // A dimmed line under an option (deeper indent) describes it.
    let is_desc = |l: &str| !row(l).is_empty() && pointer(row(l)).is_none() && lead(l) > text_col;
    let mut start = sel;
    while start > from && (is_sib(lines[start - 1]) || is_desc(lines[start - 1])) {
        start -= 1;
    }
    while start < sel && !is_sib(lines[start]) {
        start += 1;
    }
    let mut end = sel;
    while end + 1 < hint && (is_sib(lines[end + 1]) || is_desc(lines[end + 1])) {
        end += 1;
    }
    let mut options: Vec<CvOption> = vec![];
    let mut sel_ix = 0i32;
    for (i, l) in lines.iter().enumerate().take(end + 1).skip(start) {
        let l = *l;
        if i != sel && is_desc(l) {
            if let Some(o) = options.last_mut() {
                let d = row(l).to_string();
                o.description = Some(match o.description.take() {
                    Some(p) => format!("{p}\n{d}"),
                    None => d,
                });
            }
            continue;
        }
        let t = row(l);
        let label = pointer(t).unwrap_or(t);
        let (checked, label) = checkbox(label);
        let label = label.trim_end_matches('│').trim().to_string();
        if i == sel {
            sel_ix = options.len() as i32;
        }
        options.push(CvOption {
            n: String::new(),
            selected: i == sel,
            checked,
            text: wants_text(&label).then_some(true),
            label,
            ..Default::default()
        });
    }
    if options.len() < 2 {
        return None;
    }
    for (k, o) in options.iter_mut().enumerate() {
        o.nav = Some(k as i32 - sel_ix);
    }
    // The question: the text lines above, up to a rule (the box's top edge).
    let mut title: Vec<String> = vec![];
    for l in lines[..start].iter().rev().take(16) {
        let t = row(l);
        if !t.is_empty() && t.chars().all(|c| "─━═╌╍┄┅┈┉╭╮╰╯-".contains(c)) {
            break;
        }
        if t.is_empty() && (title.is_empty() || title.last().is_some_and(String::is_empty)) {
            continue;
        }
        title.push(t.to_string());
    }
    while title.last().is_some_and(String::is_empty) {
        title.pop();
    }
    title.reverse();
    Some(CvPrompt { title: title.join("\n"), options, ..Default::default() })
}

/// A prompt's fingerprint: its title and option labels as shown (not the highlighted row or the
/// checkbox state), FNV-1a, hex. The same screen always gives the same id.
pub fn fingerprint(p: &CvPrompt) -> String {
    let norm = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut h: u64 = 0xcbf29ce484222325;
    let mut eat = |s: &str| {
        for b in s.bytes().chain([0u8]) {
            h = (h ^ b as u64).wrapping_mul(0x100000001b3);
        }
    };
    eat(&norm(&p.title));
    for o in &p.options {
        eat(&o.n);
        eat(&norm(&o.label));
    }
    format!("{h:016x}")
}

/// What a menu asks, from its words (the hooks and the pending tool call refine this).
pub fn classify(p: &CvPrompt) -> &'static str {
    let title = p.title.to_lowercase();
    let labels: Vec<String> = p.options.iter().map(|o| o.label.to_lowercase()).collect();
    let any = |n: &str| labels.iter().any(|l| l.contains(n));
    if any("keep planning") || any("auto-accept edits") && title.contains("plan") || title.contains("ready to code") {
        "plan"
    } else if any("don't ask again") || any("don\u{2019}t ask again") || title.contains("do you want to") || any("allow") && any("deny") {
        "permission"
    } else if any("type something") || any("chat about this") || p.options.iter().any(|o| o.checked.is_some()) {
        "question"
    } else if title.contains("trust") || labels.len() == 2 && (labels[0].starts_with("yes") || labels[0].starts_with("no")) {
        "confirm"
    } else {
        "menu"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spinner_with_and_without_the_hint() {
        let busy = "● Counting\n\n✶ Roosting… \n\n────\n❯ \n────\n  Haiku · ctx 26k (3%)\n  ⏵⏵ bypass permissions on (shift+tab to cycle)";
        assert_eq!(spinner(busy).as_deref(), Some("✶ Roosting…"));
        let old = "✻ Thinking… (12s · esc to interrupt)\n❯ ";
        assert_eq!(spinner(old).as_deref(), Some("✻ Thinking… (12s · esc to interrupt)"));
        let done = "✻ Baked for 14s · done 12:40 PM\n\n────\n❯ \n────\n  ⏵⏵ bypass permissions on (shift+tab to cycle)";
        assert_eq!(spinner(done), None);
        assert!(is_spinner("· Shimmying… (3s · ↓ 12 tokens)"));
        assert!(!is_spinner("* a list item… that trails"));
        assert!(!is_spinner("● Done…"));
    }

    #[test]
    fn trust_dialog_without_numbers() {
        let s = "╭────────╮\n│ Do you trust the files in this folder?\n│\n│ /tmp/x\n│\n│ ❯ No, exit\n│   Yes, I trust this folder\n│\n│ Enter to confirm · Esc to cancel\n╰────────╯";
        let p = detect_menu(s).unwrap();
        assert_eq!(p.options.len(), 2);
        assert_eq!((p.options[0].label.as_str(), p.options[0].selected, p.options[0].nav), ("No, exit", true, Some(0)));
        assert_eq!((p.options[1].label.as_str(), p.options[1].nav), ("Yes, I trust this folder", Some(1)));
        assert_eq!(p.title, "Do you trust the files in this folder?\n\n/tmp/x");
        assert_eq!(classify(&p), "confirm");
        let r = "Rewind\n\n  ❯ fix the bug\n      2 files changed\n    add a test\n      No code changes\n    (current)\n\n  Enter to continue · Esc to exit · ↑/↓ to navigate";
        let p = detect_menu(r).unwrap();
        let labels: Vec<_> = p.options.iter().map(|o| (o.label.as_str(), o.nav, o.description.as_deref())).collect();
        assert_eq!(
            labels,
            vec![
                ("fix the bug", Some(0), Some("2 files changed")),
                ("add a test", Some(1), Some("No code changes")),
                ("(current)", Some(2), None)
            ]
        );
        // The input box is not a menu.
        assert!(detect_menu("────\n❯ hello\n────\n  ⏵⏵ bypass permissions on (shift+tab to cycle)").is_none());
    }

    #[test]
    fn checkboxes_and_kinds() {
        assert_eq!(checkbox("[ ] Red"), (Some(false), "Red".into()));
        assert_eq!(checkbox("[✓] Blue"), (Some(true), "Blue".into()));
        assert_eq!(checkbox("Plain"), (None, "Plain".into()));
        assert!(wants_text("No, and tell Claude what to do differently (esc)"));
        assert!(wants_text("Type something."));
        let opt = |l: &str| CvOption { n: "1".into(), label: l.into(), ..Default::default() };
        let perm = CvPrompt {
            title: "Bash command\nls\nDo you want to proceed?".into(),
            options: vec![opt("Yes"), opt("Yes, and don't ask again for ls"), opt("No")],
            ..Default::default()
        };
        assert_eq!(classify(&perm), "permission");
        let plan = CvPrompt {
            title: "Would you like to proceed?".into(),
            options: vec![opt("Yes, and auto-accept edits"), opt("No, keep planning")],
            ..Default::default()
        };
        assert_eq!(classify(&plan), "plan");
        let q = CvPrompt { title: "Which color?".into(), options: vec![opt("Red"), opt("Type something.")], ..Default::default() };
        assert_eq!(classify(&q), "question");
        let m = CvPrompt { title: "Select model".into(), options: vec![opt("Default"), opt("Opus"), opt("Haiku")], ..Default::default() };
        assert_eq!(classify(&m), "menu");
        // The fingerprint ignores the highlight and whitespace, not the words.
        let mut moved = m.clone();
        moved.options[0].selected = true;
        moved.title = "Select  model".into();
        assert_eq!(fingerprint(&m), fingerprint(&moved));
        assert_ne!(fingerprint(&m), fingerprint(&perm));
        assert_eq!(fingerprint(&m).len(), 16);
    }
}
